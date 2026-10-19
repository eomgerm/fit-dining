#!/bin/sh
# 스테이징된 변경에서 시크릿을 찾는다(스펙 13.2). 켜기: git config core.hooksPath .githooks
# gitleaks 실행 파일이 있으면 그것을, 없으면 핀한 이미지를 쓴다. 둘 다 없으면 경고만 하고 통과한다(CI lint:secrets가 다시 본다).
set -u
# shellcheck source=infra/ci/tool-images.sh
. infra/ci/tool-images.sh
if command -v gitleaks >/dev/null 2>&1; then
  exec gitleaks git --pre-commit --staged --redact --no-banner --config .gitleaks.toml .
fi
if docker info >/dev/null 2>&1; then
  W="$(pwd -W 2>/dev/null || pwd)"
  MSYS_NO_PATHCONV=1 exec docker run --rm -v "$W:/work" -w /work \
    -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/work \
    "$GITLEAKS_IMAGE" git --pre-commit --staged --redact --no-banner --config .gitleaks.toml .
fi
echo "pre-commit: gitleaks와 docker가 없어 시크릿 검사를 건너뛴다(CI에서 다시 검사한다)" >&2
exit 0
