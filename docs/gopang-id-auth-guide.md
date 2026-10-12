# 나비 ID·인증 통합 가이드 (Navi ID & Auth Guide)

**버전 1.0 · 2026년 6월 · AI City Inc.**

본 문서는 다음 6개 문서를 통합·정리한 것입니다. 중복 내용은 단일화하고, 서로 다른 설계 제안이 충돌하는 부분은 "현재 구현 vs 제안 설계"로 구분하여 명시합니다.

- `gopang-auth-whitepaper.md` (v1.0) — 인증 레벨·SSO 구현 가이드의 기준 골격
- `gopang-id-whitepaper.html` — ID/IPv6 변환 알고리즘 제안 설계 (GAS 차세대안)
- `gopang-auth-guide.html` — SSO 동작 원리 해설
- `Gopang_Auth_and_Discovery.html` (v2.2) — GDUDA 검색, 닉네임 중복/handle, Give&Take
- `Gopang_Address_System_v1.6.md` (GAS v1.6) — Stealth Address 등 차세대 주소체계 (참고용, 범위 외)
- `Gopang_User_Discovery_Algorithm.md` (GDUDA v1.0) — 5계층 분산 검색 알고리즘 원안

또한 2026년 6월 13일 K-Market 통합테스트 세션에서 도출된 신규 결론(온보딩 A/B/C 분기, `/profile` Ed25519 인증)을 §4·§6에 반영합니다.

---

## 목차

**1. 개요**
- 1.1 문서의 목적과 통합 대상
- 1.2 핵심 설계 철학
- 1.3 설계 계보 — 현재 구현 vs 제안 설계

**2. 사용자 정체성 — IPv6 기반 분산 신원**
- 2.1 IPv6를 정체성으로 선택한 이유
- 2.2 식별자 3단계 분리 — Primary GUID / Current IPv6 / Nickname Hash
- 2.3 현재 구현 — 기기 핑거프린트 기반 IPv6 생성
- 2.4 제안 설계 — 아이디(닉네임) 기반 IPv6 변환 (GAS ID Whitepaper)
- 2.5 정체성 저장 위치 (PDV / localStorage / Supabase)

**3. 인증 수단과 레벨 체계 (L0~L3)**
- 3.1 기기 핑거프린트 (L0)
- 3.2 얼굴 인증 (L1, MediaPipe)
- 3.3 지문 인증 (L2, WebAuthn/FIDO2)
- 3.4 4단어 시드 (L3 + 복원용)
- 3.5 하위 시스템별 최소 인증 레벨

**4. 온보딩 흐름 — 전화번호 기반 단일 경로** *(v2.0, 2026-06-15)*
- 4.1 설계 원칙
- 4.2 온보딩 단일 흐름
- 4.3 전화번호 → GUID 변환 알고리즘
- 4.4 AI 비서 API 키 설정 (온보딩 직후)
- 4.5 wallet 자동 할당 보장

**5. 하위 시스템 SSO 인증**
- 5.1 핵심 원칙 — 나비가 유일한 인증 포털
- 5.2 도메인 요건 (서브도메인 · HTTPS)
- 5.3 1단계 — subsystem-auth.js 한 줄 삽입
- 5.4 2단계 — gopang-sso.js의 4가지 경로
- 5.5 3단계 — silent-auth.html 크로스도메인 토큰 발급
- 5.6 인증 레벨별 구현 패턴 (L0~L3 코드 예시)

**6. 프로필 등록과 Ed25519 인증**
- 6.1 GopangWallet — 키페어 자동 생성
- 6.2 /profile API — Ed25519 서명 + TOFU
- 6.3 register-profile.html 흐름
- 6.4 /ai-setup API — 동일 인증 패턴 적용
- 6.5 SSO(§5)와의 관계 — 별도 인증 경로인 이유

**7. 사용자 검색 (GDUDA)**
- 7.1 GDUDA 5계층 구조와 사용자 배정
- 7.2 검색 알고리즘 — Phase 1 라우팅 / Phase 2 P2P
- 7.3 언어 코드 기반 닉네임 검색 최적화
- 7.4 중복 닉네임 — 표시 이름 모델과 handle 태그
- 7.5 IPv6 기반 분산 공개 속성 레코드 (PAR)
- 7.6 검색 소요 시간 분석

**8. 기기 변경 및 복원**
- 8.1 복원 시나리오
- 8.2 복원 흐름

**9. 거래 위험도 자동 판단 및 거래 상대방 오인 방지**
- 9.1 AI 판단 흐름
- 9.2 Give & Take 원칙 — 구조적 오인 차단

**10. 보안 분석**
- 10.1 위협 모델
- 10.2 Sybil / Eclipse 공격 방지
- 10.3 한계 및 주의사항

**11. 개인정보 보호**
- 11.1 데이터 최소화 원칙
- 11.2 법적 준수

**12. 기술 구현 현황 및 로드맵**
- 12.1 구현 완료
- 12.2 이번 세션 반영 사항 (worker.js v5.1 / register-profile.html)
- 12.3 구현 예정
- 12.4 로드맵

**부록 A — 인증 API 레퍼런스**
**부록 B — 용어 정의**

---

## 1. 개요

### 1.1 문서의 목적과 통합 대상

나비(Navi)은 현실 세계의 모든 기관·사물·개인의 AI 쌍둥이로 구축한 AI 평행 세계 플랫폼입니다. 사용자는 단일 정체성(IPv6 주소)으로 K-Law, K-Market, K-Tax, K-Health 등 수백 개의 하위 시스템에 접근합니다.

본 문서는 나비의 ID 생성, 인증 레벨, SSO, 사용자 검색(GDUDA), 그리고 2026년 6월 K-Market 통합테스트에서 새로 도출된 온보딩/프로필등록 인증 설계를 하나의 문서로 통합합니다.

### 1.2 핵심 설계 철학

```
원칙 1: 서버에 개인정보 저장 없음
  생체정보(지문·얼굴)는 사용자 기기 밖으로 절대 전송되지 않습니다.
  서버에는 공개키와 IPv6 주소만 저장됩니다.

원칙 2: Private Key 보관 불필요
  Private Key를 저장하거나 기억할 필요가 없습니다.
  생체정보와 4단어 시드로 매번 재생성합니다.

원칙 3: 단일 정체성으로 모든 하위 시스템 접근 (SSO)
  한 번 인증으로 K-Law, K-Market, K-Tax 등
  모든 하위 시스템을 이용합니다.

원칙 4: 거래 중요도에 비례한 인증 강도
  일상 조회는 기기 인증만, 고액 거래는 다중 인증으로
  보안과 편의성을 균형 있게 유지합니다.

원칙 5: 탈중앙 분산 신뢰
  중앙 서버 없이 OpenHash 분산 원장이 정체성을 보증합니다.

원칙 6 (신규): 결제 지갑과 신원 등록은 분리된 선택지다
  GDC 지갑(시드·생체 인증)을 사용하지 않는 사용자도
  검색·AI 상담·프로필 등록 등 핵심 기능을 이용할 수 있어야 합니다.
```

| 항목 | 기존 방식 | 나비 방식 |
|------|-----------|-----------|
| 신원 증명 | ID + 비밀번호 | IPv6 + 생체 |
| 서버 저장 | 개인정보 전체 | 공개키만 |
| 생체 저장 위치 | 서버 DB | 기기 Secure Enclave / PDV |
| 해킹 피해 | 전체 사용자 노출 | 개인키 추출 불가 |
| 통합 인증 | 시스템마다 별도 로그인 | IPv6 하나로 통합 |
| 기기 변경 | 비밀번호 입력 | 4단어 시드 + 생체 |

### 1.3 설계 계보 — 현재 구현 vs 제안 설계

통합 대상 문서들 사이에는 **IPv6 정체성을 만드는 방식**에 대해 두 가지 설계가 공존합니다.

| | 현재 구현 (gopang-app.js / gopang-sso.js / silent-auth.html) | 제안 설계 (gopang-id-whitepaper.html, GAS) |
|---|---|---|
| IPv6 생성 입력 | 기기 핑거프린트 (SHA-256) | 사용자 아이디(닉네임) + 지역코드 + 유형 |
| 프리픽스 | `2601:db80:` 고정 | `fd47:a3c2` (ULA) |
| 정체성 ↔ 기기 | 1:1 (기기 변경 시 갱신, 시드로 복원) | 정체성과 통신주소 분리 (Current IPv6 별도) |
| 닉네임 변경 영향 | 없음 (IPv6은 기기 기반) | IPv6 자체가 바뀌므로 별도 Current IPv6 필요 |
| 채택 상태 | 실제 동작 중 | 제안 — 미구현 |

