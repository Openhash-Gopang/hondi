#!/usr/bin/env python3
"""
K-Execute(SP-22) GOV_TASK_SUBMIT_REQUEST 통합 LIVE smoketest.

기존 live_smoketest.py(AC-PRO-CORE 라우팅 태그 채점)와 같은 계열이지만 대상
system prompt가 SP-22_kexecute이고, F-1/F-2(no=6/no=7) 쌍은 단일 턴이 아니라
3턴(K-Compose 위임 → GOV_TASK_SUBMIT_REQUEST 발행 → 서버 응답 주입 → 재개)
시퀀스로 실행해야 의미가 있다 — live_smoketest.py는 단일 턴만 지원해 이
시나리오를 못 돌리므로 별도 하네스로 분리했다.

klaw_billing_live_smoketest.py와 달리 실제 worker.js(hondi-proxy) 엔드포인트는
호출하지 않는다 — 이 테스트가 확인하려는 건 "SP-22 프롬프트 지침을 모델이
실제로 따르는가"(태그 발행 여부·순서·필드)이지 서버 사이드 이펙트가 아니다.
call-ai.js가 [GOV_TASK_SUBMIT_REQUEST] 감지 시 실제로 하는 일(POST /gov/task/
submit → 응답을 "[INTERNAL: GOV_TASK_SUBMIT_REQUEST 결과 수신 — ...]" 형식으로
모델에 되먹임, src/gopang/ai/call-ai.js 참고)을 이 하네스가 그대로 시뮬레이션한다
— 실제 서버 대신 항상 status:accepted인 가짜 응답을 합성해 주입한다. 따라서
"서버가 실제로 accept하는가"는 이 테스트의 범위가 아니다(그건 REQUIRED_
DOCUMENTS_REGISTRY 대조 로직이 이미 담당 — 별도 유닛/통합 테스트 영역).

Usage:
  DEEPSEEK_API_KEY=... python3 gov_task_execute_live_smoketest.py \
      --scenarios scenarios_gov_task_execute_integration_20260813.json \
      --system-prompt ../../prompts/SP-22_kexecute_v1.5.txt \
      --out ../../results/gov_task_execute_integration

--skip-fixtures(기본 true)면 atom_rows에 아직 없는 픽스처 의존 시나리오
(no=1,2,8 — 주석 precondition_note 참고)는 LIVE-SKIPPED로 표시하고 실행하지
않는다. 실 데이터(court-filing)만 우선 돌리고 싶으면 기본값 그대로 두면 된다.

Resumable: --resume 주면 이미 results/live_results.jsonl에 기록된 no는
재실행하지 않는다. 단 no=6/7은 하나의 시퀀스라 항상 함께 재실행된다(6만
캐시돼 있고 7이 없으면 6부터 다시 돈다 — 대화 이력을 다시 만들어야 하므로
6만 따로 재사용할 수 없다).
"""
import argparse
import json
import os
import re
import sys
import time
import csv
import uuid

import requests

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3

GOV_TASK_SUBMIT_RE = re.compile(
    r"\[GOV_TASK_SUBMIT_REQUEST\](.*?)\[/GOV_TASK_SUBMIT_REQUEST\]", re.DOTALL)
CALL_GOVSYS_RE = re.compile(r"\[\s*CALL_GOVSYS\s*:", re.IGNORECASE)
PROJECT_STATE_SAVE_RE = re.compile(r"\[\s*PROJECT_STATE_SAVE\s*:", re.IGNORECASE)
PROJECT_ID_RE = re.compile(r"project_id\s*=\s*([^\s,\]]+)")
RESULTS_SO_FAR_RE = re.compile(r"results_so_far\s*=\s*(.*?)(?:\]\s*$)", re.DOTALL)
RECEIPT_NO_RE = re.compile(r"HONDI-SIM-[\w\-]+")


