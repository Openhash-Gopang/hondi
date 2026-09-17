# GDC 입금 매칭 불통 — 자가신고↔알림 도착 순서·PATCH 실패·Content-Type 3중 사고 (2026-09-17)

## 1. 증상

여러 겹쳐진 증상으로 시작됐다:
- PC(`desktop.html`)에서 지갑을 열면 GDC 잔액이 항상 ₮0으로 나오는데,
  같은 계정으로 폰에서 열면 정상 잔액(8,026T)이 보임.
- 폰에서 지갑 로딩이 1분 이상 걸림.
- 전화번호 뒷자리 8자로 입금해야 하는데, 사용자가 무심코 본인 실명
  그대로 입금하는 경우 매칭이 안 됨.
- "자가신고 먼저 → 입금" 순서로는 성공(1,003원 실전 확인)하는데,
  "입금 먼저 → 자가신고" 순서로는 실패(1,001원·1,002원 두 건, 실제
  계좌엔 입금됐으나 GDC 미반영 — 은행 문자로 입금 자체는 확인됨).
- GDC는 정상 발행됐는데도 "입금 대기" 카드가 계속 화면에 남는 경우가
  다수 관찰됨.

## 2. 조사 경로 (결론까지 확인한 순서)

1. **PC/폰 잔액 불일치** — `openGopangWallet()`의 `balance = fs['bs-cash']`가
   `window.gopangWallet`(로컬 IndexedDB) 기준값이었다. `desktop.html`은
   `gopang-app.js`를 아예 안 불러 `window.gopangWallet`이 초기화된 적이
   없어 항상 0. → `gopang-wallet.js`의 `hydrateFromServer()`가 이미 쓰고
   있던 서버 단일 원장 엔드포인트(`GET /biz/balance?guid=`)를
   `openGopangWallet()`에서 직접 호출하도록 교체.
2. **폰 지갑 로딩 지연** — 위 수정 과정에서 `wallet.refreshBalanceUI()`
   (내부적으로 같은 `/biz/balance`를 또 호출)를 `await`로 순차 대기한
   뒤에야 나머지 3개 병렬 호출이 시작되고 있었음(같은 엔드포인트
   중복 호출 + 불필요한 직렬화). → `refreshBalanceUI()`를 fire-and-forget
   으로 전환.
3. **미인증 방문자가 지갑을 그냥 봄** — `desktop.html`이 로그인/가입
   팝업 자체를 안 가진 페이지라, `openGopangWallet()` 내부 가드(알림만
   띄우고 끝)로는 막다른 길이었음. → 미인증이면 로그인 팝업이 있는
   `pages/dashboard.html`로 리다이렉트.
4. **본인 실명으로 입금하는 사용자 문제 제기** — 전화번호 뒷자리 규칙을
   몰라서/까먹어서 실명으로 입금하면 매칭 불가. 동명이인 전체에게
   알림을 보내는 방안도 검토했으나, 비용·오탐(추측 공격) 문제로
   기각하고 **자가신고(금액을 먼저 등록)** 방식을 1차 안전망으로
   채택.
5. **실전 테스트 중 자가신고↔입금 순서에 따라 성공/실패가 갈리는 것을
   발견** — `wrangler tail`로 실시간 로그 확인, L1 PocketBase를 직접
   curl로 조회(`charge_requests`·`ledger_entries` 대조)해서, 1,000원·
   1,003원은 `ledger_entries`에 mint 기록이 있는데(=실제 발행됨)
   `charge_requests` 상태만 `pending`으로 남아있고, 1,001원·1,002원은
   `ledger_entries`에 아예 기록이 없음(=발행 자체가 안 됨)을 확인.
6. **안드로이드 알림 캡처 앱(`hondi-charge-notifier`) 소스 확보** —
   저장소 위치를 몰라 한참 헤맴(`AndroidStudioProjects` 기본 경로가
   아니라 `C:\dev\hondi-charge-notifier`에 있었음. Android Studio의
   `recentProjects.xml` 확인 없이 `Get-ChildItem -Recurse`로 직접
   찾음). 소스(`DepositSmsReceiver.kt`, `ChargeApiClient.kt`,
   `CaptureQueue.kt`, `CaptureRetryWorker.kt`) 전수 검토 결과 **앱
   자체엔 버그가 없음**을 확인 — `goAsync()` 정확히 사용, 네트워크
   실패 시 재시도 큐도 정상 설계.
7. **타임스탬프 정밀 대조로 진짜 근본 원인 확정** — 은행 SMS 도착
   시각과 자가신고 등록 시각을 초 단위로 비교한 결과, 실패한 두 건
   모두 "SMS가 먼저, 자가신고가 나중"이었고 성공한 1건만 "자가신고가
   먼저"였음. `handleChargeConfirmNotification`의 금액 단독 매칭은
   **알림이 도착한 그 순간의 스냅샷만** 조회하고, 나중에 자가신고가
   들어와도 되돌아가서 재확인하지 않는 구조였음이 원인.

