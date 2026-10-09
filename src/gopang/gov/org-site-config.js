// 혼디 AI 웹사이트 — 라이브 설정 (2026-10-09 신설)
//
// 기관 AI 사이트의 인사말·지침·지식 데이터·켜진 블록을 코드가 아니라 설정(JSON)으로 둔다.
// 서버(Worker)가 저장 전에, 클라이언트가 사용 전에 같은 sanitizeConfig를 거친다.
// 설정은 "버전"으로 쌓이고(롤백 = 옛 버전을 새 버전으로 다시 저장), 수정은 관리자 지갑 서명으로만 한다.
//
// AI가 화면 블록을 부르는 방법: 답변 끝에 [[BLOCK:종류 key=값 …]] 태그. parseBlockTags가 태그를 걷어내고
// 켜진 블록만 돌려준다 — 설정에서 꺼진 블록이나 모르는 종류는 조용히 버려진다.

export const BLOCK_IDS = ['programs', 'apply-draft', 'facility-booking', 'inquiry'];
export const SITE_ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

const LIM = { name: 40, greeting: 200, instructions: 4000, knowledge: 20000, demoNotice: 120, short: 200, long: 600, list: 30 };

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const idOf = (v, i, p) => str(v, 40).replace(/[^A-Za-z0-9_-]/g, '') || `${p}${i + 1}`;

/** 키 정렬 JSON — 서명 대상 해시가 필드 순서에 흔들리지 않게 한다. */
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function cleanUrl(u) {
  const s = str(u, 300);
  return /^https?:\/\//i.test(s) ? s : '';
}

/**
 * 입력을 허용 필드만 남긴 안전한 설정으로 정리한다. 모르는 필드는 버린다.
 * @returns {{ok:true, config:object}|{ok:false, errors:string[]}}
 */
export function sanitizeConfig(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['설정은 객체여야 합니다.'] };
  const c = {
    name: str(raw.name, LIM.name),
    greeting: str(raw.greeting, LIM.greeting),
    instructions: str(raw.instructions, LIM.instructions),
    knowledge: str(raw.knowledge, LIM.knowledge),
    demoNotice: str(raw.demoNotice, LIM.demoNotice),
    blocks: [],
    programs: [],
    facilities: [],
    contacts: [],
  };
  if (!c.name) errors.push('name(기관 이름)이 필요합니다.');
  if (!c.greeting) errors.push('greeting(인사말)이 필요합니다.');

  const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  for (const b of blocks) {
    if (!BLOCK_IDS.includes(b)) { errors.push(`알 수 없는 블록: ${String(b).slice(0, 30)}`); continue; }
    if (!c.blocks.includes(b)) c.blocks.push(b);
  }

  (Array.isArray(raw.programs) ? raw.programs : []).slice(0, LIM.list).forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const title = str(p.title, LIM.short);
    if (!title) { errors.push(`programs[${i}].title 필요`); return; }
    c.programs.push({
      id: idOf(p.id, i, 'p'), title, period: str(p.period, 80), target: str(p.target, LIM.short),
      support: str(p.support, LIM.short), summary: str(p.summary, LIM.long), url: cleanUrl(p.url), demo: p.demo !== false,
    });
  });
  (Array.isArray(raw.facilities) ? raw.facilities : []).slice(0, LIM.list).forEach((f, i) => {
    if (!f || typeof f !== 'object') return;
    const name = str(f.name, LIM.short);
    if (!name) { errors.push(`facilities[${i}].name 필요`); return; }
    c.facilities.push({ id: idOf(f.id, i, 'f'), name, desc: str(f.desc, LIM.long), location: str(f.location, LIM.short), unit: str(f.unit, 40), demo: f.demo !== false });
  });
  (Array.isArray(raw.contacts) ? raw.contacts : []).slice(0, 10).forEach((t, i) => {
    if (!t || typeof t !== 'object') return;
    const dept = str(t.dept, 80);
    if (!dept) { errors.push(`contacts[${i}].dept 필요`); return; }
    c.contacts.push({ id: idOf(t.id, i, 'c'), dept, role: str(t.role, LIM.short), phone: str(t.phone, 40) });
  });

  return errors.length ? { ok: false, errors } : { ok: true, config: c };
}

