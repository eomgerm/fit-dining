#!/usr/bin/env bash
# 서버 A의 관측 스택을 노트북에서 시험한다(설계 10.5절). 실제 Prometheus, Alertmanager, Grafana, node-exporter, cAdvisor, blackbox, 두 exporter, Dozzle을 띄우고
# 실제 Postgres·OpenSearch(데이터 시험 환경), 가짜 BE·Caddy·B(지표와 포트만 흉내)와 웹훅 대역으로 알림이 Mattermost 형식으로 도착하는 데까지 확인한다.
#   bash infra/obs/test/test-obs.sh up [구역...]   # 데이터 스택(OpenSearch 포함), 가짜 대상, 관측 스택을 띄운다
#   bash infra/obs/test/test-obs.sh run [구역...]  # 시나리오를 돌린다. 구역: stack init scrape rules alert grafana digest install hygiene
#   bash infra/obs/test/test-obs.sh down           # 시험이 만든 것을 모두 지운다
# 필요한 것: docker compose(2.24 이상), python 3.9 이상. 데이터 스택 시험(infra/data/test/test-data.sh)의 망과 DB를 그대로 쓴다.
# 시험용 사본: 규칙의 for는 0s로, Alertmanager의 group_wait·group_interval은 짧게 바꾼다(식과 라우팅은 같다). 시험용 값은 매번 무작위다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
# Windows의 파이썬은 콘솔 코드 페이지(cp949)로 출력해 한글이 깨지므로 UTF-8로 고정한다
export PYTHONUTF8=1
W="$(pwd -W 2>/dev/null || pwd)"
T="$W/.tmp-obstest"
PROJECT=fit-obstest
# shellcheck source=infra/ci/tool-images.sh
. infra/ci/tool-images.sh
# shellcheck source=infra/deploy/lib.sh
. infra/deploy/lib.sh

# 데이터 스택 시험의 이름(접두사 fit-datatest)을 그대로 쓴다
export FIT_ENV_DIR="$W/.tmp-datatest/etc" FIT_DATA_ENV="$W/.tmp-datatest/etc/data.env" FIT_DATA_PROJECT=fit-datatest
export FIT_NET_PREFIX=fit-datatest- FIT_NET_DATA=fit-datatest-net-data FIT_NET_EDGE=fit-datatest-net-edge FIT_NET_DBACCESS=fit-datatest-net-dbaccess
export FIT_NET_OBS=fit-datatest-net-obs FIT_NET_PROD=fit-datatest-net-prod FIT_NET_DEV=fit-datatest-net-dev
export FIT_OBSTEST_DIR="$T"

dc() { docker compose -p "$PROJECT" -f "$W/infra/obs/compose.obs.yml" -f "$W/infra/obs/test/compose.test.yml" --env-file "$T/obs.env" "$@"; }
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
PY="$(find_python)"

# 가짜 대상: 이름은 망의 별칭이다(컨테이너 이름은 시험 접두사라 다른 시험과 겹치지 않는다)
sidecar() { # sidecar 이름 망 별칭 [docker run 인자...] -- 명령...
  local name="$1" net="$2" alias="$3"
  shift 3
  docker run -d --name "$PROJECT-$name" --network "$net" --network-alias "$alias" "$@" >/dev/null
}
be_metrics() { # be_metrics 디렉터리: 가짜 BE가 내는 지표 파일(정상 값)
  mkdir -p "$T/$1/actuator"
  printf 'http_server_requests_seconds_count{status="200",uri="/api/v1/x",method="GET"} 100\nbatch_last_success_timestamp_seconds %s\nmodal_daily_budget_used_ratio 0.1\n' "$(date +%s)" >"$T/$1/actuator/prometheus"
}
mock_be() { # mock_be 이름 망 별칭 디렉터리
  be_metrics "$4"
  sidecar "$1" "$2" "$3" -v "$W/infra/obs/test/mock-exporter.py:/mock.py:ro" -v "$T/$4:/srv:ro" "$PYTHON_IMAGE" python /mock.py 8081 /srv
}

