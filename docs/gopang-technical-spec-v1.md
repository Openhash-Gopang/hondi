# Gopang Technical Specification v1.0
**작성** AI City Inc. 팀 주피터 | 2026-06-11  
**작성자** Claude Sonnet 4.6 (대화 분석 기반)

---

## 1. 시스템 개요

**플랫폼명** 고팡 (Gopang)  
**운영조직** AI City Inc. / 팀 주피터  
**파일럿** 제주도 한림읍  
**철학** DAWN — Democracy is All We Need

### 1.1 아키텍처 원칙 (6개, 변경 불가)

| # | 원칙 |
|---|---|
| P1 | 고팡이 허브, 하위 시스템은 스포크. 시스템 간 직접 교신 없음 |
| P2 | PDV는 고팡 Worker만 직접 기록·조회. 하위 시스템은 `/pdv/report` 경유 필수 |
| P3 | 모든 PDV 기록은 6하 원칙(who/when/where/what/how/why) 필수 |
| P4 | OpenHash 앵커링은 고팡 Worker의 단독 책임 |
| P5 | 다중 시스템 세션에서 PDV 보고는 최하위 이행 시스템 1회만. session_id로 중복 방지 |
| P6 | 재무제표 갱신 권한은 사용자 본인에게만 있음 |

---

## 2. 인프라

### 2.1 도메인 및 저장소

| 서비스 | 도메인 | GitHub 저장소 | 로컬 경로 |
|---|---|---|---|
| 고팡 메인 | hondi.net | Openhash-Gopang/gopang | C:\Users\주피터\Downloads\gopang\ |
| K-Market | market.hondi.net | Openhash-Gopang/market | C:\Users\주피터\Downloads\market\ |
| 사용자 프로필 | users.hondi.net | Openhash-Gopang/users | C:\Users\주피터\Downloads\users\ |

**배포** GitHub Pages — 모든 서브도메인 → CNAME → openhash-gopang.github.io  
**DNS** Cloudflare 관리  
**l1-hanlim.hondi.net** → A → 168.110.123.175 (DNS only, Cloudflare 프록시 없음)

### 2.2 백엔드 서비스

| 서비스 | 주소 | 버전/용도 |
|---|---|---|
| Cloudflare Worker | gopang-proxy.tensor-city.workers.dev | v4.9, API 프록시 |
| Supabase | ebbecjfrwaswbdybbgiu.supabase.co | 주 DB (anon key 사용) |
| L1 노드 (PocketBase) | l1-hanlim.hondi.net / 168.110.123.175:8091 | OpenHash L1 |
| Oracle Cloud VM | 168.110.123.175 Ubuntu 22.04 | L1 서버 |

### 2.3 L1 노드 구성

```
위치:       /opt/gopang/
실행파일:   /opt/gopang/pocketbase
데이터:     /opt/gopang/pb_data/
훅:         /opt/gopang/pb_hooks/main.pb.js   ← 핵심 비즈니스 로직
설정:       /opt/gopang/config/
포트:       8091 (0.0.0.0 바인딩)
nginx:      443 → 8091 리버스 프록시
SSL:        Let's Encrypt (l1-hanlim.hondi.net)
NODE_ID:    KR-JEJU-JEJU-HANLIM
Admin:      tensor.city@gmail.com / automatic25
```

**SSH 접속:**
```bash
ssh -i "C:\Users\주피터\Downloads\gopang-l1.key" ubuntu@168.110.123.175
```

**Admin 토큰 발급 (5분 유효):**
```bash
curl -X POST http://127.0.0.1:8091/api/admins/auth-with-password \
  -H "Content-Type: application/json" \
  -d '{"identity":"tensor.city@gmail.com","password":"automatic25"}'
```

**컬렉션 조회 (& 반드시 따옴표로 감싸야 함):**
```bash
curl "http://127.0.0.1:8091/api/collections/blocks/records?sort=-height&perPage=1" \
  -H "Authorization: Bearer {token}"
```

---

## 3. 핵심 파일 구조

### 3.1 gopang 저장소

```
gopang/
├── webapp.html          # 모바일 채팅 UI (phone frame)
├── desktop.html         # 데스크탑 마케팅 페이지 (Supabase 디자인 시스템)
├── desktop_.html        # 구버전 백업
├── gopang-app.js        # 앱 코어 — IIFE(async () => { ... })()로 감싸져 있음
│                        # CFG, history, _USER 등 모든 변수가 클로저 내부
│                        # 콘솔에서 직접 접근 불가
├── gopang-wallet.js     # Ed25519 지갑
├── gopang-style.css
├── gwp-registry.js      # GWP 서비스 레지스트리 (전역 노출: window.GWP_REGISTRY 등)
├── sw.js                # Service Worker: Network First + Cache Fallback
│                        # CACHE_NAME='gopang-v4', CACHE_TIMEOUT=5000ms
│                        # PRECACHE_URLS에 /gwp-registry.js 포함
│                        # 외부 API(supabase, workers.dev)는 캐시 안 함
│                        # "[SW] 캐시 폴백" 로그 = 네트워크 실패 시만 발생
├── config.js
├── worker.js            # Cloudflare Worker 로컬 사본 (실제 배포는 대시보드)
├── manifest.json
├── index.html
├── auth/
│   ├── gopang-sso.js
│   ├── silent-auth.html
│   └── subsystem-auth.js    # 하위 시스템 인증 (one-line 패턴)
├── prompts/
│   ├── SP-00-ROUTER-LATEST.txt   # 포인터 파일 (반드시 파일명 1줄만 기재)
│   ├── SP-00-ROUTER-v3.0.txt
│   ├── SP-00-ROUTER-v3.1.txt
│   ├── SP-00-ROUTER-v3_2.txt
│   ├── SP-00-ROUTER-v4_0.txt
│   ├── SP-00-ROUTER-v4_1.txt    # 현재 LATEST 포인터 대상 (5502 chars)
│   └── SP-01_klaw_v1.0.txt ~ SP-14_kinsurance_v1.0.txt  # 하위 시스템 SP들
├── src/
│   ├── app.js             # 플러그인 부트스트랩 (6단계 BOOT)
│   ├── shell-ui.js
│   ├── ai-secretary/      # AI 비서 파이프라인 (phase0~phase6, pipeline.js)
│   ├── auth/
│   │   └── gopang-auth.js
│   ├── core/              # plugin-registry.js, plugin-interface.js 등
│   ├── domains/
│   │   ├── k-law/         # K-Law 플러그인 (index.js, classifier.js 등)
│   │   └── k-health/      # K-Health 플러그인
│   ├── gdc/               # GDC 토크노믹스
│   ├── openhash/          # hashChain.js, transactionPipeline.js 등
│   ├── pdv/               # vault.js, keyManager.js
│   └── pwa/
│       └── gopang-pwa.js
└── report/
    └── gopang-report.js
```

**부팅 순서 (브라우저 콘솔 로그 기준)**:
```
[BOOT] 1/6 코어 초기화 (plugin-registry.js)
[BOOT] 2/6 PDV + OpenHash 준비
[BOOT] 3/6 도메인 플러그인 등록 (K-Law v1.0.0, K-Health v1.0.0)
[BOOT] 4/6 AI 비서 파이프라인 준비
[BOOT] 5/6 Network + GDC + Privacy 준비
[BOOT] 6/6 Shell UI 렌더링
[BOOT] 부트스트랩 완료 — 플러그인 2개 활성화
```

