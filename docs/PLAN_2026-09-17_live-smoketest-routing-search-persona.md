# 라이브 스모크테스트 계획 — 라우팅 오류 · 검색/응답 지연 · 페르소나 호출 실패

작성일: 2026-09-17 | 계기: 2026-09-17 오후 실사 세션(2:44~3:02)에서 재현된 3가지
증상(전문가 페르소나 호출 실패, 검색 위임 무한 지연, 등본 발급 안내 중복 출력)을
다각도 라이브 스모크테스트로 확인·재현·수정하기 위한 계획. 선행 문서:
`docs/HANDOFF_2026-09-14_routing-precision-testing.md`,
`docs/HANDOFF_2026-08-05_live-smoketest-latency-and-empty-content.md`.

## 0. 계획 수립 전 소스 대조로 이미 확인된 사실

이 계획을 짜기 전에 실사 스크린샷 속 세 화면을 저장소 소스와 먼저 대조했다.
아래 세 가지는 **테스트로 처음 발견해야 할 가설이 아니라, 이미 코드 레벨에서
확인된 사실**이므로 각 트랙의 1순위 항목으로 바로 배치한다.

0. **초기 화면은 항상 "사용자 AI 비서"(`webapp.html`)여야 하며
   `regional-gov.html`이 초기 화면이 되는 것은 설계상 불가능하다** —
   `manifest.json`의 `start_url`이 `/webapp.html?pwa=1`로 고정돼 있고,
   `regional-gov.html`은 어디서든 `target="_blank"` 새 탭으로만 열리도록
   설계돼 있다(§트랙 D 참고). 이번 실사에서 새 대화의 첫 메시지 응답이
   "제주도청입니다"로 시작한 것이 격리 테스트(직접 URL 진입)였는지,
   아니면 진짜 콜드스타트 결함인지는 아직 미확인 — 트랙 D에서 최우선으로
   가린다.
1. **`pages/regional-gov.html`(제주도청 화면)은 `call-ai.js`에서
   `_handleGovTaskTags`만 import한다.** `handleExpertTag`도
   `src/gopang/ai/subject-gate.js`의 `refineToLeaf`/`getConsultableChildren`도
   이 파일 어디에도 없다 — 이 화면에서는 모델이 `[EXPERT: ...]` 태그를 내도
   가로챌 코드 자체가 없다. `subject-gate.js`는 professor/physician/lawyer
   공통으로 쓰도록 설계돼 있지만(주석 §5-6행), 이 화면은 애초에 그 모듈을
   호출하는 경로에 있지 않다.
2. **등록부에 `dermatologist`라는 ID는 없다.** 실제 등록 ID는
   `physician-dermatology`(`src/gopang/ai/expert-registry-physician.js`,
   `parentKey: 'physician'`, triggers: `['피부과 상담', '피부과 전문의']`).
3. **검색/응답 지연은 신규 버그가 아니라 8/5에 이미 진단된 것과 동일 계열이다.**
   `docs/HANDOFF_2026-08-05_...md` §2-2(reasoning이 완료 토큰 예산을 전부
   소진)·§2-3(오케스트레이션 체인 전체가 순차·전부 hondi-pro)이 원인으로
   기록돼 있고, `worker.js`의 `_parseUsageFromStream`에 9/14 추가된
   `AI_EMPTY_COMPLETION_DIAG` 진단 로그가 있으나 "diagCtx가 있을 때만 동작
   (기존 4개 호출부는 무영향)"이라 K-Search/K-Deliver 경로에 실제로
   배선됐는지부터 확인이 필요하다.

---

## 1. 트랙 A — 라우팅 오류 (기존 인프라 재사용 + 신규 회귀 가드)

### A-1. 진행 중이던 gov24_corpus 전수 테스트 이어받기 (최우선, 재사용만 하면 됨)
`docs/HANDOFF_2026-09-14_...md`에 batch1(50건)만 실행·검토됐고 batch2~7
(300건)이 아직 미실행 상태로 남아 있다. 새 시나리오를 짤 필요 없이 그대로
이어가면 된다.

```bash
cd tests/live_smoketest
export DEEPSEEK_API_KEY=sk-xxxx
node gov24_corpus_live_smoketest.mjs --scenarios scenarios_gov24_corpus_batch2_20260823.json
python3 gov24_corpus_report.py --results ../../results/gov24-corpus/<batch2 결과 디렉토리>
# batch3~7도 동일 패턴 반복. 자동 PASS/FAIL이 없으므로 note의 소관기관과
# trace/agency를 사람이 직접 대조(HANDOFF §핵심교훈 1 — kregionalgov로
# 가는 게 정상인 경우가 많다는 점 유의).
```

