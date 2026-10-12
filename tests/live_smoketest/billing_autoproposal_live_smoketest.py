#!/usr/bin/env python3
"""
나비 자율 과금 제안 시스템 LIVE smoketest.

klaw_billing_live_smoketest.py와 동일한 원칙 — 실제 worker.js(hondi-proxy)
/gov/relay 엔드포인트를 HTTP로 진짜 호출하고, "부수효과"(PocketBase
billing_rule_proposals/billing_signal_events 컬렉션 변화)로 채점한다.
/gov/relay의 HTTP 200 응답 자체는 자율 과금 제안이 실제로 생성됐는지와
무관하다(신호 기록·제안 생성은 fire-and-forget으로 응답을 막지 않음) —
그래서 각 시나리오 뒤에 PocketBase Admin API로 실제 컬렉션 상태를 직접
조회해 검증한다.

매 실행마다 완전히 새로운 합성 task_key(kcc:smoketest_billing_<uuid>)를
써서 실제 운영 데이터를 오염시키지 않는다 — agency는 이미 등록된 실제
기관(kcc)을 쓰되(SP 로드 자체가 실패하지 않도록), task_key만 합성이라
REQUIRED_DOCUMENTS_REGISTRY 조회는 항상 miss되고 순수 관측 목적으로만
쓰인다.

Usage:
  python3 billing_autoproposal_live_smoketest.py \
      --scenarios scenarios_billing_autoproposal_20260814.json \
      --out ../../results/billing_autoproposal \
      --pb-base https://l1-hanlim.hondi.net \
      --pb-admin-email <admin email> --pb-admin-password <admin password>

--pb-admin-email/--pb-admin-password 대신 환경변수 PB_ADMIN_EMAIL/
PB_ADMIN_PASSWORD로도 줄 수 있다(GitHub Secrets 권장 — klaw 하네스의
DEEPSEEK_API_KEY와 동일한 관례).

Resumable: --resume 주면 이미 기록된 no는 재실행하지 않는다.
"""
import argparse
import csv
import json
import os
import sys
import time
import uuid

import requests

DEFAULT_WORKER_BASE = "https://hondi-proxy.tensor-city.workers.dev"
DEFAULT_PB_BASE = "https://l1-hanlim.hondi.net"
SIGNAL_PROPAGATION_WAIT_S = 3   # 신호 기록·제안 생성이 fire-and-forget이라 완료 대기
TEST_AGENCY = "public"          # kgov 자신 — GOV_AGENCIES에 등록된 실제 최상위 기관 코드.
                                 # "kcc"는 REQUIRED_DOCUMENTS_REGISTRY 안에서만 쓰이는
                                 # 하위 라벨(kgov가 내부적으로 처리)이지 /gov/relay가
                                 # 검사하는 GOV_AGENCIES 목록엔 없다 — 실사로 확인.


def pb_admin_login(pb_base, email, password):
    res = requests.post(
        f"{pb_base}/api/admins/auth-with-password",
        json={"identity": email, "password": password}, timeout=15,
    )
    data = res.json()
    token = data.get("token")
    if not token:
        raise RuntimeError(f"PocketBase admin 로그인 실패: {data}")
    return token


def pb_get_rule(pb_base, token, task_key):
    headers = {"Authorization": f"Bearer {token}"}
    filt = f"task_key='{task_key}'"
    res = requests.get(
        f"{pb_base}/api/collections/billing_rule_proposals/records",
        params={"filter": filt, "perPage": 5}, headers=headers, timeout=15,
    )
    items = res.json().get("items", [])
    return items[0] if items else None


def pb_get_signal_count(pb_base, token, task_key):
    headers = {"Authorization": f"Bearer {token}"}
    filt = f"task_key='{task_key}'"
    res = requests.get(
        f"{pb_base}/api/collections/billing_signal_events/records",
        params={"filter": filt, "perPage": 1}, headers=headers, timeout=15,
    )
    return res.json().get("totalItems", 0)


def call_gov_relay(worker_base, guid, task_key, roundtrips):
    body = {
        "guid": guid, "agency": TEST_AGENCY,
        "agencyPrompt": "You are a test harness call. Reply with exactly one short sentence.",
        "messages": [
            {"role": "user", "content": "이 요청은 나비 자율 과금 제안 시스템 라이브 스모크테스트입니다. 아주 짧게 한 문장으로만 답하세요."},
        ],
        "max_tokens": 40, "stream": False, "tier": "gov-flash",
        "task_key": task_key, "gov_task_roundtrips": roundtrips,
    }
    t0 = time.time()
    try:
        # worker.js AI_PROXY_PATHS 보호 — Origin 헤더 없는 요청은 403
        # FORBIDDEN_NO_ORIGIN으로 차단된다('/gov/relay'도 이 목록에 포함,
        # klaw 하네스와 동일 이유) — regional-gov.html이 실제로 서비스되는
        # 도메인(ALLOWED_ORIGINS 목록)을 그대로 사용.
        headers = {"Origin": "https://hondi.net"}
        res = requests.post(f"{worker_base}/gov/relay", json=body, headers=headers, timeout=60)
        elapsed = time.time() - t0
        try:
            data = res.json()
        except Exception:
            data = {"_raw_text": res.text[:300]}
        return {"status": res.status_code, "elapsed_s": round(elapsed, 2), "body": data}
    except Exception as e:
        elapsed = time.time() - t0
        return {"status": None, "elapsed_s": round(elapsed, 2), "body": {"error": "REQUEST_EXCEPTION", "message": str(e)}}


