#!/usr/bin/env bash
# 서버 없이 이 PC에서 CI의 lint 단계를 그대로 돌리는 러너.
#   bash infra/ci/run-local-checks.sh              # 모든 검사
#   bash infra/ci/run-local-checks.sh --self-test  # 검사가 나쁜 입력을 거부하는지(죽은 검사 방지) 확인
#   SKIP_ARCH=1 bash infra/ci/run-local-checks.sh  # 오프라인일 때 이미지 아키텍처 조회를 건너뜀
# 필요한 것: git, python 3.9 이상, docker, tar. 린터는 핀한 컨테이너로 돈다(tool-images.sh). macOS의 bash 3.2에서도 돈다.
set -u -o pipefail
# Windows의 Python은 콘솔 코드 페이지(cp949)로 출력해 UTF-8 터미널(Git Bash)에서 한글이 깨지므로 UTF-8로 고정한다.
export PYTHONUTF8=1

ROOT="$(git rev-parse --show-toplevel)" || exit 2
cd "$ROOT" || exit 2
# shellcheck source=infra/ci/tool-images.sh
. infra/ci/tool-images.sh

PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3 python; do
    # Windows의 python3 스토어 바로가기는 실행하면 설치 안내만 출력하므로 실제로 실행해 확인한다
    if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
      PY="$c"
      break
    fi
  done
fi
if [ -z "$PY" ]; then
  echo "python 3.9 이상이 필요하다 (PYTHON=경로 로 지정할 수 있다)" >&2
  exit 2
fi

# Git Bash(Windows)는 docker -v에 Windows 경로를 줘야 하고 인자 경로 자동 변환을 꺼야 한다.
case "$(uname -s)" in
  MINGW* | MSYS*)
    WORKDIR="$(pwd -W)"
    export MSYS_NO_PATHCONV=1
    ;;
  *) WORKDIR="$(pwd)" ;;
esac

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }

# drun IMAGE CMD ARGS... : 이미지의 entrypoint를 비우고 CMD를 실행한다. 작업 디렉터리는 /work.
drun() {
  local image="$1"
  shift
  docker run --rm --entrypoint "" -v "$WORKDIR:/work" -w /work "$image" "$@"
}

# 추적 중인 파일과 아직 git add 하지 않은 새 파일(.gitignore 제외)을 모두 대상으로 한다. 인덱스를 건드리지 않는다.
list_files() { git ls-files --cached --others --exclude-standard -- "$@"; }

run_step() { # run_step NAME CMD ARGS... : 실패하면 출력을 보여 준다
  local name="$1" out
  shift
  if out="$("$@" 2>&1)"; then
    pass "$name"
  else
    printf '%s\n' "$out"
    fail "$name"
  fi
}

check_tool() { # check_tool NAME IMAGE GLOB... -- CMD ARGS...(추적 중인 파일 목록이 뒤에 붙는다)
  local name="$1" image="$2"
  shift 2
  local globs=() cmd=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    globs+=("$1")
    shift
  done
  shift
  cmd=("$@")
  local files=() f
  while IFS= read -r f; do files+=("$f"); done < <(list_files "${globs[@]}")
  if [ "${#files[@]}" -eq 0 ]; then
    skip "$name (대상 파일 없음)"
    return
  fi
  run_step "$name" drun "$image" "${cmd[@]}" "${files[@]}"
}

# 커밋할 수 있는 파일(추적 중인 것과 새 파일, .gitignore 제외)만 복사해 gitleaks로 본다.
# `gitleaks dir .`는 .gitignore된 로컬 env 파일과 빌드 산출물까지 읽어 로컬에서만 실패한다.
scan_secrets() {
  local d=".tmp-gitleaks" rc
  rm -rf "${ROOT:?}/$d"
  mkdir -p "$d"
  git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf - | tar -xf - -C "$d"
  drun "$GITLEAKS_IMAGE" gitleaks dir --config .gitleaks.toml --redact --no-banner "$d"
  rc=$?
  rm -rf "${ROOT:?}/$d"
  return "$rc"
}

