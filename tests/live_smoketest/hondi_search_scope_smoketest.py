#!/usr/bin/env python3
"""
tests/live_smoketest/hondi_search_scope_smoketest.py
-------------------------------------------------------
혼디 검색(/hondi-search) LIVE 스모크테스트 — hondi-search-relay 배포
이후 실제 엔드포인트를 대상으로 실행한다(로컬 재구현이 아니라 실제
POST 호출).

이 하네스는 site-manifest.json 전수 커버리지 + 오늘(2026-09-13) 발견한
버그의 회귀 테스트 + scope 격리 검증을 함께 수행한다. 배경은
docs/HANDOFF_HONDI_SEARCH_RELAY_MIGRATION... 및 이번 세션 작업 참고.

이 저장소의 네트워크 정책상 개발 환경(예: 샌드박스)에서 hondi.net으로
직접 나가는 요청이 막혀 있을 수 있다 — 그 경우 이 스크립트는 사람이
실제 배포 후 자신의 머신/CI에서 실행한다.

Usage:
  python3 hondi_search_scope_smoketest.py \
      --manifest ../../site-manifest.json \
      --url https://hondi.net/hondi-search \
      --out ../../results/hondi-search-scope \
      [--sample 15]   # 전수 커버리지 케이스 수를 줄여 비용/시간 절감(디버깅용)
      [--category coverage_user,regression,scope_isolation]  # 특정 카테고리만
"""
import argparse
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path

import requests

DEFAULT_URL = "https://hondi.net/hondi-search"
MAX_RETRIES = 3
RETRY_BASE_SLEEP = 2
REQUEST_TIMEOUT = 20


# ── 고정 테스트 케이스 (매니페스트와 무관하게 항상 실행) ────────────
def fixed_cases(manifest_by_path):
    cases = []

    # 회귀 테스트 — 오늘 발견한 실패 케이스. site-manifest.json 갱신 전에는
    # '하이라이트 번호(1번, 2번...)' 명확화로 잘못 빠졌다.
    scenarios_entry = manifest_by_path.get("/scenarios")
    if scenarios_entry:
        cases.append({
            "id": "regression-hondi-digit-code",
            "category": "regression",
            "scope": "user",
            "message": "혼디 사이트에서 혼디 숫자 코드 페이지를 찾아주세요",
            "expected_type": "navigate",
            "expected_url": scenarios_entry["pc_url"],
        })

    # 모호성 테스트 — 기존 §1-1 규칙("OO 검색"류) 유지 확인
    cases.append({
        "id": "ambiguity-mail-search",
        "category": "ambiguity",
        "scope": "user",
        "message": "메일 검색",
        "expected_type": "clarify",
    })

    # 무후보 테스트 — 두 스코프 모두에 없는 질의. 억지 매칭하지 않고
    # 정직하게 clarify해야 한다(§3-2 신설 규칙의 핵심 검증 대상).
    cases.append({
        "id": "no-candidate-nonsense",
        "category": "no_candidate",
        "scope": "user",
        "message": "화성 이주 신청서 접수 페이지 어디 있어요",
        "expected_type": "clarify",
    })
    cases.append({
        "id": "no-candidate-nonsense-dev",
        "category": "no_candidate",
        "scope": "dev",
        "message": "화성 이주 신청서 접수 페이지 어디 있어요",
        "expected_type": "clarify",
    })

    # 스코프 격리 테스트 — dev 전용 문서를 user 스코프로 물었을 때
    # 그 문서로 새지 않아야 한다(오늘 설계의 핵심 목적).
    dev_sample = next(
        (e for e in manifest_by_path.values()
         if e["audience"] == "dev" and "SESSION_LESSONS" in e["path"]),
        None,
    )
    if dev_sample:
        cases.append({
            "id": "scope-isolation-dev-doc-via-user",
            "category": "scope_isolation",
            "scope": "user",
            "message": dev_sample["title"],
            "expected_type": None,  # navigate/clarify 무관 — 아래 forbidden_url만 확인
            "forbidden_url": dev_sample["pc_url"],
        })

    user_sample = next(
        (e for e in manifest_by_path.values()
         if e["audience"] == "user" and e["path"] == "/scenarios"),
        None,
    )
    if user_sample:
        cases.append({
            "id": "scope-isolation-user-page-via-dev",
            "category": "scope_isolation",
            "scope": "dev",
            "message": user_sample["title"],
            "expected_type": None,
            "forbidden_url": user_sample["pc_url"],
        })

    # 최근순 테스트(개발자 스코프 전용) — date 필드가 있는 항목 중
    # 가장 최근 것을 "최근" 질의로 찾을 수 있는지 확인. 정확히 그
    # 문서로 navigate하지 않아도(다른 최근 문서와 혼동 가능) 최소한
    # date 없는 오래된 참조 매뉴얼로 새지는 않아야 하므로, 여기서는
    # type만 확인하고 결과는 사람이 최종 판단한다(자동 PASS/FAIL 대상
    # 아님 — REVIEW로 표시).
    cases.append({
        "id": "recency-dev-recent-incident",
        "category": "recency",
        "scope": "dev",
        "message": "최근에 있었던 인시던트 뭐 있었어",
        "expected_type": "REVIEW",  # 사람 검토 필요, 자동 채점 제외
    })

    return cases


