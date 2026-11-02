#!/usr/bin/env bash
# 서버 한 대를 설계 3절의 상태로 만든다. 몇 번 실행해도 같은 결과다(멱등). root로 실행한다.
#   sudo ROLE=app bash infra/host/bootstrap.sh    # 서버 A(EC2 x86)
#   sudo ROLE=ops bash infra/host/bootstrap.sh    # 서버 B(EC2 Arm)
# 환경변수(선택)
#   FIT_PEER_IP      상대 서버의 공인 IP(공백으로 여러 개). fail2ban이 이 주소는 차단하지 않는다
#   FIT_SKIP         건너뛸 단계(쉼표로 구분, 시험용): docker-install, swap, sysctl-apply, systemd, networks, imds
#   FIT_FORCE_SSH=1  키가 등록된 로그인 계정이 없어도 비밀번호 로그인을 끈다(서버에 못 들어갈 수 있다)
# 실행 전에 다른 터미널에서 키로 SSH 접속이 되는지 확인한다. 이 스크립트가 비밀번호 로그인을 끄기 때문이다.
# 확인은 infra/host/verify-host.sh가 한다.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$HERE/conf"
ROLE="${ROLE:-}"
SKIP=",${FIT_SKIP:-},"
CHANGES=0
PUT=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

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
  changed "디렉터리 $1"
}

ensure_user() { # ensure_user 이름 셸. 비밀번호는 '*'라 키로만 들어온다(잠긴 계정은 sshd가 거부할 수 있다)
  if id "$1" >/dev/null 2>&1; then return 0; fi
  useradd --create-home --shell "$2" --password '*' "$1"
  changed "계정 $1"
}

preflight() {
  step "사전 확인"
  [ "$(id -u)" = 0 ] || die "root로 실행한다(sudo)"
  case "$ROLE" in app | ops) ;; *) die "ROLE=app 또는 ROLE=ops를 지정한다" ;; esac
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = ubuntu ] || die "Ubuntu가 아니다"
  case "${VERSION_ID:-}" in
    22.04 | 24.04) ;;
    *) log "경고: 시험하지 않은 Ubuntu 버전이다(22.04와 24.04에서 시험했다)" ;;
  esac
  local want=x86_64
  if [ "$ROLE" = ops ]; then want=aarch64; fi
  [ "$(uname -m)" = "$want" ] || log "경고: ROLE=$ROLE은 $want 서버를 기대한다(설계 3절)"
  log "ROLE=$ROLE"
}

install_packages() {
  step "패키지"
  local pkgs=(ca-certificates curl gnupg tzdata rsync iproute2 openssh-server ufw fail2ban python3-systemd unattended-upgrades)
  local missing=() p
  for p in "${pkgs[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get -o Acquire::Retries=3 update -qq
    apt-get -o Acquire::Retries=3 install -y -qq --no-install-recommends "${missing[@]}" >/dev/null
    changed "패키지 설치: ${missing[*]}"
  else
    log "그대로"
  fi
}

set_timezone() {
  step "시간대"
  local want=Asia/Seoul cur
  cur="$(readlink -f /etc/localtime 2>/dev/null || true)"
  if [ "${cur##*/zoneinfo/}" = "$want" ] && [ "$(cat /etc/timezone 2>/dev/null || true)" = "$want" ]; then
    log "그대로"
    return 0
  fi
  ln -sf "/usr/share/zoneinfo/$want" /etc/localtime
  echo "$want" >/etc/timezone
  changed "시간대 $want"
}

