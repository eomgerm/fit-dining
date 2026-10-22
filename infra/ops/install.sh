#!/usr/bin/env bash
# 서버 B에 감시 구성을 설치한다. 몇 번 실행해도 같은 결과다(멱등). root로 실행한다.
#   sudo bash infra/ops/install.sh
# 하는 일: 포트 노출 감사 스크립트의 root 소유 사본, 지표 디렉터리, ops.env(없으면 예제에서), 감사 타이머(quick 15분, full 매일).
# 타이머가 도는 코드는 저장소 체크아웃이 아니라 root만 쓸 수 있는 사본($FIT_OPS_ROOT, 기본 /usr/local/lib/fit/ops)이다(infra/backup/install.sh와 같은 이유).
# 감시 스택(prometheus-b 등)은 이 스크립트가 올리지 않는다. ops.env를 채운 뒤 `bash infra/ops/ops-up.sh`로 올린다.
# 타이머는 ops.env의 PROD_HOST가 채워진 뒤에 켠다. 채우기 전에 실행했다면 채운 뒤 이 스크립트를 다시 실행한다.
# 환경변수(선택): FIT_SKIP(쉼표로 구분, 시험용) apt, systemd. FIT_OPS_ROOT, FIT_SYSTEMD_DIR(/etc/systemd/system), FIT_ENV_DIR(/etc/fit),
#   FIT_VAULT_DIR(/srv/vault), FIT_VAULT_METRICS_DIR($FIT_VAULT_DIR/metrics)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SKIP=",${FIT_SKIP:-},"
OPS_ROOT="${FIT_OPS_ROOT:-/usr/local/lib/fit/ops}"
SYSTEMD_DIR="${FIT_SYSTEMD_DIR:-/etc/systemd/system}"
ENV_DIR="${FIT_ENV_DIR:-/etc/fit}"
VAULT_DIR="${FIT_VAULT_DIR:-/srv/vault}"
VAULT_METRICS_DIR="${FIT_VAULT_METRICS_DIR:-$VAULT_DIR/metrics}"
UNITS=(fit-port-audit-quick.service fit-port-audit-quick.timer fit-port-audit-full.service fit-port-audit-full.timer)
CHANGES=0
PUT=0

step() { printf '\n== %s\n' "$*"; }
log() { printf '%s\n' "$*"; }
die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
skipped() { case "$SKIP" in *",$1,"*) log "건너뜀($1)"; return 0 ;; esac; return 1; }
changed() { CHANGES=$((CHANGES + 1)); log "변경: $*"; }

# put_file 원본 대상 모드: 내용, 모드, 소유자 중 하나라도 다르면 설치하고 PUT=1로 둔다
put_file() {
  local src="$1" dst="$2" mode="$3"
  PUT=0
  if [ -f "$dst" ] && cmp -s "$src" "$dst" && [ "$(stat -c %a "$dst")" = "$mode" ] && [ "$(stat -c %U:%G "$dst")" = root:root ]; then
    return 0
  fi
  install -D -m "$mode" -o root -g root "$src" "$dst"
  PUT=1
  changed "$dst"
}
ensure_dir() { # ensure_dir 경로 모드
  if [ -d "$1" ] && [ "$(stat -c %a "$1")" = "$2" ] && [ "$(stat -c %U:%G "$1")" = root:root ]; then return 0; fi
  install -d -m "$2" -o root -g root "$1"
  changed "디렉터리 $1"
}

[ "$(id -u)" = 0 ] || die "root로 실행한다(sudo)"
for f in "$REPO/infra/ops/port-audit.py" "$REPO/infra/ops/ops.env.example" "$HERE/conf/systemd/${UNITS[0]}"; do
  [ -e "$f" ] || die "저장소 구조가 맞지 않는다: $f"
done

step "패키지"
if skipped apt; then :
elif command -v python3 >/dev/null 2>&1; then log "필요한 패키지가 이미 있다"
else
  apt-get -o Acquire::Retries=3 update -qq
  DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y -qq python3 >/dev/null
  changed "패키지 python3"
fi

step "코드 사본 $OPS_ROOT"
ensure_dir "$OPS_ROOT" 755
put_file "$REPO/infra/ops/port-audit.py" "$OPS_ROOT/port-audit.py" 755

step "디렉터리와 설정"
ensure_dir "$VAULT_METRICS_DIR" 755
if [ ! -e "$ENV_DIR/ops.env" ]; then
  install -D -m 600 -o root -g root "$REPO/infra/ops/ops.env.example" "$ENV_DIR/ops.env"
  changed "$ENV_DIR/ops.env(예제에서 만들었다. 값을 채운다)"
fi
READY=0
if prod="$(grep -E '^PROD_HOST=' "$ENV_DIR/ops.env" | head -n 1 | cut -d= -f2-)" && [ -n "$prod" ] && [ "${prod#*REPLACE_ME}" = "$prod" ]; then READY=1; fi

step "systemd 유닛"
any=0
for f in "${UNITS[@]}"; do
  put_file "$HERE/conf/systemd/$f" "$SYSTEMD_DIR/$f" 644
  [ "$PUT" = 0 ] || any=1
done
if [ "$READY" = 0 ]; then log "타이머는 켜지 않았다(ops.env의 PROD_HOST가 아직 비어 있다)"; fi
if ! skipped systemd; then
  if [ "$any" = 1 ]; then systemctl daemon-reload; fi
  if [ "$READY" = 1 ]; then
    for f in "${UNITS[@]}"; do
      case "$f" in *.timer) systemctl enable --now "$f" >/dev/null 2>&1 ;; esac
    done
  fi
fi

step "남은 수동 단계"
if [ "$READY" = 0 ]; then log "1. $ENV_DIR/ops.env 의 값을 채운 뒤 이 스크립트를 다시 실행해 감사 타이머를 켠다"; fi
log "2. 감시 스택을 올린다: bash infra/ops/ops-up.sh"
log "3. 점검한다: bash infra/ops/verify-ops.sh"
log "변경 $CHANGES건"
