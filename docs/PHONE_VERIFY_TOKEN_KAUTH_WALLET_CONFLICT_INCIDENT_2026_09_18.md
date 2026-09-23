# 메인 챗 인증 회귀 → 잘못된 대응(KAuth 신규 도입) → 기존 지갑 시스템과
충돌 → 전면 롤백 → "공용 PC" 기능 자체가 원래 고장나 있었음 발견·수정 →
기기 오등록으로 인한 push 오배송까지 (2026-09-18 ~ 09-19)

`AI 오류: HTTP 400` 하나에서 시작해 만 하루 가까이 이어진 사고입니다.
서버 인증 정책 변경 → 잘못된 클라이언트 대응 → 기존 인증 아키텍처와의
충돌 → 그 충돌이 만든 2차 장애(SW 재등록 폭주 → push 구독 붕괴) →
근본 기능(공용 PC 로그인) 자체의 선행 결함 발견 → 기기 관리 자기서비스
신설 → 그 기능 자체의 결함 → 마지막엔 **엉뚱한 DB 인스턴스를 보고
있었다는 조사 실수**까지, 단계마다 뭘 잘못 판단했는지 그대로 기록합니다.
다음에 비슷한 "인증이 갑자기 막힌다"류 증상을 보면 여기부터 먼저 확인할 것.

## 1. 증상 — 메인 챗 전체가 HTTP 400으로 막힘

주피터 실사 재현: `desktop.html`/`webapp.html`에서 어떤 메시지를 보내도
`AI 오류: HTTP 400`. 페르소나 호출("피부과 의사 AI 불러 줘")은 물론
"지금 내가 어디 있지" 같은 단순 질문까지 전부 동일하게 실패.

## 2. 원인 — 어제(09-17) 서버 게이트가 `/deepseek`·`/chat/completions`에
   `phone_verify_token`을 새로 요구하기 시작

