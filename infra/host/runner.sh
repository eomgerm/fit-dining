#!/usr/bin/env bash
# GitLab Runner를 호스트에 설치하고 등록한다(설계 6.1절). 몇 번 실행해도 같은 결과다(멱등). install과 register는 root로 실행한다.
#   sudo bash infra/host/runner.sh install     # 저장소 키(지문 확인), 패키지(버전 고정), gitlab-runner 계정의 docker 그룹, 서비스
#   sudo bash infra/host/runner.sh register    # 이 서버의 러너를 등록한다. 토큰은 숨김 입력으로만 받는다
#   sudo bash infra/host/runner.sh tune        # 동시 실행 수(concurrent)를 이 서버 역할에 맞춘다. 토큰이 필요 없고 서비스를 재시작하지 않는다
#   bash infra/host/runner.sh status           # 읽기만 한다(토큰은 찍지 않는다)
# 서버에 따라 만들 러너가 정해진다(/etc/fit/role): A(app)는 fit-deploy(shell), B(ops)는 fit-verify(docker + docker.sock).
# 러너는 GitLab에서 먼저 만든다(Settings -> CI/CD -> Runners -> Create project runner). 태그, Run untagged, Protected는 GitLab 쪽에서 정하고
# 여기서는 화면에 한 번만 보이는 인증 토큰(glrt-로 시작)을 입력한다. 토큰은 이 서버의 config.toml에만 남는다.
# 환경변수(선택): FIT_SKIP(쉼표로 구분, 시험용) systemd. FIT_RUNNER_URL(https://lab.ssafy.com). FIT_RUNNER_ROLE_FILE(/etc/fit/role)
#   FIT_RUNNER_CONFIG(/etc/gitlab-runner/config.toml). FIT_RUNNER_REREGISTER=1(이미 등록돼 있어도 다시 등록한다)
#   FIT_RUNNER_CONCURRENT(fit-verify의 동시 실행 수. 기본 2, 1에서 4까지)
set -euo pipefail

# GitLab 서버(CE 18.11.5)와 같은 마이너 버전으로 고정한다. 서버를 올리면 이 값도 같이 올린다
RUNNER_VERSION="18.11.4-1"
# 패키지 저장소 서명 키: GitLab B.V. (package repository signing key)
KEY_FPR="F6403F6544A38863DAA0B6E03F01618A51312F3F"
KEY_URL="https://packages.gitlab.com/runner/gitlab-runner/gpgkey"
REPO_URL="https://packages.gitlab.com/runner/gitlab-runner/ubuntu/"
KEYRING="/usr/share/keyrings/gitlab-runner.gpg"
LIST="/etc/apt/sources.list.d/gitlab-runner.list"
GITLAB_URL="${FIT_RUNNER_URL:-https://lab.ssafy.com}"
ROLE_FILE="${FIT_RUNNER_ROLE_FILE:-/etc/fit/role}"
CONFIG="${FIT_RUNNER_CONFIG:-/etc/gitlab-runner/config.toml}"
# 러너가 없는 job 이미지를 내려받을 때 쓰는 기본 이미지(job은 .gitlab-ci.yml에서 자기 이미지를 정한다. 핀은 infra/ci/tool-images.sh와 같다)
DEFAULT_IMAGE="python:3.12.15-slim"
SKIP=",${FIT_SKIP:-},"
CHANGES=0

step() { printf '\n== %s\n' "$*"; }
log() { printf '%s\n' "$*"; }
die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
skipped() { case "$SKIP" in *",$1,"*) log "건너뜀($1)"; return 0 ;; esac; return 1; }
changed() { CHANGES=$((CHANGES + 1)); log "변경: $*"; }
need_root() { [ "$(id -u)" = 0 ] || die "root로 실행한다(sudo)"; }

# 이 서버가 만들 러너: A(app)는 fit-deploy, B(ops)는 fit-verify
runner_name() {
  [ -f "$ROLE_FILE" ] || die "$ROLE_FILE이 없다. 먼저 infra/host/bootstrap.sh를 실행한다"
  case "$(tr -d '[:space:]' <"$ROLE_FILE")" in
    app) echo fit-deploy ;;
    ops) echo fit-verify ;;
    *) die "$ROLE_FILE의 값이 app 또는 ops가 아니다" ;;
  esac
}

