# 백업 (backup)

서버 A의 Postgres 덤프, 사진, Caddy 인증서 볼륨을 암호화해 서버 B의 금고(vault)로 보내고, 사람이 노트북에서 복원해 본다. 설계는 [design.md](../../docs/infra/design.md) 8절이다. 목표는 RPO 4시간, RTO 2시간이다(제안값. 복원 리허설로 잰다).

## 흐름

```
A  pg-backup.sh scheduled(4시간마다) ── 덤프 → (하루 1회) 임시 DB에 복원해 검증 → age 암호화 → pg/ 와 outbox/
A  files-backup.sh photos(매일) · caddy(매주) ─────────────────────────────────→ photos/·caddy/ 와 outbox/
A  push-vault.sh ── rsync(쓰기 전용 강제 명령) ──────────→ B  incoming/        (vault 계정, A가 쓸 수만 있다)
B  vault-ingest.sh(10분마다) ── 이름·sha256·크기 검증 ───→ B  store/<종류>/    (root 전용, 보관 정책 적용)
사람  restore-check.sh ── B의 사본을 내려받아 복호화·복원, RTO 기록 (노트북, Docker Desktop)
```

- **암호화:** `age`로, 수신자 2명(인프라 담당, 백업 담당)의 공개키로만 암호화한다. 개인키는 A와 B 어디에도 없고 수신자가 오프라인으로 보관한다. 그래서 서버가 뚫려도 백업 평문은 나가지 않지만 자동 복원 리허설은 못 한다.
- **금고는 쓰기 전용:** B의 `vault` 계정은 `rrsync -wo -no-del /srv/vault/incoming`만 실행할 수 있다(`restrict`, 선택적으로 `from=<A의 IP>`). A가 뚫려도 금고의 백업을 읽거나 지울 수 없고 셸도 열 수 없다.
- **B가 다시 검증한다:** `incoming/`은 신뢰하지 않는다. `vault-ingest.sh`는 이름 형식을 보고 파일을 root만 쓰는 staging으로 옮긴 뒤 그 사본의 sha256과 크기를 `.meta`와 대조한다. 통과하면 `store/`, 아니면 `store/quarantine/`으로 간다. 심볼릭 링크는 따라가지 않는다.
- **보관 정책:** 4시간 단위 백업은 48시간(`BACKUP_KEEP_HOURS`) 동안 모두 두고, 그보다 오래된 것은 한국 시간 기준 하루에 가장 늦은 1벌만 14일(`BACKUP_KEEP_DAYS`) 동안 둔다. 가장 최근 백업은 어떤 경우에도 지우지 않는다. A의 로컬 보관(`pg/`, `photos/`, `caddy/`)과 B의 `store/`에 같은 규칙을 쓴다.
- **B의 `backup.env`는 없어도 된다.** 파일이 없으면 위 기본값(48시간, 14일)을 쓴다. B에서 `BACKUP_VAULT_HOST`는 쓰이지 않는다(A의 `push-vault.sh`만 요구한다). 보관 기간을 바꿀 때만 만들고, `install.sh ops`를 다시 실행하면 예제에서 `REPLACE_ME`가 든 파일이 만들어지므로 값을 채우지 않았다면 지워도 된다(2026-10-23에 B에서 지웠고 금고 수신 서비스가 정상으로 돌았다).
- **마이그레이션 전 덤프:** `pg-backup.sh predeploy <환경> <sha>`가 평문 덤프를 `/srv/fit/predeploy/`에 둔다(환경별 최근 5개). 배포 스크립트가 마이그레이션 전에 부른다. 개인키가 서버에 없어 암호화하면 급할 때 복원할 수 없고, 이 덤프는 DB 볼륨과 같은 신뢰 범위에 있으며 B로 보내지 않는다.

## 처음 설정 (서버가 생긴 뒤, 순서대로)

