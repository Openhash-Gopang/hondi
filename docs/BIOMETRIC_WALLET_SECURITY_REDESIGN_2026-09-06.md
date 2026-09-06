# 생체인증(지문/Face ID) 기반 지갑 보안 재설계 — 2026-09-06

## 0. 배경 — 무엇이 문제였나

`gopang-wallet.js`의 개인키 암호화 entropy는 기본값이 `_deviceEntropy()`이며,
이는 다음과 같이 만들어진다:

```javascript
static async _deviceSecret() {
  let secret = localStorage.getItem(LS_DEVICE_SECRET);
  if (!secret) {
    secret = bufToHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
    localStorage.setItem(LS_DEVICE_SECRET, secret);   // 평문 저장
  }
  return secret;
}
```

**핵심 결함 3가지 (모두 실사로 확인):**

1. **"기기 바인딩"이 이름뿐이다.** entropy가 하드웨어 보안요소가 아니라
   `localStorage`에 평문으로 저장된 랜덤값이다. 개인키(암호화됨)와 그걸 여는
   열쇠가 **같은 브라우저 저장소** 안에 나란히 있다 — 저장소만 확보하면
   개인키를 그대로 연다.
2. **WebAuthn 생체인증(`_webauthnEntropy`)은 "best-effort"다.** 가입 직후
   1회 조용히 시도하고, 실패(브라우저 미지원·제스처 타이밍 실패 등)하면
   아무 안내 없이 약한 모드(`_deviceEntropy`)로 남는다. 사용자는 자신이
   약한 모드인지 알 방법이 없다.
3. **`wallet.load()`는 "1기기 1사용자"를 전제**하고, IndexedDB에 지갑
   레코드가 있으면 무조건 그 지갑을 재사용한다 — 중고폰처럼 이전 사용자의
   지갑이 남아있는 기기에서는 이 전제가 깨진다. 게다가 `signPayload()`는
   메모리에 이미 복호화된 키를 재사용할 뿐, 고액 거래(L2/L3)라고 해서
   서명 시점에 생체인증을 다시 요구하지 않는다 — 인증 레벨(L0~L3)은
   순전히 애플리케이션 레이어의 판단이지, 서명 자체를 암호학적으로
   잠그는 장치가 아니다.

**결과 — 두 가지 구체적 공격 표면:**

- **중고폰 승계**: 이전 소유자가 브라우저 데이터를 안 지우고 판 폰에서,
  새 소유자가 (a) 자기 기존 계정으로 로그인하거나 (b) 신규가입을 하면,
  둘 다 이전 소유자의 개인키를 그대로 이어받는다. (b)의 경우 이전
  소유자가 시드/백업을 보관해뒀다면 **새 소유자의 새 계정을 나중에 열 수
  있다.**
- **탈취 후 무제한 서명**: 어떤 경로로든(약한 fallback, 중고폰 등) 개인키가
  한 번 메모리에 로드되면, 그 세션 동안 L3(1,000만원 이상) 거래까지도
  추가 생체인증 없이 서명 가능하다.

---

## 1. 설계 원칙

```
원칙 1: 생체인증이 예외가 아니라 기본 경로다.
  device-secret(localStorage) fallback은 "쓰지 않는 게 기본"이고,
  쓰게 되면 사용자가 반드시 알고 동의한 상태여야 한다.

원칙 2: 키 자료 접근과 서명 권한을 분리한다.
  "지갑이 풀려 있다"와 "이 거래를 서명해도 된다"는 별개의 질문이다.
  고위험 거래는 매번 새로 생체인증을 요구한다(메모리 캐시 재사용 금지).

원칙 3: "이 기기에 남의 지갑이 있다"는 상태를 명시적으로 감지하고
  차단한다. 조용히 이어받는 경로를 없앤다.

원칙 4: 클라이언트 방어가 뚫려도 서버가 마지막 방어선이 되어야 한다.
  pubkey 재사용 같은 이상 신호는 서버에서도 독립적으로 검증한다.
```

---

## 2. 컴포넌트별 설계

### 2.1 지갑 생성 시 WebAuthn PRF를 사실상 필수화

**현재**: `create()` → 키페어 생성 → `_deviceEntropy()`로 암호화 →
가입 완료 후 "시간 나면" WebAuthn 등록 시도(1회, 실패해도 무방).

