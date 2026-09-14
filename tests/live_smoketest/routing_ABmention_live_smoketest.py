#!/usr/bin/env python3
"""
tests/live_smoketest/routing_ABmention_live_smoketest.py
----------------------------------------------------------
K-서비스/전문가 페르소나/공공기관 세 계층에 대해, "대상을 이름으로 명시한
발화(A)"와 "업무만 기술하고 이름은 밝히지 않은 발화(B)" 두 축을 각각 독립
검증하는 라우팅 하네스. AC-PRO-CORE(v1.15, sp-catalog.json 매니페스트 기준)
를 system prompt로 그대로 로드해 DeepSeek을 호출하고, 응답에 기대한 라우팅
태그/기관명이 실제로 나오는지 확인한다.

## 세 계층의 채점 방식이 다른 이유
- K-서비스(kservice): AC가 직접 [GWP: {id}] 태그를 낸다 — id가 고정 enum
  이라 태그 문자열 정확 일치로 채점 가능.
- 전문가 페르소나(expert): AC가 직접 [EXPERT: {id}] 태그를 낸다 — 마찬가지로
  정확 일치 채점 가능.
- 공공기관(institution): §CATALOG 표 밖 대상은 AC가 [CALL_KINTENT: query=...]
  로 위임만 하고, 실제 기관 특정은 K-Intent/K-Compose 내부(이 스크립트가
  호출하지 않는 하위 SP)에서 일어난다. 그래서 institution 계층은 (1) AC가
  최소한 [CALL_KINTENT로 넘어갔는지(오탐으로 다른 GWP/EXPERT를 잘못 찍지는
  않았는지), (2) AC 자신의 답변 텍스트(cleanedReply)에 이미 기관명을 정확히
  언급했는지(call-ai.js 2026-07-23 수정 주석 참고 — 이 텍스트가 그대로 다음
  단계로 전달된다) 두 가지만 느슨하게 확인한다. "K-Intent 이후 실제로 그
  기관으로 확정됐는지"까지는 이 스크립트의 범위 밖이다(하위 SP까지 체인
  호출해야 하므로 훨씬 큰 별도 작업).

## 사용법
  DEEPSEEK_API_KEY=... python3 routing_ABmention_live_smoketest.py \\
      --scenarios scenarios_kservice_20260914.json \\
      --out ../../results/routing-ab/kservice
  (세 파일을 각각 --scenarios로 바꿔가며 3번 실행하거나, --scenarios에
  쉼표로 구분해 한 번에 넘겨도 된다.)

## 한계
- expect_text(institution 전용) 매칭은 부분 문자열 포함 여부만 본다 —
  "국민연금공단"을 기대했는데 AC가 "국민연금관리공단"처럼 오타/이형을 냈으면
  놓칠 수 있다. NEEDS-REVIEW로 분류되는 것들은 사람이 raw_response를 직접
  읽어야 한다.
- 전문가 페르소나 표는 63개 중 18개(주요 도메인 대표 샘플)만, 공공기관은
  745+ 중 13개(제주 소재 국가기관 대표 샘플)만 다룬다 — 전수조사가 아니다.
  이 배치에서 특정 패턴의 오류가 보이면 같은 도메인의 나머지 항목으로
  확장하는 게 다음 단계다.
"""
import argparse
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
MAX_WORKERS = 5
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3


