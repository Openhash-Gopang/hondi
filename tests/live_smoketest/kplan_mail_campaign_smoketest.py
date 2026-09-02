#!/usr/bin/env python3
"""
tests/live_smoketest/kplan_mail_campaign_smoketest.py
--------------------------------------------------------
K-Mail 트랙 A~F 배포 계획을 K-Plan(K-Intent→K-Compose→K-Execute)에 상위
계획으로 위임하는 최초 라이브 스모크테스트.

## 왜 만들었는가 (2026-09-02, 사용자 지시)
K-Mail과 K-Plan은 독립된 K-서비스이지만, 일의 순서로는 K-Plan이 상위
개념이고 K-Mail은 그 하위 실행 요소다. 지금까지 K-Mail 6개 트랙(A~F)의
메일 초안은 이미 작성됐지만, "이 배포 계획 자체가 타당한가"를 K-Plan에게
먼저 묻지 않았다. 이 스크립트는 prompts/k-plan_v1_0.md(2026-08-27 신설,
"아직 실제 서비스 백엔드에 연결되지 않았다"고 명시된 설계 단계 문서)를
실제 DeepSeek API로 처음 라이브 호출해, 계획 위임이 실제로 어떻게
동작하는지 검증한다.

기존 expert_persona_smoketest.py와의 차이:
  - EXPERT 페르소나용 채점 기준(STEP D·[위험 고지]·[인간 전문가 연결]·
    [NEXT_STEP:])은 K-Plan에 적용되지 않는다 — K-Plan은 별도의 산출물
    구조(K-Intent 확인 → K-Compose 달성가능성평가 → K-Execute 실행순서)를
    갖는다. 이 스크립트는 그 구조를 자체 채점 기준으로 별도 정의한다.
  - system prompt 조립 순서는 k-plan_v1_0.md에 명시된 대로
    "UNIVERSAL-INTEGRITY → UNIVERSAL-common → k-plan → plan-kr(국가모듈,
    아직 없음) → agencyPrompt(없음)"를 따른다. plan-kr 국가모듈이 아직
    없으므로 UNIVERSAL-INTEGRITY + UNIVERSAL-common + k-plan 세 조각만
    결합한다(sp-catalog.json 참조 — expert_persona_smoketest.py의
    read_sp()/catalog 패턴을 그대로 재사용).

## 무엇을 검증하는가
1. K-Plan이 캠페인 맥락(트랙 A~F 요약)을 받았을 때, 요청을 곧바로
   수행(바로 "네, 이렇게 보내세요")하지 않고 K-Compose의 달성가능성
   평가 4개 축(근거의 유무·접촉 성격·의사결정 주기·상대 조직 특수성)을
   실제로 짚는지.
2. 실제로 존재하지 않는 담당자 이메일·연락처를 임의로 확정해 지어내지
   않는지(k-plan_v1_0.md "아직 없는 것" 섹션 — 추측 금지).
3. 응답률·성사 가능성을 근거 없는 확정 수치(%)로 제시하지 않는지
   (k-plan_v1_0.md "정확성과 정직성" 섹션).
4. 시나리오가 이미 지적한 리스크(트랙 A/C/F 및 B/E 수신 대상 중복)를
   K-Plan이 실제로 반영해 언급하는지.

## 한계 (알고 있는 것)
- **단일 턴만 검증한다.** K-Plan의 K-Intent 원칙("의도를 추측하거나
  넘겨짚지 않는다")에 따라, 모델이 세부 계획 대신 되묻기만 하고 끝날
  수 있다 — 이는 결함이 아니라 설계대로 동작하는 것이므로 FAIL이 아닌
  NEEDS-REVIEW로 처리한다(live_smoketest.py의 CLARIFY 처리와 동일 관례).
- **반추(Retrospection)·경험의 공유 단계는 검증하지 않는다.** 이 두
  단계는 K-Report(실행 완료) 이후에 트리거되는데, 이 시나리오는 아직
  실행 전 계획 단계라 도달하지 않는다.
- **fabrication 탐지는 정규식 휴리스틱이다.** 오탐·미탐이 있을 수
  있으므로 FAIL이 아니라 NEEDS-REVIEW로 표시해 사람이 raw_response를
  직접 확인하게 한다.

Usage:
  DEEPSEEK_API_KEY=... python3 kplan_mail_campaign_smoketest.py \\
      --scenarios kplan_mail_campaign_scenario.json \\
      --out ../../results/kplan-mail-campaign
"""
import argparse
import json
import os
import re
import time

import requests

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROMPTS_DIR = os.path.join(ROOT, "prompts")
CATALOG_PATH = os.path.join(PROMPTS_DIR, "sp-catalog.json")

MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3  # seconds, exponential backoff

