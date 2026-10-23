#!/usr/bin/env bash
# build-images.sh와 Dockerfile.be, Dockerfile.fe를 노트북에서 시험한다.
#   bash infra/ci/test/test-images.sh
# docker CLI 컨테이너에 호스트의 docker.sock을 연결해 리눅스 파일시스템에서 가짜 jar와 FE 번들(심볼릭 링크 포함)을 만들고 이미지를 조립한다.
# CI의 deploy 러너와 같은 모양이라 Windows의 NTFS 심볼릭 링크 한계를 피한다. 필요한 것: Docker, 인터넷(베이스 이미지, apk bash).
# 이 시험이 만드는 이미지는 fit-citest-be, fit-citest-fe이고 끝나면 지운다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
W="$(pwd -W 2>/dev/null || pwd)"
# shellcheck source=infra/ci/tool-images.sh
. infra/ci/tool-images.sh

exec docker run --rm \
  -v //var/run/docker.sock:/var/run/docker.sock \
  -v "$W:/repo:ro" \
  "$DOCKER_CLI_IMAGE" sh -c 'apk add --no-cache bash >/dev/null 2>&1 && bash /repo/infra/ci/test/images-in-container.sh'
