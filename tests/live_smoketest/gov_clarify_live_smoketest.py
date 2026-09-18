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
# 2026-09-18 추가 — 빈 응답(추론이 max_tokens 안에서 안 끝나는 현상) 근본원인
# 진단용으로 모듈 전역으로 뺐다. --max-tokens로 값을 바꿔 재실행할 수 있다.
# 2026-09-18 재갱신(4000→12000) — 진단 결과(diag-01~05) 4/5건이 12000 안에서
# 정상 종료(최대 reasoning 8520)됨을 확인, pages/regional-gov.html의
# _callGovClassifyModel도 동일하게 12000으로 올려 production과 동기화.
MAX_TOKENS = 12000

# pages/regional-gov.html의 _govClassifyFn 시스템 프롬프트 머리말과 정확히
# 동일한 문구 — production 소스(fn eval)에서 그대로 추출. 어긋나면 이
# 하네스가 production과 다른 걸 테스트하게 된다(양쪽 다 갱신 필요).
CLASSIFY_PROMPT_HEAD = '아래는 제주 지방행정 라우팅 코드 후보 목록이다. 사용자 발화를 읽고 다른 텍스트 없이 JSON으로만 응답하라: {"code": "<가장 알맞은 코드, 확신이 없거나 해당하는 코드가 없으면 NONE>", "runnerUp": "<그다음으로 가능성 있는 다른 구체적 코드, 없으면 null>"}. "code"는 지금까지처럼 확신 있게 고르는 판단이다 — 이 판단 자체는 조금도 망설이지 않는다. "runnerUp"은 별개의 질문이다: "code"로 고른 것 말고도 이 발화만으로는 완전히 배제할 수 없는 다른 구체적인 코드가 하나 있다면 그 코드를, 그런 코드가 전혀 없다면 null을 넣는다(runnerUp을 적는다고 "code" 판단이 흔들리는 게 아니다).\n\n후보 목록:\n'

# 2026-09-18 추가 — runnerUp 2차 확인 호출 프롬프트. pages/regional-gov.html의
# _govClassifyFn 재작성(자기선고 CLARIFY: → code+runnerUp 2단계 분리, subject-
# gate.js의 runnerUp 설계를 그대로 이식)에서 production 문자열을 그대로 추출.
CONFIRM_PROMPT_HEAD = '아래 발화가, 주어진 기관·부서에도 해당할 수 있는지만 판단하라. "이미 다른 더 적합한 후보가 있을 수도 있다"는 점은 이 판단과 무관하다 — 오직 "여기에도 해당할 수 있는가"만 본다. 다른 텍스트 없이 JSON으로만 응답하라: {"fits": true} 또는 {"fits": false}.\n\n'

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
        # 이것. production과 동일하게 맞춘다.
        # 2026-09-18 재갱신(2000→4000→12000, 위 MAX_TOKENS 전역 주석 참고) —
        # production(pages/regional-gov.html의 _callGovClassifyModel)과
        # 항상 동기화 유지. --max-tokens로 진단 실행 시에만 다른 값을 준다.
        "max_tokens": MAX_TOKENS,
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


