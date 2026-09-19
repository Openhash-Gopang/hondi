#!/usr/bin/env python3
"""
tests/live_smoketest/select_content_quality_sample.py
------------------------------------------------------
HANDOFF_2026-09-19_jeju-sp-quality-evaluation.md §4 "2단계 — 사람 표본
검토"용 표본을 뽑는다.

content_quality_live_smoketest.py(1단계 LLM 비평가 스크리닝) 결과
JSONL을 입력으로 받아, 다음을 합쳐 사람(피터)이 직접 열어볼 표본을
만든다:

  1. CONTENT-NEEDS-REVIEW로 플래그된 건 전부.
  2. 그 외 카테고리별 무작위 N건(기본 10건 — SESSION_SUMMARY_CONTROL_
     TOWER_LIVE_SMOKETEST_20260919_v1_0.md에서 실제 쓴 방식과 동일).

카테고리는 시나리오의 "category" 필드(예: do-dept/bureau, emd/team) 기준.
재현 가능하도록 --seed로 랜덤시드를 고정한다(기본 20260919).

출력은 사람이 바로 훑어볼 수 있는 마크다운 체크리스트 + 원본 대조에 쓸
필드(directCode, renderText, raw_response, critic 판정)를 그대로 남긴
JSONL 둘 다 만든다.

Usage:
  python3 select_content_quality_sample.py \\
      --results ../../results/content-quality-govtree/content_quality_results.jsonl \\
      --per-category 10 \\
      --out ../../results/content-quality-govtree/human_review_sample
"""
import argparse
import json
import os
import random


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True, help="content_quality_live_smoketest.py가 쓴 jsonl")
    ap.add_argument("--per-category", type=int, default=10,
                     help="NEEDS-REVIEW 플래그 외에 카테고리별로 추가 추출할 무작위 표본 수")
    ap.add_argument("--seed", type=int, default=20260919)
    ap.add_argument("--out", default="../../results/content-quality-govtree/human_review_sample",
                     help="확장자 없는 출력 경로 접두사 — .md와 .jsonl 둘 다 생성")
    args = ap.parse_args()

    rows = []
    with open(args.results, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))

    by_id = {r["id"]: r for r in rows}
    flagged = [r for r in rows if r.get("content_verdict") == "CONTENT-NEEDS-REVIEW"]
    flagged_ids = {r["id"] for r in flagged}

    by_category = {}
    for r in rows:
        by_category.setdefault(r.get("category", "unknown"), []).append(r)

    rng = random.Random(args.seed)
    random_sample = []
    for cat, cat_rows in sorted(by_category.items()):
        pool = [r for r in cat_rows if r["id"] not in flagged_ids]
        rng.shuffle(pool)
        random_sample.extend(pool[: args.per_category])

    sample = flagged + random_sample
    # id 기준 중복 제거(이론상 안 겹치지만 방어적으로)
    seen = set()
    dedup = []
    for r in sample:
        if r["id"] not in seen:
            seen.add(r["id"])
            dedup.append(r)
    dedup.sort(key=lambda r: r["id"])

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)

    with open(f"{args.out}.jsonl", "w", encoding="utf-8") as f:
        for r in dedup:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    with open(f"{args.out}.md", "w", encoding="utf-8") as f:
        f.write("# 2단계 사람 표본 검토 — 제주 SP 내용 품질\n\n")
        f.write(
            f"- 소스: `{args.results}`\n"
            f"- 1단계 NEEDS-REVIEW 전수: {len(flagged)}건\n"
            f"- 카테고리별 추가 무작위 표본: 카테고리당 최대 {args.per_category}건 "
            f"(seed={args.seed})\n"
            f"- 총 표본: {len(dedup)}건 / 전체 {len(rows)}건\n\n"
            "각 항목을 실제 제주도/제주시/서귀포시 조직도·공식 자료와 대조해서 "
            "체크하십시오. 형식 위반은 이미 별도 검증 완료 — 여기선 사무분장 "
            "정합성·최신성·정직한 불확실성 고지·관할 지역 오안내만 봅니다.\n\n"
        )
        for r in dedup:
            tag = "🚩 NEEDS-REVIEW" if r["id"] in flagged_ids else "🎲 무작위표본"
            f.write(f"## [{tag}] {r['id']} — {r.get('category', '')}\n\n")
            f.write(f"- directCode: `{r.get('directCode', '')}`\n")
            f.write(f"- renderText: {r.get('renderText', '')}\n")
            f.write(f"- utterance: {r.get('utterance', '')}\n")
            critic = r.get("critic") or {}
            if critic:
                f.write(f"- 비평가 판정: {r.get('content_verdict')} — {r.get('content_note', '')}\n")
                # axis -> 짝이 되는 근거 텍스트 필드(critic이 boolean에 대응해 내는
                # *_note 필드). honest_uncertainty_disclosed는 CRITIC_SYSTEM_PROMPT
                # 출력 스키마에 짝 필드가 없으므로 None으로 둔다(critic.get(axis)가
                # boolean을 돌려주는 걸 note로 오인해 덧붙이는 버그 방지).
                axis_note_keys = {
                    "jurisdiction_issue": "jurisdiction_note",
                    "currency_issue": "currency_note",
                    "hallucination_suspected": "hallucination_note",
                    "honest_uncertainty_disclosed": None,
                    "region_misdirection": "region_misdirection_note",
                }
                for axis, label in (
                    ("jurisdiction_issue", "사무분장"),
                    ("currency_issue", "최신성/수치"),
                    ("hallucination_suspected", "환각 의심"),
                    ("honest_uncertainty_disclosed", "정직한 불확실성 고지"),
                    ("region_misdirection", "관할 지역 오안내"),
                ):
                    if axis in critic:
                        note_key = axis_note_keys.get(axis)
                        note = critic.get(note_key, "") if note_key else ""
                        f.write(f"  - {label}: {critic[axis]}" + (f" — {note}" if note else "") + "\n")
            else:
                f.write(f"- 비평가 판정: {r.get('content_verdict')} — {r.get('content_note', '')}\n")
            f.write("- [ ] 사람 검토 완료 (결과: __________)\n\n")
            f.write("<details><summary>실제 응답 원문</summary>\n\n")
            f.write("```\n" + (r.get("raw_response") or "") + "\n```\n\n")
            f.write("</details>\n\n")

    print(f"1단계 NEEDS-REVIEW {len(flagged)}건 + 카테고리별 무작위 표본 → 총 {len(dedup)}건")
    print(f"  {args.out}.md  (사람이 훑어볼 체크리스트)")
    print(f"  {args.out}.jsonl  (원본 대조용 전체 필드)")


if __name__ == "__main__":
    main()
