#!/usr/bin/env bash
# 백업 스크립트를 노트북에서 시험한다(설계 10.5절). 서버 A와 B를 컨테이너 두 개로 흉내 내고(실제 sshd, rsync, rrsync, age),
# 실제 데이터 스택(infra/data/test/test-data.sh가 띄운다)의 Postgres와 Garage를 백업한다.
#   bash infra/backup/test/test-backup.sh up                 # 데이터 스택, 시험용 A·B 컨테이너, 망을 만든다
#   bash infra/backup/test/test-backup.sh run [구역...]       # 시나리오를 돌린다(구역을 주지 않으면 전부)
#   bash infra/backup/test/test-backup.sh down               # 시험이 만든 것을 모두 지운다
# 구역: retention units install trust pg predeploy files push ingest restore wrapper hygiene
# 필요한 것: docker compose(2.24 이상), GNU date(Git Bash 또는 Linux). 시험용 이름은 접두사 fit-backuptest로 시작한다.
# A 컨테이너는 Docker 소켓으로 호스트의 데몬을 쓴다(덤프와 복원 검증용 임시 컨테이너, 사진 읽기).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
W="$(pwd -W 2>/dev/null || pwd)"
T="$W/.tmp-backuptest"
DT="$W/.tmp-datatest"
PREFIX=fit-backuptest-
NET="${PREFIX}net"
A="${PREFIX}a"
B="${PREFIX}b"
IMAGE=fit-backuptest/node
EDGE_PROJECT="${PREFIX}edge"
M=/usr/local/lib/fit/repo/infra/backup

# 데이터 스택 쪽 이름(infra/data/test/test-data.sh와 같다). 호스트에서 쓰는 psql_admin, pg_as, s3run이 읽는다
export FIT_ENV_DIR="$DT/etc" FIT_DATA_ENV="$DT/etc/data.env" FIT_DATA_PROJECT=fit-datatest
export FIT_NET_PREFIX=fit-datatest- FIT_NET_DATA=fit-datatest-net-data FIT_NET_EDGE=fit-datatest-net-edge FIT_NET_DBACCESS=fit-datatest-net-dbaccess

hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

up() {
  down >/dev/null 2>&1 || true
  mkdir -p "$T"
  bash infra/data/test/test-data.sh up
  bash infra/data/init-data.sh
  docker build -q -t "$IMAGE" infra/backup/test/node >/dev/null
  docker network create "$NET" >/dev/null
  docker run -d --name "$B" --hostname "$B" --network "$NET" -v "$W:/repo:ro" "$IMAGE" \
    sh -c 'mkdir -p /run/sshd && ssh-keygen -A >/dev/null && exec /usr/sbin/sshd -D -e' >/dev/null
  docker run -d --name "$A" --hostname "$A" --network "$NET" \
    -v //var/run/docker.sock:/var/run/docker.sock -v "$W:/repo:ro" \
    -e FIT_DATA_PROJECT=fit-datatest -e FIT_NET_DATA=fit-datatest-net-data -e "FIT_EDGE_PROJECT=$EDGE_PROJECT" "$IMAGE" >/dev/null
  # A에는 data.env가 있다(실제 서버의 /etc/fit/data.env). B에는 1F bootstrap이 만드는 vault 계정과 디렉터리가 있다
  docker exec "$A" mkdir -p /etc/fit/keys
  docker exec "$A" chmod 700 /etc/fit/keys
  docker cp "$DT/etc/data.env" "$A:/etc/fit/data.env"
  docker exec "$B" sh -c "mkdir -p /etc/fit/keys && useradd --create-home --shell /bin/bash --password '*' vault \
    && install -d -m 700 -o vault -g vault /srv/vault/incoming && install -d -m 700 /srv/vault/store"
  echo "백업 시험 환경이 떴다(A=$A, B=$B)"
}

