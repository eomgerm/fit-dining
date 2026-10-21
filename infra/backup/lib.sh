# shellcheck shell=bash disable=SC2034
# infra/backup 스크립트가 함께 쓰는 함수다. 스크립트가 source한다(직접 실행하지 않는다). 설계 8절.
#
# 경로와 이름은 환경변수로 바꿀 수 있다(시험 환경이 쓴다). 서버에서는 기본값을 쓴다.
#   FIT_ENV_DIR(/etc/fit) FIT_BACKUP_ENV($FIT_ENV_DIR/backup.env) FIT_BACKUP_DIR(/srv/fit/backups) FIT_KEYS_DIR($FIT_ENV_DIR/keys)
#   FIT_AGE_RECIPIENTS($FIT_KEYS_DIR/age-recipients.txt) FIT_METRICS_DIR(/var/lib/fit/metrics) FIT_EDGE_PROJECT(fit-edge)
#   FIT_PREDEPLOY_DIR(FIT_BACKUP_DIR와 같은 부모의 predeploy, 기본 /srv/fit/predeploy)
# 데이터 스택 쪽 이름(FIT_DATA_PROJECT, FIT_NET_DATA, FIT_DATA_ENV)은 infra/data/lib.sh가 읽는다.

BACKUP_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/data/lib.sh
. "$BACKUP_LIB_DIR/../data/lib.sh"

BACKUP_ENV="${FIT_BACKUP_ENV:-$ENV_DIR/backup.env}"
BACKUP_DIR="${FIT_BACKUP_DIR:-/srv/fit/backups}"
# 마이그레이션 전 덤프는 배포 러너(docker 그룹)가 쓰므로 root 전용인 백업 디렉터리 밖에 둔다(/srv/fit/predeploy)
PREDEPLOY_DIR="${FIT_PREDEPLOY_DIR:-$(dirname "$BACKUP_DIR")/predeploy}"
KEYS_DIR="${FIT_KEYS_DIR:-$ENV_DIR/keys}"
RECIPIENTS="${FIT_AGE_RECIPIENTS:-$KEYS_DIR/age-recipients.txt}"
METRICS_DIR="${FIT_METRICS_DIR:-/var/lib/fit/metrics}"
EDGE_PROJECT="${FIT_EDGE_PROJECT:-fit-edge}"
KIND_PATTERN='(pg|photos|caddy)'

# backup.env의 선택 값을 읽는다. 없는 키는 기본값을 쓴다. BACKUP_VAULT_HOST만 push-vault.sh가 따로 요구한다
load_backup_env() {
  BACKUP_VAULT_HOST="" BACKUP_VAULT_PORT=22 BACKUP_KEEP_HOURS=48 BACKUP_KEEP_DAYS=14
  if [ -f "$BACKUP_ENV" ]; then read_env_file "$BACKUP_ENV"; fi
  case "$BACKUP_KEEP_HOURS$BACKUP_KEEP_DAYS$BACKUP_VAULT_PORT" in *[!0-9]*) die "backup.env의 숫자 값(BACKUP_KEEP_HOURS, BACKUP_KEEP_DAYS, BACKUP_VAULT_PORT)이 잘못됐다" ;; esac
}

# ---- 잠금 ---------------------------------------------------------------------
# 같은 이름의 작업이 겹쳐 돌지 않게 한다. flock이 없는 환경에서도 되도록 mkdir로 잠근다. 죽은 프로세스의 잠금은 치운다
LOCK_HELD=""
acquire_lock() { # acquire_lock 이름
  local dir="$BACKUP_DIR/state/$1.lock" pid
  mkdir -p "$BACKUP_DIR/state"
  if ! mkdir "$dir" 2>/dev/null; then
    pid="$(cat "$dir/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then die "$1 작업이 이미 돌고 있다(pid $pid)"; fi
    rm -rf "$dir"
    mkdir "$dir" || die "$1 잠금을 만들 수 없다"
  fi
  echo $$ >"$dir/pid"
  LOCK_HELD="$dir"
  trap 'release_lock' EXIT
}
release_lock() {
  if [ -n "$LOCK_HELD" ]; then rm -rf "$LOCK_HELD"; LOCK_HELD=""; fi
}