up() {
  down >/dev/null 2>&1 || true
  mkdir -p "$T/textfile" "$T/rules" "$T/caddy"
  FIT_TEST_OPENSEARCH=1 bash infra/data/test/test-data.sh up
  bash infra/data/init-data.sh
  local token_main token_dev
  token_main="$(hex 12)"
  token_dev="$(hex 12)"
  printf 'webhook-main=%s\nwebhook-dev=%s\n' "$token_main" "$token_dev" >"$T/tokens"
  {
    echo "GRAFANA_ADMIN_PASSWORD=$(hex 12)"
    echo "MATTERMOST_WEBHOOK_URL=http://webhook-sink:18099/hook/$token_main"
    echo "MATTERMOST_WEBHOOK_URL_DEV=http://webhook-sink:18099/hook-dev/$token_dev"
    echo "B_IP=b-sim"
    sed -n 's/^FIT_MONITOR_PASSWORD=/FIT_MONITOR_PASSWORD=/p' "$FIT_DATA_ENV"
  } >"$T/obs.env"
  # 시험 사본: for를 0s로, Alertmanager 대기를 짧게
  for f in infra/obs/prometheus/rules/*.yml; do sed 's/^\( *\)for: .*/\1for: 0s/' "$f" >"$T/rules/$(basename "$f")"; done
  sed -e 's/group_wait: .*/group_wait: 1s/' -e 's/group_interval: .*/group_interval: 5s/' infra/obs/alertmanager/alertmanager.yml >"$T/alertmanager.yml"
  # 지표 fixture: 백업은 정상 값으로 시작한다
  now="$(date +%s)"
  printf 'fit_backup_last_success_timestamp_seconds{kind="pg"} %s\nfit_backup_last_success_timestamp_seconds{kind="photos"} %s\nfit_backup_last_success_timestamp_seconds{kind="caddy"} %s\nfit_backup_last_verify_ok 1\nfit_backup_last_verify_timestamp_seconds %s\nfit_backup_last_push_timestamp_seconds %s\nfit_backup_outbox_files 0\n' "$now" "$now" "$now" "$now" "$now" >"$T/textfile/fit_backup.prom"
  printf 'caddy_http_requests_total 1\n' >"$T/caddy/metrics"
  mock_be be-prod-blue "$FIT_NET_PROD" be-prod-blue be-prod-blue
  mock_be be-prod-green "$FIT_NET_PROD" be-prod-green be-prod-green
  mock_be be-dev "$FIT_NET_DEV" be-dev be-dev
  sidecar caddy "$FIT_NET_OBS" caddy -v "$W/infra/obs/test/mock-exporter.py:/mock.py:ro" -v "$T/caddy:/srv:ro" "$PYTHON_IMAGE" python /mock.py 9180 /srv
  sidecar webhook-sink "$FIT_NET_OBS" webhook-sink -v "$W/infra/obs/test/webhook-sink.py:/sink.py:ro" -v "$T:/out" "$PYTHON_IMAGE" python /sink.py 18099 /out/sink.log
  sidecar b-sim "$FIT_NET_OBS" b-sim "$PYTHON_IMAGE" python -c "import socketserver as s; s.ThreadingTCPServer.allow_reuse_address=True; s.ThreadingTCPServer(('0.0.0.0',22), type('H',(s.BaseRequestHandler,),{'handle':lambda self:None})).serve_forever()"
  # 일일 점검 요약 시험용: 인증서 잔여일을 읽을 TLS 서버 둘(40일, 5일). 호스트의 openssl로 자체 서명 인증서를 만든다
  mkdir -p "$T/tls"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$T/tls/key.pem" -out "$T/tls/cert40.pem" -days 40 -subj /CN=a.test >/dev/null 2>&1
  openssl req -new -x509 -key "$T/tls/key.pem" -out "$T/tls/cert5.pem" -days 5 -subj /CN=a.test >/dev/null 2>&1
  sidecar tls-sim "$FIT_NET_OBS" tls-sim -v "$W/infra/obs/test/tls-sim.py:/tls.py:ro" -v "$T/tls:/tls:ro" "$PYTHON_IMAGE" python /tls.py 443 /tls/cert40.pem /tls/key.pem
  sidecar tls-sim-short "$FIT_NET_OBS" tls-sim-short -v "$W/infra/obs/test/tls-sim.py:/tls.py:ro" -v "$T/tls:/tls:ro" "$PYTHON_IMAGE" python /tls.py 443 /tls/cert5.pem /tls/key.pem
  : >"$T/sink.log"
  dc up -d --wait --wait-timeout 300
  echo "관측 시험 환경이 떴다(프로젝트 $PROJECT)"
}

down() {
  dc down -v --remove-orphans >/dev/null 2>&1 || docker compose -p "$PROJECT" down -v --remove-orphans >/dev/null 2>&1 || true
  local c
  docker rm -f "$PROJECT-host" >/dev/null 2>&1 || true
  for c in be-prod-blue be-prod-green be-dev caddy webhook-sink b-sim tls-sim tls-sim-short; do docker rm -f "$PROJECT-$c" >/dev/null 2>&1 || true; done
  bash infra/data/test/test-data.sh down >/dev/null 2>&1 || true
  rm -rf "$T"
  echo "정리했다"
}

# ---- 시나리오 ----------------------------------------------------------------
FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); if [ -n "${out:-}" ]; then printf '%s\n' "$out" | tail -n 8 | sed 's/^/FAIL  > /'; fi; }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }
is() { if [ "$1" = "$2" ]; then echo 1; else echo 0; fi; }
has() { case "$1" in *"$2"*) echo 1 ;; *) echo 0 ;; esac; }
out=""
rc=0

