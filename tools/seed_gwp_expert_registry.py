#!/usr/bin/env python3
"""
seed_gwp_expert_registry.py — 핵심 GWP·EXPERT를 profiles 엔티티로 등록
(안전장치, 2026-08-03 주피터 지시)

배경: §1 제1원칙("모든 사용자는 SP다") 관점에서 AC는 핵심 GWP(27개)·
EXPERT(63개)를 §CATALOG 표로 이미 알고 있어 K-Search를 거칠 필요가
없다 — 하지만 주피터 지시에 따라 "K-Search를 거칠 이유가 없더라도"
안전장치로 profiles에도 등록해, 향후 어떤 경로로든(다른 SP의 위임,
사고실험 등) 이들을 찾아야 할 때 K-Search가 실제로 찾을 수 있게 한다.

entity_type='platform', entity_subtype='gwp:{id}' 또는 'expert:{personaId}'
로 등록한다 — gwp-registry.js의 _resolveEntityGwp()가 'gwp:' 접두사는
core 레지스트리로 pass-through하도록 이미 연결해뒀다(2026-08-03 패치).
'expert:' 접두사는 검색은 되지만 [GWP: guid] 발사 연결은 아직 안 됐다
(EXPERT는 새 탭이 아니라 같은 탭 시스템 프롬프트 교체 방식이라 별도
배선 필요 — 후속 과제, 정직하게 표시).

소스:
  - gwp-registry.js의 GWP_REGISTRY 배열(정규식 기반 블록 추출)
  - src/gopang/ai/expert-registry.js의 EXPERT_REGISTRY 객체
"""
import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gov_seed_common import find_existing_guid  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
GWP_FILE = REPO_ROOT / "gwp-registry.js"
EXPERT_FILE = REPO_ROOT / "src" / "gopang" / "ai" / "expert-registry.js"
RUN_LOG = REPO_ROOT / "docs" / "GWP-EXPERT-REGISTRY-SEEDING-RUN_2026-08-03.md"


def _extract_brace_blocks(text, start_marker, end_marker):
    """start_marker 뒤에서 end_marker 전까지, 톱레벨 '{...}' 블록들을
    중괄호 깊이 추적으로 추출한다(정규식만으로는 nested object 안전하게
    못 자름 — 이 파일들의 항목엔 nested 객체/배열이 있어서 depth 추적이
    필수)."""
    body = text.split(start_marker, 1)[1]
    if end_marker:
        body = body.split(end_marker, 1)[0]
    blocks = []
    depth = 0
    buf = []
    in_block = False
    for ch in body:
        if ch == '{':
            if depth == 0:
                in_block = True
                buf = []
            depth += 1
        if in_block:
            buf.append(ch)
        if ch == '}':
            depth -= 1
            if depth == 0 and in_block:
                blocks.append(''.join(buf))
                in_block = False
    return blocks


def collect_gwp_records():
    text = GWP_FILE.read_text(encoding="utf-8")
    blocks = _extract_brace_blocks(text, "const GWP_REGISTRY = [", "\nconst SVC_ID_ALIAS")
    records = []
    for b in blocks:
        idm = re.search(r"id:\s*'([\w-]+)'", b)
        namem = re.search(r"name:\s*'([^']*)'", b)
        catm = re.search(r"category:\s*'([^']*)'", b)
        descm = re.search(r"description:\s*'([^']*)'", b)
        statusm = re.search(r"status:\s*'([^']*)'", b)
        if not idm or not namem:
            continue
        # status='pending'인 core 항목(예: ksearch)은 아직 실사용 배포
        # 전이므로 검색 노출은 시켜도 되지만(주피터 지시엔 "모두 등록"
        # 이라 있음), 혼동 방지로 tags에 남겨 구분한다 — 제외하지 않는다.
        records.append({
            "gwp_id": idm.group(1),
            "name": namem.group(1),
            "category": catm.group(1) if catm else "",
            "description": descm.group(1) if descm else "",
            "core_status": statusm.group(1) if statusm else "",
        })
    return records


