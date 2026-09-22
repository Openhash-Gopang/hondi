# 고팡 (Gopang) 파일 명세서
> 저장소: https://github.com/Openhash-Gopang/gopang  
> 배포: https://hondi.net (GitHub Pages)  
> 작성일: 2026-06-14

---

## 1. 진입점 (루트)

| 파일 | 크기 | 역할 |
|------|------|------|
| `index.html` | 2.5KB | 디바이스 감지 후 `webapp.html` 또는 `desktop.html`로 리다이렉트 |
| `webapp.html` | 42KB | **모바일 메인 앱** — 전체 UI 껍데기, 설정 패널, SSE 기반 채팅 화면 |
| `desktop.html` | 159KB | 데스크탑용 포털 (다중 서비스 대시보드) |
| `gopang-app.js` | 9.7KB | **진입 모듈** — 모든 ES Module import → exposeGlobals → bootstrap 순서로 초기화 |
| `gopang-wallet.js` | 42KB | 클라이언트 지갑 공통 모듈 (Ed25519, GDUDA 5-Layer, OpenHash L1) |
| `gwp-registry.js` | 17KB | GWP 서비스 자기서술 레지스트리 (16+ 서비스 등록) |
| `sw.js` | 5.5KB | Service Worker — PWA 오프라인 캐시 전략 |
| `manifest.json` | 1.4KB | PWA 메타데이터 |
| `gopang-style.css` | — | 전역 스타일 (Pretendard, green `#16a34a`) |
| `favicon.ico` | — | 파비콘 |
| `worker.js` | — | Web Worker (백그라운드 연산 분리) |

---

## 2. 인증 (`auth/`)

| 파일 | 역할 |
|------|------|
| `auth/gopang-sso.js` | **SSO 라이브러리** — 하위 시스템이 `gopangAuth.require('L0')` 형태로 호출하는 공개 API |
| `auth/subsystem-auth.js` | SSO 실행체 — `window._onGopangAuth` 콜백 호출, `_user` 세팅 |
| `auth/silent-auth.html` | 인증 엔드포인트 (iframe/팝업으로 로드되어 토큰 교환) |

> ⚠️ `src/auth/gopang-auth.js` — 293줄에서 잘린 미완성 파일. 현재 **미사용** (gopang-app.js가 `/src/auth/gopang-auth.js`를 로드하지만 실질 인증은 `src/gopang/core/auth.js`가 담당)

---

## 3. 핵심 모듈 (`src/gopang/`)

### 3-1. Core

| 파일 | 역할 |
|------|------|
| `src/gopang/core/state.js` | **전역 상태 단일 진실 공급원** — `_USER`, `_userLocation`, `_locationReady` 등 모든 전역 변수 + setter 함수 export |
| `src/gopang/core/auth.js` | 사용자 인증·등록 — `initAuth()`, `_isRegistered()`, `_isTypeBorC()`, `_registerToL1()`, `gopangAuth` 객체. localStorage `gopang_user_v3` 키 사용 |
| `src/gopang/core/config.js` | 앱 설정 — `CFG` 객체 (모델명, 엔드포인트, locationStr 등), `loadSettings()`, `saveSettings()` |
| `src/gopang/core/session.js` | 세션 대화 저장 — 앱 숨김(`pagehide`, `visibilitychange`) 시 1회 저장 |

### 3-2. AI

| 파일 | 역할 |
|------|------|
| `src/gopang/ai/call-ai.js` | **LLM API 호출 핵심** — SSE 스트리밍, GWP 태그 파싱, Anthropic API 호출 |
| `src/gopang/ai/router.js` | SP-00 라우터 — 사용자 메시지를 서비스별로 분류 (K-Law, K-Market 등) |
| `src/gopang/ai/toggle.js` | AI 비서 활성화·비활성화 UI 제어 |
| `src/gopang/ai/mic.js` | 마이크 입력 — Web Speech API / MediaRecorder STT, `toggleMic()` export |
| `src/gopang/ai/vision.js` | Gemini Vision — K-Clean 이미지 분석, EXIF 처리 |
| `src/gopang/ai/weather.js` | 날씨·해양기상·역지오코딩·현장보고서 |