# ---- 이름과 시각 ----------------------------------------------------------------
# 백업 파일 이름은 <종류>-<UTC 시각>.<dump|tar>.age 이고 짝 파일 <같은 이름>.meta 가 있다. 예: pg-20261021T041500Z.dump.age
backup_ts() { date -u +%Y%m%dT%H%M%SZ; }
backup_name_ok() { [[ "$1" =~ ^${KIND_PATTERN}-[0-9]{8}T[0-9]{6}Z\.(dump|tar)\.age$ ]]; }

# name_epoch 이름 → 이름 속 UTC 시각의 epoch 초. 형식이 다르면 실패한다
name_epoch() {
  local ts
  [[ "$1" =~ -([0-9]{8})T([0-9]{6})Z\. ]] || return 1
  ts="${BASH_REMATCH[1]}${BASH_REMATCH[2]}"
  date -u -d "${ts:0:4}-${ts:4:2}-${ts:6:2} ${ts:8:2}:${ts:10:2}:${ts:12:2}" +%s
}

# 한국에는 일광절약시간이 없어 UTC+9 고정이다. 일 번호가 같으면 한국 시간으로 같은 날이다
kst_day() { echo $((($1 + 32400) / 86400)); }

# retention_delete 지금(epoch) 시간창(시간) 일수 < 이름 목록: 지울 이름만 한 줄씩 출력한다(설계 8절: 4시간 단위 48시간 + 일 단위 14일)
# 규칙: 시간창 안의 백업은 모두 둔다. 그보다 오래된 것은 한국 시간 기준 하루에 가장 늦은 1개만 두되 일수 안의 것만 둔다.
# 시간창 안에서 둔 백업이 있는 날은 그 백업이 그날의 1개다. 가장 최근 백업은 어떤 경우에도 지우지 않는다. 이름 형식이 다른 항목은 건드리지 않는다.
retention_delete() {
  local now="$1" hours="$2" days="$3" name ep first=1 d
  local -A seen=()
  local -a rows=()
  while IFS= read -r name; do
    backup_name_ok "$name" || continue
    ep="$(name_epoch "$name")" || continue
    rows+=("$ep $name")
  done
  [ "${#rows[@]}" -gt 0 ] || return 0
  while read -r ep name; do
    if [ "$first" = 1 ]; then
      first=0
      seen[$(kst_day "$ep")]=1
      continue
    fi
    d="$(kst_day "$ep")"
    if [ $((now - ep)) -lt $((hours * 3600)) ]; then
      seen[$d]=1
    elif [ $((now - ep)) -lt $((days * 86400)) ] && [ -z "${seen[$d]:-}" ]; then
      seen[$d]=1
    else
      echo "$name"
    fi
  done < <(printf '%s\n' "${rows[@]}" | sort -rn)
}

# prune_dir 디렉터리 종류: 보관 정책에 걸린 백업(.age와 짝 .meta)을 지운다
prune_dir() {
  local dir="$1" kind="$2" now name
  now="$(date +%s)"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    rm -f "$dir/$name" "$dir/$name.meta"
    log "보관 기간이 지나 지웠다: $kind/$name"
  done < <(
    for name in "$dir/$kind"-*.age; do
      name="${name##*/}"
      if backup_name_ok "$name"; then echo "$name"; fi
    done | retention_delete "$now" "$BACKUP_KEEP_HOURS" "$BACKUP_KEEP_DAYS"
  )
}