본 문서의 §2.3은 **현재 구현**을, §2.4는 **제안 설계**를 기술합니다. 신규 개발 시 §2.3을 기준으로 하되, GAS 제안의 "Primary GUID/Current IPv6/Nickname Hash 3단계 분리"(§2.2) 개념은 향후 마이그레이션 방향으로 유효합니다.

---

## 2. 사용자 정체성 — IPv6 기반 분산 신원

### 2.1 IPv6를 정체성으로 선택한 이유

```
DID 방식:  did:gopang:a3f8c2...  → "신원을 증명하는 문서"
IPv6 방식: 2601:db80:a3f8:c291:  → "신원 그 자체이자 통신 주소"
```

IPv6 주소 공간(2¹²⁸ ≈ 3.4×10³⁸)은 지구의 모든 인류·사물·AI 쌍둥이에게 고유 주소를 부여하기에 충분합니다. 정체성과 통신 주소가 하나로 통합되어 나비의 AI 평행 세계 철학과 일치합니다.

### 2.2 식별자 3단계 분리 — Primary GUID / Current IPv6 / Nickname Hash

GAS(`Gopang_Auth_and_Discovery.html` §2.1)는 정체성·통신주소·검색키를 역할별로 분리하는 모델을 제안합니다.

```
공개키 (ECDSA/Ed25519)  ←  4단어 시드로 언제든 재생성 가능
│
├─ ① Primary GUID    — 불변 정체성 (DB 기본키)
├─ ② Current IPv6    — 현재 통신 주소 (기기 변경 시 갱신)
└─ ③ Nickname Hash   — 검색 키 (닉네임 변경 시 갱신)
```

| 식별자 | 생성 기반 | 변경 가능 여부 | 용도 |
|------|-----------|-----------|------|
| Primary GUID | SHA-256(공개키) | 영구 불변 | 정체성, DB 기본키 |
| Current IPv6 | SHA-256(기기 핑거프린트) | 기기 변경 시 갱신 | 통신 주소, P2P 연결 |
| Nickname Hash | SHA-256(나비ID) | 닉네임 변경 시 갱신 | 검색 키 |

> **현재 구현 상태**: `user_profiles` 테이블은 `guid`(text)와 `current_ipv6`(text) 컬럼을 모두 갖고 있으나, 실제 클라이언트(`gopang-app.js`)는 `USER_GUID = _USER.ipv6`로 **두 값을 동일하게 사용**합니다. 즉 Primary GUID와 Current IPv6가 아직 분리되지 않았습니다. §6에서 도입한 Ed25519 `pubkey_ed25519`가 향후 Primary GUID(=SHA-256(pubkey)) 분리의 기반이 될 수 있습니다.

### 2.3 현재 구현 — 기기 핑거프린트 기반 IPv6 생성

`gopang-sso.js`, `silent-auth.html`, `register-profile.html`이 공유하는 알고리즘입니다.

```javascript
// 1. 기기 핑거프린트 (SHA-256, 64 hex)
async function _buildDeviceFingerprint() {
  const raw = [
    navigator.userAgent, navigator.language,
    screen.width + 'x' + screen.height,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency || '',
    navigator.deviceMemory        || '',
    screen.pixelDepth             || '',
  ].join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// 2. fpHex(64 hex) → IPv6 (8그룹 × 16비트, 앞 2그룹 고정)
async function _buildIPv6Identity(fpHex) {
  const groups = [];
  for (let i = 0; i < 8; i++) groups.push(fpHex.slice(i*4, i*4+4));
  groups[0] = '2601'; groups[1] = 'db80';
  return groups.join(':');
}
```

**특성**: 자동(무의식), 빠름(0초), 기기 종속, 브라우저 업데이트 시 변경 가능 → 변경 시 §8(기기 변경 및 복원) 절차로 동일 정체성 유지.

`localStorage['gopang_user_v4']`에 다음 구조로 저장됩니다.

```json
{
  "ipv6": "2601:db80:08ce:a01c:bbd1:6a3f:462c:893b",
  "fpHex": "8f262b27...",
  "seedHex": "b43c21d6...",
  "faceVec": null,
  "authLevel": "L0",
  "registeredAt": "2026-06-13T01:34:22.670Z",
  "lastSeenAt": "2026-06-13T01:34:22.670Z"
}
```

`public.users` 테이블에 `_upsertUserRecord()`를 통해 `{ guid: ipv6, device_fp, registered_at, last_seen_at, gduda_registered, ... }`로 upsert됩니다.

### 2.4 제안 설계 — 아이디(닉네임) 기반 IPv6 변환 (GAS ID Whitepaper)

`gopang-id-whitepaper.html`은 **닉네임 자체가 주소가 되는** 차세대 설계를 제안합니다. 핵심은 "아이디만 알면 주소를 계산할 수 있어 DNS가 필요 없다"는 것입니다.

```
필드 구성 (128비트):
┌──────────────┬──────────────┬──────────┬──────┬──────────────┐
│ ULA 프리픽스 │  아이디 해시  │ 지역 코드 │ 유형 │  핑거프린트   │
│   32비트     │    48비트     │  32비트  │ 4비트│    12비트     │
│  fd47:a3c2   │SHA256(ID)앞48b│국가+광역+기초│1/2/3│SHA256(fp)앞12b│
└──────────────┴──────────────┴──────────┴──────┴──────────────┘

예) "주피터" (한국 제주 한림읍, 사람):
fd47:a3c2 : 3f7a:9c2b:e1d4 : 0052:0001 : 0abc
```

```javascript
// gopang-id-whitepaper.html 제안 — _buildGopangId()
async function _buildGopangId(username, fpHex, regionCode, userType) {
  const usernameBytes = new TextEncoder().encode(username.normalize('NFC'));
  const hashBuf = await crypto.subtle.digest('SHA-256', usernameBytes);
  const hashHex = Array.from(new Uint8Array(hashBuf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  const idHash48 = hashHex.slice(0, 12);

  const regionBits = ((regionCode.country & 0x3FF) << 22)
                    | ((regionCode.metro   & 0x7FF) << 11)
                    |  (regionCode.local   & 0x7FF);
  const regionHex = regionBits.toString(16).padStart(8, '0');

  const typeCode = { person: 1, device: 2, org: 3 }[userType] || 1;
  const fp12 = parseInt(fpHex.slice(0,3), 16) & 0xFFF;

  const ULA = 'fd47a3c2';
  const raw128 = ULA + idHash48 + regionHex
               + ((typeCode << 12) | fp12).toString(16).padStart(4, '0');

  const groups = [];
  for (let i = 0; i < 8; i++) groups.push(raw128.slice(i*4, i*4+4));
  return groups.join(':');
}
```

**충돌 확률**: 아이디 해시 48비트 충돌 확률 ≈ 1/2⁴⁸(약 281조분의 1). 읍면동 단위 핑거프린트 12비트로 동일 지역·동명·동기기 충돌까지 추가 방어.

**검색 흐름 (우체부 비유)**: `SHA256("춘향이")`의 앞 48비트만으로 담당 OpenHash 노드가 수학적으로 결정되므로, 브로드캐스트 없이 해당 노드 1개에만 질의(~50~100ms)하면 됩니다 — DHT(BitTorrent와 동일 원리).

> **도입 여부**: 이 설계는 §2.3(현재 구현)과 양립하지 않습니다 — IPv6가 "닉네임 기반"이 되면 닉네임 변경 시 정체성(IPv6)이 바뀌어 §2.2의 "Current IPv6 분리"가 선행되어야 합니다. 현재는 **미도입 상태이며, GDUDA(§7)의 닉네임 검색은 §2.3의 기기 기반 IPv6 + Nickname Hash 별도 테이블(`user_nicknames`) 조합으로 동작합니다.**

### 2.5 정체성 저장 위치 (PDV / localStorage / Supabase)

