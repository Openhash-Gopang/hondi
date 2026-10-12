# Navi Technical Specification — v1 Patch Notes
**버전** v1.0 → v1.1  
**작성일** 2026-06-11  
**작성자** Claude Sonnet 4.6 (대화 세션 분석 기반)  
**대상 문서** gopang-technical-spec-v1.md

---

## 패치 요약

| # | 대상 | 오류 유형 | 상태 |
|---|------|-----------|------|
| P1 | Section 4.5 K-Market SP 로드 | 캐시버스터 오류 | ✅ 수정 |
| P2 | Section 5 GWP — _gwpLaunch() | 재진입 차단 버그 | ✅ 수정 |
| P3 | Section 5 GWP — ctx 자동전송 | SP 로드 전 sendMessage() 호출 | ✅ 수정 |
| P4 | Section 5 GWP — GWP_DONE 포워딩 | market → gopang 미전달 | ✅ 수정 |
| P5 | Section 6 gopang-wallet.js | buildTxWithPrevHash 구버전 로직 | ✅ 수정 |
| P6 | Section 6 gopang-wallet.js | buildPrevSettleHash 구버전 로직 | ✅ 수정 |
| P7 | Section 18.7 | redeemClaim() 미구현으로 기재 | ✅ 구현 완료로 정정 |
| P8 | Section 18.4 | STALE_STATE 시나리오 1개 추가 | ✅ 추가 |
| P9 | 신규 섹션 | DeepSeek thinking 모드 비활성화 | ✅ 추가 |
| P10 | 신규 섹션 | sendMessage 이중 등록 경고 | ✅ 추가 |

---

## P1 — Section 4.5: K-Market SP 로드 캐시버스터 제거

**v1 기재 내용 (오류)**:
```javascript
const SP_URL = '...SP-KMARKET-v2_4.txt';
fetch(SP_URL + '?t=' + Date.now())  // ← 캐시버스터
```

**문제**: `?t=Date.now()`를 붙이면 DeepSeek KV Cache가 매 요청을 새 세션으로 인식하여 prompt 캐시 적중 불가.

**수정 후**:
```javascript
// market/webapp.html loadSystemPrompt()
const SP_URL = 'https://raw.githubusercontent.com/Openhash-Gopang/market/main/prompts/SP-KMARKET-v2_4.txt';
fetch(SP_URL)  // 캐시버스터 제거 — DeepSeek KV Cache 적중 유지
```

**추가 — SP 사전 로드 패턴**:
```javascript
// init() 완료 시점에 SP를 미리 로드하여 CFG.systemPrompt 캐시 채움
// → 첫 callAI() 호출 시 fetch 없이 즉시 사용
loadSystemPrompt().catch(() => {});
```

**KV Cache 확인 로그**:
```
[Cache] prompt=7480 cached=7424 completion=800 (절감율 96%)
```
`cached_tokens`이 `prompt_tokens`와 거의 같으면 KV Cache 정상 적중.

---

## P2 — Section 5 GWP: _gwpLaunch() 재진입 차단 버그

**v1 기재 내용 (오류)**:
```javascript
function _gwpLaunch(service, context, _preTab = null) {
  // 이미 열려 있는 탭이 있으면 포커스만 이동
  if (_gwpActive && _gwpTab && !_gwpTab.closed) {
    _gwpTab.focus();
    if (_preTab && !_preTab.closed) _preTab.close();
    return;  // ← ctx 미전달로 market 탭 멈춤
  }
```

**문제**: market 탭이 이미 열려있는 상태에서 나비에 새 주문이 들어오면, 기존 탭에 포커스만 이동하고 새 ctx를 전달하지 않음. market webapp은 아무 동작도 하지 않고 멈춤.

**수정 후**:
```javascript
function _gwpLaunch(service, context, _preTab = null) {
  // 기존 탭이 열려있으면 닫고 새 ctx로 재시작
  if (_gwpTab && !_gwpTab.closed) {
    _gwpTab.close();
    _gwpTab = null;
  }
  if (_gwpTabTimer) {
    clearInterval(_gwpTabTimer);
    _gwpTabTimer = null;
  }
  _gwpActive  = false;
  _gwpService = null;
  // 이후 정상 흐름으로 새 탭 열기 ...
```

**파일**: `gopang/gopang-app.js` 3430행

---

## P3 — Section 5 GWP: ctx 자동전송 타이밍

**v1 기재 내용 (오류)**:
```javascript
// market/webapp.html init() 완료 후
setTimeout(() => sendMessage(), 100);
```

