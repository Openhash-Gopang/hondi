# 세션 교훈 — "AI 메신저 테스트 버전" ↔ 메인 채팅(callAI) 감사 (2026-09-14)

## 한 줄 요약

`webapp.html`의 "AI 메신저" 패널(`_callPanelAI`)은 2026-07-07 `#message-list`
(구 메인 채팅)가 화면에서 숨겨진 뒤로 **사실상 유일한 프로덕션 화면**이 됐지만,
`call-ai.js`의 메인 채팅 파이프라인(`_callAIInner`)과는 코드가 완전히 분리된
별도 구현이라, 메인 채팅 쪽에 있는 기능 중 상당수가 이 패널에는 배선조차
안 돼 있었다. "AI 메신저 테스트 버전"이라는 이름표가 이 격차를 "테스트니까
아직 부족하겠지"로 오인하게 만들어, 실제 원인 파악이 여러 차례 늦어졌다.

## 발단

사용자가 "지금 내 위치 근처 중국집 찾아줘"라고 물었을 때, AC-PRO-CORE·
`services/location.js`가 이미 GPS→Kakao 역지오코딩→IP 폴백 순으로 위치를
확보해두고 있었는데도 모델이 "실시간 위치를 읽어오는 기능이 없다"고
사실과 다르게 답했다(스크린샷 재현, 2026-09-14). 처음엔 AC-PRO-CORE
프롬프트 문서에 "이용자가 위치를 직접 물으면 어떻게 답하라"는 지시가
없는 문서 결함으로 보고 §LOCATION-ANSWER 절을 신설(v1.15)했다. 배포·
매니페스트 반영까지 확인했는데도 모바일에서 재현하면 여전히 같은 증상이
나왔다 — 그래서 "패널 자체가 위치 컨텍스트를 애초에 안 만든다"는 더
근본적인 원인을 찾게 됐다.

## 근본 원인 — 패널과 메인 채팅의 구조적 분리

`webapp.html`이 `call-ai.js`에서 **가져다 쓰는** 것:
- 시스템 프롬프트 로딩(`_loadAgentCommonSP`), 프로필 태그 처리
  (`_handleProfileTags`), 웹검색(`_handleWebSearchTag`), hondi-flash 위임
  (`_handleDelegateToFlashTag`), SP-Author 자동화(`_handleSPAuthorTags`),
  오케스트레이션(`_handleOrchestrationTags`), 대화 스타일 강제
  (`_enforceConversationalStyle`/`_enforceRoutingBias`).

`webapp.html`이 **독자적으로 재구현한** 것(그래서 메인 채팅 수정이 자동
반영되지 않는 부분):
- 스트리밍 자체 — 후보 생성, fetch, SSE 파싱, 재시도 로직 전체
  (`_streamOneAttempt`를 재사용하지 않음).
- 대화 기록 — 메인은 `history`, 패널은 `_panelHistory` (서로 다른 배열).
- **매 턴 사용자 메시지 앞에 붙는 동적 컨텍스트** — 메인 채팅은
  `_buildEnhancedUserContent()` 하나가 GUID·닉네임·비서이름·프로필
  완성도·PDV 요약·**위치([현재 위치])**를 전부 묶어서 처리하는데, 패널은
  이 함수를 아예 호출한 적이 없었다. `_buildFirstContactContext()`/
  HONDI-FAQ만 개별적으로 이식돼 있었을 뿐이다.
- **다음 5개 태그 실행기 자체가 import조차 안 돼 있었다**:
  `_handleGovTaskTags`(정부 서류 접수·수수료 승인 등), `_handleDeptTaskTag`
  (부서 업무 요청), `_handleKSearchExecutionTag`(K-Search 질의 실행),
  `_handleCreateUnclaimedProfileTag`(무주인 프로필 생성),
  `_handleBalanceCheckTag`(재무제표 조회). 즉 이 기능들은 패널에서
  구조적으로 동작할 수 없는 상태였다 — AC가 태그를 냈어도 화면에서
  지워지기만(`_stripInternalTags`) 하고 조용히 멈췄다.

## 왜 통째로 이식하지 않았는가 (설계 제약)

`_handleOrchestrationTags`처럼 **모듈 전역 `CFG.system`을 바꾸는** 함수는
패널에 직접 이식하면 안 된다 — 패널은 `CFG.system`을 안 건드리는 설계
(`_panelHistory` 로컬 상태)라, 억지로 이식하면 (a) 패널 자신은 전환이
반영 안 되거나 (b) 화면엔 안 보이지만 살아있는 메인 채팅의 `CFG.system`을
옆에서 덮어쓰는 크로스 오염이 생긴다. 기존 코드는 오케스트레이션 태그가
감지되는 순간 그 턴의 대화 전체를 `call-ai.js`의 공유 파이프라인으로
명시적으로 넘기는(`setBubbleTarget` + `_panelHistory.length = 0`) 방식으로
우회했다.

