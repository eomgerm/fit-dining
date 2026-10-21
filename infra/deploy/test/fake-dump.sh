#!/usr/bin/env bash
# 시험용 마이그레이션 전 덤프(infra/backup/pg-backup.sh의 대역, 계획 1D가 진짜를 만든다). 인자: predeploy <환경> <sha>
# FAKE_DUMP_FAIL=1이면 실패한다. 덤프 대신 인자를 적은 파일을 $FIT_BACKUP_DIR에 남긴다.
set -eu
if [ "${FAKE_DUMP_FAIL:-0}" = 1 ]; then
  echo "시험용 덤프 실패" >&2
  exit 1
fi
mkdir -p "${FIT_BACKUP_DIR:?}"
echo "$*" >"$FIT_BACKUP_DIR/predeploy-$2-$3.dump"