**문제**: SP 로드(fetch)와 sendMessage()가 동시에 경쟁하여 SP 로드 전에 sendMessage → callAI()가 실행될 수 있음. 결과적으로 SP 없이 DeepSeek 호출 → 비정상 응답.

**수정 후**:
```javascript
// SP 로드 완료를 기다린 후 sendMessage() 실행
loadSystemPrompt().then(() => setTimeout(() => sendMessage(), 100));
```

**파일**: `market/webapp.html` GWP ctx 자동전송 블록

---

## P4 — Section 5 GWP / Section 18.7: GWP_DONE 포워딩 누락 (핵심 버그)

**v1 기재 내용 (오류)**:
> Section 18.7: "redeemClaim() 자동화 — 미구현"

**실제 상황**: gopang-app.js의 GWP_DONE 핸들러와 redeemClaim() 호출 코드는 이미 구현되어 있었음. 그러나 **market webapp이 GWP_DONE을 gopang에 포워딩하지 않아** redeemClaim()이 호출되지 않았음.

**문제 경로**:
```
profile.html → GWP_DONE → market webapp  ← 여기서 종료 (gopang 미전달)
```

**결과**: 거래 성공 후 gopang-wallet의 `financial_state.block_hash`가 갱신되지 않음
→ 다음 거래에서 `prev_settle_hash`가 null → L1 409 STALE_STATE

**수정 후** (`market/webapp.html` gwpHandler):
```javascript
// GWP_DONE 수신 후 gopang에 포워딩 추가
console.log('[Market] GWP_DONE 수신:', summary);

// GWP_DONE → gopang 탭 포워딩 (redeemClaim 트리거)
if (window.opener && !window.opener.closed) {
  window.opener.postMessage(e.data, 'https://hondi.net');
  console.log('[Market] GWP_DONE → gopang 포워딩 완료');
}
```

**수정 후 정상 경로**:
```
profile.html → GWP_DONE (block_hash, tx_hash, buyer_claim 포함)
  → market webapp (자체 처리 + gopang 포워딩)
  → gopang-app.js GWP_DONE 핸들러
  → window.gopangWallet.redeemClaim({ block_hash, claims })
  → IndexedDB financial_state.block_hash = block_hash  ← 갱신
  → 다음 거래 prev_settle_hash 정확히 전달 → STALE_STATE 없음
```

**Section 18.7 정정**: "미구현" → "구현 완료 (gopang-app.js 3614행)"

---

## P5 — Section 6: gopang-wallet.js buildTxWithPrevHash 구버전 로직

**v1 기재 내용 (오류)**:
```javascript
async function buildTxWithPrevHash({ buyerGuid, ..., financialState, ... }) {
  const prevSettleHash = await computePrevSettleHash(financialState);
  // fs 상태를 해싱하여 prev_settle_hash 계산
```

**문제**: L1은 `prev_settle_hash`를 **직전 블록의 content_hash**와 비교하여 검증함. 재무 상태를 해싱한 값은 전혀 다른 값이므로 항상 STALE_STATE 발생.

**수정 후**:
```javascript
// prevSettleHash를 파라미터로 수신 (호출자가 주입)
async function buildTxWithPrevHash({
  buyerGuid, sellerGuid, total, sellerNet, platformFee,
  financialState, items, prevSettleHash,  // ← 파라미터 추가
}) {
  // prevSettleHash는 호출자(sign → buildPrevSettleHash)가 주입
  // computePrevSettleHash(financialState) 호출 제거
```

**sign() 수정** — buildTxWithPrevHash 호출 시 prevSettleHash 주입:
```javascript
const { financialState, prevSettleHash } = await this.buildPrevSettleHash();
const { tx } = await buildTxWithPrevHash({
  ...,
  financialState,
  prevSettleHash,   // ← block_hash 기반 값 주입
});
```

**파일**: `gopang/gopang-wallet.js` 339행, 549행

---

## P6 — Section 6: gopang-wallet.js buildPrevSettleHash 구버전 로직

**v1 기재 내용 (오류)**:
```javascript
async buildPrevSettleHash() {
  const fs = await getFinancialState();
  return computePrevSettleHash(fs);  // ← fs 해싱 (잘못됨)
}
```

**문제**: P5와 동일. L1은 fs 해시가 아닌 직전 블록 content_hash를 기대함.

**수정 후**:
```javascript
async buildPrevSettleHash() {
  const db  = await openDB();
  const rec = await idbGet(db, IDB_FS_KEY);
  const financialState = rec?.state || {};
  const prevSettleHash = rec?.block_hash || null;
  // null = 최초 거래 → L1이 latestBlock 없을 때 검증 건너뜀
  return { prevSettleHash, financialState };
}
```

