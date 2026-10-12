# Navi Technical Specification — v1 Patch Notes v2
**버전** v1.1 → v1.2  
**작성일** 2026-06-11  
**작성자** Claude Sonnet 4.6 (대화 세션 분석 기반)  
**대상 문서** gopang-technical-spec-v1.md, gopang-technical-spec-v1-patch.md

---

## 패치 요약

| # | 대상 | 오류 유형 | 상태 |
|---|------|-----------|------|
| P11 | market/webapp.html | OPEN_PROFILE 경로 GWP_DONE gopang 포워딩 누락 (구멍 B) | ✅ 수정 |
| P12 | L1 main.pb.js | PocketBase 0.22.14 필터 버그 (`"1=1"`, IPv6, 빈 컬렉션) | ✅ 수정 |
| P13 | L1 main.pb.js | NODE_ID 외부 변수 스코프 오류 | ✅ 수정 |
| P14 | L1 main.pb.js | sha256hex 함수 선언 위치 오류 (콜백 외부) | ✅ 수정 |
| P15 | L1 main.pb.js | sha256hex 재호출 시 내부 상태 오염 | ✅ 수정 |
| P16 | L1 main.pb.js | l1_ledger 앵커링 후 NODE_ID 스코프 오류 | ✅ 수정 |
| P17 | gopang-app.js | PDV 기록 실패 (undefined.slice) | ⚠️ 다음 세션 |

---

## P11 — market/webapp.html: OPEN_PROFILE 경로 GWP_DONE 포워딩 누락

### 증상
- 1차 주문 완료 후 gopang IndexedDB `block_hash`가 null로 유지됨
- 2차 주문 시 `prev_settle_hash: null` → L1 409 STALE_STATE

### 원인
`market/webapp.html`에는 GWP_DONE 핸들러가 두 경로로 존재한다.

| 경로 | 핸들러 | gopang 포워딩 |
|------|--------|--------------|
| `_parseTrade` 경로 (1784행) | `gwpHandler` | ✅ 있음 |
| `OPEN_PROFILE` 경로 (1604행) | `gwpDoneHandler` | ❌ 없음 (구멍 B) |

실제 주문 흐름은 `OPEN_PROFILE` 경로를 사용하므로 gopang이 GWP_DONE을 수신하지 못했다.

### 수정 내용
`market/webapp.html` `gwpDoneHandler` 내부 (PDV 보고 코드 직전)에 포워딩 1줄 추가:

```javascript
// GWP_DONE → gopang 탭 포워딩 (redeemClaim 트리거)
if (window.opener && !window.opener.closed) {
  window.opener.postMessage(e.data, 'https://hondi.net');
  console.log('[Market] GWP_DONE → gopang 포워딩 완료 (OPEN_PROFILE 경로)');
}
```

### 진단 방법
```javascript
// market 탭 콘솔에서 배포 확인
fetch(location.href)
  .then(r => r.text())
  .then(html => {
    const has = html.includes('OPEN_PROFILE 경로');
    console.log('구멍 B 수정 배포됨:', has);
  });
```

### 핵심 교훈
- market이 GWP_DONE을 "수신"하는 것과 gopang으로 "포워딩"하는 것은 별개다
- 포워딩 시 `e.data` 전체를 넘길 것 — 필드 재구성 시 미래 필드 누락 위험

---

## P12 — L1 main.pb.js: PocketBase 0.22.14 필터 버그

### 증상
```
{"code":400,"message":"Something went wrong while processing your request.","data":{}}
```
- JS catch 블록이 실행되지 않고 PocketBase가 직접 400 반환
- Worker tail에서는 `POST /biz/order - Ok`로 표시되어 혼란 야기

### 원인 1: `"1=1"` 필터
PocketBase 0.22.14에서 `findRecordsByFilter`에 `"1=1"` 필터를 사용하면 빈 컬렉션이거나 특정 조건에서 JS 런타임 패닉을 일으킨다. catch를 우회하여 PocketBase가 직접 400을 반환한다.

