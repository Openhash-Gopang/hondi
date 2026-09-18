#!/usr/bin/env bash
# GitHub Actions 전용 강제 커맨드로만 실행됨.
#
# ★ 2026-09-02 — 이 파일은 그동안 hanlim 서버(/opt/gopang/ops/)에만
# 존재하고 저장소엔 없었다(git 이력 없음). K-Plan↔K-Mail 파이프라인
# 배포 중 deploy-pb-migrations.yml이 404로 계속 실패해 원인을 추적한
# 끝에 발견 — gopang/gopang_v2를 hondi로 통합할 때 이 서버 전용
# 스크립트는 통합 대상에서 빠져 있었고, RAW_BASE가 여전히 아카이브된
# 옛 저장소(Openhash-Gopang/gopang)를 가리키고 있었다. 서버에서 직접
# `sed`로 급한 불을 끄고, 이번에 그 결과를 저장소에 정본으로 편입한다
# (아래 RAW_BASE가 이미 hondi로 수정된 상태).
#
# ⚠️ 알려진 한계: 이 스크립트를 배포하는 SSH 키(L1_SSH_PRIVATE_KEY)는
# authorized_keys에 강제 커맨드(command="/opt/gopang/ops/apply-pb-migrations.sh")로
# 제한되어 있어, 그 키로는 이 스크립트 자신을 포함해 어떤 파일도
# 서버에 새로 옮길 수 없다(오직 pb_migrations/*.js만 받아 적용 가능).
# 즉 이 파일이 저장소에서 바뀌어도 **자동으로 서버에 반영되지 않는다**
# — 지금은 이 파일이 바뀌면 사람이 SSH로 직접 접속해 수동으로
# 덮어써야 한다. 자동 동기화가 필요해지면 별도의(더 넓은 권한을 가진)
# 배포 키와 워크플로 단계를 새로 설계해야 한다 — 이번 편입 작업의
# 범위 밖으로 남겨둔다.
#
# 2026-07-16 재설계: 폴더 전체 동기화(codeload tarball) 대신, 클라이언트가
# SSH_ORIGINAL_COMMAND로 넘긴 "이번 push에서 실제로 바뀐 pb_migrations
# 파일 목록"만 개별 검증 후 받는다. 이렇게 해야:
#   1) 이 저장소에서 동시 진행 중인 다른 미완성 마이그레이션까지
#      끌려오는 문제(오늘 발생한 502 사고의 원인)가 재발하지 않는다.
#   2) GitHub에서 받은 내용이 404 에러 페이지 등 깨진 파일이면
#      migrate up으로 넘기지 않고 즉시 중단한다(과거 panic 사고 재발 방지).
#
# 2026-07-29 수정 — PR #114 배포 중 실제로 겪은 문제: migrate up과
# systemctl restart는 전부 성공했는데, 재시작 직후 곧바로(sleep 2) 헬스체크를
# 쏘는 바람에 PocketBase가 포트에 완전히 바인딩되기 전에 curl이 connection
# refused(exit 7)를 받아 워크플로 전체가 실패로 기록됐다. 마이그레이션 자체는
# 이미 반영된 뒤라 재실행할 필요도 없었는데 CI 로그만 보면 실패로 보였다.
# 그래서: (1) 헬스체크를 고정 sleep 1회가 아니라 짧은 간격으로 재시도하고,
# (2) migrate up 자체가 실패하면 여전히 스크립트를 실패시키되(진짜 실패),
# 재시작 후 헬스체크는 "몇 초 늦게 뜨는 것"을 정상 범위로 보고 재시도 끝에도
# 안 되면 그때만 경고로 남긴다(구버전의 `|| echo [WARN]` 안전장치를 재시도
# 로직과 함께 복원 — 이 안전장치가 재설계 과정에서 빠졌던 것으로 보인다).
#
# 2026-09-19 추가 — 9/18 l1-hanlim crash-loop 인시던트(48개 인스턴스 중
# 46개, INCIDENT_2026-09-18_l1-hanlim-pocketbase-crashloop-recovery.md
# 참고) 재발 방지. 근본 원인: 서버 pb/pb_migrations/에 리네임 전 버려진
# 초안 파일(1793990003_created_goal_path_traces.js — 저장소 git 이력에는
# 없음, 서버에만 있던 파일)이 남아있었고, 정본(1794000001_...)과 같은
# 컬렉션명을 만들려다 PocketBase _collections.name UNIQUE 제약에 걸려
# migrate 트랜잭션이 매번 롤백되며 crash-loop이 발생했다.
#
# 이 스크립트는 그동안 이번 push에서 "바뀐 파일"만 개별로 추가/갱신할 뿐,
# 저장소에 없는 서버 전용 잔재 파일을 정리하는 로직이 전혀 없었다 — 위
# 시나리오를 막을 방법이 없었다. 아래 [RECONCILE] 단계를 추가한다: 저장소
# main의 pb_migrations/ 전체 목록을 codeload tarball로 받아, 서버
# pb/pb_migrations/에는 있지만 저장소에는 없는 *.js 파일을 찾아 삭제가
# 아니라 격리(pb_migrations_removed_stale/로 이동, 타임스탬프 접두사 —
# 9/18 인시던트 복구 때 수동으로 썼던 것과 동일한 이름의 디렉터리)한다.
# 이 정리는 migrate up보다 반드시 먼저 실행해야 한다 — 이름 충돌의
# 원인이 되는 파일을 지운 뒤에 migrate를 돌려야 crash-loop 없이
# 넘어간다. 네트워크 문제 등으로 reconcile 자체가 실패해도 비치명적
# 경고로만 남기고 넘어간다(기존 파일 적용/마이그레이션 흐름을 막지
# 않기 위함) — 단, 파일 목록을 하나라도 지운 경우엔 그 사실을 [WARN]
# 아니라 [FIXED]로 뚜렷하게 남긴다.
set -euo pipefail
cd /opt/gopang
RAW_BASE="https://raw.githubusercontent.com/Openhash-Gopang/hondi/main/pb_migrations"
REPO_TARBALL="https://codeload.github.com/Openhash-Gopang/hondi/tar.gz/refs/heads/main"
STALE_QUARANTINE_DIR="pb_migrations_removed_stale"
FILES="${SSH_ORIGINAL_COMMAND:-}"

