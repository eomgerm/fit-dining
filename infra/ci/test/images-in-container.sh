#!/usr/bin/env bash
# build-images.sh를 시험한다. test-images.sh가 docker CLI 컨테이너(호스트의 docker.sock 연결)에서 부른다.
# CI의 deploy 러너와 같은 모양이다: 리눅스 파일시스템에서 jar와 번들을 만들고(pnpm의 심볼릭 링크가 그대로다) 호스트 데몬에 이미지를 만든다.
# 시험이 만드는 이미지 이름은 fit-citest-be, fit-citest-fe, fit-citest-ai이고 끝나면 모두 지운다.
set -uo pipefail

REPO=/repo
export FIT_BE_IMAGE=fit-citest-be FIT_FE_IMAGE=fit-citest-fe FIT_AI_IMAGE=fit-citest-ai FIT_ENV_DIR=/tmp/w/etc
SHA1=0123456789abcdef0123456789abcdef01234567
SHA2=fedcba9876543210fedcba9876543210fedcba98
SHA3=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
W=/tmp/w
FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1"
  FAILED=$((FAILED + 1))
  if [ -n "${out:-}" ]; then printf '%s\n' "$out" | tail -n 10 | sed 's/^/FAIL  > /'; fi
}
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }
has() { case "$1" in *"$2"*) echo 1 ;; *) echo 0 ;; esac; }
is() { if [ "$1" = "$2" ]; then echo 1; else echo 0; fi; }
build() { bash "$REPO/infra/ci/build-images.sh" "$@" 2>&1; }
cleanup() {
  docker rm -f fit-citest-fe-run fit-citest-ai-run >/dev/null 2>&1 || true
  for t in "$SHA1" "$SHA2" "$SHA3"; do docker rmi -f "fit-citest-be:$t" "fit-citest-fe:$t" "fit-citest-ai:$t" >/dev/null 2>&1 || true; done
  rm -rf "$W"
}
trap cleanup EXIT

apk add --no-cache bash >/dev/null 2>&1 || { echo "FAIL bash를 설치하지 못했다"; exit 1; }
cleanup
mkdir -p "$W/jars" "$W/fe/standalone" "$W/fe/static/chunks" "$W/fe/public"

echo "--- 입력 검사(이미지를 만들지 않고 거부한다)"
out="$(FIT_BE_JAR_DIR=$W/jars FIT_FE_BUNDLE_DIR=$W/fe build "$SHA1")"; rc=$?
ok_if "jar가 없으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'jar가 없다')" = 1 ] && echo 1 || echo 0)"
echo fake >"$W/jars/be-0.0.1-plain.jar"
out="$(FIT_BE_JAR_DIR=$W/jars FIT_FE_BUNDLE_DIR=$W/fe build "$SHA1")"; rc=$?
ok_if "plain jar만 있으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'jar가 없다')" = 1 ] && echo 1 || echo 0)"
echo fake-jar-content >"$W/jars/be-0.0.1.jar"
echo other >"$W/jars/other.jar"
out="$(FIT_BE_JAR_DIR=$W/jars FIT_FE_BUNDLE_DIR=$W/fe build "$SHA1")"; rc=$?
ok_if "jar가 둘 이상이면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'jar가 둘 이상이다')" = 1 ] && echo 1 || echo 0)"
rm -f "$W/jars/other.jar"
out="$(FIT_BE_JAR_DIR=$W/jars FIT_FE_BUNDLE_DIR=$W/fe build "$SHA1")"; rc=$?
ok_if "FE 번들에 server.js가 없으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'standalone/server.js가 없다')" = 1 ] && echo 1 || echo 0)"
out="$(FIT_BE_JAR_DIR=$W/jars FIT_FE_BUNDLE_DIR=$W/fe build "../etc/passwd")"; rc=$?
ok_if "SHA 모양이 아닌 값은 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'SHA')" = 1 ] && echo 1 || echo 0)"
out="$(FIT_BE_JAR_DIR=$W/jars FIT_FE_BUNDLE_DIR=$W/fe build)"; rc=$?
ok_if "SHA를 주지 않으면 거부한다" "$([ "$rc" != 0 ] && echo 1 || echo 0)"
ok_if "거부한 동안 이미지는 하나도 만들어지지 않았다" "$(is "$(docker images -q fit-citest-be fit-citest-fe | wc -l)" 0)"