def call_deepseek(api_key, messages):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MODEL,
        "temperature": 0,
        "max_tokens": 900,
        "messages": messages,
    }
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=90)
            if resp.status_code == 200:
                data = resp.json()
                text = data["choices"][0]["message"]["content"]
                usage = data.get("usage", {})
                return text, usage, None
            elif resp.status_code == 429:
                time.sleep(RETRY_BASE_SLEEP * attempt)
                last_err = f"429 rate_limited (attempt {attempt})"
                continue
            else:
                last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
                time.sleep(RETRY_BASE_SLEEP)
                continue
        except requests.RequestException as e:
            last_err = f"request_exception: {e}"
            time.sleep(RETRY_BASE_SLEEP * attempt)
            continue
    return None, {}, last_err


def synthesize_gov_task_response(payload):
    """call-ai.js가 실제 /gov/task/submit 응답으로 받았을 법한 형태를 합성한다.
    항상 accepted로 고정 — 이 하네스는 서버 accept 로직이 아니라 모델의 태그
    발행 행동을 테스트하는 게 목적이므로."""
    return {
        "ok": True,
        "status": "accepted",
        "receipt_no": f"HONDI-SIM-{payload.get('agency', 'na')}-{uuid.uuid4().hex[:8]}",
        "schema_verified": True,
        "disclaimer": "이 접수번호는 나비 내부 접수번호이며 공식 접수번호가 아닙니다.",
        "dept_task_id": f"simdt_{uuid.uuid4().hex[:12]}",
    }


def build_internal_feed(sim_response):
    """call-ai.js의 실제 INTERNAL 메시지 문구를 그대로 재현(src/gopang/ai/
    call-ai.js, GOV_TASK_SUBMIT_REQUEST 처리부). 2026-08-13 라이브
    스모크테스트 no=6에서 PROJECT_STATE_SAVE 누락이 실제로 발견돼
    call-ai.js에 리마인더 문구를 추가했고, 하네스도 동일하게 맞춘다 —
    이 문구 자체가 실 배포본과 벌어지면 이 하네스가 더 이상 실제 시스템을
    대변하지 못한다."""
    return (
        "[INTERNAL: GOV_TASK_SUBMIT_REQUEST 결과 수신 — receipt_no와 disclaimer, "
        "schema_verified 필드는 절대 요약·생략하지 말고 그 의미를 온전히 사용자에게 전달하세요 "
        f"(§접수번호 면책문구 참조): {json.dumps(sim_response, ensure_ascii=False)}. "
        "이어서 이 atom이 인간전속 구간(automation_sp 없음 또는 본인인증 필요)이라면, "
        "SP-22 STEP1 지침대로 안내 문구만 내고 끝내지 말고 반드시 [PROJECT_STATE_SAVE: ...]까지 "
        "낸 뒤 멈추세요 — 이 태그 없이 끝내면 재개 시 이 접수 상태가 유실됩니다.]"
    )


def extract_tags_in_order(text):
    """텍스트에 등장하는 순서대로 태그 이름 목록을 뽑는다(대략적 — 정확한
    커서 위치 비교이지 완벽한 파서는 아니다)."""
    hits = []
    for m in re.finditer(
        r"\[\s*(GOV_TASK_SUBMIT_REQUEST|CALL_GOVSYS|PROJECT_STATE_SAVE|"
        r"HANDOFF_TO_KDELIVER|HANDOFF_TO_KCOMPOSE)\s*:?", text or "", re.IGNORECASE):
        hits.append((m.start(), m.group(1).upper()))
    hits.sort(key=lambda x: x[0])
    return [h[1] for h in hits]


