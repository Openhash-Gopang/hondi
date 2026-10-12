# AC↔SP 통신 아키텍처 매뉴얼 v1.0
## AI 비서(AC)가 언제 혼자 응답하고, 언제 다른 SP를 불러 결과만 전달하고, 언제 새 탭을 여는가

> **작성일**: 2026-08-06
> **메타 매뉴얼**: [`docs/MANUAL_INDEX.html`](./MANUAL_INDEX.html)
> **관련 코드**: `src/gopang/ai/call-ai.js`(`_handleOrchestrationTags`·`_forwardSwitchSP`·
> `_pushAndSwitchSP`·`_popSP`·`_watchdogSendFn`·`_recoverOrchestrationFailure`) ·
> `src/gopang/ai/expert-session.js`(`handleExpertTag`) ·
> `src/gopang/core/token-policy.js`(`resolveOrchestrationModel`) ·
> **관련 SP**: `AC-PRO-CORE`(§0-H, 오케스트레이션 트리거) · K-Intent 시리즈
> (K-Intent/K-Compose/K-Execute/K-Deliver/K-Report, 현재 파일명은
> `prompts/sp-catalog.json` 참조 — 이 문서에서 파일명+버전을 직접 박지
> 않는 이유는 `tools/check_no_hardcoded_sp_refs.py`와 동일)

이 문서는 사용자가 나비 채팅창에서 무언가를 요청했을 때, 실제로 **누가 응답하고
있는지**(AC 자신인지, AC가 부른 다른 SP인지, 사용자가 직접 다른 SP와 대화하게
됐는지)를 코드 기준으로 정확히 정의합니다. 2026-08-06 세션에서 라이브 재검증
중 오케스트레이션이 패널에서 조용히 멈추는 문제를 진단하며 아키텍처 전체를
다시 확인했고, 그 결과를 정리한 것입니다 — 추정이 아니라 이 문서의 각 주장은
실제 코드 위치를 인용합니다.

---

## 0. 세 가지 시나리오 — 한눈에

| 시나리오 | 예시 발화 | 누가 응답하는가 | 창(탭) | 대표 코드 경로 |
|---|---|---|---|---|
| **① AC 단독 응답** | "오늘 약속잡힌 게 뭐지?" | AC(AGENT-COMMON) 혼자 | 같은 창 | `_callAIInner`가 오케스트레이션 태그 없이 그대로 응답 |
| **② AC가 SP를 불러 결과 전달** | "어제 증권시장 상황을 요약해 줘" | AC → K-Intent → K-Compose → K-Execute 등 릴레이, 결과가 같은 스트림에 이어짐 | 같은 창 | `_handleOrchestrationTags` (K-Intent 시리즈) |
| **③ 새 탭 개설, AC는 이탈** | "변호사 AI 페르소나를 불러줘" | 사용자 ↔ 호출된 SP(전문가 페르소나·기관 서비스)가 **직접** 대화 | 새 탭 | `handleExpertTag` / GWP 라우팅(`_gwpLaunch`) |

세 시나리오를 구분하는 기준은 **"사용자 발화가 어떤 태그를 유발했는가"** 하나뿐입니다. 아래에서 각각을 코드 근거와 함께 설명합니다.

---

## 1. 시나리오 ① — AC 단독 응답

가장 단순한 경로입니다. `_callAIInner`(메인 채팅) 또는 `_callPanelAI`(패널)가 AC(AGENT-COMMON) SP로 LLM을 호출하고, 응답에 `CALL_KINTENT`·`EXPERT:`·`GWP:` 같은 라우팅 태그가 전혀 없으면 그 응답을 그대로 스트리밍해서 보여주고 끝납니다. 다른 어떤 핸들러도 개입하지 않습니다.

**판단 기준**: AC 자신의 시스템 프롬프트(`AC-PRO-CORE`)가 "이 발화는 SP 호출 없이 내가 직접 답할 수 있다"고 판단하는가. 이 판단 자체는 코드가 아니라 LLM(AC)의 몫입니다 — 코드는 그 결과(태그가 있는지 없는지)만 보고 분기합니다.

---

## 2. 시나리오 ② — AC가 K-Intent 시리즈를 호출, 결과만 전달

### 2.1 왜 "결과만 전달"인가 — 메커니즘 정정

