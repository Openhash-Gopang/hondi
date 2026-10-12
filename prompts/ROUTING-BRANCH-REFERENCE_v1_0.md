# ROUTING-BRANCH-REFERENCE · 사용자 발화 분기 경우의 수 종합 v1.0

> **이 문서의 성격**: 별도 신규 로직이 아니다. `ROUTER-PRIORITY_v1_0.md`
> (원래 설계 원칙)와 `AC-PRO-CORE_v1_1.txt`(§CORE·§INFO·§TAGS의 날짜별
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
> **정본(source of truth)은 이 문서가 아니다** — 실제 동작은 어디까지나
> `AC-PRO-CORE_v1_1.txt`가 정본이고, `ROUTER-PRIORITY_v1_0.md`가 그
> 원칙적 배경이다. 이 문서는 그 둘의 **스냅샷 종합**이라 두 원본이
> 바뀌면 낡아진다 — AC-PRO-CORE에 §CORE·§INFO·§TAGS 관련 실질적
> 변경이 있을 때마다 이 문서도 함께 갱신할 것.

---

## ⚠ 알려진 문서 드리프트 — R1/R2 이름표 충돌

두 소스 문서가 "R1"·"R2"라는 같은 이름표를 **다른 개념**에 쓰고 있다:

| 이름표 | `ROUTER-PRIORITY_v1_0.md` | `AC-PRO-CORE_v1_1.txt` 인라인 주석 |
|---|---|---|
| R1 | 공익 대변 vs 사익 대리 (K서비스+정부기관 vs 전문가 페르소나) | GWP vs EXPERT 판정축(2026-08-01 추가) — 개념은 유사하지만 표현·근거가 다시 쓰임 |
| R2 | 국가사무 vs 자치사무 (K서비스 vs Jejudo 정부기관) | GWP끼리 충돌 시 우선순위(2026-08-06 추가) — **원본 문서엔 없던 완전히 새 개념** |

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
 ├─ 1단계: 의도가 명확한가? (§CORE ①)
 │      ├─ No(후보 2개 이상 + 가를 신호 없음, 또는 판단정보 부족)
 │      │    → 새 탭 없이 후보 나열 후 되묻기. 재확인 후 1단계 재평가.
 │      └─ Yes ↓
 │
 ├─ 2단계: §CATALOG(GWP)·§CATALOG-EXPERT(전문직) 표에 그 주체가
 │         있는가? (§CORE ②)
 │      │
 │      ├─ 표 안에 있다(단일 주체로 특정됨)
 │      │    │
 │      │    ├─ R1-AC: 질문 성격이 제도·제3자 관점인가, 개인 위임
 │      │    │         의도가 명시됐는가?
 │      │    │      ├─ 제도·제3자 관점 → GWP 후보(기본값)
 │      │    │      └─ 개인 위임 의도 명시 → EXPERT 후보
 │      │    │
 │      │    ├─ R2-AC: GWP 후보가 둘 이상 동시에 그럴듯한가?
 │      │    │      → 더 구체적인 trigger/분야를 가진 쪽으로 좁힌 뒤
 │      │    │        R1-AC 적용
 │      │    │
 │      │    ├─ 확신도 게이트(ROUTER-PRIORITY §확신도) 통과?
 │      │    │      ├─ No → 새 탭 안 열고 되묻기/컨텍스트 보완 →
 │      │    │      │        0단계부터 재평가
 │      │    │      └─ Yes ↓
 │      │    │
 │      │    ├─ GWP 확정, 그런데 id가 ktelecom/kestate(예외)
 │      │    │      → 새 탭 아님. [CALL_KTELECOM: query=...] /
 │      │    │        [CALL_KESTATE: query=...]로 시스템 내 전환.
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

---

## §TAGS 전체 목록 (AC-PRO-CORE_v1_1.txt §TAGS 그대로, 참조용)

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
| `[CALL_KTELECOM: query=...]` / `[CALL_KESTATE: query=...]` | ktelecom/kestate 전용(시스템 전환형, 새 탭 없음) |
| `[DELEGATE_TO_FLASH: task=..., context=...]` | §DELEGATE — 가벼운 모델로 위임 |
| `[OPEN_SETTINGS_TAB]` / `[OPEN_K_SERVICES_TAB]` | 이용자가 명시적으로 설정/전체목록 요구 시만 |

★ `kbank`는 2026-08-01 철회(kgdc로 흡수). `OPEN_MANUAL_TAB`은 처리기가
없어 제외 — 사용법 안내는 profile-assistant 라우팅 또는 직접 설명으로
대체.

---

## 참고 문서

- `prompts/ROUTER-PRIORITY_v1_0.md` — 원래 설계 원칙(R0~R4, 요약
  결정 트리 포함). 이 문서의 0단계·확신도 게이트·R3 사업자 레이어는
  전부 여기서 가져왔다.
- `prompts/AC-PRO-CORE_v1_1.txt` — 실제 운영 로직(정본). §CORE(64행~)·
  §INFO(226행~)·§TAGS(676행~) 참조. 이 문서의 R1-AC/R2-AC와 예외
  사례(ktelecom/kestate)는 전부 여기서 가져왔다.
- `docs/HANDOFF_2026-08-06_routing-branch-live-smoketest.md` — 이
  라우팅 판단들이 실사로 검증된 스모크테스트 기록.
