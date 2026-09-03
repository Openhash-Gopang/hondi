# K-서비스 공용 인증 게이트 — 마이그레이션 매뉴얼

작성일: 2026-09-03
관련 모듈: `src/worker/k-service-auth.js` (2026-09-03 신설)
선행 작업: mail.hondi.net/webapp.html 작업 중 K-Mail 8개 엔드포인트 +
K-Law/K-Plan relay 3곳을 이 방식으로 이미 전환함(§5 완료 현황 참고).

## 0. 이 문서의 목적

"24개(실측 결과 그 이상) K-서비스 각각이 별도 인증 모듈을 갖는 것은
불합리하다"는 지시에 따라, K-Mail에 적용했던 전환 방식을 **누구나 다음
서비스에 그대로 반복 적용할 수 있도록** 절차·판별법·before/after
예시·체크리스트로 정리한다. 이 문서는 "전체 완료 보고서"가 아니라
**반복 가능한 작업 매뉴얼**이다 — §6에 오늘 스캔으로 확인한 미전환
후보 목록을 남겨두었으니, 다음 세션이 이 문서만 보고 이어서 처리할 수
있다.

## 1. 배경 — 왜 이 작업이 필요한가

`worker.js`를 스캔한 결과(2026-09-03), `_verifyClaimsRequester`(지갑
Ed25519 서명 검증)를 직접 호출하는 엔드포인트가 **36곳** 있었다. 이 중
9곳(K-Mail 8 + 캠페인 생성 — 정확히는 K-Mail 관련 8개 함수)은 이번
작업에서 공용 게이트로 전환했지만, **27곳이 여전히 지갑 서명 전용**이다.
지갑 서명 전용 엔드포인트는 K-Plan/K-Law처럼 phone_verify_token(전화
OTP·device-link) 로그인을 쓰는 서비스와 로그인 경험이 갈라진다 —
사용자가 한 서비스에서 로그인해도 다른 서비스에서 다시 지갑 서명을
요구받는 구조다.

## 2. 세 가지 인증 모델 — 먼저 어떤 유형인지 판별한다

전환 작업을 시작하기 전에, 대상 엔드포인트가 아래 셋 중 어디에
해당하는지부터 확인한다. **모델이 다르면 전환 방법도 다르다.**

### 모델 A — 지갑 서명 전용 (가장 흔함, 27곳)
특징: 함수 안에 아래 3줄이 그대로 있다.
```js
const sigMsg = `<서비스>-<동작>:${guid}:${ts}`;  // 또는 더 많은 필드 조합
const authOk = await _verifyClaimsRequester(env, { guid, pubkey, signature, sigMsg, ts });
if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);
```
판별 명령:
```bash
grep -n "_verifyClaimsRequester(env," worker.js
```
→ §3-A 레시피 적용.

### 모델 B — phone_verify_token 전용, 오류 매핑 블록이 복붙됨
특징: `_resolveGuidFromPhoneVerifyToken` 호출 뒤 `PROFILE_NOT_FOUND ? 404`
같은 5~8줄짜리 상태코드 매핑 블록이 함수 안에 그대로 있다(klaw/kplan
relay와 handleKlawQuota에 있던 것 — 이미 전환 완료).
판별 명령:
```bash
grep -n "PROFILE_NOT_FOUND' ? 404" worker.js
```
→ 이미 0건(오늘 전부 정리함). 새로 추가되는 phone_verify_token 전용
엔드포인트가 이 패턴으로 작성되면 곧바로 §3-B 레시피를 적용한다.

### 모델 C — access_cert(조직 인증서) 기반 — 별도 취급
`handleBusinessRelay`, `handleGovRelay`는 `guid`를 클라이언트가 그대로
보내고, `business_id`/`agency`가 실제로 그 조직 소유인지를
`_verifyAccessCert`(조직 인증서 서명)로 검증한다. 이건 "개인 로그인"이
아니라 "이 사람이 이 조직을 대표할 권한이 있는가"를 묻는 완전히 다른
질문이라, `_kAuth.resolveGuid`(개인 guid 확정용)로 대체할 수 **없다**.
이 모델을 손대려면 별도 설계가 필요하다 — 이번 매뉴얼 범위 밖.

## 3. 전환 레시피

### 3-A. 모델 A(지갑 서명 전용) → 공용 게이트로 확장

**Before** (`handleKmailRuleCreate`, 전환 전 실제 코드 — 예시용으로 남김):
```js
async function handleKmailRuleCreate(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON 파싱 실패', corsHeaders);
  const { guid, pubkey, signature, ts, rule_text } = body;
  if (!guid || !pubkey || !signature || !ts) {
    return _err(400, 'MISSING_FIELD', 'guid, pubkey, signature, ts 필수', corsHeaders);
  }
  const trimmed = (rule_text || '').trim();
  if (!trimmed) return _err(400, 'MISSING_FIELD', 'rule_text 필수', corsHeaders);

  const sigMsg = `kmail-rule-create:${guid}:${ts}`;
  const authOk = await _verifyClaimsRequester(env, { guid, pubkey, signature, sigMsg, ts });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  // ... guid를 써서 실제 로직 ...
}
```

