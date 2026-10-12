# ROUTING-BRANCH-REFERENCE · 사용자 발화 분기 경우의 수 종합 v1.3

> **이 문서의 성격**: 별도 신규 로직이 아니다. `ROUTER-PRIORITY_v1_0.md`
> (원래 설계 원칙)와 `AC-PRO-CORE_v1_9.txt`(§CORE·§INFO·§TAGS의 날짜별
> 인라인 주석 누적분, 실제 운영 로직)에 **흩어져 있는 라우팅 판단을
> 하나의 표로 종합**한 참조 문서다. AC 자신이 참조하는 프롬프트가
> 아니라(로드 체인에 들어가지 않는다), 사람이(다음 세션 포함) 전체
> 그림을 빠르게 파악하기 위한 지도다.
>
> **제정 배경**: 2026-08-06, 주피터님 요청 — "사용자 발화가 분기되는
> 경우의 수를 작성해 보라"는 질문에 답하며 AC-PRO-CORE 인라인 주석만
> 훑어 종합했더니, `ROUTER-PRIORITY_v1_0.md`에는 있지만 그 종합에서
> 빠진 분기(잡담·감정표현 0단계, AGENT-SUPPLIER 직교 레이어, 확신도
> 게이트)가 있다는 게 뒤늦게 드러났다. 이런 유실을 다음에도 반복하지
> 않도록, 두 소스를 대조해 만든 게 이 문서다.
>
> **v1.1 개정 배경**(2026-08-31): v1.0 제정(8/6) 이후 AC-PRO-CORE가
> v1_1 → v1_7까지 갱신되면서, 이 문서가 반영하지 못한 실질 변경이
> 누적된 게 확인됐다 — 특히 **라우팅 힌트 사전필터**(routing-hint.js,
> 2026-08-08 신설)는 §CATALOG 대조보다 앞단에 놓이는 새 단계인데도
> v1.0에 전혀 없었다. "0.5단계"와 §참고 문서를 그때 추가했다. 그 외
> R1-AC 보강(trigger 아닌 "분야" 개념 매칭, 2026-08-06/07)도 2단계
> 항목에 반영했다.
>
> **v1.2 개정 배경**(2026-08-31, 같은 날 재개정) — `scenarios_routing_
> branches_20260806.json`(34건)을 `AC-PRO-CORE_v1_7.txt` 기준으로
> 라이브 재검증한 결과 12 FAIL이 나왔고, 그중 근본 원인을 코드에서
> 고칠 수 있는 두 건을 그 자리에서 수정했다:
> 1. **R2-AC(GWP끼리 충돌)가 라이브에서 반복 재발** — "부가세 신고"
>    (kbusiness, 기대) 발화가 다시 ktax로 흡수됨. §CORE에 이미 이
>    정확한 사례가 규칙 근거로 박혀 있었는데도 안 지켜졌다 — 순수
>    문자열 사실(trigger 구체성)을 LLM 판단에 맡겨온 게 원인이라
>    판단, `candidate-prefilter.js`에 `findGwpR2Winner()`를 신설해
>    이 결정을 코드에서 미리 확정하고 `routing-hint.js`가 `[ctx]`에
>    `R2확정:id` 신호로 얹도록 배선했다. `AC-PRO-CORE_v1_9.txt`가 이
>    신호를 그대로 채택하도록 지시문을 추가했다 — **AC-PRO-CORE가
>    v1_7 → v1_8로 갱신**된 배경이다.
> 2. **ktelecom/kestate 구식 `[GWP:id]` 출력**은 재확인 결과 실제
>    프로덕션 버그가 아니라 **테스트 채점 기준의 오류**였다 —
>    `call-ai.js`의 switch-type 자동복구가 이미 100% 결정론적으로
>    `[CALL_KTELECOM:]`/`[CALL_KESTATE:]`와 동등하게 처리하는데,
>    `live_smoketest.py`가 그 동등성을 모르고 FAIL 처리하고 있었다.
>    테스트 채점 기준을 프로덕션 실제 동작에 맞춰 고쳤다(AC-PRO-CORE
>    본문은 이번엔 변경하지 않음 — 이미 최대한 강하게 경고해도 안
>    지켜진다는 게 2026-08-07에 이어 재확인됐을 뿐이고, 애초에 코드가
>    완전히 흡수하는 케이스라 프롬프트를 더 손보는 것 자체가 낭비).
>
> 아래 결정 트리·§TAGS 표·참고 문서 모두 v1_8 기준으로 갱신했다.
> R1AC-GWP기본값 축에서 "정보성 절차 질문에 라우팅 태그 없이 직접
> 답변으로 종료"(예: 계약서 작성 주의사항, 검정고시 절차)되는 패턴도
> 같은 재검증에서 발견됐으나, 이건 원칙 자체를 새로 정의해야 하는
> 문제라 이번 개정에는 포함하지 않았다 — 별도 결정 필요(미해결로
> 명시적으로 남김).
>
> **정본(source of truth)은 이 문서가 아니다** — 실제 동작은 어디까지나
> `AC-PRO-CORE_v1_9.txt`가 정본이고, `ROUTER-PRIORITY_v1_0.md`가 그
> 원칙적 배경이며, `routing-hint.js`(및 `candidate-prefilter.js`,
> `domain-classifier.js`)가 §CATALOG 대조 이전 단계의 정본 코드다. 이
> 문서는 그 전부의 **스냅샷 종합**이라 원본이 바뀌면 낡아진다 —
> AC-PRO-CORE에 §CORE·§INFO·§TAGS 관련 실질적 변경이 있거나 사전필터
> 코드가 바뀔 때마다 이 문서도 함께 갱신할 것.

