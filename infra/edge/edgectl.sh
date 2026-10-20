#!/usr/bin/env bash
# 서버 A에서 엣지(Caddy)를 다루는 명령 모음. 상태 확인, 설정 검사, 무중단 reload를 한 곳에 모은다.
# 배포 스크립트도 같은 reload를 쓴다(활성 색을 바꾼 뒤 한 줄로 적용).
#   bash infra/edge/edgectl.sh status   # 컨테이너 상태와 활성 색(Caddy가 보는 upstream 상태 파일)
#   bash infra/edge/edgectl.sh check    # 실행 중인 caddy 안에서 설정 문법을 검사한다
#   bash infra/edge/edgectl.sh reload   # check를 통과했을 때만 reload한다. 이어서 verify-edge.sh로 확인한다
# compose는 FIT_EDGE_ENV(기본 /etc/fit/edge.env)를 읽는다. 시험 환경은 FIT_EDGE_COMPOSE_ARGS로 compose 인자를 통째로 바꾼다.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${FIT_EDGE_COMPOSE_ARGS:-}" ]; then
  read -r -a DC <<<"docker compose $FIT_EDGE_COMPOSE_ARGS"
else
  DC=(docker compose --env-file "${FIT_EDGE_ENV:-/etc/fit/edge.env}" -f "$DIR/compose.edge.yml")
fi
CADDYFILE=/etc/caddy/Caddyfile

caddy_exec() { "${DC[@]}" exec -T caddy "$@"; }

check() {
  if caddy_exec caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
    echo "OK 설정 문법"
  else
    echo "FAIL 설정 문법이 틀렸다. 자세한 내용: bash infra/edge/edgectl.sh check-verbose" >&2
    return 1
  fi
}

status() {
  "${DC[@]}" ps caddy
  echo
  echo "활성 색(Caddy가 보는 상태 파일)"
  # 파일 안의 reverse_proxy 대상만 뽑는다. 형식: <환경> <서비스> <호스트:포트>
  caddy_exec sh -c 'grep -H "^reverse_proxy " /srv/fit/state/upstream-*.caddy' |
    sed -E 's#^.*/upstream-([a-z]+)-([a-z]+)\.caddy:reverse_proxy ([^ ]+).*#\1 \2 \3#' |
    while read -r env svc target; do printf '  %-5s %-3s %s\n' "$env" "$svc" "$target"; done
}

reload() {
  check
  caddy_exec caddy reload --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1
  echo "OK reload 완료. 없는 호스트를 가리키는 upstream은 reload를 통과하므로 verify-edge.sh로 확인한다"
}

case "${1:-}" in
  status) status ;;
  check) check ;;
  check-verbose) caddy_exec caddy validate --config "$CADDYFILE" --adapter caddyfile ;;
  reload) reload ;;
  *) echo "사용: bash infra/edge/edgectl.sh status | check | check-verbose | reload" >&2; exit 2 ;;
esac
