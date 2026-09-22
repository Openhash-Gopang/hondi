# 고팡 (Gopang) 개발 매뉴얼 v5.1

> ⚠️ **폐기된 문서 (2026-07-19)** — Supabase 기반 아키텍처를 설명하는 구버전입니다.
> 현재는 L1 PocketBase로 완전 이관되었습니다. 최신 문서: [docs/L1_POCKETBASE_MANUAL_v1_0.md](../L1_POCKETBASE_MANUAL_v1_0.md)
> 전체 문서 지도: [docs/MANUAL_INDEX.md](../MANUAL_INDEX.md)

---


> 작성: AI City Inc. · 도영민 | 최종 갱신: 2026-05-28

---

## § 1. 프로젝트 개요

고팡은 제주도 기반 AI 통합 커뮤니케이션·서비스 포털입니다.
사용자의 말 한마디로 적합한 서비스를 자동 호출하고, 결과를 PDV(개인 데이터 금고)에 기록합니다.

### 핵심 원칙
- **의도 파악 우선**: 사용자 입력에서 진짜 의도를 파악하여 서비스를 호출
- **PDV 6하 원칙**: 모든 활동을 누가/언제/어디서/무엇을/어떻게/왜 형식으로 기록
- **K-Law 상시 감시**: 모든 대화에서 법적 리스크를 백그라운드에서 자동 감지

---

## § 2. 저장소 구조

| 저장소 | URL | 역할 |
|---|---|---|
| gopang_v2 | github.com/Openhash-Gopang/gopang_v2 | 고팡 포털 (hondi.net) |
| fiil | github.com/nounweb/fiil | K-Clean 서비스 (fiil.kr) |

---

## § 3. 파일 구조 (gopang_v2)

```
gopang_v2/
├── index.html              ← 앱 진입점 (v5.0)
├── config.js               ← 전역 상수·API키·GWP 레지스트리 ⚠️ .gitignore
├── sw.js                   ← Service Worker
│
├── js/
│   ├── core/
│   │   ├── auth.js         ← 사용자 식별·Supabase upsert
│   │   └── location.js     ← GPS·역지오코딩(Worker)·날씨
│   ├── services/
│   │   ├── ai.js           ← callAI·도메인 감지·전문가 SP 로딩
│   │   ├── gwp.js          ← GWP 새탭 실행·window.message 수신 (v2.1)
│   │   ├── klaw.js         ← K-Law 백그라운드 법적 리스크 감시
│   │   ├── pdv.js          ← PDV 6하 원칙 기록
│   │   ├── registry.js     ← 서비스 자기 등록 레지스트리
│   │   └── storage.js      ← Supabase Storage 사진 업로드
│   └── fiil/
│       └── reporter.js     ← fiil 신고서 생성·전송
│
├── services/
│   ├── fiil-kcleaner/manifest.json  ← K-Clean 서비스 등록 정보
│   └── klaw/manifest.json           ← K-Law 서비스 등록 정보
│
├── klaw/prompts/
│   ├── system_prompt.txt   ← K-Law v15.1 (판결 예측)
│   └── monitor_prompt.txt  ← K-Law 감시용 경량 프롬프트
│
├── prompts/
│   ├── SP-00-ROUTER.txt    ← 고팡 1단계 라우터
│   ├── SP-00_v9.0.txt      ← 고팡 AI 비서 시스템 프롬프트
│   ├── SP-14_kcleaner_v1.2.txt      ← K-Clean 텍스트 분석
│   └── SP-14-IMG_kcleaner_vision_prompt_v1.0.txt ← K-Clean 이미지 분석
│
└── tools/
    ├── serve.py            ← 로컬 테스트 서버 (포트 8000)
    └── worker.js           ← Cloudflare Worker 소스
```

### 파일별 역할 요약 (GWP 관련)

| 파일 | 역할 |
|---|---|
| `gwp-sdk.js` (fiil 저장소 루트) | 서비스 webapp용 클라이언트 SDK. `GopangWidget` 클래스 제공. `window.opener.postMessage()`로 고팡에 결과 전송 |
| `js/services/gwp.js` (gopang_v2) | 고팡 측 GWP 런타임. 서비스 호출(`gwpLaunch`), 결과 수신(`_onGwpMessage`), PDV 기록, 탭 닫힘 감지 |
| `config.js` (gopang_v2) | `GWP_REGISTRY` 배열 — 고팡이 인식하는 서비스 목록 (트리거 키워드 포함) |
| `services/{id}/manifest.json` (gopang_v2) | 각 서비스의 자기 등록 정보. 서비스가 고팡에 자신을 알리는 표준 규격 |

---

## § 4. 서비스 분류 체계

