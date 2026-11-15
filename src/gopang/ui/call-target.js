/**
 * ui/call-target.js — "호출해 줘 / 불러줘 / 연결해" 같은 요청에서 "누구를, 어디서 찾을지"를 AI 없이 정한다(2026-11-16, 주피터 지시).
 * 나만의 AI 비서(나비)는 상대(사람·기관 AI·전문가 페르소나·K-서비스)를 새 탭 대화창으로 초대한다.
 * 찾는 곳과 순서(결정적):
 *   1) 전문가 페르소나(직역명: 법무사·변호사·세무사 …)   — EXPERT_REGISTRY 의 표시명
 *   2) K-서비스(K-Mail·K-Law …)                         — GWP_REGISTRY 의 이름·id
 *   3) 사람(이름·전화번호·@아이디)                        — /friends/find  (찾기를 허용한 사용자만)
 *   4) 기관(시청·법원·병원 …)                            — 기관 엔티티 검색(/search)
 * 어디에서도 못 찾으면 null → 기존 AI 라우팅으로 넘긴다. 순수 함수 + 의존성 주입이라 시험하기 쉽다.
 */
export const CALL_VERBS = '호출|불러|부르|연결|초대|대화\\s*(?:하|좀|시작)|채팅|전화|통화|말\\s*걸|바꿔|만나|접속|콜';
const _CALL_RE = new RegExp('^(.{1,24}?)\\s*(?:님|씨)?\\s*(?:을|를|께|한테|에게|이랑|랑|하고|과|와)?\\s*(?:' + CALL_VERBS + ')');
const _QUESTION = /(방법|어떻게|왜\s|뭐|무엇|알려|기록|내용|요약|번역|설명|\?|？|가능|되나|할까|인가|입니까)/;
const _GENERIC = /^(사용자|이용자|상대|상대방|친구|사람|누구|아무|대화|채팅|그|이|저|나|내|우리)$/;
const _ORG_SUFFIX = /(시청|구청|도청|군청|읍사무소|면사무소|주민센터|동사무소|법원|검찰청|경찰서|소방서|세무서|등기소|우체국|병원|의원|약국|은행|공단|공사|대학교|학교|사무소|센터|청|부|처|원|국|과)$/;
const _KO_ROLE_ALIAS = { 회계사: '공인회계사', 중개사: '공인중개사', 평가사: '감정평가사', 노무사: '공인노무사' };

/** 요청 문장에서 호출 대상 문구를 뽑는다. 호출 요청이 아니면 null. */
export function parseCallRequest(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();
  if (!t || t.length > 40 || t.startsWith('[') || _QUESTION.test(t)) return null;
  const bare = t.replace(/[\s.!~]+$/g, '');
  // 번호·@아이디만 입력한 경우도 호출 대상이다.
  if (/^@[A-Za-z0-9._-]{3,}$/.test(bare) || /^\+?[0-9][0-9\s-]{7,16}[0-9]$/.test(bare)) return { target: bare };
  const m = bare.match(_CALL_RE);
  if (!m) return null;
  const target = m[1].replace(/(?:님|씨)$/, '').trim();
  if (!target || _GENERIC.test(target)) return null;
  return { target };
}

export function classifyTarget(target) {
  const t = String(target || '').trim();
  if (/^\+?[0-9][0-9\s-]{7,16}[0-9]$/.test(t)) return 'phone';
  if (/^@?[A-Za-z][A-Za-z0-9._-]{2,29}$/.test(t) || /^@[A-Za-z0-9._-]{3,}$/.test(t)) return 'id';
  if (/^[가-힣]{2,5}$/.test(t) && !_ORG_SUFFIX.test(t)) return 'name';
  return 'other';
}

const _baseLabel = (label) => String(label || '').replace(/\(.*\)\s*$/, '').replace(/\s*보조\s*AI\s*$/, '').trim();

/** 전문가 페르소나 찾기 — 표시명이 정확히 같은(괄호·'보조 AI' 제외) 것 중 가장 상위(id 가 가장 짧은) 하나. */
export function matchExpert(target, registry) {
  const raw = String(target || '').trim();
  const want = _KO_ROLE_ALIAS[raw] || raw;
  if (!want || !registry) return null;
  let best = null;
  for (const [id, def] of Object.entries(registry)) {
    if (!def || !def.label) continue;
    if (_baseLabel(def.label) !== want && String(def.id || id).toLowerCase() !== want.toLowerCase()) continue;
    if (!best || id.length < best.id.length) best = { id, name: def.label };
  }
  return best ? { type: 'expert', id: best.id, name: best.name } : null;
}