### A-2. [신규] regional-gov.html EXPERT 태그 미배선 — 구조적 회귀 가드
소스로 이미 확인된 사실(§0-1)을 앞으로도 깨지지 않게(또는 의도적으로 고쳤을 때
확인되게) 구조 검사 스크립트로 고정한다. `expert_persona_smoketest.py`
docstring이 언급하는 `check_stale_refs.py`류 정적 검사와 같은 패턴.

- 신규 파일: `tests/live_smoketest/check_expert_tag_wiring.py`
  - 저장소 내 진입점 HTML/JS 목록(현재 파악된 것: `pages/regional-gov.html`,
    `webapp.html`, `desktop.html` — **실제 진입점 전수는 실행 전에
    `grep -rl "_govRelayCompletion\|_callAIInner\|_handleGovTaskTags" pages/
    *.html *.html`로 먼저 다시 확인할 것**, 위 목록은 이번 대조 세션에서
    빠르게 찾은 것이라 누락 가능)마다, `handleExpertTag` 또는
    `subject-gate.js` import 여부를 grep으로 확인.
  - `[EXPERT: ...]` 태그 처리가 없는 진입점을 발견하면 파일명을 나열하고
    실패 처리(현재는 `regional-gov.html` 1건이 이미 알려진 상태이므로,
    이 스크립트의 첫 실행 목적은 "이미 아는 결함을 실패로 잡는지" 자체
    검증 + "혹시 모르는 다른 진입점도 같은 결함인지" 전수 확인).
- 이건 DeepSeek API를 호출하지 않는 순수 정적 검사라 비용이 없다 —
  다른 라이브 하네스보다 먼저, 매 세션 첫 단계로 돌리는 걸 권장.

### A-3. [신규] regional-gov.html에 실제로 EXPERT 처리를 배선한 뒤의 라이브 검증
A-2에서 결함을 수정(`handleExpertTag`/`subject-gate` import + 호출 추가)한
뒤에는, 정확히 스크린샷 재현 시나리오로 라이브 확인한다.

- 신규 시나리오 파일: `tests/live_smoketest/scenarios_regionalgov_expert_20260917.json`
  - `"전문가 페르소나 중에서 피부과 의사 AI 불러줘"`(암시적, 실사 재현)
  - `"피부과 전문의 AI 불러줘"`(명시적 트리거 문구 그대로)
  - `"머리가 빠지고 있는데 웹에서 인기 있는 탈모약"`(실사 재현 — 정상적으로는
    피부과로 유도 되묻기가 나와야 하는지, 아니면 바로 라우팅해야 하는지
    기대값을 이 세션에서 먼저 정의해야 함 — expected_id 확정 전 사람 판단 필요)
  - physician/lawyer 세부 리프 각 1~2건씩(professor만 편중되지 않게 —
    HANDOFF §미해결 항목에 physician 26개·lawyer 47개는 professor만큼
    전수 검증된 적이 없다고 기록돼 있음)
- 채점: `[EXPERT: physician]`(1단계) → 실제 클라이언트가 `physician-dermatology`
  같은 리프로 정상 하향(refineToLeaf)되는지까지 **라이브 API 호출만으로는
  검증 불가**(refineToLeaf는 클라이언트 사이드 2차 호출) — 이 부분은
  `expert_persona_smoketest.py`처럼 서버 API만 흉내 내지 말고, 실제
  regional-gov.html을 헤드리스 브라우저(Playwright 등)로 띄워서 탭이 실제로
  열리는지까지 확인하는 게 정확하다. 최소선으로는 사람이 직접
  hondi.net에서 재현 문구를 입력해 탭 전환을 눈으로 확인.

### A-4. expert-registry 트리거 갭 전수 재점검
HANDOFF §핵심교훈 4: "description/label엔 특정 세부 항목이 있다고 적혀
있는데 triggers 배열엔 없는 경우"가 9/14 하루에만 10건 넘게 나왔다고
기록돼 있다. 스크립트로 자동 대조:

- `expert-registry-*.js`를 파싱해 각 persona의 `label`(괄호 안 세부 항목)과
  `triggers` 배열을 비교, description에 언급된 키워드가 triggers에
  없으면 목록화(완전 자동 판정은 어려우므로 "의심 목록" 산출 → 사람이
  최종 확인하는 방식, gov24_corpus_report.py와 같은 설계 철학).

---

## 2. 트랙 B — 검색/응답 지연 (기존 미해결 버그 재확인 + 신규 하네스)

### B-1. AI_EMPTY_COMPLETION_DIAG가 K-Search/K-Deliver 경로에 실제로 배선됐는지 소스 확인
가장 먼저 할 일(비용 없음, grep만으로 확인 가능):
```bash
grep -n "diagCtx" worker.js | grep -i "k-search\|k-deliver\|kSearch\|kDeliver"
```
배선이 안 돼 있으면(9/14 커밋 당시엔 진단 코드만 추가되고 실제 호출부
연결은 별도 작업으로 남아있을 가능성이 있음 — 주석의 "기존 4개 호출부"가
어디인지부터 특정해야 함), 이번 세션에서 K-Search/K-Deliver 호출부에도
`diagCtx`를 넘기도록 배선을 확장한 뒤 B-2로 진행.

### B-2. 실사 재현 시나리오로 wrangler tail 병행 라이브 테스트
스크린샷 그대로 재현:
- `"한림읍 한림상로 근처 평점 높은 식당 추천"` (K-Search 위임 경로)
- `"온라인으로 등본 발급해 줘"` (K-Search 아닌 안내형 경로 — 지연은 없었지만
  문구 중복이 발생한 케이스, B-4에서 별도 다룸)

실행 방법(HANDOFF §2-1과 동일 패턴 — 라이브 계정 필요):
```bash
wrangler tail --format pretty | tee tail_$(date +%s).log &
# 동시에 hondi.net에서 위 발화 입력, 또는 아래처럼 API 직접 호출로 재현
```
`tail` 로그에서 `AI_EMPTY_COMPLETION_DIAG`가 찍히면 `finishReason`·
`contentLength`·`reasoningTokens`를 그대로 기록 — HANDOFF §2-2가 예측한
대로 `finishReason:"stop"`인데 `contentLength:0`이고 `reasoningTokens`가
예산에 근접하면 원인 확정.

### B-3. [신규] K-Search 위임 전용 라이브 하네스
기존에 `scenarios_orchestration_chain.json` + `orchestration_chain_smoketest.py`가
있지만(다기관 조합/project_brief 검증 목적), **지연 자체를 측정하는
하네스는 아직 없다.** 신규로:

- `tests/live_smoketest/ksearch_latency_live_smoketest.py`
  - 시나리오: 지역+업종 조합 10~15건(맛집/카페/약국/편의점 등, 위치 다양화)
  - 측정: 요청→최종 텍스트 응답까지 걸린 시간(초), 중간 "단계로 이동 중…"
    안내가 몇 번 나왔는지(오케스트레이션 홉 수), 최종 응답이 빈 문자열인지
  - 채점: `LIVE-PASS`(정상 응답, N초 이내 — 임계값은 첫 실행 결과 분포 보고
    사람이 정함) / `LIVE-SLOW`(응답은 왔으나 임계값 초과 — HANDOFF가
    지적한 "홉 수 × hondi-pro 지연" 가설을 홉 수와 함께 기록) /
    `LIVE-EMPTY`(응답 없이 종료 — B-1/B-2의 진단 로그와 대조) /
    `LIVE-ERROR`
  - 이 하네스는 HANDOFF §2-3 가설(오케스트레이션 체인이 전부 hondi-pro로
    순차 실행)을 직접 검증하는 게 목적이므로, 결과에 홉별 소요 시간을
    남겨야 "몇 번째 홉에서 느려지는지" 사후 분석이 가능하다.

### B-4. [신규] 등본 발급 안내 문구 중복 재현
- 재현 시나리오: `"온라인으로 등본 발급해 줘"` 단발 요청을 반복 실행,
  응답 텍스트를 정규화해 완전/거의 동일한 문단이 한 응답 안에 2회 이상
  나오는지 문자열 비교로 자동 검출.
- 원인 후보(가설, 확정 아님) — 이 경로가 `call-ai.js` 메인 루프인지
  `regional-gov.html`의 `_tagAwareSend`인지부터 실제 요청 헤더/화면
  타이틀로 먼저 특정할 것(스크린샷 화면 타이틀이 "혼디, 최신 버전"이라
  `regional-gov.html`이 아닐 가능성이 있음 — 어느 진입점인지 특정 안 하고
  고치면 엉뚱한 파일을 고치게 됨).
