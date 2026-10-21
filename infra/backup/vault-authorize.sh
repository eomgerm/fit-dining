#!/usr/bin/env bash
# B에서 한 번 한다(root). A의 백업 전송용 공개키를 vault 계정에 등록한다(설계 8절 2번, 13.3절).
#   sudo bash infra/backup/vault-authorize.sh '<A의 vault_ed25519.pub 한 줄>' [A의 IP]
# 등록한 키는 쓰기 전용 rsync(rrsync -wo -no-del)로 incoming/에만 쓸 수 있다. 읽기, 삭제, 셸, 포트 포워딩은 막힌다.
# authorized_keys에는 이 키 한 줄만 둔다(다시 실행하면 그 줄로 바뀐다). A의 IP를 주면 그 주소에서만 접속할 수 있다.
# 경로: FIT_VAULT_DIR(/srv/vault), FIT_VAULT_HOME(/home/vault).
set -euo pipefail
# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

KEY="${1:-}"
PEER_IP="${2:-}"
VAULT="${FIT_VAULT_DIR:-/srv/vault}"
VAULT_HOME="${FIT_VAULT_HOME:-/home/vault}"
[[ "$KEY" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ [^[:space:]]+)?$ ]] || die "사용: vault-authorize.sh '<ssh-ed25519 공개키 한 줄>' [A의 IP]"
if [ -n "$PEER_IP" ]; then
  [[ "$PEER_IP" =~ ^[0-9a-fA-F:.]+(/[0-9]+)?$ ]] || die "IP 형식이 틀렸다: $PEER_IP"
fi
RRSYNC="$(command -v rrsync || true)"
[ -n "$RRSYNC" ] || die "rrsync가 없다(apt install rsync. Ubuntu 22.04는 python3도 필요하다)"
id vault >/dev/null 2>&1 || die "vault 계정이 없다(infra/host/bootstrap.sh ROLE=ops가 만든다)"

OPTIONS="command=\"$RRSYNC -wo -no-del $VAULT/incoming\",restrict"
if [ -n "$PEER_IP" ]; then OPTIONS="$OPTIONS,from=\"$PEER_IP\""; fi
mkdir -p "$VAULT_HOME/.ssh"
chmod 700 "$VAULT_HOME/.ssh"
printf '%s %s\n' "$OPTIONS" "$KEY" >"$VAULT_HOME/.ssh/authorized_keys"
chmod 600 "$VAULT_HOME/.ssh/authorized_keys"
chown -R vault:vault "$VAULT_HOME/.ssh"
log "vault 계정에 키를 등록했다(쓰기 전용 rrsync${PEER_IP:+, $PEER_IP에서만})"
