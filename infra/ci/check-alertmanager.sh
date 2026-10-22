#!/bin/sh
# Alertmanager 설정을 amtool로 검사하고 알림이 의도한 수신자로 가는지 시험한다(설계 9.4절).
# 저장소 루트에서 prom/alertmanager 이미지(ALERTMANAGER_IMAGE)로 실행한다. entrypoint는 비운다:
#   docker run --rm --entrypoint "" -v "$PWD:/work" -w /work "$ALERTMANAGER_IMAGE" sh infra/ci/check-alertmanager.sh
# 대상: A(infra/obs/alertmanager)와 B(infra/ops/alertmanager). 없는 디렉터리는 건너뛴다.
# 웹훅 주소 파일(api_url_file)은 서버가 뜰 때 만들어지므로 임시 폴더에 가짜 파일을 두고 경로만 바꿔 검사한다.
# 라우팅 시험 목록은 각 디렉터리의 routes.txt다. 한 줄이 한 시험이다: <기대 수신자> <라벨=값>...
# 메시지 템플릿(fit.tmpl)은 A와 B가 같은 파일이어야 한다. A의 samples/*.json(알림 묶음 견본)을 템플릿에 넣어 그린 결과를
# samples/expect.txt와 맞춘다. 한 줄이 한 시험이다: <견본>|<title, fallback, text, color>|<들어 있어야 할 문자열>(앞에 !를 붙이면 없어야 한다)
set -eu
cd "$(dirname "$0")/../.."
T="$(mktemp -d)"
status=0
found=0
if [ -f infra/obs/alertmanager/templates/fit.tmpl ] && [ -f infra/ops/alertmanager/templates/fit.tmpl ]; then
  if cmp -s infra/obs/alertmanager/templates/fit.tmpl infra/ops/alertmanager/templates/fit.tmpl; then
    echo "OK   A와 B의 fit.tmpl이 같다"
  else
    echo "FAIL infra/obs와 infra/ops의 alertmanager/templates/fit.tmpl이 다르다(같은 내용이어야 한다)"
    status=1
  fi
fi
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
  [ -f "$dir/samples/expect.txt" ] || continue
  while IFS='|' read -r sample part want; do
    case "$sample" in "" | \#*) continue ;; esac
    if ! got="$(amtool template render --template.glob="$work/templates/fit.tmpl" --template.data="$dir/samples/$sample.json" --template.text="{{ template \"fit.$part\" . }}" 2>&1)"; then
      echo "FAIL $sample $part: 템플릿을 그리지 못했다: $got"
      status=1
      continue
    fi
    case "$want" in
      "!"*)
        want="${want#!}"
        case "$got" in *"$want"*) echo "FAIL $sample $part: '$want'가 있으면 안 된다" && status=1 ;; *) echo "OK   $sample $part: '$want' 없음" ;; esac
        ;;
      *)
        case "$got" in *"$want"*) echo "OK   $sample $part: '$want'" ;; *) echo "FAIL $sample $part: '$want'가 없다. 그려진 것: $got" && status=1 ;; esac
        ;;
    esac
  done <"$dir/samples/expect.txt"
done
[ "$found" = 1 ] || echo "SKIP alertmanager 설정 없음"
rm -rf "$T"
exit "$status"