check_all() {
  run_step "guards unit tests" "$PY" -m unittest discover -s infra/ci/tests
  run_step "eol (CRLF 금지)" "$PY" infra/ci/check_eol.py
  local envs=() f
  while IFS= read -r f; do envs+=("$f"); done < <(list_files 'infra/*.env.example')
  if [ "${#envs[@]}" -eq 0 ]; then
    skip "env 형식 (대상 파일 없음)"
  else
    run_step "env 형식" "$PY" infra/ci/check_env_files.py "${envs[@]}"
  fi
  run_step "ports (compose 프로젝트)" "$PY" infra/ci/check_compose_projects.py
  if [ "${SKIP_ARCH:-0}" = "1" ]; then
    skip "arch (SKIP_ARCH=1)"
  else
    run_step "arch (도구 이미지)" "$PY" infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --images-from-sh infra/ci/tool-images.sh
  fi
  # 인프라 소유 파일만 엄격하게 본다. be·fe·ai는 각 팀 린트가 맡는다(스펙 6.3, 12.2). be의 Dockerfile은 오류만 막는다.
  check_tool shellcheck "$SHELLCHECK_IMAGE" 'infra/*.sh' -- shellcheck -x
  check_tool hadolint "$HADOLINT_IMAGE" 'infra/*Dockerfile*' -- hadolint
  check_tool "hadolint(be)" "$HADOLINT_IMAGE" 'be/*Dockerfile*' -- hadolint --failure-threshold error
  check_tool yamllint "$YAMLLINT_IMAGE" 'infra/*.yml' 'infra/*.yaml' '.gitlab-ci.yml' '.yamllint.yaml' -- yamllint -c .yamllint.yaml
  run_step "gitleaks" scan_secrets
}

expect_fail() { # expect_fail NAME CMD ARGS... : 나쁜 입력을 거부해야 통과
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    fail "self-test $name: 나쁜 입력을 통과시켰다(죽은 검사)"
  else
    pass "self-test $name: 나쁜 입력을 거부"
  fi
}

self_test() {
  local d=".tmp-selftest"
  rm -rf "${ROOT:?}/$d"
  mkdir -p "$d"
  trap 'rm -rf "${ROOT:?}/.tmp-selftest"' EXIT
  cat >"$d/bad.sh" <<'EOF'
#!/bin/bash
rm -rf $UNQUOTED/*
EOF
  printf 'FROM ubuntu:latest\nRUN apt-get install curl\n' >"$d/Dockerfile"
  printf 'a: [1, 2\n' >"$d/bad.yml"
  # 가짜 토큰은 리터럴을 쪼개 만든다(이 파일 자체가 gitleaks에 걸리지 않게)
  printf 'GITLAB_TOKEN=%s%s\n' 'glpat-' 'Zr8Q2mXk5LnV9tYb3HcD' >"$d/leak.txt"
  printf 'A="x"\n' >"$d/bad.env"
  printf 'services:\n  a:\n    image: x\n    ports: ["8080:80"]\n' >"$d/bad-compose.yml"
  printf 'a: 1\r\n' >"$d/crlf.yml"
  expect_fail shellcheck drun "$SHELLCHECK_IMAGE" shellcheck "$d/bad.sh"
  expect_fail hadolint drun "$HADOLINT_IMAGE" hadolint "$d/Dockerfile"
  expect_fail yamllint drun "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml "$d/bad.yml"
  expect_fail gitleaks drun "$GITLEAKS_IMAGE" gitleaks dir --config .gitleaks.toml --redact --no-banner "$d"
  expect_fail env-format "$PY" infra/ci/check_env_files.py "$d/bad.env"
  expect_fail ports "$PY" infra/ci/ports_invariant.py "$d/bad-compose.yml"
  expect_fail eol "$PY" infra/ci/check_eol.py "$d/crlf.yml"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
else
  check_all
fi

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d개 검사 실패\n' "$FAILED"
  exit 1
fi
printf '\n모든 검사 통과\n'
