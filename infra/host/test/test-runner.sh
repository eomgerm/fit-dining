#!/usr/bin/env bash
# runner.sh를 노트북에서 시험한다(Ubuntu 컨테이너, 실제 GitLab Runner 저장소에서 설치).
#   bash infra/host/test/test-runner.sh        # Ubuntu 24.04
#   bash infra/host/test/test-runner.sh all    # 24.04와 22.04
# 필요한 것: Docker, 인터넷(packages.gitlab.com). 진짜 토큰 등록은 서버에서 처음 등록할 때 확인한다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
W="$(pwd -W 2>/dev/null || pwd)"

versions=(24.04)
if [ "${1:-}" = all ]; then versions=(24.04 22.04); fi
status=0
for v in "${versions[@]}"; do
  echo "##### Ubuntu $v"
  docker run --rm -v "$W/infra/host:/opt/fit-host:ro" "ubuntu:$v" bash /opt/fit-host/test/runner-in-container.sh || status=1
done
exit "$status"
