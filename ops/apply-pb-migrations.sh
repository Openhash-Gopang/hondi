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
set -euo pipefail
cd /opt/gopang
RAW_BASE="https://raw.githubusercontent.com/Openhash-Gopang/hondi/main/pb_migrations"
FILES="${SSH_ORIGINAL_COMMAND:-}"
if [ -z "$FILES" ]; then
  echo "[SKIP] 변경된 파일 목록이 비어있음 — 아무 작업도 하지 않음."
  exit 0
fi
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