def collect_expert_records():
    text = EXPERT_FILE.read_text(encoding="utf-8")
    marker = "export const EXPERT_REGISTRY = {"
    body = text.split(marker, 1)[1]
    body = body.split("\nexport function", 1)[0]  # 객체 끝난 뒤 export function들 제외

    # 톱레벨 항목은 정확히 2칸 들여쓰기로 시작한다(파일 전체 확인).
    # 키에 하이픈이 있으면(judicial-scrivener 등) JS 문법상 반드시
    # 따옴표로 감싸야 하므로 '?...'? 로 둘 다 허용한다(실사로 확인 —
    # 순수 정규식만으로는 처음에 63개 중 22개만 잡혔던 원인이었다).
    starts = [m.start() for m in re.finditer(r"^  '?([a-zA-Z][\w-]*)'?: \{", body, re.M)]
    ids = re.findall(r"^  '?([a-zA-Z][\w-]*)'?: \{", body, re.M)
    records = []
    for idx, (persona_id, s) in enumerate(zip(ids, starts)):
        e = starts[idx + 1] if idx + 1 < len(starts) else len(body)
        block = body[s:e]
        labelm = re.search(r"label:\s*'([^']*)'", block)
        catm = re.search(r"category:\s*'([^']*)'", block)
        ownerm = re.search(r"ownerAgency:\s*'([^']*)'", block)
        if labelm:
            records.append({
                "persona_id": persona_id,
                "label": labelm.group(1),
                "category": catm.group(1) if catm else "",
                "owner_agency": ownerm.group(1) if ownerm else "",
            })
    return records


def build_gwp_payload(rec):
    return {
        "entity_type": "platform",
        "name": rec["name"],
        "description": rec["description"] or f"{rec['name']} — 나비 핵심 GWP 서비스",
        "tags": ["core-gwp", rec["category"]] + (["core-status:" + rec["core_status"]] if rec["core_status"] else []),
        "occupation": "AI 서비스",
        "entity_subtype": f"gwp:{rec['gwp_id']}",
        "claim_source": "gwp_core_seed",
        "claim_status": "unclaimed",
    }


def build_expert_payload(rec):
    return {
        "entity_type": "platform",
        "name": rec["label"],
        "description": f"{rec['label']} AI 전문가 페르소나(카테고리: {rec['category']}, 소속: {rec['owner_agency']})",
        "tags": ["core-expert", rec["category"]],
        "occupation": "AI 전문가 페르소나",
        "entity_subtype": f"expert:{rec['persona_id']}",
        "claim_source": "expert_core_seed",
        "claim_status": "unclaimed",
    }


