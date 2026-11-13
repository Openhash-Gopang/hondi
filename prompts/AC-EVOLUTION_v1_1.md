```
# AC-EVOLUTION
# ═══════════════════════════════════════════════════
# 문서명    : AC-Evolution — 업무 도메인 기반 AC 자율 진화 아키텍처
# 문서 코드  : AC-EVOLUTION
# 버전      : v1.1 (v1.0 대체)
# 근거      : 주피터님 지시(2026-07-13, 2차) — (1) PDV를 일상/업무
#             영역으로 완전 분할하고 업무 영역은 명시적으로 권한을
#             부여받은 사람·기관·에이전트만 제출을 요청할 수 있게
#             규정, (2) AC-EVOLUTION-GAPS의 patch 가능 항목 반영,
#             (3) 범위를 공무원·민간기업뿐 아니라 모든 직종(학생·
#             은퇴자 포함)으로 확대 — "AC는 모든 사용자의 업무를
#             보조해야 하며 예외는 없다".
# 관계      : AC-AUTHOR_v1_0.md의 후속. AC-EVOLUTION_v1_0.md를 대체
#             (§1 L2 모델이 "공무원·조직 소속자"로 좁게 서술됐던 것을
#             전 직종으로 일반화, PDV 분할 §신설).
# v1.1 변경 요약 (전부 AC-EVOLUTION-GAPS_v1_0.md 대상 항목):
#   - #19 patch: L2를 "소속기관 결합"에서 "업무 도메인"으로 일반화 —
#     소속 유무와 무관하게 전 직종 적용(§1-A).
#   - #5 patch: affiliation을 배열로 변경(겸직 지원).
#   - #4 patch: affiliation에 review_due 신설, 승인 전용 엔드포인트
#     (approveAffiliationCore)가 verified=true와 함께 채움.
#   - #7 patch: G6(응급 우선순위)이 업무모드에서도 예외 없이 상속됨을
#     AGENT-COMMON v3.58에 명시.
#   - #12 patch: PDV를 domain(personal/work)으로 완전 분할, 업무영역은
#     검증된 소속만 조회 요청 가능(§PDV-SPLIT, 신설).
#   - #2, #18: 이번 patch 대상 아님(전자는 §3 3안 채택으로 우회,
#     후자는 외부 협의 필요 — 여전히 열린 질문).
# 작성일     : 2026-07-13
# 작성자     : AI City Inc. · 주피터 (Claude 초안)
# ═══════════════════════════════════════════════════
```

## 0. AC-EVOLUTION_v1_0.md에서 달라진 것 — 핵심 관점 전환

