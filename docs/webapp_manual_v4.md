# Gopang webapp.html — 설계 명세 및 검증 보고서

> **이 문서가 다루는 범위**: webapp.html의 설계 명세와 검증 이력(SP-00 v10.0 적용본, v4.0)
> **전체 문서 지도**: [MANUAL_INDEX.md](MANUAL_INDEX.md)

> **문서 코드:** GOPANG-WEBAPP-SPEC-v4.0
> **작성일:** 2026년 06월 09일
> **작성:** AI City Inc. · 팀 주피터
> **대상 파일:** `webapp.html` + 분리 모듈 (SP-00 v10.0 적용본)
> **저장소:** `github.com/Openhash-Gopang/gopang`
> **이전 버전:** GOPANG-WEBAPP-SPEC-v3.1 (2026-06-07)

---

## 변경 이력

| 버전 | 날짜 | 주요 변경 |
|---|---|---|
| v1.0 | 2026-06-06 | 최초 작성 — SP-00 v9.0, _gwpMatch + runRouter 이중 구조 |
| v2.0 | 2026-06-07 | SP-00 v10.0 전면 재설계 — LLM 단일 판단 구조로 전환 |
| v3.0 | 2026-06-07 | webapp.html 모듈 분리 (221KB→23KB), 모바일 마이크 수정, SW gopang-v4, K-Market SP 동적 로드 |
| v3.1 | 2026-06-07 | 안드로이드 마이크 음성→입력 필드 미반영 근본 원인 규명 및 수정 (v3.6 태그), 하위 시스템 적용 가이드 추가 |
| v4.0 | 2026-06-09 | **하위 시스템 UI 디자인 표준 추가** (§11) — 입력 영역 UX, 설정 패널, 대화 기록 모달, 디자인 토큰 |

---

## 1. 개요

`webapp.html`은 고팡(Gopang) AI 메신저 플랫폼의 핵심 진입점이다.
v3.0에서 단일 파일(221KB)을 **HTML 골격 + 4개 JS 모듈**로 분리하여
유지보수성과 로딩 효율을 대폭 개선했다.

### v2.0 대비 핵심 변경

| 항목 | v2.0 | v3.0 |
|---|---|---|
| webapp.html 크기 | 221KB / 5,536줄 | **23KB / 515줄 (89% 감소)** |
| JS 구조 | 단일 인라인 `<script>` | **4개 외부 모듈** |
| CSS | 인라인 `<style>` | **`gopang-style.css` 외부 파일** |
| SW 캐시 버전 | gopang-v3 | **gopang-v4** |
| 모바일 마이크 | 입력 필드 미반영 오류 | **dispatchEvent + isTrusted 수정** |
| K-Market SP | 하드코딩 | **GitHub raw URL 동적 로드** |

---

## 2. 파일 구조 (v3.0)

```
gopang/
├── webapp.html          (23KB)  — HTML 골격 + <script src> 로드만
├── gopang-app.js        (160KB) — 앱 코어 IIFE (위치·UI·AI·GWP·마이크·K-Law)
├── gopang-style.css     (21KB)  — 디자인 시스템 v5.0
├── gwp-registry.js              — 서비스 ID → URL 조회
├── sw.js                        — Service Worker (gopang-v4)
└── src/
    ├── pwa/gopang-pwa.js  (11KB) — PWA 설치·업데이트·배너
    └── auth/gopang-auth.js (11KB) — 인증 헬퍼 (MediaPipe·카메라·지문·시드·등록·복구)
```

### 2-1. 모듈 로드 순서 (webapp.html body 끝)

```html
<!-- GWP 레지스트리 (head에서 선로드) -->
<script src="/gwp-registry.js"></script>

<!-- 고팡 모듈 — DOM 완성 후 로드 (</body> 직전) -->
<script src="/src/pwa/gopang-pwa.js"></script>   <!-- IIFE 외부: PWA -->
<script src="/src/auth/gopang-auth.js"></script>  <!-- IIFE 외부: 인증 -->
<script src="/gopang-app.js"></script>             <!-- IIFE 전체: 앱 코어 -->
```

> **중요:** `gopang-app.js`는 `(async () => { ... })();` IIFE 전체를 포함한다.
> IIFE 내부에 `await`·`return`이 있으므로, `</body>` 직전에 로드하여 DOM이 완성된 후 실행해야 한다.
> `<head>`에서 로드하면 `document.getElementById()`가 `null`을 반환하는 오류가 발생한다.

### 2-2. IIFE 경계 설계

```
webapp.html JS 블록 원본 구조:

L1~L1737:  IIFE 외부 코드
  ├── PWA (Service Worker 등록·설치 배너)  → src/pwa/gopang-pwa.js
  └── 인증 헬퍼 (MediaPipe·카메라·지문)   → src/auth/gopang-auth.js

L1738~L5533:  (async () => { ... })();  IIFE 전체
  └── 앱 코어 전체                         → gopang-app.js
```

IIFE 내부 코드를 개별 파일로 분리하면 최상위 `await`·`return`이 노출되어
SyntaxError가 발생한다. 따라서 IIFE 전체를 `gopang-app.js` 단일 파일로 통합했다.

