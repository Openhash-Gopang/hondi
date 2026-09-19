#!/usr/bin/env python3
"""
tools/archive_old_prompts.py
-----------------------------
prompts/ 안에 같은 SP/문서 계열의 버전 파일이 너무 많이 쌓이는 걸 막는다.
각 계열(build_manifest.py와 동일한 그룹핑 규칙)마다 최신 KEEP_LATEST개만
prompts/에 남기고, 그보다 오래된 버전은 prompts/archive/로 옮긴다.

■ 왜 필요한가
  AGENT-COMMON만 해도 v2.3~v3.13까지 16개 버전이 한 번도 정리되지 않고
  prompts/ 최상위에 계속 쌓여왔다(2026-07-05 확인). "이미 push된 버전은
  직접 고치지 않고 새 파일로 분리한다"는 원칙 자체는 맞지만, 그 결과가
  무한정 쌓이기만 하면 사람도 다음 세션도 어느 게 실제로 살아있는
  최신본인지 훑어보기 버거워진다. sp-catalog.json이 최신을 자동 선택해
  기능적으로는 문제없지만, 이건 사람이 디렉터리를 볼 때의 문제다.

■ 안전 원칙
  - sp-catalog.json이 실제로 참조하는 "최신본"은 절대 옮기지 않는다
    (KEEP_LATEST가 1 미만으로 설정되는 실수를 해도 최신본은 항상 보존).
  - 지우지 않고 prompts/archive/로 이동만 한다 — git 이력도 그대로 남는다.
  - 이미 손으로 archive/에 넣어둔 파일(SP-00-ROUTER 등)은 건드리지 않는다
    (스캔 대상이 PROMPTS.iterdir()이므로 하위 폴더인 archive/는 애초에
    스캔되지 않음 — build_manifest.py와 동일).
  - profile-assistant/처럼 하위 폴더에 있는 계열도 동일하게 처리하되,
    이동 위치는 prompts/archive/ 하나로 통일한다(파일명 자체가
    "profile-assistant-vX.txt"라 최상위로 옮겨도 계열 구분에 문제 없음).
    (2026-07-08: personal-assistant → profile-assistant 개명·분리)

■ 실행 시점
  - .github/workflows/manifest.yml에서 build_manifest.py 실행 "전"에
    호출한다(push마다 — 즉시 정리).
  - .github/workflows/archive-prompts.yml에서 주기적(cron)으로도 별도
    호출한다 — push 트리거를 놓치는 경우에 대한 안전망.

■ 사용법
  python3 tools/archive_old_prompts.py           # 실제 이동 수행
  python3 tools/archive_old_prompts.py --dry-run # 무엇을 옮길지만 출력
"""
import re
import sys
import shutil
from collections import defaultdict
from pathlib import Path

ROOT     = Path(__file__).parent.parent
PROMPTS  = ROOT / 'prompts'
ARCHIVE  = PROMPTS / 'archive'

KEEP_LATEST = 1  # 계열당 prompts/ 최상위에 남길 최신 버전 개수
# ★ 2026-09-20 (Phase 2 구조감사 후속) — 5 → 1로 하향. sp-catalog.json이
# 항상 정확히 1개(최신본)만 참조하므로, 그 이상 남겨둬도 "사람이 볼 때의
# 최신 확인" 목적에는 git 이력으로 충분하고, 5개씩 쌓아두면 계열 70개
# 기준 ~300개 죽은 파일이 prompts/ 최상위에 상시 체류하는 결과가 된다
# (Phase 2 감사에서 실측: SP_architect 하나만도 v2.8/2.9/3.0/3.1/3.3
# 5버전 전부 생존). 안전 원칙(§안전 원칙)은 그대로 — 최신본은 여전히
# 항상 보존되고, archive/로 이동만 할 뿐 삭제하지 않는다.


def parse_version(fname: str) -> tuple:
    m = re.search(r'v(\d+)[._](\d+)(?:[._](\d+))?', fname)
    if not m:
        return (0, 0, 0)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))


