#!/usr/bin/env python3
"""
tools/check_capabilities_registry.py
-----------------------------------
prompts/HONDI-CAPABILITIES-COMMON_v1_0.md("나비가 지금 실제로 할 수 있는
것"의 단일 소스)의 각 항목은 `검증-서버:`/`검증-클라이언트:` 줄에
"파일경로::문자열" 형식으로 실제 코드 근거를 명시한다. 이 스크립트는
그 문자열이 실제로 그 파일 안에 있는지 매번 직접 확인한다.

배경(2026-07-27): profile-assistant SP에 "실재하는 도구만 제안하라"는
원칙(§DIGITAL-BRIDGE)을 넣는 과정에서, call-ai.js에는 [TEMPLATE_LOOKUP]
태그 처리가 있었지만 pages/profile-assistant.html(PA가 실제로 실행되는
파일)에는 2026-07-17 태그 개편 이후 그 코드가 한 번도 반영되지 않아 PA가
내는 태그가 실제로는 아무 데서도 처리되지 않는 상태였다 — "이 기능이
있다"는 주장이 한쪽 파일 기준으론 참, 다른 쪽 기준으론 거짓이었던
사례다. tools/check_wallet_sync.py와 동일한 철학(자기보고를 신뢰하지
않고 실측한다)을 SP의 "역량 주장"에도 적용한다.

사용법: python3 tools/check_capabilities_registry.py
종료 코드: 전부 확인되면 0, 하나라도 실패하면 1(CI 실패)
"""
import re
import sys
from pathlib import Path

REGISTRY_FILE = "prompts/HONDI-CAPABILITIES-COMMON_v1_0.md"
VERIFY_LINE_RE = re.compile(r"^검증-(서버|클라이언트):\s*(.+?)::(.+)$")
HEADING_RE = re.compile(r"^###\s+(.+)$")


def parse_registry(path: str):
    """(항목명, 검증종류, 파일경로, 문자열) 튜플 리스트를 반환한다."""
    entries = []
    current_heading = "(제목 없음)"
    text = Path(path).read_text(encoding="utf-8")
    for line in text.splitlines():
        h = HEADING_RE.match(line.strip())
        if h:
            current_heading = h.group(1).strip()
            continue
        m = VERIFY_LINE_RE.match(line.strip())
        if m:
            kind, file_path, needle = m.group(1), m.group(2).strip(), m.group(3).strip()
            entries.append((current_heading, kind, file_path, needle))
    return entries


def check_entry(file_path: str, needle: str) -> tuple[bool, str]:
    p = Path(file_path)
    if not p.exists():
        return False, f"파일 자체가 없음: {file_path}"
    try:
        content = p.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return False, f"읽기 실패: {e}"
    if needle in content:
        return True, "OK"
    return False, f"'{needle}'가 {file_path} 안에 없음"


def main() -> int:
    if not Path(REGISTRY_FILE).exists():
        print(f"❌ 레지스트리 파일을 찾을 수 없음: {REGISTRY_FILE}")
        return 1

    entries = parse_registry(REGISTRY_FILE)
    if not entries:
        print(f"⚠ {REGISTRY_FILE}에서 검증 가능한 항목을 하나도 찾지 못함 — "
              f"'검증-서버:'/'검증-클라이언트:' 줄 형식을 확인할 것.")
        return 1

    print(f"{REGISTRY_FILE} — {len(entries)}개 검증 항목 확인 중\n")

    failures = []
    for heading, kind, file_path, needle in entries:
        ok, detail = check_entry(file_path, needle)
        status = "OK" if ok else "FAIL"
        print(f"  [{status:4s}] {heading} ({kind}) — {file_path}::{needle}")
        if not ok:
            failures.append((heading, kind, file_path, needle, detail))

    print()
    if failures:
        print(f"❌ {len(failures)}개 항목이 실제 코드와 어긋남:")
        for heading, kind, file_path, needle, detail in failures:
            print(f"   - [{heading} / {kind}] {detail}")
        print()
        print("   HONDI-CAPABILITIES-COMMON이 주장하는 기능이 실제로 사라졌거나")
        print("   경로/문자열이 바뀌었을 수 있습니다 — SP가 실재하지 않는 기능을")
        print("   사용자에게 '됩니다'라고 말하게 될 위험이 있으니, 코드를 되돌리든")
        print("   문서를 갱신하든 반드시 조치가 필요합니다.")
        return 1

    print("✅ 모든 항목이 실제 코드와 일치합니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
