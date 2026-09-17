# 혼디 통합 인증·과금 매뉴얼 (v1.0)

작성일: 2026-09-17
관련 커밋: `feat(worker): AI 서비스 인증을 디스패치 지점 공용 게이트 하나로 통합("현관문 하나")`
선행 문서: `docs/K_SERVICE_AUTH_MIGRATION_MANUAL_20260903.md` — **이 문서로 대체됨(§7 참고), 삭제하지 않고 히스토리로 보존**

## 0. 이 문서의 목적

"AI(LLM)를 이용하는 모든 서비스는 단 하나의 사용자 인증을 공유해야
한다"는 원칙(주피터 지시, 2026-09-17)이 실제로 어떻게 구현돼 있는지,
그리고 **새 AI 서비스를 하나 추가할 때 무엇을 반드시 해야 하는지**를
정리한 참조 문서다. §5의 체크리스트가 핵심 — 이걸 빠뜨려서 실제로
사고가 난 적이 있다(§1).

## 1. 배경 — 왜 이렇게 바뀌었나

2026-09-17 실사 중 다음이 확인됐다:

| 서비스 | 그 시점 상태 |
|---|---|
| klaw, kplan, kjit, kcity | 각자 자기 함수 안에서 개별적으로 `phone_verify_token` 검증(2026-09-02~03 도입). 완전히 동일한 코드가 4곳에 복붙돼 있었음 |
| gov | `phone_verify_token`이 있으면 검증하지만, 없으면 클라이언트가 보낸 `guid`를 그대로 신뢰하는 하위호환 폴백이 남아있었음 |
| **business** | 이 검증 자체가 **아예 없었음**. 게다가 클라이언트(`market` 저장소 `kmarket_admin_dashboard.html`)는 `crypto.randomUUID()`로 즉석에서 만든 무작위 guid를 씀 — 실제 신원과 전혀 무관 |
| business | `AI_PROXY_PATHS`(Origin 헤더 필수 검사 목록)에도 빠져 있어, klaw/kplan/gov/deepseek와 달리 Origin 헤더 없이 curl로 직접 호출해도 통과됐음(직접 재현 확인) |
| chat/completions, deepseek(메인 채팅) | 의도적으로 익명 허용 — guid 없이도 호출 가능, 무료 게이트만 건너뛰고 계속 진행 |

**서비스마다 문을 하나씩 다는 구조는, 하나를 빠뜨리면 그 즉시 구멍이
된다는 게 실제로 증명됐다** — business가 그 사례다. 그래서 "현관문
하나"로 바꿨다: 개별 함수가 아니라 **디스패치 지점(라우팅 분기 직전)
단 한 곳**에서 인증하고, 그 뒤 모든 핸들러는 이미 검증된 guid를
받기만 한다.

## 2. 지금 구조 — "현관문 하나"

`worker.js`의 요청 디스패치 지점(`const bodyText = await request.text();`
직후, 개별 라우트 분기 이전)에 공용 게이트가 있다:

```js
const MANDATORY_AUTH_PATHS = ['/klaw/relay', '/kplan/relay', '/kjit/relay',
  '/kcity/relay', '/gov/relay', '/chat/completions', '/deepseek'];
if (MANDATORY_AUTH_PATHS.some(p => pathname === p || pathname.startsWith(p))) {
  let _gateBody;
  try { _gateBody = JSON.parse(bodyText); } catch {
    return _err(400, 'INVALID_JSON', '', corsHeaders);
  }
  const _authResult = await _resolveGuidFromPhoneVerifyToken(env, _gateBody?.phone_verify_token);
  if (!_authResult.ok) {
    const { status, code, message } = mapPhoneAuthError(_authResult);
    return _err(status, code, message, corsHeaders);
  }
  bodyText = JSON.stringify({ ..._gateBody, guid: _authResult.guid, phone_verify_token: undefined });
}
```

