```
# AC-EVOLUTION
# ═══════════════════════════════════════════════════
# 문서명    : AC-Evolution — 업무 도메인 기반 AC 자율 진화 아키텍처
# 문서 코드  : AC-EVOLUTION
# 버전      : v1.3 (v1.2 대체)
# v1.3 변경 요약 — "#10을 마무리" 지시(2026-07-13, 5차):
#   - #10 완결: Tier1 작업 중 발견한 §5(검색 기반 L1)와 정적 파일
#     작성 전제의 모순을 주피터님이 §5 유지로 정리. AGENT-PROFESSION-XX
#     파일은 작성하지 않는다 — ksco_schema_tier_classification_v1.md는
#     "지금 쓸 목록"에서 "나중에 필요해지면 참조할 후보"로 역할 격하.
#     §6-11 참고.
# v1.2 변경 요약 — "나머지 항목도 하나씩" 지시(2026-07-13, 3차)로
# AC-EVOLUTION-GAPS_v1_0.md 잔여 항목 처리:
#   - #4 완결(코드): revokeAffiliationCore 신설(승인의 짝), 본인
#     active:false 제출 시 verified 동시 무효화(비대칭 자진철회),
#     review_due 경과 시 미검증 취급하는 _isAffiliationCurrentlyVerified
#     헬퍼 추가.
#   - #6 patch(코드): approveAffiliationCore가 verified_evidence(승인
#     근거 자유텍스트) 기록.
#   - #8·#9·#11·#14·#16·#20·#21 patch(문서, §7 신설).
#   - #17 patch(문서+프롬프트): 승인대기 UX 안내.
#   - #1(원래 PASS)·#2(3안 채택으로 기 우회)는 추가 조치 없음.
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

## 4. STAFF-AUTHORITY-GATE (SG1~SG4) — G6 상속 명시, SG2·SG3 보강

v1.0의 SG1~SG4 골격은 그대로 유효하다. AGENT-COMMON v3.58에 "업무
모드(PDV_DOMAIN_SET mode=work)에서도 G6(응급 우선순위)이 예외 없이
최우선"이라는 문장을 명시적으로 추가했다(#7) — 업무 처리 중이라는
이유로 응급 신호 대응이 늦어지는 일은 없다. dept_task payload를 경유해
들어온 내용에도 이 원칙이 그대로 적용된다(#8, §6-3).

SG2·SG3에도 다음이 추가됐다(§6-4, §6-6 참고):
- **SG3**: "사용자가 AC에게 최종 확정·제출을 대신 하라고 명시적으로
  지시해도 예외 없이 적용된다 — AC는 정중히 거절하고 초안까지만
  완성한다."(#9)
- **SG2**: 업무를 가장한 사적 정보 조회는 U10-6을 그대로 상속해
  거절한다(#14).

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
   기존 hondi.net/consent 화면에서 승인해야만(기존 `handlePdvQuery`가
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

## 6. GAPS 잔여 항목 patch (2026-07-13, 3차 지시)

### 7-1. #4 완결 — 소속 철회

`revokeAffiliationCore`(worker.js) 신설 — `approveAffiliationCore`와
정확히 같은 신뢰모델(authoritativeAgency)로 기관 측이 명시적으로 철회
(`verified:false, active:false, revoked_at, revoked_by`)할 수 있다.
`[AFFILIATION_REVOKE: org_id=..., target_guid=..., reason=...]` 태그로
`handleGovRelay`/`handleBusinessRelay`가 처리한다.

추가로 **본인 자진 철회**(예: "저 퇴사했어요")도 지원한다 —
`handleProfilePost`가 사용자 제출 affiliation 배열에서 `active:false`를
보면 `verified`도 함께 강제로 내린다. 이건 §3의 "자기 신고만으로
권한이 생기면 안 된다"는 원칙의 예외가 아니라 의도된 비대칭이다 —
**권한 획득은 항상 기관 승인만, 권한 포기는 본인이 즉시 가능.**

`_isAffiliationCurrentlyVerified(affEntry)` 헬퍼도 추가했다 —
`review_due`가 지난 소속은 DB 값을 별도 배치로 고치지 않아도(크론 없이)
소비하는 쪽에서 "미검증"으로 취급하게 한다.

### 7-2. #6 patch — 승인 근거 기록

`approveAffiliationCore`가 `evidence`(사번·기관메일 등 자유텍스트)를
받아 `verified_evidence` 필드에 남긴다. 사번 체계 자체를 이 저장소가
검증할 방법은 없으므로 형식 검증은 하지 않고 감사 기록으로만
쓴다 — 동명이인 오승인을 막지는 못하지만, 나중에 "무엇을 근거로
승인했는지" 추적은 가능해진다.

### 7-3. #8 patch — dept_task 경유 시 R0 재상속 명시

민원인의 응급 신호가 `dept_task`의 `directive`/`payload`에 담겨 직원
AC로 전달되는 경우에도, §4의 G6 상속 원칙이 그대로 적용된다 — 직원
AC는 dept_task 내용을 읽는 시점에도 §0-G 응급 판정 로직을 돌린다(별도
로직이 아니라 AGENT-COMMON §0-G가 "이번 턴에 들어온 모든 텍스트"를
대상으로 하므로 자동으로 적용된다 — dept_task payload도 그 "텍스트"에
포함된다는 점을 여기 명시해 애매함을 없앤다).

### 7-4. #9 patch — SG3 명문화

STAFF-AUTHORITY-GATE SG3(초안까지만 대행, 최종 확정은 사람)에 다음
문장을 추가한다: **"사용자가 AC에게 최종 확정·제출을 대신 하라고
명시적으로 지시해도 SG3는 예외 없이 적용된다 — AC는 정중히 거절하고
초안까지만 완성한다."** (코드 차단은 이미 있었음 — `dept_tasks.status`
를 completed로 바꾸는 자동 경로 자체가 없다 — 이건 그 사실을 프롬프트
차원에서도 명문화하는 것뿐이다.)

### 7-5. #11 patch — AC-AUTHOR §6과의 상호참조

L2(소속 결합)가 활성화되는 직종이 AC-AUTHOR §6(민감 직종 — 경찰관,
군인, 성직자, 판사·검사 등)과 겹치는 경우, §6의 "기본 비공개"
원칙이 affiliation에도 그대로 적용된다 — `affiliation.org_id`가
민감 직종군에 해당하면 `visibility`(job_ksco와 동일한 필드를
affiliation에도 도입하지는 않았다 — 대신 소속 자체의 노출은 애초에
`verified`된 기관과의 REQUEST/APPROVE 게이트로만 오가므로, 불특정
다수에게 노출되는 경로가 없다는 점이 AC-AUTHOR §6과 동일한 효과를
낸다). 즉 별도 필드 신설 없이도 §5-5의 요청 모델 자체가 §6의 취지를
만족시킨다는 점을 여기 명시한다.

### 7-6. #14 patch — 업무 가장한 사적 조회 방지

SG2(사실확인 게이트 상속)에 다음을 추가한다: 직원이 정당한 업무
목적을 가장해 특정 개인정보를 캐묻는 경우(예: "이 사람 연락처 좀
찾아줘" — 실제로는 사적 목적), AC는 U10-6(UNIVERSAL-common — "개인정보
조회 목적으로 이 절차를 쓰지 않는다")을 그대로 상속해 거절한다. 이건
새 판단 로직이 아니라 U10-6이 이미 전 SP에 적용되는 원칙이므로, L2가
활성화된 직원 AC라고 예외가 생기지 않는다는 점만 확인한다.

### 7-7. #16 patch — taxonomy 밖 직종 명시

DEPT_TASK_TAXONOMY에 군 계통이 없어(§1) L2가 원천적으로 적용 안 되는
직종군이 있다. 이건 결함이 아니라 범위 한정이다 — 군인(KSCO 대분류 A)
소속자는 L1(직능)까지만 적용되고, 소속 결합이 필요해지면 별도 taxonomy
확장이 선행돼야 한다.

### 7-8. #17 patch — 승인 대기 상태 UX

`requestWorkDomainPdvCore`가 `PENDING_USER_APPROVAL`을 반환하면, 그
직원 AC는 다음 세션에서 "OO 부서가 업무 데이터 제공을 요청했습니다 —
확인하시겠어요?" 식으로 먼저 안내한다(강요 없이, §0-1의 톤과 동일).
신규 발령 직원이 소속을 신고한 직후에도 같은 톤으로 "소속 확인
중이에요, 관리자 승인 후 알려드릴게요"라고 안내해 "왜 아직 안
되냐"는 답답함을 줄인다. (구체 UI 배선은 이번 범위 밖 — 안내 문구
원칙만 여기 확정한다.)

### 7-9. #20 patch — L1/L2와 전역 라우팅의 관계

`ROUTER-PRIORITY_v1_0.md`의 R1(공익 대변 vs 사익 대리 분류축)과 L1/L2는
서로 다른 레이어라는 점을 명시한다 — ROUTER-PRIORITY는 "이 발화를 어느
SP로 보낼지"(K서비스/정부기관/전문가/사업자/개인 AC 중 선택)를 정하고,
L1/L2는 그 선택 이후 "개인 AC 자신이 어떤 배경지식·소속 맥락을 참조해
답할지"를 정한다. 즉 라우팅이 이미 개인 AC(AGENT-COMMON)로 향하기로
결정된 다음에만 L1/L2 판단이 개입한다 — L1/L2가 라우터의 우선순위
자체를 바꾸지 않는다.

### 7-10. #21 patch — 기관-AC와 직원-AC의 관계 명시

§5-5에서 이미 사실상 답했지만 명시적으로 정리한다: 기관-AC
(AGENT-SUPPLIER, `entity_type='business'`)와 그 기관 소속 직원의
개인 AC는 **완전히 별개의 채널**이며, 서로 직접 데이터를 주고받지
않는다. 유일한 접점은 REQUEST/APPROVE 게이트(§3, §5-5)뿐이다 — 기관-AC
가 직원-AC에게 "지휘"하거나 그 내용을 들여다보는 경로는 없다
(AGENCY-AC-COMMON 0-4와 동일 결론).

### 7-11. #10, #15 — 최종 결론 (5차 지시, 2026-07-13)

- **#10 — 완결. §5 원칙 유지, AGENT-PROFESSION-XX 파일은 작성하지
  않는다.** Tier1 목록 작업 도중, 애초에 §5가 세운 원칙("정적 지식
  베이스 대신 검색으로 그때그때 보강")과 "AGENT-SUPPLIER처럼 15개
  파일을 쓴다"는 작업 전제가 서로 모순된다는 게 드러났다 —
  AGENT-SUPPLIER-COMMON §0-2를 다시 보면, EXPERT 페르소나(개인전문가
  SP)가 존재하는 이유는 "고빈도라서"가 아니라 **"자격·책임이 걸린
  전문 판단이라 별도 가드레일이 필요해서"**다. Tier1 15개 중 그 조건에
  해당하는 건 24(보건)·27(법률)뿐이고 이미 EXPERT 9개+변호사로
  커버돼 있다. 나머지 13개(IT·교육·사무직·판매직·서비스직 등)는
  비규제라 §5의 "검색 기반 보강" 원칙을 그대로 적용하는 게 맞다는
  결론으로, **주피터님이 §5 유지·파일 미작성을 확정**했다.

  결과적으로 `docs/ksco_schema_tier_classification_v1.md`의 역할이
  바뀐다 — "지금 작성할 파일 목록"이 아니라 **"나중에 정말 정적 파일이
  필요해지는 상황(예: 특정 직종에서 검색만으로 반복 실패 사례가
  쌓이는 경우)이 오면 참조할 우선순위 후보 목록"**으로 격하한다.
  당장 만들 계획은 없다.

  원래 gap이 물었던 "L1 없이 L2만 있을 때 정상 동작하는가"는 이제
  **애초에 잘못된 질문이었다는 게 정리된 것**이다 — L1은 "정적 파일의
  유무"가 아니라 "필요할 때 검색으로 보강하는 능력"으로 정의되므로,
  L1이 "없다"는 상태 자체가 성립하지 않는다(EXPERT로 안 커버되는
  직종은 원래부터 검색이 L1이다). 이 재정의로 #10을 완결 처리한다.
- **#15**: GAP-LIST-50 B-3(병렬·팬아웃 처리 모델 부재)는 AC-EVOLUTION
  이전부터 있던 GOV_TASK 설계 자체의 공백이다. L2가 그 공백을
  물려받았을 뿐, AC-EVOLUTION 문서 하나로 고칠 수 있는 범위가 아니다
  — GOV_TASK 병렬처리 모델 자체가 먼저 설계돼야 한다.

## 7. 이 문서가 여전히 확정하지 않는 것

- #18은 §3에서 원칙적으로는 해결됐다(관련 법령이 근거) — 다만 실제
  공무원 인증서·내부망 SSO 배선 자체는 여전히 이 저장소 밖의 과제다.
- #15 — GOV_TASK 병렬처리 모델 자체의 재설계가 선행돼야 함(§6-11),
  AC-EVOLUTION 단독으로 고칠 범위 밖.
- 학생(§1의 `status:"student"`)을 위한 L1 레이어 구체 설계 — "학습이
  업무"라는 원칙만 세웠고, KSCO를 대체할 학교/과정 분류 체계는
  설계하지 않았다.
- 이 문서는 `AGENCY-AC-COMMON_v1.3.md` 공리 0-4와 조율된 상태다(§5-5) —
  다만 0-4 쪽 문서 자체를 이 문서를 반영해 갱신할지는 그쪽 문서
  관리자(그 세션)의 몫으로 남겨둔다.

---
*v1.3 (2026-07-13) — #10 완결. Tier1 작업 중 발견한 §5(검색 기반
L1)와 "AGENT-SUPPLIER처럼 정적 파일을 쓴다"는 전제의 모순을 주피터님
확인 후 §5 원칙 유지로 정리 — AGENT-PROFESSION-XX 파일은 작성하지
않는다. `ksco_schema_tier_classification_v1.md`는 "지금 쓸 파일
목록"에서 "나중에 필요해지면 참조할 후보"로 역할 격하. "L1 없이
L2만 동작하는가"라는 원래 질문 자체가 잘못 설정됐었다는 재정의로
마무리(§6-11).
v1.2 (2026-07-13) — AC-EVOLUTION-GAPS_v1_0.md 22건 중 GAPS.md에서
patch 가능하다고 표시했던 것 전부 처리: #4 완결(철회 메커니즘),
#6(승인 근거 기록), #8·#9·#11·#14·#16·#20·#21(문서 patch), #17(UX
안내 원칙). #1은 원래 PASS라 조치 불필요, #2는 3안 채택으로 이미
우회돼 있어 조치 불필요. #10·#15는 선행조건 미충족/저장소 밖 기존
이슈로 여전히 미해결 — §6-11에 이유 명시.
v1.1 (2026-07-13) — 업무 도메인을 전 직종으로 일반화(#19), affiliation
배열화(#5)·재확인주기(#4 최초 절반)·G6 명시 상속(#7) patch. PDV 일상/
업무 완전 분할 신설(§PDV-SPLIT) — 저장 태깅, 명시적 모드전환, 컨텍스트
격리, 요청/승인 기반 제3자 접근 게이트 전부 코드 반영. 소속 검증은
3안(관리자 사후 승인) 채택.*