setup_swap() {
  step "스왑"
  skipped swap && return 0
  # 두 서버 모두 4GB다. B는 BE와 FE의 무거운 CI 잡이 동시에 돌 때 RAM 3.8GB를 조금 넘는다(설계 6.1절)
  local want_mb=4096 cur_mb
  cur_mb="$(awk '/^SwapTotal:/ { print int($2 / 1024) }' /proc/meminfo)"
  if [ "$cur_mb" -ge $((want_mb * 95 / 100)) ]; then
    log "그대로(목표 ${want_mb}MB)"
  else
    if swapon --show=NAME --noheadings | grep -x /swapfile >/dev/null; then swapoff /swapfile; fi
    rm -f /swapfile
    fallocate -l "${want_mb}M" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count="$want_mb" status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    changed "스왑 ${want_mb}MB"
  fi
  if [ -f /swapfile ] && ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >>/etc/fstab
    changed "/etc/fstab의 스왑 항목"
  fi
}

apply_sysctl() {
  step "커널 설정"
  put_file "$CONF/sysctl-common.conf" /etc/sysctl.d/90-fit-common.conf 644
  if [ "$ROLE" = app ]; then put_file "$CONF/sysctl-app.conf" /etc/sysctl.d/91-fit-app.conf 644; fi
  skipped sysctl-apply && return 0
  sysctl --system >/dev/null
  log "적용함"
}

install_docker() {
  step "Docker"
  if command -v docker >/dev/null 2>&1; then
    log "이미 설치돼 있다(건드리지 않는다)"
    return 0
  fi
  skipped docker-install && return 0
  # shellcheck disable=SC1091
  . /etc/os-release
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL --retry 3 --retry-delay 2 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o Acquire::Retries=3 update -qq
  apt-get -o Acquire::Retries=3 install -y -qq --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  changed "Docker 설치"
}

configure_docker() {
  step "Docker 데몬 설정"
  local dst=/etc/docker/daemon.json
  # 이미 다른 설정이 있으면 한 번만 백업한다
  if [ -f "$dst" ] && ! cmp -s "$CONF/daemon-$ROLE.json" "$dst" && [ ! -e "$dst.fit-orig" ]; then
    cp -p "$dst" "$dst.fit-orig"
    log "기존 daemon.json을 $dst.fit-orig로 백업했다"
  fi
  put_file "$CONF/daemon-$ROLE.json" "$dst" 644
  [ "$PUT" = 1 ] || return 0
  skipped systemd && return 0
  if systemctl is-active --quiet docker; then
    if [ -z "$(docker ps -q)" ]; then
      systemctl restart docker
      log "Docker를 재시작했다"
    else
      log "경고: 컨테이너가 돌고 있어 Docker를 재시작하지 않았다. 적용하려면 점검 시간에 직접 재시작한다"
    fi
  fi
}

install_prune() {
  step "Docker 정리 타이머"
  local any=0
  put_file "$HERE/docker-prune.sh" /usr/local/lib/fit/docker-prune.sh 755
  [ "$PUT" = 0 ] || any=1
  put_file "$CONF/systemd/fit-docker-prune.service" /etc/systemd/system/fit-docker-prune.service 644
  [ "$PUT" = 0 ] || any=1
  put_file "$CONF/systemd/fit-docker-prune.timer" /etc/systemd/system/fit-docker-prune.timer 644
  [ "$PUT" = 0 ] || any=1
  skipped systemd && return 0
  if [ "$any" = 1 ]; then systemctl daemon-reload; fi
  systemctl enable --now fit-docker-prune.timer >/dev/null 2>&1
}

