#!/usr/bin/env python3
"""
tests/live_smoketest/run_coverage_audit.py
--------------------------------------------
2026-09-13 세션에서 작성한 2,000개 질문(user_questions_v2.json /
dev_questions_v2.json)을 실제 hondi-search 엔드포인트에 던져 응답
유형(navigate/clarify/candidates/delegate_ksearch)을 기록한다.

이건 PASS/FAIL이 정해진 스모크테스트가 아니라 "커버리지 감사"다 —
2,000개 질문 대부분은 정답 URL이 정해져 있지 않다(존재하지 않는
서비스에 대한 질문도 의도적으로 섞여 있음). 목적은 카테고리별로
navigate 비율이 지나치게 낮은 곳(= 매니페스트에 실제로 대응 페이지가
없다는 신호)을 찾아내는 것이다.

⚠ 비용 주의: 2,000건 전체를 돌리면 DeepSeek API 호출이 2,000회
발생한다(대화 세션이 1턴짜리라 gaming 없음). --sample로 먼저 소규모
표본을 확인하고, 카테고리 단위(--category)로 나눠 돌리는 걸 권장한다.

Usage:
  python3 run_coverage_audit.py --file ../../data/coverage-audit-2000-questions/user_questions_v2.json --scope user
  python3 run_coverage_audit.py --file ../../data/coverage-audit-2000-questions/dev_questions_v2.json --scope dev
  python3 run_coverage_audit.py --file ../../data/coverage-audit-2000-questions/user_questions_v2.json --scope user --sample 50
  python3 run_coverage_audit.py --file ../../data/coverage-audit-2000-questions/user_questions_v2.json --scope user \
      --category "3_네비밖_K서비스"
"""
import argparse
import json
import os
import sys
import time
import uuid
from collections import Counter, defaultdict
from pathlib import Path

import requests

DEFAULT_URL = "https://hondi.net/hondi-search"
MAX_RETRIES = 3
RETRY_BASE_SLEEP = 2
REQUEST_TIMEOUT = 20


def call_search(url, message, scope):
    body = {"conversation_id": str(uuid.uuid4()), "message": message, "scope": scope}
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            res = requests.post(url, json=body, timeout=REQUEST_TIMEOUT)
            res.raise_for_status()
            return res.json()
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(RETRY_BASE_SLEEP * (attempt + 1))
    return {"type": "error", "message": str(last_err)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True, help="user_questions_v2.json 또는 dev_questions_v2.json 경로")
    ap.add_argument("--scope", required=True, choices=["user", "dev"])
    ap.add_argument("--url", default=os.environ.get("HONDI_SEARCH_URL", DEFAULT_URL))
    ap.add_argument("--out", default="../../results/coverage-audit")
    ap.add_argument("--sample", type=int, default=None, help="앞에서부터 N개만 실행(비용 절감용)")
    ap.add_argument("--category", default=None, help="이 카테고리(상위 분류)만 실행")
    args = ap.parse_args()

    items = json.loads(Path(args.file).read_text(encoding="utf-8"))

    if args.category:
        items = [it for it in items if it["category"].split("::")[0] == args.category]
    if args.sample:
        items = items[: args.sample]

    if not items:
        print("실행할 항목이 없습니다 (필터 조건을 확인하세요).")
        return 1

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    log_path = out_dir / f"{args.scope}_coverage_{int(time.time())}.jsonl"

    type_counts = Counter()
    by_category = defaultdict(Counter)

    with log_path.open("w", encoding="utf-8") as log_f:
        for i, it in enumerate(items, 1):
            response = call_search(args.url, it["question"], args.scope)
            rtype = response.get("type", "unknown")
            top_category = it["category"].split("::")[0]

            type_counts[rtype] += 1
            by_category[top_category][rtype] += 1

            log_f.write(json.dumps(
                {"id": it["id"], "category": it["category"], "question": it["question"],
                 "response_type": rtype, "response": response},
                ensure_ascii=False,
            ) + "\n")
            log_f.flush()

            print(f"[{i}/{len(items)}] {rtype:16s} {it['id']:10s} {it['question'][:50]}")

    total = sum(type_counts.values())
    print("\n" + "=" * 70)
    print(f"전체 {total}건 응답 유형 분포:")
    for t, c in type_counts.most_common():
        print(f"  {t:16s} {c:4d}건 ({c/total*100:5.1f}%)")

    print("\n카테고리별 navigate 비율 (낮을수록 매니페스트 공백 의심):")
    rows = []
    for cat, counts in by_category.items():
        cat_total = sum(counts.values())
        nav_rate = counts.get("navigate", 0) / cat_total * 100
        rows.append((nav_rate, cat, counts.get("navigate", 0), cat_total))
    for nav_rate, cat, nav, cat_total in sorted(rows):
        print(f"  {nav_rate:5.1f}%  {cat:35s} (navigate {nav}/{cat_total})")

    print(f"\n상세 로그: {log_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