**변경**: 키페어 생성 직후, **암호화하기 전에** WebAuthn PRF 등록을
먼저 시도한다.

```javascript
static async create(passphrase = '') {
  const kp = await generateKeyPair();

  // 2026-09-06 신설 — WebAuthn PRF를 기본 경로로 승격.
  // 성공하면 그 결과로 암호화하고 security_level='biometric'을 기록.
  // 실패(미지원 브라우저 등)하면 명시적 동의를 받은 뒤에만
  // device-secret fallback으로 진행한다 — 조용히 넘어가지 않는다.
  let entropy;
  let securityLevel;
  const prfResult = await GopangWallet._tryEnrollWebAuthnPRF();
  if (prfResult.ok) {
    entropy = prfResult.entropy;
    securityLevel = 'biometric';
  } else {
    const userConsent = await GopangWallet._confirmWeakSecurityFallback(prfResult.reason);
    if (!userConsent) {
      throw new Error('WALLET_CREATION_CANCELLED_NO_BIOMETRIC');
    }
    entropy = await GopangWallet._deviceEntropy();
    securityLevel = 'device_secret_fallback';
  }

  const enc = await encryptPrivKey(privKeyBuf, entropy);
  // ... 저장 시 securityLevel도 IndexedDB 레코드에 함께 기록 ...
  // ... /profile 또는 /ai-setup 갱신 시 서버에도 security_level 필드로 반영 ...
}
```

- `_confirmWeakSecurityFallback(reason)`은 실제 UI 모달을 띄워
  "이 기기/브라우저는 생체 보안을 지원하지 않습니다. 계속하면 이 기기의
  키가 상대적으로 약하게 보호됩니다(중고 판매 시 반드시 초기화
  필요)"라고 **명시적으로** 알리고 동의를 받는다. 조용한 실패를 없앤다.
- `security_level`을 서버 `profiles.extra.security_level`에도 기록해서,
  운영팀이 "누가 약한 모드인지" 조회하고 나중에 업그레이드를 유도할 수
  있게 한다.

### 2.2 "이 기기에 이미 지갑이 있다" 감지 게이트 (중고폰 핵심 방어)

가입/로그인 흐름에 들어가기 전에, IndexedDB를 먼저 들여다보고 분기한다.

```
페이지 로드
  └─ IndexedDB에 지갑 레코드가 있는가?
       │
       ├─ 없음 → 정상 신규가입/로그인 흐름 (시나리오 A/C)
       │
       └─ 있음 → "이 기기의 지갑 소유 확인" 단계 삽입
              │
              ├─ WebAuthn 생체인증 요청
              │     (이 지갑이 PRF로 보호돼 있다면 그 credential로 시도)
              │
              ├─ 성공 → 이 사람이 이 지갑의 원래 주인 → 정상 진행
              │          (시나리오 B/D)
              │
              └─ 실패 또는 "이 지갑은 제 것이 아닙니다" 선택
                    │
                    └─ 화면: "이 기기에 다른 사용자의 계정 정보가
                       남아있습니다. 중고 기기이거나 공용 기기라면
                       초기화가 필요합니다."
                       [기기 초기화하고 계속] [취소]
                             │
                             └─ 확인 시 IndexedDB 지갑 레코드 완전 삭제
                                → 그 다음에만 새 키페어 생성 허용
                                  (§2.1의 생성 흐름을 처음부터 다시 탐)
```

핵심은 **"기존 지갑이 있으면 무조건 재사용"이라는 지금의 기본값을
뒤집는 것**이다 — 재사용은 생체인증으로 소유를 증명했을 때만 허용되고,
증명 못 하면 명시적 초기화 없이는 아무 것도 못 하게 막는다.

이게 왜 생체인증으로 막히는가: WebAuthn PRF 결과값은 **등록 당시의
특정 credential(사실상 등록 당시의 특정 지문/얼굴)에 묶여** 있다. 새
소유자가 자기 지문을 새로 등록해도 그건 다른 credential이라 같은 PRF
값이 안 나온다 — 즉 새 소유자의 지문으로는 이전 소유자의 지갑을 절대
못 연다. 이 성질이 시나리오 E/F를 구조적으로 차단한다(이전 소유자가
시드를 보관해도, "새 소유자 명의의 새 계정"에 그 키가 얹히는 일 자체가
안 생긴다 — 얹히기 전에 게이트에서 걸린다).