# ---- 암호화와 짝 파일 ----------------------------------------------------------------
require_recipients() {
  [ -s "$RECIPIENTS" ] || die "age 수신자 파일이 없다: $RECIPIENTS (수신자 2명의 공개키를 한 줄씩 넣는다)"
  [ "$(grep -c '^age1' "$RECIPIENTS")" -ge 1 ] || die "$RECIPIENTS에 age 공개키(age1...)가 없다"
  command -v age >/dev/null 2>&1 || die "age가 설치돼 있지 않다(apt install age)"
}
# age_encrypt 원본 대상: 수신자 전원이 풀 수 있게 암호화한다. 중간 파일을 거쳐 완성된 파일만 이름을 갖게 한다
age_encrypt() {
  age -R "$RECIPIENTS" -o "$2.part" "$1" && mv "$2.part" "$2"
}

# write_meta 파일(.age) 종류: sha256과 크기를 짝 파일(.meta)에 적는다. 금고(B)가 받은 파일을 이것과 대조한다
write_meta() {
  local f="$1" kind="$2" sum size
  sum="$(sha256sum "$f" | cut -d' ' -f1)"
  size="$(wc -c <"$f" | tr -d ' ')"
  printf 'name=%s\nkind=%s\nsha256=%s\nsize=%s\ncreated=%s\n' "$(basename "$f")" "$kind" "$sum" "$size" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$f.meta.part"
  mv "$f.meta.part" "$f.meta"
}
meta_get() { sed -n "s/^$2=//p" "$1" | head -n 1; }

# ---- 지표(Prometheus textfile 형식) ---------------------------------------------------
# 1E의 node_exporter textfile collector가 이 디렉터리를 읽는다. 쓰다 만 파일이 보이지 않게 이름을 바꿔 넣는다
write_atomic() { # write_atomic 대상 < 내용
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  cat >"$dest.part" && mv "$dest.part" "$dest"
}
state_get() { cat "$BACKUP_DIR/state/$1" 2>/dev/null || echo 0; }
state_set() { mkdir -p "$BACKUP_DIR/state" && printf '%s\n' "$2" >"$BACKUP_DIR/state/$1"; }

# render_backup_metrics: A의 백업 상태를 지표 파일로 쓴다. 상태 파일(state/)에서 매번 다시 만든다
render_backup_metrics() {
  local kind outbox
  outbox="$(find "$BACKUP_DIR/outbox" -maxdepth 1 -type f -name '*.age' 2>/dev/null | wc -l | tr -d ' ')"
  {
    echo '# HELP fit_backup_last_success_timestamp_seconds 마지막으로 백업이 성공한 시각(UTC epoch)'
    echo '# TYPE fit_backup_last_success_timestamp_seconds gauge'
    for kind in pg photos caddy; do echo "fit_backup_last_success_timestamp_seconds{kind=\"$kind\"} $(state_get "$kind.last_success")"; done
    echo '# HELP fit_backup_last_verify_timestamp_seconds 마지막 덤프 복원 검증 시각'
    echo '# TYPE fit_backup_last_verify_timestamp_seconds gauge'
    echo "fit_backup_last_verify_timestamp_seconds $(state_get pg.last_verify)"
    echo '# HELP fit_backup_last_verify_ok 마지막 덤프 복원 검증 결과(1 통과, 0 실패)'
    echo '# TYPE fit_backup_last_verify_ok gauge'
    echo "fit_backup_last_verify_ok $(state_get pg.last_verify_ok)"
    echo '# HELP fit_backup_last_push_timestamp_seconds 마지막으로 금고(B)에 보낸 시각'
    echo '# TYPE fit_backup_last_push_timestamp_seconds gauge'
    echo "fit_backup_last_push_timestamp_seconds $(state_get last_push)"
    echo '# HELP fit_backup_outbox_files 아직 금고로 보내지 못한 백업 파일 수'
    echo '# TYPE fit_backup_outbox_files gauge'
    echo "fit_backup_outbox_files $outbox"
  } | write_atomic "$METRICS_DIR/fit_backup.prom"
}