### 3-3. UI

| 파일 | 역할 |
|------|------|
| `src/gopang/ui/settings.js` | **설정 패널** — `openSettings()`, `closeSettings()`, `_updateHandleChip()`, `_updateSecuritySection()`, `_settingsRegisterHandle()`, `clearSWCache()`. `openSettings()` 진입 시 `_updateLogoutBtn()` 호출 |
| `src/gopang/ui/send-message.js` | 메시지 전송 라우팅 — `sendMessage()`, `handleKey()`, `updateSendBtn()`, `autoResize()` |
| `src/gopang/ui/bubble.js` | 메시지 버블 렌더링 — `appendBubble()` |
| `src/gopang/ui/search.js` | 검색 오버레이 — 사용자·업체·PDV 검색, `openSearch()`, `runSearch()`, `selectContact()`, `openProfile()` |
| `src/gopang/ui/register-flow.js` | 아이디 등록 플로우 UI — `_showRegisterFlow()` |
| `src/gopang/ui/welcome.js` | 초기 환영 메시지 — `_showWelcomeMessage()` |
| `src/gopang/ui/progress.js` | 진행 상황 시트 (K-Clean 등) — `_progressStart()`, `_closeProgressSheet()` |
| `src/gopang/ui/file-attach.js` | 파일 첨부·카메라 — `triggerAttach()`, `triggerCamera()`, `handleFileSelect()` |

### 3-4. Services

| 파일 | 역할 |
|------|------|
| `src/gopang/services/location.js` | **위치 서비스** — GPS watch, IP폴백, PDV주소폴백. `_scheduleLocation()`, `_initLocation()`, `_buildLocNote()`. ⚠️ 61번 줄 백틱 수정 완료 |
| `src/gopang/services/klaw.js` | K-Law 백그라운드 감시 파이프라인 — `_klawReview()` |
| `src/gopang/services/kcleaner.js` | K-Clean 이미지 분석 진행 관리 |
| `src/gopang/services/fiil.js` | FIIL.kr 환경 신고 전송 (Supabase) |

### 3-5. GWP (Gopang Widget Protocol)

| 파일 | 역할 |
|------|------|
| `src/gopang/gwp/engine.js` | **GWP 엔진** — AI 응답 내 `<GWP:서비스>` 태그 감지 → 새 탭 방식으로 서비스 실행. `_gwpLaunch()`, `_gwpClose()`, `_gwpMatch()` |
| `src/gopang/gwp/sign.js` | GWP 결제 서명 처리 — `_handleGwpSignRequest()` |

### 3-6. P2P

| 파일 | 역할 |
|------|------|
| `src/gopang/p2p/webrtc.js` | **P2P WebRTC** — DataChannel, 시그널링 폴링, PDV 채팅 저장. `setPeer()`, `_clearPeer()`, `_startSignalPoll()` |

### 3-7. PDV

| 파일 | 역할 |
|------|------|
| `src/gopang/pdv/record.js` | **PDV 기록** — 해시체인, Supabase `/pdv_log` 전송. `recordPDV()`. payload: `{ user_guid, source, report: { pdv_6w } }` |

---

## 4. 앱 부트스트랩

| 파일 | 역할 |
|------|------|
| `src/app.js` | `bootstrap()` — DOMContentLoaded 후 실행, 이벤트 핸들러 바인딩, 하위 모듈 초기화 |
| `src/pwa/gopang-pwa.js` | PWA 설치 프롬프트 제어 — `installPWA()`, `dismissInstall()`, `dismissIOSInstall()` |

---

## 5. 프롬프트 (`prompts/`)