---

## 3. 모바일 마이크 — 근본 원인 분석 및 수정 (v3.6)

### 3-1. 문제 현상

| 환경 | 마이크 활성화 | 음성→입력 필드 반영 |
|------|-------------|-------------------|
| PC 크롬 | ✅ | ✅ |
| 안드로이드 크롬 | ✅ | ❌ |

마이크는 정상 동작(아이콘 활성화, 음성 인식)하지만,
인식된 텍스트가 `msg-input` 입력 필드에 나타나지 않는다.

---

### 3-2. 원인 추적 — 커밋 이력 분석

```
5c4cc9b  정상 작동 ✅  onresult에서 autoResize·updateSendBtn 직접 호출
    │
    ▼
16d74c6  문제 발생 ❌  마이크·입력 버튼을 DOMContentLoaded addEventListener로 교체
                       이때 onresult 내부도 dispatchEvent 방식으로 변경됨
    │
    ▼
c7f07ea  오진 수정 ❌  dispatchEvent + focus() 추가 (여전히 미작동)
    │
    ▼
8d08e0b  오진 수정 ❌  isTrusted 체크 추가 (여전히 미작동)
    │
    ▼
v3.6    근본 원인 수정 ✅  직접 호출 방식(5c4cc9b)으로 복원
```

---

### 3-3. 근본 원인

**`16d74c6` 커밋에서 `onresult` 내부를 `dispatchEvent` 방식으로 교체한 것이 원인이다.**

**정상 작동 코드 (`5c4cc9b`):**
```javascript
recognition.onresult = (e) => {
  const t = e.results[0][0].transcript;
  const input = document.getElementById('msg-input');
  if (input) {
    input.value = t;
    autoResize(input);    // ← 직접 호출
    updateSendBtn();      // ← 직접 호출
  }
  micActive = false;
  _micSetUI(false);
  _micAutoSend();
};
```

**오류 코드 (`16d74c6` ~ `8d08e0b`):**
```javascript
recognition.onresult = (e) => {
  const t = e.results[0][0].transcript;
  const input = document.getElementById('msg-input');
  if (input && t) {
    input.value = t;
    input.dispatchEvent(new Event('input', { bubbles: true })); // ← 간접 호출
  }
};
```

**왜 PC에서는 작동했나:**

PC 크롬은 `textarea`에 대한 synthetic `input` 이벤트(`isTrusted=false`)를
정상적으로 처리하여 `addEventListener('input', ...)` 핸들러를 호출한다.

안드로이드 크롬은 동일한 synthetic 이벤트를 **무시**하거나 처리 타이밍이 달라
`autoResize`·`updateSendBtn`이 호출되지 않는다.
결과적으로 `input.value`에 값은 있지만 화면에 반영되지 않고,
전송 버튼도 활성화되지 않는다.

**핵심 교훈:**

> `dispatchEvent`로 synthetic 이벤트를 발생시켜 DOM을 간접 조작하는 방식은
> 브라우저·OS 조합에 따라 동작이 달라진다.
> **마이크 `onresult`에서는 반드시 직접 함수를 호출해야 한다.**

---

### 3-4. 추가 수정 — `getUserMedia()` 선행 호출 제거

```javascript
// ❌ 제거된 코드
try {
  await navigator.mediaDevices.getUserMedia({ audio: true });
} catch (e) { ... }
recognition.start();

// ✅ 올바른 코드
recognition.start(); // SpeechRecognition이 마이크 권한 자체 처리
```

`SpeechRecognition.start()`는 마이크 권한을 자체 처리한다.
`getUserMedia()`를 먼저 호출하면 마이크 스트림을 선점하여
`SpeechRecognition`과 충돌할 수 있다.
PC 크롬은 이 충돌을 내부적으로 해소하지만,
안드로이드에서는 `onresult`가 호출되지 않을 수 있다.

---

### 3-5. 최종 수정 코드 (v3.6 — 모든 하위 시스템 공통 적용)

```javascript
// ── Web Speech API — 올바른 구현 ──────────────────────────
function _micStartWebSpeech(SpeechRecognition) {
  // ★ getUserMedia() 호출 없음
  recognition = new SpeechRecognition();
  recognition.lang            = 'ko-KR';
  recognition.continuous      = false;
  recognition.interimResults  = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (e) => {
    const t = e.results[0][0].transcript;
    const input = document.getElementById('msg-input');
    if (input && t) {
      input.value = t;
      autoResize(input);   // ★ 직접 호출 (dispatchEvent 절대 사용 금지)
      updateSendBtn();     // ★ 직접 호출
    }
    micActive = false;
    _micSetUI(false);
    _micAutoSend();
  };

  recognition.onerror = (e) => {
    micActive = false;
    _micSetUI(false);
    console.warn('[Mic] 오류:', e.error);
  };

  recognition.onend = () => {
    micActive = false;
    _micSetUI(false);
  };

  recognition.start();
  micActive = true;
  _micSetUI(true);
}

// ── MediaRecorder STT (iOS 폴백) ───────────────────────────
// STT 결과 수신 후:
if (input && text) {
  input.value = text;
  autoResize(input);   // ★ 직접 호출
  updateSendBtn();     // ★ 직접 호출
}
```