| 순서 | 어디서 | 명령 |
|---|---|---|
| 1 | A | `sudo bash infra/backup/install.sh app` (패키지, 코드 사본, 디렉터리, 전송 키, 타이머를 만들고 아래 수동 단계를 출력한다) |
| 2 | B | `sudo bash infra/backup/install.sh ops` |
| 3 | B | `sudo bash infra/backup/vault-authorize.sh '<A의 /etc/fit/keys/vault_ed25519.pub 한 줄>' <A의 IP>` |
| 4 | A | `/etc/fit/backup.env`의 `BACKUP_VAULT_HOST`를 B의 주소로 채운다 |
| 5 | A | `sudo bash infra/backup/install.sh pin-vault-host`로 B의 호스트 키 지문을 보고, B에서 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`의 지문과 같으면 `--yes`를 붙여 다시 실행한다 |
| 6 | 수신자 각자 | 자기 노트북에서 `age-keygen -o ~/fit-backup-key.txt`. 개인키는 오프라인으로 보관하고 공개키(`age1...`)만 전달한다 |
| 7 | A | `/etc/fit/keys/age-recipients.txt`에 공개키 2개를 한 줄씩 넣는다(root 0600) |
| 8 | A | `sudo systemctl start fit-backup@pg.service`로 첫 백업을 하고 `journalctl -u fit-backup@pg`로 확인한다 |
| 9 | B | 10분 안에 `ls /srv/vault/store/pg`에 파일이 보인다(기다리기 싫으면 `sudo systemctl start fit-vault-ingest.service`) |
| 10 | 사람 | 아래 복원 리허설을 한다 |

타이머는 A에서 `fit-backup-pg.timer`(00:15부터 4시간마다), `fit-backup-photos.timer`(매일 04:40), `fit-backup-caddy.timer`(일요일 04:50), B에서 `fit-vault-ingest.timer`(10분마다)다. 시간대는 서버의 `Asia/Seoul`이다.

**코드를 바꾸면** 서버에서 `git pull` 뒤 `sudo bash infra/backup/install.sh app`(B는 `ops`)을 다시 실행한다. 타이머는 저장소 체크아웃이 아니라 root만 쓸 수 있는 사본(`/usr/local/lib/fit/repo`)을 실행한다. 배포 러너(`gitlab-runner`)가 저장소를 바꿔도 root로 도는 백업 코드는 바뀌지 않게 하려는 것이다. 설치 스크립트는 몇 번 실행해도 같은 결과이고 바뀐 것만 알린다.

## 복원 리허설 (주 1회, 11/06 전에는 최소 2회)

노트북(Docker Desktop과 `age`가 있어야 한다)에서 한다.

```bash
# 1. B의 최신 덤프를 내려받는다(걸린 시간을 잰다)
time ssh <user>@<B> 'sudo cat /srv/vault/store/pg/pg-<UTC 시각>.dump.age' > pg-<UTC 시각>.dump.age
# 2. 복호화와 임시 Postgres 복원, 테이블 수 확인, 걸린 시간(RTO) 출력
bash infra/backup/restore-check.sh -i ~/fit-backup-key.txt --fetch-seconds <1에서 잰 초> \
  --sql 'SELECT count(*) FROM flyway_schema_history' pg-<UTC 시각>.dump.age
