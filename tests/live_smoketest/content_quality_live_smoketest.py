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

## ★ 2026-09-20 신설 — 실제 서비스와 동일한 가드레일 스택으로 생성 호출
part1of5 첫 실행에서 5건이 "환각 의심"으로 플래그됐다(SYSTEM_PROMPT에
없는 구체적 예시를 확정처럼 덧붙인 패턴). 그런데 이 스크립트가 지금까지
생성 호출에 쓰던 system prompt는 render_govtree_prompts.mjs가 만든
agencyPrompt(=assembleGovSystemPrompt의 결과) **하나뿐**이었다 —
실제 프로덕션(worker.js handleGovRelay)은 여기에 UNIVERSAL-INTEGRITY
(U2 "불확실 식별자 생성 차단" 포함)·UNIVERSAL-common을 agencyPrompt
**앞에** 붙여서 LLM을 부른다(systemParts = [universalIntegrity,
universalCommon, controlTowerPrinciple, identityDoc, ownSpAndGates,
agencyPrompt, ...].join('\n\n---\n\n')). 즉 지금까지 이 스크립트가
찾아낸 "환각"은 실제 사용자 응답에도 재현되는지 확인 전이었다 — U2가
이미 억제하고 있었을 수도 있다.

이 스크립트는 이제 UNIVERSAL-INTEGRITY·UNIVERSAL-common을 prompts/
디렉터리에서 직접 읽어(로컬 sp-catalog.json 매니페스트 기준, 프로덕션이
GitHub raw에서 읽는 파일과 같은 저장소·같은 경로) agencyPrompt 앞에
붙인다. **완전한 재현은 아니다** — 아래 두 레이어는 아직 안 붙인다:
- CONTROL-TOWER-PRINCIPLE: sp-catalog.json에 이 키 자체가 없어서
  프로덕션에서도 로드에 항상 실패한다(별도로 발견한 버그 — try/catch로
  조용히 삼켜지고 빈 문자열로 대체됨). 즉 "안 붙이는 게" 오히려 프로덕션
  실태와 일치한다 — 이건 재현 누락이 아니라 의도적으로 프로덕션의 버그를
  그대로 반영한 것이다.
- identityDoc(K-Public_common/PROFESSIONAL-common)·ownSpAndGates(기관
  정본 SP+게이트 스키마): worker.js의 _fetchOwnSpAndGates(agency)가
  agency별로 동적 조립하는데, 이 Python 스크립트에서 그 로직을 안전하게
  재구현할 근거가 아직 없다 — 다음 세션 후속 조사 필요(정직하게 기록).
  이 갭이 남아있는 채로도 U2(불확실 식별자 생성 차단)는 이미 포함되므로
  "환각 의심" 축 재현에는 충분하지만, "사무분장 정합성" 축은 여전히
  완전한 재현이 아닐 수 있다는 점을 결과 해석 시 감안할 것.

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
# ★ 2026-09-20 교정 — part1of5(104건) 첫 실사 실행에서 9건이 CONTENT-ERROR로
# 실패했다(critic_empty_response 7건 + critic_json_parse_error(문자열이 중간에
# 끊김) 2건). control_tower_live_smoketest.py의 call_deepseek 주석이 이미
# 2026-08-08/09에 기록해둔 것과 같은 원인이었다 — deepseek-v4-flash가 추론형
# 모델이라 reasoning 토큰도 max_tokens 예산에 포함되는데(관측된 reasoning
# 길이 3,200~11,500자대), 비평가 호출만 CRITIC_MAX_TOKENS=2000으로 너무 낮게
# 잡아서 reasoning이 예산을 다 쓰고 최종 JSON(content)이 비거나 중간에
# 잘렸다. 생성 호출(GEN_MAX_TOKENS)엔 이미 이 교훈이 반영돼 있었는데 비평가
# 호출엔 반영을 빼먹은 게 원인 — 같은 모델이니 같은 예산을 줘야 했다.
GEN_MAX_TOKENS = 12000  # control_tower_live_smoketest.py와 동일 근거(추론형 모델 토큰 예산)
CRITIC_MAX_TOKENS = 12000  # 위 사유로 GEN_MAX_TOKENS와 동일하게 상향(2000 → 12000)


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


# ── UNIVERSAL 레이어 (worker.js handleGovRelay와 동일한 순서로 선두 삽입) ──
# 2026-09-20 신설 — 위 모듈 docstring "★ 2026-09-20 신설" 절 참고. 결과가
# 1회 로드로 재사용되도록 모듈 레벨에 캐시한다(요청마다 파일을 다시 읽지
# 않음 — 520건 규모에서 불필요한 I/O 반복을 피하기 위함).
_universal_layers_cache = None