def run_precondition_check(sc, worker_base, pb_base, token, guid_prefix):
    """no=1: 아직 아무 신호도 안 쌓인 신선한 task_key엔 규칙이 없어야 함."""
    task_key = f"{TEST_AGENCY}:smoketest_billing_precheck_{uuid.uuid4()}"
    rule = pb_get_rule(pb_base, token, task_key)
    if rule is None:
        return "LIVE-PASS", "신선한 task_key에 규칙 없음(기대대로)", task_key, None
    return "LIVE-FAIL", f"신선한 task_key인데 이미 규칙이 있음: {rule}", task_key, rule


def run_threshold_trigger(sc, worker_base, pb_base, token, guid_prefix):
    """no=2: call_count회 실제 호출 후 규칙이 자동 생성·활성화되는지."""
    task_key_suffix = f"smoketest_billing_trigger_{uuid.uuid4()}"
    task_key = f"{TEST_AGENCY}:{task_key_suffix}"
    call_count = sc["call_count"]
    roundtrips = sc["gov_task_roundtrips_per_call"]

    print(f"    {call_count}회 실제 /gov/relay 호출 중(task_key={task_key})...")
    fail_calls = 0
    first_failure = None
    for i in range(call_count):
        guid = f"{guid_prefix}-{i}"
        result = call_gov_relay(worker_base, guid, task_key, roundtrips)
        if result["status"] != 200:
            fail_calls += 1
            if first_failure is None:
                first_failure = result
        if (i + 1) % 10 == 0:
            print(f"      {i + 1}/{call_count} 완료")

    if fail_calls > call_count * 0.2:  # 20% 넘게 실패하면 표본 자체가 신뢰 불가
        detail = json.dumps(first_failure, ensure_ascii=False)[:500] if first_failure else "(첫 실패 상세 없음)"
        return "LIVE-ERROR", f"{call_count}회 중 {fail_calls}회 HTTP 실패 — 표본 신뢰 불가 | 첫 실패: {detail}", task_key, None

    print(f"    신호 전파 대기 {SIGNAL_PROPAGATION_WAIT_S}초...")
    time.sleep(SIGNAL_PROPAGATION_WAIT_S)

    signal_count = pb_get_signal_count(pb_base, token, task_key)
    rule = pb_get_rule(pb_base, token, task_key)

    if rule is None:
        return "LIVE-FAIL", f"신호 {signal_count}건 기록됐으나 규칙 미생성", task_key, None

    exp_status = sc.get("expected_status")
    exp_based_on = sc.get("expected_based_on")
    if exp_status and rule.get("status") != exp_status:
        return "LIVE-FAIL", f"status 불일치(기대 {exp_status}, 실제 {rule.get('status')})", task_key, rule
    if exp_based_on and rule.get("based_on_service") != exp_based_on:
        return "LIVE-FAIL", f"based_on_service 불일치(기대 {exp_based_on}, 실제 {rule.get('based_on_service')})", task_key, rule
    if not rule.get("price_multiplier") or rule["price_multiplier"] <= 1.0:
        return "LIVE-FAIL", f"왕복 잦음 신호에도 배율이 그대로({rule.get('price_multiplier')}) — 2026-08-13 버그 재발", task_key, rule

    return "LIVE-PASS", f"규칙 생성 확인: status={rule.get('status')}, multiplier={rule.get('price_multiplier')}, based_on={rule.get('based_on_service')}, sample_size={rule.get('sample_size')}", task_key, rule


def run_cap_check(sc, worker_base, pb_base, token, task_key_by_no):
    """no=3: 이전 시나리오에서 만들어진 규칙의 배율이 상한 이내인지."""
    reuse_no = sc["reuse_task_key_from"]
    task_key = task_key_by_no.get(reuse_no)
    if not task_key:
        return "LIVE-ERROR", f"reuse_task_key_from={reuse_no}의 task_key를 찾을 수 없음(선행 시나리오 미실행?)", None, None
    rule = pb_get_rule(pb_base, token, task_key)
    if rule is None:
        return "LIVE-ERROR", "선행 시나리오의 규칙이 사라짐", task_key, None
    cap = sc["max_allowed_multiplier"]
    mult = rule.get("price_multiplier", 0)
    if mult > cap:
        return "LIVE-FAIL", f"배율 {mult}이 상한 {cap} 초과 — 폭주 방지 실패", task_key, rule
    return "LIVE-PASS", f"배율 {mult} <= 상한 {cap} 확인", task_key, rule