echo "--- 가짜 FE 번들(실제 pnpm standalone처럼 node_modules가 심볼릭 링크)"
cat >"$W/fe/standalone/server.js" <<'EOF'
const http = require('http');
http.createServer((req, res) => {
  res.statusCode = req.url === '/fe-healthz' ? 200 : 404;
  res.end('ok');
}).listen(Number(process.env.PORT) || 3000, process.env.HOSTNAME || '0.0.0.0');
EOF
mkdir -p "$W/fe/standalone/node_modules/.pnpm/next@1/node_modules/next" "$W/fe/standalone/.next"
echo "module.exports = 1" >"$W/fe/standalone/node_modules/.pnpm/next@1/node_modules/next/index.js"
ln -s .pnpm/next@1/node_modules/next "$W/fe/standalone/node_modules/next"
echo "chunk-a" >"$W/fe/static/chunks/a.js"
echo "sw" >"$W/fe/public/sw.js"

echo "--- 조립"
out="$(FIT_BE_JAR_DIR=$W/jars FIT_FE_BUNDLE_DIR=$W/fe build "$SHA1")"; rc=$?
printf '%s\n' "$out" | tail -n 3
ok_if "build-images.sh가 성공한다" "$(is "$rc" 0)"
ok_if "be:<sha>와 fe:<sha> 이미지가 생긴다" "$([ "$(docker images -q fit-citest-be:$SHA1 | wc -l)" = 1 ] && [ "$(docker images -q fit-citest-fe:$SHA1 | wc -l)" = 1 ] && echo 1 || echo 0)"
ID_BE="$(docker image inspect -f '{{.Id}}' fit-citest-be:$SHA1)"
ID_FE="$(docker image inspect -f '{{.Id}}' fit-citest-fe:$SHA1)"
out="$(FIT_BE_JAR_DIR=$W/jars FIT_FE_BUNDLE_DIR=$W/fe build "$SHA1")"; rc=$?
ok_if "같은 SHA를 다시 부르면 둘 다 재사용하고 이미지가 그대로다" "$([ "$rc" = 0 ] && [ "$(has "$out" "재사용: fit-citest-be:$SHA1")" = 1 ] && [ "$(has "$out" "재사용: fit-citest-fe:$SHA1")" = 1 ] && [ "$(docker image inspect -f '{{.Id}}' fit-citest-be:$SHA1)" = "$ID_BE" ] && [ "$(docker image inspect -f '{{.Id}}' fit-citest-fe:$SHA1)" = "$ID_FE" ] && echo 1 || echo 0)"