# 동시에 돌릴 job 수(설계 6.1절). config.toml의 전역 값이다.
#  fit-verify(B): 2. 메모리를 많이 쓰는 job(Gradle, Node)은 .gitlab-ci.yml의 resource_group(verify-heavy)이 한 번에 하나로 묶으므로
#                 나머지 하나는 가벼운 lint가 쓴다. MR이 몰려도 lint가 무거운 job 뒤에 줄을 서지 않는다. B는 메모리 4GB라 4를 넘기지 않는다
#  fit-deploy(A): 1. 같은 환경의 배포가 겹치면 안 된다
want_concurrent() {
  case "$(runner_name)" in
    fit-verify)
      local n="${FIT_RUNNER_CONCURRENT:-2}"
      case "$n" in 1 | 2 | 3 | 4) echo "$n" ;; *) die "FIT_RUNNER_CONCURRENT는 1에서 4 사이의 정수다" ;; esac
      ;;
    *) echo 1 ;;
  esac
}

# concurrent를 역할에 맞춘다. 이미 맞으면 아무것도 하지 않는다
set_concurrent() {
  local want
  want="$(want_concurrent)"
  if grep -qE "^concurrent[[:space:]]*=[[:space:]]*${want}[[:space:]]*\$" "$CONFIG"; then return 0; fi
  if grep -qE '^concurrent[[:space:]]*=' "$CONFIG"; then sed -i "s/^concurrent[[:space:]]*=.*/concurrent = $want/" "$CONFIG"; else sed -i "1i concurrent = $want" "$CONFIG"; fi
  chmod 600 "$CONFIG"
  changed "동시 실행 수 $want(config.toml의 concurrent)"
}

installed_version() { dpkg-query -W -f='${Version}' gitlab-runner 2>/dev/null || true; }

do_install() {
  need_root
  runner_name >/dev/null
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = ubuntu ] || die "Ubuntu가 아니다"
  local codename="${VERSION_CODENAME:-}"
  [ -n "$codename" ] || die "Ubuntu 코드명을 알 수 없다"
  getent group docker >/dev/null || die "docker 그룹이 없다. 먼저 infra/host/bootstrap.sh를 실행한다"

  step "필요한 패키지"
  local pkgs=()
  command -v curl >/dev/null 2>&1 || pkgs+=(curl)
  command -v gpg >/dev/null 2>&1 || pkgs+=(gnupg)
  [ -d /etc/ssl/certs ] && [ -f /etc/ssl/certs/ca-certificates.crt ] || pkgs+=(ca-certificates)
  if [ "${#pkgs[@]}" -gt 0 ]; then
    apt-get -o Acquire::Retries=3 update -qq
    DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y -qq "${pkgs[@]}" >/dev/null
    changed "패키지 ${pkgs[*]}"
  else
    log "이미 있다"
  fi

  step "저장소 서명 키(지문 확인)"
  local tmp want have
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  want=1
  if [ -f "$KEYRING" ] && gpg --no-default-keyring --keyring "$KEYRING" --list-keys --with-colons 2>/dev/null | awk -F: '/^fpr/{print $10}' | grep -qx "$KEY_FPR"; then
    want=0
    log "이미 있고 지문이 맞다"
  fi
  if [ "$want" = 1 ]; then
    curl -fsSL --retry 3 "$KEY_URL" -o "$tmp/key.asc"
    have="$(gpg --show-keys --with-colons "$tmp/key.asc" 2>/dev/null | awk -F: '/^fpr/{print $10}')"
    printf '%s\n' "$have" | grep -qx "$KEY_FPR" || die "받은 키의 지문이 기대와 다르다(기대 $KEY_FPR). 저장소를 믿지 않는다"
    gpg --dearmor <"$tmp/key.asc" >"$tmp/key.gpg"
    install -D -m 644 -o root -g root "$tmp/key.gpg" "$KEYRING"
    changed "$KEYRING"
  fi

  step "저장소 목록"
  local line="deb [signed-by=$KEYRING] $REPO_URL $codename main"
  if [ ! -f "$LIST" ] || [ "$(cat "$LIST")" != "$line" ]; then
    printf '%s\n' "$line" >"$LIST"
    chmod 644 "$LIST"
    changed "$LIST"
  else
    log "이미 있다"
  fi

  step "gitlab-runner $RUNNER_VERSION"
  if [ "$(installed_version)" = "$RUNNER_VERSION" ]; then
    log "이미 설치돼 있다"
  else
    apt-get -o Acquire::Retries=3 update -qq
    # 서비스가 등록 전에 멋대로 올라오지 않게 한다(러너가 하나도 없으면 아무 일도 하지 않지만 설정 파일이 비어 있다)
    # gitlab-runner는 같은 버전의 helper-images 패키지를 요구한다. 둘을 같이 지정하지 않으면 apt가 더 새 helper-images를 고르려다 실패한다
    DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y -qq --allow-downgrades "gitlab-runner=$RUNNER_VERSION" "gitlab-runner-helper-images=$RUNNER_VERSION" >/dev/null
    changed "패키지 gitlab-runner, gitlab-runner-helper-images $RUNNER_VERSION"
  fi
  # 자동 업데이트가 서버(GitLab)와 다른 마이너 버전으로 올리지 않게 둘 다 고정한다
  local held
  held="$(apt-mark showhold)"
  if ! { grep -qx gitlab-runner <<<"$held" && grep -qx gitlab-runner-helper-images <<<"$held"; }; then
    apt-mark hold gitlab-runner gitlab-runner-helper-images >/dev/null
    changed "gitlab-runner와 helper-images 버전 고정(apt hold)"
  fi

  step "gitlab-runner 계정의 docker 그룹"
  id gitlab-runner >/dev/null 2>&1 || die "gitlab-runner 계정이 없다(패키지가 만든다)"
  if id -nG gitlab-runner | tr ' ' '\n' | grep -qx docker; then
    log "이미 속해 있다"
  else
    usermod -aG docker gitlab-runner
    changed "gitlab-runner를 docker 그룹에 넣었다(root와 같은 권한이다. 설계 6.1절)"
  fi

  step "서비스"
  if skipped systemd; then :; else
    if systemctl is-enabled gitlab-runner >/dev/null 2>&1; then log "이미 켜져 있다"; else systemctl enable gitlab-runner >/dev/null 2>&1 && changed "서비스 enable"; fi
    systemctl is-active gitlab-runner >/dev/null 2>&1 || { systemctl start gitlab-runner && changed "서비스 시작"; }
  fi

  step "남은 수동 단계"
  log "1. GitLab에서 러너 $(runner_name)를 만든다(Settings -> CI/CD -> Runners -> Create project runner)"
  log "2. 이 서버에서: sudo bash infra/host/runner.sh register   (토큰은 숨김 입력)"
  log "3. 점검: bash infra/host/runner.sh status"
  log "변경 $CHANGES건"
}

