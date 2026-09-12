#!/usr/bin/env python3
"""
tools/check_site_manifest_sync.py
----------------------------------
site-manifest.json이 desktop.html의 실제 내비게이션(MEGA_MENU_SECTIONS +
STANDALONE_PAGES)과 어긋나 있으면 CI를 실패시킨다.

배경(2026-09-13): "혼디 숫자 코드" 메뉴 항목이 desktop.html엔 있었지만
site-manifest.json엔 등록되지 않아, 혼디 검색이 해당 질의에 엉뚱한
답을 낸 사고가 있었다. tools/check_capabilities_registry.py와 동일한
철학 — "갱신 원칙이 문서에 적혀 있다"는 것과 "실제로 지켜지고 있다"는
것은 다른 이야기이므로, 매번 직접 대조한다.

실제 생성/대조 로직은 tools/generate_site_manifest.py --check가 갖고
있다(단일 소스 원칙 — 생성기와 검증기가 각자 파서를 갖고 있으면 그
자체가 또 다른 드리프트 원인이 된다). 이 스크립트는 CI 진입점 역할만
한다.

사용법: python3 tools/check_site_manifest_sync.py
종료 코드: 최신 상태면 0, 어긋나 있으면 1(CI 실패)
"""
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GENERATOR = REPO_ROOT / "tools" / "generate_site_manifest.py"


def main():
    result = subprocess.run(
        [sys.executable, str(GENERATOR), "--check"],
        cwd=REPO_ROOT,
    )
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