동작 방식:
1. `phone_verify_token`(SMS 인증 완료 증명, `/biz/phone-otp-verify` 발급, HMAC 서명 + 만료시간 내장)을 `_resolveGuidFromPhoneVerifyToken(env, token)`으로 검증
2. 실패하면 그 자리에서 401/400계열 에러 반환 — 개별 핸들러까지 도달하지 않음
3. 성공하면 **클라이언트가 보낸 guid/phone_verify_token은 버리고**, 토큰에서 도출한 검증된 guid로 body를 다시 만들어 넘김
4. 이후 개별 핸들러(`handleKlawRelay`, `handleKPlanRelay`, `_handleKjitKcityRelay`, `handleGovRelay`, `callDeepSeek`)는 `body.guid`를 그대로 신뢰 — 재검증 없음

각 핸들러 안에 있던 개별 `phone_verify_token` 검증 블록은 전부
제거했다(주석으로 "이제 디스패치 게이트가 처리함"만 남김).

## 3. 과금 모델

- **접속·가입 자체는 무료.** 과금은 AI(LLM) 실사용량에만 비례한다.
- **가입 시 무료 GDC 지급**으로 체험 기회 제공. `SIGNUP_BONUS_KRW = 100`
  (100원 상당, 1:1 환율 기준 — 테스트 기간 한정), `_grantSignupBonus()`가
  `handleRegisterKey`에서 호출됨. KV(`hondi:signup_bonus_granted:{guid}`)
  플래그로 평생 1회만 지급(멱등).
- 무료 한도 소진 후에는 GDC 잔액에서 실사용량만큼 차감
  (`_gdcFreeQuotaGate` → `_l1GetBalanceKRW` → 부족하면 402
  `GDC_INSUFFICIENT_BALANCE`).
- **"AI를 언제, 얼마나 호출했는지"를 항상 정확히 추적해야 하는 이유가
  여기 있다** — 과금의 유일한 근거가 실사용량이므로, 사용량 추적이
  곧 과금 시스템의 정확성이다. §4가 그 추적 메커니즘이다.

## 4. 사용량 추적 — diagCtx / AI_EMPTY_COMPLETION_DIAG

`_parseUsageFromStream(stream, diagCtx)`가 실제 LLM 스트림에서
usage(토큰 수 등)를 파싱한다. `diagCtx = { env, meta: { tier, model,
guid, ...meta } }`를 넘기면, 응답이 비정상(빈 completion 등)일 때
`AI_EMPTY_COMPLETION_DIAG` 태그로 진단 로그를 남긴다(`env.LOG_LEVEL
=== 'debug'`일 때만 실제로 찍힘 — Cloudflare 대시보드 Variables에서
설정).

2026-09-17 기준 diagCtx 배선 현황(전수 확인):

| 호출부 | 배선 여부 |
|---|---|
| `callDeepSeek`(메인 채팅) | ✅ |
| `handleKlawRelay` | ✅ (2026-09-17 추가) |
| `handleKPlanRelay` | ✅ (2026-09-17 추가) |
| `handleBusinessRelay` | ✅ (2026-09-17 추가) |
| `handleGovRelay` | ✅ (2026-09-17 추가) |

요청 단위 로그(diagCtx와 별개, 항상 남는 건 아니고 `_dlog`도
`LOG_LEVEL=debug` 게이트를 탐): `KLAW_RELAY_CALL`, `KPLAN_RELAY_CALL`,
`BUSINESS_RELAY_CALL`, `GOV_RELAY_CALL`.

## 5. 새 AI 서비스를 추가할 때 — 체크리스트

business가 빠뜨렸던 실수를 반복하지 않기 위한 체크리스트:

1. [ ] 프런트엔드가 로그인 상태에서 `phone_verify_token`을 body에
   실어 보내는가? (없으면 2번으로 못 감 — 먼저 `k-service-auth-client.js`
   연동부터)
2. [ ] 새 relay 경로 이름을 `MANDATORY_AUTH_PATHS`(worker.js, 디스패치
   지점)에 추가했는가?
