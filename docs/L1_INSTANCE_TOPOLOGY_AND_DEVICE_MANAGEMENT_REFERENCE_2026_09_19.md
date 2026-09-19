# L1 인스턴스 토폴로지 & 기기(push) 관리 API 레퍼런스 (v1.0, 2026-09-19)

이 문서는 사고 기록이 아니라 **참조용 레퍼런스**입니다. "이 서버에서
어떤 DB를 봐야 하는가", "기기 등록을 어떻게 조회·삭제하는가"를 매번
새로 파악하지 않도록 정리합니다.

## 1. L1 PocketBase 인스턴스 찾는 법

`worker.js`가 실제로 읽고 쓰는 주소는 하드코딩된 상수 하나입니다:

```js
const L1_DEFAULT = 'https://l1-hanlim.hondi.net';
```

**주의**: 서버 호스트명(`l1-hanlim-new` 같은)과 그 안에서 도는
systemd 서비스명은 **다른 이름 체계**를 씁니다. 실사 확인 결과, 한
물리 서버(`l1-hanlim-new`) 안에 다음이 전부 동시에 떠 있을 수 있습니다:

- `gopang-pb-hanlim.service` — **접두사 없이 `hanlim`.** `L1_DEFAULT`가
  가리키는 게 바로 이것입니다. 디렉토리: `/opt/gopang/pb/hanlim/`.
- `gopang-pb-l1-<지역명>.service` (예: `l1-aewol`, `l1-ara`, `l1-samdo1`
  등 제주 각 읍면동 이름) — 지역별 개별 L1 인스턴스. 여러 개가
  `inactive dead` 상태일 수 있음(정상 — 트래픽 없는 지역).
- `gopang-pb-l2-jeju`, `gopang-pb-l2-seogwipo` — L2(시 단위 통합).
- `gopang-pb-l3-jejudo` — L3(제주도 전체 통합). **`hanlim`과 이름이
  비슷해 보이지만 완전히 다른 데이터입니다** — 혼동해서 조회하면
  엉뚱한(하지만 그럴듯하게 보이는) 결과를 얻습니다.
- `gopang-pb-l4-kr`, `gopang-pb-l5-global` — 전국/전역 통합.

**확인 절차 (매번 이 순서대로):**
```bash
# 1. worker.js가 실제로 쓰는 주소 확인
grep "L1_DEFAULT" worker.js
# 2. 그 서버에 뭐가 떠 있는지 전체 나열
systemctl list-units --type=service --all | grep -i gopang-pb
# 3. 이름이 정확히 일치하는 서비스의 데이터 디렉토리를 확인
ls -la /opt/gopang/pb/
```
"그럴듯한 이름"(`l3-jejudo`, `l1-hanlim-new` 자체 등)을 보고 바로
조회하지 말고, 반드시 1번(코드)과 2번(서버 실제 서비스 목록)을 먼저
대조할 것 — 이름이 비슷하지만 다른 인스턴스를 조회해 잘못된 결론에
도달한 사례가 실제로 있었다(§`PHONE_VERIFY_TOKEN_KAUTH_WALLET_CONFLICT_INCIDENT_2026_09_18.md` §9).

## 2. `push_subscription` 필드 직접 조회

```bash
DB=/opt/gopang/pb/hanlim/data.db
sqlite3 "$DB" "SELECT push_subscription FROM profiles WHERE handle='@닉네임';" \
  | python3 -c "
import json,sys
for d in json.load(sys.stdin):
    print(d.get('deviceId'), '|', d.get('deviceType'), '|', d.get('updatedAt'), '|', d['subscription']['endpoint'][:60])
"
```

각 기기 항목의 필드:
- `deviceId` — `getOrCreateDeviceId()`(클라이언트, localStorage
  `gopang_device_id`)로 생성되는 브라우저 설치본 고유 UUID.
- `deviceType` — `'mobile'` | `'desktop'` | (없음, 구버전 `'legacy'`
  변환 항목). 클라이언트가 `navigator.userAgent`로 자체 판정해서
  보낸 값을 그대로 저장한다 — 서버는 검증하지 않는다.