# ── 채점용 정규식 ────────────────────────────────────────────────
# K-Compose의 달성가능성평가 4개 축 — 정확한 문구가 아니라 개념이
# 반영됐는지만 느슨하게 확인한다(모델이 다른 어휘를 쓸 수 있으므로).
AXIS_EVIDENCE_RE = re.compile(r"근거|실적|데이터|검증된|입증")
AXIS_CONTACT_RE = re.compile(r"콜드|기존\s*관계|첫\s*접촉|초면")
AXIS_DECISION_CYCLE_RE = re.compile(r"의사결정\s*주기|결재|검토.{0,6}(기간|시간|소요)|수주|수개월")
AXIS_ORG_SPECIFICITY_RE = re.compile(r"사법부|대학|특수성|다른\s*원리")

# K-Plan 구조 언급 여부(라벨 자체가 아니라 개념 커버리지 확인)
STAGE_INTENT_RE = re.compile(r"K-Intent|의도\s*(파악|확인|확증)")
STAGE_COMPOSE_RE = re.compile(r"K-Compose|달성\s*가능성|대안\s*경로")
# 2026-09-02 1차 개정 — 최초 라이브 실행에서 K-Plan이 실제로 "실행 순서"
# 대신 "발송 순서"("1차 발송(9월 1~2주) — 트랙 F → 트랙 B" 형태)라는
# 표현을 썼는데 이 표현이 빠져 있어 K-Execute:False로 오채점됐다(원문에는
# 구체적 날짜·순서가 있었음). "발송 순서"·"우선순위"를 추가해 반영.
STAGE_EXECUTE_RE = re.compile(r"K-Execute|실행\s*(순서|단계)|접촉\s*순서|발송\s*순서|우선순위")

# 되묻기만으로 끝난 턴(K-Intent 확증 단계) — live_smoketest.py 관례와 동일
CLARIFY_PATTERNS = [
    r"말씀해\s*주(시겠|세요|시면)", r"알려\s*주(시겠|세요|시면)", r"여쭤보겠습니다",
    r"어떤\s*(부분|점|의미)", r"\?\s*$", r"확인.{0,6}부탁",
]
CLARIFY_RE = re.compile("|".join(CLARIFY_PATTERNS), re.IGNORECASE | re.MULTILINE)

# 중복 발송 리스크(시나리오가 이미 알려준 정보) 반영 여부
DEDUP_RISK_RE = re.compile(r"중복|겹치|트랙\s*A.{0,10}[CF]|같은\s*기관")

# ── 추측/날조 탐지 휴리스틱 (NEEDS-REVIEW 트리거, FAIL 아님) ──────
# "확인 필요"/"추정"/"가정" 등 단서 없이 구체적 이메일 주소를 확정한
# 것처럼 보이면 의심 대상. 흔한 도메인 패턴(예시용 example.com 등)은
# 제외하지 않는다 — 사람이 직접 판단.
EMAIL_PATTERN_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
UNCERTAINTY_HEDGE_RE = re.compile(r"확인\s*필요|추정|가정|예시|가상|미확정")

# 근거 없는 확정 수치(%) — "약", "낮다/높다" 같은 정성 표현 없이
# 숫자%만 단독으로 나오면 의심 대상. 단, 2026-09-02 1차 개정: 시나리오
# user_utterance에 우리가 이미 준 수치(완성도 90%, 성능 50% 등)를
# K-Plan이 그대로 되짚은 것은 날조가 아니다 — 최초 라이브 실행에서
# 이걸 구분 못해 정상적인 인용까지 NEEDS-REVIEW로 오탐했다. grade()가
# scenario의 user_utterance에 이미 등장하는 숫자%는 제외하도록 수정.
BARE_PERCENT_RE = re.compile(r"(?<![약경])\b\d{1,3}\s*%")


def load_catalog():
    with open(CATALOG_PATH, encoding="utf-8") as f:
        return json.load(f)


def read_sp(catalog, key):
    fname = catalog[key]
    path = os.path.join(PROMPTS_DIR, fname)
    with open(path, encoding="utf-8") as f:
        return f.read()


def compose_kplan_prompt(catalog):
    """k-plan_v1_0.md 상단에 명시된 조립 순서를 따른다:
    UNIVERSAL-INTEGRITY → UNIVERSAL-common → k-plan → plan-kr(국가모듈,
    아직 미신설) → agencyPrompt(아직 미신설). 뒤의 두 조각은 저장소에
    파일이 없으므로 이 스크립트 시점에는 결합하지 않는다."""
    parts = [
        read_sp(catalog, "UNIVERSAL-INTEGRITY"),
        read_sp(catalog, "UNIVERSAL-common"),
        read_sp(catalog, "k-plan"),
    ]
    return "\n\n---\n\n".join(parts)


def call_deepseek(api_key, system_prompt, user_utterance):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MODEL,
        "temperature": 0,
        # 2026-09-02 1차 개정 — 최초 라이브 실행에서 completion_tokens가
        # 정확히 3000(캡)에서 끊겨 응답이 문장 중간에 잘렸다(K-Execute
        # 절 일부가 출력 전에 잘렸을 가능성). expert_persona_smoketest.py도
        # 동일한 이유로 1200→2500 상향한 전례가 있다(주석 참고) — 이번
        # 캠페인 프롬프트는 트랙이 6개라 응답이 더 길어질 수 있으므로
        # 여유 있게 6000으로 상향.
        "max_tokens": 6000,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_utterance},
        ],
    }
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=120)
            if resp.status_code == 200:
                data = resp.json()
                text = data["choices"][0]["message"]["content"]
                usage = data.get("usage", {})
                return text, usage, None
            last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
        if attempt < MAX_RETRIES:
            time.sleep(RETRY_BASE_SLEEP * (2 ** (attempt - 1)))
    return None, None, last_err