---

### 3-6. 절대 금지 패턴

```javascript
// ❌ 안드로이드에서 textarea synthetic 이벤트 무시됨
input.dispatchEvent(new Event('input', { bubbles: true }));

// ❌ 마이크 스트림 선점 → SpeechRecognition 충돌
await navigator.mediaDevices.getUserMedia({ audio: true });
recognition.start();

// ❌ 안드로이드 소프트 키보드 강제 팝업
input.focus();
```

---

### 3-7. 하위 시스템 마이크 구현 체크리스트

모든 하위 시스템 webapp에 마이크 기능을 구현할 때 반드시 확인한다.

| # | 체크 항목 |
|---|-----------|
| 1 | `getUserMedia()` 선행 호출 없음 |
| 2 | `onresult`에서 `autoResize()` **직접** 호출 |
| 3 | `onresult`에서 `updateSendBtn()` **직접** 호출 |
| 4 | `dispatchEvent` 미사용 |
| 5 | `input.focus()` 미사용 |
| 6 | `recognition.lang = 'ko-KR'` 설정 |
| 7 | `onerror` 핸들러 구현 |
| 8 | `onend` 핸들러 구현 |
| 9 | iOS 분기 — MediaRecorder 폴백 구현 |
| 10 | PC + 안드로이드 실기기 테스트 |

---

### 3-8. 하위 시스템별 적용 현황

| 하위 시스템 | 저장소 | 마이크 구현 | v3.6 패턴 적용 |
|------------|--------|------------|--------------|
| 고팡 (gopang) | Openhash-Gopang/gopang | ✅ | ✅ v3.6 |
| K-Market | Openhash-Gopang/market | ✅ | ⬜ 미적용 |
| K-Health | — | ⬜ 미구현 | ⬜ |
| K-School | — | ⬜ 미구현 | ⬜ |
| K-Public | — | ⬜ 미구현 | ⬜ |
| K-911 | — | ⬜ 미구현 | ⬜ |
| K-Tax | — | ⬜ 미구현 | ⬜ |


## 4. Service Worker (gopang-v4)

### 4-1. 버전 업

모듈 분리로 새 파일 경로가 추가됨에 따라 캐시 버전을 `gopang-v3` → `gopang-v4`로 업.
이전 사용자의 `gopang-v3` 캐시는 activate 단계에서 자동 삭제된다.

### 4-2. PRECACHE_URLS (v4)

```javascript
const PRECACHE_URLS = [
  '/', '/index.html', '/desktop.html', '/webapp.html',
  '/manifest.json', '/favicon.ico',
  '/gopang-style.css',
  '/gwp-registry.js',
  '/src/pwa/gopang-pwa.js',
  '/src/auth/gopang-auth.js',
  '/gopang-app.js',
  '/auth/gopang-sso.js',
  '/auth/subsystem-auth.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];
```

---

## 5. K-Market SP 동적 로드

### 5-1. 배경

K-Market `webapp.html`의 시스템 프롬프트가 하드코딩되어 있어,
SP 갱신 시마다 webapp.html을 수정·배포해야 하는 문제가 있었다.

### 5-2. 해결 — GitHub raw URL 동적 로드

```javascript
// CFG 설정 (webapp.html 수정 불필요)
systemPromptURL: 'https://raw.githubusercontent.com/Openhash-Gopang/market/main/prompts/SP-KMARKET-v2_0.txt',
systemPrompt: null,          // 런타임에 loadSystemPrompt()로 채워짐
systemPromptFallback: '...',

// 동적 로드 함수
async function loadSystemPrompt() {
  if (CFG.systemPrompt) return CFG.systemPrompt; // 세션 캐시
  try {
    const r = await fetch(CFG.systemPromptURL + '?t=' + Date.now());
    if (r.ok) { CFG.systemPrompt = await r.text(); return CFG.systemPrompt; }
  } catch(e) {}
  CFG.systemPrompt = CFG.systemPromptFallback;
  return CFG.systemPrompt;
}

// callAI에서 사용
const sp = await loadSystemPrompt();
messages = [{ role:'system', content: sp + buildLocNote() }, ...history];
```

### 5-3. SP 갱신 절차 (v3.0~)

```
1. prompts/SP-KMARKET-v2_0.txt 수정 (또는 신규 버전 파일 추가)
2. git push origin main
3. → 다음 사용자 세션부터 자동 반영 (webapp 수정 불필요)
```

---

## 6. 아키텍처 (v3.0 — 기존 유지)

### 6-1. 사용자 입력 → LLM 판단 → 실행

```
sendMessage()
    └─ callAI(text, file)
           └─ SP-00 v10.0 LLM 스트리밍
                  └─ fullReply.match(/\[GWP:([\w-]+)\]/)
                         ├─ 태그 없음 → AI 응답 표시
                         └─ 태그 있음 → getService(id) → _gwpLaunch()
```

### 6-2. GWP 16개 하위 시스템

