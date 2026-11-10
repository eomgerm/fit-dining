#!/usr/bin/env bash
# 덤프를 임시 Postgres 컨테이너에 복원해 쓸 수 있는지 확인한다(설계 8절 1번). 평문 덤프(pg_dump -Fc 결과)를 받는다.
#   bash infra/backup/verify-dump.sh <덤프 파일> [--expect-tables N | --allow-empty] [--sql '<조회문>']
# 복원은 --exit-on-error라 한 건이라도 실패하면 실패다. 복원된 public 테이블 수가 --expect-tables와 같아야 한다.
# 둘 다 주지 않으면 1개 이상이어야 하고, --allow-empty는 테이블이 없어도 통과시킨다(BE가 아직 마이그레이션하기 전의 빈 DB용).
# --sql은 복원된 DB에서 조회문을 돌려 결과를 sql_result=<값> 줄로 낸다(예: --sql 'SELECT count(*) FROM flyway_schema_history').
# 임시 컨테이너는 망이 없고(--network none) 데이터를 메모리(tmpfs)에 둔다. 끝나면 지운다. 성공하면 마지막 줄에 restore_seconds=<초>를 낸다.
# 덤프는 컨테이너 안으로 표준 입력으로 흘려 넣는다(호스트 경로를 마운트하지 않으므로 Docker 소켓만 있으면 어디서든 돈다).
set -euo pipefail
# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DUMP="${1:-}"
shift || true
EXPECT=""
ALLOW_EMPTY=0
SQL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sql)
      SQL="${2:-}"
      shift 2
      ;;
    --expect-tables)
      EXPECT="${2:-}"
      shift 2
      ;;
    --allow-empty)
      ALLOW_EMPTY=1
      shift
      ;;
    *)
      echo "사용: bash infra/backup/verify-dump.sh <덤프 파일> [--expect-tables N | --allow-empty] [--sql '<조회문>']" >&2
      exit 2
      ;;
  esac
done
[ -n "$DUMP" ] && [ -s "$DUMP" ] || die "덤프 파일이 없거나 비었다: $DUMP"
case "$EXPECT" in *[!0-9]*) die "--expect-tables에는 숫자를 준다" ;; esac

# 임시 DB 이미지는 데이터 스택이 쓰는 이미지와 같아야 한다(pgvector 확장이 있어야 복원된다)
pg_image() {
  if [ -n "${FIT_PG_IMAGE:-}" ]; then
    printf '%s' "$FIT_PG_IMAGE"
    return
  fi
  sed -n 's/^[[:space:]]*image:[[:space:]]*\(pgvector\/[^[:space:]]*\).*/\1/p' "$ROOT_DIR/infra/data/compose.data.yml" | head -n 1
}
IMAGE="$(pg_image)"
[ -n "$IMAGE" ] || die "compose.data.yml에서 Postgres 이미지를 찾지 못했다"

NAME="fit-verify-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

START="$(date +%s)"
docker run -d --name "$NAME" --network none --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=verify -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" \
  -c fsync=off -c synchronous_commit=off -c full_page_writes=off >/dev/null

# 공식 이미지는 초기화용 임시 서버(소켓만 연다)를 띄웠다가 다시 시작한다. TCP(127.0.0.1)가 열리면 최종 서버다
limit=$((START + 120))
until docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres -q >/dev/null 2>&1; do
  [ "$(date +%s)" -lt "$limit" ] || die "임시 Postgres가 준비되지 않았다"
  sleep 1
done

# 덤프에 들어 있는 소유자와 권한이 복원되도록 role 이름만 만들어 둔다(비밀번호는 필요 없다)
docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -qAt \
  -c 'CREATE ROLE fit_migrator' -c 'CREATE ROLE fit_prod_app' -c 'CREATE ROLE fit_dev_app' -c 'CREATE ROLE fit_prod_ai' -c 'CREATE ROLE fit_dev_ai' -c 'CREATE ROLE fit_prod_ro' >/dev/null
docker exec "$NAME" createdb -U postgres fit_verify

if ! err="$(docker exec -i "$NAME" pg_restore -U postgres -d fit_verify --exit-on-error <"$DUMP" 2>&1)"; then
  printf '%s\n' "$err" | tail -n 5 >&2
  die "pg_restore에 실패했다"
fi

tables="$(docker exec "$NAME" psql -U postgres -d fit_verify -qAt -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
if [ -n "$EXPECT" ]; then
  [ "$tables" = "$EXPECT" ] || die "복원된 테이블 수($tables)가 기대값($EXPECT)과 다르다"
elif [ "$ALLOW_EMPTY" != 1 ]; then
  [ "$tables" -ge 1 ] || die "복원된 테이블이 없다(빈 DB면 --allow-empty)"
fi
log "복원 검증 통과(public 테이블 $tables개)"
if [ -n "$SQL" ]; then
  result="$(docker exec "$NAME" psql -U postgres -d fit_verify -v ON_ERROR_STOP=1 -qAt -c "$SQL")" || die "조회문이 실패했다"
  echo "sql_result=$result"
fi
echo "restore_seconds=$(($(date +%s) - START))"
