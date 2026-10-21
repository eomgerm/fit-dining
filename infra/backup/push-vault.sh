#!/usr/bin/env bash
# outbox/의 새 백업을 B의 금고(vault)로 보낸다(설계 8절 2번). 백업 스크립트가 끝난 뒤 timer가 부른다. 몇 번 실행해도 안전하다.
#   bash infra/backup/push-vault.sh
# 암호화된 파일(.age)을 먼저, 짝 파일(.meta)을 나중에 보낸다. B는 .meta가 있어야 받은 것으로 친다(.meta가 완료 표시다).
# B의 vault 계정은 쓰기 전용 강제 명령(rrsync -wo -no-del)이라 A가 뚫려도 금고 안의 백업을 읽거나 지울 수 없다.
# 보내기에 성공한 파일만 outbox에서 지운다. 실패하면 남겨 두었다가 다음 실행에서 다시 보낸다.
# 필요한 것: backup.env의 BACKUP_VAULT_HOST(와 BACKUP_VAULT_PORT), 키 $FIT_KEYS_DIR/vault_ed25519, B의 호스트 키를 등록한 $FIT_KEYS_DIR/vault_known_hosts(install.sh pin-vault-host).
set -euo pipefail
# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

load_backup_env
case "$BACKUP_VAULT_HOST" in "" | *REPLACE_ME*) die "backup.env의 BACKUP_VAULT_HOST를 B의 주소로 채운다" ;; esac
[[ "$BACKUP_VAULT_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || die "BACKUP_VAULT_HOST 형식이 틀렸다"
KEY="$KEYS_DIR/vault_ed25519"
KNOWN="$KEYS_DIR/vault_known_hosts"
[ -f "$KEY" ] || die "전송 키가 없다: $KEY (install.sh app이 만든다)"
[ -s "$KNOWN" ] || die "B의 호스트 키가 등록돼 있지 않다: $KNOWN (install.sh pin-vault-host)"
OUTBOX="$BACKUP_DIR/outbox"
mkdir -p "$OUTBOX"
acquire_lock push

SSH="ssh -p $BACKUP_VAULT_PORT -i $KEY -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$KNOWN -o ConnectTimeout=15"

# push_set 패턴: outbox에서 패턴에 맞는 파일을 보내고 성공하면 지운다
push_set() {
  local -a files
  mapfile -t files < <(cd "$OUTBOX" && find . -maxdepth 1 -type f -name "$1" -printf '%f\n' | sort)
  [ "${#files[@]}" -gt 0 ] || return 0
  log "보낸다: ${#files[@]}개($1)"
  printf '%s\n' "${files[@]}" | rsync -t --no-perms --no-owner --no-group --chmod=F600 --timeout=120 \
    --files-from=- -e "$SSH" "$OUTBOX/" "vault@$BACKUP_VAULT_HOST:." || die "rsync에 실패했다(남은 파일은 다음 실행에서 다시 보낸다)"
  (cd "$OUTBOX" && rm -f -- "${files[@]}")
}

push_set '*.age'
push_set '*.meta'
state_set last_push "$(date +%s)"
render_backup_metrics
log "금고로 보내기 완료"
