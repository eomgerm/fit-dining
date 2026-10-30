#!/usr/bin/env bash
# Docker 이미지와 빌더 캐시를 정리한다(설계 3절). systemd 타이머(fit-docker-prune.timer)가 주 1회 부른다.
#   app(서버 A): be·fe·ai 이미지는 SHA 태그 중 최근 5개만 남긴다. 롤백이 직전 색의 이미지를 쓰므로 그 밖의 이미지는 지우지 않는다.
#   ops(서버 B): 7일 넘게 쓰지 않은 이미지를 모두 지운다. 러너가 필요하면 다시 받는다.
# 볼륨은 지우지 않는다(데이터가 있다).
# 환경변수: FIT_ROLE(기본은 /etc/fit/role), FIT_PRUNE_KEEP(기본 5), FIT_PRUNE_REPOS(app의 대상 이미지 이름, 기본 "be fe ai")
set -euo pipefail

ROLE="${FIT_ROLE:-$(cat /etc/fit/role 2>/dev/null || true)}"
KEEP="${FIT_PRUNE_KEEP:-5}"
REPOS="${FIT_PRUNE_REPOS:-be fe ai}"

case "$ROLE" in
  app)
    for repo in $REPOS; do
      # docker image ls는 만든 시각이 최근인 순서로 보여 준다. SHA 모양의 태그만 센다(latest 같은 태그는 건드리지 않는다)
      { docker image ls "$repo" --format '{{.Tag}}' | grep -E '^[0-9a-f]{7,40}$' || true; } |
        tail -n +"$((KEEP + 1))" |
        while read -r tag; do
          # 컨테이너가 쓰는 이미지는 docker가 지우기를 거부한다. 그대로 두고 넘어간다
          docker image rm "$repo:$tag" >/dev/null 2>&1 || echo "남김: $repo:$tag (사용 중)"
        done
    done
    docker image prune -f >/dev/null
    docker builder prune -f --filter "until=168h" >/dev/null
    ;;
  ops)
    docker image prune -af --filter "until=168h" >/dev/null
    docker builder prune -af --filter "until=168h" >/dev/null
    ;;
  *)
    echo "역할을 알 수 없다(/etc/fit/role 또는 FIT_ROLE: app|ops)" >&2
    exit 2
    ;;
esac
echo "prune 완료($ROLE)"