| 파일 | 역할 |
|------|------|
| `SP-00-ROUTER-LATEST.txt` | **현재 사용 중인 라우터 프롬프트** (SP-00 v4.1) |
| `SP-00-ROUTER-v*.txt` | 이전 버전 라우터 (v3.0~v4.0) — **레거시, 삭제 가능** |
| `SP-01_klaw_v1.0.txt` | K-Law 시스템 프롬프트 |
| `SP-02_k119_v1.0.txt` | K-119 (소방/응급) |
| `SP-03_kpolice_v1.0.txt` | K-Police |
| `SP-04_khealth_v1.0.txt` | K-Health |
| `SP-05_kcommerce_v2.2.txt` | ⚠️ 2026-07-05 정정: 죽은 참조. 실제 K-Market SP는 market 레포의 `SP-KMARKET-v2_5.txt`(자체 raw fetch). gopang 쪽 SP-05_* 파일은 `DEPRECATED_SP-05_kmarket-kcommerce.txt` 참조 |
| `SP-06_ktraffic_v1.0.txt` | K-Traffic |
| `SP-07_ktax_v1.0.txt` | K-Tax |
| `SP-08_gdc_v2.0.txt` | GDC 결제 |
| `SP-09_kschool_v1.0.txt` | K-School |
| `SP-10_kpublic_v1.0.txt` | K-Public |
| `SP-11_kstock_v1.0.txt` | K-Stock |
| `SP-12_kdemocracy_v1.0.txt` | K-Democracy |
| `SP-13_klogistics_v1.0.txt` | K-Logistics |
| `SP-14_kcleaner_v1.2.txt` | K-Clean |
| `SP-14_kinsurance_v1.0.txt` | K-Insurance |

---

## 6. 기타

| 파일/폴더 | 역할 |
|-----------|------|
| `klaw/prompts/system_prompt.txt` | K-Law 전용 시스템 프롬프트 (별도 klaw 서비스용) |
| `klaw/prompts/monitor_prompt.txt` | K-Law 모니터링 프롬프트 |
| `report/gopang-report.js` | 리포트 생성 공통 모듈 |
| `sql/` | Supabase 스키마 (phase0 migration, WebAuthn, 레거시) |
| `assets/jjajang.png` | 짜장면 이미지 (desktop.html에서 `assets/jjajang.png`로 참조) |
| `assets/weaving.gif` | 로딩 애니메이션 |
| `icons/` | PWA 아이콘 (180, 192, 512px) |
| `docs/` | 설계 문서, 백서, 테스트 리포트 (배포와 무관) |
| `tools/` | 개발 도구 (build.py, bulk_register.py, serve.py) |
| `fix.py` | ⚠️ 임시 수정 스크립트 — **배포 전 삭제 필요** |

---

## 7. 레거시 (미사용 — 삭제 권장)

| 경로 | 이유 |
|------|------|
| `src/profile2.0/` | 구버전 프로토타입 (13파일, 138KB). 현재 `src/gopang/`으로 대체됨 |
| `src/ai-secretary/` | Phase 0~6 파이프라인 구버전 (9파일, 38KB) |
| `src/core/` | 구버전 core (config, constants, event-bus, plugin 등 6파일). 현재 `src/gopang/core/`로 대체 |
| `src/domains/` | K-Law, K-Health 도메인 구버전 (24파일). 현재 prompts/로 대체 |
| `src/gdc/` | GDC 구버전 (6파일) |
| `src/network/` | 네트워크 구버전 (3파일) |
| `src/openhash/` | OpenHash 구버전 (7파일) |
| `src/pdv/` | PDV 구버전 (3파일). 현재 `src/gopang/pdv/record.js`로 대체 |
| `src/privacy/` | 프라이버시 모듈 구버전 (6파일) |
| `src/tests/` | 구버전 테스트 (24파일, 251KB). 현재 활성 테스트 없음 |
| `src/auth/auth.js` | 구버전 인증 (미사용) |
| `src/auth/gopang-auth.js` | 293줄에서 잘린 미완성 파일 |
| `src/shell-ui.js` | 구버전 Shell UI |
| `prompts/SP-00-ROUTER-v3.0~v4.0.txt` | 라우터 구버전 (LATEST만 사용) |
| `prompts/SP-05_kcommerce_v1.0.txt` | v2.2로 대체됨 |

