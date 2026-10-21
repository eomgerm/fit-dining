#!/usr/bin/env bash
# Mattermost 수신 웹훅으로 한 줄을 보낸다(설계 6.4절 7단계). 실패해도 배포를 막지 않는다(항상 종료 코드 0).
#   bash infra/deploy/notify.sh ok|fail|info "메시지"
# 웹훅 주소는 환경변수 FIT_NOTIFY_WEBHOOK, 없으면 /etc/fit/obs.env의 MATTERMOST_WEBHOOK_URL이다.
# 둘 다 없으면 화면에만 출력한다. 주소는 출력하지 않는다.
set -uo pipefail

level="${1:-info}"
shift || true
msg="$*"
case "$level" in
  ok) icon=":white_check_mark:" ;;
  fail) icon=":x:" ;;
  *) icon=":information_source:" ;;
esac
echo "알림($level): $msg"

url="${FIT_NOTIFY_WEBHOOK:-}"
obs_env="${FIT_ENV_DIR:-/etc/fit}/obs.env"
if [ -z "$url" ] && [ -f "$obs_env" ]; then
  url="$(sed -n 's/^MATTERMOST_WEBHOOK_URL=//p' "$obs_env" | head -n 1)"
fi
[ -n "$url" ] || exit 0

# JSON 문자열로 쓸 수 있게 역슬래시와 따옴표를 이스케이프한다
esc="$(printf '%s %s' "$icon" "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')"
# 본문은 파일로 보낸다. 명령행 인자로 주면 Windows용 curl이 한글을 깨뜨린다
body="$(mktemp)"
trap 'rm -f "$body"' EXIT
printf '{"text":"%s"}' "$esc" >"$body"
body_path="$body"
if command -v cygpath >/dev/null 2>&1; then body_path="$(cygpath -m "$body")"; fi
curl -sS --max-time 10 -X POST -H 'Content-Type: application/json' --data-binary "@$body_path" "$url" >/dev/null 2>&1 ||
  echo "알림 전송에 실패했다(무시한다)"
exit 0