def grade_single_turn(scenario, raw_text, call_err):
    if call_err is not None:
        return "LIVE-ERROR", call_err, {}

    expected_tags = scenario.get("expected_tags_in_order", [])
    actual_tags = extract_tags_in_order(raw_text)

    gov_task_match = GOV_TASK_SUBMIT_RE.search(raw_text or "")
    parsed_fields = {}
    if gov_task_match:
        try:
            parsed_fields = json.loads(gov_task_match.group(1).strip())
        except Exception:
            parsed_fields = {"_parse_error": True, "_raw": gov_task_match.group(1)[:300]}

    # 태그 순서 검증 — expected가 빈 배열이면 "아예 안 나와야 함"이 기대치
    if not expected_tags:
        if "GOV_TASK_SUBMIT_REQUEST" in actual_tags:
            return "LIVE-FAIL", f"기대: 태그 없음, 실제: GOV_TASK_SUBMIT_REQUEST 발행됨 (전체 태그열: {actual_tags})", parsed_fields
        return "LIVE-PASS", f"기대대로 GOV_TASK_SUBMIT_REQUEST 미발행 (전체 태그열: {actual_tags})", parsed_fields

    # expected가 있으면: 순서대로 부분열(subsequence)로 등장하는지 확인
    idx = 0
    for tag in actual_tags:
        if idx < len(expected_tags) and tag == expected_tags[idx]:
            idx += 1
    if idx < len(expected_tags):
        return "LIVE-FAIL", f"기대 순서 {expected_tags} 중 {expected_tags[idx:]}가 안 나옴 (실제 태그열: {actual_tags})", parsed_fields

    # GOV_TASK_SUBMIT_REQUEST 필드 검증
    expected_fields = scenario.get("expected_gov_task_submit_fields")
    if expected_fields:
        mismatches = []
        for k, v in expected_fields.items():
            if v is None or (isinstance(v, str) and v.startswith("<")):
                continue  # 자유값 허용 필드(batch_id 등)는 존재 여부만 확인
            if parsed_fields.get(k) != v:
                mismatches.append(f"{k}: 기대 {v!r} vs 실제 {parsed_fields.get(k)!r}")
        for k in expected_fields:
            if expected_fields[k] is not None and isinstance(expected_fields[k], str) and expected_fields[k].startswith("<") and k not in parsed_fields:
                mismatches.append(f"{k}: 존재해야 하는데 누락됨")
        if mismatches:
            return "LIVE-FAIL", f"GOV_TASK_SUBMIT_REQUEST 필드 불일치: {'; '.join(mismatches)}", parsed_fields

    return "LIVE-PASS", f"기대 태그열 확인됨 (실제: {actual_tags})", parsed_fields


def run_single_turn_scenario(api_key, system_prompt, scenario):
    raw_text, usage, err = call_deepseek(
        api_key,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": scenario["kexecute_user_turn"]},
        ],
    )
    verdict, note, parsed_fields = grade_single_turn(scenario, raw_text, err)
    return {
        "no": scenario["no"],
        "cluster": scenario["cluster"],
        "title": scenario["title"],
        "category": scenario["category"],
        "raw_response": (raw_text or "")[:3000],
        "parsed_gov_task_fields": parsed_fields,
        "live_verdict": verdict,
        "live_note": note,
        "usage": usage,
        "call_error": err,
    }