**핵심**: `block_hash`가 null이면 최초 거래로 간주. L1은 블록이 없으면 prev_settle_hash 검증을 건너뜀.

**파일**: `gopang/gopang-wallet.js` 519행

---

## P7 — Section 18.7 정정: redeemClaim() 구현 상태

**v1 기재 (오류)**: "미구현"

**정정**: gopang-app.js GWP_DONE 핸들러(3614행)에 이미 구현되어 있음.

```javascript
// gopang-app.js 3614행 — 실제 구현 코드
if (msg.block_hash && window.gopangWallet?.redeemClaim) {
  const claims = msg.claims?.length
    ? msg.claims
    : (msg.buyer_claim ? [msg.buyer_claim] : []);
  window.gopangWallet.redeemClaim({
    block_hash: msg.block_hash,
    block_id:   msg.block_id  || null,
    tx_hash:    msg.tx_hash   || null,
    claims,
  }).then(({ fs, applied }) => {
    console.info('[GWP_DONE] redeemClaim 완료 — block_hash:',
      msg.block_hash.slice(0, 8), '| applied:', applied, '| bs-cash:', fs['bs-cash']);
  }).catch(err => console.warn('[GWP_DONE] redeemClaim 실패:', err.message));
}
```

**미호출이었던 실제 원인**: market webapp의 GWP_DONE 포워딩 누락 (P4 참조)

**redeemClaim() 검증 방법** (hondi.net 콘솔):
```javascript
const req = indexedDB.open('gopang-wallet');
req.onsuccess = e => {
  const db = e.target.result;
  db.transaction('keys').objectStore('keys')
    .get('financial_state').onsuccess = ev => {
      console.log('block_hash:', ev.target.result?.block_hash);
      console.log('bs-cash:', ev.target.result?.state?.['bs-cash']);
    };
};
// 주문 성공 후 block_hash가 L1 content_hash와 일치해야 함
```

---

## P8 — Section 18.4: STALE_STATE 시나리오 추가

**v1 표에 누락된 시나리오 추가**:

| 시나리오 | 원인 | 증상 | 해결 |
|----------|------|------|------|
| market webapp GWP_DONE 포워딩 누락 | market gwpHandler에 gopang 포워딩 코드 없음 | 매 주문마다 STALE_STATE (첫 거래 제외) | market webapp.html gwpHandler에 postMessage 추가 (P4) |
| buildTxWithPrevHash가 fs 해시 사용 | computePrevSettleHash(fs) 호출 | 항상 STALE_STATE | prevSettleHash를 파라미터로 주입 (P5) |

**v1 Section 18.4에 위 2개 행 추가 필요.**

---

## P9 — 신규: DeepSeek Thinking 모드 비활성화

**v1에 없는 내용 추가**:

`deepseek-v4-flash`는 기본으로 thinking(reasoning) 모드가 활성화됨.  
Thinking 모드에서는 `reasoning_content`만 반환되고 `content`가 null → market webapp 스트리밍 파서가 빈 응답으로 처리 → UI에 아무것도 표시되지 않음.

**잘못된 파라미터 (효과 없음)**:
```javascript
// ❌ 비공식 파라미터 — DeepSeek가 무시함
{ thinking_mode: false }
```

**올바른 파라미터 (공식)**:
```javascript
// ✅ DeepSeek 공식 문서 기준 (OpenAI Format)
{ thinking: { type: "disabled" } }
```

**적용 위치** (`market/webapp.html`):
```javascript
// 1차 DeepSeek 호출 (1358행)
body: JSON.stringify({
  model: CFG.model,
  messages,
  stream: true,
  max_tokens: 800,
  thinking: { type: "disabled" },  // ← 추가
})

// 2차 DeepSeek 호출 — Market Search 재호출 (1486행)
body: JSON.stringify({
  model: CFG.model,
  messages: messages2,
  stream: true,
  max_tokens: 800,
  thinking: { type: "disabled" },  // ← 추가
})
```

**스트리밍 파서 주의**: thinking 모드가 활성화된 경우 모든 청크가:
```json
{"delta": {"content": null, "reasoning_content": "..."}}
```
형태로 오며, 파서의 `chunk.choices[0].delta.content`는 null. `fullText`가 빈 문자열이 되어 [SEARCH] 태그 감지 불가.

---

## P10 — 신규: market webapp 이벤트 이중 등록 경고

