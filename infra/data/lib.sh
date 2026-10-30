# shellcheck shell=bash disable=SC2034
# infra/data 스크립트가 함께 쓰는 함수다. 스크립트가 source한다(직접 실행하지 않는다). 설계 7절.
#
# 경로와 이름은 환경변수로 바꿀 수 있다(시험 환경이 쓴다). 서버에서는 기본값을 쓴다.
#   FIT_ENV_DIR(/etc/fit) FIT_DATA_ENV($FIT_ENV_DIR/data.env) FIT_DATA_PROJECT(fit-data) FIT_NET_DATA(net-data)

DATA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DATA_DIR/../.." && pwd)"
ENV_DIR="${FIT_ENV_DIR:-/etc/fit}"
DATA_ENV="${FIT_DATA_ENV:-$ENV_DIR/data.env}"
DATA_PROJECT="${FIT_DATA_PROJECT:-fit-data}"
NET_DATA="${FIT_NET_DATA:-net-data}"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
# shellcheck source=infra/ci/tool-images.sh
. "$ROOT_DIR/infra/ci/tool-images.sh"

log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }
die() {
  printf 'FAIL %s\n' "$*" >&2
  exit 1
}

# read_env_file 파일: KEY=VALUE 줄만 읽어 환경변수로 올린다. 셸 코드로 실행(source)하지 않으므로 값에 $(...)나 따옴표가 있어도 명령이 실행되지 않는다.
# 형식이 틀린 줄은 줄 번호만 알려 준다(값에 비밀이 있을 수 있어 내용은 찍지 않는다).
read_env_file() {
  local line n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    case "$line" in '' | '#'*) continue ;; esac
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || die "$1의 ${n}번째 줄이 KEY=VALUE 형식이 아니다"
    export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
  done <"$1"
}

# data.env를 읽어 환경변수로 올린다. 필수 키가 없거나 자리표시자(REPLACE_ME)이면 멈춘다. 값은 출력하지 않는다.
DATA_KEYS="POSTGRES_PASSWORD FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD FIT_MONITOR_PASSWORD FIT_PROD_AI_PASSWORD FIT_DEV_AI_PASSWORD REDIS_PROD_PASSWORD REDIS_DEV_PASSWORD
  GARAGE_RPC_SECRET GARAGE_ADMIN_TOKEN S3_PROD_ACCESS_KEY S3_PROD_SECRET_KEY S3_DEV_ACCESS_KEY S3_DEV_SECRET_KEY"
load_data_env() {
  local k
  [ -f "$DATA_ENV" ] || die "$DATA_ENV 파일이 없다"
  # 호출한 셸의 환경에 같은 이름이 있어도 파일이 유일한 출처여야 한다
  # shellcheck disable=SC2086
  unset $DATA_KEYS
  read_env_file "$DATA_ENV"
  # shellcheck disable=SC2086
  for k in $DATA_KEYS; do
    [ -n "${!k:-}" ] || die "data.env에 $k가 없다"
    case "${!k}" in *REPLACE_ME*) die "data.env의 $k가 자리표시자(REPLACE_ME)다" ;; esac
  done
  # 비밀번호는 SQL과 compose 보간에 그대로 들어가므로 따옴표, $, 공백이 없는 문자만 쓴다
  for k in POSTGRES_PASSWORD FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD FIT_MONITOR_PASSWORD FIT_PROD_AI_PASSWORD FIT_DEV_AI_PASSWORD REDIS_PROD_PASSWORD REDIS_DEV_PASSWORD GARAGE_ADMIN_TOKEN; do
    printf '%s' "${!k}" | grep -Eq '^[A-Za-z0-9._~-]{16,}$' || die "data.env의 $k는 영문, 숫자, ._~- 만 쓴 16자 이상이어야 한다"
  done
  printf '%s' "$GARAGE_RPC_SECRET" | grep -Eq '^[0-9a-f]{64}$' || die "data.env의 GARAGE_RPC_SECRET은 64자리 16진수여야 한다"
}

svc_container() { # svc_container 서비스: compose 프로젝트의 컨테이너 ID(없으면 빈 값)
  docker ps -q --filter "label=com.docker.compose.project=$DATA_PROJECT" --filter "label=com.docker.compose.service=$1" | head -n 1
}
require_container() { # require_container 서비스 → 컨테이너 ID
  local c
  c="$(svc_container "$1")"
  [ -n "$c" ] || die "$1 컨테이너가 떠 있지 않다(프로젝트 $DATA_PROJECT)"
  printf '%s' "$c"
}

wait_healthy() { # wait_healthy 서비스 [제한 초]: 컨테이너가 healthy가 될 때까지 기다린다
  local svc="$1" limit c state
  limit=$(($(date +%s) + ${2:-120}))
  while :; do
    c="$(svc_container "$svc")"
    state=""
    if [ -n "$c" ]; then state="$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null | tr -d '\r\n' || true)"; fi
    if [ "$state" = healthy ]; then return 0; fi
    [ "$(date +%s)" -lt "$limit" ] || die "$svc가 healthy가 되지 않았다(상태: ${state:-컨테이너 없음})"
    sleep 2
  done
}

# 슈퍼유저로 psql을 돌린다. SQL은 표준 입력으로 준다(비밀번호가 프로세스 인자에 보이지 않게). 컨테이너 안의 소켓은 trust다
psql_admin() { # psql_admin [psql 인자...]
  docker exec -i "$(require_container postgres)" psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"
}
# role로 접속한다. 비밀번호는 환경변수로 넘긴다. pg_as ROLE PASSWORD DB SQL
# 공식 이미지는 컨테이너 안 loopback(127.0.0.1) 접속을 비밀번호 없이 허용(trust)한다. 서비스 이름(-h postgres)으로 접속하면
# 앱 컨테이너가 쓰는 길과 같아져 scram-sha-256 비밀번호 검사를 받는다.
pg_as() {
  docker exec -i -e "PGPASSWORD=$2" "$(require_container postgres)" psql -h postgres -U "$1" -d "$3" -v ON_ERROR_STOP=1 -qAt -c "$4"
}

native_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# s3tool.py를 net-data에 붙인 python 컨테이너에서 실행한다. 키는 임시 env 파일로 넘겨 프로세스 인자에 보이지 않게 한다.
# s3run ACCESS_KEY SECRET_KEY 명령 인자...
s3run() {
  local access="$1" secret="$2" envf rc=0
  shift 2
  envf="$(mktemp)"
  printf 'S3_ACCESS_KEY=%s\nS3_SECRET_KEY=%s\nS3_ENDPOINT=%s\n' "$access" "$secret" "${FIT_S3_ENDPOINT:-http://garage:3900}" >"$envf"
  docker run --rm -i --network "$NET_DATA" --env-file "$(native_path "$envf")" "$PYTHON_IMAGE" python - "$@" <"$DATA_DIR/s3tool.py" || rc=$?
  rm -f "$envf"
  return "$rc"
}
