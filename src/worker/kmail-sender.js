// src/worker/kmail-sender.js — 보내는 사람 표시(From의 이름 부분) 규칙.
// 순수 함수만 담는다 — worker.js 밖에서 단위 시험이 가능하다.
//
// 2026-10-27 결정(주피터): 받는 사람 화면에는 기본으로 보내는 주소(예: ceo@hondi.kr)만 보인다. 사용자가 원하면 이름을 붙여
// "도 영민 <ceo@hondi.kr>" 형식으로 보낼 수 있다. 예전에는 이름을 안 정해도 "나비 K-Mail"이 자동으로 붙었다 — 그 옛 기본값은 "이름 없음"으로 본다.
export const LEGACY_DEFAULT_NAME = '나비 K-Mail';
export const SENDER_NAME_MAX = 40;

const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/;   // 줄바꿈·보이지 않는 문자·글자 방향 바꾸기(속임수에 쓰임)
const FORBIDDEN_RE = /[<>"@\\;:,]/;                                                                            // 주소·헤더를 흉내 내거나 깨뜨릴 수 있는 문자
const RESERVED_WORDS = ['hondi', '혼디', 'admin', '관리자', '운영자', '운영팀', '고객센터', '공식', 'official', 'support', 'postmaster', 'security', '보안', 'noreply', 'no-reply'];

export const SENDER_NAME_MESSAGES = {
  type: '이름은 글자로 입력해 주세요.',
  control: '줄바꿈이나 보이지 않는 문자는 쓸 수 없습니다.',
  length: `이름은 ${SENDER_NAME_MAX}자까지 쓸 수 있습니다.`,
  chars: '이름에는 < > " @ \\ ; : , 문자를 쓸 수 없습니다.',
  reserved: '서비스나 기관을 사칭할 수 있는 말(혼디, 관리자, 공식, 고객센터 등)은 이름에 쓸 수 없습니다.',
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
  if (FORBIDDEN_RE.test(v)) return { ok: false, value: v, reason: 'chars', message: SENDER_NAME_MESSAGES.chars };
  if (!isAdmin) {
    const lower = v.toLowerCase();
    if (RESERVED_WORDS.some(w => lower.includes(w))) return { ok: false, value: v, reason: 'reserved', message: SENDER_NAME_MESSAGES.reserved };
  }
  return { ok: true, value: v };
}

// 보낼 때 실제로 쓸 이름. 저장된 값이 비었거나 옛 기본값이거나, 예전에 검사 없이 저장돼 위험한 글자가 들어 있으면 "이름 없음"으로 본다(주소만 나감).
export function effectiveSenderName(stored) {
  const v = String(stored == null ? '' : stored).replace(/\s+/g, ' ').trim();
  if (!v || v === LEGACY_DEFAULT_NAME) return '';
  if (CONTROL_RE.test(v) || FORBIDDEN_RE.test(v) || codePoints(v) > SENDER_NAME_MAX * 2) return '';
  return v;
}

// 받는 사람 화면에 보이는 모양: "도 영민 <ceo@hondi.kr>" 또는 이름이 없으면 "ceo@hondi.kr"
export function formatSender(address, name) {
  const n = effectiveSenderName(name);
  return n ? `${n} <${address}>` : String(address);
}
