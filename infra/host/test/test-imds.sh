#!/usr/bin/env bash
# block-imds.sh를 노트북에서 시험한다(Ubuntu 컨테이너 + iptables). 컨테이너에는 NET_ADMIN을 주고 DOCKER-USER 체인을 직접 만든다.
#   bash infra/host/test/test-imds.sh
# 필요한 것: Docker, 인터넷(apt). 실제로 컨테이너가 메타데이터에 닿지 못하는지는 서버에서 처음 켤 때 확인한다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
W="$(pwd -W 2>/dev/null || pwd)"

docker run --rm --cap-add NET_ADMIN -v "$W/infra/host:/opt/fit-host:ro" ubuntu:24.04 bash -c '
set -uo pipefail
FAILED=0
pass() { printf "PASS  %s\n" "$1"; }
fail() { printf "FAIL  %s\n" "$1"; FAILED=$((FAILED + 1)); }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }
b() { if [ "$1" = ok ]; then echo 1; else echo 0; fi; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq iptables >/dev/null 2>&1
export FIT_SKIP=systemd FIT_SYSTEMD_DIR=/tmp/units
mkdir -p /tmp/units
S=/opt/fit-host/block-imds.sh

iptables -N DOCKER-USER
iptables -A DOCKER-USER -j RETURN
iptables -I DOCKER-USER 1 -s 10.0.0.0/8 -d 192.0.2.1 -j ACCEPT   # 다른 규칙이 이미 있다

echo "--- check: 규칙이 없으면 실패한다"
bash "$S" check >/tmp/c0.log 2>&1; rc=$?
ok_if "규칙이 없으면 check가 실패한다" "$([ "$rc" != 0 ] && grep -q "FAIL  규칙이 없다" /tmp/c0.log && echo 1 || echo 0)"

echo "--- apply"
bash "$S" >/tmp/a1.log 2>&1; rc=$?
ok_if "apply가 성공한다" "$([ "$rc" = 0 ] && echo 1 || echo 0)"
ok_if "규칙이 DOCKER-USER 맨 위에 들어간다(다른 규칙보다 먼저 본다)" "$([ "$(iptables -S DOCKER-USER | sed -n 2p)" = "-A DOCKER-USER -d 169.254.169.254/32 -j DROP" ] && echo 1 || echo 0)"
ok_if "원래 있던 규칙은 그대로다(허용 규칙과 RETURN)" "$([ "$(iptables -S DOCKER-USER | grep -c -E "192.0.2.1/32 -j ACCEPT|-j RETURN")" = 2 ] && echo 1 || echo 0)"
ok_if "변경 1건으로 알린다" "$(grep -q "변경 1건" /tmp/a1.log && echo 1 || echo 0)"

echo "--- 멱등"
bash "$S" >/tmp/a2.log 2>&1; rc=$?
ok_if "다시 실행하면 변경이 없고 규칙은 하나다" "$([ "$rc" = 0 ] && grep -q "변경 0건" /tmp/a2.log && [ "$(iptables -S DOCKER-USER | grep -c 169.254.169.254)" = 1 ] && echo 1 || echo 0)"
bash "$S" check >/tmp/c1.log 2>&1; rc=$?
ok_if "check가 통과한다" "$([ "$rc" = 0 ] && grep -q "PASS  컨테이너발 169.254.169.254" /tmp/c1.log && echo 1 || echo 0)"

echo "--- 규칙이 사라지면 check가 알아챈다"
iptables -D DOCKER-USER -d 169.254.169.254 -j DROP
bash "$S" check >/tmp/c2.log 2>&1; rc=$?
ok_if "규칙을 지우면 check가 실패한다" "$([ "$rc" != 0 ] && echo 1 || echo 0)"
bash "$S" >/dev/null 2>&1
ok_if "apply가 다시 넣는다" "$([ "$(iptables -S DOCKER-USER | grep -c 169.254.169.254)" = 1 ] && echo 1 || echo 0)"

echo "--- 유닛 파일(systemd를 켜지 않고 내용만 본다)"
bash "$S" unit >/tmp/unit.txt
ok_if "유닛은 Docker 뒤에 뜨고 Docker가 재시작되면 같이 다시 돈다" "$([ "$(grep -c -E "^(After|Requires|PartOf)=docker.service$" /tmp/unit.txt)" = 3 ] && echo 1 || echo 0)"
ok_if "유닛의 ExecStart는 규칙이 있으면 넣지 않는다(멱등)" "$(grep -q "iptables -C DOCKER-USER -d 169.254.169.254 -j DROP 2>/dev/null || iptables -I DOCKER-USER 1 -d 169.254.169.254 -j DROP" /tmp/unit.txt && echo 1 || echo 0)"
ok_if "부팅 때 켜지도록 multi-user.target에 걸려 있다" "$(grep -q "^WantedBy=multi-user.target$" /tmp/unit.txt && echo 1 || echo 0)"

echo "--- root가 아니면(iptables -C는 root만 읽는다) 규칙이 없다고 잘못 알리지 않고 root가 필요하다고 알린다"
setpriv --reuid=65534 --regid=65534 --clear-groups bash "$S" check >/tmp/c3.log 2>&1; rc=$?
ok_if "root가 아닌 check는 실패한다" "$([ "$rc" != 0 ] && echo 1 || echo 0)"
ok_if "root가 필요하다고 알린다" "$(grep -q "root" /tmp/c3.log && echo 1 || echo 0)"
ok_if "규칙이 없다는 거짓 보고를 하지 않는다(규칙은 실제로 있다)" "$(grep -q "규칙이 없다" /tmp/c3.log && echo 0 || echo 1)"

echo "--- 잘못된 사용"
bash "$S" bogus >/tmp/b.log 2>&1; rc=$?
ok_if "모르는 인자는 거부한다" "$([ "$rc" != 0 ] && echo 1 || echo 0)"

echo
if [ "$FAILED" = 0 ]; then echo "메타데이터 차단 시험 통과"; else echo "$FAILED개 실패"; exit 1; fi
'
