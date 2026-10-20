#!/usr/bin/env bash
# 서버 A의 공유 Docker 망을 만든다(설계 2.2절). 몇 번 실행해도 같은 결과다. compose 프로젝트들이 이 망을 `external`로 붙인다.
#   bash infra/host/networks.sh          # 없는 망을 만들고 있는 망은 확인한다
#   bash infra/host/networks.sh check    # 만들지 않고 확인만 한다(있는지, net-data가 internal인지)
# FIT_NET_PREFIX로 이름 앞에 접두사를 붙일 수 있다(시험용). 하나라도 어긋나면 종료 코드 1이다.
set -euo pipefail

PREFIX="${FIT_NET_PREFIX:-}"
# net-data는 바깥으로 나가지 못하는 internal 망이다. 나머지는 일반 bridge다
NETS="net-edge net-prod net-dev net-data net-obs net-dbaccess"
INTERNAL="net-data"
MODE="${1:-create}"

bad=0
for n in $NETS; do
  name="$PREFIX$n"
  want=false
  case " $INTERNAL " in *" $n "*) want=true ;; esac
  if docker network inspect "$name" >/dev/null 2>&1; then
    got="$(docker network inspect -f '{{.Internal}}' "$name")"
    if [ "$got" = "$want" ]; then
      echo "OK    $name"
    else
      echo "FAIL  $name: internal=$got, 기대값은 $want. 망을 지우고 다시 만들어야 한다"
      bad=1
    fi
  elif [ "$MODE" = "check" ]; then
    echo "FAIL  $name: 없다"
    bad=1
  else
    args=(network create --driver bridge --label com.fit.managed=true)
    if [ "$want" = true ]; then args+=(--internal); fi
    docker "${args[@]}" "$name" >/dev/null
    echo "만듦  $name"
  fi
done
exit "$bad"
