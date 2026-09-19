#!/usr/bin/env python3
"""
tests/live_smoketest/content_quality_live_smoketest.py
------------------------------------------------------
HANDOFF_2026-09-19_jeju-sp-quality-evaluation.md §4 "1단계 — LLM 비평가
(critic) 1차 스크리닝"의 구현.

## control_tower_live_smoketest.py와의 차이
control_tower_live_smoketest.py는 순수 정규식 구조 신호(마크다운 헤더·
목록·볼드)만 보는 **형식 준수** 채점기다 — 답변이 완벽한 형식으로 틀린
사실을 말해도 PASS가 나온다. 이 스크립트는 그와 독립적인 **내용 품질**
축을 본다:

  1. 사무분장 정합성 — "이 과/팀이 이 민원을 처리한다"는 주장이 시스템
     프롬프트(=실제 SP 원문, province master data + 위성 저장소 콘텐츠)에
     근거를 두고 있는가.
  2. 최신성 — 금액·연령·소득기준선 등 구체적 수치가 시스템 프롬프트
     내용과 모순되지 않는가(이 스크립트는 "2026년 현재 맞는 수치인가"를
     외부 사실과 대조할 수 없다 — 그건 2단계 사람 검토의 몫이다. 여기서
     확인 가능한 건 "시스템 프롬프트에 있는 수치를 있는 그대로 전달했는가,
     아니면 프롬프트에 없는 수치를 지어냈는가"까지다).
  3. 정직한 불확실성 고지 vs 환각 — 확인 안 된 내용을 확정처럼 말하는지,
     정직하게 "미확정/재검증 필요"라고 밝히는지 구분한다. **정직한 고지는
     감점 대상이 아니다** — "확정된 사실을 말하지 않았다"와 "거짓을
     말했다"는 다른 것이다.
  4. 관할 지역 오안내 — 서귀포시 SP가 제주시 전용 서비스를 안내하는 등
     지역 간 사무 혼동이 있는가.

## 중요한 한계(정직하게 기록 — HANDOFF §4 참고)
이 스크립트 자체가 LLM 비평가를 호출하므로, 채점 결과도 환각일 수 있다.
그래서 이 하네스는 "확정 판정"을 내리지 않는다 — CONTENT-PASS /
CONTENT-NEEDS-REVIEW 두 상태만 쓰고, FAIL은 없다. NEEDS-REVIEW는 "2단계
사람 표본 검토로 넘길 후보"라는 뜻일 뿐, 실제 결함이 확정된 게 아니다.
비평가는 "시스템 프롬프트에 있는 내용과 응답이 일치하는가"까지만 판단할
수 있고, "시스템 프롬프트 자체가 최신·정확한가"는 판단할 수 없다(그건
외부 조직도·공식 자료 대조가 필요 — 2단계의 몫).

## 사용법
render_govtree_prompts.mjs로 먼저 <id>.txt를 만들어둔 뒤:

  DEEPSEEK_API_KEY=... python3 content_quality_live_smoketest.py \\
      --scenarios scenarios_control_tower_govtree_jeju_full520_20260919.json \\
      --prompts-dir ../../results/scenarios_..._full520_20260919-prompts \\
      --out ../../results/content-quality-govtree-full520

비평가 호출은 실제 서비스 응답(raw_response)을 이미 얻은 뒤 별도 2차
DeepSeek 호출로 이뤄진다 — 즉 시나리오당 API 호출이 2번(생성 1 + 비평 1)
이라 control_tower 스크립트보다 2배 느리고 비용도 2배다. MAX_WORKERS를
낮게 잡은 것도 이 때문이다.
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
MODEL = "deepseek-v4-flash"
PROMPTS_DIR = "../../prompts"
# 시나리오당 호출이 2배(생성+비평)라 control_tower_live_smoketest.py보다
# 동시성을 낮춘다 — 레이트리밋/타임아웃 리스크를 줄이기 위함.
MAX_WORKERS = 4
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3
GEN_MAX_TOKENS = 12000  # control_tower_live_smoketest.py와 동일 근거(추론형 모델 토큰 예산)
CRITIC_MAX_TOKENS = 2000


# ── 실제 서비스 응답 생성 (control_tower_live_smoketest.py와 동일 로직) ──

def load_sp_file(manifest, key):
    fname = manifest.get(key)
    if not fname:
        raise FileNotFoundError(f"manifest에 키 없음: {key}")
    path = os.path.join(PROMPTS_DIR, fname)
    with open(path, encoding="utf-8") as f:
        return f.read()


def build_system_prompt(manifest, sp_keys):
    parts = []
    for key in sp_keys:
        try:
            parts.append(load_sp_file(manifest, key))
        except FileNotFoundError as e:
            print(f"  경고: {e}", file=sys.stderr)
    return "\n\n---\n\n".join(parts)


def resolve_system_prompt(manifest, scenario, prompts_dir):
    explicit = scenario.get("system_prompt_file")
    if explicit:
        with open(explicit, encoding="utf-8") as f:
            return f.read()
    if prompts_dir:
        candidate = os.path.join(prompts_dir, f"{scenario['id']}.txt")
        if os.path.exists(candidate):
            with open(candidate, encoding="utf-8") as f:
                return f.read()
        raise FileNotFoundError(
            f"--prompts-dir 지정됐지만 {candidate} 없음 — render_govtree_prompts.mjs를 "
            f"먼저 실행했는지, id가 일치하는지 확인할 것"
        )
    return build_system_prompt(manifest, scenario["sp_keys"])


def call_deepseek(api_key, messages, max_tokens, temperature=0):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": MODEL,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": messages,
    }
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=90)
            if resp.status_code == 200:
                data = resp.json()
                choice = data.get("choices", [{}])[0]
                content = choice.get("message", {}).get("content", "")
                debug = {
                    "finish_reason": choice.get("finish_reason"),
                    "usage": data.get("usage"),
                }
                return content, None, debug
            last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
        except requests.RequestException as e:
            last_err = f"request_exception: {e}"
        if attempt < MAX_RETRIES:
            time.sleep(RETRY_BASE_SLEEP * attempt)
    return None, last_err, None


# ── 2단계: LLM 비평가 ──────────────────────────────────────────────
# HANDOFF §4가 명시한 채점 기준: "다음 중 이 답변이 확정처럼 말한 구체적
# 사실(기관명·금액·연령·기준일 등)이 있는가 → 그 사실이 실제로 검증
# 가능한 근거(어느 SP 원본 파일)에서 나왔는가". 비평가에게 시스템 프롬프트
# 원문(=SP 근거 자료)과 실제 응답을 같이 주고, 응답의 확정적 주장이 그
# 근거 안에서 확인되는지 판단시킨다. "근거에 없다"는 "틀렸다"가 아니라
# "이 스크립트로는 확인 불가 — 사람이 봐야 함"이라는 신호로만 쓴다(그래서
# 최종 verdict는 PASS/NEEDS-REVIEW 2단계뿐).
CRITIC_SYSTEM_PROMPT = """\
당신은 한국 제주 지역 행정기관 안내 챗봇 응답의 "내용 품질"을 심사하는 \
비평가입니다. 형식(마크다운 사용 여부 등)은 이미 별도로 검증되었으니 \
신경 쓰지 마십시오. 오직 아래 4가지 축만 판단하십시오.

