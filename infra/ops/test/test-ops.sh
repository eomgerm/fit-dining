#!/usr/bin/env bash
# 서버 B의 감시 구성을 노트북에서 시험한다(설계 10.5절). 실제 Prometheus, Alertmanager, blackbox, node-exporter를 띄우고
# 가짜 A(Caddy: 내부 CA 인증서, /healthz, basic auth가 걸린 /_ops), 웹훅 대역, 포트 감사 대상으로 A를 밖에서 보는 프로브와 알림이 Mattermost 형식으로 도착하는 데까지 확인한다.
#   bash infra/ops/test/test-ops.sh up [구역...]   # 가짜 A, 웹훅 대역, B의 감시 스택을 띄운다
#   bash infra/ops/test/test-ops.sh run [구역...]  # 시나리오를 돌린다. 구역: stack init probes alert vault ports install hygiene
#   bash infra/ops/test/test-ops.sh down           # 시험이 만든 것을 모두 지운다
# 필요한 것: docker compose(2.24 이상), python 3.9 이상. install 구역의 유닛 문법 점검은 apt로 systemd를 받으므로 인터넷이 필요하고 수십 초 걸린다.
# 시험용 사본: 규칙의 for는 0s로, Alertmanager의 group_wait·group_interval·repeat_interval은 짧게 바꾼다(식과 라우팅은 같다). 시험용 값은 매번 무작위다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
# Windows의 파이썬은 콘솔 코드 페이지(cp949)로 출력해 한글이 깨지므로 UTF-8로 고정한다
export PYTHONUTF8=1
W="$(pwd -W 2>/dev/null || pwd)"
T="$W/.tmp-opstest"
PROJECT=fit-opstest
NET=fit-opstest-net
# shellcheck source=infra/ci/tool-images.sh
. infra/ci/tool-images.sh
# shellcheck source=infra/deploy/lib.sh
. infra/deploy/lib.sh

export FIT_OPSTEST_DIR="$T" FIT_OPSTEST_NET="$NET"

dc() { docker compose -p "$PROJECT" -f "$W/infra/ops/compose.ops.yml" -f "$W/infra/ops/test/compose.test.yml" --env-file "$T/ops.env" "$@"; }
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
PY="$(find_python)"