**After:**
```js
async function handleKmailRuleCreate(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON 파싱 실패', corsHeaders);
  const { rule_text } = body;
  const trimmed = (rule_text || '').trim();
  if (!trimmed) return _err(400, 'MISSING_FIELD', 'rule_text 필수', corsHeaders);

  // phone_verify_token(K-Plan과 동일 로그인) 또는 기존 지갑 서명 —
  // 공용 게이트로 위임(src/worker/k-service-auth.js)
  const auth = await _kAuth.resolveGuid(env, body, { sigMsg: `kmail-rule-create:${body.guid}:${body.ts}` });
  if (!auth.ok) return _err(auth.status, auth.code, auth.message, corsHeaders);
  const guid = auth.guid;

  // ... guid를 써서 실제 로직(변경 없음) ...
}
```

기계적으로 반복되는 변경 4가지:
1. 구조분해에서 `guid, pubkey, signature, ts`를 빼고 실제 필요한 필드만 남긴다(guid는 auth.guid로 나중에 얻으므로).
2. `if (!guid || !pubkey || !signature || !ts) return _err(400, 'MISSING_FIELD', ...)` 줄을 삭제한다 — 게이트가 이 판정을 대신한다.
3. `sigMsg` 계산 + `_verifyClaimsRequester` 호출 + 수동 `_err(403,...)` 3줄을 `_kAuth.resolveGuid(env, body, { sigMsg: ... })` 호출 + `if (!auth.ok) return _err(auth.status, auth.code, auth.message, corsHeaders)`로 바꾼다.
4. **sigMsg 문자열은 원래 쓰던 것을 절대 바꾸지 않는다** — 기존 지갑 서명 클라이언트가 서명할 때 쓴 문자열 포맷과 정확히 같아야 검증이 통과한다. `body.guid`/`body.ts`처럼 body에서 직접 읽어와도 되고, 위에서 구조분해한 원래 변수명을 유지해도 된다(다만 그 경우 `guid`라는 이름을 auth 결과와 겹치지 않게 조심).

**GET 엔드포인트(쿼리스트링 기반)는 body 대신 `Object.fromEntries(url.searchParams.entries())`를 넘긴다** — `handleKmailContactsList`/`handleKmailCampaignsList` 참고.

**여러 필드로 sigMsg를 만드는 엔드포인트**(예: `kmail-contacts-merge:${guid}:${keep_id}:${merge_id}:${ts}`)는 그 필드들을 먼저 구조분해한 뒤 sigMsg 템플릿 문자열에 조립하면 된다 — `handleKmailContactsMerge`, `handleKmailContactsDecide` 참고(worker.js).

### 3-B. 모델 B(오류 매핑 블록 복붙) → `mapPhoneAuthError` 호출로 축약

**Before:**
```js
const resolved = await _resolveGuidFromPhoneVerifyToken(env, phone_verify_token);
if (!resolved.ok) {
  const status = resolved.code === 'PROFILE_NOT_FOUND' ? 404
    : resolved.code === 'SECRET_NOT_SET' ? 500
    : resolved.code === 'L1_ERROR' ? 502
    : (resolved.code === 'MISSING_FIELD' || resolved.code === 'TOKEN_MALFORMED') ? 400
    : 401;
  const code = resolved.code === 'MISSING_FIELD' ? 'LOGIN_REQUIRED' : resolved.code;
  const message = resolved.code === 'MISSING_FIELD' ? '전화번호 로그인이 필요합니다.' : resolved.message;
  return _err(status, code, message, corsHeaders);
}
```
**After:**
```js
const resolved = await _resolveGuidFromPhoneVerifyToken(env, phone_verify_token);
if (!resolved.ok) {
  const { status, code, message } = mapPhoneAuthError(resolved);
  return _err(status, code, message, corsHeaders);
}
```
이 모델은 원래 지갑 서명을 지원할 필요가 없는(예: 과금/사용량 조회처럼
반드시 전화 인증만 받아야 하는) 엔드포인트에 쓴다 — 지갑 서명도 같이
지원해야 한다면 애초에 모델 A 레시피(`_kAuth.resolveGuid`)를 쓴다.

## 4. 적용 후 검증 체크리스트

- [ ] `node --input-type=module --check < worker.js` (또는 Windows에서는
      Git Bash) 로 문법 오류 없음을 확인했는가
