#!/usr/bin/env bash
# Ubuntu 컨테이너 안에서 bootstrap.sh와 verify-host.sh를 시험한다. test-host.sh가 컨테이너를 띄워 부른다.
#   bash run-in-container.sh app|ops
# 컨테이너에는 systemd와 Docker 데몬, 커널 전역 설정(스왑, sysctl)이 없어서 FIT_SKIP으로 그 단계만 건너뛴다.
# 나머지(패키지, Docker 설치, 설정 파일, SSH, fail2ban, ufw, 계정, 디렉터리)는 실제로 적용하고 점검한다.
set -uo pipefail

ROLE="${1:?app 또는 ops}"
H=/opt/fit-host
SKIPS=swap,sysctl-apply,systemd,networks
# 시험 컨테이너는 x86이라 B(Arm)의 CPU 구조 점검은 건너뛴다
if [ "$ROLE" = ops ]; then SKIPS="$SKIPS,arch"; fi
export ROLE FIT_SKIP="$SKIPS" FIT_PEER_IP="203.0.113.7 198.51.100.9"

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1"
  FAILED=$((FAILED + 1))
  # 실패한 점검 바로 앞에 캡처한 출력(변수 out)의 끝부분을 보여 줘서 원인을 알 수 있게 한다
  if [ -n "${out:-}" ]; then printf '%s\n' "$out" | tail -n 12 | sed 's/^/FAIL  > /'; fi
}
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }
has() { case "$1" in *"$2"*) echo 1 ;; *) echo 0 ;; esac; }
bootstrap() { bash "$H/bootstrap.sh" 2>&1; }
verify() { bash "$H/verify-host.sh" 2>&1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1
# 클라우드 이미지처럼 비밀번호 로그인을 켜는 파일이 있어도 우리 설정이 이겨야 한다
mkdir -p /etc/ssh/sshd_config.d
printf 'PasswordAuthentication yes\n' >/etc/ssh/sshd_config.d/60-cloudimg-settings.conf

echo "--- 잘못된 입력"
out="$(ROLE='' bash "$H/bootstrap.sh" 2>&1)"; rc=$?
ok_if "ROLE이 없으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'ROLE=app 또는 ROLE=ops')" = 1 ] && echo 1 || echo 0)"

echo "--- 관리자 키를 등록하고 적용"
# Ubuntu 24.04 이미지에는 ubuntu 계정이 이미 있고 22.04 이미지에는 없다
id ubuntu >/dev/null 2>&1 || useradd --create-home --shell /bin/bash ubuntu
install -d -m 700 -o ubuntu -g ubuntu /home/ubuntu/.ssh
KEYLINE='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA test@example'
echo "$KEYLINE" >/home/ubuntu/.ssh/authorized_keys
chown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys
chmod 600 /home/ubuntu/.ssh/authorized_keys
out="$(bootstrap)"; rc=$?
if [ "$rc" != 0 ]; then
  # 패키지 내려받기가 일시적으로 실패했을 수 있다. bootstrap은 멱등이라 한 번 더 실행한다
  echo "(첫 실행이 실패해 한 번 더 실행한다)"
  printf '%s\n' "$out" | tail -n 5
  out="$(bootstrap)"; rc=$?
fi
printf '%s\n' "$out" | tail -n 4
ok_if "bootstrap이 성공한다" "$([ "$rc" = 0 ] && echo 1 || echo 0)"
out="$(bootstrap)"; rc=$?
ok_if "다시 실행하면 변경이 없다(멱등)" "$([ "$rc" = 0 ] && [ "$(has "$out" '변경 없음')" = 1 ] && echo 1 || echo 0)"
out="$(verify)"; rc=$?
if [ -n "${FIT_TEST_VERBOSE:-}" ]; then
  printf '%s\n' "$out"
else
  printf '%s\n' "$out" | grep -E '^(FAIL|SKIP)|개 점검|호스트 정상' || true
fi
ok_if "verify-host가 통과한다" "$([ "$rc" = 0 ] && echo 1 || echo 0)"
ok_if "verify-host가 IP와 키 값을 출력하지 않는다" "$([ "$(has "$out" 203.0.113.7)$(has "$out" AAAAC3Nza)" = 00 ] && echo 1 || echo 0)"