### 2.3 고위험 서명(L2/L3)은 매번 신선한 생체인증을 요구

**현재**: `signPayload()`가 메모리의 `this._privKey`(세션 내내 유지되는
복호화된 키)를 그냥 쓴다 — L0으로 지갑이 한 번 풀리면 L3까지 다 서명
가능하다.

**변경**: 인증 레벨이 L2 이상인 서명 요청은, 메모리 캐시를 쓰지 않고
**그 순간 다시** WebAuthn 어설션을 요구한 뒤, 그 어설션에서 재도출한
entropy로 개인키를 즉석에서 다시 복호화해 서명하고 즉시 폐기한다.

```javascript
async signPayload(payload, opts = { level: 'L0' }) {
  if (opts.level === 'L2' || opts.level === 'L3') {
    // 2026-09-06 신설 — 고위험 서명은 캐시된 개인키를 쓰지 않는다.
    // 매번 새 WebAuthn 어설션 → 그 자리에서 재복호화 → 서명 → 폐기.
    const freshEntropy = await GopangWallet._webauthnEntropy({ freshAssertion: true });
    const tempPrivKey = await this._decryptForOneShot(freshEntropy);
    try {
      return await sign(tempPrivKey, payload);
    } finally {
      tempPrivKey.dispose?.(); // 가능하면 즉시 폐기(WebCrypto CryptoKey는
                                 // 참조를 버리는 것으로 GC 대상화)
    }
  }
  return sign(this._privKey, payload); // L0/L1은 기존 방식 유지(체감 속도 우선)
}
```

- L0(조회)·L1(소액)은 지금처럼 세션 내 캐시된 키로 빠르게 처리 —
  UX 저하를 최소화한다.
- L2(10만원 이상)·L3(1,000만원 이상, 부동산 등)만 매번 지문/Face ID를
  요구한다 — 은행 앱들이 고액 이체마다 다시 지문을 요구하는 것과 같은
  패턴이다.
- 이 변경만으로 "키가 어떤 경로로든 한 번 노출되면 전 재산이 위험"이던
  것이, "고액 거래 순간마다 물리적 생체인증이 필요"로 바뀐다 — §2.1·2.2가
  뚫려도 마지막 방어선이 된다.

### 2.4 서버측 pubkey 재사용 탐지 (2중 방어선)

클라이언트 게이트(§2.2)가 어떤 이유로든(구버전 캐시된 JS, 버그 등)
우회되는 경우에 대비해, 서버에서도 독립적으로 차단한다.

`pb_hooks/main.pb.js`의 신규 생성(TOFU 최초 바인딩) 시점에 추가:

```javascript
// TOFU 최초 등록 직전 — 이 pubkey가 이미 "다른" guid에 등록된 적
// 있는지 확인한다(현재 활성 레코드든, superseded된 과거 레코드든).
// 정상적인 새 키페어라면 이 세상에 처음 등장하는 pubkey이므로 절대
// 걸리지 않는다 — 걸린다는 것 자체가 "이 기기의 키가 재사용됐다"는
// 강한 신호다.
const dupPubkey = $app.dao().findRecordsByFilter(
  "profiles",
  `pubkey_ed25519 = '${pubkey}' && guid != '${guid}'`,
  "", 1, 0
);
if (dupPubkey.length > 0) {
  throw new BadRequestError(
    "이 공개키는 이미 다른 계정에 등록된 적이 있습니다(REUSED_PUBKEY) — " +
    "이 기기에 이전 사용자의 지갑이 남아있을 수 있습니다. 앱에서 기기를 " +
    "초기화한 뒤 다시 시도해 주세요."
  );
}
```

이 검사는 §2.1~2.3이 전부 정상 작동하면 이론상 절대 안 걸리지만(새
키페어는 세상에 유일하므로), **정확히 이번에 발견한 버그(시나리오
E)를 재현 불가능하게 만드는 마지막 안전망**이다.

### 2.5 기존(이미 device-secret로 생성된) 계정의 업그레이드 유도

`_decryptWithMigration`(기존 코드에 이미 있는, entropy 재암호화 전환
로직)을 그대로 재사용하되, 지금처럼 "가입 직후 1회 조용히 시도"가
아니라:

- 잔액이 0보다 큰 계정이 `security_level='device_secret_fallback'`
  상태로 로그인할 때마다, 화면 상단에 닫을 수 없는(또는 매 세션 1회
  뜨는) 배너로 "생체 보안으로 업그레이드" 유도.
- L2 이상 거래를 시도하는 순간에는 **배너가 아니라 그 자리에서
  강제** — "이 거래를 진행하려면 먼저 생체인증을 등록해야 합니다"로
  전환 시점을 만든다(§2.3과 자연스럽게 맞물림 — 어차피 L2/L3는 생체인증
  없이는 서명 자체가 안 되므로, 이 시점에 등록을 유도하는 게 UX상
  자연스럽다).

---

## 3. 시나리오별 결과 (재설계 후)

| # | 시나리오 | 재설계 후 동작 |
|---|---|---|
| A | 새 사용자 + 새 기기 | WebAuthn PRF 등록 → 생체 보안으로 신규가입 (기존과 체감 동일, 내부적으로 더 안전) |
| B | 기존 가입자 + 같은 기기 | 지갑 존재 감지 → 생체인증으로 소유 확인 → 정상 로그인 |
| C | 기존 가입자 + 새 기기(깨끗함) | 지갑 없음 → 새 키 생성(§2.1) → handle 조회 → PUBKEY_MISMATCH → 4단어 시드 복원(기존과 동일) |
| D | 기존 가입자 + 중고폰(남의 지갑 있음) | 지갑 존재 감지 → 생체인증 시도 실패(자기 지문 아님) → "제 것 아님" 선택 → 초기화 → 새 키 생성 → 4단어 시드로 자기 계정 복원 |
| **E** | 신규 가입 + 중고폰(남의 지갑 있음) | 지갑 존재 감지 → 생체인증 실패 → **초기화 후에만** 신규가입 진행 → 새 키페어는 이전 소유자와 무관 → §2.4가 혹시 몰라 한 번 더 확인 |
| F | 이전 소유자가 시드로 다른 기기에서 복원 시도 | 이전 소유자 자신의 기존 계정(guid)엔 여전히 접근 가능(원래 그래야 함 — 이건 취약점이 아니라 정상 시드 복원). 단, 시나리오 E의 새 계정과는 애초에 키가 안 얽혔으므로 영향 없음 |

---

## 4. 구현 우선순위 제안

1. **§2.4 (서버 pubkey 중복 차단)** — 코드량 적고 즉시 배포 가능, 가장
   비용 대비 효과가 큼. **먼저 이것부터.**
2. **§2.2 (기존 지갑 감지 게이트)** — 중고폰 시나리오의 근본 차단.
   클라이언트 UI 흐름 변경이 필요해 §2.4보다 손이 더 감.
3. **§2.1 (WebAuthn PRF 기본화)** — 신규 가입자부터 적용, 기존
   가입자에겐 §2.5로 점진 유도.
4. **§2.3 (고위험 서명 재인증)** — 가장 UX 영향이 크므로(L2/L3마다
   지문 요구), 제품 관점에서 별도 합의 후 진행 권장.

## 5. 한계 및 남는 리스크

- WebAuthn PRF 확장은 브라우저/OS 조합에 따라 지원이 갈린다(플랫폼
  authenticator + PRF 확장 모두 필요). 미지원 환경은 여전히
  `device_secret_fallback`로 남을 수밖에 없다 — §2.5의 지속적 업그레이드
  유도가 유일한 완화책이다.
- §2.2의 "생체인증 실패 → 초기화" 흐름은 **진짜 소유자가 지문 등록
  기기를 바꿨거나 생체인증이 일시적으로 실패한 경우**와 "중고폰이라 남의
  것"을 구분 못 한다 — 진짜 소유자가 실수로 자기 지갑을 초기화해버릴
  위험이 있다. 초기화 전 "정말 확실합니까? 이 작업은 되돌릴 수 없습니다"
  경고와, 가능하면 4단어 시드 입력으로 한 번 더 확인하는 절차를 함께
  두는 걸 권장한다.
- iOS Safari의 WebAuthn PRF 지원 시점·범위는 계속 바뀌고 있어(§3.3
  기존 문서), 실기기 테스트가 필수다 — `docs/HONDI_PHONE_FIELD_TEST_CHECKLIST_v1_0.md`에 이 시나리오들을 추가해 테스트할 것을 권장한다.
