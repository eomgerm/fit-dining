#!/usr/bin/env bash
# 컨테이너가 클라우드 메타데이터 주소(169.254.169.254)에 닿지 못하게 막는다(설계 6.1절).
# 2026-11-02에 서버 A의 컨테이너에서 IMDSv2 토큰 발급이 200으로 닿는 것을 확인했다(호스트와 같은 주소). 컨테이너 안의 코드(특히 MR 코드를 도는
# CI 러너)가 인스턴스의 역할 자격 증명과 user-data를 읽을 수 있다는 뜻이라, 컨테이너발 패킷만 DOCKER-USER에서 버린다.
#   sudo bash infra/host/block-imds.sh        # 규칙을 넣고, 부팅과 Docker 재시작 때 다시 넣는 systemd 유닛을 설치한다(멱등)
#   sudo bash infra/host/block-imds.sh check  # 읽기만 한다(규칙과 유닛이 있는지. iptables를 읽으려면 root가 필요하다)
#   bash infra/host/block-imds.sh unit        # 설치할 유닛 파일 내용을 보여 준다
# 호스트 자신의 접근(SSM 에이전트 등)은 막지 않는다. DOCKER-USER는 컨테이너에서 나가는(포워딩) 패킷만 거른다.
# 환경변수(시험용): FIT_SKIP=systemd(유닛 설치를 건너뛴다), FIT_SYSTEMD_DIR(유닛 파일 위치)
set -euo pipefail

ADDR="169.254.169.254"
UNIT="fit-block-imds.service"
UNIT_DIR="${FIT_SYSTEMD_DIR:-/etc/systemd/system}"
SKIP=",${FIT_SKIP:-},"
CHANGES=0

log() { printf '%s\n' "$*"; }
die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }
changed() { CHANGES=$((CHANGES + 1)); log "변경: $*"; }
skipped() { case "$SKIP" in *",$1,"*) return 0 ;; esac; return 1; }

rule_present() { iptables -C DOCKER-USER -d "$ADDR" -j DROP >/dev/null 2>&1; }

unit_text() {
  cat <<EOF
[Unit]
Description=Block container access to the cloud metadata address
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -C DOCKER-USER -d $ADDR -j DROP 2>/dev/null || iptables -I DOCKER-USER 1 -d $ADDR -j DROP'

[Install]
WantedBy=multi-user.target
EOF
}

do_apply() {
  [ "$(id -u)" = 0 ] || die "root로 실행한다(sudo)"
  command -v iptables >/dev/null 2>&1 || die "iptables가 없다"
  step "DOCKER-USER 규칙"
  iptables -L DOCKER-USER -n >/dev/null 2>&1 || die "DOCKER-USER 체인이 없다. Docker가 켜져 있어야 한다(sudo systemctl start docker)"
  if rule_present; then
    log "이미 있다"
  else
    iptables -I DOCKER-USER 1 -d "$ADDR" -j DROP
    changed "컨테이너발 $ADDR 패킷을 버리는 규칙(DOCKER-USER 맨 위)"
  fi

  step "부팅 때 다시 넣는 유닛($UNIT)"
  if skipped systemd; then
    log "건너뜀(systemd)"
  else
    local path="$UNIT_DIR/$UNIT"
    if [ -f "$path" ] && [ "$(cat "$path")" = "$(unit_text)" ]; then
      log "이미 있다"
    else
      unit_text >"$path"
      chmod 644 "$path"
      systemctl daemon-reload
      changed "$path"
    fi
    systemctl is-enabled "$UNIT" >/dev/null 2>&1 || { systemctl enable "$UNIT" >/dev/null 2>&1 && changed "유닛 enable"; }
  fi
  log ""
  log "변경 ${CHANGES}건. 점검: 컨테이너에서 같은 주소를 불러 000이 나오는지 본다(gitlab-setup.md의 FE 러너 항목 1번)"
}

do_check() {
  local ok=1
  # iptables -C는 root만 읽는다. root가 아니면 규칙이 있어도 실패하므로 "규칙이 없다"로 잘못 알리지 않고 여기서 멈춘다
  [ "$(id -u)" = 0 ] || die "root로 실행한다(sudo bash infra/host/block-imds.sh check)"
  command -v iptables >/dev/null 2>&1 || die "iptables가 없다"
  if rule_present; then log "PASS  컨테이너발 $ADDR 패킷을 버리는 규칙이 DOCKER-USER에 있다"; else log "FAIL  규칙이 없다(sudo bash infra/host/block-imds.sh)"; ok=0; fi
  if skipped systemd; then
    log "SKIP  유닛 (FIT_SKIP=systemd)"
  elif systemctl is-enabled "$UNIT" >/dev/null 2>&1; then
    log "PASS  유닛 $UNIT이 켜져 있다(부팅 때 규칙을 다시 넣는다)"
  else
    log "FAIL  유닛 $UNIT이 없다(sudo bash infra/host/block-imds.sh)"; ok=0
  fi
  [ "$ok" = 1 ] || exit 1
}

case "${1:-apply}" in
  apply) do_apply ;;
  check) do_check ;;
  unit) unit_text ;;
  *) die "사용: block-imds.sh [apply|check|unit]" ;;
esac
