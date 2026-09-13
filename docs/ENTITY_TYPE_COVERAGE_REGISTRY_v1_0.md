# entity_type 완결성 레지스트리 v1.0
**작성** Claude | 2026-09-13 | **근거** 라이브 스모크테스트
`profile_assistant_scenarios_diverse_industries_20260913.json` 실측(#5/#11/#18 FAIL)

## 왜 필요한가

`worker.js`가 서버에서 화이트리스트로 강제하는 entity_type은 8종
(person·business·institution·org·thing·concept·platform·consumer)인데,
이 8종 각각이 profile-assistant SP 안에서 실제로 다뤄지려면 최소 아래
두 가지가 전부 갖춰져야 한다:

  1. **트리거예시** — `[P1-INFER]`에 그 타입으로 판단하게 만드는 구체적인
     사용자 발화 예시 문장이 있는가(예시가 없으면 모델이 일반 상식으로
     추측하다 person 등 기본값으로 새기 쉽다 — 2026-09-13 실사 #18에서
     consumer가 이 결함으로 person으로 샜다).
  2. **카드포맷** — `[§PROFILE_CARD]`에 그 타입 전용 표시 형식이 있는가
     (없으면 STEP-FINAL에서 사용자에게 어떤 값으로 등록되는지조차 보여줄
     방법이 없다).

서버 화이트리스트에 값을 추가할 때 이 두 가지를 프롬프트 본문 여기저기에
손으로 채워 넣는 방식이라, 하나라도 빠지면 실사고가 나기 전까지 아무도
모른다(`tools/check_capabilities_registry.py`가 잡아낸 "역량 주장 vs
실제 배선 불일치"와 동일한 종류의 문제). 이 레지스트리는 각 항목의
근거를 "파일경로::문자열" 형태로 명시하고, `tools/check_entity_type_coverage.py`가
그 문자열이 실제로 그 파일 안에 있는지 매번 직접 확인한다.

## 형식

각 entity_type 아래 `검증-트리거예시:`/`검증-카드포맷:` 줄은
`파일경로::찾을문자열` 형식이다. 문자열이 그 파일에 없으면 CI 실패.

### person
검증-트리거예시: prompts/profile-assistant/profile-assistant-v2_32.txt::개인 신상만 말하면 person으로 둡니다
검증-카드포맷: prompts/profile-assistant/profile-assistant-v2_32.txt::👤 {nickname}

### business
검증-트리거예시: prompts/profile-assistant/profile-assistant-v2_32.txt::장사해요
검증-카드포맷: prompts/profile-assistant/profile-assistant-v2_32.txt::🏪 {name}

### institution
검증-트리거예시: prompts/profile-assistant/profile-assistant-v2_32.txt::행정복지센터 등록하려고요
검증-카드포맷: prompts/profile-assistant/profile-assistant-v2_32.txt::🏛 {name}

### org
검증-트리거예시: prompts/profile-assistant/profile-assistant-v2_32.txt::협회 운영해요
검증-카드포맷: prompts/profile-assistant/profile-assistant-v2_32.txt::🤝 {name}

### thing
검증-트리거예시: prompts/profile-assistant/profile-assistant-v2_32.txt::자율주행 셔틀
검증-카드포맷: prompts/profile-assistant/profile-assistant-v2_32.txt::🚗 {name}

### concept
검증-트리거예시: prompts/profile-assistant/profile-assistant-v2_32.txt::AI 페르소나야
검증-카드포맷: prompts/profile-assistant/profile-assistant-v2_32.txt::🤖 {name}

### platform
검증-트리거예시: prompts/profile-assistant/profile-assistant-v2_32.txt::배달 플랫폼 자체를 등록하려고요
검증-카드포맷: prompts/profile-assistant/profile-assistant-v2_32.txt::💻 {name}

### consumer
검증-트리거예시: prompts/profile-assistant/profile-assistant-v2_32.txt::그냥 물건 사려고 가입했어요
검증-카드포맷: prompts/profile-assistant/profile-assistant-v2_32.txt::🛒 {nickname}

## 버전 이력
v1.0 (2026-09-13) — 최초 작성. 8종 전부 v2.32 기준 문자열로 채움(작성
당시 v2.31에는 institution·platform·consumer의 트리거예시, consumer의
카드포맷이 없었다 — 아래 "v2.31 기준 실행 결과" 참조).

## 참고: v2.31 기준 실행 결과(수정 전, 기록용)
`python3 tools/check_entity_type_coverage.py --sp-file prompts/profile-assistant/profile-assistant-v2_31.txt`
실행 시 아래 4건 FAIL(나머지 12건 PASS):
  - institution 트리거예시: 없음(기관/공공성 정의 외 실제 발화 예시 없음)
  - platform 트리거예시: 없음(필드 구조 설명만 있고 발화 예시 없음)
  - consumer 트리거예시: 없음(enum 목록에 이름만 존재)
  - consumer 카드포맷: 없음(§PROFILE_CARD에 consumer 항목 자체가 없음)