`worker.js` 커밋 `9a1d131a`("AI 서비스 인증을 디스패치 지점 공용 게이트
하나로 통합", 주피터 지시 — 익명 체험 대신 가입 시 GDC 지급으로 전환)가
`MANDATORY_AUTH_PATHS`에 `/chat/completions`·`/deepseek`를 포함시켰다.
그런데 이 두 경로를 실제로 호출하는 클라이언트 측 코드(`call-ai.js`,
`webapp.html`의 AI 패널, `pages/expert-chat.html`, `pages/profile-assistant.html`,
`send-message.js`, `services/klaw.js` — 총 6개 파일 9개 호출부)는 이
필드를 보내는 배선이 전혀 없었다. 서버는 항상 `MISSING_FIELD` →
`LOGIN_REQUIRED`(400)로 거부.

## 3. 잘못된 1차 대응 — 이미 있던 인증 시스템을 모른 채 새 인증 모듈을 도입

K-Plan/K-Law/K-Mail이 쓰던 공용 로그인 모듈(`auth/k-service-auth-client.js`,
`window.KAuth`, 전화번호 device-link 기반)을 메인 챗에도 그대로 이식해
9개 호출부 전부에 `phone_verify_token`을 채워 넣었다. 표면적으로는
동작했으나, **이 앱에는 이미 완전히 별도의 지갑 기반 세션 인증 시스템이
있었다**는 사실을 확인하지 않고 진행한 게 근본 실수였다:

- `src/gopang/core/auth.js`의 `_issueSession()` — Ed25519 키 서명 기반
  세션 발급(로그인 = "그 guid에 핀(pin)된 개인키를 갖고 있다"는 증명)
- `gopang-wallet.js`의 `window.gopangWallet` — 로컬(IndexedDB) 지갑,
  기기 간 이전은 `/auth/device-link.html`을 통한 push 승인 방식

두 시스템 모두 내부적으로 **같은** `/auth/device-link/*` 엔드포인트를
공유했다. 실사 재현: `pages/expert-chat.html`에서 KAuth 로그인 오버레이와
기존 "GopangWallet PC/미확인 기기" 안내가 **동시에 화면에 겹쳐서** 뜸.
여러 차례의 임시 수정으로도 근본적으로 해소되지 않았고, 결국 주피터
지시로 KAuth를 **전면 롤백**했다(`worker.js`의 `MANDATORY_AUTH_PATHS`에서
두 경로 제거 포함). 메인 챗 인증은 기존 지갑 세션 하나에만 맡기는 것으로
정리.

**교훈**: 서버가 새 인증 요구사항을 추가했을 때, "이 요구사항을 만족시킬
클라이언트 코드가 없다"는 사실만 보고 새로 만들기 전에, **이 앱에 이미
동등한 역할을 하는 인증 체계가 있는지부터 저장소 전체를 검색해서 확인할
것.**

## 4. 롤백 이후 새로 드러난 진짜 버그 — SW가 설치 즉시 자체적으로
   `self.skipWaiting()`을 호출

KAuth를 걷어낸 뒤에도 증상이 남았다: "device-link 인증에 매번 성공하는데,
다음 지시를 내리면 또 인증을 요구한다"는 무한 반복. `sw.js`의 `install`
핸들러가 새 SW 설치 즉시 무조건 `self.skipWaiting()`을 호출해, 이 세션
동안 연달아 10회 이상 배포될 때마다 열려있는 모든 탭에 즉시
`controllerchange` → `window.location.reload()`가 발사되고 있었다.
폰에서 device-link 승인이 실제로 성공한 그 짧은 순간, 결과를 폴링으로
받아 `persist()`하기 전에 새 SW가 먼저 활성화되며 페이지가 통째로
새로고침돼 — 성공한 인증 결과가 저장되기 전에 매번 날아가고 있었다.

**수정**: `install`에서 자체 `self.skipWaiting()` 호출 제거 — 클라이언트가
명시적으로 `{type:'SKIP_WAITING'}` 메시지를 보낼 때만 활성화되도록 변경.
`gopang-pwa.js`의 자동 새로고침 트리거에도 로그인 오버레이가 떠 있으면
새로고침을 미루는 방어를 추가.

## 5. 그 SW 폭주가 남긴 2차 피해 — push 구독 붕괴 (당일 오후 재발견)

같은 날 오후, PC 로그인 시 `wallet_not_ready` → "이 계정에 등록된
스마트폰이 없습니다" 오류가 새로 나타남 — 그런데 같은 날 초반엔 같은 폰으로
device-link가 여러 번 실제로 성공했었다. 원인 사슬: SW가 하루에 십수 번
재등록됨(§4) → push 구독은 SW 등록에 종속된 리소스라 그 폰의 구독
endpoint가 무효화됨 → 서버가 다음 발송 시도에서 410(Gone)을 받고
자동으로 그 구독을 계정에서 삭제(pruning) → `gopang-app.js`의 자동
재구독 로직은 24시간 쿨다운이 걸려 있어 당일 안에 스스로 복구 안 됨.
`?resetpush=1` 방문으로 즉시 재구독시켜 해결.

## 6. 별개로 확인·수정한 것

`pages/expert-chat.html`의 옛 과금 안내 배너("첫 1일 무료... 월 9,900원
GDC 자동청구") 삭제 — webapp.html용으로 만들어졌던 문구가 잘못
노출되고 있었고, 그마저 현재 webapp.html의 실제 과금 안내(100원 무료
사용량 소진 방식)와도 안 맞는 옛 버전이었음.

## 7. "PC는 인증 기기가 아니다" 원칙 재확인 — 그런데 그 구현이 원래부터
   고장나 있었음

주피터 지적: "PC는 기본적으로 사용자 인증 장치가 아니며, 오직 폰에서
전화번호로 본인 인증 후 사용자 등록된다. PC에서 로그인하려면 자신의
폰에서 확인 버튼을 눌러야 한다." — 정확한 원칙이고, 이걸 구현하는
"공용 PC"(`GopangWallet.createSessionSignProxy()` — 개인키를 PC에
저장하지 않고 서명마다 폰 승인을 원격으로 거치는 방식)도 2026-07-23에
이미 만들어져 있었다. 그런데 **로그인 진입점(`_loginExisting()`)이 이
기능을 한 번도 쓴 적이 없었고**, 그걸 연결하려던 중 더 근본적인 걸
발견했다:

`_issueSession()`은 서명 전에 `wallet.publicKeyB64u`(속성)와
`wallet.signPayload()`(메서드)를 요구하는데, `SessionSignProxy`는
`.sign()` 메서드만 있고 `publicKeyB64u`는 아예 없었다 — **즉 "공용 PC"
기능은 2026-07-23에 만들어진 이래 단 한 번도 실제로 작동한 적이
없었다.** 서버의 `GET /wallet/x25519`에 `ed25519_pubkey`를 함께
반환하도록 확장하고, `SessionSignProxy`가 `setIdentity()` 시점에 이를
미리 조회해 `publicKeyB64u`를 채우도록 수정, `signPayload()` 별칭 추가.
이후 `_loginExisting()`의 `wallet_not_ready` 분기에서 "전용/공용 PC"
선택을 제공하도록 연결.

또한 이 공용 PC 서명 위임 팝업(`device-link.html?purpose=sign_request`)이
로그인 화면에서 이미 입력받은 전화번호를 서명할 때마다 다시 처음부터
입력받고 있던 것도 발견 — 기존에 있던 `PREFILLED_PHONE`(`?phone=`)
경로를 이 팝업도 쓰도록 연결해 해결.

**교훈**: "이미 만들어진 기능이니 연결만 하면 된다"고 가정하지 말 것 —
연결 지점을 만들기 전에 그 기능이 실제로 자기 소비자(여기선
`_issueSession()`)의 인터페이스를 만족하는지 먼저 확인해야 한다.

## 8. 기기 삭제 자기서비스 기능 신설 — 그리고 그 기능 자체의 결함

PC(Edge)에서 Opera로 로그인을 시도했더니 승인 알림이 실제 폰이 아니라
Edge 자신에게 갔다. `push_subscription`에 잘못 `mobile`로 등록된
기기가 있으면, 정작 그 기기 자신은 지갑이 없어(`postPushSubscribe()`가
요구하는 서명을 할 수 없어) 스스로는 절대 그 등록을 고칠 수 없는
구조적 문제였다. `GET /account/devices`(목록 조회, 읽기 전용)와
`POST /account/remove-device`(Ed25519 서명=폰의 승인으로 특정 기기
삭제)를 신설, `push-diagnose.html`에 "등록된 기기 목록" UI 추가 —
§7의 `SessionSignProxy`를 그대로 재사용해 요청하는 기기와 서명하는
기기를 분리했다.

그런데 이 기능도 배포 직후 결함이 드러났다: 삭제 대상 기기 자신이
`mobile`로 등록돼 있으면, "그 기기를 지워달라"는 승인 요청 자체가 그
기기에도 함께 발송됐다(자기 자신을 지우라는 알림이 자기에게 옴) —
주피터가 직접 지적. `excludeDeviceId`를 요청 경로 전체(`push-diagnose.html`
→ `gopang-wallet.js`의 `_openSignRequestPopup`/`SessionSignProxy.sign()`
→ `device-link.html` → `worker.js`의 `handleDeviceLinkInit`)에 관통시켜,
삭제 대상 기기는 그 승인 알림의 발송 대상에서 제외하도록 수정.

## 9. 최종 조사에서 발견한 실수 — 처음부터 엉뚱한 DB를 보고 있었음

Edge를 지워도 "이 계정에 등록된 스마트폰이 없습니다"만 반복되자,
`sqlite3`로 `profiles.push_subscription`을 직접 조회했다. 그런데
서버(`l1-hanlim-new`)에서 조회한 서비스는 `gopang-pb-l3-jejudo.service`
(`--dir=/opt/gopang/pb/l3-jejudo`)였다 — **`worker.js`가 실제로 읽고
쓰는 곳은 `L1_DEFAULT = 'https://l1-hanlim.hondi.net'`인데, 그 서버엔
`gopang-pb-hanlim.service`(접두사 없이 `hanlim`)라는 별도 인스턴스가
따로 있었다.** 같은 물리 서버(`l1-hanlim-new`)에 지역별 L1 인스턴스가
40개 넘게(`l1-aewol`, `l1-ara`, ... ) 함께 떠 있고, `l2-jeju`,
`l3-jejudo`, `l4-kr`, `l5-global` 같은 상위 계층 인스턴스까지 같이
있어서, 이름이 비슷한 완전히 다른 DB를 한참 들여다보고 있었던 것이다.

`wrangler tail`로 실시간 push 발송 로그(`발송 성공: 201
wns2-pn1p.notify.windows.com/...`)와 SQLite 조회 결과가 계속 어긋나는
걸 보고서야 이 실수를 알아챘다. 진짜 `hanlim` 인스턴스(`/opt/gopang/pb/hanlim/data.db`)를
찾아 다시 조회하니, Edge가 정확히 `mobile`로(그것도 방금 갱신된
시각으로) 등록돼 있었다 — 처음 의심이 맞았고, 단지 증거를 엉뚱한
곳에서 찾고 있었을 뿐이었다. 서비스를 멈추고 그 기기 항목만 배열에서
제거한 뒤 재시작, 이후 실제 스마트폰에서 `?resetpush=1`로 재등록시켜
정상화 완료(`device-link-approve.html`의 승인 로그가 생체인증→서명→
deliver까지 전체 완료로 끝나는 것까지 확인).

**교훈**: 여러 지역별 DB 인스턴스가 이름이 비슷하게 병렬로 떠 있는
환경에서는, 서버에 SSH로 들어가서 "그럴듯한 이름의 서비스"를 바로
조회하지 말고, **코드에 하드코딩된 실제 접속 주소(`L1_DEFAULT` 등)와
그 서버의 서비스 목록을 먼저 대조**해서 정확히 같은 인스턴스인지 확인할
것. 이번엔 `systemctl list-units | grep gopang-pb`로 전체 목록을 뽑고
나서야 진짜와 가짜를 구분할 수 있었다.

## 10. Edge가 애초에 왜 `mobile`로 잘못 등록됐는가 (미해결·후속 과제)

`src/gopang/services/push.js`의 판정 로직(`/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)`)
자체는 정상적인 Windows Edge UA에 대해 `desktop`을 반환해야 한다.
Edge 콘솔에서 `navigator.userAgent`를 직접 확인해 이 정규식에 실제로
걸리는 문구가 있었는지(예: 개발자도구 기기 에뮬레이션이 켜진 채 접속된
적이 있었는지)는 아직 확인 전 — 다음 세션 후속 과제로 남긴다.

## 11. 문서화 작업 자체의 실수 (메타)

이 문서의 최초 버전(§1~§6만 담은 버전)을 패치로 만들어 드렸으나,
사용자가 실수로 잘못된 브랜치(`fix/jiles-lifelong-dup-cleanup`)에
적용하고 `main` push가 거부된 뒤, 다음 작업(posh-git 설정)으로
넘어가면서 그 재시도가 누락됐다 — 즉 **이 문서와 "⚠ 주의" 메뉴 등록
자체가 하루 가까이 `main`에 반영되지 않은 채로 있었다.** 이번에 §7~§10을
더해 다시 커밋하면서, GitHub `main`에 실제로 반영됐는지 raw 파일까지
직접 확인하는 절차를 거쳤다.

**교훈**: 패치 적용/push 흐름에서 오류가 발생해 "main으로 옮겨서
다시" 같은 재시도 지시를 내린 경우, 다음 대화로 넘어가기 전에 반드시
그 재시도가 실제로 완료됐는지 확인할 것 — 완료 확인 없이 화제를
전환하면 이번처럼 통째로 누락될 수 있다.

## 12. 재발 — 09-23, dashboard.html에서 같은 증상 두 차례 더

같은 "인증은 성공하는데 다음 지시를 내리면 또 요구한다" 무한 반복이
`dashboard.html`에서 재발했다(주피터 실사, 2회 독립 재현).

**1차 재발 원인**: §4의 수정(`gopang-pwa.js`의 자동 새로고침 유예 가드)이
`#ksa-overlay`(공용 KAuth 모듈)만 확인했는데, `dashboard.html`의 메인
지갑 로그인은 별도 ID(`#loginScreen`)를 쓴다 — 그 페이지엔 `#ksa-overlay`
자체가 없어 가드가 전혀 작동하지 않았다. `loginScreenEl`의
`display !== 'none'` 여부도 함께 확인하도록 확장.

**2차 재발 원인**: 위 수정으로도 부족했다. `completeLogin()`이
`#loginScreen`을 감추는 바로 그 틈에, `GopangWallet.restoreFromPrivateKey()`
가 IndexedDB에 쓴 개인키가 실제로 커밋되기 전일 수 있다(개별 요청의
`onsuccess`는 트랜잭션 커밋보다 먼저 끝날 수 있음) — 그 좁은 창에서
새로고침이 끼어들면, 재시작된 페이지가 방금 저장된 지갑을 못 읽어
처음부터(전화번호 입력) 다시 요구한다. `#loginScreen`의 가시성만 보는
가드로는 "감춰진 직후"를 못 잡는다.

**수정**: `dashboard.html`의 `completeLogin()`이 로그인 성공 시점에
`window._hondiAuthGraceUntil = Date.now() + 4000`(4초 유예)을 심어두고,
`gopang-pwa.js`의 새로고침 가드가 `#loginScreen` 가시성·`#ksa-overlay`에
더해 이 유예 타임스탬프도 함께 확인한다 — IndexedDB 커밋이 끝날 시간을
명시적으로 보장.

**교훈 추가**: "화면 요소가 안 보이면 안전하다"고 가정하지 말 것 —
UI가 사라진 시점과 그 UI가 트리거한 비동기 부작용(여기선 IndexedDB
쓰기)이 실제로 끝나는 시점은 다를 수 있다. 화면 가시성 대신(또는 그에
더해) 그 작업 자체의 완료를 명시적으로 신호하는 편이 더 안전하다.


1. 서버 정책 변경에 클라이언트가 안 맞을 때, 새 인증 모듈을 만들기 전에
   기존 인증 아키텍처가 있는지 저장소 전체를 먼저 검색할 것.
2. Service Worker의 `install`에서 무조건 `self.skipWaiting()`을 부르면,
   활성화 시점을 클라이언트가 전혀 통제할 수 없다.
3. Push 구독은 SW 등록에 종속된 휘발성 리소스다 — 잦은 배포가 인증과
   무관해 보여도 push 기반 기능 전체를 붕괴시킬 수 있다.
4. "이미 만들어진 기능"이라고 그 기능이 실제로 작동한다고 가정하지
   말 것 — 연결하기 전에 그 기능의 실제 소비자 인터페이스와 맞는지
   먼저 확인할 것.
5. 여러 지역별 DB 인스턴스가 비슷한 이름으로 병렬로 떠 있으면, 서버
   접속 후 바로 조회하지 말고 코드의 실제 접속 주소와 서비스 목록을
   먼저 대조할 것.
6. 패치/push 재시도를 지시한 뒤에는, 완료 확인 없이 다음 작업으로
   넘어가지 말 것.