down() {
  docker rm -f "$A" "$B" >/dev/null 2>&1 || true
  docker volume rm "${EDGE_PROJECT}_caddy_data" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker image rm -f "$IMAGE" >/dev/null 2>&1 || true
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
nonzero() { if [ "$1" != 0 ]; then echo 1; else echo 0; fi; }
OUT_ALL=""
out=""
rc=0

# 호스트에서 데이터 스택을 다루는 함수(psql_admin, pg_as, s3run)
# shellcheck source=infra/data/lib.sh
. infra/data/lib.sh

# A와 B 안에서 명령을 돌린다. out, rc를 채우고 모든 출력을 OUT_ALL에 모은다
runa() { out="$(docker exec "$A" bash -c "$1" 2>&1)" && rc=0 || rc=$?; printf '%s\n' "$out" >>"$OUT_ALL"; }
runb() { out="$(docker exec "$B" bash -c "$1" 2>&1)" && rc=0 || rc=$?; printf '%s\n' "$out" >>"$OUT_ALL"; }
qa() { docker exec "$A" bash -c "$1" 2>/dev/null | tr -d '\r'; } # 값만 필요할 때(출력을 모으지 않는다)
qb() { docker exec "$B" bash -c "$1" 2>/dev/null | tr -d '\r'; }
metric() { # metric a|b 이름과레이블: 지표 파일에서 값을 뽑는다(# HELP 줄이 아니라 값 줄에서)
  local file=/var/lib/fit/metrics/fit_backup.prom text
  if [ "$1" = b ]; then file=/srv/vault/metrics/fit_vault.prom; fi
  text="$("q$1" "cat $file")"
  awk -v n="$2" 'index($0, n " ") == 1 { print $2; exit }' <<<"$text"
}
a_ip() { docker inspect -f "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" "$A" | tr -d '\r\n'; }

# 시험용 시각 도우미: ts_at <epoch> → 백업 이름에 쓰는 UTC 시각 문자열
ts_at() { date -u -d "@$1" +%Y%m%dT%H%M%SZ; }

run_retention_checks() {
  echo "--- 보관 정책(순수 함수)"
  local now d
  now="$(date -u -d '2026-10-21 12:00:00' +%s)"
  nm() { printf 'pg-%s.dump.age' "$(date -u -d "$1" +%Y%m%dT%H%M%SZ)"; }
  # 별도 프로세스에서 lib.sh를 읽어 함수만 시험한다. deleted 이름... : 지울 이름을 한 줄로 낸다
  deleted() {
    bash -c '. infra/backup/lib.sh; now="$1"; shift; printf "%s\n" "$@" | retention_delete "$now" 48 14 | sort | tr "\n" " "' _ "$now" "$@"
  }
  d="$(deleted "$(nm '2026-10-21 11:00:00')" "$(nm '2026-10-21 07:00:00')" "$(nm '2026-10-20 03:00:00')" "$(nm '2026-10-19 13:30:00')")"
  ok_if "시간창(48시간) 안의 백업은 모두 둔다" "$(is "$d" '')"
  d="$(deleted "$(nm '2026-10-19 11:00:00')" "$(nm '2026-10-19 08:00:00')" "$(nm '2026-10-21 11:00:00')")"
  ok_if "시간창 밖은 한국 시간으로 같은 날이면 가장 늦은 1개만 둔다" "$(is "$d" "$(nm '2026-10-19 08:00:00') ")"
  d="$(deleted "$(nm '2026-10-21 11:00:00')" "$(nm '2026-10-06 11:00:00')")"
  ok_if "14일보다 오래된 백업은 지운다" "$(is "$d" "$(nm '2026-10-06 11:00:00') ")"
  d="$(deleted "$(nm '2026-10-01 11:00:00')")"
  ok_if "가장 최근 백업은 오래됐어도 지우지 않는다" "$(is "$d" '')"
  d="$(deleted "$(nm '2026-10-10 14:30:00')" "$(nm '2026-10-10 15:30:00')" "$(nm '2026-10-10 16:30:00')")"
  ok_if "한국 시간 자정을 넘으면 다른 날로 센다(23:30과 00:30은 둘 다 남고 같은 날 01:30이 00:30을 대신한다)" "$(is "$d" "$(nm '2026-10-10 15:30:00') ")"
  d="$(deleted "$(nm '2026-10-21 11:00:00')" "$(nm '2026-10-19 13:00:00')" "$(nm '2026-10-19 11:00:00')")"
  ok_if "시간창 안에서 남긴 백업이 있는 날은 그것이 그날의 1개다" "$(is "$d" "$(nm '2026-10-19 11:00:00') ")"
  d="$(deleted 'readme.txt' "pg-notatime.dump.age" "$(nm '2026-10-21 11:00:00')" 'pg-20200101T000000Z.sql')"
  ok_if "이름 형식이 다른 항목은 건드리지 않는다" "$(is "$d" '')"
  d="$(deleted)"
  ok_if "목록이 비어 있으면 아무것도 지우지 않는다" "$(is "$d" '')"
  d="$(bash -c '. infra/backup/lib.sh; name_epoch "$1"' _ "$(nm '2026-10-21 11:00:00')")"
  ok_if "name_epoch가 이름의 UTC 시각을 epoch로 바꾼다" "$(is "$d" "$(date -u -d '2026-10-21 11:00:00' +%s)")"
}

run_units_checks() {
  echo "--- systemd 유닛 문법(systemd-analyze)"
  # systemd가 있는 임시 컨테이너(시험 이미지에는 없다)에 유닛 파일을 tar로 표준 입력에 넣어 문법을 본다. 설치에 수십 초 걸린다
  out="$(tar -C infra/backup/conf/systemd -cf - . | docker run --rm -i ubuntu:24.04 bash -c '
set -e
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends systemd >/dev/null
tar -x -C /etc/systemd/system
chmod 644 /etc/systemd/system/*
mkdir -p /usr/local/lib/fit/repo/infra/backup
for s in backup-run vault-ingest; do printf "#!/bin/sh\n" >"/usr/local/lib/fit/repo/infra/backup/$s.sh"; chmod +x "/usr/local/lib/fit/repo/infra/backup/$s.sh"; done
printf "[Service]\nExecStart=/bin/true\n" >/etc/systemd/system/docker.service
for t in /etc/systemd/system/*.timer; do
  systemd-analyze calendar "$(sed -n "s/^OnCalendar=//p" "$t")" >/dev/null
  echo "calendar OK $(basename "$t")"
done
cd /etc/systemd/system
verify_out="$(systemd-analyze verify fit-backup@pg.service fit-backup@photos.service fit-backup@caddy.service fit-backup-pg.timer fit-backup-photos.timer fit-backup-caddy.timer fit-vault-ingest.service fit-vault-ingest.timer 2>&1)" || { echo "$verify_out"; echo "verify FAIL"; exit 1; }
echo "$verify_out" | grep -v "^$" || true
echo "verify OK"
' 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "systemd-analyze가 모든 타이머의 OnCalendar 표현을 해석한다(4개)" "$(is "$(grep -c '^calendar OK' <<<"$out")" 4)"
  ok_if "systemd-analyze verify가 서비스와 타이머를 오류 없이 읽는다" "$([ "$rc" = 0 ] && [ "$(has "$out" 'verify OK')" = 1 ] && [ "$(grep -ci -e 'failed' -e 'error' <<<"$out")" = 0 ] && echo 1 || echo 0)"
}

run_install_checks() {
  echo "--- 설치(A, B)"
  local fp1 fp2 unit
  runa "FIT_SKIP=apt,systemd bash /repo/infra/backup/install.sh app"
  ok_if "A: install.sh app이 성공한다" "$(is "$rc" 0)"
  ok_if "A: 첫 실행은 변경을 알린다" "$(has "$out" '변경:')"
  ok_if "A: 백업 디렉터리는 root 전용이다(700)" "$(is "$(qa "stat -c '%a %U:%G' /srv/fit/backups")" '700 root:root')"
  ok_if "A: 마이그레이션 전 덤프 디렉터리는 docker 그룹이 쓴다(2770)" "$(is "$(qa "stat -c '%a %U:%G' /srv/fit/predeploy")" '2770 root:docker')"
  ok_if "A: backup.env는 640 root:docker다" "$(is "$(qa "stat -c '%a %U:%G' /etc/fit/backup.env")" '640 root:docker')"
  ok_if "A: 전송 키의 개인키는 600이다" "$(is "$(qa "stat -c '%a' /etc/fit/keys/vault_ed25519")" 600)"
  ok_if "A: 코드 사본에 백업 스크립트가 있다" "$(is "$(qa "test -f $M/pg-backup.sh && echo yes")" yes)"
  ok_if "A: 코드 사본에 시험 디렉터리가 없다" "$(is "$(qa "ls /usr/local/lib/fit/repo/infra/backup /usr/local/lib/fit/repo/infra/data | grep -c '^test$'")" 0)"
  ok_if "A: 코드 사본은 root 외에는 쓸 수 없다" "$(is "$(qa "find /usr/local/lib/fit/repo -perm /022 | wc -l")" 0)"
  ok_if "A: 코드 사본에 데이터 스택 정의와 도구 이미지 핀이 있다" "$(is "$(qa "test -f /usr/local/lib/fit/repo/infra/data/compose.data.yml && test -f /usr/local/lib/fit/repo/infra/ci/tool-images.sh && echo yes")" yes)"
  ok_if "A: 유닛 파일 4개가 설치됐다" "$(is "$(qa "ls /etc/systemd/system | grep -c '^fit-backup'")" 4)"
  runa "su runner -c 'touch /srv/fit/predeploy/probe && stat -c %G /srv/fit/predeploy/probe && rm /srv/fit/predeploy/probe'"
  ok_if "A: docker 그룹(배포 러너)은 사전 덤프 디렉터리에 쓰고 파일이 docker 그룹이 된다" "$([ "$rc" = 0 ] && [ "$(has "$out" docker)" = 1 ] && echo 1 || echo 0)"
  runa "su runner -c 'ls /srv/fit/backups'"
  ok_if "A: 러너는 백업 디렉터리를 보지 못한다" "$(nonzero "$rc")"
  fp1="$(qa "ssh-keygen -lf /etc/fit/keys/vault_ed25519.pub")"
  runa "FIT_SKIP=apt,systemd bash /repo/infra/backup/install.sh app"
  fp2="$(qa "ssh-keygen -lf /etc/fit/keys/vault_ed25519.pub")"
  ok_if "A: 두 번째 실행은 변경이 없다" "$(has "$out" '변경 0건')"
  ok_if "A: 두 번째 실행이 전송 키를 바꾸지 않는다" "$(is "$fp1" "$fp2")"
  runb "FIT_SKIP=apt,systemd bash /repo/infra/backup/install.sh ops"
  ok_if "B: install.sh ops가 성공한다" "$(is "$rc" 0)"
  ok_if "B: 상태 디렉터리는 root 전용이다(700)" "$(is "$(qb "stat -c '%a %U:%G' /srv/vault/state")" '700 root:root')"
  ok_if "B: 유닛 파일 2개가 설치됐다" "$(is "$(qb "ls /etc/systemd/system | grep -c '^fit-vault'")" 2)"
  runb "FIT_SKIP=apt,systemd bash /repo/infra/backup/install.sh ops"
  ok_if "B: 두 번째 실행은 변경이 없다" "$(has "$out" '변경 0건')"
  runa "FIT_SKIP=apt,systemd bash /repo/infra/backup/install.sh nonsense"
  ok_if "알 수 없는 인자는 거부한다" "$(is "$rc" 2)"
  # fit-backup* 유닛은 A에, fit-vault* 유닛은 B에 설치된다
  local who
  for unit in infra/backup/conf/systemd/*.service; do
    who=qa
    case "$(basename "$unit")" in fit-vault*) who=qb ;; esac
    ok_if "$(basename "$unit"): ExecStart가 코드 사본에 있는 스크립트다" \
      "$(is "$($who "p=\$(sed -n 's/^ExecStart=\\([^ ]*\\).*/\\1/p' /etc/systemd/system/$(basename "$unit")); test -x \"\$p\" && echo yes")" yes)"
  done
  for unit in infra/backup/conf/systemd/*.timer; do
    who=qa
    case "$(basename "$unit")" in fit-vault*) who=qb ;; esac
    ok_if "$(basename "$unit"): Unit=이 가리키는 서비스가 있다" \
      "$(is "$($who "u=\$(sed -n 's/^Unit=//p' /etc/systemd/system/$(basename "$unit")); [ -z \"\$u\" ] && echo yes || { t=\$(echo \"\$u\" | sed 's/@[^.]*\\./@./'); test -f /etc/systemd/system/\$t && echo yes; }")" yes)"
  done
}

run_trust_checks() {
  echo "--- 신뢰 설정(vault 키, 호스트 키)"
  local pub ip
  pub="$(qa "cat /etc/fit/keys/vault_ed25519.pub")"
  ip="$(a_ip)"
  runb "bash $M/vault-authorize.sh 'not a key' $ip"
  ok_if "B: 형식이 틀린 공개키는 거부한다" "$(nonzero "$rc")"
  runb "bash $M/vault-authorize.sh 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIH x' 'a;b'"
  ok_if "B: 형식이 틀린 IP는 거부한다" "$(nonzero "$rc")"
  runb "bash $M/vault-authorize.sh '$pub' $ip"
  ok_if "B: A의 키를 등록한다" "$(is "$rc" 0)"
  ok_if "B: authorized_keys는 쓰기 전용 rrsync와 restrict와 from으로 제한한다" \
    "$([ "$(qb "grep -c 'rrsync -wo -no-del /srv/vault/incoming\",restrict,from=\"$ip\" ssh-ed25519' /home/vault/.ssh/authorized_keys")" = 1 ] && echo 1 || echo 0)"
  ok_if "B: authorized_keys는 vault 소유 600이다" "$(is "$(qb "stat -c '%a %U' /home/vault/.ssh/authorized_keys")" '600 vault')"
  runb "bash $M/vault-authorize.sh '$pub' $ip"
  ok_if "B: 다시 실행해도 키는 한 줄뿐이다" "$(is "$(qb "wc -l < /home/vault/.ssh/authorized_keys")" 1)"
  runa "printf 'BACKUP_VAULT_HOST=%s\nBACKUP_VAULT_PORT=22\nBACKUP_KEEP_HOURS=48\nBACKUP_KEEP_DAYS=14\n' $B >/etc/fit/backup.env"
  runa "bash $M/install.sh pin-vault-host"
  ok_if "A: --yes 없이는 호스트 키를 등록하지 않는다" "$([ "$rc" = 0 ] && [ "$(qa 'test -s /etc/fit/keys/vault_known_hosts && echo yes')" != yes ] && echo 1 || echo 0)"
  ok_if "A: B의 호스트 키 지문을 보여 준다" "$(has "$out" SHA256)"
  ok_if "A: 보여 준 지문이 B의 실제 호스트 키 지문과 같다" \
    "$([ "$(has "$out" "$(qb "ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub" | awk '{print $2}')")" = 1 ] && echo 1 || echo 0)"
  runa "bash $M/install.sh pin-vault-host --yes"
  ok_if "A: --yes로 호스트 키를 등록한다" "$(is "$(qa 'stat -c %a /etc/fit/keys/vault_known_hosts')" 600)"
}

# 시험용 age 키 3개를 A에 만든다(1, 2번은 수신자, 3번은 수신자가 아니다). 개인키는 /root/ids에만 있고 서버 설정 경로에는 공개키만 둔다
make_age_keys() {
  qa "mkdir -p /root/ids && for i in 1 2 3; do [ -f /root/ids/id\$i.txt ] || age-keygen -o /root/ids/id\$i.txt >/dev/null 2>&1; done; true" >/dev/null
}

run_pg_checks() {
  echo "--- Postgres 백업"
  make_age_keys
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'CREATE TABLE IF NOT EXISTS t_backup_probe (id int, note text)' >/dev/null
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod "INSERT INTO t_backup_probe SELECT g, 'secret-note-' || g FROM generate_series(1, 3) g" >/dev/null
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'CREATE TABLE IF NOT EXISTS t_backup_two (id int)' >/dev/null
  local pub1 pub2 f sum size
  runa "rm -f /etc/fit/keys/age-recipients.txt; bash $M/pg-backup.sh scheduled"
  ok_if "수신자 파일이 없으면 백업하지 않는다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'age 수신자')" = 1 ] && echo 1 || echo 0)"
  ok_if "수신자가 없을 때 덤프나 임시 파일이 남지 않는다" "$(is "$(qa 'ls -A /srv/fit/backups/pg | wc -l')" 0)"
  pub1="$(qa "age-keygen -y /root/ids/id1.txt")"
  pub2="$(qa "age-keygen -y /root/ids/id2.txt")"
  runa "printf '# infra owner\n%s\n# backup owner\n%s\n' '$pub1' '$pub2' >/etc/fit/keys/age-recipients.txt"
  runa "bash $M/pg-backup.sh scheduled"
  ok_if "scheduled 백업이 성공한다" "$(is "$rc" 0)"
  ok_if "첫 백업은 복원 검증을 한다" "$(has "$out" '복원 검증 통과')"
  f="$(qa "ls /srv/fit/backups/pg | grep -E '^pg-[0-9]{8}T[0-9]{6}Z\\.dump\\.age\$' | head -n 1")"
  ok_if "pg-<UTC 시각>.dump.age 파일과 .meta가 생긴다" "$([ -n "$f" ] && [ "$(qa "test -f /srv/fit/backups/pg/$f.meta && echo yes")" = yes ] && echo 1 || echo 0)"
  ok_if "임시 평문 덤프가 남지 않는다" "$(is "$(qa "ls -A /srv/fit/backups/pg | grep -c -v '^pg-'")" 0)"
  ok_if "같은 파일이 outbox에도 있다(하드링크)" "$(is "$(qa "stat -c %h /srv/fit/backups/pg/$f")" 2)"
  sum="$(qa "sha256sum /srv/fit/backups/pg/$f | cut -d' ' -f1")"
  size="$(qa "wc -c < /srv/fit/backups/pg/$f | tr -d ' '")"
  ok_if ".meta의 sha256과 크기가 파일과 맞는다" "$([ "$(qa "sed -n 's/^sha256=//p' /srv/fit/backups/pg/$f.meta")" = "$sum" ] && [ "$(qa "sed -n 's/^size=//p' /srv/fit/backups/pg/$f.meta")" = "$size" ] && echo 1 || echo 0)"
  ok_if "암호화된 파일에서 테이블 이름이나 데이터가 보이지 않는다" "$(is "$(qa "grep -c -a -e t_backup_probe -e secret-note /srv/fit/backups/pg/$f")" 0)"
  runa "age -d -i /root/ids/id1.txt -o /tmp/d1.dump /srv/fit/backups/pg/$f && age -d -i /root/ids/id2.txt -o /tmp/d2.dump /srv/fit/backups/pg/$f && cmp /tmp/d1.dump /tmp/d2.dump"
  ok_if "수신자 2명이 각자 풀 수 있고 결과가 같다" "$(is "$rc" 0)"
  runa "age -d -i /root/ids/id3.txt -o /tmp/d3.dump /srv/fit/backups/pg/$f"
  ok_if "수신자가 아닌 키로는 풀 수 없다" "$(nonzero "$rc")"
  ok_if "복호화한 덤프의 목차에는 테이블 이름이 들어 있다(암호화 파일에서는 안 보이는 것과 대비된다)" "$([ "$(qa "grep -c -a t_backup_probe /tmp/d1.dump")" -ge 1 ] && echo 1 || echo 0)"
  runa "bash $M/verify-dump.sh /tmp/d1.dump --expect-tables 2 --sql 'SELECT count(*) FROM t_backup_probe'"
  ok_if "복원한 DB에서 원래 데이터 3행이 조회된다" "$([ "$rc" = 0 ] && [ "$(has "$out" 'sql_result=3')" = 1 ] && echo 1 || echo 0)"
  ok_if "복원 검증이 restore_seconds를 보고한다" "$(has "$out" 'restore_seconds=')"
  runa "bash $M/verify-dump.sh /tmp/d1.dump --expect-tables 5"
  ok_if "복원된 테이블 수가 기대와 다르면 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '기대값')" = 1 ] && echo 1 || echo 0)"
  runa "head -c 3000 /tmp/d1.dump >/tmp/trunc.dump && bash $M/verify-dump.sh /tmp/trunc.dump --expect-tables 2"
  ok_if "잘린 덤프는 검증에 실패한다" "$(nonzero "$rc")"
  runa "head -c 4000 /dev/urandom >/tmp/junk.dump && bash $M/verify-dump.sh /tmp/junk.dump --allow-empty"
  ok_if "덤프가 아닌 파일은 검증에 실패한다" "$(nonzero "$rc")"
  runa "bash $M/verify-dump.sh /tmp/does-not-exist.dump"
  ok_if "없는 파일은 거부한다" "$(nonzero "$rc")"
  ok_if "검증이 끝나면 임시 컨테이너가 남지 않는다" "$(is "$(docker ps -a --format '{{.Names}}' | grep -c '^fit-verify-')" 0)"
  ok_if "지표: 마지막 검증 결과가 통과(1)다" "$(is "$(metric a fit_backup_last_verify_ok)" 1)"
  ok_if "지표: pg 마지막 성공 시각이 기록된다" "$([ "$(metric a 'fit_backup_last_success_timestamp_seconds{kind="pg"}')" -gt 1000000000 ] && echo 1 || echo 0)"
  ok_if "지표: 보낼 파일 수가 1이다" "$(is "$(metric a fit_backup_outbox_files)" 1)"
  # 두 번째 실행은 검증 주기 안이라 복원 검증을 건너뛴다
  sleep 1
  runa "bash $M/pg-backup.sh scheduled"
  ok_if "검증 주기 안의 두 번째 백업은 복원 검증을 건너뛴다" "$([ "$rc" = 0 ] && [ "$(has "$out" '복원 검증 통과')" = 0 ] && echo 1 || echo 0)"
  ok_if "백업이 2개가 된다" "$(is "$(qa "ls /srv/fit/backups/pg | grep -c '\\.age\$'")" 2)"
  # 검증 실패: 임시 DB를 못 띄우게 해서 verify-dump가 실패하는 경우
  sleep 1
  runa "FIT_VERIFY_EVERY_HOURS=0 FIT_PG_IMAGE=fit-backuptest/does-not-exist:0 bash $M/pg-backup.sh scheduled"
  ok_if "검증에 실패하면 백업을 보내지 않고 실패로 끝낸다" "$([ "$rc" != 0 ] && [ "$(has "$out" '검증에 실패')" = 1 ] && echo 1 || echo 0)"
  ok_if "검증에 실패한 덤프는 failed-verify로 남고 .age는 늘지 않는다" \
    "$([ "$(qa "ls /srv/fit/backups/pg | grep -c '^failed-verify-'")" = 1 ] && [ "$(qa "ls /srv/fit/backups/pg | grep -c '\\.age\$'")" = 2 ] && echo 1 || echo 0)"
  ok_if "지표: 검증 결과가 실패(0)로 바뀐다" "$(is "$(metric a fit_backup_last_verify_ok)" 0)"
  ok_if "실패한 실행이 임시 파일이나 잠금을 남기지 않는다" "$([ "$(qa "ls -A /srv/fit/backups/pg | grep -c -e '^\\.tmp' -e '\\.part'")" = 0 ] && [ "$(qa 'ls /srv/fit/backups/state | grep -c lock')" = 0 ] && echo 1 || echo 0)"
  runa "rm -f /srv/fit/backups/pg/failed-verify-*; FIT_VERIFY_EVERY_HOURS=0 bash $M/pg-backup.sh scheduled"
  ok_if "다음 실행이 다시 검증해 통과하면 지표가 1로 돌아온다" "$([ "$rc" = 0 ] && [ "$(metric a fit_backup_last_verify_ok)" = 1 ] && echo 1 || echo 0)"
  # 잠금
  runa "mkdir -p /srv/fit/backups/state/pg.lock && echo 1 >/srv/fit/backups/state/pg.lock/pid && bash $M/pg-backup.sh scheduled"
  ok_if "같은 백업이 이미 돌고 있으면(살아 있는 pid) 시작하지 않는다" "$([ "$rc" != 0 ] && [ "$(has "$out" '이미 돌고')" = 1 ] && echo 1 || echo 0)"
  runa "echo 999999 >/srv/fit/backups/state/pg.lock/pid && bash $M/pg-backup.sh scheduled"
  ok_if "죽은 프로세스의 잠금은 치우고 진행한다" "$(is "$rc" 0)"
  # 보관 정책: 오래된 가짜 백업은 지워진다
  runa "cd /srv/fit/backups/pg && for d in '50 days ago' '51 days ago'; do n=pg-\$(date -u -d \"\$d\" +%Y%m%dT%H%M%SZ).dump.age; echo x >\$n; echo x >\$n.meta; done; ls | grep -c 'pg-.*[.]age\$'"
  local total_before="$out"
  ok_if "보관 정책 시험용 오래된 가짜 백업 2개를 더했다" "$([ "$total_before" -ge 5 ] && echo 1 || echo 0)"
  sleep 1
  runa "bash $M/pg-backup.sh scheduled"
  ok_if "다음 백업이 14일이 지난 백업과 짝 파일을 지운다" "$([ "$(qa "ls /srv/fit/backups/pg | grep -c -E '^pg-$(date -u -d '50 days ago' +%Y%m%d)T|^pg-$(date -u -d '51 days ago' +%Y%m%d)T'")" = 0 ] && echo 1 || echo 0)"
  ok_if "최근 백업은 남는다" "$([ "$(qa "ls /srv/fit/backups/pg | grep -c '\\.dump\\.age\$'")" -ge 3 ] && echo 1 || echo 0)"
}

run_predeploy_checks() {
  echo "--- 마이그레이션 전 덤프(predeploy)"
  local i
  runa "bash $M/pg-backup.sh predeploy prod abcdef1234567"
  ok_if "predeploy가 성공한다" "$(is "$rc" 0)"
  ok_if "predeploy-prod-<sha>.dump가 생긴다" "$(is "$(qa "test -s /srv/fit/predeploy/predeploy-prod-abcdef1234567.dump && echo yes")" yes)"
  ok_if "파일은 640이고 docker 그룹이다" "$(is "$(qa "stat -c '%a %G' /srv/fit/predeploy/predeploy-prod-abcdef1234567.dump")" '640 docker')"
  runa "docker exec -i \$(docker ps -q --filter label=com.docker.compose.project=fit-datatest --filter label=com.docker.compose.service=postgres) pg_restore -l </srv/fit/predeploy/predeploy-prod-abcdef1234567.dump | grep -c t_backup_probe"
  ok_if "덤프가 읽히고 prod 테이블이 들어 있다" "$([ "$rc" = 0 ] && [ "$out" -ge 1 ] && echo 1 || echo 0)"
  runa "bash $M/pg-backup.sh predeploy prod 'not a sha'"
  ok_if "sha 형식이 틀리면 거부한다" "$(nonzero "$rc")"
  runa "bash $M/pg-backup.sh predeploy staging abcdef1234567"
  ok_if "환경이 prod나 dev가 아니면 거부한다" "$(nonzero "$rc")"
  runa "bash $M/pg-backup.sh predeploy dev 1234567abcdef"
  ok_if "dev 환경은 fit_dev를 덤프한다" "$([ "$rc" = 0 ] && [ -n "$(qa "ls /srv/fit/predeploy | grep predeploy-dev-")" ] && echo 1 || echo 0)"
  for i in 1 2 3 4 5 6; do
    runa "bash $M/pg-backup.sh predeploy prod 000000${i}aaaa"
    sleep 1
  done
  ok_if "환경별 최근 5개만 남긴다" "$(is "$(qa "ls /srv/fit/predeploy | grep -c 'predeploy-prod-'")" 5)"
  ok_if "다른 환경의 덤프는 지우지 않는다" "$(is "$(qa "ls /srv/fit/predeploy | grep -c 'predeploy-dev-'")" 1)"
  ok_if "가장 최근 사전 덤프는 남아 있다" "$(is "$(qa "test -f /srv/fit/predeploy/predeploy-prod-0000006aaaa.dump && echo yes")" yes)"
  # 배포 스크립트의 preflight는 사전 덤프 스크립트의 실행 권한(-x)을 확인한다. git이 추적 중이면 인덱스의 모드가 100755여야 한다
  if git ls-files --error-unmatch infra/backup/pg-backup.sh >/dev/null 2>&1; then
    ok_if "pg-backup.sh가 git에 실행 권한(100755)으로 올라 있다(deploy의 preflight가 -x를 본다)" "$(is "$(git ls-files -s infra/backup/pg-backup.sh | cut -d' ' -f1)" 100755)"
  fi
}

run_files_checks() {
  echo "--- 사진과 Caddy 볼륨 백업"
  local f t
  s3run "$S3_PROD_ACCESS_KEY" "$S3_PROD_SECRET_KEY" put fit-prod-photos confirmed/a.jpg photo-bytes-A >/dev/null
  s3run "$S3_PROD_ACCESS_KEY" "$S3_PROD_SECRET_KEY" put fit-prod-photos confirmed/b.jpg photo-bytes-B >/dev/null
  s3run "$S3_DEV_ACCESS_KEY" "$S3_DEV_SECRET_KEY" put fit-dev-photos confirmed/dev-only.jpg dev-bytes >/dev/null
  runa "bash $M/files-backup.sh photos"
  ok_if "photos 백업이 성공한다" "$(is "$rc" 0)"
  f="$(qa "ls /srv/fit/backups/photos | grep -E '^photos-[0-9]{8}T[0-9]{6}Z\\.tar\\.age\$' | head -n 1")"
  ok_if "photos-<UTC 시각>.tar.age와 .meta가 생긴다" "$([ -n "$f" ] && [ "$(qa "test -f /srv/fit/backups/photos/$f.meta && echo yes")" = yes ] && echo 1 || echo 0)"
  runa "age -d -i /root/ids/id2.txt /srv/fit/backups/photos/$f | tar -t"
  ok_if "복호화한 tar에 prod 사진이 들어 있다" "$([ "$(has "$out" confirmed/a.jpg)" = 1 ] && [ "$(has "$out" confirmed/b.jpg)" = 1 ] && echo 1 || echo 0)"
  ok_if "dev 버킷의 사진은 들어 있지 않다" "$(is "$(has "$out" dev-only.jpg)" 0)"
  runa "age -d -i /root/ids/id1.txt /srv/fit/backups/photos/$f | tar -xO confirmed/b.jpg"
  ok_if "사진 내용이 그대로다" "$(has "$out" photo-bytes-B)"
  ok_if "지표: photos 마지막 성공 시각이 기록된다" "$([ "$(metric a 'fit_backup_last_success_timestamp_seconds{kind="photos"}')" -gt 1000000000 ] && echo 1 || echo 0)"
  runa "bash $M/files-backup.sh caddy"
  ok_if "볼륨이 없으면 caddy 백업은 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '볼륨')" = 1 ] && echo 1 || echo 0)"
  docker volume create "${EDGE_PROJECT}_caddy_data" >/dev/null
  docker run --rm -v "${EDGE_PROJECT}_caddy_data:/d" "$PYTHON_IMAGE" sh -c 'mkdir -p /d/certificates/acme && echo cert-data >/d/certificates/acme/site.crt'
  runa "bash $M/files-backup.sh caddy"
  ok_if "caddy 백업이 성공한다" "$(is "$rc" 0)"
  t="$(qa "ls /srv/fit/backups/caddy | grep -E '^caddy-[0-9]{8}T[0-9]{6}Z\\.tar\\.age\$' | head -n 1")"
  runa "age -d -i /root/ids/id1.txt /srv/fit/backups/caddy/$t | tar -xO ./certificates/acme/site.crt"
  ok_if "볼륨의 인증서 파일이 tar에 그대로 들어 있다" "$(has "$out" cert-data)"
  ok_if "files-backup.sh는 알 수 없는 종류를 거부한다" "$(is "$(qa "bash $M/files-backup.sh nothing >/dev/null 2>&1; echo \$?")" 2)"
}

run_push_checks() {
  echo "--- 금고로 전송(rsync, rrsync)"
  local ip n
  ip="$(a_ip)"
  ok_if "전송 전에 outbox에 보낼 파일이 있다" "$([ "$(qa "ls /srv/fit/backups/outbox | wc -l")" -ge 6 ] && echo 1 || echo 0)"
  # 호스트 키가 다른 서버로 바뀐 것처럼 만들면 보내지 않는다
  runa "cp /etc/fit/keys/vault_known_hosts /tmp/known.good && ssh-keygen -q -t ed25519 -N '' -f /tmp/other && printf '%s %s\n' $B \"\$(cut -d' ' -f1,2 /tmp/other.pub)\" >/etc/fit/keys/vault_known_hosts && bash $M/push-vault.sh"
  ok_if "B의 호스트 키가 등록된 것과 다르면 보내지 않는다" "$([ "$rc" != 0 ] && [ "$(qb "ls /srv/vault/incoming | wc -l")" = 0 ] && echo 1 || echo 0)"
  runa "cp /tmp/known.good /etc/fit/keys/vault_known_hosts && bash $M/push-vault.sh"
  ok_if "push-vault.sh가 성공한다" "$(is "$rc" 0)"
  ok_if "보낸 파일이 outbox에서 사라진다" "$(is "$(qa "ls /srv/fit/backups/outbox | wc -l")" 0)"
  ok_if "A의 로컬 사본은 남는다" "$([ "$(qa "ls /srv/fit/backups/pg | grep -c '\\.age\$'")" -ge 3 ] && echo 1 || echo 0)"
  n="$(qb "ls /srv/vault/incoming | grep -c '\\.age\$'")"
  ok_if "B의 incoming에 암호화 파일이 도착한다" "$([ "$n" -ge 5 ] && echo 1 || echo 0)"
  ok_if "B의 incoming에 짝 파일(.meta)도 도착한다" "$(is "$(qb "ls /srv/vault/incoming | grep -c '\\.meta\$'")" "$n")"
  ok_if "도착한 파일은 vault 소유 600이다" "$(is "$(qb "stat -c '%a %U' /srv/vault/incoming/\$(ls /srv/vault/incoming | head -n 1)")" '600 vault')"
  ok_if "지표: 마지막 전송 시각이 기록되고 보낼 파일은 0이다" "$([ "$(metric a fit_backup_last_push_timestamp_seconds)" -gt 1000000000 ] && [ "$(metric a fit_backup_outbox_files)" = 0 ] && echo 1 || echo 0)"
  runa "bash $M/push-vault.sh"
  ok_if "보낼 파일이 없어도 성공한다" "$(is "$rc" 0)"
  # 쓰기 전용 강제 명령: A의 키로는 금고를 읽거나 지우거나 셸을 열 수 없다
  local ssh_opts="-i /etc/fit/keys/vault_ed25519 -o BatchMode=yes -o UserKnownHostsFile=/etc/fit/keys/vault_known_hosts"
  runa "ssh $ssh_opts vault@$B 'ls /srv/vault'"
  ok_if "A의 키로 셸 명령을 실행할 수 없다" "$([ "$rc" != 0 ] && [ "$(has "$out" store)" = 0 ] && echo 1 || echo 0)"
  runa "mkdir -p /tmp/pull && rsync -e 'ssh $ssh_opts' vault@$B:./ /tmp/pull/ && ls /tmp/pull | wc -l"
  ok_if "A의 키로 금고의 파일을 내려받을 수 없다" "$([ "$rc" != 0 ] || [ "$out" = 0 ] && echo 1 || echo 0)"
  runa "mkdir -p /tmp/empty && rsync -r --delete -e 'ssh $ssh_opts' /tmp/empty/ vault@$B:./"
  ok_if "A의 키로 --delete를 쓸 수 없다" "$(nonzero "$rc")"
  ok_if "삭제 시도 뒤에도 incoming의 파일이 그대로다" "$([ "$(qb "ls /srv/vault/incoming | grep -c '\\.age\$'")" = "$n" ] && echo 1 || echo 0)"
  runa "echo escape >/tmp/escape.txt && rsync -e 'ssh $ssh_opts' /tmp/escape.txt vault@$B:../store/escape.txt"
  ok_if "incoming 밖(../store)으로는 쓸 수 없다" "$([ "$(qb "ls /srv/vault/store | grep -c escape")" = 0 ] && [ "$(qb "test -e /srv/vault/escape.txt && echo yes")" != yes ] && echo 1 || echo 0)"
  # 등록한 A의 주소가 아닌 곳에서는 같은 키로도 접속할 수 없다
  docker cp "$A:/etc/fit/keys/vault_ed25519" "$T/k" >/dev/null
  docker cp "$T/k" "$B:/tmp/k" >/dev/null
  runb "chmod 600 /tmp/k && ssh -i /tmp/k -o BatchMode=yes -o StrictHostKeyChecking=no vault@127.0.0.1 true"
  ok_if "등록한 주소(from=$ip)가 아니면 같은 키도 거부한다" "$(nonzero "$rc")"
  runb "rm -f /tmp/k"
}

# 금고에 일부러 넣는 파일(잘못된 짝, 심볼릭 링크 등)을 만드는 도우미(B 안에서 root로)
vault_put() { # vault_put 이름 내용
  runb "printf '%s' '$2' >/srv/vault/incoming/$1 && chown vault:vault /srv/vault/incoming/$1"
}
vault_meta() { # vault_meta 데이터이름 종류 sha256 크기
  runb "printf 'name=%s\nkind=%s\nsha256=%s\nsize=%s\ncreated=x\n' '$1' '$2' '$3' '$4' >/srv/vault/incoming/$1.meta && chown vault:vault /srv/vault/incoming/$1.meta"
}

run_ingest_checks() {
  echo "--- 금고 ingest(B)"
  local f sum base now fails
  runb "bash $M/vault-ingest.sh"
  ok_if "vault-ingest.sh가 성공한다" "$(is "$rc" 0)"
  ok_if "받은 백업이 검증을 통과해 incoming에서 보관소로 옮겨졌다" "$([ "$(qb "ls /srv/vault/incoming | wc -l")" = 0 ] && [ "$(qb "ls /srv/vault/store/pg | grep -c '\\.age\$'")" -ge 3 ] && echo 1 || echo 0)"
  ok_if "사진과 Caddy 백업도 종류별 디렉터리로 간다" "$([ "$(qb "ls /srv/vault/store/photos | grep -c '\\.age\$'")" = 1 ] && [ "$(qb "ls /srv/vault/store/caddy | grep -c '\\.age\$'")" = 1 ] && echo 1 || echo 0)"
  f="$(qb "ls /srv/vault/store/pg | grep '\\.age\$' | head -n 1")"
  sum="$(qb "sha256sum /srv/vault/store/pg/$f | cut -d' ' -f1")"
  ok_if "보관소의 파일 sha256이 .meta와 맞는다" "$(is "$(qb "sed -n 's/^sha256=//p' /srv/vault/store/pg/$f.meta")" "$sum")"
  ok_if "B에는 평문이 없다(보관소의 덤프에서 데이터가 보이지 않는다)" "$(is "$(qb "grep -c -a secret-note /srv/vault/store/pg/$f")" 0)"
  now="$(date +%s)"
  ok_if "지표: pg 마지막 수신 시각이 방금이다" "$([ "$(( now - $(metric b 'fit_vault_last_received_timestamp_seconds{kind="pg"}') ))" -lt 120 ] && echo 1 || echo 0)"
  ok_if "지표 파일은 누구나 읽을 수 있다(644). vault-ingest.sh는 umask 077이지만 node-exporter는 nobody로 읽는다" "$(is "$(qb "stat -c %a /srv/vault/metrics/fit_vault.prom")" 644)"
  ok_if "지표: 보관 중인 pg 백업 수와 크기가 기록된다" "$([ "$(metric b 'fit_vault_backups{kind="pg"}')" -ge 3 ] && [ "$(metric b 'fit_vault_store_bytes{kind="pg"}')" -gt 0 ] && echo 1 || echo 0)"
  ok_if "지표: 격리와 실패는 0이다" "$([ "$(metric b fit_vault_quarantined_files)" = 0 ] && [ "$(metric b fit_vault_ingest_failures_total)" = 0 ] && echo 1 || echo 0)"
  # 손상된 전송: sha256이 다르다
  base=pg-20261021T130000Z.dump.age
  vault_put "$base" 'corrupted-content'
  vault_meta "$base" pg "$(printf '%064d' 0 | tr 0 a)" 17
  runb "bash $M/vault-ingest.sh"
  ok_if "sha256이 다르면 보관소로 옮기지 않는다" "$([ "$(qb "test -e /srv/vault/store/pg/$base && echo yes")" != yes ] && echo 1 || echo 0)"
  ok_if "sha256이 다른 파일은 격리한다" "$([ "$(qb "ls /srv/vault/store/quarantine | grep -c '^$base'")" = 2 ] && [ "$(qb "ls /srv/vault/incoming | wc -l")" = 0 ] && echo 1 || echo 0)"
  ok_if "지표: 실패 누적이 1로 오른다" "$(is "$(metric b fit_vault_ingest_failures_total)" 1)"
  # 크기가 다르다
  base=pg-20261021T131000Z.dump.age
  vault_put "$base" 'size-mismatch'
  vault_meta "$base" pg "$(qb "printf '%s' 'size-mismatch' | sha256sum | cut -d' ' -f1")" 999
  runb "bash $M/vault-ingest.sh"
  ok_if "크기가 다르면 격리한다" "$([ "$(qb "test -e /srv/vault/store/pg/$base && echo yes")" != yes ] && [ "$(qb "ls /srv/vault/store/quarantine | grep -c '^$base'")" = 2 ] && echo 1 || echo 0)"
  # 형식이 틀린 .meta
  base=pg-20261021T132000Z.dump.age
  vault_put "$base" 'bad-meta'
  vault_meta "$base" pg 'not-a-hash' 8
  runb "bash $M/vault-ingest.sh"
  ok_if "sha256 형식이 틀린 .meta는 격리한다" "$([ "$(qb "ls /srv/vault/store/quarantine | grep -c '^$base'")" = 2 ] && echo 1 || echo 0)"
  # 종류가 짝과 다르다
  base=photos-20261021T133000Z.tar.age
  vault_put "$base" 'kind-mismatch'
  vault_meta "$base" pg "$(qb "printf '%s' 'kind-mismatch' | sha256sum | cut -d' ' -f1")" 13
  runb "bash $M/vault-ingest.sh"
  ok_if "이름의 종류와 .meta의 종류가 다르면 격리한다" "$([ "$(qb "test -e /srv/vault/store/photos/$base && echo yes")" != yes ] && [ "$(qb "ls /srv/vault/store/quarantine | grep -c '^$base'")" = 2 ] && echo 1 || echo 0)"
  # 심볼릭 링크
  base=pg-20261021T134000Z.dump.age
  runb "ln -s /etc/passwd /srv/vault/incoming/$base && chown -h vault:vault /srv/vault/incoming/$base"
  vault_meta "$base" pg "$(qb "sha256sum /etc/passwd | cut -d' ' -f1")" "$(qb "wc -c </etc/passwd | tr -d ' '")"
  runb "bash $M/vault-ingest.sh"
  ok_if "심볼릭 링크는 따라가지 않고 격리한다" "$([ "$(qb "test -e /srv/vault/store/pg/$base && echo yes")" != yes ] && [ "$(qb "ls /srv/vault/store/quarantine | grep -c '^$base'")" = 2 ] && echo 1 || echo 0)"
  # 짝이 없는 파일과 이상한 이름: 진행 중일 수 있으니 처음에는 두고, 시간이 지나면 격리한다
  vault_meta pg-20261021T135000Z.dump.age pg aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1
  vault_put evil.sh 'rm -rf /'
  vault_put .pg-20261021T136000Z.dump.age.AbC123 'partial-transfer'
  runb "bash $M/vault-ingest.sh"
  ok_if "방금 온 짝 없는 .meta와 이상한 이름과 전송 중 임시 파일은 건드리지 않는다" "$(is "$(qb "ls -A /srv/vault/incoming | wc -l")" 3)"
  runb "touch -d '2 hours ago' /srv/vault/incoming/pg-20261021T135000Z.dump.age.meta && touch -d '2 days ago' /srv/vault/incoming/evil.sh /srv/vault/incoming/.pg-20261021T136000Z.dump.age.AbC123 && bash $M/vault-ingest.sh"
  ok_if "1시간이 지난 짝 없는 .meta는 격리한다" "$([ "$(qb "ls /srv/vault/store/quarantine | grep -c '^pg-20261021T135000Z.dump.age.meta'")" = 1 ] && echo 1 || echo 0)"
  ok_if "하루가 지난 이상한 파일과 끊긴 임시 파일은 격리한다" "$([ "$(qb "ls -A /srv/vault/store/quarantine | grep -c -e '^evil.sh' -e 'AbC123'")" = 2 ] && [ "$(qb "ls -A /srv/vault/incoming | wc -l")" = 0 ] && echo 1 || echo 0)"
  # 보관 정책: 오래된 백업은 지워진다(B)
  now="$(date +%s)"
  runb "cd /srv/vault/store/pg && for h in 100 124 125 400; do n=pg-\$(date -u -d @\$(( $now - h*3600 )) +%Y%m%dT%H%M%SZ).dump.age; echo x >\$n; echo x >\$n.meta; done"
  runb "bash $M/vault-ingest.sh"
  ok_if "14일이 지난 백업(400시간)은 B에서도 지워진다" "$(is "$(qb "ls /srv/vault/store/pg | grep -c \"pg-\$(date -u -d @$(( now - 400*3600 )) +%Y%m%dT%H%M%SZ)\"")" 0)"
  ok_if "시간창 밖에서도 날마다 1개는 남는다(100시간, 124시간: 백업 파일과 .meta가 함께)" \
    "$([ "$(qb "ls /srv/vault/store/pg | grep -c \"pg-\$(date -u -d @$(( now - 100*3600 )) +%Y%m%dT%H%M%SZ)\"")" = 2 ] && [ "$(qb "ls /srv/vault/store/pg | grep -c \"pg-\$(date -u -d @$(( now - 124*3600 )) +%Y%m%dT%H%M%SZ)\"")" = 2 ] && echo 1 || echo 0)"
  # 복원 리허설 기록
  runb "bash $M/vault-ingest.sh record-restore abc 10"
  ok_if "record-restore는 숫자가 아닌 인자를 거부한다" "$(nonzero "$rc")"
  runb "bash $M/vault-ingest.sh record-restore 1790000000 1234"
  ok_if "record-restore가 성공한다" "$(is "$rc" 0)"
  ok_if "지표: 복원 리허설 시각과 RTO가 기록된다" "$([ "$(metric b fit_vault_last_restore_check_timestamp_seconds)" = 1790000000 ] && [ "$(metric b fit_vault_last_restore_check_rto_seconds)" = 1234 ] && echo 1 || echo 0)"
  runb "bash $M/vault-ingest.sh nothing"
  ok_if "알 수 없는 인자는 거부한다" "$(is "$rc" 2)"
  runb "mkdir -p /srv/vault/state/ingest.lock && echo 1 >/srv/vault/state/ingest.lock/pid && bash $M/vault-ingest.sh"
  ok_if "ingest가 이미 돌고 있으면 시작하지 않는다" "$([ "$rc" != 0 ] && [ "$(has "$out" '이미 돌고')" = 1 ] && echo 1 || echo 0)"
  runb "rm -rf /srv/vault/state/ingest.lock"
  fails="$(metric b fit_vault_ingest_failures_total)"
  ok_if "지표: 실패 누적이 시험에서 일으킨 5건이다" "$(is "$fails" 5)"
}

run_restore_checks() {
  echo "--- 복원 리허설(노트북 역할)"
  local f
  f="$(qb "ls /srv/vault/store/pg | grep '\\.dump\\.age\$' | sort | tail -n 1")"
  docker cp "$B:/srv/vault/store/pg/$f" "$T/restore.age" >/dev/null
  docker cp "$T/restore.age" "$A:/tmp/$f" >/dev/null
  runa "bash $M/restore-check.sh -i /root/ids/id2.txt --fetch-seconds 5 --sql 'SELECT count(*) FROM t_backup_probe' /tmp/$f"
  ok_if "restore-check.sh가 B의 사본을 복호화하고 복원해 성공한다" "$(is "$rc" 0)"
  ok_if "복원된 데이터를 조회한다(3행)" "$(has "$out" 'sql_result=3')"
  ok_if "RTO를 초 단위로 알려 준다(내려받기 5초를 더한다)" "$([[ "$out" =~ RTO:\ ([0-9]+)초 ]] && [ "${BASH_REMATCH[1]}" -ge 5 ] && echo 1 || echo 0)"
  runa "bash $M/restore-check.sh -i /root/ids/id3.txt /tmp/$f"
  ok_if "수신자가 아닌 개인키로는 복호화에 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '복호화에 실패')" = 1 ] && echo 1 || echo 0)"
  runa "bash $M/restore-check.sh /tmp/$f"
  ok_if "개인키(-i)가 없으면 거부한다" "$(nonzero "$rc")"
  runa "cp /tmp/$f /tmp/notabackup.age && bash $M/restore-check.sh -i /root/ids/id1.txt /tmp/notabackup.age"
  ok_if "백업 이름 형식이 아니면 거부한다" "$(nonzero "$rc")"
  f="$(qb "ls /srv/vault/store/photos | grep '\\.tar\\.age\$' | head -n 1")"
  docker cp "$B:/srv/vault/store/photos/$f" "$T/photos.age" >/dev/null
  docker cp "$T/photos.age" "$A:/tmp/$f" >/dev/null
  runa "bash $M/restore-check.sh -i /root/ids/id1.txt /tmp/$f"
  ok_if "사진 tar 백업은 복호화하고 목록을 확인한다" "$([ "$rc" = 0 ] && [ "$(has "$out" '항목')" = 1 ] && echo 1 || echo 0)"
  ok_if "복원 시험이 임시 컨테이너를 남기지 않는다" "$(is "$(docker ps -a --format '{{.Names}}' | grep -c '^fit-verify-')" 0)"
}

run_wrapper_checks() {
  echo "--- backup-run.sh"
  local before
  before="$(qa "ls /srv/fit/backups/pg | grep -c '\\.dump\\.age\$'")"
  runa "printf 'BACKUP_VAULT_HOST=REPLACE_ME\n' >/tmp/bad.env && FIT_BACKUP_ENV=/tmp/bad.env bash $M/backup-run.sh pg"
  ok_if "전송이 실패해도 백업은 만들고 실패로 끝낸다" "$([ "$rc" != 0 ] && [ "$(qa "ls /srv/fit/backups/pg | grep -c '\\.dump\\.age\$'")" = "$((before + 1))" ] && echo 1 || echo 0)"
  ok_if "전송하지 못한 파일은 outbox에 남는다" "$(is "$(qa "ls /srv/fit/backups/outbox | grep -c '\\.age\$'")" 1)"
  runa "bash $M/backup-run.sh pg"
  ok_if "정상 설정에서는 백업하고 밀린 파일까지 함께 보낸다" "$([ "$rc" = 0 ] && [ "$(qa "ls /srv/fit/backups/outbox | wc -l")" = 0 ] && echo 1 || echo 0)"
  runa "bash $M/backup-run.sh nothing"
  ok_if "알 수 없는 종류는 거부한다" "$(is "$rc" 2)"
}

run_hygiene_checks() {
  echo "--- 비밀 값 노출"
  local bad=0 k v
  for k in POSTGRES_PASSWORD FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD GARAGE_ADMIN_TOKEN S3_PROD_SECRET_KEY S3_DEV_SECRET_KEY; do
    v="$(sed -n "s/^$k=//p" "$DT/etc/data.env")"
    if grep -qF "$v" "$OUT_ALL"; then
      bad=1
      echo "FAIL  $k 값이 스크립트 출력에 찍혔다"
    fi
  done
  ok_if "스크립트 출력에 데이터 스택의 비밀 값이 없다" "$(is "$bad" 0)"
  ok_if "스크립트 출력에 SSH 개인키 본문이 없다" "$(is "$(grep -c 'BEGIN OPENSSH PRIVATE KEY' "$OUT_ALL")" 0)"
  ok_if "스크립트 출력에 age 개인키가 없다" "$(is "$(grep -c 'AGE-SECRET-KEY' "$OUT_ALL")" 0)"
  ok_if "A의 서버 설정 경로에는 age 공개키만 있다" "$(is "$(qa "grep -r -l 'AGE-SECRET-KEY' /etc/fit /srv/fit /usr/local/lib/fit 2>/dev/null | wc -l")" 0)"
}

run() {
  OUT_ALL="$T/output.log"
  : >"$OUT_ALL"
  local section
  local -a sections=("$@")
  if [ "${#sections[@]}" = 0 ]; then sections=(retention units install trust pg predeploy files push ingest restore wrapper hygiene); fi
  if [ -f "$DATA_ENV" ]; then load_data_env; fi
  set +e
  for section in "${sections[@]}"; do "run_${section}_checks"; done
  set -e
  if [ "$FAILED" -gt 0 ]; then
    printf '\n%d개 점검 실패\n' "$FAILED"
    return 1
  fi
  printf '\n백업 시험 통과\n'
}

case "${1:-}" in
  up) up ;;
  run) shift && run "$@" ;;
  down) down ;;
  *)
    echo "사용: bash infra/backup/test/test-backup.sh up | run [구역...] | down" >&2
    exit 2
    ;;
esac
