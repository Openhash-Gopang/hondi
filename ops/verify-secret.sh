#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# 2026-09-16 신설 — 시크릿을 바꾼 "직후" 실제로 반영됐는지 즉시 확인하는
# 표준 절차.
#
# 배경: 09-03 AI_CHARGE_SECRET 드리프트 사고, 09-16 ADMIN_ACTION_SECRET
# 드리프트 사고 둘 다 "값을 바꿨다"와 "그 값이 실제로 동작한다"를 확인할
# 표준 절차가 없어서, 사용자가 잔액 이상을 신고할 때까지 아무도 몰랐다.
# 이 스크립트는 그 확인 절차를 매번 손으로 curl 명령을 새로 조립하는 대신
# 한 줄로 표준화한다.
#
# 값 자체는 인자로 넘기거나(터미널 히스토리에 남는 걸 감수) 환경변수로
# 미리 export해서 넘기는 것(권장 — 히스토리에 안 남음) 둘 다 지원한다.
#
# 사용법:
#   ADMIN_ACTION_SECRET=<값> ./ops/verify-secret.sh admin_action
#   MINT_SECRET=<값>         ./ops/verify-secret.sh mint
#   AI_CHARGE_SECRET=<값>    ./ops/verify-secret.sh ai_charge
#
# ⚠️ 이 스크립트는 절대 진짜 GDC를 발행/차감하지 않는다 — mint·ai_charge
# 검증은 pb_hooks/main.pb.js가 지원하는 dry_run:true 모드를 쓴다(2026-09-16
# 신설, 시크릿 검증만 통과시키고 그 아래 실제 발행/차감 로직은 실행 안 함).
#
# ⚠️ 이 스크립트를 원격 서버(hanlim 등) SSH 세션에서 실행하는 건 무방하다
# — curl로 나가는 요청 자체엔 값이 URL에 노출되지 않고(POST body), 다만
# bash history에는 남으니 가능하면 값은 환경변수로 넘기고 이 스크립트
# 실행 후 `history -c`로 정리할 것.
# ═══════════════════════════════════════════════════════════
set -euo pipefail

PROXY_BASE="${PROXY_BASE:-https://hondi-proxy.tensor-city.workers.dev}"
L1_BASE="${L1_BASE:-https://l1-hanlim.hondi.net}"

kind="${1:-}"
if [[ -z "$kind" ]]; then
  echo "사용법: $0 {admin_action|mint|ai_charge}" >&2
  exit 1
fi

case "$kind" in
  admin_action)
    : "${ADMIN_ACTION_SECRET:?ADMIN_ACTION_SECRET 환경변수를 설정하세요}"
    echo "[검증] hondi-proxy의 ADMIN_ACTION_SECRET — POST /biz/charge-confirm-notification"
    resp=$(curl -s -w '\n%{http_code}' -X POST "${PROXY_BASE}/biz/charge-confirm-notification" \
      -H "Content-Type: application/json" \
      -d "{\"secret\":\"${ADMIN_ACTION_SECRET}\",\"raw_text\":\"검증용 12345678 1,000원 입금\",\"notification_key\":\"verify-secret-$(date +%s)\"}")
    body=$(echo "$resp" | head -n1)
    status=$(echo "$resp" | tail -n1)
    echo "  응답 코드: $status"
    echo "  응답 본문: $body"
    if [[ "$status" == "403" ]]; then
      echo "  ❌ FORBIDDEN — 값이 워커에 아직 반영 안 됐거나 오타/공백이 있습니다." >&2
      exit 2
    fi
    echo "  ✅ 403이 아님 — ADMIN_ACTION_SECRET 정상 반영 확인."
    ;;

  mint)
    : "${MINT_SECRET:?MINT_SECRET 환경변수를 설정하세요}"
    echo "[검증] hanlim의 MINT_SECRET — POST /api/mint (dry_run, 실제 발행 없음)"
    resp=$(curl -s -w '\n%{http_code}' -X POST "${L1_BASE}/api/mint" \
      -H "Content-Type: application/json" \
      -d "{\"secret\":\"${MINT_SECRET}\",\"guid\":\"verify-secret-dry-run\",\"krw_amount\":1,\"dry_run\":true}")
    body=$(echo "$resp" | head -n1)
    status=$(echo "$resp" | tail -n1)
    echo "  응답 코드: $status"
    echo "  응답 본문: $body"
    if [[ "$status" == "403" ]]; then
      echo "  ❌ FORBIDDEN — hanlim 프로세스가 이 MINT_SECRET을 모릅니다." >&2
      echo "     sudo cat /proc/<PID>/environ | grep MINT_SECRET 로 실제 반영 여부 확인." >&2
      exit 2
    fi
    echo "  ✅ 403이 아님 — MINT_SECRET 정상 반영 확인(실제 발행은 안 됐습니다)."
    ;;

  ai_charge)
    : "${AI_CHARGE_SECRET:?AI_CHARGE_SECRET 환경변수를 설정하세요}"
    echo "[검증] hanlim의 AI_CHARGE_SECRET — POST /api/ai-charge (dry_run, 실제 차감 없음)"
    resp=$(curl -s -w '\n%{http_code}' -X POST "${L1_BASE}/api/ai-charge" \
      -H "Content-Type: application/json" \
      -d "{\"secret\":\"${AI_CHARGE_SECRET}\",\"guid\":\"verify-secret-dry-run\",\"tx_hash\":\"verify\",\"krw_amount\":1,\"dry_run\":true}")
    body=$(echo "$resp" | head -n1)
    status=$(echo "$resp" | tail -n1)
    echo "  응답 코드: $status"
    echo "  응답 본문: $body"
    if [[ "$status" == "403" ]]; then
      echo "  ❌ FORBIDDEN — hanlim 프로세스가 이 AI_CHARGE_SECRET을 모릅니다." >&2
      exit 2
    fi
    echo "  ✅ 403이 아님 — AI_CHARGE_SECRET 정상 반영 확인(실제 차감은 안 됐습니다)."
    ;;

  *)
    echo "알 수 없는 종류: $kind (admin_action|mint|ai_charge 중 하나)" >&2
    exit 1
    ;;
esac
