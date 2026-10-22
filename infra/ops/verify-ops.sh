#!/usr/bin/env bash
# 서버 B의 감시 구성이 설계대로 떠 있는지 점검한다(설계 9.3절). 읽기만 하고 아무것도 바꾸지 않는다. 점검마다 PASS, FAIL, SKIP만 출력하고 값은 찍지 않는다.
#   bash infra/ops/verify-ops.sh
# 컨테이너 안에서 API를 불러(docker exec) 호스트에 게시된 포트가 없어도 돈다. 하나라도 FAIL이면 종료 코드 1이다.
# 환경변수: FIT_OPS_PROJECT(fit-ops), FIT_SKIP=systemd(포트 감사 타이머를 보지 않는다. 시험용). A가 아직 배포 전이면 A를 보는 프로브와 금고 지표는 SKIP으로 센다.
set -uo pipefail
export PYTHONUTF8=1
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../deploy/lib.sh"

PROJECT="${FIT_OPS_PROJECT:-fit-ops}"
PY="$(find_python)" || {
  echo "FAIL python 3.9 이상이 필요하다" >&2
  exit 1
}
FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }

cid() { docker ps -a -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n 1; }
api() { docker exec "$(cid "$1")" wget -qO- "$2" 2>/dev/null; } # api 서비스 URL: 그 컨테이너 안에서 읽는다
pyjson() { "$PY" -c "$1"; } # 표준 입력의 JSON을 파이썬 식으로 판정한다
query() { api prometheus-b "http://localhost:9090/api/v1/query?query=$1"; } # query 식(URL 인코딩된 식): 결과 JSON
count_of() { pyjson "import json,sys; print(len(json.load(sys.stdin)['data']['result']))" 2>/dev/null || echo 0; }

for svc in prometheus-b alertmanager-b blackbox node-exporter; do
  c="$(cid "$svc")"
  state=""
  if [ -n "$c" ]; then state="$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$c" | tr -d '\r\n')"; fi
  case "$state" in running/healthy | running/-) pass "$svc가 떠 있다($state)" ;; *) fail "$svc가 떠 있지 않다(${state:-컨테이너 없음})" ;; esac
done
c="$(cid ops-init)"
ok_if "ops-init(설정 만들기)이 성공으로 끝났다" "$([ -n "$c" ] && [ "$(docker inspect -f '{{.State.ExitCode}}' "$c" | tr -d '\r\n')" = 0 ] && echo 1 || echo 0)"

# 수집 대상: B 자신의 job은 up이어야 하고 A 프로브는 대상 8개가 모두 수집돼야 한다(A가 응답하는지는 아래에서 따로 본다)
targets="$(api prometheus-b 'http://localhost:9090/api/v1/targets?state=active')"
for job in prometheus alertmanager node blackbox; do
  up="$(printf '%s' "$targets" | pyjson "import json,sys; t=json.load(sys.stdin)['data']['activeTargets']; print(sum(1 for x in t if x['labels']['job']=='$job' and x['health']=='up'))" 2>/dev/null || echo 0)"
  ok_if "수집 대상 $job: up이 있다" "$([ "${up:-0}" -ge 1 ] && echo 1 || echo 0)"
done
up="$(printf '%s' "$targets" | pyjson "import json,sys; t=json.load(sys.stdin)['data']['activeTargets']; print(sum(1 for x in t if x['labels']['job']=='a-probe' and x['health']=='up'))" 2>/dev/null || echo 0)"
ok_if "A 프로브 대상 8개가 모두 수집된다" "$([ "${up:-0}" = 8 ] && echo 1 || echo 0)"

# 규칙: 모두 평가에 성공하고 알림 규칙이 있다
rules="$(api prometheus-b 'http://localhost:9090/api/v1/rules')"
bad="$(printf '%s' "$rules" | pyjson "import json,sys; g=json.load(sys.stdin)['data']['groups']; print(sum(1 for x in g for r in x['rules'] if r.get('health')!='ok' or r.get('lastError')))" 2>/dev/null || echo 99)"
n="$(printf '%s' "$rules" | pyjson "import json,sys; g=json.load(sys.stdin)['data']['groups']; print(sum(1 for x in g for r in x['rules'] if r['type']=='alerting'))" 2>/dev/null || echo 0)"
ok_if "알림 규칙 $n개가 올라와 있다" "$([ "${n:-0}" -ge 1 ] && echo 1 || echo 0)"
ok_if "모든 규칙이 오류 없이 평가된다" "$([ "${bad:-99}" = 0 ] && echo 1 || echo 0)"

# 알림 경로
am="$(api prometheus-b 'http://localhost:9090/api/v1/alertmanagers')"
ok_if "Prometheus가 Alertmanager를 찾았다" "$(printf '%s' "$am" | pyjson "import json,sys; print(1 if json.load(sys.stdin)['data']['activeAlertmanagers'] else 0)" 2>/dev/null || echo 0)"
ok_if "Alertmanager가 준비됐다" "$([ -n "$(api alertmanager-b 'http://localhost:9093/-/ready')" ] && echo 1 || echo 0)"

flags="$(api prometheus-b 'http://localhost:9090/api/v1/status/flags')"
ok_if "보존 기간 7일(1w), 크기 상한 2GB(2GiB)" "$(printf '%s' "$flags" | pyjson "import json,sys; f=json.load(sys.stdin)['data']; print(1 if f['storage.tsdb.retention.time'] in ('7d','1w') and f['storage.tsdb.retention.size'] in ('2GB','2GiB') else 0)" 2>/dev/null || echo 0)"

# A를 밖에서 본 결과. 첫 배포 전이면 A가 응답하지 않으므로 SKIP이다
if [ "$(query 'probe_success%7Bprobe%3D%22a-healthz%22%7D%3D%3D1' | count_of)" = 1 ]; then
  pass "밖에서 본 A의 /healthz가 200이다"
else
  skip "밖에서 본 A의 /healthz가 200이 아니다(A가 배포 전이면 정상)"
fi
for metric in fit_portaudit_last_scan_timestamp_seconds fit_vault_last_received_timestamp_seconds; do
  if [ "$(query "$metric" | count_of)" -ge 1 ]; then pass "지표 $metric가 있다"; else skip "지표 $metric가 아직 없다(설치 직후나 첫 실행 전이면 정상)"; fi
done
if [ "$(query 'fit_portaudit_unexpected_ports%3E0' | count_of)" = 0 ]; then pass "예상 밖에서 열린 포트가 없다(포트 감사 지표 기준)"; else fail "예상 밖에서 열린 포트가 있다(fit_portaudit_port_open 지표를 본다)"; fi

# 포트 감사 타이머(systemd가 없는 환경에서는 건너뛴다)
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] && [ "${FIT_SKIP:-}" != systemd ]; then
  for t in fit-port-audit-quick.timer fit-port-audit-full.timer; do
    ok_if "$t가 켜져 있다" "$([ "$(systemctl is-active "$t" 2>/dev/null)" = active ] && echo 1 || echo 0)"
  done
else
  skip "systemd가 없어 포트 감사 타이머를 보지 않았다"
fi

# 호스트에 게시한 포트는 127.0.0.1뿐이다(설계 13.1절)
exposed="$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Ports}}' | tr ',' '\n' | grep -c -E '(^|[ ])(0\.0\.0\.0|\[::\]):[0-9]+->' || true)"
ok_if "0.0.0.0에 게시한 포트가 없다" "$([ "${exposed:-0}" = 0 ] && echo 1 || echo 0)"

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d개 점검 실패\n' "$FAILED"
  exit 1
fi
printf '\nB의 감시 구성이 설계대로다\n'
