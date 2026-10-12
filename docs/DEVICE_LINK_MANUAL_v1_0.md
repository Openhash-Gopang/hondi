# 기기 간 지갑 이전(Device-Link) 완전 매뉴얼 v1.0

> **작성일**: 2026-07-20 · **대상**: 일반 사용자 + 개발자(유지보수·확장)
> **메타 매뉴얼**: [`docs/MANUAL_INDEX.md`](./MANUAL_INDEX.md)
> **관련 코드**: `worker.js`(`/auth/device-link/*`, `/account/step-up-*`, `/auth/webauthn/*`) ·
> `auth/device-link.html`(PC) · `auth/device-link-approve.html`(폰) ·
> `auth/push-diagnose.html`(진단) · `gopang-wallet.js` · `src/gopang/services/push.js`

이 문서는 "스마트폰으로 가입한 계정으로 PC에서도 완전히 같은 지갑을 쓸 수
있게 하는 기능"(이하 device-link)을 다룹니다. 하루 동안 실사로 발견·수정한
문제들을 전부 기록해 뒀습니다 — 비슷한 증상을 다시 겪게 될 다음 개발자가
같은 시행착오를 반복하지 않도록 하는 것이 이 문서의 가장 큰 목적입니다.

---

## 1. 왜 이 기능이 필요한가

나비의 본인 인증 수단은 **스마트폰 SMS 문자 인증뿐**입니다(가입 시 1회).
그런데 지갑(GDC 서명 개인키)은 그 폰의 로컬 저장소(IndexedDB)에만 있어서,
PC에서는 원래 같은 계정을 쓸 방법이 없었습니다 — 매번 폰에서 QR을 찍거나
백업 키를 손으로 옮겨 적어야 했습니다(QR 로그인은 2026-07-19에 이미
폐기됨 — 아래 §6 참고).

device-link는 **SMS를 다시 쓰지 않으면서**(비용 절감), 은행 OTP 앱과
비슷한 방식으로 PC가 폰과 **완전히 같은 개인키**를 갖게 합니다.

---

## 2. 사용자 가이드

### 2.1 처음 PC에서 로그인할 때