# ── 매니페스트 전수 커버리지 케이스 생성 ──────────────────────────
CLEAN_RE = re.compile(r"[↗()]")


def coverage_cases(manifest, scope, sample=None):
    entries = [e for e in manifest if e["audience"] == scope]
    if sample:
        entries = entries[:sample]
    cases = []
    for e in entries:
        query = CLEAN_RE.sub(" ", e["title"]).strip()
        cases.append({
            "id": f"coverage-{scope}-{e['path']}",
            "category": f"coverage_{scope}",
            "scope": scope,
            "message": query,
            "expected_type": "navigate",
            "expected_url": e["pc_url"],
        })
    return cases


def call_search(url, message, scope, conversation_id=None):
    body = {
        "conversation_id": conversation_id or str(uuid.uuid4()),
        "message": message,
        "scope": scope,
    }
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            res = requests.post(url, json=body, timeout=REQUEST_TIMEOUT)
            res.raise_for_status()
            return res.json()
        except Exception as e:  # noqa: BLE001 — 재시도 대상이라 광범위하게 잡음
            last_err = e
            time.sleep(RETRY_BASE_SLEEP * (attempt + 1))
    raise RuntimeError(f"요청 실패(재시도 {MAX_RETRIES}회 소진): {last_err}")


def grade(case, response):
    """(passed: bool|None, reason: str). passed=None이면 사람 검토 대상(REVIEW)."""
    if case.get("expected_type") == "REVIEW":
        return None, f"사람 검토 필요 — 응답: {json.dumps(response, ensure_ascii=False)}"

    actual_type = response.get("type")
    actual_url = response.get("url")

    if "forbidden_url" in case:
        if actual_url == case["forbidden_url"]:
            return False, f"금지된 URL로 navigate함: {actual_url}"
        return True, f"격리 확인됨 (type={actual_type}, url={actual_url})"

    if case["expected_type"] != actual_type:
        return False, f"기대 type={case['expected_type']}, 실제 type={actual_type}"

    if case["expected_type"] == "navigate":
        if actual_url != case["expected_url"]:
            return False, f"기대 url={case['expected_url']}, 실제 url={actual_url}"

    return True, "OK"