sidecar() { # sidecar 이름 별칭 [docker run 인자...]: 시험 망에 붙인 컨테이너
  local name="$1" alias="$2"
  shift 2
  docker run -d --name "$PROJECT-$name" --network "$NET" --network-alias "$alias" "$@" >/dev/null
}
# 지정한 포트를 여는 TCP 수신기. network에는 시험 망 또는 container:이름(다른 컨테이너와 같은 네트워크 이름공간)을 준다
listener() { # listener 이름 network 별칭 포트...
  local name="$1" net="$2" alias="$3" ports="" p
  shift 3
  for p in "$@"; do ports="$ports,$p"; done
  local code="import socketserver as s,threading
s.ThreadingTCPServer.allow_reuse_address=True
H=type('H',(s.BaseRequestHandler,),{'handle':lambda self:None})
for p in [${ports#,}]:
    threading.Thread(target=s.ThreadingTCPServer(('0.0.0.0',p),H).serve_forever,daemon=True).start()
threading.Event().wait()"
  if [ -n "$alias" ]; then
    docker run -d --name "$PROJECT-$name" --network "$net" --network-alias "$alias" "$PYTHON_IMAGE" python -c "$code" >/dev/null
  else
    docker run -d --name "$PROJECT-$name" --network "$net" "$PYTHON_IMAGE" python -c "$code" >/dev/null
  fi
}
# Prometheus가 time()으로 보는 시각(컨테이너의 시계). PC가 절전에서 깨어난 직후처럼 Docker의 시계가 호스트와 어긋나도 시험이 흔들리지 않게 이것을 쓴다
vm_now() {
  local n
  n="$(docker exec "$(cid prometheus-b)" date +%s 2>/dev/null | tr -d '\r\n')"
  printf '%s' "${n:-$(date +%s)}"
}
vault_metrics() { # vault_metrics 기준시각 [pg를 마지막으로 받은 시각]: 금고가 쓰는 fit_vault.prom과 같은 이름·형식의 지표(1D vault-ingest.sh)
  local now="$1" pg="${2:-$1}" f="$T/metrics/fit_vault.prom"
  printf 'fit_vault_last_received_timestamp_seconds{kind="pg"} %s\nfit_vault_last_received_timestamp_seconds{kind="photos"} %s\nfit_vault_last_received_timestamp_seconds{kind="caddy"} %s\nfit_vault_quarantined_files 0\nfit_vault_ingest_failures_total 0\nfit_vault_ingest_last_run_timestamp_seconds %s\nfit_vault_last_restore_check_timestamp_seconds %s\n' \
    "$pg" "$now" "$now" "$now" "$now" >"$f.part"
  mv "$f.part" "$f"
}

up() {
  down >/dev/null 2>&1 || true
  mkdir -p "$T/metrics" "$T/rules" "$T/caddy"
  docker network create "$NET" >/dev/null
  local tok pw hash
  tok="$(hex 12)"
  pw="$(hex 12)"
  printf 'webhook=%s\npassword=%s\n' "$tok" "$pw" >"$T/tokens"
  {
    echo "PROD_HOST=a-prod.test"
    echo "DEV_HOST=a-dev.test"
    echo "OPS_BASIC_AUTH_USER=opsuser"
    echo "OPS_BASIC_AUTH_PASSWORD=$pw"
    echo "MATTERMOST_WEBHOOK_URL=http://webhook-sink:18099/hook/$tok"
  } >"$T/ops.env"
  # 시험 사본: for를 0s로, Alertmanager 대기와 반복 간격을 짧게(이미 울린 알림도 곧 다시 보낸다)
  for f in infra/ops/prometheus/rules/*.yml; do sed 's/^\( *\)for: .*/\1for: 0s/' "$f" >"$T/rules/$(basename "$f")"; done
  sed -e 's/group_wait: .*/group_wait: 1s/' -e 's/group_interval: .*/group_interval: 5s/' -e 's/repeat_interval: .*/repeat_interval: 30s/' infra/ops/alertmanager/alertmanager.yml >"$T/alertmanager.yml"
  # 가짜 A: prod와 dev 호스트 이름을 모두 받는 Caddy. 인증서는 내부 CA가 발급하고(12시간짜리라 만료 임박 알림이 울린다), /_ops는 basic auth다
  hash="$(docker run --rm "$CADDY_IMAGE" caddy hash-password --plaintext "$pw" | tr -d '\r\n')"
  cat >"$T/caddy/Caddyfile" <<EOF
{
	local_certs
	skip_install_trust
}
a-prod.test, a-dev.test {
	tls internal
	handle /_ops/* {
		basic_auth {
			opsuser $hash
		}
		respond "ok" 200
	}
	handle /healthz {
		respond "ok" 200
	}
	handle {
		respond "fe" 200
	}
}
EOF
  sidecar a-sim a-prod.test --network-alias a-dev.test -v "$T/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE"
  sidecar webhook-sink webhook-sink -v "$W/infra/obs/test/webhook-sink.py:/sink.py:ro" -v "$T:/out" "$PYTHON_IMAGE" python /sink.py 18099 /out/sink.log
  : >"$T/sink.log"
  vault_metrics "$(date +%s)"
  dc up -d --wait --wait-timeout 300
  echo "B 시험 환경이 떴다(프로젝트 $PROJECT)"
}

down() {
  dc down -v --remove-orphans >/dev/null 2>&1 || docker compose -p "$PROJECT" down -v --remove-orphans >/dev/null 2>&1 || true
  docker compose -p "$PROJECT-up" down -v --remove-orphans >/dev/null 2>&1 || true
  local c
  for c in a-sim webhook-sink a-ports a-ports-extra host; do docker rm -f "$PROJECT-$c" >/dev/null 2>&1 || true; done
  docker network rm "$NET" >/dev/null 2>&1 || true
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
nonzero() { if [ "$1" != 0 ]; then echo 1; else echo 0; fi; }
out=""
rc=0

cid() { docker ps -a -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n 1; }
inside() { docker exec "$(cid "$1")" wget -qO- "$2" 2>/dev/null; } # 서비스 컨테이너 안에서 URL을 읽는다
urlenc() { "$PY" -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1"; }
prom() { inside prometheus-b "http://localhost:9090/api/v1/query?query=$(urlenc "$1")"; }
pval() { prom "$1" | "$PY" -c 'import json,sys; r=json.load(sys.stdin)["data"]["result"]; print(r[0]["value"][1] if r else "")' 2>/dev/null || true; }
pcount() { prom "$1" | "$PY" -c 'import json,sys; print(len(json.load(sys.stdin)["data"]["result"]))' 2>/dev/null || echo 0; }
wait_for() { # wait_for 제한초 명령... : 명령이 성공할 때까지 기다린다
  local limit=$(($(date +%s) + $1))
  shift
  until "$@" >/dev/null 2>&1; do
    [ "$(date +%s)" -lt "$limit" ] || return 1
    sleep 3
  done
}
sink_count() { # sink_count 경로접두사 포함할문자열...: 모든 문자열이 들어 있는 메시지 수
  "$PY" - "$T/sink.log" "$@" <<'PYEOF'
import json, sys
path, prefix, needles = sys.argv[1], sys.argv[2], sys.argv[3:]
n = 0
for line in open(path, encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    rec = json.loads(line)
    if rec["path"].startswith(prefix) and all(x in rec["body"] for x in needles):
        n += 1
print(n)
PYEOF
}
sink_has() { [ "$(sink_count "$@")" -ge 1 ]; }
sink_body() { # sink_body 경로접두사 포함할문자열...: 마지막으로 받은 메시지의 body
  "$PY" - "$T/sink.log" "$@" <<'PYEOF'
import json, sys
path, prefix, needles = sys.argv[1], sys.argv[2], sys.argv[3:]
last = ""
for line in open(path, encoding="utf-8"):
    line = line.strip()
    if line:
        rec = json.loads(line)
        if rec["path"].startswith(prefix) and all(x in rec["body"] for x in needles):
            last = rec["body"]
print(last)
PYEOF
}
tok() { sed -n "s/^$1=//p" "$T/tokens"; }
# 알림 이름으로 보는 도착 확인. 같은 알림이 둘 이상이면 제목이 [FIRING:2]처럼 되므로 개수는 보지 않는다
fired() { sink_has "/hook/$(tok webhook)" '[FIRING:' "] $1 ("; }
resolved() { sink_has "/hook/$(tok webhook)" "[RESOLVED] $1 ("; }
fired_body() { sink_body "/hook/$(tok webhook)" '[FIRING:' "] $1 ("; }
pval_is() { [ "$(pval "$1")" = "$2" ]; } # pval_is 식 기대값: wait_for에 넘기려고 호출할 때마다 다시 질의한다
run_audit() { # run_audit 모드 대상 [포트 목록]: 포트 감사를 컨테이너에서 돌려 지표 파일을 시험 디렉터리에 쓴다
  docker run --rm --network "$NET" -v "$W/infra/ops/port-audit.py:/pa.py:ro" -v "$T/metrics:/out" "$PYTHON_IMAGE" python /pa.py --target "$2" --mode "$1" --out /out ${3:+--expected "$3"} 2>&1
}

run_stack_checks() {
  echo "--- 구성"
  # up 직후에는 첫 수집이 끝나기 전일 수 있다. 수집 대상 12개(B 자신 4, A 프로브 8)가 모두 up이 될 때까지 기다린다
  wait_for 90 pval_is 'count(up == 1)' 12 || true
  out="$(FIT_SKIP=systemd FIT_OPS_PROJECT=$PROJECT bash infra/ops/verify-ops.sh 2>&1)" && rc=0 || rc=$?
  ok_if "verify-ops.sh가 모두 통과한다" "$(is "$rc" 0)"
  local ports
  ports="$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}} {{.Ports}}' | tr -d '\r')"
  ok_if "호스트에 게시한 포트는 prometheus-b와 alertmanager-b의 127.0.0.1뿐이다" \
    "$([ "$(grep -c '127.0.0.1:' <<<"$ports")" = 2 ] && [ "$(grep -c '0.0.0.0:' <<<"$ports")" = 0 ] && echo 1 || echo 0)"
  ok_if "blackbox와 node-exporter는 호스트에 게시하지 않는다" "$([ "$(grep -E 'blackbox|node-exporter' <<<"$ports" | grep -c -- '->')" = 0 ] && echo 1 || echo 0)"
  local svc limit
  for svc in prometheus-b:167772160 alertmanager-b:67108864 blackbox:67108864 node-exporter:67108864 ops-init:33554432; do
    limit="$(docker inspect -f '{{.HostConfig.Memory}}' "$(cid "${svc%%:*}")" | tr -d '\r\n')"
    ok_if "${svc%%:*}의 메모리 한도가 ${svc##*:}바이트다" "$(is "$limit" "${svc##*:}")"
  done
  out="$(inside prometheus-b 'http://localhost:9090/api/v1/status/flags')"
  ok_if "Prometheus 보존이 7일, 2GB다(화면에는 1w, 2GiB로 보인다)" "$([ "$(has "$out" '"storage.tsdb.retention.time":"1w"')" = 1 ] && [ "$(has "$out" '"storage.tsdb.retention.size":"2GiB"')" = 1 ] && echo 1 || echo 0)"
  ok_if "Prometheus의 관리 API(/-/quit, /-/reload)는 꺼져 있다" "$([ "$(has "$out" '"web.enable-lifecycle":"false"')" = 1 ] && echo 1 || echo 0)"
  # 감시 체계가 빠지면 점검이 실패한다
  docker stop "$(cid alertmanager-b)" >/dev/null
  out="$(FIT_SKIP=systemd FIT_OPS_PROJECT=$PROJECT bash infra/ops/verify-ops.sh 2>&1)" && rc=0 || rc=$?
  ok_if "alertmanager-b를 멈추면 verify-ops.sh가 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'FAIL  alertmanager-b')" = 1 ] && echo 1 || echo 0)"
  docker start "$(cid alertmanager-b)" >/dev/null
  ok_if "다시 켜면 verify-ops.sh가 통과한다" "$(wait_for 90 env FIT_SKIP=systemd FIT_OPS_PROJECT=$PROJECT bash infra/ops/verify-ops.sh && echo 1 || echo 0)"
}

run_init_checks() {
  echo "--- 설정 만들기(ops-init)"
  mkdir -p "$T/gen"
  local good=(PROD_HOST=a.example.test DEV_HOST=dev.example.test OPS_BASIC_AUTH_USER=opsuser OPS_BASIC_AUTH_PASSWORD=ops-test-password-aaaaaaaa MATTERMOST_WEBHOOK_URL=https://mm.example.test/hooks/a)
  initrun() { # initrun NAME=값...: ops-init과 같은 조건(네트워크 없음)으로 render.py를 돌린다. 같은 이름이 뒤에 또 있으면 뒤의 값이 이긴다
    local envs=() e
    for e in "$@"; do envs+=(-e "$e"); done
    docker run --rm --network none -e GENERATED_DIR=/g -v "$T/gen:/g" -v "$W/infra/ops/render.py:/render.py:ro" -v "$W/infra/ops/blackbox/blackbox.yml:/blackbox.yml:ro" "${envs[@]}" "$PYTHON_IMAGE" python /render.py 2>&1
  }
  rm -rf "${T:?}/gen"/*
  out="$(initrun "${good[@]}")" && rc=0 || rc=$?
  ok_if "올바른 값이면 대상 파일, blackbox 설정, 비밀 파일 2개를 만든다" "$([ "$rc" = 0 ] && [ -f "$T/gen/targets/a-probes.yml" ] && [ -f "$T/gen/blackbox.yml" ] && [ -f "$T/gen/secrets/mattermost_url" ] && [ -f "$T/gen/secrets/ops_password" ] && echo 1 || echo 0)"
  ok_if "프로브 대상이 8개다" "$(is "$(grep -c '^- targets' "$T/gen/targets/a-probes.yml")" 8)"
  ok_if "대상 파일에 prod와 dev 호스트가 들어간다" "$([ "$(has "$(cat "$T/gen/targets/a-probes.yml")" 'a.example.test:443')" = 1 ] && [ "$(has "$(cat "$T/gen/targets/a-probes.yml")" 'dev.example.test:443')" = 1 ] && echo 1 || echo 0)"
  ok_if "blackbox 설정에 /_ops 사용자 이름이 들어가고 자리 표시는 남지 않는다" "$([ "$(has "$(cat "$T/gen/blackbox.yml")" 'username: "opsuser"')" = 1 ] && [ "$(has "$(cat "$T/gen/blackbox.yml")" '@@')" = 0 ] && echo 1 || echo 0)"
  ok_if "운영 값에서는 인증서 검증을 끄지 않는다(insecure_skip_verify: true가 없다)" "$(is "$(grep -c 'insecure_skip_verify: true' "$T/gen/blackbox.yml")" 0)"
  ok_if "만든 내용에 웹훅 주소와 비밀번호를 출력하지 않는다" "$([ "$(has "$out" 'mm.example.test')" = 0 ] && [ "$(has "$out" 'ops-test-password-aaaaaaaa')" = 0 ] && echo 1 || echo 0)"
  out="$(initrun "${good[@]}" PROBE_INSECURE_TLS=1)" && rc=0 || rc=$?
  ok_if "PROBE_INSECURE_TLS=1이면(시험 전용) 인증서 검증을 끈다" "$([ "$rc" = 0 ] && [ "$(grep -c 'insecure_skip_verify: false' "$T/gen/blackbox.yml")" = 0 ] && echo 1 || echo 0)"
  local name
  for name in PROD_HOST DEV_HOST OPS_BASIC_AUTH_USER OPS_BASIC_AUTH_PASSWORD MATTERMOST_WEBHOOK_URL; do
    local args=() e
    for e in "${good[@]}"; do case "$e" in "$name="*) ;; *) args+=("$e") ;; esac; done
    out="$(initrun "${args[@]}")" && rc=0 || rc=$?
    ok_if "$name가 없으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" "$name")" = 1 ] && echo 1 || echo 0)"
  done
  out="$(initrun "${good[@]}" PROD_HOST=REPLACE_ME)" && rc=0 || rc=$?
  ok_if "자리표시자(REPLACE_ME)가 남아 있으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" REPLACE_ME)" = 1 ] && echo 1 || echo 0)"
  out="$(initrun "${good[@]}" 'PROD_HOST=a;b')" && rc=0 || rc=$?
  ok_if "호스트 이름에 이상한 문자가 있으면 거부한다" "$(nonzero "$rc")"
  out="$(initrun "${good[@]}" OPS_BASIC_AUTH_PASSWORD=short)" && rc=0 || rc=$?
  ok_if "짧은 비밀번호는 거부한다" "$(nonzero "$rc")"
  out="$(initrun "${good[@]}" 'OPS_BASIC_AUTH_USER=a b')" && rc=0 || rc=$?
  ok_if "사용자 이름에 공백이 있으면 거부한다" "$(nonzero "$rc")"
  out="$(initrun "${good[@]}" MATTERMOST_WEBHOOK_URL=ftp://x.test/a)" && rc=0 || rc=$?
  ok_if "http(s)가 아닌 웹훅 주소는 거부한다" "$(nonzero "$rc")"
  c="$(cid ops-init)"
  ok_if "ops-init은 네트워크 없이 읽기 전용으로 돈다" "$([ "$(docker inspect -f '{{.HostConfig.NetworkMode}} {{.HostConfig.ReadonlyRootfs}}' "$c" | tr -d '\r')" = 'none true' ] && echo 1 || echo 0)"
  ok_if "ops-init은 성공으로 끝났다" "$(is "$(docker inspect -f '{{.State.ExitCode}}' "$c" | tr -d '\r\n')" 0)"
}

run_probes_checks() {
  echo "--- 밖에서 본 A(프로브)"
  local p
  for p in a-healthz a-fe a-tcp-80 a-tcp-443 a-tls-prod a-tls-dev a-prometheus a-alertmanager; do
    ok_if "프로브 $p가 성공한다" "$(wait_for 90 pval_is "probe_success{probe=\"$p\"}" 1 && echo 1 || echo 0)"
  done
  ok_if "인증서 만료까지 남은 시간이 읽힌다(prod 12시간 안팎, 7일 미만)" \
    "$([ "$(pcount 'probe_ssl_earliest_cert_expiry{probe="a-tls-prod"} - time() > 0 < 604800')" = 1 ] && [ "$(pcount 'probe_ssl_earliest_cert_expiry{probe="a-tls-dev"} - time() > 0 < 604800')" = 1 ] && echo 1 || echo 0)"
  # /_ops는 자격이 있어야 200이다. 같은 주소를 자격 없이(http_2xx 모듈) 부르면 실패한다
  out="$(inside prometheus-b 'http://blackbox:9115/probe?module=http_2xx&target=https%3A%2F%2Fa-prod.test%2F_ops%2Fprometheus%2Fhealthy')"
  ok_if "자격 없이 /_ops를 부르면 프로브가 실패한다(basic auth)" "$([ "$(has "$out" 'probe_success 0')" = 1 ] && echo 1 || echo 0)"
  out="$(inside prometheus-b 'http://blackbox:9115/probe?module=http_ops&target=https%3A%2F%2Fa-prod.test%2F_ops%2Fprometheus%2Fhealthy')"
  ok_if "자격(password_file)을 주면 같은 주소가 200이다" "$([ "$(has "$out" 'probe_success 1')" = 1 ] && echo 1 || echo 0)"
}

run_alert_checks() {
  echo "--- 알림이 Mattermost 형식으로 도착한다"
  local body
  : >"$T/sink.log" # 앞서 받은 메시지는 비운다. 울리고 있는 알림은 반복 간격(시험 30초)마다 다시 온다
  ok_if "내부 CA 인증서는 12시간짜리라 FitCertExpiringCritical이 main 수신자에 도착한다" "$(wait_for 150 fired FitCertExpiringCritical && echo 1 || echo 0)"
  body="$(fired_body FitCertExpiringCritical)"
  out="$body"
  ok_if "메시지가 Slack 형식이고 제목에 상태, 알림 이름, site/env가 있다([FIRING:1] ... (B/prod))" "$([ "$(has "$body" '"attachments"')" = 1 ] && [ "$(has "$body" '"color":"danger"')" = 1 ] && [ "$(has "$body" '(B/prod)')" = 1 ] && echo 1 || echo 0)"
  ok_if "본문에 요약과 런북 ID(RB-05)가 있다" "$([ "$(has "$body" '인증서가 7일 안에 만료된다')" = 1 ] && [ "$(has "$body" '런북: RB-05')" = 1 ] && echo 1 || echo 0)"
  # 가짜 A가 죽으면 밖에서 본 알림 네 가지가 울린다
  docker stop "$PROJECT-a-sim" >/dev/null
  for a in FitExternalDown FitPortUnreachable FitOpsWatcherDown FitTlsProbeFailed; do
    ok_if "A가 죽으면 $a가 도착한다" "$(wait_for 150 fired "$a" && echo 1 || echo 0)"
  done
  out="$(fired_body FitExternalDown)"
  ok_if "FitExternalDown은 critical이고 런북은 RB-02다" "$([ "$(has "$out" '"color":"danger"')" = 1 ] && [ "$(has "$out" '런북: RB-02')" = 1 ] && echo 1 || echo 0)"
  docker start "$PROJECT-a-sim" >/dev/null
  ok_if "A가 돌아오면 [RESOLVED] FitExternalDown이 온다" "$(wait_for 150 resolved FitExternalDown && echo 1 || echo 0)"
}

run_vault_checks() {
  echo "--- 금고 지표(textfile)가 알림까지 이어진다"
  local n
  vault_metrics "$(vm_now)"
  : >"$T/sink.log"
  ok_if "금고 지표가 정상이면 FitVault* 알림이 울리지 않는다" "$(wait_for 60 pval_is 'count(ALERTS{alertname=~"FitVault.*", alertstate="firing"})' '' && echo 1 || echo 0)"
  n="$(vm_now)"
  vault_metrics "$n" "$((n - 9 * 3600))"
  ok_if "Postgres 백업을 9시간째 못 받았다고 쓰면 FitVaultStale이 도착한다" "$(wait_for 150 fired FitVaultStale && echo 1 || echo 0)"
  out="$(fired_body FitVaultStale)"
  ok_if "그 메시지는 critical이고 런북은 RB-06이다" "$([ "$(has "$out" '"color":"danger"')" = 1 ] && [ "$(has "$out" '런북: RB-06')" = 1 ] && echo 1 || echo 0)"
  vault_metrics "$(vm_now)"
  ok_if "정상으로 되돌리면 [RESOLVED] FitVaultStale이 온다" "$(wait_for 150 resolved FitVaultStale && echo 1 || echo 0)"
  rm -f "$T/metrics/fit_vault.prom"
  ok_if "지표 파일이 사라지면 FitVaultMetricMissing(absent)이 도착한다" "$(wait_for 150 fired FitVaultMetricMissing && echo 1 || echo 0)"
  vault_metrics "$(vm_now)"
  ok_if "되살리면 해소 메시지가 온다(시험은 처음 상태로 돌아간다)" "$(wait_for 150 resolved FitVaultMetricMissing && echo 1 || echo 0)"
}

run_ports_checks() {
  echo "--- 포트 노출 감사"
  docker rm -f "$PROJECT-a-ports" "$PROJECT-a-ports-extra" >/dev/null 2>&1 || true
  rm -f "$T"/metrics/fit_portaudit_*.prom # 이 구역을 다시 돌려도 "한 번도 돌리지 않은" 상태에서 시작한다
  ok_if "감사를 한 번도 돌리지 않은 동안은 FitPortAuditMissing이 울린다" "$(wait_for 90 pval_is 'count(ALERTS{alertname="FitPortAuditMissing", alertstate="firing"})' 1 && echo 1 || echo 0)"
  listener a-ports "$NET" a-ports.test 22 80 443
  sleep 2
  out="$(run_audit quick a-ports.test)" && rc=0 || rc=$?
  ok_if "예상 포트(22, 80, 443)만 열려 있으면 quick 감사가 예상 밖 0개로 끝난다" "$([ "$rc" = 0 ] && [ "$(has "$out" '예상 밖 []')" = 1 ] && echo 1 || echo 0)"
  ok_if "지표 파일이 시험 지표 디렉터리에 만들어지고 읽을 수 있다(644)" "$([ -f "$T/metrics/fit_portaudit_quick.prom" ] && [ "$(has "$(cat "$T/metrics/fit_portaudit_quick.prom")" 'fit_portaudit_unexpected_ports{mode="quick"} 0')" = 1 ] && echo 1 || echo 0)"
  ok_if "첫 감사가 끝나면 FitPortAuditMissing이 해소된다" "$(wait_for 90 pval_is 'count(ALERTS{alertname="FitPortAuditMissing", alertstate="firing"})' '' && echo 1 || echo 0)"
  ok_if "Prometheus가 감사 지표를 읽는다(마지막 스캔 시각, 예상 밖 0개)" "$(wait_for 60 pval_is 'fit_portaudit_unexpected_ports{mode="quick"}' 0 && echo 1 || echo 0)"
  : >"$T/sink.log"
  listener a-ports-extra "container:$PROJECT-a-ports" "" 8080
  sleep 2
  out="$(run_audit quick a-ports.test)" && rc=0 || rc=$?
  ok_if "8080이 더 열리면 quick 감사가 예상 밖 [8080]을 찾고 종료 코드는 0이다" "$([ "$rc" = 0 ] && [ "$(has "$out" '예상 밖 [8080]')" = 1 ] && echo 1 || echo 0)"
  ok_if "지표에 port=8080이 라벨로 남는다" "$(has "$(cat "$T/metrics/fit_portaudit_quick.prom")" 'fit_portaudit_port_open{mode="quick",port="8080"} 1')"
  ok_if "FitPortExposed가 critical로 main 수신자에 도착한다" "$(wait_for 150 fired FitPortExposed && echo 1 || echo 0)"
  out="$(fired_body FitPortExposed)"
  ok_if "메시지에 예상 밖 열린 포트 1개와 런북 RB-01이 있다" "$([ "$(has "$out" '예상 밖 열린 포트 1개')" = 1 ] && [ "$(has "$out" '런북: RB-01')" = 1 ] && echo 1 || echo 0)"
  out="$(FIT_SKIP=systemd FIT_OPS_PROJECT=$PROJECT bash infra/ops/verify-ops.sh 2>&1)" && rc=0 || rc=$?
  ok_if "예상 밖 포트가 열려 있으면 verify-ops.sh가 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'FAIL  예상 밖에서 열린 포트가 있다')" = 1 ] && echo 1 || echo 0)"
  docker rm -f "$PROJECT-a-ports-extra" >/dev/null
  run_audit quick a-ports.test >/dev/null
  ok_if "포트를 닫고 다시 감사하면 해소 메시지가 온다" "$(wait_for 150 resolved FitPortExposed && echo 1 || echo 0)"
  # full 스캔은 1~65535 전체를 본다. quick이 보지 않는 높은 번호 포트를 찾는다
  listener a-ports-extra "container:$PROJECT-a-ports" "" 41234
  sleep 2
  run_audit quick a-ports.test >/dev/null
  ok_if "quick 스캔은 41234 같은 높은 번호 포트를 보지 않는다" "$(has "$(cat "$T/metrics/fit_portaudit_quick.prom")" 'fit_portaudit_unexpected_ports{mode="quick"} 0')"
  out="$(run_audit full a-ports.test)" && rc=0 || rc=$?
  ok_if "full 스캔은 41234를 예상 밖으로 찾는다" "$([ "$rc" = 0 ] && [ "$(has "$out" '예상 밖 [41234]')" = 1 ] && echo 1 || echo 0)"
  ok_if "full 지표는 mode=full 라벨로 따로 남는다" "$(has "$(cat "$T/metrics/fit_portaudit_full.prom")" 'fit_portaudit_port_open{mode="full",port="41234"} 1')"
  docker rm -f "$PROJECT-a-ports-extra" >/dev/null
  out="$(run_audit quick nonexistent.invalid)" && rc=0 || rc=$?
  ok_if "주소를 찾지 못하면 종료 코드 1로 실패하고 지표 파일을 건드리지 않는다" "$([ "$rc" = 1 ] && [ "$(has "$(cat "$T/metrics/fit_portaudit_quick.prom")" 'fit_portaudit_unexpected_ports{mode="quick"} 0')" = 1 ] && echo 1 || echo 0)"
  out="$(run_audit quick 'a;b')" && rc=0 || rc=$?
  ok_if "대상 이름에 이상한 문자가 있으면 거부한다" "$(is "$rc" 1)"
  ok_if "지표 파일을 쓰다 만 임시 파일(.part)이 남지 않는다" "$(is "$(find "$T/metrics" -name '*.part' | wc -l | tr -d ' ')" 0)"
  docker rm -f "$PROJECT-a-ports" >/dev/null
}

run_install_checks() {
  echo "--- 설치(B)"
  local H="$PROJECT-host" M=/usr/local/lib/fit/ops u
  docker rm -f "$H" >/dev/null 2>&1 || true
  docker run -d --name "$H" -v "$W:/repo:ro" ubuntu:24.04 sleep infinity >/dev/null
  hx() { docker exec "$H" bash -c "$1" 2>&1; } # 컨테이너 안에서 root로 실행한다
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/ops/install.sh')" && rc=0 || rc=$?
  ok_if "install.sh가 성공한다" "$(is "$rc" 0)"
  ok_if "첫 실행은 변경을 알리고 ops.env가 비어 있으면 타이머를 켜지 않는다고 알린다" "$([ "$(has "$out" '변경:')" = 1 ] && [ "$(has "$out" '타이머는 켜지 않았다')" = 1 ] && echo 1 || echo 0)"
  ok_if "ops.env는 예제에서 만들어지고 600 root:root다" "$(is "$(hx "stat -c '%a %U:%G' /etc/fit/ops.env")" '600 root:root')"
  ok_if "포트 감사 스크립트 사본은 755 root:root다" "$(is "$(hx "stat -c '%a %U:%G' $M/port-audit.py")" '755 root:root')"
  ok_if "코드 사본은 root 외에는 쓸 수 없다" "$(is "$(hx "find $M -perm /022 | wc -l")" 0)"
  ok_if "금고 지표 디렉터리가 755로 만들어진다" "$(is "$(hx "stat -c '%a %U:%G' /srv/vault/metrics")" '755 root:root')"
  ok_if "유닛 파일 4개가 설치됐다" "$(is "$(hx "ls /etc/systemd/system | grep -c '^fit-port-audit'")" 4)"
  ok_if "저장소의 유닛과 설치된 유닛이 같다" "$(is "$(hx "for f in /repo/infra/ops/conf/systemd/*; do cmp -s \$f /etc/systemd/system/\$(basename \$f) || echo diff; done | wc -l")" 0)"
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/ops/install.sh')"
  ok_if "두 번째 실행은 변경이 없다" "$(has "$out" '변경 0건')"
  hx "sed -i 's/^PROD_HOST=.*/PROD_HOST=a.example.test/' /etc/fit/ops.env" >/dev/null
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/ops/install.sh')"
  ok_if "ops.env의 PROD_HOST를 채우면 타이머를 켜라는 안내가 사라지고 채운 값은 덮어쓰지 않는다" "$([ "$(has "$out" '타이머는 켜지 않았다')" = 0 ] && [ "$(has "$(hx 'grep ^PROD_HOST /etc/fit/ops.env')" 'a.example.test')" = 1 ] && echo 1 || echo 0)"
  out="$(hx "su -s /bin/bash nobody -c 'bash /repo/infra/ops/install.sh'")" && rc=0 || rc=$?
  ok_if "root가 아니면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'root로 실행한다')" = 1 ] && echo 1 || echo 0)"
  hx "echo '# 누가 고쳤다' >> $M/port-audit.py" >/dev/null
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/ops/install.sh')"
  ok_if "사본을 손으로 고쳐도 다시 실행하면 저장소와 같게 되돌린다" "$([ "$(has "$out" "변경: $M/port-audit.py")" = 1 ] && [ "$(hx "cmp /repo/infra/ops/port-audit.py $M/port-audit.py && echo same")" = same ] && echo 1 || echo 0)"
  for u in infra/ops/conf/systemd/*.service; do
    ok_if "$(basename "$u"): ExecStart가 가리키는 스크립트가 사본에 있다" "$(is "$(hx "p=\$(sed -n 's/^ExecStart=[^ ]* \\([^ ]*\\) .*/\\1/p' /etc/systemd/system/$(basename "$u")); test -f \"\$p\" && echo yes")" yes)"
  done
  docker rm -f "$H" >/dev/null

  echo "--- 올리기(ops-up.sh)"
  # docker CLI 컨테이너가 호스트 데몬을 쓴다(파일 권한을 믿을 수 있는 Linux에서 돌리려는 것이다). compose 파일은 마운트 없는 작은 것을 쓴다
  out="$(docker run --rm -i -v //var/run/docker.sock:/var/run/docker.sock -v "$W:/repo:ro" -e IMG="$PYTHON_IMAGE" -e P="$PROJECT-up" "$DOCKER_CLI_IMAGE" sh -s 2>&1 <<'EOS'
apk add --no-cache -q bash >/dev/null
printf 'services:\n  probe:\n    image: %s\n    command: [python, -c, "import time; time.sleep(600)"]\n' "$IMG" >/tmp/c.yml
go() { FIT_ENV_DIR=/etc/fit FIT_OPS_PROJECT="$P" FIT_OPS_COMPOSE=/tmp/c.yml bash /repo/infra/ops/ops-up.sh; }
count() { docker ps -q --filter "label=com.docker.compose.project=$P" | wc -l | tr -d ' '; }
mkdir -p /etc/fit
go >/tmp/o 2>&1; echo "CASE noenv rc=$? $(cat /tmp/o | tr '\n' ' ')"
cp /repo/infra/ops/ops.env.example /etc/fit/ops.env; chmod 600 /etc/fit/ops.env
go >/tmp/o 2>&1; echo "CASE placeholder rc=$? $(cat /tmp/o | tr '\n' ' ')"
printf 'PROD_HOST=a.test\nDEV_HOST=d.test\nOPS_BASIC_AUTH_USER=u\nOPS_BASIC_AUTH_PASSWORD=ops-test-password-aaaaaaaa\nMATTERMOST_WEBHOOK_URL=http://x.test/h\n' >/etc/fit/ops.env
chmod 644 /etc/fit/ops.env
go >/tmp/o 2>&1; echo "CASE worldreadable rc=$? $(cat /tmp/o | tr '\n' ' ')"
chmod 600 /etc/fit/ops.env
go >/tmp/o 2>&1; echo "CASE up600 rc=$? count=$(count)"
go >/tmp/o 2>&1; echo "CASE again rc=$? count=$(count)"
chmod 640 /etc/fit/ops.env
go >/tmp/o 2>&1; echo "CASE up640 rc=$? count=$(count)"
docker compose -p "$P" -f /tmp/c.yml down -v --remove-orphans >/dev/null 2>&1
echo "CASE down count=$(count)"
EOS
)"
  ok_if "ops.env가 없으면 올리지 않는다" "$([ "$(has "$out" 'CASE noenv rc=1')" = 1 ] && echo 1 || echo 0)"
  ok_if "REPLACE_ME가 남아 있으면 올리지 않는다" "$([ "$(has "$out" 'CASE placeholder rc=1')" = 1 ] && [ "$(has "$out" 'REPLACE_ME')" = 1 ] && echo 1 || echo 0)"
  ok_if "ops.env를 다른 사용자가 읽을 수 있으면(644) 올리지 않는다" "$([ "$(has "$out" 'CASE worldreadable rc=1')" = 1 ] && [ "$(has "$out" '권한')" = 1 ] && echo 1 || echo 0)"
  ok_if "값이 모두 채워지고 권한이 600이면 compose를 올린다(컨테이너 하나)" "$(has "$out" 'CASE up600 rc=0 count=1')"
  ok_if "다시 실행해도 같은 결과다(컨테이너는 하나)" "$(has "$out" 'CASE again rc=0 count=1')"
  ok_if "권한 640(root:docker)도 받아들인다" "$(has "$out" 'CASE up640 rc=0 count=1')"
  ok_if "시험이 올린 컨테이너를 지웠다" "$(has "$out" 'CASE down count=0')"

  echo "--- systemd 유닛 문법(systemd-analyze)"
  # systemd가 있는 임시 컨테이너(저장소에는 없다)에 유닛 파일을 tar로 표준 입력에 넣어 문법을 본다. 설치에 수십 초 걸린다
  out="$(tar -C infra/ops/conf/systemd -cf - . | docker run --rm -i ubuntu:24.04 bash -c '
set -e
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends systemd >/dev/null
tar -x -C /etc/systemd/system
chmod 644 /etc/systemd/system/*
mkdir -p /usr/local/lib/fit/ops /etc/fit
printf "#!/bin/sh\n" >/usr/local/lib/fit/ops/port-audit.py
printf "PROD_HOST=a.example.test\n" >/etc/fit/ops.env
[ -x /usr/bin/python3 ] || { printf "#!/bin/sh\n" >/usr/bin/python3; chmod +x /usr/bin/python3; }
for t in /etc/systemd/system/*.timer; do
  systemd-analyze calendar "$(sed -n "s/^OnCalendar=//p" "$t")" >/dev/null
  echo "calendar OK $(basename "$t")"
done
cd /etc/systemd/system
verify_out="$(systemd-analyze verify fit-port-audit-quick.service fit-port-audit-quick.timer fit-port-audit-full.service fit-port-audit-full.timer 2>&1)" || { echo "$verify_out"; echo "verify FAIL"; exit 1; }
echo "$verify_out" | grep -v "^$" || true
echo "verify OK"
' 2>&1)" && rc=0 || rc=$?
  ok_if "systemd-analyze가 두 타이머의 OnCalendar 표현을 해석한다" "$(is "$(grep -c '^calendar OK' <<<"$out")" 2)"
  ok_if "systemd-analyze verify가 서비스와 타이머를 오류 없이 읽는다" "$([ "$rc" = 0 ] && [ "$(has "$out" 'verify OK')" = 1 ] && [ "$(grep -ci -e 'failed' -e 'error' <<<"$out")" = 0 ] && echo 1 || echo 0)"
}

run_hygiene_checks() {
  echo "--- 비밀 값 노출"
  local t pw leaked=0 svc
  t="$(tok webhook)"
  pw="$(tok password)"
  for svc in ops-init prometheus-b alertmanager-b blackbox node-exporter; do
    if docker logs "$(cid "$svc")" 2>&1 | grep -q -e "$t" -e "$pw"; then
      leaked=1
      echo "FAIL  $svc 로그에 비밀 값이 있다"
    fi
  done
  ok_if "어느 컨테이너 로그에도 웹훅 주소와 /_ops 비밀번호가 없다" "$(is "$leaked" 0)"
  ok_if "Prometheus 설정 API에 웹훅 주소와 비밀번호가 없다" "$([ "$(has "$(inside prometheus-b 'http://localhost:9090/api/v1/status/config')" "$t")" = 0 ] && [ "$(has "$(inside prometheus-b 'http://localhost:9090/api/v1/status/config')" "$pw")" = 0 ] && echo 1 || echo 0)"
  ok_if "blackbox 설정 화면에 비밀번호가 없다(파일로만 읽는다)" "$([ "$(has "$(inside prometheus-b 'http://blackbox:9115/config')" "$pw")" = 0 ] && echo 1 || echo 0)"
  ok_if "저장소 파일에 시험용 비밀 값이 남지 않았다" "$([ -z "$(git grep -l -e "$t" -e "$pw" -- . 2>/dev/null || true)" ] && echo 1 || echo 0)"
}

run() {
  local section
  local -a sections=("$@")
  if [ "${#sections[@]}" = 0 ]; then sections=(stack init probes alert vault ports install hygiene); fi
  set +e
  for section in "${sections[@]}"; do "run_${section}_checks"; done
  set -e
  if [ "$FAILED" -gt 0 ]; then
    printf '\n%d개 점검 실패\n' "$FAILED"
    return 1
  fi
  printf '\nB 감시 구성 시험 통과\n'
}

case "${1:-}" in
  up) up ;;
  run) shift && run "$@" ;;
  down) down ;;
  *)
    echo "사용: bash infra/ops/test/test-ops.sh up | run [구역...] | down" >&2
    exit 2
    ;;
esac