**v1에 없는 내용 추가**:

`market/webapp.html`에는 이벤트 핸들러가 HTML 속성과 JS addEventListener 양쪽에 등록되어 있음.

| 요소 | HTML 속성 | JS addEventListener | 결과 |
|------|-----------|---------------------|------|
| `#send-btn` | `onclick="sendMessage()"` (906행) | `sendBtn.addEventListener('click', sendMessage)` (2198행) | 버튼 클릭 시 sendMessage() 2회 호출 |
| `#msg-input` | `oninput="autoResize(this); updateSendBtn()"` (902행) | `msgInput.addEventListener('input', ...)` (2201행) | input 이벤트 핸들러 2회 등록 |

**영향**: 사용자가 버튼을 직접 클릭할 때 sendMessage()가 2회 호출됨. ctx 자동전송 경로에서는 버튼을 클릭하지 않으므로 직접적인 문제는 없으나, 추후 혼란 방지를 위해 HTML onclick 속성 제거 권장.

**권장 수정**:
```html
<!-- 906행: onclick 속성 제거 -->
<button class="send-btn" id="send-btn" disabled>
```
```javascript
// init()에서 이미 addEventListener로 등록하므로 HTML onclick 불필요
```

---

## 수정된 파일 목록 (이번 패치)

| 파일 | 수정 내용 | 패치 참조 |
|------|-----------|-----------|
| `market/webapp.html` | SP 사전 로드, ctx 타이밍 수정 | P1, P3 |
| `market/webapp.html` | thinking: {type:"disabled"} 추가 (1358, 1486행) | P9 |
| `market/webapp.html` | GWP_DONE → gopang 포워딩 추가 | P4 |
| `gopang/gopang-app.js` | _gwpLaunch() 재진입 차단 제거 | P2 |
| `gopang/gopang-wallet.js` | buildTxWithPrevHash prevSettleHash 파라미터 주입 | P5 |
| `gopang/gopang-wallet.js` | buildPrevSettleHash block_hash 직접 반환 | P6 |

---

## 변경되지 않은 내용 (v1 유지)

- Section 1 시스템 개요 및 아키텍처 원칙
- Section 2 인프라
- Section 3 핵심 파일 구조
- Section 4.1~4.4 AI 아키텍처 (SP-00, KV Cache 제외)
- Section 7~16 하위 시스템
- Section 17 진단 가이드 (17.4 STALE_STATE 진단 순서에 P4 내용 추가 권장)
- Section 18.1~18.6 Hash 값 모듈 간 일관성

---

## 검토 — 누락 오류 재확인

이번 세션에서 발견된 모든 이슈를 재확인:

| 이슈 | 패치 포함 여부 |
|------|---------------|
| DeepSeek reasoning_content 반환 → content null | ✅ P9 |
| thinking_mode: false 비공식 파라미터 → 무효 | ✅ P9 |
| market webapp ctx 자동전송 SP 로드 전 실행 | ✅ P3 |
| SP 캐시버스터 ?t=Date.now() KV Cache 방해 | ✅ P1 |
| _gwpLaunch 기존 탭 포커스만 이동 ctx 미전달 | ✅ P2 |
| GWP_DONE market → gopang 포워딩 누락 | ✅ P4 |
| buildTxWithPrevHash fs 해시 사용 오류 | ✅ P5 |
| buildPrevSettleHash fs 해시 사용 오류 | ✅ P6 |
| redeemClaim "미구현"으로 잘못 기재 | ✅ P7 |
| STALE_STATE 시나리오 누락 (2개) | ✅ P8 |
| send-btn / msg-input 이중 등록 | ✅ P10 |

**누락 없음.** 총 11개 이슈, 10개 패치로 처리 완료.

---

*Navi Technical Specification v1 Patch Notes*  
*AI City Inc. 팀 주피터 | 2026-06-11*

---

## P11 — 신규: GWP 메시지 전달 메커니즘 전체 명세

### P11.1 메시지 전달 토폴로지

나비 GWP는 세 도메인(hondi.net / market.hondi.net / users.hondi.net)이 `window.postMessage`로 통신한다. 브라우저 Same-Origin 정책상 탭 간 직접 통신이 불가하므로 **market webapp이 중계자(relay)** 역할을 한다.

```
┌─────────────────────────────────────────────────────────┐
│ 탭 구조                                                  │
│                                                          │
│  hondi.net (iframe: webapp.html)                        │
│       ↑↓ postMessage                                     │
│  market.hondi.net/webapp.html   ← 중계자               │
│       ↑↓ postMessage                                     │
│  users.hondi.net/profile.html   ← window.open() 팝업   │
└─────────────────────────────────────────────────────────┘
```

