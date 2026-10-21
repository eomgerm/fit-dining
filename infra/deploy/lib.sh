# shellcheck shell=bash disable=SC2034
# infra/deploy 스크립트가 함께 쓰는 함수다. 스크립트가 source한다(직접 실행하지 않는다). 설계 6.4절.
#
# 경로와 이름은 환경변수로 바꿀 수 있다(시험 환경이 쓴다). 서버에서는 기본값을 쓴다.
#   FIT_ENV_DIR(/etc/fit) FIT_STATE_DIR(/srv/fit/state) FIT_WEB_DIR(/srv/fit/web) FIT_REPO_DIR(저장소 루트)
#   FIT_EDGE_PROJECT(fit-edge) FIT_BE_IMAGE(be) FIT_FE_IMAGE(fe) FIT_NET_PROD·FIT_NET_DEV·FIT_NET_DATA(망 이름)
# 상태 파일 $STATE_DIR/deploy-<환경>.env는 compose의 --env-file이기도 하다. 이미지 태그와 활성 색이 여기에 있다.

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DEPLOY_DIR/../.." && pwd)"
ENV_DIR="${FIT_ENV_DIR:-/etc/fit}"
STATE_DIR="${FIT_STATE_DIR:-/srv/fit/state}"
WEB_DIR="${FIT_WEB_DIR:-/srv/fit/web}"
REPO_DIR="${FIT_REPO_DIR:-$ROOT_DIR}"
EDGE_PROJECT="${FIT_EDGE_PROJECT:-fit-edge}"
BE_IMAGE="${FIT_BE_IMAGE:-be}"
FE_IMAGE="${FIT_FE_IMAGE:-fe}"
BE_READY_TIMEOUT="${FIT_BE_READY_TIMEOUT:-150}"
FE_READY_TIMEOUT="${FIT_FE_READY_TIMEOUT:-60}"
DRAIN_SECONDS="${FIT_DRAIN_SECONDS:-30}"
MIGRATION_DIR="${FIT_MIGRATION_DIR:-be/src/main/resources/db/migration}"
export FIT_ENV_DIR="$ENV_DIR"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac

log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }
die() {
  printf 'FAIL %s\n' "$*" >&2
  exit 1
}

# Windows의 python3는 스토어 바로가기라 실행해 보고 고른다
find_python() {
  local c
  for c in "${PYTHON:-}" python3 python; do
    [ -n "$c" ] || continue
    if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
      printf '%s' "$c"
      return 0
    fi
  done
  return 1
}

# docker.exe(Windows)에 넘길 경로. Git Bash의 /tmp/...를 C:/... 모양으로 바꾼다. Linux에서는 그대로다
native_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# mode_is_private 파일: 다른 사용자(others)가 아무 권한도 없으면 성공한다(env 파일은 root:docker 0640, 설계 13.2절)
mode_is_private() {
  local mode
  mode="$(stat -c %a "$1")"
  [ "${mode: -1}" = 0 ]
}

valid_env() { case "$1" in prod | dev) return 0 ;; *) return 1 ;; esac; }
other_color() { if [ "$1" = blue ]; then echo green; else echo blue; fi; }
upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

# ---- 상태 파일 ----------------------------------------------------------------
state_file() { printf '%s/deploy-%s.env' "$STATE_DIR" "$1"; }

state_get() { # state_get 환경 키 [기본값]
  local f v=""
  f="$(state_file "$1")"
  if [ -f "$f" ]; then v="$(awk -v k="$2" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$f")"; fi
  printf '%s' "${v:-${3:-}}"
}

state_set() { # state_set 환경 KEY=VALUE...: 임시 파일에 쓴 뒤 mv로 바꾼다(원자적). 같은 키는 나중 값이 이긴다
  local env="$1" f tmp pair
  shift
  f="$(state_file "$env")"
  mkdir -p "$STATE_DIR"
  tmp="$(mktemp "$f.XXXXXX")"
  {
    if [ -f "$f" ]; then cat "$f"; fi
    for pair in "$@"; do printf '%s\n' "$pair"; done
  } | awk -F= '{ k = $1; v[k] = substr($0, length(k) + 2) } END { for (k in v) print k "=" v[k] }' | sort >"$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$f"
}