def _load_universal_layers(manifest):
    global _universal_layers_cache
    if _universal_layers_cache is not None:
        return _universal_layers_cache
    parts = []
    for key in ("UNIVERSAL-INTEGRITY", "UNIVERSAL-common"):
        try:
            parts.append(load_sp_file(manifest, key))
        except FileNotFoundError as e:
            # 프로덕션도 이 레이어 로드 실패 시 빈 문자열로 대체하고 서비스는
            # 계속한다(worker.js _fetchUniversalIntegrity 등 동일 정책) —
            # 여기서도 스크립트를 죽이지 않고 경고만 남긴다.
            print(f"  경고(universal layer): {e}", file=sys.stderr)
    _universal_layers_cache = "\n\n---\n\n".join(parts)
    return _universal_layers_cache


def resolve_system_prompt(manifest, scenario, prompts_dir):
    universal = _load_universal_layers(manifest)

    def _prepend(agency_prompt):
        # worker.js handleGovRelay의 systemParts 조립 순서·구분자와 동일:
        # [universalIntegrity, universalCommon, ..., agencyPrompt, ...].join('\n\n---\n\n')
        return f"{universal}\n\n---\n\n{agency_prompt}" if universal else agency_prompt

    explicit = scenario.get("system_prompt_file")
    if explicit:
        with open(explicit, encoding="utf-8") as f:
            return _prepend(f.read())
    if prompts_dir:
        candidate = os.path.join(prompts_dir, f"{scenario['id']}.txt")
        if os.path.exists(candidate):
            with open(candidate, encoding="utf-8") as f:
                return _prepend(f.read())
        raise FileNotFoundError(
            f"--prompts-dir 지정됐지만 {candidate} 없음 — render_govtree_prompts.mjs를 "
            f"먼저 실행했는지, id가 일치하는지 확인할 것"
        )
    return _prepend(build_system_prompt(manifest, scenario["sp_keys"]))


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
                msg = choice.get("message", {})
                content = msg.get("content", "")
                # control_tower_live_smoketest.py와 동일하게 reasoning_content
                # 길이를 같이 남긴다 — max_tokens 예산 부족으로 빈 응답/잘린
                # JSON이 재발하면 이 필드로 바로 원인 진단이 가능하도록.
                debug = {
                    "finish_reason": choice.get("finish_reason"),
                    "usage": data.get("usage"),
                    "has_reasoning_content": bool(msg.get("reasoning_content")),
                    "reasoning_content_len": len(msg.get("reasoning_content") or ""),
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
        return None, err, debug
    if not content or not content.strip():
        return None, f"critic_empty_response{_debug_suffix(debug)}", debug
    m = JSON_BLOCK_RE.search(content)
    raw_json = m.group(0) if m else content
    try:
        parsed = json.loads(raw_json)
    except json.JSONDecodeError as e:
        return None, f"critic_json_parse_error: {e} raw={content[:300]!r}{_debug_suffix(debug)}", debug
    return parsed, None, debug


def _debug_suffix(debug):
    # 실패 사유 문자열에 finish_reason/reasoning 길이를 같이 남겨서, 결과
    # jsonl만 보고도 "또 토큰 예산 부족이었는지" 바로 진단 가능하게 한다.
    if not debug:
        return ""
    return (
        f" [finish={debug.get('finish_reason')}, "
        f"reasoning_len={debug.get('reasoning_content_len', '-')}]"
    )


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

    critic, critic_err, critic_debug = run_critic(api_key, system_prompt, scenario["utterance"], raw_text)
    if critic_err:
        return {**scenario, "raw_response": raw_text, "content_verdict": "CONTENT-ERROR",
                "content_note": f"비평가 호출 실패: {critic_err}", "critic": None,
                "gen_debug": gen_debug, "critic_debug": critic_debug}

    overall = critic.get("overall_flag", "NEEDS_REVIEW")
    verdict = "CONTENT-PASS" if overall == "OK" else "CONTENT-NEEDS-REVIEW"
    return {
        **scenario,
        "raw_response": raw_text,
        "content_verdict": verdict,
        "content_note": critic.get("overall_reason", ""),
        "critic": critic,
        "gen_debug": gen_debug,
        "critic_debug": critic_debug,
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
