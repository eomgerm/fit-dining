#!/usr/bin/env bash
# 배포 전 점검(설계 6.4절 1단계). 읽기만 하고 아무것도 바꾸지 않는다. 점검마다 PASS, FAIL, SKIP만 출력하고 값은 찍지 않는다.
#   bash infra/deploy/preflight.sh <prod|dev> <sha>              # 배포 전
#   bash infra/deploy/preflight.sh <prod|dev> - --rollback       # 롤백 전(이미지·다운그레이드·마이그레이션 검사는 생략)
# 하나라도 FAIL이면 종료 코드 1이다. 임계값은 환경변수로 바꾼다: FIT_MIN_DISK_GB(5), FIT_MIN_MEM_MB(prod 2560, dev 512),
# 현재 여유 메모리를 직접 줄 때 FIT_MEM_AVAILABLE_MB, 마이그레이션 전 덤프 스크립트 FIT_PREDEPLOY_DUMP,
# 파일 권한 점검을 건너뛸 때 FIT_SKIP_PERM=1(권한 비트가 없는 NTFS의 시험용. 서버에서는 쓰지 않는다).
# 필수 키 표의 위치는 FIT_ENV_CONTRACT(기본 docs/infra/contracts/env.md. 시험이 바꾼다). 읽지 못하면 env 점검이 실패한다.
set -uo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENVN="${1:-}"
SHA="${2:-}"
ROLLBACK=0
if [ "${3:-}" = "--rollback" ]; then ROLLBACK=1; fi
valid_env "$ENVN" || {
  echo "사용: bash infra/deploy/preflight.sh <prod|dev> <sha> [--rollback]" >&2
  exit 2
}

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }
succeeds() { if "$@" >/dev/null 2>&1; then echo 1; else echo 0; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 계약 표(docs/infra/contracts/env.md)에서 그룹의 필수 키를 한 줄에 하나씩 뽑는다. 파일이 없으면 awk가 실패해 빈 목록이 되고,
# 호출하는 쪽(check_env_file)이 빈 목록을 실패로 본다(빈 목록으로 점검이 통과하는 가짜 PASS를 막는다. 저장소 일부만 복사한 서버에서 실제로 났다)
CONTRACT="${FIT_ENV_CONTRACT:-$ROOT_DIR/docs/infra/contracts/env.md}"
required_keys() {
  awk -F'|' -v g="$1" '
    $2 ~ /^ *`[A-Z][A-Z0-9_]*` *$/ {
      k = $2; gsub(/[ `]/, "", k)
      flag = $4; gsub(/ /, "", flag)
      n = split($3, a, ",")
      for (i = 1; i <= n; i++) { x = a[i]; gsub(/ /, "", x); if (x == g && flag == "O") print k }
    }' "$CONTRACT"
}

check_env_file() { # check_env_file 파일 그룹
  local f="$1" group="$2" name PY
  name="$(basename "$f")"
  if [ ! -f "$f" ]; then
    fail "$name: 파일이 없다"
    return
  fi
  if [ "${FIT_SKIP_PERM:-0}" = 1 ]; then
    skip "$name: 파일 권한 (FIT_SKIP_PERM=1, NTFS에는 권한 비트가 없는 시험용)"
  else
    ok_if "$name: 다른 사용자가 읽을 수 없다" "$(succeeds mode_is_private "$f")"
  fi
  ok_if "$name: APP_ENV가 $ENVN이다" "$(succeeds grep -qx "APP_ENV=$ENVN" "$f")"
  ok_if "$name: 자리표시자(REPLACE_ME)가 남아 있지 않다" "$([ "$(grep -c 'REPLACE_ME' "$f")" = 0 ] && echo 1 || echo 0)"
  # 그룹의 필수 키는 하나 이상이다. 못 읽었거나 비어 있으면 점검이 의미가 없으니 실패한다
  if ! required_keys "$group" >"$TMP/required.$group" 2>/dev/null || [ ! -s "$TMP/required.$group" ]; then
    fail "$name: 계약 문서(${CONTRACT#"$ROOT_DIR"/})에서 그룹 $group의 필수 키를 읽지 못했다(파일이 있는지, 키 표 형식이 그대로인지 확인한다)"
    return
  fi
  if PY="$(find_python)"; then
    ok_if "$name: 형식과 필수 키(그룹 $group)가 맞다" \
      "$(succeeds "$PY" "$(native_path "$ROOT_DIR/infra/ci/check_env_files.py")" "$(native_path "$f")" --required "$(native_path "$TMP/required.$group")")"
  else
    skip "$name: 형식과 필수 키 (python 3.9 이상 없음)"
  fi
}

echo "-- 환경 파일"
check_env_file "$ENV_DIR/$ENVN.env" app
check_env_file "$ENV_DIR/fe-$ENVN.env" fe
# FE 서버가 BE를 부르는 주소는 이 환경의 엣지 내부 리스너여야 한다. 같은 망의 컨테이너는 어느 환경의 리스너에도 닿으므로 환경이 섞이지 않게 여기서 막는다
want_port=8081
if [ "$ENVN" = dev ]; then want_port=8082; fi
be_url="$(sed -n 's/^BE_INTERNAL_URL=//p' "$ENV_DIR/fe-$ENVN.env" 2>/dev/null | head -n 1)"
ok_if "fe-$ENVN.env: BE_INTERNAL_URL이 이 환경의 엣지 내부 리스너(http://caddy:$want_port)다" "$([ "$be_url" = "http://caddy:$want_port" ] && echo 1 || echo 0)"
if [ "$ROLLBACK" = 0 ]; then check_env_file "$ENV_DIR/migrate-$ENVN.env" migrate; fi

echo "-- Docker와 compose"
ok_if "docker가 응답한다" "$(succeeds docker info)"
STATE_FOR_CONFIG="$(state_file "$ENVN")"
if [ ! -f "$STATE_FOR_CONFIG" ]; then
  : >"$TMP/empty.env"
  STATE_FOR_CONFIG="$TMP/empty.env"
fi
ok_if "compose 설정이 올바르다(config -q)" \
  "$(succeeds docker compose -p "fit-app-$ENVN" -f "$(app_compose_file)" --env-file "$(native_path "$STATE_FOR_CONFIG")" --profile "$ENVN" config -q)"
net_prod="${FIT_NET_PROD:-net-prod}" net_dev="${FIT_NET_DEV:-net-dev}" net_data="${FIT_NET_DATA:-net-data}"
net_env="$net_prod"
if [ "$ENVN" = dev ]; then net_env="$net_dev"; fi
ok_if "공유 망이 있다($ENVN 망과 데이터 망)" "$(succeeds docker network inspect "$net_env" "$net_data")"
ok_if "엣지(caddy)가 돌고 있다(배포가 이 컨테이너로 서비스를 점검한다)" "$([ -n "$(caddy_container)" ] && echo 1 || echo 0)"

echo "-- 자원"
min_disk="${FIT_MIN_DISK_GB:-5}"
mkdir -p "$STATE_DIR" 2>/dev/null || true
free_gb=$(($(df -Pk "$STATE_DIR" | awk 'NR == 2 { print $4 }') / 1024 / 1024))
ok_if "디스크 여유가 ${min_disk}GB 이상이다" "$([ "$free_gb" -ge "$min_disk" ] && echo 1 || echo 0)"
min_mem="${FIT_MIN_MEM_MB:-512}"
if [ "$ENVN" = prod ]; then min_mem="${FIT_MIN_MEM_MB:-2560}"; fi
mem_mb="${FIT_MEM_AVAILABLE_MB:-}"
if [ -z "$mem_mb" ]; then mem_mb="$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null)"; fi
if [ -z "$mem_mb" ]; then
  skip "메모리 여유 (MemAvailable을 읽을 수 없다)"
else
  ok_if "메모리 여유가 ${min_mem}MB 이상이다(겹침 배포에 필요한 양)" "$([ "$mem_mb" -ge "$min_mem" ] && echo 1 || echo 0)"
fi

if [ "$ROLLBACK" = 0 ]; then
  echo "-- 이미지와 커밋"
  [ -n "$SHA" ] || {
    echo "SHA가 필요하다" >&2
    exit 2
  }
  ok_if "이미지 $BE_IMAGE:$SHA 가 있다" "$(succeeds docker image inspect "$BE_IMAGE:$SHA")"
  ok_if "이미지 $FE_IMAGE:$SHA 가 있다" "$(succeeds docker image inspect "$FE_IMAGE:$SHA")"
  ok_if "저장소에 커밋 $SHA 가 있다" "$(succeeds git -C "$REPO_DIR" rev-parse --verify -q "$SHA^{commit}")"
  cur="$(state_get "$ENVN" DEPLOYED_SHA none)"
  if [ "$cur" = none ]; then
    skip "다운그레이드 가드 (아직 배포한 적이 없다)"
  else
    # 얕은 clone이면 현재 배포된 커밋을 먼저 가져온다(실패해도 아래 판정이 막는다)
    git -C "$REPO_DIR" cat-file -e "$cur^{commit}" 2>/dev/null || git -C "$REPO_DIR" fetch --quiet origin "$cur" 2>/dev/null || true
    ok_if "다운그레이드가 아니다(현재 $cur 의 후손이거나 같은 커밋)" "$(succeeds git -C "$REPO_DIR" merge-base --is-ancestor "$cur" "$SHA")"
  fi
  if migrations_changed "$cur" "$SHA"; then
    if [ "$ENVN" = prod ]; then
      dump="${FIT_PREDEPLOY_DUMP:-$ROOT_DIR/infra/backup/pg-backup.sh}"
      ok_if "마이그레이션이 있어 사전 덤프 스크립트가 필요하다(있다)" "$([ -x "$dump" ] && echo 1 || echo 0)"
    else
      pass "마이그레이션이 있다(dev는 사전 덤프 없이 실행한다)"
    fi
  else
    pass "마이그레이션 변경이 없다"
  fi
fi

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d개 점검 실패\n' "$FAILED"
  exit 1
fi
printf '\n배포 사전 점검 통과\n'
