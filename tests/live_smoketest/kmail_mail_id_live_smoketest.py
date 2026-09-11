#!/usr/bin/env python3
"""
K-Mail ID(mail_id) + 설정 + 임시보관함 + 실제 발송/수신 왕복 LIVE smoketest.

2026-09-12 세션에 새로 만든 기능 전체(kaddress_contacts_live_smoketest.py가
전혀 건드리지 않는 영역)의 회귀 방지 가드:
  1) mail_id 형식 검증(3~30자, 영문 소문자·숫자·-·_, 영숫자로 시작/끝)과
     예약어(admin/root/... ) 거부가 실제로 걸리는지.
  2) mail_id가 저장 전 소문자로 정규화되는지(대문자 입력 → 소문자 저장).
  3) mail_id 전역 유일성 — 다른 사용자가 이미 쓰고 있는 mail_id를
     설정하려 하면 409 MAIL_ID_TAKEN으로 거부되는지. 실계정을 두 개
     만들 수 없으므로, PocketBase Admin API로 합성 guid의
     kmail_user_settings 행을 직접 하나 심어(제3자 "이미 있는 사용자"
     역할) 충돌을 재현한다(PDV smoketest의 합성 guid 관례와 동일).
  4) GET /kmail/mail-id/check가 실제 점유 상태와 일치하는 답을 주는지.
  5) POST /kmail/mail-id/auto가 8자리 hex를 생성하고, 두 번 연속 호출해도
     같은 값을 반환하는지(멱등성 — worker.js _kmailGenerateMailIdCandidate
     가 guid 결정론적이므로 counter=0부터 재시도하면 항상 같은 후보가
     나와야 정상).
  6) 서명/발신자 표시 이름/부재중 자동응답 설정이 실제로 저장·조회되는지
     (기존엔 이 세 필드를 검증하는 하네스가 전혀 없었다 — REST 경로
     자체가 지갑서명 전용이라 웹앱에서 호출이 안 됐던 버그도 이번
     세션에 같이 고쳤음, 그 회귀도 함께 방지).
  7) 임시보관함(POST/GET/DELETE /kmail/drafts) 왕복.
  8) ★ 실제 발송→수신 왕복 — 자기 자신의 <guid>@hondi.kr로 실제
     env.EMAIL.send() 발송 후, Cloudflare Email Routing catch-all이
     받아 _handleKmailInboundEmail로 되돌아오는지까지 실계로 확인한다.
     외부 제3자에게 아무 것도 보내지 않으므로(자기 자신 앞으로만 발송)
     스팸 위험이 없는 유일하게 안전한 실발송 테스트 대상이다.

kaddress_contacts_live_smoketest.py와 동일한 원칙 — 실제 worker.js
(hondi-proxy) 엔드포인트를 HTTP로 진짜 호출하고, PocketBase Admin API로
실제 저장된 레코드를 직접 조회해 채점한다. HTTP 200(ok:true) 자체는
설계 의도대로 저장/검증됐는지와 무관하다.

인증: 실제 registered 계정(주피터 본인 테스트 계정)의 phone_verify_token을
오프라인으로 재현해서 쓴다(klaw_usage_billing_live_smoketest.py의
make_phone_verify_token 그대로 재사용).

★ 실계정 오염 방지 — 이 계정의 kmail_user_settings(서명/mail_id 등)를
실제로 덮어쓴다. 실행 전 기존 값을 백업해두고, 실행이 끝나면(--no-cleanup을
안 준 이상) 원래 값으로 복원한다. mail_id 충돌 테스트용으로 심은 합성
guid 행은 항상 삭제로 정리한다. 자가발송 테스트로 생긴 kmail_outbound/
kmail_inbound ai_messages 레코드는 정리 대상이 아니다(원래도 "메일" 탭
발신함/수신함에 실제 사용 흔적처럼 쌓이는 게 정상 동작이라 삭제 전용
엔드포인트 자체가 없음 — kaddress_contacts 하네스의 소프트삭제 철학과
동일하게 건드리지 않는다).

Usage:
  PHONE_VERIFY_SECRET=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... \\
  python3 kmail_mail_id_live_smoketest.py \\
      --scenarios scenarios_kmail_mail_id_20260912.json \\
      --out ../../results/kmail-mail-id \\
      --test-e164 "+8201096627170"
"""
import argparse
import csv
import hashlib
import hmac
import json
import os
import re
import sys
import time
import uuid