사용자에게 보이는 효과는 "AC가 다른 SP와 소통한 뒤 결과를 요약해서 알려주는 것"처럼 보이지만, **실제 메커니즘은 다릅니다.** AC가 결과를 가공·요약해서 자기 목소리로 전달하는 게 아니라, **바통을 넘긴 다음 SP가 같은 대화 스트림에 자기 응답을 직접 이어 씁니다.** AC는 넘긴 뒤 관여하지 않습니다. 사용자 입장에서 "누가 말했는지 몰라도 된다"는 결과는 동일하므로 이 시나리오 설명 자체는 유효하지만, 정확히는:

> AC가 SP의 말을 "전달"하는 게 아니라, **SP가 AC 자리에서 직접 이어 말한다.**

### 2.2 K-Intent 시리즈 — 정확한 정의

"K-Intent 시리즈"는 다음 5개 SP를 가리킵니다. 이들은 별도의 "오케스트레이션 SP"가 위에서 지휘하는 구조가 아니라, **체인 안의 각 SP가 자기 차례에 다음 SP를 직접 호출하고 바통을 넘기는 릴레이 구조**입니다.

| SP | 역할 |
|---|---|
| K-Intent | 사용자 요청을 구조화된 목표로 정리 |
| K-Compose | 목표를 절차(어느 기관·어떤 단계)로 분해 |
| K-Execute | 분해된 절차를 실제로 실행(기관 조회·신청 등) |
| K-Deliver | 실행 결과를 사용자에게 전달할 형태로 정리 |
| K-Report | 이해당사자 통지·신고가 필요하면 처리 |

(각 SP의 현재 파일명·버전은 `prompts/sp-catalog.json`을 참조하세요 — 이 문서에서
파일명+버전을 직접 적지 않는 이유는 위 헤더에 적은 대로 `tools/check_no_hardcoded_sp_refs.py`와
동일한 원칙입니다.)

**전환 프로토콜**: 각 SP가 자기 업무를 마치면 `[HANDOFF_TO_KCOMPOSE:...]` `[HANDOFF_TO_KEXECUTE:...]` 같은 태그를 스스로 발급하도록 각 SP의 시스템 프롬프트에 지시돼 있습니다. `call-ai.js`의 `_handleOrchestrationTags()`가 그 태그를 감지해 실제로 다음 SP의 시스템 프롬프트를 로드하고 재호출하는 "기계적 배선" 역할을 합니다. 이 함수 없이는 태그가 발급돼도 아무 일도 일어나지 않습니다(§4-2 참고).

**전달(forward) vs 위임(push) — 이 함수의 핵심 책임**:

- **전달(forward, `_forwardSwitchSP`)**: 돌아올 필요 없음. AC→K-Intent, K-Intent→K-Compose, K-Compose→K-Execute→K-Deliver→K-Report가 전부 이 방식입니다. `CFG.system`만 바꿔치기하고 끝 — 이전 SP는 이후 관여하지 않습니다.
- **위임(push, `_pushAndSwitchSP`/`_popSP`)**: 반드시 돌아와야 함. K-Compose가 K-Search나 EXPERT 페르소나를 `scope=orchestration_subtask`로 부를 때만 이 방식을 씁니다. 현재 `CFG.system`을 `CFG.systemStack`에 쌓아두고 교체 → 상대가 결과 태그를 내면 스택에서 꺼내 정확히 원래 자리(주로 K-Compose)로 복귀합니다.

이 둘을 헷갈리면 안 됩니다 — 예를 들어 "AC가 상시 감독한다"는 건 **위임(push)** 패턴이고, 지금 K-Intent 시리즈 주 체인은 **전달(forward)** 패턴이라 AC는 한 번 넘기면 그 턴에는 다시 안 돌아옵니다.

### 2.3 실패 대응 — 워치독 (2026-08-06 신설)

전달(forward) 방식의 구조적 약점: 체인 중 어느 한 SP가 실패(LLM 후보 소진, 네트워크 오류, 45초 타임아웃)하면 아무도 그걸 되돌리지 않았습니다. 이를 보완하기 위해 "필요한 지점에만 감독을 넣는" 워치독을 도입했습니다:

- 평소엔 AC가 매 홉을 감독하지 않습니다(감독 비용 = 매번 hondi-pro 재판단 = 지연 증가, §2.4와 충돌하므로 지양).
- 실패가 **실제로 발생한 홉**에서만 `_recoverOrchestrationFailure`가 `CFG.system`을 `system_base`(AC)로 강제 복원하고, 실패 사유를 담은 `[INTERNAL: ...]` 메시지로 AC를 다시 불러 사용자에게 자연스럽게 설명·재시도/대체경로 판단을 맡깁니다.
- 구현: `callAI`/`_callAIInner`의 5번째 인자 `onFailure`, `_handleOrchestrationTags` 내부의 `_watchdogSendFn` 래퍼(재귀 `sendFn` 호출 23곳 전부 적용).

