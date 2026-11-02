#!/usr/bin/env bash
# 서버가 설계 3절의 상태인지 점검한다. 읽기만 하고 아무것도 바꾸지 않는다. 점검마다 PASS, FAIL, SKIP만 출력하고 값(IP, 키)은 찍지 않는다.
#   sudo bash infra/host/verify-host.sh             # 역할은 /etc/fit/role에서 읽는다
#   sudo ROLE=app bash infra/host/verify-host.sh    # 역할을 지정한다
# 환경변수: FIT_PEER_IP(있으면 fail2ban ignoreip에 들어 있는지 본다), FIT_SKIP(bootstrap.sh와 같다), FIT_NET_PREFIX(networks.sh와 같다)
# 하나라도 FAIL이면 종료 코드 1이다.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$HERE/conf"
SKIP=",${FIT_SKIP:-},"
FAILED=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; } # ok_if 이름 1|0
is() { if [ "$1" = "$2" ]; then echo 1; else echo 0; fi; }
succeeds() { if "$@" >/dev/null 2>&1; then echo 1; else echo 0; fi; } # succeeds 명령...: 성공하면 1
skipped() { case "$SKIP" in *",$1,"*) return 0 ;; esac; return 1; }
file_is() { # file_is 경로 모드 소유자:그룹
  if [ -e "$1" ] && [ "$(stat -c %a "$1")" = "$2" ] && [ "$(stat -c %U:%G "$1")" = "$3" ]; then echo 1; else echo 0; fi
}

if [ "$(id -u)" != 0 ]; then
  echo "root로 실행한다(sudo). ufw와 sshd 설정을 읽으려면 필요하다" >&2
  exit 2
fi
ROLE="${ROLE:-$(cat /etc/fit/role 2>/dev/null || true)}"
case "$ROLE" in
  app | ops) ;;
  *)
    echo "역할을 알 수 없다. ROLE=app|ops를 주거나 bootstrap.sh를 먼저 실행한다" >&2
    exit 2
    ;;
esac
echo "ROLE=$ROLE"

sshd_value() { # sshd_value 사용자 키워드: 그 사용자에게 적용되는 값(소문자 키워드)
  sshd -T -C "user=$1,host=verify,addr=192.0.2.1" 2>/dev/null | awk -v k="$2" '$1 == k { $1 = ""; sub(/^ /, ""); print; exit }'
}

check_system() {
  echo "-- 시스템"
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:22.04 | ubuntu:24.04) pass "OS는 시험한 Ubuntu LTS다" ;;
    *) fail "OS가 Ubuntu 22.04 또는 24.04가 아니다" ;;
  esac
  local want=x86_64
  if [ "$ROLE" = ops ]; then want=aarch64; fi
  if skipped arch; then skip "CPU 구조 (FIT_SKIP=arch)"; else ok_if "CPU 구조가 ROLE=$ROLE에 맞다($want)" "$(is "$(uname -m)" "$want")"; fi
  local cur
  cur="$(readlink -f /etc/localtime 2>/dev/null || true)"
  ok_if "시간대는 Asia/Seoul이다" "$(is "${cur##*/zoneinfo/}$(cat /etc/timezone 2>/dev/null || true)" "Asia/SeoulAsia/Seoul")"
  if skipped systemd; then skip "시간 동기화 (FIT_SKIP=systemd)"; else
    ok_if "시간이 동기화돼 있다" "$(is "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" yes)"
  fi
  if grep -qx 'vm.swappiness = 10' /etc/sysctl.d/90-fit-common.conf 2>/dev/null; then pass "sysctl 설정 파일: swappiness 10"; else fail "sysctl 설정 파일: swappiness 10"; fi
  if [ "$ROLE" = app ]; then
    if grep -qx 'vm.max_map_count = 262144' /etc/sysctl.d/91-fit-app.conf 2>/dev/null; then pass "sysctl 설정 파일: max_map_count 262144"; else fail "sysctl 설정 파일: max_map_count 262144"; fi
  fi
  if skipped sysctl-apply; then skip "커널 값 적용 (FIT_SKIP=sysctl-apply)"; else
    ok_if "swappiness가 10이다" "$(is "$(sysctl -n vm.swappiness)" 10)"
    if [ "$ROLE" = app ]; then ok_if "max_map_count가 262144다" "$(is "$(sysctl -n vm.max_map_count)" 262144)"; fi
  fi
  if skipped swap; then skip "스왑 (FIT_SKIP=swap)"; else
    local want_mb=4096 cur_mb
    cur_mb="$(awk '/^SwapTotal:/ { print int($2 / 1024) }' /proc/meminfo)"
    ok_if "스왑이 목표(${want_mb}MB)의 95% 이상이다" "$([ "$cur_mb" -ge $((want_mb * 95 / 100)) ] && echo 1 || echo 0)"
    ok_if "재부팅 뒤에도 스왑이 켜지도록 fstab에 있다" "$(succeeds grep -qE '^/swapfile[[:space:]]' /etc/fstab)"
  fi
}

