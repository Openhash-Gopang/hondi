#!/usr/bin/env python3
"""
tests/live_smoketest/gov_clarify_live_smoketest.py (2026-09-18 신설)
------------------------------------------------------------------
gov-router.js의 "CLARIFY:코드1,코드2" 되묻기 신호(2026-08-21 신설,
사용자 지시)가 실제로 발동하는지 처음으로 라이브 검증하는 하네스.

## 왜 이 테스트가 필요한가
이 세션 앞부분에서 EXPERT 리프 라우팅(subject-gate.js)에 똑같은 컨셉의
자기선고형 "ambiguous" 신호를 추가했다가 실사에서 2회 연속 0/22건으로
전혀 안 쓰이는 걸 발견했다(모델이 "확신 있게 하나 고르기"와 "동시에
스스로 의심하기"를 같은 JSON 안에서 요구받으면 항상 전자만 이행).
gov-router.js의 CLARIFY: 메커니즘은 정확히 같은 설계 패턴(한 번의 호출
안에서 코드 하나 / NONE / CLARIFY:... 중 하나를 자유 텍스트로 선택)이라
같은 실패 양상을 겪을 위험이 있다 — 그런데 이 기능은 2026-08-21에
신설된 이후 실제로 라이브 검증된 적이 없다(이전 세션 마지막 메시지가
정확히 이 검증을 요청하다가 크레딧 소진으로 중단됨).

## 이 하네스가 하는 일
pages/regional-gov.html의 _govClassifyFn 시스템 프롬프트와
gov-router.js의 _parseClarifySignal 파싱 규칙을 그대로 재현(재구현
아님 — 두 문자열/로직 모두 production 소스에서 그대로 추출)해서,
ROUTE_DESCRIPTIONS 자신의 주석이 명시적으로 "인접·혼동 위험"이라고
표시해둔 코드쌍(예: SP-DO-GENDER ↔ SP-DO-WELFARE, SP-NAT-POLICE ↔
SP-NAT-PROSECUTION)을 겨냥한 발화로 실제 CLARIFY 발동 여부를 잰다.

Usage:
  DEEPSEEK_API_KEY=... python3 gov_clarify_live_smoketest.py \
      --scenarios scenarios_gov_clarify_20260918.json \
      --out ../../results/gov-clarify
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
MODEL = "deepseek-v4-flash"  # pages/regional-gov.html의 _govClassifyFn과 동일 모델
MAX_WORKERS = 5
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3

# pages/regional-gov.html의 _govClassifyFn 시스템 프롬프트 머리말과 정확히
# 동일한 문구 — production 소스(fn eval)에서 그대로 추출. 어긋나면 이
# 하네스가 production과 다른 걸 테스트하게 된다(양쪽 다 갱신 필요).
CLASSIFY_PROMPT_HEAD = "아래는 제주 지방행정 라우팅 코드 후보 목록이다. 사용자 발화를 읽고 가장 알맞은 코드 하나만 답하라. 확신이 없거나 해당하는 코드가 없으면 NONE이라고만 답하라. 후보 중 2개가 똑같이 그럴듯해서 하나로 못 고르겠으면 \"CLARIFY:코드1,코드2\" 형식으로만 답하라(콤마로 구분, 공백 없이, 정확히 2개만). 다른 설명·문장부호 없이 코드, NONE, 또는 CLARIFY:... 중 하나만 출력한다.\n\n"


def call_deepseek(api_key, system_prompt, user_utterance):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": MODEL,
        "temperature": 0,
        # 2026-09-18 갱신 — pages/regional-gov.html의 _govClassifyFn이
        # max_tokens 30→2000으로 수정됐는데(원인: 추론모델이 30 전량을
        # reasoning에 소진해 실제 응답을 한 번도 못 냄, 이 하네스의 첫
        # 실사 6/6건에서 재현) 이 하네스는 독립 상수라 그 갱신을 자동으로
        # 안 따라갔다 — 재실행해도 여전히 0글자 응답이었던 원인이 바로
        # 이것. production과 동일하게 2000으로 맞춘다.
        "max_tokens": 2000,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_utterance[:2000]},
        ],
    }
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                msg = data["choices"][0]["message"]
                text = msg.get("content") or ""
                if not text:
                    print(
                        f"[DEBUG-EMPTY] finish_reason={data['choices'][0].get('finish_reason')} "
                        f"reasoning_content_len={len(msg.get('reasoning_content') or '')} "
                        f"usage={data.get('usage')}",
                        flush=True,
                    )
                return text, data.get("usage", {}), None
            last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
        except requests.RequestException as e:
            last_err = f"request_exception: {e}"
        if attempt < MAX_RETRIES:
            time.sleep(RETRY_BASE_SLEEP * attempt)
    return None, {}, last_err


def parse_clarify_signal(raw):
    """gov-router.js의 _parseClarifySignal을 그대로 재현(재구현 아님 —
    같은 정규식·분기 규칙)."""
    if not isinstance(raw, str) or not raw.startswith("CLARIFY:"):
        return None
    codes = [c.strip() for c in raw[8:].split(",") if c.strip()]
    return codes if len(codes) >= 2 else None


def grade(scenario, raw_text, call_err):
    if call_err is not None:
        return "LIVE-ERROR", call_err, None

    raw = (raw_text or "").strip()
    clarify_codes = parse_clarify_signal(raw)
    expected = scenario["expected_ambiguous_pair"]

    if clarify_codes:
        valid = [c for c in clarify_codes if c in scenario["candidate_codes"]]
        if len(valid) >= 2:
            if set(valid[:2]) == set(expected):
                return "LIVE-CLARIFY-CORRECT", f"CLARIFY 발동, 기대한 쌍과 정확히 일치: {valid}", raw
            return "LIVE-CLARIFY-OTHERPAIR", f"CLARIFY는 발동했으나 다른 쌍: {valid} (기대: {expected})", raw
        return "LIVE-FAIL", f"CLARIFY 형식이나 유효 코드 부족: {clarify_codes}", raw

    # 단일 코드 매칭 추출 — _govClassifyFn의 정규식과 동일 규칙.
    m = re.match(r"[A-Z0-9][A-Z0-9-]*", raw)
    chosen = m.group(0) if m else None
    if chosen == "NONE":
        return "LIVE-FAIL", "NONE 응답 — 후보 중 하나는 명백히 맞아야 하는 시나리오인데 회피", chosen
    if chosen and chosen in scenario["candidate_codes"]:
        note = (
            f"단일 코드로 확신 있게 답함(하나를 골랐지만 기대 쌍 {expected} 중 하나): {chosen}"
            if chosen in expected
            else f"단일 코드로 확신 있게 답함(기대 쌍 밖): {chosen}"
        )
        return "LIVE-FAIL", note, chosen
    return "LIVE-FAIL", f"파싱 실패/화이트리스트 밖 — raw: {raw[:200]}", chosen


def process_one(api_key, scenario):
    candidates_text = "\n".join(
        f"{code}: {scenario['descriptions'][code]}" for code in scenario["candidate_codes"]
    )
    system_prompt = CLASSIFY_PROMPT_HEAD + candidates_text
    raw_text, usage, err = call_deepseek(api_key, system_prompt, scenario["utterance"])
    verdict, note, chosen = grade(scenario, raw_text, err)
    return {
        "id": scenario["id"], "utterance": scenario["utterance"],
        "expected_ambiguous_pair": scenario["expected_ambiguous_pair"],
        "live_verdict": verdict, "live_note": note, "chosen": chosen, "usage": usage,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", required=True)
    ap.add_argument("--out", default="../../results/gov-clarify")
    args = ap.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)

    with open(args.scenarios, encoding="utf-8") as f:
        scenarios = json.load(f)

    os.makedirs(args.out, exist_ok=True)
    results_path = os.path.join(args.out, "live_results.json")

    results = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(process_one, api_key, s): s for s in scenarios}
        for i, fut in enumerate(as_completed(futures), 1):
            r = fut.result()
            results.append(r)
            print(f"  [{i}/{len(scenarios)}] {r['id']}: {r['live_verdict']} | {r['live_note']}", flush=True)

    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    verdict_counts = {}
    for r in results:
        verdict_counts[r["live_verdict"]] = verdict_counts.get(r["live_verdict"], 0) + 1
    print("\n=== 요약 ===")
    for v, c in sorted(verdict_counts.items()):
        print(f"  {v}: {c}")


if __name__ == "__main__":
    main()
