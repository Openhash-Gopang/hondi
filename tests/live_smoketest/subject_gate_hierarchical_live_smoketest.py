#!/usr/bin/env python3
"""
tests/live_smoketest/subject_gate_hierarchical_live_smoketest.py
------------------------------------------------------------------
2026-08-10 subject-gate.js flat→계층형 리팩터 이후의 실사 검증 하네스.

## 왜 기존 subject_gate_live_smoketest.py를 그대로 못 쓰는가
기존 하네스는 root_id 하나에 대해 "전체 리프 후보를 한 방에 보여주고
정답 리프를 맞히는지"만 채점한다(dump_leaves.mjs로 뽑은 flat 후보
목록 전체를 한 프롬프트에 욱여넣음). 이건 2026-08-08~09 시점의 flat
게이트를 테스트하는 방식이고, 2026-08-10 리팩터로 production의
refineToLeaf()는 이제 여러 단계로 나눠서 게이트를 돈다(§CATALOG-EXPERT
루트 professor부터 시작해, 직계 자식이 2개 이상인 노드에서만 게이트
호출 1회씩) — 기존 하네스로 채점하면 production과 다른 입력(단일
254+ 후보 vs 단계별 4~29개 후보)으로 테스트하는 셈이라 결과를 신뢰할
수 없다.

## 이 하네스가 하는 일
시나리오마다 "이 발화가 최종적으로 어느 리프에 도달해야 하는가
(expected_leaf_id)"만 적어두면, dump_leaf_paths.mjs(재구현 아님 —
EXPERT_REGISTRY.parentKey 체인과 getConsultableChildren을 그대로
따라감)가 계산한 "실제 refineToLeaf가 거칠 게이트 단계 목록"을 그대로
따라가며, 각 단계에서 dump_gate_levels.mjs가 뽑은 그 단계의 실제 후보
메뉴(재구현 아님 — subject-gate.js._buildGateCandidates/_leafMenuLine
직접 호출)로 DeepSeek을 호출한다. 각 단계에서 모델이 정답(그 리프로
가는 올바른 다음 노드)을 골랐는지 채점하고, 시나리오 전체는 모든
단계를 통과해야 PASS다.

## 시나리오 파일 형식(기존보다 단순화 — root_id 불필요, 항상 professor
트리 기준)
[
  { "id": "t1-law-01", "utterance": "...", "expected_leaf_id": "professor-constitutionallaw",
    "category": "..." }
]

## 한계(§1-1과 동일한 철학 — 미리 밝혀둔다)
- 단계별 정답 경로를 "고정"해두고 각 단계를 독립적으로 채점한다 —
  1단계에서 모델이 틀린 노드를 골랐을 때 그 틀린 경로를 실제로
  따라 내려가며 2단계까지 테스트하지는 않는다(더 실전에 가까운
  "연쇄 재현" 방식은 추후 필요시 별도 모드로 추가 가능). 지금 이
  버전은 "어느 단계에서 정확히 틀리는가"를 정확히 짚어내는 데
  최적화돼 있다 — production 자체는 정답이 아닌 노드를 골라도 계속
  내려가므로(§refineToLeaf), 실제 최종 결과는 이 스크립트의 개별
  단계 결과보다 더 나쁠 수 있다는 점을 결과 리뷰 시 감안할 것.
- 게이트 호출이 아예 없는(직계 자식 1개 이하 통과) 리프는
  expected_leaf_id로 지정해도 라이브 호출 없이 자동 PASS 처리된다 —
  production도 그 경우 모델을 안 부르므로 이게 맞는 동작이다.

Usage:
  DEEPSEEK_API_KEY=... python3 subject_gate_hierarchical_live_smoketest.py \\
      --scenarios scenarios_hierarchical_gate_20260810.json \\
      --out ../../results/subject-gate-hierarchical \\
      --resume
  (--roots 생략 시 기존과 동일하게 professor 하나만 대상. 시나리오가
   여러 트리를 섞어 담고 있으면 --roots professor,physician,lawyer,
   patent-attorney,accountant 처럼 전부 나열해야 한다 — 2026-09-18 인자화.)
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
# 2026-09-18 인자화 — dump_leaf_paths.mjs/dump_gate_levels.mjs는 애초에
# 여러 root를 한 번에 받도록 만들어져 있었다(`process.argv.slice(2)`,
# for-of 루프) — 이 파이썬 래퍼만 professor 하나로 하드코딩돼 있었을 뿐,
# .mjs 쪽 변경은 필요 없었다. --roots로 콤마 구분 다중 root 지정 가능
# (기본값은 기존 동작과 동일하게 professor 하나만).
DEFAULT_ROOTS = ["professor"]

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DUMP_LEVELS_SCRIPT = os.path.join(SCRIPT_DIR, "dump_gate_levels.mjs")
DUMP_PATHS_SCRIPT = os.path.join(SCRIPT_DIR, "dump_leaf_paths.mjs")

MAX_WORKERS = 5
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3

# subject-gate.js의 GATE_SYS_PROMPT_HEAD와 정확히 동일한 문구 — 어긋나면
# 이 하네스가 production과 다른 걸 테스트하게 된다(양쪽 다 갱신 필요).
# 2026-09-18 갱신 — "ambiguous" 출력 형식 추가(§1-2-A/B, 주피터 지시: 오분류가
# 아니라 "애매한데 안 되묻는 것"이 문제라는 지적에 따른 신설). 하네스도 함께
# 갱신 안 하면 production은 이제 되묻는데 하네스는 여전히 옛 스키마로만
# 채점해 또 괴리가 생긴다 — 위 max_tokens 사례와 같은 실수를 반복하지 않는다.
# subject-gate.js의 GATE_SYS_PROMPT_HEAD와 정확히 동일한 문구 — 어긋나면
# 이 하네스가 production과 다른 걸 테스트하게 된다(양쪽 다 갱신 필요).
# 2026-09-18 갱신 — "ambiguous" 출력 형식 추가(§1-2-A/B). 2026-09-18 재갱신 —
# scenarios_ambiguity_feature_test_20260918.json 52건 실사에서 첫 버전 문구로는
# ambiguous가 0/22건 실제 사용되지 않아(AC-PRO-CORE 2026-08-01과 동일한 습관),
# 이름 붙인 트리거 조건으로 재작성한 production 버전을 그대로 복사.
# subject-gate.js의 GATE_SYS_PROMPT_HEAD/RUNNER_UP_CONFIRM_PROMPT_HEAD와
# 정확히 동일한 문구 — 어긋나면 이 하네스가 production과 다른 걸 테스트하게
# 된다(양쪽 다 갱신 필요). 2026-09-18 3차 재설계 — 자기선고형 ambiguous
# (1·2차 시도 모두 0/22건 사용)를 폐기하고, id+runnerUp 1차 호출 후
# runnerUp이 있을 때만 예/아니오 2차 호출로 확정하는 2단계 분리 방식으로
# 교체. 두 문구 모두 production 문자열을 그대로 추출해 복사.
GATE_SYS_PROMPT_HEAD = '사용자 발화를 아래 후보 목록 중 정확히 하나로 분류하세요. 후보 목록 맨 마지막 항목은 그 어떤 전공도 실제로 맞지 않을 때 고르는 "해당 없음" 항목입니다 — 발화 소재와 이름이 비슷하거나 어렴풋이 연상되는 전공이 있어도, 그 전공이 실제로 다루는 정규 교과·분야가 아니면 억지로 고르지 말고 이 "해당 없음" 항목을 고르십시오. 다른 텍스트 없이 JSON으로만 응답하세요: {"id": "<가장 확신 있는 후보 id>", "runnerUp": "<id 또는 null>"}. "id"는 지금까지처럼 가장 확신 있는 후보를 고르십시오 — 확신 있게 고르는 이 판단 자체는 조금도 망설이지 않습니다. "runnerUp"은 별개의 질문입니다: "id"로 고른 것 말고도, 이 발화만으로는 완전히 배제할 수 없는 다른 구체적인 후보가 하나 있다면 그 id를, 그런 후보가 전혀 없다면 null을 넣으세요 — "해당 없음" 항목은 runnerUp으로 넣지 않습니다. runnerUp은 나중에 별도로 한 번 더 확인하는 용도일 뿐이니, 있는지 없는지만 정직하게 보고하면 됩니다(runnerUp을 적는다고 "id" 판단이 흔들리는 게 아닙니다).\n\n후보 목록:\n'

RUNNER_UP_CONFIRM_PROMPT_HEAD = '아래 발화가, 주어진 전공에도 해당할 수 있는지만 판단하세요. "이미 다른 더 적합한 전공이 있을 수도 있다"는 점은 이 판단과 무관합니다 — 오직 "이 전공에도 해당할 수 있는가"만 봅니다. 다른 텍스트 없이 JSON으로만 응답하세요: {"fits": true} 또는 {"fits": false}.\n\n전공: '



def load_gate_levels(roots):
    """dump_gate_levels.mjs를 서브프로세스로 호출 — 노드별 실제 후보 메뉴.
    roots는 리스트 — 여러 트리(professor/physician/lawyer/patent-attorney/
    accountant 등)를 한 번에 넘기면 .mjs가 각각 BFS로 돌며 합쳐서 낸다."""
    result = subprocess.run(
        ["node", DUMP_LEVELS_SCRIPT, *roots],
        capture_output=True, text=True, check=True, cwd=SCRIPT_DIR,
    )
    data = json.loads(result.stdout)
    by_node = {}
    for level in data["gateLevels"]:
        candidate_ids = {c["id"] for c in level["candidates"]}
        # 2026-09-18 추가 — runnerUp 2차 확인 호출에 label이 필요(production의
        # _confirmRunnerUpFits가 EXPERT_REGISTRY[id].label을 그대로 씀).
        candidate_labels = {c["id"]: c["label"] for c in level["candidates"]}
        menu = "\n".join(c["menuLine"] for c in level["candidates"])
        by_node[level["nodeId"]] = {
            "menu": menu, "candidate_ids": candidate_ids, "candidate_labels": candidate_labels,
        }
    return by_node


def load_leaf_paths(roots):
    """dump_leaf_paths.mjs를 서브프로세스로 호출 — 리프별 게이트 스텝 목록."""
    result = subprocess.run(
        ["node", DUMP_PATHS_SCRIPT, *roots],
        capture_output=True, text=True, check=True, cwd=SCRIPT_DIR,
    )
    return json.loads(result.stdout)


def call_deepseek(api_key, system_prompt, user_utterance):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": MODEL,
        "temperature": 0,
        "max_tokens": 4000,  # subject-gate.js와 동일값 유지 — 2026-08-10 1000→1500,
        # 2026-09-14 production이 1500→4000으로 재상향(deepseek-v4-flash가
        # reasoning_content로 최대 3000토큰가량 먹어치워 최종 답 없이
        # finish_reason=length로 끝나는 사례 재현). 이 하네스는 그 재상향을
        # 반영 안 한 채 1500에 남아 있었고, 2026-09-18 5트리 범용화 실사
        # 395건 중 63건 실패의 절반이 넘는 35건이 바로 이 stale 값 때문에
        # raw가 빈 문자열로 온 JSON 파싱 실패였다 — production과 다른 값을
        # 쓰고 있었으니 그 35건은 이 하네스만의 가짜 실패였다. 4000으로
        # 맞춰 재검증.
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


def run_gate_step(api_key, gate_node_id, correct_choice_id, node, utterance):
    """subject-gate.js의 _gateOneLevel + _confirmRunnerUpFits를 그대로 재현
    (재구현 아님 — 프롬프트 문구는 위에서 production 문자열을 그대로 추출해
    복사, 판단 순서·화이트리스트 규칙도 그쪽 코드 그대로 따라감).
    1차 호출(id+runnerUp) → runnerUp이 유효하면 2차 호출(예/아니오)까지 마친
    뒤 최종 verdict를 낸다. 반환: (verdict, note, chosen, usages: list)
    """

    def call(system_prompt, user_utterance):
        return call_deepseek(api_key, system_prompt, user_utterance)

    menu = node["menu"]
    candidate_ids = node["candidate_ids"]
    candidate_labels = node["candidate_labels"]

    raw1, usage1, err1 = call(GATE_SYS_PROMPT_HEAD + menu, utterance)
    usages = [usage1]
    if err1 is not None:
        return "LIVE-ERROR", err1, None, usages
    try:
        cleaned = re.sub(r"```json|```", "", raw1 or "").strip()
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, AttributeError):
        return "LIVE-FAIL", f"1차 호출 JSON 파싱 실패 — raw: {(raw1 or '')[:200]}", None, usages

    chosen = parsed.get("id") if isinstance(parsed, dict) else None
    if chosen is None or chosen not in candidate_ids or chosen not in candidate_labels:
        return "LIVE-FAIL", f"화이트리스트 밖/누락 id: {chosen} (production이면 {gate_node_id}로 폴백)", chosen, usages

    # "해당없음"(chosen===gate_node_id) 선택 시 runnerUp을 아예 안 본다 —
    # production _gateOneLevel과 동일 규칙.
    runner_up = parsed.get("runnerUp") if isinstance(parsed, dict) else None
    runner_up_valid = (
        chosen != gate_node_id
        and runner_up and runner_up != chosen and runner_up != gate_node_id
        and runner_up in candidate_ids and runner_up in candidate_labels
    )

    if runner_up_valid:
        confirm_prompt = RUNNER_UP_CONFIRM_PROMPT_HEAD + candidate_labels[runner_up]
        raw2, usage2, err2 = call(confirm_prompt, utterance)
        usages.append(usage2)
        if err2 is None:
            try:
                cleaned2 = re.sub(r"```json|```", "", raw2 or "").strip()
                parsed2 = json.loads(cleaned2)
                fits = parsed2.get("fits") if isinstance(parsed2, dict) else None
            except (json.JSONDecodeError, AttributeError):
                fits = None
            if fits is True:
                valid_pair = [chosen, runner_up]
                if correct_choice_id in valid_pair:
                    return (
                        "LIVE-AMBIGUOUS-CORRECT",
                        f"runnerUp 확인 결과 애매함 확정, 정답 포함: {valid_pair} (기대: {correct_choice_id})",
                        None, usages,
                    )
                return (
                    "LIVE-AMBIGUOUS-WRONG",
                    f"runnerUp 확인 결과 애매함 확정, 정답 미포함: {valid_pair} (기대: {correct_choice_id})",
                    None, usages,
                )
        # 2차 호출 실패 또는 fits!=true → production과 동일하게 애매함
        # 아님으로 처리, 아래에서 chosen 그대로 채점.

    if chosen == correct_choice_id:
        return "LIVE-PASS", f"정확히 일치: {chosen}", chosen, usages
    return "LIVE-FAIL", f"다른 노드로 정밀화됨: {chosen} (기대: {correct_choice_id})", chosen, usages


def process_one(api_key, scenario, gate_levels, leaf_paths):

    expected_leaf = scenario["expected_leaf_id"]
    steps = leaf_paths.get(expected_leaf)
    if steps is None:
        return {
            "id": scenario["id"], "utterance": scenario["utterance"],
            "expected_leaf_id": expected_leaf, "category": scenario.get("category", ""),
            "live_verdict": "SETUP-ERROR",
            "live_note": f"expected_leaf_id가 레지스트리에 없음(오타 또는 리프 삭제됨): {expected_leaf}",
            "step_results": [],
        }
    if len(steps) == 0:
        # 게이트 호출이 아예 없는 리프 — production도 모델을 안 부르므로 자동 PASS.
        return {
            "id": scenario["id"], "utterance": scenario["utterance"],
            "expected_leaf_id": expected_leaf, "category": scenario.get("category", ""),
            "live_verdict": "PASS-NO-GATE",
            "live_note": "직계 자식 1개 이하 통과 구간만 거침 — 게이트 호출 자체가 없음(정상)",
            "step_results": [],
        }

    step_results = []
    overall = "LIVE-PASS"
    for step in steps:
        node = gate_levels.get(step["gateNodeId"])
        if node is None:
            step_results.append({
                "gateNodeId": step["gateNodeId"], "correctChoiceId": step["correctChoiceId"],
                "verdict": "SETUP-ERROR", "note": "dump_gate_levels.mjs 출력에 이 노드가 없음",
            })
            overall = "SETUP-ERROR"
            break
        verdict, note, chosen, usages = run_gate_step(
            api_key, step["gateNodeId"], step["correctChoiceId"], node, scenario["utterance"]
        )
        step_results.append({
            "gateNodeId": step["gateNodeId"], "correctChoiceId": step["correctChoiceId"],
            "chosenId": chosen, "verdict": verdict, "note": note, "usages": usages,
        })
        if verdict != "LIVE-PASS":
            overall = verdict
            break  # 이 단계에서 이미 어긋났으니 뒤 단계는 의미 없음(§한계 참고)

    return {
        "id": scenario["id"], "utterance": scenario["utterance"],
        "expected_leaf_id": expected_leaf, "category": scenario.get("category", ""),
        "live_verdict": overall, "step_results": step_results,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="scenarios_hierarchical_gate_20260810.json")
    ap.add_argument("--out", default="../../results/subject-gate-hierarchical")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument(
        "--roots", default=",".join(DEFAULT_ROOTS),
        help="콤마 구분 root id 목록 (예: professor,physician,lawyer,patent-attorney,accountant). "
             "시나리오 파일이 여러 트리를 섞어 담고 있으면 전부 나열해야 expected_leaf_id를 찾는다.",
    )
    args = ap.parse_args()
    roots = [r.strip() for r in args.roots.split(",") if r.strip()]

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)

    with open(args.scenarios, encoding="utf-8") as f:
        scenarios = json.load(f)
    if args.limit:
        scenarios = scenarios[: args.limit]

    print(f"게이트 레벨/리프 경로 로드 중... (roots: {', '.join(roots)})")
    gate_levels = load_gate_levels(roots)
    leaf_paths = load_leaf_paths(roots)
    print(f"  게이트 호출 지점 {len(gate_levels)}개, 리프 {len(leaf_paths)}개")

    os.makedirs(args.out, exist_ok=True)
    results_path = os.path.join(args.out, "live_results.json")

    done_ids = set()
    results = []
    if args.resume and os.path.exists(results_path):
        with open(results_path, encoding="utf-8") as f:
            results = json.load(f)
        done_ids = {r["id"] for r in results if r.get("live_verdict") not in ("LIVE-ERROR",)}
        print(f"  --resume: 기존 결과 {len(done_ids)}건 재사용")

    todo = [s for s in scenarios if s["id"] not in done_ids]
    print(f"  실행 대상: {len(todo)}건 (전체 {len(scenarios)}건 중)")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(process_one, api_key, s, gate_levels, leaf_paths): s for s in todo}
        for i, fut in enumerate(as_completed(futures), 1):
            r = fut.result()
            results.append(r)
            print(f"  [{i}/{len(todo)}] {r['id']}: {r['live_verdict']}")
            if i % 10 == 0:
                with open(results_path, "w", encoding="utf-8") as f:
                    json.dump(results, f, ensure_ascii=False, indent=2)

    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    verdict_counts = {}
    for r in results:
        verdict_counts[r["live_verdict"]] = verdict_counts.get(r["live_verdict"], 0) + 1
    print("\n=== 요약 ===")
    for v, c in sorted(verdict_counts.items()):
        print(f"  {v}: {c}")

    fails = [r for r in results if r["live_verdict"] not in ("LIVE-PASS", "PASS-NO-GATE")]
    if fails:
        print(f"\n실패 {len(fails)}건:")
        for r in fails:
            print(f"  - {r['id']} (기대: {r['expected_leaf_id']}): {r['live_verdict']}")


if __name__ == "__main__":
    main()
