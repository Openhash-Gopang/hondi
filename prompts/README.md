# 나비 (Navi) — AI 평행 세계 플랫폼

> 현실 세계의 모든 기관·사물·전문직의 AI 쌍둥이로 구축한 평행 세계.
> 하위 시스템 개발자를 위한 통합 진입점입니다.

---

## 빠른 시작 (하위 시스템 개발자)

나비의 하위 시스템(K-Law, K-Market, K-School 등)을 개발한다면
**아래 순서대로** 읽으면 됩니다.

```
1단계  인증 통합    → #1-나비-인증-통합
2단계  보고서 전송  → #2-pdv-보고서-전송
3단계  서비스 등록  → #3-서비스-등록
4단계  상세 문서    → docs/ 폴더
```

---

## 1. 나비 인증 통합

모든 하위 시스템은 **독자 인증 없이** 나비 SSO를 사용합니다.

### 필요한 파일

| 파일 | 위치 | 역할 |
|------|------|------|
| `gopang-sso.js` | `https://hondi.net/auth/gopang-sso.js` | 인증 라이브러리 |
| `silent-auth.html` | `https://hondi.net/auth/silent-auth.html` | 인증 엔드포인트 |

### 3줄 통합

```html
<script type="module">
import { gopangAuth } from 'https://hondi.net/auth/gopang-sso.js';

const user = await gopangAuth.require('L0');  // 미인증 시 자동 처리
if (!user) return;                            // 리다이렉트 중

console.log(user.ipv6);   // 사용자 정체성
console.log(user.level);  // L0 | L1 | L2 | L3
</script>
```

### 인증 레벨

| 레벨 | 수단 | 사용 시점 |
|------|------|-----------|
| L0 | 기기 자동 인식 | 일반 접속·조회 |
| L1 | + 얼굴 (MediaPipe) | 개인정보 열람·소액 결제 |
| L2 | + 지문 (WebAuthn) | 금융 거래·계약 서명 |
| L3 | + 얼굴 + 지문 + 4단어 | 고액 거래·불가역 행위 |

### 상세 문서

📄 [`docs/gopang-auth-whitepaper.md`](docs/gopang-auth-whitepaper.md)
— 인증 원리, 레벨 기준표, 보안 분석, 하위 시스템 구현 가이드(§12)

---

## 2. PDV 보고서 전송

하위 시스템은 사용자 활동을 주기적으로 나비 PDV에 보고합니다.
나비는 이를 6하원칙(누가·언제·어디서·무엇을·어떻게·왜)으로 기록합니다.

### 필요한 파일

| 파일 | 위치 | 역할 |
|------|------|------|
| `gopang-report.js` | `https://hondi.net/report/gopang-report.js` | 보고서 전송 라이브러리 |

### 3줄 전송

```javascript
import { buildReport, sendReportOnce }
  from 'https://hondi.net/report/gopang-report.js';

const report = buildReport({
  svc:    'school',
  type:   'weekly_progress',
  ipv6:   user.ipv6,
  what: { summary: '수학 2단원 완료, 영어 80% 진행', details: [...] },
  how:  { method: 'AI 튜터 + 문제 풀이' },
  why:  { goal: '1학기 선행 준비', triggered: 'weekly_schedule' },
});

const ack = await sendReportOnce(report);  // 중복 방지 자동 처리
console.log(ack.pdv_entry);               // PDV 기록 ID
```

### API 엔드포인트

```
POST https://gopang-proxy.tensor-city.workers.dev/pdv/report
GET  https://gopang-proxy.tensor-city.workers.dev/svc/verify?svc_id=school
POST https://gopang-proxy.tensor-city.workers.dev/svc/register
```

### 상세 문서

📄 [`docs/gopang-report-manual.md`](docs/gopang-report-manual.md)
— 6하원칙 JSON 스키마, 보고서 유형, 전송 API, ACK, 오류 처리, school 예시

---

## 3. 서비스 등록

나비 인증·PDV를 사용하려면 **서비스 등록**이 필요합니다.

### 등록 수준

| 수준 | 조건 | 인증 | PDV 보고 |
|------|------|------|----------|
| Level 1 | `*.hondi.net` 서브도메인 | ✅ 자동 | ❌ |
| Level 2 | 외부 도메인, 신원 확인 | ✅ | ✅ |
| Level 3 | AI City Inc. 공식 파트너 | ✅ | ✅ |

### 등록 방법