## 3. 근본 원인 (3가지, 서로 다른 층위)

1. **기기 로컬 상태를 서버 단일 원장인 것처럼 취급** — `fs['bs-cash']`
   (IndexedDB)를 기기 간 공유되는 값처럼 읽었다. 클라이언트-서버
   구조에서 로컬 캐시는 표시 최적화일 뿐 진실의 원천이 될 수 없다.
2. **시간 순서 의존적 매칭 로직** — 금액 단독 매칭이 "지금 이 순간
   존재하는 pending만" 보고 끝내버려, 도착 순서가 뒤바뀌면 영구
   유실됐다. 비동기로 도착하는 두 이벤트(자가신고 API 호출, 은행
   알림 캡처)를 매칭하려면 **어느 쪽이 먼저 와도 나중에 온 쪽이
   찾아낼 수 있는 저장소**가 필요했는데, 처음엔 그 저장소 자체가
   없었다.
3. **mint 성공 후 상태 PATCH가 별도 실패 지점** — `_mintAndRecordCharge`
   에서 GDC 발행(`/api/mint`)과 원본 `charge_requests` 레코드를
   `matched`로 바꾸는 PATCH가 분리된 두 단계였고, 후자만 실패해도
   전자는 이미 완료된 상태로 남는다(`CHARGE_CONFIRM_PATCH_FAILED_AFTER_MINT`,
   재시도 없이 로그만 남기고 포기하던 기존 설계). 돈은 안전했지만
   화면엔 "입금 대기"가 영구적으로 남았다.

## 4. 조치

1. `openGopangWallet()` 잔액을 `/biz/balance` 서버 단일 원장 기준으로
   변경, `refreshBalanceUI()`는 fire-and-forget으로 전환.
2. `desktop.html`의 GDC 충전 버튼에 미인증 리다이렉트 추가
   (`pages/dashboard.html`로).
3. Gopang Wallet 헤더에 인증된 사용자 이름 표시, 통화 표기를
   "₮숫자" → "숫자T"(꾸밈없는 알파벳, 한국식 표기)로 변경.
4. 거래 내역·"준비 중인 서비스"를 CSS Grid `auto-fill` 기반 반응형
   카드로 재구성(데스크톱 와이드 화면에서 한 줄 리스트로 낭비되던
   문제 해결).
5. 입금 계좌 안내를 **방법 1(추천, 자가신고 우선)** / **방법 2(전화번호
   뒷자리)** 로 나눠 사용자가 선택하게 함. 방법 1엔 "이름으로 이미
   입금했어도 여기 금액만 적으면 된다"는 안내 추가.
6. `POST /biz/charge-self-report` 신설 — 사용자가 스스로 금액을 등록.
7. `handleChargeConfirmNotification`에 금액 단독 매칭 폴백 추가, 후보가
   없으면 **`unmatched_deposit_captures`** (L1에 신규 생성한 컬렉션)에
   저장해 나중에 자가신고가 이를 찾아 짝짓도록 양방향화.
8. `handleChargeSelfReport`가 등록 즉시 `unmatched_deposit_captures`를
   조회해 이미 도착한 입금이 있으면 그 자리에서 바로 확정(소급 매칭).
9. `_mintAndRecordCharge`의 PATCH 단계에 최대 3회 재시도 + 실패 시
   상태 코드·응답 본문 로깅 추가.
10. 지갑 UI에서, 이미 `ledger_entries`에 반영된 pending 신청은
    "입금 대기" 목록에서 자동으로 걸러내도록 클라이언트 재조정(PATCH가
    또 실패해도 화면엔 정확하게 보이도록 하는 안전망).
11. "입금 대기" 카드·상세 화면에 2단계 진행률 바 추가, 로그에
    `amount_guess`·`raw_text_snippet`·PATCH 실패 이유 등 진단 필드 보강.

**실전 검증**: 1,003원(자가신고 먼저), 1,005원·1,006원(자가신고 먼저),
1,007원(입금 먼저 → 소급 매칭) — 양방향 모두 실제 계좌이체로 확인 완료.

## 5. 재발 방지

- **기기 로컬 상태 vs 서버 단일 원장 구분 원칙**: 여러 기기/페이지에서
  같은 값을 보여줘야 하는 화면은 반드시 서버 엔드포인트를 직접
  불러야 한다. `window.gopangWallet` 같은 전역 객체가 "존재하지 않을
  수 있는 페이지"(이 저장소엔 `desktop.html`처럼 `gopang-app.js`를
  안 불러 로컬 지갑이 통째로 없는 페이지가 있다)가 있다는 걸 항상
  전제할 것.