setup_accounts_and_dirs() {
  step "계정과 디렉터리"
  getent group docker >/dev/null || { groupadd --system docker; changed "docker 그룹"; }
  echo "$ROLE" >"$TMP/role"
  ensure_dir /etc/fit 750 root:docker
  ensure_dir /etc/fit/keys 700 root:root
  put_file "$TMP/role" /etc/fit/role 644
  if [ "$ROLE" = app ]; then
    ensure_dir /srv/fit 755 root:root
    # deploy 러너(gitlab-runner, docker 그룹)가 상태 파일과 정적 자산 풀을 쓴다. setgid라 새 파일도 docker 그룹이고, Caddy는 others로 읽기만 한다
    ensure_dir /srv/fit/state 2775 root:docker
    ensure_dir /srv/fit/web 2775 root:docker
    ensure_dir /srv/fit/backups 700 root:root
    ensure_user fit-dev /usr/sbin/nologin
    ensure_dir /home/fit-dev/.ssh 700 fit-dev:fit-dev
    if [ ! -e /home/fit-dev/.ssh/authorized_keys ]; then
      install -m 600 -o fit-dev -g fit-dev /dev/null /home/fit-dev/.ssh/authorized_keys
      changed "/home/fit-dev/.ssh/authorized_keys(빈 파일, 팀원 키는 사람이 넣는다)"
    fi
  else
    ensure_user vault /bin/bash
    ensure_dir /srv/vault 755 root:root
    ensure_dir /srv/vault/incoming 700 vault:vault
    ensure_dir /srv/vault/store 700 root:root
  fi
}

configure_fail2ban() {
  step "fail2ban"
  local ignore="127.0.0.1/8 ::1 ${FIT_PEER_IP:-}"
  if [ -z "${FIT_PEER_IP:-}" ]; then
    log "경고: FIT_PEER_IP가 없어 상대 서버가 ignoreip에 없다. A와 B 사이 전송이 차단될 수 있으니 상대 IP를 넣어 다시 실행한다"
  elif ! printf '%s' "$FIT_PEER_IP" | grep -qE '^[0-9a-fA-F:./ ]+$'; then
    die "FIT_PEER_IP에는 IP 주소만 쓴다"
  fi
  ignore="$(echo "$ignore" | xargs)"
  sed "s|@IGNOREIP@|$ignore|" "$CONF/fail2ban-fit.local" >"$TMP/fit.local"
  put_file "$TMP/fit.local" /etc/fail2ban/jail.d/fit.local 644
  if ! fail2ban-client -t >/dev/null 2>&1; then
    rm -f /etc/fail2ban/jail.d/fit.local
    die "fail2ban 설정 검사에 실패해 파일을 지웠다"
  fi
  skipped systemd && return 0
  if [ "$PUT" = 1 ]; then systemctl restart fail2ban; else systemctl enable --now fail2ban >/dev/null 2>&1; fi
}

configure_auto_upgrades() {
  step "자동 보안 업데이트"
  put_file "$CONF/apt-fit.conf" /etc/apt/apt.conf.d/52fit-auto-upgrades 644
}