state_init() { # 처음 배포하는 환경의 상태 파일을 만든다. prod는 활성이 green이라 첫 배포가 blue로 간다(엣지 견본의 upstream과 같다)
  if [ -f "$(state_file "$1")" ]; then return 0; fi
  if [ "$1" = prod ]; then
    state_set prod BE_ACTIVE=green FE_ACTIVE=green BE_BLUE_TAG=none BE_GREEN_TAG=none FE_BLUE_TAG=none FE_GREEN_TAG=none DEPLOYED_SHA=none PREVIOUS_SHA=none
  else
    state_set dev BE_DEV_TAG=none BE_DEV_PREV_TAG=none FE_DEV_TAG=none FE_DEV_PREV_TAG=none DEPLOYED_SHA=none PREVIOUS_SHA=none
  fi
}

# ---- 이름 규칙 ----------------------------------------------------------------
svc_name() { # svc_name be|fe 환경 [색] → be-prod-blue, be-dev
  if [ "$2" = dev ]; then printf '%s-dev' "$1"; else printf '%s-prod-%s' "$1" "$3"; fi
}
svc_port() { if [ "$1" = be ]; then printf 8080; else printf 3000; fi; }
tag_key() { # tag_key be|fe 환경 [색] → BE_BLUE_TAG, BE_DEV_TAG
  if [ "$2" = dev ]; then printf '%s_DEV_TAG' "$(upper "$1")"; else printf '%s_%s_TAG' "$(upper "$1")" "$(upper "$3")"; fi
}
image_of() { if [ "$1" = be ]; then printf '%s' "$BE_IMAGE"; else printf '%s' "$FE_IMAGE"; fi; }

# docker에 넘기는 파일 경로는 native_path를 거친다(Windows의 docker.exe는 /c/... 모양을 읽지 못한다)
app_compose_file() { native_path "$ROOT_DIR/infra/app/compose.app.yml"; }
compose() { # compose 환경 인자...
  local env="$1"
  shift
  docker compose -p "fit-app-$env" -f "$(app_compose_file)" --env-file "$(native_path "$(state_file "$env")")" --profile "$env" "$@"
}

# ---- 엣지와 점검 ----------------------------------------------------------------
caddy_container() {
  docker ps -q --filter "label=com.docker.compose.project=$EDGE_PROJECT" --filter "label=com.docker.compose.service=caddy" | head -n 1
}

# 컨테이너는 호스트에 게시하지 않으므로 같은 망에 있는 caddy 컨테이너 안에서 요청한다. 2xx가 아니면 실패한다
probe() {
  local c
  c="$(caddy_container)"
  [ -n "$c" ] || return 1
  docker exec "$c" wget -q -T 5 -O - "$1"
}

container_running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true)" = true ]; }

sha_match() { # sha_match 앞 뒤: 한쪽이 다른 쪽의 앞부분이면 같은 커밋으로 본다(7자 이상)
  local a="$1" b="$2"
  [ "${#a}" -ge 7 ] && [ "${#b}" -ge 7 ] || return 1
  case "$a" in "$b"*) return 0 ;; esac
  case "$b" in "$a"*) return 0 ;; esac
  return 1
}

json_string() { # json_string 키 본문: 첫 번째 "키": "값"의 값
  printf '%s' "$2" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
}

wait_ready() { # wait_ready be|fe 컨테이너: 준비될 때까지 2초 간격으로 본다. 컨테이너가 죽으면 바로 실패한다
  local svc="$1" name="$2" timeout limit now body
  if [ "$svc" = be ]; then timeout="$BE_READY_TIMEOUT"; else timeout="$FE_READY_TIMEOUT"; fi
  limit=$(($(date +%s) + timeout))
  while :; do
    container_running "$name" || {
      log "$name 컨테이너가 실행 중이 아니다"
      return 1
    }
    if [ "$svc" = be ]; then
      body="$(probe "http://$name:8081/actuator/health/readiness" 2>/dev/null || true)"
      if printf '%s' "$body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"UP"'; then return 0; fi
    elif probe "http://$name:3000/fe-healthz" >/dev/null 2>&1; then
      return 0
    fi
    now="$(date +%s)"
    if [ "$now" -ge "$limit" ]; then
      log "$name 준비 시간 초과(${timeout}초)"
      return 1
    fi
    sleep 2
  done
}

