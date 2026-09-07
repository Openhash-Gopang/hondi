#!/usr/bin/env python3
"""
K-Law 베타 기간 "토큰 종량제 × 배수" GDC 차감 LIVE smoketest.

배경: 2026-09-02 결정(주피터 지시) — 2026-12-31까지 K-Law의 기존 사건단위
정액과금(KLAW_CLAIM_FEE_SCHEDULE)을 중단하고, 판결 생성 포함 모든 호출을
일반 상담과 동일하게 토큰 종량제로 청구한다. 배수는 전역 공유 배수
(BILLING_MULTIPLIER_DEFAULT=10) 대신 K-Law 전용 베타 배수를 쓴다:
klaw-flash 10배, klaw-pro 5배 (worker.js KLAW_BETA_MULTIPLIER 참고).

klaw_billing_live_smoketest.py(F1/F3, 정액과금 시절 하네스)와 달리, 이
하네스는 "기대 차감액"을 미리 정해두지 않는다 — 대신 /klaw/relay 응답에
그대로 담겨오는 DeepSeek usage(prompt_cache_hit_tokens /
prompt_cache_miss_tokens / completion_tokens)를 읽어, worker.js의
_deepseekUsageToKRW + computeBilledKRW 공식을 이 스크립트 안에서 동일하게
재계산한 뒤, 그 값이 /biz/balance-status 전후 실제 차감액과 일치하는지로
채점한다. 이렇게 해야 DeepSeek 응답 토큰 수 자체는 매 호출 약간씩 달라져도
(짧은 인사말 등으로 결정적으로 통제하기 어려움) 각 호출의 "실제 사용량
기준 정답"을 매번 다시 계산해 비교할 수 있다.

★ 가격 상수 경고 — worker.js KLAW_TIER_MODELS['klaw-flash'].price
  ({cacheHit:0.0028, cacheMiss:0.14, output:0.28} $/1M)는 2026-08-16
  DeepSeek 리프라이싱(공식 문서 기준 오프피크 cacheMiss $0.22 /
  cacheHit $0.007 / output $0.66, 피크 2배) 이전 값 그대로다. 이 스크립트는
  "코드가 스스로의 공식을 정확히 실행하는지"만 검증하며, 그 공식이 실제
  DeepSeek 청구서와 일치하는지는 검증 범위 밖이다 — 아래 DEEPSEEK_FLASH_PRICE
  상수를 worker.js와 동일하게 고정한 이유가 그것이다. 가격 상수 자체를
  최신화하려면 worker.js 4곳(HONDI_TIER_MODELS/KLAW_TIER_MODELS/biz-flash/
  gov-flash) + 이 스크립트를 함께 바꿔야 한다.

★ 측정 해상도 문제와 repeat — klaw-flash 같은 저가 모델은 짧은 메시지 1회
  청구액이 1원 미만이라, /biz/balance-status가 정수로 반올림해 보여주는
  잔액에서는 그 변화가 표시 반올림에 묻혀버린다(예: 0.7원 청구돼도 잔액
  표시는 그대로일 수 있음). 이를 피하려고 각 시나리오는 "repeat"만큼
  /klaw/relay를 연속 호출해 사용량을 인위적으로 누적시킨 뒤, 그 전체
  구간의 시작/끝 잔액 차이를 (매 호출 usage로 계산한) 누적 기대 청구액
  합계와 비교한다 — 개별 호출 단위가 아니라 누적 단위로 채점한다.

★ 2026-09-07 수정(#104) — /klaw/relay가 2026-09-02부터 클라이언트가 보낸
guid를 신뢰하지 않고 phone_verify_token만 받도록 바뀌면서(handleKlawRelay,
worker.js 18811행 주석 참고), 이 스크립트가 --funded-guid만 보내던 이전
버전은 매 실행 첫 호출부터 LOGIN_REQUIRED로 막혔다(실사 재현, 2026-09-07
01:11 라이브 실행 결과 참고). SMS OTP 왕복을 CI에서 자동화하기보다,
서버가 실제 OTP 검증 성공 시 발급하는 것과 동일한 서명 방식
(HMAC-SHA256(PHONE_VERIFY_SECRET, "{e164}:{exp_ms}"), worker.js 392행
_hmacSha256Hex 그대로)을 이 스크립트가 오프라인으로 재현해 토큰을 직접
발급한다 — SMS 발송이라는 UX만 건너뛰고, 서명 검증이라는 인증 자체는
그대로 통과한다. guid는 더 이상 CLI 인자로 받지 않는다 — 발급한 토큰으로
POST /user/gdc-balance를 먼저 호출해(guid 없이 phone_verify_token만
요구) 실제 guid와 시작 잔액을 서버로부터 직접 얻는다(handleUserGdcBalance,
worker.js 489행).

Usage:
  PHONE_VERIFY_SECRET=... python3 klaw_usage_billing_live_smoketest.py \
      --scenarios scenarios_klaw_usage_billing_beta_20260907.json \
      --out ../../results/klaw_usage_billing_beta \
      --funded-e164 "+8201096627170"
"""
import argparse
import csv
import hashlib
import hmac
import json
import os
import sys
import time
import uuid