```

- 마지막에 `RTO: <초>초`를 낸다. 결과를 B의 지표로 남기려면 `--record <user>@<B>`를 붙이거나, 출력된 안내대로 B에서 `sudo /usr/local/lib/fit/repo/infra/backup/vault-ingest.sh record-restore <epoch> <RTO>`를 실행한다.
- 사진과 인증서 백업(`photos-*.tar.age`, `caddy-*.tar.age`)은 복호화해 tar 목록을 확인한다.
- BE가 아직 마이그레이션하기 전의 빈 DB 덤프는 `--allow-empty`를 붙인다.
- 내려받은 암호화 덤프 최신 1벌은 노트북에 남긴다(설계 13.4절, 세 번째 사본).
- Windows Git Bash에서는 `age`(WinGet 설치 경로)를 `PATH`에 넣으면 된다. 경로는 `/c/...`로 줘도 `C:/...`로 줘도 된다. 윈도 `age.exe`는 Git Bash의 `/c/...` 경로를 열지 못해서, `restore-check.sh`가 `age`에 주는 경로만 `cygpath`로 `C:/...` 모양으로 바꾼다(2026-10-28 이 PC에서 `/c/...` 경로와 기본 임시 폴더로 끝까지 확인했다. 예전에 쓰던 `TMPDIR` 우회는 필요 없다).
- 오류는 원인별로 다르게 나온다: 백업 파일이 없으면 `백업 파일이 없다`, 개인키 파일이 없으면 `개인키 파일이 없다`, `-i`를 안 주면 `개인키 파일(-i)을 준다`, 키가 수신자가 아니면 `이 개인키는 이 백업의 수신자가 아니다`다. 그 밖의 `age` 오류(깨진 파일 등)는 `복호화에 실패했다(age의 말): …`로 age가 한 말을 그대로 보여 준다.
- 노트북에서 이진 파일을 받을 때는 PowerShell의 `>`를 쓰지 않는다. 암호화 파일이 글자로 바뀌어 깨진다. Git Bash를 쓴다.
- prod DB에 테이블이 생기기 전에 실제 테이블이 있는 덤프가 필요하면 A에서 dev DB를 평문 없이 바로 암호화한다. 운영 백업 줄기(`pg/`, `outbox/`, 금고)와 섞이지 않게 별도 폴더에 두고, 파일 이름은 `pg-<UTC 시각>.dump.age` 형식이어야 `restore-check.sh`가 받는다.

  ```bash
  sudo install -d -m 700 /srv/fit/backups/rehearsal-dev
  sudo bash -c "set -o pipefail; docker exec fit-data-postgres-1 pg_dump -U postgres -Fc -d fit_dev | age -R /etc/fit/keys/age-recipients.txt -o /srv/fit/backups/rehearsal-dev/pg-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
  ```

### 리허설 기록

| 회차 | 날짜(KST) | 대상 | 결과 | RTO | 한계 |
|---|---|---|---|---|---|
| #1 | 2026-10-22 | `fit_prod` 덤프(테이블 0개, `--allow-empty`)와 사진 tar | 복호화·복원 성공, 사진 tar 목록을 읽음 | 6초 | 빈 DB라 데이터는 확인하지 못했다 |
| #2 | 2026-10-27 | `fit_dev` 덤프(테이블 6개, 마이그레이션 기록 2건, 나머지 5개 테이블은 0행) | 복호화·복원 성공, 테이블 6개와 `flyway_schema_history` 2건을 확인 | 7초(내려받기 1초 + 복호화·복원 6초) | 행이 거의 없어 실제 데이터 크기의 RTO가 아니다. 덤프는 금고를 거치지 않고 A에서 받았다 |
| #3 | 2026-11-10 | `fit_prod` 실데이터(장소 11,712 · 사용자 36 · 리뷰 4 · 북마크 6, public 테이블 30개, 덤프 144,357,302바이트) | 복원 두 부분으로 나눠 확인했다. (1) A에서 그 시각의 `fit_prod`를 새로 덤프해 `verify-dump.sh`로 임시 DB에 복원해 통과했다(`fit_prod_ro` 권한이 든 덤프 포함). (2) 금고의 최신 덤프(`pg-20261110T071529Z.dump.age`, 144,393,103바이트)를 노트북에서 개인키로 복호화해 앞 5바이트(`PGDMP`)만 확인했다 | 약 30초(A에서 복원 17초 + B에서 내려받기 12.6초). 덤프를 뜨는 데는 33초 | 금고의 덤프를 노트북에서 끝까지 복호화·복원한 것이 아니다(개인 정보가 든 덤프를 노트북에 두지 않기로 했다). 복호화 시간은 재지 않았다. 서버 전체 재구축(RB-12)과 사람이 하는 절차의 시간은 포함하지 않는다 |

- 두 번 모두 첫 번째 수신자의 개인키로 했다. 두 번째 수신자는 2026-10-27에 같은 형식의 덤프를 자기 키로 복호화했다고 보고했다(Jira S15P31A302-79).
- #3은 실제 데이터 크기(덤프 약 138 MiB)로 쟀다. DB 복원 부분은 약 30초이고 목표(RTO 2시간)에 한참 못 미친다. 서버 전체를 새로 세우는 시간(RB-12)을 포함한 RTO는 아직 재지 않았다. #3의 복호화 확인은 노트북의 age 개인키로 했다.

## 자주 하는 일

| 하고 싶은 일 | 명령 |
|---|---|
| 지금 백업하고 B로 보내기 | `sudo systemctl start fit-backup@pg.service`(`photos`, `caddy`도 같다) |
| 보내지 못한 파일 확인 | `ls /srv/fit/backups/outbox`(A). 다음 실행이 다시 보낸다 |
| 백업 상태 지표 보기 | `cat /var/lib/fit/metrics/fit_backup.prom`(A), `cat /srv/vault/metrics/fit_vault.prom`(B) |
| 격리된 파일 보기 | `ls /srv/vault/store/quarantine`(B). 검증에 실패했거나 짝이 없는 파일이다 |
| 덤프 검증만 따로 | `bash infra/backup/verify-dump.sh <평문 덤프> --expect-tables <N>`(복호화한 파일) |

## 지표

A는 `/var/lib/fit/metrics/fit_backup.prom`(`FIT_METRICS_DIR`)에, B는 `/srv/vault/metrics/fit_vault.prom`에 Prometheus textfile 형식으로 쓴다. A의 node-exporter(`infra/obs`)와 B의 node-exporter(`infra/ops`)가 textfile collector로 읽고, 알림 규칙이 이 이름을 쓴다([obs/README.md](../obs/README.md), [ops/README.md](../ops/README.md)).

| 지표 | 뜻 |
|---|---|
| `fit_backup_last_success_timestamp_seconds{kind}` | 종류(`pg`, `photos`, `caddy`)별 마지막 백업 성공 시각 |
| `fit_backup_last_verify_ok`, `fit_backup_last_verify_timestamp_seconds` | 마지막 덤프 복원 검증의 결과(1 통과, 0 실패)와 시각 |
| `fit_backup_last_push_timestamp_seconds`, `fit_backup_outbox_files` | 마지막 전송 시각, 아직 못 보낸 백업 수 |
| `fit_vault_last_received_timestamp_seconds{kind}` | B가 검증을 통과한 백업을 마지막으로 받은 시각(8시간 넘게 안 오면 알린다) |
| `fit_vault_backups{kind}`, `fit_vault_store_bytes{kind}` | 보관 중인 백업 수와 크기 |
| `fit_vault_quarantined_files`, `fit_vault_ingest_failures_total` | 격리한 파일 수, 검증 실패 누적 |
| `fit_vault_ingest_last_run_timestamp_seconds` | ingest가 마지막으로 끝까지 돈 시각 |
| `fit_vault_last_restore_check_timestamp_seconds`, `fit_vault_last_restore_check_rto_seconds` | 마지막 복원 리허설 시각과 RTO |

## 파일

| 경로 | 내용 |
|---|---|
| `lib.sh` | 공통 함수(잠금, 이름과 시각, 보관 정책 `retention_delete`, 암호화, `.meta`, 지표). `data/lib.sh`를 읽는다. 직접 실행하지 않는다 |
| `pg-backup.sh` | `scheduled`, `predeploy <환경> <sha>` |
| `verify-dump.sh` | 평문 덤프를 임시 Postgres(망 없음, 메모리 디스크)에 복원해 확인한다. `--expect-tables`, `--allow-empty`, `--sql` |
| `files-backup.sh` | `photos`(Garage의 prod 버킷 전체를 tar로), `caddy`(Caddy 데이터 볼륨을 tar로) |
| `push-vault.sh` | outbox의 파일을 B로 보낸다(호스트 키 고정, 쓰기 전용). 성공한 파일만 outbox에서 지운다 |
| `backup-run.sh` | 타이머가 부르는 진입점: 백업 뒤 결과와 상관없이 전송도 시도하고, 하나라도 실패하면 실패로 끝낸다 |
| `vault-ingest.sh` | B: 받은 파일 검증과 보관 정책, `record-restore` |
| `vault-authorize.sh` | B: A의 공개키를 쓰기 전용으로 등록한다 |
| `restore-check.sh` | 노트북: 복호화, 복원, RTO |
| `install.sh` | `app`, `ops`, `pin-vault-host` |
| `conf/systemd/` | 서비스와 타이머 |
| `backup.env.example` | `BACKUP_VAULT_HOST`, `BACKUP_VAULT_PORT`, `BACKUP_KEEP_HOURS`, `BACKUP_KEEP_DAYS` |
| `test/` | 노트북 시험 |

A의 디렉터리: `/srv/fit/backups/{pg,photos,caddy,outbox,state}`(root 0700), `/srv/fit/predeploy`(root:docker 2770). B: `/srv/vault/{incoming(vault 소유),store,state,metrics}`.

## 범위와 한계

- 백업하는 것은 `fit_prod`(Postgres), prod 사진 버킷, Caddy 인증서 볼륨이다. dev DB·dev 사진·OpenSearch는 백업하지 않는다(OpenSearch는 Postgres에서 재색인, 설계 7.2절). `/etc/fit/*.env`는 자동화하지 않고 인프라 담당이 변경 때마다 암호화해 팀 비밀번호 관리자에 둔다.
- 덤프 검증은 복원 오류가 없고 복원된 public 테이블 수가 덤프 시점의 수와 같은지 본다. 덤프를 뜬 뒤 검증 전에 마이그레이션이 테이블을 더하면 그날은 검증이 실패로 나오고 다음 실행이 다시 확인한다. 업무 데이터의 의미(행 수 등)는 `--sql`로 사람이 본다.
- B의 verify 러너가 docker.sock으로 B의 root 권한을 갖기 때문에 금고를 지울 수 있다(설계 13.4절). A의 로컬 사본과 노트북의 최신 1벌이 그 대비다.
- 사진 백업은 prod 버킷 전체를 매일 새로 묶는다(증분 아님). 사진이 커지면 방식을 바꾼다(설계 4.4절의 용량 가정).

## 노트북에서 시험하기

```bash
bash infra/backup/test/test-backup.sh up                 # 데이터 스택, 시험용 A·B 컨테이너(실제 sshd, rsync, rrsync, age), 망
bash infra/backup/test/test-backup.sh run                # 전부. 구역을 주면 그 구역만: retention install trust pg predeploy files push ingest restore wrapper hygiene
bash infra/backup/test/test-backup.sh down               # 시험이 만든 것을 모두 지운다
```

시험은 `infra/data/test/test-data.sh`가 띄우는 실제 Postgres와 Garage를 백업하고, A와 B를 Docker 컨테이너 두 개로 흉내 낸다(접두사 `fit-backuptest`). A 컨테이너는 Docker 소켓으로 호스트의 데몬을 써서 덤프와 복원 검증용 임시 컨테이너를 만든다. systemd는 없어서 설치 스크립트의 `systemctl` 단계는 `FIT_SKIP=apt,systemd`로 건너뛰고, 유닛 파일은 `ExecStart`가 코드 사본의 스크립트를 가리키는지 정적으로 본다.

## 서버에서만 확인되는 것

systemd 타이머의 실제 실행(`OnCalendar`, `Persistent`), A와 B 사이의 실제 네트워크와 SSH(방화벽 22번, `from=` 주소), Ubuntu 22.04의 `rrsync`(python3가 있어야 한다. 시험은 24.04), 실제 데이터 크기에서의 덤프·검증·전송 시간과 디스크, 호스트 재부팅 뒤 타이머, 수신자 2명의 실제 개인키로 한 복호화.