### 3.2 market 저장소

```
market/
├── webapp.html          # K-Market AI 채팅 앱
└── prompts/
    └── SP-KMARKET-v2_4.txt   # GitHub raw 동적 로드
```

### 3.3 users 저장소

```
users/
└── profile.html         # 업체 프로필 + 메뉴 주문 + GWP 결제
```

---

## 4. AI 아키텍처

### 4.1 SP-00 (고팡 메인 AI) — 중요: 실제 파일 없음

- **명칭** "SP-00 v10.0"
- **실체** `gopang-app.js` 내 `CFG.system` 필드에 하드코딩된 문자열
- **GitHub에 별도 파일 없음** — 버전 관리 안 됨
- **역할** 사용자 입력 → `[GWP:서비스ID]` 태그 출력 → 하위 시스템 새 탭 오픈
- **코드베이스 전반에 "SP-00 v10.0"이 인용되는 이유**: 과거 리팩토링 잔재. 원래는 GitHub에서 동적 로드하는 구조였으나 하드코딩으로 전환되면서 주석만 남음

**gopang-app.js와 src/app.js 플러그인 아키텍처 병존**:
- `src/app.js` BOOT 과정에서 K-Law, K-Health 플러그인을 `src/domains/`에서 로드
- `gopang-app.js`의 `callAI()`는 `CFG.system` 기반으로 **독립적으로 동작**
- 두 아키텍처의 통합 방식은 미확인 — 추가 조사 필요

### 4.2 SP-00의 system prompt 오염 문제 (해결됨)

**원인**: `saveSettings()`가 `CFG.system`을 `localStorage.gopang_cfg.system`에 저장하고, `loadSettings()`가 매 로드 시 이를 복원하여 K-Clean 등 전문가 SP로 오염됨

**해결**: `gopang-app.js` 3곳 수정
```javascript
// 1) CFG에 system_base 추가
const CFG = {
  system: `...SP-00 하드코딩...`,
  system_base: null,   // ← 추가
};

// 2) callAI() 진입 시 최초 1회 백업 후 매 호출마다 복원
if (!CFG.system_base) CFG.system_base = CFG.system;
CFG.system = CFG.system_base;

// 3) loadSettings()에서 system 복원 제거
// if (saved.system) CFG.system = saved.system;  ← 삭제

// 4) saveSettings()에서 system 저장 제거
// system: CFG.system,  ← 삭제
```

**기존 오염 제거 (1회):**
```javascript
const cfg = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
delete cfg.system;
localStorage.setItem('gopang_cfg', JSON.stringify(cfg));
location.reload();
```

### 4.3 callAI() 라우팅 구조

```
sendMessage()
  → gwpMatch(text)  ← gwp=1 모드에서는 건너뜀 (재귀 방지)
  → callAI(text)
      → LLM 호출 (SP-00)
      → fullReply에서 [GWP:id] 태그 감지
      → getService(svcId) → _gwpLaunch(svcDef)
```

**중요**: `runRouter()`는 정의되어 있지만 `sendMessage()`에서 호출되지 않음. 주석에 "runRouter 제거 — LLM 1회 호출로 통합"이라고 명시됨.

### 4.4 SP-00-ROUTER

- **포인터 파일** `prompts/SP-00-ROUTER-LATEST.txt` — 반드시 파일명 1줄만 기재 (SP 본문 전체가 들어가면 안 됨)
- **현재 버전** `SP-00-ROUTER-v4_1.txt`
- **로드 방식**: `_loadRouterPrompt()` → 포인터 파일 읽기 → 실제 SP 파일 fetch
- **폴백**: SP-00-ROUTER-v3.0.txt → 내장 최소 프롬프트
- **모델** deepseek-v4-flash

**⚠️ v3.2 vs v4.1 아키텍처 불일치 — 미해결**:

| 항목 | v3.2 방식 | v4.1 방식 |
|---|---|---|
| 출력 | `[GWP:서비스ID]` 태그 (텍스트 내 포함) | JSON only |
| LLM 역할 | AI 비서 + 라우터 통합 | 순수 라우터 |
| gopang-app.js 연동 | `fullReply.match(/\[GWP:([\w-]+)\]/)` | `runRouter()` 별도 호출 |
| **현재 실제 동작** | **v3.2 방식으로 동작 중** | runRouter() 미호출 |

**결론**: `callAI()`는 `[GWP:서비스ID]` 태그 감지 방식(v3.2)으로 동작.  
LATEST가 v4.1(JSON 방식)을 가리키지만 `runRouter()`가 호출되지 않아 **v4.1은 사실상 미사용**.  
두 아키텍처 중 하나로 통일 필요.

### 4.5 K-Market SP 로드

```javascript
// GitHub raw URL 동적 로드 (캐시 버스터 포함)
const SP_URL = 'https://raw.githubusercontent.com/Openhash-Gopang/market/main/prompts/SP-KMARKET-v2_4.txt';
fetch(SP_URL + '?t=' + Date.now())
```

### 4.6 KV Cache 최적화

| 저장소 | 상태 |
|---|---|
| gopang-app.js | ✅ 절감율 96% 확인 |
| market/webapp.html | ✅ 수정 완료 |
| users/profile.html | ✅ AI 호출 없음 — 해당 없음 |

---

## 5. GWP (Gopang Widget Protocol)

### 5.1 gwp-registry.js

**전역 노출**:
```javascript
window.GWP_REGISTRY  = GWP_REGISTRY;   // 16개 서비스 배열
window.gwpMatch      = matchService;   // ← 실제 함수명은 matchService
window.matchService  = matchService;
window.getService    = getService;     // id로 단건 조회
window.getByCategory = getByCategory;
```

**중요**: `gopang-app.js`는 `getService(svcId)`, market `webapp.html`은 `gwpMatch(text)` 호출.  
`gwpMatch`는 `matchService`의 alias임.

**16개 서비스 ID**:
```
kemergency, klaw, kpolice, ksecurity, khealth, kedu, kgdc, kfinance,
kinsurance, ktax, kcommerce, ktransport, klogistics, fiil-kcleaner, kgov, kdemocracy
```

### 5.2 K-Market 주문 전체 플로우

