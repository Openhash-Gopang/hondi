# 세션 요약 — 「제주 AI 행정」 SP 정비 전 과정 + k-services.html 개편 (2026-09-20)

주피터님 지시로 시작된 "제주 AI 행정" 330여개 SP 정비 프로젝트의 전 과정과,
그 사이 요청받은 k-services.html 개편 작업을 정리한다. 같은 저장소를
다른 세션(관제탑 원칙 라이브 스모크테스트, 콘텐츠 품질 스크리닝)이 동시에
건드리고 있었기 때문에, 두 작업 흐름이 서로 어떻게 연결됐는지도 함께
기록한다.

## 1. 「제주 AI 행정」 페이지 ↔ 저장소 정합성 감사

- `pages/jeju-gov-automation.html`의 도청 실·국이 17개로 표시돼 있었으나
  실제 저장소엔 8개가 더 있었다(AI행정혁신추진단 등) — 페이지에 반영해
  25개로 정정. `SP-ORGDIV-JILES-LIFELONG` 깨진 링크(중복 항목, 실제
  파일 없음)도 제거.
- SP 인벤토리를 342개로 재확정(도청 8개 반영 후).

## 2. "공통 SP"의 실제 정체 재확인

`00-common/JEJU-GOV-COMMON_v1.x.md`를 공통 SP로 오인했으나, `gov-router.js`
코드를 직접 대조한 결과 실제 라이브 체인은 kgov+오버레이+GOV-TREE-PROTOCOL+
AGENCY-AC-COMMON 등 7개 파일 조합이었다 — JEJU-GOV-COMMON 5개 버전은 죽은
문서로 확인 후 archive 이동. gov-tree 전용 공통 4문서(게이트 스키마·
오버레이·TREE-PROTOCOL·AGENCY-AC-COMMON)의 버전/명칭 불일치·낡은 진행상태
표·안 쓰이는 태그 서술을 다듬었다.

## 3. Phase 2 — 342개 SP 구조 감사 + 관제탑 원칙 위반 근본원인 발견

구조 스캔 결과 PASS 231 / PARTIAL 109 / FAIL 1(깨진 링크, 조치 완료).
그 과정에서 **§2("완결 처리 업무")가 실행이 아니라 순수 안내 문장으로만
채워진 SP가 112개(35%)** 발견됐는데, 원인을 추적하니 **템플릿 17개
자체에 그 안내형 보일러플레이트가 박혀있던 것** — 근본 수정.

## 4. 다른 세션과의 합류 — 관제탑 원칙 라이브 검증

