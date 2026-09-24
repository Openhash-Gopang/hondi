# 세션 기록 — gov-tree 누락 15개 기관 신설(공공정책연수원~소방서 4곳)·합의제행정기관 새 K-FOI tier(collegial) 신설·명칭 충돌 3건 정리·신설 SP 라우팅 라이브 스모크테스트 2종(22건→42건) (2026-09-24~25)

> 관련 문서: `WORKLOG_INDEX.md`에서 전체 문서 지도 확인 (desktop.html 좌측
> 사이드바 "🛠 개발자 문서" 섹션에서 링크됨)
>
> 1차 출처: `prompts/gov-tree/03-do-agency/archive/README.md`(작업
> #12~#15·#17~#19), `prompts/gov-tree/03b-collegial-agency/archive/
> README.md`(작업 #16~#17). 이 문서는 그 두 README를 시간순으로 요약한
> 것이며, 정확한 원문·근거 인용은 그쪽을 봐야 한다.

## 0. 범위

2026-09-23~24 진행된 gov-tree(제주 지방행정 SP 트리) 배치 8건(작업
#12~#19)의 시간순 기록이다: "org-baseline 누락 15개 기관 신설 → 사용자
지시로 소방서 현장단위까지 확장 → 합의제행정기관용 새 tier 신설 → 명칭
충돌 정리 → 실제 라이브 스모크테스트로 검증 → 버그 2건 발견·수정 → 더
넓은 재검증"까지 하나로 이어진 흐름이다. **보훈청 라우팅 방향, "문화사랑회"
라우팅 버그, 지방노동위원회 소속 관계는 아직 미해결이며 이 문서는 그것을
해결된 것처럼 적지 않는다.**

## 1. 배경

- `org-baseline-agency.json`의 `missing_in_inventory`(SP 파일 자체가 없어
  대조조차 못 한 법정 기관)에 15개 기관이 남아 있었다.
- 합의제행정기관(감사위원회·지방노동위원회·자치경찰위원회) 3곳은 기존
  K-FOI digest 6개 유형(do/jeju-si/seogwipo/agency/org/emd) 어디에도
  담을 수 없어 `open_questions`에 "새 범주가 필요하다"로만 남아 있었다.

## 2. 작업 #12~#14 — missing_in_inventory 9개 기관 신설(2026-09-23)

- **#12**: 공공정책연수원(division 1)·보훈청(division 3) — 별표8 원문
  확인, confidence: high. `JEJU_NATIONAL_TABLE`에 이미 `SP-NAT-VETERANS`가
  있다는 명칭 중복을 이때 발견했지만 미해결로 남김(→ #19에서 실제 버그로
  터짐, §6).
- **#13**: 문화예술진흥원·해양수산연구원·동물위생시험소·설문대여성문화
  센터·돌문화공원관리소·고용센터·중앙협력본부 7개 기관·division 17개 —
  별표9 원문, confidence: high. 고용센터·중앙협력본부는 이미 다른 이름의
  SP가 존재한다는 명칭 중복을 발견(→ #17에서 정리).
- **#14**: 제주환경자원순환센터·제주안전체험관 2개 기관·division 5개 —
  **별표8·9 원문에 이 두 기관의 division별 분장사무가 전혀 없음을 확인한
  뒤**, 기관명·과 이름에서 추정한 최소 범위(과당 3~5건)만 담아 신설하고
  confidence를 명시적으로 "low"로 표기했다(#12·#13의 high와 다른 등급).

24개 SP 모두 신설 시점에 task_key 미배선을 먼저 확인한 뒤 archive 이동
없이 신설만으로 끝났다.

## 3. 작업 #15 — 소방서 4곳 현장단위까지 48개 파일 신설(2026-09-24, 사용자 명시적 지시)

**사용자(프로젝트 총괄)의 직접 지시**: "1항은 현장 단위까지 수십 개 SP를
작성하십시오. 우리가 만든 SP가 있어야 사람 소방서 직원들이 오류를 수정
갱신할 수 있습니다." 정확도가 완벽하지 않아도 정직하게 초안(draft)으로
표시하며 현장단위(119안전센터·구조대·지역대)까지 뼈대를 만들라는 지시다.

- **신설 규모**: 기관 4개(제주·서귀포·서부·동부)·division 13개·현장단위
  SP 31개, 총 48개 파일.
- division 13개는 별표8 원문 확인(confidence: high) — 제주소방서는 4개
  과(예방/대응 분리), 나머지 3개서는 3개 과(예방구조과로 통합) 구성.
- 현장단위 31개는 원문이 없어 나무위키·언론 보도(2차 출처)로 채웠다.
  119지역대(김녕·성읍·우도) 3곳은 원 지시서에 3개 소방서 모두에 중복
  기재돼 있었으나 위키 표 추출 오류로 판단, **동부소방서 산하로만**
  신설했다(우도는 언론 보도로 확인, 김녕·성읍은 관할구역 정황 추정 —
  confidence: low).
- **라우팅 설계 결정**: 현장단위 31개는 라우팅 테이블에 등록하지 않았다
  — 짧은 지명 키워드("이도"·"화북"·"성산")가 다른 동 기관과 오탐 충돌할
  위험이 크고, 실사용자가 특정 안전센터를 직접 지목하는 경우가 드물다고
  판단했기 때문이다. LLM 라우팅은 과(division) 레벨까지가 합리적이라는
  결론이며, 현장단위 SP는 상위 기관 SP가 참고하는 문서로만 존재한다.

## 4. 작업 #16 — 합의제행정기관용 새 K-FOI tier(`collegial`) 신설(2026-09-24)

감사위원회·지방노동위원회·자치경찰위원회는 지방자치법 제130조 근거의
독립적 의사결정 합의체로, 도지사 소속 집행조직(03-do-agency, 제125조)과
조직법적 성격이 다르다. 기존 6개 유형에 끼워맞추지 않고 새 tier로 분리했다.

- 새 디렉토리 `prompts/gov-tree/03b-collegial-agency/`, 새 SP 코드 접두어
  `SP-COMM-*`(institution)/`SP-COMMDIV-*`(division), 새 org-baseline 파일
  `org-baseline-collegial.json`.
- `tools/build_kfoi_digest.mjs` 스키마 변경 4곳(최소 침습): `ORG_BASELINE_
  FILES`에 `collegial` 항목, `TIER_LABELS`에 `collegial: '합의제행정기관'`,
  `staticTiers`에 `['collegial', data.DO_COLLEGIAL, '03b-collegial-agency',
  'committee']`, `applyOrgBaseline`의 kind 조건문에 `'committee'` 추가
  (누락 시 org-baseline 대조가 조용히 비어버리는 결함을 테스트로 발견해
  즉시 수정).
- `gov-router.js`에 `collegial`/`collegialDivision` 테이블·accessor·fetch·
  division 판정 함수를 agency/org와 동일 패턴으로 추가, 메인 매칭 흐름에
  agency→org 실패 후 마지막으로 collegial을 시도하도록 배선.
- 사무 원문 확보 여부는 기관마다 다르다: 지방노동위원회 사무국·자치경찰
  위원회 자치경찰총괄과는 별표10 원문 확인(high). 자치경찰협력과는 별표10에
  없고 옛 이름 "자치경찰정책과" 원문을 잠정 사용(medium). 감사위원회
  4개 division은 별표10에 아예 없어 명칭 추정만(low).
- **명칭 충돌 3건 발견, 이 배치에서는 기록만**: (1) 지방노동위원회 vs
  `SP-NAT-LABORREL`(고용노동부) — 같은 실체를 다른 소속으로 가리킬
  가능성이 큼. (2) 자치경찰위원회 vs 자치경찰단(`SP-AGY-POLICE`) — 별개
  기관임만 확인. (3) 감사위원회 vs bare "감사" 키워드.

## 5. 작업 #17 — 명칭 충돌 3건 중 확정 가능한 것만 정리(2026-09-24)

프로젝트 총괄에게 직접 확인(AskUserQuestion)+웹 조사로 결론이 난 3건만
정리했다.

1. **고용센터**: `SP-DIV-ECON-EMPLOYCENTER`(경제활력국 산하 division으로
   잘못 모델링된 옛 SP)를 archive로, `SP-AGY-EMPLOYMENT`(#13에서 신설,
   위키백과로 실제 도 직속 사업소임을 확인)로 일원화. task_key 미배선을
   재확인 후 이동.
2. **중앙협력본부**: `SP-DO-LIAISON`(스스로 "초안"이라 밝히던 옛 SP)을
   archive로, `SP-AGY-CENTRALCOOP`(#13에서 신설)로 일원화. 상속 템플릿도
   다른 인스턴스 없음을 확인해 함께 archive.
3. **자치경찰위원회 ↔ 자치경찰단**: 둘 다 별개 법인격이라 삭제하지 않고,
   자치경찰위원회(`SP-COMM-POLICE`)가 자치경찰단(`SP-AGY-POLICE`)을
   지휘·감독하는 상급기관이라는 관계의 **방향**을 jeju.go.kr·삼다일보
   보도로 확인해 양쪽 SP에 상호 참조로 문서화(둘 다 유지).

**지방노동위원회는 이번에도 건드리지 않았다** — 프로젝트 총괄이 "확실하지
않음, 다음 배치에서 더 조사"라고 답해 open_questions에 그대로 남겼다.

## 6. 작업 #18~#19 — 라이브 스모크테스트, 버그 2건 발견·수정(2026-09-24)

**#18**: 프로젝트 총괄 요청으로 기존 선례(`gov_router_2026_08_21_
department_live_smoketest.mjs`)를 복제해, batch13~17에서 생긴 기관 18개
코드 전부를 커버하는 22개 시나리오를 신설
(`tests/live_smoketest/gov_router_2026_09_24_new_agencies_live_
smoketest.mjs` + 대응 워크플로). `DEEPSEEK_API_KEY`가 없어 이때는 문법
검증·오프라인 kw 시뮬레이션(13/22건 kw만으로 성공)까지만 하고 완전한
검증은 GitHub Actions 수동 실행으로 미뤘다.

**#19 — 실제 GitHub Actions 실행 결과 22건 중 2건 실패, 근본원인 규명·수정**:

- **버그 1 — 보훈청 명칭 충돌**: `veterans-registration`("국가유공자
  등록을 하고 싶은데 어디로 가야 하나요") → 실제 `SP-NAT-VETERANS`,
  기대 `SP-AGY-VETERANS`. 원인: 국가기관↔지방행정 충돌 안전망
  `_localGovCollisionCandidate()`가 시청 국·도청 실국 2계층만 검사하고
  **03-do-agency(직속기관) 계층은 검사 대상에서 빠져 있었다.** `_agencyTable()`
  검사를 추가해 수정(cityDept→agency→l2 순). classifyFn 없이도 항상
  충돌검사를 실행하도록 바꿔봤다가 `national-agency-100-scenarios.
  test.mjs`에서 8건 새 회귀가 나 원복(`natMatch && classifyFn` 가드는
  의도적 설계임을 재확인).
- **버그 2 — 자치경찰위원회/자치경찰단 명칭 충돌**:
  `police-committee-deliberation` → 실제 `SP-AGY-POLICE`, 기대
  `SP-COMM-POLICE`. 원래 가설("전역 LLM 안전망이 collegial을 후보에
  안 넣어서")은 **틀렸다** — 실측 로그로 확인한 진짜 원인은
  `_resolveInstitutionMatch`의 "zero-score LLM 폴백" 경로가 agency
  테이블 하나+L2 1등 후보만 구성해 **org/collegial 계층 자체가 후보
  목록에 없었다**는 것(agency 27개 후보 중 `SP-COMM-POLICE`가 전혀
  없음을 로그로 확인). 수정: `_resolveInstitutionMatch(...,
  siblingTables=[])` 5번째 인자를 추가해 zero-score·약한·강한 매칭
  LLM 후보 구성부 전부에 형제 테이블 병합(agency 호출엔
  `[_orgTable(), _collegialTable()]`, org 호출엔 `[_collegialTable()]`).
  결과 코드의 실제 출신 테이블을 접두어로 판별하는 디스패처
  `_resolveInstitutionDivision`도 신설.

수정 후 오프라인 mock 재현·해소 확인, 기존 회귀 스윕(`kfoi-digest`·
`check_stale_refs`·`src/tests/*.test.mjs` 27개 파일)에서 수정 전과 동일한
8개 파일 실패(사전 존재, 무관)만 유지되고 새 회귀 0건임을 `git stash`
대조로 확인했다.

### 42건(broad) 재검증 신설 + 실제 재실행 결과

같은 #19에서 "더 폭넓은 발화로 한 번 더" 지시에 따라
`gov_router_2026_09_24_new_agencies_broad_live_smoketest.mjs`(42개
시나리오, 격식체/반말/간접표현/복합질문, 애매한 경계 4건은 `info: true`
관찰 전용)를 신설했다(기존 22건 파일·워크플로는 유지).

**이 문서를 쓰는 시점(2026-09-25)에 두 워크플로 모두 실제 GitHub Actions에서
`DEEPSEEK_API_KEY`와 함께 재실행된 결과를 `results/live-smoketest-gov-router-
2026-09-24-new-agencies`·`-broad` 브랜치에서 직접 확인했다**:

| 스모크테스트 | 총 건수 | 통과 | 실패 | 실패 항목 |
|---|---|---|---|---|
| 22건(narrow, 재검증) | 22 | 21 | 1 | `veterans-registration` |
| 42건(broad, 신규) | 42 | 36 | 2 | `veterans-registration-casual`, `cultureearts-friends-society`(info 4건 별도) |

- **자치경찰위원회 버그(버그 2)는 완전히 해결됐다** — 두 결과 어디에도
  자치경찰위원회 관련 실패가 없다. 42건에는 반말 포함 자치경찰위원회 4건·
  자치경찰단 대응쌍 2건이 재검증으로 들어 있고 전부 정확히 갈렸다.
- **보훈청은 여전히 미해결이다.** 22건·42건 모두 "국가유공자 등록" 계열
  발화가 실제 LLM 판단으로 `SP-NAT-VETERANS`(국가기관)로 확정됐다 — #19의
  코드 수정은 국가기관 즉시확정을 막고 LLM에게 두 후보를 함께 주도록
  했을 뿐, **LLM 자신이 국가기관을 고르는 것까지 막지는 못한다.** 국가
  유공자 "등록" 자체가 원칙적으로 국가보훈부 소관이라는 해석과,
  `SP-AGYDIV-VETERANS-COMPENSATION` §2 원문(별표8 "각종 등록에 관한
  사항")이 도 직속기관 사무로 명시돼 있다는 사실이 충돌한다 — 이게
  실제로 법리상 맞는 결과인지는 다음 배치에서 확인해야 한다.
- **새로 발견된 버그(미수정)**: `cultureearts-friends-society`("문화사랑회
  회원 가입 관련해서 문의드리고 싶습니다", 문화예술진흥원 운영과
  division kw) → 실제 `SP-DO-CULTURE`(도청), 기대 `SP-AGY-CULTUREARTS`.
  "문화사랑회"가 division(운영과) kw에만 있고 상위 기관 kw 목록에 대표
  문구가 없어 기관 매칭 단계에서부터 도청으로 새는 구조적 문제로 추정된다
  (§7 교훈 (a) 참고). **아직 코드 수정 전 — 다음 배치 과제.**

## 7. 작업 방식 교훈(향후 개발자용)

- **(a) division 전용 키워드는 상위 기관 레벨 kw에도 대표 문구를 넣어야
  한다.** 기관 매칭이 division 매칭보다 먼저 실행되므로, division kw에만
  있고 기관 kw에 없는 고유명사는 기관 단계에서부터 다른 SP(특히
  SP-DO-*)로 오매칭될 수 있다("문화사랑회" 버그 참고).
- **(b) 새 SP 신설 전 반드시 gov-router.js 전수 검색.** VETERANS·
  EMPLOYMENT·CENTRALCOOP·자치경찰·감사위원회까지 이번 세션에서만 명칭
  충돌 5건 이상을 발견했다 — 새 기관명·division명으로 `JEJU_NATIONAL_
  TABLE`·`JEJU_DO_TABLE`·`division-tables.js`를 미리 grep하는 절차를
  생략하면 안 된다.
- **(c) 모든 배치는 patch 전달(`git format-patch`/`git am`)로만 이뤄졌다**
  — 직접 push 권한이 없다.
- **(d) 라이브 스모크테스트는 `DEEPSEEK_API_KEY` GitHub secret이 있어야
  완전히 검증된다.** 이 저장소엔 이미 등록돼 있어 `gh workflow run
  live-smoketest-gov-router-2026-09-24-new-agencies.yml`(또는 `-broad.yml`)
  로 언제든 재실행 가능하고, 결과는 `results/live-smoketest-gov-router-
  2026-09-24-new-agencies`(`-broad`) 브랜치의 `results.json`에 남는다.

## 8. 아직 남은 작업(정직하게 명시)

1. **보훈청 라우팅 방향 결정** — "국가유공자 등록"을 `SP-NAT-VETERANS`
   (국가)로 보낼지 `SP-AGY-VETERANS`(도 직속기관)로 보낼지 법리 확인
   필요. 현재 실제 배포는 국가기관 쪽으로 확정되고 있다.
2. **"문화사랑회" 라우팅 버그 수정** — `SP-DO-CULTURE`로 새는 구조적
   문제(division 전용 kw가 기관 레벨에 없음). 코드 수정 전.
3. **지방노동위원회 소속 관계 확인** — `SP-COMM-LABOR`(도 소속)와
   `SP-NAT-LABORREL`(고용노동부 소속)가 같은 실체를 가리키는지 확정 필요.
4. 작업 #14(제주환경자원순환센터·제주안전체험관)·#16(감사위원회 division
   4개, 자치경찰협력과)의 confidence: low/medium 항목은 실제 서비스
   라우팅(task_key) 연결 전 재검증 필요.
5. 작업 #15 소방서 현장단위 31개(특히 김녕·성읍 119지역대 소속 추정)는
   실제 소방서 직원 검증·수정 전까지 확정된 사실로 취급하면 안 된다.

## 관련 문서

- `prompts/gov-tree/03-do-agency/archive/README.md`(작업 #12~#15·#17~#19)
- `prompts/gov-tree/03b-collegial-agency/archive/README.md`(작업 #16~#17)
- `prompts/gov-tree/kfoi-digest/org-baseline-agency.json`,
  `org-baseline-collegial.json`
- `tools/build_kfoi_digest.mjs`, `src/gopang/gov/gov-router.js`,
  `src/gopang/gov/division-tables.js`
- `tests/live_smoketest/gov_router_2026_09_24_new_agencies_live_
  smoketest.mjs`, `gov_router_2026_09_24_new_agencies_broad_live_
  smoketest.mjs`
- `results/live-smoketest-gov-router-2026-09-24-new-agencies`,
  `results/live-smoketest-gov-router-2026-09-24-new-agencies-broad`
  브랜치의 `results.json`