import requests

DEFAULT_WORKER_BASE = "https://hondi-proxy.tensor-city.workers.dev"
SETTLEMENT_POLL_ATTEMPTS = 6
SETTLEMENT_POLL_INTERVAL_S = 2
BALANCE_TOLERANCE_KRW = 2  # hit/miss/out 3항 반올림 누적 + GDC 정수 반올림 여유

# worker.js와 동일하게 고정 (KLAW_TIER_MODELS['klaw-flash'].price, $/1M tokens)
DEEPSEEK_FLASH_PRICE = {"cacheHit": 0.0028, "cacheMiss": 0.14, "output": 0.28}
USD_TO_KRW = 1500  # worker.js USD_TO_KRW와 동일
KLAW_BETA_MULTIPLIER_FLASH = 10  # worker.js KLAW_BETA_MULTIPLIER['klaw-flash']
EXCHANGE_RATE_KRW_PER_GDC = 1  # worker.js EXCHANGE_RATE_KRW_PER_GDC (테스트 기간 한정)


def make_phone_verify_token(secret, e164, ttl_ms=5 * 60 * 1000):
    """worker.js handlePhoneOtpVerify(392행)가 실제 OTP 검증 성공 시 발급하는
    것과 동일한 형식/서명 방식을 오프라인으로 재현한다. guid 없는 2필드
    payload("{e164}:{exp}")만 쓴다 — _resolveGuidFromPhoneVerifyToken은 어차피
    guid를 payload에서 읽지 않고 e164로 profiles를 직접 조회해 도출한다."""
    exp = int(time.time() * 1000) + ttl_ms
    payload = f"{e164}:{exp}"
    sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def resolve_guid_and_balance(worker_base, phone_verify_token):
    """POST /user/gdc-balance — phone_verify_token만으로 guid·잔액을 직접
    조회한다(handleUserGdcBalance, worker.js 489행). --funded-guid를 CLI에서
    안 받아도 되게 해주는 핵심 호출."""
    try:
        res = requests.post(
            f"{worker_base}/user/gdc-balance",
            json={"phone_verify_token": phone_verify_token},
            timeout=15,
        )
        data = res.json()
        if res.status_code != 200 or not data.get("ok"):
            print(f"    [guid resolve error] HTTP {res.status_code} — {json.dumps(data, ensure_ascii=False)[:300]}", file=sys.stderr)
            return None, None
        return data.get("guid"), data.get("balance")
    except Exception as e:
        print(f"    [guid resolve error] {e}", file=sys.stderr)
        return None, None


def get_balance_krw(worker_base, guid):
    try:
        res = requests.get(f"{worker_base}/biz/balance-status", params={"guid": guid}, timeout=15)
        data = res.json()
        if not data.get("ok"):
            return None
        return data.get("balance_krw")
    except Exception as e:
        print(f"    [balance lookup error] {e}", file=sys.stderr)
        return None


