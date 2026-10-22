#!/usr/bin/env bash
# 관측 스택이 설계대로 떠 있는지 점검한다(설계 9절). 읽기만 하고 아무것도 바꾸지 않는다. 점검마다 PASS, FAIL, SKIP만 출력하고 값은 찍지 않는다.
#   bash infra/obs/verify-obs.sh
# 컨테이너 안에서 API를 불러(docker exec) 호스트에 게시된 포트가 없어도 돈다. 하나라도 FAIL이면 종료 코드 1이다.
# 환경변수: FIT_OBS_PROJECT(fit-obs). BE와 caddy는 첫 배포 전에는 없으므로 down이면 SKIP으로 센다.
set -uo pipefail
export PYTHONUTF8=1
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../deploy/lib.sh"

PROJECT="${FIT_OBS_PROJECT:-fit-obs}"
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

for svc in prometheus alertmanager grafana node-exporter cadvisor blackbox postgres-exporter opensearch-exporter dozzle; do
  c="$(cid "$svc")"
  state=""
  if [ -n "$c" ]; then state="$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$c" | tr -d '\r\n')"; fi
  case "$state" in running/healthy | running/-) pass "$svc가 떠 있다($state)" ;; *) fail "$svc가 떠 있지 않다(${state:-컨테이너 없음})" ;; esac
done
c="$(cid obs-init)"
ok_if "obs-init(설정 만들기)이 성공으로 끝났다" "$([ -n "$c" ] && [ "$(docker inspect -f '{{.State.ExitCode}}' "$c" | tr -d '\r\n')" = 0 ] && echo 1 || echo 0)"

# 수집 대상: 필수 job은 up이 하나 이상이어야 하고 be·caddy는 배포 전이면 SKIP이다
targets="$(api prometheus 'http://localhost:9090/api/v1/targets?state=active')"
for job in prometheus alertmanager node cadvisor postgres opensearch blackbox vault-ssh; do
  up="$(printf '%s' "$targets" | pyjson "import json,sys; t=json.load(sys.stdin)['data']['activeTargets']; print(sum(1 for x in t if x['labels']['job']=='$job' and x['health']=='up'))" 2>/dev/null || echo 0)"
  ok_if "수집 대상 $job: up이 있다" "$([ "${up:-0}" -ge 1 ] && echo 1 || echo 0)"
done
for job in be caddy; do
  up="$(printf '%s' "$targets" | pyjson "import json,sys; t=json.load(sys.stdin)['data']['activeTargets']; print(sum(1 for x in t if x['labels']['job']=='$job' and x['health']=='up'))" 2>/dev/null || echo 0)"
  if [ "${up:-0}" -ge 1 ]; then pass "수집 대상 $job: up이 있다"; else skip "수집 대상 $job: up이 없다(첫 배포 전이면 정상)"; fi
done

# 규칙: 모두 평가에 성공하고 알림 규칙이 있다
rules="$(api prometheus 'http://localhost:9090/api/v1/rules')"
bad="$(printf '%s' "$rules" | pyjson "import json,sys; g=json.load(sys.stdin)['data']['groups']; print(sum(1 for x in g for r in x['rules'] if r.get('health')!='ok' or r.get('lastError')))" 2>/dev/null || echo 99)"
n="$(printf '%s' "$rules" | pyjson "import json,sys; g=json.load(sys.stdin)['data']['groups']; print(sum(1 for x in g for r in x['rules'] if r['type']=='alerting'))" 2>/dev/null || echo 0)"
ok_if "알림 규칙 $n개가 올라와 있다" "$([ "${n:-0}" -ge 1 ] && echo 1 || echo 0)"
ok_if "모든 규칙이 오류 없이 평가된다" "$([ "${bad:-99}" = 0 ] && echo 1 || echo 0)"

# 알림 경로: Prometheus가 Alertmanager를 알고 Alertmanager가 준비돼 있다
am="$(api prometheus 'http://localhost:9090/api/v1/alertmanagers')"
ok_if "Prometheus가 Alertmanager를 찾았다" "$(printf '%s' "$am" | pyjson "import json,sys; print(1 if json.load(sys.stdin)['data']['activeAlertmanagers'] else 0)" 2>/dev/null || echo 0)"
ok_if "Alertmanager가 준비됐다" "$([ -n "$(api alertmanager 'http://localhost:9093/-/ready')" ] && echo 1 || echo 0)"

# 보존 설정(설계 9.1절)
flags="$(api prometheus 'http://localhost:9090/api/v1/status/flags')"
ok_if "보존 기간 7일(1w), 크기 상한 5GB(5GiB)" "$(printf '%s' "$flags" | pyjson "import json,sys; f=json.load(sys.stdin)['data']; print(1 if f['storage.tsdb.retention.time'] in ('7d','1w') and f['storage.tsdb.retention.size'] in ('5GB','5GiB') else 0)" 2>/dev/null || echo 0)"

ok_if "Grafana가 응답한다" "$(api grafana 'http://localhost:3000/api/health' | pyjson "import json,sys; print(1 if json.load(sys.stdin).get('database')=='ok' else 0)" 2>/dev/null || echo 0)"

# 호스트에 게시한 포트는 127.0.0.1뿐이다(설계 13.1절)
exposed="$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Ports}}' | tr ',' '\n' | grep -c -E '(^|[ ])(0\.0\.0\.0|\[::\]):[0-9]+->' || true)"
ok_if "0.0.0.0에 게시한 포트가 없다" "$([ "${exposed:-0}" = 0 ] && echo 1 || echo 0)"

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d개 점검 실패\n' "$FAILED"
  exit 1
fi
printf '\n관측 스택이 설계대로다\n'