- `subscription.endpoint` — 브라우저 push 서비스 주소로 대략적인
  브라우저/OS를 짐작할 수 있다: `fcm.googleapis.com` = Chromium
  계열(Chrome/Brave/Opera, 모바일·데스크톱 무관), `wns2-*.notify.windows.com`
  = Edge(Windows), `updates.push.services.mozilla.com` = Firefox.
  **endpoint만으로 mobile/desktop을 단정하지 말 것** — FCM은 데스크톱
  Chromium도 똑같이 쓴다.
- `updatedAt` — epoch ms.

**직접 수정 시 반드시**: 서비스 정지 → 백업 → 수정 → 서비스 재시작
순서를 지킬 것(§`DEVICE_LINK_MANUAL_v1_0.md` 참고).
```bash
sudo systemctl stop gopang-pb-hanlim.service
cp "$DB" "$DB.bak.$(date +%s)"
# ...수정...
sudo systemctl start gopang-pb-hanlim.service
```

## 3. 기기 관리 API (2026-09-19 신설)

### `GET /account/devices?guid=<guid>`
등록된 기기 전체 목록. 서명 불필요(읽기 전용, 메타데이터만 노출).
```json
{ "ok": true, "devices": [
  { "deviceId": "...", "deviceType": "mobile", "updatedAt": 1789772886004 }
] }
```
`subscription.endpoint`는 포함하지 않는다(불필요한 노출 최소화).

### `GET /account/push-device-info?guid=<guid>&deviceId=<deviceId>`
"이 기기 자신"의 등록 상태만 조회(진단 페이지 `push-diagnose.html`용).

### `POST /account/remove-device`
```json
{ "guid": "...", "deviceId": "...", "pubkey": "...", "signature": "...", "ts": 1234567890 }
```
서명 대상 문자열: `` `remove-device:${guid}:${deviceId}:${ts}` ``.
Ed25519 서명이 그 guid에 TOFU-핀된 `pubkey_ed25519`와 일치해야만
삭제 실행 — 즉 **그 계정의 진짜 개인키(=폰)의 승인이 있어야만** 어떤
기기든(요청한 기기 자신 포함) 삭제 가능. 요청하는 기기와 서명하는
기기가 분리돼 있어, 지갑 없는 "공용 PC"도 자기 자신의 잘못된 등록을
지울 수 있다.

## 4. 서명이 필요한 요청에 폰 승인 받아오기 — `SessionSignProxy`

`gopang-wallet.js`의 `GopangWallet.createSessionSignProxy()`가 반환하는
객체는 로컬에 개인키를 두지 않고, 서명이 필요할 때마다
`/auth/device-link.html?purpose=sign_request`를 팝업으로 열어 폰의
승인을 받는다.

```js
const proxy = GopangWallet.createSessionSignProxy();
await proxy.setIdentity({ guid, handle, e164 });   // guid를 이미 알면 공개키를 미리 조회해둠
const signature = await proxy.sign(sigMsg, excludeDeviceId);  // excludeDeviceId는 선택
// proxy.publicKeyB64u 에 서명자의 공개키가 채워짐
```

**소비자(예: `_issueSession()`) 쪽에서 요구하는 인터페이스**:
- `wallet.publicKeyB64u` — 속성. 서명 *전에* 이미 채워져 있어야 함
  (sigMsg 자체에 공개키가 들어가는 구조라서).
- `wallet.signPayload(payload)` — 메서드명이 정확히 이거여야 함
  (`.sign()`이 아님 — `SessionSignProxy`는 둘 다 제공, `signPayload`는
  `sign`으로 위임하는 별칭).

**`excludeDeviceId`(선택, 2번째 인자)**: 이 서명 요청의 승인 알림을
받지 말아야 할 deviceId. "그 기기 자신을 삭제하는" 것처럼, 요청을
만든 기기가 (잘못) `mobile`로 등록돼 있어 자기 몫의 알림을 스스로
받아버리는 걸 막을 때 쓴다. 서버(`handleDeviceLinkInit`)까지 그대로
전달되어 발송 대상 필터링에 반영된다.

**guid를 아직 모르는 상태**(진짜 무명 공용 PC 부트스트랩,
`ensureWalletSetup()`의 초기 경로)에서는 `publicKeyB64u`를 미리
채울 수 없다 — 이 경우는 아직 `_issueSession()`과 완전히 맞물리지
않는다(첫 서명 후에도 다음 호출이 실패할 수 있음, 미해결 후속 과제).