```
hondi.net (gopang-app.js)
  ├─ 사용자: "짜장면 두 그릇 주문해줘"
  ├─ SP-00: [GWP:kcommerce] 태그 출력
  ├─ callAI() → [GWP:kcommerce] 감지 → getService('kcommerce') → _gwpLaunch()
  └─ market.hondi.net/webapp.html?gwp=1&token=&origin=...&ctx={b64}&ctx_enc=b64 오픈

market.hondi.net (webapp.html)
  ├─ gwp=1 감지 → ctx b64 디코딩 → 입력창 주입 → setTimeout(sendMessage, 100)
  ├─ sendMessage() → gwp=1이면 gwpMatch 건너뜀 → callAI()
  ├─ SP-KMARKET: [SEARCH]{"keyword":"짜장면","occupation":"중식","address":""} 출력
  ├─ SEARCH 태그 감지 → /search RPC → search_entities
  │   ├─ p_address: null (GPS 좌표 우선), p_lat/p_lng 사용
  │   └─ 결과: 금능반점 1건
  ├─ AI 재호출 → [OPEN_PROFILE:{"handle":"@geumneung","guid":"dummy-hanlim-003"}] 출력
  ├─ OPEN_PROFILE 태그 감지
  └─ users.hondi.net/profile.html?gwp=1&guid=dummy-hanlim-003&opener_origin=https://market.hondi.net 팝업

users.hondi.net (profile.html)
  ├─ /biz/profile/{guid} → Worker → Supabase user_profiles 조회
  ├─ 메뉴 표시 (extra.menu) → 사용자 선택 → [주문하기]
  ├─ GWP_SIGN_REQUEST → window.opener(market), targetOrigin=OPENER_ORIGIN
  │
market.hondi.net
  ├─ GWP_SIGN_REQUEST 수신 → window.opener(gopang), targetOrigin='https://hondi.net'
  │   (핸들러 중복 방지: _gwpSignResponseHandler 전역 플래그)
  │
hondi.net (gopang-app.js)
  ├─ GWP_SIGN_REQUEST 수신 → 서명 확인 UI 표시
  ├─ 사용자: [서명하여 결제] 클릭
  ├─ _gwpSignExecute() → window.gopangWallet.sign(tx) → Ed25519 서명
  ├─ GWP_SIGN_RESPONSE → sourceWin(market).postMessage
  │
market.hondi.net
  ├─ GWP_SIGN_RESPONSE 수신 → profileSource.postMessage → profile
  │
users.hondi.net (profile.html)
  ├─ GWP_SIGN_RESPONSE 수신
  ├─ /biz/order POST → Worker
  │   body: { tx, tx_hash, buyer_sig, buyer_public_key, from_guid,
  │           seller_guid, l1_node, prev_settle_hash, balance_claimed, outputs }
  │
Worker (/biz/order)
  ├─ L1 /api/tx POST
  └─ L1 응답 → fs_ledger RPC → PDV 기록 → 클라이언트 반환

users.hondi.net
  ├─ result.ok → GWP_DONE → window.opener(market)
  │
market.hondi.net
  └─ GWP_DONE → window.opener(gopang)
```

### 5.3 GWP 메시지 포워딩 구조

```
profile (users) → GWP_SIGN_REQUEST → window.opener (market)
market          → GWP_SIGN_REQUEST → window.opener (gopang)
gopang          → GWP_SIGN_RESPONSE → sourceWin (market)
market          → GWP_SIGN_RESPONSE → profileSource (profile)
profile         → GWP_DONE → window.opener (market)
market          → GWP_DONE → window.opener (gopang)
```

### 5.4 OPEN_PROFILE URL 파라미터

```
https://users.hondi.net/profile.html
  ?gwp=1
  &guid={primary_guid}
  &opener_origin={market.hondi.net URL encoded}
```

**주의**: `params` 선언이 반드시 `OPENER_ORIGIN` 선언보다 앞에 있어야 함 (TDZ 오류 방지)

---

## 6. OpenHash / L1 노드

### 6.1 /api/tx 4단계 검증 파이프라인 (main.pb.js)

```javascript
// 1단계: 서명 형식 검증
if (!/^[0-9a-f]{64}$/.test(tx_hash)) → INVALID_SIGNATURE

// 2단계: 공개키 등록 확인
gdc_keys 컬렉션에서 buyer_public_key 조회
→ 없으면: UNREGISTERED_KEY (403)

// 3단계: prev_settle_hash 검증
blocks 컬렉션에서 buyer_guid 기준 최신 블록 조회
→ 블록 있음: prev_settle_hash !== latestBlock.content_hash → STALE_STATE (409)
→ 이중지불: 동일 prev_settle_hash 블록 이미 존재 → STALE_STATE (409)
→ 블록 없음 (첫 거래): balance_claimed <= 0 → INSUFFICIENT_BALANCE

// 4단계: 잔액 확인
balance_claimed < sum(outputs.amount) → INSUFFICIENT_BALANCE
```

### 6.2 블록 생성

```javascript
contentHash = sha256hex(tx_hash + buyer_sig + prevBlockHash)
// prevBlockHash: 이전 블록의 content_hash, 첫 블록이면 "GENESIS"
```

**blocks 컬렉션 주요 필드**:
```
block_type, tx_hash, buyer_guid, seller_guid, buyer_sig,
outputs (JSON string), prev_block_hash, content_hash,
height, prev_settle_hash
```

### 6.3 prev_settle_hash 설계 — 핵심 이슈

**L1 기대값**: 이전 블록의 `content_hash` (블록체인 연속성)  
**wallet 원래 계산값**: `financialState` 객체의 SHA-256 ← **구조적 불일치**

```
financialState = { 'bs-cash': N, 'pl-purchase': N, 'pl-revenue': N }
computePrevSettleHash(fs) = SHA-256(sortedStringify(fs))
→ 이 값은 L1의 content_hash와 전혀 다름
```

**올바른 해결 방향 (방향 B — 구현 필요)**:
```
거래 성공
  → L1 응답: block_hash (= content_hash)
  → Worker → buyer_claim 포함 클라이언트 전달
  → gopang-app.js GWP_DONE 핸들러 → wallet.redeemClaim({block_hash, claims})
  → redeemClaim(): financial_state.block_hash = block_hash 자동 갱신
  → 다음 거래: buildPrevSettleHash() → block_hash 반환 → L1 통과
```

**현재 임시 조치**:
- `buildPrevSettleHash()`가 `financial_state.block_hash`를 우선 사용
- IndexedDB에 수동으로 최신 `content_hash` 기입 필요

**수동 동기화 명령 (콘솔)**:
```javascript
const req = indexedDB.open('gopang-wallet');
req.onsuccess = e => {
  const db = e.target.result;
  const tx = db.transaction('keys', 'readwrite');
  tx.objectStore('keys').put({
    state: { 'bs-cash': 1000000, 'pl-purchase': 0, 'pl-revenue': 0 },
    updatedAt: new Date().toISOString(),
    block_hash: '{L1_최신_content_hash}'
  }, 'financial_state');
  tx.oncomplete = () => console.log('✅');
};
```

### 6.4 Worker → L1 HTTP 오류 매핑

```javascript
const statusMap = {
  INVALID_SIGNATURE:    401,
  UNREGISTERED_KEY:     403,
  STALE_STATE:          409,
  INSUFFICIENT_BALANCE: 402,
  BLOCK_SAVE_FAILED:    500,
};
```

---

## 7. gopang-wallet.js 상세

### 7.1 IndexedDB 구조

**DB명**: `gopang-wallet`

| Store | keyPath | 용도 |
|---|---|---|
| `keys` | (out-of-line) | 키페어 + 재무상태 |
| `hash_chain` | `height` | 해시체인 이력 |

**keys store 주요 레코드**:

| key | value 구조 |
|---|---|
| `ed25519-main` | `{ publicKeyB64u, publicKeyHex, encPrivKey, createdAt }` |
| `financial_state` | `{ state: {'bs-cash':N, 'pl-purchase':N, 'pl-revenue':N}, updatedAt, block_hash }` |