import requests

DEFAULT_WORKER_BASE = "https://hondi-proxy.tensor-city.workers.dev"
DEFAULT_PB_BASE = "https://l1-hanlim.hondi.net"
WRITE_PROPAGATION_WAIT_S = 2
# 실제 이메일 발송 → Cloudflare Email Routing → _handleKmailInboundEmail
# 왕복은 PocketBase 쓰기보다 훨씬 느리다(외부 메일 인프라를 실제로
# 왕복하므로) — 고정 sleep 대신 짧은 간격으로 최대 이 시간까지 폴링한다.
INBOUND_POLL_TIMEOUT_S = 90
INBOUND_POLL_INTERVAL_S = 5


def normalize_kr_e164(raw):
    """kaddress_contacts_live_smoketest.py의 동명 함수와 완전히 동일
    (이 저장소의 e164 표기 관례 — "+82" + "0" + 10자리를 그대로 유지)."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) < 8:
        raise ValueError(f"전화번호에서 숫자가 8자리 미만입니다: {raw!r}")
    last8 = digits[-8:]
    return f"+82010{last8}"


def make_phone_verify_token(secret, e164, ttl_ms=10 * 60 * 1000):
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


def pb_find_settings_by_mail_id(pb_base, pb_token, mail_id):
    headers = {"Authorization": f"Bearer {pb_token}"}
    filt = f"mail_id='{mail_id}'"
    res = requests.get(
        f"{pb_base}/api/collections/kmail_user_settings/records",
        params={"filter": filt, "perPage": 20}, headers=headers, timeout=15,
    )
    return res.json().get("items", [])


def pb_find_settings_by_guid(pb_base, pb_token, guid):
    headers = {"Authorization": f"Bearer {pb_token}"}
    filt = f"owner_user_guid='{guid}'"
    res = requests.get(
        f"{pb_base}/api/collections/kmail_user_settings/records",
        params={"filter": filt, "perPage": 1}, headers=headers, timeout=15,
    )
    items = res.json().get("items", [])
    return items[0] if items else None


def pb_create_settings(pb_base, pb_token, owner_user_guid, mail_id):
    """mail_id 충돌 테스트용 — 실제로 가입한 적 없는 합성 guid의
    kmail_user_settings 행을 admin API로 직접 심는다(PDV 하네스의 합성
    guid 관례와 동일 — 실계정을 하나 더 만들 필요가 없다)."""
    headers = {"Authorization": f"Bearer {pb_token}", "Content-Type": "application/json"}
    res = requests.post(
        f"{pb_base}/api/collections/kmail_user_settings/records",
        json={"owner_user_guid": owner_user_guid, "mail_id": mail_id},
        headers=headers, timeout=15,
    )
    data = res.json()
    if not data.get("id"):
        raise RuntimeError(f"합성 kmail_user_settings 생성 실패: {data}")
    return data["id"]


def pb_delete_record(pb_base, pb_token, collection, record_id):
    headers = {"Authorization": f"Bearer {pb_token}"}
    try:
        requests.delete(f"{pb_base}/api/collections/{collection}/records/{record_id}",
                         headers=headers, timeout=15)
    except Exception as e:
        print(f"    (정리 실패, 무시하고 계속: {collection}/{record_id} {e})", file=sys.stderr)


def pb_patch_record(pb_base, pb_token, collection, record_id, patch):
    headers = {"Authorization": f"Bearer {pb_token}", "Content-Type": "application/json"}
    requests.patch(f"{pb_base}/api/collections/{collection}/records/{record_id}",
                    json=patch, headers=headers, timeout=15)


def fresh_mail_id():
    # HMAC 후보(worker.js)와 절대 우연히도 겹치지 않도록 uuid 기반 —
    # 형식 제약(3~30자, 영숫자로 시작/끝)을 만족하는 문자열.
    return f"smk{uuid.uuid4().hex[:10]}"


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


MAIL_ID_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$")


def run_scenario(scn, ctx):
    """kind별 실행 + 채점. 반환: (verdict, reason, extra_record_fields, cleanup_list)
    cleanup_list는 (kind, args) 튜플의 리스트 — main()이 끝에서 일괄 정리."""
    kind = scn["kind"]
    worker_base = ctx["worker_base"]
    token = ctx["phone_verify_token"]
    pb_base = ctx["pb_base"]
    pb_token = ctx["pb_token"]
    guid = ctx["guid"]
    cleanup = []

    if kind == "mail_id_invalid_format":
        status, body, _, err = post_json(worker_base, "/kmail/settings", token,
                                          {"mail_id": scn["bad_mail_id"]})
        if err:
            return "LIVE-ERROR", err, {}, cleanup
        if status != 400 or (body or {}).get("error") != "INVALID_MAIL_ID":
            return "LIVE-FAIL", f"잘못된 형식({scn['bad_mail_id']!r})이 거부되지 않음: status={status} body={body}", \
                {"http_status": status, "http_body": body}, cleanup
        return "LIVE-PASS", "", {"http_status": status}, cleanup

    if kind == "mail_id_reserved_word":
        status, body, _, err = post_json(worker_base, "/kmail/settings", token,
                                          {"mail_id": scn["reserved_word"]})
        if err:
            return "LIVE-ERROR", err, {}, cleanup
        if status != 400 or (body or {}).get("error") != "INVALID_MAIL_ID":
            return "LIVE-FAIL", f"예약어({scn['reserved_word']!r})가 거부되지 않음: status={status} body={body}", \
                {"http_status": status, "http_body": body}, cleanup
        return "LIVE-PASS", "", {"http_status": status}, cleanup

    if kind == "mail_id_normalize_and_persist":
        candidate_upper = fresh_mail_id().upper()
        status, body, _, err = post_json(worker_base, "/kmail/settings", token,
                                          {"mail_id": candidate_upper})
        if err:
            return "LIVE-ERROR", err, {}, cleanup
        if status != 200 or not (body or {}).get("ok"):
            return "LIVE-FAIL", f"대문자 mail_id 설정 자체가 실패: status={status} body={body}", \
                {"http_status": status, "http_body": body}, cleanup
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        gstatus, gbody, _, gerr = get_json(worker_base, "/kmail/settings", token)
        if gerr:
            return "LIVE-ERROR", gerr, {}, cleanup
        actual = (gbody or {}).get("mail_id", "")
        expected = candidate_upper.lower()
        if actual != expected:
            return "LIVE-FAIL", f"소문자 정규화 안 됨: 입력={candidate_upper!r} 저장된 값={actual!r}(기대 {expected!r})", \
                {"get_body": gbody}, cleanup
        return "LIVE-PASS", "", {"mail_id": actual}, cleanup

    if kind == "mail_id_collision_cross_user":
        taken = fresh_mail_id()
        synthetic_guid = f"smoketest-synthetic-{uuid.uuid4().hex[:16]}"
        record_id = pb_create_settings(pb_base, pb_token, synthetic_guid, taken)
        cleanup.append(("delete_settings_record", record_id))
        time.sleep(WRITE_PROPAGATION_WAIT_S)

        # GET /kmail/mail-id/check가 "이미 점유됨"을 정확히 보고하는지
        cstatus, cbody, _, cerr = get_json(worker_base, "/kmail/mail-id/check", token,
                                            {"candidate": taken})
        if cerr:
            return "LIVE-ERROR", cerr, {}, cleanup
        check_ok = cstatus == 200 and (cbody or {}).get("valid") is True and (cbody or {}).get("available") is False

        # 실제 설정 시도는 409로 거부돼야 함
        sstatus, sbody, _, serr = post_json(worker_base, "/kmail/settings", token, {"mail_id": taken})
        if serr:
            return "LIVE-ERROR", serr, {}, cleanup
        set_rejected = sstatus == 409 and (sbody or {}).get("error") == "MAIL_ID_TAKEN"

        reasons = []
        if not check_ok:
            reasons.append(f"/kmail/mail-id/check가 점유 상태를 못 알아챔: status={cstatus} body={cbody}")
        if not set_rejected:
            reasons.append(f"이미 점유된 mail_id 설정 시도가 409로 거부되지 않음: status={sstatus} body={sbody}")
        if reasons:
            return "LIVE-FAIL", "; ".join(reasons), {"check_body": cbody, "set_body": sbody}, cleanup
        return "LIVE-PASS", "", {"check_body": cbody, "set_status": sstatus}, cleanup

    if kind == "mail_id_check_available":
        candidate = fresh_mail_id()
        status, body, _, err = get_json(worker_base, "/kmail/mail-id/check", token,
                                         {"candidate": candidate})
        if err:
            return "LIVE-ERROR", err, {}, cleanup
        if status != 200 or (body or {}).get("valid") is not True or (body or {}).get("available") is not True:
            return "LIVE-FAIL", f"새 후보가 available=true로 안 나옴: status={status} body={body}", \
                {"http_status": status, "http_body": body}, cleanup
        return "LIVE-PASS", "", {"http_body": body}, cleanup

    if kind == "mail_id_auto_generate_idempotent":
        s1, b1, _, e1 = post_json(worker_base, "/kmail/mail-id/auto", token, {})
        if e1:
            return "LIVE-ERROR", e1, {}, cleanup
        if s1 != 200 or not (b1 or {}).get("ok") or not MAIL_ID_PATTERN.match((b1 or {}).get("mail_id", "")):
            return "LIVE-FAIL", f"자동생성 1차 실패 또는 형식 불일치: status={s1} body={b1}", \
                {"http_status": s1, "http_body": b1}, cleanup
        first = b1["mail_id"]
        time.sleep(WRITE_PROPAGATION_WAIT_S)

        s2, b2, _, e2 = post_json(worker_base, "/kmail/mail-id/auto", token, {})
        if e2:
            return "LIVE-ERROR", e2, {}, cleanup
        second = (b2 or {}).get("mail_id")
        if s2 != 200 or second != first:
            return "LIVE-FAIL", f"자동생성이 멱등적이지 않음: 1차={first!r} 2차={second!r}(같아야 함)", \
                {"body1": b1, "body2": b2}, cleanup

        rec = pb_find_settings_by_guid(pb_base, pb_token, guid)
        if not rec or rec.get("mail_id") != first:
            return "LIVE-FAIL", f"PocketBase 실제 저장값 불일치: 응답={first!r} PB={rec.get('mail_id') if rec else None!r}", \
                {"pb_record": rec}, cleanup
        return "LIVE-PASS", "", {"mail_id": first}, cleanup

    if kind == "settings_display_name_signature_roundtrip":
        marker = uuid.uuid4().hex[:8]
        name = f"스모크발신자-{marker}"
        sig = f"스모크서명-{marker}"
        status, body, _, err = post_json(worker_base, "/kmail/settings", token,
                                          {"sender_display_name": name, "signature_text": sig})
        if err:
            return "LIVE-ERROR", err, {}, cleanup
        if status != 200 or not (body or {}).get("ok"):
            return "LIVE-FAIL", f"설정 저장 실패: status={status} body={body}", {"http_status": status}, cleanup
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        gstatus, gbody, _, gerr = get_json(worker_base, "/kmail/settings", token)
        if gerr:
            return "LIVE-ERROR", gerr, {}, cleanup
        reasons = []
        if (gbody or {}).get("sender_display_name") != name:
            reasons.append(f"sender_display_name 불일치: {gbody.get('sender_display_name')!r} != {name!r}")
        if (gbody or {}).get("signature") != sig:
            reasons.append(f"signature 불일치: {gbody.get('signature')!r} != {sig!r}")
        if reasons:
            return "LIVE-FAIL", "; ".join(reasons), {"get_body": gbody}, cleanup
        return "LIVE-PASS", "", {"get_body": gbody}, cleanup

    if kind == "settings_auto_reply_toggle":
        text = f"스모크 부재중 자동응답 {uuid.uuid4().hex[:8]}"
        s1, b1, _, e1 = post_json(worker_base, "/kmail/settings", token, {
            "auto_reply_enabled": True, "auto_reply_text": text,
        })
        if e1:
            return "LIVE-ERROR", e1, {}, cleanup
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        g1s, g1b, _, g1e = get_json(worker_base, "/kmail/settings", token)
        if g1e:
            return "LIVE-ERROR", g1e, {}, cleanup
        on_ok = (g1b or {}).get("auto_reply_enabled") is True and (g1b or {}).get("auto_reply_text") == text

        s2, b2, _, e2 = post_json(worker_base, "/kmail/settings", token, {"auto_reply_enabled": False})
        if e2:
            return "LIVE-ERROR", e2, {}, cleanup
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        g2s, g2b, _, g2e = get_json(worker_base, "/kmail/settings", token)
        if g2e:
            return "LIVE-ERROR", g2e, {}, cleanup
        # 끌 때 auto_reply_text를 지우라고 안 보냈으므로 문구는 재사용을 위해 남아있어야 함(SP §2-9 설계)
        off_ok = (g2b or {}).get("auto_reply_enabled") is False and (g2b or {}).get("auto_reply_text") == text

        reasons = []
        if not on_ok:
            reasons.append(f"켰을 때 조회 불일치: {g1b}")
        if not off_ok:
            reasons.append(f"껐을 때 조회 불일치(문구는 남아있어야 함): {g2b}")
        if reasons:
            return "LIVE-FAIL", "; ".join(reasons), {"get1": g1b, "get2": g2b}, cleanup
        return "LIVE-PASS", "", {"get1": g1b, "get2": g2b}, cleanup

    if kind == "drafts_roundtrip":
        marker = uuid.uuid4().hex[:8]
        subject = f"스모크 임시보관 {marker}"
        s1, b1, _, e1 = post_json(worker_base, "/kmail/drafts", token,
                                   {"subject": subject, "body": "테스트 본문"})
        if e1:
            return "LIVE-ERROR", e1, {}, cleanup
        if s1 != 200 or not (b1 or {}).get("ok") or not (b1 or {}).get("draft_id"):
            return "LIVE-FAIL", f"임시저장 실패: status={s1} body={b1}", {"http_status": s1}, cleanup
        draft_id = b1["draft_id"]
        time.sleep(WRITE_PROPAGATION_WAIT_S)

        lstatus, lbody, _, lerr = get_json(worker_base, "/kmail/drafts", token)
        if lerr:
            return "LIVE-ERROR", lerr, {}, cleanup
        items = (lbody or {}).get("items", [])
        found = any(d.get("id") == draft_id and d.get("subject") == subject for d in items)
        if not found:
            return "LIVE-FAIL", f"저장한 임시보관 항목이 목록에서 안 보임: draft_id={draft_id}", \
                {"list_body": lbody}, cleanup

        dstatus, dbody, _, derr = post_json(worker_base, "/kmail/drafts/delete", token, {"draft_id": draft_id})
        if derr:
            return "LIVE-ERROR", derr, {}, cleanup
        if dstatus != 200 or not (dbody or {}).get("ok"):
            return "LIVE-FAIL", f"임시보관 삭제 실패: status={dstatus} body={dbody}", {}, cleanup
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        l2status, l2body, _, l2err = get_json(worker_base, "/kmail/drafts", token)
        if l2err:
            return "LIVE-ERROR", l2err, {}, cleanup
        still_there = any(d.get("id") == draft_id for d in (l2body or {}).get("items", []))
        if still_there:
            return "LIVE-FAIL", f"삭제했는데 여전히 목록에 남아있음: draft_id={draft_id}", {"list2": l2body}, cleanup
        return "LIVE-PASS", "", {"draft_id": draft_id}, cleanup

    if kind == "self_send_and_inbound_roundtrip":
        marker = uuid.uuid4().hex[:10]
        subject = f"[스모크테스트] 자가발송 왕복 {marker}"
        # worker.js _guidToEmailLocalPart와 동일 — 실제 이메일 프로토콜에
        # 쓰는 주소는 콜론이 아니라 하이픈 형태여야 한다(콜론은 이메일
        # 로컬파트에서 무효 문자 — fix/kmail-guid-email-address-invalid
        # 참고). ctx["guid"]는 PocketBase 조회용 원본(콜론) 형태이므로
        # 여기서만 별도로 변환한다.
        to_addr = f"{guid.replace(':', '-')}@hondi.kr"
        status, body, _, err = post_json(worker_base, "/mail/send", token, {
            "to": to_addr, "subject": subject, "text": f"자가발송 왕복 테스트 본문 {marker}",
        })
        if err:
            return "LIVE-ERROR", err, {}, cleanup
        if status != 200 or not (body or {}).get("ok"):
            return "LIVE-FAIL", f"발송 자체가 실패: status={status} body={body}", {"http_status": status}, cleanup

        # 보낸함 확인(발송은 즉시 기록됨 — PocketBase 쓰기 지연 정도만 대기)
        time.sleep(WRITE_PROPAGATION_WAIT_S)
        sstatus, sbody, _, serr = get_json(worker_base, "/kmail/mailbox", token, {"box": "sent"})
        if serr:
            return "LIVE-ERROR", serr, {}, cleanup
        sent_found = any(subject in (m.get("content_original") or m.get("subject") or "")
                          for m in (sbody or {}).get("items", []))
        if not sent_found:
            return "LIVE-FAIL", f"방금 보낸 메일이 보낸함에 안 보임: subject={subject!r}", \
                {"sent_body": sbody}, cleanup

        # 받은함 확인(실제 외부 메일 인프라 왕복 — 폴링 필요)
        inbox_found = False
        inbox_body = None
        deadline = time.time() + INBOUND_POLL_TIMEOUT_S
        while time.time() < deadline:
            istatus, ibody, _, ierr = get_json(worker_base, "/kmail/mailbox", token, {"box": "inbox"})
            if ierr:
                time.sleep(INBOUND_POLL_INTERVAL_S)
                continue
            inbox_body = ibody
            if any(subject in (m.get("content_original") or m.get("subject") or "")
                   for m in (ibody or {}).get("items", [])):
                inbox_found = True
                break
            time.sleep(INBOUND_POLL_INTERVAL_S)

        if not inbox_found:
            return "LIVE-FAIL", (
                f"자가발송한 메일이 {INBOUND_POLL_TIMEOUT_S}초 안에 받은함에 안 들어옴 — "
                f"Cloudflare Email Routing catch-all 또는 _handleKmailInboundEmail 경로 확인 필요"
            ), {"inbox_body": inbox_body}, cleanup
        return "LIVE-PASS", "", {"to": to_addr}, cleanup

    return "LIVE-ERROR", f"알 수 없는 kind: {kind}", {}, cleanup


def do_cleanup(items, ctx):
    for kind, arg in items:
        if kind == "delete_settings_record":
            pb_delete_record(ctx["pb_base"], ctx["pb_token"], "kmail_user_settings", arg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="scenarios_kmail_mail_id_20260912.json")
    ap.add_argument("--out", default="../../results/kmail-mail-id")
    ap.add_argument("--worker-base", default=DEFAULT_WORKER_BASE)
    ap.add_argument("--pb-base", default=DEFAULT_PB_BASE)
    ap.add_argument("--phone-verify-secret", default=os.environ.get("PHONE_VERIFY_SECRET"))
    ap.add_argument("--test-e164", required=True,
                     help="K-Mail을 실제로 쓰는 등록된 테스트 계정 전화번호 (예: +8201096627170)")
    ap.add_argument("--pb-admin-email", default=os.environ.get("PB_ADMIN_EMAIL"))
    ap.add_argument("--pb-admin-password", default=os.environ.get("PB_ADMIN_PASSWORD"))
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--skip-self-send", action="store_true",
                     help="실제 발송/수신 왕복 시나리오를 건너뜀(빠른 재실행용 — 외부 메일 인프라 지연이 없어짐)")
    ap.add_argument("--no-restore", action="store_true",
                     help="실행 전 kmail_user_settings 값을 백업했다가 끝나고 복원하지 않음(디버깅용)")
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
    if args.skip_self_send:
        scenarios = [s for s in scenarios if s["kind"] != "self_send_and_inbound_roundtrip"]

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

    e164 = normalize_kr_e164(args.test_e164)
    print(f"입력된 전화번호({args.test_e164!r})를 정규화: {e164}")
    token = make_phone_verify_token(args.phone_verify_secret, e164)
    pb_token = pb_admin_login(args.pb_base, args.pb_admin_email, args.pb_admin_password)

    sanity_status, sanity_body, _, sanity_err = get_json(args.worker_base, "/kmail/settings", token)
    if sanity_err or sanity_status != 200 or not (sanity_body or {}).get("ok"):
        print(f"\n사전 점검 실패 — {e164}로 등록된 프로필을 찾지 못했거나 인증에 실패했습니다.", file=sys.stderr)
        print(f"  status={sanity_status} body={sanity_body} err={sanity_err}", file=sys.stderr)
        sys.exit(1)
    # 2026-09-12 수정 — worker.js 긴급 수정(fix/kmail-guid-email-address-invalid)
    # 이후 kmail_address는 이메일 프로토콜에 실제로 넣을 수 있는 하이픈
    # 형태(2601-db80-...)로 응답한다. 그런데 PocketBase의
    # kmail_user_settings.owner_user_guid 등 내부 저장값은 여전히 원래
    # guid(콜론 형태, 2601:db80:...)이므로, PB 직접 조회에 쓰려면
    # 하이픈을 다시 콜론으로 되돌려야 한다(worker.js
    # _emailLocalPartToGuid와 동일한 변환).
    guid = sanity_body["kmail_address"].split("@")[0].replace("-", ":")
    print(f"사전 점검 통과 — guid={guid}\n")

    # ★ 실계정 오염 방지 — 실행 전 현재 kmail_user_settings 값을 백업.
    pre_state = pb_find_settings_by_guid(args.pb_base, pb_token, guid)
    pre_patch = None
    if pre_state:
        pre_patch = {
            k: pre_state.get(k, "" if k != "auto_reply_enabled" else False)
            for k in ("signature", "sender_display_name", "mail_id",
                      "auto_reply_enabled", "auto_reply_text", "auto_reply_until")
        }
        print(f"실행 전 설정 백업 완료(복원용): {pre_patch}\n")

    ctx = {
        "worker_base": args.worker_base, "phone_verify_token": token,
        "pb_base": args.pb_base, "pb_token": pb_token, "guid": guid,
    }

    all_cleanup = []
    results = []
    with open(results_path, "a", encoding="utf-8") as out_f:
        for scn in scenarios:
            no = scn["no"]
            if no in done:
                print(f"[{no}] skip (already done)")
                continue
            print(f"[{no}] {scn['name']} ({scn['kind']})")
            try:
                verdict, reason, extra, cleanup_items = run_scenario(scn, ctx)
            except Exception as e:
                verdict, reason, extra, cleanup_items = "LIVE-ERROR", f"예외: {e}", {}, []
            all_cleanup.extend(cleanup_items)
            record = {"no": no, "name": scn["name"], "kind": scn["kind"], "verdict": verdict, "reason": reason, **extra}
            results.append(record)
            out_f.write(json.dumps(record, ensure_ascii=False) + "\n")
            out_f.flush()
            print(f"    -> {verdict} {reason}")

    print(f"\n정리 중 — 합성 레코드 {len(all_cleanup)}건...")
    do_cleanup(all_cleanup, ctx)

    if not args.no_restore and pre_patch is not None:
        print("실행 전 설정 값으로 복원 중...")
        pb_patch_record(args.pb_base, pb_token, "kmail_user_settings", pre_state["id"], pre_patch)
        print("복원 완료.")
    elif args.no_restore:
        print("--no-restore 지정됨 — 테스트로 바뀐 설정값이 그대로 남아있습니다.")

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
