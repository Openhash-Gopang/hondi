# GDC 과금(AI 사용료) 개발자 매뉴얼 v1.0

> **작성일**: 2026-09-03 · **대상**: 개발자(신규 K-서비스에 과금을 붙이거나, 과금이 안 될 때 진단하는 사람)
> **메타 매뉴얼**: [`docs/MANUAL_INDEX.md`](./MANUAL_INDEX.md)
> **관련 문서**: [`GDC_CHARGE_MANUAL_v1_0.md`](./GDC_CHARGE_MANUAL_v1_0.md)(가입충전·저잔액 알림 — 이 문서와 상호 보완),
> [`AI_CHARGE_SECRET_DRIFT_INCIDENT_2026_09_03.md`](./AI_CHARGE_SECRET_DRIFT_INCIDENT_2026_09_03.md)(이 매뉴얼의 근거가 된 실제 사고 기록)
> **관련 코드**: `worker.js`(`computeBilledKRW`·`_recordAiUsage`·`_settleAiUsage`·`_chargeGdcForAiUsage`·
> `_gdcFreeQuotaGate`·`_aiChargeSecret`·`_l1AdminTokenFor`) ·
> `pb_hooks/main.pb.js`(`POST /api/ai-charge`) ·
> `services/gopang-worker/src/routes/internal.js`(`POST /internal/ledger-entries`) ·
> `services/gopang-worker/src/lib/pb-admin.js`

이 문서는 "K-서비스 하나를 쓸 때마다 실제 사용량만큼 GDC 잔액에서 깎이는"
AI 사용료 과금 파이프라인(이하 GDC AI 과금)을 다룹니다. 2026-09-03,
K-Plan이 출시된 이후 **한 번도 실제로 과금된 적이 없었다**는 사실을 실사로
발견하고 원인 3가지를 고쳤습니다 — 그 과정에서 얻은 교훈을 다음 개발자가
반복하지 않도록 여기 정리합니다.

---

## 1. 전체 그림 (파이프라인 개요)

```
사용자(K-Plan 등) → hondi-proxy Worker (/kplan/relay 등)
                        │
                        ├─ ① _gdcFreeQuotaGate — 실제 GDC 잔액 확인(사전 게이트)
                        ├─ ② DeepSeek 실제 호출 → usage(토큰) 수신
                        ├─ ③ computeBilledKRW — 토큰 → 원화 환산 (가격표 × 베타배율)
                        └─ ④ _recordAiUsage → onAfterRecord → _settleAiUsage
                                 │                                  │
                                 │                     ┌────────────┘
                                 ▼                     ▼
                     _l1CreateUsageLog(로그)   _chargeGdcForAiUsage
                                                        │
                                                        ▼
                                        POST L1노드/api/ai-charge (pb_hooks/main.pb.js)
                                                        │
                                        secret 검증 → tx_hash 멱등성 확인
                                        → computeBalance(잔액 재계산)
                                        → 잔액 부족 시 402 차단
                                        → block_type:"ai_usage_charge" 블록 저장(실제 차감)
                                        → market-proxy /internal/ledger-entries 호출(재무제표 기록)
```

**핵심 포인트**: 실제 잔액 차감은 `_gdcFreeQuotaGate`(사전 확인)가 아니라
`/api/ai-charge`가 블록을 저장하는 순간 일어납니다. 사전 게이트는 "요청을
시작해도 되는가"만 보고, 진짜 차감은 사용량이 확정된 뒤에야 일어납니다.

---

## 2. 왜 인증이 두 갈래인가 — 전화번호 vs admin 계정

혼동하기 쉬운 지점이라 먼저 짚습니다.

- **`phone_verify_token`(전화번호)** = "이 요청이 **어느 사용자**의 것인가"를
  증명. worker.js가 이걸로 guid를 뽑아 과금 대상을 확정합니다.