반면 오늘 이식한 5개 핸들러는 전부 **leaf 핸들러**임을 함수 본문을 직접
grep해 확인했다 — `CFG.system`이나 `_forwardSwitchSP`/`_pushAndSwitchSP`를
전혀 건드리지 않고, `history.push(...)` + `sendFn(주입텍스트)`만 한다.
이미 안전하게 이식돼 있던 `_handleWebSearchTag`/`_handleDelegateToFlashTag`/
`_handleSPAuthorTags`와 정확히 같은 부류라, 같은 패턴
(`bubbleEl`, `_panelSendFn`, `userText`)으로 안전하게 추가할 수 있었다.
이 5개가 내부에서 `history.push`하는 대상은 패널이 안 쓰는 죽은 배열이라
무해하다 — 실제 대화 연속성은 `_panelSendFn`이 `_callPanelAI()`를 재귀
호출해 `_panelHistory`에 정상 반영하는 경로로 유지된다.

## 오늘 적용한 수정

1. **위치 컨텍스트 배선** (`services/location.js`의 `_buildLocNote`/
   `_waitForLocationReady`를 패널에 import) — `_buildLocNote()`의 원형
   출력(`"\n\n[현재 위치]\n상세"`, 태그와 내용이 분리된 멀티라인)은 패널의
   `_stripLeadingInternalTag`(대괄호 하나가 통째로 닫히는 단일 블록만
   인식)와 안 맞아 그대로 붙이면 위치 상세정보가 사용자 발화처럼 화면에
   노출될 위험이 있었다 — `_buildFirstContactContext()`와 동일하게 전체를
   대괄호 하나로 감싼 단일 태그(`[현재 위치: 상세]`)로 재포맷해서 매 턴
   사용자 메시지 앞에 붙이도록 고쳤다.
2. **5개 leaf 액션 태그 실행기 이식** — `_handleBalanceCheckTag`,
   `_handleKSearchExecutionTag`, `_handleCreateUnclaimedProfileTag`,
   `_handleGovTaskTags`, `_handleDeptTaskTag`를 import해 기존 태그
   처리 파이프라인(`_handleSPAuthorTags` 다음, `_parseAgentTags` 이전)에
   순차 추가했다.
3. **이름표 정정** — "{이름}, AI 메신저 테스트 버전" → "{이름}, 최신 버전".
   "테스트"라는 문구가 이번 사고에서 "격차 원인 파악"을 반복해서 늦춘
   핵심 오인 요소였다.

## 다음 세션을 위한 체크리스트

새 화면·패널을 `call-ai.js`(또는 어떤 "정본" 파이프라인이든) 위에 별도로
만들 때는, 배선하기 전에 반드시:

1. 정본 파이프라인이 **매 턴 사용자 메시지 앞에 붙이는 동적 컨텍스트**
   함수(예: `_buildEnhancedUserContent`)를 찾아, 그 안의 각 항목(위치·
   프로필·PDV·GUID 등)이 새 화면에도 필요한지 하나씩 대조한다 — "가져다
   쓰는 함수 목록"만 보고 끝내지 말 것, 안 가져다 쓰는 목록도 명시적으로
   만들어야 이번처럼 "위치가 통째로 빠짐"이 늦게 발견되지 않는다.
2. 정본 파이프라인이 실행하는 **모든 태그 핸들러 목록**을 grep으로 뽑아,
   새 화면이 import하는 목록과 diff한다. 응답에 태그가 나와도 화면에서
   조용히 지워지기만 하는 건 사용자에게는 "아무 반응 없음"으로만 보여
   버그 리포트로 이어지기 전까지 몇 주씩 묻힐 수 있다.
3. 각 핸들러를 이식하기 전에 **`CFG.system` 등 모듈 전역 상태를 건드리는지**
   함수 본문을 직접 읽고 확인한다 — leaf 핸들러(sendFn+history.push만)와
   SP-전환 핸들러(CFG.system 변경)는 이식 방법이 다르다.
4. 화면 이름에 "테스트"·"베타" 같은 문구가 붙어 있다면, 그게 아직도
   사실인지(진짜 대안이 존재하는지) 먼저 확인한다 — 사실이 아니면 그
   이름표 자체가 다음 사람의 진단을 늦추는 원인이 된다.