---

## ⚠ 알려진 문서 드리프트 — R1/R2 이름표 충돌

두 소스 문서가 "R1"·"R2"라는 같은 이름표를 **다른 개념**에 쓰고 있다:

| 이름표 | `ROUTER-PRIORITY_v1_0.md` | `AC-PRO-CORE_v1_9.txt` 인라인 주석 |
|---|---|---|
| R1 | 공익 대변 vs 사익 대리 (K서비스+정부기관 vs 전문가 페르소나) | GWP vs EXPERT 판정축(2026-08-01 추가) — 개념은 유사하지만 표현·근거가 다시 쓰임 |
| R2 | 국가사무 vs 자치사무 (K서비스 vs Jejudo 정부기관) | GWP끼리 충돌 시 우선순위(2026-08-06 추가, 2026-08-31 코드 확정으로 보강) — **원본 문서엔 없던 완전히 새 개념** |

혼동을 막기 위해, 아래 표에서는 AC-PRO-CORE 쪽을 **R1-AC**·**R2-AC**로,
ROUTER-PRIORITY 쪽을 **R1-RP**·**R2-RP**로 구분해 표기한다. 근본적으로는
두 문서를 합쳐서 이름표를 재정리하는 게 맞지만, 지금 당장 기능에
영향은 없어 이번 문서에서는 명명 정리까지는 하지 않는다(별도 과제로
남김).

---

## 전체 결정 트리

