#!/usr/bin/env bash
# ops/apply-pb-hooks.sh — GitHub Actions 강제 커맨드 전용 (SSH_ORIGINAL_COMMAND
# 로 전달되는 인자는 무시 — pb_hooks/main.pb.js 파일은 항상 통째로 하나뿐이라
# pb_migrations처럼 "바뀐 파일명 목록"을 받을 필요가 없다).
#
# 2026-07-19 v3 수정 — 실전 배포에서 hooksWatch 자동재시작 가정이 틀린
# 것으로 확인됐다: 이 서버(v0.22.14, --hooksWatch 플래그 미지정)에서는
# 파일 교체 후 재시작이 전혀 일어나지 않았다(git 배포 파이프라인 최초
# 성공 실행에서 실측 — 헬스체크는 통과했지만 systemctl 프로세스 시작
# 시각이 그대로였음, 신구 파일 내용을 grep으로 대조해 확인). v2의
# "hooksWatch가 자동으로 재시작한다"는 가정은 폐기하고, 이제 파일 교체
# 직후 명시적으로 systemctl restart를 호출한다. ubuntu 계정에
# `sudo -n systemctl restart gopang-pb-hanlim`이 암호 없이 되도록
# sudoers가 이미 설정돼 있어야 한다(2026-07-19 확인 완료).
#
# 2026-07-18 실전 배포 경험으로 v2 수정(현재는 위 v3로 대체된 가정 포함):
#   - 백업을 pb_hooks/ 밖(pb_hooks_backups/)에 만든다. 파일 생성이
#     불필요한 트리거로 이어지는 걸 막기 위한 조치였는데, v3에서 재시작을
#     명시적으로 제어하게 되면서 이 걱정 자체는 의미가 옅어졌지만, 백업을
#     pb_hooks/ 밖에 두는 관례는 여전히 안전하므로 유지한다.
#   - (v3에서 폐기) 명시적 systemctl restart를 안 쓴다는 가정 — 실측
#     결과 hooksWatch가 동작하지 않아 폐기.
#   - 헬스체크 대기를 2초→최대 120초로 늘렸다. 이 서버는 메모리 956MB에
#     PocketBase 49개가 떠 있어(도입 초기 스펙, 출시 시 업그레이드 예정)
#     정상 배포도 60~90초씩 걸릴 수 있다.
#   - 배포 직후 첫 요청들은 hooksPool(기본 25개 Goja 런타임) 각각이
#     이 파일을 최초 파싱하며 콜드스타트가 발생해 70~80초까지 걸릴 수
#     있음을 확인했다(3~5회 정도 후 1초 미만으로 안정화). 이건 정상
#     현상이며 헬스체크 자체와는 무관하다 — 배포 직후 바로 실거래가
#     몰리는 시점이라면 이 지연을 감안할 것.
#
# 이 스크립트가 하는 일 (모두 자동, 실패 시 자동 롤백):
#   1) 현재 pb_hooks/main.pb.js를 pb_hooks_backups/ 에 백업(감시 밖)
#   2) GitHub main의 최신 pb_hooks/main.pb.js 다운로드(/tmp, 감시 밖)
#   3) 최소 검증(필수 라우트/함수 존재 확인)
#   4) 교체(단 1회 cp) + 명시적 systemctl restart (v3)
#   5) 최대 120초 헬스체크 대기
#   6) 실패 시 백업으로 즉시 롤백 + 재시작
#
# 2026-09-19 수정 — RAW_URL이 아직도 아카이브된 옛 저장소
# Openhash-Gopang/gopang을 가리키고 있던 것을 발견해 hondi로 고쳤다.
# ops/apply-pb-migrations.sh는 이미 2026-09-02에 이 문제(RAW_BASE가
# 옛 저장소를 가리키던 것)를 고쳤는데, 같은 계열의 apply-pb-hooks.sh는
# 그때 같이 고쳐지지 않고 남아있었던 것으로 보인다. 다만 이쪽은 옛
# gopang 저장소 자체가 404가 아니라 (아직 살아있는 채로) 아주 오래된
# pb_hooks 내용을 200 OK로 계속 반환하고 있어서 — apply-pb-migrations.sh
# 때처럼 워크플로가 눈에 띄게 실패하지 않고 조용히 구식 pb_hooks(2026-09-06
# NODE_ID 정리 이전 버전 확인됨)를 hanlim에 배포해왔을 위험이 있다.
set -euo pipefail

