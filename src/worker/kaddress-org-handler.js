/**
 * src/worker/kaddress-org-handler.js
 * ------------------------------------------------------------------
 * K-Address(mail.hondi.net 주소록) 소속 기관 계층 — 트리 CRUD, 연락처 배정,
 * 정합성 복구. 2026-09-21 신설(주피터 지시: "학교-대학-제주대학-컴퓨터공학과"
 * 같은 계층 분류). 스키마는 pb_migrations/1794010001·1794010002.
 *
 * 구조(설계 결정은 마이그레이션 주석 참고)
 *  · org_units  — 사용자(owner_user_guid)별 트리 노드. parent_id는 text,
 *                 path는 루트부터 '>'로 이은 전체 경로.
 *  · kmail_contacts.org_unit / org_path — 연락처가 속한 "가장 하위" 노드 id와
 *                 그 경로의 비정규화 복사본(하위 포함 조회용).
 *
 * 왜 worker.js가 아니라 별도 모듈인가: worker.js는 여러 세션이 동시에 고치는
 * 대형 공유 파일이라(2026-08-21 재발 방지 지시), 새 로직은 makeKfoiHandlers와
 * 같은 팩토리 방식으로 분리하고 worker.js에는 import·라우트·조회 필터 몇 줄만
 * 남긴다. 의존성(kAuth/err/l1AdminToken/L1_DEFAULT/fetch)은 주입받으므로
 * 네트워크 없이도(또는 로컬 PocketBase에 붙여) 그대로 테스트할 수 있다.
 *
 * 무결성 원칙
 *  · PocketBase 0.22는 여러 요청에 걸친 트랜잭션이 없다. 노드 이름 변경/이동은
 *    "노드 PATCH들 → 연락처 org_path PATCH들" 순서로 진행하고, 중간에 실패하거나
 *    예산(CONTACT_WRITE_BUDGET)을 넘으면 어긋난 상태가 남을 수 있다. 그래서
 *    org_unit(연락처→노드 id)과 parent_id(노드→부모 id)를 "진실"로 삼고
 *    path/org_path는 언제든 그로부터 다시 계산 가능한 파생값으로 취급한다
 *    — POST /kmail/org-units/resync가 그 복구 경로다(반복 호출해 pending=0까지).
 *  · 조회 필터는 반드시 (org_path='X' || org_path~'X>%') 형태다. 단순 접두
 *    (org_path~'X%')는 '제주대학교'가 형제 '제주대학교병원'까지 잡는다
 *    (PocketBase 0.22.14 실측).
 */

export const ORG_PATH_SEP = '>';
export const ORG_MAX_DEPTH = 12;           // org_units.depth 스키마 상한과 동일
export const ORG_NAME_MAX = 100;           // org_units.name 스키마 상한과 동일
export const ORG_ALIAS_MAX = 20;           // 노드당 별칭 개수 상한
export const ASSIGN_MAX = 100;             // /kmail/contacts/assign-org 1회 상한
export const CONTACT_WRITE_BUDGET = 200;   // 한 요청에서 연락처 PATCH 상한(서브리퀘스트 보호)
export const NODE_WRITE_BUDGET = 200;      // 한 요청에서 노드 PATCH 상한
export const ORG_UNASSIGNED = '__NONE__';  // 목록 조회에서 "미분류" 버킷 예약어(category와 동일 관례)

const PAGE_SIZE = 500;
const MAX_PAGES = 20;                      // 안전장치: 1만 건까지만 훑는다
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;     // 필터·URL에 그대로 들어가므로 엄격히 제한
const FORBIDDEN_CHARS = /[>%\\\u0000-\u001f]/; // '>' 경로 구분자, '%' LIKE 와일드카드, '\' 필터 이스케이프, 제어문자

// ── 시드 템플릿 ─────────────────────────────────────────────
// "제안"이다 — 사용자가 노드를 자유롭게 추가·이름변경·이동·삭제할 수 있고,
// seed 호출은 이미 있는 경로를 건드리지 않는다(멱등).
export const SEED_TEMPLATE = [
  { name: '학교', children: ['초등학교', '중학교', '고등학교', '대학', '대학원'] },
  { name: '정부·공공기관', children: ['중앙정부', '지방자치단체', '공공기관', '국회·법원'] },
  { name: '기업', children: [] },
  { name: '연구기관', children: [] },
  { name: '의료기관', children: ['병원', '의원', '약국'] },
  { name: '협회·단체', children: [] },
  { name: '언론·방송', children: [] },
  { name: '금융기관', children: ['은행', '증권·보험'] },
  { name: '국제·외국기관', children: [] },
];

// ── 순수 함수(네트워크 없음) ─────────────────────────────────

