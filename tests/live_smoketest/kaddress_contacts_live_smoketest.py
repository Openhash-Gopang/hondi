#!/usr/bin/env python3
"""
K-Address 주소록(kmail_contacts) 등록 경로 LIVE smoketest.

이번 세션(2026-09-11)에 고친 것들의 회귀 방지 가드:
  1) CSV/엑셀 일괄 업로드(handleKmailContactsCsvImport)의 소속명 자동
     분류(_kaddressClassifyCategory)가 kmail_contacts.category select
     필드(21개 고정값)와 정확히 일치하는 문자열을 넣는지 — 실사 사고:
     코드 한 글자('P')만 넣어 레코드 생성 자체가 조용히 실패했었다.
  2) 세 등록 경로(propose/csv-import/chat-save save) 전부 저장 전 이메일
     중복을 확인하는지, 그리고 이메일 대소문자를 정규화해서 비교하는지
     — 실사 사고: propose(웹앱 "새 연락처 등록" 폼) 경로엔 중복 검사가
     아예 없었다.
  3) mailbox/drafts/message-state 다섯 엔드포인트가 phone_verify_token
     인증을 받아들이는지 — 실사 사고: 전부 지갑 서명만 지원해서 지갑
     SSO를 안 쓰는 mail.hondi.net 웹앱("메일" 탭)에서 아예 호출이
     막혀 있었다.
  4) GET /kmail/contacts/category-counts가 실제 PocketBase 카운트와
     일치하는지(전체 목록을 200건 캡으로 가져와 샘플 크기를 총 건수로
     오인했던 사고의 반대편 — 이번엔 count-only 엔드포인트 자체가
     맞는 값을 내는지).

klaw_usage_billing_live_smoketest.py와 동일한 원칙 — 실제 worker.js
(hondi-proxy) 엔드포인트를 HTTP로 진짜 호출하고, PocketBase Admin API로
실제 저장된 레코드를 직접 조회해 채점한다. HTTP 200(ok:true) 자체는
설계 의도대로 분류/중복처리됐는지와 무관하다(csv-import는 개별 레코드
생성이 실패해도 전체 응답은 여전히 200 ok:true를 낸다).

인증: 실제 registered 계정(주피터 본인 테스트 계정)의 phone_verify_token을
오프라인으로 재현해서 쓴다(klaw_usage_billing_live_smoketest.py의
make_phone_verify_token 그대로 재사용) — SMS OTP 왕복 없이 서명 검증만
통과시킨다.

★ 실계정 오염 방지 — PDV smoketest와 달리 이 계정은 매번 새로 만드는
합성 guid가 아니라 실제 등록된 계정(주소록 소유자)이라, 여기서 만드는
테스트 연락처가 실제 주소록에 그대로 쌓이면 안 된다. 그래서:
  - 모든 테스트 연락처는 status='pending_review'로 생성한다(기본값
    confirmed로 만들지 않음 — 확인됨/발송가능 목록에 안 섞이게).
  - 매 스모크테스트 실행이 끝나면(--no-cleanup을 안 준 이상) 생성한
    모든 연락처 id를 POST /kmail/contacts/decide로 rejected 처리해
    치운다(완전 삭제는 앱 설계상 원래 안 함 — 소프트 삭제 철학과 동일).
  - 이메일은 매번 새 uuid를 써서 실행 간 충돌(의도치 않은 dedup 오탐)도
    피한다.

Usage:
  PHONE_VERIFY_SECRET=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... \\
  python3 kaddress_contacts_live_smoketest.py \\
      --scenarios scenarios_kaddress_contacts_20260911.json \\
      --out ../../results/kaddress-contacts \\
      --test-e164 "+8201096627170"
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
DEFAULT_PB_BASE = "https://l1-hanlim.hondi.net"
WRITE_PROPAGATION_WAIT_S = 2


def make_phone_verify_token(secret, e164, ttl_ms=10 * 60 * 1000):
    """worker.js _resolveGuidFromPhoneVerifyToken이 검증하는 것과 동일한
    형식(klaw_usage_billing_live_smoketest.py의 make_phone_verify_token
    그대로 재사용)."""
    exp = int(time.time() * 1000) + ttl_ms
    payload = f"{e164}:{exp}"
    sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


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


def pb_find_contact_by_email(pb_base, pb_token, email):
    headers = {"Authorization": f"Bearer {pb_token}"}
    filt = f"email='{email}'"
    res = requests.get(
        f"{pb_base}/api/collections/kmail_contacts/records",
        params={"filter": filt, "perPage": 20}, headers=headers, timeout=15,
    )
    return res.json().get("items", [])


def fresh_email():
    return f"smoketest-{uuid.uuid4().hex[:12]}@example-smoketest.invalid"


def csv_import(worker_base, phone_verify_token, contacts, status="pending_review"):
    body = {"phone_verify_token": phone_verify_token, "contacts": contacts, "status": status}
    t0 = time.time()
    try:
        res = requests.post(f"{worker_base}/kmail/contacts/csv-import", json=body, timeout=30)
        return res.status_code, res.json(), time.time() - t0, None
    except Exception as e:
        return None, None, time.time() - t0, str(e)


def propose(worker_base, phone_verify_token, candidates):
    body = {"phone_verify_token": phone_verify_token, "recipient_query": "smoketest", "candidates": candidates}
    t0 = time.time()
    try:
        res = requests.post(f"{worker_base}/kmail/contacts/propose", json=body, timeout=30)
        return res.status_code, res.json(), time.time() - t0, None
    except Exception as e:
        return None, None, time.time() - t0, str(e)


def category_counts(worker_base, phone_verify_token, status="pending_review"):
    t0 = time.time()
    try:
        res = requests.get(f"{worker_base}/kmail/contacts/category-counts",
                            params={"phone_verify_token": phone_verify_token, "status": status}, timeout=30)
        return res.status_code, res.json(), time.time() - t0, None
    except Exception as e:
        return None, None, time.time() - t0, str(e)


def get_json(worker_base, path, phone_verify_token, extra_params=None):
    params = {"phone_verify_token": phone_verify_token}
    if extra_params:
        params.update(extra_params)
    t0 = time.time()
    try:
        res = requests.get(f"{worker_base}{path}", params=params, timeout=30)
        try:
            body = res.json()
        except Exception:
            body = None
        return res.status_code, body, time.time() - t0, None
    except Exception as e:
        return None, None, time.time() - t0, str(e)


def post_json(worker_base, path, phone_verify_token, extra_body=None):
    body = {"phone_verify_token": phone_verify_token}
    if extra_body:
        body.update(extra_body)
    t0 = time.time()
    try:
        res = requests.post(f"{worker_base}{path}", json=body, timeout=30)
        try:
            data = res.json()
        except Exception:
            data = None
        return res.status_code, data, time.time() - t0, None
    except Exception as e:
        return None, None, time.time() - t0, str(e)


def decide_reject(worker_base, phone_verify_token, contact_id):
    """정리(cleanup)용 — 실계정 오염 방지."""
    try:
        requests.post(f"{worker_base}/kmail/contacts/decide", json={
            "phone_verify_token": phone_verify_token, "contact_id": contact_id, "decision": "reject",
        }, timeout=15)
    except Exception as e:
        print(f"    (정리 실패, 무시하고 계속: contact_id={contact_id} {e})", file=sys.stderr)


def run_scenario(scn, ctx):
    """kind별 실행 + 채점. 반환: (verdict, reason, extra_record_fields, created_contact_ids)"""
    kind = scn["kind"]
    worker_base = ctx["worker_base"]
    token = ctx["phone_verify_token"]
    pb_base = ctx["pb_base"]
    pb_token = ctx["pb_token"]
    created_ids = []

    if kind == "category_classify":
        email = fresh_email()
        status, body, elapsed, err = csv_import(worker_base, token, [
            {"name": "스모크테스트", "org": scn["org"], "email": email},
        ])
        if err:
            return "LIVE-ERROR", err, {"http_status": status, "http_body": body}, created_ids
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        items = pb_find_contact_by_email(pb_base, pb_token, email)
        if not items:
            return "LIVE-FAIL", "csv-import 후 PocketBase에서 레코드를 찾지 못함(생성 자체가 실패했을 가능성 — select 필드 검증 거부 회귀 의심)", \
                {"http_status": status, "http_body": body}, created_ids
        rec = items[0]
        created_ids.append(rec["id"])
        actual_category = rec.get("category") or ""
        expected = scn.get("expect_category", "")
        if actual_category != expected:
            return "LIVE-FAIL", f"category 불일치: expected={expected!r} actual={actual_category!r}", \
                {"http_status": status, "http_body": body, "pb_category": actual_category}, created_ids
        return "LIVE-PASS", "", {"http_status": status, "http_body": body, "pb_category": actual_category}, created_ids

    if kind == "category_classify_email_domain":
        # _kaddressClassifyCategory의 도메인 매칭은 domain.endsWith('.ac.kr')
        # 식이라 맨몸 "ac.kr" 자체는 안 걸리고 "무언가.ac.kr" 형태(서브도메인)
        # 여야 매칭된다 — 실제 대학 이메일도 항상 이 형태(snu.ac.kr 등)이므로
        # 테스트 이메일도 서브도메인을 하나 붙인다.
        email = f"smoketest-{uuid.uuid4().hex[:12]}@sub.{scn['email_domain']}"
        status, body, elapsed, err = csv_import(worker_base, token, [
            {"name": "스모크테스트", "org": "", "email": email},
        ])
        if err:
            return "LIVE-ERROR", err, {"http_status": status, "http_body": body}, created_ids
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        items = pb_find_contact_by_email(pb_base, pb_token, email)
        if not items:
            return "LIVE-FAIL", "PocketBase에서 레코드를 찾지 못함", {"http_status": status, "http_body": body}, created_ids
        rec = items[0]
        created_ids.append(rec["id"])
        actual_category = rec.get("category") or ""
        expected = scn.get("expect_category", "")
        if actual_category != expected:
            return "LIVE-FAIL", f"category 불일치(이메일 도메인 폴백): expected={expected!r} actual={actual_category!r}", \
                {"http_status": status, "pb_category": actual_category}, created_ids
        return "LIVE-PASS", "", {"http_status": status, "pb_category": actual_category}, created_ids

    if kind == "dedup_same_call":
        email = fresh_email()
        status, body, elapsed, err = csv_import(worker_base, token, [
            {"name": "스모크A", "org": "", "email": email},
            {"name": "스모크A중복", "org": "", "email": email},
        ])
        if err:
            return "LIVE-ERROR", err, {"http_status": status}, created_ids
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        items = pb_find_contact_by_email(pb_base, pb_token, email)
        created_ids.extend(r["id"] for r in items)
        reasons = []
        if body.get("created") != 1:
            reasons.append(f"created={body.get('created')} (기대 1)")
        if body.get("skippedDup") != 1:
            reasons.append(f"skippedDup={body.get('skippedDup')} (기대 1)")
        if len(items) != 1:
            reasons.append(f"PocketBase 실제 레코드 수={len(items)} (기대 1 — 중복 생성됨)")
        if reasons:
            return "LIVE-FAIL", "; ".join(reasons), {"http_body": body, "pb_record_count": len(items)}, created_ids
        return "LIVE-PASS", "", {"http_body": body, "pb_record_count": len(items)}, created_ids

    if kind == "dedup_across_calls":
        email = fresh_email()
        status1, body1, _, err1 = csv_import(worker_base, token, [{"name": "스모크B", "org": "", "email": email}])
        if err1:
            return "LIVE-ERROR", err1, {}, created_ids
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        status2, body2, _, err2 = csv_import(worker_base, token, [{"name": "스모크B재시도", "org": "", "email": email}])
        if err2:
            return "LIVE-ERROR", err2, {}, created_ids
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        items = pb_find_contact_by_email(pb_base, pb_token, email)
        created_ids.extend(r["id"] for r in items)
        reasons = []
        if body1.get("created") != 1:
            reasons.append(f"1차 호출 created={body1.get('created')} (기대 1)")
        if body2.get("created") != 0 or body2.get("skippedDup") != 1:
            reasons.append(f"2차 호출 created={body2.get('created')}/skippedDup={body2.get('skippedDup')} (기대 0/1)")
        if len(items) != 1:
            reasons.append(f"PocketBase 실제 레코드 수={len(items)} (기대 1)")
        if reasons:
            return "LIVE-FAIL", "; ".join(reasons), {"body1": body1, "body2": body2, "pb_record_count": len(items)}, created_ids
        return "LIVE-PASS", "", {"body1": body1, "body2": body2, "pb_record_count": len(items)}, created_ids

    if kind == "dedup_case_insensitive":
        base = f"smoketest-{uuid.uuid4().hex[:12]}"
        email_lower = f"{base}@example-smoketest.invalid"
        email_upper = f"{base.upper()}@EXAMPLE-SMOKETEST.INVALID"
        status1, body1, _, err1 = csv_import(worker_base, token, [{"name": "스모크C", "org": "", "email": email_lower}])
        if err1:
            return "LIVE-ERROR", err1, {}, created_ids
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        status2, body2, _, err2 = csv_import(worker_base, token, [{"name": "스모크C대문자", "org": "", "email": email_upper}])
        if err2:
            return "LIVE-ERROR", err2, {}, created_ids
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        items = pb_find_contact_by_email(pb_base, pb_token, email_lower.lower())
        created_ids.extend(r["id"] for r in items)
        reasons = []
        if body2.get("created") != 0 or body2.get("skippedDup") != 1:
            reasons.append(f"대소문자만 다른 재등록이 중복으로 안 잡힘: 2차 created={body2.get('created')}/skippedDup={body2.get('skippedDup')} (기대 0/1)")
        if len(items) != 1:
            reasons.append(f"PocketBase 실제 레코드 수={len(items)} (기대 1)")
        if reasons:
            return "LIVE-FAIL", "; ".join(reasons), {"body1": body1, "body2": body2, "pb_record_count": len(items)}, created_ids
        return "LIVE-PASS", "", {"body1": body1, "body2": body2, "pb_record_count": len(items)}, created_ids

    if kind == "propose_dedup":
        # 실사 회귀 가드 — propose 엔드포인트엔 이번 세션 전까지 중복
        # 검사가 전혀 없었다(웹앱 "새 연락처 등록" 폼이 쓰는 경로).
        email = fresh_email()
        cand = {"name": "스모크D", "email": email}
        status1, body1, _, err1 = propose(worker_base, token, [cand])
        if err1:
            return "LIVE-ERROR", err1, {}, created_ids
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        status2, body2, _, err2 = propose(worker_base, token, [cand])
        if err2:
            return "LIVE-ERROR", err2, {}, created_ids
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        items = pb_find_contact_by_email(pb_base, pb_token, email)
        created_ids.extend(r["id"] for r in items)
        if len(items) != 1:
            return "LIVE-FAIL", f"propose를 같은 이메일로 두 번 호출했는데 PocketBase에 {len(items)}건 생성됨(기대 1) — 중복 방지 회귀", \
                {"body1": body1, "body2": body2, "pb_record_count": len(items)}, created_ids
        return "LIVE-PASS", "", {"body1": body1, "body2": body2, "pb_record_count": len(items)}, created_ids

    if kind == "category_counts_delta":
        category = scn["category"]
        status_before, before, _, errb = category_counts(worker_base, token, status="pending_review")
        if errb:
            return "LIVE-ERROR", errb, {}, created_ids
        before_count = next((c["count"] for c in before.get("categories", []) if c["category"] == category), 0)
        before_total = before.get("total", 0)

        email = fresh_email()
        status_ci, body_ci, _, err_ci = csv_import(worker_base, token, [
            {"name": "스모크E", "org": "", "email": email, "category": category},
        ])
        if err_ci:
            return "LIVE-ERROR", err_ci, {}, created_ids
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        items = pb_find_contact_by_email(pb_base, pb_token, email)
        created_ids.extend(r["id"] for r in items)

        status_after, after, _, erra = category_counts(worker_base, token, status="pending_review")
        if erra:
            return "LIVE-ERROR", erra, {}, created_ids
        after_count = next((c["count"] for c in after.get("categories", []) if c["category"] == category), 0)
        after_total = after.get("total", 0)

        reasons = []
        if after_count != before_count + 1:
            reasons.append(f"category '{category}' 건수: before={before_count} after={after_count} (기대 +1)")
        if after_total != before_total + 1:
            reasons.append(f"total: before={before_total} after={after_total} (기대 +1)")
        if reasons:
            return "LIVE-FAIL", "; ".join(reasons), {"before": before, "after": after}, created_ids
        return "LIVE-PASS", "", {"before_total": before_total, "after_total": after_total}, created_ids

    if kind == "auth_phone_token_mailbox":
        status, body, _, err = get_json(worker_base, "/kmail/mailbox", token, {"box": "sent"})
        if err:
            return "LIVE-ERROR", err, {}, created_ids
        if status != 200 or not (body or {}).get("ok"):
            return "LIVE-FAIL", f"GET /kmail/mailbox가 phone_verify_token을 거부함: status={status} body={body}", \
                {"http_status": status, "http_body": body}, created_ids
        return "LIVE-PASS", "", {"http_status": status}, created_ids

    if kind == "auth_phone_token_drafts":
        status, body, _, err = get_json(worker_base, "/kmail/drafts", token)
        if err:
            return "LIVE-ERROR", err, {}, created_ids
        if status != 200 or not (body or {}).get("ok"):
            return "LIVE-FAIL", f"GET /kmail/drafts가 phone_verify_token을 거부함: status={status} body={body}", \
                {"http_status": status, "http_body": body}, created_ids
        return "LIVE-PASS", "", {"http_status": status}, created_ids

    if kind == "auth_phone_token_message_state":
        status, body, _, err = get_json(worker_base, "/kmail/messages/state", token)
        if err:
            return "LIVE-ERROR", err, {}, created_ids
        if status != 200 or not (body or {}).get("ok"):
            return "LIVE-FAIL", f"GET /kmail/messages/state가 phone_verify_token을 거부함: status={status} body={body}", \
                {"http_status": status, "http_body": body}, created_ids
        return "LIVE-PASS", "", {"http_status": status}, created_ids

    return "LIVE-ERROR", f"알 수 없는 kind: {kind}", {}, created_ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="scenarios_kaddress_contacts_20260911.json")
    ap.add_argument("--out", default="../../results/kaddress-contacts")
    ap.add_argument("--worker-base", default=DEFAULT_WORKER_BASE)
    ap.add_argument("--pb-base", default=DEFAULT_PB_BASE)
    ap.add_argument("--phone-verify-secret", default=os.environ.get("PHONE_VERIFY_SECRET"))
    ap.add_argument("--test-e164", required=True,
                     help="주소록을 실제로 소유한 등록된 테스트 계정 전화번호 (예: +8201096627170)")
    ap.add_argument("--pb-admin-email", default=os.environ.get("PB_ADMIN_EMAIL"))
    ap.add_argument("--pb-admin-password", default=os.environ.get("PB_ADMIN_PASSWORD"))
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--no-cleanup", action="store_true",
                     help="테스트 연락처를 rejected 처리하지 않고 남겨둠(디버깅용, 기본은 정리함)")
    args = ap.parse_args()

    if not args.phone_verify_secret:
        print("PHONE_VERIFY_SECRET이 없습니다.", file=sys.stderr)
        sys.exit(1)
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

    token = make_phone_verify_token(args.phone_verify_secret, args.test_e164)
    pb_token = pb_admin_login(args.pb_base, args.pb_admin_email, args.pb_admin_password)
    ctx = {
        "worker_base": args.worker_base, "phone_verify_token": token,
        "pb_base": args.pb_base, "pb_token": pb_token,
    }

    all_created_ids = []
    results = []
    with open(results_path, "a", encoding="utf-8") as out_f:
        for scn in scenarios:
            no = scn["no"]
            if no in done:
                print(f"[{no}] skip (already done)")
                continue
            print(f"[{no}] {scn['name']} ({scn['kind']})")
            try:
                verdict, reason, extra, created_ids = run_scenario(scn, ctx)
            except Exception as e:
                verdict, reason, extra, created_ids = "LIVE-ERROR", f"예외: {e}", {}, []
            all_created_ids.extend(created_ids)
            record = {"no": no, "name": scn["name"], "kind": scn["kind"], "verdict": verdict, "reason": reason, **extra}
            results.append(record)
            out_f.write(json.dumps(record, ensure_ascii=False) + "\n")
            out_f.flush()
            print(f"    -> {verdict} {reason}")

    # 정리 — 실계정 주소록에 스모크테스트 흔적이 남지 않게.
    if not args.no_cleanup and all_created_ids:
        print(f"\n정리 중 — 테스트 연락처 {len(all_created_ids)}건을 rejected 처리합니다...")
        for cid in all_created_ids:
            decide_reject(args.worker_base, token, cid)
        print("정리 완료.")
    elif args.no_cleanup and all_created_ids:
        print(f"\n--no-cleanup 지정됨 — 테스트 연락처 {len(all_created_ids)}건이 pending_review 상태로 남아있습니다.")
        print("id 목록:", all_created_ids)

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
        w.writerow(["no", "name", "kind", "verdict", "reason"])
        for r in all_results:
            w.writerow([r.get("no"), r.get("name"), r.get("kind"), r.get("verdict"), r.get("reason")])

    counts = {}
    for r in all_results:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    summary = {"total": len(all_results), "counts": counts}
    with open(os.path.join(args.out, "live_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n=== 요약 ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if counts.get("LIVE-FAIL") or counts.get("LIVE-ERROR"):
        sys.exit(1)


if __name__ == "__main__":
    main()
