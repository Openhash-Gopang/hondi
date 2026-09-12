#!/usr/bin/env python3
"""
tools/generate_site_manifest.py
--------------------------------
혼디 검색(/hondi-search)이 참조하는 site-manifest.json을 desktop.html의
실제 내비게이션 구조에서 "자동 생성"한다 — 손으로 쓰는 매니페스트는
구조적으로 누락이 발생한다(2026-09-13, "혼디 숫자 코드" 페이지 검색
실패 사고가 그 증거: 메가메뉴엔 있었지만 수기 매니페스트엔 없었음).

소스 3곳을 통합한다:
  1. desktop.html의 MEGA_MENU_SECTIONS(JS 변수, JSON으로 파싱)
  2. desktop.html의 STANDALONE_PAGES 배열(메가메뉴에 링크가 없는
     SPA 오버레이 페이지 — 예: klaw, usage-guide, expert-personas 등)
  3. K-서비스 서브도메인 레지스트리(메가메뉴 "서비스" 섹션에서 자동
     추출되므로 별도 목록 불필요 — 현재는 1과 겹침)

audience 분류 원칙:
  "🛠 개발자 문서" / "⚠ 주의" 섹션 → dev
  그 외 전부 → user
(desktop.html 섹션 라벨이 바뀌면 DEV_SECTION_LABELS만 갱신하면 된다.)

사용법:
  python3 tools/generate_site_manifest.py            # site-manifest.json 갱신
  python3 tools/generate_site_manifest.py --check     # 갱신 없이 diff만 표시, 변경 있으면 exit 1
                                                         (tools/check_site_manifest_sync.py가 이 모드로 CI에서 호출)
"""
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DESKTOP_HTML = REPO_ROOT / "desktop.html"
MANIFEST_PATH = REPO_ROOT / "site-manifest.json"

DEV_SECTION_LABELS = {"🛠 개발자 문서", "⚠ 주의"}

# loadPage() 이외의 onclick 핸들러 — 페이지 이동이 아니라 같은 화면의
# 오버레이를 여는 함수라 자동 파싱으로는 목적지를 알 수 없다. 발견될
# 때마다 여기 수동으로 추가한다(현재 desktop.html 전수 확인 결과 1건).
# pc_url은 오버레이가 뜨는 "같은 페이지"를 가리킬 뿐, 딥링크로 자동
# 오픈되는 것은 아니다 — _openUserDashboard()는 KAuth.ensureLogin()으로
# 로그인부터 요구하므로 검색 결과 클릭만으로 오버레이가 바로 열리지
# 않는다는 한계를 description에 명시한다.
KNOWN_ONCLICK_TARGETS = {
    "_openUserDashboard": {
        "path": "/user-dashboard",
        "pc_url": "https://hondi.net/desktop.html",
        "note": "(로그인 필요 — 페이지 이동 후 우측 상단 대시보드 버튼을 다시 눌러야 함)",
    },
}

# 날짜 파싱: "(0912)", "(2026-09-03)", "20260909" 등 제목에 박힌 표기 대응
DATE_RE_FULL = re.compile(r"(20\d{2})-?(\d{2})-?(\d{2})")
DATE_RE_SHORT = re.compile(r"\((\d{2})(\d{2})\)")  # (0912) → 09-12, 연도 미상

# 제목 정제용 — 화살표·괄호 요약·구두점을 keywords 추출 전에 제거
CLEAN_MARKS_RE = re.compile(r"[↗()·►]")
SPLIT_RE = re.compile(r"[,\-–—/]|\s{2,}")


def load_mega_menu_sections():
    text = DESKTOP_HTML.read_text(encoding="utf-8")
    m = re.search(r"var MEGA_MENU_SECTIONS = (\[.*?\]);", text, re.S)
    if not m:
        raise RuntimeError("MEGA_MENU_SECTIONS를 desktop.html에서 찾지 못했습니다")
    return json.loads(m.group(1))


def load_standalone_pages():
    text = DESKTOP_HTML.read_text(encoding="utf-8")
    m = re.search(r"const STANDALONE_PAGES = (\[.*?\]);", text)
    if not m:
        raise RuntimeError("STANDALONE_PAGES를 desktop.html에서 찾지 못했습니다")
    return json.loads(m.group(1).replace("'", '"'))


def extract_date(label: str):
    m = DATE_RE_FULL.search(label)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = DATE_RE_SHORT.search(label)
    if m:
        # 연도 미상 — 2026년으로 가정(이 문서 체계가 전부 2026년 기록이므로).
        # 다른 연도가 섞이기 시작하면 이 가정을 재검토해야 한다.
        return f"2026-{m.group(1)}-{m.group(2)}"
    return None


def derive_keywords(label: str, extra=()):
    cleaned = CLEAN_MARKS_RE.sub(" ", label)
    cleaned = DATE_RE_FULL.sub(" ", cleaned)
    cleaned = DATE_RE_SHORT.sub(" ", cleaned)
    parts = [p.strip() for p in SPLIT_RE.split(cleaned) if p.strip()]
    parts = [p for p in parts if len(p) > 1]
    # 전체 구(phrase) 키워드 외에, 부분 질의도 맞도록 공백 단위 단어도
    # 추가한다("혼디 숫자 코드" 전체 구 하나만 있으면 "숫자 코드"만
    # 물어본 질의를 놓칠 수 있다) — 단, 원본 label 자체가 이미 한 단어면
    # 중복이니 스킵.
    word_level = []
    for p in parts:
        word_level.extend(w for w in p.split() if len(w) > 1)
    seen = []
    for p in list(parts) + word_level + list(extra):
        if p not in seen:
            seen.append(p)
    return seen[:8]  # 과도한 키워드는 SP 매칭에 잡음만 늘리므로 상한


