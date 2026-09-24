// ═════════════════════════════════════════════════
// 문자(SMS) 인증 토큰 검증 — 숫자 번호 등록용 (2026-09-25, 주피터 지시: "본인 인증은 SMS")
//
// 토큰은 기존 /biz/phone-otp-verify 가 발급하는 guid 바인딩 3필드 형식 그대로다:
//     "<e164>:<guid>:<exp>.<hmacSha256Hex(PHONE_VERIFY_SECRET, '<e164>:<guid>:<exp>')>"
// 이 토큰의 유효기간은 30일(로그인 유지용)이라, 그대로 받으면 한 달 전에 인증한 토큰으로도 번호를 등록할 수 있다.
// 그래서 여기서는 **방금(기본 10분 이내) 문자 인증한 토큰만** 허용한다(발급 시각 = exp − ttlMs).
//
// 검사 순서: 형식 → guid 바인딩(등록하려는 계정과 같은 guid) → 서명 → 만료 → 신선도 → 토큰 전화번호 = 계정 전화번호
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

export async function verifyFreshPhoneToken({ secret, token, guid, accountPhone, ttlMs, freshMs = 10 * 60 * 1000, now = Date.now() }) {
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
  const tokenGuid = first === last ? null : payload.slice(first + 1, last);   // guid에 ':'가 있어도 안전(양 끝 콜론으로 자름)
  if (!e164 || !Number.isFinite(exp)) return bad(400, 'PHONE_TOKEN_MALFORMED', '문자 인증 토큰 형식이 올바르지 않습니다.');
  if (!tokenGuid) return bad(400, 'PHONE_TOKEN_NOT_BOUND', '계정에 묶이지 않은 인증 토큰입니다. 문자 인증을 다시 진행해 주세요.');
  if (tokenGuid !== guid) return bad(403, 'PHONE_TOKEN_GUID_MISMATCH', '다른 계정용으로 발급된 인증 토큰입니다.');
  if (!timingSafeEqualHex(await hmacHex(secret, payload), sig)) return bad(401, 'PHONE_TOKEN_INVALID', '문자 인증 토큰 서명이 유효하지 않습니다.');
  if (now > exp) return bad(401, 'PHONE_TOKEN_EXPIRED', '문자 인증이 만료되었습니다. 다시 인증해 주세요.');
  if (!(ttlMs > 0)) return bad(500, 'TTL_NOT_SET', '토큰 유효기간 설정이 없습니다.');
  const issuedAt = exp - ttlMs;
  if (now - issuedAt > freshMs) return bad(401, 'PHONE_TOKEN_STALE', '방금 진행한 문자 인증만 사용할 수 있습니다. 문자 인증을 다시 진행해 주세요.');
  const acct = String(accountPhone || '').replace(/\D/g, '');
  const tok = e164.replace(/^\+82/, '').replace(/\D/g, '');
  if (!acct || acct !== tok) return bad(403, 'PHONE_MISMATCH', '인증한 전화번호가 이 계정에 등록된 번호와 다릅니다.');
  return { ok: true };
}

/**
 * 문자 토큰 + (지문을 쓰는 계정이면) 지문 step-up 토큰까지 확인한다.
 * 기존 규칙(/biz/phone-otp-request 의 "phone-reclaim" 챌린지)과 같은 기준이다:
 *   SMS는 불법 취득한 폰으로도 받을 수 있으므로, 지문(WebAuthn) 계정은 SMS 코드만으로는 부족하고
 *   그 계정을 등록한 물리적 기기의 지문 확인(step-up)도 통과해야 한다. step-up 토큰의 용도 문자열은 `phone-reclaim:<e164>`.
 * verifyStepUp(token, guid, txHash) → { ok, reason } — worker.js의 _verifyStepUpToken 을 감싸서 넘긴다.
 */
export async function verifyPhoneAndStepUp({ secret, token, guid, profile, ttlMs, freshMs, stepUpToken, verifyStepUp, now }) {
  const pv = await verifyFreshPhoneToken({ secret, token, guid, accountPhone: profile?.phone, ttlMs, freshMs, ...(now ? { now } : {}) });
  if (!pv.ok) return pv;
  const creds = profile?.extra?.webauthn_credentials;
  if (Array.isArray(creds) && creds.length > 0) {
    const t = String(token);
    const e164 = t.slice(0, t.indexOf(':'));
    const su = await verifyStepUp(stepUpToken, guid, `phone-reclaim:${e164}`);
    if (!su || !su.ok) return { ok: false, status: 403, code: 'BIOMETRIC_REQUIRED', message: `이 기기에서 지문/Face ID 인증을 통과해야 합니다(${su?.reason || '확인 실패'}).` };
  }
  return { ok: true };
}