def load_query_suite(path, manifest_by_path):
    """50개 큐레이션 질의 파일(hondi_search_50_query_suite.json 등)을
    런타임 케이스 형식으로 변환한다. expected_path/forbidden_path를
    매니페스트에서 조회해 실제 pc_url로 치환 — 하드코딩된 URL 대신
    항상 최신 매니페스트를 기준으로 채점한다(과거 hondi-search.smoke.js가
    겪은 것과 같은 유형의 결함을 피하기 위함)."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    cases = []
    for c in raw["cases"]:
        case = {
            "id": c["id"],
            "category": c.get("category", "suite"),
            "scope": c.get("override_scope", c["scope"]),
            "message": c["message"],
            "expected_type": c.get("expected_type"),
        }
        if c.get("expected_path"):
            entry = manifest_by_path.get(c["expected_path"])
            if not entry:
                print(f"[경고] {c['id']}: expected_path={c['expected_path']!r}가 "
                      f"현재 매니페스트에 없습니다 — 케이스를 건너뜁니다", file=sys.stderr)
                continue
            case["expected_url"] = entry["pc_url"]
        if c.get("forbidden_path"):
            entry = manifest_by_path.get(c["forbidden_path"])
            if entry:
                case["forbidden_url"] = entry["pc_url"]
        cases.append(case)
    return cases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="../../site-manifest.json")
    ap.add_argument("--url", default=os.environ.get("HONDI_SEARCH_URL", DEFAULT_URL))
    ap.add_argument("--out", default="../../results/hondi-search-scope")
    ap.add_argument("--sample", type=int, default=None,
                     help="전수 커버리지 케이스를 스코프별 N개로 제한(디버깅용)")
    ap.add_argument("--category", default=None,
                     help="쉼표로 구분된 카테고리만 실행 (예: regression,scope_isolation)")
    ap.add_argument("--query-suite", default=None,
                     help="큐레이션 질의 파일 경로(예: hondi_search_50_query_suite.json). "
                          "지정하면 전수 커버리지 대신 이 파일의 케이스만 실행한다.")
    args = ap.parse_args()

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    manifest_by_path = {e["path"]: e for e in manifest}

    if args.query_suite:
        cases = load_query_suite(args.query_suite, manifest_by_path)
    else:
        cases = (
            fixed_cases(manifest_by_path)
            + coverage_cases(manifest, "user", args.sample)
            + coverage_cases(manifest, "dev", args.sample)
        )

    if args.category:
        wanted = set(args.category.split(","))
        cases = [c for c in cases if c["category"] in wanted]

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    log_path = out_dir / "live_results.jsonl"

    results = {"PASS": 0, "FAIL": 0, "REVIEW": 0}
    failures = []

    with log_path.open("w", encoding="utf-8") as log_f:
        for i, case in enumerate(cases, 1):
            try:
                response = call_search(args.url, case["message"], case["scope"])
                passed, reason = grade(case, response)
            except Exception as e:  # noqa: BLE001
                passed, reason, response = False, f"요청 예외: {e}", {}

            if passed is None:
                results["REVIEW"] += 1
                status = "REVIEW"
            elif passed:
                results["PASS"] += 1
                status = "PASS"
            else:
                results["FAIL"] += 1
                status = "FAIL"
                failures.append({"case": case, "reason": reason, "response": response})

            log_f.write(json.dumps(
                {"case": case, "status": status, "reason": reason, "response": response},
                ensure_ascii=False,
            ) + "\n")
            log_f.flush()

            print(f"[{i}/{len(cases)}] {status:6s} {case['id']:45s} — {reason}")

    total = sum(results.values())
    scored = results["PASS"] + results["FAIL"]
    pct = (results["PASS"] / scored * 100) if scored else 0.0

    print("\n" + "=" * 60)
    print(f"PASS={results['PASS']} FAIL={results['FAIL']} REVIEW={results['REVIEW']} "
          f"(총 {total}건, 채점 대상 {scored}건 중 {pct:.1f}% PASS)")
    print(f"상세 로그: {log_path}")

    if failures:
        print("\n--- 실패 상세 ---")
        for f in failures:
            print(f"  {f['case']['id']} [{f['case']['category']}]: {f['reason']}")

    return 1 if results["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