- **비동기 이벤트 매칭은 항상 양방향으로 설계**: "A가 B보다 먼저 온다"
  고 가정하지 말 것. 실사용자 행동은 예측한 순서를 지키지 않는다.
  한쪽만 있어도, 다른 쪽이 나중에 와서 찾아낼 수 있는 저장소를
  처음부터 같이 설계할 것.
- **"성공 후 부수 작업" 실패는 반드시 재시도 + 원인 로깅**: 핵심
  작업(mint)이 성공한 뒤의 후속 작업(상태 PATCH)이 실패해도 핵심
  작업의 성공 자체는 되돌릴 수 없다 — 이런 구조에서 후속 작업은
  최소 몇 회 재시도하고, 그래도 실패하면 반드시 "왜" 실패했는지
  로그에 남길 것(상태 코드+응답 본문). "실패했다"는 사실만 남기고
  이유를 안 남기면 다음 사고 조사 때 다시 처음부터 추측해야 한다.
- **PocketBase 필터에 날짜를 넣을 때는 항상
  `.toISOString().replace('T',' ').slice(0,19)`** — 이 저장소에 이미
  여러 곳(예: `_l1SweepPendingSettlements`)에 검증된 관례가 있는데도
  새로 짜는 코드에서 또 빠뜨렸다(이번 사고에서 실제로 재현됨). 이
  변환 없이 plain `.toISOString()`을 필터에 그대로 넣으면 문자열
  비교 순서가 실제 시각 순서와 어긋나 조용히, 예측 불가능하게
  실패한다.
- **fetch에 body를 실어 보낼 때는 항상 `Content-Type: application/json`
  포함 여부를 직접 확인**: GET용으로 만든 `headers` 객체를 POST에
  재사용하면서 빠뜨리는 실수가 이번에도 재현됐다(과거
  `AI_CHARGE_SECRET_DRIFT_INCIDENT_2026_09_03.md` 등에서도 비슷한
  헤더 재사용 사고가 있었음 — 매번 같은 클래스의 실수가 반복되고
  있다는 뜻이므로, 다음엔 POST/PATCH 호출부마다 헤더를 매번 새로
  선언하는 걸 원칙으로 삼는 게 나을 수 있다).
- **안드로이드 앱(`hondi-charge-notifier`) 소스 위치를 문서에 고정**:
  `C:\dev\hondi-charge-notifier` (private, GitHub 미업로드 상태에서
  이번 조사 중 zip으로 확보). 다음에 이 앱을 또 못 찾는 일이 없도록
  이 문서와 `docs/ADMIN_ACTION_SECRET_DRIFT_INCIDENT_2026_09_16.md`
  양쪽에 경로를 남긴다.
- **디버깅 시 `wrangler tail <워커이름>`을 쓸 것** — 워커 이름을 모르면
  `wrangler.toml`의 `name` 필드(`hondi-proxy`)를 확인. 기본값
  `my-worker`로 실행하면 "이 워커는 존재하지 않는다"는 오해를 부르는
  에러만 나온다.

## 6. 남은 과제

- 동명이인 전체에게 알림을 보내는 2차 안전망(자가신고로도 해결 안
  되는 경우 대비)은 설계만 하고 구현하지 않았다 — 비용(SMS)·오탐
  (같은 이름 여러 명 중 라운드 금액 추측) 문제를 먼저 풀어야 한다.
- 근본적으로는 사용자마다 고유 가상계좌를 발급하는 방식(보낸이가
  무엇이든 계좌번호 자체로 특정)이 이 클래스의 문제 전체를 없앤다.
  지금은 은행 API/PG 계약이 필요해 보류 중 — 거래량이 늘면 재검토.
- `unmatched_deposit_captures`에 쌓인 레코드를 정리(만료/삭제)하는
  배치가 아직 없다 — 영구히 안 온 자가신고에 대응하는 캡처가 계속
  쌓이면 조회 성능에 영향을 줄 수 있다. 만료 정책 검토 필요.
- 이 문서 작성 시점 기준, `fix_charge_confirm_patch_retry.py`
  (PATCH 재시도 + 실패이유 로깅)가 아직 main에 병합되지 않은 상태로
  남아있을 수 있다 — 병합 여부를 확인할 것.
- `hondi-charge-notifier` 앱 자체는 GitHub에 아직 없다(로컬 전용).
  이번 조사에서 "코드는 로컬에만 있고 어디 있는지 아무도 기억 못
  하는" 상황을 실제로 겪었으므로, private 저장소로 옮겨두는 걸
  권장한다.