```
┌─────────────────────────────────────────────────┐
│  OpenHash 분산 원장 (공개, 불변)                  │
│  · IPv6 주소 · 공개키 · 등록 타임스탬프           │
│  · 기기 변경 이력 (해시만)                        │
├─────────────────────────────────────────────────┤
│  Supabase (현재 구현 — Phase 1 중앙 보조)         │
│  · user_profiles (guid, current_ipv6, handle, ...) │
│  · public.users (guid=ipv6, device_fp, ...)       │
├─────────────────────────────────────────────────┤
│  PDV — Private Data Vault / localStorage(기기 로컬)│
│  · gopang_user_v4: ipv6, fpHex, seedHex, faceVec   │
│  · gopang_wallet_pubkey (Ed25519 공개키)           │
├─────────────────────────────────────────────────┤
│  기기 Secure Enclave (하드웨어 보안)               │
│  · 지문 원본 · WebAuthn 개인키 · Ed25519 개인키    │
├─────────────────────────────────────────────────┤
│  사용자 오프라인 보관                              │
│  · 4단어 시드 (종이 기록 권장)                     │
└─────────────────────────────────────────────────┘
```

---

## 3. 인증 수단과 레벨 체계 (L0~L3)

### 3.1 기기 핑거프린트 (L0)

§2.3 참조. **특성**: 자동(무의식), 빠름(0초), 기기 종속.

### 3.2 얼굴 인증 (L1) — MediaPipe 온디바이스

```
카메라 (전면, facingMode: 'user')
   → MediaPipe FaceLandmarker (468개 3D 랜드마크)
   → 정규화 (코 끝 원점, 눈 간격 스케일)
   → 128차원 특징 벡터
   → PDV 저장 벡터와 코사인 유사도 비교 (임계값 90%)
```

얼굴 이미지는 기기 외부로 전송되지 않습니다. 처리 속도 0.1~0.3초, 조명·각도 허용 ±30도. Safari iOS 포함 모든 주요 브라우저 지원.

### 3.3 지문 인증 (L2) — WebAuthn/FIDO2

```
navigator.credentials.create() [등록]
  → Secure Enclave에서 키 쌍 생성
  → 개인키: Secure Enclave (외부 유출 불가)
  → 공개키: Supabase + OpenHash 등록
navigator.credentials.get() [인증]
  → 챌린지 서명 (Secure Enclave 내부)
  → Worker에서 공개키로 서명 검증
```

지원 기기: iPhone/iPad(Face ID·Touch ID), Android(BiometricPrompt), 데스크탑(Windows Hello, Touch ID). 지문 원본은 외부로 전송되지 않으며, WebAuthn 카운터로 재사용 공격을 방지하고 도메인 바인딩으로 피싱을 차단합니다.

### 3.4 4단어 시드 (L3 + 복원용)

```
사용자 입력: "제주 파란 파도 2018"
  → PBKDF2 (SHA-256, 100,000 iterations, 나비 전용 salt)
  → 256비트 시드 바이트
  → PDV에 해시값만 저장 (원문 절대 미저장)
```

**용도**: ① 기기 변경 시 정체성 복원, ② L3 고위험 거래 추가 인증, ③ 생체 인증 불가 시 비상 복원.

### 3.5 하위 시스템별 최소 인증 레벨

| 레벨 | 인증 수단 | 적용 상황 |
|---|---|---|
| L0 | 기기 핑거프린트 (자동, 0초) | 일상 접속, 조회, 검색, 대화 |
| L1 | L0 + 얼굴 (90% 이상, 1~2초) | 개인정보 열람, 10만원 미만 결제 |
| L2 | L0 + 지문/Face ID (2~3초) | 10만원 이상 거래, 계약 서명, 소송 제기 |
| L3 | L0+L1+L2 + 4단어 (5~10초) | 1,000만원 이상, 부동산, 되돌릴 수 없는 행위 |

| 하위 시스템 | 기본 | 중요 기능 |
|-------------|------|-----------|
| K-Law | L0 (조회) | L2 (소송 제기), L3 (화해·취하) |
| K-Market | L0 (탐색) | L1 (10만원↓), L2 (10만원↑) |
| K-Tax | L1 (조회) | L2 (신고 제출) |
| GDC 화폐 | L1 (잔액) | L2 (100만원↓), L3 (100만원↑) |
| K-Health | L1 (기록 조회) | L2 (처방·진단) |
| PDV 접근 | L1 (요약) | L2 (전체 열람) |
| **users.hondi.net (프로필 조회/등록)** | **L0 (Ed25519 서명만, §6)** | — |

---

## 4. 온보딩 흐름 — 전화번호 기반 단일 경로

> **v2.0 변경 (2026-06-15)**: 기존 시나리오 A(게스트)/B(GDC)/C(프로필) 3분기를 **전화번호 입력 → 즉시 GDC 사용자 등록** 단일 경로로 통합. 게스트 모드 폐지.

### 4.1 설계 원칙

```
원칙: 모든 사용자는 첫 접속 시 전화번호를 입력하고 즉시 등록된다.
      전화번호 자체가 신원이다.

현재(테스트):  전화번호 입력 → 즉시 등록 (OTP 없음)
상용화 시점:   전화번호 입력 → SMS 2FA → 등록
```

게스트(미등록) 상태는 존재하지 않습니다. 모든 접속자는 등록된 GDC 사용자입니다.

### 4.2 온보딩 단일 흐름

```
[Step 1] 전화번호 입력
  ┌────────────────────────────────┐
  │  📱 전화번호를 입력하세요        │
  │  +82 010-____-____            │
  │  [계속]                        │
  └────────────────────────────────┘
  ※ 상용화 시: SMS OTP 인증 추가 (2FA)

[Step 2] 자동 사용자 등록
  e164 = normalizePhone(input)         // '+821012345678'
  guid = SHA-256('gopang-phone:' + e164) → IPv6 변환 (2601:db80:...)
  handle = '@' + digits8               // KR: @12345678 / 비KR: @US-1234567890
  nickname_hash = SHA-256(e164)        // GDUDA 검색 키

  gopangWallet.create()                // Ed25519 키페어 자동 생성
  gopangWallet.setIdentity({ guid, handle, e164 })

  localStorage['gopang_user_v4'] = { ipv6: guid, handle, e164,
                                      country_code, nickname, ... }

[Step 3] Supabase 등록 (upsert)
  POST /p2p/register → global_profiles upsert
    { guid, handle, e164, country_code, region, current_l1, ... }

  public.users upsert
    { guid: ipv6, device_fp, registered_at, last_seen_at, gduda_registered: true }

[Step 4] 온보딩 완료 → hondi.net/webapp.html 진입
```

### 4.3 전화번호 → GUID 변환 알고리즘

handle 및 GUID 생성 규칙은 GAS v1.6 § 및 GDUDA P2P Design §2와 동일합니다.

```javascript
// 전화번호 정규화
function normalizePhone(input, countryCode = 'KR') {
  const digits = input.replace(/[^0-9]/g, '');
  if (countryCode === 'KR') return '+82' + digits.replace(/^0/, '');
  // 비KR: country dial code 자동 부착
  return '+' + dialCode(countryCode) + digits;
}

// GUID 생성 (서버 불필요 — 로컬 계산)
async function phoneToGuid(e164) {
  const buf = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode('gopang-phone:' + e164));
  const hex = Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const groups = [];
  for (let i = 0; i < 8; i++) groups.push(hex.slice(i*4, i*4+4));
  groups[0] = '2601'; groups[1] = 'db80';
  return groups.join(':');
}

// handle 생성
function phoneToHandle(e164, countryCode = 'KR') {
  const digits = e164.replace(/[^0-9]/g, '');
  if (countryCode === 'KR') return '@' + digits.slice(-8);       // @12345678
  return '@' + countryCode + '-' + digits.slice(-10);            // @US-1234567890
}
```

### 4.4 AI 비서 API 키 설정 (온보딩 직후)

등록 완료 직후, AI 비서 API 키 설정 화면을 제시합니다.

- DeepSeek / Gemini(무료 티어) / Claude 등 무료 발급처 안내
- API 키는 AES-256-GCM 암호화 후 `user_llm_keys`에 guid 기준 저장 (§6.4)
- "나중에 설정" 시 공유 크레딧 한도 내에서만 응답 — 한도 초과 시 본인 키 요구

### 4.5 wallet 자동 할당 보장

`gopang-wallet.js`는 로드 시 **항상** Ed25519 키페어를 자동 생성합니다. 전화번호 입력 후 `setIdentity()`가 호출되면 wallet과 guid가 즉시 연결됩니다.

```
gopang-wallet.js 로드
  └─ GopangWallet.load() 또는 create()
       └─ wallet.publicKeyB64u  ← 항상 존재
       └─ wallet.guid           ← 전화번호 입력 전: null
                                   setIdentity() 호출 후: ipv6 연결됨
```

