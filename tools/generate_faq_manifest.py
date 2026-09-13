#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_faq_manifest.py — src/gopang/ai/hondi-faq-router.js의
HONDI_FAQ_REGISTRY 배열을 파싱해 hondi-faq-manifest.json(레포 루트)을 생성한다.

왜 필요한가
-----------
HONDI_FAQ_REGISTRY(주제 id/label/file/triggers)는 원래 일반 AI 비서(AC/GWP)
전용으로 hondi-faq-router.js 안에만 있었다. 그런데 hondi-search-relay는
별도 저장소/Worker라 이 .js 파일을 그대로 import할 수 없다. site-manifest.json이
이미 쓰고 있는 패턴(레포 루트에 정적 JSON을 두고, GitHub Pages 미러링으로
https://hondi.net/<file>.json에서 그대로 서빙되게 하는 것)을 그대로 따라,
hondi-faq-manifest.json이라는 JSON 사본을 만든다.

"단일 소스" 원칙 — .js 배열이 여전히 마스터다. 이 스크립트는 그 배열을
읽어서 JSON을 "생성"할 뿐, 手동으로 JSON을 따로 유지보수하지 않는다.
레지스트리를 고칠 때는 항상 hondi-faq-router.js를 고친 뒤 이 스크립트를
다시 돌린다(추후 CI 가드 후보 — manifest.yml처럼 자동 재생성 + diff 체크).

사용법
------
    python3 tools/generate_faq_manifest.py
"""
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_JS = REPO_ROOT / "src/gopang/ai/hondi-faq-router.js"
OUTPUT_JSON = REPO_ROOT / "hondi-faq-manifest.json"

# HONDI_FAQ_REGISTRY 배열 리터럴 전체를 추출.
ARRAY_RE = re.compile(
    r"export const HONDI_FAQ_REGISTRY\s*=\s*(\[.*?\]);",
    re.DOTALL,
)

# 개별 항목: { id: '...', label: '...', file: '....txt', triggers: [ '...', ... ], }
ENTRY_RE = re.compile(
    r"\{\s*"
    r"id:\s*'([^']*)',\s*"
    r"label:\s*'([^']*)',\s*"
    r"file:\s*'([^']*)',\s*"
    r"triggers:\s*\[(.*?)\],?\s*"
    r"\}",
    re.DOTALL,
)

TRIGGER_STR_RE = re.compile(r"'((?:[^'\\]|\\.)*)'")


def _unescape_js_single_quoted(s: str) -> str:
    return s.replace("\\'", "'").replace('\\\\', '\\')


def parse_registry(js_text: str):
    m = ARRAY_RE.search(js_text)
    if not m:
        print("ERROR: HONDI_FAQ_REGISTRY 배열을 찾지 못했습니다.", file=sys.stderr)
        sys.exit(1)
    array_src = m.group(1)

    entries = []
    for em in ENTRY_RE.finditer(array_src):
        entry_id, label, file_, triggers_src = em.groups()
        triggers = [
            _unescape_js_single_quoted(t)
            for t in TRIGGER_STR_RE.findall(triggers_src)
        ]
        entries.append({
            "id": _unescape_js_single_quoted(entry_id),
            "label": _unescape_js_single_quoted(label),
            "file": file_,
            "triggers": triggers,
            # hondi-search-relay가 절대 URL로 이 파일을 fetch할 때 쓸 경로.
            # hondi-faq-router.js의 _SP_BASE와 동일한 값을 여기 명시적으로
            # 박아둔다 — 두 소비자(AC 내부 상대경로 fetch / 외부 저장소의
            # 절대경로 fetch)가 서로 다른 fetch 방식을 쓰더라도 "파일이 어디
            # 있는지"는 이 한 곳(base_path)에서만 정의되게 하기 위함.
            "base_path": "/prompts/HONDI-FAQ/",
        })
    return entries


def main():
    js_text = SOURCE_JS.read_text(encoding="utf-8")
    entries = parse_registry(js_text)
    if not entries:
        print("ERROR: 파싱된 항목이 0개입니다 — 정규식이 포맷 변경을 못 따라간 것일 수 있습니다.", file=sys.stderr)
        sys.exit(1)

    OUTPUT_JSON.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"OK: {len(entries)}개 항목 -> {OUTPUT_JSON.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