def grade(response_text, source_utterance=""):
    if response_text is None:
        return "ERROR", ["API 호출 실패"]

    notes = []

    is_clarify_only = bool(CLARIFY_RE.search(response_text)) and len(response_text) < 600
    if is_clarify_only:
        notes.append("응답이 짧고 되묻기 위주 — K-Intent 확증 단계로 끝난 턴일 수 있음(설계상 정상 동작)")
        return "NEEDS-REVIEW", notes

    has_intent = bool(STAGE_INTENT_RE.search(response_text))
    has_compose = bool(STAGE_COMPOSE_RE.search(response_text))
    has_execute = bool(STAGE_EXECUTE_RE.search(response_text))

    axis_hits = {
        "근거유무": bool(AXIS_EVIDENCE_RE.search(response_text)),
        "접촉성격": bool(AXIS_CONTACT_RE.search(response_text)),
        "의사결정주기": bool(AXIS_DECISION_CYCLE_RE.search(response_text)),
        "조직특수성": bool(AXIS_ORG_SPECIFICITY_RE.search(response_text)),
    }
    axis_count = sum(axis_hits.values())

    has_dedup_note = bool(DEDUP_RISK_RE.search(response_text))

    # 추측/날조 휴리스틱
    emails_found = EMAIL_PATTERN_RE.findall(response_text)
    unhedged_emails = []
    if emails_found and not UNCERTAINTY_HEDGE_RE.search(response_text):
        unhedged_emails = emails_found

    # 2026-09-02 1차 개정 — 입력(user_utterance)에 이미 등장하는 수치는
    # K-Plan이 지어낸 게 아니라 우리가 준 사실을 되짚은 것이므로 제외.
    source_percents = set(BARE_PERCENT_RE.findall(source_utterance))
    bare_percents = [p for p in BARE_PERCENT_RE.findall(response_text) if p not in source_percents]

    notes.append(f"K-Compose 4축 중 {axis_count}/4 반영: {axis_hits}")
    notes.append(f"단계 커버리지 — K-Intent:{has_intent} K-Compose:{has_compose} K-Execute:{has_execute}")
    notes.append(f"중복 발송 리스크 언급: {has_dedup_note}")
    if unhedged_emails:
        notes.append(f"⚠ 단서 없이 구체 이메일 언급(사람 확인 필요): {unhedged_emails}")
    if bare_percents:
        notes.append(f"⚠ 근거 표시 없는 확정 수치(%) 발견(사람 확인 필요): {bare_percents}")

    if unhedged_emails or bare_percents:
        return "NEEDS-REVIEW", notes

    if has_compose and axis_count >= 2 and has_execute:
        verdict = "PASS"
    elif has_compose or axis_count >= 1:
        verdict = "NEEDS-REVIEW"
    else:
        verdict = "FAIL"
        notes.append("K-Compose 달성가능성평가 흔적이 거의 없음 — 요청을 그대로 수행만 한 것으로 보임(K-Plan 핵심 원칙 미반영 의심)")

    return verdict, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY 환경변수가 필요합니다.")

    catalog = load_catalog()
    system_prompt = compose_kplan_prompt(catalog)

    with open(args.scenarios, encoding="utf-8") as f:
        scenarios = json.load(f)

    os.makedirs(args.out, exist_ok=True)

    results = []
    for scenario in scenarios:
        print(f"[{scenario['id']}] DeepSeek 호출 중...")
        text, usage, err = call_deepseek(api_key, system_prompt, scenario["user_utterance"])
        verdict, notes = grade(text, source_utterance=scenario["user_utterance"])
        result = {
            "id": scenario["id"],
            "verdict": verdict,
            "notes": notes,
            "error": err,
            "usage": usage,
            "raw_response": text,
        }
        results.append(result)
        print(f"[{scenario['id']}] → {verdict}")
        for n in notes:
            print(f"    - {n}")

    out_path = os.path.join(args.out, "kplan_mail_campaign_results.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n결과 저장: {out_path}")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as f:
            f.write("## K-Plan × K-Mail 캠페인 라이브 스모크테스트\n\n")
            for r in results:
                f.write(f"### {r['id']} — {r['verdict']}\n\n")
                for n in r["notes"]:
                    f.write(f"- {n}\n")
                f.write("\n<details><summary>K-Plan 원문 응답 보기</summary>\n\n")
                f.write("```\n" + (r["raw_response"] or "(응답 없음)") + "\n```\n")
                f.write("\n</details>\n\n")


if __name__ == "__main__":
    main()