cid() { docker ps -a -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n 1; }
# 서비스 컨테이너 안에서 URL을 읽는다(호스트 포트 포워더에 기대지 않는다)
inside() { docker exec "$(cid "$1")" wget -qO- "$2" 2>/dev/null; }
urlenc() { "$PY" -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1"; }
prom() { inside prometheus "http://localhost:9090/api/v1/query?query=$(urlenc "$1")"; }
# 질의 결과의 첫 값(없으면 빈 문자열)
pval() { prom "$1" | "$PY" -c 'import json,sys; r=json.load(sys.stdin)["data"]["result"]; print(r[0]["value"][1] if r else "")' 2>/dev/null || true; }
pcount() { prom "$1" | "$PY" -c 'import json,sys; print(len(json.load(sys.stdin)["data"]["result"]))' 2>/dev/null || echo 0; }
wait_for() { # wait_for 제한초 명령... : 명령이 성공할 때까지 기다린다
  local limit=$(($(date +%s) + $1)) _
  shift
  until "$@" >/dev/null 2>&1; do
    [ "$(date +%s)" -lt "$limit" ] || return 1
    sleep 3
  done
}
# 웹훅 대역이 받은 메시지 수: sink_count 경로접두사 포함할문자열
sink_count() {
  "$PY" - "$T/sink.log" "$1" "$2" <<'PYEOF'
import json, sys
path, prefix, needle = sys.argv[1:4]
n = 0
for line in open(path, encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    rec = json.loads(line)
    if rec["path"].startswith(prefix) and needle in rec["body"]:
        n += 1
print(n)
PYEOF
}
sink_has() { [ "$(sink_count "$1" "$2")" -ge 1 ]; }
sink_body() { # sink_body 경로접두사 포함할문자열: 마지막으로 받은 메시지의 body
  "$PY" - "$T/sink.log" "$1" "$2" <<'PYEOF'
import json, sys
path, prefix, needle = sys.argv[1:4]
last = ""
for line in open(path, encoding="utf-8"):
    line = line.strip()
    if line:
        rec = json.loads(line)
        if rec["path"].startswith(prefix) and needle in rec["body"]:
            last = rec["body"]
print(last)
PYEOF
}

run_stack_checks() {
  echo "--- 구성"
  out="$(FIT_OBS_PROJECT=$PROJECT bash infra/obs/verify-obs.sh 2>&1)" && rc=0 || rc=$?
  ok_if "verify-obs.sh가 모두 통과한다" "$(is "$rc" 0)"
  local ports
  ports="$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}} {{.Ports}}' | tr -d '\r')"
  ok_if "호스트에 게시한 포트는 prometheus, grafana, dozzle의 127.0.0.1뿐이다" \
    "$([ "$(grep -c '127.0.0.1:' <<<"$ports")" = 3 ] && [ "$(grep -c '0.0.0.0:' <<<"$ports")" = 0 ] && echo 1 || echo 0)"
  ok_if "alertmanager, exporter, cadvisor는 호스트에 게시하지 않는다" \
    "$([ "$(grep -E 'alertmanager|exporter|cadvisor|blackbox' <<<"$ports" | grep -c -- '->')" = 0 ] && echo 1 || echo 0)"
  local svc limit
  for svc in prometheus:536870912 alertmanager:67108864 grafana:268435456 node-exporter:67108864 cadvisor:201326592 blackbox:67108864 postgres-exporter:67108864 opensearch-exporter:67108864 dozzle:67108864; do
    limit="$(docker inspect -f '{{.HostConfig.Memory}}' "$(cid "${svc%%:*}")" | tr -d '\r\n')"
    ok_if "${svc%%:*}의 메모리 한도가 ${svc##*:}바이트다" "$(is "$limit" "${svc##*:}")"
  done
  out="$(inside prometheus 'http://localhost:9090/api/v1/status/flags')"
  ok_if "Prometheus 보존이 7일, 5GB다(화면에는 1w, 5GiB로 보인다)" "$([ "$(has "$out" '"storage.tsdb.retention.time":"1w"')" = 1 ] && [ "$(has "$out" '"storage.tsdb.retention.size":"5GiB"')" = 1 ] && echo 1 || echo 0)"
  ok_if "Prometheus의 관리 API(/-/quit, /-/reload)는 꺼져 있다" "$([ "$(has "$out" '"web.enable-lifecycle":"false"')" = 1 ] && echo 1 || echo 0)"
}

run_init_checks() {
  echo "--- 설정 만들기(obs-init)"
  local g=/tmp/g good=(-e B_IP=b.example.test -e MATTERMOST_WEBHOOK_URL=https://mm.example.test/hooks/a -e MATTERMOST_WEBHOOK_URL_DEV=https://mm.example.test/hooks/b)
  initrun() { docker run --rm --network none -e GENERATED_DIR=$g -v "$W/infra/obs/render.py:/render.py:ro" "$@" "$PYTHON_IMAGE" python /render.py 2>&1; }
  out="$(initrun "${good[@]}" && echo)" && rc=0 || rc=$?
  ok_if "올바른 값이면 대상 파일과 비밀 파일 3개를 만든다" "$([ "$rc" = 0 ] && [ "$(has "$out" 'vault-ssh.yml')" = 1 ] && [ "$(has "$out" 'mattermost_url_dev')" = 1 ] && echo 1 || echo 0)"
  ok_if "만든 내용에 웹훅 주소를 출력하지 않는다" "$(is "$(has "$out" 'mm.example.test')" 0)"
  out="$(initrun -e MATTERMOST_WEBHOOK_URL=https://x.test/a -e MATTERMOST_WEBHOOK_URL_DEV=https://x.test/b)" && rc=0 || rc=$?
  ok_if "B_IP가 없으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" B_IP)" = 1 ] && echo 1 || echo 0)"
  out="$(initrun -e B_IP=REPLACE_ME -e MATTERMOST_WEBHOOK_URL=https://x.test/a -e MATTERMOST_WEBHOOK_URL_DEV=https://x.test/b)" && rc=0 || rc=$?
  ok_if "자리표시자(REPLACE_ME)가 남아 있으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" REPLACE_ME)" = 1 ] && echo 1 || echo 0)"
  out="$(initrun -e 'B_IP=a;b' -e MATTERMOST_WEBHOOK_URL=https://x.test/a -e MATTERMOST_WEBHOOK_URL_DEV=https://x.test/b)" && rc=0 || rc=$?
  ok_if "B_IP에 이상한 문자가 있으면 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  out="$(initrun -e B_IP=b.test -e MATTERMOST_WEBHOOK_URL=ftp://x.test/a -e MATTERMOST_WEBHOOK_URL_DEV=https://x.test/b)" && rc=0 || rc=$?
  ok_if "http(s)가 아닌 웹훅 주소는 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  c="$(cid obs-init)"
  ok_if "obs-init은 네트워크 없이 읽기 전용으로 돈다" "$([ "$(docker inspect -f '{{.HostConfig.NetworkMode}} {{.HostConfig.ReadonlyRootfs}}' "$c" | tr -d '\r')" = 'none true' ] && echo 1 || echo 0)"
  out="$(docker exec "$(cid alertmanager)" sh -c 'ls -l /generated/secrets/ | grep -c mattermost; cat /generated/targets/vault-ssh.yml' 2>&1)"
  ok_if "Alertmanager가 비밀 파일 2개를 읽을 수 있고 대상 파일에 B_IP가 있다" "$([ "$(has "$out" 'b-sim:22')" = 1 ] && echo 1 || echo 0)"
}

run_scrape_checks() {
  echo "--- 수집"
  local job
  for job in prometheus alertmanager node cadvisor caddy postgres opensearch blackbox vault-ssh; do
    ok_if "수집 대상 $job가 up이다" "$(is "$(pval "count(up{job=\"$job\"} == 1)")" 1)"
  done
  ok_if "BE는 세 대상(blue, green, dev)이 모두 up이다" "$(is "$(pval 'count(up{job="be"} == 1)')" 3)"
  ok_if "BE 지표에 env와 color 라벨이 붙는다" "$(is "$(pval 'count(up{job="be", env="prod", color="blue"})')" 1)"
  ok_if "Prometheus에 site=A 외부 라벨이 있다" "$([ "$(has "$(inside prometheus 'http://localhost:9090/api/v1/status/config')" 'site: A')" = 1 ] && echo 1 || echo 0)"
  # Docker Desktop(WSL2)에는 mountpoint="/"인 파일시스템이 없어 라벨은 실제 서버에서 확인한다
  ok_if "node-exporter가 호스트의 메모리·디스크 지표를 낸다" "$([ "$(pcount 'node_memory_MemAvailable_bytes')" -ge 1 ] && [ "$(pcount 'node_filesystem_avail_bytes')" -ge 1 ] && echo 1 || echo 0)"
  ok_if "node-exporter가 textfile 지표(백업)를 읽는다" "$(is "$(pval 'fit_backup_last_verify_ok')" 1)"
  ok_if "cAdvisor가 컨테이너 이름과 메모리 한도를 낸다(prometheus 512MiB)" "$(is "$(pval 'container_spec_memory_limit_bytes{name=~".*prometheus.*"}')" 536870912)"
  ok_if "postgres-exporter가 pg_up=1과 연결 수를 낸다" "$([ "$(pval pg_up)" = 1 ] && [ -n "$(pval 'sum(pg_stat_activity_count)')" ] && [ "$(pval 'max(pg_settings_max_connections)')" = 60 ] && echo 1 || echo 0)"
  ok_if "OpenSearch exporter가 클러스터 상태와 힙을 낸다" "$([ "$(pval 'elasticsearch_clusterinfo_up')" = 1 ] && [ -n "$(pval 'max(elasticsearch_jvm_memory_used_bytes{area="heap"})')" ] && echo 1 || echo 0)"
  ok_if "A에서 B(b-sim:22)의 TCP 프로브가 성공한다" "$(is "$(pval 'probe_success{job="vault-ssh"}')" 1)"
}

run_rules_checks() {
  echo "--- 규칙"
  local rules
  rules="$(inside prometheus 'http://localhost:9090/api/v1/rules')"
  ok_if "알림 규칙 35개가 올라와 있다" "$(is "$(printf '%s' "$rules" | "$PY" -c 'import json,sys; g=json.load(sys.stdin)["data"]["groups"]; print(sum(1 for x in g for r in x["rules"] if r["type"]=="alerting"))')" 35)"
  ok_if "모든 규칙이 오류 없이 평가된다" "$(is "$(printf '%s' "$rules" | "$PY" -c 'import json,sys; g=json.load(sys.stdin)["data"]["groups"]; print(sum(1 for x in g for r in x["rules"] if r.get("health")!="ok" or r.get("lastError")))')" 0)"
  ok_if "기록 규칙(recording rule, Modal 폴백 비율)이 올라와 있다" "$([ "$(has "$rules" 'fit:modal_fallback_ratio:rate15m')" = 1 ] && echo 1 || echo 0)"
  ok_if "Prometheus가 Alertmanager에 연결돼 있다" "$([ "$(has "$(inside prometheus 'http://localhost:9090/api/v1/alertmanagers')" 'alertmanager:9093')" = 1 ] && echo 1 || echo 0)"
}

run_alert_checks() {
  echo "--- 알림이 Mattermost 형식으로 도착한다"
  local mt="$T/textfile/fit_backup.prom" tok_main tok_dev body
  tok_main="$(sed -n 's/^webhook-main=//p' "$T/tokens")"
  tok_dev="$(sed -n 's/^webhook-dev=//p' "$T/tokens")"
  : >"$T/sink.log" # 앞서 받은 메시지는 비운다(이 구역을 다시 돌려도 같은 결과가 나오게)
  # 1) prod BE가 모두 내려가면 critical이 main으로 간다
  docker stop "$PROJECT-be-prod-blue" "$PROJECT-be-prod-green" >/dev/null
  ok_if "prod BE 두 색이 모두 내려가면 FitBeProdDown이 main 수신자(/hook)에 도착한다" "$(wait_for 150 sink_has "/hook/$tok_main" FitBeProdDown && echo 1 || echo 0)"
  body="$(sink_body "/hook/$tok_main" "[FIRING:1] FitBeProdDown")"
  out="$body"
  ok_if "메시지가 Slack 형식(attachments, title, text, color)이다" "$([ "$(has "$body" '"attachments"')" = 1 ] && [ "$(has "$body" '"title"')" = 1 ] && [ "$(has "$body" '"color":"danger"')" = 1 ] && echo 1 || echo 0)"
  ok_if "제목에 상태, 알림 이름, site/env가 있다([FIRING:1] FitBeProdDown (A/prod))" "$(has "$body" '[FIRING:1] FitBeProdDown (A/prod)')"
  ok_if "본문에 요약, 설명, 런북 ID가 있다" "$([ "$(has "$body" '*CRITICAL*')" = 1 ] && [ "$(has "$body" 'prod BE가 모든 색에서 응답하지 않는다')" = 1 ] && [ "$(has "$body" '런북: RB-02')" = 1 ] && echo 1 || echo 0)"
  ok_if "prod 알림은 dev 수신자(/hook-dev)로 가지 않는다" "$(is "$(sink_count "/hook-dev/$tok_dev" FitBeProdDown)" 0)"
  docker start "$PROJECT-be-prod-blue" "$PROJECT-be-prod-green" >/dev/null
  ok_if "복구되면 [RESOLVED] 메시지가 온다" "$(wait_for 150 sink_has "/hook/$tok_main" '[RESOLVED] FitBeProdDown' && echo 1 || echo 0)"
  # 2) dev는 별도 수신자로 간다
  docker stop "$PROJECT-be-dev" >/dev/null
  ok_if "dev BE가 내려가면 FitBeDevDown이 dev 수신자(/hook-dev)에 도착한다" "$(wait_for 150 sink_has "/hook-dev/$tok_dev" FitBeDevDown && echo 1 || echo 0)"
  ok_if "dev 알림은 main 수신자로 가지 않는다" "$(is "$(sink_count "/hook/$tok_main" FitBeDevDown)" 0)"
  docker start "$PROJECT-be-dev" >/dev/null
  # 3) 백업 지표(textfile)가 알림까지 이어진다
  sed -i 's/^fit_backup_last_verify_ok .*/fit_backup_last_verify_ok 0/' "$mt"
  ok_if "textfile의 fit_backup_last_verify_ok를 0으로 바꾸면 FitBackupVerifyFailed가 도착한다" "$(wait_for 150 sink_has "/hook/$tok_main" FitBackupVerifyFailed && echo 1 || echo 0)"
  out="$(sink_body "/hook/$tok_main" "[FIRING:1] FitBackupVerifyFailed")"
  ok_if "그 메시지의 색은 warning이고 런북은 RB-06이다" "$([ "$(has "$out" '"color":"warning"')" = 1 ] && [ "$(has "$out" '런북: RB-06')" = 1 ] && echo 1 || echo 0)"
  sed -i 's/^fit_backup_last_verify_ok .*/fit_backup_last_verify_ok 1/' "$mt"
  ok_if "1로 되돌리면 해소 메시지가 온다" "$(wait_for 150 sink_has "/hook/$tok_main" '[RESOLVED] FitBackupVerifyFailed' && echo 1 || echo 0)"
  # 4) B로 가는 22번 프로브가 실패하면 알린다
  docker stop "$PROJECT-b-sim" >/dev/null
  ok_if "B의 22번 포트가 닫히면 FitVaultUnreachable이 도착한다" "$(wait_for 150 sink_has "/hook/$tok_main" FitVaultUnreachable && echo 1 || echo 0)"
  docker start "$PROJECT-b-sim" >/dev/null
  # 5) 지표가 사라지면(absent) 알린다
  rm -f "$T/be-prod-blue/actuator/prometheus" "$T/be-prod-green/actuator/prometheus"
  ok_if "BE 지표 파일이 사라지면 FitHttpMetricMissing(absent)이 도착한다" "$(wait_for 150 sink_has "/hook/$tok_main" FitHttpMetricMissing && echo 1 || echo 0)"
  be_metrics be-prod-blue
  be_metrics be-prod-green
  ok_if "지표 파일을 되살리면 해소 메시지가 온다(시험은 처음 상태로 돌아간다)" "$(wait_for 150 sink_has "/hook/$tok_main" '[RESOLVED] FitHttpMetricMissing' && echo 1 || echo 0)"
}

run_grafana_checks() {
  echo "--- Grafana"
  local pw dashes
  pw="$(sed -n 's/^GRAFANA_ADMIN_PASSWORD=//p' "$T/obs.env")"
  out="$(docker exec "$(cid grafana)" wget -qO- --header "Authorization: Basic $(printf 'admin:%s' "$pw" | base64 | tr -d '\n')" http://localhost:3000/api/datasources/uid/prom-a/health 2>&1)"
  ok_if "프로비저닝한 Prometheus 데이터소스(uid prom-a)가 정상이다" "$(has "$out" 'Successfully queried the Prometheus API')"
  dashes="$(docker exec "$(cid grafana)" wget -qO- --header "Authorization: Basic $(printf 'admin:%s' "$pw" | base64 | tr -d '\n')" 'http://localhost:3000/api/search?type=dash-db' 2>&1)"
  ok_if "대시보드 3개가 프로비저닝됐다(fit-host, fit-app, fit-data)" "$([ "$(has "$dashes" '"uid":"fit-host"')" = 1 ] && [ "$(has "$dashes" '"uid":"fit-app"')" = 1 ] && [ "$(has "$dashes" '"uid":"fit-data"')" = 1 ] && echo 1 || echo 0)"
  out="$(docker exec "$(cid grafana)" wget -qO- http://localhost:3000/api/search 2>&1 || true)"
  ok_if "로그인 없이는 대시보드를 볼 수 없다(익명 접근 없음)" "$([ "$(has "$out" fit-host)" = 0 ] && echo 1 || echo 0)"
  # 대시보드의 모든 쿼리가 Prometheus에서 문법 오류 없이 실행된다
  local bad=0 n=0 expr
  while IFS= read -r expr; do
    n=$((n + 1))
    if [ "$(prom "$expr" | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null)" != success ]; then
      bad=$((bad + 1))
      echo "FAIL  쿼리가 실행되지 않는다: $expr"
    fi
  done < <("$PY" - infra/obs/grafana/dashboards <<'PYEOF'
import json, pathlib, sys
for f in sorted(pathlib.Path(sys.argv[1]).glob("*.json")):
    for p in json.loads(f.read_text(encoding="utf-8"))["panels"]:
        for t in p["targets"]:
            print(t["expr"])
PYEOF
  )
  ok_if "대시보드의 쿼리 $n개가 모두 Prometheus에서 성공한다" "$([ "$bad" = 0 ] && [ "$n" -ge 20 ] && echo 1 || echo 0)"
}

run_digest_checks() {
  echo "--- 일일 점검 요약(daily-digest.py)"
  local tok gate gpw before out2
  tok="$(sed -n 's/^webhook-main=//p' "$T/tokens")"
  gate="gatekey-$(hex 6)"
  gpw="$(sed -n 's/^GRAFANA_ADMIN_PASSWORD=//p' "$T/obs.env")"
  mkdir -p "$T/digest" "$T/state"
  printf 'GRAFANA_ADMIN_PASSWORD=%s\nMATTERMOST_WEBHOOK_URL=http://webhook-sink:18099/hook/%s\n' "$gpw" "$tok" >"$T/digest/obs.env"
  printf 'GRAFANA_ADMIN_PASSWORD=%s\nMATTERMOST_WEBHOOK_URL=http://webhook-sink:1/unreachable\n' "$gpw" >"$T/digest/obs-bad.env"
  printf 'PROD_HOST=a.test\nDEV_HOST=a.test\nDEV_GATE_KEY=%s\n' "$gate" >"$T/digest/edge.env"
  printf '2026-11-07T01:02:03Z deploy-start all 0123456789abcdef0123 start runner\n2026-11-07T01:05:03Z deploy-end all 0123456789abcdef0123 ok runner\n' >"$T/state/history-prod.log"
  printf '2026-11-07T02:02:03Z deploy-end all fedcba9876543210fedc fail runner\n' >"$T/state/history-dev.log"
  digest() { # digest 인자...: 스크립트를 시험 망의 컨테이너에서 돌린다(뒤에 오는 같은 옵션이 앞을 덮는다)
    docker run --rm --network "$FIT_NET_OBS" -v "$W/infra/obs/daily-digest.py:/d.py:ro" -v "$T/digest:/digest:ro" -v "$T/state:/state:ro" "$PYTHON_IMAGE" \
      python /d.py --prom http://prometheus:9090 --state-dir /state --obs-env /digest/obs.env --edge-env /digest/edge.env --tls-connect tls-sim "$@" 2>&1
  }
  # shellcheck disable=SC2329 # wait_for가 이름으로 부른다
  digest_has() { digest --dry-run | grep -qF -- "$1"; } # digest_has 문자열: wait_for에 넘기려고 호출할 때마다 다시 만든다
  before="$(sink_count /hook "일일 점검")"
  out="$(digest --dry-run)" && rc=0 || rc=$?
  ok_if "--dry-run은 종료 코드 0으로 끝나고 아무것도 올리지 않는다" "$([ "$rc" = 0 ] && [ "$(sink_count /hook "일일 점검")" = "$before" ] && echo 1 || echo 0)"
  ok_if "표에 디스크, 메모리, 스왑, CPU 24시간 평균 행이 있다" "$([ "$(has "$out" '| 디스크(/) |')" = 1 ] && [ "$(has "$out" '| 메모리 |')" = 1 ] && [ "$(has "$out" '| 스왑 |')" = 1 ] && [ "$(has "$out" '| CPU 24시간 평균 |')" = 1 ] && echo 1 || echo 0)"
  ok_if "CPU는 데이터가 24시간보다 짧으면 '쌓인 데이터만'이라고 적는다(방금 올린 시험 스택이다)" "$([ "$(printf '%s\n' "$out" | grep -F '| CPU 24시간 평균 |' | grep -c '쌓인 데이터만')" = 1 ] && echo 1 || echo 0)"
  # CPU 행의 ✅와 ⚠️는 시험하는 PC의 부하에 달렸으므로 값이 나오는지만 본다
  ok_if "메모리와 CPU는 실제 값이 나온다(지표 없음이 아니다)" "$([ "$(has "$out" '| 메모리 | ✅ | 가용')" = 1 ] && [ "$(printf '%s\n' "$out" | grep -F '| CPU 24시간 평균 |' | grep -c '기준선 40%')" = 1 ] && echo 1 || echo 0)"
  ok_if "백업 행: pg, photos, caddy의 마지막 성공과 복원 검증 통과" "$([ "$(has "$out" '| 백업 pg | ✅ | 마지막 성공')" = 1 ] && [ "$(has "$out" '| 백업 photos | ✅ |')" = 1 ] && [ "$(has "$out" '| 백업 caddy | ✅ |')" = 1 ] && [ "$(has "$out" '| 백업 복원 검증 | ✅ | 마지막 검증 통과')" = 1 ] && echo 1 || echo 0)"
  ok_if "5xx와 배치 행이 있다(BE 지표에서)" "$([ "$(has "$out" '| 5xx(24시간) | ✅ | 0건')" = 1 ] && [ "$(has "$out" '| 새벽 배치 | ✅ | 마지막 성공')" = 1 ] && echo 1 || echo 0)"
  ok_if "마지막 배포: prod는 성공(KST로 바뀐 시각과 앞 12자리 sha), dev는 실패가 주의로 보인다" "$([ "$(has "$out" '| 마지막 배포(prod) | ✅ | 11-07 10:05 KST 배포 ok 0123456789ab (runner)')" = 1 ] && [ "$(has "$out" '| 마지막 배포(dev) | ⚠️ | 11-07 11:02 KST 배포 fail fedcba987654')" = 1 ] && echo 1 || echo 0)"
  ok_if "인증서 잔여일을 서버 자신의 443에서 읽는다(40일, 정상)" "$([ "$(has "$out" '| 인증서(prod) | ✅ | 만료까지 40일')" = 1 ] && [ "$(has "$out" '| 인증서(dev) | ✅ | 만료까지 40일')" = 1 ] && echo 1 || echo 0)"
  ok_if "지금 울리는 알림 행이 있다" "$(has "$out" '| 지금 울리는 알림 |')"
  ok_if "웹훅 주소, Grafana 비밀번호, dev 게이트 키는 출력하지 않는다" "$([ "$(has "$out" "$tok")" = 0 ] && [ "$(has "$out" "$gpw")" = 0 ] && [ "$(has "$out" "$gate")" = 0 ] && echo 1 || echo 0)"
  out2="$(digest --dry-run --tls-connect tls-sim-short)" && rc=0 || rc=$?
  ok_if "인증서가 5일 남았으면 주의(14일 미만)로 보이고 주의 건수가 줄에 나온다" "$([ "$rc" = 0 ] && [ "$(has "$out2" '| 인증서(prod) | ⚠️ | 만료까지 5일')" = 1 ] && [ "$(has "$out2" '주의 ')" = 1 ] && echo 1 || echo 0)"
  # 백업 검증이 실패했다고 쓰면 요약에 주의로 나온다
  sed -i 's/^fit_backup_last_verify_ok .*/fit_backup_last_verify_ok 0/' "$T/textfile/fit_backup.prom"
  ok_if "백업 복원 검증이 실패하면 요약에 주의로 나온다" "$(wait_for 90 digest_has '| 백업 복원 검증 | ⚠️ | 마지막 검증 실패' && echo 1 || echo 0)"
  sed -i 's/^fit_backup_last_verify_ok .*/fit_backup_last_verify_ok 1/' "$T/textfile/fit_backup.prom"
  # 한 번도 백업하지 않았으면(지표 값 0) "20748일 전"이 아니라 한 번도 없다고 적는다
  caddy_ts="$(sed -n 's/^fit_backup_last_success_timestamp_seconds{kind="caddy"} //p' "$T/textfile/fit_backup.prom")"
  sed -i 's/^\(fit_backup_last_success_timestamp_seconds{kind="caddy"}\) .*/\1 0/' "$T/textfile/fit_backup.prom"
  ok_if "백업을 한 번도 안 한 종류는 '아직 성공한 적이 없다'로 주의에 나온다" "$(wait_for 90 digest_has '| 백업 caddy | ⚠️ | 아직 성공한 적이 없다' && echo 1 || echo 0)"
  sed -i "s/^\(fit_backup_last_success_timestamp_seconds{kind=\"caddy\"}\) .*/\1 $caddy_ts/" "$T/textfile/fit_backup.prom"
  # 실제로 올린다
  out="$(digest)" && rc=0 || rc=$?
  ok_if "올리면 종료 코드 0이고 main 수신자에 도착한다" "$([ "$rc" = 0 ] && wait_for 30 sink_has "/hook/$tok" "일일 점검" && echo 1 || echo 0)"
  out="$(sink_body "/hook/$tok" "일일 점검")"
  ok_if "메시지는 Mattermost 수신 웹훅 형식({\"text\": ...})이고 제목이 있다" "$([ "$(has "$out" '{"text":')" = 1 ] && [ "$(has "$out" '#### Fit Dining 일일 점검')" = 1 ] && echo 1 || echo 0)"
  # 실패 경로
  out="$(digest --prom http://nonexistent.invalid:9090)" && rc=0 || rc=$?
  ok_if "Prometheus에 닿지 못하면 그 사실을 올리고 종료 코드 1이다" "$([ "$rc" = 1 ] && wait_for 30 sink_has "/hook/$tok" "Prometheus에서 값을 읽지 못했다" && echo 1 || echo 0)"
  out="$(digest --obs-env /digest/none.env)" && rc=0 || rc=$?
  ok_if "웹훅 주소를 읽지 못하면 거부한다" "$([ "$rc" = 1 ] && [ "$(has "$out" 'MATTERMOST_WEBHOOK_URL을 읽지 못했다')" = 1 ] && echo 1 || echo 0)"
  out="$(digest --obs-env /digest/obs-bad.env)" && rc=0 || rc=$?
  ok_if "웹훅에 보내지 못하면 종료 코드 1이고 주소는 출력하지 않는다" "$([ "$rc" = 1 ] && [ "$(has "$out" '웹훅으로 보내지 못했다')" = 1 ] && [ "$(has "$out" 'unreachable')" = 0 ] && echo 1 || echo 0)"
}

run_install_checks() {
  echo "--- 설치(A의 일일 점검 요약)"
  local H="$PROJECT-host" M=/usr/local/lib/fit/obs
  docker rm -f "$H" >/dev/null 2>&1 || true
  docker run -d --name "$H" -v "$W:/repo:ro" ubuntu:24.04 sleep infinity >/dev/null
  hx() { docker exec "$H" bash -c "$1" 2>&1; } # 컨테이너 안에서 root로 실행한다
  hx 'groupadd docker' >/dev/null
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/obs/install.sh')" && rc=0 || rc=$?
  ok_if "install.sh가 성공한다" "$(is "$rc" 0)"
  ok_if "첫 실행은 변경을 알리고 웹훅이 비어 있으면 타이머를 켜지 않는다고 알린다" "$([ "$(has "$out" '변경:')" = 1 ] && [ "$(has "$out" '타이머는 켜지 않았다')" = 1 ] && echo 1 || echo 0)"
  ok_if "obs.env는 예제에서 만들어지고 640 root:docker다" "$(is "$(hx "stat -c '%a %U:%G' /etc/fit/obs.env")" '640 root:docker')"
  ok_if "점검 요약 스크립트 사본은 755 root:root다" "$(is "$(hx "stat -c '%a %U:%G' $M/daily-digest.py")" '755 root:root')"
  ok_if "코드 사본은 root 외에는 쓸 수 없다" "$(is "$(hx "find $M -perm /022 | wc -l")" 0)"
  ok_if "유닛 파일 2개가 설치됐고 저장소와 같다" "$(is "$(hx "ls /etc/systemd/system | grep -c '^fit-daily-digest'; for f in /repo/infra/obs/conf/systemd/*; do cmp -s \$f /etc/systemd/system/\$(basename \$f) || echo diff; done" | tr '\n' ' ')" '2 ')"
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/obs/install.sh')"
  ok_if "두 번째 실행은 변경이 없다" "$(has "$out" '변경 0건')"
  hx "sed -i 's|^MATTERMOST_WEBHOOK_URL=.*|MATTERMOST_WEBHOOK_URL=http://mm.example.test/hooks/x|' /etc/fit/obs.env" >/dev/null
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/obs/install.sh')"
  ok_if "웹훅을 채우면 타이머 안내가 사라지고 채운 값은 덮어쓰지 않는다" "$([ "$(has "$out" '타이머는 켜지 않았다')" = 0 ] && [ "$(has "$(hx 'grep ^MATTERMOST /etc/fit/obs.env')" 'mm.example.test')" = 1 ] && echo 1 || echo 0)"
  out="$(hx "su -s /bin/bash nobody -c 'bash /repo/infra/obs/install.sh'")" && rc=0 || rc=$?
  ok_if "root가 아니면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'root로 실행한다')" = 1 ] && echo 1 || echo 0)"
  hx "echo '# 누가 고쳤다' >> $M/daily-digest.py" >/dev/null
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/obs/install.sh')"
  ok_if "사본을 손으로 고쳐도 다시 실행하면 저장소와 같게 되돌린다" "$([ "$(has "$out" "변경: $M/daily-digest.py")" = 1 ] && [ "$(hx "cmp /repo/infra/obs/daily-digest.py $M/daily-digest.py && echo same")" = same ] && echo 1 || echo 0)"
  ok_if "ExecStart가 가리키는 스크립트가 사본에 있다" "$(is "$(hx "p=\$(sed -n 's/^ExecStart=[^ ]* \\([^ ]*\\)\$/\\1/p' /etc/systemd/system/fit-daily-digest.service); test -f \"\$p\" && echo yes")" yes)"
  docker rm -f "$H" >/dev/null
  echo "--- systemd 유닛 문법(systemd-analyze)"
  out="$(tar -C infra/obs/conf/systemd -cf - . | docker run --rm -i ubuntu:24.04 bash -c '
set -e
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends systemd >/dev/null
tar -x -C /etc/systemd/system
chmod 644 /etc/systemd/system/*
mkdir -p /usr/local/lib/fit/obs
printf "#!/bin/sh\n" >/usr/local/lib/fit/obs/daily-digest.py
printf "[Service]\nExecStart=/bin/true\n" >/etc/systemd/system/docker.service
[ -x /usr/bin/python3 ] || { printf "#!/bin/sh\n" >/usr/bin/python3; chmod +x /usr/bin/python3; }
systemd-analyze calendar "$(sed -n "s/^OnCalendar=//p" /etc/systemd/system/fit-daily-digest.timer)" >/dev/null
echo "calendar OK"
cd /etc/systemd/system
verify_out="$(systemd-analyze verify fit-daily-digest.service fit-daily-digest.timer 2>&1)" || { echo "$verify_out"; echo "verify FAIL"; exit 1; }
echo "$verify_out" | grep -v "^$" || true
echo "verify OK"
' 2>&1)" && rc=0 || rc=$?
  ok_if "systemd-analyze가 OnCalendar 표현을 해석한다" "$(has "$out" 'calendar OK')"
  ok_if "systemd-analyze verify가 서비스와 타이머를 오류 없이 읽는다" "$([ "$rc" = 0 ] && [ "$(has "$out" 'verify OK')" = 1 ] && [ "$(grep -ci -e 'failed' -e 'error' <<<"$out")" = 0 ] && echo 1 || echo 0)"
}

run_hygiene_checks() {
  echo "--- 비밀 값 노출"
  local tok_main tok_dev pw leaked=0 svc
  tok_main="$(sed -n 's/^webhook-main=//p' "$T/tokens")"
  tok_dev="$(sed -n 's/^webhook-dev=//p' "$T/tokens")"
  pw="$(sed -n 's/^GRAFANA_ADMIN_PASSWORD=//p' "$T/obs.env")"
  for svc in obs-init prometheus alertmanager grafana node-exporter cadvisor blackbox postgres-exporter opensearch-exporter dozzle; do
    if docker logs "$(cid "$svc")" 2>&1 | grep -q -e "$tok_main" -e "$tok_dev" -e "$pw" -e "$(sed -n 's/^FIT_MONITOR_PASSWORD=//p' "$T/obs.env")"; then
      leaked=1
      echo "FAIL  $svc 로그에 비밀 값이 있다"
    fi
  done
  ok_if "어느 컨테이너 로그에도 웹훅 주소, Grafana·모니터링 비밀번호가 없다" "$(is "$leaked" 0)"
  ok_if "Prometheus 설정 API에 웹훅 주소가 없다(파일로만 읽는다)" "$([ "$(has "$(inside prometheus 'http://localhost:9090/api/v1/status/config')" "$tok_main")" = 0 ] && echo 1 || echo 0)"
}

run() {
  local section
  local -a sections=("$@")
  if [ "${#sections[@]}" = 0 ]; then sections=(stack init scrape rules alert grafana digest install hygiene); fi
  set +e
  for section in "${sections[@]}"; do "run_${section}_checks"; done
  set -e
  if [ "$FAILED" -gt 0 ]; then
    printf '\n%d개 점검 실패\n' "$FAILED"
    return 1
  fi
  printf '\n관측 스택 시험 통과\n'
}

case "${1:-}" in
  up) up ;;
  run) shift && run "$@" ;;
  down) down ;;
  *)
    echo "사용: bash infra/obs/test/test-obs.sh up | run [구역...] | down" >&2
    exit 2
    ;;
esac