| 항목 | 값 |
|---|---|
| `gopangWallet.publicKeyB64u` | 항상 존재 (로드 즉시) |
| `gopangWallet.guid` | `gopang_user_v4.ipv6` 연결 (전화번호 등록 완료 후) |
| `localStorage['gopang_user_v4']` | `{ ipv6, handle, e164, country_code, nickname, ... }` |

> **⚠️ 스토리지 키 주의**: 현재 구현은 `gopang_user_v4`를 사용합니다. 구버전 `gopang_user_v4` 참조 코드는 모두 `v4`로 교체해야 합니다 (`gopang-wallet.js` 싱글턴 초기화 포함).
## 5. 하위 시스템 SSO 인증

### 5.1 핵심 원칙 — 나비가 유일한 인증 포털

하위 서비스(K-Law, K-Market, K-Tax, K-Security 등)는 **독자적인 인증 시스템을 구현하지 않습니다.** 모든 인증은 `hondi.net`에 위임합니다.

```
[금지]
하위 서비스가 자체 로그인 화면 구현
하위 서비스가 지문·얼굴·시드를 독자 등록
하위 서비스가 gopang_user_v4를 직접 읽고 조작

[허용]
gopang-sso.js를 통한 토큰 요청
Cloudflare Worker /auth/verify로 토큰 검증
gopang_user_v4 읽기 전용 참조 (L0 기기 일치 확인만)
```

### 5.2 도메인 요건 (서브도메인 · HTTPS)

하위 서비스는 반드시 `*.hondi.net` 서브도메인을 사용해야 합니다.

```
허용: klaw.hondi.net / market.hondi.net / security.hondi.net
금지: klaw.kr / gopang-market.com / ksecurity.net
```

**이유**:
1. **WebAuthn rp.id 공유** — `rp.id: 'hondi.net'`에 바인딩된 credential은 `*.hondi.net`에서만 사용 가능. 별도 도메인 사용 시 L2 지문 인증 완전 불가.
2. **Silent iframe SSO** — `*.hondi.net`이어야 Same-Site 쿠키가 자동 전송됨.
3. **SameSite=None 쿠키** — `Domain=.gopang.net` 설정이 모든 서브도메인에 자동 적용.

WebAuthn, SameSite=None 쿠키, Service Worker는 모두 **HTTPS 환경에서만** 동작합니다. `http://` 서빙 시 L2 이상 인증이 불가능합니다.

### 5.3 1단계 — subsystem-auth.js 한 줄 삽입

`hondi.net/auth/` 디렉토리에는 인증 관련 파일이 다음 3개만 존재합니다 — 하위 시스템에 별도 `auth.js` 파일을 두지 않습니다.

```
hondi.net/auth/
  ├── gopang-sso.js        ← 중앙 인증 라이브러리 (핵심)
  ├── subsystem-auth.js    ← 하위 시스템 공용 인증 모듈
  └── silent-auth.html     ← 크로스도메인 토큰 발급기

각 하위 시스템/
  └── *.html               ← script 태그 한 줄만 삽입 (auth.js 파일 없음)
```

```html
<script type="module"
  src="https://hondi.net/auth/subsystem-auth.js">
</script>
```

`subsystem-auth.js`는 로드 즉시 `initAuth()`를 자동 실행하여 L0 인증을 수행하고, `#auth-badge`/`#auth-loading`/`#auth-modal` 엘리먼트가 있으면 자동으로 갱신합니다. 인증 완료 후 `window._onGopangAuth(user)` 콜백이 호출되며, K-Security 에이전트(`security-agent.js`)가 자동 로드됩니다(`data-security="false"`로 비활성화 가능).

### 5.4 2단계 — gopang-sso.js의 4가지 경로

`gopangAuth.require(level)` 단일 호출로 다음 4가지 경로를 순서대로 시도합니다.

```
경로 1: GWP 토큰 (URL의 gwp_token 파라미터, HMAC 서명)
   → 나비 앱이 _gwpLaunch로 하위 서비스를 호출한 경우, 사용자 인지 없이 즉시 완료

경로 2-A: sessionStorage 캐시 (gopang_sso_token)
   → 이전 인증 결과 재사용

경로 2-B: 로컬스토어 직접 대조 (same-device, gopang_user_v4 + fpHex 일치)
   → Silent iframe 없이 즉시 토큰 생성

경로 2-B(iframe): Silent iframe (hondi.net/auth/silent-auth.html)
   → 서드파티 쿠키 차단 환경에서도 postMessage로 토큰 수신 (3초 타임아웃)

경로 2-C: 리다이렉트
   → hondi.net/auth/silent-auth.html?return=...&svc=...&level=...
   → 4단어 입력 또는 신규 등록 → ?gopang_token=... 으로 복귀
```

레벨이 부족하면(`_checkLevel`) `gopangAuth.verify(level)`이 팝업(`hondi.net/auth/upgrade`)으로 상향 인증을 요청합니다.

### 5.5 3단계 — silent-auth.html 크로스도메인 토큰 발급

`silent-auth.html`은 두 가지 모드로 동작합니다.

- **Silent 모드** (`window.parent !== window`, iframe): `gopang_user_v4`를 읽어 기기 일치 확인 후 `issueToken(user, svc)`로 토큰을 발급하고 `postMessage({type:'GOPANG_SSO_TOKEN', token})`으로 부모 창에 전달
- **리다이렉트 모드**: 4단어 시드 입력 UI(`#auth-card`) 표시. 시드 일치 시 토큰 발급 후 `return` URL로 `?gopang_token=...` 부착 리다이렉트. `gopang_user_v4`가 없는 미등록 기기는 전화번호 입력 온보딩(`hondi.net?onboard=1`)으로 이동 (§4.2)

`issueToken(user, svcId)`는 `{ ver, ipv6, level, svc, iat, exp }` payload를 만들고, `user.seedHex`가 있으면 HMAC-SHA256(seedHex)로 서명합니다. 시드가 없는 사용자는 `sig: 'unsigned'`로 반환됩니다 — 이 토큰은 §6의 Ed25519 서명과는 **별개의 메커니즘**입니다 (§6.5 참조).

### 5.6 인증 레벨별 구현 패턴 (L0~L3 코드 예시)

```javascript
// L0 — 기기 인증 (기본, 모든 서비스)
const user = await gopangAuth.require('L0');
if (!user) return; // 리다이렉트 중 — 이하 실행 안 됨
initService(user);

// L1 — 얼굴 인증
async function openPersonalData() {
  const user = await gopangAuth.require('L1');
  if (!user) return;
  renderPersonalData();
}

// L2 — 지문 인증
async function submitContract(data) {
  const user = await gopangAuth.require('L2');
  if (!user) return;
  await signContract(user.ipv6, data);
}
```

---

## 6. 프로필 등록과 Ed25519 인증

### 6.1 GopangWallet — 키페어 자동 생성

`gopang-wallet.js`(v2.0.0)는 `<script src="/gopang-wallet.js">`로 로드되는 즉시 `window.gopangWallet` 싱글턴을 초기화합니다.

```javascript
// gopang-wallet.js 싱글턴 자동 초기화 (요약)
let wallet = await GopangWallet.load();
if (!wallet) {
  wallet = await GopangWallet.create();  // Ed25519 키페어 자동 생성
}
const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
if (stored?.ipv6) {
  wallet.setIdentity({ guid: stored.ipv6, handle: stored.handle || null });
}
global.gopangWallet = wallet;
```

- 개인키는 IndexedDB(AES-GCM 암호화) + localStorage 폴백에 저장
- `wallet.publicKeyB64u` (Base64URL Ed25519 공개키), `wallet.guid` (=ipv6, `gopang_user_v4.ipv6` 존재 시에만 연결)
- `wallet.sign(payload)` — Ed25519 서명, `wallet.verify(payload, sig)` — 검증

### 6.2 /profile API — Ed25519 서명 + TOFU

`/biz/product`, `/biz/review`가 이미 사용하던 `_verifyEd25519(pubkey, signature, body)` 패턴을 `/profile`, `/ai-setup`에도 동일하게 적용합니다 (worker.js v5.1).

