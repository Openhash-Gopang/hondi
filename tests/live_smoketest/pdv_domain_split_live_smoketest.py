#!/usr/bin/env python3
"""
PDV 일상/업무 분할(domain split) 라이브 smoketest.

billing_autoproposal_live_smoketest.py / klaw_billing_live_smoketest.py와 동일한
원칙 — 실제 worker.js(hondi-proxy) /pdv/report 엔드포인트를 HTTP로 진짜 호출하고,
"부수효과"(PocketBase pdv_records 컬렉션에 실제로 무엇이 저장됐는지)로 채점한다.
/pdv/report의 HTTP 200 응답 자체(ok:true)는 domain/affiliation_org_id가 서버
설계 의도대로 분류됐는지와 무관하다 — 예를 들어 domain 값에 오탈자가 있어도
서버는 조용히 'personal'로 강등하고 200을 반환하므로, 실제로 저장된 레코드를
PocketBase Admin API로 직접 조회해야만 회귀를 잡을 수 있다.

배경(docs/PDV_QUERY_PROTOCOL_v1_0.md와의 관계):
  2026-06-05 작성된 PDV_QUERY_PROTOCOL_v1_0.md는 "/pdv/query"(동의 기반 타기관
  조회)가 pdv_log에서 6하원칙 요약을 반환한다고 서술한다. 그러나 2026-08-20
  해시 전용 재설계(주피터 지시)로 pdv_records.summary/summary_6w는 이제 평문이
  아니라 content_hash만 담으므로, 서버가 돌려줄 읽을 수 있는 내용이 없어져
  handlePdvQuery는 완전히 죽은 코드가 됐고 항상 410 FEATURE_REMOVED_HASH_ONLY_REDESIGN을
  반환한다(worker.js 18053행 주석 참조). 즉 그 문서는 현재 코드와 더 이상 맞지
  않는다 — 이 하네스의 시나리오 7번은 "누군가 문서만 보고 /pdv/query를 다시
  살렸다가 조용히 옛 동작으로 되돌아가는" 회귀를 잡기 위한 가드다(문서 자체를
  최신화하는 건 이 스크립트의 범위 밖).

실제 사용자 일상/업무 기록은 지금은 오직 /pdv/report(쓰기, domain=personal|work
분할) + /pdv/my-records(본인 조회, Ed25519 서명 인증 필요)로만 이뤄진다. 이
하네스는 서명 인프라가 필요 없는 /pdv/report 경로만 다룬다 — /pdv/my-records
라이브 검증은 클라이언트 Ed25519 키페어 생성·서명이 필요해 별도 하네스로 분리하는
것을 권장한다(src/pdv/keyManager.js의 generateKeyPair/signMessage를 Node에서
그대로 재사용 가능 — 이 저장소엔 아직 그런 python/node 서명 하네스가 없다).

매 실행마다 완전히 새로운 합성 guid(ipv6 형태 문자열)를 써서 실제 운영 데이터를
오염시키지 않는다.

Usage:
  python3 pdv_domain_split_live_smoketest.py \
      --scenarios scenarios_pdv_domain_split_20260908.json \
      --out ../../results/pdv-domain-split \
      --pb-base https://l1-hanlim.hondi.net \
      --pb-admin-email <admin email> --pb-admin-password <admin password>

--pb-admin-email/--pb-admin-password 대신 환경변수 PB_ADMIN_EMAIL/
PB_ADMIN_PASSWORD로도 줄 수 있다(GitHub Secrets 권장 — 다른 하네스들과 동일한
관례).

Resumable: --resume 주면 이미 기록된 no는 재실행하지 않는다.
"""
import argparse
import csv
import hashlib
import json
import os
import sys
import time
import uuid

import requests

DEFAULT_WORKER_BASE = "https://hondi-proxy.tensor-city.workers.dev"
DEFAULT_PB_BASE = "https://l1-hanlim.hondi.net"
WRITE_PROPAGATION_WAIT_S = 2   # PocketBase 쓰기 직후 조회 타이밍 여유
ORIGIN = "https://hondi.net"   # REGISTERED_SERVICES['gopang'].domain 매칭용
SVC_ID = "gopang"


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


def pb_get_pdv_record(pb_base, token, report_id):
    headers = {"Authorization": f"Bearer {token}"}
    filt = f"report_id='{report_id}'"
    res = requests.get(
        f"{pb_base}/api/collections/pdv_records/records",
        params={"filter": filt, "perPage": 5}, headers=headers, timeout=15,
    )
    items = res.json().get("items", [])
    return items[0] if items else None