**⚠️ 중요**: `getFinancialState()`는 `rec?.state`를 반환. `financial_state`를 직접 저장할 때 반드시 `{ state: {...}, ... }` 형태로 감싸야 함.

### 7.2 도메인 격리 문제

`hondi.net`과 `users.hondi.net`은 **도메인이 달라 IndexedDB가 완전히 분리**됨.  
- `hondi.net`의 `gopang-wallet` DB에 저장된 키: `ed25519-main`
- `users.hondi.net`에서 `gopang-wallet.js`가 로드되면 **별도 DB에 새 키 생성**

따라서 **서명은 반드시 hondi.net에서** 수행해야 함 (GWP_SIGN_REQUEST → GWP_SIGN_RESPONSE 경로).

### 7.3 주요 메서드

| 메서드 | 설명 |
|---|---|
| `GopangWallet.load(passphrase)` | IndexedDB `ed25519-main`에서 키 로드, 없으면 null |
| `GopangWallet.create()` | 새 키쌍 생성 + IndexedDB 저장 |
| `wallet.sign(rawTx)` | UTXO tx 빌드 + Ed25519 서명 반환 |
| `wallet.getFinancialState()` | `financial_state.state` 반환 (없으면 `{}`) |
| `wallet.getBalance()` | `fs['bs-cash']` 반환 |
| `wallet.buildPrevSettleHash()` | `block_hash` 우선, 없으면 fs 해시 |
| `wallet.redeemClaim({block_hash, claims})` | 청구권 적용 + financial_state 갱신 |
| `wallet.setFinancialState(newState)` | `{ state: newState, updatedAt, block_hash: null }` 저장 |
| `wallet.setIdentity({guid, handle})` | `this.guid` 설정 (sign()에 필요) |
| `GopangWallet.computePrevSettleHash(fs)` | 정적 메서드, fs 객체 → SHA-256 hex |

### 7.4 sign() 내부 흐름

```
sign(rawTx)
  ① buildPrevSettleHash()
      → idbGet(db, 'financial_state') → rec.block_hash 있으면 반환
      → 없으면 computePrevSettleHash(financialState)
  ② buildTxWithPrevHash({buyerGuid, sellerGuid, financialState, items, ...})
      → tx.input.prev_settle_hash = prevSettleHash
      → tx.input.balance_claimed = financialState['bs-cash']
      → tx.input.owner_guid = buyerGuid
  ③ signTx(privKey, tx) → { tx_hash, buyer_sig }
  ④ return { tx, tx_hash, buyer_sig, buyer_public_key, prev_settle_hash }
```

**⚠️ 중요**: `wallet.sign()` 호출 전 `wallet.setIdentity({guid})` 가 먼저 호출되어야 함.  
guid 없으면 `'[Wallet] guid(IPv6)가 설정되지 않았습니다.'` 에러.

### 7.5 콘솔 디버깅

```javascript
// hondi.net 콘솔 — gopangWallet 공개 속성만 접근 가능
Object.keys(window.gopangWallet)
// ['_pubKey', '_privKey', 'publicKeyB64u', 'publicKeyHex', 'handle', 'guid']

// 잔액 확인
const fs = await window.gopangWallet.getFinancialState();
console.log(fs);

// prev_settle_hash 계산 확인
const { prevSettleHash } = await window.gopangWallet.buildPrevSettleHash();
console.log(prevSettleHash);

// CFG, history 등은 IIFE 클로저 내부 → 콘솔 직접 접근 불가
// window.gopangWallet, window.GWP_REGISTRY, window.gwpMatch 등 전역 노출 변수만 접근 가능
```

---

## 8. Supabase 스키마

### 8.1 주요 테이블

| 테이블 | 주요 컬럼 | 용도 |
|---|---|---|
| user_profiles | guid, primary_guid, current_ipv6, handle, nickname, entity_type, name, address, occupation, services, extra, public_key, l1_node | 사용자/업체 프로필 |
| fs_ledger | tx_id, guid, buyer_guid, seller_guid, direction, amount, fs_account, prev_settle_hash, block_hash, block_id | 거래 원장 |
| pdv_log | id, guid, source, type, report_id, summary, summary_6w, openhash_anchored, block_hash, reporter_svc | PDV 기록 |
| biz_orders | - | 주문 기록 |
| gdc_keys | guid, public_key | Ed25519 공개키 등록 |
| gdc_deposits | account_id, user_guid, product_type, principal | 예금 |
| biz_products | seller_guid, name, price_krw, is_active | 상품 |
| biz_reviews | reviewer_guid, seller_guid, rating, body | 리뷰 |

**잔액 저장 위치**: `fs_ledger`는 거래 내역만 있고 잔액 컬럼 없음. 잔액은 **wallet IndexedDB `financial_state.state['bs-cash']`** 에만 존재.

### 8.2 주요 RPC

```sql
-- 업체 검색
search_entities(
  p_keyword, p_occupation, p_address,
  p_entity_type, p_limit, p_offset, p_lang_code,
  p_sort, p_trust_min, p_gdc_only, p_exclude_guid,
  p_handle, p_nickname, p_primary_guid,
  p_l1_node, p_l2_node, p_l3_node,
  p_lat, p_lng   ← GPS 좌표 기반 검색 (주소보다 신뢰성 높음)
)

-- 거래 기록
-- ⚠️ 2026-07-07 폐기: GDC 잔액/거래 원장 역할을 L1 PocketBase(blocks
-- 컬렉션 재생, main.pb.js computeBalance())로 완전히 이관했다. worker.js는
-- 더 이상 이 RPC를 호출하지 않는다 — 아래 시그니처는 과거 기록용으로만
-- 남긴다. 새로 이 흐름을 볼 사람은 /opt/gopang/pb_hooks/main.pb.js의
-- /api/tx, /api/mint를 참고할 것.
market_purchase(
  p_tx_id, p_buyer_guid, p_seller_guid,
  p_item_name, p_item_id, p_quantity,
  p_total, p_seller_net, p_fee,
  p_prev_settle_hash, p_block_hash, p_block_id, p_memo
)
```

### 8.3 Supabase REST API 주의사항

- **IPv6 URL 인코딩**: `?guid=eq.2601:db80:...` → 콜론이 URL에서 문제 발생. `encodeURIComponent()` 필요
- **400 오류 원인**: 잘못된 파라미터명 (`bs_cash` 대신 정확한 컬럼명 필요)
- **PowerShell PATCH**: `-Uri` URL에 IPv6 포함 시 400 오류 → SQL Editor 직접 사용 권장

---

## 9. Cloudflare Worker v4.9

### 9.1 ALLOWED_ORIGINS

```javascript
[
  'https://hondi.net', 'https://www.hondi.net',
  'https://klaw.hondi.net', 'https://market.hondi.net',
  'https://tax.hondi.net', 'https://gdc.hondi.net',
  'https://health.hondi.net', 'https://school.hondi.net',
  'https://public.hondi.net', 'https://security.hondi.net',
  'https://democracy.hondi.net', 'https://police.hondi.net',
  'https://insurance.hondi.net', 'https://911.hondi.net',
  'https://stock.hondi.net', 'https://traffic.hondi.net',
  'https://logistics.hondi.net', 'https://users.hondi.net',
  'https://l1-hanlim.hondi.net', 'https://fiil.kr',
  'https://openhash.kr', 'https://nounweb.github.io',
  'http://localhost', 'http://127.0.0.1',
]
```