echo "--- 설정 단위 확인"
ok_if "클라우드 이미지의 설정보다 우리 SSH 설정이 먼저 적용된다" \
  "$([ "$(sshd -T -C user=ubuntu,host=h,addr=192.0.2.1 | awk '$1 == "passwordauthentication" { print $2 }')" = no ] && echo 1 || echo 0)"
ok_if "daemon.json이 올바른 JSON이다" "$(python3 -c 'import json; json.load(open("/etc/docker/daemon.json"))' 2>/dev/null && echo 1 || echo 0)"
ok_if "Docker가 설치됐다" "$(docker --version >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && docker buildx version >/dev/null 2>&1 && echo 1 || echo 0)"
if apt-get install -y -qq systemd >/dev/null 2>&1; then
  ok_if "정리 타이머 유닛 문법이 맞다(systemd-analyze verify)" \
    "$(systemd-analyze verify /etc/systemd/system/fit-docker-prune.service /etc/systemd/system/fit-docker-prune.timer >/dev/null 2>&1 && echo 1 || echo 0)"
fi

echo "--- 잠금 방지: 관리자 키가 없으면 비밀번호 로그인을 끄지 않는다"
# 패키지가 이미 설치된 뒤에 시험해서 네트워크 상태와 무관하게 SSH 단계의 거부만 본다.
# 터널 계정(fit-dev)이나 금고 계정(vault)에 키가 있어도 관리자 키로 치지 않는다
TUNNEL_USER=fit-dev
if [ "$ROLE" = ops ]; then TUNNEL_USER=vault; fi
mv /home/ubuntu/.ssh/authorized_keys /tmp/authorized_keys.bak
install -d -m 700 -o "$TUNNEL_USER" -g "$TUNNEL_USER" "/home/$TUNNEL_USER/.ssh"
echo "$KEYLINE" >"/home/$TUNNEL_USER/.ssh/authorized_keys"
chown "$TUNNEL_USER:$TUNNEL_USER" "/home/$TUNNEL_USER/.ssh/authorized_keys"
chmod 600 "/home/$TUNNEL_USER/.ssh/authorized_keys"
rm -f /etc/ssh/sshd_config.d/10-fit.conf
out="$(bootstrap)"; rc=$?
ok_if "관리자 키가 없으면 bootstrap이 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '비밀번호 로그인을 끄지 않았다')" = 1 ] && echo 1 || echo 0)"
ok_if "거부했을 때 SSH 설정 파일을 만들지 않았다" "$([ ! -e /etc/ssh/sshd_config.d/10-fit.conf ] && echo 1 || echo 0)"
mv /tmp/authorized_keys.bak /home/ubuntu/.ssh/authorized_keys
chown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys
chmod 600 /home/ubuntu/.ssh/authorized_keys
: >"/home/$TUNNEL_USER/.ssh/authorized_keys"
out="$(bootstrap)"; rc=$?
ok_if "관리자 키를 되돌리면 bootstrap이 다시 성공한다" "$([ "$rc" = 0 ] && [ -e /etc/ssh/sshd_config.d/10-fit.conf ] && echo 1 || echo 0)"
out="$(FIT_PEER_IP='203.0.113.7; touch /tmp/injected' bootstrap)"; rc=$?
ok_if "FIT_PEER_IP에 IP가 아닌 값이 있으면 거부한다" "$([ "$rc" != 0 ] && [ ! -e /tmp/injected ] && echo 1 || echo 0)"
out="$(verify)"; rc=$?
ok_if "되돌린 뒤 verify-host가 통과한다" "$([ "$rc" = 0 ] && echo 1 || echo 0)"

# 망가뜨리면 verify-host가 잡고, bootstrap이 고치는지 본다: break_and_fix 이름 "망가뜨리는 명령" "기대하는 FAIL 문구" ["고치는 명령"]
break_and_fix() {
  local name="$1" breaker="$2" expect="$3" fixer="${4:-bootstrap}" out rc
  eval "$breaker"
  out="$(verify)"; rc=$?
  ok_if "$name: 망가뜨리면 verify-host가 실패한다" "$([ "$rc" = 1 ] && [ "$(has "$out" "$expect")" = 1 ] && echo 1 || echo 0)"
  eval "$fixer" >/dev/null 2>&1
  out="$(verify)"; rc=$?
  ok_if "$name: 고친 뒤 verify-host가 통과한다" "$([ "$rc" = 0 ] && echo 1 || echo 0)"
}

