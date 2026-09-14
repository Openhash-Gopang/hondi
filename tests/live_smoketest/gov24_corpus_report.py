#!/usr/bin/env python3
"""
tests/live_smoketest/gov24_corpus_report.py
--------------------------------------------
gov24_corpus_live_smoketest.mjs가 만드는 results/gov24_corpus_smoketest_<batch>/
results.json을 note(정부24 명시 소관기관)와 나란히 놓고 사람이 빠르게 스캔할
수 있는 표로 만든다.

## 왜 자동 PASS/FAIL이 아닌가
gov24_corpus_live_smoketest.mjs가 호출하는 gov-router.js는 "제주 지방행정"
라우터다 — note의 "소관기관(정부24 명시)"은 국토교통부·국세청 같은 **중앙부처**
이지만, 실제 창구는 그 부처 산하의 **지역 사무소나 위임받은 지자체 부서**인
경우가 많다(오늘 institution 계층 테스트에서 kregionalgov가 "국가기관
지역사무소"까지 이미 포함하도록 설계돼 있었다는 걸 뒤늦게 확인한 것과 같은
교훈). "trace에 '국토교통부'라는 문자열이 그대로 없으면 FAIL"처럼 채점하면
그 교훈을 무시하고 똑같은 오류를 반복하게 된다 — 그래서 이 스크립트는
자동 판정을 하지 않는다. 대신:
  1. 명백히 문제인 것(라우팅 자체가 실패·크래시·NONE·CLARIFY로 끝난 것)만
     NEEDS-ATTENTION으로 자동 플래그한다 — 이건 중앙/지방 구분과 무관하게
     항상 문제다.
  2. 나머지는 전부 note와 trace/agency를 나란히 보여주는 표로만 내놓는다 —
     "이 라우팅이 실제로 맞는 창구인가"의 최종 판단은 사람이 한다.

## 사용법
7개 배치를 전부(또는 원하는 만큼) 돌린 뒤:
  python3 gov24_corpus_report.py \
      --results ../../results/gov24_corpus_smoketest_scenarios_gov24_corpus_batch1_20260823,../../results/gov24_corpus_smoketest_scenarios_gov24_corpus_batch2_20260823 \
      --out ../../results/gov24_corpus_report.md
(콤마로 여러 배치의 results 디렉터리를 한 번에 넘길 수 있다. 디렉터리 안의
results.json을 읽는다.)
"""
import argparse
import json
import os
import re


def extract_expected_agency(note):
    m = re.search(r"소관기관\(정부24 명시\):\s*([^—]+?)\s*—", note or "")
    return m.group(1).strip() if m else "(파싱 실패)"


def load_results(dirs):
    all_results = []
    for d in dirs:
        path = os.path.join(d.strip(), "results.json")
        if not os.path.exists(path):
            print(f"[경고] 없음, 건너뜀: {path}")
            continue
        with open(path, encoding="utf-8") as f:
            batch = json.load(f)
        batch_name = os.path.basename(d.strip())
        for r in batch:
            r["_batch"] = batch_name
        all_results.extend(batch)
    return all_results


def flag(r):
    """명백한 문제만 자동 플래그 — 중앙/지방 판단은 안 한다."""
    if r.get("error"):
        return "NEEDS-ATTENTION", f"크래시: {r['error']}"
    trace = r.get("trace") or []
    agency = r.get("agency")
    if not trace:
        return "NEEDS-ATTENTION", "trace 비어 있음 — 라우팅 자체가 안 됨"
    if any("NONE" in t for t in trace) or agency == "NONE":
        return "NEEDS-ATTENTION", "분류 실패(NONE)"
    if any(t.startswith("CLARIFY") for t in trace):
        return "REVIEW", "두 후보 사이에서 CLARIFY(되묻기) 발동 — 정상일 수도 있음"
    if r.get("needsClarification"):
        nc = r["needsClarification"]
        label = "위치 되묻기" if nc.get("isLocationQuestion") else "되묻기"
        return "REVIEW", f"{label} 발동: {nc.get('question', '')}"
    return "REVIEW", "사람 대조 필요(자동 판정 없음)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True, help="results 디렉터리 경로들(콤마 구분)")
    ap.add_argument("--out", default="../../results/gov24_corpus_report.md")
    args = ap.parse_args()

    dirs = args.results.split(",")
    results = load_results(dirs)
    print(f"{len(results)}건 로드됨 ({len(dirs)}개 배치)")

    rows = []
    for r in results:
        expected = extract_expected_agency(r.get("note", ""))
        status, note = flag(r)
        rows.append({
            "id": r["id"],
            "batch": r["_batch"],
            "utterance": r["utterance"],
            "expected_agency": expected,
            "resolved_agency": r.get("agency") or "(없음)",
            "trace": " > ".join(r.get("trace") or []),
            "status": status,
            "auto_note": note,
        })

    attention = [x for x in rows if x["status"] == "NEEDS-ATTENTION"]
    review = [x for x in rows if x["status"] == "REVIEW"]

    print(f"\n=== 자동 플래그 요약 ===")
    print(f"  NEEDS-ATTENTION(명백한 실패): {len(attention)}")
    print(f"  REVIEW(사람 대조 필요): {len(review)}")

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(f"# 정부24 코퍼스 라우팅 결과 대조표\n\n")
        f.write(f"총 {len(rows)}건 — NEEDS-ATTENTION {len(attention)} / REVIEW {len(review)}\n\n")

        if attention:
            f.write("## 🔴 NEEDS-ATTENTION (라우팅 자체가 실패 — 우선 확인)\n\n")
            f.write("| id | 발화 | 기대 소관기관 | trace | 사유 |\n|---|---|---|---|---|\n")
            for x in attention:
                f.write(f"| {x['id']} | {x['utterance']} | {x['expected_agency']} | "
                        f"{x['trace']} | {x['auto_note']} |\n")
            f.write("\n")

        f.write("## 🟡 REVIEW (자동 판정 없음 — note와 trace/agency를 직접 대조)\n\n")
        f.write("| id | 배치 | 발화 | 기대 소관기관(정부24) | 실제 resolved agency | trace |\n")
        f.write("|---|---|---|---|---|---|\n")
        for x in sorted(review, key=lambda r: r["expected_agency"]):
            f.write(f"| {x['id']} | {x['batch']} | {x['utterance']} | "
                    f"{x['expected_agency']} | {x['resolved_agency']} | {x['trace']} |\n")

    print(f"\n표 저장: {args.out}")
    print("NEEDS-ATTENTION부터 먼저 보시고, REVIEW는 expected_agency로 정렬돼 있으니")
    print("같은 부처끼리 묶어서 훑으면 패턴(예: 특정 부처만 계속 이상하게 감)을 빠르게 잡을 수 있습니다.")


if __name__ == "__main__":
    main()