/** 노드 이름/별칭 검증·정규화. 앞뒤 공백 제거, 연속 공백은 하나로. */
export function validateOrgName(raw) {
  if (typeof raw !== 'string') return { ok: false, code: 'INVALID_NAME', message: '이름은 문자열이어야 합니다' };
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, code: 'INVALID_NAME', message: '이름이 비어 있습니다' };
  if (name.length > ORG_NAME_MAX) return { ok: false, code: 'INVALID_NAME', message: `이름은 ${ORG_NAME_MAX}자 이하여야 합니다` };
  if (FORBIDDEN_CHARS.test(name)) {
    return { ok: false, code: 'INVALID_NAME', message: "이름에는 '>', '%', '\\' 및 제어문자를 쓸 수 없습니다('>'는 경로 구분자)" };
  }
  if (name === ORG_UNASSIGNED) return { ok: false, code: 'INVALID_NAME', message: `'${ORG_UNASSIGNED}'는 예약어입니다` };
  return { ok: true, name };
}

/** 별칭 배열 검증·정규화(중복·빈 값 제거). */
export function normalizeAliases(raw) {
  if (!Array.isArray(raw)) return { ok: false, code: 'INVALID_ALIASES', message: 'aliases는 문자열 배열이어야 합니다' };
  const out = [];
  for (const a of raw) {
    const v = validateOrgName(a);
    if (!v.ok) return { ok: false, code: 'INVALID_ALIASES', message: `별칭 오류: ${v.message}` };
    if (!out.includes(v.name)) out.push(v.name);
  }
  if (out.length > ORG_ALIAS_MAX) return { ok: false, code: 'INVALID_ALIASES', message: `별칭은 ${ORG_ALIAS_MAX}개 이하여야 합니다` };
  return { ok: true, aliases: out };
}

export function buildPath(parentPath, name) {
  return parentPath ? `${parentPath}${ORG_PATH_SEP}${name}` : name;
}

/**
 * 하위 포함 조회 필터 조각. 정확 일치 OR "경로>" 접두 일치.
 * path에 '%'·'\\'가 있으면 호출부가 먼저 거부해야 한다(validatePathParam).
 */
export function orgPathFilterClause(path, esc = s => String(s).replace(/'/g, "\\'")) {
  const p = esc(path);
  return `(org_path='${p}' || org_path~'${p}${ORG_PATH_SEP}%')`;
}

/** GET 파라미터로 들어온 org_path 검증. 빈 값/'__NONE__'/유효 경로만 통과. */
export function validatePathParam(raw) {
  const p = String(raw || '').trim();
  if (!p || p === ORG_UNASSIGNED) return { ok: true, path: p };
  if (/[%\\\u0000-\u001f]/.test(p)) return { ok: false, code: 'INVALID_ORG_PATH', message: "org_path에는 '%', '\\' 및 제어문자를 쓸 수 없습니다" };
  if (p.length > 1000) return { ok: false, code: 'INVALID_ORG_PATH', message: 'org_path가 너무 깁니다' };
  return { ok: true, path: p };
}

function childrenMap(nodes) {
  const m = new Map();
  for (const n of nodes) {
    const k = n.parent_id || '';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(n);
  }
  return m;
}

/** rootId와 그 모든 하위 노드 id(부모→자식 순 BFS). parent_id 체인 기준이라 path 드리프트와 무관. */
export function collectSubtree(nodes, rootId) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (!byId.has(rootId)) return [];
  const kids = childrenMap(nodes);
  const out = [];
  const seen = new Set();
  const queue = [byId.get(rootId)];
  while (queue.length) {
    const n = queue.shift();
    if (seen.has(n.id)) continue; // 순환 방어
    seen.add(n.id);
    out.push(n);
    for (const c of (kids.get(n.id) || [])) queue.push(c);
  }
  return out;
}

/**
 * 노드 이름 변경/이동의 "재작성 계획". 네트워크 없이 계산한다.
 *  opts.parent : undefined → 현재 부모 유지, null → 루트로, 객체 → 그 노드 아래로
 *  opts.name   : 생략 시 현재 이름 유지
 * 반환: { ok:true, entries:[{id, oldPath, newPath, newDepth, patch}], newRootPath }
 *       또는 { ok:false, code, message }
 * entries[0]이 루트, 이후 부모→자식 순. patch는 그 노드에 실제로 PATCH할 필드.
 */