RECONCILED=0

reconcile_stale_migrations() {
  echo "[RECONCILE] 저장소 pb_migrations/ 전체 목록과 서버 파일 비교 중..."
  local tmpdir src_dir stale
  tmpdir=$(mktemp -d)
  if ! curl -sL "$REPO_TARBALL" -o "$tmpdir/repo.tar.gz"; then
    echo "[WARN] reconcile: 저장소 tarball을 받지 못함 — 이번 실행은 건너뜀(비치명적)"
    rm -rf "$tmpdir"
    return 0
  fi
  tar -xzf "$tmpdir/repo.tar.gz" -C "$tmpdir" --wildcards "*/pb_migrations/*.js" 2>/dev/null || true
  src_dir=$(find "$tmpdir" -maxdepth 2 -type d -name "pb_migrations" | head -n1)
  if [ -z "$src_dir" ]; then
    echo "[WARN] reconcile: tarball에서 pb_migrations 폴더를 못 찾음 — 이번 실행은 건너뜀(비치명적)"
    rm -rf "$tmpdir"
    return 0
  fi
  stale=$(comm -23 \
    <(ls pb/pb_migrations/*.js 2>/dev/null | xargs -n1 basename | sort) \
    <(ls "$src_dir" | sort))
  rm -rf "$tmpdir"
  if [ -z "$stale" ]; then
    echo "     서버-저장소 파일 목록 일치, 정리할 것 없음"
    return 0
  fi
  mkdir -p "$STALE_QUARANTINE_DIR"
  local ts
  ts=$(date +%Y%m%d%H%M%S)
  echo "[FIXED] 저장소에 없는 서버 전용 마이그레이션 파일 발견 — 격리(삭제 아님):"
  local s
  for s in $stale; do
    mv "pb/pb_migrations/$s" "$STALE_QUARANTINE_DIR/${ts}_$s"
    echo "  [MOVED] pb/pb_migrations/$s -> $STALE_QUARANTINE_DIR/${ts}_$s"
  done
  RECONCILED=1
}

if [ -z "$FILES" ]; then
  echo "[SKIP] 변경된 파일 목록이 비어있음 — 신규/변경 파일 적용은 건너뜀."
else
  for f in $FILES; do
    case "$f" in
      *.js)
        if [[ "$f" == *"/"* || "$f" == *".."* ]]; then
          echo "[FAIL] 허용되지 않는 파일명: $f"
          exit 1
        fi
        ;;
      *)
        echo "[FAIL] .js 파일이 아님: $f"
        exit 1
        ;;
    esac
    echo "[FETCH] $f"
    TMPFILE=$(mktemp)
    curl -sL "$RAW_BASE/$f" -o "$TMPFILE.body"
    HTTP_CODE=$(curl -sL -o /dev/null -w "%{http_code}" "$RAW_BASE/$f")
    if [ "$HTTP_CODE" != "200" ]; then
      echo "[FAIL] $f 다운로드 실패 (HTTP $HTTP_CODE) — 적용 중단"
      rm -f "$TMPFILE" "$TMPFILE.body"
      exit 1
    fi
    if ! grep -q "migrate(" "$TMPFILE.body"; then
      echo "[FAIL] $f 내용이 유효한 마이그레이션 JS로 보이지 않음 — 적용 중단"
      echo "--- 받은 내용 미리보기 ---"
      head -c 200 "$TMPFILE.body"
      rm -f "$TMPFILE" "$TMPFILE.body"
      exit 1
    fi
    cp "$TMPFILE.body" "pb/pb_migrations/$f"
    rm -f "$TMPFILE" "$TMPFILE.body"
    echo "[OK] $f 검증 통과, 저장 완료"
  done
fi

reconcile_stale_migrations

if [ -z "$FILES" ] && [ "$RECONCILED" = "0" ]; then
  echo "[DONE] 신규/변경 파일 없음, 정리할 서버 전용 파일도 없음 — migrate/재기동 건너뜀."
  exit 0
fi

echo "[MIGRATE] migrate up 실행"
./pocketbase migrate up --dir=pb/hanlim --migrationsDir=pb/pb_migrations
# ↑ 여기서 실패하면(진짜 마이그레이션 오류) set -e에 의해 스크립트가 즉시
#   중단된다 — 이건 의도된 hard fail이며 아래 재시도 로직과 무관하다.

echo "[RESTART] gopang-pb-hanlim.service 재기동"
sudo systemctl restart gopang-pb-hanlim.service

echo "[HEALTHCHECK] 서비스 기동 대기 (최대 5회, 2초 간격)"
ok=""
for i in 1 2 3 4 5; do
  sleep 2
  if systemctl is-active --quiet gopang-pb-hanlim.service && \
     curl -sf http://127.0.0.1:8091/api/health > /dev/null; then
    ok=1
    echo "[OK] ${i}번째 시도에서 헬스체크 통과"
    break
  fi
  echo "[WAIT] ${i}번째 시도 실패 — 재시도"
done

if [ -z "$ok" ]; then
  echo "[WARN] migrate up은 성공했으나(마이그레이션은 이미 반영됨), 재시작 후" \
       "헬스체크가 5회 재시도 후에도 실패했습니다 — 서비스 로그를 직접" \
       "확인해 주세요: journalctl -u gopang-pb-hanlim.service -n 50"
  # ★ 여기서 exit 1로 끝내지 않는다 — migrate up이 이미 성공했으므로
  #   "재적용해야 하는 진짜 실패"가 아니라 "확인이 필요한 경고"다.
  #   CI 로그에 [WARN]이 남으므로 조용히 묻히지 않는다.
fi

echo "[DONE] 마이그레이션 적용 완료 (파일: $FILES)"
