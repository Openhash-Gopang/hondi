# 관제탑 원칙(CONTROL-TOWER-PRINCIPLE) 520개 gov-tree SP 전수 라이브 스모크테스트 — 세션 종합 기록

**작업일**: 2026-09-19
**범위**: `pages/jeju-gov-automation.html`에 등록된 520개 SP(도청 실·국 79 + 직속기관 37 + 출자출연기관 110 + 제주시청 60 + 서귀포시청 50 + 읍면동 43개×184팀), 그중 표본 154건(do-dept 104건 전수 + 나머지 5개 카테고리 각 10건) 실제 DeepSeek 라이브 호출로 검증
**전제 문서**: `INCIDENT_2026-09-18_l1-hanlim-pocketbase-crashloop-recovery.md`의 "남은 후속 작업" 절

이 문서는 하루짜리 세션 안에서 있었던 (1) 핸드오프 문서 우선순위 작업 5건, (2) 520개 SP 전수 관제탑 원칙 라이브 스모크테스트 구축, (3) 실사에서 드러난 심각한 결함(99% 위반)의 원인 규명과 수정, (4) 수정 후 재검증까지를 정리한다.

---

## 1. 핸드오프 문서 우선순위 작업 (전부 완료·머지)

| PR | 내용 |
|---|---|
| #368 | `pb_hooks/main.pb.js` `_balanceUtils is not defined` 삭제훅 버그 수정 (PocketBase Goja 엔진의 top-level IIFE가 콜백 내부에서 안 보이는 구조적 제약 — 콜백 내부에 로컬 재선언) |
| #371 | 동일 계열의 `_sigVerify` ReferenceError 수정(profiles PATCH 콜백) |
| #373 | `apply-pb-migrations.sh`에 서버 잔재 마이그레이션 파일 정리(reconcile) 로직 추가 — 9/18 crash-loop(마이그레이션 파일 잔재 충돌) 재발 방지 |
| #374 | `apply-pb-hooks.sh`의 `RAW_URL`이 아카이브된 옛 저장소(`Openhash-Gopang/gopang`)를 가리키고 있던 것을 `hondi`로 수정 — hanlim에 2026-09-06 이전 구식 pb_hooks가 매 배포마다 조용히 재적용되고 있었음을 확인·시정 |

6개 PocketBase 인스턴스(hanlim·l2-jeju·l2-seogwipo·l3-jejudo·l4-kr·l5-global) 전부 sha256sum 대조로 배포 검증 완료. l3-jejudo의 `tensor.city@gmail.com` admin 비밀번호도 원복.

---

## 2. 520개 SP 관제탑 원칙 라이브 스모크테스트 구축