```
발화 수신
 │
 ├─ R0: 생명·신체 위험 신호(화재·응급환자·강력범죄·재난)?
 │      ├─ Yes → 즉시 kemergency(GWP) 새 탭. 이하 전부 건너뜀.
 │      └─ No  ↓
 │
 ├─ 0단계: 실행요청인가, 잡담·감정 표현인가? (ROUTER-PRIORITY §0,
 │         AC-PRO-CORE엔 이 단계가 별도 절로 명시돼 있지 않지만
 │         실질 동작은 동일 — §CORE 1단계 "의도 파악"에 흡수돼 있음)
 │      ├─ 잡담·감정 표현 → AC가 그 자리에서 직접 응답, 새 탭 없음,
 │      │    태그 없음. 단, 감정 서술 속에 구체적 질문이 섞여
 │      │    있으면 그 질문만 따로 아래 단계로 이어감.
 │      └─ 실행요청 ↓
 │
 ├─ 0.5단계 — 라우팅 힌트 사전필터 (routing-hint.js, 2026-08-08).
 │         §CATALOG 전체(93개 이상 행)를 매번 훑기 전에 후보를 미리
 │         좁혀 [ctx] 블록에 얹는 코드 단계 — AC 판단이 아니라 그
 │         앞단의 전처리다.
 │      ├─ 0단계(candidate-prefilter.js) — 로컬 문자열 매칭, LLM
 │      │    호출 없음. trigger 최상위 점수 ≥4(WEAK_SIGNAL_THRESHOLD)면
 │      │    상위 8개를 "라우팅후보:id1,id2,..."로 그대로 힌트 확정.
 │      ├─ [v1.2 신설, 2026-08-31] R2 사전 확정 — GWP 후보가 둘 이상
 │      │    매칭됐고, 한쪽의 매칭 trigger가 다른 쪽 trigger를 문자열로
 │      │    포함하면(예: "부가세 신고" ⊃ "부가세") findGwpR2Winner()가
 │      │    승자를 확정해 "R2확정:id" 한 줄을 추가로 얹는다. 포함관계가
 │      │    아니면(애매하면) 아무것도 확정하지 않고 아래 2단계의 R2-AC
 │      │    판단에 그대로 맡긴다.
 │      ├─ 1단계(domain-classifier.js) — 0단계 신호가 약할 때만
 │      │    LLM 1회로 상위 도메인 9개 중 분류. 실패 시 좁히지
 │      │    않고 null 반환(전체 후보로 안전 폴백).
 │      └─ 힌트는 참고용 후보 축소일 뿐 최종 판단이 아니다 — 단,
 │           "R2확정" 신호만은 예외다(코드가 이미 순수 문자열 사실로
 │           확정한 것이라 AC가 재판단하지 않고 그대로 채택한다). 그 외
 │           힌트는 여전히 참고용이고, 힌트가 없거나 명백히 안 맞으면
 │           §CATALOG 표 전체로 복귀.
 │
 ├─ 1단계: 의도가 명확한가? (§CORE ①)
 │      ├─ No(후보 2개 이상 + 가를 신호 없음, 또는 판단정보 부족)
 │      │    → 새 탭 없이 후보 나열 후 되묻기. 재확인 후 1단계 재평가.
 │      └─ Yes ↓
 │
 ├─ 2단계: §CATALOG(GWP)·§CATALOG-EXPERT(전문직) 표에 그 주체가
 │         있는가? (§CORE ②) — 0.5단계 힌트가 있으면 이 표 전체를
 │         다시 훑기 전에 힌트 후보부터 먼저 검토한다.
 │      │
 │      ├─ 표 안에 있다(단일 주체로 특정됨)
 │      │    │
 │      │    ├─ R1-AC: 질문 성격이 제도·제3자 관점인가, 개인 위임
 │      │    │         의도가 명시됐는가?
 │      │    │      ├─ 제도·제3자 관점 → GWP 후보(기본값). 이 판정은
 │      │    │      │    §CATALOG trigger 단어가 우연히 겹치는지가
 │      │    │      │    아니라 그 GWP의 "분야" 칸에 개념적으로
 │      │    │      │    속하는지로 한다 — 단, 그 사무를 전담하는
 │      │    │      │    전용 GWP가 따로 있으면 그쪽이 우선(예: 특허·
 │      │    │      │    재산가치평가처럼 전용 GWP가 없을 때만
 │      │    │      │    klaw로 감).
 │      │    │      └─ 개인 위임 의도 명시 → EXPERT 후보
 │      │    │
 │      │    ├─ R2-AC: GWP 후보가 둘 이상 동시에 그럴듯한가?
 │      │    │      ├─ [ctx]에 "R2확정:id"가 있다 → [v1.2] 그 id를
 │      │    │      │    그대로 채택(재판단하지 않음). 단 위 R1-AC에서
 │      │    │      │    이미 EXPERT 위임의도가 명시됐다면 R1-AC가
 │      │    │      │    우선한다 — R2확정은 GWP끼리의 경쟁만 해소.
 │      │    │      └─ 신호 없음 → 더 구체적인 trigger/분야를 가진
 │      │    │           쪽으로 직접 판단해 좁힌 뒤 R1-AC 적용
 │      │    │
 │      │    ├─ 확신도 게이트(ROUTER-PRIORITY §확신도) 통과?
 │      │    │      ├─ No → 새 탭 안 열고 되묻기/컨텍스트 보완 →
 │      │    │      │        0단계부터 재평가
 │      │    │      └─ Yes ↓
 │      │    │
 │      │    ├─ GWP 확정, 그런데 id가 ktelecom/kestate(예외)
 │      │    │      → 정상 경로는 새 탭 아님. [CALL_KTELECOM:
 │      │    │        query=...] / [CALL_KESTATE: query=...]로 시스템
 │      │    │        내 전환. [v1.2] 실사에서 이 두 서비스는 구식
 │      │    │        [GWP: id] 문법으로도 자주 출력되는데, call-ai.js
 │      │    │        가 100% 결정론적으로 자동복구해 결과적으로
 │      │    │        동일하다 — 프롬프트만으로는 못 고치는 습관으로
 │      │    │        재확인됐고(2026-08-07, 2026-08-31 두 차례), 코드
 │      │    │        레벨 동등 처리를 정식 설계로 채택했다.
 │      │    ├─ GWP 확정(그 외 전부) → [GWP: id] 새 탭
 │      │    └─ EXPERT 확정 → [EXPERT: personaId] 새 탭
 │      │
 │      └─ 표 안에 없다(단일기관 미특정, 또는 여러 기관·절차 조합 필요)
 │           → 새 탭 없이 같은 패널에서 [CALL_KINTENT: query={원문}]
 │             → K-Intent→K-Compose→K-Execute→K-Deliver 오케스트레이션
 │             → 진행 중 인간 전속 구간(human_action) 도달 시 일시정지
 │               → 완료 확인 후 [RESUME_KEXECUTE: ...]로 재개
 │
 └─ (2단계에서 새 탭/오케스트레이션 어느 쪽도 해당 없는, 순수
    정보성 질문 — §INFO 3경로)
      ├─ 시의성 있는 공개정보(뉴스·통계·법령현황·시세) →
      │    [WEB_SEARCH: query=...]
      ├─ 과거 대화에 관련 기록 있을 만함 → (태그 없이) PDV 조회 후
      │    반영, 없으면 정직하게 재질문
      └─ 로컬에 답 없고 상대(기관/개인)가 자체 AI 비서 보유 →
           핸드셰이크 절차(신원고지→권한범위고지→상대확인→기록)

  (아래는 위 트리와 별개로, 조건 충족 시 언제든 나올 수 있는 태그)
  ├─ 실존 제도·직업군인데 대응 SP 자체가 없음(전문직) →
  │    [SP_DRAFT_REQUEST: domain=..., request=...]
  ├─ 실존 기관인데 SP가 없음 →
  │    [GWP_REGISTRY_SEARCH: q=...] → 안 나오면
  │    [GOV_SP_DRAFT_REQUEST: institution=..., task=...]
  ├─ 나비 사용자(개인/기관) 자체를 찾는 의도 →
  │    [SEARCH: query=..., type=user] (대화중 후보 확인) 또는
  │    [SEARCH: ..., mode=tab] (검색화면 자체 요청)
  ├─ 이미 판단 끝난 단순 작업, 가벼운 모델로 위임 가능 →
  │    [DELEGATE_TO_FLASH: task=..., context=...]
  └─ 사용자가 설정/전체 K-서비스 목록을 명시적으로 요구 →
       [OPEN_SETTINGS_TAB] / [OPEN_K_SERVICES_TAB]

  ── R3-RP: AGENT-SUPPLIER(사업자) 레이어 — 위 전체와 직교(orthogonal) ──
  로그인한 사용자 프로필에 KSIC 업종코드가 등록돼 있으면, 위 분류
  결과와 완전히 무관하게 항상 배경 지식으로 병행 주입된다
  (`_compileAgentSP`). "판정 결과에 따라 켜고 끄는" 분기가 아니라
  "이 사용자가 어떤 사업자인가"로 결정되는 상시 레이어다.
```

