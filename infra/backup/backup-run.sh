#!/usr/bin/env bash
# timer가 부르는 진입점이다(fit-backup@<종류>.service). 백업을 하고 결과와 상관없이 금고 전송도 시도한다.
#   bash infra/backup/backup-run.sh pg|photos|caddy
# 백업이 실패해도 앞서 쌓인 파일은 보내고, 둘 중 하나라도 실패하면 실패로 끝낸다(systemd가 실패로 기록한다).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIND="${1:-}"
rc=0
case "$KIND" in
  pg) bash "$HERE/pg-backup.sh" scheduled || rc=1 ;;
  photos | caddy) bash "$HERE/files-backup.sh" "$KIND" || rc=1 ;;
  *)
    echo "사용: bash infra/backup/backup-run.sh pg|photos|caddy" >&2
    exit 2
    ;;
esac
bash "$HERE/push-vault.sh" || rc=1
exit "$rc"