PB_ROOT="/opt/gopang"
SERVICE="gopang-pb-hanlim.service"
RAW_URL="https://raw.githubusercontent.com/Openhash-Gopang/hondi/main/pb_hooks/main.pb.js"
BACKUP_DIR="$PB_ROOT/pb_hooks_backups"

cd "$PB_ROOT"
mkdir -p "$BACKUP_DIR"

echo "[0/6] 배포 전 여유 메모리 확인..."
AVAIL_MB=$(free -m | awk '/^Mem:/{print $7}')
echo "     available: ${AVAIL_MB}Mi"
if [ "$AVAIL_MB" -lt 100 ]; then
  echo "     [WARN] 여유 메모리가 100Mi 미만입니다. 배포가 느리거나"
  echo "     실패할 위험이 있습니다. 그래도 강행합니다(자동화 컨텍스트라"
  echo "     사람 확인을 기다릴 수 없음 — 실패 시 자동 롤백에 의존)."
fi

echo "[1/6] 백업 (pb_hooks 밖 — 불필요한 재시작 트리거 방지)..."
BACKUP="$BACKUP_DIR/main.pb.js.bak-$(date +%Y%m%d-%H%M%S)"
cp pb_hooks/main.pb.js "$BACKUP"

echo "[2/6] 최신 파일 다운로드 (/tmp — 역시 감시 밖)..."
TMPFILE=$(mktemp)
curl -sL "$RAW_URL" -o "$TMPFILE"

echo "[3/6] 최소 검증..."
if [ ! -s "$TMPFILE" ]; then
  echo "[FAIL] 빈 파일 — 중단"; rm -f "$TMPFILE"; exit 1
fi
if ! grep -q 'routerAdd("POST", "/api/tx"' "$TMPFILE"; then
  echo "[FAIL] /api/tx 라우트가 없음 — 중단(잘못된 파일 가능성)"; rm -f "$TMPFILE"; exit 1
fi

echo "[4/6] 교체 (단 1회 cp)..."
cp "$TMPFILE" pb_hooks/main.pb.js
rm -f "$TMPFILE"

echo "[4.5/6] 명시적 재시작 (hooksWatch 미동작 확인됨 — 2026-07-19)..."
sudo -n systemctl restart "$SERVICE"

echo "[5/6] 재시작 후 헬스체크 대기 (최대 120초)..."
OK=0
for i in $(seq 1 120); do
  sleep 1
  if curl -sf http://127.0.0.1:8091/api/health >/dev/null 2>&1; then
    OK=1
    echo "     ${i}초 후 정상 기동 확인"
    break
  fi
  if [ $((i % 30)) -eq 0 ]; then
    echo "     ...${i}초 경과 ($(free -m | awk '/^Mem:/{print $7"Mi avail"}'))"
  fi
done

echo "[6/6] 최종 확인..."
if [ "$OK" = "1" ]; then
  echo "[OK] 배포 완료"
  sha256sum pb_hooks/main.pb.js
else
  echo "[FAIL] 120초 내 헬스체크 실패 — 롤백"
  cp "$BACKUP" pb_hooks/main.pb.js
  echo "     롤백 파일 교체 완료 — 재시작 후 헬스체크 대기(최대 60초)..."
  sudo -n systemctl restart "$SERVICE"
  for i in $(seq 1 60); do
    sleep 1
    if curl -sf http://127.0.0.1:8091/api/health >/dev/null 2>&1; then
      echo "     [ROLLBACK OK] ${i}초 후 정상 복구됨"
      exit 1
    fi
  done
  echo "     [ROLLBACK FAIL] 롤백 후에도 비정상 — 즉시 수동 개입 필요:"
  echo "       tail -30 /opt/gopang/logs/hanlim_err.log"
  echo "       ps aux | grep [p]ocketbase | grep 8091"
  exit 1
fi
