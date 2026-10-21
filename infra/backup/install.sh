#!/usr/bin/env bash
# 서버에 백업 구성을 설치한다. 몇 번 실행해도 같은 결과다(멱등). root로 실행한다.
#   sudo bash infra/backup/install.sh app                  # 서버 A: 백업 스크립트, 디렉터리, 전송 키, 타이머
#   sudo bash infra/backup/install.sh ops                  # 서버 B: 금고 ingest, 디렉터리, 타이머
#   sudo bash infra/backup/install.sh pin-vault-host [--yes]  # A에서: B의 호스트 키를 확인하고 등록한다
# 타이머가 도는 코드는 저장소 체크아웃이 아니라 root만 쓸 수 있는 사본($FIT_INSTALL_ROOT, 기본 /usr/local/lib/fit/repo)이다.
# 배포 러너(gitlab-runner)가 저장소를 바꿔도 root로 도는 백업 코드는 바뀌지 않게 하려는 것이다. 코드를 고치면 이 스크립트를 다시 실행한다.
# 환경변수(선택): FIT_SKIP(쉼표로 구분, 시험용) apt, systemd. FIT_INSTALL_ROOT, FIT_SYSTEMD_DIR(/etc/systemd/system), FIT_ENV_DIR(/etc/fit),
#   FIT_BACKUP_DIR(/srv/fit/backups), FIT_VAULT_DIR(/srv/vault), FIT_METRICS_DIR(/var/lib/fit/metrics), FIT_VAULT_METRICS_DIR($FIT_VAULT_DIR/metrics)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SKIP=",${FIT_SKIP:-},"
INSTALL_ROOT="${FIT_INSTALL_ROOT:-/usr/local/lib/fit/repo}"
SYSTEMD_DIR="${FIT_SYSTEMD_DIR:-/etc/systemd/system}"
ENV_DIR="${FIT_ENV_DIR:-/etc/fit}"
KEYS_DIR="${FIT_KEYS_DIR:-$ENV_DIR/keys}"
BACKUP_DIR="${FIT_BACKUP_DIR:-/srv/fit/backups}"
PREDEPLOY_DIR="${FIT_PREDEPLOY_DIR:-$(dirname "$BACKUP_DIR")/predeploy}"
VAULT_DIR="${FIT_VAULT_DIR:-/srv/vault}"
METRICS_DIR="${FIT_METRICS_DIR:-/var/lib/fit/metrics}"
VAULT_METRICS_DIR="${FIT_VAULT_METRICS_DIR:-$VAULT_DIR/metrics}"
CHANGES=0
PUT=0

step() { printf '\n== %s\n' "$*"; }
log() { printf '%s\n' "$*"; }
die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
skipped() { case "$SKIP" in *",$1,"*) log "건너뜀($1)"; return 0 ;; esac; return 1; }
changed() { CHANGES=$((CHANGES + 1)); log "변경: $*"; }

# put_file 원본 대상 모드 [소유자:그룹]: 내용, 모드, 소유자 중 하나라도 다르면 설치하고 PUT=1로 둔다
put_file() {
  local src="$1" dst="$2" mode="$3" owner="${4:-root:root}"
  PUT=0
  if [ -f "$dst" ] && cmp -s "$src" "$dst" && [ "$(stat -c %a "$dst")" = "$mode" ] && [ "$(stat -c %U:%G "$dst")" = "$owner" ]; then
    return 0
  fi
  install -D -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$src" "$dst"
  PUT=1
  changed "$dst"
}
ensure_dir() { # ensure_dir 경로 모드 소유자:그룹
  if [ -d "$1" ] && [ "$(stat -c %a "$1")" = "$2" ] && [ "$(stat -c %U:%G "$1")" = "$3" ]; then return 0; fi
  install -d -m "$2" -o "${3%%:*}" -g "${3##*:}" "$1"
  chmod "$2" "$1" # install -d는 setgid 비트를 빼먹을 수 있어 한 번 더 맞춘다
  changed "디렉터리 $1"
}

preflight() {
  [ "$(id -u)" = 0 ] || die "root로 실행한다(sudo)"
  for d in "$REPO/infra/backup" "$REPO/infra/data" "$REPO/infra/ci/tool-images.sh"; do
    [ -e "$d" ] || die "저장소 구조가 맞지 않는다: $d"
  done
}