def run_resume_pair(api_key, system_prompt, scenario_f1, scenario_f2):
    """no=6(F-1)과 no=7(F-2)을 하나의 대화로 이어 3턴 시퀀스로 실행한다."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": scenario_f1["kexecute_user_turn"]},
    ]
    reply1, usage1, err1 = call_deepseek(api_key, messages)
    if err1 is not None:
        err_result = {
            "no": scenario_f1["no"], "cluster": scenario_f1["cluster"], "title": scenario_f1["title"],
            "category": scenario_f1["category"], "raw_response": "", "parsed_gov_task_fields": {},
            "live_verdict": "LIVE-ERROR", "live_note": err1, "usage": usage1, "call_error": err1,
        }
        skip_result = dict(err_result, no=scenario_f2["no"], cluster=scenario_f2["cluster"],
                            title=scenario_f2["title"], category=scenario_f2["category"],
                            live_note="선행 턴(no=" + str(scenario_f1["no"]) + ") 실패로 스킵")
        return err_result, skip_result

    messages.append({"role": "assistant", "content": reply1})

    gov_task_match = GOV_TASK_SUBMIT_RE.search(reply1 or "")
    parsed_fields_1 = {}
    reply1b = ""
    usage1b = {}
    if gov_task_match:
        try:
            parsed_fields_1 = json.loads(gov_task_match.group(1).strip())
        except Exception:
            parsed_fields_1 = {"_parse_error": True}
        sim_response = synthesize_gov_task_response(parsed_fields_1)
        internal_feed = build_internal_feed(sim_response)
        messages.append({"role": "user", "content": internal_feed})
        reply1b, usage1b, err1b = call_deepseek(api_key, messages)
        if err1b is None:
            messages.append({"role": "assistant", "content": reply1b})

    full_reply_1 = (reply1 or "") + "\n" + (reply1b or "")
    verdict1, note1, _ = grade_single_turn(scenario_f1, full_reply_1, None)
    # F-1 전용 추가 확인: PROJECT_STATE_SAVE의 results_so_far에 접수번호 흔적이
    # 남았는지(다음 턴 중복방지 가드의 전제조건) — 못 찾으면 PASS를 뒤집지는
    # 않되(모델이 다른 형식으로 적었을 수도 있어 오탐 위험) NEEDS-REVIEW로 낮춘다.
    if verdict1 == "LIVE-PASS" and PROJECT_STATE_SAVE_RE.search(full_reply_1):
        if not RECEIPT_NO_RE.search(full_reply_1):
            verdict1 = "LIVE-NEEDS-REVIEW"
            note1 += " | PROJECT_STATE_SAVE는 나왔지만 results_so_far에서 접수번호(HONDI-SIM-...) 패턴을 못 찾음 — no=7 중복방지 전제조건 확인 필요(사람 검토)"

    result1 = {
        "no": scenario_f1["no"], "cluster": scenario_f1["cluster"], "title": scenario_f1["title"],
        "category": scenario_f1["category"], "raw_response": full_reply_1[:3000],
        "parsed_gov_task_fields": parsed_fields_1, "live_verdict": verdict1, "live_note": note1,
        "usage": {"turn1": usage1, "turn1b": usage1b}, "call_error": None,
    }

    if not gov_task_match:
        # F-1 자체가 GOV_TASK_SUBMIT_REQUEST를 못 냈으면 F-2는 전제가 무너져 스킵
        result2 = {
            "no": scenario_f2["no"], "cluster": scenario_f2["cluster"], "title": scenario_f2["title"],
            "category": scenario_f2["category"], "raw_response": "", "parsed_gov_task_fields": {},
            "live_verdict": "LIVE-SKIPPED", "live_note": "no=6에서 GOV_TASK_SUBMIT_REQUEST 자체가 안 나와 재개 테스트 전제 무효",
            "usage": {}, "call_error": None,
        }
        return result1, result2

    # RESUME_KEXECUTE 턴 — project_id/pdv_project_state 플레이스홀더를 실제
    # 값으로 못 채워도(모델 출력 형식이 매번 다를 수 있어 정규식 추출이
    # 불완전할 수 있음) 원문 그대로 이어붙인다 — 어차피 이 테스트가 보는 건
    # "GOV_TASK_SUBMIT_REQUEST가 또 나오는가"이지 project_id 일치 여부가 아니다.
    resume_turn = scenario_f2["kexecute_user_turn"]
    pid_match = PROJECT_ID_RE.search(full_reply_1)
    if pid_match:
        resume_turn = resume_turn.replace("{{PROJECT_ID}}", pid_match.group(1))
    resume_turn = resume_turn.replace(
        "{{PDV_PROJECT_STATE}}",
        "(PDV에 저장된 이전 PROJECT_STATE_SAVE 전체를 그대로 조회한 것으로 간주)")

    messages.append({"role": "user", "content": resume_turn})
    reply2, usage2, err2 = call_deepseek(api_key, messages)
    verdict2, note2, parsed_fields_2 = grade_single_turn(scenario_f2, reply2, err2)

    result2 = {
        "no": scenario_f2["no"], "cluster": scenario_f2["cluster"], "title": scenario_f2["title"],
        "category": scenario_f2["category"], "raw_response": (reply2 or "")[:3000],
        "parsed_gov_task_fields": parsed_fields_2, "live_verdict": verdict2, "live_note": note2,
        "usage": usage2, "call_error": err2,
    }
    return result1, result2


FIXTURE_DEPENDENT_NOS = {1, 2, 8}  # precondition_note에 픽스처 시드가 필요하다고 명시된 시나리오


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="scenarios_gov_task_execute_integration_20260813.json")
    ap.add_argument("--system-prompt", default="../../prompts/SP-22_kexecute_v1.5.txt")
    ap.add_argument("--out", default="../../results/gov_task_execute_integration")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--skip-fixtures", dest="skip_fixtures", action="store_true", default=True)
    ap.add_argument("--include-fixtures", dest="skip_fixtures", action="store_false")
    args = ap.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY env var not set", file=sys.stderr)
        sys.exit(1)

    with open(args.scenarios, "r", encoding="utf-8") as f:
        scenarios = json.load(f)
    with open(args.system_prompt, "r", encoding="utf-8") as f:
        system_prompt = f.read()

    os.makedirs(args.out, exist_ok=True)
    jsonl_path = os.path.join(args.out, "live_results.jsonl")

    done = set()
    if args.resume and os.path.exists(jsonl_path):
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        done.add(json.loads(line)["no"])
                    except Exception:
                        pass

    by_no = {s["no"]: s for s in scenarios}
    results = []

    with open(jsonl_path, "a", encoding="utf-8") as out_f:
        for s in scenarios:
            if s["no"] in done:
                continue
            if args.skip_fixtures and s["no"] in FIXTURE_DEPENDENT_NOS:
                r = {
                    "no": s["no"], "cluster": s["cluster"], "title": s["title"], "category": s["category"],
                    "raw_response": "", "parsed_gov_task_fields": {}, "live_verdict": "LIVE-SKIPPED",
                    "live_note": "픽스처 시드 필요(precondition_note 참고) — --include-fixtures로 강제 실행 가능",
                    "usage": {}, "call_error": None,
                }
                results.append(r)
                out_f.write(json.dumps(r, ensure_ascii=False) + "\n")
                out_f.flush()
                continue

            if s["no"] == 6:
                # F-1/F-2 쌍은 항상 함께 실행(no=7이 done에 있어도 6이 새로
                # 필요하면 재실행해야 대화이력이 맞다 — 위 done 체크에서
                # no=6이 이미 걸러지지 않은 경우에만 여기 온다)
                s7 = by_no[7]
                r6, r7 = run_resume_pair(api_key, system_prompt, s, s7)
                for r in (r6, r7):
                    results.append(r)
                    out_f.write(json.dumps(r, ensure_ascii=False) + "\n")
                    out_f.flush()
                print(f"  no=6 {r6['live_verdict']} / no=7 {r7['live_verdict']}")
                continue
            if s["no"] == 7:
                continue  # no=6 처리 시 함께 실행됨

            r = run_single_turn_scenario(api_key, system_prompt, s)
            results.append(r)
            out_f.write(json.dumps(r, ensure_ascii=False) + "\n")
            out_f.flush()
            print(f"  no={r['no']} {r['live_verdict']}")

    # 최종 집계(재실행 대비 no로 dedup, 마지막 결과 우선)
    all_results = {}
    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            all_results[r["no"]] = r
    final = [all_results[k] for k in sorted(all_results)]

    with open(os.path.join(args.out, "live_results.json"), "w", encoding="utf-8") as f:
        json.dump(final, f, ensure_ascii=False, indent=2)

    csv_path = os.path.join(args.out, "live_results.csv")
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["no", "cluster", "title", "category", "live_verdict", "live_note"])
        for r in final:
            writer.writerow([r["no"], r["cluster"], r["title"], r["category"], r["live_verdict"], r["live_note"]])

    summary = {}
    for r in final:
        summary[r["live_verdict"]] = summary.get(r["live_verdict"], 0) + 1
    with open(os.path.join(args.out, "live_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(f"\n완료: {len(final)}건 — {summary}")


if __name__ == "__main__":
    main()