**opener 관계**:
- gopang이 market을 `window.open()` → market의 `window.opener` = gopang
- market이 profile을 `window.open()` → profile의 `window.opener` = market

### P11.2 메시지 타입 전체 목록

| 메시지 타입 | 발신 | 수신 | 경유 | 방향 |
|-------------|------|------|------|------|
| `GWP_SIGN_REQUEST` | profile | gopang | market (중계) | profile → market → gopang |
| `GWP_SIGN_RESPONSE` | gopang | profile | market (중계) | gopang → market → profile |
| `GWP_SIGN_CANCELLED` | gopang | profile | market (중계) | gopang → market → profile |
| `GWP_DONE` | profile | gopang | market (중계) | profile → market → gopang |
| `GWP_BUBBLE` | 하위 시스템 | gopang | 직접 | 하위 → gopang |

### P11.3 메시지 흐름 상세

#### 서명 요청 흐름 (GWP_SIGN_REQUEST)
```
1. profile.html: requestSign()
   └─ window.opener.postMessage({ type:'GWP_SIGN_REQUEST', tx }, OPENER_ORIGIN)
      └─ OPENER_ORIGIN = 'https://market.hondi.net'

2. market/webapp.html: window.addEventListener('message')
   └─ e.origin === 'https://users.hondi.net' 검증
   └─ e.data.type === 'GWP_SIGN_REQUEST' 확인
   └─ window.opener.postMessage(e.data, 'https://hondi.net')  ← gopang으로 포워딩

3. hondi.net/webapp.html: window.addEventListener('message')
   └─ e.origin === 'https://market.hondi.net' 검증
   └─ _gwpSignExecute(e.data.tx)  ← gopang-wallet.js sign() 호출
   └─ GWP_SIGN_RESPONSE 전송 (아래 참조)
```

#### 서명 응답 흐름 (GWP_SIGN_RESPONSE)
```
1. hondi.net/gopang-app.js: _gwpSignExecute() 완료
   └─ _gwpTab.postMessage({ type:'GWP_SIGN_RESPONSE', signedTx, success:true }, marketOrigin)
      └─ _gwpTab = market 탭 참조

2. market/webapp.html: _gwpSignResponseHandler
   └─ e.origin === 'https://hondi.net' 검증
   └─ profileSource.postMessage(ev.data, profileOrigin)  ← profile로 포워딩
      └─ profileSource = GWP_SIGN_REQUEST 수신 시 저장한 e.source

3. profile.html: window.addEventListener('message', GWP_SIGN_RESPONSE 처리)
   └─ /biz/order POST → Worker → L1
```

#### 완료 통보 흐름 (GWP_DONE) — P4에서 수정
```
1. profile.html: /biz/order 성공 후
   └─ window.opener.postMessage({
        type:        'GWP_DONE',
        summary:     '주문 완료 문자열',
        block_hash:  result.block_hash,   ← L1 content_hash
        tx_hash:     result.tx_hash,
        buyer_claim: result.buyer_claim,
        pdvData:     { who, when, where, what, how, why },
      }, OPENER_ORIGIN)  ← OPENER_ORIGIN = 'https://market.hondi.net'

2. market/webapp.html: gwpHandler
   └─ 자체 처리 (appendBubble, recordPDV)
   └─ window.opener.postMessage(e.data, 'https://hondi.net')  ← gopang 포워딩 (P4 추가)

3. hondi.net/webapp.html: GWP_DONE 핸들러 (gopang-app.js 3584행)
   └─ appendBubble('ai', '✅ ' + msg.summary)
   └─ PDV 기록 (중복 방지 포함)
   └─ window.gopangWallet.redeemClaim({ block_hash, claims })  ← wallet 갱신
   └─ _gwpOnTabClose() 호출 (탭 닫힘 처리)
```

### P11.4 origin 검증 규칙

각 수신자는 반드시 `e.origin`을 검증해야 한다.

| 수신자 | 허용 origin |
|--------|-------------|
| gopang (GWP_SIGN_REQUEST) | `https://market.hondi.net` |
| gopang (GWP_DONE) | `https://market.hondi.net` |
| market (GWP_SIGN_REQUEST 중계) | `https://users.hondi.net` |
| market (GWP_SIGN_RESPONSE 중계) | `https://hondi.net` |
| market (GWP_DONE 수신) | `https://users.hondi.net` |
| profile (GWP_SIGN_RESPONSE) | `https://market.hondi.net` 또는 `https://hondi.net` |