def run_classify(api_key, scenario):
    """pages/regional-gov.html의 _govClassifyFn을 그대로 재현(재구현 아님 —
    프롬프트 문구는 위에서 production 문자열을 그대로 추출해 복사, 판단
    순서·후처리 규칙도 그쪽 코드 그대로 따라감). 1차 호출(code+runnerUp)
    → runnerUp이 유효하면 2차 호출(예/아니오)까지 마친 뒤 최종 verdict를
    낸다. 반환: (verdict, note, chosen, usages: list)
    """
    candidate_codes = scenario["candidate_codes"]
    expected = scenario["expected_ambiguous_pair"]  # None이면 오탐 확인용 통제 시나리오
    candidates_text = "\n".join(
        f"{code}: {scenario['descriptions'][code]}" for code in candidate_codes
    )

    raw1, usage1, err1 = call_deepseek(
        api_key, CLASSIFY_PROMPT_HEAD + candidates_text, scenario["utterance"]
    )
    usages = [usage1]
    if err1 is not None:
        return "LIVE-ERROR", err1, None, usages

    cleaned = re.sub(r"```json|```", "", raw1 or "").strip()
    parsed = None
    try:
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        parsed = None

    if not isinstance(parsed, dict):
        # 하위호환 경로(_govClassifyFn과 동일) — 정상 경로에서는 거의 안 탈 것으로 예상.
        clarify_codes = parse_clarify_signal(cleaned)
        if clarify_codes:
            valid = [c for c in clarify_codes if c in candidate_codes]
            if len(valid) >= 2:
                verdict, note = _grade_clarify_pair(valid, expected, "구형식 CLARIFY")
                return verdict, note, None, usages
        return "LIVE-FAIL", f"JSON 파싱 실패(하위호환 경로도 실패) — raw: {cleaned[:200]}", None, usages

    code = parsed.get("code") if isinstance(parsed.get("code"), str) else None
    code = code.strip() if code else None
    if not code or code == "NONE":
        if expected is None and code == "NONE":
            return "LIVE-FAIL", "통제 시나리오인데 NONE 응답 — 명백한 정답을 회피", code, usages
        return "LIVE-FAIL", f"code 없음/NONE — raw: {cleaned[:200]}", code, usages
    if code not in candidate_codes:
        return "LIVE-FAIL", f"화이트리스트 밖 code: {code}", code, usages

    runner_up = parsed.get("runnerUp") if isinstance(parsed.get("runnerUp"), str) else None
    runner_up = runner_up.strip() if runner_up else None
    runner_up_valid = runner_up and runner_up != code and runner_up in candidate_codes

    if runner_up_valid:
        runner_up_line = f"{runner_up}: {scenario['descriptions'][runner_up]}"
        raw2, usage2, err2 = call_deepseek(
            api_key, CONFIRM_PROMPT_HEAD + runner_up_line, scenario["utterance"]
        )
        usages.append(usage2)
        if err2 is None:
            try:
                cleaned2 = re.sub(r"```json|```", "", raw2 or "").strip()
                parsed2 = json.loads(cleaned2)
                fits = parsed2.get("fits") if isinstance(parsed2, dict) else None
            except (json.JSONDecodeError, TypeError):
                fits = None
            if fits is True:
                verdict, note = _grade_clarify_pair([code, runner_up], expected, "runnerUp 확인 결과")
                return verdict, note, None, usages
        # 2차 호출 실패 또는 fits!=true → production과 동일하게 애매함
        # 아님으로 처리, 아래에서 code 그대로 채점.

    if expected is None:
        return "LIVE-PASS", f"통제 시나리오 — 확신 있게 단일 코드로 정상 답함: {code}", code, usages
    note = (
        f"단일 코드로 확신 있게 답함(하나를 골랐지만 기대 쌍 {expected} 중 하나): {code}"
        if code in expected
        else f"단일 코드로 확신 있게 답함(기대 쌍 밖): {code}"
    )
    return "LIVE-FAIL", note, code, usages


def _grade_clarify_pair(valid_pair, expected, prefix):
    if expected is None:
        return "LIVE-CLARIFY-FALSEPOSITIVE", f"통제 시나리오인데 {prefix} 발동 — 과잉 트리거: {valid_pair}"
    if set(valid_pair[:2]) == set(expected):
        return "LIVE-CLARIFY-CORRECT", f"{prefix} 애매함 확정, 기대한 쌍과 정확히 일치: {valid_pair} (기대: {expected})"
    return "LIVE-CLARIFY-OTHERPAIR", f"{prefix} 애매함 확정, 다른 쌍: {valid_pair} (기대: {expected})"


def process_one(api_key, scenario):
    verdict, note, chosen, usages = run_classify(api_key, scenario)
    return {
        "id": scenario["id"], "utterance": scenario["utterance"],
        "expected_ambiguous_pair": scenario["expected_ambiguous_pair"],
        "live_verdict": verdict, "live_note": note, "chosen": chosen, "usages": usages,
    }


def main():
    global MAX_TOKENS
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", required=True)
    ap.add_argument("--out", default="../../results/gov-clarify")
    ap.add_argument("--max-tokens", type=int, default=MAX_TOKENS,
                     help="진단용 — production 기본값(4000)보다 키워서 빈 응답이 "
                          "예산 부족 때문인지(늘리면 해결) 아니면 추론이 끝나지 "
                          "않는 다른 문제인지(늘려도 그대로 4000/N 소진) 구분한다.")
    args = ap.parse_args()
    MAX_TOKENS = args.max_tokens

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
