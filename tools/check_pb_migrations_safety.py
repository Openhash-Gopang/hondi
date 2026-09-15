#!/usr/bin/env python3
"""
tools/check_pb_migrations_safety.py

pb_migrations/*.js 안전성 검사 — 2026-09-15 hanlim L1 크래시 루프 사고
재발 방지용.

사고 요약: 예전에 revert된 기능(goal_path_traces 컬렉션 생성 마이그레이션)의
"적용 기록"은 서버 _migrations 테이블에 남아있었는데, 그 원인이 된 파일은
저장소에서 삭제되어 되돌릴(down) 방법이 사라진 상태였다. 이후 같은 기능을
다시 만들며 새 타임스탬프의 새 파일로 동일한 이름("goal_path_traces")의
컬렉션을 또 생성하려 했고, PocketBase의 _collections.name UNIQUE 제약에
걸려 배포 즉시 서버가 부팅 자체를 거부(크래시 루프)했다.

이 스크립트는 같은 사고가 재발하기 전에 두 가지를 미리 잡는다:

  1. [삭제 금지] pb_migrations/*.js 파일을 삭제하는 커밋/PR을 막는다.
     이미 서버에 적용된 마이그레이션 파일은 절대 지우면 안 된다 — 기능을
     되돌리고 싶으면 그 파일은 그대로 두고, 새 타임스탬프의 새 파일에
     역방향(down) 로직을 담아 "추가"해야 한다.

  2. [이름 충돌 사전탐지] 현재 저장소에 남아있는 pb_migrations/*.js를
     타임스탬프(파일명) 순으로 시뮬레이션해, 같은 컬렉션 name을 두 번
     CREATE하려는 파일이 있는데 그 사이에 DELETE가 없으면 실패시킨다 —
     PocketBase가 실제로 검사하는 UNIQUE 제약을 배포 전에 미리 재현한다.

Exit code: 0 = 통과, 1 = 위반 발견(사람이 읽을 메시지와 함께 출력).
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = REPO_ROOT / "pb_migrations"

# new Collection({ ... "name": "X" ... }) 형태에서 name 추출
CREATE_NAME_RE = re.compile(r'new Collection\(\{.*?"name":\s*"([^"]+)"', re.S)
# down() 쪽의 findCollectionByNameOrId("X") ... deleteCollection 패턴에서 name 추출
DELETE_NAME_RE = re.compile(
    r'findCollectionByNameOrId\(\s*"([^"]+)"\s*\)[\s\S]{0,200}?deleteCollection'
)


def check_no_deleted_migration_files() -> list[str]:
    """origin/main 대비 pb_migrations/*.js 파일이 삭제됐는지 확인."""
    errors: list[str] = []
    try:
        subprocess.run(
            ["git", "fetch", "--quiet", "origin", "main"],
            cwd=REPO_ROOT, check=False, capture_output=True,
        )
        diff = subprocess.run(
            ["git", "diff", "--name-status", "origin/main...HEAD", "--", "pb_migrations/*.js"],
            cwd=REPO_ROOT, check=True, capture_output=True, text=True,
        ).stdout
    except subprocess.CalledProcessError as e:
        print(f"[경고] git diff 실행 실패 — 삭제 검사는 건너뜀: {e}", file=sys.stderr)
        return errors

    for line in diff.strip().splitlines():
        if not line:
            continue
        parts = line.split("\t")
        status, path = parts[0], parts[-1]
        if status.startswith("D"):
            errors.append(
                f"[삭제 금지] pb_migrations 파일이 삭제됐습니다: {path}\n"
                f"    이미 서버에 적용된 마이그레이션 파일은 절대 삭제하면 안 됩니다.\n"
                f"    기능을 되돌리려면 이 파일은 그대로 두고, 새 타임스탬프의 새\n"
                f"    파일에 역방향(down) 로직을 담아 '추가'하세요.\n"
                f"    (2026-09-15 hanlim L1 크래시 루프 사고와 동일한 원인 패턴입니다 —\n"
                f"     삭제된 파일이 만들던 컬렉션명을 나중에 다른 파일이 재사용하면서\n"
                f"     _collections.name UNIQUE 제약에 걸려 PocketBase가 기동을 거부합니다.)"
            )
    return errors


def check_no_duplicate_collection_names() -> list[str]:
    """현재 저장소의 pb_migrations/*.js를 시간순으로 시뮬레이션해 이름 충돌 탐지."""
    errors: list[str] = []
    if not MIGRATIONS_DIR.is_dir():
        return errors

    files = sorted(MIGRATIONS_DIR.glob("*.js"))
    active_names: dict[str, str] = {}  # name -> 이 이름을 만든 파일명

    for f in files:
        text = f.read_text(encoding="utf-8", errors="replace")
        created = CREATE_NAME_RE.findall(text)
        deleted = DELETE_NAME_RE.findall(text)

        for name in created:
            if name in active_names:
                errors.append(
                    f"[이름 충돌] 컬렉션 '{name}'\n"
                    f"    {active_names[name]} 에서 이미 생성됐고, 그 사이 삭제(down에서\n"
                    f"    deleteCollection)된 적이 없는데 {f.name} 이 같은 이름으로 또\n"
                    f"    생성을 시도합니다. 배포 즉시 PocketBase가\n"
                    f"    _collections.name UNIQUE 제약 위반으로 부팅을 거부합니다.\n"
                    f"    → 다른 이름을 쓰거나, 정말 같은 컬렉션이 맞다면 새 CREATE가\n"
                    f"      아니라 서버의 기존 레코드를 '이미 적용됨'으로 표시하는\n"
                    f"      방식을 검토하세요."
                )
            else:
                active_names[name] = f.name

        for name in deleted:
            active_names.pop(name, None)

    return errors


def main() -> int:
    errors: list[str] = []
    errors += check_no_deleted_migration_files()
    errors += check_no_duplicate_collection_names()

    if errors:
        print("❌ pb_migrations 안전성 검사 실패:\n")
        for e in errors:
            print(e + "\n")
        return 1

    print("✅ pb_migrations 안전성 검사 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
