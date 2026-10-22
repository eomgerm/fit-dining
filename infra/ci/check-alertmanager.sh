#!/bin/sh
# Alertmanager 설정을 amtool로 검사하고 알림이 의도한 수신자로 가는지 시험한다(설계 9.4절).
# 저장소 루트에서 prom/alertmanager 이미지(ALERTMANAGER_IMAGE)로 실행한다. entrypoint는 비운다:
#   docker run --rm --entrypoint "" -v "$PWD:/work" -w /work "$ALERTMANAGER_IMAGE" sh infra/ci/check-alertmanager.sh
# 대상: A(infra/obs/alertmanager)와 B(infra/ops/alertmanager). 없는 디렉터리는 건너뛴다.
# 웹훅 주소 파일(api_url_file)은 서버가 뜰 때 만들어지므로 임시 폴더에 가짜 파일을 두고 경로만 바꿔 검사한다.
# 라우팅 시험 목록은 각 디렉터리의 routes.txt다. 한 줄이 한 시험이다: <기대 수신자> <라벨=값>...
set -eu
cd "$(dirname "$0")/../.."
T="$(mktemp -d)"
status=0
found=0
for dir in infra/obs/alertmanager infra/ops/alertmanager; do
  [ -f "$dir/alertmanager.yml" ] || continue
  found=1
  work="$T/$(basename "$(dirname "$dir")")"
  mkdir -p "$work/secrets" "$work/templates"
  for f in mattermost_url mattermost_url_dev; do echo "http://example.test/hook" >"$work/secrets/$f"; done
  cp "$dir"/templates/*.tmpl "$work/templates/"
  sed -e "s#/generated/secrets#$work/secrets#g" -e "s#/etc/alertmanager/templates#$work/templates#g" "$dir/alertmanager.yml" >"$work/alertmanager.yml"
  echo "== $dir"
  amtool check-config "$work/alertmanager.yml" || status=1
  while read -r want labels; do
    case "$want" in "" | \#*) continue ;; esac
    # shellcheck disable=SC2086
    got="$(amtool config routes test --config.file="$work/alertmanager.yml" $labels)"
    if [ "$got" = "$want" ]; then
      echo "OK   $labels -> $got"
    else
      echo "FAIL $labels -> $got (기대: $want)"
      status=1
    fi
  done <"$dir/routes.txt"
done
[ "$found" = 1 ] || echo "SKIP alertmanager 설정 없음"
rm -rf "$T"
exit "$status"
