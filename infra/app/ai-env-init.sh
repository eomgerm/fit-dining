#!/usr/bin/env bash
# AI API용 env 파일(/etc/fit/ai-<환경>.env)을 만든다. RB-14 2절의 2~4번을 한 번에 한다. 몇 번 실행해도 같은 결과다(멱등).
#   sudo bash infra/app/ai-env-init.sh dev            # data.env의 AI role 비밀번호 확인, role 만들기, ai-dev.env 만들고 값 채우기
#   sudo bash infra/app/ai-env-init.sh dev point-be   # BE가 AI API를 부르게 dev.env의 MODAL_*를 바꾼다(배포는 따로 한다)
# 값은 화면, 명령 인자, 출력 어디에도 남기지 않는다. 서버에 이미 있는 값(dev.env의 GMS·Modal, data.env의 비밀번호)을 파이프로
# envset.py에 넘기고, 비밀이 아닌 값만 인자로 준다. 이미 값이 있는 키는 바꾸지 않는다.
# 환경변수(시험용): FIT_ENV_DIR, FIT_ENVSET, FIT_REPO, FIT_HOME, FIT_PYTHON, FIT_ENSURE_DATABASES, FIT_AI_INIT_NOROOT=1
set -euo pipefail

die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
log() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }

ENVN="${1:-}"
ACTION="${2:-init}"
case "$ENVN" in dev | prod) ;; *) die "사용: sudo bash infra/app/ai-env-init.sh <dev|prod> [point-be]" ;; esac
case "$ACTION" in init | point-be) ;; *) die "두 번째 인자는 point-be만 받는다" ;; esac
[ "${FIT_AI_INIT_NOROOT:-0}" = 1 ] || [ "$(id -u)" = 0 ] || die "root로 실행한다(sudo)"

HOME_DIR="${FIT_HOME:-$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)}"
ENV_DIR="${FIT_ENV_DIR:-/etc/fit}"
REPO="${FIT_REPO:-$HOME_DIR/fit-repo}"
ENVSET="${FIT_ENVSET:-$HOME_DIR/host/envset.py}"
PY="${FIT_PYTHON:-python3}"
ENSURE="${FIT_ENSURE_DATABASES:-$REPO/infra/data/ensure-databases.sh}"
EXAMPLE="$REPO/infra/app/ai.env.example"
UP="$(printf '%s' "$ENVN" | tr '[:lower:]' '[:upper:]')"
APP_FILE="$ENV_DIR/$ENVN.env"
DATA_FILE="$ENV_DIR/data.env"
AI_FILE="$ENV_DIR/ai-$ENVN.env"
AI_NAME="ai-$ENVN"

# 파일에서 키의 첫 값(없으면 빈 문자열)
getv() { { grep -E "^$2=" "$1" 2>/dev/null || true; } | head -n 1 | cut -d= -f2-; }
# 값이 있고 자리표시자가 아니면 참
real() { [ -n "$1" ] && [ "${1#*REPLACE_ME}" = "$1" ]; }
# 비밀이 아닌 값은 인자로, 비밀 값은 파이프로 넘긴다(이미 있는 값은 --yes로 덮는 일이 없게 호출하는 쪽이 먼저 확인한다)
put_plain() { "$PY" "$ENVSET" set "$1" "$2=$3" --yes | sed 's/^/    /'; }
put_secret() { printf '%s\n' "$3" | "$PY" "$ENVSET" set "$1" "$2" --yes | sed 's/^/    /'; }

MISSING=""
fill_plain() { # fill_plain <KEY> <값>
  if real "$(getv "$AI_FILE" "$1")"; then log "    이미 있다: $1"; return 0; fi
  if real "$2"; then put_plain "$AI_NAME" "$1" "$2"; else MISSING="$MISSING $1"; fi
}
fill_secret() { # fill_secret <KEY> <값>
  if real "$(getv "$AI_FILE" "$1")"; then log "    이미 있다: $1"; return 0; fi
  if real "$2"; then put_secret "$AI_NAME" "$1" "$2"; else MISSING="$MISSING $1"; fi
}