```
고팡 (1단계 — 14개 대분류)
├── ECO  금융·경제
├── MED  의료·보건      → K-Health (예정)
├── EDU  교육·연구
├── TRN  교통·물류
├── MKT  시장·거래
├── GOV  정부행정
├── JUS  사법·법률      → K-Law ✅
├── IND  산업·생산
├── ENV  환경·자원      → K-Clean (fiil.kr) ✅
├── CUL  문화·여가
├── SOC  사회·복지
├── IOT  IoT·사물
├── INT  국제·외교
└── COM  미디어·통신
```

각 대분류 서비스가 중분류, 소분류로 이어지는 3단계 계층 구조.

---

## § 5. GWP (Gopang Widget Protocol) 아키텍처

### v2.1 — 새 탭 + window.opener.postMessage 방식

**설계 원칙**: 고팡과 각 서비스 webapp은 직접 1:1 통신합니다. 중계 서버 없이
`gwp-sdk.js` 표준 하나로 수십 개 서비스를 연결할 수 있습니다.

```
사용자 입력 (텍스트 + 사진)
    ↓
고팡 → Supabase Storage에 사진 업로드 → public URL 획득
    ↓
gwpLaunch() → window.open(서비스URL?gwp=1&photo_url=...&gps_addr=...&desc=...)
    ↓ (새 탭 오픈 — cross-origin 허용)
서비스 webapp 자동 처리 (사진 fetch → AI 분석 → 신고 제출)
    ↓
gwp.done() → window.opener.postMessage(GWP_DONE, gopang_origin)
    ↓ (고팡 측 window 'message' 이벤트 수신)
_onGwpMessage() → PDV 기록 → 완료 버블 출력 → gwpClose()
```

### BroadcastChannel을 사용하지 않는 이유

BroadcastChannel은 **동일 origin(scheme + host + port 모두 일치)** 에서만 동작합니다.
고팡(`localhost:8000`)과 서비스(`localhost:8001`, `fiil.kr`)는 포트/도메인이 달라
`window.opener.postMessage()`를 사용합니다. 이 방식은 cross-origin을 허용하며
target origin을 명시하여 보안을 유지합니다.

### 전체 통신 흐름도

```
고팡 (hondi.net)                    서비스 webapp (fiil.kr 등)
─────────────────────                ──────────────────────────
gwpLaunch(svc, ctx, extra)
  └─ window.open(url)  ──────────→  새 탭 로드
  └─ _startChannel()               GopangWidget 초기화
     window.addEventListener         gwp.ready() 호출
     ('message', _onGwpMessage)
                                     작업 처리 (AI 분석, 신고 등)
                                     gwp.done({ summary, pdvData })
                                       └─ window.opener
_onGwpMessage(e)  ←──────────────────     .postMessage(GWP_DONE)
  └─ origin 검증
  └─ _recordPDV()
  └─ appendBubble('✅ 완료')
  └─ gwpClose()
```

---

## § 6. 새 서비스 등록 방법 (3단계)

### Step 1 — manifest.json 작성 및 배포

`gopang_v2/services/{서비스ID}/manifest.json`:

```json
{
  "id":          "my-service",
  "name":        "서비스명",
  "icon":        "🔧",
  "version":     "1.0.0",
  "url":         "https://my-service.kr/webapp.html",
  "category":    "ENV",
  "sp_path":     "prompts/SP-XX.txt",
  "triggers":    ["키워드1", "키워드2", "키워드3"],
  "description": "서비스 설명"
}
```

### Step 2 — GWP_REGISTRY 등록

`config.js`의 `GWP_REGISTRY` 배열에 추가:

```javascript
export const GWP_REGISTRY = [
  {
    id:       'fiil-kcleaner',
    name:     'K-Clean',
    icon:     '🌊',
    url:      location.hostname === 'localhost'
                ? 'http://localhost:8001/webapp.html'
                : 'https://fiil.kr/webapp.html',
    triggers: ['해안 쓰레기', '불법 투기', '환경 신고', '쓰레기 신고'],
    category: 'ENV',
  },
  // 새 서비스 추가
  {
    id:       'my-service',
    name:     '서비스명',
    icon:     '🔧',
    url:      'https://my-service.kr/webapp.html',
    triggers: ['키워드1', '키워드2'],
    category: 'ENV',
  },
];
```

> ⚠️ `config.js`는 `.gitignore` 대상입니다. 운영 서버에 별도 배포 필요.

### Step 3 — 서비스 webapp에 gwp-sdk.js 적용

서비스 webapp(`webapp.html`)에서:

```html
<!-- 1. SDK 로드 -->
<script src="/gwp-sdk.js"></script>

<script>
// 2. GopangWidget 초기화 — gwp=1 파라미터일 때만 활성화
if (GopangWidget.isWidget) {
  const gwp = new GopangWidget({
    onInit({ token, context, gpsAddr, photoUrl, desc }) {
      // 고팡이 전달한 컨텍스트 활용
      // token: 사용자 GUID
      // gpsAddr: GPS 좌표 + 행정 지명
      // photoUrl: Supabase Storage 사진 URL
      // desc: 요청사항 텍스트
    },
    onInput(text, file) {
      // 고팡 입력창에서 추가 입력이 들어올 때
    },
  });

  window.__gwpInstance = gwp;

  gwp.ready({
    title:       '서비스명',
    placeholder: '안내 문구',
  });
}

// 3. 작업 완료 시 고팡에 보고
function onTaskComplete(result) {
  window.__gwpInstance?.done({
    summary: '작업 완료 요약',
    pdvData: {
      when:  new Date().toISOString(),
      where: result.location,
      what:  result.summary,
      how:   'image',            // 또는 'text'
      why:   '서비스 이용 목적',
      data:  result,             // 원본 데이터
    },
  });
}
</script>
```

---

## § 7. gwp-sdk.js API 레퍼런스 (v2.1)

| 메서드 / 프로퍼티 | 설명 |
|---|---|
| `GopangWidget.isWidget` | `gwp=1` 파라미터 여부 (static getter) |
| `new GopangWidget({ onInit, onInput })` | 인스턴스 생성. URL 파라미터 자동 파싱 |
| `gwp.ready(options)` | 서비스 준비 완료 신호. `onInit` 핸들러 호출 |
| `gwp.done({ summary, pdvData })` | 작업 완료 보고. `window.opener.postMessage(GWP_DONE)` 전송 |
| `gwp.message(text)` | 고팡 채팅창에 메시지 버블 출력 |

### ready() options

| 옵션 | 설명 |
|---|---|
| `title` | 고팡 상단 타이틀바에 표시할 서비스명 |
| `placeholder` | 고팡 입력창 placeholder 텍스트 |
| `accept` | 파일 입력 accept (예: `'image/*'`) |
| `showCamera` | 카메라 버튼 표시 여부 |

### done() pdvData 6하 원칙

| 필드 | 6하 | 설명 |
|---|---|---|
| `who` | 누가 | 미입력 시 SDK가 token으로 자동 채움 |
| `when` | 언제 | 미입력 시 SDK가 `new Date().toISOString()` 자동 채움 |
| `where` | 어디서 | GPS 좌표 또는 행정 지명 |
| `what` | 무엇을 | 작업 요약 |
| `how` | 어떻게 | `'image'` 또는 `'text'` |
| `why` | 왜 | 서비스 이용 목적 |
| `data` | — | 서비스 원본 데이터 (JSON) |

---

## § 8. URL 파라미터 (고팡 → 서비스)

| 파라미터 | 설명 |
|---|---|
| `gwp=1` | GWP 모드 활성화 (필수) |
| `token` | 사용자 GUID |
| `origin` | 고팡 origin (보안 검증용) |
| `ctx` | 사용자 입력 텍스트 (URL 인코딩) |
| `gps_addr` | GPS 좌표 + 행정 지명 (URL 인코딩) |
| `photo_url` | Supabase Storage 사진 public URL |
| `desc` | 요청사항 텍스트 (URL 인코딩) |

---

## § 9. Cloudflare Worker (gopang-proxy)

URL: `https://gopang-proxy.tensor-city.workers.dev`

| 엔드포인트 | 메서드 | 역할 |
|---|---|---|
| `/deepseek` | POST | DeepSeek API 프록시 |
| `/geocode?lat=&lng=` | GET | 카카오 역지오코딩 프록시 |
| `/gemini/*` | POST | GPT-4o mini Vision 프록시 |

환경변수 (Cloudflare Dashboard → Settings):
- `DEEPSEEK_API_KEY`
- `KAKAO_REST_KEY`
- `OpenAI` (GPT-4o mini)

---

## § 10. Supabase 테이블

| 테이블 | 역할 |
|---|---|
| `users` | 사용자 식별 (guid, device_fp, phone) |
| `pdv_log` | PDV 6하 원칙 기록 (12컬럼) |
| `reports` | fiil.kr 신고서 |

### pdv_log 6하 원칙 컬럼

| 컬럼 | 6하 | 설명 |
|---|---|---|
| `user_guid`, `who_name` | 누가 | GUID + 마스킹 전화번호 |
| `created_at` | 언제 | 자동 타임스탬프 |
| `location` | 어디서 | GPS 좌표 또는 행정 지명 |
| `summary`, `payload` | 무엇을 | 요약 + 전체 JSON |
| `how`, `record_type` | 어떻게 | image/text/auto |
| `why`, `service_id` | 왜 | 서비스 이용 목적 |

