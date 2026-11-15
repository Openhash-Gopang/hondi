// ═════════════════════════════════════════════════
// 친구 초대(추천인) — 2026-11-15, 주피터 지시
//   · 초대 문자의 가입 주소에 추천 코드(?ref=)를 붙인다. 코드는 guid 에서 서버 비밀값으로 만든 짧은 값이라 guid 를 알 수 없다.
//   · 초대받은 사람이 실제로 가입(전화 인증 + 프로필 생성)하면 추천인에게 REFERRAL_REWARD_KRW(1,000원 = 1,000 GDC, 1:1)를 한 번 지급한다.
//   · 부정 방지: 가입자 1명당 1회, 본인 추천 불가, 가입 후 REFERRAL_WINDOW_HOURS 안에서만 청구, 추천인당 REFERRAL_MAX_REWARDS 명까지.
// 이 모듈은 순수 계산만 한다(네트워크 없음). L1·KV 는 worker.js 가 한다.
// ═════════════════════════════════════════════════
export const REFERRAL_REWARD_KRW = 1000;
export const REFERRAL_WINDOW_HOURS = 72;
export const REFERRAL_MAX_REWARDS = 30;
export const INVITE_BASE_URL = 'https://naviweb.kr/webapp.html';

const hex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

/** guid → 추천 코드(10자리 16진). 같은 guid 는 늘 같은 코드. */
export async function referralCode(secret, guid) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode('ref-code:' + guid))).slice(0, 10);
}

export const isReferralCode = (c) => /^[0-9a-f]{10}$/.test(String(c || ''));

export function inviteLink(code) { return `${INVITE_BASE_URL}?ref=${code}`; }

/** 초대 문자 본문(클라이언트가 sms: 링크에 채운다). name 은 보내는 사람 이름(없으면 생략). */
export function inviteText(code, name) {
  const who = name ? `${name}입니다. ` : '';
  return `${who}나비웹에서 대화해요! AI 비서 나비가 도와주는 앱이에요. 가입하면 1,000 GDC를 드려요.\n${inviteLink(code)}`;
}

/** 가입(프로필 created)한 지 windowHours 안인가. */
export function withinClaimWindow(createdIso, now = Date.now(), windowHours = REFERRAL_WINDOW_HOURS) {
  const t = Date.parse(String(createdIso || '').replace(' ', 'T'));
  if (!Number.isFinite(t)) return false;
  return now - t >= 0 && now - t <= windowHours * 3600000;
}
