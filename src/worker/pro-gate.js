// 전문가용 SP 서버 게이트 (2026-10-21) — AI 프록시 경로로 들어오는 요청에 전문가용 SP(`-assistant`)가 실려 있으면
// 유효한 전문가 세션(pro-session.js)이 있어야만 통과시킨다. 계획 W1-5.
//
// 식별 방식: 전문가용 SP 는 클라이언트가 공개 파일로 조립해 system 에 실어 보내므로, 서버는 본문으로 식별한다.
//   ① 제목 줄 `# SP-XXX-NN · ○○ 보조 AI` 의 코드가 assistant-sp-codes.js 에 있으면 그 직역의 전문가용 SP
//   ② 전문가용 SP 생성기가 넣는 고유 줄 2개(CLASS_MARKS)가 모두 있으면 전문가용으로 본다(직역 불명 → 어떤 직역이든 세션 필요)
// 한계: 본문을 직접 고쳐 제목·고유 줄을 지우면 우회할 수 있다. 근본 해결은 전문가용 SP 를 서버에서만 조립하는 것(후속 과제).
//   이 게이트는 "키만 바꿔 호출"하는 무단 이용을 막는 1차 장치이며, 이용은 어차피 GDC 과금 대상이다.
//
// 구독(W5): 인증이 맞아도 세션의 sub(구독·체험 만료 시각)가 지났으면 402 PRO_SUBSCRIPTION_REQUIRED — env.PRO_SUB_MODE 로 단계 도입.
// 모드(env.PRO_GATE_MODE): 'off' | 'log'(기본 — 차단 없이 기록만) | 'enforce'. 프런트가 pro_session 을 보내기 시작한 뒤 enforce 로 전환한다.
import { ASSISTANT_SP_CODES } from './assistant-sp-codes.js';
import { verifySession } from './pro-session.js';
import { personaCovers } from './pro-verify-handler.js';

export const TITLE_RE = /^# (SP-[A-Z]+-[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*) · [^\n]*보조 AI/m;
export const CLASS_MARKS = ['scope_note: "{경계 영역일 때 범위 확인 사유}"', 'law_checked: {조회한 법령·서식·기준과 조회일'];
const MAX_TEXT = 2_000_000;

function collectStrings(v, out, depth = 0) {
  if (out.len > MAX_TEXT || depth > 6) return;
  if (typeof v === 'string') { out.parts.push(v); out.len += v.length; }
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out, depth + 1);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) collectStrings(v[k], out, depth + 1);
}

// → { assistant: boolean, persona: string|null }
export function detectAssistantSp(body) {
  const out = { parts: [], len: 0 };
  collectStrings(body, out);
  const text = out.parts.join('\n');
  const t = text.match(TITLE_RE);
  // 표에 없는 코드(예: 아직 전문가용으로 분리되지 않은 법무사·행정사 SP — 제목만 '보조 AI')는 제목만으로는 전문가용으로 보지 않는다.
  if (t && ASSISTANT_SP_CODES[t[1]]) return { assistant: true, persona: ASSISTANT_SP_CODES[t[1]] };
  if (CLASS_MARKS.every(m => text.includes(m))) return { assistant: true, persona: null };
  return { assistant: false, persona: null };
}

// → { ok:true, bodyText, mode, wouldBlock? } | { ok:false, status, code, message }
export async function checkProGate({ bodyText, env, now = Date.now() }) {
  const mode = String(env?.PRO_GATE_MODE || 'log').toLowerCase();
  if (mode === 'off') return { ok: true, bodyText, mode };
  let body; try { body = JSON.parse(bodyText); } catch { return { ok: true, bodyText, mode }; }
  const det = detectAssistantSp(body);
  const token = body && typeof body === 'object' ? body.pro_session : undefined;
  if (token !== undefined && body && typeof body === 'object') { delete body.pro_session; bodyText = JSON.stringify(body); }   // LLM·핸들러로 넘기지 않는다
  if (!det.assistant) return { ok: true, bodyText, mode };

  const s = await verifySession(env?.PRO_SESSION_SECRET, token, now);
  let fail = null;
  if (!s) fail = { status: 401, code: 'PRO_SESSION_REQUIRED', message: '전문가용 AI는 면허 인증을 마친 전문가만 쓸 수 있습니다. 인증을 신청하거나 다시 로그인하세요.' };
  else if (det.persona ? !s.personas.some(p => personaCovers(p, det.persona)) : s.personas.length === 0) fail = { status: 403, code: 'PRO_PERSONA_MISMATCH', message: '이 직역에 대한 면허 인증이 없습니다.' };
  // 구독·체험(W5) — env.PRO_SUB_MODE: off(기본) | log | enforce. 차단은 PRO_GATE_MODE 와 PRO_SUB_MODE 가 모두 enforce 일 때만.
  // 세션 토큰의 sub(접근 가능 시각)만 본다 — 추가 DB 조회 없음. 부여·환불은 토큰 수명(4시간) 안에 반영된다.
  const subMode = String(env?.PRO_SUB_MODE || 'off').toLowerCase();
  let subFail = null;
  if (!fail && subMode !== 'off' && !(s.sub > now)) subFail = { status: 402, code: 'PRO_SUBSCRIPTION_REQUIRED', message: '전문가용 AI는 구독이 필요합니다. 체험 기간이 끝났거나 구독이 만료되었습니다. 구독 안내를 확인하세요.' };
  if (subFail) {
    if (mode === 'enforce' && subMode === 'enforce') return { ok: false, ...subFail };
    return { ok: true, bodyText, mode, wouldBlock: subFail.code, persona: det.persona };
  }
  if (!fail) return { ok: true, bodyText, mode, persona: det.persona };
  if (mode === 'enforce') return { ok: false, ...fail };
  return { ok: true, bodyText, mode, wouldBlock: fail.code, persona: det.persona };
}