- 특정 후 해당 진입점의 재귀/재시도 로직(`_tagAwareSend`류)에서 동일
  `assistant` 메시지가 `messages` 배열에 중복 push되는지, 또는
  `_announceStageTransition`이 같은 라벨로 중복 호출되는지 로그로 확인.

---

## 3. 트랙 D — [신규] 콜드스타트 진입 화면 불변식 검증 (최우선)

**전제 정정**: 혼디를 시작했을 때 초기 화면은 항상 "사용자 AI 비서"
(`webapp.html`의 `#ai-panel`, AGENT-COMMON)여야 하며, `regional-gov.html`
("제주도청입니다" 류 화면)은 그 자체가 초기 화면이 될 수 없다. 이는
가설이 아니라 설계 불변식이다 — 소스로 확인됨:

- `index.html`은 기기 판별 후 모바일이면 항상 `webapp.html`로 리다이렉트.
- `manifest.json`의 `start_url`이 `/webapp.html?pwa=1`로 고정 —
  `regional-gov.html`은 PWA 시작 지점에 전혀 등록돼 있지 않음.
- `regional-gov.html`은 `gwp-registry.js` / `pages/k-government.html`에서
  `target="_blank"`로 여는 **별도 새 탭**으로만 설계돼 있다 — 앱이
  자체적으로 그 화면으로 진입하는 경로는 코드 어디에도 없다.

즉 2026-09-17 실사 세션에서 "탈모 문제 상담" 발화가 새 대화의 **첫
메시지**로 들어갔는데 응답이 "안녕하세요, 제주도청입니다"로 시작한 것은
(트랙 A의 EXPERT 태그 미배선과는) **별개의, 더 상위 층위의 결함 후보**다
— 정상이라면 그 발화는 AI 비서(`_callPanelAI`, AGENT-COMMON)로 갔어야
하고, AI 비서는 이미 `handleExpertTag`를 정식으로 import하고 있다
(§0-1과 대조: 오히려 AI 비서 패널 쪽은 배선이 돼 있다는 게 코드로
확인됨 — `webapp.html` BUG-FIX 2026-09-14 주석). 그렇다면 왜 그 화면이
아니라 regional-gov.html 응답이 나왔는지가 트랙 A보다 먼저 풀어야 할
질문이다. 원인 후보(우선순위 미정, 전부 실사로 좁혀야 함):

1. **테스터가 직접 `regional-gov.html` URL(또는 `?gov_code=` 딥링크)로
   들어갔을 가능성** — 이 경우 결함이 아니라 단순히 "AI 비서를 거치지
   않고 특정 SP만 격리 테스트한 것"이므로, 이번 세션에서 **재현 시
   URL을 그대로 기록**해 정상적인 격리 테스트였는지부터 구분해야 한다.
2. **AI 비서 패널 자체가 특정 조건에서 규탄 화면 텍스트("제주도청입니다")를
   내는 경우** — 예를 들어 AGENT-COMMON이 정부 민원성 발화를 감지해
   `regional-gov.html`로 새 탭을 여는 게 정상 설계인데, 그 새 탭이
   열리는 과정 자체가 매끄럽지 않아 "처음부터 그 화면이었던 것"처럼
   보였을 가능성.
3. **PWA 캐시/세션 복원 버그** — 이전 세션에서 마지막으로 연 탭이
   `regional-gov.html`이었고, 앱 재실행 시 `start_url`을 안 따르고
   마지막 탭을 복원하는 로직이 어딘가 있을 가능성(현재까지 grep으로는
   그런 로직을 찾지 못함 — `sw.js`에 관련 로직 없음 확인됨. 다만 브라우저
   자체의 탭 복원 기능일 수도 있어 앱 결함이 아닐 수 있음).

### D-1. 재현 절차부터 표준화 (비용 없음)
다음 세션부터 라이브 재현 시 반드시 기록: (a) 앱을 어떻게 열었는지(홈
화면 아이콘/북마크/직접 URL 입력/이전 탭 복귀), (b) 최초로 뜬 화면의
URL과 타이틀, (c) 그게 `webapp.html`이 아니면 왜 아닌지. 이 세 가지가
없으면 트랙 D의 원인 후보 1번(정상적인 격리 테스트)과 2·3번(진짜 결함)을
구분할 수 없다.