```
요청 body = { guid, pubkey, signature, ...필드 }

서버 검증:
  1. { signature, ...rest } = body
  2. crypto.subtle.verify('Ed25519', pubkey, signature, JSON.stringify(rest))
  3. TOFU(Trust-On-First-Use):
     - user_profiles.guid = body.guid 행이 없으면 → body.pubkey를 그대로 저장
     - 행이 있으면 → 저장된 pubkey_ed25519 와 body.pubkey 일치 확인
       (불일치 시 401 PUBKEY_MISMATCH — 키 탈취/대체 차단)
```

| 엔드포인트 | 메서드 | 인증 |
|---|---|---|
| `GET /profile?guid=` 또는 `/profile/{handle}` | GET | 불필요 (공개 정보) |
| `POST /profile` | POST | Ed25519 + TOFU |
| `GET /ai-setup?guid=` | GET | 불필요 (저장값 암호화) |
| `POST /ai-setup` | POST | Ed25519 + TOFU |

> **이전 설계와의 차이**: 초기 패치(v5.0)는 `/auth/issue`(쿠키 기반 `buildToken`/`parseToken`)를 인증 수단으로 채택했으나, 실제 SSO(`gopang-sso.js`)는 이 경로를 사용하지 않고 `issueToken()`의 `{payload, sig}` 구조(HMAC, §5.5)를 사용함이 확인되어 폐기되었습니다. v5.1은 두 체계 모두를 거치지 않고, `/biz/product`와 동일한 **Ed25519 직접 서명**으로 통일했습니다.

### 6.3 register-profile.html 흐름

> 전화번호 온보딩(§4) 완료 후 호출됩니다. `gopang_user_v4`에 ipv6가 항상 존재하므로 경량 ipv6 생성 분기(`ensureIdentity`)가 불필요합니다.

```
1. <script src="/gopang-wallet.js"> 로드 → window.gopangWallet 자동 생성

2. 신원 확인
   - localStorage['gopang_user_v4'].ipv6 읽기 (항상 존재 — §4.2 보장)
   - gopangWallet.guid 미연결이면 setIdentity({ guid: ipv6, handle, e164 })

3. 기존 프로필 로드
   GET /profile?guid={ipv6} → 있으면 폼에 자동 채움

4. 3단계 폼 입력
   1단계: entity_type 선택 (person/business/org/institution)
   2단계: 이름·소개·태그·언어·위치(Kakao 지오코딩)·연락처
   3단계: 영업시간·GDC 결제 수락 여부·공개 설정

5. 제출
   payload = { guid, pubkey: wallet.publicKeyB64u, ...폼데이터 }
   signature = await wallet.sign(JSON.stringify(payload))
   POST /profile  body = { ...payload, signature }
   POST /p2p/register → global_profiles 동시 갱신 (§4.2 Step 3)

6. 응답의 handle로 /profile.html?handle=... 이동
```

### 6.4 /ai-setup API — 동일 인증 패턴 적용

`/ai-setup` POST(AI 비서 설정 저장)도 §6.2와 동일하게 `{ guid, pubkey, signature, provider, model, ai_active, api_key, custom_prompt, ... }`로 요청하며, Ed25519 검증 + TOFU(`pubkey_ed25519`) 확인 후 `user_llm_keys`에 upsert됩니다. API 키는 AES-256-GCM으로 암호화되어 저장되므로, `GET /ai-setup?guid=`는 인증 없이도 평문 키 노출 없이 현재 설정(provider, model, ai_active 등)을 조회할 수 있습니다.

### 6.5 SSO(§5)와의 관계 — 별도 인증 경로인 이유

§5의 SSO는 **"나비 계정으로 다른 *.hondi.net 서비스에 로그인"**하는 시나리오를 위한 것이고, §6의 Ed25519 인증은 **"users.hondi.net 자체에서 본인 프로필을 쓰기(write)"**하는 시나리오를 위한 것입니다.

- `register-profile.html`은 `users.hondi.net` 자체 페이지이므로 크로스도메인 SSO(silent-auth.html, iframe, 리다이렉트)가 필요 없습니다 — `window.gopangWallet`을 직접 사용
- `/profile`, `/ai-setup`의 쓰기 요청은 "이 요청이 정말 이 guid의 개인키 소유자가 보낸 것인가"를 증명해야 하며, 이는 SSO 토큰(HMAC, 세션 캐시 가능)보다 **매 요청 서명(Ed25519)**이 더 강한 보장을 제공합니다
- 두 체계는 공통적으로 `gopang_user_v4.ipv6`를 정체성의 근거로 사용하므로 **상호 호환**되며, 충돌하지 않습니다

---

## 7. 사용자 검색 (GDUDA)

### 7.1 GDUDA 5계층 구조와 사용자 배정

```
L5: 글로벌     (19개 이상 독립 운영 주체)
L4: 국가       (최소 13개 독립 기관)         예) 대한민국
L3: 광역       (16개 광역시도 노드)           예) 제주특별자치도  # 2026-07-20 정정(17→16, 전남광주 통합)
L2: 시군구     (226개 노드)                  예) 제주시
L1: 읍면동     (~3,500개 × 이중화 = 7,000)   예) 한림읍
     └── 사용자 PDV (개인 단말)
```

각 L1 노드는 `local_users`(GUID·gopang_id·공개키·endpoint·last_seen), `neighbor_l1`(인접 읍면동), `kbucket`(Kademlia K-bucket)을 유지합니다.

**신규 사용자 등록(4단계)**:
```
Step 1. L1 노드 자동 배정 — REGISTER 패킷 전송(GUID, 공개키, L1 주소, 자기 서명)
Step 2. L1→L2→L3 순차 전파(상향 Broadcasting) — 각 계층 라우팅 테이블 갱신
Step 3. OpenHash 블록 기록 — { type:"USER_REGISTER", guid, l1_node, public_key_hash, timestamp, prev_hash }
Step 4. L1 이웃 노드에 mDNS 스타일 로컬 브로드캐스트
```

> **검토 의견**: Step 2의 상향 전파는 신규 가입마다 L4까지 전파되어 사용자 증가 시 트래픽이 선형 증가합니다. 전파 범위를 L2까지로 제한하고 L3·L4는 1시간 배치 동기화(Lazy Propagation)로 처리하는 방안이 검토되었습니다.

### 7.2 검색 알고리즘 — Phase 1 라우팅 / Phase 2 P2P

검색은 가장 가까운 계층부터 순서대로 질의하며, 결과를 찾는 즉시 캐시하고 반환합니다.

| 단계 | 범위 | 방식 | 예상 지연 |
|---|---|---|---|
| 1 | 로컬 캐시 | 캐시 직접 조회 | 즉시 |
| 2 | 동일 읍면동 (L1) | mDNS 직접 조회 | ~1ms |
| 3 | 동일 시군구 (L2) | BGP 라우팅 테이블 | ~5ms |
| 4 | 동일 광역 (L3) | Kademlia XOR 룩업 | ~15ms |
| 5 | 국가·글로벌 (L4·L5) | 글로벌 인덱스 | ~50ms |

```
GDUDA_SEARCH(target_id):
  1. 로컬 캐시 확인 → 있으면 즉시 반환
  2. L1 노드 직접 질의 → 있으면 반환
  3. L2 라우팅 테이블 → target의 L1 주소 확인 → L1 직접 질의
  4. L3 Kademlia 룩업 (SHA-256(target_id) 기반)
  5. L4/L5 글로벌 인덱스 조회
  → 모든 단계 실패 시 NOT_FOUND
```

검색 완료 후, 상대방의 L1 노드 주소와 공개키를 획득하면 서버를 거치지 않고 PDV ↔ PDV 직접 E2E 암호화 통신(`DIRECT_MESSAGE` + 서명)을 시작합니다. 상대가 오프라인이면 L1 권역 DB 노드가 최대 72시간 메시지를 임시 보관합니다.

> **검토 의견**: 닉네임(`@체제수리공`) 검색과 GUID(해시값) 검색이 동일한 경로를 사용하지만, 닉네임은 DHT 라우팅 키로 직접 쓰기 어려워 별도의 닉네임→GUID 매핑 테이블을 L2 이상 노드에 캐시하는 구조가 필요합니다 → §7.3에서 해결. 또한 PDV↔PDV 직접 연결은 NAT 환경에서 STUN/TURN 홀펀칭과 모바일 푸시(FCM/APNs) 웨이크업이 별도로 필요합니다.

### 7.3 언어 코드 기반 닉네임 검색 최적화

기존(v1) `nickname_hash = SHA-256(닉네임)`은 언어 정보가 해시 생성 시점에 소멸되어 두 가지 문제가 있습니다.