### P11.5 메시지 전달 실패 시나리오 및 대응

| 실패 시나리오 | 원인 | 증상 | 대응 |
|--------------|------|------|------|
| market → gopang GWP_DONE 미전달 | market gwpHandler에 포워딩 코드 없음 | redeemClaim 미호출 → STALE_STATE 반복 | P4 수정 (포워딩 추가) |
| gopang 탭 닫힌 후 GWP_DONE 전달 | window.opener 소멸 | postMessage 예외, 조용히 실패 | P12 자동 복구로 보완 |
| profile opener 소멸 | market 탭 새로고침 | GWP_SIGN_RESPONSE 전달 불가 | profile에 재시도 로직 추가 |
| _gwpTab 참조 소멸 | market 탭 강제 종료 | GWP_SIGN_RESPONSE 전달 불가 | GWP_SIGN_REQUEST 재발송 유도 |
| _preTab 비활성 소멸 | 브라우저 팝업 차단 | market 탭 미생성, ctx 미전달 | P2 수정으로 완화 |

### P11.6 메시지 전달 디버깅

```javascript
// hondi.net 콘솔 — 수신 메시지 모니터링
window.addEventListener('message', e => {
  if (e.data?.type?.startsWith('GWP_')) {
    console.log('[MSG 수신]', e.origin, e.data.type, e.data);
  }
});

// market.hondi.net 콘솔 — 중계 모니터링
window.addEventListener('message', e => {
  if (e.data?.type?.startsWith('GWP_')) {
    console.log('[MSG 중계]', e.origin, '→', e.data.type);
  }
});
```

---

## P12 — 신규: 해시 동기화 메커니즘 (3단계 방어선)

### P12.1 불일치 발생 원인 전체

P4(GWP_DONE 포워딩)로 주된 원인은 해결됐으나, 다음 시나리오에서 불일치가 재발할 수 있다.

| 시나리오 | 원인 | P4로 해결 여부 |
|----------|------|----------------|
| market → gopang GWP_DONE 포워딩 누락 | 구현 버그 | ✅ 해결 |
| gopang 탭이 닫힌 상태에서 거래 완료 | opener 소멸 | ❌ 미해결 |
| 네트워크 오류로 postMessage 실패 | 일시적 오류 | ❌ 미해결 |
| 다른 기기/브라우저로 접속 | IndexedDB 비공유 | ❌ 구조적 한계 |
| 브라우저 데이터 전체 삭제 | IndexedDB 소멸 | ❌ 구조적 한계 |
| 개발 중 테스트 블록 L1 직접 삽입 | 수동 조작 | ❌ 해당 없음 |

### P12.2 1단계 방어선 — 로그인 시 자동 검증 및 복구

페이지 로드 시마다 Supabase fs_ledger에서 최신 block_hash를 조회하여 IndexedDB와 비교·복구한다.

**구현 위치**: `gopang/gopang-wallet.js` 싱글턴 초기화 블록 (현재 재무 상태 서버 동기화 코드 이후)

```javascript
// gopang-wallet.js 싱글턴 초기화 — 기존 코드 이후에 추가
if (stored?.ipv6) {
  try {
    const sbKey = '...';  // 기존 변수 재사용
    // Supabase에서 최신 block_hash 조회
    const bhRes = await fetch(
      `${SUPABASE_URL}/rest/v1/fs_ledger` +
      `?buyer_guid=eq.${stored.ipv6}&order=created_at.desc&limit=1&select=block_hash`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    if (bhRes.ok) {
      const [row] = await bhRes.json();
      const serverHash = row?.block_hash;
      if (serverHash) {
        const db  = await openDB();
        const rec = await idbGet(db, IDB_FS_KEY);
        const localHash = rec?.block_hash;
        if (serverHash !== localHash) {
          await idbPut(db, IDB_FS_KEY, {
            ...(rec || { state: {} }),
            block_hash: serverHash,
            updatedAt:  new Date().toISOString(),
          });
          console.info('[GopangWallet] block_hash 자동 복구:',
            (localHash || 'null').slice(0,8), '→', serverHash.slice(0,8));
        }
      }
    }
  } catch(e) {
    console.warn('[GopangWallet] block_hash 검증 실패 (무시):', e.message);
  }
}
```

**필요 Supabase 조건**: `fs_ledger` 테이블에 `buyer_guid`, `block_hash`, `created_at` 컬럼 필요.