### 9.2 주요 엔드포인트

| 엔드포인트 | 메서드 | 설명 |
|---|---|---|
| /chat/completions | POST | DeepSeek 스트리밍 프록시 |
| /deepseek | POST | DeepSeek 프록시 (alias) |
| /geocode | GET | Kakao coord2address (lat, lng 파라미터) |
| /search | POST | search_entities RPC 경유 |
| /biz/profile/{handle_or_guid} | GET | 업체 프로필 (handle→nickname→guid 순 폴백) |
| /biz/order | POST | 주문 (L1 위임) |
| /biz/review | POST | 리뷰 등록 |
| /biz/product | POST | 상품 관리 |
| /pdv/report | POST | PDV 기록 |
| /pdv/query | POST | PDV 조회 (동의 필요) |
| /auth/issue | POST | SSO 토큰 발급 |
| /auth/verify | POST | SSO 토큰 검증 |

### 9.3 /biz/order 요청 body

```javascript
{
  tx,                  // UTXO tx 객체
  tx_hash,             // 64자리 hex
  buyer_sig,           // Ed25519 서명 (base64url)
  buyer_public_key,    // Ed25519 공개키 (base64url)
  from_guid,           // 구매자 IPv6
  seller_guid,         // 판매자 primary_guid
  l1_node,             // 'KR-JEJU-JEJU-HANLIM'
  prev_settle_hash,    // 이전 블록 content_hash
  balance_claimed,     // 구매자 선언 잔액
  outputs,             // [{recipient_guid, amount}, ...]
  item_name, quantity, memo,
  seller_net, fee,
  session_id, reporter_svc,
}
```

### 9.4 서비스 레지스트리 (Worker 내부)

```javascript
REGISTERED_SERVICES = {
  'market': { level:3, domain:'market.hondi.net', pdv:true },
  'klaw':   { level:3, domain:'klaw.hondi.net',   pdv:true },
  'users':  { level:3, domain:'users.hondi.net',  pdv:false },
  // ... 등 16개
}
```

`users.hondi.net`은 `pdv:false` → PDV 보고 불가.

---

## 10. Kakao 역지오코딩 구조

```javascript
// coord2address 응답 구조
addr = geo.documents?.[0]?.address || geo.documents?.[0]?.road_address || {}
userAddress = {
  dong:    addr.region_3depth_name || addr.region_3depth_h_name || '',
  sigungu: addr.region_2depth_name || '',   // 예: "제주시" (한림읍 포함 안 됨)
  sido:    addr.region_1depth_name || '',
  full:    [sido, sigungu, dong].filter(Boolean).join(' '),
}
```

**⚠️ 주의**: `region_2depth_name`은 시/군 단위 (`제주시`). 읍/면은 `region_3depth_name`에 들어오지 않을 수 있음. `dong`이 비어 있는 경우 `sigungu`만 반환되어 검색 0건 발생.

**해결**: `p_address=null`로 설정하고 `p_lat/p_lng` GPS 좌표만 사용.

---

## 11. 보안 에이전트

**subsystem-auth.js**: 모든 하위 시스템에 one-line으로 추가 (`<script src="...subsystem-auth.js">`)  
**security-agent.js**: 하위 시스템 로드 시 자동으로 K-Security 에이전트 시작  
```
[K-Security Agent:market] 시작 — market.hondi.net — 접검 간격 86400s
```

---

## 12. 테스트 환경 (파일럿 데이터)

### 12.1 테스트 사용자

| 항목 | 값 |
|---|---|
| IPv6 | 2601:db80:bd05:abfe:cf29:fc7f:f5a8:4e5b |
| 공개키 (L1 등록, PB record_id: 84hbfyjjcujhwe5) | JXTgyqqY28hriCfhulPNjBbye4vp1i7II-_faaLX7t8 |
| 공개키 (IndexedDB ed25519-main) | JXTgyqqY28hriCfhulPNjBbye4vp1i7II-_faaLX7t8 |
| 잔액 (bs-cash, IndexedDB) | 1,000,000 |
| L1 최신 블록 height | 1 |
| L1 최신 content_hash | 4a676070a715c09cef682a445e77f8486defcb79e5fe7d3986a4ab2e5f386237 |
| financial_state.block_hash | 4a676070a715c09cef682a445e77f8486defcb79e5fe7d3986a4ab2e5f386237 |

### 12.2 테스트 업체

| 항목 | 값 |
|---|---|
| primary_guid | dummy-hanlim-003 |
| name | 금능반점 |
| handle | @geumneung |
| rating | ★4.5 |
| GDC | ✅ |
| trust_level | L1 |
| 메뉴 | 짜장면 ₩6,000 / 짜장밥 ₩6,000 / 간짜장 ₩7,000 |

---

## 13. 환경 상수

```
SUPABASE_URL  = https://ebbecjfrwaswbdybbgiu.supabase.co
SUPABASE_KEY  = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA
WORKER_URL    = https://gopang-proxy.tensor-city.workers.dev
L1_URL        = https://l1-hanlim.hondi.net
L1_LOCAL      = http://168.110.123.175:8091
L1_NODE_ID    = KR-JEJU-JEJU-HANLIM
DEEPSEEK_MODEL = deepseek-v4-flash (기본), deepseek-chat (V3)
```

---

## 14. 이번 대화에서 발견된 오류 전체 목록

### 14.1 코드 버그 (수정 완료)

| # | 오류/증상 | 파일 | 원인 | 수정 방법 |
|---|---|---|---|---|
| B1 | 짜장면 주문 → K-Clean 응답 | gopang-app.js | saveSettings()가 K-Clean SP를 `localStorage.gopang_cfg.system`에 저장, loadSettings()가 매 로드 시 CFG.system 덮어씀 | system 저장/복원 제거, CFG.system_base 도입, callAI() 진입 시 복원 |
| B2 | `profile.html:363 Cannot access 'params' before initialization` | profile.html | OPENER_ORIGIN(363줄)이 params(369줄)보다 먼저 `params.get()` 호출 → TDZ ReferenceError | params 선언 블록을 OPENER_ORIGIN 선언 앞으로 이동 |
| B3 | K-Market AI 응답 없음 (Location 후 멈춤) | market/webapp.html | gwp=1로 열린 K-Market이 sendMessage()→gwpMatch()→kcommerce 재매칭→gwpLaunch() 무한루프 | `_isGwpMode` 체크 추가: gwp=1이면 gwpMatch 건너뜀 |
| B4 | Market Search 결과 0건 | market/webapp.html | Kakao `region_2depth_name`이 "제주시"만 반환(읍 없음) → p_address LIKE 불일치 | p_address=null, p_lat/p_lng GPS 좌표만 사용 |
| B5 | wallet prev_settle_hash ≠ L1 content_hash | gopang-wallet.js | buildPrevSettleHash()가 financialState SHA-256 계산, L1은 블록 content_hash 기대 | financial_state.block_hash 우선 사용 (임시); 근본 해결: redeemClaim() 자동화 |
| B6 | SP-00 v10.0 실체 없음 ("존재하지 않는 문서") | gopang-app.js | 리팩토링 잔재. GitHub 별도 파일 없이 CFG.system 하드코딩 | 문서화 (수정 불필요) |
| B7 | runRouter() 정의되어 있으나 미호출 | gopang-app.js | sendMessage() 주석: "runRouter 제거 — LLM 1회 호출로 통합" | 문서화 (수정 불필요) |

