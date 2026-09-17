# 제주 AI 행정 — 실·국·과 탭 및 실행 화면 직접 연결 설계서

**대상:** hondi 저장소(Openhash-Gopang/hondi) 개발자
**대상 페이지:** `pages/jeju-gov-automation.html` (홈 히어로 5번째 버튼과 상단 네비게이션에 이미 연결됨 — PR #284)
**전제:** 단일 소스 원칙 — 실·국·과 목록의 원본은 `desktop.html#k-government`의 "제주" 탭. 이 페이지가 과 단위까지 완전히 채워지면 참조 방향이 반전되어 k-government 제주 탭이 이 페이지를 참조하게 된다(2026-09-17 합의).

---

## 1. 배경 — 실행 링크의 두 가지 오류를 바로잡음

이전 목업(`jeju-gov-automation-v2.html` 1차본)은 실행 화면을 `webapp.html?sp={SP_ID}`로 가정했으나, 저장소를 직접 확인한 결과 **두 가지가 모두 틀렸다.**

| 가정 | 실제 확인된 사실 | 근거 |
|---|---|---|
| 실행 화면 = `webapp.html` | gov-tree SP의 실행 화면은 `pages/regional-gov.html`이다. `webapp.html`은 K-Mail 등 개별 K-서비스 전용 파일명으로, gov-tree와 무관 | PR #101 "regional-gov.html(전국 지방행정 AI, 부산/서울/대전 등 모든 지역 공용)", PR #281 "메인 AI비서가 GWP로 여는 실제 지역정부 자유발화 채팅 탭" |
| `?sp=` 파라미터로 특정 SP를 바로 연다 | regional-gov.html은 현재 **자유발화 전용**이며, 특정 SP를 URL로 지정해 바로 여는 기능이 없다 | 관련 PR 어디에도 그런 파라미터 처리 코드가 언급되지 않음 |
| (참고) 직접 열기 자체가 불가능한 개념은 아님 | `pages/expert-chat.html`이 `URLSearchParams(persona, return)`으로 특정 전문가 페르소나를 바로 여는 기능을 이미 갖고 있다 | PR #245 — `src/gopang/gdc/tax-execution.js`의 `buildTaxAdvisorChatUrl()`과 동일 패턴 |

이번 설계서는 **expert-chat.html의 검증된 패턴을 regional-gov.html에도 동일하게 이식**하는 것을 제안한다. "제주 AI 행정" 페이지의 각 카드가 실제로 그 과(課)의 AI 행정 채팅으로 바로 진입하려면 이 기능이 먼저 구현되어야 한다.

---

## 2. 현재 아키텍처 (변경 없음)

```
사용자 자유발화 입력
        │
        ▼
regional-gov.html → CALL_GOVTREE → gov-router.js
        │                              │
        │                    _kwMatch/_scoreMatchTies
        │                              │
        │               L2(국) 키워드 게이트 → L3(과) division 테이블
        │                              │
        ▼                              ▼
   AC가 자연어에서 도메인을 추론          DO_DEPT_DIVISION_TABLE에서
   해 어느 SP로 갈지 스스로 결정         해당 SP 결정
```

이 경로는 **"어느 SP인지 모르는 자유발화"**를 위한 것이다. "제주 AI 행정" 페이지에서 카드를 클릭하는 경우는 이미 어느 SP인지 사용자가 명시적으로 골랐으므로, 이 키워드 매칭 라우팅을 거칠 필요가 없다 — 오히려 거치면 동점(tie)·오매칭 위험(예: PR #312에서 확인된 SP-DO-GENERAL/SP-DIV-JACHI-GENERAL 동점 사례)에 다시 노출된다.

---

## 3. 제안 — regional-gov.html 직접 열기 파라미터

### 3.1 URL 스펙

```
pages/regional-gov.html?sp={SP_ID}&return={RETURN_URL}
```

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `sp` | Y | 열려는 SP의 ID (예: `SP-DIV-ECON-1`). 국 단위·과 단위 모두 동일한 파라미터명 사용 |
| `return` | N | 뒤로가기 대상 URL. 생략 시 기본값은 `pages/jeju-gov-automation.html` |

`expert-chat.html`이 `persona`를 받아 그 페르소나의 SP를 로드하듯, `regional-gov.html`은 `sp`를 받아 **AC의 키워드 매칭 단계를 건너뛰고** 해당 SP를 즉시 로드해야 한다.

### 3.2 동작 순서 (제안)

1. `regional-gov.html` 로드 시 `URLSearchParams`로 `sp` 파라미터 확인.
2. `sp`가 있으면:
   - `CALL_GOVTREE`의 키워드 매칭 단계(L2→L3)를 **건너뛰고**, 해당 SP 파일을 직접 로드 (`prompts/gov-tree/{경로}/{sp}.md`).
   - `expert-chat.html`의 `composeExpertPrompt()`와 같은 역할을 하는 gov-tree용 프롬프트 조립 함수가 필요 — 기존 조립 로직(§0 상위 SP 참조 등, PR #279에서 정리된 것과 동일한 원칙)을 그대로 따라야 한다. **새 조립 로직을 복붙으로 새로 만들지 말 것** — PR #245가 지적한 "복붙된 조립 로직이 조용히 갈라지는" 문제를 반복하지 않기 위함.
   - 채팅 상단에 "OOO과 AI 행정" 같은 컨텍스트 배지를 표시해, 사용자가 지금 어느 SP와 대화 중인지 알 수 있게 한다(전문가 챗의 페르소나 배지와 동일한 역할).
3. `sp`가 없으면 기존 자유발화 흐름을 그대로 유지 — **회귀 없음.**
4. `return` 파라미터가 있으면 상단에 "← 제주 AI 행정으로" 같은 뒤로가기 링크를 노출.

### 3.3 PDV 위치 힌트와의 상호작용 — 확인 필요 사항

PR #281에서 확인했듯, `regional-gov.html`의 `onSend` 콜백은 `ensureWalletSetup()` → `retryProfileAddressIfWalletReady()`를 거쳐 PDV 등록주소를 우선 조회한다. `sp` 파라미터로 직접 진입한 경우에도 이 흐름이 동일하게 유지되어야 한다 — 즉 AC의 도메인 추론 단계만 건너뛰고, 위치 힌트 첨부 같은 나머지 공통 로직은 그대로 타야 한다. 이 부분은 실제 구현 전에 개발자가 재확인해야 한다(이 세션은 코드를 직접 읽지 못했으므로 설계 의도만 명시).

---

## 4. "제주 AI 행정" 페이지 쪽 변경 사항

`jeju-gov-automation-v2.html` 목업에 이미 반영:

- 실행 링크를 `webapp.html?sp=` → `pages/regional-gov.html?sp={SP_ID}&return=pages/jeju-gov-automation.html`로 수정.
- §3의 기능이 구현되기 전까지는 동작하지 않는다는 점을 코드 주석과 화면 배지(**"제안·미구현"**, 카드 안 `▶ 실행*` 표시)로 명시 — 미구현 기능을 구현된 것처럼 보여주지 않기 위함.

---

## 5. 실·국·과 데이터 자체 (이전 설계서 내용 유지)

- 17개 실·국 명칭은 `desktop.html#k-government` "제주 부서" 탭에서 그대로 가져온 값(2026-09-17 확인).
- 과 단위 데이터의 살아있는 소스는 `division-tables.js`의 `DO_DEPT_DIVISION_TABLE`이다. **`division-master-data.json`은 죽은 데이터이므로 참조 금지**(PR #279).
- 확인된 것: 제주도청 리프 SP 67개(division 55 + 단일창구 국 4개: AI행정혁신추진단/기본사회추진단/노동안전감독관/청렴감찰관). econ 4개 과 중 3개 이름 확인(경제정책과/기업정책과/소상공인물류과), climate·housing·transport·culture·tourism·agri·ocean은 과 **개수**만 확인(4·4·4·3·3·5·4), 나머지 9개 실·국은 미확인.
- 이름이 불확실한 항목을 추측해서 채우지 말 것 — 목업에서도 "명칭 확인 필요"로 정직하게 표시했다.

---

## 6. 다음 단계 제안

1. `regional-gov.html`에 `sp`/`return` 파라미터 처리와 gov-tree용 프롬프트 직접 로드 함수를 구현.
2. `DO_DEPT_DIVISION_TABLE`을 이 페이지의 실제 데이터 소스로 연동(현재 목업은 econ 1곳만 하드코딩된 예시).
3. 구현 후 목업의 "제안·미구현" 배지 제거, 실제 링크로 전환.
4. 제주도청 본청이 끝나면 같은 패턴을 제주시청·서귀포시청, 이후 나머지 16개 지역으로 확장.