# config.toml에서 이미 등록된 러너 이름(토큰은 읽지 않는다)
registered_names() { [ -f "$CONFIG" ] && sed -n 's/^[[:space:]]*name[[:space:]]*=[[:space:]]*"\(.*\)"/\1/p' "$CONFIG" || true; }

do_register() {
  need_root
  local name
  name="$(runner_name)"
  [ "$(installed_version)" = "$RUNNER_VERSION" ] || die "gitlab-runner $RUNNER_VERSION이 설치돼 있지 않다. 먼저 install을 실행한다"
  if registered_names | grep -qx "$name" && [ "${FIT_RUNNER_REREGISTER:-0}" != 1 ]; then
    log "$name은 이미 등록돼 있다(다시 등록하려면 FIT_RUNNER_REREGISTER=1과 함께 실행하고, GitLab에서 옛 러너를 지운다)"
    return 0
  fi

  umask 077
  local token=""
  read -r -s -p "GitLab에서 만든 러너($name)의 인증 토큰(glrt-로 시작, 입력은 보이지 않는다): " token || true
  echo >&2
  case "$token" in glrt-*) ;; *) die "토큰이 glrt-로 시작하지 않는다(러너를 만들 때 한 번만 보이는 값이다)" ;; esac
  printf '%s' "$token" | grep -Eq '^glrt-[A-Za-z0-9_.-]+$' || die "토큰에 쓸 수 없는 글자가 있다"

  # 토큰은 명령 인자가 아니라 환경변수로만 넘긴다(프로세스 목록에 남지 않는다)
  local args=(register --non-interactive --url "$GITLAB_URL" --name "$name")
  case "$name" in
    fit-verify)
      # B: docker executor. docker.sock을 job에 열어 이미지를 빌드·검사한다. job은 메모리 2GB, CPU 2개(설계 6.1절)
      args+=(--executor docker --docker-image "$DEFAULT_IMAGE" --docker-pull-policy if-not-present
        --docker-volumes /var/run/docker.sock:/var/run/docker.sock --docker-memory 2g --docker-cpus 2)
      ;;
    fit-deploy)
      # A: shell executor. gitlab-runner 계정이 docker 그룹이라 compose를 쓴다. 보호된 브랜치의 job만 받는다(GitLab 쪽 설정)
      args+=(--executor shell)
      ;;
  esac
  # 등록 로그에 토큰 일부가 찍힐 수 있어 출력은 버린다
  CI_SERVER_TOKEN="$token" gitlab-runner "${args[@]}" >/dev/null 2>&1 || die "등록에 실패했다. 토큰이 맞는지, 러너를 만든 프로젝트가 맞는지 확인한다(토큰은 출력하지 않는다)"
  token=""

  # 동시 실행 수는 역할에 맞춘다(설계 6.1절). 설정은 한 파일이라 전역 값을 바꾼다
  set_concurrent
  chmod 600 "$CONFIG"
  changed "러너 $name 등록(config.toml 권한 600)"
  skipped systemd || systemctl restart gitlab-runner
  log "점검: bash infra/host/runner.sh status"
}

