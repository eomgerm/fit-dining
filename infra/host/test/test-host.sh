#!/usr/bin/env bash
# 호스트 설정 스크립트를 노트북에서 시험한다(설계 10.5절). 서버가 없어도 Ubuntu 컨테이너와 이 PC의 Docker로 확인한다.
#   bash infra/host/test/test-host.sh            # Ubuntu 24.04에서 app과 ops
#   bash infra/host/test/test-host.sh all        # 24.04와 22.04에서 app과 ops
#   bash infra/host/test/test-host.sh prune      # docker-prune.sh와 networks.sh를 이 PC의 Docker로 시험
# 컨테이너는 --rm으로 지워진다. 필요한 것: docker, git. 컨테이너 시험은 Docker Engine 설치까지 하므로 조합당 몇 분 걸린다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
W="$(pwd -W 2>/dev/null || pwd)"

in_container() { # in_container 우분투버전 역할
  echo "=== Ubuntu $1, ROLE=$2"
  docker run --rm -e FIT_TEST_VERBOSE="${FIT_TEST_VERBOSE:-}" --cap-add NET_ADMIN --cap-add NET_RAW -v "$W/infra/host:/opt/fit-host:ro" "ubuntu:$1" bash /opt/fit-host/test/run-in-container.sh "$2"
}

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
ok_if() { if [ "$2" = "1" ]; then pass "$1"; else fail "$1"; fi; }
has() { case "$1" in *"$2"*) echo 1 ;; *) echo 0 ;; esac; }

PREFIX=fit-hosttest-
TEST_REPO=fit-hosttest
cleanup_prune() {
  docker rm -f fit-hosttest-keep >/dev/null 2>&1 || true
  for r in "$TEST_REPO/be" "$TEST_REPO/fe"; do
    docker image ls "$r" -q 2>/dev/null | sort -u | xargs -r docker image rm -f >/dev/null 2>&1 || true
  done
  for n in net-edge net-prod net-dev net-data net-obs net-dbaccess; do docker network rm "$PREFIX$n" >/dev/null 2>&1 || true; done
}

