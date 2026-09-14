#!/usr/bin/env python3
"""
tests/live_smoketest/subject_gate_live_smoketest.py
--------------------------------------------------
subject-gate.js의 2단계 과목 게이트(refineToLeaf)를 실제 DeepSeek API로
라이브 검증한다.

## 2026-09-14 전면 재작성 — flat → 계층형 재동기화
이전 버전(2026-08-08~08-10)은 dump_leaves.mjs로 root_id(professor 등)
아래 전체 리프(158~308개)를 한 번에 flat하게 뽑아 프롬프트 하나에
욱여넣었다. 그런데 subject-gate.js는 2026-08-10에 이미 flat→계층형으로
리팩터돼(주석 "2026-08-10 리팩터(flat → 계층형)" 참고), 실제 refineToLeaf()는
EXPERT_REGISTRY의 parentKey 트리를 한 단계씩(직계 자식만, 대부분 4~14개)
내려가며 여러 번 작은 게이트 호출을 한다 — dump_leaves.mjs만 이 리팩터를
놓치고 옛 방식 그대로 남아 있었다(2026-09-14, professor-06-hard-adjacent가
308개 후보 프롬프트에서 reasoning_tokens 1500을 전부 소진하고 빈 응답을
낸 걸 계기로 발견 — 실제 production이라면 이 케이스는 각 단계 최대
30개 미만 후보라 애초에 이 문제가 생기지 않는다).

이번 재작성은 dump_leaves.mjs 대신 get_gate_level.mjs(2026-09-14 신설,
한 id의 직계 자식만 돌려줌)를 매 단계 서브프로세스로 호출해서, Python
쪽 refine_to_leaf()가 subject-gate.js의 refineToLeaf() for 루프를
정확히 그대로 재현한다(재구현이 아니라 production 함수 get_gate_level.mjs
가 그대로 통과시키는 EXPERT_REGISTRY/subject-gate.js의 실제 함수 호출
결과를 그대로 조립) — 시나리오 하나당 API 호출이 1회가 아니라 트리
깊이만큼(현재 최대 4단계) 될 수 있다.

## 시나리오 파일 형식
[
  {
    "id": "professor-01",
    "root_id": "professor",
    "utterance": "국어 문법을 좀 더 깊이 배우고 싶어요",
    "expected_leaf_id": "professor-korean",
    "category": "정상경로(단일 과목 명시)"
  },
  ...
]

완전공백 과목 시나리오는 expected_leaf_id를 root_id 그대로 채운다
(예: "professor") — "해당 없음" 항목의 id가 root_id와 같기 때문이다
(subject-gate.js._buildGateCandidates 참고).

## 한계
- 인접 과목(예: professor-electrical vs professor-electronics)은
  발화가 애매하면 모델이 둘 중 하나를 골라도 사람이 보기엔 둘 다
  말이 될 수 있다 — category에 "인접쌍"이라고 표시된 건 결과 리뷰 시
  더 관대하게 봐야 한다(자동判定은 여전히 엄격 일치).
- 트리 각 단계마다 순차 API 호출이라 시나리오당 지연이 이전 버전보다
  길다(단, 토큰 소진으로 인한 빈 응답은 구조적으로 사라진다).

Usage:
  DEEPSEEK_API_KEY=... python3 subject_gate_live_smoketest.py \
      --scenarios scenarios_subject_gate_stage2_20260808.json \
      --out ../../results/subject-gate \
      --resume
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-v4-flash"  # subject-gate.js와 동일 모델

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GET_GATE_LEVEL_SCRIPT = os.path.join(SCRIPT_DIR, "get_gate_level.mjs")

MAX_WORKERS = 5
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3
MAX_DEPTH = 6  # subject-gate.js refineToLeaf()의 MAX_DEPTH와 동일

# subject-gate.js의 GATE_SYS_PROMPT_HEAD와 정확히 동일한 문구.
GATE_SYS_PROMPT_HEAD = (
    "사용자 발화를 아래 후보 목록 중 정확히 하나로 분류하세요. 후보 목록 "
    '맨 마지막 항목은 그 어떤 전공도 실제로 맞지 않을 때 고르는 "해당 '
    '없음" 항목입니다 — 발화 소재와 이름이 비슷하거나 어렴풋이 연상되는 '
    '전공이 있어도, 그 전공이 실제로 다루는 정규 교과·분야가 아니면 '
    '억지로 고르지 말고 이 "해당 없음" 항목을 고르십시오. 반드시 후보 '
    '목록의 id 값 중 하나만, 다른 텍스트 없이 JSON으로만 응답하세요: '
    '{"id": "<후보 id>"}.\n\n후보 목록:\n'
)


def get_gate_level(node_id):
    """get_gate_level.mjs를 서브프로세스로 호출해 node_id의 상태를 얻는다.
    반환: {"kind": "leaf"} | {"kind": "passthrough", "childId": ...} |
          {"kind": "gate", "candidates": [...]}
    """
    result = subprocess.run(
        ["node", GET_GATE_LEVEL_SCRIPT, node_id],
        capture_output=True, text=True, encoding="utf-8", check=True, cwd=SCRIPT_DIR,
    )
    return json.loads(result.stdout)


def call_deepseek(api_key, system_prompt, user_utterance):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": MODEL,
        "temperature": 0,
        "max_tokens": 1500,  # subject-gate.js와 동일 값(계층형 전환 후에도
        # 단계당 후보가 최악 케이스 30개 미만이라 1500이면 충분한 여유 —
        # 예전 flat 308개 시절과 달리 이제 이 값을 낮출 여지도 있지만,
        # subject-gate.js가 아직 1500이므로 그대로 맞춘다.
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
                return text, None
            last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
        except requests.RequestException as e:
            last_err = f"request_exception: {e}"
        if attempt < MAX_RETRIES:
            time.sleep(RETRY_BASE_SLEEP * attempt)
    return None, last_err


def refine_to_leaf(api_key, persona_id, user_text, trace):
    """subject-gate.js의 refineToLeaf() for 루프를 그대로 재현한다.
    trace 리스트에 단계별 기록을 남겨(레벨의 kind, 호출 여부, 선택 결과)
    실패 시 어느 단계에서 무슨 일이 있었는지 사람이 바로 볼 수 있게 한다.
    """
    current_id = persona_id
    for _depth in range(MAX_DEPTH):
        try:
            level = get_gate_level(current_id)
        except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
            trace.append({"step": current_id, "error": f"get_gate_level 실패: {e}"})
            return current_id, "LEVEL-ERROR"

        if level["kind"] == "leaf":
            trace.append({"step": current_id, "kind": "leaf"})
            return current_id, None

        if level["kind"] == "passthrough":
            trace.append({"step": current_id, "kind": "passthrough", "to": level["childId"]})
            current_id = level["childId"]
            continue

        # kind == "gate" — 실제 API 호출 1회
        menu = "\n".join(c["menuLine"] for c in level["candidates"])
        system_prompt = GATE_SYS_PROMPT_HEAD + menu
        candidate_ids = {c["id"] for c in level["candidates"]}

        raw_text, err = call_deepseek(api_key, system_prompt, user_text)
        if err is not None:
            trace.append({"step": current_id, "kind": "gate", "error": err})
            return current_id, "CALL-ERROR"

        try:
            cleaned = re.sub(r"```json|```", "", raw_text or "").strip()
            chosen = json.loads(cleaned).get("id")
        except (json.JSONDecodeError, AttributeError):
            trace.append({"step": current_id, "kind": "gate", "raw": (raw_text or "")[:200], "error": "parse"})
            return current_id, "PARSE-ERROR"

        if chosen is None or chosen not in candidate_ids:
            trace.append({"step": current_id, "kind": "gate", "chosen": chosen, "error": "invalid-id"})
            return current_id, "INVALID-ID"

        trace.append({"step": current_id, "kind": "gate", "chosen": chosen})
        if chosen == current_id:
            return current_id, None  # "해당 없음" — 더 안 내려감
        current_id = chosen

    trace.append({"step": current_id, "error": "MAX_DEPTH 초과"})
    return current_id, "MAX-DEPTH"


def grade(scenario, resolved_id, walk_err):
    expected = scenario["expected_leaf_id"]
    if walk_err is not None:
        return ("LIVE-ERROR" if walk_err in ("CALL-ERROR", "LEVEL-ERROR") else "LIVE-FAIL"), \
            f"{walk_err} (도달: {resolved_id}, 기대: {expected})"
    if resolved_id == expected:
        return "LIVE-PASS", f"정확히 일치: {resolved_id}"
    return "LIVE-FAIL", f"다른 리프로 정밀화됨: {resolved_id} (기대: {expected})"


def process_one(api_key, scenario):
    trace = []
    resolved_id, walk_err = refine_to_leaf(api_key, scenario["root_id"], scenario["utterance"], trace)
    verdict, note = grade(scenario, resolved_id, walk_err)
    return {
        "id": scenario["id"],
        "root_id": scenario["root_id"],
        "utterance": scenario["utterance"],
        "expected_leaf_id": scenario["expected_leaf_id"],
        "category": scenario.get("category", ""),
        "resolved_id": resolved_id,
        "trace": trace,
        "live_verdict": verdict,
        "live_note": note,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="scenarios_subject_gate_stage2_20260808.json")
    ap.add_argument("--out", default="../../results/subject-gate")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)

    with open(args.scenarios, encoding="utf-8") as f:
        scenarios = json.load(f)
    if args.limit:
        scenarios = scenarios[: args.limit]

    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, "live_results.jsonl")

    done_ids = set()
    if args.resume and os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    done_ids.add(json.loads(line)["id"])
                except (json.JSONDecodeError, KeyError):
                    continue
        print(f"[resume] {len(done_ids)}개 이미 완료됨 — 건너뜀")

    todo = [s for s in scenarios if s["id"] not in done_ids]
    print(f"총 {len(scenarios)}개 시나리오, {len(todo)}개 실행 예정 (트리 단계별 순차 호출)")

    results = []
    with open(out_path, "a", encoding="utf-8") as out_f:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {pool.submit(process_one, api_key, s): s for s in todo}
            for i, fut in enumerate(as_completed(futures), 1):
                r = fut.result()
                results.append(r)
                out_f.write(json.dumps(r, ensure_ascii=False) + "\n")
                out_f.flush()
                print(f"[{i}/{len(todo)}] {r['id']:28s} {r['live_verdict']:12s} {r['live_note']}")

    all_results = results
    if args.resume and os.path.exists(out_path):
        all_results = []
        with open(out_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    all_results.append(json.loads(line))

    counts = {}
    for r in all_results:
        counts[r["live_verdict"]] = counts.get(r["live_verdict"], 0) + 1

    print("\n=== 요약 ===")
    for status in ("LIVE-PASS", "LIVE-FAIL", "LIVE-ERROR"):
        if status in counts:
            print(f"  {status:12s} {counts[status]}")

    fails = [r for r in all_results if r["live_verdict"] in ("LIVE-FAIL", "LIVE-ERROR")]
    if fails:
        print("\n=== FAIL/ERROR 목록 ===")
        for r in fails:
            print(f"  - {r['id']} ({r['root_id']}): {r['live_note']}")

    if counts.get("LIVE-FAIL", 0) > 0 or counts.get("LIVE-ERROR", 0) > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
