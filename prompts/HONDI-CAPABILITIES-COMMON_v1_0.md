# HONDI-CAPABILITIES-COMMON v1.0

이 문서는 "혼디가 지금 실제로 할 수 있는 것"의 **단일 소스**다. 여러 SP가
각자 프로즈로 베껴 적으면(이번에 발견한 사고 사례 참고 — 아래 §배경)
반드시 서로 다른 속도로 낡아 갈라진다. 그래서 이 문서 하나만 두고, SP는
이 문서를 그대로 로드해서 참조한다(예: profile-assistant는
`config.js`의 `loadPersonalAssistantSP()`가 이 문서를 함께 fetch해
자기 SP 앞에 붙인다 — 복사·재입력하지 않는다).

**이 문서를 수정하는 사람에게**: 새 항목을 추가할 땐 반드시 `검증-*` 줄에
실제 파일 경로와, 그 파일 안에 실재하는 문자열(라우트 경로·함수명·태그
정규식 등)을 적어라. `tools/check_capabilities_registry.py`가 매 push·
PR·매일 스케줄로 이 줄들을 실제 코드와 대조한다(gopang-wallet.js
드리프트 검사와 동일한 철학 — "동기화했다"는 자기보고를 신뢰하지 않고
직접 대조한다). 검증 대상 없이 프로즈만 추가하면 그 항목은 검사 대상이
아니게 되어 다시 조용히 낡을 수 있다.

---

## §배경 — 이 문서가 왜 필요한가

2026-07-27, profile-assistant SP에 "실재하는 도구만 제안하라"는 원칙
(§DIGITAL-BRIDGE)을 넣는 과정에서, 그 목록을 SP 안에 프로즈로 하드코딩
하려다가 먼저 이걸 발견했다: `call-ai.js`(AC가 쓰는 파일)에는
`[TEMPLATE_LOOKUP]` 태그 처리 코드가 있었지만, `pages/profile-assistant.html`
(2026-07-11부터 PA가 실제로 실행되는 파일)에는 2026-07-17 태그 개편
이후 그 코드가 한 번도 반영되지 않아, PA가 내는 태그가 실제로는 아무
데서도 처리되지 않고 있었다 — 즉 "이 기능이 있다"는 게 한쪽 파일 기준
으로는 참이고 다른 쪽 기준으로는 거짓이었던 것이다. 이런 종류의
드리프트(같은 지식을 여러 곳에 프로즈로 복사해두면 한쪽만 갱신되고
나머지는 조용히 낡는 것)를 SP 텍스트 차원에서 또 반복하지 않기 위해
이 문서를 단일 소스로 분리한다.

---

## 실재하는 도구 (2026-07-27 확인 기준)

### 혼디 코드 스캔
설명: 사업장 입구·전단에 붙여두면 손님이 혼디 앱 카메라로 스캔해 곧바로
이 프로필(미니 웹사이트)로 진입한다. 별도 인쇄 안내문 없이 이용 안내를
상시 노출할 수 있다.
검증-클라이언트: src/gopang/ai/hondi-scanner.js::lookupProfile
검증-클라이언트: src/gopang/ai/hondi-code.js::generateHondiCodeDataURL
확인일: 2026-07-27

### 사진 문서 판독 → 이용 안내 자동 요약
설명: 종이 안내문·약관·주의사항을 사진으로 찍으면 방문객이 미리 알아야
할 핵심을 자동 요약해 미니 웹사이트에 상시 게시한다. 내용이 바뀌면 다시
찍어 보내는 것만으로 갱신된다.
검증-서버: worker.js::resolvedDataSources
검증-서버: worker.js::avatar_url
검증-클라이언트: profile.html::notice-text
확인일: 2026-07-27

### 사진 갤러리
설명: §IMAGE-SCAN으로 첨부된 사진 전체가 공개 프로필(미니 웹사이트)에
갤러리로 게시된다.
검증-서버: worker.js::/profile/photo-upload
검증-서버: worker.js::/media/profile-photo/
검증-클라이언트: profile.html::photo-gallery
확인일: 2026-07-27

### GDC 지갑 결제
설명: 모든 가입자가 자동으로 갖는 gopang wallet으로 실시간 결제를
받는다.
검증-서버: worker.js::gdc_accepted
검증-클라이언트: prompts/profile-assistant/profile-assistant-v2_31.txt::gdc_accepted
확인일: 2026-09-03

### 계좌 이체 결제
설명: 본인이 지정한 실물 계좌 정보를 등록해 손님이 직접 입금할 수 있게
한다.
검증-서버: worker.js::payout_account
검증-클라이언트: profile.html::_copyPayoutAccount
확인일: 2026-07-27

### 예약 시스템
설명: 전화·수기 예약장 대신 손님이 프로필(미니 웹사이트)에서 직접 방문
슬롯을 예약한다.
검증-서버: worker.js::reservation_config
검증-클라이언트: profile.html::_editReservationSettings
확인일: 2026-07-27

### 업종 참조 템플릿(동종업계 프로필 조회)
설명: 업종이 확정되면 동종업계 공개 프로필 최대 8건을 참조해 어떤
정보를 추가로 물을지 스스로 판단한다(과반수 패턴만 참고).
검증-서버: worker.js::handleTemplateLookup
검증-클라이언트: pages/profile-assistant.html::_lookupTemplateAxis
확인일: 2026-07-27

---

## 아직 없는 것 (자주 나올 법한 아이디어 — 확정 약속 금지)

이 목록은 "곧 나온다"는 뜻이 아니라, PA가 헷갈리지 않도록 명시적으로
"없다"고 박아두는 목록이다. 아래 항목을 사용자에게 제안할 땐 반드시
§DIGITAL-BRIDGE의 [실재하지 않는 아이디어 처리] 절차([FEATURE_SUGGESTION]
기록, 확정 약속 금지)를 따른다.

- 고객의 화면 내 직접 전자서명 캡처·저장·검증(리스크 고지·동의서 등)
- 상품별 개별 사진 매칭(현재는 세션 전체 사진 갤러리만 지원, 사진과
  특정 상품을 1:1로 연결하지 않음)
- 계좌 입금의 자동 확인(무통장입금 매칭) — GDC 충전(고정계좌+입금자명
  매칭)과는 별개로, 사업자 개인 계좌로 들어오는 고객 결제의 자동 확인은
  없음. 사업자가 직접 대화로 확인해야 매출에 반영됨.