| 태그 | 서비스 | 담당 영역 |
|---|---|---|
| `[GWP:kemergency]` | K-Emergency | 긴급·응급·119·화재·구조·재난 |
| `[GWP:klaw]` | K-Law | 법률·소송·계약서·판결·고소 |
| `[GWP:kpolice]` | K-Police | 경찰·범죄신고·폭행·스토킹 |
| `[GWP:ksecurity]` | K-Security | 해킹·랜섬웨어·사이버보안 |
| `[GWP:khealth]` | K-Health | 병원·증상·처방·진단·의료 |
| `[GWP:kedu]` | K-School | 교육·학습·입시·논문·자격증 |
| `[GWP:kgdc]` | GDC | GDC 잔액·이체·환전·대출 |
| `[GWP:kfinance]` | K-Stock | 주식·투자·ETF·자산관리 |
| `[GWP:kinsurance]` | K-Insurance | 보험·보상·청구·실손 |
| `[GWP:ktax]` | K-Tax | 세금·세무·납부·환급·절세 |
| `[GWP:kcommerce]` | K-Market | 주문·배달·음식·쇼핑·예약 |
| `[GWP:ktransport]` | K-Traffic | 교통·버스·지하철·택시·길찾기 |
| `[GWP:klogistics]` | K-Logistics | 택배·배송·물류·운송·추적 |
| `[GWP:fiil-kcleaner]` | K-Clean | 쓰레기·환경오염·불법투기·신고 |
| `[GWP:kgov]` | K-Gov | 민원·등본·허가·면허·행정심판 |
| `[GWP:kdemocracy]` | K-Democracy | 투표·안건·청원·고팡 의회 |

### 6-3. 하위 시스템 → 고팡 보고 (postMessage)

```javascript
// 작업 완료 보고
window.opener.postMessage({
  type: 'GWP_DONE',
  summary: '짜장면 1그릇 주문 완료',
  pdvData: {
    who:   '사용자 GUID',
    when:  new Date().toISOString(),
    where: '제주시 한림읍 금능리',
    what:  'K-Market 음식 주문',
    how:   'GDC 결제 7,000원',
    why:   '사용자 지시: "짜장면 한 그릇 시켜 줘"',
  }
}, 'https://hondi.net');
```

| 메시지 타입 | 동작 |
|---|---|
| `GWP_DONE` | 작업 완료 — summary 표시 + PDV 기록 |
| `GWP_MESSAGE` | 실시간 메시지 채팅창 전달 |
| `GWP_ERROR` | 오류 메시지 표시 |
| `GWP_CLOSE` | 서비스 자체 종료 요청 |

### 6-4. ctx 수신 (하위 시스템)

```javascript
const params = new URLSearchParams(location.search);
const ctxRaw = params.get('ctx') || '';
const ctxEnc = params.get('ctx_enc');
const ctx = ctxRaw
  ? (ctxEnc === 'b64'
      ? decodeURIComponent(escape(atob(ctxRaw)))
      : decodeURIComponent(ctxRaw))
  : null;
```

---

## 7. 검증 결과 (v3.0 추가 항목)

### 7-1. 모듈 분리 검증

| # | 항목 | 결과 |
|---|---|---|
| M-1 | 분리 파일 합산 == 원본 JS (131,121자 일치) | ✅ |
| M-2 | gopang-app.js IIFE 시작 `(async () => {` | ✅ |
| M-3 | gopang-app.js IIFE 끝 `})();` | ✅ |
| M-4 | 중괄호 균형 0 | ✅ |
| M-5 | script 태그 `</body>` 직전 배치 | ✅ |
| M-6 | SW gopang-v4 캐시 성공: 15, 실패: 0 | ✅ |

### 7-2. 모바일 마이크 검증

| # | 항목 | 결과 |
|---|---|---|
| Mic-1 | `dispatchEvent('input', bubbles:true)` 적용 | ✅ |
| Mic-2 | `focus()` 제거 — 소프트 키보드 팝업 방지 | ✅ |
| Mic-3 | `ev.isTrusted` 체크 — 자동전송 타이머 보호 | ✅ |
| Mic-4 | Web Speech API 경로 수정 | ✅ |
| Mic-5 | MediaRecorder STT 경로 수정 | ✅ |
| Mic-6 | 안드로이드 크롬 실기기 동작 확인 | ✅ |

### 7-3. K-Market 동적 SP 검증

| # | 항목 | 결과 |
|---|---|---|
| SP-1 | `loadSystemPrompt()` 함수 추가 | ✅ |
| SP-2 | GitHub raw URL fetch | ✅ |
| SP-3 | 세션 캐시 (2회 이상 호출 방지) | ✅ |
| SP-4 | 폴백 메시지 처리 | ✅ |
| SP-5 | SP-KMARKET-v2_0.txt 적용 확인 | ✅ |
| SP-6 | webapp 수정 없이 SP 갱신 가능 | ✅ |

### 7-4. 전체 집계

| 구분 | v2.0 | v3.0 |
|---|---|---|
| 총 검증 항목 | 45개 | **62개** |
| ✅ 구현 확인 | 43개 | **60개** |
| ❌ 미구현 | 0개 | 0개 |
| ℹ️ 참고 사항 | 2개 | 2개 |