### 2.4 재주입 홉의 모델 티어 — hondi-flash vs hondi-pro

체인이 서버 조회 결과를 다시 SP에 먹이는 "단순 재주입" 턴(`PROCEDURE_MAP_LOOKUP_RESULT` 등)까지 전부 hondi-pro(reasoning 켜짐)로 돌리면 체감 지연이 커집니다. `token-policy.js`의 `resolveOrchestrationModel(tagType)`이 "단순 재주입"과 "진짜 판단"(신규 계획 수립, SP 간 전환 등)을 구분해 전자는 hondi-flash, 후자는 hondi-pro를 씁니다. 이 판정 결과는 `sendFn`의 4번째 인자(`modelTier`)로 흘러갑니다.

**알려진 제약**: 이 판정은 메인 채팅(`_callAIInner`)에서만 실제로 적용됩니다. 패널(`_callPanelAI`)은 아직 `_handleOrchestrationTags` 자체가 연결돼 있지 않아(§4-2), 오케스트레이션이 패널에서는 시작되지 않습니다.

### 2.5 실시간 진행 보고 (2026-08-06 신설)

체인이 SP를 전환하는 매 순간, 다음 SP의 응답(최대 수십 초, hondi-pro reasoning 포함)을 기다리는 동안 화면에 아무 변화가 없어 사용자가 막연히 기다려야 했습니다. SP 전환은 `_forwardSwitchSP`/`_pushAndSwitchSP`/`_popSP` 한 곳에서만 일어나므로, 여기서 다음 LLM 호출을 기다리지 않고 즉시 진행 상황 말풍선을 붙입니다:

```
🔄 요청 파악 단계로 이동 중…       (K-Intent)
🔄 절차 구성 단계로 이동 중…       (K-Compose)
🔄 실행 단계로 이동 중…           (K-Execute)
🔄 결과 정리 단계로 이동 중…       (K-Deliver)
🔄 통지·신고 처리 단계로 이동 중…   (K-Report)
```

내부 SP 코드명은 `_STAGE_LABELS` 매핑을 통해 사용자 친화적 한글로 변환됩니다. 매핑에 없는 라벨(예: `EXPERT:personaId`)은 안전하게 원문으로 폴백합니다.

이와 별개로 `[ORCHESTRATION_PROGRESS: step=n/total, doing=...]`이라는 SP 프롬프트 지시 기반 진행 태그도 이미 존재하지만(K-Compose·K-Execute 프롬프트에만 지시, K-Intent·K-Deliver·K-Report엔 없음), 이 태그는 모델이 생성하는 응답 "내용"의 일부라 reasoning이 끝나기 전까지는 화면에 나올 수 없습니다 — 정확히 사용자가 기다리는 그 구간에 무력합니다. 위 SP-전환-말풍선은 이 한계와 무관하게 클라이언트가 전환 사실 자체를 아는 즉시 동작하므로, 5단계 전체를 SP 프롬프트 협조 없이 커버합니다.

---

## 3. 시나리오 ③ — 새 탭 개설, AC 이탈

다음 두 경우에 새 탭이 열리고, **사용자는 그 탭에서 호출된 SP와 직접 대화**하게 됩니다. AC는 그 시점부터 관여하지 않습니다(다시 능동적으로 무언가를 하지는 않음 — 정확히는 "배경으로 물러난다"기보다는 원래 AC 창은 그대로 남아있고 사용자가 새 탭으로 이동하는 것).

### 3.1 GWP 기관 서비스 (K-Law 등)

`[GWP: id]` 태그 감지 시 `_gwpLaunch()`가 `pages/*.html`을 새 탭에서 엽니다. 별도 독립 서비스가 있는 기관 성격 SP가 대상입니다.

### 3.2 EXPERT 전문가 페르소나 (변호사·간호사 등)

`[EXPERT:personaId]` 태그 감지 시 `handleExpertTag()`(`expert-session.js`)가 **GWP 기관 서비스와 완전히 동일한 방식**(`_gwpLaunch`)으로 `pages/expert-chat.html`을 새 탭으로 엽니다. 이전 대화 맥락은 6하원칙 요약으로 새 탭에 함께 인계됩니다.