---

## "새 탭이 열리는가"로 재분류

| 결과 유형 | 해당 항목 |
|---|---|
| **새 탭 열림** | GWP(ktelecom·kestate 제외), EXPERT, kemergency, `[OPEN_SETTINGS_TAB]`/`[OPEN_K_SERVICES_TAB]`, `[SEARCH: ..., mode=tab]` |
| **같은 패널에서 처리(태그는 나가지만 탭 없음)** | CALL_KINTENT 오케스트레이션, CALL_KTELECOM/CALL_KESTATE, WEB_SEARCH, DELEGATE_TO_FLASH, SEARCH(대화중), SP_DRAFT_REQUEST 계열 |
| **태그 없이 텍스트로만 처리** | 잡담·감정표현 응답, 되묻기, PDV 조회 반영, 핸드셰이크 |
| **AC 판단 이전의 코드 전처리(태그 아님)** | 라우팅 힌트 사전필터(0.5단계) — 후보를 좁히거나(참고용) R2를 확정(구속력 있음)할 뿐, 그 자체로 탭이나 태그를 발생시키지 않는다 |

---

## §TAGS 전체 목록 (AC-PRO-CORE_v1_9.txt §TAGS 그대로, 참조용)

| 태그 | 용도 |
|---|---|
| `[GWP: {id}]` | 기관/K-서비스 새 탭 (ktelecom·kestate는 예외 — 아래 참조) |
| `[EXPERT: {personaId}]` | 전문가 AI 새 탭 |
| `[WEB_SEARCH: query=...]` | §INFO 경로1(공개정보) |
| `[SEARCH: query=..., type=user]` | 나비 사용자 검색(대화 중 후보 확인) |
| `[SEARCH: query=..., type=user, mode=tab]` | 검색 화면 자체 요청 |
| `[SP_DRAFT_REQUEST: domain=..., request=...]` | §DRAFT_REQUEST(전문직 SP 없음) |
| `[GWP_REGISTRY_SEARCH: q=..., category=..., tier=...]` | §GOV_MATCH 2단계 |
| `[GOV_SP_DRAFT_REQUEST: institution=..., task=..., tier_hint=..., source_conversation=...]` | §GOV_MATCH 3단계 |
| `[CALL_KINTENT: query=...]` | §ORCHESTRATION 진입 |
| `[RESUME_KEXECUTE: ...]` | 일시정지된 오케스트레이션 재개 |
| `[CALL_KTELECOM: query=...]` / `[CALL_KESTATE: query=...]` | ktelecom/kestate 전용(시스템 전환형, 새 탭 없음). 구식 `[GWP: id]`로 나와도 코드가 자동복구해 동등하게 처리(§CORE 2단계 참고) |
| `[DELEGATE_TO_FLASH: task=..., context=...]` | §DELEGATE — 가벼운 모델로 위임 |
| `[OPEN_SETTINGS_TAB]` / `[OPEN_K_SERVICES_TAB]` | 이용자가 명시적으로 설정/전체목록 요구 시만 |