echo "--- 일부러 망가뜨리기"
break_and_fix "방화벽 허용 규칙 추가" "ufw allow 8000/tcp >/dev/null" "ufw 허용 규칙" "ufw delete allow 8000/tcp >/dev/null"
break_and_fix "비밀번호 로그인 켜기" "sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config.d/10-fit.conf" "비밀번호 로그인이 꺼져 있다"
break_and_fix "시간대" "ln -sf /usr/share/zoneinfo/UTC /etc/localtime; echo UTC >/etc/timezone" "시간대는 Asia/Seoul"
break_and_fix "fail2ban 감옥 삭제" "rm -f /etc/fail2ban/jail.d/fit.local" "fail2ban sshd 감옥이 설정돼 있다"
break_and_fix "daemon.json 변경" "echo '{}' >/etc/docker/daemon.json" "daemon.json이 설계대로다"
break_and_fix "/etc/fit 권한" "chmod 755 /etc/fit" "/etc/fit이 root:docker 750이다"
break_and_fix "자동 재부팅 켜기" "printf 'Unattended-Upgrade::Automatic-Reboot \"true\";\n' >/etc/apt/apt.conf.d/99zz-test" "자동 재부팅은 꺼져 있다" "rm -f /etc/apt/apt.conf.d/99zz-test"
if [ "$ROLE" = app ]; then
  break_and_fix "fit-dev 터널 제한 해제" "sed -i '/PermitOpen/d' /etc/ssh/sshd_config.d/10-fit.conf" "fit-dev는 터널만 된다"
  break_and_fix "상태 디렉터리 모드" "chmod 755 /srv/fit/state" "/srv/fit/state, web이 root:docker 2775다"
  break_and_fix "정적 자산 디렉터리 그룹" "chgrp root /srv/fit/web" "/srv/fit/state, web이 root:docker 2775다"
else
  break_and_fix "vault 전달 허용" "sed -i 's/AllowTcpForwarding no/AllowTcpForwarding yes/' /etc/ssh/sshd_config.d/10-fit.conf" "vault는 전달·TTY·사용자 rc가 막혀 있다"
fi
# 허용 목록 밖의 포트가 열리면 잡는다
/usr/sbin/sshd -p 2222 -o PidFile=/tmp/sshd2.pid
out="$(verify)"; rc=$?
ok_if "허용 목록 밖의 포트(2222)가 열리면 verify-host가 실패한다" "$([ "$rc" = 1 ] && [ "$(has "$out" '허용 목록 밖에서 열린 TCP 포트: 2222')" = 1 ] && echo 1 || echo 0)"
kill "$(cat /tmp/sshd2.pid)"
# 프로세스가 끝나 포트가 닫힐 때까지 기다린다(최대 10초)
for _ in 1 2 3 4 5 6 7 8 9 10; do
  ss -H -lnt | grep ':2222 ' >/dev/null || break
  sleep 1
done
out="$(verify)"; rc=$?
ok_if "포트를 닫으면 verify-host가 통과한다" "$([ "$rc" = 0 ] && echo 1 || echo 0)"
ok_if "daemon.json을 바꿨을 때 원래 파일을 한 번 백업했다" "$([ -e /etc/docker/daemon.json.fit-orig ] && echo 1 || echo 0)"

echo "--- 잘못된 SSH 설정은 되돌린다"
cp -r "$H" /tmp/host-bad
echo 'NoSuchKeyword yes' >>/tmp/host-bad/conf/sshd-common.conf
cp -p /etc/ssh/sshd_config.d/10-fit.conf /tmp/10-fit.before
out="$(bash /tmp/host-bad/bootstrap.sh 2>&1)"; rc=$?
ok_if "sshd -t가 실패하면 bootstrap이 멈춘다" "$([ "$rc" != 0 ] && [ "$(has "$out" '되돌렸다')" = 1 ] && echo 1 || echo 0)"
ok_if "되돌린 SSH 설정이 이전 파일과 같다" "$(cmp -s /tmp/10-fit.before /etc/ssh/sshd_config.d/10-fit.conf && echo 1 || echo 0)"

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d개 시험 실패(ROLE=%s)\n' "$FAILED" "$ROLE"
  exit 1
fi
printf '\n컨테이너 시험 통과(ROLE=%s)\n' "$ROLE"