---

## 8. 핵심 데이터 흐름

```
사용자 입력
  → webapp.html (UI)
  → gopang-app.js (전역 함수 노출)
    → src/gopang/core/auth.js (인증 확인)
    → src/gopang/ai/router.js (서비스 분류)
    → src/gopang/ai/call-ai.js (LLM 호출)
    → src/gopang/gwp/engine.js (GWP 태그 처리)
    → src/gopang/pdv/record.js (PDV 기록 → Supabase)
```

## 9. 주요 상수

| 항목 | 값 |
|------|-----|
| Supabase URL | `https://ebbecjfrwaswbdybbgiu.supabase.co` |
| CF Worker Proxy | `gopang-proxy.tensor-city.workers.dev` |
| L1 PocketBase | `https://l1-hanlim.hondi.net` |
| 브랜드 색상 | `#16a34a` (green) |
| 사용자 스토리지 키 | `localStorage: 'gopang_user_v3'` |
| GUID 기반 | `user.ipv6` (SHA-256 기기 핑거프린트 → IPv6 형식) |

---

## 10. 오늘 수정한 파일 요약

| 파일 | 수정 내용 |
|------|-----------|
| `src/gopang/services/location.js` | 61번 줄: 실제 줄바꿈 → 백틱 템플릿 리터럴 |
| `src/gopang/ui/settings.js` | `openSettings()` 진입 시 `_updateLogoutBtn()` 호출 추가 |
| `webapp.html` | ① 얼굴 재등록 버튼 삭제 ② `gopangLogout confirm` 줄바꿈 수정 ③ `_isGuestUser()` 기반 로그인/로그아웃 분기 추가 |

---

## 11. 파일별 함수 목록

> `⬆` = export (외부에서 호출 가능)  
> 들여쓰기 없음 = 파일 내부 전용

---

### `webapp.html` (인라인 `<script>`)

| 줄 | 함수 | 설명 |
|----|------|------|
| 21 | `gopangLogout()` | localStorage·sessionStorage·캐시 초기화 후 reload |
| 28 | `_isGuestUser()` | `gopang_user_v3` 파싱 → guest 여부 반환 |
| 34 | `_settingsLogoutOrLogin()` | guest → `/login.html`, 등록자 → `gopangLogout()` |
| 41 | `_updateLogoutBtn()` | `#btn-logout-or-login` 텍스트·색상 동적 업데이트 |
| 883 | `autoResize()` | 입력창 높이 자동 조절 |
| 888 | `syncState()` | 입력값 유무에 따라 보조 버튼 토글 |

---

### `src/gopang/core/state.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 10 | ⬆ `setUser(u)` | `_USER` 업데이트 |
| 22 | ⬆ `setAiActive(v)` | AI 비서 활성 상태 |
| 23 | ⬆ `setMicActive(v)` | 마이크 활성 상태 |
| 24 | ⬆ `setAttachFile(v)` | 첨부 파일 상태 |
| 25 | ⬆ `setRecognition(v)` | SpeechRecognition 인스턴스 |
| 40–44 | ⬆ `setPeerState / setRtcConn / setRtcChannel / setSignalPoll / setPdvChatDB` | P2P 상태 |
| 51–53 | ⬆ `setUserLocation / setLocationReady / setLocationPending` | 위치 상태 |
| 61–64 | ⬆ `setGwpActive / setGwpService / setGwpTab / setGwpTabTimer` | GWP 상태 |
| 71–72 | ⬆ `setKlawBusy / setKlawLastCheck` | K-Law 상태 |
| 87–90 | ⬆ `setLastPipelineResult / setLastRouterResult / setLastFiilReportId / setInstallBannerVisible` | 기타 상태 |