def call_pdv_report(worker_base, guid, session_id, overrides):
    content_hash = hashlib.sha256(f"smoketest:{session_id}".encode()).hexdigest()
    report = {
        "svc": SVC_ID,
        "who": {"ipv6": guid},
        "session_id": session_id,
        "reporter_svc": SVC_ID,
        "content_hash": content_hash,
        "type": "smoketest",
    }
    if overrides.get("_omit_content_hash"):
        report.pop("content_hash")
    for k, v in overrides.items():
        if k.startswith("_"):
            continue
        report[k] = v

    body = {"report": report}
    headers = {"Content-Type": "application/json", "Origin": ORIGIN}
    t0 = time.time()
    try:
        res = requests.post(f"{worker_base}/pdv/report", json=body, headers=headers, timeout=30)
        elapsed = time.time() - t0
        try:
            data = res.json()
        except Exception:
            data = None
        return res.status_code, data, elapsed, None
    except Exception as e:
        return None, None, time.time() - t0, str(e)


def call_pdv_query_regression_guard(worker_base):
    headers = {"Content-Type": "application/json", "Origin": ORIGIN}
    body = {"query": {"svc": SVC_ID, "ipv6": "smoketest::guard", "scope": ["pdv_general"],
                       "period": {"start": "2026-01-01", "end": "2026-01-02"}}}
    t0 = time.time()
    try:
        res = requests.post(f"{worker_base}/pdv/query", json=body, headers=headers, timeout=30)
        elapsed = time.time() - t0
        try:
            data = res.json()
        except Exception:
            data = None
        return res.status_code, data, elapsed, None
    except Exception as e:
        return None, None, time.time() - t0, str(e)


