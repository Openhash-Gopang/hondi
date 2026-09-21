#!/usr/bin/env python3
"""
tests/live_smoketest/kaddress_org_units_live_smoketest.py
------------------------------------------------------------------
K-Address 소속 기관 계층(org_units) API를 "실서버"(worker + L1 PocketBase)에
붙여 끝에서 끝까지 검증한다. 2026-09-21 신설 — PR #404(워커 API)와 스키마
마이그레이션(1794010001·1794010002)이 실서버에 실제로 적용됐는지, 그리고
worker.js의 조회 필터(GET /kmail/contacts?org_path=)가 라이브에서 형제 접두어
노드를 잘못 잡지 않는지를 확인한다. 로컬 PocketBase 통합 테스트로는 볼 수 없는
것: 실제 배포 여부, 라이브 인증(phone_verify_token), 실서버 스키마.

인증: 기존 kaddress_contacts_live_smoketest.py와 동일 — 등록된 계정의
phone_verify_token을 PHONE_VERIFY_SECRET으로 오프라인 서명해 사용(SMS 불필요).

★ 실계정 안전 원칙 (이 테스트는 주소록을 실제로 가진 계정에서 돈다)
  · 트리는 이번 실행에서만 쓰는 고유 루트 노드(zz-smoketest-<8hex>) 아래에서만
    만들고 바꾼다 — 실계정의 기존 노드·연락처는 읽기(목록)만 하고 쓰지 않는다.
  · 시드(POST /kmail/org-units/seed)는 실계정 트리에 23개 노드를 실제로 만들기
    때문에 기본으로는 호출하지 않는다(--with-seed로만).
  · 정리는 PocketBase Admin API로, "이번 실행이 만든 것"만 지운다: 고유 루트 아래
    노드(경로가 루트로 시작하는 것) + 이번에 만든 연락처(이메일이
    @example-smoketest.invalid로 끝나고 우리가 기록한 id인 것).
  · 실행 도중 실패해도 finally에서 정리한다. --no-cleanup이면 남긴다(디버깅용).

사용 예:
  PHONE_VERIFY_SECRET=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... \\
  python3 kaddress_org_units_live_smoketest.py --test-e164 "+8201096627170"
"""
import argparse
import csv
import json
import os
import sys
import time
import uuid

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kaddress_contacts_live_smoketest import (  # noqa: E402  (같은 폴더의 검증된 헬퍼 재사용)
    DEFAULT_WORKER_BASE, DEFAULT_PB_BASE,
    normalize_kr_e164, make_phone_verify_token, pb_admin_login, fresh_email,
    get_json, post_json, csv_import,
)

SMOKE_EMAIL_SUFFIX = "@example-smoketest.invalid"


class Recorder:
    def __init__(self):
        self.rows = []

    def check(self, name, ok, detail=""):
        verdict = "LIVE-PASS" if ok else "LIVE-FAIL"
        self.rows.append({"no": len(self.rows) + 1, "name": name, "verdict": verdict, "reason": "" if ok else str(detail)})
        print(f"[{len(self.rows):02d}] {verdict}  {name}" + ("" if ok else f"\n        -> {detail}"))
        return ok

    def error(self, name, detail):
        self.rows.append({"no": len(self.rows) + 1, "name": name, "verdict": "LIVE-ERROR", "reason": str(detail)})
        print(f"[{len(self.rows):02d}] LIVE-ERROR {name}\n        -> {detail}")


class PB:
    """PocketBase Admin API 얇은 래퍼(검증·정리 전용)."""

    def __init__(self, base, token):
        self.base = base
        self.h = {"Authorization": f"Bearer {token}"}

    def list(self, coll, filt, per_page=200):
        r = requests.get(f"{self.base}/api/collections/{coll}/records",
                         params={"filter": filt, "perPage": per_page}, headers=self.h, timeout=20)
        r.raise_for_status()
        return r.json().get("items", [])

    def delete(self, coll, rec_id):
        r = requests.delete(f"{self.base}/api/collections/{coll}/records/{rec_id}", headers=self.h, timeout=20)
        return r.status_code in (200, 204, 404)


