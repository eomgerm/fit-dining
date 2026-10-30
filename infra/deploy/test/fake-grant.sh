#!/usr/bin/env bash
# 시험용 AI 읽기 권한 맞추기(infra/data/grant-ai-read.sh의 대역. 배포가 마이그레이션 뒤에 부른다).
# FAKE_GRANT_FAIL=1이면 실패한다. 부를 때마다 $FIT_GRANT_MARK에 한 줄을 남긴다.
set -eu
if [ "${FAKE_GRANT_FAIL:-0}" = 1 ]; then
  echo "시험용 권한 맞추기 실패" >&2
  exit 1
fi
echo "grant" >>"${FIT_GRANT_MARK:?}"