3. [ ] 같은 경로를 `AI_PROXY_PATHS`(Origin 헤더 필수 검사 목록)에도
   추가했는가? — 이 둘은 별개 목록이라 하나만 넣으면 안 됨
4. [ ] 핸들러 함수 안에서 `body.guid`를 그대로 신뢰하고 있는가?
   (자체적으로 `phone_verify_token`을 다시 검증하는 코드를 새로
   작성하지 말 것 — 게이트와 중복)
5. [ ] `_parseUsageFromStream(forUsage, { env, meta: { tier, model,
   guid, ...meta } })` 형태로 diagCtx를 배선했는가?
6. [ ] 위 5가지를 라이브 스모크테스트로 실제 확인했는가? (§6)

## 6. 라이브 검증 방법

- **배선 검증(브라우저 필요)**: Playwright로 실제 페이지에서
  `window.open`/리다이렉트까지 확인 — EXPERT/GWP 태그 배선 검증에
  쓴 방식(`0012_...popup...cjs` 계열, 이 문서와 별도 보관)
- **인증·과금 게이트 검증(브라우저 불필요, 권장)**: 저장소 관행대로
  `requests`/`fetch`로 relay 엔드포인트를 직접 HTTP POST —
  `tests/live_smoketest/klaw_billing_live_smoketest.py` 참고 패턴.
  `Origin` 헤더를 서비스 도메인에 맞게, `phone_verify_token`은 실제
  로그인해서 얻은 값(devtools Network 탭) 사용.
- **diagCtx 로그 확인**: `npx wrangler tail hondi-proxy` 실행 후 위
  방법으로 요청을 보내고 `AI_EMPTY_COMPLETION_DIAG` 등장 여부 확인.
  이 로그는 `LOG_LEVEL=debug`가 켜져 있어야 보임(Cloudflare 대시보드
  Workers & Pages → 해당 Worker → Settings → Variables and Secrets) —
  확인 끝나면 다시 꺼둘 것(상시 debug 로그는 비용·노이즈 증가).
- 마지막 단계로 **실제 폰·PC에서 수동 검증**(로그인 → 실제 발화 →
  응답 확인) — 자동화가 대체할 수 없는 단계.

## 7. 아직 안 된 것 (열린 항목)

- **business/relay는 아직 게이트 밖.** `market` 저장소
  (`kmarket_admin_dashboard.html`)에 `k-service-auth-client.js` +
  전화번호 인증 UI를 이식해야 한다 — `regional-gov.html`이 이미
  검증된 참고 패턴. 프런트 배포 확인 후 `MANDATORY_AUTH_PATHS`에
  `/business/relay` 추가.
- **`/ai/chat`, `/gemini/`, `/llm/relay`는 이번 통합 범위 밖.**
  인증 모델을 아직 확인 안 함 — 별도 조사 필요.
- **`callDeepSeek`은 `callOpenAIFromGeminiBody`의 실패 폴백으로 guid
  없이 내부 호출되는 경로가 있다**(정상 설계 — `/gemini/`가 게이트
  대상이 아니므로). 이 함수 내부에 하드 블록을 넣지 않은 이유가
  이것이다.
- desktop.html에 "방문자 데모 위젯"류의 비로그인 호출이 실제로
  남아있었는지는 배포 후 미확인 — 확인되면 이 섹션에 결과 추가.

## 부록. 예전 문서와의 관계

`K_SERVICE_AUTH_MIGRATION_MANUAL_20260903.md`는 "K-Mail 8개 엔드포인트
+ K-Law/K-Plan relay를 공용 게이트로 전환한 작업 매뉴얼"이자 당시
스캔 결과(지갑 서명 전용 27곳 등)를 담은 **그 시점의 기록**이다.
삭제하지 않았다 — 다만 그 문서의 "모델 A/B/C 판별법"과 개별 함수
내부 검증 패턴은 이 문서(v1.0)의 §2 구조로 대체됐다. 그 문서
맨 위에 이 사실을 알리는 갱신 주석을 추가했다(별도 커밋).