do_init() {
  local f e k pw src
  for f in "$DATA_FILE" "$APP_FILE" "$ENVSET" "$EXAMPLE"; do [ -f "$f" ] || die "$f가 없다"; done

  step "data.env의 AI role 비밀번호(dev와 prod 둘 다 있어야 data 스크립트가 돈다)"
  for e in DEV PROD; do
    k="FIT_${e}_AI_PASSWORD"
    if real "$(getv "$DATA_FILE" "$k")"; then
      log "    이미 있다: $k"
    else
      openssl rand -hex 16 | "$PY" "$ENVSET" set data "$k" --yes | sed 's/^/    /'
    fi
  done

  step "role과 읽기 권한(ensure-databases.sh)"
  bash "$ENSURE" 2>&1 | tail -n 8 | sed 's/^/    /'

  step "$AI_FILE"
  if [ -f "$AI_FILE" ]; then
    log "    이미 있다(없는 값만 채운다)"
  else
    if [ "${FIT_AI_INIT_NOROOT:-0}" = 1 ]; then cp "$EXAMPLE" "$AI_FILE" && chmod 640 "$AI_FILE"; else install -m 640 -o root -g docker "$EXAMPLE" "$AI_FILE"; fi
    log "    예제에서 만들었다"
  fi

  step "값 채우기(이미 있는 값은 건드리지 않는다)"
  put_plain "$AI_NAME" APP_ENV "$ENVN"
  fill_plain GMS_BASE_URL "$(getv "$APP_FILE" GMS_BASE_URL)"
  fill_plain GMS_ENABLED "$(getv "$APP_FILE" GMS_ENABLED)"
  src="$(getv "$APP_FILE" MODAL_BASE_URL)"
  case "$src" in
    http://ai-*) if ! real "$(getv "$AI_FILE" EMBED_BASE_URL)"; then die "$ENVN.env의 MODAL_BASE_URL이 이미 AI API 주소다. Modal 임베딩 주소를 직접 넣는다: sudo python3 $ENVSET set $AI_NAME EMBED_BASE_URL=<주소>"; fi ;;
  esac
  case "$src" in http://ai-*) ;; *) fill_plain EMBED_BASE_URL "$src" ;; esac
  fill_secret GMS_API_KEY "$(getv "$APP_FILE" GMS_API_KEY)"
  fill_secret EMBED_KEY "$(getv "$APP_FILE" MODAL_KEY)"
  fill_secret EMBED_SECRET "$(getv "$APP_FILE" MODAL_SECRET)"
  pw="$(getv "$DATA_FILE" "FIT_${UP}_AI_PASSWORD")"
  fill_secret DATABASE_URL "$(real "$pw" && printf 'postgresql://fit_%s_ai:%s@postgres:5432/fit_%s' "$ENVN" "$pw" "$ENVN" || true)"

  step "점검(값은 나오지 않는다)"
  "$PY" "$ENVSET" status "$AI_NAME" | sed 's/^/    /' || true
  if [ -n "$MISSING" ]; then die "채우지 못한 키:$MISSING (원본 값이 비어 있다. envset.py로 직접 넣는다)"; fi
  log ""
  log "끝. 다음: BE가 AI를 부르게 하려면 sudo bash infra/app/ai-env-init.sh $ENVN point-be, 그다음 GitLab에서 build:images를 Retry한 뒤 deploy:$ENVN(RB-14 2절 6번)"
}

do_point_be() {
  local k
  [ -f "$AI_FILE" ] || die "$AI_FILE이 없다. 먼저 init을 실행한다"
  # Modal 토큰을 잃지 않게 AI 쪽에 값이 다 있는지 먼저 본다
  for k in EMBED_BASE_URL EMBED_KEY EMBED_SECRET DATABASE_URL; do
    real "$(getv "$AI_FILE" "$k")" || die "$AI_FILE의 $k가 비어 있다. 먼저 init으로 채운다(그 전에 $ENVN.env의 MODAL_*를 지우면 값을 잃는다)"
  done
  step "$APP_FILE: BE가 같은 서버의 AI API를 부르게 한다"
  put_plain "$ENVN" MODAL_BASE_URL "http://ai-$ENVN:8000"
  "$PY" "$ENVSET" unset "$ENVN" MODAL_KEY MODAL_SECRET --yes | sed 's/^/    /'
  log ""
  log "끝. BE는 다음 배포부터 AI API를 부른다. PLACE_MOCK_ENABLED가 true면 BE는 AI를 부르지 않는다(Mock 장소 사용)."
}

case "$ACTION" in
  init) do_init ;;
  point-be) do_point_be ;;
esac
