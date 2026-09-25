// ═════════════════════════════════════════════════
// 문자(SMS) 인증 토큰 검증 — 숫자 번호 등록용 (2026-09-25 v3, 주피터 지시로 재작성)
//
// v1~v2는 "토큰의 번호가 계정에 저장된 e164_hash와도 일치해야 한다"는 검사를 추가로 두었는데,
// 이는 가입 시점 SMS 인증이나 이미 운영 중인 K-Law 로그인·GDC 잔액 조회(worker.js
// _resolveGuidFromPhoneVerifyToken)의 검증 방식에 없는, 이번에 새로 만들어 넣은 단계였다.
// 그 두 곳은 서명·만료·guid 바인딩만 확인하고 저장된 값과 대조하지 않는다 — 신뢰는
// "이 계정 자신의 e164로 요청한 OTP를 자신이 입력해, 자신의 guid로 서버가 서명해 준 토큰"이라는
// 발급 경로 자체에서 나오고, 그걸로 충분하다(요청 시 e164·guid 둘 다 로그인 세션에서 읽으므로
// 자기 모순이 나올 수 없다). 저장된 값과의 대조는 불필요했고, 형식·비밀값 이력에 계속 걸려
// 여러 차례 오거절을 냈다. v3는 그 비교를 없애고 검증된 패턴을 그대로 따른다.
//
// 토큰 형식은 /biz/phone-otp-verify 가 발급하는 guid 바인딩 3필드 그대로다:
//     "<e164>:<guid>:<exp>.<hmacSha256Hex(PHONE_VERIFY_SECRET, '<e164>:<guid>:<exp>')>"
// 이 토큰의 유효기간은 30일(로그인 유지용)이라, 그대로 받으면 한 달 전 인증으로도 등록할 수 있다.
// 그래서 여기서는 **방금(기본 10분 이내) 문자 인증한 토큰만** 허용한다(발급 시각 = exp − ttlMs).
//
// 검사 순서: 형식 → guid 바인딩(등록하려는 계정과 같은 guid) → 서명 → 만료 → 신선도
// 반환: { ok:true } | { ok:false, status, code, message }
// ═════════════════════════════════════════════════

const enc = new TextEncoder();

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * @param {{secret:string, token:string, guid:string, ttlMs:number, freshMs?:number, now?:number}} p
 * @returns {Promise<{ok:true, e164:string} | {ok:false, status:number, code:string, message:string}>}
 */
export async function verifyFreshPhoneToken({ secret, token, guid, ttlMs, freshMs = 10 * 60 * 1000, now = Date.now() }) {
  const bad = (status, code, message) => ({ ok: false, status, code, message });
  if (!secret) return bad(500, 'SECRET_NOT_SET', 'PHONE_VERIFY_SECRET이 설정되지 않았습니다.');
  if (!guid) return bad(400, 'MISSING_GUID', 'guid가 필요합니다.');
  const t = String(token || '');
  const dot = t.lastIndexOf('.');
  if (dot < 0) return bad(400, 'PHONE_TOKEN_MALFORMED', '문자 인증 토큰 형식이 올바르지 않습니다.');
  const payload = t.slice(0, dot), sig = t.slice(dot + 1);
  const first = payload.indexOf(':'), last = payload.lastIndexOf(':');
  if (first < 0 || last < first) return bad(400, 'PHONE_TOKEN_MALFORMED', '문자 인증 토큰 형식이 올바르지 않습니다.');
  const e164 = payload.slice(0, first), exp = Number(payload.slice(last + 1));
  const tokenGuid = first === last ? null : payload.slice(first + 1, last);   // guid에 ':'가 있어도 안전(양 끝 콜론으로 자름, worker.js와 동일)
  if (!e164 || !Number.isFinite(exp)) return bad(400, 'PHONE_TOKEN_MALFORMED', '문자 인증 토큰 형식이 올바르지 않습니다.');
  if (!tokenGuid) return bad(400, 'PHONE_TOKEN_NOT_BOUND', '계정에 묶이지 않은 인증 토큰입니다. 문자 인증을 다시 진행해 주세요.');
  if (tokenGuid !== guid) return bad(403, 'PHONE_TOKEN_GUID_MISMATCH', '다른 계정용으로 발급된 인증 토큰입니다.');
  if (!timingSafeEqualHex(await hmacHex(secret, payload), sig)) return bad(401, 'PHONE_TOKEN_INVALID', '문자 인증 토큰 서명이 유효하지 않습니다.');
  if (now > exp) return bad(401, 'PHONE_TOKEN_EXPIRED', '문자 인증이 만료되었습니다. 다시 인증해 주세요.');
  if (!(ttlMs > 0)) return bad(500, 'TTL_NOT_SET', '토큰 유효기간 설정이 없습니다.');
  const issuedAt = exp - ttlMs;
  if (now - issuedAt > freshMs) return bad(401, 'PHONE_TOKEN_STALE', '방금 진행한 문자 인증만 사용할 수 있습니다. 문자 인증을 다시 진행해 주세요.');
  return { ok: true, e164 };
}

/**
 * 문자 토큰 + (지문을 쓰는 계정이면) 지문 step-up 토큰까지 확인한다.
 * 기존 규칙(/biz/phone-otp-request 의 "phone-reclaim" 챌린지)과 같은 기준이다:
 *   SMS는 불법 취득한 폰으로도 받을 수 있으므로, 지문(WebAuthn) 계정은 SMS 코드만으로는 부족하고
 *   그 계정을 등록한 물리적 기기의 지문 확인(step-up)도 통과해야 한다. step-up 토큰의 용도 문자열은 `phone-reclaim:<e164>`.
 * verifyStepUp(token, guid, txHash) → { ok, reason } — worker.js의 _verifyStepUpToken 을 감싸서 넘긴다.
 */
export async function verifyPhoneAndStepUp({ secret, token, guid, profile, ttlMs, freshMs, stepUpToken, verifyStepUp, now }) {
  const pv = await verifyFreshPhoneToken({ secret, token, guid, ttlMs, freshMs, ...(now ? { now } : {}) });
  if (!pv.ok) return pv;
  const creds = profile?.extra?.webauthn_credentials;
  if (Array.isArray(creds) && creds.length > 0) {
    const su = await verifyStepUp(stepUpToken, guid, `phone-reclaim:${pv.e164}`);
    if (!su || !su.ok) return { ok: false, status: 403, code: 'BIOMETRIC_REQUIRED', message: `이 기기에서 지문/Face ID 인증을 통과해야 합니다(${su?.reason || '확인 실패'}).` };
  }
  return { ok: true };
}
