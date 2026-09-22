# 고팡 하위 시스템 등록 안내서
## Gopang Subsystem Registry Guide v1.0

> **저장소:** `Openhash-Gopang/gopang_v2`  
> **파일:** `gwp-registry.js`  
> **작성일:** 2026-06-03  
> **작성자:** AI City Inc. (팀 주피터)  
> **문의:** dev@hondi.net

---

## § 1. 개요

고팡은 수백 종의 하위 시스템으로 구성된 AI 평행 세계입니다.  
사용자가 고팡 앱에 자연어로 요청하면, **GWP 라우터**가 `gwp-registry.js`를 읽어  
가장 적합한 하위 시스템을 자동으로 호출합니다.

**핵심 원칙:**
- 라우터는 서비스 목록을 모릅니다
- 각 서비스가 스스로 "나는 이런 요청을 처리합니다"를 등록합니다
- 신규 서비스 추가 = `gwp-registry.js`에 항목 1개 추가

```
사용자: "잔액 얼마야?"
        │
        ▼
gwp-registry.js 순회
        │  kgdc.triggers에 '잔액' 포함 → 매칭
        ▼
gdc.hondi.net/webapp.html?gwp=1 자동 호출
```

---

## § 2. 등록 구조

`gwp-registry.js`의 `GWP_REGISTRY` 배열에 객체 1개를 추가합니다.

### 2-1. 필수 필드

```javascript
{
  id:          'your-service-id',   // 고유 서비스 ID (소문자, 하이픈 허용)
  name:        '서비스 이름',        // 사용자에게 표시될 이름
  category:    'ECO',               // 카테고리 코드 (§4 참조)
  url:         'https://your-service.hondi.net/webapp.html',
  minAuth:     'L0',                // 최소 인증 레벨 (§5 참조)
  pdv:         true,                // PDV 기록 허용 여부
  priority:    5,                   // 우선순위 (낮을수록 먼저, 0=긴급)
  description: '서비스 한 줄 설명',
  triggers:    ['키워드1', '키워드2', ...],
}
```

### 2-2. 전체 예시

```javascript
{
  id:          'kfarm',
  name:        'K-Agriculture',
  category:    'ENV',
  url:         'https://farm.hondi.net/webapp.html',
  minAuth:     'L0',
  pdv:         true,
  priority:    7,
  description: '농업·축산·수산 AI 자문. 기상·토양 데이터 연동.',
  triggers: [
    '농업', '농산물', '축산', '수산', '작물', '재배',
    '병충해', '비료', '수확', '농지', '스마트팜',
    '어업', '양식', '낚시', '임업', '산림',
  ],
}
```

---

## § 3. 등록 절차

### Step 1 — 저장소 Fork

```bash
# GitHub에서 Fork 후 로컬에 클론
git clone https://github.com/YOUR_NAME/gopang_v2.git
cd gopang_v2
```

### Step 2 — `gwp-registry.js` 수정

```javascript
// gwp-registry.js 하단 GWP_REGISTRY 배열에 항목 추가
export const GWP_REGISTRY = [
  // ... 기존 서비스들 ...

  // ── 신규 서비스 ─────────────────────────
  {
    id:          'kfarm',
    name:        'K-Agriculture',
    category:    'ENV',
    url:         'https://farm.hondi.net/webapp.html',
    minAuth:     'L0',
    pdv:         true,
    priority:    7,
    description: '농업·축산·수산 AI 자문.',
    triggers: ['농업', '농산물', '수확', '스마트팜'],
  },
];
```

### Step 3 — 서비스 시스템 프롬프트 작성

하위 서비스 전용 AI 프롬프트를 작성합니다.

```
gopang_v2/
└── your-service/
    └── prompts/
        └── SP-KFARM-v1_0.txt   ← 신규 작성
```

프롬프트 파일 명명 규칙:
```
SP-{서비스ID대문자}-v{버전}.txt
예: SP-KFARM-v1_0.txt
    SP-KHEALTH-v2_1.txt
```

### Step 4 — 하위 시스템 HTML에 인증 삽입

모든 하위 시스템은 `</body>` 직전에 **한 줄**만 추가합니다.

```html
<!-- 고팡 SSO 인증 — 이 한 줄이 전부 -->
<script type="module"
  src="https://hondi.net/auth/subsystem-auth.js">
</script>
```

인증 완료 콜백:

```javascript
window._onGopangAuth = async function(user) {
  // user.ipv6  : 사용자 GUID
  // user.level : 인증 레벨 (L0~L3)
  // user.via   : 인증 경로 (session / iframe / gwp)
  if (!user?.ipv6) return;

  const guid = user.ipv6;
  // 서비스 초기화
  initMyService(guid);
};
```

### Step 5 — PDV 기록 (권장)

