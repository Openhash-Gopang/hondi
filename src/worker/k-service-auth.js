// ═══════════════════════════════════════════════════════════
// K-서비스 공용 인증 게이트 (2026-09-03 신설)
//
// 배경: K-Plan/K-Law/K-Gov/K-Business relay 4곳이 phone_verify_token→guid
// 해석 실패 시의 상태코드 매핑(PROFILE_NOT_FOUND→404, TOKEN_EXPIRED→401
// 등)을 각자 손으로 복붙해뒀고, K-Mail의 8개 엔드포인트(chat, 캠페인
// 생성, 주소록 6종)는 그 매핑조차 없이 지갑 서명(_verifyClaimsRequester)
// 만 지원해 K-Plan과 로그인 경험이 갈라져 있었다(mail.hondi.net/webapp.html
// 작업 지시서 §2에서 발견). 24개 K-서비스가 매번 이 인증 판정을
// 새로 구현하는 건 지속 불가능하므로, "어떻게 guid를 확정하는가"의
// 공통 판정 로직만 이 모듈로 뺐다(주피터 지시, 2026-09-03).
//
// 이 모듈에 넣지 않은 것: phone_verify_token 자체의 파싱·HMAC 서명
// 검증·L1 profiles 조회(_resolveGuidFromPhoneVerifyToken), 그리고 지갑
// Ed25519 서명 검증·TOFU pubkey 대조(_verifyClaimsRequester). 이 둘은
// PHONE_VERIFY_SECRET·L1_DEFAULT·_l1AdminToken 같은 worker.js 저수준
// 의존성을 갖고 있고, 이미 여러 프로덕션 경로가 실사 검증한 코드라
// 옮기다 깨뜨릴 위험이 있다 — 대신 makeKServiceAuthGate가 두 함수를
// "의존성 주입"으로 받는다. worker.js가 하나의 인스턴스(_kAuth)를
// 만들어 모든 K-서비스 핸들러가 공유한다.
//
// 사용법:
//   import { makeKServiceAuthGate } from './src/worker/k-service-auth.js';
//   const _kAuth = makeKServiceAuthGate({
//     resolveGuidFromPhoneVerifyToken: _resolveGuidFromPhoneVerifyToken,
//     verifyClaimsRequester: _verifyClaimsRequester,
//   });
//   // 엔드포인트 안(POST 등 JSON body 있는 경우):
//   const auth = await _kAuth.resolveGuid(env, body, { sigMsg: `kmail-chat:${body.guid}:${body.ts}` });
//   if (!auth.ok) return _err(auth.status, auth.code, auth.message, corsHeaders);
//   const guid = auth.guid;
//   // GET 등 쿼리스트링 기반 엔드포인트는 URLSearchParams를 plain
//   // object로 바꿔서(Object.fromEntries(url.searchParams)) 넘기면 됨.
//
// sigMsg는 서비스마다 형식이 다르므로(예: `kmail-chat:guid:ts` vs
// `kmail-contacts-merge:guid:keep:merge:ts`) 이 모듈이 강제로 만들 수
// 없다 — 호출부가 지갑 서명 경로를 지원하려면 반드시 넘겨야 한다.
// phone_verify_token 경로만 지원할 새 엔드포인트라면 sigMsg 없이도
// 동작한다(지갑 서명 필드가 body에 없으면 그 분기 자체를 안 탐).
// ═══════════════════════════════════════════════════════════

// phone_verify_token 해석 실패 코드 → HTTP 상태/응답 코드/메시지 매핑.
// handleKlawRelay·handleKPlanRelay·handleBusinessRelay·handleGovRelay에
// 동일 블록이 4번 복붙돼 있던 것을 여기 한 곳으로 모음.
export function mapPhoneAuthError(authResult) {
  const status = authResult.code === 'PROFILE_NOT_FOUND' ? 404
    : authResult.code === 'SECRET_NOT_SET' ? 500
    : authResult.code === 'L1_ERROR' ? 502
    : (authResult.code === 'MISSING_FIELD' || authResult.code === 'TOKEN_MALFORMED') ? 400
    : 401; // TOKEN_EXPIRED, TOKEN_INVALID
  const code = authResult.code === 'MISSING_FIELD' ? 'LOGIN_REQUIRED' : authResult.code;
  const message = authResult.code === 'MISSING_FIELD' ? '전화번호 로그인이 필요합니다.' : authResult.message;
  return { status, code, message };
}

export function makeKServiceAuthGate({ resolveGuidFromPhoneVerifyToken, verifyClaimsRequester }) {
  if (typeof resolveGuidFromPhoneVerifyToken !== 'function' || typeof verifyClaimsRequester !== 'function') {
    throw new Error('makeKServiceAuthGate: resolveGuidFromPhoneVerifyToken, verifyClaimsRequester 둘 다 함수여야 합니다');
  }

  // guid를 확정한다. 두 인증 방식을 지원:
  //  1) phone_verify_token — K-Plan 로그인(전화 OTP/device-link)과 동일
  //     경험. body에 이 필드가 있으면 우선 이 경로를 탄다.
  //  2) 지갑 서명(guid/pubkey/signature/ts) — 기존 클라이언트 하위호환.
  // 반환: { ok:true, guid, authMode } 또는
  //       { ok:false, status, code, message }
  async function resolveGuid(env, body, { sigMsg } = {}) {
    const b = body || {};

    if (b.phone_verify_token) {
      const resolved = await resolveGuidFromPhoneVerifyToken(env, b.phone_verify_token);
      if (!resolved.ok) return { ok: false, ...mapPhoneAuthError(resolved) };
      return { ok: true, guid: resolved.guid, authMode: 'phone' };
    }

    if (b.guid && b.pubkey && b.signature && b.ts) {
      if (!sigMsg) {
        // 호출부가 지갑 서명 지원을 잊고 sigMsg를 안 넘긴 경우 — 조용히
        // 통과시키지 않고 명확한 서버 오류로 드러낸다(잘못된 sigMsg로
        // 검증을 통과/실패시키는 것보다 안전).
        return { ok: false, status: 500, code: 'SIGMSG_MISSING', message: '서버 설정 오류: 지갑 서명 검증에 필요한 sigMsg가 지정되지 않았습니다' };
      }
      const authOk = await verifyClaimsRequester(env, { guid: b.guid, pubkey: b.pubkey, signature: b.signature, sigMsg, ts: b.ts });
      if (!authOk) return { ok: false, status: 403, code: 'AUTH_REQUIRED', message: '본인 서명 인증이 필요합니다' };
      return { ok: true, guid: b.guid, authMode: 'wallet' };
    }

    return { ok: false, status: 400, code: 'LOGIN_REQUIRED', message: '로그인이 필요합니다 (phone_verify_token 또는 지갑 서명 필드 중 하나 필수)' };
  }

  return { resolveGuid };
}