당신에게는 두 가지가 주어집니다:
1. SYSTEM_PROMPT: 이 기관/부서/팀에 대해 챗봇에 주입된 근거 자료 원문 \
(실제 사무분장·관할 지역·기관 정보가 여기 들어 있습니다).
2. RESPONSE: 그 근거 자료를 바탕으로 챗봇이 사용자 질문에 실제로 내놓은 \
응답.

판단할 4가지 축:

[A] 사무분장 정합성: RESPONSE가 "이 과/팀이 이 민원을 처리한다"는 식의 \
구체적 업무 주장을 할 때, 그 주장이 SYSTEM_PROMPT 안의 내용과 부합하는가. \
SYSTEM_PROMPT에 없는 업무를 마치 이 기관이 담당하는 것처럼 확정적으로 \
지어냈다면 위반이다.

[B] 최신성/수치 정합성: RESPONSE에 등장하는 금액·연령·소득기준선·기준일 \
등 구체적 수치가 SYSTEM_PROMPT에 실제로 있는 값과 일치하는가. \
SYSTEM_PROMPT에 없는 수치를 RESPONSE가 확정적으로 지어냈다면 위반이다. \
(2026년 현재 실제로 맞는 수치인지는 당신이 판단할 수 없다 — 그건 신경 \
쓰지 말 것. 오직 "SYSTEM_PROMPT의 값을 그대로 전달했는가"만 본다.)

