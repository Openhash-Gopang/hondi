# 공유 시크릿 회전(rotation) 표준 절차 v1.0

작성일: 2026-09-16 — `ADMIN_ACTION_SECRET` 드리프트 사고(같은 날) 및
`docs/AI_CHARGE_SECRET_DRIFT_INCIDENT_2026_09_03.md`(2주 전, `MINT_SECRET`/
`AI_CHARGE_SECRET`) 재발 방지용.

## 왜 필요한가

이 코드베이스엔 "같은 값이 서로 다른 두 시스템에 각각 따로 저장돼 있고,
한쪽만 바꾸면 다른 쪽엔 자동으로 안 퍼지는" 시크릿이 여러 쌍 있다:

| 시크릿 | 저장 위치 A | 저장 위치 B |
|---|---|---|
| `MINT_SECRET` | hondi-proxy 워커 secret | hanlim PocketBase 프로세스 환경변수 |
| `AI_CHARGE_SECRET` | hondi-proxy 워커 secret | hanlim PocketBase 프로세스 환경변수 |
| `ADMIN_ACTION_SECRET` | hondi-proxy 워커 secret | 안드로이드 앱 `hondi-charge-notifier` 로컬 설정 |

지금까지 이 값들을 바꾼 뒤 "실제로 양쪽이 일치하는지" 검증하는 절차가
없었다 — 바꾸고 나서 문제없길 바라며 넘어갔고, 두 번 다(09-03, 09-16)
사용자가 GDC 잔액 이상을 신고하고 나서야 발견됐다.

## 표준 절차

**1. 새 값 생성** — 로컬(본인) PC에서, 서버 SSH 세션이 아닌 곳에서:
```bash
openssl rand -hex 24
```

**2. 두 저장 위치 모두 갱신** — 위 표를 보고 A·B 양쪽에 동일한 값을
반영한다. 한쪽만 바꾸고 끝내는 게 지금까지 두 사고의 공통 원인이었다.

**3. 즉시 검증** — 값을 바꿨다고 그걸로 끝내지 않는다.
`ops/verify-secret.sh`로 실제 엔드포인트를 호출해 403이 안 뜨는지
확인한다(mint·ai_charge는 `dry_run:true`를 써서 실제 발행/차감 없이
시크릿 일치 여부만 검증한다):
```bash
ADMIN_ACTION_SECRET=<새 값> ./ops/verify-secret.sh admin_action
MINT_SECRET=<새 값>         ./ops/verify-secret.sh mint
AI_CHARGE_SECRET=<새 값>    ./ops/verify-secret.sh ai_charge
```

**4. 값 전달 시 흔적 남기지 않기** — PC→폰 전달은 QR 코드 또는 USB
케이블을 쓰고, 카카오톡·문자·이메일처럼 서버에 평문으로 영구 저장되는
채널은 피한다. 터미널에 값을 직접 타이핑했다면 작업 종료 후
`history -c`(또는 해당 줄만 `history -d <번호>`)로 정리한다.

**5. 관련 secret 목록을 함께 기록** — 값 자체가 아니라 "이 시크릿을
언제, 왜 바꿨는지"를 이 문서 하단 이력에 한 줄 추가한다(값은 절대
기록하지 않는다).

## 재발 시 자동 경보 (2026-09-16 신설)

위 표의 세 시크릿이 어긋나면 `_alertAdminOnSecretFailure()`(worker.js)가
`ADMIN_ALERT_PHONE`(secret, 관리자 폰번호)으로 SMS를 자동 발송한다 —
최초 실패 즉시, 이후 같은 원인이면 30분에 한 번씩 재알림. 이 시크릿이
미설정이면 조용히 스킵되니, 처음 설정할 때 반드시:
```bash
wrangler secret put ADMIN_ALERT_PHONE --name hondi-proxy
# 예: +821012345678 형식
```
설정 직후 검증하려면 `ops/verify-secret.sh`의 세 검증 중 아무거나 일부러
틀린 값으로 한 번 돌려 실제로 SMS가 오는지 확인해볼 것.

## 변경 이력 (값 없이, 날짜·사유만)

- 2026-09-16: `ADMIN_ACTION_SECRET` 재발급(안드로이드 앱-워커 드리프트
  사고 대응), 안드로이드 앱 설정값 동기화 완료.