---

### `src/gopang/core/auth.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 12 | ⬆ `_sha256(str)` | SHA-256 해시 (hex) |
| 18 | ⬆ `initAuth()` | **앱 기동 시 최초 호출** — 기기 핑거프린트 → IPv6 GUID → `_USER` 초기화 |
| 45 | ⬆ `_isRegistered()` | `gopang_user_v3.handle` 존재 여부 |
| 52 | ⬆ `_isTypeBorC()` | 등록 타입 B/C 여부 |
| 61 | ⬆ `_registerToL1(name)` | L1 PocketBase에 사용자 등록 |
| 174 | `_showRestoreUI()` | 복구 UI 표시 (내부) |
| 203 | ⬆ `_verifyRestore(newFpHex)` | `window._verifyRestore` — 기기 복구 검증 |
| 217 | ⬆ `_injectAuthConfirmButton(level)` | `[AUTH:Lx]` 태그 감지 시 인증 버튼 주입 |
| 239 | ⬆ `_executeAuthAndProceed(level)` | `window._executeAuthAndProceed` — 인증 실행 |
| 248 | ⬆ `_cancelAuthRequest()` | `window._cancelAuthRequest` — 인증 취소 |

---

### `src/gopang/core/config.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 61 | ⬆ `saveSettings()` | `CFG` → localStorage 저장 |
| 95 | ⬆ `loadSettings()` | localStorage → `CFG` 복원 |
| 114 | ⬆ `_modelSupportsVision()` | 현재 모델의 Vision 지원 여부 |

---

### `src/gopang/core/session.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 22 | `_classifyDomain()` | 대화 도메인 분류 (내부) |
| 29 | `_saveSessionOnce()` | 실제 저장 로직 (내부) |
| 55 | ⬆ `_saveOnce()` | `pagehide` / `visibilitychange` 시 호출 — 1회 저장 보장 |

---

### `src/gopang/ai/call-ai.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 17 | ⬆ `callAI(userText, imageFile, _preTab)` | **LLM 호출 핵심** — SSE 스트리밍, GWP/AUTH 태그 처리, K-Law 트리거 |
| 27 | `poll()` | AI 활성화 대기 폴링 (내부) |

---

### `src/gopang/ai/router.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 19 | ⬆ `_loadRouterPrompt()` | SP-00-ROUTER-LATEST.txt 로드 |
| 106 | ⬆ `runRouter(text)` | SP-00으로 서비스 분류 → `{ service, confidence }` 반환 |
| 200 | ⬆ `applyRouterResult(result)` | 분류 결과 적용 (CFG 업데이트 등) |

---

### `src/gopang/ai/toggle.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 11 | ⬆ `toggleAI()` | AI 비서 ON/OFF 토글 |
| 26 | ⬆ `activateAI()` | AI 비서 활성화 |
| 39 | ⬆ `closeAI()` | AI 비서 비활성화 |
| 44 | `_showAISetupPopup()` | 최초 AI 설정 팝업 (내부) |

---

### `src/gopang/ai/mic.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 11 | ⬆ `_micAutoSend()` | 음성 인식 완료 후 자동 전송 |
| 64 | ⬆ `toggleMic()` | 마이크 ON/OFF — Web Speech API 또는 MediaRecorder 분기 |
| 82 | ⬆ `_micStop()` | 마이크 중지 |
| 91 | `_micSetUI(active)` | 마이크 버튼 UI 업데이트 (내부) |
| 100 | `_micStartWebSpeech()` | Web Speech API 방식 (내부) |
| 151 | `_micStartMediaRecorder()` | MediaRecorder+STT 방식 (내부) |

---