def call_klaw_relay(worker_base, guid, phone_verify_token, case_id, claim_amount_krw, step_cycle):
    body = {
        "guid": guid,  # handleKlawRelay가 실제로 신뢰하는 건 아니지만(2026-09-02부터
        # phone_verify_token으로 강제 치환됨), 하위호환을 위해 계속 실어 보낸다.
        "phone_verify_token": phone_verify_token,
        "tier": "klaw-flash",
        "messages": [
            {"role": "system", "content": "You are a test harness call. Reply with exactly one short sentence."},
            {"role": "user", "content": "이 요청은 K-Law GDC 베타 토큰 종량제 과금 라이브 스모크테스트입니다. 아주 짧게 한 문장으로만 답하세요."},
        ],
        "max_tokens": 40,
        "stream": False,
    }
    if step_cycle:
        body["step_cycle"] = True
    if case_id:
        body["case_id"] = case_id
    if claim_amount_krw is not None:
        body["claim_amount_krw"] = claim_amount_krw

    t0 = time.time()
    try:
        headers = {"Origin": "https://klaw.hondi.net"}
        res = requests.post(f"{worker_base}/klaw/relay", json=body, headers=headers, timeout=90)
        elapsed = time.time() - t0
        try:
            data = res.json()
        except Exception:
            data = {"_raw_text": res.text[:500]}
        return {"status": res.status_code, "elapsed_s": round(elapsed, 2), "body": data}
    except Exception as e:
        elapsed = time.time() - t0
        return {"status": None, "elapsed_s": round(elapsed, 2), "body": {"error": "REQUEST_EXCEPTION", "message": str(e)}}


def wait_for_settlement_and_get_balance(worker_base, guid, balance_before):
    """정산이 ctx.waitUntil로 비동기 처리되므로, 잔액 변화가 감지될 때까지
    폴링한다. klaw_billing_live_smoketest.py와 동일한 패턴."""
    last = balance_before
    for _ in range(SETTLEMENT_POLL_ATTEMPTS):
        time.sleep(SETTLEMENT_POLL_INTERVAL_S)
        bal = get_balance_krw(worker_base, guid)
        if bal is not None:
            last = bal
            if bal != balance_before:
                time.sleep(SETTLEMENT_POLL_INTERVAL_S)
                bal2 = get_balance_krw(worker_base, guid)
                return bal2 if bal2 is not None else bal
    return last


def expected_billed_krw(usage):
    """worker.js _deepseekUsageToKRW + computeBilledKRW(klaw-flash, ×10)를
    그대로 재현. usage는 DeepSeek 응답의 usage 필드(dict)."""
    if not usage:
        return None
    hit = usage.get("prompt_cache_hit_tokens") or 0
    miss = usage.get("prompt_cache_miss_tokens")
    if miss is None:
        miss = (usage.get("prompt_tokens") or 0) - hit
    miss = max(miss, 0)
    out = usage.get("completion_tokens") or 0

    usd = (
        (hit / 1e6) * DEEPSEEK_FLASH_PRICE["cacheHit"]
        + (miss / 1e6) * DEEPSEEK_FLASH_PRICE["cacheMiss"]
        + (out / 1e6) * DEEPSEEK_FLASH_PRICE["output"]
    )
    api_cost_krw = usd * USD_TO_KRW
    billed_krw = api_cost_krw * KLAW_BETA_MULTIPLIER_FLASH
    return {
        "hit_tokens": hit, "miss_tokens": miss, "out_tokens": out,
        "api_cost_krw": round(api_cost_krw, 6),
        "billed_krw": round(billed_krw, 6),
        "billed_gdc": round(billed_krw / EXCHANGE_RATE_KRW_PER_GDC, 6),
    }