- **L1 admin 이메일/비밀번호** = "**이 서버 프로세스 자신이** DB에 쓸 자격이
  있는가"를 증명. PocketBase의 `blocks`·`ledger_entries` 컬렉션은 API 규칙이
  전부 비어있어(admin-only) admin 토큰 없이는 어떤 CRUD도 불가능합니다.

전화번호만으로는 "누구 돈인지"는 알아도, 요청을 보낸 프로그램이 실제로 DB에
쓸 권한이 있는지는 증명이 안 됩니다 — 이걸 생략하면 아무 서버나 guid만
지정해서 임의로 잔액을 조작할 수 있는 구멍이 생깁니다.

---

## 3. 시크릿 목록과 "반드시 일치해야 하는 짝"

| 시크릿 | 있어야 할 곳 | 반드시 일치해야 하는 상대 |
|---|---|---|
| `AI_CHARGE_SECRET` | hondi-proxy Worker secret | **모든** L1 노드의 `.env`(`AI_CHARGE_SECRET`) — 노드마다 별도 프로세스이므로 노드별로 각각 확인 필요 |
| `L1_ADMIN_EMAIL`/`L1_ADMIN_PASSWORD` (hondi-proxy용) | hondi-proxy Worker secret | 해당 L1 노드의 실제 PocketBase admin 계정 |
| `L1_ADMIN_EMAIL`/`L1_ADMIN_PASSWORD` (market-proxy용) | **market-proxy** Worker secret(별도 워커!) | 동일하게 실제 admin 계정과 일치해야 함 — hondi-proxy용과 값은 같아도 되지만 **등록은 따로** 해야 함 |
| `LEDGER_WRITE_SECRET` | market-proxy Worker secret | 모든 L1 노드 `.env`의 동일 이름 값 |
| `MINT_SECRET` | hondi-proxy Worker secret | 모든 L1 노드 `.env`의 동일 이름 값 |

> ⚠️ **hondi-proxy와 market-proxy는 서로 다른 Cloudflare Worker이고, secret
> store가 완전히 분리돼 있습니다.** 한쪽에 등록했다고 다른 쪽도 자동으로
> 채워지지 않습니다 — 2026-09-03 사고의 핵심 원인 중 하나였습니다. Cloudflare
> 대시보드 URL의 `/workers/services/view/<worker-이름>/`을 항상 먼저 확인하세요.

---

## 4. 자주 놓치는 실패 지점 체크리스트

2026-09-03 실사에서 실제로 겪은 것들입니다 — 과금이 안 될 때 이 순서대로
의심해 보세요.

### 4-1. L1 노드가 systemd로 뜨는데 `.env`를 실제로는 안 읽는 경우
- **증상**: `.env` 파일엔 값이 있는데도 계속 `secret 불일치`.
- **원인**: `override.conf`에 `Environment="KEY=value"`를 한 줄씩 수동으로
  박아 넣는 관행이 굳어져 있으면, 새 시크릿이 추가될 때마다 이 줄 추가를
  깜빡하기 쉽습니다. `EnvironmentFile=`을 안 쓰고 있다는 뜻입니다.
- **확인**: `sudo cat /proc/<PID>/environ | tr '\0' '\n' | grep KEY_NAME`
- **근본 수정**: `sudo systemctl edit <unit>`으로
  `EnvironmentFile=/opt/gopang/gopang.env` 한 줄 추가 → `daemon-reload` →
  `restart`. (기존 `Environment=` 줄은 남겨둬도 무방 — 같은 키면 뒤에 오는
  파일 값이 이깁니다.)

### 4-2. 프로세스가 오래 떠 있으면 `.env`를 고쳐도 반영 안 됨
환경변수는 **프로세스 시작 시 딱 한 번만** 읽힙니다. `gopang-idle-shutdown`/
`gopang-wake-gateway` 구조로 오래전에 깨어난 뒤 계속 살아있는 프로세스는,
그 이후 `.env`가 바뀌어도 재시작 전까지는 옛날 값을 그대로 씁니다.
- **확인**: `ps -o lstart= -p <PID>`로 기동 시각을 확인하고 `.env` 최종
  수정 시각과 비교.