1. PC 브라우저에서 `https://hondi.net/auth/device-link.html` 접속
   (또는 `webapp.html`에서 로그인 시도 시 뜨는 "이 기기는 등록된 기기가
   아닙니다" 화면의 **"스마트폰으로 이 기기 승인하기"** 버튼으로도 진입)
2. 스마트폰에 등록된 전화번호 입력(`010-1234-5678` 형식) → **"스마트폰으로
   요청 보내기"**
3. 스마트폰에 알림이 옵니다(웹푸시, 문자 아님 — 비용 없음). **알림을 탭**
4. 뜨는 화면에서 PC 정보(브라우저·OS)를 확인하고, 본인이 맞으면
   **"본인이 맞습니다 — 로그인 허용"** 탭
5. 몇 초 안에 PC 화면이 자동으로 로그인 완료 화면으로 넘어갑니다

**숫자를 옮겨 적는 단계가 없습니다** — 예전엔 폰 화면의 6자리 코드를
PC에 직접 입력해야 했지만, 2026-07-20에 구글 방식(원탭 승인)으로
단순화했습니다(§6-8 참고). 코드 자체는 여전히 내부적으로 쓰이지만
폰이 스스로 처리합니다.

### 2.2 알림이 안 올 때

화면에 **"알림이 안 왔나요? 문자로 받기"** 버튼이 있습니다 — 누르면
같은 승인 링크를 SMS로 받습니다(1안 실패 시에만 쓰는 폴백, 세션당 최대
2회까지). 그래도 안 되면 아래 §5 진단 절차를 따라 주세요.

### 2.3 고액 거래 재인증(생체인증)

일정 금액(기본 ₮100,000, 설정에서 변경 가능) 이상 GDC를 보낼 때는
지문/얼굴 인증을 한 번 더 요구합니다. **설정(좌측 메뉴 맨 아래) →
보안 — 고액 거래 재인증**에서 등록·문턱 금액 설정이 가능합니다.

---

## 3. 아키텍처

### 3.1 전체 흐름 (기기 이전)

```
PC(device-link.html)                     서버(worker.js)                    폰(device-link-approve.html)
  ─ 1회용 X25519 키쌍 생성
  ─ POST /auth/device-link/init  ──────▶  ① 전화번호로 계정 조회
                                          ② 세션 생성(KV, 90초)
                                          ③ 웹푸시 발송 ─────────────────▶  알림 도착 → 탭
                                                                              GET /auth/device-link/session
                                                                              (code·PC정보 조회)
                                                                              "본인이 맞습니다" 탭
                                          ◀──────────────────────────────  POST /auth/device-link/verify
                                          (code 자동 제출, 세션 state=approved)
                                                                              exportPrivateKey()
                                                                              + gopang_user_v4 전체를
                                                                              PC의 1회용 공개키로 봉투암호화
                                          ◀──────────────────────────────  POST /auth/device-link/deliver
  GET /auth/device-link/poll  ─────────▶  (2초 간격 폴링)
  (state=delivered → sealed 수신)
  ─ 봉투 복호화(자신의 1회용 개인키)
  ─ restoreFromPrivateKey()
  ─ localStorage.gopang_user_v4 저장
  ─ webapp.html로 이동
```

### 3.2 암호화 — X25519 봉투(seal) 방식

- PC가 세션 전용 **1회용** X25519 키쌍을 생성해 공개키만 서버로 보냄
  (개인키는 PC 메모리에만, 페이지 벗어나면 소멸 — non-extractable CryptoKey)
- 폰이 그 공개키로 `개인키(43자 base64url) + gopang_user_v4 전체`를
  ECDH+AES-GCM으로 암호화(`GopangWallet.sealForRecipient`)
- 서버는 암호화된 덩어리(`ephemeralPubKey, iv, ciphertext`)만 중계 —
  **평문 개인키를 한 번도 보지 않음**
- `gopang_user_v4`(닉네임·전화번호·guid 등)를 같이 안 보내면, PC 지갑
  키는 옮겨져도 `gopang-wallet.js`의 자동 초기화가 이 계정을 "게스트"로
  오인해 로그아웃·계정삭제 버튼이 숨겨진다 — 반드시 같이 보내야 함
  (2026-07-20 실사로 발견·수정, §6-4 참고)

### 3.3 관련 엔드포인트 전체 목록

| 엔드포인트 | 메서드 | 호출자 | 역할 |
|---|---|---|---|
| `/auth/device-link/init` | POST | PC | 세션 생성 + 웹푸시 발송 |
| `/auth/device-link/session` | GET | 폰 | code·PC정보 조회(자기 guid로만) |
| `/auth/device-link/verify` | POST | 폰(자동) | code 확인 → state=approved |
| `/auth/device-link/deliver` | POST | 폰 | 암호화된 개인키 전달 |
| `/auth/device-link/poll` | GET | PC | 전달 여부 폴링(2초 간격) |
| `/auth/device-link/resend-sms` | POST | PC | SMS 폴백(같은 세션·같은 code 재사용) |
| `/account/step-up-threshold` | GET/POST | 양쪽 | 고액거래 재인증 문턱 조회/설정 |
| `/auth/webauthn/register-key` | POST | 양쪽 | 재인증용 WebAuthn 공개키 서버 등록 |
| `/account/step-up-challenge` | POST | - | tx_hash 결박 챌린지 발급 |
| `/account/step-up-verify` | POST | - | WebAuthn assertion 서버 검증 → step_up_token 발급 |

세션 저장소는 전부 `env.QR_SESSIONS_KV`(Cloudflare KV) 재사용 — 새 바인딩
불필요.

---

## 4. 고액 거래 재인증(Step-Up) 상세

### 4.1 왜 서버가 직접 검증하는가

최초 구현은 "폰에서 생체인증 성공하면 그냥 넘어간다"는 **클라이언트
전용** 검증이었는데, 사고실험으로 **치명적 우회**가 발견됐습니다:
개발자도구에서 `sender_sig`(Ed25519 서명)만 있으면 `/wallet/gdc-transfer`
를 직접 호출해 생체인증 자체를 건너뛸 수 있었습니다. 지금은:

1. 서버가 WebAuthn 공개키를 직접 보관(`profiles.extra.webauthn_credentials`)
2. **그 거래(tx_hash)에만 유효한** 챌린지를 서버가 발급(WYSIWYS 원칙 —
   다른 거래의 assertion을 재사용 불가)
3. 서버가 ECDSA 서명을 **직접** 검증(DER→raw 변환 포함, Node.js로 8회
   반복 독립 테스트 완료)
4. 통과해야만 `step_up_token`(HMAC 서명, 2분 유효) 발급
5. `handleGdcTransfer`가 **클라이언트가 뭘 보냈든** 서버 자체 판단으로
   문턱을 조회하고, 이 토큰 없이는 무조건 거부

### 4.2 생체등록이 두 갈래로 분리된 이유

`GopangWallet.enrollWebAuthn()`(기존, PRF 확장 필수 — 로컬 저장소
재암호화용)과 `enrollStepUpBiometric()`(신규, PRF 불필요 — 서버 검증용)
는 **완전히 다른 credential**입니다. PRF는 기기·브라우저에 따라
미지원인 경우가 많아서(지문 인증 자체는 성공해도 PRF 체크에서 조용히
실패), 하나로 묶었다가 재인증 등록 자체가 막히는 사고가 있었습니다
(§6-6). Settings UI는 반드시 `enrollStepUpBiometric()`(`LS_STEPUP_CRED`)
쪽을 써야 합니다.

---

## 5. 진단 절차 (문제가 생겼을 때)

### 5.1 폰에 알림이 안 옴

`https://hondi.net/auth/push-diagnose.html`을 폰에서 열어보세요.
브라우저 알림 권한·서비스워커 상태·구독 유무·쿨다운 기록이 자동
표시됩니다. **"구독 초기화 후 재시도"** 버튼으로 즉시 재구독 가능합니다
(VAPID 키가 바뀐 경우 특히 필요 — §6-5 참고).

### 5.2 알림은 오는데 승인 화면에서 막힘

`device-link-approve.html`은 **화면 자체에 단계별 디버그 로그**가 있습니다
(코드 확인·verify·개인키 추출·PC 공개키 길이·봉투 암호화·deliver 각 단계).
USB 원격 디버깅 없이 그 로그만 보면 어느 단계에서 막혔는지 바로 압니다.

### 5.3 PC가 아무 응답이 없음

브라우저 개발자도구 Network 탭에서 `init` 요청의 Response를 확인 —
`pushSent` 값이 `true`/`false`로 서버가 실제 발송을 시도했는지 알려줍니다.

### 5.4 `wrangler tail`

가장 확실한 방법 — 실시간으로 서버 예외(스택 트레이스 포함)를 봅니다:
```powershell
cd C:\Users\<사용자>\Downloads\gopang
wrangler tail
```
이 상태로 device-link를 다시 시도하면 실제 에러가 그대로 찍힙니다.

---

## 6. 실사로 발견한 함정들 (개발자 필독)

이번 기능 하나를 완성하는 데 실제로 겹쳐 있던 서로 다른 원인 11가지를
전부 기록합니다 — 증상("안 됨")은 매번 비슷했지만 원인은 매번 달랐습니다.

### 6-1. 전화번호 형식이 표준 E.164가 아님
이 시스템은 `+82` 뒤에 **앞자리 0을 유지**한 `010`을 그대로 붙입니다
(`+8201012345678`) — 표준 E.164(앞자리 0 제거)와 다릅니다. `auth.js`의
`buildE164()`/`COUNTRIES.KR`(`prefix: "010"`)이 근거입니다. 새 코드에서
전화번호를 다룰 땐 반드시 이 관례를 따라야 합니다.

### 6-2. 계정 정체성(gopang_user_v4) 누락
지갑 개인키만 옮기고 `localStorage.gopang_user_v4`를 안 써주면, 로그아웃·
계정삭제 버튼이 이 계정을 "게스트"로 오인해 숨겨집니다 — §3.2 참고.

### 6-3. Service Worker 알림 클릭 처리
이미 열려있는 창을 그냥 `focus()`만 하고 `url`을 안 넘기면, 알림을 눌러도
새 화면으로 이동하지 않습니다. `client.navigate()`는 일부 기기(Android
Chrome 특정 조합)에서 원인불명으로 알림 클릭 자체를 무반응으로 만든
사례가 있어, device-link 알림은 `clients.openWindow()`만 쓰도록 단순화
했습니다.

### 6-4. PRF와 재인증 등록의 결합 (§4.2 참고)

### 6-5. VAPID 키 분실 → 재발급 후 재구독 필요
`applicationServerKey`가 바뀌면 브라우저가 기존 구독을 자동 갱신하지
않습니다. **기존 구독을 명시적으로 `unsubscribe()`한 뒤에만** 새 키로
재구독됩니다 — `push-diagnose.html`의 "구독 초기화 후 재시도" 버튼이
이걸 자동화합니다.

### 6-6. 하드코딩된 버전 URL이 CI 재생성에 쓸려나감
`worker.js`가 prompts 문서를 하드코딩된 GitHub raw URL로 fetch하면, 그
문서가 새 버전으로 바뀔 때마다 URL을 손으로 갱신해야 하고 안 하면
조용히 구버전을 계속 서빙합니다 — `_fetchByManifestKeyFromGithub()`
(sp-catalog.json 경유)로 전환해 구조적으로 없앴습니다. **새로 문서를
fetch하는 코드를 짤 때는 절대 URL을 하드코딩하지 말 것.**

### 6-7. Cloudflare KV `expirationTtl` 최솟값은 60초
`{ expirationTtl: 30 }`처럼 60 미만 값을 주면 `KV PUT`이 **400 에러로
예외를 던집니다.** 이게 device-link `deliver` 단계가 항상 실패하던
최종 원인이었습니다(`wrangler tail`로 실사 확인). **KV TTL은 항상 60
이상으로 설정할 것.**

### 6-8. 진단용 curl이 실제 부작용을 일으킴
`/auth/device-link/init`을 진단 목적으로 가짜 값(`pcPubKeyB64u:"test"`)
을 넣어 curl로 호출하면, 서버가 **실제로 폰에 푸시 알림을 보냅니다.**
그 알림은 진짜 세션 알림과 구분이 안 돼서, 사용자가 이를 눌러
"승인"하면 가짜 값으로 암호화를 시도하다 실패합니다. 지금은 서버가
`pcPubKeyB64u`를 32바이트(X25519 공개키 크기)인지 미리 검증해 이런
가짜 값을 애초에 거부합니다 — **진단용 API 호출도 실제 부작용(푸시
발송 등)이 있을 수 있다는 걸 항상 염두에 둘 것.**

### 6-9. `worker.js` 동시편집 충돌
여러 사람이 `worker.js`(단일 거대 파일)를 각자 로컬에서 편집하다가,
**오래된 로컬 사본으로 커밋**하면 그 사이 다른 사람이 추가한 내용이
git 히스토리상 자연스럽게 사라집니다. 이번 세션에서 device-link
관련 코드와 다른 협업자의 "시군구 리졸버" 코드가 각각 최소 2~3회
사라졌다 재적용됐습니다. **`worker.js`를 열기 직전엔 반드시
`git pull`부터 할 것** — 오래 열어둔 에디터 세션으로 커밋하지 말 것.

### 6-10. QR 로그인은 이미 폐기됨(2026-07-19)
`auth/qr-scan.html`에 "가입 시점 전화번호 문자 인증 1회만이 유일한
본인 인증 경로"라는 원칙에 따라 폐기 처리돼 있습니다. 기기 간 로그인을
다시 만들 때 QR 방식으로 되돌아가지 말 것 — 이 device-link(웹푸시+
원탭 승인)가 그 대체재입니다.

### 6-11. 코드 재입력 → 원탭 승인으로 단순화(2026-07-20)
처음엔 "PC에 뜬 6자리 코드를 사람이 폰 화면과 비교해 옮겨 적는" 방식
이었는데(구글/MS의 "번호 매칭" 패턴), "본인 확인은 이미 코드를 아는
사람(같은 guid로 세션을 조회할 수 있는 사람)"이라는 논리로 폰이 code를
**스스로** `/verify`에 제출하도록 단순화했습니다. 서버 검증 로직은
전혀 안 바뀌었고, 사람이 숫자를 옮겨 적던 단계만 없앴습니다.

---

## 7. 확장 가이드 — 비슷한 기기 간 이전 기능을 또 만든다면

1. **1회용 비대칭키 결박 원칙 재사용**: 매번 새 X25519(또는 필요시 P-256)
   키쌍을 발신 측에서 생성하고, 개인키는 그 세션에서만 메모리에 존재
   시킬 것 — `GopangWallet.generateX25519KeyPair()`/`openSealedWithKey()`
   /`sealForRecipient()`가 이미 범용으로 만들어져 있어 그대로 재사용
   가능합니다.
2. **서버는 항상 암호화된 덩어리만 중계** — 평문이 스쳐가는 지점을
   설계 단계에서부터 없앨 것.
3. **KV TTL은 60 이상**(§6-7), **URL은 절대 하드코딩 금지**(§6-6),
   **worker.js는 편집 직전 반드시 pull**(§6-9) — 세 가지는 이 저장소
   전체에 적용되는 원칙입니다.
4. **화면 자체에 디버그 로그를 남기는 패턴**(`device-link-approve.html`
   참고)은 USB 원격 디버깅이 불안정한 실제 사용자 환경에서 매우
   효과적이었습니다 — 비슷한 민감 흐름(결제 승인 등)에 그대로
   재사용을 권합니다.

---

## 변경 이력

- v1.0 (2026-07-20): 최초 작성. device-link 전체 기능 완성 시점 기록.
