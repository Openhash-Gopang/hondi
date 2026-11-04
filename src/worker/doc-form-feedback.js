// ═════════════════════════════════════════════════
// 서식 피드백 API (2026-11-04 신설) — 정적 서식(navi-pro 의 data/forms)을 쓰는 이용자들의 수정 흔적을 모아 서식 갱신 후보를 만든다.
//
//   POST /doc-form/feedback                    { persona?, form_id, v, adds:[라벨…], cid }   익명. 이용자가 서식에 없는 항목을 추가했다는 신호.
//   GET  /doc-form/feedback/candidates?min=&persona=    Authorization: Bearer env.DOC_FORM_FEEDBACK_TOKEN
//                                                        같은 서식 버전·같은 항목을 서로 다른 이용자 min(기본 5)명 이상이 추가한 후보 목록.
//
// 원칙
//   · 라벨만 받는다(값은 받지 않는다). 숫자 6자리 이상·이메일·URL처럼 개인정보로 보이는 라벨은 버린다.
//   · cid 는 기기별 무작위 값 — 서버는 해시만 저장한다. 하루 DAILY_LIMIT 건을 넘으면 429.
//   · 한 이용자가 같은 서식 버전의 같은 항목을 여러 번 보내도 1표(유일 인덱스).
//   · 후보를 서식에 반영하는 일은 사람이 검토해 서식 파일(PR)로 한다(navi-pro scripts/apply-form-feedback.mjs).
// ═════════════════════════════════════════════════
const json = (body, status, cors = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
const err = (status, code, message, cors) => json({ ok: false, code, message }, status, cors);

export const MIN_USERS_DEFAULT = 5;
export const DAILY_LIMIT = 30;
export const MAX_ADDS = 5;
export const WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 같은 뜻의 라벨을 같은 값으로 모은다(공백·구두점·대소문자·전각 차이 무시). */
export function normLabel(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s·.,:;!?()[\]{}<>\-_/\\'"“”‘’~]/g, '');
}

/** 저장해도 되는 라벨로 다듬는다. 개인정보로 보이거나 너무 짧고 긴 것은 null. */
export function cleanLabel(s) {
  const t = String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 40) return null;
  if (/\d{6,}/.test(t.replace(/[-\s]/g, '')) || /@|https?:|www\./i.test(t)) return null;
  if (normLabel(t).length < 2) return null;
  return t;
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** 기록들에서 min 명 이상의 서로 다른 이용자가 낸 (서식·버전·항목) 후보를 모은다. */
export function aggregateCandidates(rows, { min = MIN_USERS_DEFAULT, persona = '' } = {}) {
  const map = new Map();
  for (const r of rows) {
    if (persona && r.persona !== persona) continue;
    const key = `${r.form_id}\n${r.version}\n${r.kind}\n${r.label_norm}`;
    let g = map.get(key);
    if (!g) { g = { form_id: r.form_id, version: r.version, kind: r.kind, label_norm: r.label_norm, persona: r.persona || '', users: new Set(), labels: new Map() }; map.set(key, g); }
    g.users.add(r.cid_hash);
    g.labels.set(r.label, (g.labels.get(r.label) || 0) + 1);
  }
  return [...map.values()].filter(g => g.users.size >= min)
    .map(g => ({ form_id: g.form_id, version: g.version, kind: g.kind, persona: g.persona, label: [...g.labels.entries()].sort((a, b) => b[1] - a[1])[0][0], users: g.users.size }))
    .sort((a, b) => b.users - a.users || a.form_id.localeCompare(b.form_id));
}

export function makeDocFormFeedbackHandler({ store, now = () => Date.now() }) {
  if (!store?.add || !store?.since || !store?.countSince) throw new Error('makeDocFormFeedbackHandler: store 필요');

  /** 이 경로가 아니면 null 을 돌려 다음 핸들러로 넘긴다. */
  async function handle(request, url, env, cors = {}) {
    const path = url.pathname;
    try {
      if (request.method === 'POST' && path === '/doc-form/feedback') {
        const b = await request.json().catch(() => null) || {};
        const formId = typeof b.form_id === 'string' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(b.form_id) ? b.form_id : null;
        const v = Number.isInteger(b.v) && b.v >= 1 && b.v <= 999 ? b.v : null;
        const cid = typeof b.cid === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(b.cid) ? b.cid : null;
        const persona = typeof b.persona === 'string' && /^[a-z0-9-]{0,60}$/.test(b.persona) ? b.persona : '';
        if (!formId || !v || !cid || !Array.isArray(b.adds)) return err(400, 'BAD_REQUEST', 'form_id, v, cid, adds 가 필요합니다.', cors);
        const seen = new Set(), labels = [];
        for (const raw of b.adds.slice(0, MAX_ADDS)) {
          const label = cleanLabel(raw), n = label && normLabel(label);
          if (label && !seen.has(n)) { seen.add(n); labels.push({ label, n }); }
        }
        if (!labels.length) return json({ ok: true, accepted: 0 }, 200, cors);
        const ts = now(), cidHash = await sha256Hex('hondi-doc-form-feedback\n' + cid);
        if ((await store.countSince(cidHash, ts - DAY_MS)) >= DAILY_LIMIT) return err(429, 'RATE_LIMIT', '오늘 보낼 수 있는 횟수를 넘었습니다.', cors);
        let accepted = 0;
        for (const { label, n } of labels) {
          if (await store.add({ form_id: formId, version: v, kind: 'add', label_norm: n.slice(0, 80), label: label.slice(0, 80), cid_hash: cidHash, persona, ts })) accepted++;
        }
        return json({ ok: true, accepted }, 200, cors);
      }

      if (request.method === 'GET' && path === '/doc-form/feedback/candidates') {
        const token = env?.DOC_FORM_FEEDBACK_TOKEN;
        const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        if (!token || !given || !safeEqual(given, token)) return err(401, 'UNAUTHORIZED', '권한이 없습니다.', cors);
        const min = Math.max(2, Math.min(1000, parseInt(url.searchParams.get('min') || String(MIN_USERS_DEFAULT), 10) || MIN_USERS_DEFAULT));
        const persona = (url.searchParams.get('persona') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 60);
        const rows = await store.since(now() - WINDOW_MS);
        return json({ ok: true, min, candidates: aggregateCandidates(rows, { min, persona }) }, 200, cors);
      }
      return null;
    } catch (e) {
      return err(500, 'INTERNAL', '처리하지 못했습니다.', cors);
    }
  }
  return { handle };
}
