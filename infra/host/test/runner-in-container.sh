#!/usr/bin/env bash
# Ubuntu 컨테이너 안에서 runner.sh를 시험한다. test-runner.sh가 컨테이너를 띄워 부른다.
# 컨테이너에는 systemd가 없어 FIT_SKIP=systemd로 서비스 단계만 건너뛴다. 저장소 키 지문 확인, 패키지 설치(실제 저장소), 버전 고정,
# docker 그룹, 멱등, 등록 입력 검사는 실제로 한다. 진짜 토큰으로 GitLab에 등록하는 것은 서버에서 처음 등록할 때만 확인된다.
set -uo pipefail

H=/opt/fit-host
export FIT_SKIP=systemd FIT_RUNNER_ROLE_FILE=/etc/fit/role
FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1"
  FAILED=$((FAILED + 1))
  if [ -n "${out:-}" ]; then printf '%s\n' "$out" | tail -n 10 | sed 's/^/FAIL  > /'; fi
}
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }
has() { case "$1" in *"$2"*) echo 1 ;; *) echo 0 ;; esac; }
run() { bash "$H/runner.sh" "$@" 2>&1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1

echo "--- 사전 조건 확인"
out="$(run install)"; rc=$?
ok_if "서버 역할 파일이 없으면 install을 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '/etc/fit/role이 없다')" = 1 ] && echo 1 || echo 0)"
mkdir -p /etc/fit
echo app >/etc/fit/role
out="$(run install)"; rc=$?
ok_if "docker 그룹이 없으면 install을 거부한다(bootstrap이 먼저다)" "$([ "$rc" != 0 ] && [ "$(has "$out" 'docker 그룹이 없다')" = 1 ] && echo 1 || echo 0)"
groupadd docker
out="$(run bogus)"; rc=$?
ok_if "모르는 명령은 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '사용: runner.sh install | register | status')" = 1 ] && echo 1 || echo 0)"

echo "--- install(서버 A 역할)"
out="$(run install)"; rc=$?
if [ "$rc" != 0 ]; then
  # 패키지 내려받기가 일시적으로 실패했을 수 있다. install은 멱등이라 한 번 더 실행한다
  echo "(첫 실행이 실패해 한 번 더 실행한다)"
  printf '%s\n' "$out" | tail -n 5
  out="$(run install)"; rc=$?
fi
printf '%s\n' "$out" | tail -n 8
ok_if "install이 성공한다" "$([ "$rc" = 0 ] && echo 1 || echo 0)"
ok_if "저장소 키의 지문이 고정한 값과 같다" "$(gpg --no-default-keyring --keyring /usr/share/keyrings/gitlab-runner.gpg --list-keys --with-colons 2>/dev/null | awk -F: '/^fpr/{print $10}' | grep -qx F6403F6544A38863DAA0B6E03F01618A51312F3F && echo 1 || echo 0)"
ok_if "저장소 목록이 signed-by 키와 이 Ubuntu의 코드명을 쓴다" "$(grep -q "signed-by=/usr/share/keyrings/gitlab-runner.gpg\] https://packages.gitlab.com/runner/gitlab-runner/ubuntu/ $(. /etc/os-release; echo "$VERSION_CODENAME") main" /etc/apt/sources.list.d/gitlab-runner.list && echo 1 || echo 0)"
ok_if "gitlab-runner가 고정한 버전(18.11.4-1)으로 설치된다" "$(is_v="$(dpkg-query -W -f='${Version}' gitlab-runner 2>/dev/null)"; [ "$is_v" = 18.11.4-1 ] && echo 1 || echo 0)"
ok_if "gitlab-runner와 helper-images가 같은 버전으로 고정된다(apt hold)" "$([ "$(apt-mark showhold | grep -cx -e gitlab-runner -e gitlab-runner-helper-images)" = 2 ] && [ "$(dpkg-query -W -f='${Version}' gitlab-runner-helper-images)" = 18.11.4-1 ] && echo 1 || echo 0)"
ok_if "gitlab-runner 계정이 docker 그룹이다" "$(id -nG gitlab-runner | tr ' ' '\n' | grep -qx docker && echo 1 || echo 0)"
out="$(run install)"; rc=$?
ok_if "다시 실행하면 변경이 없다(멱등)" "$([ "$rc" = 0 ] && [ "$(has "$out" '변경 0건')" = 1 ] && echo 1 || echo 0)"

