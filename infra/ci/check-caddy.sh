#!/bin/sh
# 엣지 Caddy 설정의 형식(caddy fmt)과 문법(caddy validate)을 검사한다(설계 5절).
# caddy 이미지 안에서 저장소 루트를 작업 디렉터리로 돈다(CI의 lint:caddy, 로컬 러너).
# validate에는 환경변수와 상태 파일(upstream-*.caddy)이 필요해서 예제 env와 형식 견본을 쓴다.
# 인증서 단계(staging, production)와 HSTS(off, on)의 네 조합을 모두 확인한다.
set -eu

CONF=infra/edge/conf
bad=0

for f in "$CONF/Caddyfile" "$CONF"/acme/*.caddy "$CONF"/hsts/*.caddy infra/edge/state-sample/*.caddy; do
  if ! caddy fmt --diff "$f" >/dev/null 2>&1; then
    echo "FAIL caddy fmt 필요: $f (caddy fmt --overwrite $f)"
    bad=1
  fi
done

mkdir -p /srv/fit/state
cp infra/edge/state-sample/*.caddy /srv/fit/state/
set -a
# shellcheck source=/dev/null
. infra/edge/edge.env.example
set +a
# 예제의 자리표시자(REPLACE_ME)는 Caddy가 받아들이지 않는다(B_IP는 IP여야 하고 해시는 bcrypt의 base64여야 한다). 문서용 IP와 즉석에서 만든 해시로 바꿔 검사한다
B_IP=203.0.113.9
OPS_BASIC_AUTH_HASH="$(caddy hash-password --plaintext check-only | base64 | tr -d '\n')"
export B_IP OPS_BASIC_AUTH_HASH
for mode in staging production; do
  for hsts in off on; do
    if ! ACME_MODE="$mode" HSTS_MODE="$hsts" caddy validate --config "$CONF/Caddyfile" --adapter caddyfile >/dev/null 2>&1; then
      echo "FAIL caddy validate: ACME_MODE=$mode HSTS_MODE=$hsts"
      bad=1
    fi
  done
done

if [ "$bad" = 0 ]; then
  echo "OK caddy (fmt, validate)"
fi
exit "$bad"
