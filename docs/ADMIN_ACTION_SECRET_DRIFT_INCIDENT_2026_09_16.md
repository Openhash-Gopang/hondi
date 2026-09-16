# GDC 충전 알림 불통 — ADMIN_ACTION_SECRET 드리프트 사고 (2026-09-16)

## 1. 증상

사용자가 계좌이체로 GDC를 충전했는데 **잔액도 그대로, 충전 확인 알림도
오지 않음**(지갑 화면 기준 지출 -1,676원, 수입 +0원). 이전엔 같은
방식(전화번호 뒷자리 8자리 입금자명 매칭, `charge.html` 사전 신청 없이
바로 계좌이체하는 "직접입금형" 경로)으로 정상적으로 충전이 됐었는데
이번엔 안 됨.

## 2. 조사 경로 (결론까지 확인한 순서)

1. **오늘 push된 커밋 전수 확인** — `worker.js`, `pb_hooks/main.pb.js`
   어느 것도 GDC 충전 파이프라인(`_mintAndRecordCharge`,
   `handleChargeConfirm`, `_sendPushToGuid`, 시크릿 상수)을 건드리지
   않았음을 확인 → **코드 회귀 아님.**
2. **잔액도 알림도 둘 다 안 왔다는 점이 핵심 단서** — `_mintAndRecordCharge`
   구조상 푸시 알림은 `/api/mint` 성공 **이후에만** 나간다. 즉 mint 자체가
   성사되지 않았다는 뜻이지, 알림 발송만 별도로 실패한 게 아니었다.
3. **Cloudflare `hondi-proxy` Observability 로그를 시간대별로 좁혀가며
   확인** — `mint`, `charge` 키워드로 검색.
4. **결정적 로그 발견**:
   ```
   POST /biz/charge-confirm-notification
   user_agent: okhttp/4.12.0   ← 안드로이드 알림 리스너 앱(hondi-charge-notifier)
   response: 403 FORBIDDEN
   ```
   앱은 은행 입금 알림을 정상적으로 캡처해서 서버로 전달하고 있었다
   (앱 자체는 죽지 않음) — 다만 `handleChargeConfirmNotification`
   (`worker.js`) 맨 앞의 시크릿 검사에서 거부되고 있었다:
   ```js
   if (secret !== _adminActionSecret(env)) return _err(403, 'FORBIDDEN', ...)
   ```

## 3. 근본 원인

`hondi-proxy` 워커의 `ADMIN_ACTION_SECRET`과 안드로이드 앱
`hondi-charge-notifier`에 저장된 값이 서로 어긋나 있었다. 정확한 계기
(언제 어느 쪽이 바뀌었는지)는 재현 조사 범위 밖이었지만, 구조적으로는
**같은 값이 두 시스템(워커 secret store / 앱 로컬 설정)에 각각 따로
저장돼 있고, 한쪽을 바꿔도 다른 쪽엔 자동으로 안 퍼지는** 상태였다는
점이 근본 원인이다.

이건 `docs/AI_CHARGE_SECRET_DRIFT_INCIDENT_2026_09_03.md`(2주 전,
`MINT_SECRET`/`AI_CHARGE_SECRET`이 hondi-proxy 워커 ↔ hanlim
PocketBase 프로세스 사이에서 어긋났던 사고)와 **완전히 동일한 클래스의
문제**다 — 대상 시크릿과 두 시스템의 정체만 다를 뿐, "시크릿 이중
저장 + 동기화·검증 장치 없음"이라는 구조는 같다.

## 4. 조치

1. **`ADMIN_ACTION_SECRET` 재발급** — 새 랜덤값으로 교체 후
   `hondi-proxy` 워커 secret에 등록.
2. **안드로이드 앱(`hondi-charge-notifier`) 설정 화면에서 동일 값으로
   갱신** — 이 앱은 설정 화면에 시크릿 입력란이 있는 구조(빌드
   하드코딩 아님)라 앱 재빌드 없이 값만 갱신하면 됐다.
3. **워커 쪽 curl로 즉시 검증** — `NO_PENDING_REQUEST` 응답(403 아님)
   확인으로 시크릿 일치를 먼저 확인한 뒤, 앱 쪽 갱신 후 실제 소액
   테스트 입금으로 최종 확인.
4. **노출된 구값 정리** — 검증 과정에서 시크릿 값이 실수로 원격 서버
   bash history와 로컬 셸 명령어에 그대로 노출된 적이 있어, 해당 값은
   폐기하고 다시 한번 재발급 → 이번이 최종 반영된 값.

## 5. 재발 방지 (2026-09-16, 이번 사고를 계기로 신설)

- **`ops/verify-secret.sh`** — 시크릿을 바꾼 직후 실제로 반영됐는지
  한 줄로 검증하는 표준 스크립트. `ADMIN_ACTION_SECRET`은
  `/biz/charge-confirm-notification`을 실제 호출해서, `MINT_SECRET`·
  `AI_CHARGE_SECRET`은 `/api/mint`·`/api/ai-charge`에 새로 추가한
  `dry_run:true` 모드(진짜 발행/차감 없이 시크릿 일치 여부만 확인)로
  검증한다.
- **`docs/SECRET_ROTATION_PROCEDURE_v1_0.md`** — 이중 저장된 시크릿
  목록과 "생성 → 양쪽 반영 → 즉시 검증 → 전달 흔적 정리" 표준 절차를
  문서로 고정.
- **`_alertAdminOnSecretFailure()`(worker.js, 신설)** — 관리자 전용
  액션 시크릿·mint 발행 시크릿이 어긋나 `FORBIDDEN`이 뜨는 순간(이런
  경로는 실사용자가 정상적으로는 도달 못 하므로, 여기서의 실패는
  거의 항상 설정 드리프트다) 관리자 폰으로 SMS 즉시 경보(솔라피,
  30분 쿨다운으로 스팸 방지). `handleChargeConfirmNotification`의
  403 분기, `_mintAndRecordCharge`·`handleAdminManualCharge`의 mint
  `FORBIDDEN` 분기 세 곳에 연결됨. `env.ADMIN_ALERT_PHONE`(secret)
  설정이 선행돼야 동작한다.

## 6. 남은 과제

- 안드로이드 앱(`hondi-charge-notifier`) 쪽에 이 시크릿이 왜/언제
  바뀌었는지의 정확한 계기는 끝내 특정하지 못했다 — 이 저장소가
  비공개라 커밋 이력을 대조할 수 없었다. 이 앱의 빌드·배포 이력도
  `docs/`에 기록해두는 걸 고려할 것(다음에 같은 사고가 나면 "언제
  마지막으로 이 앱을 손댔는지"부터 바로 확인할 수 있도록).
- `_alertAdminOnSecretFailure`는 이번에 신설된 안전망이라 아직 실전
  검증(고의로 틀린 시크릿을 넣어 SMS가 실제로 오는지)을 거치지 않았다
  — 배포 후 반드시 한 번은 실사용 테스트할 것.
