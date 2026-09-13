#!/usr/bin/env python3
"""
tools/check_entity_type_coverage.py
------------------------------------
docs/ENTITY_TYPE_COVERAGE_REGISTRY_v1_0.md("profile-assistant의 entity_type
8종이 각각 트리거예시·카드포맷을 갖췄는가"의 단일 소스)의 각 항목은
"검증-트리거예시:"/"검증-카드포맷:" 줄에 "파일경로::문자열" 형식으로 실제
프롬프트 근거를 명시한다. 이 스크립트는 그 문자열이 실제로 그 파일 안에
있는지 매번 직접 확인한다.

배경(2026-09-13): 라이브 스모크테스트(profile_assistant_scenarios_
diverse_industries_20260913.json) #18에서, 서버 화이트리스트(worker.js)엔
있는 entity_type=consumer가 실제로는 [P1-INFER] 트리거예시도
[§PROFILE_CARD] 카드포맷도 SP 안에 하나도 없어 person으로 새는 게
확인됐다. "서버 화이트리스트에 값이 있다"는 것과 "SP가 그 값을 실제로
다룰 수 있다"는 것은 별개 주장이며, 이 스크립트는
tools/check_capabilities_registry.py와 동일한 철학(자기보고를 신뢰하지
않고 실측한다)을 entity_type 커버리지에도 적용한다.

사용법:
  python3 tools/check_entity_type_coverage.py
  python3 tools/check_entity_type_coverage.py --sp-file prompts/profile-assistant/profile-assistant-v2_31.txt
      (레지스트리에 적힌 프롬프트 파일 경로 대신 --sp-file로 지정한 파일을
       대상으로 검사한다 — 버전 간 비교/회귀 확인용. 레지스트리 항목 중
       "profile-assistant-v" 패턴을 포함한 파일 경로만 치환되고, 그 외
       경로는 레지스트리에 적힌 그대로 검사한다.)

종료 코드: 전부 확인되면 0, 하나라도 실패하면 1(CI 실패)
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
REGISTRY_FILE = ROOT / "docs" / "ENTITY_TYPE_COVERAGE_REGISTRY_v1_0.md"
VERIFY_LINE_RE = re.compile(r"^검증-(트리거예시|카드포맷):\s*(.+?)::(.+)$")
HEADING_RE = re.compile(r"^###\s+(.+)$")
PA_VERSION_RE = re.compile(r"profile-assistant-v")


def parse_registry(path: Path):
    """(entity_type, 검증종류, 파일경로, 문자열) 튜플 리스트를 반환한다."""
    entries = []
    current_type = "(제목 없음)"
    text = path.read_text(encoding="utf-8")
    for line in text.splitlines():
        h = HEADING_RE.match(line.strip())
        if h:
            current_type = h.group(1).strip()
            continue
        m = VERIFY_LINE_RE.match(line.strip())
        if m:
            kind, file_path, needle = m.group(1), m.group(2).strip(), m.group(3).strip()
            entries.append((current_type, kind, file_path, needle))
    return entries


def check_entry(file_path: str, needle: str) -> tuple[bool, str]:
    p = ROOT / file_path
    if not p.exists():
        return False, f"파일 자체가 없음: {file_path}"
    try:
        content = p.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return False, f"읽기 실패: {e}"
    if needle in content:
        return True, "OK"
    return False, f"'{needle}'가 {file_path} 안에 없음"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--sp-file",
        default=None,
        help="레지스트리의 profile-assistant-vX.txt 경로 대신 이 파일을 검사 대상으로 삼는다",
    )
    args = ap.parse_args()

    if not REGISTRY_FILE.exists():
        print(f"레지스트리 파일이 없음: {REGISTRY_FILE}", file=sys.stderr)
        sys.exit(1)

    entries = parse_registry(REGISTRY_FILE)
    if not entries:
        print("레지스트리에서 검증 항목을 하나도 찾지 못함 — 형식을 확인하십시오.", file=sys.stderr)
        sys.exit(1)

    types_seen = set()
    fail_count = 0
    for entity_type, kind, file_path, needle in entries:
        types_seen.add(entity_type)
        target = args.sp_file if (args.sp_file and PA_VERSION_RE.search(file_path)) else file_path
        ok, msg = check_entry(target, needle)
        status = "PASS" if ok else "FAIL"
        if not ok:
            fail_count += 1
        print(f"[{status}] {entity_type} / 검증-{kind}: {msg}")

    expected_types = {
        "person", "business", "institution", "org",
        "thing", "concept", "platform", "consumer",
    }
    missing_types = expected_types - types_seen
    for t in missing_types:
        print(f"[FAIL] {t} / 레지스트리에 항목 자체가 없음(8종 화이트리스트 중 누락)")
        fail_count += 1

    total = len(entries) + len(missing_types)
    print(f"\n{total - fail_count}/{total} 통과")
    sys.exit(1 if fail_count else 0)


if __name__ == "__main__":
    main()
