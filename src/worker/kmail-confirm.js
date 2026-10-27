// src/worker/kmail-confirm.js — 대화로 메일을 보내기 전의 "확인 단계" 방어 장치.
//
// 배경(2026-10-27): 시스템 프롬프트는 "발송 태그를 내기 전에 받는 사람·제목·본문·시각을 보여 주고 '이대로 보낼까요?'로 확인받으라"고
// 하지만, 실제로 비서가 "tensor.city@gmail.com에 테스트 메일 발송" 한 마디에 제목·본문을 직접 지어내 곧바로 보낸 사례가 있었다.
// 메일이 이제 요청 안에서 실제로 바로 나가므로(발송 완료), 모델의 약속에만 기대지 않고 서버가 확인했는지를 검사한다.
//
// 규칙: 발송 태그가 나온 턴의 "바로 앞 비서 메시지"가 확인 질문(이대로 보낼까요? 등)이어야 한다. 그렇지 않으면 메일을 만들지도
// 보내지도 않고, 서버가 태그 내용으로 직접 만든 확인 요약("아직 발송하지 않았습니다 … 이대로 보낼까요?")을 대신 보여 준다.
// 사용자가 동의하면 비서가 그 요약대로 태그를 다시 내고, 이번에는 앞 메시지가 확인 질문이므로 통과한다.
// 순수 함수만 담는다 — worker.js 밖에서 단위 시험이 가능하다.
import { formatKst, isImmediate } from './kmail-send-status.js';
import { describeSender, effectiveSenderName } from './kmail-sender.js';

// 확인을 구하는 문장(질문형). "지금 바로 발송하겠습니다"·"이대로 보냅니다"처럼 선언하는 문장은 해당하지 않는다.
const ASK_RE = /(보낼까요|보내드릴까요|보내도\s*(될까요|괜찮을까요|되겠습니까|괜찮겠습니까)|발송할까요|발송해\s*드릴까요|발송해도\s*(될까요|괜찮을까요|되겠습니까|괜찮겠습니까)|전송할까요|진행할까요|진행해도\s*(될까요|괜찮을까요|되겠습니까)|확정할까요|예약할까요|이대로[^?\n]{0,25}\?)/;

export function hasConfirmationAsk(text) {
  return ASK_RE.test(String(text || '').replace(/\s+/g, ' '));
}

// messages: 이번 턴의 사용자 메시지까지 들어 있는 대화(오래된 것부터). 바로 앞 비서 메시지가 확인 질문이었는가.
export function previousAssistantAsked(messages) {
  if (!Array.isArray(messages)) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'assistant') return hasConfirmationAsk(m.content);
  }
  return false;                                   // 비서 메시지가 아예 없으면(첫 요청 한 번에 발송) 확인한 적이 없다
}

const MAX_LISTED = 10;
const MAX_SUMMARY_CHARS = 3600;                   // 대화 기록은 메시지당 4,000자까지만 서버로 돌아온다 — 본문이 잘린 채 확인받으면 안 된다

function recipientLabel(r) {
  const email = String((r && r.email) || '').trim();
  const name = String((r && r.name) || '').trim();
  return name ? `${name}<${email}>` : email;   // 2026-10-28: 이름<이메일> 표기(사용자가 말한 확인 문구 형식)
}

