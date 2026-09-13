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

### 영상 업로드/게시
설명: 사업자·기관·단체·플랫폼이 짧은 영상(mp4/webm/mov, 최대 50MB)을
업로드하면 공개 프로필에 영상 갤러리로 게시된다. 사진과 동일한 R2
버킷·URL 화이트리스트 원칙을 쓴다(외부 URL은 절대 그대로 노출하지
않음). 갤러리 상한 5개(사진보다 낮음 — 용량 부담 고려).
검증-서버: worker.js::/profile/video-upload
검증-서버: worker.js::/media/profile-video/
검증-클라이언트: profile.html::video-gallery
확인일: 2026-09-13

### 문서/메뉴판/이용안내 사진 자동 판독(대화 밖 — 대시보드용)
설명: §IMAGE-SCAN(대화 중 사진 판독)과 동일한 판독 규칙을 대시보드의
폼 편집기에서도 쓸 수 있게 한 것. 사진 한 장을 올리면 종류(메뉴판/
간판/사업자등록증/이용안내)를 스스로 판단해 이름·주소·업종·메뉴·
이용안내 초안을 구조화해 돌려준다. 이 엔드포인트 자체는 프로필을
쓰지 않는다 — 사람이 확인 후 기존 POST /profile로 확정해야 실제
반영된다(모든 AI 판독은 초안).
2026-09-13 재작성(2차) — 최초 구현은 DeepSeek image_url을 썼는데
당시(2026-08-21 이전) DeepSeek 텍스트 모델(v4-flash/v4-pro)은 실제로
이미지를 처리하지 못했다(resolveDeepseekModel()의 별칭 매핑이 비전
지원 이름을 텍스트 전용 모델로 되돌림 + §IMAGE-SCAN 자체가 원래
Gemini BYOK 기반이었음). 1차 수정으로 Gemini 플랫폼 키(env.
GEMINI_API_KEY)로 바꿨으나, DeepSeek가 2026년 8월 21일
deepseek-v4-flash-vision-exp(실험적, V4-Flash와 동일 가격)를 공개해
image_url 멀티모달이 정식으로 가능해진 것을 확인 — 이 모델 ID는
MODEL_ALIAS에 없어 안전하게 그대로 통과된다. 최종적으로 DeepSeek
비전 모델로 되돌렸다 — 이미 있는 DEEPSEEK_API_KEY만으로 동작하고
새 시크릿(GEMINI_API_KEY)이 필요 없다.
검증-서버: worker.js::handleProfileDocumentScan
확인일: 2026-09-13

### 대시보드 폼 편집기(대화 없이 직접 수정)
설명: PC 대시보드(pages/dashboard.html) "프로필 관리" 탭에 대화 없이
필드를 직접 보고 고칠 수 있는 폼을 추가했다 — 상호명·주소·전화·소개·
이용안내·영업시간(요일별)·메뉴 목록·공개여부, 사진·영상 업로드, 그리고
"사진으로 자동 채우기"(위 문서 자동 판독 호출)까지 이 폼 하나에서
처리한다. 백엔드는 새로 만들지 않고 기존 POST /profile을 그대로
재사용 — 이 폼이 직접 다루지 않는 필드(website·tags·holidays·
sns_public·languages_spoken·region·directions·parking·phone_visible·
field_visibility·job_ksco·affiliation·work_domain·avatar_url·
data_sources)는 저장 시 마지막으로 불러온 값을 그대로 되돌려 보내
실수로 지우지 않는다. gdc_accepted/currencies/price_range/
payout_account는 아예 보내지 않아 worker.js의 'in body' 보존 로직에
맡긴다. 여기서 편집한 영업시간·메뉴·소개·이용안내는 AI 점원 채팅
(buildSystemPrompt)이 그대로 근거 자료로 쓴다 — 별도 배선 불필요.
검증-클라이언트: pages/dashboard.html::pfSaveForm
검증-클라이언트: pages/dashboard.html::pfPopulateForm
확인일: 2026-09-13

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

### 프로필 다국어 자동 번역(뷰어 언어 감지 표시)
설명: 방문객이 프로필(미니 웹사이트)을 자신의 기기 언어(영어/일본어/
중국어)로 열람하면 이름·소개·이용안내를 AI가 초벌 번역해 보여준다.
모든 번역은 초안이며 원문(한국어)으로 언제든 되돌릴 수 있다. 사업자·
기관·단체·플랫폼 프로필에만 적용(개인·소비자·사물·개념은 대상 아님).
실시간 대화 통역이 아니라 정적 페이지 표시 번역이다(대화 통역은 아래
"AI 점원 채팅" 항목 참조).
검증-서버: worker.js::_getOrGenerateProfileTranslation
검증-클라이언트: profile.html::_toggleProfileTranslation
확인일: 2026-09-13

### AI 점원 채팅 (다국어 문의응답 + 사람 연결 에스컬레이션)
설명: 방문객이 프로필에서 메시지를 보내면, 사업자가 등록한 LLM 키로
그 사업자의 메뉴·영업시간·위치·소개·이용안내에 근거해서만 답하는 AI가
응대한다(그 외 정보는 "제공하기 어렵다"고 답함 — 할루시네이션 방지).
방문객 언어와 사업자 언어(기본 한국어)가 달라도 양방향 자동 번역된다.
반복 실패·특정 키워드("사람 연결" 등, 6개 언어 지원)·사업자가 AI를
꺼둔 경우엔 사람에게 자동으로 넘어간다. K-Market 상품(seller_products)
이 등록돼 있으면 그 메뉴로 주문 접수(ORDER_DRAFT)까지 가능하고, 없으면
PA가 수집한 메뉴(products)를 정보 제공 전용으로 대신 보여준다(주문
접수는 가격 위변조 방지를 위해 K-Market 등록 상품에만 허용).
2026-09-13 확장 — 영업시간이 아무도 쓰지 않는 죽은 필드(extra.
business_hours)를 읽고 있어 실제로는 항상 "정보 없음"으로 나오던 결함
수정(실제 경로 extra.public.activity.hours로 교체), K-Market 미등록
업체의 메뉴 정보 제공 폴백 추가, 소개·이용안내를 답변 근거에 포함.
2026-09-13 확인 — 이 항목은 원래 src/profile2.0/ai_assistant.js(Supabase
기반 초안)에만 있었고 이 문서(HONDI-CAPABILITIES-COMMON)에 등록된 적이
없었다. 실제 라이브 코드는 src/worker/ai-chat-handler.js(L1 PocketBase
기반)로 이관돼 worker.js에 배선돼 있는데, 그 이관 사실이 이 문서에
반영되지 않아 "실재하는 도구" 목록에서 완전히 누락돼 있었다 — PA가
이 기능의 존재를 몰라 사용자가 물어봐도 답할 수 없는 상태였을 가능성.
src/profile2.0/ai_assistant.js 자체는 더 이상 쓰이지 않는 원안이다.
검증-서버: worker.js::handleAiChat
검증-서버: src/worker/ai-chat-handler.js::caller_lang
확인일: 2026-09-13

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