- **문제 1 — 언어 간 충돌 가능성**: `SHA-256("rose")`(영어)와 `SHA-256("로즈")`(한국어)는 해시가 다르지만, "rose" 검색 시 한국어 사용자 노드까지 전수 조회할 이유가 없습니다.
- **문제 2 — 검색 범위 과잉**: "홍길동" 검색이 전 세계 L4/L5 인덱스를 조회하지만, 한국어 닉네임이 한국(KR) 노드 밖에서 발견될 확률은 통계적으로 매우 낮습니다.

**개정(v2)**: 언어 코드(BCP 47)를 해시 입력에 포함합니다. 기존 해시와 하위 호환되지 않으므로 신규 필드로 추가하고 전환 기간 동안 병행 지원합니다.

```
v1 (기존): nickname_hash = SHA-256("홍길동")
v2 (개정): nickname_hash = SHA-256("ko:" + "홍길동") = SHA-256("ko:홍길동")

다국어 별칭 등록 시 — 세 해시 모두 동일 primary_guid를 가리킴:
  nickname_hash_ko = SHA-256("ko:홍길동")
  nickname_hash_en = SHA-256("en:Hong Gildong")
  nickname_hash_zh = SHA-256("zh:洪吉童")
```

언어 코드 → 지역 노드 사전 매핑(L2 이상 노드에 정적 배포)으로 검색 시작점을 전 세계 L5가 아닌 해당 언어 주요국 L4로 즉시 좁힙니다. 예: `ko` → KR(대한민국 L4, 한국어 사용자 99% 이상). `en`은 영어권이 다수 국가에 분산되어 단일 L4로 좁히기 어려워 L5 글로벌을 유지합니다. 지역 조건이 함께 제공되면("서울에 사는 서울대 출신 홍길동") L3 닉네임 캐시로 더 좁혀 ~30ms까지 단축됩니다.

### 7.4 중복 닉네임 — 표시 이름 모델과 handle 태그

닉네임 중복을 허용하면 닉네임은 **식별자(Identifier)**에서 **표시 이름(Display Name)**으로 역할이 바뀝니다. Primary GUID의 유일성은 그대로 유지되지만, 최종 식별 부담이 다음 3계층으로 분산됩니다.

**① 나비 핸들 — `@닉네임#태그`**
```
handle = "@" + display_name + "#" + GUID[:4] (16진수)

예) 홍길동 A의 handle: @홍길동#3f7a
    홍길동 B의 handle: @홍길동#c18d

특성: 태그는 GUID에서 결정론적으로 파생 → 충돌 없음
      사용자는 닉네임만 기억, 태그는 시스템이 관리
      handle 직접 입력 시 1:1 즉시 검색 (~2ms)
      닉네임 변경 시 태그는 불변 (GUID 기반)
```

**② 검색 결과 내 맥락 필터 — PAR(공개 속성 레코드) 기반**
```
검색: "홍길동"
결과 (PAR 포함 표시):
  @홍길동#3f7a  |  제주시 이도1동  |  소프트웨어 개발자
  @홍길동#c18d  |  서울 강남구    |  변호사
  @홍길동#45fa  |  부산 해운대구  |  (비공개)
  @홍길동#9b2e  |  검증됨         |  제주대학교병원 의사
```

**③ 검증 배지(Verified Badge)**: 기관·공인은 신뢰 기관 GUID의 서명으로 검증 표시를 부여받아 동명의 일반 사용자와 구분됩니다. 검증 계층: 국가 기관 서명(최상위) → 공인 기관 서명 → 상호 보증 누적(커뮤니티 신뢰).

**검색 흐름**:
```
@홍길동#3f7a    handle 인덱스 직접 조회             ~2ms
홍길동          lang→노드 매핑 → nickname_hash      ~30ms → PAR 필터 → 사용자 선택
제주도 홍길동   L3 노드 → nickname_hash             ~20ms → PAR 필터 → 사용자 선택
```

### 7.5 IPv6 기반 분산 공개 속성 레코드 (PAR)

모든 사용자가 이미 고유 IPv6 주소를 갖고 있다는 점을 활용해, 이 주소를 **DHT 공개 레코드의 키**로도 사용하면 외부 중앙 서버 없이 OpenHash 네트워크 자체가 속성 인덱스가 됩니다.

```
검색 경로 요약:
  닉네임만            → GDUDA 닉네임 검색 → GUID 목록
  닉네임 + 속성       → GDUDA 닉네임 → IPv6 PAR 필터
  속성만              → IPv6 PAR 직접 쿼리 → GUID 목록
```

각 L1 노드는 관할 사용자의 PAR을 IPv6 키로 인덱싱·캐시하여, PDV가 오프라인이어도 TTL 기간 동안 레코드를 제공합니다. §14(속성 기반 복합 검색)의 순수 처리 시간은 약 67ms로 추정되며(전국 닉네임 인덱스 조회가 지배적 원인), 지역 조건이 함께 제공되면 L3 캐시로 ~30ms까지 단축됩니다.

### 7.6 검색 소요 시간 분석

80억 인구 기준 가정:

| 계층 | 노드 수 | 노드당 평균 사용자 |
|---|---|---|
| L1 (읍면동) | 약 500만 개 | 1,600명 |
| L2 (시군구) | 약 50만 개 | 16,000명 |
| L3 (광역) | 약 5만 개 | 160,000명 |
| L4 (국가) | 약 200개 | 4,000만 명 |
| L5 (글로벌) | 19개 이상 | 전 세계 |

검색 확률 분포와 계층별 소요 시간(네트워크+조회):

| 검색 범위 | 비율 | 합계 |
|---|---|---|
| 동일 L1 (읍면동, ~1,600명) | 40% | ~2ms |
| 동일 L2 (시군구, ~16,000명) | 30% | ~7ms |
| 동일 L3 (광역, ~160,000명) | 15% | ~20ms |
| 동일 L4 (국가, ~4,000만 명) | 10% | ~70ms |
| L5 글로벌 (80억 명) | 5% | ~200ms |

가중 평균 = (2×0.40)+(7×0.30)+(20×0.15)+(70×0.10)+(200×0.05) ≈ **약 23~24ms**.

**실질적 병목은 검색이 아니라 P2P 연결**입니다.

| 단계 | 소요 시간 | 원인 |
|---|---|---|
| 순수 검색 | ~23ms | 계층 라우팅 |
| P2P 홀펀칭 (NAT 통과) | +50–500ms | STUN/TURN 협상 |
| 모바일 절전 웨이크업 | +1–5초 | FCM/APNs 딜레이 |

DNS(평균 ~30ms, 캐시히트 90% 가정) 대비 GDUDA 검색 자체(~23ms)는 동등하지만, 연결 단계까지 포함한 체감 총 소요는 DNS의 즉시(중앙서버) ~50ms와 달리 GDUDA는 0.1초~5초입니다. 자주 통신하는 상대는 **Persistent Connection Pool**로 상시 연결을 유지하는 전략이 필요합니다.

---

## 8. 기기 변경 및 복원

### 8.1 복원 시나리오

| 상황 | 복원 방법 | 소요 시간 |
|------|-----------|-----------|
| 앱 갱신 (기기 동일) | L0 자동 | 0초 |
| 브라우저 변경 | 4단어 입력 | 30초 |
| 폰 기기 변경 | 4단어 + 얼굴 또는 지문 | 1~2분 |
| 폰 분실 + 생체 손상 | 4단어만으로 복원 | 2~3분 |
| 4단어 분실 | **복원 불가** — 해당 GUID 정체성 영구 소멸. 종이 보관 필수 | — |

### 8.2 복원 흐름

```
새 기기 접속
   → gopang_user_v4 없음 감지
   → 온보딩 화면: 전화번호 입력
        └─ GUID = SHA-256('gopang-phone:' + e164) → 동일 정체성 즉시 복원 (§4.3)
        └─ gopangWallet.setIdentity({ guid, handle, e164 })

   ※ 생체(얼굴/지문)는 새 기기에서 재등록 필요
   ※ 4단어 시드가 있으면 L3 거래 즉시 복원 가능
   ※ 기기 핑거프린트 불일치 시에도 전화번호 일치로 동일 guid 확인됨
```

4단어 시드 보유 사용자는 기존 흐름도 유효합니다:

```
4단어 시드 입력 → PBKDF2(입력값) == PDV 저장 해시?
   일치 ✅ → 기기 핑거프린트 갱신, IPv6 정체성 유지
             → 얼굴 또는 지문 재등록 (선택)
   불일치 ❌ → 재입력 요청 (3회 실패 시 잠금)
```

`gopang-sso.js`/`silent-auth.html` 차원에서는, `_tryLocalStore()`가 같은 브라우저의 `localStorage['gopang_user_v4']`를 읽고 현재 기기의 `_buildDeviceFingerprint()`와 대조합니다. 일치하면 토큰을 즉시 발급하고, 불일치 시 `silent-auth.html`의 리다이렉트 모드(전화번호 재입력 또는 4단어 입력 UI)로 전환됩니다.

---

## 9. 거래 위험도 자동 판단 및 거래 상대방 오인 방지

### 9.1 AI 판단 흐름

```
AI 비서 (1차 판단)
  사용자 지시 문맥 분석 → 금액·행위 유형·되돌림 가능성 평가
  → [AUTH:Lx] 태그로 인증 레벨 결정
        ↓
하위 시스템 (2차 강제)
  코드 레벨에서 최소 인증 레벨 강제 — AI 판단보다 낮으면 무조건 상향
        ↓
사용자 (최종 승인)
  AI가 결정한 레벨 확인 → 인증 실행 또는 거래 취소
```

| 조건 | 인증 레벨 |
|------|-----------|
| 정보 조회·계산·대화 | L0 |
| PDV 개인정보 열람, 10만원↓ 결제 | L1 |
| 10만원↑ 금융 거래, 계약 서명, 소송 | L2 |
| 1,000만원↑, 부동산, 되돌릴 수 없는 행위 | L3 |

**예시 판단 흐름**:
```
사용자: "A 계좌로 500만원 보내줘"
  → AI 내부 판단: 금융거래(ECO) · 500만원>10만원 → L2 · 타인계좌 송금 → L2 확정 · 되돌릴 수 있음 → L3 아님
  → 응답: "[AUTH:L2] 500만원 송금은 지문 인증이 필요합니다. 진행하시겠습니까?"
  → 사용자: "진행해" → 지문 인증 실행 → [AUTH_CONFIRMED:L2] → 송금 실행
```

### 9.2 Give & Take 원칙 — 구조적 오인 차단

닉네임 중복(§7.4)으로 인해 "제주도 사는 홍길동"에게 송금하려다 "서울 사는 홍길동"에게 잘못 입금하는 시나리오는, 다음 원칙으로 구조적으로 차단됩니다.

> **모든 거래는 반드시 한 쌍의 가치를 서로 주고받는 Give & Take로 구성되며, Give와 Take는 상호 동등하다.**

```
거래 = {
  give : { party: pguid-A, value: "GDC 100만원" },
  take : { party: pguid-B, value: "서비스 또는 재화" },
  signatures: [
    ECDSA(give + take, A의 개인키),   ← A의 서명
    ECDSA(give + take, B의 개인키)    ← B의 서명
  ]
}
→ B의 서명은 B의 기기에서 B의 개인키로만 생성 가능.
→ "서울 홍길동"의 기기에서 생성된 서명은
   "제주 홍길동"의 pguid를 포함한 페이로드에 절대 일치하지 않음.
```

| 상황 | 결과 |
|---|---|
| 잘못 선택된 B가 거래 요청 수신 | B는 예상치 못한 내용에 서명하지 않음 → 트랜잭션 미완결 |
| 잘못 선택된 B가 실수로 서명 | B가 동의한 가치 교환 → 법적으로 유효한 거래 성립 |
| A가 서명 전 수신자 GUID 확인 | 페이로드에 pguid 명시 → 선택 오류 인지 가능 |

세부 구현(수신자 신원 카드, QR 기반 확정, 지연 실행, 사후 구제)은 `gdc.hondi.net`(거래 프로토콜), `market.hondi.net`(거래 UI·수신자 확인), `security.hondi.net`(이상 거래 탐지·사후 구제) 각 하위 시스템에서 정의합니다. 본 문서는 **닉네임 검색 결과의 오인이 거래 완결로 이어지지 않음을 구조적으로 보장한다**는 원칙만 명시합니다.

---

## 10. 보안 분석

### 10.1 위협 모델

| 위협 | 대응 | 결과 |
|------|------|------|
| 서버 해킹 | 공개키만 저장 | 공개키는 쓸모없음 |
| 기기 도난 | 생체 인증 필수 | 타인 지문 인식 불가 |
| 4단어 도용 | 4단어만으론 L3 불가 (생체 병행) | 단독 사용 불가 |
| 중간자 공격 | WebAuthn 도메인 바인딩 | 피싱 사이트에서 서명 무효 |
| 재사용 공격 | WebAuthn 카운터 | 동일 서명 재사용 불가 |
| 얼굴 사진 공격 | 3D 랜드마크 + 라이브니스 | 사진으로 통과 불가 |
| 딥페이크 | 90% 유사도 + 랜드마크 깊이값 | 2D 영상으로 통과 어려움 |
| `/profile` 키 탈취·대체 | TOFU + `pubkey_ed25519` 일치 확인 (§6.2) | 등록된 키 외 쓰기 거부 |

### 10.2 Sybil / Eclipse 공격 방지

**Sybil 공격 방지** — 신규 등록 시 요구사항:
```
1. ECDSA/Ed25519 서명 (키 생성 비용)
2. L1 노드의 신원 검증 (최소 1개 기존 사용자 보증 또는 기관 확인)
3. OpenHash 스테이킹 (최소 1 토큰 — 스팸 방지)
4. 이중 등록 방지: GUID 유일성을 L4/L5에서 검증
```

**Eclipse 공격 방지**:
```
- 복수 L1 노드에 동시 등록 (이중화)
- Kademlia K-bucket의 XOR 거리 다양성 유지
- OpenHash ILMV(양방향 계층 검증)로 라우팅 테이블 무결성 감사
```

### 10.3 한계 및 주의사항

```
1. 4단어 시드 분실 시 복원 불가
   → 안전한 오프라인 장소에 보관 필수

2. 브라우저 데이터 삭제 시 PDV 소실
   → 지문·얼굴 재등록 필요 (정체성 복원은 4단어로 가능)

3. 동일 기기 다른 브라우저
   → PDV는 브라우저 단위 격리 → 4단어로 복원 후 재등록

4. iOS Safari WebAuthn 제한
   → Face ID는 지원, Touch ID는 부분 지원

5. 전화번호만으로 등록한 사용자 (4단어 시드 미설정)
   → 기기 변경 시 같은 전화번호로 guid를 재계산하면 정체성은 복원 가능
   → 단, 얼굴/지문 등 생체 인증은 새 기기에서 재등록 필요
   → 고액 거래·프로필 소유권 분쟁 방지를 위해 설정에서 4단어 시드 등록 강권
```

---

## 11. 개인정보 보호

### 11.1 데이터 최소화 원칙

```
수집하지 않는 것:
  · 이름, 주민번호, 전화번호
  · 생체 이미지 (얼굴 사진, 지문 이미지)
  · 위치 원본 (좌표만 임시 사용)
  · 구매 이력, 행동 패턴

서버에 저장하는 것 (최소한):
  · IPv6 정체성 (공개 가능)
  · WebAuthn/Ed25519 공개키 (공개 가능)
  · 등록·접속 타임스탬프

기기에만 저장하는 것 (PDV):
  · 얼굴 벡터 128차원 (수치, 이미지 아님)
  · 시드 해시 (원문 아님)
  · 대화 이력
```

GAS(`Gopang_Auth_and_Discovery.html` §15)의 PUBLIC/SEMI-PUBLIC/PRIVATE 3계층 모델(`user_profiles.extra` JSONB의 `public{}`/`semi{}`/`private{}`)도 이 원칙을 따릅니다 — PUBLIC은 인증 불필요(이름, handle, 영업시간 등), SEMI-PUBLIC은 JWT 인증 필요(정밀 위치, 상세 연락처), PRIVATE은 본인+권한자만(재무 상세, 거래 이력).

> **§6.2의 `GET /profile` 현황**: 현재는 PUBLIC/SEMI/PRIVATE 마스킹 없이 `user_profiles` 행 전체를 반환합니다. 운영 전 PRIVATE 필드(특히 `extra.private.*`) 마스킹 처리가 필요합니다 — §12.3 참조.

### 11.2 법적 준수