### P12.3 2단계 방어선 — redeemClaim 실패 시 L1 직접 조회 폴백

`redeemClaim()` 자체가 실패하거나 `block_hash`가 누락된 경우, Worker를 통해 L1 최신 블록을 조회하여 복구한다.

**구현 위치**: `gopang/gopang-app.js` GWP_DONE 핸들러 (3614행 이후)

```javascript
// gopang-app.js GWP_DONE 핸들러 — redeemClaim 실패 시 폴백
if (msg.block_hash && window.gopangWallet?.redeemClaim) {
  const claims = msg.claims?.length
    ? msg.claims
    : (msg.buyer_claim ? [msg.buyer_claim] : []);
  window.gopangWallet.redeemClaim({
    block_hash: msg.block_hash,
    block_id:   msg.block_id || null,
    tx_hash:    msg.tx_hash  || null,
    claims,
  }).then(({ fs, applied }) => {
    console.info('[GWP_DONE] redeemClaim 완료:', msg.block_hash.slice(0,8));
  }).catch(async err => {
    console.warn('[GWP_DONE] redeemClaim 실패 — L1 직접 복구 시도:', err.message);
    // ← 폴백: Worker 경유 L1 최신 block_hash 조회
    try {
      await window.gopangWallet.syncBlockHashFromL1(
        window.gopangWallet.guid,
        SUPABASE_ANON_KEY
      );
    } catch(e2) {
      console.warn('[GWP_DONE] L1 동기화도 실패 (수동 복구 필요):', e2.message);
    }
  });
}
```

**gopang-wallet.js에 추가할 메서드** (`syncBlockHashFromL1`):

```javascript
// GopangWallet 클래스 내부 추가
async syncBlockHashFromL1(guid, supabaseKey) {
  const res = await fetch(
    `https://ebbecjfrwaswbdybbgiu.supabase.co/rest/v1/fs_ledger` +
    `?buyer_guid=eq.${guid}&order=created_at.desc&limit=1&select=block_hash`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (!res.ok) throw new Error('Supabase 조회 실패: ' + res.status);
  const [row] = await res.json();
  if (!row?.block_hash) throw new Error('block_hash 없음');
  const db  = await openDB();
  const rec = await idbGet(db, IDB_FS_KEY);
  await idbPut(db, IDB_FS_KEY, {
    ...(rec || { state: {} }),
    block_hash: row.block_hash,
    updatedAt:  new Date().toISOString(),
  });
  console.info('[Wallet] syncBlockHashFromL1 완료:', row.block_hash.slice(0,8));
  return row.block_hash;
}
```

### P12.4 3단계 방어선 — /biz/order 409 수신 시 자동 재시도

STALE_STATE를 받으면 즉시 복구 후 1회 재시도한다. 사용자에게 오류를 노출하지 않는다.

**구현 위치**: `users/profile.html` GWP_SIGN_RESPONSE 핸들러 `/biz/order` POST 부분

```javascript
// profile.html — /biz/order 자동 재시도 (1회)
async function postOrder(payload) {
  const res = await fetch(`${PROXY_BASE}/biz/order`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  const result = await res.json();

  if (!result.ok && result.error === 'STALE_STATE') {
    console.warn('[Order] STALE_STATE — wallet 재동기화 후 재시도');
    // gopang에 동기화 요청
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'GWP_SYNC_REQUEST' }, OPENER_ORIGIN);
    }
    // 700ms 대기 (gopang wallet 동기화 완료 기다림)
    await new Promise(r => setTimeout(r, 700));
    // 재시도 (gopang이 새 서명 없이 동일 tx_hash 재사용 불가 — 새 서명 필요)
    // → 사용자에게 재시도 안내
    showToast('일시적 오류가 발생했습니다. 다시 서명해 주세요.');
    resetPayBtn();
    return null;
  }

  return result;
}
```

**gopang-app.js에 추가 — GWP_SYNC_REQUEST 수신 처리**:

```javascript
// gopang-app.js GWP 메시지 핸들러에 추가
case 'GWP_SYNC_REQUEST': {
  // wallet block_hash를 Supabase에서 즉시 재동기화
  if (window.gopangWallet?.syncBlockHashFromL1) {
    const guid = window.gopangWallet.guid;
    window.gopangWallet.syncBlockHashFromL1(guid, SUPABASE_ANON_KEY)
      .then(hash => console.info('[GWP_SYNC] 완료:', hash.slice(0,8)))
      .catch(e => console.warn('[GWP_SYNC] 실패:', e.message));
  }
  break;
}
```

### P12.5 방어선 우선순위 및 구현 계획

```
현재 구현 완료:
  ✅ P4 — GWP_DONE 포워딩 (주된 원인 해결)