- **수정**: 재시작. PocketBase는 SQLite 파일 기반이라 재시작해도 데이터
  손실 없음.

### 4-3. 로그를 journalctl에서만 찾다가 놓침
systemd 유닛에 `StandardOutput=append:/path/to/file.log`가 지정돼 있으면
journald가 아니라 그 파일에 로그가 쌓입니다. `journalctl -f`가 계속
조용하다고 "요청이 아예 안 왔다"고 오판하지 마세요.
- **먼저 확인**: `systemctl cat <unit>`으로 `StandardOutput=` 줄부터 보고,
  파일이면 `tail -f 그파일.log | grep 태그`로 감시.

### 4-4. `wrangler secret put` 대화형 프롬프트가 빈 값으로 들어감
프롬프트(`wrangler secret put NAME`)가 터미널/타이밍 문제로 입력을 놓칠 수
있습니다(2026-09-03 실제 재현 — PocketBase가 `"identity":{"code":
"validation_required","message":"Cannot be blank."}`로 정확히 알려줌).
등록 직후 반드시 실사용 테스트를 해서 빈 값이 아닌지 확인하세요. 파이프
방식(`"값" | wrangler secret put NAME`)은 과거(2026-07-21) 문자열 끝에
개행이 붙는 문제가 있었으니([`L1_ADMIN_AUTH_INCIDENT_2026_07_21.md`](./L1_ADMIN_AUTH_INCIDENT_2026_07_21.md)
참고) 이 방식을 쓰더라도 등록 후 실제 인증 테스트로 검증하세요.

### 4-5. hondi-proxy와 market-proxy를 같은 워커로 착각
이름이 같은 시크릿(`L1_ADMIN_EMAIL` 등)이 두 워커에 각각 존재합니다.
한쪽에 넣었다고 다른 쪽도 됐을 거라 가정하지 마세요 — §3 표 참고.

### 4-6. 서비스별 개인 하드캡을 GDC 잔액과 혼동
"1인 1일 300원"·"1인 1일 5회" 같은 서비스 전용 하드캡을 넣으면, 실제 GDC
잔액이 충분해도 사용자가 막힙니다. 새 K-서비스에 과금을 붙일 때 이런
개별 일일 한도가 정말 필요한지 먼저 판단하세요 — 대개는 필요 없고,
`_gdcFreeQuotaGate`(진짜 잔액 게이트) 하나로 충분합니다. 플랫폼 전체를
지키는 공유예산 상한(`XXX_GLOBAL_DAILY_KRW_LIMIT`)은 별개로 유지해도
됩니다 — 이건 개인 한도가 아니라 계정 전체 폭주 방지용입니다.

---

## 5. 새 K-서비스에 GDC AI 과금을 붙일 때 체크리스트

1. `handleXxxRelay`에서 tier → priceTier 매핑(`'hondi-flash'`/`'hondi-pro'`)이
   `HONDI_TIER_MODELS`에 실제 등록돼 있는지 확인.
2. 호출 전 `_gdcFreeQuotaGate(env, guid, corsHeaders, meta)` 호출 — 진짜
   잔액 게이트.
3. AI 응답 후 `_recordAiUsage(env, ctx, { ..., spendKeys, onAfterRecord })`
   호출 — **`ctx`를 반드시 넘기세요.** `ctx.waitUntil`이 없으면 응답이
   반환된 뒤 백그라운드 정산이 중간에 끊길 위험이 있습니다.
4. `onAfterRecord`가 `_settleAiUsage`(→ `_chargeGdcForAiUsage`)를 호출하는
   구조인지 확인.
5. 서비스 전용 일일 하드캡은 정말 필요한 경우에만 추가(§4-6 참고).
6. **배포 후 반드시 실사용 테스트를 하세요.** 코드 리뷰만으로는 "정상"처럼
   보여도 실제로는 3주 가까이 전혀 과금이 안 되고 있을 수 있습니다(§7의
   진단 플레이북을 그대로 따라 하면 5분 안에 끝납니다).