has_admin_key() { # 키가 한 줄이라도 등록된 일반 로그인 계정이 있는가(터널·금고 계정은 제외)
  local f
  for f in /home/*/.ssh/authorized_keys; do
    [ -s "$f" ] || continue
    case "$(stat -c %U "$f")" in fit-dev | vault) continue ;; esac
    if grep -qvE '^[[:space:]]*(#|$)' "$f"; then return 0; fi
  done
  return 1
}

harden_ssh() {
  step "SSH 하드닝"
  if [ "${FIT_FORCE_SSH:-0}" != 1 ] && ! has_admin_key; then
    die "키가 등록된 로그인 계정이 없어 비밀번호 로그인을 끄지 않았다. 키를 등록하거나 FIT_FORCE_SSH=1을 준다"
  fi
  local dst=/etc/ssh/sshd_config.d/10-fit.conf prev=""
  cat "$CONF/sshd-common.conf" "$CONF/sshd-$ROLE.conf" >"$TMP/10-fit.conf"
  if [ -f "$dst" ]; then prev="$TMP/10-fit.prev"; cp -p "$dst" "$prev"; fi
  mkdir -p /run/sshd
  put_file "$TMP/10-fit.conf" "$dst" 644
  if ! sshd -t; then
    if [ -n "$prev" ]; then cp -p "$prev" "$dst"; else rm -f "$dst"; fi
    die "sshd 설정 검사에 실패해 되돌렸다"
  fi
  skipped systemd && return 0
  if [ "$PUT" = 1 ]; then systemctl reload ssh 2>/dev/null || systemctl reload sshd; fi
}

configure_ufw() {
  step "방화벽(ufw)"
  local port before after
  # awk가 먼저 끝나면 sshd가 SIGPIPE로 죽어 pipefail에 걸린다. 끝까지 읽는다
  port="$(sshd -T 2>/dev/null | awk '$1 == "port" && !seen { print $2; seen = 1 }')"
  [ "$port" = 22 ] || die "sshd가 22번 포트가 아니라 ufw가 SSH를 막을 수 있다(포트 ${port:-?}). 확인하고 다시 실행한다"
  before="$(ufw show added 2>/dev/null || true)"
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw limit 22/tcp >/dev/null
  if [ "$ROLE" = app ]; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
  else
    # B의 verify 러너 잡 컨테이너(기본 브리지)가 Testcontainers가 띄운 형제 컨테이너의 게시 포트에 호스트 게이트웨이로 닿게 한다(BE 계약 #13).
    # Docker가 게시 포트에 임의로 배정하는 범위만, 기본 브리지의 컨테이너에서 오는 연결만 연다. 22 같은 다른 포트나 다른 망은 열지 않는다
    ufw allow in on docker0 from 172.17.0.0/16 to any port 32768:60999 proto tcp comment 'ci: job container -> published ports (Testcontainers)' >/dev/null
  fi
  after="$(ufw show added 2>/dev/null || true)"
  if [ "$before" != "$after" ]; then changed "ufw 규칙"; fi
  ufw --force enable >/dev/null
  log "ufw 활성"
  # 목록에 없는 규칙은 지우지 않고 알려 준다(verify-host.sh가 실패로 보고한다)
  local extra known='limit 22/tcp|allow 80/tcp|allow 443/tcp'
  if [ "$ROLE" != app ]; then known="limit 22/tcp|allow in on docker0 from 172\.17\.0\.0/16 to any port 32768:60999 proto tcp( comment '[^']*')?"; fi
  extra="$(printf '%s\n' "$after" | grep '^ufw ' | grep -vE "^ufw ($known)\$" || true)"
  if [ -n "$extra" ]; then
    log "경고: 허용 목록에 없는 ufw 규칙이 있다. 필요 없으면 'ufw delete'로 지운다:"
    printf '  %s\n' "$extra"
  fi
}

create_networks() {
  step "Docker 망"
  [ "$ROLE" = app ] || { log "해당 없음(ROLE=ops)"; return 0; }
  skipped networks && return 0
  if docker info >/dev/null 2>&1; then
    bash "$HERE/networks.sh"
  else
    log "Docker가 응답하지 않아 건너뛴다. Docker를 띄운 뒤 'bash infra/host/networks.sh'를 실행한다"
  fi
}

block_imds() {
  step "컨테이너의 클라우드 메타데이터 접근 차단"
  [ "$ROLE" = app ] || { log "해당 없음(ROLE=ops)"; return 0; }
  skipped imds && return 0
  if docker info >/dev/null 2>&1; then
    bash "$HERE/block-imds.sh"
  else
    log "Docker가 응답하지 않아 건너뛴다. Docker를 띄운 뒤 'sudo bash infra/host/block-imds.sh'를 실행한다"
  fi
}

main() {
  preflight
  install_packages
  set_timezone
  setup_swap
  apply_sysctl
  install_docker
  configure_docker
  install_prune
  setup_accounts_and_dirs
  configure_fail2ban
  configure_auto_upgrades
  harden_ssh
  configure_ufw
  create_networks
  block_imds
  step "끝"
  if [ "$CHANGES" = 0 ]; then log "변경 없음"; else log "변경 ${CHANGES}건"; fi
  log "다음: sudo bash infra/host/verify-host.sh"
}

main