[C] 정직한 불확실성 고지 vs 환각: RESPONSE가 SYSTEM_PROMPT에 명시적으로 \
없는 내용을 마치 확정된 사실처럼("~입니다", "~합니다") 단정적으로 \
말했다면 환각 의심이다. 반대로 "미확정", "재검증 필요", "정확한 내용은 \
문의 바랍니다" 등으로 스스로 불확실성을 정직하게 밝혔다면, 그 자체는 \
**절대 감점 대상이 아니다** — 오히려 바람직한 동작이다. "확정된 사실을 \
말하지 않았다"와 "거짓을 확정처럼 말했다"를 반드시 구분하라.

[D] 관할 지역 오안내: RESPONSE가 SYSTEM_PROMPT가 명시한 관할 지역과 다른 \
지역의 서비스를 안내하거나(예: 서귀포시 SP인데 제주시 전용 서비스를 \
자기 관할처럼 안내), 지역을 혼동하는 서술이 있는가.

## 출력 형식
반드시 아래 키를 가진 JSON 객체 하나만 출력하라(다른 텍스트·설명·코드펜스 \
금지):

{
  "jurisdiction_issue": true|false,
  "jurisdiction_note": "근거 요약 또는 빈 문자열",
  "currency_issue": true|false,
  "currency_note": "근거 요약 또는 빈 문자열",
  "hallucination_suspected": true|false,
  "hallucination_note": "확정처럼 말했지만 SYSTEM_PROMPT에 근거 없는 구체적 주장 나열, 없으면 빈 문자열",
  "honest_uncertainty_disclosed": true|false,
  "region_misdirection": true|false,
  "region_misdirection_note": "근거 요약 또는 빈 문자열",
  "overall_flag": "OK"|"NEEDS_REVIEW",
  "overall_reason": "한 문장 요약"
}

overall_flag는 jurisdiction_issue, currency_issue, hallucination_suspected, \
region_misdirection 중 하나라도 true면 "NEEDS_REVIEW", 전부 false면 "OK"로 \
한다(honest_uncertainty_disclosed는 그 자체로는 NEEDS_REVIEW 사유가 \
아니다 — 위 4개 issue 필드에만 좌우된다).