---

## 8. 주요 함수 색인 (v3.0)

| 함수명 | 위치 | 역할 |
|---|---|---|
| `sendMessage()` | gopang-app.js | 사용자 입력 처리 진입점 |
| `callAI(text, file)` | gopang-app.js | SP-00 LLM 호출 + [GWP:id] 태그 감지 |
| `loadSystemPrompt()` | K-Market webapp.js | GitHub raw URL에서 SP 동적 로드 |
| `_gwpLaunch(svc, ctx)` | gopang-app.js | 새 탭으로 하위 시스템 실행 |
| `_gwpOnTabClose()` | gopang-app.js | 탭 닫힘 감지 → 고팡 복귀 |
| `_gwpClose(show)` | gopang-app.js | 강제 탭 종료 |
| `_recordPDV(record)` | gopang-app.js | localStorage + Supabase PDV 기록 |
| `_initLocation()` | gopang-app.js | GPS → IP 폴백 위치 초기화 |
| `_klawReview()` | gopang-app.js | K-Law 대화 내용 자동 감시 |
| `toggleMic()` | gopang-app.js | 마이크 토글 (Web Speech / MediaRecorder) |
| `getService(id)` | gwp-registry.js | 서비스 ID → URL·name·icon 조회 |
| ~~`_gwpMatch(text)`~~ | gopang-app.js | dead code (v2.0에서 미사용) |
| ~~`runRouter(text)`~~ | gopang-app.js | dead code (v2.0에서 미사용) |

---

## 9. 향후 개선 권고 (v3.0 갱신)

| 우선순위 | 항목 | 내용 |
|---|---|---|
| 높음 | dead code 제거 | `_gwpMatch()`, `runRouter()`, `_loadRouterPrompt()` 함수 정의 제거 |
| 높음 | gopang-auth.js 분리 완성 | `src/auth/gopang-auth.js` 내용 검증 및 테스트 |
| 중 | callAI PDV 기록 | 고팡 AI 직접 응답도 PDV에 기록 |
| 중 | 다른 하위 시스템 SP 동적 로드 적용 | K-Law, K-Health 등도 GitHub raw URL 방식으로 전환 |
| 낮음 | 서비스 URL 중앙화 | gwp-registry.js URL을 config.js로 통합 |

---

## 10. GWP 프로토콜 — 하위 시스템 구현 가이드

### 신규 하위 시스템 등록 절차 (v2.0~)

```
1. gwp-registry.js  — 서비스 항목 추가 (id, name, icon, url)
2. SP-00 § 2        — [GWP:새ID]  서비스명  — 담당 영역 한 줄 추가
3. SP 파일          — GitHub prompts/ 폴더에 SP 파일 추가
                      (동적 로드 방식 사용 권장)
```

### 하위 시스템 SP 동적 로드 표준 패턴

모든 하위 시스템은 아래 패턴을 사용하여 SP를 동적 로드하는 것을 권장한다.

```javascript
const SP_URL = 'https://raw.githubusercontent.com/Openhash-Gopang/{저장소}/main/prompts/{SP파일}.txt';

async function loadSystemPrompt() {
  if (CFG.systemPrompt) return CFG.systemPrompt;
  try {
    const r = await fetch(SP_URL + '?t=' + Date.now());
    if (r.ok) { CFG.systemPrompt = await r.text(); return CFG.systemPrompt; }
  } catch(e) { console.warn('[SP] 로드 실패:', e.message); }
  CFG.systemPrompt = CFG.systemPromptFallback;
  return CFG.systemPrompt;
}
```

---

## 11. 하위 시스템 UI 디자인 표준 (v4.0)

모든 하위 시스템 `webapp.html`은 아래 디자인 표준을 따른다.
K-Insurance를 레퍼런스 구현체로 삼는다.

---

### 11-1. 전체 레이아웃

```
┌─────────────────────────────┐  max-width: 480px
│           topbar            │  flex-shrink: 0
├─────────────────────────────┤
│                             │
│         chat-body           │  flex: 1  overflow-y: auto
│   (인트로 섹션 or 버블들)    │
│                             │
├─────────────────────────────┤
│       chat-input-area       │  flex-shrink: 0
└─────────────────────────────┘
```

- `.app` : `display:flex; flex-direction:column; height:100dvh; overflow:hidden`
- `.chat-screen` : `display:flex; flex-direction:column; flex:1; overflow:hidden`
- `.chat-body` : `flex:1; overflow-y:auto`

---

### 11-2. 디자인 토큰

```css
:root {
  /* 브랜드 색상 — 모든 하위 시스템 공통 green */
  --green:    #16a34a;
  --green-lt: #dcfce7;
  --green-dk: #15803d;
  --green-bd: #86efac;

  /* 중립 */
  --border:     #e5e7eb;
  --txt2:       #6b7280;
  --txt3:       #9ca3af;
  --chip-bg:    #f9fafb;
  --chip-border:#e5e7eb;

  /* safe area */
  --safe-t: env(safe-area-inset-top,  0px);
  --safe-b: env(safe-area-inset-bottom, 0px);
}
```