### 14.2 환경/설정 오류 (운영 중 마주침)

| # | 오류/증상 | 위치 | 원인 | 해결 방법 |
|---|---|---|---|---|
| E1 | `[Router] 최신 버전 로드 실패, 폴백 사용: 포인터 내용 비정상` | hondi.net 콘솔 | SP-00-ROUTER-LATEST.txt에 SP 본문 전체가 들어있었음 | 파일 내용을 `SP-00-ROUTER-v4_1.txt` 1줄로 교체 후 push |
| E2 | `GWP_REGISTRY` 두 번 `undefined` (콘솔) | hondi.net 콘솔 | 캐시 삭제 직후 gwp-registry.js 재로드 전에 콘솔 확인 | 타이밍 문제, 실제 오류 아님. 세 번째 확인 시 'object' |
| E3 | `window.gopangWallet.getState is not a function` | hondi.net 콘솔 | getState() 메서드 없음. 올바른 API는 `getFinancialState()` | `await window.gopangWallet.getFinancialState()` 사용 |
| E4 | `IDBDatabase: One of the specified object stores was not found` (`financial` store) | hondi.net 콘솔 | 존재하지 않는 store 이름. 실제 store는 `keys`와 `hash_chain` 뿐 | `db.transaction('keys', ...)` 사용 |
| E5 | `financial_state` 저장 후 `getFinancialState()` 빈 객체 반환 | hondi.net 콘솔 | `store.put({bs-cash:...}, key)` → state 래퍼 없이 저장 → `rec?.state`가 undefined | `store.put({ state: {...}, updatedAt, block_hash }, 'financial_state')` 형태로 저장 |
| E6 | `/biz/order` 403 (처음 진단 시) | profile.html 콘솔 | worker.js 로컬 파일에 syntax error(outputs 중복 선언) 있었으나 Cloudflare 실제 배포본은 정상 | 로컬 파일과 Cloudflare 대시보드 불일치 확인. 실제 403 원인은 별도(공개키 불일치) |
| E7 | `/biz/order` 403 UNREGISTERED_KEY | profile.html 콘솔 | L1 gdc_keys에 등록된 키(`kvm4r_...`)와 wallet 실제 서명 키(`JXTgy...`)가 다름 | L1 gdc_keys PATCH: `public_key = IndexedDB ed25519-main.publicKeyB64u` |
| E8 | buyer_public_key 3개 키 불일치 | 진단 중 발견 | ① L1 등록: kvm4r_... ② hondi.net IDB ed25519-main: JXTgy... ③ users.hondi.net IDB 별도 키 | hondi.net IDB ed25519-main 키를 L1에 등록, users.hondi.net은 서명 안 함 |
| E9 | `/biz/order` 409 STALE_STATE | profile.html 콘솔 | `prev_settle_hash`(fs SHA-256)가 L1 최신 블록 content_hash와 불일치 | IndexedDB financial_state.block_hash를 L1 최신 content_hash로 수동 동기화 |
| E10 | Supabase PATCH 400 `bs_cash column not found` | PowerShell | `user_profiles` 테이블에 `bs_cash` 컬럼 없음. 잔액은 IndexedDB에만 존재 | SQL Editor에서 컬럼 구조 확인 후 올바른 테이블/컬럼 사용 |
| E11 | PowerShell Invoke-RestMethod 400 (IPv6 URL) | PowerShell | `-Uri`에 IPv6 콜론 포함 시 URL 파싱 오류 | Supabase SQL Editor 직접 사용 권장 |
| E12 | PocketBase curl `&` 백그라운드 실행 오류 | SSH 터미널 | URL의 `&`가 셸에서 백그라운드 프로세스로 해석됨 | URL을 따옴표로 감쌈: `curl "...?sort=...&perPage=1"` |
| E13 | PocketBase Admin API 403 `Only admins can perform this action` | SSH 터미널 | `Authorization: Admin password` 헤더 형식 오류 | 먼저 `/api/admins/auth-with-password`로 토큰 발급 후 `Bearer {token}` 사용 |
| E14 | `[GopangWallet] guid: 미연결` | market 콘솔 | market webapp SSO 완료 후 wallet.setIdentity() 미호출 | market webapp init()에서 SSO 완료 콜백에 wallet.setIdentity({guid, handle}) 추가 (미수정) |
| E15 | `openWebApp is not defined` desktop.html:709 | hondi.net 콘솔 | desktop.html에 openWebApp 함수 미정의 또는 미로드 | 일시적 오류로 재현 안 됨. 미수정 |
| E16 | `<meta name="apple-mobile-web-app-capable">` deprecated 경고 | market/profile 콘솔 | 구형 메타 태그 사용 | `<meta name="mobile-web-app-capable" content="yes">` 추가 권장 (비긴급) |
| E17 | `_recordPDV: _USER.guid undefined` | gopang-app.js | 신규 사용자는 guid 없이 ipv6만 있음 | `_USER.guid || _USER.ipv6` fallback 추가 (미수정) |

### 14.3 진단 오류 (Claude의 오진)

| # | 잘못된 진단 | 실제 원인 | 교훈 |
|---|---|---|---|
| M1 | Market Search 0건 → 주소 파싱 문제로 진단 → p_address 수정 | 실제 원인은 GWP 재귀(gwpMatch가 callAI 도달 전에 return) | 로그가 끊긴 위치 기준으로 함수 전체 경로를 위→아래로 읽어야 함 |
| M2 | GWP_REGISTRY undefined → 타이밍 문제로 진단 | 실제로는 콘솔 컨텍스트가 desktop.html이었음 | 콘솔 드롭다운에서 webapp.html iframe 컨텍스트 먼저 확인 |
| M3 | /biz/order 403 → worker.js syntax error로 진단 | 실제 Cloudflare 배포본은 정상. 원인은 공개키 불일치 | 로컬 파일과 실제 배포본 불일치 가능성 항상 고려 |

---

## 15. 미완성 항목 (다음 대화 우선순위)

| 우선순위 | 항목 | 설명 |
|---|---|---|
| 1 | **redeemClaim 자동 호출** | gopang-app.js GWP_DONE 핸들러에서 wallet.redeemClaim({block_hash, buyer_claim.claims}) 호출 → financial_state.block_hash 자동 갱신 → STALE_STATE 근본 해결 |
| 2 | T05 | fs_ledger 3행 확인, openhash_anchored 확인 |
| 3 | T06 | Hash Chain IndexedDB 검증 |
| 4 | T07 | 재무제표 갱신 |
| 5 | T08 | gdc_claims 청구권 |
| 6 | wallet guid 미연결 | market webapp SSO 완료 콜백에서 wallet.setIdentity() 호출 |
| 7 | desktop.html openWebApp 오류 | desktop.html:709 ReferenceError |
| 8 | _recordPDV guid fallback | _USER.guid undefined 시 _USER.ipv6 사용 |