---

## 6. 서비스별로 독립적으로 검증해야 하는 이유

2026-09-03 사고에서 K-Law는 정상적으로 과금되고 있었는데 K-Plan은 전혀
안 되고 있었습니다 — **같은 파이프라인을 공유하는 것처럼 보여도, 실제로는
서비스별 실사용 테스트를 거쳐야만 확신할 수 있습니다.** "다른 서비스가
되니까 이것도 될 것"이라는 가정은 틀릴 수 있습니다.

---

## 7. 진단 플레이북 (과금이 안 되는 것 같을 때)

1. 브라우저 콘솔에서 잔액 조회(전/후 비교용으로 먼저 한 번):
   ```js
   fetch('https://hondi-proxy.tensor-city.workers.dev/user/gdc-balance', {
     method: 'POST', headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ phone_verify_token: sessionStorage.getItem('<서비스>_phone_verify_token') })
   }).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)))
   ```
2. Cloudflare 대시보드 → hondi-proxy Worker → **Observability → Begin log
   stream** 켜기.
3. L1 노드 SSH 접속 → `systemctl cat <해당 unit>`으로 로그 출력 방식부터
   확인 → journalctl이든 파일이든 실시간 감시 시작.
4. 실제 요청 1건 실행(해당 K-서비스에서).
5. 두 로그를 대조해 어느 단계에서 끊기는지 특정:
   - hondi-proxy 로그에 `KPLAN_RELAY_COST`(또는 해당 서비스 태그)가
     없다 → ①/②/③ 단계 자체가 안 돎(코드 경로 확인).
   - hondi-proxy엔 있는데 L1 로그에 `[AI-CHARGE] 진입`이 없다 →
     `_chargeGdcForAiUsage`가 L1까지 못 감(네트워크/URL 문제).
   - `[AI-CHARGE] 진입`은 있는데 `secret 불일치` → §3 표의 `AI_CHARGE_SECRET`
     짝을 확인(§4-1, §4-2).
   - `검증 통과`는 뜨는데 `ledger_entries 기록 실패` → market-proxy의
     `L1_ADMIN_EMAIL`/`PASSWORD`를 확인(§4-5). (단, 이건 실제 잔액 차감
     자체를 막지는 않습니다 — 재무제표 기록만 별도로 실패한 것.)
6. 최종 확인은 잔액 재조회 + `blocks` 테이블 직접 쿼리:
   ```bash
   sqlite3 <해당노드>/data.db "SELECT tx_hash, buyer_guid, outputs, created FROM blocks WHERE block_type='ai_usage_charge' ORDER BY created DESC LIMIT 5;"
   ```

---

## 8. 2026-09-03 실제 사고에서 고친 것 (요약)

1. **개인별 하드캡(300원/일, 5회/일)이 실제 잔액과 무관하게 먼저 막고
   있었음** → 하드캡 제거, 진짜 잔액 게이트(`_gdcFreeQuotaGate`)만 유지
   (플랫폼 전체 공유예산 상한은 유지).
2. **hanlim L1 노드의 systemd 서비스가 `override.conf`에 개별
   `Environment=` 줄만 갖고 있어 `AI_CHARGE_SECRET`을 못 읽었음** →
   `EnvironmentFile=` 추가로 근본 수정, 재시작으로 즉시 반영 확인.
3. **market-proxy 워커에 등록된 `L1_ADMIN_EMAIL`/`PASSWORD`가 실제 계정과
   안 맞았음**(등록 과정에서 이메일 값이 빈 문자열로 들어갔던 것으로 추정)
   → 전용 admin 계정을 새로 발급해 재등록.

자세한 조사 경과(증상 → 배제한 가설 → 진짜 원인 → 조치)는
[`AI_CHARGE_SECRET_DRIFT_INCIDENT_2026_09_03.md`](./AI_CHARGE_SECRET_DRIFT_INCIDENT_2026_09_03.md)를
참고하세요.