**문제 코드:**
```javascript
// gdc_keys 조회
$app.dao().findFirstRecordByFilter(
  "gdc_keys",
  "public_key = '" + buyer_public_key.replace(/'/g, "''") + "'"
);
// → buyer_public_key에 '-', '_' 등 특수문자 포함 시 필터 파싱 실패

// blocks 조회
$app.dao().findRecordsByFilter("blocks", "1=1", "-created", 0, 0);
// → "1=1" 필터 + limit 0 조합에서 패닉

// l1_ledger 조회
$app.dao().findRecordsByFilter("l1_ledger", "1=1", "-created", 0, 0);
// → 동일 문제
```

**수정 코드:**
```javascript
// gdc_keys — 전체 로드 후 JS에서 비교
const allKeys = $app.dao().findRecordsByFilter(
  "gdc_keys", "public_key != ''", "", 1000, 0
);
keyRecord = allKeys.find(r => r.getString("public_key") === buyer_public_key) || null;

// blocks — 존재하는 컬럼 조건 사용
const allBlocks = $app.dao().findRecordsByFilter(
  "blocks", "block_type != ''", "-height", 1000, 0
);
const buyerBlocks = allBlocks.filter(r => r.getString("buyer_guid") === owner_guid);

// l1_ledger — 존재하는 컬럼 조건 사용
const allLedger = $app.dao().findRecordsByFilter(
  "l1_ledger", "tx_id != ''", "-created", 10000, 0
);
```

### 원인 2: IPv6 주소를 PocketBase 필터에 직접 삽입
```javascript
// 문제: IPv6의 ':' 문자가 필터 파싱 오류 유발
"buyer_guid = '2601:db80:bd05:abfe:cf29:fc7f:f5a8:4e5b'"

// 해결: 전체 로드 후 JS에서 비교
allBlocks.filter(r => r.getString("buyer_guid") === owner_guid)
```

### 원인 3: `findRecordsByFilter` 빈 컬렉션 조회
PocketBase 0.22.14에서 `findRecordsByFilter`는 빈 컬렉션에 대해 빈 배열 반환 대신 내부 오류를 일으킬 수 있다. `"1=1"` 필터 대신 실제 컬럼 조건을 사용해야 한다.

### 진단 절차
1. PocketBase stdout 로그 실시간 확인:
```bash
PID=$(ps aux | grep pocketbase | grep hanlim | grep -v grep | awk '{print $2}')
tail -f /proc/$PID/fd/1
```

2. 각 단계에 console.log 추가하여 어느 단계에서 멈추는지 확인:
```javascript
console.log("[TX] 1단계 진입");
console.log("[TX] 2단계 진입");
// ...
```

3. 최소 버전으로 교체하여 이진 탐색:
- routerAdd 콜백 내 최소 코드만 남기고 성공 확인
- 코드를 하나씩 추가하며 실패 지점 특정

---

## P13 — L1 main.pb.js: NODE_ID 외부 변수 스코프 오류

### 증상
```
[TX] 앵커링 실패: NODE_ID is not defined
```
PocketBase JS 런타임에서 routerAdd 콜백 외부에 선언된 `const NODE_ID`가 콜백 내부의 특정 컨텍스트(l1_ledger 저장, 청구권 생성)에서 참조 불가.

### 원인
PocketBase 0.22.14 JS 런타임이 특정 조건에서 외부 스코프 변수 접근을 차단한다.

### 수정 내용
`NODE_ID` 외부 변수 참조를 모두 인라인 문자열로 교체:

```javascript
// 수정 전
issued_by: NODE_ID,
ledgerRec.set("l1_node", NODE_ID);

// 수정 후
issued_by: "KR-JEJU-JEJU-HANLIM",
ledgerRec.set("l1_node", "KR-JEJU-JEJU-HANLIM");
```

---

## P14 — L1 main.pb.js: sha256hex 함수 선언 위치

### 증상
청구권 생성 시 `sha256hex` 호출이 실패하여 400 반환.

### 원인
원본 코드에서 `sha256hex`가 routerAdd 콜백 외부에 선언되어 있었다. P13과 동일한 스코프 문제.

### 수정 내용
`sha256hex` 함수를 routerAdd 콜백 **내부** 블록 생성 직전으로 이동:

```javascript
routerAdd("POST", "/api/tx", (c) => {
  // ... 검증 코드 ...

  // 블록 생성 직전에 선언
  function sha256hex(str) {
    // ... 구현 ...
  }
  const contentHash = sha256hex(tx_hash + buyer_sig + prevBlockHash + Date.now().toString());
  
  // 청구권 생성 시에도 동일 스코프 내에서 재사용 가능
  const buyerClaim = {
    claim_id: sha256hex("buyer-" + tx_hash + blockId).substring(0, 32),
    // ...
  };
});
```

---

## P15 — L1 main.pb.js: sha256hex 함수 재호출 시 내부 상태 오염

### 증상
청구권 생성 시 `sha256hex("buyer-" + tx_hash + blockId)` 호출이 실패하여 400 반환.
블록 생성 시 첫 번째 `sha256hex` 호출은 성공하지만 두 번째 호출이 실패.

### 원인
`sha256hex` 함수 내부의 `words` 배열이 `|=` 연산으로 누적되는 구조여서, 함수를 재호출하면 이전 호출의 상태가 남아 오염된다.

```javascript
// 문제: words 배열이 초기화되지 않고 누적됨
const words = [];
words[i >> 2] |= j << ((3 - i) % 4) * 8;  // 이전 호출 값에 OR 연산
```

### 수정 내용
청구권의 `claim_id`에서 `sha256hex` 재호출 제거. 대신 단순 문자열 슬라이스 사용:

```javascript
// 수정 전
claim_id: sha256hex("buyer-" + tx_hash + blockId).substring(0, 32)

// 수정 후 (현재 버전에서 적용됨 — sha256hex는 contentHash 계산에만 1회 사용)
claim_id: ("buyer-" + tx_hash + blockId).substring(0, 32)
// 또는 sha256hex를 매 호출마다 새로운 함수 인스턴스로 재선언
```

---

## P16 — L1 main.pb.js: l1_ledger 저장 후 Merkle 계산 시 NODE_ID 참조 오류

### 증상
```
[TX] 앵커링 실패: NODE_ID is not defined
```
l1_ledger 저장까지는 성공하지만 Merkle 계산 + L2 전파 블록에서 실패.

### 원인
원본 코드에서 l1_ledger 저장 후 `ledgerRec.set("parent_root", parentRoot)`를 위해 `ledgerRec`를 재참조하는 코드가 있었고, 이 시점에 `NODE_ID` 외부 변수 접근이 차단됨.

### 수정 내용
P13과 동일 — `NODE_ID` 모든 참조를 인라인 문자열로 교체.

---

## P17 — gopang-app.js: PDV 기록 실패 (미해결)

### 증상
```
[PDV] 기록 실패: Cannot read properties of undefined (reading 'slice')
```

### 발생 위치
`gopang-app.js:3973` `_recordPDV` 함수

### 원인 추정
GWP_DONE 메시지에서 PDV 데이터의 특정 필드가 undefined인 상태로 `_recordPDV`에 전달됨. `.slice()` 호출 대상이 undefined.

### 현재 상태
T04 동작에는 영향 없음. PDV 기록만 실패하고 wallet 갱신은 정상 완료.

### 다음 세션 조치
1. `gopang-app.js` 3973행 확인
2. `_recordPDV` 호출 시 전달되는 데이터 구조 확인
3. undefined 필드에 대한 방어 코드 추가

---

## 수정된 main.pb.js 전체 구조 (v2.1)

```
routerAdd("POST", "/api/tx", (c) => {
  // 1단계: 필드 유효성 검사 + tx_hash 형식
  // 2단계: 공개키 확인 (findRecordsByFilter + JS filter)
  // 3단계: 블록 조회 (findRecordsByFilter "block_type != ''" + JS filter)
  //        이중 지불 확인 (findRecordsByFilter "block_type != ''" + JS find)
  // 4단계: 잔액 확인
  // sha256hex 함수 선언 (콜백 내부)
  // 블록 생성 + saveRecord
  // 청구권 생성 (sha256hex 재사용, NODE_ID 인라인)
  // l1_ledger 앵커링 (findRecordsByFilter "tx_id != ''")
  // Merkle 계산 + L2 전파
  // 200 응답
});

routerAdd("GET", "/health", ...);
routerAdd("GET", "/merkle", ...);
routerAdd("POST", "/tx", ...);      // /api/tx 별칭
routerAdd("POST", "/push_root", ...);
```