# 반대 색을 전환하기 전에 직접 확인한다. BE는 헬스와 버전, FE는 SSR 페이지와 /config.json이다(설계 6.4절 4단계)
smoke_idle() { # smoke_idle be|fe 환경 컨테이너 sha
  local svc="$1" env="$2" name="$3" sha="$4" body got
  if [ "$svc" = be ]; then
    probe "http://$name:8080/healthz" >/dev/null 2>&1 || {
      log "$name /healthz 실패"
      return 1
    }
    body="$(probe "http://$name:8080/api/v1/version" 2>/dev/null || true)"
    got="$(json_string sha "$body")"
    sha_match "$got" "$sha" || {
      log "$name 버전이 배포할 SHA와 다르다"
      return 1
    }
  else
    probe "http://$name:3000/" >/dev/null 2>&1 || {
      log "$name 첫 화면(SSR) 실패"
      return 1
    }
    body="$(probe "http://$name:3000/config.json" 2>/dev/null || true)"
    printf '%s' "$body" | grep -Eq "\"env\"[[:space:]]*:[[:space:]]*\"$env\"" || {
      log "$name /config.json의 env가 $env가 아니다"
      return 1
    }
  fi
}

write_upstream() { # write_upstream 환경 be|fe 호스트 포트: 엣지 상태 파일(infra/edge/state-sample과 같은 형식)을 원자적으로 바꾼다
  local f="$STATE_DIR/upstream-$1-$2.caddy"
  mkdir -p "$STATE_DIR"
  printf '%s\nreverse_proxy %s:%s {\n\tlb_try_duration 5s\n\tlb_try_interval 250ms\n}\n' \
    '# 활성 색 upstream. deploy.sh와 rollback.sh가 쓴다(설계 5.5절).' "$3" "$4" >"$f.new"
  mv -f "$f.new" "$f"
}
reload_edge() { bash "$ROOT_DIR/infra/edge/edgectl.sh" reload >/dev/null; }

# ---- 기록과 알림 ----------------------------------------------------------------
history_add() { # history_add 환경 동작 서비스 sha 결과
  mkdir -p "$STATE_DIR"
  printf '%s %s %s %s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" "$3" "$4" "$5" "$(id -un)" >>"$STATE_DIR/history-$1.log"
}
notify() { bash "$DEPLOY_DIR/notify.sh" "$@" || true; }

# ---- 잠금: flock이 없는 곳(Git Bash)에서도 되도록 mkdir로 한다. 프로세스가 죽어 남은 잠금은 pid로 알아본다 ----
LOCK_DIR=""
acquire_lock() { # acquire_lock 환경
  local pid
  mkdir -p "$STATE_DIR"
  LOCK_DIR="$STATE_DIR/deploy-$1.lock"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ >"$LOCK_DIR/pid"
    return 0
  fi
  pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    LOCK_DIR=""
    die "다른 배포가 돌고 있다(pid $pid)"
  fi
  log "프로세스가 죽어 남은 잠금을 지운다(pid ${pid:-?})"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  echo $$ >"$LOCK_DIR/pid"
}
release_lock() {
  if [ -n "$LOCK_DIR" ]; then rm -rf "$LOCK_DIR"; fi
  return 0
}

# 마이그레이션 파일이 바뀌었는가. 이전 SHA를 모르거나 커밋이 없으면 바뀐 것으로 본다(첫 배포)
migrations_changed() { # migrations_changed 이전sha 새sha
  if [ "${FIT_FORCE_MIGRATE:-0}" = 1 ]; then return 0; fi
  if [ "$1" = none ] || ! git -C "$REPO_DIR" cat-file -e "$1^{commit}" 2>/dev/null; then return 0; fi
  ! git -C "$REPO_DIR" diff --quiet "$1" "$2" -- "$MIGRATION_DIR"
}