install_packages() { # install_packages 패키지...: 없는 명령이 있을 때만 apt로 설치한다
  local pkgs=("$@")
  step "패키지"
  skipped apt && return 0
  if command -v age >/dev/null 2>&1 && command -v rsync >/dev/null 2>&1 && command -v ssh >/dev/null 2>&1 && { [ "$ROLE" != ops ] || command -v rrsync >/dev/null 2>&1; }; then
    log "필요한 패키지가 이미 있다"
    return 0
  fi
  apt-get -o Acquire::Retries=3 update -qq
  DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y -qq "${pkgs[@]}" >/dev/null
  changed "패키지 ${pkgs[*]}"
}

# mirror_code: 저장소의 backup, data(시험 제외), ci/tool-images.sh를 root 소유 사본으로 둔다. 바뀐 파일만 갱신하고 사라진 파일은 지운다
mirror_code() {
  step "코드 사본 $INSTALL_ROOT"
  local stage rel
  stage="$(mktemp -d)"
  mkdir -p "$stage/infra/backup" "$stage/infra/data" "$stage/infra/ci"
  (cd "$REPO/infra/backup" && tar -c --exclude=./test .) | tar -x -C "$stage/infra/backup"
  (cd "$REPO/infra/data" && tar -c --exclude=./test .) | tar -x -C "$stage/infra/data"
  cp "$REPO/infra/ci/tool-images.sh" "$stage/infra/ci/tool-images.sh"
  if [ -d "$INSTALL_ROOT" ] && diff -rq "$stage" "$INSTALL_ROOT" >/dev/null 2>&1; then
    log "코드 사본이 최신이다"
  else
    rm -rf "$INSTALL_ROOT.new"
    install -d -m 755 -o root -g root "$(dirname "$INSTALL_ROOT")" "$INSTALL_ROOT.new"
    cp -a "$stage/." "$INSTALL_ROOT.new/"
    chown -R root:root "$INSTALL_ROOT.new"
    chmod -R go-w "$INSTALL_ROOT.new"
    rm -rf "$INSTALL_ROOT.old"
    if [ -d "$INSTALL_ROOT" ]; then mv "$INSTALL_ROOT" "$INSTALL_ROOT.old"; fi
    mv "$INSTALL_ROOT.new" "$INSTALL_ROOT"
    rm -rf "$INSTALL_ROOT.old"
    changed "코드 사본 $INSTALL_ROOT"
  fi
  rm -rf "$stage"
  for rel in infra/backup/backup-run.sh infra/backup/vault-ingest.sh; do
    [ -x "$INSTALL_ROOT/$rel" ] || die "$INSTALL_ROOT/$rel에 실행 권한이 없다"
  done
}

install_units() { # install_units 파일...: 유닛을 설치하고 타이머를 켠다
  step "systemd 유닛"
  local any=0 f
  for f in "$@"; do
    put_file "$HERE/conf/systemd/$f" "$SYSTEMD_DIR/$f" 644
    [ "$PUT" = 0 ] || any=1
  done
  skipped systemd && return 0
  if [ "$any" = 1 ]; then systemctl daemon-reload; fi
  for f in "$@"; do
    case "$f" in *.timer) systemctl enable --now "$f" >/dev/null 2>&1 ;; esac
  done
}