prune_and_networks() {
  trap cleanup_prune EXIT
  cleanup_prune
  echo "=== docker-prune.sh"
  # be는 서로 다른 이미지 7개(SHA 태그), fe는 3개를 만든다. 오래된 순서로 만들어야 "최근 5개"가 정해진다
  local i tag
  for i in 1 2 3 4 5 6 7; do
    tag="$(printf '%07x' $((0xabc000 + i)))"
    printf 'FROM ubuntu:24.04\nRUN echo be-%s > /n\n' "$i" | docker build -q -t "$TEST_REPO/be:$tag" - >/dev/null
    sleep 1
  done
  for i in 1 2 3; do
    tag="$(printf '%07x' $((0xdef000 + i)))"
    printf 'FROM ubuntu:24.04\nRUN echo fe-%s > /n\n' "$i" | docker build -q -t "$TEST_REPO/fe:$tag" - >/dev/null
    sleep 1
  done
  docker tag "$TEST_REPO/be:$(printf '%07x' $((0xabc000 + 7)))" "$TEST_REPO/be:latest"
  docker tag "$TEST_REPO/be:$(printf '%07x' $((0xabc000 + 1)))" "$TEST_REPO/be:rc1"
  # 가장 오래된 SHA 이미지(abc001)는 rc1 태그도 달려 있다. 가장 오래된 둘 중 하나(abc002)를 컨테이너가 쓴다
  docker run -d --name fit-hosttest-keep "$TEST_REPO/be:$(printf '%07x' $((0xabc000 + 2)))" sleep 600 >/dev/null
  local out
  out="$(FIT_ROLE=app FIT_PRUNE_REPOS="$TEST_REPO/be $TEST_REPO/fe" FIT_PRUNE_KEEP=5 bash infra/host/docker-prune.sh 2>&1)"
  echo "$out"
  local be_tags fe_tags
  be_tags="$(docker image ls "$TEST_REPO/be" --format '{{.Tag}}' | sort | tr '\n' ' ')"
  fe_tags="$(docker image ls "$TEST_REPO/fe" --format '{{.Tag}}' | sort | tr '\n' ' ')"
  ok_if "prune: be는 최근 SHA 5개를 남긴다(abc003~abc007)" "$([ "$(has "$be_tags" abc003)$(has "$be_tags" abc004)$(has "$be_tags" abc005)$(has "$be_tags" abc006)$(has "$be_tags" abc007)" = 11111 ] && echo 1 || echo 0)"
  ok_if "prune: 컨테이너가 쓰는 오래된 이미지(abc002)는 지우지 않고 알린다" "$([ "$(has "$be_tags" abc002)$(has "$out" '남김: '"$TEST_REPO"'/be:0abc002')" = 11 ] && echo 1 || echo 0)"
  ok_if "prune: 쓰지 않는 오래된 SHA 이미지(abc001)는 지운다. 같은 이미지의 rc1 태그는 SHA 모양이 아니라 남는다" "$([ "$(has "$be_tags" abc001)$(has "$be_tags" rc1)" = 01 ] && echo 1 || echo 0)"
  ok_if "prune: latest 같은 태그는 건드리지 않는다" "$(has "$be_tags" latest)"
  ok_if "prune: SHA 태그가 5개 이하인 fe는 그대로다" "$([ "$(has "$fe_tags" def001)$(has "$fe_tags" def002)$(has "$fe_tags" def003)" = 111 ] && echo 1 || echo 0)"
  local rc
  FIT_ROLE='' bash infra/host/docker-prune.sh >/dev/null 2>&1 && rc=0 || rc=$?
  ok_if "prune: 역할을 모르면 종료 코드 2로 멈춘다" "$([ "$rc" = 2 ] && echo 1 || echo 0)"

  echo "=== networks.sh"
  out="$(FIT_NET_PREFIX=$PREFIX bash infra/host/networks.sh)"
  ok_if "networks: 여섯 개를 만든다" "$([ "$(printf '%s\n' "$out" | grep -c '^만듦')" = 6 ] && echo 1 || echo 0)"
  out="$(FIT_NET_PREFIX=$PREFIX bash infra/host/networks.sh)"
  ok_if "networks: 다시 실행하면 새로 만들지 않고 OK만 낸다" "$([ "$(printf '%s\n' "$out" | grep -c '^OK')" = 6 ] && echo 1 || echo 0)"
  ok_if "networks: net-data만 internal이다" \
    "$([ "$(docker network inspect -f '{{.Internal}}' ${PREFIX}net-data)$(docker network inspect -f '{{.Internal}}' ${PREFIX}net-edge)" = truefalse ] && echo 1 || echo 0)"
  FIT_NET_PREFIX=$PREFIX bash infra/host/networks.sh check >/dev/null 2>&1 && rc=0 || rc=$?
  ok_if "networks: check는 모두 있으면 통과한다" "$([ "$rc" = 0 ] && echo 1 || echo 0)"
  docker network rm "${PREFIX}net-data" >/dev/null
  docker network create "${PREFIX}net-data" >/dev/null
  out="$(FIT_NET_PREFIX=$PREFIX bash infra/host/networks.sh check 2>&1)" && rc=0 || rc=$?
  ok_if "networks: internal이 아닌 net-data는 실패로 잡는다" "$([ "$rc" = 1 ] && [ "$(has "$out" 'FAIL  '"${PREFIX}"'net-data: internal=false')" = 1 ] && echo 1 || echo 0)"
  docker network rm "${PREFIX}net-obs" >/dev/null
  out="$(FIT_NET_PREFIX=$PREFIX bash infra/host/networks.sh check 2>&1)" && rc=0 || rc=$?
  ok_if "networks: check는 빠진 망을 만들지 않고 실패로 잡는다" "$([ "$rc" = 1 ] && [ "$(has "$out" '없다')" = 1 ] && ! docker network inspect "${PREFIX}net-obs" >/dev/null 2>&1 && echo 1 || echo 0)"
  if [ "$FAILED" -gt 0 ]; then
    printf '\n%d개 시험 실패\n' "$FAILED"
    return 1
  fi
  printf '\nprune·networks 시험 통과\n'
}

case "${1:-default}" in
  default)
    in_container 24.04 app
    in_container 24.04 ops
    ;;
  all)
    for v in 24.04 22.04; do
      in_container "$v" app
      in_container "$v" ops
    done
    ;;
  prune) prune_and_networks ;;
  *)
    echo "사용: bash infra/host/test/test-host.sh [all|prune]" >&2
    exit 2
    ;;
esac