- [ ] sigMsg 문자열을 원본 그대로 유지했는가(포맷을 바꾸면 기존 지갑
      서명 클라이언트가 전부 깨진다)
- [ ] GET 엔드포인트는 `url.searchParams`를 plain object로 바꿔서
      넘겼는가(POST의 `body`와 혼동하지 않았는가)
- [ ] 변경한 함수가 이제 `guid`를 두 번 선언하고 있지 않은가(원래
      구조분해에 남아있던 `guid`를 지웠는지 확인)
- [ ] 이 엔드포인트를 부르는 프런트엔드가 있다면, phone_verify_token을
      보내도록 프런트도 같이 바꿀지(§5 "완료" 기준) 아니면 지갑 서명
      클라이언트를 위한 하위호환만 유지할지 결정했는가 — 백엔드
      전환만으로는 사용자 로그인 경험이 안 바뀐다(프런트가 여전히
      지갑 서명만 보내면 계속 그 경로로 인증됨)

## 5. 완료 현황 (2026-09-03 기준)

| 서비스 | 엔드포인트 수 | 방식 |
|---|---|---|
| K-Mail | 8 (chat, campaigns/create, contacts propose/list/decide/update/tag/merge) | 모델 A → 공용 게이트 |
| K-Mail | +1 (campaigns/list, 이번에 신설) | 처음부터 공용 게이트로 작성 |
| K-Law | relay 1곳 | 모델 B → mapPhoneAuthError |
| K-Plan | relay 1곳 | 모델 B → mapPhoneAuthError |
| (조회 전용) | handleKlawQuota 1곳 | 모델 B → mapPhoneAuthError |

## 6. 미전환 후보 (오늘 스캔 결과 — 다음 작업 대상)

`grep -c "_verifyClaimsRequester(env," worker.js` = 36건 중 9건 전환 완료,
**27건 미전환**. 함수명 기준 그룹:

**K-Mail(같은 서비스인데 아직 8곳 빠짐 — 우선순위 최상, 웹앱과 바로
연결되는 기능들):**
- handleKmailRuleCreate / handleKmailRuleList / handleKmailRuleToggle
- handleKmailSettingsGet / handleKmailSettingsSet
- handleKmailStats
- handleKmailThreadStateSet / handleKmailMessageStateSet
- handleKmailMailboxList
- handleKmailDraftsList / handleKmailDraftSave / handleKmailDraftDelete
- handleKmailBlocklistList / handleKmailBlocklistAdd / handleKmailBlocklistRemove
- handleKmailAttachmentUpload / handleKmailAttachmentGet
- handleUserMailSend (K-Mail 발신 자체 — `/mail/send`)

**K-서비스 여부 확인 필요(플랫폼 공통 기능일 수 있음 — 전환 전에 이게
"K-서비스"로 부를 대상인지부터 판단할 것):**
- Trade 관련: handleTradeDisputeResolve, handleTradeDisputeSubmit, handleTradeDisputeQueue, handleTradeRatingSubmit
- PDV 관련: handlePdvMyRecords
- GDC DAO: handleGdcDaoVote, handleGdcDaoProposalCreate, handleGdcDepositClose
- 보험(K-Ins 추정): handleInsClaimsList, handleInsClaimCreate
- 기타: handleVerifyAdmin, handleTxHistory, handleSettleLedger, handleRegisterKey, handleFinancialsGet, handleClaimsList, handleClaimsAck

**이 매뉴얼로 재스캔하는 명령(다음 세션이 그대로 실행하면 최신 상태를
얻는다):**
```bash
grep -c "_verifyClaimsRequester(env," worker.js   # 전체 지갑서명-전용 호출 수
grep -c "_kAuth.resolveGuid" worker.js            # 전환 완료 수
awk '/^async function handle[A-Za-z]+\(/{fn=$0} /_verifyClaimsRequester\(env,/{print fn}' worker.js \
  | sed 's/async function //' | sort -u           # 미전환 함수 목록
```

## 7. K-Gov / K-Business(모델 C)를 언젠가 통합하려면

지금 당장 할 일은 아니지만, 참고로 남긴다. access_cert 기반 조직
인증도 결국 "이 요청을 이 guid/조직이 대신 수행할 권한이 있는가"라는
같은 질문의 변형이다. 나중에 필요해지면 `k-service-auth.js`에
`makeOrgAuthGate({ verifyAccessCert, ... })` 같은 두 번째 팩토리를
추가하는 방향을 검토할 수 있다 — 다만 access_cert 검증은
`_verifyEd25519Simple`·`_l1FindProfileByGuid`까지 추가로 의존하고
있어(§2 모델 C 설명 참고), 이번 개인 로그인 게이트보다 의존성이 많다.
이번 세션에서는 설계만 남기고 구현하지 않았다.
