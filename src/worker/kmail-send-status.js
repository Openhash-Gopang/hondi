// src/worker/kmail-send-status.js — K-Mail 대화에서 "보내세요" 뒤에 사용자에게 보여 주는 발송 결과 문구.
//
// 원칙(2026-10-27): 문구는 "지금 실제로 일어난 일"만 말한다.
//   · 발송 완료  — 메일을 실제로 내보냈다(수신자별 성공 수를 안다).
//   · 발송 접수  — 아직 보내지 않았고 서버가 곧 보낸다(10분 주기 스케줄러가 집는다).
//   · 예약 완료  — 사용자가 정한 미래 시각에 보낼 것이다.
//   · 일부만 발송 / 발송 실패 — 실제 결과 그대로.
// 시각은 서버 내부의 UTC ISO(…Z)가 아니라 한국 시간(KST)으로 보여 준다.
// 순수 함수만 담는다 — worker.js 밖에서 단위 시험이 가능하다.

export const KST_OFFSET_MS = 9 * 3600 * 1000;
export const IMMEDIATE_WINDOW_MS = 60 * 1000;          // 보낼 시각이 지금부터 1분 이내면 "지금 즉시"로 본다
export const DEFAULT_INSTANT_SEND_MAX = 1;             // 이 수 이하의 수신자는 대화 요청 안에서 바로 발송한다(무료 플랜은 요청당 하위 요청이 50개라 보수적으로 1명)

const pad = (n) => String(n).padStart(2, '0');
function kstParts(ms) { const d = new Date(ms + KST_OFFSET_MS); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; }

// 10월 27일 16:58  (해가 다르면 2027년 1월 3일 09:00)
export function formatKst(valueMs, nowMs = Date.now()) {
  const p = kstParts(valueMs), n = kstParts(nowMs);
  return `${p.y !== n.y ? p.y + '년 ' : ''}${p.mo}월 ${p.d}일 ${pad(p.h)}:${pad(p.mi)}`;
}

export function isImmediate(sendAtMs, nowMs) { return Number.isFinite(sendAtMs) && sendAtMs <= nowMs + IMMEDIATE_WINDOW_MS; }

// KMAIL_INSTANT_SEND_MAX: 미설정이면 1. 0이면 끈다(항상 스케줄러에 맡김). 유료 플랜(요청당 하위 요청 한도가 넉넉함)이면 올린다.
export function instantSendMax(env) {
  const raw = env && env.KMAIL_INSTANT_SEND_MAX;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_INSTANT_SEND_MAX;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_INSTANT_SEND_MAX;
}

// outcome: null/undefined(즉시 발송을 시도하지 않음) | { dispatched:false } | { dispatched:true, success, fail }
// → { state: 'sent'|'partial'|'failed'|'queued'|'scheduled', line }
export function buildSendStatus({ nowMs, sendAtMs, recipientCount, newContactCount = 0, outcome = null }) {
  const n = recipientCount;
  let state, line;
  if (!isImmediate(sendAtMs, nowMs)) {
    state = 'scheduled';
    line = `⏰ 예약 완료 — ${formatKst(sendAtMs, nowMs)}에 ${n}명에게 발송됩니다. 아직 발송 전입니다.`;
  } else if (outcome && outcome.dispatched) {
    const s = Number(outcome.success) || 0, f = Number(outcome.fail) || 0;
    if (s > 0 && f === 0) { state = 'sent'; line = `✅ 발송 완료 — ${s}명에게 보냈습니다. (${formatKst(nowMs, nowMs)})`; }
    else if (s > 0) { state = 'partial'; line = `⚠️ 일부만 발송했습니다 — ${s}명 성공, ${f}명 실패. (${formatKst(nowMs, nowMs)}) 실패한 분은 "내 캠페인"에서 확인하세요.`; }
    else { state = 'failed'; line = `❌ 발송하지 못했습니다 — ${f || n}명 모두 실패했습니다. 잠시 뒤 다시 시도해 주세요.`; }
  } else {
    state = 'queued';
    line = `📤 발송 접수 — ${n}명. 아직 발송 전이며, 곧 자동으로 보내집니다(보통 10분 이내). 진행 상황은 "내 캠페인"에서 확인하세요.`;
  }
  if (newContactCount > 0) line += ` · 받는 사람 ${newContactCount}명을 주소록에 새로 저장했습니다`;
  return { state, line };
}