---

## 16. 주요 교훈

1. **로그 기반 진단**: "어디서 로그가 끊기는가"를 기준으로 해당 함수의 전체 실행 경로를 위→아래로 읽어야 함. 선입견으로 엉뚱한 곳을 수정하는 실수 방지.

2. **사고 실험 필수**: 코드 수정 전 실제 데이터 흐름을 추적해야 함. 첫 번째 Market Search 진단에서 로그 `0건` 이후 멈춤으로 보고 주소 문제를 추정했으나, 실제 원인은 GWP 재귀였음.

3. **localStorage system 오염**: system prompt를 localStorage에 저장하면 세션 간 오염 발생 — 절대 저장 금지.

4. **GWP 재귀 패턴**: gwp=1로 열린 하위 시스템이 내부에서 gwpMatch를 실행하면 자기 자신을 재귀 호출. 모든 하위 시스템은 gwp=1 모드에서 gwpMatch 건너뛰어야 함.

5. **wallet 공개키 일치 필수**: L1 gdc_keys의 public_key는 hondi.net IndexedDB `ed25519-main.publicKeyB64u`와 정확히 일치해야 함. users.hondi.net이 별도 키를 생성하면 UNREGISTERED_KEY 오류.

6. **Supabase vs IndexedDB 잔액**: bs-cash 잔액은 Supabase에 없고 wallet IndexedDB에만 있음. Supabase는 거래 내역(fs_ledger)만 저장.

7. **IIFE 클로저**: gopang-app.js 전체가 `(async () => { ... })()`로 감싸져 있어 CFG, history, _USER 등 내부 변수는 브라우저 콘솔에서 직접 접근 불가. window.gopangWallet 등 명시적으로 전역 노출된 변수만 접근 가능.

8. **콘솔 컨텍스트 선택**: F12 → Console 드롭다운이 `top`이면 `GWP_REGISTRY === undefined`. 반드시 `webapp.html` iframe 컨텍스트로 전환 후 확인해야 함. `desktop.html`은 gwp-registry.js를 로드하지 않으므로 `undefined`가 정상.

---

## 17. 디버깅 체크리스트

### 17.1 GWP_REGISTRY 확인 절차

**반드시 webapp.html iframe 컨텍스트에서 확인해야 함.**

```
F12 → Console → 상단 드롭다운 'top' → 'hondi.net/webapp.html' 선택
location.href        // 'https://hondi.net/webapp.html' 확인
typeof GWP_REGISTRY  // 'object'
typeof getService    // 'function'
```

- `desktop.html` 컨텍스트: `GWP_REGISTRY === undefined` (정상 — gwp-registry.js 미로드)
- `webapp.html` 컨텍스트: `GWP_REGISTRY === 'object'` ✅

### 17.2 SP-00-ROUTER-LATEST.txt 점검

```powershell
cat prompts/SP-00-ROUTER-LATEST.txt
# 반드시 1줄만: SP-00-ROUTER-v4_1.txt
# SP 본문이 들어가면 "[Router] 포인터 내용 비정상" 오류
# → 라우팅 폴백 → K-Market 호출 안 됨
```

### 17.3 라우팅 오류 (짜장면 → K-Clean) 진단 순서

```
1. 콘솔 [Router] 로그: "프롬프트 로드 완료: SP-00-ROUTER-v4_1.txt" 확인
2. Network 탭 /chat/completions → request body "system" 필드
   → CFG.system 오염 여부 확인 (K-Clean 내용이면 오염)
3. Network 탭 /chat/completions → response content
   → LLM 실제 출력 태그 확인 ([GWP:kcommerce] 있어야 정상)
4. CFG.system이 K-Clean SP 내용이면:
```

```javascript
// webapp.html 컨텍스트 콘솔에서 실행
const cfg = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
delete cfg.system;
localStorage.setItem('gopang_cfg', JSON.stringify(cfg));
location.reload();
```

### 17.4 STALE_STATE 진단 순서

```
1. L1 최신 블록 content_hash 확인 (SSH → PocketBase API)
2. wallet financial_state.block_hash 확인:
```
```javascript
const req = indexedDB.open('gopang-wallet');
req.onsuccess = e => {
  const db = e.target.result;
  db.transaction('keys').objectStore('keys').get('financial_state')
    .onsuccess = e => console.log(e.target.result);
};
```
```
3. 두 값 불일치 → 수동 동기화 (Section 6.3 참조)
4. 근본 해결: GWP_DONE 핸들러에서 wallet.redeemClaim() 자동 호출 구현
```

### 17.5 /biz/order 403 원인 구분

```
403 반환 시:
├─ Worker CORS 차단: response body 없음, Network 탭 "Blocked" 표시
│   → ALLOWED_ORIGINS에 origin 추가 필요
├─ L1 UNREGISTERED_KEY: {"ok":false,"error":"UNREGISTERED_KEY"}
│   → L1 gdc_keys에 buyer_public_key 등록 필요
│   → hondi.net IndexedDB ed25519-main.publicKeyB64u 확인 후 PB에 PATCH
└─ L1 기타: L1 /api/tx에 직접 curl로 확인
```

---

## 18. Hash 값 모듈 간 일관성 (핵심)

이 섹션은 고팡 결제 시스템에서 가장 중요한 불변 조건을 기술한다.  
**hash 값 일관성이 깨지면 모든 거래가 STALE_STATE(409)로 실패한다.**

### 18.1 hash 값 흐름 전체 다이어그램

```
거래 성공 시:

L1 (PocketBase blocks 컬렉션)
  └─ content_hash = sha256(tx_hash + buyer_sig + prevBlockHash)
       ↓ L1 응답 (block_hash = content_hash)
       ↓
Worker (/biz/order 응답)
  └─ { ok:true, block_hash, buyer_claim: { block_hash, ... } }
       ↓ profile.html → GWP_DONE → market → gopang
       ↓
gopang-app.js (GWP_DONE 핸들러) ← ⚠️ 현재 redeemClaim() 미호출
  └─ wallet.redeemClaim({ block_hash, claims: buyer_claim })
       ↓
gopang-wallet.js (redeemClaim)
  └─ IndexedDB 'financial_state'.block_hash = block_hash  ← 갱신
       ↓
다음 거래 sign() 호출 시:
  └─ buildPrevSettleHash()
       └─ financial_state.block_hash → prev_settle_hash로 사용
            ↓
       L1 3단계 검증: prev_settle_hash === latestBlock.content_hash ✅
```

### 18.2 모듈별 hash 저장 위치와 역할

| 모듈 | 저장 위치 | 저장 값 | 역할 |
|---|---|---|---|
| L1 PocketBase | `blocks.content_hash` | sha256(tx_hash+buyer_sig+prevBlockHash) | 블록체인 연속성의 기준값 |
| L1 PocketBase | `blocks.prev_settle_hash` | 해당 거래의 prev_settle_hash (기록용) | 감사 추적 |
| gopang-wallet.js | IndexedDB `financial_state.block_hash` | 직전 거래의 L1 content_hash | 다음 거래의 prev_settle_hash 원천 |
| gopang-wallet.js | IndexedDB `hash_chain` (height별) | prevSettleHash, newSettleHash, txHash 등 | 로컬 해시체인 이력 |
| Supabase | `fs_ledger.block_hash` | L1 content_hash | DB 레코드와 L1 블록 연결 |
| Supabase | `fs_ledger.prev_settle_hash` | 거래 당시의 prev_settle_hash | 감사 추적 |
| Supabase | `pdv_log.block_hash` | L1 content_hash | OpenHash 앵커링 증거 |