def grade(scn, http_status, http_body, pb_record):
    expect = scn["expect"]
    reasons = []

    ok_actual = bool(http_body and http_body.get("ok"))
    if expect.get("http_ok") is not None and ok_actual != expect["http_ok"]:
        reasons.append(f"ok 불일치: expected={expect['http_ok']} actual={ok_actual}")

    if "http_status" in expect and http_status != expect["http_status"]:
        reasons.append(f"HTTP status 불일치: expected={expect['http_status']} actual={http_status}")

    if "error_code" in expect:
        actual_code = (http_body or {}).get("error")
        if actual_code != expect["error_code"]:
            reasons.append(f"error 코드 불일치: expected={expect['error_code']} actual={actual_code}")

    if expect.get("skipped"):
        if not (http_body or {}).get("skipped"):
            reasons.append("skipped:true 기대했으나 없음")
        elif (http_body or {}).get("reason") != expect.get("reason"):
            reasons.append(f"reason 불일치: expected={expect.get('reason')} actual={(http_body or {}).get('reason')}")

    if "domain" in expect:
        if pb_record is None:
            reasons.append("PocketBase에서 pdv_records 레코드를 찾지 못함 — domain 검증 불가")
        else:
            actual_domain = pb_record.get("domain") or None
            expected_domain = expect["domain"]
            # PocketBase select 필드는 미설정 시 빈 문자열일 수 있음 — personal 기본값과 동치로 취급
            if expected_domain == "personal" and actual_domain in (None, ""):
                pass
            elif actual_domain != expected_domain:
                reasons.append(f"domain 불일치: expected={expected_domain} actual={actual_domain!r}")

    if "affiliation_org_id" in expect:
        if pb_record is None:
            reasons.append("PocketBase 레코드 없음 — affiliation_org_id 검증 불가")
        else:
            actual_aff = pb_record.get("affiliation_org_id") or None
            if actual_aff != expect["affiliation_org_id"]:
                reasons.append(f"affiliation_org_id 불일치: expected={expect['affiliation_org_id']!r} actual={actual_aff!r}")

    if not reasons:
        return "LIVE-PASS", ""
    return "LIVE-FAIL", "; ".join(reasons)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="scenarios_pdv_domain_split_20260908.json")
    ap.add_argument("--out", default="../../results/pdv-domain-split")
    ap.add_argument("--worker-base", default=DEFAULT_WORKER_BASE)
    ap.add_argument("--pb-base", default=DEFAULT_PB_BASE)
    ap.add_argument("--pb-admin-email", default=os.environ.get("PB_ADMIN_EMAIL"))
    ap.add_argument("--pb-admin-password", default=os.environ.get("PB_ADMIN_PASSWORD"))
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    if not args.pb_admin_email or not args.pb_admin_password:
        print("PocketBase admin 계정 정보가 없습니다 (--pb-admin-email/--pb-admin-password "
              "또는 PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD 환경변수).", file=sys.stderr)
        sys.exit(1)

    with open(args.scenarios, encoding="utf-8") as f:
        scenarios = json.load(f)

    os.makedirs(args.out, exist_ok=True)
    results_path = os.path.join(args.out, "live_results.jsonl")

    done = set()
    if args.resume and os.path.exists(results_path):
        with open(results_path, encoding="utf-8") as f:
            for line in f:
                try:
                    done.add(json.loads(line)["no"])
                except Exception:
                    pass

    pb_token = pb_admin_login(args.pb_base, args.pb_admin_email, args.pb_admin_password)

    run_guid = f"smoketest-pdv-{uuid.uuid4().hex[:16]}"
    session_ids = {}  # no -> session_id, for _reuse_session_from

    results = []
    with open(results_path, "a", encoding="utf-8") as out_f:
        for scn in scenarios:
            no = scn["no"]
            if no in done:
                print(f"[{no}] skip (already done)")
                continue

            print(f"[{no}] {scn['name']}")

            if scn.get("is_pdv_query_regression_guard"):
                status, body, elapsed, err = call_pdv_query_regression_guard(args.worker_base)
                verdict, reason = grade(scn, status, body, None)
                record = {"no": no, "name": scn["name"], "verdict": verdict, "reason": reason,
                          "http_status": status, "http_body": body, "elapsed_s": round(elapsed, 2),
                          "error": err}
                results.append(record)
                out_f.write(json.dumps(record, ensure_ascii=False) + "\n")
                out_f.flush()
                print(f"    -> {verdict} {reason}")
                continue

            overrides = dict(scn.get("report_overrides", {}))
            reuse_from = overrides.pop("_reuse_session_from", None)
            if reuse_from is not None:
                session_id = session_ids.get(reuse_from)
                if session_id is None:
                    verdict, reason = "LIVE-ERROR", f"_reuse_session_from={reuse_from} 참조 시나리오가 아직 실행되지 않음"
                    record = {"no": no, "name": scn["name"], "verdict": verdict, "reason": reason}
                    results.append(record)
                    out_f.write(json.dumps(record, ensure_ascii=False) + "\n")
                    out_f.flush()
                    print(f"    -> {verdict} {reason}")
                    continue
            else:
                session_id = f"smoketest-{uuid.uuid4().hex[:16]}"
            session_ids[no] = session_id

            guid = run_guid
            status, body, elapsed, err = call_pdv_report(args.worker_base, guid, session_id, overrides)

            if err:
                record = {"no": no, "name": scn["name"], "verdict": "LIVE-ERROR", "reason": err}
                results.append(record)
                out_f.write(json.dumps(record, ensure_ascii=False) + "\n")
                out_f.flush()
                print(f"    -> LIVE-ERROR {err}")
                continue

            time.sleep(WRITE_PROPAGATION_WAIT_S)

            pb_record = None
            if status == 200 and body and body.get("ok") and not body.get("skipped"):
                report_id_filter = f"{session_id}:{SVC_ID}"
                pb_record = pb_get_pdv_record(args.pb_base, pb_token, report_id_filter)

            verdict, reason = grade(scn, status, body, pb_record)
            record = {
                "no": no, "name": scn["name"], "verdict": verdict, "reason": reason,
                "http_status": status, "http_body": body,
                "pb_record": {k: pb_record.get(k) for k in ("id", "domain", "affiliation_org_id", "report_id")} if pb_record else None,
                "elapsed_s": round(elapsed, 2),
            }
            results.append(record)
            out_f.write(json.dumps(record, ensure_ascii=False) + "\n")
            out_f.flush()
            print(f"    -> {verdict} {reason}")

    # 요약 저장
    all_results = results
    if args.resume and os.path.exists(results_path):
        all_results = []
        with open(results_path, encoding="utf-8") as f:
            for line in f:
                try:
                    all_results.append(json.loads(line))
                except Exception:
                    pass

    with open(os.path.join(args.out, "live_results.json"), "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)

    with open(os.path.join(args.out, "live_results.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["no", "name", "verdict", "reason", "http_status"])
        for r in all_results:
            w.writerow([r.get("no"), r.get("name"), r.get("verdict"), r.get("reason"), r.get("http_status")])

    counts = {}
    for r in all_results:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    summary = {"total": len(all_results), "counts": counts, "run_guid": run_guid}
    with open(os.path.join(args.out, "live_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n=== 요약 ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