check_docker() {
  echo "-- Docker"
  ok_if "docker가 설치돼 있다" "$(succeeds command -v docker)"
  ok_if "docker compose 플러그인이 있다" "$(succeeds docker compose version)"
  ok_if "docker buildx 플러그인이 있다(이미지 아키텍처 검사에 쓴다)" "$(succeeds docker buildx version)"
  ok_if "daemon.json이 설계대로다(로그 로테이션$([ "$ROLE" = app ] && echo ', live-restore'))" "$(succeeds cmp -s "$CONF/daemon-$ROLE.json" /etc/docker/daemon.json)"
  ok_if "docker 그룹이 있다" "$(succeeds getent group docker)"
  if skipped systemd; then skip "Docker 데몬 상태 (FIT_SKIP=systemd)"; else
    ok_if "Docker 데몬이 돌고 있다" "$(succeeds docker info)"
    if [ "$ROLE" = app ]; then ok_if "live-restore가 켜져 있다" "$(is "$(docker info --format '{{.LiveRestoreEnabled}}' 2>/dev/null)" true)"; fi
    ok_if "정리 타이머가 켜져 있다" "$(succeeds systemctl is-enabled --quiet fit-docker-prune.timer)"
  fi
  ok_if "정리 스크립트가 설치돼 있다" "$(file_is /usr/local/lib/fit/docker-prune.sh 755 root:root)"
  ok_if "정리 서비스·타이머 유닛이 설계대로다" \
    "$(is "$(succeeds cmp -s "$CONF/systemd/fit-docker-prune.service" /etc/systemd/system/fit-docker-prune.service)$(succeeds cmp -s "$CONF/systemd/fit-docker-prune.timer" /etc/systemd/system/fit-docker-prune.timer)" 11)"
  if [ "$ROLE" = app ]; then
    if skipped networks || skipped systemd; then skip "공유 Docker 망 (FIT_SKIP)"; else
      ok_if "공유 Docker 망이 있고 net-data만 internal이다" "$(succeeds bash "$HERE/networks.sh" check)"
    fi
    if skipped imds || skipped systemd; then skip "컨테이너발 클라우드 메타데이터 차단 (FIT_SKIP)"; else
      ok_if "컨테이너에서 클라우드 메타데이터(169.254.169.254)로 못 나가고 재부팅 뒤에도 유지된다" "$(succeeds bash "$HERE/block-imds.sh" check)"
    fi
  fi
}

check_dirs_and_accounts() {
  echo "-- 디렉터리와 계정"
  ok_if "/etc/fit이 root:docker 750이다" "$(file_is /etc/fit 750 root:docker)"
  ok_if "/etc/fit/keys가 root 700이다" "$(file_is /etc/fit/keys 700 root:root)"
  ok_if "/etc/fit/role이 역할과 같다" "$(is "$(cat /etc/fit/role 2>/dev/null)" "$ROLE")"
  if [ "$ROLE" = app ]; then
    ok_if "/srv/fit/state, web이 root:docker 2775다(deploy 러너가 쓴다)" "$(is "$(file_is /srv/fit/state 2775 root:docker)$(file_is /srv/fit/web 2775 root:docker)" 11)"
    ok_if "/srv/fit/backups가 root 700이다" "$(file_is /srv/fit/backups 700 root:root)"
    ok_if "fit-dev 계정은 셸이 없다" "$(is "$(getent passwd fit-dev | cut -d: -f7)" /usr/sbin/nologin)"
    ok_if "fit-dev의 authorized_keys가 있고 권한이 맞다" "$(is "$(file_is /home/fit-dev/.ssh 700 fit-dev:fit-dev)$(file_is /home/fit-dev/.ssh/authorized_keys 600 fit-dev:fit-dev)" 11)"
  else
    ok_if "vault 계정이 있다" "$(succeeds id vault)"
    ok_if "/srv/vault/incoming은 vault 전용 700이다" "$(file_is /srv/vault/incoming 700 vault:vault)"
    ok_if "/srv/vault/store는 root 700이다" "$(file_is /srv/vault/store 700 root:root)"
  fi
}