### `src/gopang/ai/vision.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 19 | ⬆ `_fileToBase64(file)` | File → base64 변환 |
| 32 | ⬆ `_showGeminiProgress()` | Gemini 분석 진행 UI 표시 |
| 77 | ⬆ `_hideGeminiProgress()` | Gemini 진행 UI 숨김 |
| 86 | ⬆ `_callGeminiVision(b64, key, prompt)` | Gemini Vision API 호출 |
| 133 | ⬆ `_callGeminiGeneral(file, key, text)` | Gemini 일반 호출 |
| 183 | ⬆ `_geminiResultToText(result)` | Gemini 응답 → 텍스트 변환 |
| 226 | ⬆ `_extractExif(file)` | 이미지 EXIF (GPS 등) 추출 |

---

### `src/gopang/ui/settings.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 12 | ⬆ `_updateHandleChip(handle)` | 상단 핸들 칩 업데이트 |
| 28 | ⬆ `openSettings()` | 설정 패널 열기 + `_updateLogoutBtn()` 호출 |
| 71 | ⬆ `closeSettings()` | 설정 패널 닫기 |
| 75 | ⬆ `handleOverlayClick(e)` | 오버레이 클릭 → 닫기 |
| 80 | ⬆ `_updateSecuritySection()` | 보안 섹션 UI 업데이트 |
| 100 | ⬆ `_settingsRegisterHandle()` | 아이디 등록 처리 |
| 117 | ⬆ `clearSWCache()` | 앱 캐시 초기화 |

---

### `src/gopang/ui/send-message.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 12 | ⬆ `autoResize(input)` | 입력창 높이 자동 조절 |
| 16 | ⬆ `updateSendBtn()` | 전송 버튼 상태 업데이트 |
| 26 | ⬆ `handleKey(e)` | Enter 키 전송 처리 |
| 35 | ⬆ `sendMessage()` | **메시지 전송 진입점** |
| 103 | `_runPipelineBackground(text)` | 백그라운드 파이프라인 실행 (내부) |

---

### `src/gopang/ui/search.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 9 | ⬆ `openSearch()` | 검색 오버레이 열기 |
| 14 | ⬆ `closeSearch()` | 검색 오버레이 닫기 |
| 18 | ⬆ `handleSearchOverlayClick(e)` | 오버레이 클릭 처리 |
| 23 | ⬆ `runSearch(query)` | 검색 실행 — `_searchContacts()` + `_searchPDV()` 병렬 |
| 147 | ⬆ `selectContact(ipv6)` | 연락처 선택 → P2P 연결 시도 |
| 168 | ⬆ `openProfile(ipv6)` | 프로필 오버레이 열기 |
| 174 | `_sectionHeader(title)` | 검색 결과 섹션 헤더 (내부) |
| 180 | `_searchContacts(q)` | Supabase 사용자 검색 (내부) |
| 194 | `_searchPDV(q)` | PDV 기록 검색 (내부) |

---

### `src/gopang/services/location.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 4 | ⬆ `_scheduleLocation()` | 앱 기동 후 1초 지연 → `_initLocation()` 호출 |
| 13 | ⬆ `_initLocation()` | GPS watchPosition 시작 (실패 시 IP→PDV 폴백) |
| 41 | ⬆ `_loadLocationFromPDV()` | localStorage 주소 → IP API 폴백 |
| 52 | ⬆ `_updateLocationInPrompt()` | `CFG.locationStr` 업데이트 |
| 57 | ⬆ `_buildLocNote()` | system prompt에 삽입할 위치 문자열 생성 |

---

### `src/gopang/pdv/record.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 18 | ⬆ `recordPDV(source, data)` | PDV 공개 API — 해시체인 + Supabase 전송 |
| 47 | ⬆ `_recordPDV(...)` | 내부 실제 기록 함수 |
| 134 | ⬆ `_patchL1LedgerUserHash(...)` | L1 원장 사용자 해시 업데이트 |
| 167 | ⬆ `_patchPdvChainHeight(...)` | PDV 체인 높이 패치 |
| 208 | ⬆ `_markPdvAnchored(...)` | PDV 앵커 표시 |