export function planSubtreeRewrite(nodes, rootId, opts = {}) {
  const subtree = collectSubtree(nodes, rootId);
  if (!subtree.length) return { ok: false, code: 'UNIT_NOT_FOUND', message: '노드를 찾을 수 없습니다' };
  const root = subtree[0];

  let parentNode = null;
  if (opts.parent === undefined) parentNode = nodes.find(n => n.id === root.parent_id) || null;
  else parentNode = opts.parent; // null 또는 노드 객체

  if (parentNode && subtree.some(n => n.id === parentNode.id)) {
    return { ok: false, code: 'CYCLE', message: '노드를 자기 자신이나 자기 하위로 옮길 수 없습니다' };
  }

  const newName = opts.name !== undefined ? opts.name : root.name;
  const baseDepth = parentNode ? (Number(parentNode.depth) || 1) : 0;
  const newRootPath = buildPath(parentNode ? parentNode.path : '', newName);

  const entries = [];
  const newPathById = new Map();
  const newDepthById = new Map();
  for (const n of subtree) {
    let newPath, newDepth;
    if (n.id === root.id) {
      newPath = newRootPath;
      newDepth = baseDepth + 1;
    } else {
      newPath = buildPath(newPathById.get(n.parent_id), n.name);
      newDepth = newDepthById.get(n.parent_id) + 1;
    }
    if (newDepth > ORG_MAX_DEPTH) {
      return { ok: false, code: 'TOO_DEEP', message: `계층은 최대 ${ORG_MAX_DEPTH}단계까지입니다` };
    }
    newPathById.set(n.id, newPath);
    newDepthById.set(n.id, newDepth);
    const patch = {};
    if (n.path !== newPath) patch.path = newPath;
    if (Number(n.depth) !== newDepth) patch.depth = newDepth;
    if (n.id === root.id) {
      if (opts.name !== undefined && n.name !== newName) patch.name = newName;
      if (opts.parent !== undefined) {
        const newParentId = parentNode ? parentNode.id : '';
        if ((n.parent_id || '') !== newParentId) patch.parent_id = newParentId;
      }
    }
    entries.push({ id: n.id, oldPath: n.path, newPath, newDepth, patch });
  }
  return { ok: true, entries, newRootPath };
}

/**
 * parent_id 체인으로 모든 노드의 "정답" path/depth를 다시 계산(resync용).
 * 반환: { expected: Map(id → {path, depth}), orphans:[id], cycles:[id] }
 * 부모가 없는데 parent_id가 비어 있지 않은 노드(orphan)와 순환 노드는 expected에서 제외한다.
 */
export function computeExpected(nodes) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const expected = new Map();
  const orphans = [];
  const cycles = [];
  function resolve(n, trail) {
    if (expected.has(n.id)) return expected.get(n.id);
    if (trail.has(n.id)) return null; // 순환
    trail.add(n.id);
    let res;
    if (!n.parent_id) {
      res = { path: n.name, depth: 1 };
    } else {
      const p = byId.get(n.parent_id);
      if (!p) return 'ORPHAN';
      const pr = resolve(p, trail);
      if (pr === 'ORPHAN') return 'ORPHAN';
      if (!pr) return null;
      res = { path: buildPath(pr.path, n.name), depth: pr.depth + 1 };
    }
    expected.set(n.id, res);
    return res;
  }
  for (const n of nodes) {
    if (expected.has(n.id)) continue;
    const r = resolve(n, new Set());
    if (r === 'ORPHAN') orphans.push(n.id);
    else if (r === null) cycles.push(n.id);
  }
  return { expected, orphans, cycles };
}

/** 노드별 직접/하위 포함 건수 집계(순수). directById: Map(노드id → 건수). */
export function aggregateCounts(nodes, directById) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const subtree = new Map();
  for (const [id, cnt] of directById.entries()) {
    let cur = byId.get(id);
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      subtree.set(cur.id, (subtree.get(cur.id) || 0) + cnt);
      cur = cur.parent_id ? byId.get(cur.parent_id) : null;
    }
  }
  return subtree;
}