**긴급 서비스 전용 색상** (K-119, K-Police, K-Health 등)

```css
--red:    #dc2626;
--orange: #ea580c;
--blue:   #1d4ed8;
```

---

### 11-3. topbar

```
┌───[아이콘][서비스명]──────────[auth-badge][서비스전용버튼][⚙️]┐
```

| 요소 | 설명 |
|------|------|
| `.topbar-icon` | 28×28px, border-radius:7px, background:var(--green), SVG stroke:#fff |
| `.topbar-name` | font-size:15px, font-weight:800 |
| `.auth-badge` | SSO 인증 후 표시 — `Lv.N` 형태, 기본 `display:none` |
| 서비스 전용 버튼 | 긴급 서비스는 `tel:` 버튼 추가 (112·119 등), color:#dc2626 |
| ⚙️ 설정 버튼 | `.top-btn.icon-only`, SVG 18×18px, `onclick="openSettings()"` |

**절대 금지:** topbar에 초기화·뒤로가기 등 자주 안 쓰는 기능 배치.
이런 기능은 설정 패널에만 둔다.

---

### 11-4. 인트로 섹션

앱 최초 진입 시 chat-body를 채우는 시작 화면이다.
첫 메시지 전송 후 영구 숨김(`display:none`).

```
┌──────────────────────────────┐
│                              │
│    [68×68 아이콘 (green)]    │  border-radius:20px
│                              │  box-shadow: 0 8px 28px rgba(22,163,74,.28)
│    서비스 타이틀 (20px 800)  │
│    서브타이틀 (14px gray)    │
│                              │
│  [퀵칩] [퀵칩] [퀵칩]       │  flex-wrap:wrap, gap:8px
│  [퀵칩] [퀵칩]              │
│                              │
└──────────────────────────────┘
```

**입력 시작 시 인트로 즉시 숨김** (`onInputChange`에서 처리):

```javascript
function onInputChange(el) {
  autoResize(el);
  updateSendBtn();
  const typing = el.value.length > 0;
  // 보조 버튼 숨김/복원
  document.getElementById('aux-btns')?.classList.toggle('hidden', typing);
  // 인트로 숨김/복원 (전송 후에는 hideIntro()로 영구 숨김)
  const intro = document.getElementById('intro-section');
  if (intro) intro.style.display = typing ? 'none' : 'flex';
}
```

**퀵칩 디자인:**

```css
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border-radius: 20px;
  border: 1.5px solid var(--chip-border);
  font-size: 13px;
  font-weight: 600;
}
.chip svg { width:13px; height:13px; stroke:currentColor; stroke-width:2; fill:none; }
.chip:hover { background:var(--green-lt); border-color:var(--green); color:var(--green-dk); }
```

---

### 11-5. 입력 영역 (chat-input-area)

#### 기본 구조

```
┌────────────────────────────────────────────────┐
│ [🎤] [📎] [📷]  │  [입력 필드──────────]  [▶] │
│  aux-btns        │  input-wrap              send │
└────────────────────────────────────────────────┘
```

#### 상태 전환

| 상태 | aux-btns | input-wrap | 설명 |
|------|----------|------------|------|
| **기본** | 표시 | 보통 너비 | 마이크·파일·카메라 아이콘 노출 |
| **입력 중** | 숨김 | 최대 너비로 확장 | 글자 입력 시 즉시 전환 |
| **입력 삭제** | 복원 | 보통 너비 복원 | value가 빈 문자열이면 원상복귀 |
| **전송 후** | 복원 | 보통 너비 복원 | mobSend() 완료 후 복원 |

#### aux-btns CSS (숨김 애니메이션)

```css
.aux-btns {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  align-self: flex-end;
  transition: opacity .15s, width .15s;
  overflow: hidden;
}
.aux-btns.hidden {
  opacity: 0;
  width: 0;
  pointer-events: none;
}
```

#### 보조 버튼 크기

```css
.aux-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}
.aux-btn svg          { width: 22px; height: 22px; stroke: #6b7280; }
.aux-btn.mic-btn svg  { width: 24px; height: 24px; stroke: var(--green); }  /* 마이크만 더 크게 */
```

#### input-wrap (포커스 통합 컨테이너)

```css
.input-wrap {
  flex: 1;
  display: flex;
  align-items: flex-end;
  background: #f3f4f6;
  border: 1.5px solid transparent;
  border-radius: 22px;
  padding: 8px 8px 8px 16px;
  transition: border-color .15s, background .15s;
}
.input-wrap:focus-within {
  border-color: var(--green);
  background: #fff;
}
```

#### textarea 자동 확장

```css
.chat-textarea {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  max-height: 120px;   /* 최대 약 5줄 */
  line-height: 1.5;
  font-size: 14px;
}
```

```javascript
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}
```

- 내용이 늘어나면 textarea 높이가 자동 증가 (최대 120px)
- 120px 초과 시 내부 스크롤 발생 (max-height에 의해)
- `onInputChange(el)` 내부에서 `autoResize(el)` 호출

#### 전송 버튼