---

### `src/gopang/p2p/webrtc.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 14 | ⬆ `setPeer(ipv6)` | P2P 연결 시작 (Offer 생성) |
| 47 | ⬆ `_clearPeer()` | P2P 연결 해제 |
| 58 | `_createOffer()` | WebRTC Offer 생성 (내부) |
| 73 | `_handleOffer(signal)` | Offer 수신 → Answer 생성 (내부) |
| 131 | ⬆ `_sendP2P(text)` | DataChannel 메시지 전송 |
| 162 | ⬆ `_startSignalPoll()` | 시그널 폴링 시작 (등록 사용자 전용) |
| 177 | `_handleSignal(sig)` | 수신 시그널 처리 (내부) |
| 226 | `_saveMsgPDV(msg)` | 채팅 메시지 PDV 저장 (내부) |

---

### `src/gopang/gwp/engine.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 23 | ⬆ `_gwpMatch(text)` | 텍스트에서 `[GWP:svcId]` 추출 |
| 33 | ⬆ `_gwpLaunch(svcDef, text, preTab)` | GWP 서비스 새 탭 오픈 |
| 102 | `_gwpOnTabClose()` | 탭 닫힘 감지 (내부) |
| 124 | ⬆ `_gwpClose()` | GWP 탭 닫기 |

---

### `src/gopang/gwp/sign.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 16 | ⬆ `_handleGwpSignRequest(payload)` | GWP 결제 서명 요청 처리 |
| 144 | ⬆ `_gwpSignExecute(txData)` | 서명 실행 |
| 207 | ⬆ `_gwpSignCancel()` | 서명 취소 |

---

### `auth/subsystem-auth.js`

| 줄 | 함수 | 설명 |
|----|------|------|
| 31 | `_loadSSO()` | gopang-sso.js 동적 로드 (내부) |
| 49 | ⬆ `initAuth()` | 하위 시스템용 인증 초기화 → `window._onGopangAuth` 콜백 호출 |
| 109 | ⬆ `requireLevel(level)` | 최소 인증 레벨 요구 |
| 120 | ⬆ `getUser()` | 현재 사용자 반환 |
| 125 | ⬆ `logout()` | 로그아웃 |
| 153 | ⬆ `showAuthPanel()` | 인증 패널 표시 |
| 196 | ⬆ `showLoginPrompt()` | 로그인 유도 UI |

---

## 12. 핵심 호출 흐름

### A. 앱 초기화 흐름

```
webapp.html 로드
  ├─ <script src="/gopang-wallet.js">     → 지갑 함수 전역 등록
  ├─ <script src="/gwp-registry.js">      → GWP 서비스 레지스트리 등록
  ├─ <script src="/src/pwa/gopang-pwa.js"> → PWA 설치 핸들러
  ├─ <script src="/src/auth/gopang-auth.js"> → (미완성, 얼굴/지문 헬퍼)
  └─ <script type="module" src="/gopang-app.js">
       ├─ initAuth()                       ← core/auth.js
       │    └─ _buildDeviceFingerprint()
       │    └─ _buildIPv6Identity()
       │    └─ setUser(_USER)              ← core/state.js
       ├─ exposeGlobals()                  → window.openSettings, window.callAI 등 노출
       ├─ loadSettings()                   ← core/config.js
       ├─ _updateHandleChip()              ← ui/settings.js
       └─ DOMContentLoaded
            ├─ bootstrap()                 ← src/app.js
            ├─ Promise.all([...imports])
            │    ├─ send-message.js
            │    ├─ file-attach.js
            │    ├─ ai/mic.js
            │    ├─ services/location.js
            │    ├─ ui/welcome.js
            │    ├─ ui/progress.js
            │    ├─ gwp/engine.js
            │    ├─ gwp/sign.js
            │    ├─ services/klaw.js
            │    ├─ ai/call-ai.js
            │    └─ ai/router.js
            ├─ 이벤트 바인딩 (input, send, mic, attach)
            ├─ _showWelcomeMessage()        ← ui/welcome.js
            ├─ _scheduleLocation()          ← services/location.js
            └─ _startSignalPoll() (등록자만) ← p2p/webrtc.js
```