> ⚠️ **정정(2026-08-06)**: `expert-session.js` 파일 최상단 주석(1~6행)은 "전문가 AI는 같은 스레드 안에서 System Prompt만 교체하는 방식"이라고 적혀 있지만, 이는 **2026-07-03에 폐기된 옛 설계 설명**입니다. 그 방식을 구현하는 `startExpertSession()`은 `@deprecated 2026-07-22`로 표시돼 있고 `call-ai.js`에서 더 이상 import되지 않습니다 — 실제로는 3.2에 적힌 새 탭 방식만 동작합니다. 파일 상단 주석은 다음 정리 때 갱신이 필요합니다.

### 3.3 (참고) 죽은 코드 — `isExpertActive()`

`_callAIInner`가 매 턴 `maybeHandleExpertTurn`/`isExpertActive()`를 호출하지만, 이를 활성화하는 `startExpertSession()`이 위처럼 폐기돼 있어 `isExpertActive()`는 **항상 `false`만 반환**합니다. 동작에 영향은 없으나(매 턴 아무 일도 안 하는 체크가 하나 더 도는 것뿐) 다음 코드 정리 때 제거 후보입니다.

---

## 4. 패널(`_callPanelAI`)과의 차이 — 알려진 아키텍처 갭

이 문서에 정리된 세 시나리오는 **메인 채팅(`_callAIInner`) 기준**입니다. 패널은 다음 지점에서 다릅니다:

### 4.1 시나리오 ①·③은 패널에서도 동작

AC 단독 응답과 새 탭 개설(GWP·EXPERT)은 패널에도 배선돼 있습니다(`_parseAgentTags`, `handleExpertTag` 호출부 존재).

### 4.2 시나리오 ②는 패널에서 동작하지 않음

`_handleOrchestrationTags` 자체가 패널에 import·호출되지 않습니다. 모델이 `[CALL_KINTENT]` 등을 정상적으로 발급해도(2026-08-06 실사로 SSE 페이로드 확인 — `finish_reason: "stop"`, 태그 정상 생성) 아무도 그 태그를 실행하지 않아 오케스트레이션이 조용히 멈춥니다.

**왜 단순히 함수를 연결하면 안 되는가**: `_handleOrchestrationTags`의 SP 전환 로직(`_forwardSwitchSP`/`_pushAndSwitchSP`)이 `call-ai.js` 모듈 전역의 `CFG.system`을 직접 변경합니다 — 이는 메인 채팅이 쓰는 공유 싱글턴입니다. 패널은 "항상 AGENT-COMMON만 쓴다"는 설계 원칙으로 자기만의 로컬 `_panelHistory[0]`을 씁니다. 그대로 연결하면 (1) 패널 자신은 전환이 실질적으로 적용 안 되거나, (2) 사용자가 패널과 메인 채팅을 동시에 열어둔 경우 메인 채팅의 활성 SP 상태를 패널이 옆에서 덮어쓰는 크로스 오염이 발생할 수 있습니다.

**해결 방향(미착수, 다음 세션 과제)**:
1. 패널 전용 SP 전환 함수 신설 — `CFG.system` 대신 `_panelHistory[0]`을 바꾸는 버전. 정공법이나 손이 많이 감(`_handleOrchestrationTags` 내부 호출 지점 10여 곳 수정 필요).
2. 패널에서 오케스트레이션 태그 감지 시 메인 채팅으로 핸드오프 — 코드 변경은 작지만 UX가 바뀜(패널 안에서 안 끝남).

---

## 5. 요약 — 판단 흐름도

```
사용자 발화
  │
  ▼
AC(AGENT-COMMON)가 1차 응답
  │
  ├─ 라우팅 태그 없음 ──────────────────► [시나리오 ①] AC 단독 응답, 종료
  │
  ├─ [CALL_KINTENT] 등 K-Intent 시리즈 ─► [시나리오 ②] _handleOrchestrationTags가
  │                                        전달(forward)로 릴레이, 실패 시 워치독,
  │                                        전환마다 진행 말풍선. 메인 채팅만 동작(§4.2)
  │
  └─ [GWP:id] 또는 [EXPERT:personaId] ─► [시나리오 ③] 새 탭 개설(_gwpLaunch),
                                           AC는 그 창에서 이탈. 패널에서도 동작
```

---

*이 문서는 실사(코드 인용·SSE 페이로드 확인)를 기반으로 작성됐습니다. 코드가
바뀌면 이 문서도 함께 갱신해야 합니다 — 특히 §4의 패널 오케스트레이션 배선이
완료되면 §0·§4 전체를 다시 써야 합니다.*