echo "--- BE 이미지"
ok_if "비root 사용자(uid 10001)로 돈다" "$(is "$(docker run --rm --entrypoint id fit-citest-be:$SHA1 -u)" 10001)"
ok_if "/app/app.jar가 입력 jar와 같다" "$(is "$(docker run --rm --entrypoint cat fit-citest-be:$SHA1 /app/app.jar)" "fake-jar-content")"
ok_if "APP_SHA와 APP_BUILT_AT(UTC)가 박혀 있다" "$(docker run --rm --entrypoint sh fit-citest-be:$SHA1 -c 'echo "$APP_SHA $APP_BUILT_AT"' | grep -Eq "^$SHA1 [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$" && echo 1 || echo 0)"
ok_if "ENTRYPOINT는 java -jar /app/app.jar다(인자가 그대로 전달된다. 마이그레이션 프로필)" "$(is "$(docker image inspect -f '{{json .Config.Entrypoint}}' fit-citest-be:$SHA1)" '["java","-jar","/app/app.jar"]')"
ok_if "베이스가 JRE 21(핀한 21.0.12)이다" "$(docker run --rm --entrypoint java fit-citest-be:$SHA1 -version 2>&1 | grep -q '21.0.12' && echo 1 || echo 0)"
ok_if "커밋을 라벨로 남긴다(org.opencontainers.image.revision)" "$(is "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' fit-citest-be:$SHA1)" "$SHA1")"

echo "--- FE 이미지"
ok_if "비root 사용자(node)로 돈다" "$(is "$(docker run --rm --entrypoint id fit-citest-fe:$SHA1 -un)" node)"
ok_if "정적 자산이 /app/.next/static에 있다(배포 스크립트가 풀에 쌓는 위치)" "$(is "$(docker run --rm --entrypoint cat fit-citest-fe:$SHA1 /app/.next/static/chunks/a.js)" chunk-a)"
ok_if "public이 /app/public에 있다" "$(is "$(docker run --rm --entrypoint cat fit-citest-fe:$SHA1 /app/public/sw.js)" sw)"
ok_if "node_modules의 심볼릭 링크가 보존된다(pnpm standalone)" "$(is "$(docker run --rm --entrypoint sh fit-citest-fe:$SHA1 -c 'test -L /app/node_modules/next && readlink /app/node_modules/next && node -e "console.log(require(\"/app/node_modules/next\"))"' | tr '\n' ' ')" ".pnpm/next@1/node_modules/next 1 ")"
docker run -d --name fit-citest-fe-run --read-only --tmpfs /app/.next/cache --tmpfs /tmp fit-citest-fe:$SHA1 >/dev/null
sleep 3
out="$(docker exec fit-citest-fe-run node -e "fetch('http://127.0.0.1:3000/fe-healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" 2>&1)"; rc=$?
ok_if "compose와 같은 조건(읽기 전용, tmpfs)에서 /fe-healthz가 200이다(compose의 healthcheck 명령 그대로)" "$(is "$rc" 0)"
docker rm -f fit-citest-fe-run >/dev/null

echo "--- public이 없는 번들"
rm -rf "$W/fe/public"
out="$(FIT_BE_JAR_DIR=$W/jars FIT_FE_BUNDLE_DIR=$W/fe build "$SHA2")"; rc=$?
ok_if "public이 없어도 조립된다(빈 /app/public)" "$([ "$rc" = 0 ] && [ "$(docker run --rm --entrypoint sh fit-citest-fe:$SHA2 -c 'test -d /app/public && ls -A /app/public | wc -l' | tr -d ' ')" = 0 ] && echo 1 || echo 0)"

echo "--- AI 이미지(ai-prod.env나 ai-dev.env가 있는 서버에서만 만든다)"
mkdir -p "$W/etc"
AIDIR="$W/ai"
cp -r "$REPO/infra/ci/test/ai-fixture" "$AIDIR"
echo "SECRET_MARKER=must-not-be-in-the-image" >"$AIDIR/.env"
out="$(FIT_BE_JAR_DIR=$W/jars FIT_FE_BUNDLE_DIR=$W/fe FIT_AI_DIR=$AIDIR build "$SHA1")"; rc=$?
ok_if "ai-*.env가 없으면 AI 이미지를 만들지 않는다(선택 기능)" \
  "$([ "$rc" = 0 ] && [ "$(docker images -q fit-citest-ai:$SHA1 | wc -l)" = 0 ] && [ "$(has "$out" 'AI 이미지: 건너뜀')" = 1 ] && echo 1 || echo 0)"
: >"$W/etc/ai-dev.env"
out="$(FIT_BE_JAR_DIR=$W/jars FIT_FE_BUNDLE_DIR=$W/fe FIT_AI_DIR=$AIDIR build "$SHA1")"; rc=$?
printf '%s\n' "$out" | tail -n 3
ok_if "ai-dev.env가 있으면 ai:<sha>를 조립하고 BE·FE는 재사용한다" \
  "$([ "$rc" = 0 ] && [ "$(docker images -q fit-citest-ai:$SHA1 | wc -l)" = 1 ] && [ "$(has "$out" "조립: fit-citest-ai:$SHA1")" = 1 ] && [ "$(has "$out" "재사용: fit-citest-be:$SHA1")" = 1 ] && echo 1 || echo 0)"
ID_AI="$(docker image inspect -f '{{.Id}}' fit-citest-ai:$SHA1)"
out="$(FIT_BE_JAR_DIR=$W/jars FIT_FE_BUNDLE_DIR=$W/fe FIT_AI_DIR=$AIDIR build "$SHA1")"; rc=$?
ok_if "같은 SHA를 다시 부르면 AI 이미지도 재사용하고 그대로다" \
  "$([ "$rc" = 0 ] && [ "$(has "$out" "재사용: fit-citest-ai:$SHA1")" = 1 ] && [ "$(docker image inspect -f '{{.Id}}' fit-citest-ai:$SHA1)" = "$ID_AI" ] && echo 1 || echo 0)"

echo "--- AI 이미지 내용"
ok_if "비root 사용자(uid 10001)로 돈다" "$(is "$(docker run --rm --entrypoint id fit-citest-ai:$SHA1 -u)" 10001)"
ok_if "커밋을 라벨로 남긴다(org.opencontainers.image.revision)" "$(is "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' fit-citest-ai:$SHA1)" "$SHA1")"
ok_if ".env와 그 안의 값이 이미지에 들어가지 않는다(컨텍스트에서 뺀다)" \
  "$([ "$(docker run --rm --entrypoint sh fit-citest-ai:$SHA1 -c 'ls -A /app | grep -c "^.env"')" = 0 ] && [ "$(docker run --rm --entrypoint sh fit-citest-ai:$SHA1 -c 'grep -rl SECRET_MARKER /app 2>/dev/null | wc -l')" = 0 ] && echo 1 || echo 0)"
ok_if "장소 파일(samples/place/mock.json)이 있다" "$(is "$(docker run --rm --entrypoint cat fit-citest-ai:$SHA1 /app/samples/place/mock.json | tr -d ' \n')" '{"places":[]}')"
ok_if "torch는 들어 있지 않다(로컬 인코더가 없다)" "$(docker run --rm --entrypoint python fit-citest-ai:$SHA1 -c 'import torch' >/dev/null 2>&1 && echo 0 || echo 1)"
docker run -d --name fit-citest-ai-run --read-only --tmpfs /tmp --memory 512m fit-citest-ai:$SHA1 >/dev/null
sleep 3
out="$(docker exec fit-citest-ai-run python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)" 2>&1)"; rc=$?
ok_if "compose와 같은 조건(읽기 전용, tmpfs, 512m)에서 /healthz가 200이다(compose의 healthcheck 명령 그대로)" "$(is "$rc" 0)"
docker rm -f fit-citest-ai-run >/dev/null

echo "--- AI 빌드가 실패해도 BE·FE는 나간다"
rm -rf "$W/ai-bad"
cp -r "$AIDIR" "$W/ai-bad"
rm -f "$W/ai-bad/uv.lock"
out="$(FIT_BE_JAR_DIR=$W/jars FIT_FE_BUNDLE_DIR=$W/fe FIT_AI_DIR=$W/ai-bad build "$SHA3")"; rc=$?
ok_if "AI 입력이 틀려도 build-images.sh는 성공하고 BE·FE 이미지는 만든다" \
  "$([ "$rc" = 0 ] && [ "$(docker images -q fit-citest-be:$SHA3 | wc -l)" = 1 ] && [ "$(docker images -q fit-citest-fe:$SHA3 | wc -l)" = 1 ] && echo 1 || echo 0)"
ok_if "AI 이미지는 없고 경고로 알린다" "$([ "$(docker images -q fit-citest-ai:$SHA3 | wc -l)" = 0 ] && [ "$(has "$out" '경고: AI 이미지를 만들지 못했다')" = 1 ] && echo 1 || echo 0)"

echo
if [ "$FAILED" = 0 ]; then echo "이미지 조립 시험 통과"; else echo "$FAILED개 실패"; exit 1; fi