```css
.chat-send-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--green);
  align-self: flex-end;
}
.chat-send-btn:disabled { background: var(--green-bd); cursor: not-allowed; }
.chat-send-btn svg { width: 13px; height: 13px; stroke: #fff; stroke-width: 2.2; fill: none; }
```

**Enter 키 = 전송, Shift+Enter = 줄바꿈:**

```javascript
onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();mobSend()}"
```

#### 파일 첨부 · 카메라

```javascript
// 파일 첨부 — 숨겨진 input[type=file] 클릭
function handleFile(input) {
  const file = input.files[0]; if (!file) return;
  // 파일명을 사용자 버블로 표시 후 AI 호출
}

// 카메라 — capture='environment'로 후면 카메라 열기
function openCamera() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = () => handleFile(input);
  input.click();
}
```

---

### 11-6. 채팅 버블

```css
/* AI 버블 */
.b-ai-wrap  { display:flex; flex-direction:column; align-self:flex-start; max-width:88%; }
.b-ai       { background:#f9fafb; border:1px solid var(--border);
              border-radius:4px 16px 16px 16px; padding:10px 14px; font-size:14px; }

/* 사용자 버블 */
.b-user-wrap { display:flex; flex-direction:column; align-items:flex-end;
               align-self:flex-end; max-width:88%; }
.b-user      { background:var(--green); color:#fff;
               border-radius:16px 16px 4px 16px; padding:10px 14px; font-size:14px; }

/* 시간 표시 */
.b-time { font-size:10px; color:var(--txt3); margin-top:3px; padding:0 2px; }
```

---

### 11-7. 설정 패널

topbar 우측 끝의 ⚙️ 버튼을 탭하면 화면 오른쪽에서 슬라이드 인.

#### 구조

```
┌────────────────────────────────┐
│ 딤 배경 (settings-overlay)     │  클릭 시 패널 닫힘
├──────────────────┬─────────────┘
│  settings-drawer │  width: 80% (max 300px)
│                  │  높이: 100%
│ ┌──────────────┐ │
│ │ 설정     [X] │ │  settings-head
│ ├──────────────┤ │
│ │ 계정         │ │  항상 첫 번째 섹션
│ │ ─────────── │ │
│ │ [서비스 기능] │ │  서비스별 고유 항목
│ │ ─────────── │ │
│ │ 대화         │ │  항상 포함
│ │  · 대화 기록 │ │
│ │  · 대화 초기화│ │
│ │ ─────────── │ │
│ │ 기타         │ │  항상 마지막 섹션
│ │  · PC 화면보기│ │
│ └──────────────┘ │
└──────────────────┘
```

#### 슬라이드 애니메이션 CSS

```css
.settings-panel {
  position: fixed; inset: 0; z-index: 999;
  display: flex; justify-content: flex-end;
  visibility: hidden;
}
.settings-panel.open { visibility: visible; }

.settings-overlay {
  flex: 1; background: rgba(0,0,0,.3);
  opacity: 0; transition: opacity .25s; cursor: pointer;
}
.settings-panel.open .settings-overlay { opacity: 1; }

.settings-drawer {
  width: 80%; max-width: 300px;
  background: #fff; height: 100%;
  transform: translateX(100%);
  transition: transform .25s;
  box-shadow: -4px 0 24px rgba(0,0,0,.12);
}
.settings-panel.open .settings-drawer { transform: translateX(0); }
```

#### 패널 열기/닫기

```javascript
function openSettings()  { document.getElementById('settings-panel').classList.add('open'); }
function closeSettings() { document.getElementById('settings-panel').classList.remove('open'); }
```

#### 섹션 구조 규칙

| 섹션 | 위치 | 내용 |
|------|------|------|
| **계정** | 항상 맨 위 | auth-badge와 동기화된 이름·레벨 |
| **서비스 고유** | 계정 아래 | 서비스별 기능 (예: 내 보험, 사건 현황, 납부 내역 등) |
| **대화** | 고유 섹션 아래 | 대화 기록 / 대화 초기화 (항상 포함) |
| **기타** | 항상 맨 아래 | PC 화면 보기 (항상 포함) |

#### settings-item 클릭 동작 규칙

- **설정 패널을 닫아야 하는 경우:** `onclick="someAction();closeSettings()"`
- **모달을 여는 경우(대화 기록 등):** `closeSettings()` 먼저 호출 후 모달 표시
- **외부 페이지 이동:** `window.open('desktop.html','_blank')` — 패널 닫기 불필요

---

### 11-8. 대화 기록 모달 (바텀시트)

설정 패널 → "대화 기록" 탭 시 아래에서 슬라이드 업.

#### 구조

```
┌─────────────────────────────┐
│       딤 배경               │  클릭 시 닫힘
│  ┌───────────────────────┐  │
│  │  대화 기록        [X] │  │  history-sheet-head
│  ├───────────────────────┤  │
│  │  [나]  안녕하세요     │  │  사용자: green-lt 배경, 우측 정렬
│  │  [AI]  안녕하세요!   │  │  AI: chip-bg 배경, 좌측 정렬
│  │  [나]  질문입니다     │  │
│  │  [AI]  답변입니다     │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

#### 바텀시트 CSS

```css
.history-modal {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,.45);
  display: flex; align-items: flex-end; justify-content: center;
  visibility: hidden; opacity: 0;
  transition: opacity .2s, visibility .2s;
}
.history-modal.open { visibility: visible; opacity: 1; }