/** 코드에 박힌 기본 설정(ORG_SITES) 위에 서버에서 받은 설정을 덮는다. live가 없으면 기본값 그대로. */
export function mergeConfig(base, live) {
  const b = base || {};
  if (!live) return { name: b.name || '', greeting: b.greeting || '', instructions: '', knowledge: '', demoNotice: '', blocks: [], programs: [], facilities: [], contacts: [] };
  return live;
}

/** 시스템 프롬프트 뒤에 붙일 기관별 지침 — 지식·블록 사용 규칙·시연 표시. */
export function buildPromptAddon(config) {
  if (!config) return '';
  const L = [];
  L.push('\n\n[기관 AI 웹사이트 설정 — 관리자가 라이브로 정한 내용]');
  if (config.instructions) L.push('■ 응대 지침\n' + config.instructions);
  if (config.knowledge) L.push('■ 기관 지식(이 안의 내용만 근거로 안내하고, 없는 내용은 모른다고 답하며 담당자 연결을 제안한다)\n' + config.knowledge);
  if (config.programs.length) {
    L.push('■ 지원사업 목록\n' + config.programs.map(p =>
      `- (${p.id}) ${p.title} | 접수 ${p.period || '미정'} | 대상 ${p.target || '-'} | 지원 ${p.support || '-'} | ${p.summary || ''}${p.demo ? ' [가상 예시]' : ''}`).join('\n'));
  }
  if (config.facilities.length) {
    L.push('■ 장비·시설 목록\n' + config.facilities.map(f =>
      `- (${f.id}) ${f.name} | ${f.location || '-'} | ${f.desc || ''}${f.demo ? ' [가상 예시]' : ''}`).join('\n'));
  }
  if (config.contacts.length) L.push('■ 담당 부서\n' + config.contacts.map(t => `- (${t.id}) ${t.dept} ${t.role}`).join('\n'));
  if (config.blocks.length) {
    const how = {
      'programs': '[[BLOCK:programs ids=p1,p2]] — 방문자 조건에 맞는 지원사업 카드(최대 3개). ids는 위 목록의 id.',
      'apply-draft': '[[BLOCK:apply-draft program=p1 company="회사명" summary="사업 개요 한두 문장"]] — 신청서 초안 화면. 모르는 값은 비워 둔다.',
      'facility-booking': '[[BLOCK:facility-booking facility=f1 purpose="사용 목적"]] — 장비·시설 예약 요청 화면.',
      'inquiry': '[[BLOCK:inquiry dept=c1 subject="문의 제목" body="문의 내용 요약"]] — 담당자에게 전달할 문의 화면.',
    };
    L.push('■ 화면 블록(켜진 것만 사용). 텍스트 답변 끝에 아래 태그를 붙이면 화면에 해당 UI가 열린다. 태그 값에 큰따옴표를 넣지 말 것.\n' + config.blocks.map(b => how[b]).join('\n'));
    L.push('블록의 제출·접수는 사람이 승인해야 이뤄진다. 승인 전에는 "접수했다"고 말하지 않는다. 심사 결과나 선정 가능성은 단정하지 않는다.');
  }
  if (config.demoNotice) L.push('■ 시연 표시: ' + config.demoNotice + ' — 가상 예시 항목을 안내할 때는 가상임을 밝힌다.');
  return L.join('\n');
}

const TAG_RE = /\[\[BLOCK:([a-z-]+)((?:\s+[a-z]+=(?:"[^"\]]*"|[^\s\]"]*))*)\s*\]\]/g;
const ARG_RE = /([a-z]+)=(?:"([^"\]]*)"|([^\s\]"]*))/g;

/** 답변에서 블록 태그를 걷어내고, 켜진 블록만 [{type,args}]로 돌려준다. */
export function parseBlockTags(reply, enabled = []) {
  const blocks = [];
  const text = String(reply || '').replace(TAG_RE, (_m, type, argstr) => {
    if (enabled.includes(type) && BLOCK_IDS.includes(type)) {
      const args = {};
      let m; ARG_RE.lastIndex = 0;
      while ((m = ARG_RE.exec(argstr || ''))) args[m[1]] = (m[2] !== undefined ? m[2] : m[3]).slice(0, 600);
      blocks.push({ type, args });
    }
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { text, blocks };
}
