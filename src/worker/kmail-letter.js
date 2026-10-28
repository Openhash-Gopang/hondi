// src/worker/kmail-letter.js — "편지 작성(AI)" 모드(2026-10-28, 주피터 지시).
// 새 캠페인과 같은 대화 인터페이스지만, 캠페인(내 캠페인)을 만들지 않고 개인 편지로 바로 보내 '보낸메일함'에만 기록한다.
// 순수 함수만 담는다 — worker.js 밖에서 단위 시험이 가능하다.
import { formatKst, isImmediate } from './kmail-send-status.js';

export const LETTER_MAX_RECIPIENTS = 5;               // 편지는 소수에게만(여러 명은 새 캠페인). 요청 하나의 하위 요청 한도를 넘지 않게 보수적으로.
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

// KMAIL_INSTANT_SEND_MAX 가 있으면 따르되 1~5명으로 제한한다.
export function letterMax(instantMax) {
  const n = Math.floor(Number(instantMax));
  return Math.min(LETTER_MAX_RECIPIENTS, Math.max(1, Number.isFinite(n) ? n : 1));
}

// 편지 모드에서 모델에게 주는 안내(시스템 메시지로 추가).
export const LETTER_MODE_NOTE = [
  "[편지 작성(AI) 모드] 이 대화는 '새 캠페인'이 아니라 개인 편지를 써서 바로 보내는 화면입니다.",
  '① KMAIL_CAMPAIGN_START 와 캠페인 설계(트랙·회신 수집·다이제스트·분할 발송)는 쓰지 마세요.',
  "② 발송은 지금 즉시만 가능합니다. 예약을 원하면 \"편지 작성은 바로 보내는 것만 됩니다. 예약은 '새 캠페인'에서 해 주세요\"라고 안내하세요.",
  '③ 받는 사람은 소수(기본 1명)입니다. 많은 사람에게 보내려면 새 캠페인을 안내하세요.',
  '④ 수신자·제목·본문을 보여 주고 "…보낼까요?"로 확인받은 뒤 사용자가 승인하면 KMAIL_SEND_CAMPAIGN 태그(send_at 은 지금)를 내세요. 서버가 이를 편지로 보내 "보낸메일함"에만 기록합니다(내 캠페인에는 남지 않습니다).',
  '⑤ 이름만 말한 수신자의 주소록 조회, 확인 질문 형식, 보내는 사람 줄은 평소와 같이 따르세요.',
].join('\n');

// 발송 태그(parsed)를 편지로 보낼 수 있는지 판정. → { ok:true, recipients, subject, body } | { ok:false, message }
export function evaluateLetter(parsed, { nowMs = Date.now(), max = 1 } = {}) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const recipients = (Array.isArray(p.recipients) ? p.recipients : [])
    .map(r => ({ name: String((r && r.name) || '').trim(), email: String((r && r.email) || '').trim() }))
    .filter(r => EMAIL_RE.test(r.email));
  const subject = String(p.subject || '').trim();
  const body = String(p.body || '').trim();
  if (!recipients.length) return { ok: false, message: '받는 사람 이메일을 확인하지 못해 아직 보내지 않았습니다. 받는 사람을 알려 주세요.' };
  if (recipients.length > max) return { ok: false, message: `편지 작성은 한 번에 ${max}명까지 보낼 수 있습니다(지금 ${recipients.length}명). 여러 명에게는 '새 캠페인'을 이용해 주세요. 아직 보내지 않았습니다.` };
  if (!subject || !body) return { ok: false, message: '제목과 본문이 모두 있어야 보낼 수 있습니다. 아직 보내지 않았습니다.' };
  const sendAtMs = Date.parse(p.send_at);
  if (Number.isFinite(sendAtMs) && !isImmediate(sendAtMs, nowMs)) {
    return { ok: false, message: `편지 작성은 바로 보내는 것만 됩니다(요청하신 시각: ${formatKst(sendAtMs, nowMs)}). 예약 발송은 '새 캠페인'에서 해 주세요. 아직 보내지 않았습니다.` };
  }
  return { ok: true, recipients, subject, body };
}

// 발송 결과 문구. state: 'sent' | 'partial' | 'failed'
export function buildLetterStatus({ success, fail, nowMs = Date.now() }) {
  const s = Number(success) || 0, f = Number(fail) || 0;
  if (s > 0 && f === 0) return { state: 'sent', line: `✅ 발송 완료 — ${s}명에게 보냈습니다. (${formatKst(nowMs, nowMs)}) "보낸메일함"에서 볼 수 있습니다. 캠페인으로는 기록하지 않았습니다.` };
  if (s > 0) return { state: 'partial', line: `⚠️ 일부만 발송했습니다 — ${s}명 성공, ${f}명 실패. (${formatKst(nowMs, nowMs)}) 성공한 편지는 "보낸메일함"에서 볼 수 있습니다.` };
  return { state: 'failed', line: `❌ 발송하지 못했습니다 — ${f}명 모두 실패했습니다. 잠시 뒤 다시 시도해 주세요.` };
}
