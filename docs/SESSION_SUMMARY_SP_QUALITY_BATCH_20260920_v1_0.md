# 세션 요약 — SP 품질 배치 정비 착수 + 매니페스트 결함 수정 (2026-09-20)

**전제**: `docs/SESSION_SUMMARY_CONTENT_QUALITY_LIVE_SMOKETEST_20260920_v1_0.md`
§6 "다음 세션 시작점"의 후속 작업. 그 문서의 우선순위 목록 순서대로
진행했다.

## 1. 패치 #0006(§2 템플릿 근본수정) — 확인 불가, 미병합

이 세션(클라우드 컨테이너) 안에서는 저장소 어디에도, 열린 PR
(refs/pull/*/head 389개 전수 확인) 어디에도 "패치 #0006"에 해당하는
것을 찾지 못했다. HANDOFF 문서들이 반복적으로 언급하는 "Windows
PowerShell에서 `git am`으로 패치 적용" 관행에 비춰보면, 이 패치는
피터님 로컬 머신에만 있는 `.patch`/`.diff` 파일로 추정된다 — **이 세션은
그 파일에 접근할 방법이 없어 병합하지 못했다.** 다음 세션(또는 로컬
환경)에서 그 패치 파일 자체를 제공해주시면 바로 적용 가능하다.

이 갭은 §3(아래)의 진행 범위를 실질적으로 제한했다 — 이유는 §3 참고.

## 2. SP_advisor·SP_nurse의 C39-2 — 조사 후 차등 처리

Phase 2 감사(`prompts/gov-tree/docs/PHASE2-STRUCTURAL-AUDIT-AND-PERSONA-C39-2_2026-09-19.md`)가
"C39-2 없음"으로 잡은 2건을 실제로 열어본 결과, 둘의 사정이 완전히
달랐다:

- **SP_nurse**: 실제 결함. STEP D에 L2·L3 예외 내용 자체는 있었지만
  D-2 문단에 인라인으로만 섞여 있어 grep(`C39-2` 리터럴 검색) 기준
  감사에 안 걸렸을 뿐이었다. `SP_common_guardrails` C39-2+ 표준 서식을
  명시 참조하는 별도 **D-1+** 절로 분리·구조화(v3.7 → v3.8, 내용 변경
  없음, 단일출처원칙 준수).
- **SP_advisor**: **오탐(false positive)**. 이 페르소나는 v1.3부터
  이미 "K-Professor 계열과 동일하게 STEP D(인간 전문가 연결) 자체가
  없다"고 스스로 명시하고 있다(법령상 최종 승인 필요한 자격자가 없어
  C39/C39-2 적용 대상이 아님) — `SP_professor_v1_5.md`도 동일 사유로
  C39-2가 없음을 교차 확인해 뒷받침했다. Phase 2 감사가 쓴 "전문화 없는
  최상위 페르소나"(parent 없는 카테고리) 필터는 `prof-professor`(355개
  전문분야를 자식으로 둔 카테고리)를 아예 건너뛰어 그 base 파일 자체가
  같은 이유로 C39-2가 없다는 사실이 애초에 감사 범위 밖에 있었다 — 즉
  advisor·professor 둘 다 정상이고, 감사 방법론의 사각지대였다.
  내용은 바꾸지 않고 v1.4 changelog에 이 조사 결과만 기록해 감사
  항목을 종결했다.

두 파일 모두 `prompts/sp-catalog.json`에 반영(SP_advisor→v1.4,
SP_nurse→v3.8).

## 3. 112개 §2 재작성 + §3 누락 109건 — CT-0054·CT-0064만 개별 수정,
   전면 배치는 미착수(§1 의존성 때문)

`SP-DIV-TOURISM-TOURISMPOLICY`(CT-0054)·`SP-DIV-OCEAN-MARINEPOLICY`
(CT-0064) 두 파일을 열어보니, 둘 다 `division-master-data.json`
2026-07-10 조사분을 `SP-DIV-TEMPLATE_v1.0.md` 형식으로 그대로 옮긴
**동일한 일반 템플릿 문구**(§2가 "OO 관련 민원의 절차·자격 요건을
안내한다"는 한 줄짜리 광역 서술)를 쓰고 있었다 — 그리고 나머지 do-dept
division 상당수(§4 목록 참고)도 같은 문구를 공유한다. 즉 CT-0054·
CT-0064는 이 두 파일만의 개별 결함이 아니라, **§2 템플릿 자체가 너무
넓어서 생성형 모델이 인접 부서 업무나 근거 없는 예시를 스스로 채워
넣기 쉬운 구조**라는 공통 원인의 개별 증상이다 — 정확히 "패치 #0006
(§2 템플릿 근본수정)"이 다루려는 문제로 보인다.

그 패치의 실제 내용(새 템플릿이 §2를 어떤 형식으로 재구성하는지)을
확인할 방법이 없는 상태에서 112개 파일에 내 나름의 새 템플릿을 임의로
적용하면, 패치 #0006이 도착했을 때 서로 충돌하거나 중복 작업이 될
위험이 크다고 판단했다. 그래서 이번 세션은:

1. **CT-0054·CT-0064 두 건만** 최소 침습적으로 수정했다 — 기존 §2
   구조는 그대로 두고, 감사에서 이미 확인된 구체적 오류(관광사업
   등록·허가를 자기 소관으로 나열 / 근거 없는 "어촌·어항 정책" 예시)만
   콕 집어 "혼동 주의" 네거티브 항목을 §2에 추가했다(v1.0 → v1.1,
   구버전은 `divisions/archive/`로 이동 — 02-do-dept/archive/README.md와
   동일 컨벤션). 근거 없는 새 사실은 추가하지 않았다 — 이미 SP 원문
   §INPUT_SCHEMA·§3에 있던 "개별 인허가는 시청 OOO과 소관"이라는
   기존 문구를 §2 레벨로 끌어올려 명시했을 뿐이다.
2. `src/gopang/gov/division-tables.js`와 `pages/jeju-gov-automation.html`
   (+ `-draft.html`)의 file 참조를 v1.1로 갱신해 실제 라우팅에 반영되게
   했다.
3. 나머지 do-dept·do-agency·org·city division들의 §2 전면 재작성은
   **패치 #0006 병합 후로 보류**한다.

## 4. §3(안내/연계) 누락 기계적 재실측 — 102건(참고용, Phase 2의 109와
   근사)

Phase 2 감사와 동일한 취지로 `02-do-dept`·`03-do-agency`·`07-org`·
`04-city`의 division급 SP 549개를 스캔해 "§2는 있는데 §3(접수·안내만
하는 업무/타 기관 연계)이 없는" 파일을 다시 골랐다(템플릿 파일·이미
알려진 예외 2종 — SEOGWIPO-CONSTRUCTION 6개, JTO-PLANNING — 제외).
결과 **102건**(Phase 2가 보고한 109와 근사 — 정확히 일치하지 않는 건
스캔 범위 차이로 추정, `05-emd`·`01-do` 레벨은 이번 재실측에 포함하지
않았다). 전체 파일 목록은 이 문서 끝에 첨부한다.

**이 102건에 실제 §3 연계 내용을 채워 넣는 작업은 이번 세션에서
착수하지 않았다** — 그 이유는 §1·§3의 패치 의존성과 별개로, 각 기관이
"자기 권한 밖 업무를 실제로 어디로 연계해야 하는가"는 이 저장소 안의
데이터만으로 검증할 수 없는 사실(제주도 실제 조직도·사무분장규칙)이라,
이 세션이 임의로 채우면 오히려 새로운 CT-0054/CT-0064류 환각을
만들어낼 위험이 있다고 판단했기 때문이다. 다음 세션에서 사람(피터님)이
확인 가능한 실제 연계 부서 목록을 함께 두고 배치 작업하는 것을
권장한다.

## 5. CONTROL-TOWER-PRINCIPLE 매니페스트 결함 — 근본 원인까지 수정

세션 요약(2026-09-20)이 "매니페스트에 파일명만 등록하면 되는 소규모
수정"이라 적었으나, 실제로 조사해보니 원인이 하나 더 있었다:
`tools/build_manifest.py`의 `ALLOWLIST_PREFIXES`가 `CONTROL-TOWER-
PRINCIPLE`을 "카탈로그 등록 아닌 설계 문서"로 **잘못 분류**하고 있었다
(2026-09-01 배치 추가 때 8개를 한꺼번에 넣으면서 개별 검토가 빠졌던
것으로 추정). 이 상태로는 `sp-catalog.json`에 키를 수동으로 넣어도
다음 CI 재생성(`ci: regenerate sp-catalog.json...`) 때 조용히 다시
지워졌을 것이다(UNIVERSAL-common·K-Public_common이 과거 겪었던 것과
동일한 회귀 패턴 — 이 스크립트 자체의 주석에 선례가 여러 번 기록돼
있다). 그래서:

1. `sp-catalog.json`에 `"CONTROL-TOWER-PRINCIPLE": "CONTROL-TOWER-PRINCIPLE_v1_1.md"` 등록.
2. `tools/build_manifest.py`에 `_scan_single(r'^CONTROL-TOWER-PRINCIPLE_v', '.md', 'CONTROL-TOWER-PRINCIPLE')` 스캔 블록 추가 + `ALLOWLIST_PREFIXES`에서 제거.
3. `tests/live_smoketest/content_quality_live_smoketest.py`의 UNIVERSAL
   레이어 조립에 `CONTROL-TOWER-PRINCIPLE`을 세 번째 레이어로 추가(이
   버그가 고쳐졌으니 하네스도 다시 프로덕션과 맞춰야 함 — 기존 주석
   "안 붙이는 게 프로덕션과 일치"는 이제 낡은 정보라 함께 정정).

**주의**: `tools/build_manifest.py`를 실제로 실행해보니(자기검증 단계),
이 세션과 무관한 **선재 결함**이 있다 — `SP-EDITOR_v1_0.md`·
`SP-FS-COMPOSER_v1_1.md`·`SP-PATH-VERIFIER_v1_0.md`·`k-job_v1_0.md`·
`k-plan_v1_1/1_2/1_3.md` 7개 파일이 이 스크립트의 어떤 스캔 패턴에도
안 걸려 자기검증이 실패한다(2026-09-02~09-15 사이 추가된 파일들 —
CI의 "ci: regenerate sp-catalog.json" 잡이 이 시점부터 계속 실패
중이었을 가능성). CONTROL-TOWER-PRINCIPLE 수정과는 무관한 별개
결함이라 이번 세션에서는 손대지 않았다 — **후속 세션 필요**.

## 6. identityDoc·ownSpAndGates 이식 — 검토만, 미착수

`worker.js`의 `_fetchOwnSpAndGates(agency)`를 확인한 결과, agency별로
동적 조립되는 로직이라(런타임 DB/JSON 조회 다수 결합) Python 하네스로
안전하게 재현하려면 그 자체로 별도 세션 분량의 작업이 될 것으로
보인다 — 이번 세션 범위에서는 착수하지 않고 다음 세션 후보로 남긴다.

## 7. prompts/ 최상위 구버전 아카이브 정리 — 완료

`tools/archive_old_prompts.py`의 `KEEP_LATEST`를 5→1로 낮췄다(기존
값은 계열당 5개씩 남겨 70개 계열 × 5 ≈ 300개가 상시 체류하는 원인 —
`sp-catalog.json`은 항상 1개만 참조하므로 그 이상은 git 이력으로
충분). 실행 결과: 136개 이동, 이미 archive/에 동일 내용으로 존재하던
107개는 원본 삭제(데이터 손실 없음 — 스크립트에 안전장치 추가:
내용이 다르면 자동 처리하지 않고 사람 확인 대상으로 남김), 충돌 1건
(`SP_sanitarian_v1_2.md` — archive 사본과 내용이 다름, 아래 참고).
`sp-catalog.json`이 참조하는 모든 파일은 이동 후에도 100% 존재 확인.

**참고(수동 확인 권장)**: `prompts/SP_sanitarian_v1_2.md`가
`prompts/archive/SP_sanitarian_v1_2.md`와 같은 버전 번호인데 내용이
다르다 — 루트 쪽에 2026-08-11에 추가된 "STEP D+" 절이 archive 사본에는
없다. 카탈로그는 이미 v1.6을 가리키므로 기능상 영향은 없지만, 버전
번호 규율 위반(같은 v1.2 파일을 새 버전 채번 없이 사후 수정)의 흔적으로
보여 그대로 두고 보고만 한다.

## 8. 이번 세션에서 바꾼 파일 요약

- `prompts/sp-catalog.json` — CONTROL-TOWER-PRINCIPLE 키 추가,
  SP_advisor→v1.4, SP_nurse→v3.8
- `prompts/SP_advisor_v1_4.md`(신규), `prompts/SP_nurse_v3_8.md`(신규)
- `tools/build_manifest.py` — CONTROL-TOWER-PRINCIPLE 스캔 블록 추가 +
  ALLOWLIST_PREFIXES 정정
- `tools/archive_old_prompts.py` — KEEP_LATEST 5→1 + 동일내용 중복 자동
  정리 로직 추가
- `tests/live_smoketest/content_quality_live_smoketest.py` —
  CONTROL-TOWER-PRINCIPLE 레이어 추가
- `tests/live_smoketest/scenarios_content_quality_retest_ct0054_ct0064_20260920.json`(신규)
  — CT-0054·CT-0064 재검증용 2건 시나리오
- `prompts/gov-tree/02-do-dept/divisions/SP-DIV-TOURISM-TOURISMPOLICY_v1.1.md`(신규),
  `SP-DIV-OCEAN-MARINEPOLICY_v1.1.md`(신규) + 구버전 `divisions/archive/`로 이동
- `src/gopang/gov/division-tables.js`, `pages/jeju-gov-automation.html`,
  `pages/jeju-gov-automation-draft.html` — 위 두 SP의 file 참조 v1.1로 갱신
- `prompts/archive/` — 136개 이동 + 107개 중복 삭제(아카이브 정리)

## 9. 다음 세션 시작점 (갱신)

1. **패치 #0006 확보·병합** — 로컬 머신에서 `.patch` 파일을 가져오거나,
   그 패치가 의도한 §2 새 템플릿 형식을 문서로 옮겨줄 것. 이게 있어야
   §3의 112개 배치를 안전하게 진행할 수 있다.
2. §3의 102(~109)건 §3 연계 섹션 채우기 — 실제 연계 부서 목록(사람이
   확인한 자료)과 함께 배치 진행.
3. `tools/build_manifest.py` 자기검증 실패 7건(SP-EDITOR·SP-FS-COMPOSER·
   SP-PATH-VERIFIER·k-job·k-plan v1.1~1.3) 정리 — CI의 카탈로그
   자동 재생성이 이 시점부터 막혀있었을 가능성이 있어 우선순위 있음.
4. identityDoc·ownSpAndGates 하네스 이식(선택, §6 참고).
5. CT-0054·CT-0064 v1.1 수정 후 실제 라이브 재검증 — 이 클라우드
   세션에는 `DEEPSEEK_API_KEY`가 없어 실행 못 함.
   `tests/live_smoketest/scenarios_content_quality_retest_ct0054_ct0064_20260920.json`을
   `.github/workflows/live-smoketest-content-quality-govtree.yml`
   workflow_dispatch의 `scenarios_file` 입력으로 넣어 실행할 것(병합 후).

## 부록 — §3 연계 누락 102건 전체 목록

```
prompts/gov-tree/02-do-dept/SP-DO-TOURISM_v1.2.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-AGRI-ANIMALQUARANTINE_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-AGRI-CITRUS_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-AGRI-ECOFARMPOLICY_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-AGRI-FOODINDUSTRY_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-AGRI-LIVESTOCKPOLICY_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-CLIMATE-ENVPOLICY_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-CLIMATE-FORESTGREEN_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-CLIMATE-RECYCLING_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-CLIMATE-WATERPOLICY_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-CULTURE-CULTUREPOLICY_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-CULTURE-EDUCOOPERATION_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-CULTURE-SPORTSPROMO_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-ECON-EMPLOYCENTER_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-ECON-INVESTMENT_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-ECON-JOBECONOMY_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-ECON-SMALLBIZ_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-HOUSING-ARCHITECTURE_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-HOUSING-HOUSINGLAND_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-HOUSING-ROADMANAGE_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-OCEAN-HAENYEOHERITAGE_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-OCEAN-MARINEINDUSTRY_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-OCEAN-MARINEPOLICY_v1.1.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-OCEAN-PORTHARBOR_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-TOURISM-PEACEDIPLOMACY_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-TOURISM-TOURISMINDUSTRY_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-TOURISM-TOURISMPOLICY_v1.1.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-TRANSPORT-15MINCITY_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-TRANSPORT-PUBLICTRANSPORT_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-TRANSPORT-TRAFFICPOLICY_v1.0.md
prompts/gov-tree/02-do-dept/divisions/SP-DIV-TRANSPORT-URBANPLAN_v1.0.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-AGRITECH-ADMIN_v1.0.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-BOHWAN-ENVIRONMENT_v1.0.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-BOHWAN-HEALTH_v1.0.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-CHUKSAN-RESEARCH_v1.0.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-FIRE-ADMIN_v1.0.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-FIRE-PREVENTION_v1.1.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-FIRE-RESPONSE_v1.1.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-HERITAGE-HALLASAN_v1.0.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-HERITAGE-MANAGEMENT_v1.1.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-POLICE-SAFETY_v1.1.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-POLICE-TRAFFIC_v1.1.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-POLICE-WOMENYOUTH_v1.0.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-WATER-ADMIN_v1.0.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-WATER-SEWAGE_v1.0.md
prompts/gov-tree/03-do-agency/divisions/SP-AGYDIV-WATER-WATERSUPPLY_v1.1.md
prompts/gov-tree/04-city/divisions/SP-CITYDIV-JEJUSI-AGRI-CITRUS_v1.0.md
prompts/gov-tree/04-city/divisions/SP-CITYDIV-JEJUSI-AGRI-ECOFARM_v1.0.md
prompts/gov-tree/04-city/divisions/SP-CITYDIV-JEJUSI-AGRI-FISHERY_v1.0.md
prompts/gov-tree/04-city/divisions/SP-CITYDIV-JEJUSI-AGRI-LIVESTOCK_v1.0.md
prompts/gov-tree/04-city/divisions/SP-CITYDIV-JEJUSI-HEALTH-ADMIN_v1.0.md
prompts/gov-tree/04-city/divisions/SP-CITYDIV-JEJUSI-HEALTH-EASTCENTER_v1.0.md
prompts/gov-tree/04-city/divisions/SP-CITYDIV-JEJUSI-HEALTH-EPIDEMIC_v1.0.md
prompts/gov-tree/04-city/divisions/SP-CITYDIV-JEJUSI-HEALTH-PROMOTION_v1.0.md
prompts/gov-tree/04-city/divisions/SP-CITYDIV-JEJUSI-HEALTH-WESTCENTER_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-CHILDCARE-SUPPORT_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-CHILDMEAL-ADMIN_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-CHILDMEAL-HYGIENE_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-CHILDMEAL-NUTRITION_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-ICCJEJU-VENUE_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-IPF-PEACE_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JCCEI-SUPPORT_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JCGF-ADMIN_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JCGF-RISK_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JCGF-UNDERWRITING_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JCPA-CONTENTS_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JEA-PLANNING_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JEA-RENEWABLE_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JEDA-BUSINESS_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JEDA-PLANNING_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JEJU43-PEACE_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JEJUMED-ADMIN_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JEJUMED-CLINICAL_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JEJUMED-NURSING_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JERI-PLANNING_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JERI-RESEARCH_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JFAC-SUPPORT_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JILES-SCHOLARSHIP_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JPASS-ADMIN_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JPDC-BUSINESS_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JPDC-PLANNING_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JPSPO-ADMIN_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JPSPO-ELITESPORT_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JPSPO-LIFESPORT_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JPSPO-PLANNING_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JSPO-ADMIN_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JSPO-ELITESPORT_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JSPO-LIFESPORT_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JSPO-PLANNING_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JTA-MEMBERSUPPORT_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JTO-MARKETING_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JTP-ADMIN_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JTP-CORPSUPPORT_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JTP-POLICY_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JWFRI-PLANNING_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-JWFRI-RESEARCH_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-MAEUL-SUPPORT_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-SGPMED-ADMIN_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-SGPMED-CLINICAL_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-SGPMED-NURSING_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-TRANSWEAK-DISPATCH_v1.0.md
prompts/gov-tree/07-org/divisions/SP-ORGDIV-URBANREGEN-SUPPORT_v1.0.md
```