check_ssh() {
  echo "-- SSH"
  ok_if "비밀번호 로그인이 꺼져 있다" "$(is "$(sshd_value ubuntu passwordauthentication)" no)"
  ok_if "키보드 대화형 로그인이 꺼져 있다" "$(is "$(sshd_value ubuntu kbdinteractiveauthentication)" no)"
  ok_if "root 로그인이 꺼져 있다" "$(is "$(sshd_value root permitrootlogin)" no)"
  ok_if "공개키 로그인이 켜져 있다" "$(is "$(sshd_value ubuntu pubkeyauthentication)" yes)"
  ok_if "SSH 포트가 22다" "$(is "$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2; exit }')" 22)"
  if [ "$ROLE" = app ]; then
    ok_if "fit-dev는 터널만 된다(local 전달, 개발 포트 세 개, TTY 없음, 명령 고정)" \
      "$(is "$(sshd_value fit-dev allowtcpforwarding)|$(sshd_value fit-dev permitopen)|$(sshd_value fit-dev permittty)|$(sshd_value fit-dev forcecommand)" \
        'local|127.0.0.1:3000 127.0.0.1:8888 127.0.0.1:5432|no|/usr/sbin/nologin')"
    ok_if "일반 계정의 포트 전달은 막히지 않았다(관리자 터널용)" "$(is "$(sshd_value ubuntu allowtcpforwarding)" yes)"
  else
    ok_if "vault는 전달·TTY·사용자 rc가 막혀 있다" \
      "$(is "$(sshd_value vault allowtcpforwarding)|$(sshd_value vault permittty)|$(sshd_value vault permituserrc)" 'no|no|no')"
  fi
  if skipped systemd; then skip "fail2ban 상태 (FIT_SKIP=systemd)"; else
    ok_if "fail2ban이 돌고 sshd 감옥이 켜져 있다" "$(succeeds fail2ban-client status sshd)"
  fi
  ok_if "fail2ban 설정 검사가 통과한다" "$(succeeds fail2ban-client -t)"
  ok_if "fail2ban sshd 감옥이 설정돼 있다(재시도 5회, 1시간)" \
    "$(is "$(grep -cE '^(maxretry = 5|bantime = 1h|enabled = true)$' /etc/fail2ban/jail.d/fit.local 2>/dev/null)" 3)"
  if [ -n "${FIT_PEER_IP:-}" ]; then
    local ip all=1
    for ip in $FIT_PEER_IP; do
      sed -n 's/^ignoreip = //p' /etc/fail2ban/jail.d/fit.local 2>/dev/null | tr ' ' '\n' | grep -qxF "$ip" || all=0
    done
    ok_if "fail2ban이 상대 서버를 차단하지 않는다(ignoreip)" "$all"
  else
    skip "fail2ban ignoreip의 상대 서버 (FIT_PEER_IP 없음)"
  fi
  ok_if "자동 보안 업데이트는 켜져 있고 자동 재부팅은 꺼져 있다" \
    "$(is "$(apt-config dump 2>/dev/null | grep -cE '^(APT::Periodic::Unattended-Upgrade "1";|Unattended-Upgrade::Automatic-Reboot "false";)$')" 2)"
}

check_firewall() {
  echo "-- 방화벽과 열린 포트"
  local expected added what
  if [ "$ROLE" = app ]; then
    expected="$(printf 'ufw allow 443/tcp\nufw allow 80/tcp\nufw limit 22/tcp')"
    what='22 limit, 80, 443'
  else
    # B: verify 러너 잡 컨테이너가 Testcontainers 형제 컨테이너의 게시 포트에 닿는 길(bootstrap.sh와 같은 규칙)
    expected="$(printf 'ufw allow in on docker0 from 172.17.0.0/16 to any port 32768:60999 proto tcp\nufw limit 22/tcp')"
    what='22 limit, docker0의 게시 포트 범위(CI)'
  fi
  # 규칙의 주석 문구는 비교에서 뺀다(주석이 달라도 같은 규칙이다)
  added="$(ufw show added 2>/dev/null | grep '^ufw ' | sed "s/ comment '.*'\$//" | sort)"
  ok_if "ufw 허용 규칙이 설계와 정확히 같다($what)" "$(is "$added" "$(printf '%s\n' "$expected" | sort)")"
  local status
  status="$(ufw status verbose 2>/dev/null)"
  ok_if "ufw가 켜져 있다" "$(is "$(printf '%s\n' "$status" | head -n 1)" 'Status: active')"
  ok_if "기본 정책은 들어오는 것 차단, 나가는 것 허용이다" "$(succeeds grep -q 'Default: deny (incoming), allow (outgoing)' <<<"$status")"
  # 외부에서 닿는 TCP 리스너(루프백이 아닌 주소)가 허용 포트뿐인가. Docker가 게시한 포트도 여기에 잡힌다
  local allowed=" 22 " bad="" port addr
  if [ "$ROLE" = app ]; then allowed=" 22 80 443 "; fi
  while read -r addr; do
    port="${addr##*:}"
    case "$addr" in 127.* | "[::1]:"* | "::1:"*) continue ;; esac
    case "$allowed" in *" $port "*) ;; *) bad="$bad $port" ;; esac
  done < <(ss -H -lnt 2>/dev/null | awk '{ print $4 }')
  if [ -z "$bad" ]; then pass "외부에 열린 TCP 포트가 허용 목록 안이다(${allowed# })"; else fail "허용 목록 밖에서 열린 TCP 포트:$bad"; fi
}

check_system
check_docker
check_dirs_and_accounts
check_ssh
check_firewall

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d개 점검 실패\n' "$FAILED"
  exit 1
fi
printf '\n호스트 정상\n'