def run(args, rec):
    e164 = normalize_kr_e164(args.test_e164)
    base = args.worker_base
    tok = lambda: make_phone_verify_token(args.phone_verify_secret, e164)  # 호출마다 새 토큰(TTL 10분)
    pb = PB(args.pb_base, pb_admin_login(args.pb_base, args.pb_admin_email, args.pb_admin_password))

    def POST(path, body=None):
        s, b, _, e = post_json(base, path, tok(), body)
        if e:
            raise RuntimeError(f"POST {path} 호출 실패: {e}")
        return s, b or {}

    def GET(path, params=None):
        s, b, _, e = get_json(base, path, tok(), params)
        if e:
            raise RuntimeError(f"GET {path} 호출 실패: {e}")
        return s, b or {}

    T = f"zz-smoketest-{uuid.uuid4().hex[:8]}"        # 이번 실행 전용 루트 이름(경로도 T로 시작)
    created_contact_ids = []
    created_emails = []
    ids = {}

    def emails_of(items):
        return {i.get("email") for i in items}

    def contacts_under(org_path):
        s, b = GET("/kmail/contacts", {"status": "all", "org_path": org_path})
        return s, b, emails_of(b.get("items", []))

    try:
        # ── 0. 배포 확인: 라우트 + 컬렉션 + 인증 ───────────────────────
        r = requests.get(f"{base}/kmail/org-units", timeout=30)
        rec.check("미인증 GET /kmail/org-units → 400 LOGIN_REQUIRED (워커 배포 확인)",
                  r.status_code == 400 and (r.json().get("error") == "LOGIN_REQUIRED"), f"HTTP {r.status_code} {r.text[:120]}")
        s, b = GET("/kmail/org-units", {"status": "all"})
        if s == 503:
            rec.check("GET /kmail/org-units (org_units 컬렉션 존재)", False, f"503 {b.get('error')} — 마이그레이션 미적용")
            return
        if not rec.check("GET /kmail/org-units (인증 통과·트리 조회)", s == 200 and b.get("ok") is True, f"HTTP {s} {b}"):
            return

        if args.with_seed:
            s, b = POST("/kmail/org-units/seed")
            rec.check("POST seed (실계정 트리에 실제 생성 — --with-seed)", s == 200 and b.get("ok") is True, f"HTTP {s} {b}")

        # ── 1. 노드 생성(4단계 대신 3단계 + 접두어 형제) ─────────────
        s, b = POST("/kmail/org-units/create", {"name": T})
        ok = rec.check("루트 노드 생성", s == 200 and b.get("node", {}).get("path") == T and b["node"]["depth"] == 1, f"HTTP {s} {b}")
        if not ok:
            return
        ids["T"] = b["node"]["id"]
        s, b = POST("/kmail/org-units/create", {"parent_id": ids["T"], "name": "대학", "aliases": ["univ"]})
        rec.check("자식 노드 생성(+별칭)", s == 200 and b.get("node", {}).get("path") == f"{T}>대학", f"HTTP {s} {b}")
        ids["C"] = b.get("node", {}).get("id")
        s, b = POST("/kmail/org-units/create", {"parent_id": ids["C"], "name": "학과"})
        rec.check("손자 노드 생성(3단계)", s == 200 and b.get("node", {}).get("depth") == 3, f"HTTP {s} {b}")
        ids["G"] = b.get("node", {}).get("id")
        s, b = POST("/kmail/org-units/create", {"parent_id": ids["T"], "name": "대학병원"})
        rec.check("접두어를 공유하는 형제 노드 생성('대학' vs '대학병원')", s == 200, f"HTTP {s} {b}")
        ids["S"] = b.get("node", {}).get("id")
        P_C, P_G, P_S = f"{T}>대학", f"{T}>대학>학과", f"{T}>대학병원"

        s, b = POST("/kmail/org-units/create", {"parent_id": ids["T"], "name": "대학"})
        rec.check("중복 생성 → 409 UNIT_EXISTS", s == 409 and b.get("error") == "UNIT_EXISTS", f"HTTP {s} {b}")
        s, b = POST("/kmail/org-units/create", {"parent_id": ids["T"], "name": "가>나"})
        rec.check("이름에 '>' → 400 INVALID_NAME", s == 400 and b.get("error") == "INVALID_NAME", f"HTTP {s} {b}")

        # ── 2. 테스트 연락처 3건 등록 + 배정 ───────────────────────────
        emails = [fresh_email() for _ in range(3)]
        rows = [{"name": f"스모크테스트-{n}", "org": "스모크테스트", "email": em} for n, em in zip("abc", emails)]
        created_emails.extend(emails)
        s, b, _, e = csv_import(base, tok(), rows, status="confirmed")
        # csv-import는 레코드 생성이 실패해도 ok:true를 돌려준다(created/failedCount로만 드러남) — ok만 보면 vacuous pass.
        rec.check("테스트 연락처 3건 등록(csv-import: created=3, failedCount=0)",
                  s == 200 and (b or {}).get("created") == 3 and (b or {}).get("failedCount", 0) == 0, f"HTTP {s} {b} {e}")
        time.sleep(1)
        cid = {}
        for em in emails:
            items = pb.list("kmail_contacts", f"email='{em}'")
            if items:
                cid[em] = items[0]["id"]
                created_contact_ids.append(items[0]["id"])
        if not rec.check("테스트 연락처가 PocketBase에 실제 저장됨", len(cid) == 3, f"찾은 것 {len(cid)}/3"):
            return
        a, bb, c = emails

        s, b = POST("/kmail/contacts/assign-org", {"unit_id": ids["G"], "emails": [a]})
        rec.check("assign: a → 학과", s == 200 and b.get("assigned") == 1, f"HTTP {s} {b}")
        s, b = POST("/kmail/contacts/assign-org", {"unit_id": ids["C"], "emails": [bb]})
        rec.check("assign: b → 대학", s == 200 and b.get("assigned") == 1, f"HTTP {s} {b}")
        s, b = POST("/kmail/contacts/assign-org", {"unit_id": ids["S"], "emails": [c]})
        rec.check("assign: c → 대학병원", s == 200 and b.get("assigned") == 1, f"HTTP {s} {b}")
        s, b = POST("/kmail/contacts/assign-org", {"unit_id": "nonexistentunit1", "emails": [a]})
        rec.check("존재하지 않는 노드로 assign → 404", s == 404, f"HTTP {s} {b}")

        # ── 3. 라이브 조회 필터(worker.js 변경분) ───────────────────────
        s, b, got = contacts_under(P_C)
        rec.check("GET /kmail/contacts?org_path=대학 → a,b만(형제 '대학병원' 제외)", s == 200 and got == {a, bb}, f"HTTP {s} got={sorted(got)}")
        s, b, got = contacts_under(T)
        rec.check("GET ?org_path=루트 → a,b,c 전부", s == 200 and got == {a, bb, c}, f"HTTP {s} got={sorted(got)}")
        # 2026-09-21 — 목록 페이지 지원(미분류 정리 마법사가 전체를 열거하는 데 필요). 응답에 page/totalPages/totalItems.
        rec.check("페이지 메타: page=1, totalPages=1, totalItems=3",
                  (b.get("page"), b.get("totalPages"), b.get("totalItems")) == (1, 1, 3), f"{ {k: b.get(k) for k in ('page', 'totalPages', 'totalItems')} }")
        s2, b2 = GET("/kmail/contacts", {"status": "all", "org_path": T, "page": 2})
        rec.check("범위 밖 페이지(page=2) → 200 + 빈 목록", s2 == 200 and b2.get("items") == [], f"HTTP {s2} {str(b2)[:120]}")
        s, b, got = contacts_under(P_S)
        rec.check("GET ?org_path=대학병원 → c만", s == 200 and got == {c}, f"HTTP {s} got={sorted(got)}")
        s, b, got = contacts_under("__NONE__")
        rec.check("GET ?org_path=__NONE__ → 배정된 a,b,c는 제외", s == 200 and not ({a, bb, c} & got), f"HTTP {s}")
        s, b = GET("/kmail/contacts", {"status": "all", "org_path": "a%b"})
        rec.check("org_path에 '%' → 400 INVALID_ORG_PATH", s == 400 and b.get("error") == "INVALID_ORG_PATH", f"HTTP {s} {b}")

        # ── 4. 트리 조회·건수 ────────────────────────────────────────────
        s, b = GET("/kmail/org-units", {"status": "all"})
        by = {n["id"]: n for n in b.get("nodes", [])}
        counts = {k: (by.get(ids[k], {}).get("direct"), by.get(ids[k], {}).get("subtree")) for k in ("T", "C", "G", "S")}
        rec.check("트리 건수: T(0,3) C(1,2) G(1,1) S(1,1)",
                  counts == {"T": (0, 3), "C": (1, 2), "G": (1, 1), "S": (1, 1)}, f"{counts}")
        rec.check("별칭 저장·반환", by.get(ids["C"], {}).get("aliases") == ["univ"], f"{by.get(ids['C'])}")

        # ── 5. 이름 변경 → 하위·연락처 경로 갱신 ────────────────────────
        s, b = POST("/kmail/org-units/update", {"unit_id": ids["C"], "name": "대학교"})
        rec.check("update: '대학' → '대학교'", s == 200 and b.get("contacts_pending") == 0 and b.get("nodes_updated") == 2, f"HTTP {s} {b}")
        time.sleep(1)
        pa = pb.list("kmail_contacts", f"id='{cid[a]}'")[0]["org_path"]
        pbb = pb.list("kmail_contacts", f"id='{cid[bb]}'")[0]["org_path"]
        pc = pb.list("kmail_contacts", f"id='{cid[c]}'")[0]["org_path"]
        rec.check("PocketBase: a/b 경로 갱신, c(형제) 불변",
                  (pa, pbb, pc) == (f"{T}>대학교>학과", f"{T}>대학교", P_S), f"{(pa, pbb, pc)}")
        s, b, got = contacts_under(f"{T}>대학교")
        rec.check("새 경로로 조회 → a,b", got == {a, bb}, f"got={sorted(got)}")
        s, b, got = contacts_under(P_C)
        rec.check("옛 경로로 조회 → 없음", not got, f"got={sorted(got)}")
        P_C, P_G = f"{T}>대학교", f"{T}>대학교>학과"

        # ── 6. 이동 ──────────────────────────────────────────────────────
        s, b = POST("/kmail/org-units/move", {"unit_id": ids["G"], "new_parent_id": ids["S"]})
        rec.check("move: 학과를 '대학병원' 아래로", s == 200 and b.get("new_path") == f"{P_S}>학과", f"HTTP {s} {b}")
        time.sleep(1)
        pa = pb.list("kmail_contacts", f"id='{cid[a]}'")[0]["org_path"]
        rec.check("PocketBase: a 경로가 이동 반영", pa == f"{P_S}>학과", f"{pa}")
        s, b = POST("/kmail/org-units/move", {"unit_id": ids["T"], "new_parent_id": ids["G"]})
        rec.check("move: 루트를 자기 하위로 → 400 CYCLE", s == 400 and b.get("error") == "CYCLE", f"HTTP {s} {b}")

        # ── 7. 삭제 규칙 + 미분류 복귀 + resync ─────────────────────────
        s, b = POST("/kmail/org-units/delete", {"unit_id": ids["T"]})
        rec.check("delete: 하위 있는 루트 → 409 HAS_CHILDREN", s == 409 and b.get("error") == "HAS_CHILDREN", f"HTTP {s} {b}")
        s, b = POST("/kmail/org-units/delete", {"unit_id": ids["G"]})
        rec.check("delete: 리프(연락처 1건) → 삭제 + 부모로 이동", s == 200 and b.get("deleted") is True and b.get("moved") == 1, f"HTTP {s} {b}")
        time.sleep(1)
        rec_a = pb.list("kmail_contacts", f"id='{cid[a]}'")[0]
        rec.check("PocketBase: a가 부모('대학병원') 소속으로", (rec_a["org_unit"], rec_a["org_path"]) == (ids["S"], P_S), f"{(rec_a['org_unit'], rec_a['org_path'])}")
        s, b = POST("/kmail/contacts/assign-org", {"unit_id": "", "emails": [c]})
        rec_c = pb.list("kmail_contacts", f"id='{cid[c]}'")[0]
        rec.check("assign unit_id='' → 미분류로 복귀", s == 200 and (rec_c["org_unit"], rec_c["org_path"]) == ("", ""), f"HTTP {s} {(rec_c['org_unit'], rec_c['org_path'])}")
        s, b = POST("/kmail/org-units/resync", {})
        rec.check("resync: 정합 상태에서 pending=0, 노드/연락처 수정 0",
                  s == 200 and b.get("pending") == 0 and b.get("nodes_fixed") == 0 and b.get("contacts_fixed") == 0, f"HTTP {s} {b}")
    finally:
        if args.no_cleanup:
            print(f"\n--no-cleanup — 루트 '{T}' 아래 노드와 연락처 {created_emails}가 남아 있습니다.")
            return
        print("\n정리 중(이번 실행이 만든 것만)...")
        ok_all = True
        for cid_ in created_contact_ids:
            ok_all &= pb.delete("kmail_contacts", cid_)
        nodes = pb.list("org_units", f"path='{T}' || path~'{T}>%'")
        nodes = [n for n in nodes if n.get("path", "").split(">")[0] == T]  # 방어: 우리 루트 아래만
        for n in sorted(nodes, key=lambda x: -len(x.get("path", ""))):        # 깊은 것부터
            ok_all &= pb.delete("org_units", n["id"])
        left_nodes = [n for n in pb.list("org_units", f"path='{T}' || path~'{T}>%'")]
        left_contacts = [em for em in created_emails if pb.list("kmail_contacts", f"email='{em}'")]
        rec.check("정리: 테스트 노드·연락처가 남지 않음", ok_all and not left_nodes and not left_contacts,
                  f"남은 노드 {len(left_nodes)}, 남은 연락처 {len(left_contacts)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="../../results/kaddress-org-units")
    ap.add_argument("--worker-base", default=DEFAULT_WORKER_BASE)
    ap.add_argument("--pb-base", default=DEFAULT_PB_BASE)
    ap.add_argument("--phone-verify-secret", default=os.environ.get("PHONE_VERIFY_SECRET"))
    ap.add_argument("--test-e164", required=True, help="주소록을 실제로 소유한 등록된 테스트 계정 전화번호(어떤 형식이든)")
    ap.add_argument("--pb-admin-email", default=os.environ.get("PB_ADMIN_EMAIL"))
    ap.add_argument("--pb-admin-password", default=os.environ.get("PB_ADMIN_PASSWORD"))
    ap.add_argument("--with-seed", action="store_true", help="실계정 트리에 시드 23개 노드를 실제로 생성(기본 꺼짐)")
    ap.add_argument("--no-cleanup", action="store_true")
    args = ap.parse_args()
    for k in ("phone_verify_secret", "pb_admin_email", "pb_admin_password"):
        if not getattr(args, k):
            print(f"필수 값 누락: --{k.replace('_', '-')} (또는 환경변수)", file=sys.stderr)
            sys.exit(2)

    rec = Recorder()
    try:
        run(args, rec)
    except Exception as e:  # 예외도 결과에 남기고 종료코드로 드러낸다
        rec.error("스모크테스트 실행 중 예외", repr(e))

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "live_results.json"), "w", encoding="utf-8") as f:
        json.dump(rec.rows, f, ensure_ascii=False, indent=2)
    with open(os.path.join(args.out, "live_results.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["no", "name", "verdict", "reason"])
        for r in rec.rows:
            w.writerow([r["no"], r["name"], r["verdict"], r["reason"]])
    counts = {}
    for r in rec.rows:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    summary = {"total": len(rec.rows), "counts": counts}
    with open(os.path.join(args.out, "live_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print("\n=== 요약 ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if counts.get("LIVE-FAIL") or counts.get("LIVE-ERROR"):
        sys.exit(1)


if __name__ == "__main__":
    main()