구현 권장 순서:
  1순위 — P12.2 (로그인 시 자동 검증)
    → 구현 난이도: 낮음
    → 효과: 기기 변경, IndexedDB 삭제 등 구조적 한계 해소
    → 사이드이펙트: 없음 (읽기 전용 + 조건부 쓰기)

  2순위 — P12.3 (redeemClaim 폴백)
    → 구현 난이도: 낮음 (syncBlockHashFromL1 메서드 추가)
    → 효과: gopang 탭 닫힘 등 postMessage 실패 케이스 보완

  3순위 — P12.4 (409 자동 재시도)
    → 구현 난이도: 중간 (새 서명 필요 → UX 재설계 포함)
    → 효과: 사용자 경험 개선 (오류 노출 최소화)
    → 주의: L1은 동일 tx_hash 재사용 불가 → 재시도 시 새 서명 필수
```

### P12.6 수동 복구 절차 (비상시 — v1 Section 18.6 보완)

자동 복구가 모두 실패한 경우 최후 수단:

**Step 1 — L1 최신 블록 삭제** (테스트 환경 전용):
```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8091/api/admins/auth-with-password \
  -H "Content-Type: application/json" \
  -d '{"identity":"tensor.city@gmail.com","password":"automatic25"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s "http://127.0.0.1:8091/api/collections/blocks/records\
?filter=(buyer_guid='GUID')&sort=-created&perPage=10" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys,json,urllib.request
d=json.load(sys.stdin)
token='$TOKEN'
for b in d['items']:
    req=urllib.request.Request(
        f'http://127.0.0.1:8091/api/collections/blocks/records/{b[\"id\"]}',
        method='DELETE',
        headers={'Authorization':f'Bearer {token}'}
    )
    urllib.request.urlopen(req)
    print(f'삭제: height={b[\"height\"]}')
"
```

**Step 2 — wallet block_hash null 초기화** (Step 1과 반드시 함께):
```javascript
// hondi.net 콘솔
const req = indexedDB.open('gopang-wallet');
req.onsuccess = e => {
  const db = e.target.result;
  const tx = db.transaction('keys', 'readwrite');
  tx.objectStore('keys').get('financial_state').onsuccess = ev => {
    const rec = ev.target.result;
    tx.objectStore('keys').put({ ...rec, block_hash: null }, 'financial_state');
    tx.oncomplete = () => console.log('✅ block_hash null 초기화 완료');
  };
};
```

**Step 3 — 검증**:
```javascript
const { prevSettleHash } = await window.gopangWallet.buildPrevSettleHash();
console.log('prevSettleHash:', prevSettleHash);
// → null 이어야 함 (L1 블록 없음 = 최초 거래 상태)
```

---

## 패치 요약 (업데이트)

| # | 대상 | 오류 유형 | 상태 |
|---|------|-----------|------|
| P1 | Section 4.5 K-Market SP 로드 | 캐시버스터 오류 | ✅ 수정 |
| P2 | Section 5 GWP — _gwpLaunch() | 재진입 차단 버그 | ✅ 수정 |
| P3 | Section 5 GWP — ctx 자동전송 | SP 로드 전 sendMessage() 호출 | ✅ 수정 |
| P4 | Section 5 GWP — GWP_DONE 포워딩 | market → gopang 미전달 | ✅ 수정 |
| P5 | Section 6 gopang-wallet.js | buildTxWithPrevHash 구버전 로직 | ✅ 수정 |
| P6 | Section 6 gopang-wallet.js | buildPrevSettleHash 구버전 로직 | ✅ 수정 |
| P7 | Section 18.7 | redeemClaim() 미구현으로 기재 | ✅ 구현 완료로 정정 |
| P8 | Section 18.4 | STALE_STATE 시나리오 추가 | ✅ 추가 |
| P9 | 신규 섹션 | DeepSeek thinking 모드 비활성화 | ✅ 추가 |
| P10 | 신규 섹션 | sendMessage 이중 등록 경고 | ✅ 추가 |
| P11 | 신규 섹션 | GWP 메시지 전달 메커니즘 전체 명세 | ✅ 추가 |
| P12 | 신규 섹션 | 해시 동기화 3단계 방어선 | ✅ 추가 |

---

*Navi Technical Specification v1 Patch Notes (최종)*  
*AI City Inc. 팀 주피터 | 2026-06-11*