사용자 활동을 PDV에 기록합니다.

```javascript
await fetch('https://gopang-proxy.tensor-city.workers.dev/pdv/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    report: {
      svc:  'kfarm',          // gwp-registry.js의 id와 동일
      type: 'event',
      who: {
        ipv6:       user.ipv6,
        role:       'user',
        level:      user.level,
        recipients: ['gopang-pdv'],
      },
      when: {
        period_start: new Date().toISOString(),
        period_end:   new Date().toISOString(),
      },
      where: { svc_url: 'https://farm.hondi.net/webapp.html' },
      what:  { summary: '농업 AI 자문 접속' },
      how:   { method: '고팡 SSO 자동 인증' },
      why:   { goal:   '농업 정보 조회' },
    }
  })
});
```

### Step 6 — Pull Request 제출

```bash
git add gwp-registry.js your-service/prompts/SP-KFARM-v1_0.txt
git commit -m "feat: K-Agriculture (kfarm) 레지스트리 등록"
git push origin main
```

GitHub에서 `Openhash-Gopang/gopang_v2`로 Pull Request를 제출합니다.

**PR 제목 형식:**
```
feat: {서비스명} ({서비스ID}) 레지스트리 등록
예: feat: K-Agriculture (kfarm) 레지스트리 등록
```

**PR 본문 체크리스트:**
```
- [ ] gwp-registry.js에 항목 추가
- [ ] triggers 키워드 10개 이상
- [ ] 서비스 URL 접속 확인
- [ ] subsystem-auth.js 연동 확인
- [ ] PDV 기록 테스트 완료
- [ ] 서비스 전용 SP 파일 작성
```

---

## § 4. 카테고리 코드

| 코드 | 영역 | 예시 서비스 |
|------|------|------------|
| `EMG` | 긴급·재난 | K-Emergency (911.hondi.net) |
| `JUS` | 사법·법률 | K-Law, K-Police, K-Security |
| `MED` | 의료·보건 | K-Health |
| `EDU` | 교육·연구 | K-School |
| `ECO` | 금융·경제 | GDC, K-Stock, K-Insurance, K-Tax |
| `MKT` | 시장·거래 | K-Market |
| `TRN` | 교통·물류 | K-Traffic, K-Logistics |
| `ENV` | 환경·자원 | K-Clean |
| `GOV` | 정부행정 | K-Gov |
| `LEG` | 입법·정책 | K-Democracy |
| `SOC` | 사회·복지 | (예정) |
| `IOT` | IoT·사물 | (예정) |
| `DIRECT` | 고팡 직접 | gopang-direct |

---

## § 5. 인증 레벨

| 레벨 | 인증 방법 | 권장 서비스 유형 |
|------|----------|----------------|
| `L0` | 기기 자동 인식 | 일반 조회, AI 상담 |
| `L1` | L0 + 얼굴 인증 | 신고 접수, 법률 자문 |
| `L2` | L1 + 지문(WebAuthn) | 진료 기록, 금융 거래 |
| `L3` | L2 + 4단어 시드 | 계정 복원, 최고 보안 |

---

## § 6. 우선순위 (priority)

낮은 숫자가 높은 우선순위입니다.  
동일 입력에 여러 서비스가 매칭될 때 priority가 낮은 서비스가 선택됩니다.

| priority | 용도 |
|----------|------|
| `0` | EMG 전용 (긴급·재난) — 항상 최우선 |
| `1` | JUS (법률·경찰·보안) |
| `2` | MED (의료) |
| `3` | EDU (교육) |
| `4` | ECO (금융·경제) |
| `5` | MKT (시장) |
| `6` | TRN (교통·물류) |
| `7` | ENV (환경) |
| `8` | GOV (정부행정) |
| `9` | LEG (입법·정책) |
| `10+` | 기타 신규 서비스 |

---

## § 7. 트리거 키워드 작성 가이드

### 좋은 트리거

```javascript
triggers: [
  // ✅ 구체적인 동사·명사
  '농업 자문', '작물 병충해', '스마트팜 설치',
  // ✅ 사용자가 실제 말하는 표현
  '농사 어떻게', '벼가 누렇게', '비료 얼마나',
  // ✅ 동의어 포함
  '재배', '경작', '농지', '밭', '논',
]
```

### 나쁜 트리거

```javascript
triggers: [
  // ❌ 너무 일반적 (다른 서비스와 충돌)
  '도움', '알려줘', '어떻게',
  // ❌ 너무 드문 표현
  '지력 증진 기술 체계',
  // ❌ 중복 (이미 다른 서비스가 사용)
  '긴급', '병원', '소송',
]
```

### 권장 수량

- 최소: **10개** (매칭 정확도 보장)
- 권장: **20~40개**
- 최대: 제한 없음