---

### B. 메시지 전송 흐름

```
사용자 입력 → 전송 버튼 클릭 / Enter
  └─ sendMessage()                         ← ui/send-message.js
       ├─ appendBubble('user', text)        ← ui/bubble.js
       ├─ [P2P 활성 시] _sendP2P(text)     ← p2p/webrtc.js
       └─ callAI(text, file, preTab)        ← ai/call-ai.js
            ├─ showTyping()                 ← ui/bubble.js
            ├─ [이미지 있을 때] _callGeminiGeneral() ← ai/vision.js
            ├─ _buildLocNote()              ← services/location.js
            ├─ fetch(CF Worker /chat)       → worker.js → LLM API
            ├─ SSE 스트리밍 수신
            │    └─ _updateStreamBubble()   ← ui/bubble.js
            ├─ fullReply 완성
            ├─ [GWP 태그 감지] _gwpLaunch() ← gwp/engine.js
            ├─ [AUTH 태그 감지] _injectAuthConfirmButton() ← core/auth.js
            └─ setTimeout → _klawReview()   ← services/klaw.js
```

---

### C. 설정 패널 열기 흐름

```
사용자 ⚙️ 버튼 클릭
  └─ openSettings()                        ← ui/settings.js (window에 노출)
       ├─ _isRegistered()                  ← core/auth.js
       ├─ _updateLogoutBtn()               ← webapp.html 인라인
       │    └─ _isGuestUser()              ← webapp.html 인라인
       │         └─ localStorage.getItem('gopang_user_v3')
       ├─ LLM 섹션 표시/숨김
       ├─ 아이디 섹션 표시
       ├─ _updateSecuritySection()
       └─ settings-overlay.classList.add('open')
```

---

### D. PDV 기록 흐름

```
recordPDV(source, data)                    ← pdv/record.js
  ├─ _recordPDV()
  │    ├─ 해시체인 계산
  │    └─ fetch(CF Worker /pdv_log)        → worker.js → Supabase
  ├─ _patchL1LedgerUserHash()             → L1 PocketBase
  └─ _patchPdvChainHeight()
```

---

### E. GWP 서비스 실행 흐름

```
callAI() → fullReply에 [GWP:k-market] 감지
  └─ getService('k-market')               ← gwp-registry.js
  └─ _gwpLaunch(svcDef, text, preTab)     ← gwp/engine.js
       ├─ 새 탭 오픈 (사전 예약 탭 재사용)
       ├─ 탭에 postMessage(userText)
       └─ _gwpOnTabClose() 감시 시작
```

---

### F. P2P 채팅 흐름

```
selectContact(ipv6)                        ← ui/search.js
  └─ setPeer(ipv6)                         ← p2p/webrtc.js
       ├─ _sendSignal('offer', sdp)        → CF Worker /signal/send
       └─ _waitICE() → DataChannel 개통
            └─ _setupChannelEvents()
                 ├─ onmessage → appendBubble('peer', msg) ← ui/bubble.js
                 └─ _saveMsgPDV(msg)       → IndexedDB
```

---

### G. 위치 서비스 흐름

```
_scheduleLocation()                        ← services/location.js
  └─ (1초 후) _initLocation()
       ├─ navigator.geolocation.watchPosition()
       │    └─ setUserLocation({lat, lng}) ← core/state.js
       │    └─ _updateLocationInPrompt()   → CFG.locationStr 업데이트
       └─ [실패 시] _loadLocationFromPDV()
            ├─ localStorage('gopang_profile_address') 있으면 사용
            └─ 없으면 ipapi.co/json/ 호출
```