.history-sheet {
  width: 100%; max-width: 480px;
  background: #fff;
  border-radius: 20px 20px 0 0;
  max-height: 75dvh;
  display: flex; flex-direction: column;
  transform: translateY(100%);
  transition: transform .25s;
}
.history-modal.open .history-sheet { transform: translateY(0); }
```

#### 대화 항목 스타일

```css
.history-item.user { background:var(--green-lt); color:var(--green-dk);
                     align-self:flex-end; text-align:right; }
.history-item.ai   { background:var(--chip-bg); color:#374151;
                     align-self:flex-start; }
```

#### showHistory() 구현 패턴

```javascript
function showHistory() {
  closeSettings();   // ★ 설정 패널 먼저 닫기
  const body = document.getElementById('history-body');
  body.innerHTML = '';
  if (!hist.length) {
    body.innerHTML = '<div class="history-empty">대화 기록이 없습니다.</div>';
  } else {
    hist.forEach(m => {
      const el = document.createElement('div');
      el.className = `history-item ${m.role === 'user' ? 'user' : 'ai'}`;
      el.innerHTML = `<div class="history-item-role">${m.role === 'user' ? '나' : 'AI'}</div>
                      ${escHtml(m.content).replace(/\n/g, '<br>')}`;
      body.appendChild(el);
    });
    setTimeout(() => { body.scrollTop = body.scrollHeight; }, 50);  // 최신으로 스크롤
  }
  document.getElementById('history-modal').classList.add('open');
}
function closeHistory() { document.getElementById('history-modal').classList.remove('open'); }
```

---

### 11-9. 대화 초기화 (clearChat)

`location.reload()` 없이 DOM 직접 조작으로 처리한다.

```javascript
function clearChat() {
  hist = [];
  document.getElementById('mob-chat-body').innerHTML = '';
  // 인트로 섹션 복원
  const intro = document.getElementById('intro-section');
  if (intro) {
    intro.style.display = 'flex';
  } else {
    location.reload();   // intro가 DOM에 없을 경우 폴백만 reload 사용
    return;
  }
  // 입력 필드 초기화
  const inp = document.getElementById('mob-input');
  if (inp) { inp.value = ''; autoResize(inp); updateSendBtn(); }
  // 보조 버튼 복원
  document.getElementById('aux-btns')?.classList.remove('hidden');
}
```

---

### 11-10. UI 체크리스트 (하위 시스템 공통)

| # | 항목 | 비고 |
|---|------|------|
| UI-1 | 화이트 테마 (`background:#fff`) | 다크 테마 금지 |
| UI-2 | green tint (`--green:#16a34a`) | 모든 하위 시스템 통일 |
| UI-3 | Pretendard 폰트 로드 | Google Fonts CDN |
| UI-4 | 인트로 섹션 존재 (아이콘·타이틀·퀵칩) | `id="intro-section"` |
| UI-5 | 퀵칩 5개 이상 | SVG 아이콘 + 레이블 |
| UI-6 | aux-btns — 마이크·파일첨부·카메라 | 기본 표시, 입력 시 숨김 |
| UI-7 | 마이크 SVG 24px (다른 아이콘 22px) | 마이크만 더 크게 |
| UI-8 | input-wrap 포커스 시 green 테두리 | `focus-within` |
| UI-9 | textarea max-height 120px | 약 5줄 |
| UI-10 | Enter = 전송, Shift+Enter = 줄바꿈 | |
| UI-11 | send-btn 초기 `disabled` | 텍스트 없을 때 비활성 |
| UI-12 | 입력 시 인트로 숨김, aux-btns 숨김 | `onInputChange()` |
| UI-13 | 전송 후 aux-btns 복원 | `mobSend()` 내부 |
| UI-14 | ⚙️ 설정 버튼 topbar 우측 끝 | `top-btn icon-only` |
| UI-15 | 설정 패널 슬라이드 인 (오른쪽에서) | `translateX(100%)→0` |
| UI-16 | 설정 패널 딤 배경 클릭 시 닫힘 | `settings-overlay` onclick |
| UI-17 | 설정 패널 — 계정·서비스·대화·기타 순서 | 섹션 순서 고정 |
| UI-18 | 대화 기록 모달 (바텀시트) | `history-modal` |
| UI-19 | 대화 기록 — 최신 메시지로 자동 스크롤 | `scrollTop = scrollHeight` |
| UI-20 | PC 화면 보기 — `window.open('desktop.html','_blank')` | 기타 섹션 |
| UI-21 | clearChat — reload 없이 DOM 직접 조작 | 인트로 복원 포함 |
| UI-22 | auth-badge — 인증 전 `display:none` | SSO 완료 후 표시 |

---

*AI City Inc. · 팀 주피터 · hondi.net · github.com/Openhash-Gopang/gopang*
*DAWN: Democracy is All We Need · MIT License*