# 이미 등록된 러너의 동시 실행 수만 역할에 맞춘다. 토큰이 필요 없다. 러너는 config.toml을 몇 초마다 다시 읽어 concurrent를 바로 반영하므로
# 서비스를 재시작하지 않는다(돌고 있는 job이 끊기지 않는다)
do_tune() {
  need_root
  local name
  name="$(runner_name)"
  if [ ! -f "$CONFIG" ] || ! registered_names | grep -qx "$name"; then die "러너 $name이 등록돼 있지 않다. 먼저 register를 실행한다"; fi
  step "동시 실행 수"
  set_concurrent
  if [ "$CHANGES" = 0 ]; then log "이미 $(want_concurrent)이다"; else log "러너가 config.toml을 몇 초 안에 다시 읽는다(서비스는 재시작하지 않았다)"; fi
  log "변경 $CHANGES건"
}

do_status() {
  local name ok=1 v held
  name="$(runner_name)"
  v="$(installed_version)"
  if [ "$v" = "$RUNNER_VERSION" ]; then log "PASS  gitlab-runner $v 설치됨"; else log "FAIL  gitlab-runner가 $RUNNER_VERSION이 아니다(지금: ${v:-없음})"; ok=0; fi
  held="$(apt-mark showhold 2>/dev/null)"
  if grep -qx gitlab-runner <<<"$held" && grep -qx gitlab-runner-helper-images <<<"$held"; then log "PASS  버전이 고정돼 있다(apt hold)"; else log "FAIL  버전이 고정돼 있지 않다"; ok=0; fi
  if id -nG gitlab-runner 2>/dev/null | tr ' ' '\n' | grep -qx docker; then log "PASS  gitlab-runner 계정이 docker 그룹이다"; else log "FAIL  gitlab-runner 계정이 docker 그룹이 아니다"; ok=0; fi
  if systemctl is-active gitlab-runner >/dev/null 2>&1; then log "PASS  서비스가 켜져 있다"; else log "SKIP  서비스가 켜져 있지 않다(시험 환경이면 정상)"; fi
  if registered_names | grep -qx "$name"; then
    log "PASS  러너 $name이 등록돼 있다"
    if [ "$(stat -c %a "$CONFIG")" = 600 ]; then log "PASS  config.toml 권한이 600이다"; else log "FAIL  config.toml 권한이 600이 아니다"; ok=0; fi
    local want
    want="$(want_concurrent)"
    if [ "$(grep -cE "^concurrent[[:space:]]*=[[:space:]]*${want}[[:space:]]*\$" "$CONFIG")" = 1 ]; then log "PASS  concurrent가 ${want}이다"; else log "FAIL  concurrent가 ${want}이 아니다(sudo bash infra/host/runner.sh tune)"; ok=0; fi
  else
    log "SKIP  러너 $name이 아직 등록돼 있지 않다(GitLab에서 만든 뒤 register를 실행한다)"
  fi
  if [ "$ok" = 1 ]; then log "러너 설정이 설계대로다"; else log "러너 설정이 설계와 다르다"; return 1; fi
}

case "${1:-}" in
  install) do_install ;;
  register) do_register ;;
  tune) do_tune ;;
  status) do_status ;;
  *) die "사용: runner.sh install | register | tune | status" ;;
esac
