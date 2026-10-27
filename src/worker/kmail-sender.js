// src/worker/kmail-sender.js — 보내는 사람 표시(From의 이름 부분) 규칙.
// 순수 함수만 담는다 — worker.js 밖에서 단위 시험이 가능하다.
//
// 2026-10-27 결정(주피터): 받는 사람 화면에는 기본으로 보내는 주소(예: ceo@hondi.kr)만 보인다. 사용자가 원하면 이름을 붙여
// "도 영민 <ceo@hondi.kr>" 형식으로 보낼 수 있다. 예전에는 이름을 안 정해도 "나비 K-Mail"이 자동으로 붙었다 — 그 옛 기본값은 "이름 없음"으로 본다.
export const LEGACY_DEFAULT_NAME = '나비 K-Mail';
export const SENDER_NAME_MAX = 40;

const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/;   // 줄바꿈·보이지 않는 문자·글자 방향 바꾸기(속임수에 쓰임)
const FORBIDDEN_RE = /[<>"@\\;:,]/;                                                                            // 주소·헤더를 흉내 내거나 깨뜨릴 수 있는 문자
// Google 발신자 지침: 이름 옆에 이모지·이미지를 붙여 인증된 것처럼 보이게 하면 안 된다 — ✓ ✔ ☑ ✅ 🔒 🔐 🔏 🛡 (이모지 선택자 포함)
const VERIFY_SYMBOL_RE = /[\u2713\u2714\u2611\u2705\u{1F512}\u{1F510}\u{1F50F}\u{1F6E1}]\uFE0F?/gu;
const RESERVED_WORDS = ['hondi', '혼디', 'admin', '관리자', '운영자', '운영팀', '고객센터', '공식', 'official', 'support', 'postmaster', 'security', '보안', 'noreply', 'no-reply', 'verified', '인증됨', '인증완료', '인증 완료'];

export const SENDER_NAME_MESSAGES = {
  type: '이름은 글자로 입력해 주세요.',
  control: '줄바꿈이나 보이지 않는 문자는 쓸 수 없습니다.',
  length: `이름은 ${SENDER_NAME_MAX}자까지 쓸 수 있습니다.`,
  chars: '이름에는 < > " @ \\ ; : , 문자를 쓸 수 없습니다.',
  reserved: '서비스나 기관을 사칭할 수 있는 말(혼디, 관리자, 공식, 고객센터 등)은 이름에 쓸 수 없습니다.',
  symbol: '인증·보증된 것처럼 보이는 기호(✓ ✔ ✅ 🔒 등)는 이름에 쓸 수 없습니다.',
};

const codePoints = (s) => Array.from(s).length;

// 저장하기 전 검사. 빈 값은 "이름 없이 주소만"이라는 뜻이라 통과한다. → { ok, value, reason?, message? }
export function checkSenderName(raw, { isAdmin = false } = {}) {
  if (raw === null || raw === undefined) return { ok: true, value: '' };
  if (typeof raw !== 'string') return { ok: false, value: '', reason: 'type', message: SENDER_NAME_MESSAGES.type };
  const nfc = raw.normalize('NFC');
  if (CONTROL_RE.test(nfc)) return { ok: false, value: '', reason: 'control', message: SENDER_NAME_MESSAGES.control };
  const v = nfc.replace(/\s+/g, ' ').trim();
  if (!v) return { ok: true, value: '' };
  if (codePoints(v) > SENDER_NAME_MAX) return { ok: false, value: v, reason: 'length', message: SENDER_NAME_MESSAGES.length };
  if (new RegExp(VERIFY_SYMBOL_RE.source, 'u').test(v)) return { ok: false, value: v, reason: 'symbol', message: SENDER_NAME_MESSAGES.symbol };   // 관리자도 예외 없음
  if (FORBIDDEN_RE.test(v)) return { ok: false, value: v, reason: 'chars', message: SENDER_NAME_MESSAGES.chars };
  if (!isAdmin) {
    const lower = v.toLowerCase();
    if (RESERVED_WORDS.some(w => lower.includes(w))) return { ok: false, value: v, reason: 'reserved', message: SENDER_NAME_MESSAGES.reserved };
  }
  return { ok: true, value: v };
}

// 보낼 때 실제로 쓸 이름. 저장된 값이 비었거나 옛 기본값이거나, 예전에 검사 없이 저장돼 위험한 글자가 들어 있으면 "이름 없음"으로 본다(주소만 나감).
export function effectiveSenderName(stored) {
  // 예전에 검사 없이 저장된 이름에 인증 기호가 들어 있으면 기호만 조용히 지우고 나머지 이름은 그대로 쓴다
  const v = String(stored == null ? '' : stored).replace(VERIFY_SYMBOL_RE, '').replace(/\s+/g, ' ').trim();
  if (!v || v === LEGACY_DEFAULT_NAME) return '';
  if (CONTROL_RE.test(v) || FORBIDDEN_RE.test(v) || codePoints(v) > SENDER_NAME_MAX * 2) return '';
  return v;
}

// 받는 사람 화면에 보이는 모양: "도 영민 <ceo@hondi.kr>" 또는 이름이 없으면 "ceo@hondi.kr"
export function formatSender(address, name) {
  const n = effectiveSenderName(name);
  return n ? `${n} <${address}>` : String(address);
}

// 발송 전 확인 요약에 쓰는 "보내는 사람" 설명 — 이름이 없을 때는 받는 사람 화면에서 아이디가 이름처럼 보일 수 있음을 알린다.
// (Gmail이 이름 없는 주소를 어떻게 보이는지는 Google이 문서로 밝히지 않았고, 사용자 보고로는 @ 앞부분이 보낸 사람 이름으로 보인다.)
export function describeSender(address, name) {
  const n = effectiveSenderName(name);
  if (n) return `${n} <${address}>`;
  const local = String(address).split('@')[0];
  return `${address} (이름 없음 — 받는 사람의 메일 프로그램에 따라 "${local}"가 보낸 사람 이름으로 보일 수 있습니다)`;
}

// 2026-10-28 — 회신 주소. 캠페인 메일의 Reply-To(kmail-<캠페인ID>@hondi.kr)는 회신을 캠페인별로 모으기 위한 내부 주소다.
// 받는 사람이 1명이면 모을 것이 없으므로 Reply-To 를 보내는 사람 자신으로 둔다(REPLY_TO_SELF → 발송 직전에 보내는 주소로 바뀐다. 이름이 있으면 "주피터<ceo@hondi.kr>").
// 2명 이상이면 캠페인 주소를 유지한다.
export const REPLY_TO_SELF = '__reply_to_self__';
export function campaignReplyTo(trackingAddress, recipientCount) {
  return Number(recipientCount) === 1 ? REPLY_TO_SELF : trackingAddress;
}
// Reply-To 에도 보내는 이름을 붙인다 → { email, name }. 이름이 없거나 Reply-To 가 없으면 그대로.
export function replyToWithName(replyTo, name) {
  if (!replyTo || typeof replyTo !== 'string') return replyTo;
  const n = effectiveSenderName(name);
  return n ? { email: replyTo, name: n } : replyTo;
}
