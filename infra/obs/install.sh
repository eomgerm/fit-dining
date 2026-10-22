#!/usr/bin/env bash
# 서버 A에 관측 구성을 설치한다. 몇 번 실행해도 같은 결과다(멱등). root로 실행한다.
#   sudo bash infra/obs/install.sh
# 하는 일: 일일 점검 요약 스크립트의 root 소유 사본, obs.env(없으면 예제에서), 요약 타이머(매일 09:00과 18:00 KST).
# 타이머가 도는 코드는 저장소 체크아웃이 아니라 root만 쓸 수 있는 사본($FIT_OBS_ROOT, 기본 /usr/local/lib/fit/obs)이다(infra/backup/install.sh와 같은 이유).
# 관측 스택(prometheus 등)은 이 스크립트가 올리지 않는다. obs.env를 채우면 `bash infra/deploy/fit-up.sh`가 올린다.
# 타이머는 obs.env의 MATTERMOST_WEBHOOK_URL이 채워진 뒤에 켠다. 채우기 전에 실행했다면 채운 뒤 이 스크립트를 다시 실행한다.
# 환경변수(선택): FIT_SKIP(쉼표로 구분, 시험용) apt, systemd. FIT_OBS_ROOT, FIT_SYSTEMD_DIR(/etc/systemd/system), FIT_ENV_DIR(/etc/fit)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SKIP=",${FIT_SKIP:-},"
OBS_ROOT="${FIT_OBS_ROOT:-/usr/local/lib/fit/obs}"
SYSTEMD_DIR="${FIT_SYSTEMD_DIR:-/etc/systemd/system}"
ENV_DIR="${FIT_ENV_DIR:-/etc/fit}"
UNITS=(fit-daily-digest.service fit-daily-digest.timer)
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
for f in "$REPO/infra/obs/daily-digest.py" "$REPO/infra/obs/obs.env.example" "$HERE/conf/systemd/${UNITS[0]}"; do
  [ -e "$f" ] || die "저장소 구조가 맞지 않는다: $f"
done

step "패키지"
if skipped apt; then :
elif command -v python3 >/dev/null 2>&1 && command -v openssl >/dev/null 2>&1; then log "필요한 패키지가 이미 있다"
else
  apt-get -o Acquire::Retries=3 update -qq
  DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y -qq python3 openssl >/dev/null
  changed "패키지 python3 openssl"
fi

step "코드 사본 $OBS_ROOT"
ensure_dir "$OBS_ROOT" 755
put_file "$REPO/infra/obs/daily-digest.py" "$OBS_ROOT/daily-digest.py" 755

step "설정"
if [ ! -e "$ENV_DIR/obs.env" ]; then
  # 배포 러너(docker 그룹)가 fit-up.sh로 compose에 --env-file로 넘긴다. 다른 사용자는 읽지 못한다
  install -D -m 640 -o root -g docker "$REPO/infra/obs/obs.env.example" "$ENV_DIR/obs.env"
  changed "$ENV_DIR/obs.env(예제에서 만들었다. 값을 채운다)"
fi
READY=0
if hook="$(grep -E '^MATTERMOST_WEBHOOK_URL=' "$ENV_DIR/obs.env" | head -n 1 | cut -d= -f2-)" && [ -n "$hook" ] && [ "${hook#*REPLACE_ME}" = "$hook" ]; then READY=1; fi

step "systemd 유닛"
any=0
for f in "${UNITS[@]}"; do
  put_file "$HERE/conf/systemd/$f" "$SYSTEMD_DIR/$f" 644
  [ "$PUT" = 0 ] || any=1
done
if [ "$READY" = 0 ]; then log "타이머는 켜지 않았다(obs.env의 MATTERMOST_WEBHOOK_URL이 아직 비어 있다)"; fi
if ! skipped systemd; then
  if [ "$any" = 1 ]; then systemctl daemon-reload; fi
  if [ "$READY" = 1 ]; then
    for f in "${UNITS[@]}"; do
      case "$f" in *.timer) systemctl enable --now "$f" >/dev/null 2>&1 ;; esac
    done
  fi
fi

step "남은 수동 단계"
if [ "$READY" = 0 ]; then log "1. $ENV_DIR/obs.env 의 값을 채운 뒤 이 스크립트를 다시 실행해 요약 타이머를 켠다"; fi
log "2. 관측 스택을 올린다: bash infra/deploy/fit-up.sh"
log "3. 점검한다: bash infra/obs/verify-obs.sh"
log "4. 요약을 지금 한 번 보내 본다: sudo python3 $OBS_ROOT/daily-digest.py --dry-run (출력만) 또는 sudo systemctl start fit-daily-digest.service"
log "변경 $CHANGES건"