def onclick_to_pageid(onclick: str):
    m = re.search(r"loadPage\('([^']+)'\)", onclick or "")
    return m.group(1) if m else None


def normalize_href_path(href: str):
    if href.startswith("http"):
        return href  # 외부 URL(K-서비스 서브도메인, GitHub 등)은 그대로 식별자 겸용
    # './docs/x.html' 같은 상대경로 → '/docs/x.html'
    return "/" + href.lstrip("./")


def href_to_pc_url(href: str):
    if href.startswith("http"):
        return href
    return "https://hondi.net" + normalize_href_path(href)


def build_entries():
    sections = load_mega_menu_sections()
    standalone_ids = load_standalone_pages()

    entries = {}  # path -> entry, dict라서 중복 href 자동 dedup

    def add(path, title, pc_url, audience, keywords, source, label_for_date=None):
        if path in entries:
            return  # 먼저 등록된 항목 우선(메가메뉴가 1차 소스)
        entries[path] = {
            "path": path,
            "title": title,
            "description": title,  # 자동 초안 — 사람 검수 단계에서 다듬을 값
            "keywords": keywords,
            "pc_url": pc_url,
            "audience": audience,
            "source": source,
        }
        date = extract_date(label_for_date or title)
        if date:
            entries[path]["date"] = date

    def walk(items, audience):
        for it in items:
            if "items" in it:
                child_audience = (
                    "dev" if it.get("label") in DEV_SECTION_LABELS else audience
                )
                walk(it["items"], child_audience)
                continue

            label = it.get("label", "")
            onclick = it.get("onclick")
            href = it.get("href")

            if onclick:
                page_id = onclick_to_pageid(onclick)
                if page_id:
                    path = "/" + page_id
                    pc_url = f"https://hondi.net/desktop.html#{page_id}"
                    add(path, label, pc_url, audience, derive_keywords(label), "menu", label)
                    continue
                matched = next((fn for fn in KNOWN_ONCLICK_TARGETS if fn in onclick), None)
                if matched:
                    target = KNOWN_ONCLICK_TARGETS[matched]
                    entries_before = len(entries)
                    add(target["path"], label, target["pc_url"], audience,
                        derive_keywords(label), "menu_special", label)
                    if len(entries) > entries_before:
                        entries[target["path"]]["description"] = label + " " + target["note"]
                    continue
                # 알려지지 않은 onclick 패턴 — 조용히 넘기지 않고 표준에러로 알린다.
                # (다음 사람이 새 onclick 핸들러를 추가했는데 매니페스트가
                # 또 누락되는, 오늘과 같은 사고를 방지하기 위함.)
                print(f"[경고] 처리되지 않은 onclick 패턴: {onclick!r} (label={label!r}) "
                      f"— KNOWN_ONCLICK_TARGETS에 추가 검토 필요", file=sys.stderr)
            elif href and href != "#":
                path = normalize_href_path(href)
                pc_url = href_to_pc_url(href)
                add(path, label, pc_url, audience, derive_keywords(label), "menu", label)
            # href == '#'인데 onclick도 없는 경우는 순수 UI 트리거로 보고 스킵

    for section in sections:
        section_label = section.get("label", "")
        top_audience = "dev" if section_label in DEV_SECTION_LABELS else "user"
        walk(section.get("items", []), top_audience)

    # STANDALONE_PAGES 중 메가메뉴에서 이미 못 만난 것 보강(전부 user로 간주 —
    # 지금까지 확인된 9개가 전부 사용자용 SPA 페이지이기 때문. dev 전용
    # standalone 페이지가 생기면 이 가정을 재검토해야 한다).
    for page_id in standalone_ids:
        path = "/" + page_id
        if path not in entries:
            add(path, page_id, f"https://hondi.net/desktop.html#{page_id}", "user",
                derive_keywords(page_id), "standalone")

    return list(entries.values())


def main():
    check_only = "--check" in sys.argv
    entries = build_entries()
    entries.sort(key=lambda e: (e["audience"], e["path"]))

    new_content = json.dumps(entries, ensure_ascii=False, indent=2) + "\n"

    if check_only:
        old_content = MANIFEST_PATH.read_text(encoding="utf-8") if MANIFEST_PATH.exists() else ""
        if old_content.strip() != new_content.strip():
            print("site-manifest.json이 desktop.html의 실제 내비게이션과 어긋납니다.")
            print(f"  현재 사람 손 매니페스트: {len(json.loads(old_content)) if old_content else 0}개")
            print(f"  desktop.html에서 발견: {len(entries)}개")
            return 1
        print("site-manifest.json이 최신 상태입니다.")
        return 0

    MANIFEST_PATH.write_text(new_content, encoding="utf-8")
    user_count = sum(1 for e in entries if e["audience"] == "user")
    dev_count = sum(1 for e in entries if e["audience"] == "dev")
    print(f"site-manifest.json 생성 완료 — 총 {len(entries)}개 (user={user_count}, dev={dev_count})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
