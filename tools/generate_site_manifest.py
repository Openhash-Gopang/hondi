#!/usr/bin/env python3
"""
tools/generate_site_manifest.py
--------------------------------
혼디 검색(/hondi-search)이 참조하는 site-manifest.json을 desktop.html의
실제 내비게이션 구조에서 "자동 생성"한다 — 손으로 쓰는 매니페스트는
구조적으로 누락이 발생한다(2026-09-13, "혼디 숫자 코드" 페이지 검색
실패 사고가 그 증거: 메가메뉴엔 있었지만 수기 매니페스트엔 없었음).

소스 4곳을 통합한다:
  1. desktop.html의 MEGA_MENU_SECTIONS(JS 변수, JSON으로 파싱)
  2. desktop.html의 STANDALONE_PAGES 배열(메가메뉴에 링크가 없는
     SPA 오버레이 페이지 — 예: klaw, usage-guide, expert-personas 등)
  3. desktop.html의 MEGA_MENU_PINNED(단일 객체 — 메가메뉴 상단에 고정
     표시되는 항목 1개. 2026-09-13 v1.1에서 추가 — 배열이 아니라 별도
     변수라 처음엔 놓쳤다. 이런 "또 다른 소스"가 계속 나올 수 있다는
     전제로 ④를 안전망으로 둔다)
  4. desktop.html 본문에 흩어진 순수 `<a href="...">` 앵커(메가메뉴 밖,
     예: 하단 지원 배너 "혼디 프로젝트를 지원하는 방법", 헤더의 "사용법"
     링크). JS 구조가 아니라 정규식으로 전체 문서를 훑으며, 이미 ①~③에서
     찾은 것과 겹치면 add()의 중복 방지로 자동 무시된다. .css/.js/이미지
     등 페이지가 아닌 링크는 확장자로 걸러낸다.

audience 분류 원칙:
  "🛠 개발자 문서" / "⚠ 주의" 섹션 → dev
  그 외 전부(④의 순수 앵커 포함) → user
(desktop.html 섹션 라벨이 바뀌면 DEV_SECTION_LABELS만 갱신하면 된다.)

⚠ 2026-09-13 실전 교훈: ①②만 파싱하고 "이걸로 전수 커버했다"고
간주했다가, 50개 스모크테스트 질의를 준비하는 과정에서 ③④ 소스에만
있던 실제 페이지 3개(legacy_overview_20260821.html,
hondi_interactive_manual.html, project-support.html)가 통째로 빠진
채 방치돼 있었던 걸 발견했다. "메가메뉴 JSON을 파싱했다"와 "desktop.html
안의 페이지 링크를 전수 확인했다"는 다른 이야기라는 게 이번에 확인된
교훈이다 — 다음에 또 새로운 소스(예: 다른 JS 변수, 다른 페이지 파일
안의 앵커)가 발견되면 이 파일의 소스 목록에 추가하고 위 경고 문단도
갱신한다.

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

# ④ 순수 앵커 스캔 대상 확장자 — 페이지로 볼 수 있는 것만. 자산(css/js/
# 이미지 등)은 여기 없으므로 자동으로 제외된다.
PAGE_LIKE_EXTENSIONS = (".html", ".md")
# 순수 앵커에서 라벨을 못 뽑을 때(예: 아이콘만 있는 링크) 대비한 안전망 —
# href의 파일명을 그대로 title로 쓰기 전에, 사람이 읽을 만한 라벨을 알고
# 있으면 여기 채운다. 모르면 비워두고 자동 초안(파일명)을 그대로 둔다.
KNOWN_ANCHOR_LABELS = {
    "./docs/legacy_overview_20260821.html": "혼디 시스템 개요",
    "./docs/hondi_interactive_manual.html": "혼디 사용법",
    "/pages/project-support.html": "혼디 프로젝트를 지원하는 방법",
}

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


def load_mega_menu_pinned():
    """MEGA_MENU_PINNED — 배열이 아니라 단일 객체인 별도 변수. 없어도
    치명적이지 않으므로(과거엔 없었을 수 있음) 못 찾으면 None을 반환."""
    text = DESKTOP_HTML.read_text(encoding="utf-8")
    m = re.search(r"var MEGA_MENU_PINNED = (\{.*?\});", text)
    return json.loads(m.group(1)) if m else None


ANCHOR_HREF_RE = re.compile(r'<a\s[^>]*href="(\.\/docs\/[^"]+|\/pages\/[^"]+|\/[a-zA-Z][a-zA-Z0-9_\-\.]*\.html)"')


def find_loose_anchor_hrefs():
    """desktop.html 전체 본문에서 메가메뉴/STANDALONE_PAGES/PINNED 밖에
    흩어진 순수 <a href="..."> 링크를 찾는다. 이미 다른 소스에서 찾은
    항목과 겹치면 build_entries()의 add()가 중복을 알아서 무시하므로,
    여기서는 페이지처럼 보이는 확장자(PAGE_LIKE_EXTENSIONS)만 걸러
    과대 수집을 막는다."""
    text = DESKTOP_HTML.read_text(encoding="utf-8")
    hrefs = sorted(set(ANCHOR_HREF_RE.findall(text)))
    return [h for h in hrefs if h.lower().endswith(PAGE_LIKE_EXTENSIONS)]


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
    pinned = load_mega_menu_pinned()
    loose_anchor_hrefs = find_loose_anchor_hrefs()

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

    # ③ MEGA_MENU_PINNED — 단일 고정 항목.
    if pinned and pinned.get("href") and pinned["href"] != "#":
        label = pinned.get("label", "")
        path = normalize_href_path(pinned["href"])
        add(path, label, href_to_pc_url(pinned["href"]), "user",
            derive_keywords(label), "pinned", label)

    # ④ 메가메뉴/STANDALONE_PAGES/PINNED 어디에도 없던 순수 앵커.
    # 2026-09-13 실전 교훈(파일 상단 경고 참고) — 이 소스를 놓쳤던 사고를
    # 재발 방지하기 위한 안전망. 라벨을 알면 KNOWN_ANCHOR_LABELS에서
    # 가져오고, 모르면 파일명을 그대로 자동 초안으로 쓴다(사람 검수 필요).
    for href in loose_anchor_hrefs:
        path = normalize_href_path(href)
        if path in entries:
            continue  # 이미 다른 소스에서 찾음
        label = KNOWN_ANCHOR_LABELS.get(href) or Path(href).stem
        add(path, label, href_to_pc_url(href), "user",
            derive_keywords(label), "loose_anchor", label)

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