def group_files() -> dict[str, list[Path]]:
    """build_manifest.py와 동일한 규칙으로 파일을 계열별로 묶는다."""
    groups: dict[str, list[Path]] = defaultdict(list)

    def add(key, path):
        groups[key].append(path)

    for f in PROMPTS.iterdir():
        if f.is_dir():
            continue
        name = f.name
        if 'LATEST' in name or name == 'sp-catalog.json':
            continue

        if re.match(r'^AGENT-COMMON_v', name) and name.endswith('.txt'):
            add('AGENT-COMMON', f)
        elif re.match(r'^AGENT-SUPPLIER-COMMON_v', name) and name.endswith('.txt'):
            add('AGENT-SUPPLIER-COMMON', f)
        elif re.match(r'^SP-00-ROUTER-v', name) and name.endswith('.txt'):
            add('SP-00-ROUTER', f)
        elif name.endswith('.txt'):
            m = re.match(r'^(SP-[\d]+-?(?:IMG)?)_(.+?)(?:_v[\d.]+)?\.txt$', name)
            if m:
                add(f"{m.group(1)}_{m.group(2)}", f)
                continue
            m2 = re.match(r'^(AGENT-SUPPLIER-(\d+))_', name)
            if m2:
                add(f'AGENT-SUPPLIER-{m2.group(2)}', f)
        elif name.endswith('.md'):
            # ★ 2026-07-20 신설 — build_manifest.py와 동일한 규칙인데 이
            # 스크립트엔 .md 스캔이 통째로 빠져 있었다(전수조사로 발견:
            # SP_accountant·SP_appraiser 등 60개 EXPERT 페르소나 .md 파일과
            # UNIVERSAL-common·K-Public_common 등이 KEEP_LATEST 정리 대상에서
            # 한 번도 걸러진 적이 없어 prompts/ 루트에 무기한 쌓이고 있었다).
            # build_manifest.py의 SP_{slug} 정규식(밑줄, 비탐욕 매칭)과
            # UNIVERSAL-common/PROFESSIONAL-common/K-Public_common 등 개별
            # 문서 규칙을 동일하게 적용한다.
            m = re.match(r'^(SP_.+?)_v[\d_]+\.md$', name)
            if m:
                add(m.group(1), f)
                continue
            m3 = re.match(r'^(UNIVERSAL-INTEGRITY|UNIVERSAL-common|UNIVERSAL-job-assist|'
                          r'PROFESSIONAL-common|TASK-DELEGATION-GUIDE|K-Public_common|'
                          r'k-business|business-kr)_v', name)
            if m3:
                add(m3.group(1), f)

    pa_dir = PROMPTS / 'profile-assistant'
    if pa_dir.is_dir():
        for f in pa_dir.iterdir():
            if re.match(r'^profile-assistant-v', f.name) and f.name.endswith('.txt'):
                add('profile-assistant', f)

    return groups


def plan_archive(groups: dict[str, list[Path]]) -> list[Path]:
    """계열마다 최신 KEEP_LATEST개를 제외한 나머지를 반환한다."""
    to_archive = []
    for key, files in groups.items():
        if len(files) <= KEEP_LATEST:
            continue
        ranked = sorted(files, key=lambda p: (parse_version(p.name), len(p.name)), reverse=True)
        old = ranked[KEEP_LATEST:]
        to_archive.extend(old)
    return to_archive


def main():
    dry_run = '--dry-run' in sys.argv
    groups = group_files()
    to_archive = plan_archive(groups)

    if not to_archive:
        print('정리할 파일 없음 — 모든 계열이 KEEP_LATEST(=%d) 이하.' % KEEP_LATEST)
        return

    ARCHIVE.mkdir(exist_ok=True)
    moved, dupes_removed, conflicts = 0, 0, 0
    for f in to_archive:
        dest = ARCHIVE / f.name
        if dest.exists():
            # ★ 2026-09-20 추가 — KEEP_LATEST를 5→1로 낮추면서 "이미 archive에
            # 동명 파일 존재"로 건너뛰던 파일들이 prompts/ 최상위에 그대로
            # 남아 정리 효과가 반감되는 걸 발견(Phase 2 후속 정리 중 실측).
            # 대부분은 예전 archive 작업에서 이미 옮겨진 것과 완전히 같은
            # 내용의 잔재이므로, 내용이 동일하면 원본을 안전하게 지운다
            # (archive/에 이미 그 내용이 보존돼 있으니 데이터 손실 없음).
            # 내용이 다르면(동명이인 버전 충돌) 절대 자동 처리하지 않고
            # 사람 확인 대상으로 남긴다.
            if f.read_bytes() == dest.read_bytes():
                print(f'  {"[dry-run] " if dry_run else ""}{f.relative_to(ROOT)} (archive와 내용 동일 — 원본 삭제)')
                dupes_removed += 1
                if not dry_run:
                    f.unlink()
            else:
                print(f'  ⚠ 충돌(내용 다름, 수동 확인 필요): {f.relative_to(ROOT)} vs {dest.relative_to(ROOT)}')
                conflicts += 1
            continue
        print(f'  {"[dry-run] " if dry_run else ""}{f.relative_to(ROOT)} → {dest.relative_to(ROOT)}')
        moved += 1
        if not dry_run:
            shutil.move(str(f), str(dest))

    print(f'\n총 {len(to_archive)}건 중 이동 {moved}건, 동일내용 삭제 {dupes_removed}건, '
          f'충돌(수동확인 필요) {conflicts}건 {"(dry-run)" if dry_run else ""}.')


if __name__ == '__main__':
    main()