setup_app() {
  ROLE=app
  preflight
  install_packages age rsync openssh-client
  mirror_code
  step "디렉터리와 설정"
  ensure_dir "$BACKUP_DIR" 700 root:root
  local d
  for d in pg photos caddy outbox state; do ensure_dir "$BACKUP_DIR/$d" 700 root:root; done
  # 배포 러너(gitlab-runner, docker 그룹)가 마이그레이션 전 덤프를 쓴다. 평문이라 다른 사용자는 읽지 못하게 한다(2770 = setgid).
  # 러너가 지나갈 수 있도록 root 전용인 백업 디렉터리 밖에 둔다
  ensure_dir "$PREDEPLOY_DIR" 2770 root:docker
  ensure_dir "$METRICS_DIR" 755 root:root
  if [ ! -e "$ENV_DIR/backup.env" ]; then
    install -D -m 640 -o root -g docker "$REPO/infra/backup/backup.env.example" "$ENV_DIR/backup.env"
    changed "$ENV_DIR/backup.env(예제에서 만들었다. BACKUP_VAULT_HOST를 채운다)"
  fi
  step "전송 키"
  ensure_dir "$KEYS_DIR" 700 root:root
  if [ ! -f "$KEYS_DIR/vault_ed25519" ]; then
    ssh-keygen -q -t ed25519 -N '' -C fit-a-backup -f "$KEYS_DIR/vault_ed25519"
    changed "$KEYS_DIR/vault_ed25519(새 키)"
  fi
  install_units fit-backup@.service fit-backup-pg.timer fit-backup-photos.timer fit-backup-caddy.timer
  step "남은 수동 단계"
  log "1. B에서: sudo bash infra/backup/vault-authorize.sh '$(cat "$KEYS_DIR/vault_ed25519.pub")' <A의 IP>"
  log "2. A에서: sudo bash infra/backup/install.sh pin-vault-host   (B의 호스트 키 지문을 B의 지문과 대조한 뒤 --yes)"
  log "3. A에서: $KEYS_DIR/age-recipients.txt 에 수신자 2명의 공개키(age1...)를 한 줄씩 넣는다"
  log "4. A에서: $ENV_DIR/backup.env 의 BACKUP_VAULT_HOST를 B의 주소로 채운다"
  log "변경 $CHANGES건"
}

setup_ops() {
  ROLE=ops
  preflight
  install_packages rsync python3 openssh-server
  mirror_code
  step "디렉터리와 설정"
  ensure_dir "$VAULT_DIR/store" 700 root:root
  ensure_dir "$VAULT_DIR/state" 700 root:root
  ensure_dir "$VAULT_METRICS_DIR" 755 root:root
  if [ ! -e "$ENV_DIR/backup.env" ]; then
    install -D -m 640 -o root -g docker "$REPO/infra/backup/backup.env.example" "$ENV_DIR/backup.env"
    changed "$ENV_DIR/backup.env(예제에서 만들었다. 보관 기간 BACKUP_KEEP_*을 확인한다)"
  fi
  install_units fit-vault-ingest.service fit-vault-ingest.timer
  log "변경 $CHANGES건"
}

# pin-vault-host: B의 ed25519 호스트 키를 받아 지문을 보여 주고, 사람이 B의 지문과 대조한 뒤 --yes를 주면 등록한다
pin_vault_host() {
  [ "$(id -u)" = 0 ] || die "root로 실행한다(sudo)"
  # shellcheck source=infra/backup/lib.sh
  . "$HERE/lib.sh"
  load_backup_env
  case "$BACKUP_VAULT_HOST" in "" | *REPLACE_ME*) die "backup.env의 BACKUP_VAULT_HOST를 먼저 채운다" ;; esac
  [[ "$BACKUP_VAULT_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || die "BACKUP_VAULT_HOST 형식이 틀렸다"
  local tmp
  tmp="$(mktemp)"
  ssh-keyscan -p "$BACKUP_VAULT_PORT" -t ed25519 "$BACKUP_VAULT_HOST" >"$tmp" 2>/dev/null
  [ -s "$tmp" ] || die "B($BACKUP_VAULT_HOST:$BACKUP_VAULT_PORT)에서 호스트 키를 받지 못했다"
  log "B의 호스트 키 지문(B에서 ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 의 결과와 같아야 한다):"
  ssh-keygen -lf "$tmp"
  if [ "${1:-}" = "--yes" ]; then
    install -d -m 700 "$KEYS_DIR"
    install -m 600 "$tmp" "$KEYS_DIR/vault_known_hosts"
    log "$KEYS_DIR/vault_known_hosts 에 등록했다"
  else
    log "지문이 같으면 --yes를 붙여 다시 실행한다"
  fi
  rm -f "$tmp"
}

case "${1:-}" in
  app) setup_app ;;
  ops) setup_ops ;;
  pin-vault-host) pin_vault_host "${2:-}" ;;
  *)
    echo "사용: sudo bash infra/backup/install.sh app | ops | pin-vault-host [--yes]" >&2
    exit 2
    ;;
esac