---

## § 8. GWP 파라미터 활용

고팡 앱이 하위 서비스를 호출할 때 URL 파라미터를 전달합니다.

```
https://farm.hondi.net/webapp.html
  ?gwp=1                          ← GWP 호출 표시
  &gwp_token=HMAC-SHA256-TOKEN    ← 인증 토큰
  &svc=kfarm                      ← 서비스 ID
  &ctx=벼%20병충해%20진단해줘     ← 사용자 입력 원문
  &return=https://hondi.net      ← 복귀 URL
```

하위 서비스에서 파라미터 파싱:

```javascript
const params  = new URLSearchParams(location.search);
const isGWP   = params.get('gwp') === '1';
const ctx     = params.get('ctx');     // 사용자 원문 입력
const returnTo = params.get('return'); // 복귀 URL

// GWP 호출이면 ctx를 초기 입력으로 활용
if (isGWP && ctx) {
  processUserInput(decodeURIComponent(ctx));
}

// 고팡으로 복귀 버튼
document.getElementById('back-btn').href = returnTo || 'https://hondi.net';
```

---

## § 9. 도메인 설정

고팡 하위 시스템은 `*.hondi.net` 서브도메인을 사용합니다.  
도메인 설정은 `dev@hondi.net`으로 요청하십시오.

### GitHub Pages 배포 기준

```
DNS CNAME: your-service.hondi.net → openhash-gopang.github.io
저장소: Openhash-Gopang/your-service (Public)
```

### CORS 허용

`gopang-proxy`의 `ALLOWED_ORIGINS`에 자동 포함되는 패턴:

```javascript
// *.hondi.net 서브도메인은 자동 허용
/^https:\/\/[a-z0-9-]+\.gopang\.net$/
```

별도 도메인(예: `fiil.kr`)은 `dev@hondi.net`으로 허용 요청.

---

## § 10. 테스트 체크리스트

등록 전 다음 항목을 반드시 확인합니다.

```
T1 □ gwp-registry.js 항목 추가 및 문법 오류 없음
T2 □ 서비스 URL 접속 확인 (https 필수)
T3 □ subsystem-auth.js 로드 확인 (Console 오류 없음)
T4 □ _onGopangAuth(user) 호출 확인 (user.ipv6 수신)
T5 □ PDV /pdv/report 200 응답 확인
T6 □ Supabase pdv_log 저장 확인
T7 □ 고팡 앱에서 트리거 키워드 입력 → 자동 라우팅 확인
T8 □ GWP ctx 파라미터 수신 및 활용 확인
T9 □ 복귀 버튼 (→ 고팡) 동작 확인
```

---

## § 11. 승인 절차

| 단계 | 내용 | 소요 시간 |
|------|------|----------|
| PR 제출 | gwp-registry.js 수정 + SP 파일 | — |
| 자동 검증 | 필수 필드·URL 유효성·트리거 수 | 즉시 |
| 코드 리뷰 | AI City Inc. 팀 검토 | 3영업일 내 |
| 테스트 | T1~T9 체크리스트 공동 확인 | 1영업일 |
| 병합 | `main` 브랜치 merge | 즉시 |
| 라우팅 활성화 | 고팡 앱 자동 반영 | merge 후 즉시 |

---

## § 12. 자주 묻는 질문

**Q. 고팡 서브도메인 없이 외부 도메인으로 등록할 수 있나요?**  
A. 가능합니다. `dev@hondi.net`으로 도메인 허용 요청 후 등록하십시오. (예: `fiil.kr`)

**Q. triggers 키워드가 다른 서비스와 겹쳐도 되나요?**  
A. 됩니다. 라우터는 매칭 수와 priority로 최적 서비스를 선택합니다.

**Q. 서비스를 비활성화하고 싶으면?**  
A. `gwp-registry.js`에서 해당 항목을 제거하는 PR을 제출하십시오.

**Q. PDV 기록이 필수인가요?**  
A. 필수는 아니지만 강력히 권장합니다. `pdv: false`로 설정하면 PDV 없이도 운영 가능합니다.

**Q. 신규 카테고리가 필요하면?**  
A. `dev@hondi.net`으로 제안하십시오. DAWN 투표를 통해 추가됩니다.

---

## § 13. 연락처

| 용도 | 연락처 |
|------|--------|
| 등록 문의 | dev@hondi.net |
| 법률·컴플라이언스 | legal@hondi.net |
| 일반 문의 | hello@hondi.net |
| 긴급 보안 | security@hondi.net |
| GitHub Issues | github.com/Openhash-Gopang/gopang_v2/issues |

---

*© 2026 AI City Inc. · DAWN: Democracy is All We Need*  
*고팡은 참여하는 시민들이 스스로 통치하는 디지털 민주주의입니다.*