**Level 1** — `*.hondi.net` 서브도메인이면 자동 승인:
```
하위 서비스 URL: https://myservice.hondi.net
→ gopangAuth.require() 즉시 사용 가능
```

**Level 2 / 3** — 이 저장소에 Issue 등록:

```
제목: [서비스 등록] {서비스명}

내용:
- 서비스 ID:    myservice
- 도메인:       https://myservice.example.com
- 운영자 IPv6:  2601:db80:...
- 서비스 설명:  (한 줄 설명)
- 필요 기능:    인증만 / 인증 + PDV 보고
```

또는 API로 신청:
```javascript
await fetch('https://gopang-proxy.tensor-city.workers.dev/svc/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    svc_id:        'myservice',
    domain:        'https://myservice.hondi.net',
    operator_ipv6: user.ipv6,
    description:   '서비스 설명',
    min_auth:      'L0',
  }),
});
```

---

## 4. 저장소 구조

```
gopang_v2/
│
│  ← hondi.net 배포 파일
├── index.html          기기 감지 라우터
├── webapp.html         모바일 PWA (AI 비서)
├── desktop.html        PC 랜딩 페이지
├── worker.js           Cloudflare Worker (API 서버)
├── manifest.json       PWA 설정
│
│  ← 인증 라이브러리 (hondi.net/auth/*)
├── auth/
│   ├── gopang-sso.js       하위 시스템 SSO 라이브러리
│   └── silent-auth.html    인증 엔드포인트 (리다이렉트·iframe)
│
│  ← 보고서 라이브러리 (hondi.net/report/*)
├── report/
│   └── gopang-report.js    PDV 보고서 전송 라이브러리
│
│  ← 문서
├── docs/
│   ├── gopang-auth-whitepaper.md   인증 백서 (§12: 하위 시스템 구현 가이드)
│   ├── gopang-report-manual.md     보고서 전송 매뉴얼
│   ├── supabase_webauthn.sql       WebAuthn 테이블 SQL
│   └── ...기타 설계 문서
│
│  ← 나비 앱 빌드 소스
├── src/
│   ├── app.js              부트스트랩
│   ├── ai-secretary/       AI 비서 파이프라인
│   ├── domains/k-law/      K-Law 플러그인
│   ├── domains/k-health/   K-Health 플러그인
│   └── ...
│
│  ← 개발 도구
└── tools/
    ├── build.py            빌드 스크립트
    └── serve.py            로컬 서버
```

---

## 5. 하위 시스템 도메인 요건

```
필수: *.hondi.net 서브도메인
  klaw.hondi.net    ✅
  school.hondi.net  ✅
  myservice.hondi.net ✅

  myservice.com      ❌ (WebAuthn L2 불가, 별도 신청 필요)

필수: HTTPS
  http:// 환경에서는 L2 이상 인증 불가
```

---

## 6. Worker API 전체 목록

`https://gopang-proxy.tensor-city.workers.dev`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/auth/issue` | SSO 토큰 발급 |
| GET  | `/auth/verify` | 토큰 검증 |
| GET  | `/auth/refresh` | 토큰 갱신 |
| POST | `/auth/webauthn/challenge` | WebAuthn 챌린지 발급 |
| POST | `/auth/webauthn/register` | 지문 공개키 등록 |
| POST | `/auth/webauthn/verify` | 지문 서명 검증 |
| GET  | `/geocode` | 카카오 역지오코딩 |
| POST | `/deepseek` | DeepSeek API 프록시 |
| POST | `/gemini/*` | GPT-4o mini 프록시 |
| POST | `/pdv/report` | **PDV 보고서 수신·기록** |
| POST | `/svc/register` | **서비스 등록 신청** |
| GET  | `/svc/verify` | **서비스 등록 상태 확인** |

---

## 7. 문의

| 목적 | 연락처 |
|------|--------|
| 서비스 등록 신청 | GitHub Issue |
| 기술 문의 | dev@hondi.net |
| 법률·파트너십 | legal@hondi.net |
| 일반 문의 | hello@hondi.net |

---

## 나비란

나비는 현실 세계의 모든 기관·사물·전문직의 AI 쌍둥이로 구축한 AI 평행 세계 플랫폼입니다.
사용자는 단일 정체성(IPv6)으로 수백 개의 하위 시스템에 접근하며,
전용 AI 비서가 각 기관과의 소통을 대행합니다.

철학·비전·기술 상세: [`docs/GDC_Whitepaper_v1.5.md`](docs/GDC_Whitepaper_v1.5.md)

---

*© 2026 AI City Inc. — DAWN: Democracy is All We Need*