| 규정 | 준수 방법 |
|------|-----------|
| GDPR | 개인정보 서버 미저장, 처리 목적 명확 |
| 개인정보보호법 | 생체정보 서버 미전송 |
| FIDO2 표준 | WebAuthn W3C 표준 준수 |

---

## 12. 기술 구현 현황 및 로드맵

### 12.1 구현 완료

| 기능 | 상태 | 비고 |
|------|------|------|
| IPv6 정체성 생성 (기기 핑거프린트 기반) | 완료 | §2.3 |
| 기기 핑거프린트 (L0) | 완료 | 자동 로그인 |
| 얼굴 인증 (L1) | 완료 | MediaPipe 온디바이스 |
| WebAuthn 지문 (L2) | 완료 | Supabase 공개키 저장 |
| 4단어 시드 (L3) | 완료 | PBKDF2 해시 |
| 기기 변경 복원 | 완료 | 4단어 + 생체 |
| SSO 토큰 (HMAC) | 완료 | §5.4-5.5 |
| 거래 위험도 AI 판단 | 완료 | system prompt §9 |
| [AUTH:Lx] 자동 인증 | 완료 | AI 응답 태그 파싱 |
| 설정 화면 보안 섹션 | 완료 | 지문·얼굴 재등록 |

### 12.2 이번 세션 반영 사항 (2026-06-15 / v2.0)

| 기능 | 상태 | 비고 |
|------|------|------|
| 온보딩 단일화 — 전화번호 입력 즉시 GDC 등록 | 설계 완료, 구현 대기 | §4 — 게스트·B·C 분기 폐지 |
| 전화번호 → GUID/handle 변환 알고리즘 | 설계 완료 | §4.3, GDUDA §2 동기화 |
| `gopang_user_v3` → `gopang_user_v4` 키 통일 | 설계 완료, 구현 대기 | gopang-wallet.js, gopang-app.js 패치 필요 |
| `/profile` GET/POST (Ed25519+TOFU) | worker.js v5.1 패치 완료 | §6.2 |
| `/ai-setup` Ed25519+TOFU 전환 | worker.js v5.1 패치 완료 | §6.4 |
| `register-profile.html` | 구현 대기 | §6.3 — ensureIdentity() 분기 제거됨 |
| `user_profiles.pubkey_ed25519` 컬럼 | **확인 필요** | `/biz/product`가 이미 참조하나 스키마 존재 여부 미확인 |

### 12.3 구현 예정

| 기능 | 예정 | 비고 |
|------|------|------|
| `gopang-app.js` 온보딩 전화번호 입력 UI 구현 | 다음 세션 | §4.2 — `_showRegisterUI()` 전면 교체 |
| `gopang-wallet.js` v3 키 → v4 키 마이그레이션 | 다음 세션 | 기존 기기 하위호환 처리 필요 |
| `register-profile.html` 3단계 폼 구현 | 다음 세션 | §6.3 |
| SMS 2FA (상용화 시) | Phase 2 | 현재는 전화번호 입력만으로 즉시 등록 |
| `GET /profile` PUBLIC/SEMI/PRIVATE 마스킹 | Phase 2 | §11.1 |
| OpenHash 공개키 등록 | Phase 2 | 완전 탈중앙 |
| 얼굴 라이브니스 감지 | Phase 2 | 딥페이크 방어 |
| 다기기 지문 동기화 | Phase 2 | OpenHash 기반 |
| 언어코드 기반 닉네임 해시(v2) | Phase 2 | §7.3 |
| IPv6 PAR(분산 공개 속성 레코드) | Phase 3 | §7.5 |
| Primary GUID/Current IPv6/Nickname Hash 3단계 분리 | Phase 3 | §2.2 |

### 12.4 로드맵

```
Phase 1 (현재) — 브라우저 기반 구현
  ✅ IPv6 정체성 (기기 핑거프린트 기반)
  ✅ MediaPipe 얼굴 / WebAuthn 지문 / 4단어 시드
  ✅ 거래 위험도 AI 자동 판단
  ✅ /profile, /ai-setup Ed25519 인증 (이번 세션)
  ⏳ 온보딩 A/B/C 분기 (다음 세션)

Phase 2 — OpenHash 연동 + 검색 최적화
  OpenHash에 공개키 직접 등록 (서버 없이 하위 시스템이 공개키 조회)
  다기기 지문 인증 동기화
  언어코드 기반 닉네임 검색(v2) 도입
  GET /profile PUBLIC/SEMI/PRIVATE 마스킹

Phase 3 — 고도화
  퍼지 추출기, 얼굴 라이브니스, 완전 오프라인 인증(L2까지)
  IPv6 PAR 분산 속성 레코드
  Primary GUID/Current IPv6/Nickname Hash 3단계 분리
  네이티브 앱 전환 (실제 IPv6 소켓 바인딩)
```

---

## 부록 A — 인증 API 레퍼런스

| 엔드포인트 | 메서드 | 인증 | 설명 |
|---|---|---|---|
| `/auth/issue` | POST | — | (구) 쿠키 토큰 발급 — 신규 코드에서 사용 안 함 |
| `/auth/verify` | POST | 쿠키 | (구) 쿠키 토큰 검증 |
| `/auth/refresh` | POST | 쿠키 | (구) 쿠키 토큰 갱신 |
| `/auth/webauthn/challenge` | GET | — | WebAuthn 챌린지 발급 (L2 등록용) |
| `/auth/webauthn/register` | POST | — | WebAuthn 공개키 등록 |
| `/auth/webauthn/verify` | POST | — | WebAuthn 서명 검증 → L2 토큰 |
| `hondi.net/auth/gopang-sso.js` | (모듈) | — | §5.4 — `gopangAuth.require(level)` |
| `hondi.net/auth/subsystem-auth.js` | (모듈) | — | §5.3 — 하위 시스템 1줄 삽입 |
| `hondi.net/auth/silent-auth.html` | (페이지) | — | §5.5 — 크로스도메인 토큰 발급 |
| `GET /profile?guid=` 또는 `/profile/{handle}` | GET | 불필요 | §6.2 — 공개 프로필 조회 |
| `POST /profile` | POST | Ed25519+TOFU | §6.2 — 프로필 등록/갱신 |
| `GET /ai-setup?guid=` | GET | 불필요 | §6.4 — AI 비서 설정 조회 |
| `POST /ai-setup` | POST | Ed25519+TOFU | §6.4 — AI 비서 설정 저장 |
| `/search` | POST | — | search_entities RPC 프록시 |
| `/geocode` | GET | — | Kakao coord2address (서버측 키) |
| `/biz/profile/{handle}` | GET | — | 사업자 프로필+상품+리뷰 조합 조회 |
| `/biz/order` | POST | L1 위임 | 주문 (Worker 검증 없음) |
| `/biz/review`, `/biz/product` | POST | Ed25519 | `/profile`과 동일 패턴의 원조 |

---

## 부록 B — 용어 정의

| 용어 | 정의 |
|---|---|
| PDV | Private Data Vault — 사용자 개인 데이터 저장소 (기기 로컬) |
| OpenHash | 5계층(L1~L5) 분산 해시체인 네트워크. 위변조 불가 영구 기록 |
| GDUDA | Navi Distributed User Discovery — 분산 사용자 검색 알고리즘 |
| GAS | Navi Address System — 나비 주소(IPv6 정체성) 체계 |
| fpHex | 기기 핑거프린트의 SHA-256 해시 (64 hex) |
| ipv6 / Current IPv6 | `2601:db80:` + fpHex 기반 변환 주소. 현재 구현의 사용자 식별자 |
| Primary GUID | (제안) SHA-256(공개키) 기반 불변 정체성. 현재는 ipv6와 동일하게 취급 |
| Nickname Hash | 닉네임의 SHA-256(또는 언어코드 포함 SHA-256, §7.3) — 검색 키 |
| GWP | Navi Wallet Protocol — 나비 앱이 하위 서비스를 호출하는 토큰 전달 방식 |
| TOFU | Trust-On-First-Use — 최초 등록 시의 공개키를 신뢰하고, 이후 동일 키만 허용 |
| PAR | Public Attribute Record — IPv6 키 기반 분산 공개 속성 레코드 |
| handle | `@닉네임#GUID앞4자리` 형식의 유일 식별자 (표시이름과 분리) |
| L0~L3 | 인증 레벨 — 기기/얼굴/지문/시드 |
| GDC | 나비 발행 화폐 단위 (₮) |