def load_ac_pro_core():
    with open(os.path.join(PROMPTS_DIR, "sp-catalog.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    fname = manifest.get("AC-PRO-CORE")
    if not fname:
        raise FileNotFoundError("manifest에 AC-PRO-CORE 키 없음")
    with open(os.path.join(PROMPTS_DIR, fname), encoding="utf-8") as f:
        return f.read(), fname


def call_deepseek(api_key, system_prompt, user_utterance):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": MODEL,
        "temperature": 0,
        "max_tokens": 800,
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
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                return content, None
            last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
        except requests.RequestException as e:
            last_err = f"request_exception: {e}"
        if attempt < MAX_RETRIES:
            time.sleep(RETRY_BASE_SLEEP * attempt)
    return None, last_err


def grade(raw_text, scenario):
    if not raw_text or not raw_text.strip():
        return "LIVE-FAIL", "응답이 비어 있음"

    expect_tag = scenario["expect_tag"]
    tier = scenario["tier"]

    if tier in ("kservice", "expert"):
        # 정확 일치 — [GWP: id] / [EXPERT: id]를 그대로 찾는다.
        if expect_tag in raw_text:
            return "LIVE-PASS", f"기대 태그 정확 일치: {expect_tag}"
        # 다른 GWP/EXPERT 태그로 샜는지 확인(오탐 여부를 알려주면 디버깅에
        # 도움이 된다).
        wrong = re.search(r"\[(GWP|EXPERT|CALL_KINTENT)[^\]]*\]", raw_text)
        if wrong:
            return "LIVE-FAIL", f"다른 곳으로 샘: {wrong.group(0)}"
        return "LIVE-FAIL", "기대 태그 없음(태그 자체를 안 냄)"

    if tier == "institution":
        has_handoff = expect_tag in raw_text  # "[CALL_KINTENT" 접두 매칭
        misroute = re.search(r"\[(GWP|EXPERT):\s*[\w-]+\]", raw_text)
        text_match = scenario.get("expect_text", "") in raw_text
        if misroute:
            return "LIVE-FAIL", f"공공기관 사안인데 K-서비스/전문가로 오탐: {misroute.group(0)}"
        if has_handoff and text_match:
            return "LIVE-PASS", "CALL_KINTENT로 위임 + 기관명 텍스트 일치"
        if has_handoff and not text_match:
            return "LIVE-NEEDS-REVIEW", "CALL_KINTENT는 냈으나 기대 기관명 텍스트가 응답에 안 보임 — 사람 확인 필요"
        if not has_handoff and text_match:
            return "LIVE-NEEDS-REVIEW", "CALL_KINTENT 태그는 안 보이지만 기관명은 텍스트에 있음 — 사람 확인 필요"
        return "LIVE-FAIL", "CALL_KINTENT도 없고 기관명 언급도 없음"

    return "LIVE-NEEDS-REVIEW", f"알 수 없는 tier: {tier}"


def process_one(api_key, ac_pro_core, scenario):
    raw_text, err = call_deepseek(api_key, ac_pro_core, scenario["utterance"])
    if err:
        return {**scenario, "raw_response": None, "live_verdict": "LIVE-ERROR", "live_note": err}
    verdict, note = grade(raw_text, scenario)
    return {**scenario, "raw_response": raw_text, "live_verdict": verdict, "live_note": note}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", required=True,
                     help="시나리오 JSON 파일 경로(쉼표로 여러 개 지정 가능)")
    ap.add_argument("--out", default="../../results/routing-ab")
    args = ap.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)

    ac_pro_core, fname = load_ac_pro_core()
    print(f"AC-PRO-CORE 버전: {fname}")

    scenarios = []
    for path in args.scenarios.split(","):
        with open(path.strip(), encoding="utf-8") as f:
            scenarios.extend(json.load(f))

    print(f"{len(scenarios)}개 시나리오 실행 중...")
    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, "live_results.jsonl")

    results = []
    with open(out_path, "w", encoding="utf-8") as out_f:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {pool.submit(process_one, api_key, ac_pro_core, s): s for s in scenarios}
            for i, fut in enumerate(as_completed(futures), 1):
                r = fut.result()
                results.append(r)
                out_f.write(json.dumps(r, ensure_ascii=False) + "\n")
                out_f.flush()
                print(f"[{i}/{len(scenarios)}] {r['id']:42s} {r['live_verdict']:16s} {r['live_note']}")

    # ── 계층 × 변형(명시/암시)별 집계 ──────────────────────────
    summary = {}
    for r in results:
        key = (r["tier"], r["variant"])
        summary.setdefault(key, {}).setdefault(r["live_verdict"], 0)
        summary[key][r["live_verdict"]] += 1

    print("\n=== 계층 × 명시/암시 별 요약 ===")
    for (tier, variant), counts in sorted(summary.items()):
        total = sum(counts.values())
        passed = counts.get("LIVE-PASS", 0)
        print(f"  {tier:12s} {variant:8s} — {passed}/{total} PASS  {counts}")

    fails = [r for r in results if r["live_verdict"] in ("LIVE-FAIL", "LIVE-ERROR")]
    if fails:
        print("\n=== FAIL/ERROR 목록 ===")
        for r in fails:
            print(f"  - {r['id']} ({r.get('target_id') or r.get('target_name')}): {r['live_note']}")

    if any(r["live_verdict"] in ("LIVE-FAIL", "LIVE-ERROR") for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