def grade(call_results, balance_delta_krw, cumulative_expected):
    """call_results: 이번 시나리오의 repeat회 호출 결과 리스트."""
    for i, result in enumerate(call_results):
        if result["status"] != 200:
            return "LIVE-FAIL", f"{i+1}번째 호출 HTTP {result['status']} (기대 200) — body: {json.dumps(result.get('body'), ensure_ascii=False)[:300]}"
        if not (result.get("body") or {}).get("usage"):
            return "LIVE-ERROR", f"{i+1}번째 호출 응답에 usage 필드가 없음 — 과금 계산 자체가 불가"

    if cumulative_expected is None:
        return "LIVE-ERROR", "expected 계산 실패"
    if balance_delta_krw is None:
        return "LIVE-ERROR", "잔액 조회 실패로 실제 차감액 확인 불가"

    exp = cumulative_expected["billed_krw"]
    n = len(call_results)
    tol = max(BALANCE_TOLERANCE_KRW, n * 0.5)  # 반복 횟수만큼 반올림 오차 여유를 비례 확대
    if abs(balance_delta_krw - exp) <= tol:
        return "LIVE-PASS", (
            f"{n}회 누적 토큰 {cumulative_expected['hit_tokens']}h/{cumulative_expected['miss_tokens']}m/"
            f"{cumulative_expected['out_tokens']}o → 기대 누적 차감 {exp:.4f}원, 실제 차감 {balance_delta_krw}원 "
            f"(허용오차 {tol:.1f}원 이내)"
        )
    return "LIVE-FAIL", (
        f"{n}회 누적 차감액 불일치 — 토큰 {cumulative_expected['hit_tokens']}h/{cumulative_expected['miss_tokens']}m/"
        f"{cumulative_expected['out_tokens']}o 기준 기대 {exp:.4f}원, 실제 {balance_delta_krw}원 "
        f"(차이 {balance_delta_krw - exp:.4f}원, 허용오차 {tol:.1f}원). "
        f"multiplierOverride가 실제로 전달되지 않았거나(전역 배수 10과 우연히 같을 수 있어 klaw-pro로도 교차 확인 권장), "
        f"가격 상수/환율 상수가 이 스크립트와 어긋났을 가능성."
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--worker-base", default=DEFAULT_WORKER_BASE)
    ap.add_argument("--funded-e164", required=True,
                     help='잔액 충분한 테스트 계정의 전화번호, 내부 표준 형식(예: "+8201096627170")')
    ap.add_argument("--phone-verify-secret", default=os.environ.get("PHONE_VERIFY_SECRET"),
                     help="worker.js PHONE_VERIFY_SECRET과 동일한 값(HMAC 서명용). 생략 시 PHONE_VERIFY_SECRET 환경변수 사용")
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    if not args.phone_verify_secret:
        print("PHONE_VERIFY_SECRET이 없습니다 — --phone-verify-secret 또는 환경변수로 넘겨주세요.", file=sys.stderr)
        sys.exit(2)

    # TTL 30분 — 두 시나리오 × repeat 30회 순차 호출이 여유 있게 끝나도록
    # 넉넉히 잡는다(서버 쪽 상한은 PHONE_VERIFY_TOKEN_TTL_MS=60분).
    phone_verify_token = make_phone_verify_token(args.phone_verify_secret, args.funded_e164, ttl_ms=30 * 60 * 1000)
    guid, balance_gdc = resolve_guid_and_balance(args.worker_base, phone_verify_token)
    if not guid:
        print(f"guid 조회 실패 — {args.funded_e164}로 등록된 프로필이 없거나 PHONE_VERIFY_SECRET이 Cloudflare 쪽과 다릅니다.", file=sys.stderr)
        sys.exit(2)
    print(f"[auth] e164={args.funded_e164} → guid={guid} (현재 잔액 {balance_gdc} GDC)")

    with open(args.scenarios, encoding="utf-8") as f:
        scenarios = json.load(f)

    os.makedirs(args.out, exist_ok=True)
    jsonl_path = os.path.join(args.out, "live_results.jsonl")
    json_path = os.path.join(args.out, "live_results.json")
    csv_path = os.path.join(args.out, "live_results.csv")
    summary_path = os.path.join(args.out, "live_summary.json")

    done_nos = set()
    if args.resume and os.path.exists(jsonl_path):
        with open(jsonl_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    done_nos.add(json.loads(line)["no"])
                except Exception:
                    pass

    results = []
    jsonl_f = open(jsonl_path, "a", encoding="utf-8")
    t_start = time.time()

    for sc in scenarios:
        no = sc["no"]
        if no in done_nos:
            print(f"[{no}] resume — skip (already recorded)")
            continue

        print(f"[{no}] {sc['title']}")

        repeat = max(1, int(sc.get("repeat", 1)))
        base_case_id = sc.get("case_id")

        balance_before = get_balance_krw(args.worker_base, guid)

        call_results = []
        cumulative = {"hit_tokens": 0, "miss_tokens": 0, "out_tokens": 0, "api_cost_krw": 0.0, "billed_krw": 0.0}
        for i in range(repeat):
            case_id = f"smoketest-usage-{uuid.uuid4()}" if base_case_id == "auto" else base_case_id
            result = call_klaw_relay(
                args.worker_base, guid, phone_verify_token, case_id,
                sc.get("claim_amount_krw"), sc.get("step_cycle", False),
            )
            call_results.append(result)
            if result["status"] == 200:
                exp = expected_billed_krw((result.get("body") or {}).get("usage"))
                if exp:
                    cumulative["hit_tokens"] += exp["hit_tokens"]
                    cumulative["miss_tokens"] += exp["miss_tokens"]
                    cumulative["out_tokens"] += exp["out_tokens"]
                    cumulative["api_cost_krw"] += exp["api_cost_krw"]
                    cumulative["billed_krw"] += exp["billed_krw"]
            else:
                break  # 실패 시 이후 반복은 의미 없음 — 즉시 채점 단계로

        expected = cumulative if any(call_results) else None
        balance_after = None
        balance_delta = None
        if all(r["status"] == 200 for r in call_results):
            balance_after = wait_for_settlement_and_get_balance(args.worker_base, guid, balance_before)
            if balance_before is not None and balance_after is not None:
                balance_delta = round(balance_before - balance_after, 4)

        verdict, reason = grade(call_results, balance_delta, expected)

        record = {
            "no": no, "title": sc["title"], "verdict": verdict, "reason": reason,
            "guid": guid, "repeat": repeat, "calls": len(call_results),
            "http_statuses": [r["status"] for r in call_results],
            "cumulative_expected": expected,
            "balance_before_krw": balance_before, "balance_after_krw": balance_after,
            "balance_delta_krw": balance_delta,
        }
        results.append(record)
        jsonl_f.write(json.dumps(record, ensure_ascii=False) + "\n")
        jsonl_f.flush()
        print(f"    -> {verdict} ({reason})")

    jsonl_f.close()

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    if results:
        with open(csv_path, "w", encoding="utf-8", newline="") as f:
            fieldnames = ["no", "title", "verdict", "reason", "guid", "repeat", "calls",
                          "balance_before_krw", "balance_after_krw", "balance_delta_krw"]
            w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            w.writeheader()
            for r in results:
                w.writerow(r)

    counts = {}
    for r in results:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    summary = {
        "total": len(results), "counts": counts,
        "runtime_seconds": round(time.time() - t_start, 1),
    }
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n=== SUMMARY ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    # ★ 2026-09-07 수정 — 이전 버전은 채점 결과와 무관하게 항상 exit 0으로
    # 끝나, LIVE-FAIL/LIVE-ERROR가 있어도 CI 단계가 초록불로 표시되는
    # 결함이 있었다(라이브 실행에서 실제로 재현됨 — funded_guid 오류로
    # 두 시나리오 모두 LIVE-FAIL이었는데 워크플로는 success였음). 이제
    # LIVE-FAIL 또는 LIVE-ERROR가 하나라도 있으면 비정상 종료해 CI 단계
    # 자체를 실패로 표시한다. LIVE-PASS/LIVE-SKIPPED만 있으면 0으로 종료.
    bad = counts.get("LIVE-FAIL", 0) + counts.get("LIVE-ERROR", 0)
    if bad > 0:
        print(f"\n{bad}개 시나리오가 LIVE-FAIL/LIVE-ERROR — 비정상 종료(exit 1)", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