이 사이 다른 세션이 같은 원칙(C50)을 520개 시나리오로 실제 라이브
검증하고 있었음을 발견 — do-dept 104건 중 103건 LIVE-FAIL(프롬프트 끝
재확인 문구 누락)을 찾아 수정(PR #377), 재검증 전부 PASS. 이후 나머지
카테고리 50건 표본도 성공. 이쪽 작업(§2 콘텐츠 내용)과 그쪽 작업(프롬프트
내 위치/형식)은 같은 원칙의 다른 발현이라 서로 겹치지 않았다.

## 5. 콘텐츠 품질 스크리닝 — 사무분장 정합성·환각 여부

또 다른 세션이 LLM 비평가로 520개(186건 실행) 내용 품질을 스크리닝,
182 PASS / 4 NEEDS-REVIEW. 그 4건(CT-0054 관광정책과, CT-0064 수산정책과,
CT-0172 제주문화예술재단, CT-0293 서귀포 세무과 — 전부 "인접 부서 소관
혼동" 또는 "미확정 사실을 확정처럼 서술")을 재작성. CT-0293은 1차 수정
후에도 재발해 §1 정체성 문단 자체를 "필수 응답 규칙"으로 재작성해서
해결.

## 6. 기타 발견·수정

- **CONTROL-TOWER-PRINCIPLE 매니페스트 키 버그**: `sp-catalog.json`에
  이 키가 아예 없어 `worker.js`의 서버측 경로(`/gov/relay`,
  `/business/relay`)에서 **K-Law·K-Tax·K-Health·K-Police·K-119·
  K-Democracy·K-Insurance·K-Traffic·K-Logistics·K-Public·K-Business
  9~10개 핵심 서비스 전부**가 관제탑 원칙을 한 번도 상속받지 못하고
  있었다 — 키 등록으로 수정.
- **SP_advisor·SP_nurse C39-2 "누락"은 오탐지**였음을 뒤늦게 확인 —
  문자열 매칭만으로 스캔해서 놓친 것으로, 둘 다 실제로는 이미 충족
  상태(작업 불필요로 종결).
- **prompts/ 최상위 페르소나 구버전 307개** archive 정리(972→665개
  파일). 정리 도중 라이브 파일(`AGENCY-AC-COMMON_v1.5.md` 등)까지
  archive될 뻔한 사고를 커밋 전에 발견·복구 — 이후 전수 sanity check를
  추가해 재실행.
- **content_quality_live_smoketest.py의 identityDoc·ownSpAndGates
  "잔여 갭"은 갭이 아니었다** — worker.js의 `NO_IDENTITY_LAYER_AGENCIES`·
  `_fetchOwnSpAndGates`를 대조한 결과, `gov_do` agency(이 시나리오군
  전체)에는 프로덕션 자체가 이 두 레이어를 붙이지 않는다는 걸 확인.
  CONTROL-TOWER-PRINCIPLE 레이어만 추가하고 문서를 정정.
- **저장소 동시성 사고 1건**: 여러 세션이 동시에 push하는 와중에 우리
  PR 하나(페이지+아카이브 정비분)가 병합됐다고 표시됐음에도 실제 main
  히스토리에는 반영되지 않은 채 유실됐다 — 로컬 커밋 객체가 살아있어
  재발행으로 복구.

## 7. k-services.html 개편

- **내부 처리단계 6개 분리**: 의도 파악·실행계획 조합·오케스트레이션
  실행·결과 전달·이해당사자 통지·복합 사안 총괄(K-Intent~K-Report,
  K-Case)을 공개 K-서비스 그리드에서 빼서 히어로 안내문 바로 아래
  별도 섹션으로 이동.
- 이 6개 각각에 **실제 SP 원문(STEP/PHASE 알고리즘) 기반 개요 다이어그램
  + 접이식(아코디언) STEP 상세**를 신설 — SP-19_kintent, SP-20_kcompose,
  SP-22_kexecute, SP-21_kdeliver, SP-23_kreport, K-Case 원문을 직접 읽어
  실제 분기 구조(캐시 조회, 병렬/팬아웃 join·notify, 인간 전속 경계,
  일치도 검증 게이트 등)를 반영.
- 탭 라벨 11개 축약(응급신고→응급 등), 메일 탭을 그리드 맨 앞으로 이동.

## 8. 남은 과제 (다음 세션)

- 매니페스트에 안 걸린 4개 그룹(9개 파일) — `ROUTING-BRANCH-REFERENCE`·
  `SP-AUTHOR-EXPERT`·`AC-AUTHOR-ORG`·`AGENCY-COMMON-TEMPLATE` 실사용
  여부 재조사.
- §3(안내/연계 섹션) 누락 SP들의 배치 정비.
- `prompts/gov-tree/07-org` 전국 확장분(제주 외 약 245개)과 제주분 26개의
  스코프 재정리.

상세 근거·수치는 `prompts/gov-tree/docs/PHASE2-STRUCTURAL-AUDIT-AND-PERSONA-C39-2_2026-09-19.md`,
`docs/SESSION_SUMMARY_CONTENT_QUALITY_LIVE_SMOKETEST_20260920_v1_0.md`,
`docs/SESSION_SUMMARY_CONTROL_TOWER_LIVE_SMOKETEST_20260919_v1_0.md` 참고.