// ── 핸들러 팩토리 ────────────────────────────────────────────
export function makeOrgUnitHandlers(deps) {
  const { kAuth, err, l1AdminToken, L1_DEFAULT } = deps;
  const doFetch = (...a) => (deps.fetch || globalThis.fetch)(...a);
  const esc = s => String(s).replace(/'/g, "\\'");
  const json = (cors, obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

  class OrgError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }

  async function makePb(env) {
    const token = await l1AdminToken(env);
    return async function pb(coll, path, { method = 'GET', body, query } = {}) {
      const qs = query ? '?' + Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
      const res = await doFetch(`${L1_DEFAULT}/api/collections/${coll}/records${path}${qs}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 404 && coll === 'org_units' && path === '' && method === 'GET') {
        // 컬렉션 자체가 없는 경우(마이그레이션 미적용) — 원인을 명확히 드러낸다.
        throw new OrgError(503, 'ORG_UNITS_NOT_READY', 'org_units 컬렉션이 없습니다 — PocketBase 마이그레이션 적용을 확인해 주세요');
      }
      return { ok: res.ok, status: res.status, data };
    };
  }

  const pubNode = n => ({
    id: n.id, name: n.name, parent_id: n.parent_id || '', path: n.path,
    depth: Number(n.depth) || 0, aliases: Array.isArray(n.aliases) ? n.aliases : [], origin: n.origin || '',
  });

  async function loadNodes(pb, guid) {
    const out = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await pb('org_units', '', { query: { filter: `owner_user_guid='${esc(guid)}'`, sort: 'path', perPage: String(PAGE_SIZE), page: String(page) } });
      if (!r.ok) throw new OrgError(502, 'ORG_UNITS_READ_FAILED', `노드 조회 실패(HTTP ${r.status})`);
      out.push(...(r.data?.items || []));
      if (page >= (r.data?.totalPages || 1)) break;
    }
    return out;
  }

  /** 연락처 목록(필요 필드만)을 전부 모은다 — 페이지 이동 중 PATCH로 필터 결과가 흔들리지 않게 먼저 다 읽는다. */
  async function scanContacts(pb, filter, fields) {
    const out = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await pb('kmail_contacts', '', { query: { filter, fields, perPage: String(PAGE_SIZE), page: String(page) } });
      if (!r.ok) throw new OrgError(502, 'CONTACTS_READ_FAILED', `연락처 조회 실패(HTTP ${r.status})`);
      out.push(...(r.data?.items || []));
      if (page >= (r.data?.totalPages || 1)) break;
    }
    return out;
  }

  /** PATCH 목록을 10개씩 병렬로 실행. 실패 건수를 센다. */
  async function patchMany(pb, coll, jobs) {
    let done = 0, failed = 0;
    for (let i = 0; i < jobs.length; i += 10) {
      const chunk = jobs.slice(i, i + 10);
      const rs = await Promise.all(chunk.map(j => pb(coll, `/${j.id}`, { method: 'PATCH', body: j.patch })));
      for (const r of rs) { if (r.ok) done++; else failed++; }
    }
    return { done, failed };
  }

  /** 노드를 만든다. 같은 (owner,path)가 이미 있으면 conflict로 기존 노드를 돌려준다. */
  async function createNode(pb, guid, { parent, name, aliases = [], origin = 'user' }) {
    const path = buildPath(parent ? parent.path : '', name);
    const depth = (parent ? (Number(parent.depth) || 1) : 0) + 1;
    if (depth > ORG_MAX_DEPTH) throw new OrgError(400, 'TOO_DEEP', `계층은 최대 ${ORG_MAX_DEPTH}단계까지입니다`);
    const r = await pb('org_units', '', { method: 'POST', body: { owner_user_guid: guid, name, parent_id: parent ? parent.id : '', path, depth, aliases, origin } });
    if (r.ok) return { ok: true, node: r.data };
    // 고유 인덱스 충돌이면 이미 있는 노드다(동시 요청/이중 클릭 포함).
    const ex = await pb('org_units', '', { query: { filter: `owner_user_guid='${esc(guid)}' && path='${esc(path)}'`, perPage: '1' } });
    if (ex.ok && ex.data?.items?.[0]) return { ok: false, conflict: true, existing: ex.data.items[0] };
    throw new OrgError(502, 'CREATE_FAILED', `노드 생성 실패(HTTP ${r.status})`);
  }

  /** 재작성 계획을 실제로 적용: 노드 PATCH → 연락처 org_path PATCH(예산 내). */
  async function applyPlan(pb, guid, plan) {
    const nodeJobs = plan.entries.filter(e => Object.keys(e.patch).length).map(e => ({ id: e.id, patch: e.patch }));
    if (nodeJobs.length > NODE_WRITE_BUDGET) {
      throw new OrgError(400, 'TOO_MANY_NODES', `한 번에 바꿀 수 있는 하위 노드는 ${NODE_WRITE_BUDGET}개까지입니다`);
    }
    const nr = await patchMany(pb, 'org_units', nodeJobs);
    if (nr.failed) {
      throw new OrgError(502, 'PARTIAL_APPLY', `노드 ${nr.failed}건 수정 실패 — /kmail/org-units/resync로 정합성을 복구해 주세요`);
    }
    // 연락처: 옛 루트 경로 기준으로 소속 연락처를 찾아 새 경로로 바꾼다.
    const root = plan.entries[0];
    const newPathById = new Map(plan.entries.map(e => [e.id, e.newPath]));
    const contacts = await scanContacts(pb, `owner_user_guid='${esc(guid)}' && ${orgPathFilterClause(root.oldPath, esc)}`, 'id,org_unit,org_path');
    const jobs = contacts
      .filter(c => newPathById.has(c.org_unit) && c.org_path !== newPathById.get(c.org_unit))
      .map(c => ({ id: c.id, patch: { org_path: newPathById.get(c.org_unit) } }));
    const batch = jobs.slice(0, CONTACT_WRITE_BUDGET);
    const cr = await patchMany(pb, 'kmail_contacts', batch);
    return { nodes_updated: nodeJobs.length, contacts_updated: cr.done, contacts_pending: (jobs.length - batch.length) + cr.failed };
  }

  // 공통 실행 래퍼: 인증 → 본문 → try/catch(OrgError는 그대로, 그 외는 502)
  async function run(cors, fn) {
    try { return await fn(); }
    catch (e) {
      if (e instanceof OrgError) return err(e.status, e.code, e.message, cors);
      console.warn('[OrgUnits] 처리 실패:', e?.message);
      return err(502, 'ORG_UNITS_FAILED', e?.message || '처리 실패', cors);
    }
  }
  async function readBody(request, cors) {
    const body = await request.json().catch(() => null);
    if (!body) return { error: err(400, 'INVALID_JSON', 'JSON 파싱 실패', cors) };
    return { body };
  }

  // ── GET /kmail/org-units?status=confirmed|pending_review|rejected|all ──
  async function list(request, url, env, cors) {
    const qp = Object.fromEntries(url.searchParams.entries());
    const status = qp.status || 'confirmed';
    if (!['pending_review', 'confirmed', 'rejected', 'all'].includes(status)) {
      return err(400, 'INVALID_STATUS', 'status는 pending_review/confirmed/rejected/all 중 하나여야 합니다', cors);
    }
    const auth = await kAuth.resolveGuid(env, qp, { sigMsg: `kmail-org-units-list:${qp.guid}:${qp.ts}` });
    if (!auth.ok) return err(auth.status, auth.code, auth.message, cors);
    const guid = auth.guid;
    return run(cors, async () => {
      const pb = await makePb(env);
      const nodes = await loadNodes(pb, guid);
      const filter = `owner_user_guid='${esc(guid)}'` + (status !== 'all' ? ` && status='${esc(status)}'` : '');
      const contacts = await scanContacts(pb, filter, 'org_unit');
      const byId = new Map(nodes.map(n => [n.id, n]));
      const direct = new Map();
      let unassigned = 0, dangling = 0;
      for (const c of contacts) {
        if (!c.org_unit) { unassigned++; continue; }
        if (!byId.has(c.org_unit)) { dangling++; continue; }
        direct.set(c.org_unit, (direct.get(c.org_unit) || 0) + 1);
      }
      const sub = aggregateCounts(nodes, direct);
      const out = nodes.map(n => ({ ...pubNode(n), direct: direct.get(n.id) || 0, subtree: sub.get(n.id) || 0 }));
      return json(cors, { ok: true, nodes: out, unassigned, dangling, total: contacts.length });
    });
  }

  // ── POST /kmail/org-units/seed ──
  async function seed(request, env, cors) {
    const rb = await readBody(request, cors); if (rb.error) return rb.error;
    const body = rb.body;
    const auth = await kAuth.resolveGuid(env, body, { sigMsg: `kmail-org-units-seed:${body.guid}:${body.ts}` });
    if (!auth.ok) return err(auth.status, auth.code, auth.message, cors);
    const guid = auth.guid;
    return run(cors, async () => {
      const pb = await makePb(env);
      const nodes = await loadNodes(pb, guid);
      const byPath = new Map(nodes.map(n => [n.path, n]));
      let created = 0, existing = 0;
      for (const root of SEED_TEMPLATE) {
        let rootNode = byPath.get(root.name);
        if (rootNode) existing++;
        else {
          const r = await createNode(pb, guid, { parent: null, name: root.name, origin: 'seed' });
          rootNode = r.ok ? r.node : r.existing;
          if (r.ok) created++; else existing++;
          byPath.set(rootNode.path, rootNode);
        }
        for (const childName of root.children) {
          const childPath = buildPath(rootNode.path, childName);
          if (byPath.has(childPath)) { existing++; continue; }
          const r = await createNode(pb, guid, { parent: rootNode, name: childName, origin: 'seed' });
          if (r.ok) { created++; byPath.set(childPath, r.node); } else { existing++; byPath.set(childPath, r.existing); }
        }
      }
      return json(cors, { ok: true, created, existing });
    });
  }

  // ── POST /kmail/org-units/create — { parent_id?, name, aliases? } ──
  async function create(request, env, cors) {
    const rb = await readBody(request, cors); if (rb.error) return rb.error;
    const body = rb.body;
    const auth = await kAuth.resolveGuid(env, body, { sigMsg: `kmail-org-units-create:${body.guid}:${body.ts}` });
    if (!auth.ok) return err(auth.status, auth.code, auth.message, cors);
    const guid = auth.guid;
    const nv = validateOrgName(body.name);
    if (!nv.ok) return err(400, nv.code, nv.message, cors);
    let aliases = [];
    if (body.aliases !== undefined) {
      const av = normalizeAliases(body.aliases);
      if (!av.ok) return err(400, av.code, av.message, cors);
      aliases = av.aliases;
    }
    const parentId = body.parent_id ? String(body.parent_id) : '';
    if (parentId && !ID_RE.test(parentId)) return err(400, 'INVALID_PARENT', 'parent_id 형식이 올바르지 않습니다', cors);
    return run(cors, async () => {
      const pb = await makePb(env);
      let parent = null;
      if (parentId) {
        const nodes = await loadNodes(pb, guid);
        parent = nodes.find(n => n.id === parentId) || null;
        if (!parent) throw new OrgError(404, 'PARENT_NOT_FOUND', '상위 노드를 찾을 수 없습니다');
      }
      const r = await createNode(pb, guid, { parent, name: nv.name, aliases, origin: 'user' });
      if (!r.ok) return json(cors, { ok: false, error: 'UNIT_EXISTS', message: '같은 위치에 같은 이름의 노드가 이미 있습니다', existing: pubNode(r.existing) }, 409);
      return json(cors, { ok: true, node: pubNode(r.node) });
    });
  }

  // ── POST /kmail/org-units/update — { unit_id, name?, aliases? } ──
  async function update(request, env, cors) {
    const rb = await readBody(request, cors); if (rb.error) return rb.error;
    const body = rb.body;
    const unitId = String(body.unit_id || '');
    if (!ID_RE.test(unitId)) return err(400, 'MISSING_FIELD', 'unit_id 필수', cors);
    if (body.name === undefined && body.aliases === undefined) return err(400, 'NOTHING_TO_UPDATE', 'name 또는 aliases 중 하나는 필요합니다', cors);
    const auth = await kAuth.resolveGuid(env, body, { sigMsg: `kmail-org-units-update:${body.guid}:${unitId}:${body.ts}` });
    if (!auth.ok) return err(auth.status, auth.code, auth.message, cors);
    const guid = auth.guid;
    let newName;
    if (body.name !== undefined) {
      const nv = validateOrgName(body.name);
      if (!nv.ok) return err(400, nv.code, nv.message, cors);
      newName = nv.name;
    }
    let aliases;
    if (body.aliases !== undefined) {
      const av = normalizeAliases(body.aliases);
      if (!av.ok) return err(400, av.code, av.message, cors);
      aliases = av.aliases;
    }
    return run(cors, async () => {
      const pb = await makePb(env);
      const nodes = await loadNodes(pb, guid);
      const node = nodes.find(n => n.id === unitId);
      if (!node) throw new OrgError(404, 'UNIT_NOT_FOUND', '노드를 찾을 수 없습니다');
      let applied = { nodes_updated: 0, contacts_updated: 0, contacts_pending: 0 };
      if (newName !== undefined && newName !== node.name) {
        const plan = planSubtreeRewrite(nodes, unitId, { name: newName });
        if (!plan.ok) throw new OrgError(400, plan.code, plan.message);
        if (nodes.some(n => n.id !== unitId && n.path === plan.newRootPath)) {
          return json(cors, { ok: false, error: 'UNIT_EXISTS', message: '같은 위치에 같은 이름의 노드가 이미 있습니다' }, 409);
        }
        applied = await applyPlan(pb, guid, plan);
      }
      if (aliases !== undefined) {
        const r = await pb('org_units', `/${unitId}`, { method: 'PATCH', body: { aliases } });
        if (!r.ok) throw new OrgError(502, 'UPDATE_FAILED', `별칭 저장 실패(HTTP ${r.status})`);
      }
      return json(cors, { ok: true, unit_id: unitId, ...applied });
    });
  }

  // ── POST /kmail/org-units/move — { unit_id, new_parent_id ('' = 루트) } ──
  async function move(request, env, cors) {
    const rb = await readBody(request, cors); if (rb.error) return rb.error;
    const body = rb.body;
    const unitId = String(body.unit_id || '');
    if (!ID_RE.test(unitId)) return err(400, 'MISSING_FIELD', 'unit_id 필수', cors);
    const newParentId = body.new_parent_id ? String(body.new_parent_id) : '';
    if (newParentId && !ID_RE.test(newParentId)) return err(400, 'INVALID_PARENT', 'new_parent_id 형식이 올바르지 않습니다', cors);
    const auth = await kAuth.resolveGuid(env, body, { sigMsg: `kmail-org-units-move:${body.guid}:${unitId}:${body.ts}` });
    if (!auth.ok) return err(auth.status, auth.code, auth.message, cors);
    const guid = auth.guid;
    return run(cors, async () => {
      const pb = await makePb(env);
      const nodes = await loadNodes(pb, guid);
      const node = nodes.find(n => n.id === unitId);
      if (!node) throw new OrgError(404, 'UNIT_NOT_FOUND', '노드를 찾을 수 없습니다');
      if ((node.parent_id || '') === newParentId) throw new OrgError(400, 'NOTHING_TO_UPDATE', '이미 그 위치에 있습니다');
      let newParent = null;
      if (newParentId) {
        newParent = nodes.find(n => n.id === newParentId) || null;
        if (!newParent) throw new OrgError(404, 'PARENT_NOT_FOUND', '새 상위 노드를 찾을 수 없습니다');
      }
      const plan = planSubtreeRewrite(nodes, unitId, { parent: newParent });
      if (!plan.ok) throw new OrgError(plan.code === 'UNIT_NOT_FOUND' ? 404 : 400, plan.code, plan.message);
      if (nodes.some(n => n.id !== unitId && n.path === plan.newRootPath)) {
        return json(cors, { ok: false, error: 'UNIT_EXISTS', message: '새 위치에 같은 이름의 노드가 이미 있습니다 — 이름을 바꾸거나 그 노드로 연락처를 옮긴 뒤 삭제해 주세요' }, 409);
      }
      const applied = await applyPlan(pb, guid, plan);
      return json(cors, { ok: true, unit_id: unitId, new_path: plan.newRootPath, ...applied });
    });
  }

  // ── POST /kmail/org-units/delete — { unit_id } ──
  // 하위 노드가 있으면 거부. 소속 연락처는 부모 노드로(루트면 미분류로) 옮긴 뒤 노드를 지운다.
  // 연락처가 예산보다 많으면 deleted=false와 remaining을 돌려주니, remaining=0이 될 때까지 다시 호출한다.
  async function remove(request, env, cors) {
    const rb = await readBody(request, cors); if (rb.error) return rb.error;
    const body = rb.body;
    const unitId = String(body.unit_id || '');
    if (!ID_RE.test(unitId)) return err(400, 'MISSING_FIELD', 'unit_id 필수', cors);
    const auth = await kAuth.resolveGuid(env, body, { sigMsg: `kmail-org-units-delete:${body.guid}:${unitId}:${body.ts}` });
    if (!auth.ok) return err(auth.status, auth.code, auth.message, cors);
    const guid = auth.guid;
    return run(cors, async () => {
      const pb = await makePb(env);
      const nodes = await loadNodes(pb, guid);
      const node = nodes.find(n => n.id === unitId);
      if (!node) throw new OrgError(404, 'UNIT_NOT_FOUND', '노드를 찾을 수 없습니다');
      const childCount = nodes.filter(n => n.parent_id === unitId).length;
      if (childCount) {
        return json(cors, { ok: false, error: 'HAS_CHILDREN', message: `하위 노드가 ${childCount}개 있어 삭제할 수 없습니다 — 먼저 옮기거나 삭제해 주세요`, children: childCount }, 409);
      }
      const parent = node.parent_id ? nodes.find(n => n.id === node.parent_id) : null;
      const contacts = await scanContacts(pb, `owner_user_guid='${esc(guid)}' && org_unit='${esc(unitId)}'`, 'id');
      const batch = contacts.slice(0, CONTACT_WRITE_BUDGET);
      const target = { org_unit: parent ? parent.id : '', org_path: parent ? parent.path : '' };
      const cr = await patchMany(pb, 'kmail_contacts', batch.map(c => ({ id: c.id, patch: target })));
      const remaining = (contacts.length - batch.length) + cr.failed;
      if (remaining > 0) return json(cors, { ok: true, deleted: false, moved: cr.done, remaining });
      const dr = await pb('org_units', `/${unitId}`, { method: 'DELETE' });
      if (!dr.ok && dr.status !== 404) throw new OrgError(502, 'DELETE_FAILED', `노드 삭제 실패(HTTP ${dr.status})`);
      return json(cors, { ok: true, deleted: true, moved: cr.done, remaining: 0 });
    });
  }

  // ── POST /kmail/contacts/assign-org — { unit_id ('' = 미분류로), contact_ids?[], emails?[] } ──
  async function assign(request, env, cors) {
    const rb = await readBody(request, cors); if (rb.error) return rb.error;
    const body = rb.body;
    const unitId = body.unit_id ? String(body.unit_id) : '';
    if (unitId && !ID_RE.test(unitId)) return err(400, 'INVALID_UNIT', 'unit_id 형식이 올바르지 않습니다', cors);
    const ids = Array.isArray(body.contact_ids) ? body.contact_ids.map(String) : [];
    const emails = Array.isArray(body.emails) ? body.emails.map(e => String(e).trim().toLowerCase()) : [];
    if (!ids.length && !emails.length) return err(400, 'MISSING_FIELD', 'contact_ids 또는 emails 중 하나는 필요합니다', cors);
    if (ids.length + emails.length > ASSIGN_MAX) return err(400, 'TOO_MANY', `한 번에 최대 ${ASSIGN_MAX}건까지 배정할 수 있습니다`, cors);
    if (ids.some(i => !ID_RE.test(i))) return err(400, 'INVALID_CONTACT_ID', 'contact_ids 형식이 올바르지 않습니다', cors);
    if (emails.some(e => !e || /[\\\u0000-\u001f]/.test(e) || e.length > 320)) return err(400, 'INVALID_EMAIL', 'emails 형식이 올바르지 않습니다', cors);
    const auth = await kAuth.resolveGuid(env, body, { sigMsg: `kmail-contacts-assign-org:${body.guid}:${body.ts}` });
    if (!auth.ok) return err(auth.status, auth.code, auth.message, cors);
    const guid = auth.guid;
    return run(cors, async () => {
      const pb = await makePb(env);
      let target = { org_unit: '', org_path: '' };
      if (unitId) {
        const r = await pb('org_units', `/${unitId}`);
        if (!r.ok || !r.data || r.data.owner_user_guid !== guid) throw new OrgError(404, 'UNIT_NOT_FOUND', '노드를 찾을 수 없습니다');
        target = { org_unit: unitId, org_path: r.data.path };
      }
      const found = new Map(); // contact id → record(id,email)
      const owner = `owner_user_guid='${esc(guid)}'`;
      for (let i = 0; i < ids.length; i += 25) {
        const terms = ids.slice(i, i + 25).map(x => `id='${esc(x)}'`).join(' || ');
        const r = await pb('kmail_contacts', '', { query: { filter: `${owner} && (${terms})`, fields: 'id,email', perPage: '50' } });
        if (!r.ok) throw new OrgError(502, 'CONTACTS_READ_FAILED', `연락처 조회 실패(HTTP ${r.status})`);
        for (const c of (r.data?.items || [])) found.set(c.id, c);
      }
      for (let i = 0; i < emails.length; i += 25) {
        const terms = emails.slice(i, i + 25).map(x => `email='${esc(x)}'`).join(' || ');
        const r = await pb('kmail_contacts', '', { query: { filter: `${owner} && (${terms})`, fields: 'id,email', perPage: '50' } });
        if (!r.ok) throw new OrgError(502, 'CONTACTS_READ_FAILED', `연락처 조회 실패(HTTP ${r.status})`);
        for (const c of (r.data?.items || [])) found.set(c.id, c);
      }
      const cr = await patchMany(pb, 'kmail_contacts', Array.from(found.keys()).map(id => ({ id, patch: target })));
      const foundIds = new Set(Array.from(found.values()).map(c => c.id));
      const foundEmails = new Set(Array.from(found.values()).map(c => String(c.email || '').toLowerCase()));
      const skipped = [...ids.filter(i => !foundIds.has(i)), ...emails.filter(e => !foundEmails.has(e))];
      return json(cors, { ok: true, assigned: cr.done, failed: cr.failed, skipped, unit: unitId ? { id: unitId, path: target.org_path } : null });
    });
  }

  // ── POST /kmail/org-units/resync — { fix_dangling? } ──
  // parent_id 체인·org_unit을 진실로 삼아 노드 path/depth와 연락처 org_path를 다시 맞춘다.
  // 예산을 넘으면 pending>0을 돌려주니 pending=0이 될 때까지 반복 호출한다.
  async function resync(request, env, cors) {
    const rb = await readBody(request, cors); if (rb.error) return rb.error;
    const body = rb.body;
    const auth = await kAuth.resolveGuid(env, body, { sigMsg: `kmail-org-units-resync:${body.guid}:${body.ts}` });
    if (!auth.ok) return err(auth.status, auth.code, auth.message, cors);
    const guid = auth.guid;
    const fixDangling = body.fix_dangling === true;
    return run(cors, async () => {
      const pb = await makePb(env);
      const nodes = await loadNodes(pb, guid);
      const { expected, orphans, cycles } = computeExpected(nodes);

      // 1) 노드 path/depth
      const nodeJobs = [];
      for (const n of nodes) {
        const e = expected.get(n.id);
        if (!e) continue;
        const patch = {};
        if (n.path !== e.path) patch.path = e.path;
        if (Number(n.depth) !== e.depth) patch.depth = e.depth;
        if (Object.keys(patch).length) nodeJobs.push({ id: n.id, patch });
      }
      const nodeBatch = nodeJobs.slice(0, NODE_WRITE_BUDGET);
      const nr = await patchMany(pb, 'org_units', nodeBatch);
      const nodePending = (nodeJobs.length - nodeBatch.length) + nr.failed;

      // 2) 연락처 org_path — 노드가 아직 어긋나 있으면(노드 pending) 연락처는 다음 호출로 미룬다.
      let contactsFixed = 0, contactsPending = 0, dangling = 0;
      if (nodePending === 0) {
        const contacts = await scanContacts(pb, `owner_user_guid='${esc(guid)}' && (org_unit!='' || org_path!='')`, 'id,org_unit,org_path');
        const jobs = [];
        for (const c of contacts) {
          if (!c.org_unit) { if (c.org_path) jobs.push({ id: c.id, patch: { org_path: '' } }); continue; }
          const e = expected.get(c.org_unit);
          if (!e) {
            dangling++;
            if (fixDangling) jobs.push({ id: c.id, patch: { org_unit: '', org_path: '' } });
            continue;
          }
          if (c.org_path !== e.path) jobs.push({ id: c.id, patch: { org_path: e.path } });
        }
        const room = Math.max(0, CONTACT_WRITE_BUDGET - nodeBatch.length);
        const batch = jobs.slice(0, room);
        const cr = await patchMany(pb, 'kmail_contacts', batch);
        contactsFixed = cr.done;
        contactsPending = (jobs.length - batch.length) + cr.failed;
      }
      return json(cors, {
        ok: true,
        nodes_fixed: nr.done, contacts_fixed: contactsFixed,
        pending: nodePending + contactsPending,
        dangling, orphans, cycles,
      });
    });
  }

  return { list, seed, create, update, move, remove, assign, resync };
}