### Supabase Storage

버킷: `gopang-photos` (public)
- 경로: `{user_guid}/{timestamp}.jpg`
- 용도: 고팡에서 사진 업로드 후 서비스에 URL 전달

---

## § 11. K-Law 이중 역할

| 역할 | 방식 | 프롬프트 |
|---|---|---|
| **백그라운드 감시** | 모든 대화 자동 분석, 30초 쿨다운 | `monitor_prompt.txt` |
| **판결 예측 서비스** | 사용자 명시적 요청, GWP 위젯 | `system_prompt.txt` (v15.1) |

---

## § 12. 로컬 개발 환경

```powershell
# 터미널 1 — 고팡
cd C:\Users\주피터\Downloads\gopang_v2
python tools\serve.py

# 터미널 2 — fiil.kr
cd C:\Users\주피터\Downloads\fiil
python -m http.server 8001
```

브라우저: `http://localhost:8000`

### config.js 개발/운영 분기

```javascript
// 개발 시 fiil.kr 로컬 서버 사용
url: location.hostname === 'localhost'
  ? 'http://localhost:8001/webapp.html'
  : 'https://fiil.kr/webapp.html'
```

---

## § 13. 테스트 결과 (v5.1)

| 테스트 | 결과 | 비고 |
|---|---|---|
| T-01 사용자 로그인 | ✅ | UUID + GPS + 역지오코딩 정상 |
| T-02 GWP fiil.kr 호출 | ✅ | 새 탭 방식, 사진/GPS/메시지 전달 |
| T-03 Supabase PDV 기록 | ✅ | 6하 원칙 12컬럼 저장 |
| T-04 GWP 완료 보고 수신 | ✅ | window.opener.postMessage cross-origin 정상 동작 |
| T-05 관리자 로그인 | 🔲 | 미구현 (다음 스프린트) |

---

## § 14. 이번 스프린트 주요 변경사항 (2026-05-28)

### 문제 및 원인
GWP 완료 보고(`GWP_DONE`)가 고팡에 전달되지 않는 문제.

| 버그 | 원인 | 수정 |
|---|---|---|
| `GopangWidget.isWidget` 항상 false | 클래스에 `isWidget` 프로퍼티 없음 | `static get isWidget()` getter 추가 |
| `BroadcastChannel` 수신 불가 | 고팡(8000)↔서비스(8001) 포트 달라 cross-origin 차단 | `window.opener.postMessage` 방식으로 전환 |
| `setTimeout` 구조 오류 | 닫는 `}` 위치 잘못됨 + 인코딩 깨진 코드 혼재 | GWP 초기화 블록 전체 재작성 |
| `listenGWPDone` export 누락 | 리팩터 중 주석으로 대체됨 | `export function listenGWPDone() {}` 복원 |

### 수정된 파일

| 파일 | 저장소 | 변경 내용 |
|---|---|---|
| `gwp-sdk.js` | fiil | v2.1: `static get isWidget()`, `_post()`를 `window.opener.postMessage`로 교체 |
| `webapp.html` | fiil | GWP 초기화 블록 재작성. `onInit`에서 URL 파라미터 처리 통합. `_gopangNotify` 제거 |
| `js/services/gwp.js` | gopang_v2 | `_startChannel()`을 `window.addEventListener('message')`로 교체. `_onGwpMessage` 분리. BroadcastChannel 제거 |

---

## § 15. 배포

```powershell
# gopang_v2
cd C:\Users\주피터\Downloads\gopang_v2
git add . && git add -u
git commit -m "feat: GWP v2.1 — opener.postMessage, cross-origin 완료 보고 정상화"
git push origin main

# fiil
cd C:\Users\주피터\Downloads\fiil
git add . && git add -u
git commit -m "feat: gwp-sdk v2.1 — isWidget getter, opener.postMessage 전환"
git push origin main
```

⚠️ `config.js`는 `.gitignore`에 추가되어 있어 push되지 않습니다.
운영 서버에는 별도로 배포해야 합니다.

---

## § 16. 향후 로드맵

- [ ] 관리자 인증 (Supabase Auth)
- [ ] K-Law 판결 예측 GWP 위젯
- [ ] K-Health 서비스 추가
- [ ] GWP_REGISTRY 원격 JSON 전환 (서비스 재배포 없이 등록)
- [ ] `gwp-sdk.js` CDN 배포 (hondi.net/gwp-sdk.js)
- [ ] Gemini 코드 제거 (OpenAI로 통일)
- [ ] 고팡 SP-00 1단계 라우터 고도화