★ `kbank`는 2026-08-01 철회(kgdc로 흡수). `OPEN_MANUAL_TAB`은 처리기가
없어 제외 — 사용법 안내는 profile-assistant 라우팅 또는 직접 설명으로
대체. [2026-08-04 제거] `[KSEARCH_HANDOFF]`/`[KSEARCH_RESULT]`도 AC의
태그 목록에서 빠졌다 — §CATALOG 표 밖 대상은 이제 이 시점에 이미
`[CALL_KINTENT]`로 넘어가 있어야 하며, K-Search 위임 이후 처리는
K-Compose/K-Execute(SP-20/SP-22 태그 규격)가 전담한다.

`[ctx]` 블록 전용 신호(태그가 아니라 코드→AC 방향 입력):

| 신호 | 용도 |
|---|---|
| `라우팅후보:id1,id2,...` | 0.5단계 사전필터가 좁힌 후보 목록(참고용, 구속력 없음) |
| `R2확정:id(사유: ...)` | [v1.2 신설] GWP끼리 충돌을 코드가 문자열 포함관계로 이미 확정한 결과(구속력 있음 — AC는 재판단하지 않고 채택) |
| `최우선후보:id(사유: ...)` | [v1.3 신설] 경쟁 후보가 전혀 없는(전부 0점) 유일 매칭을 코드가 확정한 결과(구속력 있음 — 명백히 안 맞는 경우가 아니면 채택). R2확정과 상호 배타적(R2확정은 최소 2개 후보 필요) |

