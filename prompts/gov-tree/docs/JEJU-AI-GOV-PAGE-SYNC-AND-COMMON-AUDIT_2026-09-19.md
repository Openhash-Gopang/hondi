# 「제주 AI 행정」 페이지 정합성 정비 + 공통 SP 실사 — 2026-09-19

## 1. 페이지 반영 (pages/jeju-gov-automation.html)

도청 실·국 8개가 저장소에는 실재하나 페이지 `DO_BUREAUS`에 없었던 것을 확인 후
추가했다: `SP-DO-AIGOV`(AI행정혁신추진단), `SP-DO-AIRPORTSUP`(공항확충지원단),
`SP-DO-AUTONOMY`(특별자치제도추진단), `SP-DO-BALANCE`(도시균형추진단),
`SP-DO-BASICSOC`(기본사회추진단), `SP-DO-GANGJEONG`(강정공동체사업추진단),
`SP-DO-GENDER`(성평등여성정책관), `SP-DO-LABOR`(노동안전감독관).

기존에 `spId: null`(미배정)로 남아있던 4개(총무과·소통청렴담당관·중앙협력
본부·대변인)도 실제로는 `SP-DO-GENERAL`/`SP-DO-COMM`/`SP-DO-LIAISON`/
`SP-DO-SPOKES`로 존재함을 확인해 연결했다(소통청렴담당관은 최신 버전에서
"소통담당관"으로 개칭돼 있어 표기도 함께 갱신).

결과: 도청 실·국 13(과 존재) + 12(단일창구) = **25개**로 정정
(기존 페이지는 17개만 반영, 그중 4개는 SP 자체가 없는 것으로 잘못 표시돼 있었음).

## 2. "공통 SP"의 실제 정체 재확인 — JEJU-GOV-COMMON은 죽은 문서

`src/gopang/gov/gov-router.js`의 `_loadGovCommon()`을 직접 읽어, 지금 실제로
조립되는 공통 레이어가 `00-common/JEJU-GOV-COMMON_v1.x.md`가 **아니라** 다음
7개 조합임을 코드로 확인:

1. `prompts/SP-10_kpublic_v3.25.txt` (kgov)
2. 코드 내 하드코딩 전문가 SP 상속 선언문
3. `prompts/SP_common_guardrails_v3_30.md` (SP-COMMON-02)
4. `08-schema/HUMAN-AUTHORITY-GATE-SCHEMA_v1_4.md`
5. `00-common/overlays/GOV-COMMON-OVERLAY-TEMPLATE_v1.1.md` + 오버레이 데이터
6. `00-common/GOV-TREE-PROTOCOL_v1.0.md`
7. `prompts/AGENCY-AC-COMMON_v1.5.md`

`JEJU-GOV-COMMON_v1_5.md` 자신의 헤더가 이미 2026-07-09에 이 사실을 선언해
뒀었고, 이번 세션에서 그 주장을 실제 파일 존재·grep 검증으로 재확인했다
(§10 정직성/GAP_LOG, §11 능동적역량, §13 PDV_REQUEST, §14 적극적 보조 원칙
전부 kgov/SP_common_guardrails/UNIVERSAL-common 쪽에 실재).

**조치**: `JEJU-GOV-COMMON_v1_1~v1_5.md` 5개 전부를
`00-common/archive/`로 이동, 검증 근거를 담은 README 동봉. 유실된 원칙 없어
7개 살아있는 파일 쪽에 추가 반영할 내용은 없음.

## 3. 도청 버전 중복 정리

`SP-DO-COMM_v1.0`(→v1.1로 대체, 소통청렴담당관→소통담당관 개칭 반영),
`SP-DO-INNOV_v1.1`(→v1.2로 대체, 혁신산업국→미래산업국 개칭 반영) 구버전을
`02-do-dept/archive/`로 이동.

## 4. 이번에 발견했으나 아직 처리하지 않은 것 (다음 세션 후보)

- **버그 의심**: `renderBureauStrip()`의 `doPath = pathBase + b.spId + '.md'`가
  버전 접미사(`_v1.1` 등) 없이 파일명을 구성한다. 실제 파일은 전부
  `SP-DO-WELFARE_v1.2.md`처럼 버전이 붙어있어, 25개 도청 국 전부의 "SP 원문/
  저장소에서 보기" 링크가 404일 가능성이 있다(직속기관·출자출연기관·시청
  국 단위도 동일 함수를 씀 — 영향 범위가 이 페이지 전체일 수 있음). 오늘
  범위 밖이라 손대지 않음 — 별도 확인·수정 필요.
- `SP_common_guardrails_v3_24/25/27/29.md`, `UNIVERSAL-common_v1_9/10/11.md`가
  최신본 옆에 미아카이브 상태로 남아있음(경미).
- `07-org`는 제주 26개 + 전국 타 시도 약 245개가 같은 폴더에 혼재 — 이번
  "제주 AI 행정" 작업 범위에서는 제주 26개만 다룬다는 점을 재확인.

## 5. 다음 단계

7개 살아있는 공통 파일(특히 kgov 65KB, SP-COMMON-02 177KB) 내용을 다듬는
작업으로 진행.
