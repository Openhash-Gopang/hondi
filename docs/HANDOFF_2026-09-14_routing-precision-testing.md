# 인수인계서 2026-09-14 — AC 라우팅 정밀도 전수 테스트

마지막 확인 커밋: `dcc3216 fix(gov-router): 대학/학교 증명서 전용 노드(SP-NAT-EDUCERT) 신설`
(이 뒤로 커밋이 더 있을 수 있으니 새 세션 시작하면 `git log -3`로 먼저 재확인할 것)

## 오늘 한 일 (시간순 요약)

**전반부 — 개별 버그 수정** (라우팅 테스트 착수 전)
1. "AI 메신저" 패널에 위치 컨텍스트([현재 위치]) 배선이 아예 안 돼 있던 문제 수정
2. 같은 패널에 leaf 액션 태그 5종(재무제표 조회·K-Search 실행·무주인 프로필 생성·정부 서류 접수·부서 업무 요청) 미이식 발견·이식, "AI 메신저 테스트 버전" 이름표를 "최신 버전"으로 정정
3. 결함 A(부서/직원 PDV 미기록, PR #269) 머지, 결함 B(GDC 결제 전 확인 게이트 부재) 조치
4. 원인 진단용으로 잠시 넣었던 노란 배너(TEMP DIAGNOSTIC) 제거

**후반부 — 라우팅 정밀도 3단계 전수 테스트** (오늘 대부분의 시간)

- **1단계: K-서비스(30개)+전문가 페르소나(63개 상위 카테고리)** — 명시형/암시형 발화 각각 테스트.
  - K-서비스: 30/30 커버(1차 60건). `kplan`/`kjob`/`kqna`/`kusers` 경계 케이스 소수 있었으나 대부분 정상.
  - 전문가 페르소나: 63개 전부 4배치로 커버(named 60/60, implied는 여러 차례 트리거 보강 거쳐 계속 상승).
  - `expert-registry-core.js`/`expert-registry-professor.js`에 트리거 보강 다수 — 공통 패턴: **description/label이 이미 특정 세부 항목을 포함한다고 명시하는데 실제 `triggers` 배열엔 그 키워드가 없는 경우**가 반복 발견됨(tax-accountant의 "M&A 실사", kinsurance의 "산재" 등).

- **2단계: professor 158개+ 세부 과목 게이트** — `subject-gate.js`의 `refineToLeaf()` 검증.
  - **중대 발견**: 기존 테스트 하네스(`subject_gate_live_smoketest.py`)가 8/10에 있었던 flat→계층형 리팩터를 놓치고 옛날 방식(308개 후보 한 프롬프트)으로 계속 테스트하고 있었음 — 전면 재작성(`get_gate_level.mjs` 신설, 트리를 한 단계씩 내려가며 재현).
  - 재작성 과정에서 **프로덕션 코드(`subject-gate.js`) 자체의 버그도 발견·수정**: `max_tokens` 1500으로는 특정 발화에서 reasoning만으로 토큰이 다 소진되는 사례가 실사로 확인돼 4000으로 상향(테스트만이 아니라 실서비스 정밀도에 영향).
  - 중계열 라벨에 세부 항목 힌트 다수 추가(재료 중계열→반도체, 의료 중계열→수의학, 기타 중계열→교양자연과학, 미술 중계열→디자인, 응용예술 중계열→애니메이션, 교통·수송 중계열→항공운항).
  - 최종: stage2(18개) 18/18, gapfill(38개) 37/38.
  - **미해결 1건**: `professor-gap-09`(기계공학, "열역학이랑 유체역학" 동시 언급) — `max_tokens` 4000까지 올려도 reasoning만 14000~16000자 소진하고 답을 못 냄. 등록부 라벨 문제로 안 보여서 손 안 댐 — 재현되는지 관찰만 하는 중.

- **3단계: 공공기관(institution) 테스트** — 여기서 제가 두 번 판단을 뒤집는 실수를 했다(교훈 참고). 제가 직접 institution 시나리오를 만들었다가 채점 기준이 틀렸다는 걸 뒤늦게 확인, 대신 **기존에 이미 있었지만 완료된 적 없는 인프라**(`gov24_corpus_live_smoketest.mjs` + 정부24 실제 민원 350건, 7배치)를 발견해 그쪽으로 전환.
  - Windows에서 `path.join()` 절대경로를 `import()`에 그대로 넘기면 실패하는 버그 수정(`pathToFileURL` 적용, `gov_router_2026_08_21_department_live_smoketest.mjs`도 동일 수정).
  - 채점 자동화 대신 `gov24_corpus_report.py` 신설 — "명백한 실패"만 자동 플래그하고 나머지는 사람이 대조하도록 설계(자동 PASS/FAIL로 오판했던 실수를 반복 안 하려고 의도적으로 이렇게 만듦).
  - batch1(50건) 실행·전수 검토 → 진짜 결함 2건 확정·수정:
    - `SP-NAT-TAX`(국세청) 트리거에 "소득금액증명"/"납세증명서" 누락 → 추가(커밋 `fc52cf4`)
    - 대학/학교 증명서(졸업증명서·성적증명서·졸업예정증명서·학교생활기록부) 전용 노드 자체가 없어 무관한 위치 기반 기본값으로 새던 문제 → `SP-NAT-EDUCERT` 신설(도메인/도코드 의도적으로 비워 기존의 정직한 "[정보 없음]" 폴백 경로를 그대로 활용, 커밋 `dcc3216`) → 4건 재검증 4/4 통과 확인.

## 지금 상태 / 다음 세션이 바로 이어받을 것

1. **gov24_corpus batch2~7(각 50건, 총 300건)이 아직 실행·검토 전입니다.** batch1과 같은 방식(`node gov24_corpus_live_smoketest.mjs --scenarios <파일>` → `python gov24_corpus_report.py`)으로 이어가면 됩니다.
2. **사용자 PC 로컬에 git 미커밋 파일이 있을 수 있습니다.** 새 세션 시작하면 `git status`부터 확인할 것 — 오늘 여러 차례 untracked로 남아있던 테스트 스크립트/시나리오 파일들이 언급됐습니다(아래 파일 목록 참고).
3. **`professor-gap-09`(기계공학) 토큰 소진 미해결** — 등록부를 더 건드리기보다 재현 여부 관찰 우선.
4. **`professor-gap-14`(병리생리학) 시나리오 기대값이 현재 애매함** — "병리생리학"이라는 문구 자체가 병리과(professor-med-pathology)로 읽힐 여지가 있어, 등록부보다 시나리오 쪽 기대값을 재검토하는 게 맞아 보임(아직 안 함).
5. **`SP_CODE_TO_PDV_SCOPE`에 `SP-NAT-EDUCERT` 미등록** — 크래시는 안 나지만 이 상담의 PDV 기록 scope가 안 남습니다. 필요시 추가.
6. professor 158개 세부 과목 중 gapfill 38개로 커버된 건 일부뿐 — 전수는 아님, 확장 여지 있음.

## 핵심 교훈 (다음 세션이 꼭 알아야 할 것)

1. **institution/공공기관 라우팅은 "note의 소관기관 문자열이 trace에 그대로 있나"로 자동 채점하면 안 됩니다.** note의 소관기관은 흔히 중앙부처(예: 국토교통부)이지만, 실제 창구는 그 부처의 지역사무소이거나 위임받은 지자체 부서인 경우가 많습니다. `kregionalgov`("전국 지방행정 AI")는 애초에 "국가기관 지역사무소"까지 포함하도록 설계돼 있어서, 거기로 가는 게 정상인 경우가 대부분입니다 — 이걸 모르고 "오탐"이라 잘못 판정했다가 두 번 번복한 게 오늘의 가장 큰 시행착오였습니다.
2. **테스트 하네스가 프로덕션 리팩터를 놓치고 낡아 있을 수 있습니다.** `subject_gate_live_smoketest.py`가 한 달 넘게 옛날(flat) 방식으로 프로덕션과 다른 걸 테스트하고 있었습니다 — 새 하네스를 만들거나 기존 걸 재사용하기 전에 "이게 지금 프로덕션 함수를 그대로 호출하는 게 맞는지" 소스를 직접 대조할 것.
3. **Windows PowerShell 환경 특유의 버그 패턴 2종**(둘 다 오늘 실사용 중 재현·수정):
   - Python `subprocess.run(..., text=True)`만 쓰면 Windows 한국어 로캘(cp949)로 디코딩돼 UTF-8 한글 출력이 깨짐 → `encoding='utf-8'` 명시 필요.
   - Node ESM `import()`에 `path.join()`으로 만든 절대경로(`C:\...`)를 그대로 넘기면 `ERR_UNSUPPORTED_ESM_URL_SCHEME`로 실패 → `pathToFileURL()`로 감싸야 함. 리눅스/맥에서는 재현 안 돼서 놓치기 쉬움.
4. **등록부(`expert-registry-*.js`) 트리거 갭이 흔한 패턴입니다.** description/label엔 이미 특정 세부 항목이 포함된다고 적혀 있는데 실제 `triggers` 배열엔 그 키워드가 없어서 못 잡는 경우가 오늘만 10건 넘게 나왔습니다. 자연스러운 구어체("~할 사람이 필요해요" 식 상황 묘사)도 자주 누락돼 있습니다.
5. **없는 걸 지어내는 대신 기존의 정직한 폴백 경로를 재활용하는 게 이 코드베이스의 확립된 원칙입니다.** `SP-NAT-EDUCERT`를 만들 때 `domain`/`도코드`를 일부러 안 채워서 기존 "[정보 없음] ... 정부24로 확인" 폴백이 자동으로 뜨게 한 것처럼, 상세 데이터가 없으면 억지로 채우지 말고 이미 있는 정직한 미등록 상태 처리 경로를 그대로 쓸 것.

## 오늘 신설된 파일 (대부분 `tests/live_smoketest/` 아래)

- `routing_ABmention_live_smoketest.py` + `scenarios_kservice_20260914.json` / `scenarios_expert_20260914.json`(+ `_batch2`/`_batch3`/`_batch4`) / `scenarios_institution_20260914.json`(3단계 재설계 전 구버전 — 참고용, gov24_corpus로 대체됨)
- `gov_recheck_live_smoketest.py` + `scenarios_gov_recheck_20260914.json`
- `get_gate_level.mjs` (subject-gate 계층형 재현, `subject_gate_live_smoketest.py`가 매 단계 서브프로세스로 호출)
- `gov24_corpus_report.py` (정부24 350건 결과-정답 대조표 생성, 자동 PASS/FAIL 없음)
- `scenarios_educert_recheck_20260914.json`

이 파일들이 사용자 PC git에는 있지만 아직 안 커밋됐을 수 있습니다 — 새 세션에서 `git status`로 확인 후 필요하면 커밋 정리부터 권할 것.