def post_profile(worker_base, payload):
    req = urllib.request.Request(
        f"{worker_base.rstrip('/')}/profile",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/126.0.0.0 Safari/537.36",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--worker-base", default=os.environ.get(
        "WORKER_BASE", "https://hondi-proxy.tensor-city.workers.dev"))
    ap.add_argument("--force", action="store_true",
                     help="이미 등록된 항목도 확인 없이 강제로 새로 POST(위험 — "
                          "중복 생성됨). 기본은 꺼짐.")
    args = ap.parse_args()

    gwp_records = collect_gwp_records()
    expert_records = collect_expert_records()
    print(f"핵심 GWP {len(gwp_records)}건, EXPERT {len(expert_records)}건 — 합계 {len(gwp_records) + len(expert_records)}건")

    if not args.apply:
        print("\n[DRY-RUN] --apply 없이 실행됨 — 미리보기 3건씩:")
        for r in gwp_records[:3]:
            print(json.dumps(build_gwp_payload(r), ensure_ascii=False, indent=2))
        for r in expert_records[:3]:
            print(json.dumps(build_expert_payload(r), ensure_ascii=False, indent=2))
        return

    results = {"success": [], "failed": [], "skipped_existing": []}
    for rec in gwp_records:
        gov_code = f"gwp:{rec['gwp_id']}"
        if not args.force:
            try:
                existing = find_existing_guid(
                    args.worker_base, rec["name"], gov_code, rec["gwp_id"], entity_type="platform")
            except Exception as e:
                print(f"  [SKIP-UNCERTAIN] {gov_code} — 기존 등록 여부 확인 실패({e}), 건너뜀.",
                      file=sys.stderr)
                results["skipped_existing"].append({"id": gov_code, "reason": f"check_failed: {e}"})
                continue
            if existing:
                print(f"  [SKIP-EXISTS] {gov_code} — 이미 등록됨 → {existing}")
                results["skipped_existing"].append({"id": gov_code, "guid": existing})
                continue
        payload = build_gwp_payload(rec)
        try:
            body = post_profile(args.worker_base, payload)
            results["success"].append({"id": f"gwp:{rec['gwp_id']}", "guid": body.get("guid")})
            print(f"  [OK] gwp:{rec['gwp_id']} → {body.get('guid')}")
        except Exception as e:
            detail = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
            results["failed"].append({"id": f"gwp:{rec['gwp_id']}", "error": detail})
            print(f"  [FAIL] gwp:{rec['gwp_id']} — {detail}", file=sys.stderr)

    for rec in expert_records:
        gov_code = f"expert:{rec['persona_id']}"
        if not args.force:
            try:
                existing = find_existing_guid(
                    args.worker_base, rec["label"], gov_code, rec["persona_id"], entity_type="platform")
            except Exception as e:
                print(f"  [SKIP-UNCERTAIN] {gov_code} — 기존 등록 여부 확인 실패({e}), 건너뜀.",
                      file=sys.stderr)
                results["skipped_existing"].append({"id": gov_code, "reason": f"check_failed: {e}"})
                continue
            if existing:
                print(f"  [SKIP-EXISTS] {gov_code} — 이미 등록됨 → {existing}")
                results["skipped_existing"].append({"id": gov_code, "guid": existing})
                continue
        payload = build_expert_payload(rec)
        try:
            body = post_profile(args.worker_base, payload)
            results["success"].append({"id": f"expert:{rec['persona_id']}", "guid": body.get("guid")})
            print(f"  [OK] expert:{rec['persona_id']} → {body.get('guid')}")
        except Exception as e:
            detail = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
            results["failed"].append({"id": f"expert:{rec['persona_id']}", "error": detail})
            print(f"  [FAIL] expert:{rec['persona_id']} — {detail}", file=sys.stderr)

    RUN_LOG.parent.mkdir(parents=True, exist_ok=True)
    import datetime
    is_rerun = RUN_LOG.exists()
    with open(RUN_LOG, "a" if is_rerun else "w", encoding="utf-8") as f:
        if is_rerun:
            f.write(f"\n\n---\n\n## 재실행 {datetime.datetime.now().isoformat(timespec='seconds')}\n\n")
        else:
            f.write("# GWP-EXPERT-REGISTRY-SEEDING-RUN_2026-08-03.md\n\n")
        f.write(f"성공 {len(results['success'])}건 / 스킵(기존 등록) "
                f"{len(results['skipped_existing'])}건 / 실패 {len(results['failed'])}건\n\n## 성공\n")
        for r in results["success"]:
            f.write(f"- {r['id']} → {r['guid']}\n")
        f.write("\n## 스킵(이미 등록돼 있어 건너뜀 — 중복 방지)\n")
        for r in results["skipped_existing"]:
            if "guid" in r:
                f.write(f"- {r['id']} → 기존 {r['guid']}\n")
            else:
                f.write(f"- {r['id']}: {r['reason']}\n")
        f.write("\n## 실패\n")
        for r in results["failed"]:
            f.write(f"- {r['id']}: {r['error']}\n")
    print(f"\n로그 기록: {RUN_LOG}")


if __name__ == "__main__":
    main()