### D-2. [신규] 콜드스타트 라이브 스모크테스트
- `tests/live_smoketest/coldstart_entry_screen_smoketest.py` (또는
  Playwright 기반 브라우저 자동화) — 신규 시크릿 컨텍스트로
  `hondi.net`을 N회 반복 접속(캐시 없음 상태 재현), 매번 최초 렌더된
  페이지의 URL이 `webapp.html`인지, 첫 화면에 "제주도청" 등 지역 관공서
  인사말이 뜨는지 검사.
- 로그인된 기존 세션으로도 별도 반복 — 로그아웃 상태와 로그인 상태 둘 다
  확인(원인 후보 3번이 세션/토큰에 얽혀 있을 가능성 배제 못 함).

이 트랙이 원인 후보 1번(단순 격리 테스트)으로 판명되면 트랙 A·B의
분석은 그대로 유효하다. 원인 후보 2·3번으로 판명되면 트랙 A·B보다 먼저
고쳐야 할 더 근본적인 결함이므로, 이번 계획의 우선순위 1번으로 재조정할 것.

---

## 4. 트랙 C — 페르소나 호출 "실패" 자체의 검증 범위 재정의

`tests/live_smoketest/expert_persona_smoketest.py`(62개 EXPERT 페르소나)는
이미 있지만, README와 docstring에 명시된 대로 **"라우팅된 뒤 페르소나가
올바르게 행동하는가"(STEP D 위험고지·인간전문가연결)만 검증**하고,
**"라우팅 태그가 애초에 클라이언트에서 탭 전환·화면 전환으로 이어지는가"는
검증 범위 밖**이다. 스크린샷에서 실제로 재현된 실패는 후자(탭 전환 자체가
안 됨)이므로, 기존 하네스를 그대로 돌려서는 이 버그를 못 잡는다.

- A-3에서 만들 진입점별 배선 확인(A-2)과 실제 UI 반응 확인(A-3)이 이 갭을
  메우는 담당이다. `expert_persona_smoketest.py`는 그대로 두고(이미 잘
  작동하는 다른 층위 검증), "탭 전환/화면 전환" 층위는 별도 트랙으로
  명확히 분리해 다음 세션에도 이 구분이 유지되도록 이 문서에 남긴다.

---

## 5. 권장 실행 순서

0. **D-1**(재현 절차 표준화, 비용 없음) → 이번 세션 재현 시 URL/진입
   경로부터 기록. 트랙 A·B의 결과 해석이 이 구분에 좌우되므로 최우선.
1. **A-2**(정적 검사, 비용 없음) → 알려진 결함이 실제로 잡히는지, 다른
   진입점도 같은 결함인지 전수 확인
2. **B-1**(grep, 비용 없음) → diagCtx 배선 범위 확인
3. **D-2**(콜드스타트 반복 접속) — 원인 후보 1번(격리 테스트) vs
   2·3번(진짜 결함) 판명. 2·3번으로 나오면 이후 순서를 전면 재조정.
4. 결함 수정(regional-gov.html EXPERT 배선 추가, 필요시 diagCtx 확장,
   D-2에서 확정된 콜드스타트 결함이 있다면 그것도 포함)
5. **A-1**(gov24_corpus batch2~7 이어받기) — 이미 있는 작업이므로 병행 가능
6. **A-3 + B-2 + B-3 + B-4**(라이브 호출 필요) — 수정 커밋 이후 재현·검증
7. **A-4**(트리거 갭 전수 재점검) — 시간이 남으면 확장 작업으로

## 6. 산출물 규칙 (기존 관례 그대로)

- 결과는 `results/<트랙명>/`에 JSON/CSV, 자동 PASS/FAIL이 애매한 항목은
  `LIVE-NEEDS-REVIEW`로 표시해 사람이 `transcript`를 직접 읽는다
  (`gov24_corpus_report.py`·`expert_persona_smoketest.py`와 동일 철학 —
  "명백한 실패만 자동 플래그, 나머지는 사람이 대조").
- 이번 세션에서 새로 만든 스크립트/시나리오 파일은 세션 종료 시
  `git status`로 확인 후 커밋 정리(HANDOFF §핵심교훈 2 — 프로덕션 리팩터를
  테스트 하네스가 놓치는 사고를 반복하지 않으려면, 새 하네스가 실제
  프로덕션 함수를 그대로 호출하는지 소스로 재대조하는 습관 유지).
