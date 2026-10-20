#!/bin/sh
# 시험용 정적 자산 풀과 상태 파일을 만든다(infra/edge/test). 몇 번 실행해도 같은 결과다.
# 풀은 설계 5.3절의 배치 모양이다: /srv/fit/web/<환경>/pool/_next/static/... (URL 경로를 그대로 따른다).
set -eu
WEB=/srv/fit/web
STATE=/srv/fit/state

for env in prod dev; do
  pool="$WEB/$env/pool/_next/static/chunks"
  rm -rf "${WEB:?}/$env"
  mkdir -p "$pool"
  # 현재 릴리스의 자산(FE 화면이 가리킨다)과 이전 릴리스에만 있던 자산. 둘 다 풀에서 나가야 한다
  echo "pool-app $env" >"$pool/app-1a2b3c4d.js"
  echo "pool-old $env" >"$pool/old-9f8e7d6c.js"
done

mkdir -p "$STATE"
# 상태 파일은 형식 견본(infra/edge/state-sample)을 그대로 쓴다
cp /state-sample/upstream-*.caddy "$STATE/"
echo "seed done"