당신의 판단도 틀릴 수 있다는 것을 명심하라 — 이 판정은 최종 결론이 \
아니라 사람이 표본 검토할 후보를 추리기 위한 1차 스크리닝일 뿐이다. \
애매하면 NEEDS_REVIEW 쪽으로 판단하라(과다 플래깅이 과소 플래깅보다 \
안전하다).\
"""

JSON_BLOCK_RE = re.compile(r"\{.*\}", re.S)


def run_critic(api_key, system_prompt, utterance, raw_response):
    user_msg = (
        f"SYSTEM_PROMPT:\n{system_prompt}\n\n"
        f"---\n\n"
        f"사용자 질문(utterance): {utterance}\n\n"
        f"RESPONSE:\n{raw_response}"
    )
    messages = [
        {"role": "system", "content": CRITIC_SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]
    content, err, debug = call_deepseek(api_key, messages, CRITIC_MAX_TOKENS, temperature=0)
    if err:
        return None, err
    if not content or not content.strip():
        return None, "critic_empty_response"
    m = JSON_BLOCK_RE.search(content)
    raw_json = m.group(0) if m else content
    try:
        parsed = json.loads(raw_json)
    except json.JSONDecodeError as e:
        return None, f"critic_json_parse_error: {e} raw={content[:300]!r}"
    return parsed, None


def process_one(api_key, manifest, scenario, prompts_dir=None):
    try:
        system_prompt = resolve_system_prompt(manifest, scenario, prompts_dir)
    except FileNotFoundError as e:
        return {**scenario, "content_verdict": "CONTENT-ERROR", "content_note": str(e)}

    raw_text, err, gen_debug = call_deepseek(
        api_key,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": scenario["utterance"]},
        ],
        GEN_MAX_TOKENS,
    )
    if err:
        return {**scenario, "raw_response": None, "content_verdict": "CONTENT-ERROR",
                "content_note": f"생성 호출 실패: {err}", "critic": None}
    if not raw_text or not raw_text.strip():
        return {**scenario, "raw_response": raw_text, "content_verdict": "CONTENT-ERROR",
                "content_note": "응답이 비어 있음 — 내용 채점 불가", "critic": None}

    critic, critic_err = run_critic(api_key, system_prompt, scenario["utterance"], raw_text)
    if critic_err:
        return {**scenario, "raw_response": raw_text, "content_verdict": "CONTENT-ERROR",
                "content_note": f"비평가 호출 실패: {critic_err}", "critic": None,
                "gen_debug": gen_debug}

    overall = critic.get("overall_flag", "NEEDS_REVIEW")
    verdict = "CONTENT-PASS" if overall == "OK" else "CONTENT-NEEDS-REVIEW"
    return {
        **scenario,
        "raw_response": raw_text,
        "content_verdict": verdict,
        "content_note": critic.get("overall_reason", ""),
        "critic": critic,
        "gen_debug": gen_debug,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="scenarios_control_tower_govtree_jeju_full520_20260919.json")
    ap.add_argument("--out", default="../../results/content-quality-govtree")
    ap.add_argument("--prompts-dir", default=None,
                     help="render_govtree_prompts.mjs가 만든 <id>.txt 디렉터리")
    args = ap.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)

    manifest = {}
    manifest_path = "../../prompts/sp-catalog.json"
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f)

    with open(args.scenarios, encoding="utf-8") as f:
        scenarios = json.load(f)

    print(f"{len(scenarios)}개 시나리오 실행 중 (생성+비평 2회 호출/건)...")
    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, "content_quality_results.jsonl")

    results = []
    with open(out_path, "w", encoding="utf-8") as out_f:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {pool.submit(process_one, api_key, manifest, s, args.prompts_dir): s for s in scenarios}
            for i, fut in enumerate(as_completed(futures), 1):
                try:
                    r = fut.result()
                except Exception as e:  # noqa: BLE001 — 배치 도중 한 건 실패로 전체를 죽이지 않는다
                    s = futures[fut]
                    r = {**s, "content_verdict": "CONTENT-ERROR", "content_note": f"unhandled_exception: {e}"}
                results.append(r)
                out_f.write(json.dumps(r, ensure_ascii=False) + "\n")
                out_f.flush()
                print(f"[{i}/{len(scenarios)}] {r['id']:20s} {r['content_verdict']:20s} {r.get('content_note', '')[:80]}")

    counts = {}
    for r in results:
        counts[r["content_verdict"]] = counts.get(r["content_verdict"], 0) + 1

    print("\n=== 요약 ===")
    for status in ("CONTENT-PASS", "CONTENT-NEEDS-REVIEW", "CONTENT-ERROR"):
        if status in counts:
            print(f"  {status:20s} {counts[status]}")

    flagged = [r for r in results if r["content_verdict"] == "CONTENT-NEEDS-REVIEW"]
    if flagged:
        print(f"\n=== NEEDS-REVIEW 목록 ({len(flagged)}건, 2단계 사람 표본 검토 후보) ===")
        for r in flagged:
            print(f"  - {r['id']} ({r['category']}): {r.get('content_note', '')}")

    print(
        "\n주의: 위 판정은 LLM 비평가의 1차 스크리닝일 뿐이며 최종 결론이 아니다. "
        "NEEDS-REVIEW는 결함 확정이 아니라 2단계 사람 검토 후보를 뜻한다. "
        "(select_content_quality_sample.py로 표본을 뽑을 것.)"
    )

    if counts.get("CONTENT-ERROR", 0) > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