`tests/live_smoketest/scenarios_control_tower_govtree_jeju_20260809.json`(9건 샘플)에 이미 있던 인프라(`render_govtree_prompts.mjs` + `control_tower_live_smoketest.py` + `.github/workflows/live-smoketest-control-tower-govtree.yml`)를 재사용해, 페이지에 등록된 520개 SP 전수 시나리오 파일(PR #375, `scenarios_control_tower_govtree_jeju_full520_20260919.json`)을 만들었다.

- directCode는 `pages/jeju-gov-automation.html` 자체의 `doDeptUrl`/`doAgencyUrl`/`orgUrl`/`cityDeptUrl`/`cityDivUrl`/`teamUrl` 헬퍼 로직을 그대로 재현해 생성 — 국/부서 자체와 그 산하 division이 각각 별도의 addressable SP로 카운트되는 집계 방식(336(도청+시청 계열) + 184(읍면동 팀) = 520)도 페이지 원본 로직과 대조해 확인.
- utterance는 각 SP 이름을 채운 "~에서 처리하는 민원 절차를 전부 알려줘" 공통 템플릿(목록/설명 덤프를 유도하는 압박 질의 — 관제탑 원칙이 "전부 알려달라"는 요청에도 버티는지를 보는 의도적 스트레스 테스트).

**실행 중 실제 저장소 버그 1건 추가 발견·수정(PR #376)**: `prompts/gov-tree/04-city/templates/city-dept-master-data.json`의 서귀포시 농수축산경제국 항목이 존재하지 않는 파일(`SP-CITYDEPT-AGRIECONOMY-TEMPLATE_v1.0.md`, 실제 파일명은 `SP-CITYDEPT-AGRI-TEMPLATE_v1.0.md`)을 가리키고 있어 국 자체 + 산하 division 6개(7개 SP)가 렌더 단계에서 404로 전부 실패하고 있었다.

또한 워크플로 타임아웃(30분)이 520건 순차 실행에 부족해, 520건을 CT-0001~0104 / 0105~0208 / 0209~0312 / 0313~0416 / 0417~0520 순서로 5개 파일(각 104건)로 분할했다.

---

## 3. 실사 결과 — 99% 위반, 원인 규명, 수정

part1(도청 실·국 do-dept 104건)을 실제 DeepSeek로 라이브 실행한 결과:

**LIVE-FAIL 103건, LIVE-NEEDS-REVIEW 1건, PASS 0건**

거의 전수가 마크다운 헤더(#/##/###)·볼드(**...**)·불릿/번호 목록을 써서 관제탑 원칙(한 번에 한 단계, 문서 서식 금지)을 위반했다.

### 3-1. 원인 진단

CT-0001의 실제 렌더 결과(4516줄)를 직접 열어 확인한 결과, `CONTROL-TOWER-PRINCIPLE`(C50 절)은 시스템 프롬프트에 정상적으로 주입되어 있었다 — 즉 **주입 자체는 결함이 아니었다.** 다만 그 문구가 전체 프롬프트의 2920번째 줄, 즉 수천 줄에 달하는 기관 본문(agencyPrompt) 한가운데 묻혀 있었다.

별도로, `src/gopang/ai/call-ai.js`에는 이미 코드 레벨 재시도 안전망(`_violatesConversationalStyle`로 위반 감지 → `_enforceConversationalStyle`로 최대 2회 재작성 강제)이 있으나, 이는 브라우저 대화 흐름(`callAI`)에만 있는 방어망이라 우리 스모크테스트(DeepSeek API 직접 1회 호출)는 이를 거치지 않는다 — 즉 이번 99% 수치는 "실사용자 최종 응답" 기준이 아니라 "모델 1차 원본 응답" 기준이다. 다만 1차 응답이 이 정도로 자주 어긋나면 실제로도 재시도 API 호출이 거의 매번 발생한다는 뜻이라(비용·지연), 안전망에 기대기보다 1차 응답부터 원칙을 지키게 하는 게 맞는 방향으로 판단했다.

### 3-2. 조치 (PR #377)

이 코드베이스가 위치/날짜 안내(`_buildLocationNote`/`_buildDateNote`)에 이미 쓰고 있는 "나중 위치가 이긴다" 패턴을 그대로 적용해, 짧고 단호한 재확인 문구를 프롬프트 맨 끝(agencyPrompt·위치·날짜 안내보다도 뒤)에 추가했다. 두 경로 모두에 동일하게 적용:

- `worker.js` `handleGovRelay()` — 실제 서버 배포 경로
- `src/gopang/gov/gov-router.js` `assembleGovSystemPrompt()` — `pages/regional-gov.html`의 클라이언트 실행 경로이자 `render_govtree_prompts.mjs`가 검증하는 경로(각 tier 분기의 개별 return이 아니라 공용 래퍼 한 곳에 적용해 전체 tier에 일괄 반영)

`call-ai.js`의 코드 레벨 재시도 안전망은 그대로 유지 — 이건 그 안전망에 기대는 재시도 횟수 자체를 줄이기 위한 1차 방어선 보강이다.

### 3-3. 재검증

- do-dept 실패 103건 중 무작위 10건(CT-0006/0009/0017/0019/0047/0067/0076/0085/0096/0101) 재실행 → **10/10 PASS**
- 나머지 5개 카테고리(do-agency·org·jejusi·seogwipo·emd/team) 각 10건씩 무작위 50건 재실행 → **50/50 PASS**

총 60건 표본 전부 통과로 조치 효과를 확인했다. 나머지 460건(do-agency 27건·org 100건·jejusi 50건·seogwipo 40건·emd 174건)은 표본 추출로 대체하고 전수 재검증은 생략했다 — 필요 시 `tests/live_smoketest/scenarios_control_tower_govtree_jeju_full520_20260919_part{1~5}of5.json`으로 이어서 실행 가능.

---

## 4. 오늘 머지된 PR 전체 목록

#368, #371, #373, #374, #375, #376, #377 (총 7건)

## 5. 남은 과제

520개 SP 각각의 **내용 품질**(사실관계 정확성·최신성·과별 사무분장 정합성 등, 형식 준수와는 별개 축)은 이번 세션에서 다루지 않았다 — 후속 세션 인수인계서(`HANDOFF_2026-09-19_jeju-sp-quality-evaluation.md`) 참조.
