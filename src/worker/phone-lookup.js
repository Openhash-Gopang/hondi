// ═════════════════════════════════════════════════
// 전화번호로 프로필 찾기 — e164_hash 기준 조회 (2026-09-25)
//
// 배경(docs/SESSION_LESSONS_BIOMETRIC_E164_DEPLOYMENT_20260907, pb_hooks/main.pb.js):
//   2026-09-07부터 새 가입 계정의 profiles.e164 는 항상 빈 문자열이다("서버에 개인정보를 저장하지 않는다").
//   번호는 세 칸에만 남는다:
//     e164_hash  = HMAC-SHA256(PHONE_VERIFY_SECRET, "e164-lookup:" + e164)  (hex)   ← 정확일치 조회용
//     e164_enc   = AES-256-GCM(e164)                                                  ← SMS 재발송 등 원문이 꼭 필요할 때만
//     e164_last8 = e164 뒤 8자리 평문                                                 ← "숫자코드"(뒷 8자리) 일치 검색용
//   이전에 가입한 계정은 평문 e164 가 남아 있고 e164_hash 는 백필되어 있다.
// 그런데 worker.js 의 조회 5곳은 여전히 평문 `e164='…'` / `e164~'…'` 로만 찾아서, 새 계정은 찾지 못한다.
// (같은 문서는 "worker.js 조회 지점은 전부 e164_hash 기준으로 바뀌었다"고 적었지만 git 이력상 worker.js 에는
//  e164_hash 가 한 번도 들어간 적이 없다.)
//
// 이 모듈은 조회 조건(필터)과 8자리 매칭 판정만 만든다 — 실제 L1 호출은 worker.js 가 그대로 한다.
//   · 해시로 찾되 옛 레코드(평문만 있는 경우)도 같이 찾도록 OR 로 묶는다.
// ═════════════════════════════════════════════════

const enc = new TextEncoder();
const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** pb_hooks 의 $security.hs256("e164-lookup:" + e164, secret) 와 같은 값(HMAC-SHA256, 16진수). */
export async function e164LookupHash(secret, e164) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('e164-lookup:' + e164));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 정확일치 조회 필터: 새 계정(e164_hash) + 옛 계정(평문 e164) 모두. e164 는 호출부가 이미 정규화한 값이어야 한다. */
export async function profilePhoneFilter(env, e164) {
  const plain = `e164='${q(e164)}'`;
  if (!env || !env.PHONE_VERIFY_SECRET) return plain;              // 비밀값이 없으면 예전 동작 그대로
  const h = await e164LookupHash(env.PHONE_VERIFY_SECRET, e164);
  return `(e164_hash='${h}' || ${plain})`;
}

/** "뒷 8자리 매칭키" 1차 후보 필터: 새 계정(e164_last8) + 옛 계정(평문 부분일치). code 는 8자리 숫자만 넘긴다. */
export function last8Filter(code) {
  const c = q(code);
  return `(e164_last8='${c}' || e164~'${c}')`;
}

/** 후보 중 뒤 8자리가 정확히 code 이고 딱 1건일 때만 그 guid, 아니면 null(0건·충돌은 자동 처리 포기). */
export function pickGuidByLast8(items, code) {
  const exact = (items || []).filter(p => {
    const last8 = p.e164_last8 ? String(p.e164_last8) : String(p.e164 || '').replace(/\D/g, '').slice(-8);
    return last8 === code;
  });
  return exact.length === 1 ? exact[0].guid : null;
}