def run_no_duplicate_check(sc, worker_base, pb_base, token, task_key_by_no):
    """no=4: 이미 규칙 있는 task_key에 추가 호출해도 중복 규칙이 안 생기는지."""
    reuse_no = sc["reuse_task_key_from"]
    task_key = task_key_by_no.get(reuse_no)
    if not task_key:
        return "LIVE-ERROR", f"reuse_task_key_from={reuse_no}의 task_key를 찾을 수 없음", None, None

    extra = sc["extra_call_count"]
    for i in range(extra):
        call_gov_relay(worker_base, f"smoketest-dup-{uuid.uuid4()}", task_key, 4)
    time.sleep(SIGNAL_PROPAGATION_WAIT_S)

    headers = {"Authorization": f"Bearer {token}"}
    filt = f"task_key='{task_key}'"
    res = requests.get(
        f"{pb_base}/api/collections/billing_rule_proposals/records",
        params={"filter": filt, "perPage": 10}, headers=headers, timeout=15,
    )
    items = res.json().get("items", [])
    if len(items) != 1:
        return "LIVE-FAIL", f"규칙이 {len(items)}건 — UNIQUE 제약이 깨졌거나 예상과 다름(기대 1건)", task_key, items
    return "LIVE-PASS", "추가 호출 후에도 규칙 1건 유지(UNIQUE 정상)", task_key, items[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--worker-base", default=DEFAULT_WORKER_BASE)
    ap.add_argument("--pb-base", default=DEFAULT_PB_BASE)
    ap.add_argument("--pb-admin-email", default=os.environ.get("PB_ADMIN_EMAIL"))
    ap.add_argument("--pb-admin-password", default=os.environ.get("PB_ADMIN_PASSWORD"))
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    if not args.pb_admin_email or not args.pb_admin_password:
        print("PocketBase admin 계정 정보 없음(--pb-admin-email/--pb-admin-password 또는 "
              "PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD 환경변수 필요) — 전체 시나리오 LIVE-SKIPPED", file=sys.stderr)
        token = None
    else:
        token = pb_admin_login(args.pb_base, args.pb_admin_email, args.pb_admin_password)

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

    task_key_by_no = {}
    results = []
    if args.resume and os.path.exists(json_path):
        with open(json_path, encoding="utf-8") as f:
            try:
                results = json.load(f)
                for r in results:
                    if r.get("task_key"):
                        task_key_by_no[r["no"]] = r["task_key"]
            except Exception:
                results = []

    jsonl_f = open(jsonl_path, "a", encoding="utf-8")
    t_start = time.time()
    guid_prefix = f"smoketest-billing-{uuid.uuid4()}"

    for sc in scenarios:
        no = sc["no"]
        if no in done_nos:
            print(f"[{no}] resume — skip (already recorded)")
            continue

        print(f"[{no}] {sc['title']}")

        if token is None:
            record = {"no": no, "title": sc["title"], "finding": sc.get("finding"),
                       "verdict": "LIVE-SKIPPED", "reason": "PocketBase admin 계정 정보 없음",
                       "task_key": None, "rule": None}
            results.append(record)
            jsonl_f.write(json.dumps(record, ensure_ascii=False) + "\n")
            jsonl_f.flush()
            print("    -> LIVE-SKIPPED (admin 계정 정보 없음)")
            continue

        sc_type = sc["type"]
        if sc_type == "precondition_check":
            verdict, reason, task_key, rule = run_precondition_check(sc, args.worker_base, args.pb_base, token, guid_prefix)
        elif sc_type == "threshold_trigger":
            verdict, reason, task_key, rule = run_threshold_trigger(sc, args.worker_base, args.pb_base, token, guid_prefix)
        elif sc_type == "cap_check":
            verdict, reason, task_key, rule = run_cap_check(sc, args.worker_base, args.pb_base, token, task_key_by_no)
        elif sc_type == "no_duplicate_check":
            verdict, reason, task_key, rule = run_no_duplicate_check(sc, args.worker_base, args.pb_base, token, task_key_by_no)
        else:
            verdict, reason, task_key, rule = "LIVE-ERROR", f"알 수 없는 시나리오 타입: {sc_type}", None, None

        if task_key:
            task_key_by_no[no] = task_key

        record = {
            "no": no, "title": sc["title"], "finding": sc.get("finding"),
            "verdict": verdict, "reason": reason,
            "task_key": task_key, "rule": rule,
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
            fieldnames = ["no", "title", "finding", "verdict", "reason", "task_key"]
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
        "pb_admin_provided": bool(token),
    }
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n=== SUMMARY ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
