# K-Plan GDC 실차감 3주 무발생 — 원인 3건 조사·수정 (2026-09-03)

K-Plan 출시(2026-09-02) 이후 사용자가 여러 번 K-Plan을 실사용했는데도
GDC 잔액이 단 한 번도 줄지 않았던 사고입니다. "오늘 사용 가능한 K-Plan
한도를 모두 사용했습니다"라는 429 메시지를 사용자가 실제로 마주치면서
조사가 시작됐습니다. **최종적으로 원인이 3개 겹쳐 있었고, 그중 두 개는
worker.js 코드가 아니라 인프라(systemd·Cloudflare secret 등록) 쪽이었습니다.**

---

## 1. 증상

1. K-Plan을 여러 번 정상적으로 사용(초안·최종검토 응답 다 정상 수신)했는데
   GDC 잔액이 그대로.
2. 한도 소진 메시지(`KPLAN_USER_QUOTA_EXCEEDED`, "오늘 사용 가능한 K-Plan
   한도를 모두 사용했습니다")가 잔액이 충분한데도 발생.
3. `blocks` 테이블에서 `service_id: "kplan"`인 `ai_usage_charge` 레코드가
   단 하나도 없음(가장 최근 것도 8/13 K-Law 스모크테스트).

## 2. 원인 1 — 개인별 하드캡이 실제 잔액과 무관하게 먼저 막음

worker.js에 K-Law를 본떠 만든 `KPLAN_USER_DAILY_KRW_LIMIT`(300원)·
`KPLAN_USER_DAILY_GENERATION_LIMIT`(5회) 하드캡이 있었는데, pro 티어 1회
정련만 해도 `max_tokens 16000 × 5배 베타배율`로 300원을 쉽게 넘겨서, 잔액이
충분히 남아있어도 "오늘 한도 소진"으로 막히는 설계 결함이었습니다.

**수정**: 두 하드캡 제거. 개인 한도는 `_gdcFreeQuotaGate`(실제 GDC 잔액
확인) 하나로만 판단하도록 변경. 플랫폼 전체 공유예산 보호용
`KPLAN_GLOBAL_DAILY_KRW_LIMIT`(3만원)은 유지 — 이건 개인 한도가 아니라
계정 전체 폭주 방지용이라 성격이 다름. (PR #21로 반영·배포 완료.)

이 수정 이후에도 잔액이 안 줄어드는 게 확인되면서, 별개의 더 근본적인
문제가 있다는 게 드러났습니다.

## 3. 원인 2 — hanlim L1 노드가 `AI_CHARGE_SECRET`을 못 읽고 있었음

### 3-1. 진단 경로
Cloudflare 실시간 로그(Observability → Logs)와 hanlim 서버의
`journalctl -f`를 동시에 띄운 채 실제 K-Plan 요청을 보내 대조했습니다.

- Cloudflare 로그: `POST /kplan/relay` 200 정상 완료
- hanlim `journalctl -f | grep AI-CHARGE`: **완전히 무반응**

→ 요청이 L1까지 도달은 하는데(다음 절 원인 3에서 재확인), 진짜 원인은
로그 자체가 journald로 안 가고 있었다는 것과, secret이 실제로 비어있었다는
것 두 가지가 겹쳐 있었습니다.

Cloudflare 로그 상세를 펼쳐보니 `tag: "AI_CHARGE_FAILED", error: "FORBIDDEN"`
— `pb_hooks/main.pb.js`의 `secret !== AI_CHARGE_SECRET` 분기였습니다.

### 3-2. 진짜 원인
```bash
sudo cat /proc/<hanlim_PID>/environ | tr '\0' '\n' | grep AI_CHARGE_SECRET
# → 아무것도 안 나옴
```
`.env`(`/opt/gopang/gopang.env`)엔 `AI_CHARGE_SECRET=hondi-dev-ai-charge-2026`가
정확히 들어있었는데도, **실행 중인 프로세스의 메모리엔 이 값이 없었습니다.**

```bash
sudo systemctl cat gopang-pb-hanlim.service
```
로 확인해보니:
- 메인 유닛 파일엔 `EnvironmentFile=`이 아예 없음.
- `override.conf`엔 `Environment="MINT_SECRET=..."` **딱 한 줄**만 수동으로
  박혀 있음 — `AI_CHARGE_SECRET`이 나중에 추가됐을 때 이 override에 같이
  넣는 걸 놓친 것으로 보임.
- 게다가 이 프로세스는 **어제(전날 22:54) 마지막으로 기동된 뒤 재시작
  안 됨** — `.env`를 나중에 고쳤어도 애초에 이 유닛이 그 파일을 안 읽으니
  의미가 없었음.

부수적으로: 이 유닛은 `StandardOutput=append:/opt/gopang/logs/hanlim.log`로
설정돼 있어, `console.log`가 journald가 아니라 **파일**로 쌓이고
있었습니다. `journalctl -f`가 계속 조용했던 두 번째 이유입니다.

### 3-3. 수정
```bash
sudo systemctl edit gopang-pb-hanlim.service
```
`override.conf`에 한 줄 추가:
```ini
[Service]
Environment="MINT_SECRET=ow42sl7tyzmhufckq913p5n60xageb8r"
EnvironmentFile=/opt/gopang/gopang.env
```
```bash
sudo systemctl daemon-reload
sudo systemctl restart gopang-pb-hanlim.service
```
재시작 후 `/proc/<새PID>/environ`에서 `AI_CHARGE_SECRET` 정상 확인, 로그
감시는 `sudo tail -f /opt/gopang/logs/hanlim.log`로 전환.

**결과**: `[AI-CHARGE] 검증 통과` → 블록 저장 → 잔액 실제 차감 확인
(`4011 → 4003.015464`, 두 번의 호출분 `3.637368`·`4.347168`과 소수점까지
정확히 일치).

## 4. 원인 3 — market-proxy 워커의 admin 계정이 실제와 안 맞음

원인 2를 고친 뒤에도 이번엔 다른 로그가 남았습니다:
```
[AI-CHARGE] ledger_entries 기록 실패(market-proxy 응답 500): {"ok":false,
"reason":"LEDGER_WRITE_FAILED","detail":"L1 admin 인증 실패
(https://l1-hanlim.hondi.net): 400 {\"code\":400,\"message\":
\"Failed to authenticate.\",\"data\":{}}"}
```
잔액 차감 자체(블록 저장)는 이미 성공한 뒤라 사용자에게 영향은 없었지만,
재무제표 원장(`ledger_entries`) 기록이 계속 실패하고 있었습니다.

### 4-1. 배제한 원인
hondi-proxy Worker의 `L1_ADMIN_EMAIL`/`PASSWORD`는 정상 동작 중임을 먼저
확인했습니다 — 같은 인증 엔드포인트(`/api/admins/auth-with-password`)를
쓰는 `/user/gdc-balance`가 이미 계속 정상 응답하고 있었기 때문입니다.
→ hanlim 서버의 admin 계정 자체와 hondi-proxy의 자격증명은 문제없음.

### 4-2. 진짜 원인
`market-proxy`는 **hondi-proxy와 완전히 별개인 Cloudflare Worker**이고
(`services/gopang-worker`, `wrangler.toml`의 `name = "market-proxy"`),
`L1_ADMIN_EMAIL`/`PASSWORD`를 **자기 자신의 secret store에 따로** 갖고
있습니다. 대시보드에서 확인한 결과 두 secret 모두 "존재"는 했지만, 값이
실제 admin 계정과 맞지 않았습니다.

재등록을 시도하는 과정에서 첫 시도가 `"identity":{"code":
"validation_required","message":"Cannot be blank."}`로 실패 — `wrangler
secret put L1_ADMIN_EMAIL` 대화형 프롬프트가 실제로는 빈 값을 등록한
것으로 확인됐습니다(터미널에 입력 반향이 전혀 없어 사용자가 "제대로
입력됐는지" 눈으로 확인할 방법이 없었던 것도 원인 파악을 늦춘 요인).

### 4-3. 수정
값을 다시 추측하기보다, hanlim 서버에 이 용도 전용 admin 계정을 새로
발급해 그 값을 그대로 등록하는 방식으로 확실하게 처리했습니다:

```bash
# hanlim 서버(SSH)
sudo /opt/gopang/pocketbase admin create ai-charge-svc@hondi.net 'hondi2026charge' \
  --dir=/opt/gopang/pb/hanlim

# 등록 직후 curl로 즉시 검증(market-proxy를 거치지 않고 직접)
curl -s -X POST https://l1-hanlim.hondi.net/api/admins/auth-with-password \
  -H "Content-Type: application/json" \
  -d '{"identity":"ai-charge-svc@hondi.net","password":"hondi2026charge"}'
# → token 필드 포함된 정상 응답으로 계정 유효성 먼저 확정
```
```powershell
# 본인 PC(PowerShell) — market-proxy 워커에 등록
cd .../services/gopang-worker
"ai-charge-svc@hondi.net" | wrangler secret put L1_ADMIN_EMAIL --name market-proxy
"hondi2026charge" | wrangler secret put L1_ADMIN_PASSWORD --name market-proxy
```
재등록 후 K-Plan 재요청 → 로그에 `ledger_entries 기록 요청 완료
(market-proxy)` 확인.

## 5. 재발 방지 — 다음 개발자가 지킬 것

1. **새 시크릿을 systemd 서비스에 추가할 때는 `override.conf`에
   `Environment=` 줄을 늘리지 말고, 애초에 `EnvironmentFile=`을 쓰는
   유닛으로 만들 것.** (이미 개별 줄 방식으로 굳어진 유닛은 이번처럼
   `EnvironmentFile=`을 추가해 근본적으로 고칠 것 — 나중에 또 잊는다.)
2. **오래 떠 있는 systemd 프로세스의 환경변수를 바꿨다면 반드시 재시작할
   것.** `.env`를 고치는 것과 그 값이 실제로 반영되는 것은 별개다.
3. **로그가 조용하다고 "요청이 안 왔다"로 단정하지 말 것** — 먼저
   `systemctl cat <unit>`으로 `StandardOutput=`이 journald인지 파일인지
   확인할 것.
4. **`wrangler secret put`은 등록만으로 끝내지 말고, 그 직후 반드시 실제
   인증/실사용 테스트를 한 번 거칠 것.** 대화형 프롬프트가 조용히 빈 값을
   등록할 수 있다(§4-2).
5. **이름이 같은 시크릿이 여러 Cloudflare Worker에 각각 존재할 수 있다는
   것을 항상 의심할 것.** `hondi-proxy`에 있다고 `market-proxy`에도 있는
   게 아니다 — Cloudflare 대시보드 URL의 워커 이름을 항상 먼저 확인.
6. **"코드 리뷰상 정상"과 "실제로 동작함"은 다르다.** 이번 사고 전체가
   worker.js 코드 자체는 문제없어 보이는 상태에서, 인프라 설정 3곳이
   각각 조용히 어긋나 있었던 경우다. 새 과금 경로를 추가하거나 만졌다면
   반드시 [`GDC_BILLING_DEVELOPER_MANUAL_v1_0_20260903.md`](./GDC_BILLING_DEVELOPER_MANUAL_v1_0_20260903.md)
   §7의 진단 플레이북대로 실사용 테스트까지 거칠 것.

## 6. 관련 커밋/PR

- PR #21 — `fix: K-Plan 개인별 하드캡(300원·5회/일) 제거 - 실제 GDC 잔액만으로 한도 판단`
- hanlim 서버 `gopang-pb-hanlim.service` override.conf 수정(인프라 변경 —
  이 저장소의 git 이력에는 없음, 서버에 직접 반영)
- market-proxy 워커 `L1_ADMIN_EMAIL`/`L1_ADMIN_PASSWORD` 재등록(인프라
  변경 — 마찬가지로 git 이력 없음)