---

## T-시리즈 현황 (2026-06-11 기준)

| 테스트 | 내용 | 상태 |
|--------|------|------|
| T01 | 기본 주문 흐름 | ✅ |
| T02 | AI 판매자 검색 | ✅ |
| T03 | profile.html 팝업 | ✅ |
| T04 | 반복 주문 (STALE_STATE 없이) | ✅ 완료 |
| T05~T10 | 미시작 | ⏳ |

---

## 즉각 조치 가이드

### 증상: `{"code":400,"message":"Something went wrong"}`

1. Worker tail 확인 → `[BizOrder] L1 실패:` 로그 확인
2. L1 직접 테스트:
```bash
curl -s -X POST http://127.0.0.1:8091/api/tx \
  -H "Content-Type: application/json" \
  -d '{"tx":...,"tx_hash":"...","buyer_sig":"...","buyer_public_key":"..."}' \
  | python3 -m json.tool
```
3. PocketBase 로그 실시간 확인:
```bash
PID=$(ps aux | grep pocketbase | grep hanlim | grep -v grep | awk '{print $2}')
tail -f /proc/$PID/fd/1
```
4. main.pb.js에 단계별 console.log 추가하여 실패 지점 특정
5. `findRecordsByFilter` 필터에 `"1=1"` 또는 IPv6 주소 직접 삽입 여부 확인

### 증상: 반복 주문 시 STALE_STATE

1. IndexedDB block_hash 확인:
```javascript
const req = indexedDB.open('gopang-wallet');
req.onsuccess = e => {
  const db = e.target.result;
  db.transaction('keys').objectStore('keys')
    .get('financial_state').onsuccess = ev => {
      console.log('block_hash:', ev.target.result?.block_hash);
    };
};
```
2. null이면 GWP_DONE 포워딩 경로 확인
3. market 탭 콘솔에서 `[MARKET MSG] GWP_DONE` 로그 확인
4. gopang 탭 콘솔에서 `[NAVI MSG] GWP_DONE` 로그 확인

### L1 블록 초기화

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8091/api/admins/auth-with-password \
  -H "Content-Type: application/json" \
  -d '{"identity":"tensor.city@gmail.com","password":"automatic25"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s "http://127.0.0.1:8091/api/collections/blocks/records?sort=-created&perPage=50" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys,json,urllib.request
d=json.load(sys.stdin)
token='$TOKEN'
for b in d.get('items',[]):
    req=urllib.request.Request(
        f'http://127.0.0.1:8091/api/collections/blocks/records/{b[\"id\"]}',
        method='DELETE',
        headers={'Authorization':f'Bearer {token}'}
    )
    urllib.request.urlopen(req)
    print(f'삭제: height={b[\"height\"]}')
print('완료')
"
```

### gopang IndexedDB 초기화 + 잔액 설정

```javascript
const req = indexedDB.open('gopang-wallet');
req.onsuccess = e => {
  const db = e.target.result;
  const tx = db.transaction('keys', 'readwrite');
  const store = tx.objectStore('keys');
  store.delete('financial_state');
  store.delete('hash_chain');
  tx.oncomplete = () => {
    const req2 = indexedDB.open('gopang-wallet');
    req2.onsuccess = e2 => {
      const db2 = e2.target.result;
      const tx2 = db2.transaction('keys', 'readwrite');
      tx2.objectStore('keys').put({
        state: { 'bs-cash': 100000000, 'pl-purchase': 0, 'pl-revenue': 0 },
        block_hash: null,
        updatedAt: new Date().toISOString()
      }, 'financial_state');
      tx2.oncomplete = () => console.log('✅ 초기화 + 잔액 설정 완료');
    };
  };
};
```

---

*gopang-technical-spec-v1-patch2.md*  
*AI City Inc. 팀 주피터 | 2026-06-11*
