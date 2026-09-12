#!/usr/bin/env python3
"""
tests/live_smoketest/kmail_kaddress_new_features_live_smoketest.py
--------------------------------------------------------
2026-09-12 세션에 새로 만든 3가지 기능의 회귀 방지 가드:

  1) KMAIL_FETCH_CONTENT의 실제 조회 메커니즘(worker.js
     _performUrlFetchForSummary/_fetchGithubRepoSummary — GitHub
     저장소 URL은 REST API로 우회) — REST 레벨, LLM 판단과 무관하게
     기계적으로 검증.
  2) K-Mail(SP-25)이 이름 붙은 그룹을 언급받으면 사용자에게 되묻기
     전에 KMAIL_LOOKUP_CONTACTS를 먼저 시도하는가 — AI 행동 검증.
  3) K-Mail이 "URL 내용 요약해서 보내줘"류 요청에 KMAIL_FETCH_PAGE
     (이메일찾기 전용, 오용하면 안 됨)가 아니라 KMAIL_FETCH_CONTENT를
     쓰는가 — AI 행동 검증.
  4) K-Address(SP-26)가 "메일 보내줘" 요청에 안내만 하고 끝내지 않고
     KADDR_HANDOFF_TO_KMAIL로 실제 호출을 시도하는가 — AI 행동 검증
     (UNIVERSAL-INTEGRITY U0 항목(11) 준수 확인).

## 두 가지 검증 방식을 섞어 쓰는 이유
- REST(1번)는 실제 worker.js 엔드포인트(hondi-proxy)를 진짜 HTTP로
  호출한다 — GitHub API 우회가 실제로 동작하는지, 네트워크·인증까지
  전부 실사로 확인해야 의미가 있는 부분이라 여기는 mock을 쓰지 않는다.
- AI 행동(2~4번)은 kmail_fetch_page_smoketest.py와 동일한 패턴 —
  DeepSeek API를 직접 호출해 실제 worker.js(handleKmailChat/
  handleKaddressChat)가 아니라 SP 텍스트 자체가 만드는 판단을
  검증한다. UNIVERSAL 계층 근사·단일 SP 결합 등 그 하네스와 동일한
  한계를 그대로 안고 간다(하단 "한계" 참고).

## 한계
- 2~4번은 LLM 확률적 응답이라 재실행 시 결과가 달라질 수 있다 —
  NEEDS-REVIEW가 나오면 사람이 raw_response를 직접 봐야 한다.
- 1번은 GitHub API 비인증 요청(시간당 60건)에 의존한다 — 반복
  실행하면 레이트리밋(GITHUB_RATE_LIMITED)에 걸릴 수 있다(이 경우도
  FAIL이 아니라 별도 표시).

Usage:
  PHONE_VERIFY_SECRET=... DEEPSEEK_API_KEY=... python3 \\
      kmail_kaddress_new_features_live_smoketest.py \\
      --out ../../results/kmail-kaddress-new-features \\
      --test-e164 "+8201096627170"
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import sys
import time

import requests

DEFAULT_WORKER_BASE = "https://hondi-proxy.tensor-city.workers.dev"
DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROMPTS_DIR = os.path.join(ROOT, "prompts")
CATALOG_PATH = os.path.join(PROMPTS_DIR, "sp-catalog.json")


# ══════════════════════════════════════════════════════════════
# 공용
# ══════════════════════════════════════════════════════════════
def normalize_kr_e164(raw):
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) < 8:
        raise ValueError(f"전화번호에서 숫자가 8자리 미만입니다: {raw!r}")
    return f"+82010{digits[-8:]}"


def make_phone_verify_token(secret, e164, ttl_ms=10 * 60 * 1000):
    exp = int(time.time() * 1000) + ttl_ms
    payload = f"{e164}:{exp}"
    sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def load_catalog():
    with open(CATALOG_PATH, encoding="utf-8") as f:
        return json.load(f)


def read_sp(catalog, key):
    with open(os.path.join(PROMPTS_DIR, catalog[key]), encoding="utf-8") as f:
        return f.read()


def compose_prompt(catalog, sp_key):
    parts = [read_sp(catalog, "UNIVERSAL-INTEGRITY"), read_sp(catalog, "UNIVERSAL-common"), read_sp(catalog, sp_key)]
    return "\n\n---\n\n".join(parts)


def call_deepseek(api_key, system_prompt, turns, max_tokens=1200):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": MODEL, "temperature": 0.4, "max_tokens": max_tokens,
               "messages": [{"role": "system", "content": system_prompt}] + turns}
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"]["content"], data.get("usage", {}), None
            last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
        if attempt < MAX_RETRIES:
            time.sleep(RETRY_BASE_SLEEP * (2 ** (attempt - 1)))
    return None, None, last_err


# ══════════════════════════════════════════════════════════════
# 1) REST — KMAIL_FETCH_CONTENT 실제 조회 메커니즘
# ══════════════════════════════════════════════════════════════
def rest_get(worker_base, path, token, extra_params=None):
    params = {"phone_verify_token": token}
    if extra_params:
        params.update(extra_params)
    try:
        res = requests.get(f"{worker_base}{path}", params=params, timeout=30)
        try:
            body = res.json()
        except Exception:
            body = None
        return res.status_code, body, None
    except Exception as e:  # noqa: BLE001
        return None, None, str(e)


def run_rest_scenario(scn, worker_base, token):
    kind = scn["kind"]

    if kind == "fetch_content_github_repo":
        status, body, err = rest_get(worker_base, "/kmail/fetch-content-check", token,
                                      {"url": scn["url"]})
        if err:
            return "LIVE-ERROR", err, {}
        result = (body or {}).get("result", {})
        if status != 200:
            return "LIVE-FAIL", f"HTTP {status}: {body}", {"body": body}
        if result.get("error") == "GITHUB_RATE_LIMITED":
            return "LIVE-SKIP", "GitHub API 레이트리밋에 걸림(비인증 60건/시간) — 재실행 필요, 실패 아님", {"result": result}
        if not result.get("ok"):
            return "LIVE-FAIL", f"조회 실패: {result}", {"result": result}
        if result.get("kind") != "github_repo":
            return "LIVE-FAIL", f"GitHub URL인데 kind='{result.get('kind')}'(기대: github_repo) — API 우회가 안 탄 것으로 보임", {"result": result}
        snippet = result.get("text_snippet", "")
        if "최근 커밋" not in snippet:
            return "LIVE-FAIL", f"text_snippet에 커밋 목록이 없음: {snippet[:200]}", {"result": result}
        return "LIVE-PASS", "", {"kind": result.get("kind"), "snippet_head": snippet[:200]}

    if kind == "fetch_content_generic_page":
        status, body, err = rest_get(worker_base, "/kmail/fetch-content-check", token,
                                      {"url": scn["url"]})
        if err:
            return "LIVE-ERROR", err, {}
        result = (body or {}).get("result", {})
        if status != 200 or not result.get("ok"):
            return "LIVE-FAIL", f"조회 실패: status={status} result={result}", {"result": result}
        if result.get("kind") != "generic_page":
            return "LIVE-FAIL", f"일반 페이지인데 kind='{result.get('kind')}'(기대: generic_page)", {"result": result}
        return "LIVE-PASS", "", {"kind": result.get("kind")}

    if kind == "fetch_content_invalid_url":
        status, body, err = rest_get(worker_base, "/kmail/fetch-content-check", token,
                                      {"url": scn["url"]})
        if err:
            return "LIVE-ERROR", err, {}
        result = (body or {}).get("result", {})
        if result.get("ok") or result.get("error") != "INVALID_URL":
            return "LIVE-FAIL", f"잘못된 URL이 거부되지 않음: {result}", {"result": result}
        return "LIVE-PASS", "", {"result": result}

    if kind == "fetch_content_nonexistent_repo":
        status, body, err = rest_get(worker_base, "/kmail/fetch-content-check", token,
                                      {"url": scn["url"]})
        if err:
            return "LIVE-ERROR", err, {}
        result = (body or {}).get("result", {})
        if result.get("ok") or result.get("error") not in ("REPO_NOT_FOUND", "GITHUB_RATE_LIMITED"):
            return "LIVE-FAIL", f"존재하지 않는 저장소가 REPO_NOT_FOUND로 안 잡힘: {result}", {"result": result}
        if result.get("error") == "GITHUB_RATE_LIMITED":
            return "LIVE-SKIP", "GitHub API 레이트리밋 — 재실행 필요", {"result": result}
        return "LIVE-PASS", "", {"result": result}

    return "LIVE-ERROR", f"알 수 없는 kind: {kind}", {}


REST_SCENARIOS = [
    {"no": 1, "name": "GitHub 저장소 URL → REST API 우회(커밋 목록 포함)",
     "kind": "fetch_content_github_repo", "url": "https://github.com/Openhash-Gopang/hondi/"},
    {"no": 2, "name": "일반 웹페이지 URL → generic_page로 조회",
     "kind": "fetch_content_generic_page", "url": "https://example.com/"},
    {"no": 3, "name": "잘못된 URL 형식 거부", "kind": "fetch_content_invalid_url", "url": "not-a-url"},
    {"no": 4, "name": "존재하지 않는 GitHub 저장소 → REPO_NOT_FOUND",
     "kind": "fetch_content_nonexistent_repo",
     "url": "https://github.com/Openhash-Gopang/this-repo-should-not-exist-xyz123/"},
]


# ══════════════════════════════════════════════════════════════
# 2~4) AI 행동 — DeepSeek 직접 호출(kmail_fetch_page_smoketest.py와 동일 패턴)
# ══════════════════════════════════════════════════════════════
LOOKUP_TAG_RE = re.compile(r"[\[\(]?KMAIL_LOOKUP_CONTACTS\s*(\{[\s\S]*\})\s*[\]\)]?\s*$")
FETCH_CONTENT_TAG_RE = re.compile(r"[\[\(]?KMAIL_FETCH_CONTENT\s*(\{[\s\S]*\})\s*[\]\)]?\s*$")
FETCH_PAGE_TAG_RE = re.compile(r"[\[\(]?KMAIL_FETCH_PAGE\s*(\{[\s\S]*\})\s*[\]\)]?\s*$")
HANDOFF_TAG_RE = re.compile(r"[\[\(]?KADDR_HANDOFF_TO_KMAIL\s*(\{[\s\S]*\})\s*[\]\)]?\s*$")

# "그룹이 누구누구인지 알려주세요"류 — 조회 없이 바로 되묻는 회귀 신호.
ASK_GROUP_MEMBERS_RE = re.compile(
    r"(멤버|명단|구성원).{0,15}(누구|알려|말씀).{0,10}주(시겠|시면|세요)", re.IGNORECASE
)
# K-Address가 "제가 못 하니 K-Mail 가서 직접 하세요"류로 안내만 하고 끝내는 회귀 신호.
GUIDE_ONLY_RE = re.compile(
    r"(K-?Mail|메일).{0,10}(탭|화면|에서).{0,15}(직접|스스로).{0,10}(해|보내|진행)", re.IGNORECASE
)


def run_ai_scenario(scn, api_key, catalog):
    kind = scn["kind"]

    if kind == "kmail_group_lookup_first":
        system_prompt = compose_prompt(catalog, "SP-25_kmail")
        text, usage, err = call_deepseek(api_key, system_prompt,
                                          [{"role": "user", "content": scn["user_utterance"]}])
        if err:
            return "LIVE-ERROR", err, {"raw": None}
        if LOOKUP_TAG_RE.search(text):
            return "LIVE-PASS", "되묻지 않고 KMAIL_LOOKUP_CONTACTS를 먼저 시도함", {"raw": text}
        if ASK_GROUP_MEMBERS_RE.search(text):
            return "LIVE-FAIL", "조회 없이 바로 '멤버가 누구인지' 되물음 — 실사고 재발", {"raw": text}
        return "LIVE-NEEDS-REVIEW", "조회도 안 하고 되묻기 패턴도 아님 — 사람 확인 필요", {"raw": text}

    if kind == "kmail_fetch_content_not_fetch_page":
        system_prompt = compose_prompt(catalog, "SP-25_kmail")
        text, usage, err = call_deepseek(api_key, system_prompt,
                                          [{"role": "user", "content": scn["user_utterance"]}])
        if err:
            return "LIVE-ERROR", err, {"raw": None}
        used_content = bool(FETCH_CONTENT_TAG_RE.search(text))
        used_page = bool(FETCH_PAGE_TAG_RE.search(text))
        if used_content and not used_page:
            return "LIVE-PASS", "KMAIL_FETCH_CONTENT를 정확히 사용함(FETCH_PAGE 오용 없음)", {"raw": text}
        if used_page:
            return "LIVE-FAIL", "이메일찾기 전용 KMAIL_FETCH_PAGE를 오용함 — 실사고 재발", {"raw": text}
        return "LIVE-NEEDS-REVIEW", "둘 다 안 씀 — 사람이 raw_response 확인 필요(자료를 대신 요청했을 수도 있음, 그 경우도 정상)", {"raw": text}

    if kind == "kaddress_handoff_not_guide_only":
        system_prompt = compose_prompt(catalog, "SP-26_kaddress")
        text, usage, err = call_deepseek(api_key, system_prompt,
                                          [{"role": "user", "content": scn["user_utterance"]}])
        if err:
            return "LIVE-ERROR", err, {"raw": None}
        if HANDOFF_TAG_RE.search(text):
            return "LIVE-PASS", "KADDR_HANDOFF_TO_KMAIL로 실제 호출을 시도함", {"raw": text}
        if GUIDE_ONLY_RE.search(text):
            return "LIVE-FAIL", "안내만 하고 끝남(U0 항목(11) 위반) — 실사고 재발", {"raw": text}
        return "LIVE-NEEDS-REVIEW", "핸드오프도 안 하고 안내형 패턴도 아님 — 사람 확인 필요", {"raw": text}

    return "LIVE-ERROR", f"알 수 없는 kind: {kind}", {}


AI_SCENARIOS = [
    {"no": 5, "name": "K-Mail: 이름 붙은 그룹 언급 시 되묻기 전에 주소록 조회",
     "kind": "kmail_group_lookup_first",
     "user_utterance": "팀 주피터 멤버들에게 혼디 최근 개발 상황을 요약해서 보내줘"},
    {"no": 6, "name": "K-Mail: URL 요약 요청에 FETCH_CONTENT 사용(FETCH_PAGE 오용 금지)",
     "kind": "kmail_fetch_content_not_fetch_page",
     "user_utterance": "https://github.com/Openhash-Gopang/hondi/ 이 저장소 최근 진행 상황을 파악해서 메일 본문 초안에 넣어줘"},
    {"no": 7, "name": "K-Address: 발송 요청에 안내만 하지 않고 K-Mail 직접 호출",
     "kind": "kaddress_handoff_not_guide_only",
     "user_utterance": "팀 주피터 멤버들에게 혼디 최근 개발 상황을 요약해서 보내줘"},
]


# ══════════════════════════════════════════════════════════════
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="../../results/kmail-kaddress-new-features")
    ap.add_argument("--worker-base", default=DEFAULT_WORKER_BASE)
    ap.add_argument("--phone-verify-secret", default=os.environ.get("PHONE_VERIFY_SECRET"))
    ap.add_argument("--deepseek-api-key", default=os.environ.get("DEEPSEEK_API_KEY"))
    ap.add_argument("--test-e164", required=True)
    ap.add_argument("--skip-rest", action="store_true")
    ap.add_argument("--skip-ai", action="store_true")
    args = ap.parse_args()

    if not args.skip_rest and not args.phone_verify_secret:
        print("PHONE_VERIFY_SECRET이 없습니다(REST 시나리오에 필요, --skip-rest로 건너뛸 수 있음).", file=sys.stderr)
        sys.exit(1)
    if not args.skip_ai and not args.deepseek_api_key:
        print("DEEPSEEK_API_KEY가 없습니다(AI 행동 시나리오에 필요, --skip-ai로 건너뛸 수 있음).", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.out, exist_ok=True)
    results = []

    if not args.skip_rest:
        e164 = normalize_kr_e164(args.test_e164)
        token = make_phone_verify_token(args.phone_verify_secret, e164)
        print(f"=== REST 시나리오({len(REST_SCENARIOS)}건) ===")
        for scn in REST_SCENARIOS:
            print(f"[{scn['no']}] {scn['name']}")
            try:
                verdict, reason, extra = run_rest_scenario(scn, args.worker_base, token)
            except Exception as e:  # noqa: BLE001
                verdict, reason, extra = "LIVE-ERROR", f"예외: {e}", {}
            results.append({"no": scn["no"], "name": scn["name"], "kind": scn["kind"], "verdict": verdict, "reason": reason, **extra})
            print(f"    -> {verdict} {reason}")

    if not args.skip_ai:
        catalog = load_catalog()
        print(f"\n=== AI 행동 시나리오({len(AI_SCENARIOS)}건, DeepSeek 직접 호출) ===")
        for scn in AI_SCENARIOS:
            print(f"[{scn['no']}] {scn['name']}")
            try:
                verdict, reason, extra = run_ai_scenario(scn, args.deepseek_api_key, catalog)
            except Exception as e:  # noqa: BLE001
                verdict, reason, extra = "LIVE-ERROR", f"예외: {e}", {}
            raw = extra.pop("raw", None)
            record = {"no": scn["no"], "name": scn["name"], "kind": scn["kind"], "verdict": verdict, "reason": reason, **extra}
            if raw:
                record["raw_response"] = raw
            results.append(record)
            print(f"    -> {verdict} {reason}")
            if raw and verdict in ("LIVE-FAIL", "LIVE-NEEDS-REVIEW"):
                print(f"       raw_response: {raw[:300]}")

    with open(os.path.join(args.out, "live_results.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    counts = {}
    for r in results:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    summary = {"total": len(results), "counts": counts}
    with open(os.path.join(args.out, "live_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n=== 요약 ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if counts.get("LIVE-FAIL") or counts.get("LIVE-ERROR"):
        sys.exit(1)


if __name__ == "__main__":
    main()