---

## 미해결로 남긴 것 (2026-08-31 재검증에서 발견, 이번 개정 범위 밖)

- **정보성 절차 질문이 라우팅 없이 직접 답변으로 종료되는 패턴** —
  예: "계약서 작성 시 법적으로 뭘 조심해야 하는지"(기대: klaw),
  "고등학교 검정고시 진행 방식"(기대: kedu) 모두 태그 없이 AC가
  일반 지식으로 직접 답했다. R1-AC 원칙("제도 정보 관점 → GWP
  기본값")을 위반한 것으로 볼 수도, "일반 상식 수준은 직접 답해도
  된다"는 합리적 예외로 볼 수도 있다 — 원칙 자체를 먼저 정하지
  않고서는 코드로도 프롬프트로도 고칠 수 없어 이번 개정에서는
  다루지 않았다.

---

## 참고 문서

- `prompts/ROUTER-PRIORITY_v1_0.md` — 원래 설계 원칙(R0~R4, 요약
  결정 트리 포함). 이 문서의 0단계·확신도 게이트·R3 사업자 레이어는
  전부 여기서 가져왔다.
- `prompts/AC-PRO-CORE_v1_9.txt` — 실제 운영 로직(정본). §CORE·§INFO·
  §TAGS 참조. R2확정 신호를 소비하는 지시문이 R2-AC 문단 바로 뒤에
  있다(2026-08-31 추가).
- `src/gopang/ai/routing-hint.js` — 0.5단계 사전필터 오케스트레이션
  (2026-08-08 신설, 2026-08-31 R2확정 신호 추가). system 캐시(DeepSeek
  Auto Prompt Caching) 보존을 위해 후보 축소 결과를 system이 아닌
  매 턴 user 메시지 앞 [ctx] 블록에 얹는 방식을 택한 배경이 파일
  상단 주석에 설명돼 있다.
- `src/gopang/ai/candidate-prefilter.js` — 0.5단계의 0단계(로컬
  trigger 매칭, LLM 미호출) + `findGwpR2Winner()`(2026-08-31 신설,
  R2 결정론적 확정). 순수 문자열 부분일치 기반이라 리터럴 trigger가
  없는 패러프레이즈는 못 좁히는 한계가 파일에 명시돼 있다.
- `src/gopang/ai/domain-classifier.js` · `domain-taxonomy.js` —
  0.5단계의 1단계(도메인 분류, LLM 1회). 실패 시 좁히지 않고 안전
  폴백하는 원칙이 subject-gate.js와 동일하다.
- `docs/HANDOFF_2026-08-06_routing-branch-live-smoketest.md` — 이
  라우팅 판단들이 실사로 검증된 스모크테스트 기록.
- `tests/live_smoketest/scenarios_routing_branches_20260806.json` —
  이 결정 트리 전체를 커버하는 34건 라이브 회귀 시나리오. 2026-08-31
  재검증(v1_7 기준)에서 12 FAIL을 발견해 이번 v1.2 개정을 유발했다.
- `tests/live_smoketest/scenarios_full_sp_coverage_20260831.json` —
  [v1.2 신설, 2026-08-31 재작성] 88개 SP(GWP 26 + EXPERT 루트 62)
  전체를 각 1건씩 커버하는 통합 배치. 초안은 EXPERT 60건이 "~한테
  직접 상담받고 싶어요"처럼 SP 명칭(직함) 자체를 발화에 그대로
  박아넣은 반칙 케이스였음이 지적돼 전량 폐기하고, 명칭을 전혀
  언급하지 않은 채 상황 서술 + 위임의도 표현만으로 해당 전문직이
  식별되도록 60건 전부 다시 썼다(예: "치과기공사" 대신 "제 틀니를
  맞춤 제작해 주실 분께 직접 의뢰하고 싶어요"). GWP 26건은 원래도
  명칭 미언급 상태라 그대로 유지. 결정 트리의 "분기"가 아니라 "SP
  목록 자체의 전수 커버리지"를 검증하는 용도라 위 34건 배치와
  상호 보완적이다. 첫 라이브 실행(88건 중 17 FAIL)에서 [v1.3]의
  최우선후보 메커니즘과 8개 EXPERT trigger 보강을 유발했다.

## v1.3 개정(2026-08-31, 같은 날 3차 재개정) — 최우선후보 신설

`scenarios_full_sp_coverage_20260831.json` 첫 라이브 실행(88건 중
17 FAIL)을 분해한 결과:
- **5건은 테스트 저작 오류**(kqna/kusers 소관 오인, kfinance는 오히려
  EXPERT가 정답, tool-web-search는 스키마 오분류, tool-calculator는
  애초에 미구현 기능) — 전부 테스트 파일 쪽에서 수정했다.
- **4건은 R2와 동일한 실패 유형**(dentist, dental-hygienist,
  navigation-officer, fiil-kcleaner) — 사전필터가 압도적 단일 후보를
  정확히 찾아냈는데도(경쟁 후보 전부 0점) AC가 더 범용적인 인접
  대상이나 CALL_KINTENT로 새어버림. `candidate-prefilter.js`에
  `findDominantCandidate()`를 신설(R2확정과 상호 배타적: 경쟁자가
  전혀 없는 유일 매칭만 확정), `routing-hint.js`가 `[ctx]`에
  `최우선후보:id`로 얹도록 배선, `AC-PRO-CORE_v1_9.txt`에 소비
  지시문 추가.
- **8건은 사전필터가 애초에 후보로도 못 찾음**(customs-broker, nurse,
  paramedic, social-worker, curator, childcare-teacher,
  gas-safety-engineer, tour-guide) — 이 8개 EXPERT 항목이 "직업명
  위주로만" 등록돼(2026-07-25 원 설계) 있어 직업명을 안 쓰는 자연어
  상황 표현은 로컬 매칭 점수가 0이 됨. `expert-registry-core.js`에
  각 항목당 상황 표현 trigger 2~3개씩 보강 — 8/8 전부 정상 발견되는
  것까지 코드로 검증했다.

이 개정으로 AC-PRO-CORE가 v1_8 → v1_9로 갱신됐다. §TAGS 표의
`R2확정` 행 아래에 `최우선후보` 행이 추가된다(아래 참조).
- `src/tests/ai-secretary/candidate-prefilter.test.mjs` — `findGwpR2Winner()`
  단위 회귀 테스트(부가세/kbusiness 사례 포함, 2026-08-31 신설).
