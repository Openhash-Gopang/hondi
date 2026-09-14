#!/usr/bin/env python3
"""
tests/live_smoketest/gov_recheck_live_smoketest.py
------------------------------------------------------
routing_ABmention_live_smoketest.py의 institution 계층 결과 중 진짜로
의심스러운 2건(국민건강보험공단→kinsurance, 근로복지공단→kbusiness)만
좁혀서, 다른 문구 5개씩으로 패턴인지 우연인지 재확인하는 전용 스크립트.

institution 계층 전체를 다시 채점하지 않는다 — kregionalgov/kgov로 가는
건 gov-router.js의 국가기관 라우팅 테이블이 이미 내부에서 처리하도록
설계돼 있음을 확인했으므로(2026-09-14) 정상으로 간주하고, 오직 "완전히
다른 도메인의 민간/사업자 K-서비스로 새는지"만 본다.

Usage:
  DEEPSEEK_API_KEY=... python3 gov_recheck_live_smoketest.py
"""
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"
PROMPTS_DIR = "../../prompts"
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3


def load_ac_pro_core():
    with open(os.path.join(PROMPTS_DIR, "sp-catalog.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    fname = manifest["AC-PRO-CORE"]
    with open(os.path.join(PROMPTS_DIR, fname), encoding="utf-8") as f:
        return f.read(), fname


def call_deepseek(api_key, system_prompt, user_utterance):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": MODEL, "temperature": 0, "max_tokens": 500,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_utterance},
        ],
    }
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("choices", [{}])[0].get("message", {}).get("content", ""), None
            last_err = f"HTTP {resp.status_code}: {resp.text[:200]}"
        except requests.RequestException as e:
            last_err = f"request_exception: {e}"
        if attempt < MAX_RETRIES:
            time.sleep(RETRY_BASE_SLEEP * attempt)
    return None, last_err


def grade(raw_text, scenario):
    if not raw_text:
        return "ERROR", "응답 없음"
    avoid_tag = f"[GWP: {scenario['avoid_id']}]"
    if avoid_tag in raw_text:
        return "CONFIRMED-MISROUTE", f"의심 패턴 재현: {avoid_tag}"
    any_gwp = re.search(r"\[GWP:\s*[\w-]+\]", raw_text)
    return "OK", f"다른 곳으로 감(문제 아님): {any_gwp.group(0) if any_gwp else '태그 없음'}"


def process_one(api_key, ac_pro_core, scenario):
    raw, err = call_deepseek(api_key, ac_pro_core, scenario["utterance"])
    if err:
        return {**scenario, "raw_response": None, "verdict": "ERROR", "note": err}
    verdict, note = grade(raw, scenario)
    return {**scenario, "raw_response": raw, "verdict": verdict, "note": note}


def main():
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)

    ac_pro_core, fname = load_ac_pro_core()
    print(f"AC-PRO-CORE 버전: {fname}")

    with open("scenarios_gov_recheck_20260914.json", encoding="utf-8") as f:
        scenarios = json.load(f)

    results = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(process_one, api_key, ac_pro_core, s): s for s in scenarios}
        for i, fut in enumerate(as_completed(futures), 1):
            r = fut.result()
            results.append(r)
            print(f"[{i}/{len(scenarios)}] {r['id']:28s} {r['verdict']:20s} {r['note']}")

    nhis = [r for r in results if r["id"].startswith("gov-nhis")]
    kcomwel = [r for r in results if r["id"].startswith("gov-kcomwel")]

    print("\n=== 요약 ===")
    for label, group in [("국민건강보험공단(→kinsurance 의심)", nhis), ("근로복지공단(→kbusiness 의심)", kcomwel)]:
        confirmed = sum(1 for r in group if r["verdict"] == "CONFIRMED-MISROUTE")
        print(f"  {label}: {confirmed}/{len(group)}건 재현")


if __name__ == "__main__":
    main()