const _norm = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
/** K-서비스 찾기 — 이름·id 가 정확히 같은 활성 서비스(예: 'K-Mail', 'kmail', 'k메일'은 제외). */
export function matchService(target, services) {
  const w = _norm(target);
  if (!w || !Array.isArray(services)) return null;
  const hit = services.filter(s => s && s.url && s.status === 'active' && (_norm(s.name) === w || _norm(s.id) === w));
  return hit.length === 1 ? { type: 'service', id: hit[0].id, name: hit[0].name } : null;
}

/**
 * 호출 대상을 찾는다(주피터 지시 순서: 내 친구 → 전문가 → 기관 → 서비스 → 나비웹 사용자 전체).
 * 앞의 네 단계는 전부 기기 안(메모리)에서 끝나므로 네트워크를 기다리지 않는다. 마지막 단계만 서버(/friends/find)를 부른다.
 * deps: { friendsLocal(target)→[user], expertRegistry, institutionIndex(target,{fuzzy})→[{guid,name}], services, findFriend(q), now() }
 * 반환: { target, kind, candidates, trace:[{step,ms,hits}], error? } | null(호출 요청이 아님)
 */
export async function resolveCallTarget(text, deps) {
  const p = parseCallRequest(text);
  if (!p) return null;
  const now = deps.now || (() => Date.now());
  const kind = classifyTarget(p.target);
  const out = { target: p.target, kind, candidates: [], trace: [] };
  const step = async (name, fn) => {
    const t0 = now(); let hits = 0;
    try { hits = (await fn()) || 0; } catch (e) { out.error = out.error || (e && e.message) || 'step_failed'; }
    out.trace.push({ step: name, ms: Math.round((now() - t0) * 10) / 10, hits });
    return hits;
  };
  // 1) 내 친구(이 기기에 저장된, 전에 찾거나 연결한 사용자)
  if (kind === 'name' || kind === 'id' || kind === 'phone') {
    if (await step('friends', () => {
      const us = (deps.friendsLocal && deps.friendsLocal(p.target)) || [];
      us.forEach(u => out.candidates.push({ type: 'person', id: u.guid || u.handle, name: u.nickname || u.handle || p.target, user: u }));
      return us.length;
    })) return out;
  }
  // 2) 전문가 페르소나
  if (await step('expert', () => { const ex = matchExpert(p.target, deps.expertRegistry); if (ex) out.candidates.push(ex); return ex ? 1 : 0; })) return out;
  // 3) 기관 SP — 사람 이름처럼 보이는 말은 정확히 같은 이름만, 기관명처럼 보이면 부분 일치도
  if (await step('institution', () => {
    const rows = (deps.institutionIndex && deps.institutionIndex(p.target, { fuzzy: kind === 'other' })) || [];
    rows.forEach(r => out.candidates.push({ type: 'institution', id: r.guid, name: r.name }));
    return rows.length;
  })) return out;
  // 4) K-서비스
  if (await step('service', () => { const sv = matchService(p.target, deps.services); if (sv) out.candidates.push(sv); return sv ? 1 : 0; })) return out;
  // 5) 나비웹 사용자 전체(서버) — 이름·번호·아이디일 때만
  if (kind === 'phone' || kind === 'id' || kind === 'name') {
    await step('users', async () => {
      const r = await deps.findFriend(p.target);
      const users = r && r.ok !== false ? (r.users || (r.found && r.user ? [r.user] : [])) : [];
      if (r && r.ok === false) out.error = r.error || 'find_failed';
      users.forEach(u => out.candidates.push({ type: 'person', id: u.guid || u.handle, name: u.nickname || u.handle || p.target, user: u }));
      return users.length;
    });
  }
  return out;
}

const _STEP_NAMES = { friends: '내 친구', expert: '전문가', institution: '기관', service: '서비스', users: '나비웹 사용자' };
/** 사용자에게 보여 줄 "찾은 순서" 한 줄. 예: 내 친구 ✗ → 전문가 ✗ → 기관 ✗ → 서비스 ✗ → 나비웹 사용자 ✓ (0.4초) */
export function traceLine(trace) {
  if (!Array.isArray(trace) || !trace.length) return '';
  const total = trace.reduce((a, t) => a + (t.ms || 0), 0);
  return trace.map(t => `${_STEP_NAMES[t.step] || t.step} ${t.hits ? '✓' : '✗'}`).join(' → ') + ` (${(total / 1000).toFixed(2)}초)`;
}