**users.hondi.net (profile.html)**:
- hash 값을 저장하지 않음
- `/biz/order` POST → Worker → L1으로 전달만 함
- 서명은 hondi.net wallet에서 수행 (GWP 경로)
- profile.html 자체의 IndexedDB에는 hash 관련 데이터 없음

### 18.3 일관성 불변 조건

거래 N이 성공한 후, 거래 N+1이 성공하려면 반드시:

```
IndexedDB financial_state.block_hash
  === L1 blocks 컬렉션에서 buyer_guid 기준 최신 블록의 content_hash
```

이 조건이 깨지는 순간 409 STALE_STATE 발생.

### 18.4 일관성이 깨지는 시나리오

| 시나리오 | 원인 | 증상 | 해결 |
|---|---|---|---|
| GWP_DONE 후 redeemClaim() 미호출 | gopang-app.js 구현 누락 | 다음 거래부터 항상 STALE_STATE | GWP_DONE 핸들러에 redeemClaim() 추가 |
| setFinancialState() 직접 호출 | `block_hash: null`로 리셋됨 | 다음 거래 STALE_STATE | setFinancialState 후 block_hash 수동 재설정 |
| 페이지 새로고침 (캐시 삭제 포함) | IndexedDB는 유지, 별도 영향 없음 | 해당 없음 | - |
| 다른 기기/브라우저에서 접속 | 해당 기기에 financial_state 없음 | 첫 거래는 통과, 이후 STALE_STATE | redeemClaim() 자동화로 해결 |
| L1에서 테스트 블록 직접 삽입 | L1 블록은 생겼지만 wallet 미갱신 | STALE_STATE | 수동 동기화 |
| users.hondi.net에서 서명 시도 | 별도 IndexedDB에 다른 키 생성 | UNREGISTERED_KEY (403) | 반드시 hondi.net 경로로 서명 |

### 18.5 setFinancialState() 호출 위험

```javascript
// ⚠️ 위험: block_hash가 null로 리셋됨
await wallet.setFinancialState({ 'bs-cash': 1000000, ... });
// → financial_state = { state: {...}, updatedAt: ..., block_hash: null }
// → 다음 buildPrevSettleHash()가 fs 해시를 계산 → L1 불일치 → STALE_STATE

// ✅ 안전: setFinancialState 후 반드시 block_hash 복원
await wallet.setFinancialState({ 'bs-cash': 1000000, ... });
// 이후 redeemClaim() 또는 수동으로 block_hash 기입 필요
```

### 18.6 수동 동기화 절차 (비상시)

**Step 1**: L1에서 사용자의 최신 블록 content_hash 조회
```bash
# L1 서버에서
TOKEN=$(curl -s -X POST http://127.0.0.1:8091/api/admins/auth-with-password \
  -H "Content-Type: application/json" \
  -d '{"identity":"tensor.city@gmail.com","password":"automatic25"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s "http://127.0.0.1:8091/api/collections/blocks/records?filter=(buyer_guid='2601:db80:bd05:abfe:cf29:fc7f:f5a8:4e5b')&sort=-height&perPage=1" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['items'][0]['content_hash'])"
```

**Step 2**: hondi.net 콘솔에서 IndexedDB 동기화
```javascript
const LATEST_CONTENT_HASH = '{Step1에서 조회한 값}';
const req = indexedDB.open('gopang-wallet');
req.onsuccess = e => {
  const db = e.target.result;
  const tx = db.transaction('keys', 'readwrite');
  const store = tx.objectStore('keys');
  // 현재 financial_state 읽기
  store.get('financial_state').onsuccess = ev => {
    const rec = ev.target.result || { state: { 'bs-cash': 0, 'pl-purchase': 0, 'pl-revenue': 0 } };
    // block_hash만 갱신
    store.put({
      ...rec,
      block_hash: LATEST_CONTENT_HASH,
      updatedAt: new Date().toISOString(),
    }, 'financial_state');
    tx.oncomplete = () => console.log('✅ block_hash 동기화 완료:', LATEST_CONTENT_HASH);
  };
};
```

**Step 3**: 검증
```javascript
const { prevSettleHash } = await window.gopangWallet.buildPrevSettleHash();
console.log('prev_settle_hash:', prevSettleHash);
// → Step 1의 content_hash와 일치해야 함
```

### 18.7 근본 해결 — redeemClaim() 자동화 (미구현)

**목표**: 거래 성공 시 자동으로 financial_state.block_hash 갱신

**구현 위치**: `gopang-app.js` GWP_DONE 핸들러

```javascript
// gopang-app.js: GWP_DONE 수신 핸들러에서 추가할 코드
window.addEventListener('message', async (e) => {
  if (e.data?.type !== 'GWP_DONE') return;
  
  const { buyer_claim, block_hash } = e.data;
  
  // ← 이 부분 추가 필요
  if (window.gopangWallet && block_hash) {
    try {
      await window.gopangWallet.redeemClaim({
        block_hash,
        block_id: e.data.block_id || null,
        claims:   buyer_claim ? [buyer_claim] : [],
        tx_hash:  e.data.tx_hash || null,
      });
      console.info('[GWP_DONE] wallet.redeemClaim() 완료 — block_hash 갱신:', block_hash.slice(0,8));
    } catch(err) {
      console.warn('[GWP_DONE] redeemClaim 실패 (수동 동기화 필요):', err.message);
    }
  }
});
```

**redeemClaim() 내부 동작** (gopang-wallet.js):
```javascript
redeemClaim({ block_hash, claims }) {
  // 1. financial_state 로드
  // 2. claims 적용 (debit/credit → bs-cash 차감/추가)
  // 3. financial_state.block_hash = block_hash  ← 핵심
  // 4. IndexedDB 저장
  // 5. hash_chain 이력 기록
}
```

**GWP_DONE에 buyer_claim이 포함되는 경로 확인 필요**:
```
profile.html → GWP_DONE postMessage 내용 확인
  → { type:'GWP_DONE', summary, pdvData }  ← buyer_claim 없음 (현재)
  
Worker /biz/order 응답 → { ok, block_hash, buyer_claim, seller_claim }
  → profile.html이 result.buyer_claim을 GWP_DONE에 포함시켜야 함
```

**따라서 profile.html도 수정 필요**:
```javascript
// profile.html GWP_DONE 전송 시
window.opener.postMessage({
  type:        'GWP_DONE',
  summary:     `...`,
  block_hash:  result.block_hash,   // ← 추가
  tx_hash:     result.tx_hash,      // ← 추가
  buyer_claim: result.buyer_claim,  // ← 추가
  pdvData:     { ... },
}, OPENER_ORIGIN);
```

---

---

*Gopang Technical Specification v1.0 (patch 적용 완료)*  
*AI City Inc. 팀 주피터 | 2026-06-11*
  
*AI City Inc. 팀 주피터 | 2026-06-11*