// parsed: 비서가 낸 KMAIL_SEND_CAMPAIGN JSON. 확인 요약 문장을 서버가 직접 만든다(모델의 서술을 거치지 않아 정확하다).
// sender: { address, name } — 있으면 "보내는 사람" 줄을 넣는다(이름이 없으면 그 사실과 받는 쪽 표시 가능성을 알림).
export function buildConfirmationSummary(parsed, nowMs = Date.now(), sender = null) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const recips = (Array.isArray(p.recipients) ? p.recipients : []).filter(r => r && r.email);
  const listed = recips.slice(0, MAX_LISTED).map(recipientLabel).join(', ');
  const more = recips.length > MAX_LISTED ? ` 외 ${recips.length - MAX_LISTED}명` : '';
  const sendAtMs = Date.parse(p.send_at);
  const when = Number.isFinite(sendAtMs) ? (isImmediate(sendAtMs, nowMs) ? '지금 즉시' : formatKst(sendAtMs, nowMs)) : '(시각 미정 — 정해 주세요)';
  const subject = String(p.subject || '').trim() || '(제목 없음)';
  const body = String(p.body || '').trim();

  const head = [
    '⚠️ 아직 발송하지 않았습니다. 보내기 전에 아래 내용을 확인해 주세요.',
    '',
    ...(sender && sender.address ? [`- **보내는 사람**: ${describeSender(sender.address, sender.name)}`] : []),
    `- **받는 사람**: ${listed || '(없음)'}${more}${recips.length ? ` (총 ${recips.length}명)` : ''}`,
    `- **제목**: ${subject}`,
    `- **발송 시각**: ${when}`,
  ];
  const tail = ['', '이대로 보낼까요? 바꾸고 싶은 곳이 있으면 말씀해 주세요.'];
  const withBody = [...head, '- **본문**:', '', body || '(본문 없음)', ...tail].join('\n');
  if (withBody.length <= MAX_SUMMARY_CHARS) return withBody;
  // 본문이 너무 길면 요약에 담지 않는다 — 일부만 보여 주고 "이대로"라고 하면 잘린 본문이 그대로 나갈 수 있다.
  return [...head, `- **본문**: 길이 ${body.length}자라 여기서는 생략합니다.`, '',
    '본문 전체를 먼저 확인하려면 "발송할 내용 전체를 보여줘"라고 말씀해 주세요. 확인하신 뒤 "보내세요"라고 하면 발송합니다.'].join('\n');
}

// 발송 태그를 받아 줄지 판정한다. → { allow: true } | { allow: false, reply, action }
export function evaluateSendGuard(messages, parsed, nowMs = Date.now(), sender = null) {
  if (previousAssistantAsked(messages)) return { allow: true };
  return { allow: false, reply: buildConfirmationSummary(parsed, nowMs, sender), action: { type: 'send_confirmation_required' } };
}

// 2026-10-28 — 발송 직후 대화에 붙이는 "보낸 메일 내용". parsed 는 실제로 캠페인을 만든 KMAIL_SEND_CAMPAIGN JSON(서버가 확인·발송한 그 값).
// state: 'sent'|'partial'(실제로 나감) | 'queued'|'scheduled'(아직 안 나감 → '발송할 메일 내용') | 'failed'(붙이지 않음 → 빈 문자열)
const MAX_PREVIEW_BODY = 3000;
export function buildSentMailPreview(parsed, sender, state, sendAtMs, nowMs = Date.now()) {
  if (state === 'failed') return '';
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const recips = (Array.isArray(p.recipients) ? p.recipients : []).filter(r => r && r.email);
  const listed = recips.slice(0, MAX_LISTED).map(recipientLabel).join(', ');
  const more = recips.length > MAX_LISTED ? ` 외 ${recips.length - MAX_LISTED}명` : '';
  const subject = String(p.subject || '').trim() || '(제목 없음)';
  let body = String(p.body || '').trim() || '(본문 없음)';
  if (body.length > MAX_PREVIEW_BODY) body = body.slice(0, MAX_PREVIEW_BODY) + `\n… (이하 ${String(p.body).trim().length - MAX_PREVIEW_BODY}자 생략 — 전체는 "내 캠페인"에서 확인하세요)`;
  const sent = state === 'sent' || state === 'partial';
  const timeLine = sent
    ? `- **발송 시각**: ${formatKst(nowMs, nowMs)}`
    : (Number.isFinite(sendAtMs) && !isImmediate(sendAtMs, nowMs) ? `- **발송 예정**: ${formatKst(sendAtMs, nowMs)}` : '- **발송 예정**: 곧(보통 10분 이내)');
  return [
    sent ? '📨 **보낸 메일 내용**' : '📝 **발송할 메일 내용**',
    '',
    ...(sender && sender.address ? [`- **보내는 사람**: ${effectiveSenderName(sender.name) ? effectiveSenderName(sender.name) + '<' + sender.address + '>' : sender.address}`] : []),
    `- **받는 사람**: ${listed || '(없음)'}${more}${recips.length ? ` (총 ${recips.length}명)` : ''}`,
    `- **제목**: ${subject}`,
    timeLine,
    '- **본문**:',
    '',
    ...body.split('\n').map(l => '> ' + l),
  ].join('\n');
}