echo "--- status"
out="$(run status)"; rc=$?
ok_if "status가 설치, 고정, 그룹을 PASS로 보고하고 등록 전이라 러너는 SKIP이다" "$([ "$rc" = 0 ] && [ "$(has "$out" 'PASS  gitlab-runner 18.11.4-1 설치됨')" = 1 ] && [ "$(has "$out" 'PASS  버전이 고정돼 있다')" = 1 ] && [ "$(has "$out" 'PASS  gitlab-runner 계정이 docker 그룹이다')" = 1 ] && [ "$(has "$out" 'SKIP  러너 fit-deploy이 아직 등록돼 있지 않다')" = 1 ] && echo 1 || echo 0)"
gpasswd -d gitlab-runner docker >/dev/null 2>&1
out="$(run status)"; rc=$?
ok_if "docker 그룹에서 빼면 status가 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'FAIL  gitlab-runner 계정이 docker 그룹이 아니다')" = 1 ] && echo 1 || echo 0)"
out="$(run install)"; rc=$?
ok_if "install을 다시 실행하면 그룹을 되돌린다" "$([ "$rc" = 0 ] && [ "$(has "$out" '변경: gitlab-runner를 docker 그룹에 넣었다')" = 1 ] && echo 1 || echo 0)"

echo "--- register 입력 검사(진짜 토큰 없이 확인할 수 있는 것)"
out="$(printf 'abc\n' | run register)"; rc=$?
ok_if "glrt-로 시작하지 않는 토큰은 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '토큰이 glrt-로 시작하지 않는다')" = 1 ] && echo 1 || echo 0)"
out="$(printf 'glrt-bad token;rm\n' | run register)"; rc=$?
ok_if "쓸 수 없는 글자가 있는 토큰은 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '토큰에 쓸 수 없는 글자가 있다')" = 1 ] && echo 1 || echo 0)"
FAKE="glrt-FAKE0000000000000000000000000000000000TOKEN"
out="$(printf '%s\n' "$FAKE" | FIT_RUNNER_URL=https://lab.ssafy.com run register)"; rc=$?
ok_if "가짜 토큰은 GitLab이 거부해 등록에 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '등록에 실패했다')" = 1 ] && echo 1 || echo 0)"
ok_if "실패해도 토큰은 출력에 나오지 않는다" "$([ "$(has "$out" "$FAKE")" = 0 ] && [ "$(has "$out" 'FAKE0000')" = 0 ] && echo 1 || echo 0)"
ok_if "실패하면 러너가 등록되지 않는다(config.toml에 러너가 없다)" "$([ ! -f /etc/gitlab-runner/config.toml ] || [ "$(grep -c '^\[\[runners\]\]' /etc/gitlab-runner/config.toml)" = 0 ] && echo 1 || echo 0)"
out="$(run status)"; rc=$?
ok_if "등록에 실패한 뒤에도 status는 러너를 SKIP으로 보고한다" "$([ "$rc" = 0 ] && [ "$(has "$out" 'SKIP  러너 fit-deploy이 아직 등록돼 있지 않다')" = 1 ] && echo 1 || echo 0)"

echo "--- 서버 B 역할은 러너 이름이 fit-verify다"
echo ops >/etc/fit/role
out="$(run status)"
ok_if "ops 서버는 fit-verify를 안내한다" "$(has "$out" 'SKIP  러너 fit-verify이 아직 등록돼 있지 않다')"

echo
if [ "$FAILED" = 0 ]; then echo "러너 시험 통과"; else echo "$FAILED개 실패"; exit 1; fi
