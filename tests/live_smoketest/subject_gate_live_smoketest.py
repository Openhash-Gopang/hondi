#!/usr/bin/env python3
"""
tests/live_smoketest/subject_gate_live_smoketest.py
--------------------------------------------------
subject-gate.js의 2단계 과목 게이트(refineToLeaf)를 실제 DeepSeek API로
라이브 검증한다.

## 무엇을 검증하는가
기존 live_smoketest.py/scenarios_expert_routing_precision는 1단계
(AC-PRO-CORE의 [EXPERT: professor] 같은 상위 태그)만 검증한다 — 이
하네스는 그 다음 단계, 즉 "professor로 라우팅된 뒤 실제로 어느 세부
리프(교수-국어/교수-수학 등)로 정밀화되는가"를 검증한다.

subject-gate.js의 refineToLeaf()와 동일한 system prompt(GATE_SYS_PROMPT_HEAD
+ dump_leaves.mjs로 뽑은 후보 메뉴)를 그대로 구성해서 호출하므로, 이
하네스가 PASS면 실제 프로덕션 코드도 같은 입력에 같은 결과를 낸다고
볼 수 있다(system prompt 텍스트·모델·temperature=0 전부 동일 소스).

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

2026-08-10 개정 — 대응하는 리프가 레지스트리에 아예 없는 "완전공백"
과목 시나리오는 expected_leaf_id를 null이 아니라 root_id 그대로
채운다(예: "professor"). "해당 없음" 항목의 id가 root_id와 같기
때문이다(subject-gate.js._buildGateCandidates 참고) — 이러면 별도
분기 없이 일반 채점 로직(chosen == expected)이 그대로 정답 판정을
해준다.

## 한계
- 후보 메뉴는 dump_leaves.mjs로 그때그때 최신 레지스트리에서 뽑으므로,
  expected_leaf_id가 리프 레지스트리에서 이름이 바뀌면 이 스크립트가
  아니라 시나리오 파일 쪽을 갱신해야 한다.
- 인접 과목(예: professor-electrical vs professor-electronics)은
  발화가 애매하면 모델이 둘 중 하나를 골라도 사람이 보기엔 둘 다
  말이 될 수 있다 — 그런 시나리오는 category에 "인접쌍"이라고 표시해
  결과 리뷰 시 더 관대하게 봐야 한다(자동判定은 여전히 엄격 일치).

Usage:
  DEEPSEEK_API_KEY=... python3 subject_gate_live_smoketest.py \\
      --scenarios scenarios_subject_gate_stage2_20260808.json \\
      --out ../../results/subject-gate \\
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
DUMP_LEAVES_SCRIPT = os.path.join(SCRIPT_DIR, "dump_leaves.mjs")

MAX_WORKERS = 5
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3

# subject-gate.js의 GATE_SYS_PROMPT_HEAD와 정확히 동일한 문구 — 이
# 하네스가 프로덕션과 다른 결과를 내지 않으려면 여기가 그 파일과
# 어긋나면 안 된다(수정 시 양쪽 다 갱신). 2026-08-10 개정 — "확신이
# 없으면 null" 지시(반례 4건 추가판 포함)가 실사 재검증에서 효과가
# 없었음을 확인해, "해당 없음"을 후보 목록의 정식 항목으로 넣는 구조로
# 전면 교체(subject-gate.js._buildGateCandidates 참고).
GATE_SYS_PROMPT_HEAD = (
    "사용자 발화를 아래 후보 목록 중 정확히 하나로 분류하세요. 후보 목록 "
    '맨 마지막 항목은 그 어떤 전공도 실제로 맞지 않을 때 고르는 "해당 '
    '없음" 항목입니다 — 발화 소재와 이름이 비슷하거나 어렴풋이 연상되는 '
    '전공이 있어도, 그 전공이 실제로 다루는 정규 교과·분야가 아니면 '
    '억지로 고르지 말고 이 "해당 없음" 항목을 고르십시오. 반드시 후보 '
    '목록의 id 값 중 하나만, 다른 텍스트 없이 JSON으로만 응답하세요: '
    '{"id": "<후보 id>"}.\n\n후보 목록:\n'
)


def get_leaf_candidates(roots):
    """dump_leaves.mjs를 서브프로세스로 호출해 root_id별 리프 목록을 얻는다."""
    # BUG-FIX(2026-09-14, Windows) — text=True만 쓰면 Windows에서는
    # locale.getpreferredencoding()(한국어 로캘이면 cp949)로 stdout을
    # 디코딩한다. dump_leaves.mjs는 한글 label을 UTF-8로 찍으므로 cp949
    # 디코딩 중 멀티바이트 시퀀스가 깨져 UnicodeDecodeError가 백그라운드
    # 리더 스레드에서 터지고, 그 결과 result.stdout이 None이 되어 아래
    # json.loads()가 "must be str, bytes or bytearray, not NoneType"로
    # 실패했다(Windows 실사용 재현 확인). encoding='utf-8'을 명시해
    # 리눅스/맥과 동일하게 강제한다.
    result = subprocess.run(
        ["node", DUMP_LEAVES_SCRIPT, *roots],
        capture_output=True, text=True, encoding="utf-8", check=True, cwd=SCRIPT_DIR,
    )
    return json.loads(result.stdout)


def build_gate_system_prompt(leaves):
    # 2026-08-09 수정 — dump_leaves.mjs가 이제 subject-gate.js._leafMenuLine()을
    # 그대로 호출해 만든 menuLine(LEAF_SYNONYMS 보강 포함)을 내려준다. 여기서
    # "- id: label"로 재조립하지 않고 그 필드를 그대로 쓴다 — 이 하네스가
    # production과 다른(더 빈약한) 메뉴로 채점하던 gap을 없앤다(K-12 어휘
    # 동의어가 없으면 교과목 발화 검증 자체가 왜곡됨).
    menu = "\n".join(l["menuLine"] for l in leaves)
    return GATE_SYS_PROMPT_HEAD + menu


def call_deepseek(api_key, system_prompt, user_utterance):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": MODEL,
        "temperature": 0,
        "max_tokens": 1500,  # 2026-08-09 재상향(500→1000) — 500으로도 여전히 실패한
        # professor-gap-01/17 실사 확인(reasoning_content 1700~1800자, finish_reason=length,
        # 500 전량 소진). 프로덕션 subject-gate.js도 이번에 60→1000으로 맞춰 패치함 —
        # 이 스크립트도 동일 값으로 맞춰 재검증.
        # 2026-08-10 재상향(1000→1500) — K-12 리프 신설로 후보 158→162개, 프롬프트가
        # 더 길어지며 reasoning_content_len 3700~3900대 재발(k12-sg-16/22 빈 응답).
        # subject-gate.js와 동일 값으로 재동기화.
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
                    # 2026-08-09 진단 로그 — content가 비어 있을 때 reasoning_content가
                    # 실제로 토큰을 다 먹었는지, finish_reason이 length인지 확인.
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


def grade(scenario, leaf_ids, raw_text, call_err):
    if call_err is not None:
        return "LIVE-ERROR", call_err
    try:
        cleaned = re.sub(r"```json|```", "", raw_text or "").strip()
        parsed = json.loads(cleaned)
        chosen = parsed.get("id")
    except (json.JSONDecodeError, AttributeError):
        return "LIVE-FAIL", f"JSON 파싱 실패 — raw: {(raw_text or '')[:200]}"

    expected = scenario["expected_leaf_id"]

    # 2026-08-10 개정 — "해당 없음"이 이제 후보 목록의 정식 항목(id는
    # personaId=root_id 그대로)이라, 완전공백 과목 시나리오는
    # expected_leaf_id를 root_id로 채워두면(예: "professor") 아래 일반
    # 분기(chosen == expected)가 그대로 정답 판정을 해준다 — null 전용
    # 특수 분기가 더 이상 필요 없다. chosen이 None으로 오는 경우는 이제
    # 정상 경로가 아니라 순수 방어적 안전망(파싱 실패 등)으로만 취급한다.
    if chosen is None:
        return "LIVE-FAIL", f"id:null 응답 (기대: {expected}) — '해당 없음' 항목이 후보에 있는데도 null을 냄, 이례적"
    if chosen not in leaf_ids:
        return "LIVE-FAIL", f"화이트리스트 밖 id를 지어냄: {chosen} (기대: {expected}) — subject-gate.js면 이 경우 원래 personaId로 폴백함"
    if chosen == expected:
        return "LIVE-PASS", f"정확히 일치: {chosen}"
    return "LIVE-FAIL", f"다른 리프로 정밀화됨: {chosen} (기대: {expected})"


def process_one(api_key, scenario, gate_prompt, leaf_ids):
    raw_text, usage, err = call_deepseek(api_key, gate_prompt, scenario["utterance"])
    verdict, note = grade(scenario, leaf_ids, raw_text, err)
    return {
        "id": scenario["id"],
        "root_id": scenario["root_id"],
        "utterance": scenario["utterance"],
        "expected_leaf_id": scenario["expected_leaf_id"],
        "category": scenario.get("category", ""),
        "raw_response": raw_text,
        "live_verdict": verdict,
        "live_note": note,
        "usage": usage,
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

    roots = sorted({s["root_id"] for s in scenarios})
    print(f"후보 메뉴 로드 중 (roots: {roots})...")
    candidates = get_leaf_candidates(roots)
    for r in roots:
        print(f"  {r}: {len(candidates[r])}개 리프")

    gate_prompts = {r: build_gate_system_prompt(candidates[r]) for r in roots}
    leaf_id_sets = {r: {l["id"] for l in candidates[r]} for r in roots}

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
    print(f"총 {len(scenarios)}개 시나리오, {len(todo)}개 실행 예정")

    results = []
    with open(out_path, "a", encoding="utf-8") as out_f:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {
                pool.submit(
                    process_one, api_key, s, gate_prompts[s["root_id"]], leaf_id_sets[s["root_id"]]
                ): s
                for s in todo
            }
            for i, fut in enumerate(as_completed(futures), 1):
                r = fut.result()
                results.append(r)
                out_f.write(json.dumps(r, ensure_ascii=False) + "\n")
                out_f.flush()
                print(f"[{i}/{len(todo)}] {r['id']:20s} {r['live_verdict']:12s} {r['live_note']}")

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

    fails = [r for r in all_results if r["live_verdict"] == "LIVE-FAIL"]
    if fails:
        print("\n=== FAIL 목록 ===")
        for r in fails:
            print(f"  - {r['id']} ({r['root_id']}): {r['live_note']}")

    if counts.get("LIVE-FAIL", 0) > 0 or counts.get("LIVE-ERROR", 0) > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