v1.0은 "제주시청 위생과 직원"이라는 구체 사례에 이끌려 L2를 사실상
공무원 전용으로 좁혀 설계했다("소속기관 결합 레이어 — 공무원·조직
소속자 전용"). **이건 원 지시("직업마다 AC가 진화해야 한다")보다
좁은 범위였다** — AC-EVOLUTION-GAPS #19가 정확히 이 지점을 지적했다.

v1.1은 **"업무 도메인"**을 모든 `entity_type='person'`의 기본 속성으로
끌어올린다. 소속기관이 있고 없고는 업무 도메인이 존재하는지 여부가
아니라, 그 업무 도메인에 **L2(소속 결합) 레이어가 추가로 붙는지 여부**
만 가른다.

## 1. 업무 도메인 — 전 직종 일반화 모델

```
extra.public.identity.work_domain: {
  status: "employed_public" | "employed_private" | "self_employed" |
          "student" | "retired" | "homemaker" | "unemployed" | "other",
  active: true | false,   // 신규 데이터 적재 여부 — 은퇴자는 false
  status_since: "date"
}
```

**KSCO(job_ksco)만으로는 이걸 표현할 수 없다는 걸 이번에 확인했다** —
KSCO 총설 자체가 "직업"을 계속성·경제성 있는 경제활동으로 정의하므로,
학생·은퇴자·전업주부는 애초에 KSCO 분류 대상이 아니다(KSCO는 "직업"을
분류하지, "사람이 시간을 쓰는 일"을 분류하지 않는다). 그래서
`work_domain.status`를 `job_ksco`와 별개의 상위 개념으로 신설한다 —
`job_ksco`는 `status`가 `employed_*`/`self_employed`일 때만 채워지는
하위 필드다.

### 예시로 정리 (원 지시 그대로)

- **학생**: `status: "student"`, `job_ksco: null`. "업무"는 학습이다 —
  L1은 KSCO 대신 재학 중인 학교·과정 정보를 참조하는 별도 경량 레이어로
  대체한다(구체 설계는 §7 열린 질문, 이번 patch 범위 밖).
- **은퇴자**: `status: "retired"`, `active: false`. **새 데이터는
  안 쌓이지만 과거 업무 도메인 PDV 기록은 그대로 남는다** — `active`가
  `false`로 바뀌는 순간부터 신규 work-domain PDV 적재를 멈추지만
  (§PDV-SPLIT), 과거 기록은 삭제하지 않는다. 접근권은 §PDV-SPLIT의
  일반 규칙을 그대로 따른다 — 퇴직하면 옛 소속기관의 실시간 조회 권한
  (affiliation.verified)도 함께 철회 대상이 되므로(AC-EVOLUTION-GAPS #4),
  과거 기록은 사실상 본인만 접근하는 개인 아카이브가 된다.
- **프리랜서/1인 자영업자**: `status: "self_employed"`, `job_ksco` 있음,
  `affiliation` 없음(소속기관이 없으므로 L2 미적용, L1만 적용).
- **공무원/회사원**: `status: "employed_public"` 또는
  `"employed_private"`, `job_ksco` + `affiliation` 둘 다 있음(L1+L2).

## 2. 소속(affiliation) — 겸직 지원, 배열로 일반화

```
extra.public.identity.affiliation: [
  {
    org_type: "city-dept" | "do-dept" | "do-agency" | "org" | "national",
    org_id:   "city-dept:jeju:health",  // 민간기업은 "org:{bizKey}" 형태로 통일
                                          // (handleBusinessRelay의 DEPT_TASK_
                                          // REQUEST가 이미 이 형식을 쓴다 —
                                          // 새 포맷을 만들지 않고 재사용)
    role:     "staff" | "manager",
    active:   true,
    verified:      false,   // 자기 신고만으로는 절대 true가 안 됨(서버 강제)
    verified_at:   null,
    verified_by:   null,
    review_due:    null     // verified=true 전환 시 +30일로 자동 설정
  }
]
```
배열이라 겸직(AC-EVOLUTION-GAPS #5) 표현 가능. 최대 5개로 제한(worker.js
`handleProfilePost`).

## 3. 소속 검증 — 3안(관리자 사후 승인) 채택, 코드 반영 완료

**제 의견**: 3안을 채택했습니다. 1안(초대코드)은 코드 자체가 공유
가능한 비밀번호라 근본 결함이 있고(#2), 2안(내부 SSO 연동)은 가장
안전하지만 기관 시스템 협조가 선행돼야 해 지금 범위를 넘어섭니다.
3안은 기존 `dept_tasks`/`authoritativeAgency` 세션 신뢰모델을 그대로
재사용할 수 있어 신규 인프라가 최소입니다.

**구현 완료**:
- `handleProfilePost`(worker.js) — `affiliation` 배열을 받되,
  `verified`는 클라이언트가 뭘 보내든 무조건 이전 값을 유지(기본
  `false`)한다. 자기 신고만으로 권한이 생기지 않는다.
- `approveAffiliationCore`(worker.js, 신설) — `[AFFILIATION_APPROVE:
  org_id=..., target_guid=...]` 태그를 `handleGovRelay`/
  `handleBusinessRelay`가 서버 안에서 직접 감지해 호출한다.
  `createDeptTaskCore`와 정확히 같은 `_authoritativeCheck` 신뢰모델을
  재사용 — 순수 HTTP POST로는 절대 승인자를 자칭할 수 없다. 승인되면
  `verified:true`, `verified_at`, `review_due`(+30일)를 채운다.
  민간기업(org:{bizKey})도 `_validateTarget`의 business 분기와 동일한
  방식(L1 실존 + claimed 여부)으로 지원 — 07-org 고정 27개 목록에
  없어도 통과한다(§1의 전 직종 확대 반영).
- **#18(최초 관리자 임명)은 시스템이 아니라 법령이 해법이다** (주피터님
  지시로 정리) — "제주도민이 도지사를 선출하면, 도지사가 도청 소속
  공무원들의 직책을 결정할 권한을 갖고, 그 공무원들은 공무원 임용에
  관한 법률에 의해 특정 직책을 할당받을 자격을 부여받는다." 즉
  `authoritativeAgency` 세션에 누가 들어와 있다는 사실 자체가 이미
  이 시스템 밖의 법적·행정적 인사 절차(선출→임명→임용)로 보증된
  것이라고 보면 된다 — 이 저장소가 그 인사 절차를 재검증할 필요도
  없고 방법도 없다. **결론: #18은 결함이 아니라 적절한 관심사
  분리다** — 시스템의 책임은 "그 세션 인증을 정확히 신뢰하는 것"까지고,
  "그 세션에 누가 들어올 자격이 있는지"는 국가/기관의 인사 시스템이
  이미 답을 갖고 있는 질문이다. 다만 실제로 그 세션 로그인 배선
  (공무원 인증서·내부망 SSO 등)이 이 저장소 밖에서 완성돼야 이 전제가
  성립한다는 점은 여전히 남는다.

## 4. STAFF-AUTHORITY-GATE (SG1~SG4) — v1.0과 동일, G6 상속만 명시 보강

v1.0의 SG1~SG4는 그대로 유효하다. 이번에 AGENT-COMMON v3.58에 "업무
모드(PDV_DOMAIN_SET mode=work)에서도 G6(응급 우선순위)이 예외 없이
최우선"이라는 문장을 명시적으로 추가했다(AC-EVOLUTION-GAPS #7) — 업무
처리 중이라는 이유로 응급 신호 대응이 늦어지는 일은 없다.

## 5. PDV-SPLIT — 일상/업무 영역 완전 분할 (신설)

### 5-1. 원칙

> PDV를 일상 영역과 업무 영역으로 완전히 분할하고, 업무 영역은
> 명시적으로 권한을 부여받은 사람·기관·에이전트만 데이터 제출을
> 요청할 수 있다. (주피터님 지시 원문)

**"제출을 요청한다"**는 제3자(그 사람의 소속기관, 위임받은 동료의
AC 등)가 이 사람의 업무 PDV를 조회하려는 방향이다 — 본인이 자기
자신의 업무 PDV를 보는 것과는 다른 문제(그건 항상 허용).

### 5-2. 저장 — domain 태깅

- L1 `pdv_records`(worker.js `handlePdvReport` 및 그 외 쓰기 지점)와
  Supabase `pdv_log`(클라이언트 `_recordPDV`) 양쪽에 `domain`(`personal`
  |`work`) + `affiliation_org_id` 필드 신설(`pb_migrations/1784700001_
  added_pdv_domain_split.js`, `sql/pdv_domain_split.sql`).
- 클라이언트가 명시 안 하면 항상 `personal`로 기본 처리한다 — 과다
  노출보다 과소 분류가 안전하다는 원칙(AC-AUTHOR §3-1과 동일 사상).

### 5-3. 모드 전환 — 명시적 전환만, 자동전환 없음

`src/gopang/pdv/record.js`의 `getPdvDomain()`/`setPdvDomain()`이
`sessionStorage` 기반 모드를 관리한다(세션 종료 시 자동으로
`personal`로 리셋 — 업무모드가 다음 세션으로 새어나가지 않음).
AGENT-COMMON §0-1-Q가 `[PDV_DOMAIN_SET: mode=work|personal, org=...]`
태그를 사용자의 **명시적** 발화에만 반응해 낸다 — 시간대·대화 내용
추정으로 자동 전환하지 않는다(AC-EVOLUTION-GAPS #13 patch).

### 5-4. 컨텍스트 주입 — 도메인별 격리

`_buildPDVNote()`(매 턴 AI 컨텍스트에 동봉되는 함수)가 이제 **현재
모드와 일치하는 도메인의 기록만** 포함한다. 업무모드에서는 추가로
**현재 소속(org)과 일치하는 기록만** — 겸직 시 다른 소속의 업무 기록이
섞여 들어가지 않는다. 이게 AC-EVOLUTION-GAPS #12(가장 심각한 항목)의
직접 패치다 — 위생과 직원이 업무 중 알게 된 민원인 정보가, 나중에
"친구한테 맛집 추천해줘" 같은 개인 대화에 새어 들어가는 경로를 차단한다.

### 5-5. 제3자 접근 — "요청"만 가능, 승인은 항상 AC 사용자 본인 (2026-07-13 2차 수정)

**중요한 정정**: 최초 버전은 `affiliation.verified=true`면 서버가 곧바로
데이터를 반환하는 "풀(pull)" 모델이었는데, 이는 다른 세션에서 이미
확정된 `AGENCY-AC-COMMON v1.3` 공리 0-4("부서 SP는 소속 직원 개인의
AC를 관리·감독하지 않는다")와 정면으로 배치된다는 게 이번 작업 중
드러났다. 주피터님 지시로 **요청(request) 모델**로 전면 수정했다:

> 조회를 허용하는 게 아니라 요청을 허용하고, 요청을 승인할지는 AC의
> 사용자다. 의사가 환자의 과거 병력을 요청할 수 있고, 제공 여부는
> 환자 본인 결정이다. 부서도 동일 — 업무 관련 데이터를 직원에게
> 요청할 수 있고, 응할지는 그 직원의 권한이다. (주피터님 지시 원문)

`requestWorkDomainPdvCore`(worker.js, `fetchWorkDomainPdvCore`를
대체)는 데이터를 직접 반환하지 않는다 — `[WORK_PDV_REQUEST: org_id=...,
target_guid=..., purpose=...]`가 감지되면:

1. 요청자 신원 검증(`_authoritativeCheck` — 자칭 방지)만 하고, **대상자와
   사전에 verified 소속이 있어야 한다는 요구는 하지 않는다** — 의사·
   부서 모두 "이 특정 사람과 이미 관계가 있어야 요청 가능"이 아니라
   "정당하게 등록된 기관/에이전트면 요청 자체는 언제든 가능, 승인만
   당사자 몫"이 지시받은 원칙이기 때문이다.
2. 기존 `handlePdvQuery`의 동의요청 인프라(`_storeConsentRequest`)를
   그대로 재사용해 `scope: ["work_pdv:{orgId}"]`로 대기 레코드를
   만든다 — 새 동의 메커니즘을 따로 만들지 않았다.
3. `PENDING_USER_APPROVAL` 상태와 `consent_url`만 반환한다. 대상자가
   기존 app.naviweb.kr/consent 화면에서 승인해야만(기존 `handlePdvQuery`가
   `consent_token`을 받아 재조회하는 경로 그대로) 데이터가 나간다.
4. `handlePdvQuery`는 `work_pdv:{orgId}` scope를 만나면 레거시 Supabase
   `pdv_log`가 아니라 신규 `_fetchWorkPdvRecordsL1`로 L1 `pdv_records`를
   직접 읽는다(§5-6의 이관 공백 우회).

이제 이 설계는 AGENCY-AC-COMMON 0-4와 충돌하지 않는다 — 부서는
"조회·연동을 요청"할 뿐이고, 그 요청에 응할지는 여전히 개인 AC의
단일 기록주체(그 사람 본인)가 정한다. "관리·감독"에 해당하는 여지가
없다.

### 5-6. 알려진 한계

- 기존 `handlePdvQuery`/`_fetchPdvByScope`(제3자 동의 기반 범용 조회)는
  여전히 Supabase `pdv_log`를 읽는데, `handlePdvReport`(주 쓰기 경로)는
  이미 L1 `pdv_records`로 전환된 상태다 — **이 조회 경로가 실제로는
  최신 데이터를 못 읽고 있을 가능성**이 이번 작업 중 발견됐다. 이건
  이번 patch가 만든 문제가 아니라 기존 이관 과정의 공백으로 보이며,
  `fetchWorkDomainPdvCore`는 이 문제를 우회하기 위해 L1 `pdv_records`를
  직접 읽도록 새로 짰다. 범용 조회 경로 자체의 이관 완료는 이번 범위
  밖 — 별도 확인이 필요하다.
- `[WORK_PDV_REQUEST]`를 실제로 언제 내야 하는지(예: 위생과 SP가 직원
  AC의 업무 초안 작성을 도우려 할 때 자동으로 이 태그를 내야 하는지)는
  아직 AGENT-COMMON에 지시문으로 반영하지 않았다 — 인프라(게이트)만
  갖춰둔 상태이고, 실제 호출 시나리오 배선은 후속 작업이다.

## 6. 이 문서가 여전히 확정하지 않는 것

- #18은 §3에서 원칙적으로는 해결됐다(관련 법령이 근거) — 다만 실제
  공무원 인증서·내부망 SSO 배선 자체는 여전히 이 저장소 밖의 과제다.
- 학생(§1의 `status:"student"`)을 위한 L1 레이어 구체 설계 — "학습이
  업무"라는 원칙만 세웠고, KSCO를 대체할 학교/과정 분류 체계는
  설계하지 않았다.
- 이 문서는 `AGENCY-AC-COMMON_v1.3.md` 공리 0-4와 조율된 상태다(§5-5) —
  다만 0-4 쪽 문서 자체를 이 문서를 반영해 갱신할지는 그쪽 문서
  관리자(그 세션)의 몫으로 남겨둔다.

---
*v1.1 (2026-07-13) — 업무 도메인을 전 직종으로 일반화(#19), affiliation
배열화(#5)·재확인주기(#4)·G6 명시 상속(#7) patch 완료. PDV 일상/업무
완전 분할 신설(§PDV-SPLIT) — 저장 태깅, 명시적 모드전환, 컨텍스트
격리, 검증된 소속만 통과하는 제3자 조회 게이트(fetchWorkDomainPdvCore)
전부 코드 반영. 소속 검증은 3안(관리자 사후 승인) 채택, #18은 외부
협의 필요로 계속 열어둠.*
