# 데이터 스택과 백업 구현 계획 (Plan 1D)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버 A의 데이터 스택(Postgres(pgvector), OpenSearch, Redis 2개, Garage)을 compose와 멱등 초기화 스크립트로 정의하고, Postgres 덤프·사진·Caddy 인증서 볼륨을 암호화해 서버 B의 금고로 보내 받은 쪽이 다시 검증하며 사람이 노트북에서 복원해 볼 수 있는 백업 체계를 만든다. 서버 없이 실제 Postgres·Redis·Garage와 실제 sshd·rsync·rrsync·age가 든 A·B 컨테이너로 권한 격리, 멱등성, 재시작, 손상 파일 격리, 쓰기 전용 금고, 복원을 노트북에서 시험한다.

**Architecture:** `infra/data/compose.data.yml`이 프로젝트 `fit-data`(postgres, opensearch, redis-prod, redis-dev, garage)를 정의하고, 환경별 DB·role·버킷·키는 compose가 아니라 멱등 스크립트(`ensure-databases.sh`, `init-garage.sh`)가 `/etc/fit/data.env`의 값으로 만든다. 호스트에 S3 도구가 없고 Garage 포트를 게시하지 않으므로 S3 요청은 표준 라이브러리만 쓰는 `s3tool.py`를 net-data에 붙인 python 컨테이너에서 실행한다. 백업은 A의 root 타이머가 `age`(수신자 2명)로 암호화한 파일과 sha256·크기를 적은 `.meta`를 만들어 outbox에 두고, `push-vault.sh`가 B의 `vault` 계정(쓰기 전용 강제 명령 `rrsync -wo -no-del`)으로 보내면 B의 `vault-ingest.sh`가 root 전용 staging에서 다시 검증해 보관소로 옮기고 보관 정책을 적용한다. 개인키는 서버에 없고 복원은 사람이 `restore-check.sh`로 한다. 타이머가 도는 코드는 저장소 체크아웃이 아니라 root 소유 사본이다.

**Tech Stack:** bash, Docker Compose v2(2.24 이상, `!override`), `pgvector/pgvector:0.8.7-pg16`, `redis:7.4.9-alpine`, `dxflrs/garage:v2.4.1`, OpenSearch 3.9.0(로컬과 같은 Dockerfile), age, rsync·rrsync·ssh, python 3(표준 라이브러리 SigV4), GNU date·find(Git Bash와 Ubuntu), 시험용 `ubuntu:24.04`와 `docker:29.9.0-cli`.

**Spec:** [docs/infra/design.md](../design.md) (2.2절 네트워크, 2.3절 환경 분리, 7절 데이터 서비스, 8절 백업·복구, 13.2절 시크릿, 13.3절 SSH)

## 한눈에 보기

각 Task는 구현, 통과 확인, 커밋 순서다(커밋은 허용된 경우에만). Task 3과 6의 시험이 이 계획의 게이트다.

| Task | 만드는 것 | 막는 사고 |
|---|---|---|
| 1 | `compose.data.yml`, `garage.toml`, `data.env.example`, `backup.env.example`, env 계약, 검사 등록 | 환경마다 서비스 설정이 달라짐, 컨테이너가 호스트에 포트를 게시함, 계약에 없는 키 |
| 2 | `lib.sh`, `ensure-databases.sh`, `s3tool.py`, `init-garage.sh`, `init-data.sh`, `verify-data.sh` | init 스크립트가 빈 볼륨에서 한 번만 돌아 DB·role이 없음, 앱이 다른 환경의 DB·버킷에 접근, 비밀번호가 로그·프로세스 목록에 남음, 형식이 틀린 값(따옴표, 셸 문법)으로 초기화 |
| 3 | 데이터 시험(`test/test-data.sh`) | 서버 없이는 권한 격리·재시작·멱등성을 확인할 길이 없음 |
| 4 | `lib.sh`(보관 정책), `pg-backup.sh`, `verify-dump.sh`, `files-backup.sh`, `restore-check.sh` | 덤프가 복원되지 않는데 모름, 평문 백업이 서버에 남음, 보관 정책 오류로 백업이 지워짐, 마이그레이션 전 덤프가 없음 |
| 5 | `push-vault.sh`, `vault-ingest.sh`, `vault-authorize.sh`, `backup-run.sh`, `install.sh`, systemd 유닛 | A가 뚫렸을 때 금고의 백업이 지워짐, 손상·바꿔치기된 파일이 보관소에 들어감, 타이머가 CI가 바꿀 수 있는 코드를 root로 실행 |
| 6 | 백업 시험(`test/test-backup.sh`, 시험용 서버 이미지) | 전송·수신·복원 경로는 실제로 돌려 보기 전에는 믿을 수 없음 |
| 7 | `fit-up.sh` 연결, 문서와 CI 연결 | 재부팅 뒤 데이터 스택이 안 올라옴, 문서와 구현이 어긋남 |

이 계획은 서버 A와 B의 데이터·백업만 만든다. 관측성(지표 수집과 알림 규칙)은 계획 1E가, 런북 RB-01·08·10·12와 포팅 매뉴얼은 계획 1G가, CI 파이프라인은 계획 1C-3이 만든다.

## 검증 결과

이 계획의 코드는 저장소를 clone한 임시 복사본(저장소 밖)에서 계획의 코드 블록만으로 다시 만들어 실행해 확인했다.

- 데이터 시험(`test-data.sh run`)은 처음 상태에서 구역 10개, `PASS` 59개, `FAIL` 0개로 통과한다. 실제 Postgres(pgvector 0.8.7, PG16), Redis 7.4.9 두 개, Garage v2.4.1을 띄운다. `FIT_TEST_OPENSEARCH=1`이면 OpenSearch 3.9.0도 띄워 nori 분석기가 `닭가슴살`을 `닭`, `가슴`, `살`로 나누는 것까지 확인했다(빈 인덱스에서 컨테이너 메모리 약 1.3GiB).
- 데이터 시험이 죽은 검사가 아닌지 확인하려고 초기화 스크립트를 11곳 일부러 망가뜨렸다(`REVOKE ... FROM PUBLIC` 삭제, 마이그레이터 테이블·시퀀스의 기본 권한 삭제, 기존 테이블 `GRANT` 삭제, prod 앱 비밀번호 갱신 삭제, dev 키에 prod 버킷 권한 부여, 수명주기 설정 삭제, 호출한 셸의 환경변수를 지우는 줄 삭제, 비밀번호 문자·길이 검사 완화, Garage 레이아웃 재적용 가드 삭제). 모든 경우에 해당 점검이 실패로 잡았다. 시험하다 찾은 결함도 고쳤다: 공식 Postgres 이미지가 컨테이너 안 loopback 접속을 비밀번호 없이 허용해서 비밀번호 시험이 의미가 없었고(서비스 이름으로 접속하도록 고쳤다), `data.env`를 `source`하면 값 안의 셸 문법이 실행될 수 있어 `KEY=VALUE` 줄만 읽도록 고쳤다.
- 데이터 스택: 초기화를 다시 실행해도 role 3개·DB 2개·Garage 레이아웃이 그대로이고 기존 행과 객체를 건드리지 않는다. 비밀번호를 바꿔 다시 실행하면 옛 비밀번호가 거부된다. 앱 role은 마이그레이터가 만든 테이블에 DML만 하고 DDL·TRUNCATE는 못 하며 다른 환경 DB에 접속하지 못한다. Redis는 maxmemory를 넘으면 쫓아내지 않고 `OOM`으로 거절하고 기존 키가 남으며 AOF로 재시작 뒤 데이터가 돌아온다. dev 키와 prod 키는 서로의 Garage 버킷을 읽지 못하고 서명 없는 S3 GET은 거부되며 웹 엔드포인트 읽기는 된다. 따옴표·`$(...)`가 든 비밀번호, 틀린 키 형식, 자리표시자, 누락은 값을 찍지 않고 거부한다. 호스트에 게시된 포트는 postgres의 `127.0.0.1` 하나다.
- 백업 시험(`test-backup.sh run`)은 처음 상태에서 구역 12개, `PASS` 159개, `FAIL` 0개로 통과한다. 실제 Postgres·Garage를 백업하고 A·B를 실제 sshd·rsync·rrsync·age가 든 Ubuntu 24.04 컨테이너 두 개로 흉내 낸다.
- 백업 시험이 죽은 검사가 아닌지 확인하려고 백업 스크립트를 11곳 일부러 망가뜨렸다(보관 정책의 하루 1벌 규칙과 최신 보호 삭제, age 수신자를 1명으로, 덤프 검증 실패를 무시, 복원된 테이블 수 비교 삭제, 금고의 sha256·크기 비교 삭제, 심볼릭 링크 검사 삭제, `rrsync`의 `-wo`와 `-no-del` 삭제, SSH 호스트 키 검사 끄기, 전송 실패에도 outbox 비우기). 모든 경우에 해당 점검이 실패로 잡았다. systemd 유닛은 `OnCalendar`에 오타를 넣거나 존재하지 않는 `ExecStart`를 가리키게 하면 `units` 구역이 잡는다.
- 백업: 수신자 2명의 키로 각자 복호화할 수 있고 수신자가 아닌 키로는 못 푼다. 암호화 파일에서 테이블 이름이 보이지 않고, 복호화해 임시 Postgres에 복원하면 원래 행 3개가 조회된다. 잘린 덤프·잡음 파일·잘못된 테이블 수는 검증에 실패하고, 검증에 실패한 덤프는 보내지 않고 지표가 0이 되며 다음 실행이 회복한다. 보관 정책은 시간창 안은 모두, 그 밖은 한국 시간 하루 1벌, 14일 뒤 삭제, 최신 보호를 지킨다(A와 B 모두). 마이그레이션 전 덤프는 640 `docker` 그룹 파일로 생기고 환경별 최근 5개만 남는다.
- 금고: A의 키로 셸 명령 실행, 금고 읽기, `--delete`, `incoming/` 밖 쓰기가 모두 거부되고 등록하지 않은 주소에서는 같은 키도 거부된다. B의 호스트 키가 등록된 것과 다르면 보내지 않는다. B는 손상된 파일, 크기가 다른 파일, 형식이 틀린 `.meta`, 이름과 종류가 다른 파일, 심볼릭 링크를 격리하고 보관소에는 들이지 않으며, 방금 온 짝 없는 파일은 건드리지 않고 시간이 지나면 격리한다.
- 설치와 복원: `install.sh`가 A·B에 디렉터리 모드(백업 700, 사전 덤프 `root:docker 2770`)와 root만 쓸 수 있는 코드 사본을 만들고 두 번째 실행은 변경이 0건이다. 배포 러너 계정은 사전 덤프 디렉터리에 쓰지만 백업 디렉터리는 보지 못한다. `restore-check.sh`가 B의 사본을 복호화·복원해 RTO를 낸다. 유닛 파일은 `systemd-analyze`(systemd 255)로 `OnCalendar` 표현과 문법을 확인했다.
- 배포 연결: `fit-up.sh`는 data compose가 있으면 올린 뒤 초기화 스크립트를 돌리고 없으면 건너뛴다. 1C-2의 배포 시험(`test-deploy.sh run`)은 구역 15개, `PASS` 76개, `FAIL` 0개로 그대로 통과한다.
- 정적 검사: 데이터 compose는 포트 불변식이 5개 서비스를 검사하고 이미지 아키텍처 검사(arm64·amd64)가 통과한다. 러너(`run-local-checks.sh`)와 자가 테스트가 통과하고 새 스크립트·Dockerfile·compose는 `lint:shell`·`lint:docker`·`lint:yaml`이 자동으로 검사한다. gitleaks 검사도 통과한다.
- Windows(Git Bash)에서 시험하며 겪은 것: `cd`가 `fnm` 훅 때문에 실패 코드를 돌려줘 `&&` 연결이 끊기므로 시험 스크립트는 `git rev-parse`와 절대 경로를 쓴다. Docker 소켓은 `//var/run/docker.sock`으로 마운트한다. `docker exec`의 인자로 한글을 넘기면 깨질 수 있어 시험 명령은 ASCII로 쓴다. `pg_dump -Fc`는 데이터를 압축해서 평문 덤프에서 행 값을 `grep`할 수 없으므로 복원해서 조회한다.

아래 코드를 그대로 옮기면 같은 결과가 나와야 한다. 다르면 코드를 고치기 전에 원인을 먼저 확인한다.

**아직 확인하지 못한 것**

- systemd 타이머의 실제 실행(`OnCalendar`, `Persistent`, 재부팅 뒤 기동). 시험 컨테이너에는 systemd가 없어서 유닛 파일은 `ExecStart`가 코드 사본의 스크립트를 가리키는지, `Unit=`이 가리키는 서비스가 있는지를 정적으로 확인하고 `systemd-analyze`로 `OnCalendar` 표현과 유닛 문법만 확인했다(실행은 하지 못했다).
- A와 B 사이의 실제 네트워크(방화벽 22번, `from=` 주소). 시험은 한 Docker 망 안의 두 컨테이너다.
- Ubuntu 22.04의 `rrsync`(python3가 있어야 한다). 시험은 24.04다.
- 호스트 게시 포트(`127.0.0.1:5432`)로 들어오는 접속이 비밀번호를 확인하는지(개발자 SSH 터널). 시험은 다른 컨테이너가 서비스 이름으로 접속하는 경로까지다.
- 실제 데이터 크기에서의 덤프·검증·전송 시간과 디스크, OpenSearch의 실제 메모리 사용(설계 4.1절 예산), 메모리 상한 안에서의 동작.
- 실제 `/etc/fit`의 파일 권한(NTFS와 컨테이너에서는 일부만 확인했다), 수신자 2명의 실제 개인키로 한 복호화, 실제 B(Arm)에서의 동작.
- Mattermost 알림과 지표 수집(계획 1E). 지표 파일의 내용까지만 확인했다.

## Global Constraints

1A·1B·1C-1·1F·1C-2의 전역 제약이 모두 적용된다([plan 1A](2026-10-15-plan-1a-foundation-guardrails.md), [plan 1B](2026-10-19-plan-1b-local-env-contracts.md), [plan 1C-1](2026-10-20-plan-1c1-edge.md), [plan 1F](2026-10-20-plan-1f-host.md), [plan 1C-2](2026-10-21-plan-1c2-deploy.md)). 이 계획에서 더 지키는 것은 다음과 같다.

- 비밀 값(비밀번호, 토큰, 키)을 화면, 로그, 프로세스 인자에 출력하지 않는다. SQL은 표준 입력으로 넘기고 `log_statement`와 `pg_stat_statements.track_utility`를 끈다. `data.env`는 셸로 실행하지 않고 `KEY=VALUE` 줄만 읽는다. 검증 메시지는 어떤 키가 틀렸는지만 알린다.
- 호스트에 게시하는 포트는 postgres의 `127.0.0.1:5432` 하나다. 나머지는 net-data 안에서 서비스 이름으로 닿는다.
- 초기화·설치 스크립트는 몇 번 실행해도 같은 결과이고 기존 데이터와 기존 키를 바꾸지 않는다(비밀번호 교체는 값을 바꾸고 `ensure-databases.sh`를 다시 실행).
- 개인키(age)는 서버 어디에도 두지 않는다. A에는 공개키만 있다.
- 받는 쪽(B)은 보내는 쪽(A)을 신뢰하지 않는다. `incoming/`의 파일은 root 전용 staging으로 옮긴 뒤 검증하고, 형식이 틀린 이름·내용과 심볼릭 링크는 격리한다.
- 타이머가 root로 실행하는 코드는 root만 쓸 수 있는 사본이다. 배포 러너(docker 그룹)가 쓰는 곳(`/srv/fit/predeploy`)은 root 전용 백업 디렉터리 밖에 둔다.
- 시험용 값(비밀번호, 키)은 실행할 때마다 무작위로 만들고 저장소에 두지 않는다. 시험용 컨테이너·볼륨·이미지·망은 `fit-datatest`, `fit-backuptest` 접두사로 만들고 `down`으로 지운다(이름 패턴 일괄 삭제 금지). 시험 디렉터리는 저장소 안의 `.tmp-datatest/`, `.tmp-backuptest/`다(`.gitignore`에 있다).
- Windows(Git Bash)에서 시험이 돌아야 한다. 네이티브 프로그램(`docker`, `python`)에 넘기는 경로는 `native_path`를 거치고, Docker 소켓은 `//var/run/docker.sock`으로 마운트하며, 시험이 만드는 임시 컨테이너에는 호스트 경로를 마운트하지 않고 파일을 표준 입력으로 흘려 넣는다. GNU `date -d`와 `find -printf`가 필요하다(Git Bash와 Ubuntu에 있다). 한글을 `docker exec`의 명령행 인자로 넘기지 않는다.
- 브랜치는 `infra/feat/data-backup-S15P31A302-19`다. 커밋 메시지는 1B와 같은 규칙이다.

## 파일 구조

모든 경로는 저장소 루트(`C:\Users\SSAFY\ssafy\S15P31A302`) 기준이다.

| 파일 | 책임 |
|---|---|
| `infra/data/compose.data.yml`, `garage/garage.toml`, `data.env.example` | 데이터 스택 정의와 키 예제 |
| `infra/data/lib.sh`, `ensure-databases.sh`, `init-garage.sh`, `init-data.sh`, `verify-data.sh`, `s3tool.py` | 초기화와 점검 |
| `infra/data/test/` | 데이터 시험(`test-data.sh`, `compose.test.yml`) |
| `infra/backup/lib.sh`, `pg-backup.sh`, `verify-dump.sh`, `files-backup.sh`, `restore-check.sh` | 덤프·검증·사진/인증서 백업·복원 리허설 |
| `infra/backup/push-vault.sh`, `vault-ingest.sh`, `vault-authorize.sh`, `backup-run.sh`, `install.sh`, `conf/systemd/` | 전송, 금고 수신 검증, 설치, 타이머 |
| `infra/backup/backup.env.example` | 백업 설정 예제 |
| `infra/backup/test/` | 백업 시험(`test-backup.sh`, 시험용 서버 이미지 `node/Dockerfile`) |
| `infra/deploy/fit-up.sh`, `infra/deploy/test/test-deploy.sh` | (수정) data 스택 기동과 초기화 연결 |
| `infra/ci/compose-projects.txt`, `infra/ci/run-local-checks.sh`, `.gitlab-ci.yml`, `.gitignore` | (수정) 검사 연결 |
| `docs/infra/contracts/env.md`, `docs/infra/design.md`, `docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md`, `infra/README.md`, `infra/deploy/README.md`, `infra/data/README.md`, `infra/backup/README.md` | (신규·수정) 문서 |

## 후속 계획

| 계획 | 이 계획의 산출물을 쓰는 방식 |
|---|---|
| 1E 관측성 | A의 `/var/lib/fit/metrics/fit_backup.prom`과 B의 `/srv/vault/metrics/fit_vault.prom`을 textfile collector가 읽게 마운트하고 알림 규칙을 건다(백업 8시간 무수신, 검증 실패, 격리 발생, 복원 리허설 기한). 데이터 컨테이너의 메모리·재시작 지표를 본다 |
| 1G 런북 | RB-01(B 재구축), RB-08(Garage 키 교체), RB-10(데이터 삭제), RB-12(A 소실 복원)가 이 계획의 스크립트와 `infra/backup/README.md` 절차를 쓴다 |
| 1C-3 CI 파이프라인 | 배포 잡이 `deploy.sh`를 부르면 마이그레이션 전 `pg-backup.sh predeploy`가 돈다. `lint:image-arch`는 이 계획이 더한 입력(데이터 compose, 시험 이미지)을 이미 본다 |
| 계획 2(서버 수령 후) | `install.sh app`·`ops`로 서버에 깔고, 첫 데이터 초기화와 첫 백업·복원 리허설을 한다 |

---

### Task 1: 데이터 스택 정의

**목표:** postgres, opensearch, redis-prod, redis-dev, garage를 프로젝트 `fit-data`로 정의한다. 메모리·망·게시 포트는 설계 2.2절과 4.1절, 7절을 그대로 옮긴다. 환경변수 계약에 `data`, `backup` 그룹을 더한다.

**Files:**
- Create: `infra/data/compose.data.yml`, `infra/data/garage/garage.toml`, `infra/data/data.env.example`, `infra/backup/backup.env.example`
- Modify: `docs/infra/contracts/env.md`, `infra/ci/compose-projects.txt`, `.gitignore`

**Interfaces:**
- Consumes: 1F의 공유 망(`net-data`, `net-edge`, `net-dbaccess`. 이름은 `FIT_NET_DATA`, `FIT_NET_EDGE`, `FIT_NET_DBACCESS`로 바꾼다), 1B의 OpenSearch Dockerfile(`infra/local/opensearch`)
- Produces: 서비스 `postgres`(`127.0.0.1:5432` 게시), `opensearch`, `redis-prod`, `redis-dev`, `garage`. 서비스 이름이 BE가 쓰는 호스트 이름이다. 값은 `docker compose --env-file /etc/fit/data.env`로 읽는다(`${VAR:?msg}`라 비면 compose가 멈춘다)
- 한도: postgres 1g, opensearch 2g(힙 768m), redis 각 128m(maxmemory 96mb), garage 192m

핵심 결정:

- 튜닝은 mount한 설정 파일이 아니라 `command:` 플래그로 한다(shared_buffers 256MB, max_connections 60, `idle_in_transaction_session_timeout`, `pg_stat_statements`).
- postgres는 internal 망(net-data)에서 포트를 게시할 수 없어서 net-dbaccess에도 속한다. 개발자 SSH 터널이 `127.0.0.1:5432`로 들어온다.
- Redis는 `noeviction`, AOF everysec, requirepass(환경별 비밀번호)다. 멱등성 키가 쫓겨나지 않게 하는 것이다.
- Garage 설정은 디렉터리째 마운트한다(`garage.toml`). 레이아웃·버킷·키는 Task 2의 스크립트가 만든다.
- env 계약은 `data`(12개 키), `backup`(4개 키) 그룹을 더한다. `local` 그룹과 겹치는 키(`POSTGRES_PASSWORD` 등)는 두 그룹에 모두 적는다.

- [ ] **Step 1: 환경 확인과 브랜치**

Run (저장소 루트, Git Bash):

```bash
python --version
docker version --format 'server={{.Server.Version}}'
docker compose version
git status --short
```

Expected: Python 3.9 이상, Docker 서버 버전 출력, Compose v2.24 이상, 작업 트리가 깨끗하다.

사용자에게 커밋 허용 여부를 한 번 묻는다. 허용하면 `git switch -c infra/feat/data-backup-S15P31A302-19`로 브랜치를 만든 뒤 시작한다. 허용하지 않으면 모든 커밋 단계를 건너뛴다.

- [ ] **Step 2: 검사 대상에 먼저 등록하고 실패 확인**

````diff
diff --git a/infra/ci/compose-projects.txt b/infra/ci/compose-projects.txt
index 6b9b5b9..50c4dfa 100644
--- a/infra/ci/compose-projects.txt
+++ b/infra/ci/compose-projects.txt
@@ -5,3 +5,4 @@ local infra/local/compose.yml --env-file infra/local/local.env.example
 edge infra/edge/compose.edge.yml --env-file infra/edge/edge.env.example
 edge-test infra/edge/compose.edge.yml infra/edge/test/compose.test.yml --env-file infra/edge/edge.env.example
 app infra/app/compose.app.yml
+data infra/data/compose.data.yml --env-file infra/data/data.env.example
````

Run: `python infra/ci/check_compose_projects.py; echo "exit=$?"`

Expected: `== data` 아래에 `FAIL docker compose config failed: …compose.data.yml…`(파일을 열 수 없다는 오류)이 나오고 `exit=1`이다.

- [ ] **Step 3: compose 파일과 Garage 설정 작성**

`infra/data/compose.data.yml`:

````yaml
# 데이터 스택. 서버 A의 fit-data 프로젝트다(설계 2.2절, 4.1절, 7절): postgres, opensearch, redis-prod, redis-dev, garage.
# 값은 `docker compose --env-file /etc/fit/data.env`로 읽는다(compose 보간). 필요한 키는 docs/infra/contracts/env.md의 data 그룹이다.
# DB·role·버킷·키는 이 파일이 아니라 멱등 스크립트(ensure-databases.sh, init-garage.sh)가 만든다. 직접 부르지 않고 init-data.sh를 쓴다.
# 호스트에 게시하는 포트는 postgres의 127.0.0.1:5432 하나다(개발자 SSH 터널용). 나머지는 net-data 안에서 서비스 이름으로 닿는다.
# 망(net-*)은 호스트에서 먼저 만들어 둔다(infra/host/networks.sh). 서비스 이름이 BE가 쓰는 호스트 이름이다(`postgres`, `redis-prod`, `garage` 등).
name: fit-data

services:
  postgres:
    image: pgvector/pgvector:0.8.7-pg16
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?data.env에 POSTGRES_PASSWORD가 없다}
    # 튜닝은 설정 파일이 아니라 command 플래그로 한다(설계 7.1절)
    command:
      - postgres
      - -c
      - shared_buffers=256MB
      - -c
      - max_connections=60
      - -c
      - idle_in_transaction_session_timeout=60000
      - -c
      - shared_preload_libraries=pg_stat_statements
    ports:
      - 127.0.0.1:5432:5432
    mem_limit: 1g
    volumes:
      - pgdata:/var/lib/postgresql/data
    # net-data는 internal이라 포트를 게시할 수 없다. 127.0.0.1:5432를 위해 net-dbaccess에도 속한다(설계 2.2절)
    networks: [net-data, net-dbaccess]
    healthcheck:
      test: [CMD-SHELL, pg_isready -U postgres -d postgres]
      interval: 5s
      timeout: 3s
      retries: 12

  # 공식 이미지에 analysis-nori를 넣은 이미지다. 로컬 스택과 같은 Dockerfile을 쓴다(설계 7.2절)
  opensearch:
    build:
      context: ../local/opensearch
    restart: unless-stopped
    environment:
      discovery.type: single-node
      DISABLE_SECURITY_PLUGIN: "true"
      DISABLE_INSTALL_DEMO_CONFIG: "true"
      OPENSEARCH_JAVA_OPTS: -Xms768m -Xmx768m
      action.destructive_requires_name: "true"
    mem_limit: 2g
    volumes:
      - osdata:/usr/share/opensearch/data
    networks: [net-data]
    healthcheck:
      test: [CMD-SHELL, "curl -fsS 'http://localhost:9200/_cluster/health?wait_for_status=yellow&timeout=5s' >/dev/null"]
      interval: 10s
      timeout: 8s
      retries: 18

  # 멱등성 키가 쫓겨나지 않게 noeviction, AOF everysec, requirepass(설계 7.3절)
  redis-prod:
    image: redis:7.4.9-alpine
    restart: unless-stopped
    environment:
      REDIS_PASSWORD: ${REDIS_PROD_PASSWORD:?data.env에 REDIS_PROD_PASSWORD가 없다}
      REDISCLI_AUTH: ${REDIS_PROD_PASSWORD:?data.env에 REDIS_PROD_PASSWORD가 없다}
    command:
      - sh
      - -c
      - exec redis-server --requirepass "$$REDIS_PASSWORD" --maxmemory 96mb --maxmemory-policy noeviction --appendonly yes --appendfsync everysec
    mem_limit: 128m
    volumes:
      - redisdata-prod:/data
    networks: [net-data]
    healthcheck:
      test: [CMD, redis-cli, ping]
      interval: 5s
      timeout: 3s
      retries: 12

  redis-dev:
    image: redis:7.4.9-alpine
    restart: unless-stopped
    environment:
      REDIS_PASSWORD: ${REDIS_DEV_PASSWORD:?data.env에 REDIS_DEV_PASSWORD가 없다}
      REDISCLI_AUTH: ${REDIS_DEV_PASSWORD:?data.env에 REDIS_DEV_PASSWORD가 없다}
    command:
      - sh
      - -c
      - exec redis-server --requirepass "$$REDIS_PASSWORD" --maxmemory 96mb --maxmemory-policy noeviction --appendonly yes --appendfsync everysec
    mem_limit: 128m
    volumes:
      - redisdata-dev:/data
    networks: [net-data]
    healthcheck:
      test: [CMD, redis-cli, ping]
      interval: 5s
      timeout: 3s
      retries: 12

  # 사진 저장소(설계 7.4절). S3 API(3900)와 웹 엔드포인트(3902)는 엣지가 net-edge로 프록시한다. 설정은 디렉터리째 마운트한다
  garage:
    image: dxflrs/garage:v2.4.1
    restart: unless-stopped
    command: [/garage, -c, /etc/garage/garage.toml, server]
    environment:
      GARAGE_RPC_SECRET: ${GARAGE_RPC_SECRET:?data.env에 GARAGE_RPC_SECRET이 없다}
      GARAGE_ADMIN_TOKEN: ${GARAGE_ADMIN_TOKEN:?data.env에 GARAGE_ADMIN_TOKEN이 없다}
    mem_limit: 192m
    volumes:
      - ./garage:/etc/garage:ro
      - garage-meta:/var/lib/garage/meta
      - garage-data:/var/lib/garage/data
    networks: [net-data, net-edge]
    healthcheck:
      test: [CMD, /garage, -c, /etc/garage/garage.toml, status]
      interval: 5s
      timeout: 5s
      retries: 12

volumes:
  pgdata:
  osdata:
  redisdata-prod:
  redisdata-dev:
  garage-meta:
  garage-data:

networks:
  net-data:
    name: ${FIT_NET_DATA:-net-data}
    external: true
  net-edge:
    name: ${FIT_NET_EDGE:-net-edge}
    external: true
  net-dbaccess:
    name: ${FIT_NET_DBACCESS:-net-dbaccess}
    external: true
````

`infra/data/garage/garage.toml`:

````toml
# 서버 A의 Garage 설정(설계 7.4절). 단일 노드다. 로컬 스택(infra/local/garage/garage.toml)과 같은 구조를 쓴다.
# 웹 엔드포인트의 root_domain은 엣지가 보내는 Host(<버킷>.web.garage.localhost)와 맞아야 한다(설계 5.2절).
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "lmdb"
replication_factor = 1

rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"

[s3_web]
bind_addr = "[::]:3902"
root_domain = ".web.garage.localhost"
index = "index.html"

[admin]
api_bind_addr = "[::]:3903"
````

- [ ] **Step 4: env 예제와 계약 작성**

`infra/data/data.env.example`:

````env
POSTGRES_PASSWORD=REPLACE_ME
FIT_MIGRATOR_PASSWORD=REPLACE_ME
FIT_PROD_APP_PASSWORD=REPLACE_ME
FIT_DEV_APP_PASSWORD=REPLACE_ME
REDIS_PROD_PASSWORD=REPLACE_ME
REDIS_DEV_PASSWORD=REPLACE_ME
GARAGE_RPC_SECRET=REPLACE_ME
GARAGE_ADMIN_TOKEN=REPLACE_ME
S3_PROD_ACCESS_KEY=REPLACE_ME
S3_PROD_SECRET_KEY=REPLACE_ME
S3_DEV_ACCESS_KEY=REPLACE_ME
S3_DEV_SECRET_KEY=REPLACE_ME
````

`infra/backup/backup.env.example`:

````env
BACKUP_VAULT_HOST=REPLACE_ME
BACKUP_VAULT_PORT=22
BACKUP_KEEP_HOURS=48
BACKUP_KEEP_DAYS=14
````

환경변수 계약 표에 두 그룹과 키를 더한다(`local` 그룹과 겹치는 키는 그룹 열에 `local, data`로 적는다):

````diff
diff --git a/docs/infra/contracts/env.md b/docs/infra/contracts/env.md
index 18197c8..f4fdac5 100644
--- a/docs/infra/contracts/env.md
+++ b/docs/infra/contracts/env.md
@@ -17,8 +17,10 @@
 | `local` | `infra/local/local.env.example` | 로컬 개발 스택(`infra/local/compose.yml`) |
 | `fe` | `infra/app/fe.env.example` | FE Node 컨테이너(`/etc/fit/fe-dev.env`, `/etc/fit/fe-prod.env`). 비밀을 담지 않는다 |
 | `edge` | `infra/edge/edge.env.example` | 엣지 Caddy(`/etc/fit/edge.env`). compose가 `--env-file`로 읽는다 |
+| `data` | `infra/data/data.env.example` | 데이터 스택(`infra/data/compose.data.yml`)과 DB·버킷 초기화 스크립트(`/etc/fit/data.env`). 환경별 자격이 앱 env와 같아야 한다 |
+| `backup` | `infra/backup/backup.env.example` | A의 백업 스크립트와 타이머(`/etc/fit/backup.env`) |
 
-이 문서를 만든 계획 이후의 계획이 `data`, `obs`, `ops` 그룹을 같은 표에 더한다(design.md 13.2절의 파일 구분).
+이 문서를 만든 계획 이후의 계획이 `obs`, `ops` 그룹을 같은 표에 더한다(design.md 13.2절의 파일 구분).
 
 ## 키 목록
 
@@ -77,20 +79,33 @@
 | `ACME_MODE` | edge | O | `staging`이면 staging CA만 쓴다. `production`이면 기본 이슈어(Let's Encrypt, ZeroSSL)를 쓴다 |
 | `HSTS_MODE` | edge | O | `off` 또는 `on`. 운영 인증서가 확정된 뒤에만 `on`으로 바꾼다 |
 | `DEV_GATE_KEY` | edge | O | dev 접근 키. `/?k=<키>`로 접속하면 쿠키를 받는다. 영문자·숫자·`_`·`-` 32자 이상, 비밀 |
+| `FIT_PROD_APP_PASSWORD` | data | O | `fit_prod_app` 비밀번호. `prod.env`의 `SPRING_DATASOURCE_PASSWORD`와 같아야 한다 |
+| `REDIS_PROD_PASSWORD` | data | O | `redis-prod` 비밀번호. `prod.env`의 `SPRING_DATA_REDIS_PASSWORD`와 같아야 한다 |
+| `REDIS_DEV_PASSWORD` | data | O | `redis-dev` 비밀번호. `dev.env`의 `SPRING_DATA_REDIS_PASSWORD`와 같아야 한다 |
+| `S3_PROD_ACCESS_KEY` | data | O | prod 버킷 전용 Garage 키 ID. `prod.env`의 `S3_ACCESS_KEY`와 같아야 한다 |
+| `S3_PROD_SECRET_KEY` | data | O | prod 버킷 전용 Garage 비밀 키. `prod.env`의 `S3_SECRET_KEY`와 같아야 한다 |
+| `S3_DEV_ACCESS_KEY` | data | O | dev 버킷 전용 Garage 키 ID. `dev.env`의 `S3_ACCESS_KEY`와 같아야 한다 |
+| `S3_DEV_SECRET_KEY` | data | O | dev 버킷 전용 Garage 비밀 키. `dev.env`의 `S3_SECRET_KEY`와 같아야 한다 |
+| `BACKUP_VAULT_HOST` | backup | O | 백업 금고(B)의 주소(공인 IP나 호스트 이름). 문서나 저장소에 적지 않는다 |
+| `BACKUP_VAULT_PORT` | backup | X | 금고의 SSH 포트. 기본 `22` |
+| `BACKUP_KEEP_HOURS` | backup | X | 4시간 단위 덤프를 모두 보관하는 시간. 기본 `48` |
+| `BACKUP_KEEP_DAYS` | backup | X | 그 뒤 하루 한 벌씩 보관하는 일수. 기본 `14` |
 | `FIT_LOCAL_PG_PORT` | local | X | 호스트에 게시하는 Postgres 포트. 기본 `15432` |
 | `FIT_LOCAL_REDIS_PORT` | local | X | Redis 포트. 기본 `16379` |
 | `FIT_LOCAL_S3_PORT` | local | X | Garage S3 API 포트. 기본 `13900` |
 | `FIT_LOCAL_S3_WEB_PORT` | local | X | Garage 웹 엔드포인트 포트. 기본 `13902` |
 | `FIT_LOCAL_OPENSEARCH_PORT` | local | X | OpenSearch 포트. 기본 `19200` |
-| `POSTGRES_PASSWORD` | local | O | Postgres 관리자(`postgres`) 비밀번호 |
-| `FIT_MIGRATOR_PASSWORD` | local | O | `fit_migrator` 비밀번호 |
-| `FIT_DEV_APP_PASSWORD` | local | O | `fit_dev_app` 비밀번호 |
+| `POSTGRES_PASSWORD` | local, data | O | Postgres 관리자(`postgres`) 비밀번호 |
+| `FIT_MIGRATOR_PASSWORD` | local, data | O | `fit_migrator` 비밀번호. `migrate-<env>.env`의 `SPRING_DATASOURCE_PASSWORD`와 같아야 한다 |
+| `FIT_DEV_APP_PASSWORD` | local, data | O | `fit_dev_app` 비밀번호. `dev.env`의 `SPRING_DATASOURCE_PASSWORD`와 같아야 한다 |
 | `REDIS_PASSWORD` | local | O | Redis 비밀번호 |
-| `GARAGE_RPC_SECRET` | local | O | Garage RPC 비밀. 64자리 16진수 |
-| `GARAGE_ADMIN_TOKEN` | local | O | Garage 관리 API 토큰 |
+| `GARAGE_RPC_SECRET` | local, data | O | Garage RPC 비밀. 64자리 16진수 |
+| `GARAGE_ADMIN_TOKEN` | local, data | O | Garage 관리 API 토큰 |
 
 로컬 그룹의 값은 개발용 가짜 값이다. 서버 값으로 쓰지 않는다.
 
+`data` 그룹의 값 형식은 스크립트가 검사한다(`infra/data/lib.sh`, `init-garage.sh`). 비밀번호와 토큰(`*_PASSWORD`, `GARAGE_ADMIN_TOKEN`)은 영문·숫자·`._~-`만 쓴 16자 이상이고, `GARAGE_RPC_SECRET`과 `S3_*_SECRET_KEY`는 16진수 64자리, `S3_*_ACCESS_KEY`는 `GK` + 16진수 24자리다.
+
 ## 프런트 런타임 설정 (`/config.json`)
 
 번들에는 환경 값을 넣지 않고 시작할 때 `/config.json`을 받아 쓴다(design.md 12.5절 #3). 브라우저에 공개되는 값만 둔다. 이 표는 파일이 없어 검사기가 보지 않는다.
````

도구 산출물 디렉터리를 무시한다:

````diff
diff --git a/.gitignore b/.gitignore
index 90530ff..1aaa8d1 100644
--- a/.gitignore
+++ b/.gitignore
@@ -26,6 +26,8 @@ id_rsa
 ### 도구 산출물 ###
 .tmp-selftest/
 .tmp-gitleaks/
+.tmp-datatest/
+.tmp-backuptest/
 __pycache__/
 *.pyc
 .venv/
````

- [ ] **Step 5: 정적 검증 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
docker compose -f infra/data/compose.data.yml --env-file infra/data/data.env.example config -q && echo "data config OK"
docker compose -f infra/data/compose.data.yml --env-file infra/data/data.env.example config --format json | python -c "
import json,sys
c=json.load(sys.stdin)
for n,s in c['services'].items():
    print(n, s.get('image') or 'build', s.get('mem_limit'), sorted(s['networks']), [p['host_ip'] + ':' + str(p['published']) for p in s.get('ports', [])])
"
docker compose -f infra/data/compose.data.yml config -q 2>&1 | head -2
python infra/ci/check_compose_projects.py | tail -3
python infra/ci/check_env_contract.py
python infra/ci/check_env_files.py infra/data/data.env.example infra/backup/backup.env.example
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml infra/data/compose.data.yml; echo "yamllint exit=$?"
python infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/data/compose.data.yml --env-file infra/data/data.env.example
```

Expected: `data config OK`, 서비스 5개가 한 줄씩(postgres만 `127.0.0.1:5432`), 이어서 필수 값이 없을 때의 오류(`required variable … is missing`) 두 줄, 포트 검사 끝부분 `OK ports (6 service(s))`, `== data`, `OK ports (5 service(s))`, 이어서 `OK env-contract`, `OK env (2 file(s))`, `yamllint exit=0`, `OK arch linux/arm64,linux/amd64 (3 image(s))`

- [ ] **Step 6: 커밋 (허용된 경우)**

```bash
git add infra/data/compose.data.yml infra/data/garage/garage.toml infra/data/data.env.example infra/backup/backup.env.example docs/infra/contracts/env.md infra/ci/compose-projects.txt .gitignore
git commit -m "feat(infra): 데이터 스택 정의(compose.data.yml)와 env 계약(data, backup) 추가"
```

---

### Task 2: DB·버킷 초기화와 점검 스크립트

**목표:** 환경별 DB·role과 Garage 버킷·키를 몇 번 실행해도 같은 결과로 맞추는 스크립트와, 설계대로인지 읽기 전용으로 점검하는 스크립트를 만든다.

**Files:**
- Create: `infra/data/lib.sh`, `infra/data/ensure-databases.sh`, `infra/data/s3tool.py`, `infra/data/init-garage.sh`, `infra/data/init-data.sh`, `infra/data/verify-data.sh`

**Interfaces:**
- Consumes: Task 1의 compose(프로젝트 `fit-data`, 컨테이너는 compose 라벨로 찾는다), `infra/ci/tool-images.sh`의 `PYTHON_IMAGE`
- Produces: `init-data.sh`(postgres·garage가 healthy가 되길 기다린 뒤 두 스크립트 실행), `ensure-databases.sh`, `init-garage.sh`, `verify-data.sh`(PASS/FAIL, 하나라도 FAIL이면 종료 코드 1). 환경변수: `FIT_ENV_DIR`(`/etc/fit`), `FIT_DATA_ENV`, `FIT_DATA_PROJECT`(`fit-data`), `FIT_NET_DATA`(`net-data`), 시험용 `FIT_VERIFY_SKIP_OPENSEARCH=1`
- 공통 함수(`lib.sh`): `read_env_file`, `load_data_env`, `svc_container`, `wait_healthy`, `psql_admin`, `pg_as`, `s3run`, `native_path`. 1B의 `fit-local.sh`(로컬)와 별개다

핵심 결정:

- DB·role은 init 스크립트가 아니라 멱등 스크립트로 만든다. init 스크립트는 빈 볼륨에서 한 번만 돌기 때문이다(A503 함정). 비밀번호는 실행할 때마다 `data.env` 값으로 맞춘다.
- role: `fit_migrator`(DDL, 두 DB의 소유자), `fit_prod_app`, `fit_dev_app`(DML만, dev는 `statement_timeout` 30초). 각 앱 role은 자기 DB에만 접속한다(`REVOKE ALL ... FROM PUBLIC`). 기본 권한과 기존 테이블 `GRANT`로 마이그레이터가 만드는 테이블에 DML이 따라간다.
- `data.env`는 `source`하지 않는다. 값 안의 `$(...)`나 따옴표가 셸에서 실행되거나 SQL로 새지 않게 `KEY=VALUE` 줄만 읽고, 비밀번호는 영문·숫자·`._~-` 16자 이상만 받는다. 호출한 셸의 같은 이름 환경변수는 먼저 지운다(파일이 유일한 출처).
- 공식 Postgres 이미지는 컨테이너 안 loopback 접속을 비밀번호 없이 허용(trust)한다. `pg_as`는 서비스 이름(`-h postgres`)으로 접속해 앱 컨테이너와 같은 scram 검사를 받는다.
- Garage 키 ID는 `GK` + 16진수 24자리, 비밀 키는 16진수 64자리다(`key import` 형식). 이미 있는 키는 바꾸지 않는다(교체는 RB-08).
- `s3tool.py`(SigV4)가 수명주기 설정, 객체 읽기·쓰기, 사진 tar를 맡는다. 키는 임시 env 파일로 넘겨 프로세스 인자에 보이지 않게 한다.

- [ ] **Step 1: 공통 함수와 DB 스크립트 작성**

`infra/data/lib.sh`:

````bash
# shellcheck shell=bash disable=SC2034
# infra/data 스크립트가 함께 쓰는 함수다. 스크립트가 source한다(직접 실행하지 않는다). 설계 7절.
#
# 경로와 이름은 환경변수로 바꿀 수 있다(시험 환경이 쓴다). 서버에서는 기본값을 쓴다.
#   FIT_ENV_DIR(/etc/fit) FIT_DATA_ENV($FIT_ENV_DIR/data.env) FIT_DATA_PROJECT(fit-data) FIT_NET_DATA(net-data)

DATA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DATA_DIR/../.." && pwd)"
ENV_DIR="${FIT_ENV_DIR:-/etc/fit}"
DATA_ENV="${FIT_DATA_ENV:-$ENV_DIR/data.env}"
DATA_PROJECT="${FIT_DATA_PROJECT:-fit-data}"
NET_DATA="${FIT_NET_DATA:-net-data}"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
# shellcheck source=infra/ci/tool-images.sh
. "$ROOT_DIR/infra/ci/tool-images.sh"

log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }
die() {
  printf 'FAIL %s\n' "$*" >&2
  exit 1
}

# read_env_file 파일: KEY=VALUE 줄만 읽어 환경변수로 올린다. 셸 코드로 실행(source)하지 않으므로 값에 $(...)나 따옴표가 있어도 명령이 실행되지 않는다.
# 형식이 틀린 줄은 줄 번호만 알려 준다(값에 비밀이 있을 수 있어 내용은 찍지 않는다).
read_env_file() {
  local line n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    case "$line" in '' | '#'*) continue ;; esac
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || die "$1의 ${n}번째 줄이 KEY=VALUE 형식이 아니다"
    export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
  done <"$1"
}

# data.env를 읽어 환경변수로 올린다. 필수 키가 없거나 자리표시자(REPLACE_ME)이면 멈춘다. 값은 출력하지 않는다.
DATA_KEYS="POSTGRES_PASSWORD FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD REDIS_PROD_PASSWORD REDIS_DEV_PASSWORD
  GARAGE_RPC_SECRET GARAGE_ADMIN_TOKEN S3_PROD_ACCESS_KEY S3_PROD_SECRET_KEY S3_DEV_ACCESS_KEY S3_DEV_SECRET_KEY"
load_data_env() {
  local k
  [ -f "$DATA_ENV" ] || die "$DATA_ENV 파일이 없다"
  # 호출한 셸의 환경에 같은 이름이 있어도 파일이 유일한 출처여야 한다
  # shellcheck disable=SC2086
  unset $DATA_KEYS
  read_env_file "$DATA_ENV"
  # shellcheck disable=SC2086
  for k in $DATA_KEYS; do
    [ -n "${!k:-}" ] || die "data.env에 $k가 없다"
    case "${!k}" in *REPLACE_ME*) die "data.env의 $k가 자리표시자(REPLACE_ME)다" ;; esac
  done
  # 비밀번호는 SQL과 compose 보간에 그대로 들어가므로 따옴표, $, 공백이 없는 문자만 쓴다
  for k in POSTGRES_PASSWORD FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD REDIS_PROD_PASSWORD REDIS_DEV_PASSWORD GARAGE_ADMIN_TOKEN; do
    printf '%s' "${!k}" | grep -Eq '^[A-Za-z0-9._~-]{16,}$' || die "data.env의 $k는 영문, 숫자, ._~- 만 쓴 16자 이상이어야 한다"
  done
  printf '%s' "$GARAGE_RPC_SECRET" | grep -Eq '^[0-9a-f]{64}$' || die "data.env의 GARAGE_RPC_SECRET은 64자리 16진수여야 한다"
}

svc_container() { # svc_container 서비스: compose 프로젝트의 컨테이너 ID(없으면 빈 값)
  docker ps -q --filter "label=com.docker.compose.project=$DATA_PROJECT" --filter "label=com.docker.compose.service=$1" | head -n 1
}
require_container() { # require_container 서비스 → 컨테이너 ID
  local c
  c="$(svc_container "$1")"
  [ -n "$c" ] || die "$1 컨테이너가 떠 있지 않다(프로젝트 $DATA_PROJECT)"
  printf '%s' "$c"
}

wait_healthy() { # wait_healthy 서비스 [제한 초]: 컨테이너가 healthy가 될 때까지 기다린다
  local svc="$1" limit c state
  limit=$(($(date +%s) + ${2:-120}))
  while :; do
    c="$(svc_container "$svc")"
    state=""
    if [ -n "$c" ]; then state="$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null | tr -d '\r\n' || true)"; fi
    if [ "$state" = healthy ]; then return 0; fi
    [ "$(date +%s)" -lt "$limit" ] || die "$svc가 healthy가 되지 않았다(상태: ${state:-컨테이너 없음})"
    sleep 2
  done
}

# 슈퍼유저로 psql을 돌린다. SQL은 표준 입력으로 준다(비밀번호가 프로세스 인자에 보이지 않게). 컨테이너 안의 소켓은 trust다
psql_admin() { # psql_admin [psql 인자...]
  docker exec -i "$(require_container postgres)" psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"
}
# role로 접속한다. 비밀번호는 환경변수로 넘긴다. pg_as ROLE PASSWORD DB SQL
# 공식 이미지는 컨테이너 안 loopback(127.0.0.1) 접속을 비밀번호 없이 허용(trust)한다. 서비스 이름(-h postgres)으로 접속하면
# 앱 컨테이너가 쓰는 길과 같아져 scram-sha-256 비밀번호 검사를 받는다.
pg_as() {
  docker exec -i -e "PGPASSWORD=$2" "$(require_container postgres)" psql -h postgres -U "$1" -d "$3" -v ON_ERROR_STOP=1 -qAt -c "$4"
}

native_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# s3tool.py를 net-data에 붙인 python 컨테이너에서 실행한다. 키는 임시 env 파일로 넘겨 프로세스 인자에 보이지 않게 한다.
# s3run ACCESS_KEY SECRET_KEY 명령 인자...
s3run() {
  local access="$1" secret="$2" envf rc=0
  shift 2
  envf="$(mktemp)"
  printf 'S3_ACCESS_KEY=%s\nS3_SECRET_KEY=%s\nS3_ENDPOINT=%s\n' "$access" "$secret" "${FIT_S3_ENDPOINT:-http://garage:3900}" >"$envf"
  docker run --rm -i --network "$NET_DATA" --env-file "$(native_path "$envf")" "$PYTHON_IMAGE" python - "$@" <"$DATA_DIR/s3tool.py" || rc=$?
  rm -f "$envf"
  return "$rc"
}
````

`infra/data/ensure-databases.sh`:

````bash
#!/usr/bin/env bash
# 환경별 DB와 role을 만든다(설계 2.3절, 7.1절). 몇 번 실행해도 같은 결과다(멱등). init 스크립트가 아니라 이 스크립트를 쓰는 이유는
# init 스크립트가 빈 볼륨에서 한 번만 돌기 때문이다(A503 함정). role 비밀번호는 매번 data.env 값으로 맞춘다.
#   bash infra/data/ensure-databases.sh
# role: fit_migrator(DDL), fit_prod_app, fit_dev_app(DML만). DB: fit_prod, fit_dev(소유자 fit_migrator). 각 app role은 자기 DB에만 접속한다.
# dev role에는 statement_timeout 30초를 건다. 비밀번호는 표준 입력으로만 넘기고 서버의 통계·로그에 남지 않게 세션 설정을 끈다.
set -euo pipefail
# shellcheck source=infra/data/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_data_env

log "role과 DB를 맞춘다"
psql_admin -d postgres <<SQL
SET pg_stat_statements.track_utility = off;
SET log_statement = 'none';
SELECT 'CREATE ROLE fit_migrator LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_migrator') \gexec
SELECT 'CREATE ROLE fit_prod_app LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_prod_app') \gexec
SELECT 'CREATE ROLE fit_dev_app LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_dev_app') \gexec
ALTER ROLE fit_migrator PASSWORD '${FIT_MIGRATOR_PASSWORD}';
ALTER ROLE fit_prod_app PASSWORD '${FIT_PROD_APP_PASSWORD}';
ALTER ROLE fit_dev_app PASSWORD '${FIT_DEV_APP_PASSWORD}';
ALTER ROLE fit_dev_app SET statement_timeout = '30s';
SELECT 'CREATE DATABASE fit_prod OWNER fit_migrator' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fit_prod') \gexec
SELECT 'CREATE DATABASE fit_dev OWNER fit_migrator' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fit_dev') \gexec
SQL

for env in prod dev; do
  psql_admin -d "fit_$env" <<SQL
SET client_min_messages = warning;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
REVOKE ALL ON DATABASE fit_$env FROM PUBLIC;
GRANT CONNECT ON DATABASE fit_$env TO fit_${env}_app;
GRANT USAGE ON SCHEMA public TO fit_${env}_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fit_${env}_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fit_${env}_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fit_${env}_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fit_${env}_app;
SQL
done
log "role과 DB가 설계대로다"
````

- [ ] **Step 2: S3 도구와 Garage 스크립트 작성**

`infra/data/s3tool.py`:

````python
"""Garage(S3 호환)를 서명한 요청으로 다루는 도구(표준 라이브러리만 쓴다). 설계 7.4절.

호스트에는 S3 도구가 없고 Garage의 S3 포트는 호스트에 게시하지 않으므로, init-garage.sh·verify-data.sh·files-backup.sh가
python 이미지 컨테이너를 net-data에 붙여 이 파일을 표준 입력으로 실행한다: docker run --rm -i --network net-data python - <명령> ...
접속 정보는 환경변수다: S3_ENDPOINT(기본 http://garage:3900), S3_REGION(garage), S3_ACCESS_KEY, S3_SECRET_KEY.
키 값은 출력하지 않는다.

명령
  put BUCKET KEY TEXT          객체를 올린다. 첫 줄에 `HTTP <코드>`를 출력한다
  get BUCKET KEY               객체를 읽는다. 첫 줄에 `HTTP <코드>`, 이어서 본문
  anon-get URL [HOST]          서명 없이 읽는다(웹 엔드포인트나 S3 API의 익명 접근 시험). 첫 줄에 `HTTP <코드>`
  delete BUCKET KEY            객체를 지운다
  lifecycle-set BUCKET         pending/ 접두사의 객체와 끝나지 않은 멀티파트를 1일 뒤 지운다
  lifecycle-get BUCKET         수명주기 설정을 읽는다
  tar-stdout BUCKET PREFIX     PREFIX 아래 모든 객체를 tar로 표준 출력에 낸다(사진 백업)
"""
import datetime
import hashlib
import hmac
import io
import os
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ENDPOINT = os.environ.get("S3_ENDPOINT", "http://garage:3900")
REGION = os.environ.get("S3_REGION", "garage")
ACCESS = os.environ.get("S3_ACCESS_KEY", "")
SECRET = os.environ.get("S3_SECRET_KEY", "")
HOST = urllib.parse.urlparse(ENDPOINT).netloc

LIFECYCLE = (
    "<LifecycleConfiguration><Rule><ID>pending-expire</ID><Status>Enabled</Status>"
    "<Filter><Prefix>pending/</Prefix></Filter><Expiration><Days>1</Days></Expiration>"
    "<AbortIncompleteMultipartUpload><DaysAfterInitiation>1</DaysAfterInitiation></AbortIncompleteMultipartUpload>"
    "</Rule></LifecycleConfiguration>"
)


def _hmac(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def request(method, path, query=None, body=b""):
    """SigV4(헤더 서명, path-style)로 서명해 보낸다. (상태 코드, 본문 바이트 읽는 응답)을 돌려준다."""
    query = query or {}
    now = datetime.datetime.now(datetime.timezone.utc)
    amzdate, datestamp = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()
    canonical_query = "&".join(
        f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}" for k, v in sorted(query.items())
    )
    canonical_path = urllib.parse.quote(path, safe="/-_.~")
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical = "\n".join(
        [
            method,
            canonical_path,
            canonical_query,
            f"host:{HOST}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amzdate}\n",
            signed_headers,
            payload_hash,
        ]
    )
    scope = f"{datestamp}/{REGION}/s3/aws4_request"
    to_sign = f"AWS4-HMAC-SHA256\n{amzdate}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    key = _hmac(_hmac(_hmac(_hmac(("AWS4" + SECRET).encode(), datestamp), REGION), "s3"), "aws4_request")
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    headers = {
        "x-amz-date": amzdate,
        "x-amz-content-sha256": payload_hash,
        "Authorization": f"AWS4-HMAC-SHA256 Credential={ACCESS}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
    }
    url = ENDPOINT + canonical_path + ("?" + canonical_query if query else "")
    req = urllib.request.Request(url, data=body if method in ("PUT", "POST") else None, method=method, headers=headers)
    try:
        return urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        return e


def status_and_body(resp):
    return resp.getcode(), resp.read()


def list_keys(bucket, prefix):
    token = None
    while True:
        query = {"list-type": "2", "prefix": prefix}
        if token:
            query["continuation-token"] = token
        code, data = status_and_body(request("GET", f"/{bucket}", query))
        if code != 200:
            raise SystemExit(f"목록 조회 실패(HTTP {code})")
        root = ET.fromstring(data)
        ns = {"s": root.tag.split("}")[0].strip("{")} if "}" in root.tag else {}
        tag = (lambda n: f"s:{n}") if ns else (lambda n: n)
        for item in root.findall(tag("Contents"), ns):
            yield item.find(tag("Key"), ns).text
        if (root.findtext(tag("IsTruncated"), namespaces=ns) or "false") != "true":
            return
        token = root.findtext(tag("NextContinuationToken"), namespaces=ns)


def tar_stdout(bucket, prefix):
    out = sys.stdout.buffer
    count = 0
    with tarfile.open(fileobj=out, mode="w|") as tar:
        for key in list_keys(bucket, prefix):
            code, data = status_and_body(request("GET", f"/{bucket}/{key}"))
            if code != 200:
                raise SystemExit(f"{key} 읽기 실패(HTTP {code})")
            info = tarfile.TarInfo(name=key)
            info.size = len(data)
            info.mtime = int(datetime.datetime.now().timestamp())
            tar.addfile(info, io.BytesIO(data))
            count += 1
    print(f"객체 {count}개", file=sys.stderr)


def main(argv):
    cmd = argv[0] if argv else ""
    if cmd == "put":
        resp = request("PUT", f"/{argv[1]}/{argv[2]}", body=argv[3].encode())
        print(f"HTTP {resp.getcode()}")
    elif cmd == "get":
        code, data = status_and_body(request("GET", f"/{argv[1]}/{argv[2]}"))
        print(f"HTTP {code}")
        print(data.decode("utf-8", errors="replace"))
    elif cmd == "anon-get":
        headers = {"Host": argv[2]} if len(argv) > 2 else {}
        try:
            resp = urllib.request.urlopen(urllib.request.Request(argv[1], headers=headers), timeout=30)
            print(f"HTTP {resp.getcode()}")
            print(resp.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code}")
    elif cmd == "delete":
        print(f"HTTP {request('DELETE', f'/{argv[1]}/{argv[2]}').getcode()}")
    elif cmd == "lifecycle-set":
        print(f"HTTP {request('PUT', f'/{argv[1]}', {'lifecycle': ''}, LIFECYCLE.encode()).getcode()}")
    elif cmd == "lifecycle-get":
        code, data = status_and_body(request("GET", f"/{argv[1]}", {"lifecycle": ""}))
        print(f"HTTP {code}")
        print(data.decode("utf-8", errors="replace"))
    elif cmd == "tar-stdout":
        tar_stdout(argv[1], argv[2])
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
````

`infra/data/init-garage.sh`:

````bash
#!/usr/bin/env bash
# Garage를 한 번 초기화한다(설계 7.4절). 몇 번 실행해도 같은 결과다(멱등). 단일 노드도 레이아웃을 적용해야 버킷을 만들 수 있다.
#   bash infra/data/init-garage.sh
# 레이아웃, 버킷(fit-prod-photos, fit-dev-photos), 환경 전용 키(자기 버킷에만 권한), 웹 엔드포인트 공개 읽기, 수명주기(pending/ 1일 뒤 삭제)를 맞춘다.
# 키 ID는 GK로 시작하는 26자리, 비밀 키는 64자리 16진수여야 한다(Garage의 key import 형식). 이 스크립트는 기존 키를 바꾸지 않는다(교체는 RB-08).
set -euo pipefail
# shellcheck source=infra/data/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_data_env

GARAGE="$(require_container garage)"
garage() { docker exec -e RUST_LOG=warn "$GARAGE" /garage -c /etc/garage/garage.toml "$@"; }

printf '%s%s' "$S3_PROD_ACCESS_KEY" "$S3_DEV_ACCESS_KEY" | grep -Eq '^(GK[0-9a-f]{24}){2}$' || die "S3 키 ID는 GK로 시작하는 26자리(GK + 16진수 24자리)여야 한다"
printf '%s%s' "$S3_PROD_SECRET_KEY" "$S3_DEV_SECRET_KEY" | grep -Eq '^[0-9a-f]{128}$' || die "S3 비밀 키는 각각 64자리 16진수여야 한다"

if garage status 2>/dev/null | grep -q "NO ROLE ASSIGNED"; then
  node="$(garage status 2>/dev/null | awk '/^[0-9a-f]{16}/ { print $1; exit }')"
  garage layout assign -z dc1 -c 1G "$node" >/dev/null
  garage layout apply --version 1 >/dev/null
  log "레이아웃을 적용했다"
fi

for env in prod dev; do
  bucket="fit-$env-photos"
  access_var="S3_$(printf '%s' "$env" | tr '[:lower:]' '[:upper:]')_ACCESS_KEY"
  secret_var="S3_$(printf '%s' "$env" | tr '[:lower:]' '[:upper:]')_SECRET_KEY"
  garage bucket info "$bucket" >/dev/null 2>&1 || garage bucket create "$bucket" >/dev/null
  garage key info "${!access_var}" >/dev/null 2>&1 || garage key import --yes -n "fit-$env" "${!access_var}" "${!secret_var}" >/dev/null
  garage bucket allow --read --write --owner "$bucket" --key "${!access_var}" >/dev/null
  garage bucket website --allow "$bucket" >/dev/null
  s3run "${!access_var}" "${!secret_var}" lifecycle-set "$bucket" | grep -q '^HTTP 200' || die "$bucket 수명주기를 설정하지 못했다"
  log "$bucket 준비됨(키, 권한, 웹 읽기, 수명주기)"
done
````

- [ ] **Step 3: 진입점과 점검 스크립트 작성**

`infra/data/init-data.sh`:

````bash
#!/usr/bin/env bash
# 데이터 스택이 뜬 뒤 DB와 버킷을 맞춘다. fit-up.sh와 사람이 부른다. 몇 번 실행해도 같은 결과다(멱등).
#   bash infra/data/init-data.sh
# postgres와 garage가 healthy가 될 때까지 기다린 뒤 ensure-databases.sh와 init-garage.sh를 차례로 돌린다.
set -euo pipefail
# shellcheck source=infra/data/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

wait_healthy postgres
wait_healthy garage
bash "$DATA_DIR/ensure-databases.sh"
bash "$DATA_DIR/init-garage.sh"
log "데이터 초기화 완료"
````

`infra/data/verify-data.sh`:

````bash
#!/usr/bin/env bash
# 데이터 스택이 설계대로 떠 있는지 점검한다(설계 7절). 값을 바꾸지 않는다(사진 점검용 객체 하나를 올리고 바로 지운다).
#   bash infra/data/verify-data.sh
# 점검마다 PASS 또는 FAIL만 출력하고 비밀 값은 찍지 않는다. 하나라도 FAIL이면 종료 코드 1이다.
# 시험에서 OpenSearch를 띄우지 않을 때는 FIT_VERIFY_SKIP_OPENSEARCH=1로 그 점검을 건너뛴다.
set -uo pipefail
# shellcheck source=infra/data/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_data_env

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }
succeeds() { if "$@" >/dev/null 2>&1; then echo 1; else echo 0; fi; }
fails() { if "$@" >/dev/null 2>&1; then echo 0; else echo 1; fi; }

health() { # health 서비스 → healthy 여부(0/1)
  local c
  c="$(svc_container "$1")"
  if [ -n "$c" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" = healthy ]; then echo 1; else echo 0; fi
}

for svc in postgres opensearch redis-prod redis-dev garage; do
  if [ "$svc" = opensearch ] && [ "${FIT_VERIFY_SKIP_OPENSEARCH:-0}" = 1 ]; then continue; fi
  ok_if "$svc가 healthy다" "$(health "$svc")"
done

# --- Postgres: 환경별 DB와 role, 접속 범위 ---
ok_if "DB fit_prod와 fit_dev가 있다" "$([ "$(psql_admin -d postgres -c "SELECT count(*) FROM pg_database WHERE datname IN ('fit_prod','fit_dev')" 2>/dev/null)" = 2 ] && echo 1 || echo 0)"
for env in prod dev; do
  pw_var="FIT_$(printf '%s' "$env" | tr '[:lower:]' '[:upper:]')_APP_PASSWORD"
  other=dev
  if [ "$env" = dev ]; then other=prod; fi
  ok_if "fit_${env}_app이 fit_$env에 접속한다" "$(succeeds pg_as "fit_${env}_app" "${!pw_var}" "fit_$env" 'SELECT 1')"
  ok_if "fit_${env}_app은 fit_$other에 접속하지 못한다" "$(fails pg_as "fit_${env}_app" "${!pw_var}" "fit_$other" 'SELECT 1')"
  ok_if "fit_$env에 vector와 pg_stat_statements가 있다" \
    "$([ "$(psql_admin -d "fit_$env" -c "SELECT count(*) FROM pg_extension WHERE extname IN ('vector','pg_stat_statements')" 2>/dev/null)" = 2 ] && echo 1 || echo 0)"
  ok_if "fit_${env}_app은 테이블을 만들지 못한다(DDL은 fit_migrator만)" "$(fails pg_as "fit_${env}_app" "${!pw_var}" "fit_$env" 'CREATE TABLE verify_denied (id int)')"
done
ok_if "fit_migrator가 fit_prod에서 테이블을 만들 수 있다" "$(succeeds pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'CREATE TEMP TABLE verify_ddl (id int)')"
ok_if "dev 앱 role에 쿼리 시간 제한 30초가 걸려 있다" "$(succeeds pg_as fit_dev_app "$FIT_DEV_APP_PASSWORD" fit_dev "SELECT 1 WHERE current_setting('statement_timeout') = '30s'")"
pg_super() { docker exec -e "PGPASSWORD=$1" "$(svc_container postgres)" psql -h postgres -U postgres -d postgres -c 'SELECT 1'; }
ok_if "슈퍼유저 postgres는 네트워크로 접속할 때 비밀번호를 쓴다" "$(succeeds pg_super "$POSTGRES_PASSWORD")"
ok_if "틀린 비밀번호는 거부한다" "$(fails pg_super "wrong-$POSTGRES_PASSWORD")"

# --- Redis: 인증과 메모리 정책 ---
for env in prod dev; do
  pw_var="REDIS_$(printf '%s' "$env" | tr '[:lower:]' '[:upper:]')_PASSWORD"
  c="$(svc_container "redis-$env")"
  ok_if "redis-$env는 인증 없이는 명령을 받지 않는다" "$([ "$(docker exec "$c" env -u REDISCLI_AUTH redis-cli ping 2>&1 | grep -c NOAUTH)" = 1 ] && echo 1 || echo 0)"
  ok_if "redis-$env는 비밀번호로 PONG을 돌려준다" "$([ "$(docker exec -e "REDISCLI_AUTH=${!pw_var}" "$c" redis-cli ping 2>/dev/null)" = PONG ] && echo 1 || echo 0)"
  ok_if "redis-$env의 maxmemory-policy가 noeviction이다" \
    "$([ "$(docker exec -e "REDISCLI_AUTH=${!pw_var}" "$c" redis-cli config get maxmemory-policy 2>/dev/null | tail -n 1)" = noeviction ] && echo 1 || echo 0)"
  ok_if "redis-$env의 AOF가 켜져 있다" \
    "$([ "$(docker exec -e "REDISCLI_AUTH=${!pw_var}" "$c" redis-cli config get appendonly 2>/dev/null | tail -n 1)" = yes ] && echo 1 || echo 0)"
done
ok_if "dev 비밀번호로는 prod Redis에 들어가지 못한다" \
  "$(succeeds grep -q -E 'WRONGPASS|NOAUTH' <<<"$(docker exec -e "REDISCLI_AUTH=$REDIS_DEV_PASSWORD" "$(svc_container redis-prod)" redis-cli ping 2>&1)")"

# --- Garage: 버킷 분리, 공개 읽기, 수명주기 ---
if [ "$(health garage)" = 1 ]; then
  probe="verify-$$.txt"
  prod() { s3run "$S3_PROD_ACCESS_KEY" "$S3_PROD_SECRET_KEY" "$@" 2>&1; }
  dev() { s3run "$S3_DEV_ACCESS_KEY" "$S3_DEV_SECRET_KEY" "$@" 2>&1; }
  first_line() { head -n 1 <<<"$1"; }
  out="$(prod put fit-prod-photos "$probe" hello-prod)"
  ok_if "prod 키로 fit-prod-photos에 올릴 수 있다" "$([ "$(first_line "$out")" = 'HTTP 200' ] && echo 1 || echo 0)"
  out="$(prod get fit-prod-photos "$probe")"
  ok_if "prod 키로 올린 객체를 읽을 수 있다" "$(succeeds grep -q hello-prod <<<"$out")"
  out="$(dev put fit-prod-photos "$probe-dev" nope)"
  ok_if "dev 키는 fit-prod-photos에 쓸 수 없다" "$([ "$(first_line "$out")" = 'HTTP 403' ] && echo 1 || echo 0)"
  out="$(prod anon-get "http://garage:3900/fit-prod-photos/$probe")"
  ok_if "서명 없이는 S3 API로 읽을 수 없다" "$([ "$(first_line "$out")" = 'HTTP 403' ] && echo 1 || echo 0)"
  out="$(prod anon-get "http://garage:3902/$probe" fit-prod-photos.web.garage.localhost)"
  ok_if "웹 엔드포인트로는 서명 없이 읽을 수 있다" "$([ "$(first_line "$out")" = 'HTTP 200' ] && echo 1 || echo 0)"
  out="$(prod lifecycle-get fit-prod-photos)"
  ok_if "수명주기(pending/ 1일)가 걸려 있다" "$(succeeds grep -q 'pending/' <<<"$out")"
  prod delete fit-prod-photos "$probe" >/dev/null
fi

# --- OpenSearch: nori 분석기 ---
if [ "${FIT_VERIFY_SKIP_OPENSEARCH:-0}" != 1 ]; then
  ok_if "OpenSearch에 nori 분석기가 있다" \
    "$([ "$(docker exec "$(svc_container opensearch)" curl -s -X POST 'localhost:9200/_analyze' -H 'Content-Type: application/json' -d '{"analyzer":"nori","text":"닭가슴살"}' 2>/dev/null | grep -c '"token"')" -ge 1 ] && echo 1 || echo 0)"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "실패 $FAILED건"
  exit 1
fi
echo "데이터 스택이 설계대로다"
````

- [ ] **Step 4: shellcheck와 입력 검증 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
chmod +x infra/data/*.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/data/lib.sh infra/data/ensure-databases.sh infra/data/init-garage.sh infra/data/init-data.sh infra/data/verify-data.sh; echo "shellcheck exit=$?"
FIT_DATA_ENV=/nonexistent bash infra/data/ensure-databases.sh; echo "exit=$?"
cp infra/data/data.env.example /tmp/placeholder.env
FIT_DATA_ENV=/tmp/placeholder.env bash infra/data/ensure-databases.sh; echo "exit=$?"
python -c "import ast; ast.parse(open('infra/data/s3tool.py', encoding='utf-8').read()); print('s3tool OK')"
```

Expected: `shellcheck exit=0`. 두 번의 `ensure-databases.sh`는 각각 `FAIL …파일이 없다`, `FAIL data.env의 POSTGRES_PASSWORD가 자리표시자(REPLACE_ME)다`를 stderr에 내고 `exit=1`이다(값을 출력하지 않는다). `s3tool OK`. 실제 동작은 Task 3의 시험이 확인한다.

- [ ] **Step 5: 커밋 (허용된 경우)**

```bash
git add infra/data
git update-index --chmod=+x infra/data/ensure-databases.sh infra/data/init-garage.sh infra/data/init-data.sh infra/data/verify-data.sh
git commit -m "feat(infra): DB·버킷 멱등 초기화와 데이터 스택 점검 스크립트 추가"
```

---

### Task 3: 데이터 시험

**목표:** 서버 없이 실제 Postgres(pgvector), Redis 2개, Garage를 띄워 초기화·멱등·권한 격리·입력 검증·재시작·포트·비밀 값 노출을 확인한다.

**Files:**
- Create: `infra/data/test/compose.test.yml`, `infra/data/test/test-data.sh`
- Modify: `infra/ci/compose-projects.txt`

**Interfaces:**
- Consumes: Task 1·2의 compose와 스크립트, 1F의 `networks.sh`(접두사 `fit-datatest-`)
- Produces: `bash infra/data/test/test-data.sh up|run [구역...]|down`. 구역: `init idempotent rotation privilege input redis postgres garage port hygiene`. `FIT_TEST_OPENSEARCH=1`이면 OpenSearch(이미지 빌드, 메모리 2GB)도 띄우고 nori까지 점검한다. 호스트 Postgres 포트는 55432(`FIT_DATATEST_PG_PORT`)

시나리오(구역):

- `init`: 첫 초기화가 Garage 레이아웃을 적용하고 `verify-data.sh`가 모두 통과한다. net-data는 internal이다.
- `idempotent`: 다시 실행해도 레이아웃을 다시 적용하지 않고 role 3개·DB 2개 그대로이며 기존 데이터(Postgres 행, Garage 객체)를 건드리지 않는다.
- `rotation`: `data.env`의 새 비밀번호로 다시 실행하면 옛 비밀번호가 거부되고 새 비밀번호가 통한다.
- `privilege`: 마이그레이터가 만든 테이블에 앱 role이 DML하고 DDL·TRUNCATE·DROP은 못 한다, dev 앱 role은 prod DB에 접속하지 못한다, 슈퍼유저가 만든 테이블은 재실행 뒤에 읽힌다.
- `input`: 형식이 틀린 키(`GK` 아님, 64자리 아님), 자리표시자, 누락, 따옴표·SQL 주입, 셸 문법(`$(touch ...)`), 짧은 비밀번호, 없는 파일을 모두 거부하고 거부 메시지에 값이 없다.
- `redis`: maxmemory를 넘으면 쫓아내지 않고 `OOM`으로 거절하고 기존 키가 남는다, 두 Redis의 데이터가 따로이고 재시작해도 AOF로 돌아온다.
- `postgres`: 튜닝 플래그, pgvector, 비밀번호가 로그와 `pg_stat_statements`에 없다, 재시작해도 데이터가 남고 초기화가 그대로 성공한다.
- `garage`: dev 키와 prod 키가 서로의 버킷을 읽지 못한다, dev 버킷에도 수명주기가 있다, 재시작해도 객체와 레이아웃이 남는다, `tar-stdout`이 버킷을 tar로 낸다.
- `port`: redis·garage는 게시하지 않고 postgres는 `127.0.0.1`에만 게시한다.
- `hygiene`: 모든 스크립트 출력에 비밀 값이 없다.

- [ ] **Step 1: 시험 compose 오버라이드와 시험 스크립트 작성**

`infra/data/test/compose.test.yml`: 노트북에서 5432가 이미 쓰일 수 있어 호스트 포트만 바꾼다.

````yaml
# 시험용 덮어쓰기. 노트북에서 5432가 이미 쓰이고 있을 수 있어 호스트 포트만 바꾼다(127.0.0.1에만 열리는 점은 같다).
services:
  postgres:
    ports: !override
      - 127.0.0.1:${FIT_DATATEST_PG_PORT:-55432}:5432
````

`infra/data/test/test-data.sh`:

````bash
#!/usr/bin/env bash
# 데이터 스택을 노트북에서 시험한다(설계 10.5절). 실제 Postgres(pgvector), Redis 2개, Garage를 띄우고 초기화 스크립트를 돌린다.
#   bash infra/data/test/test-data.sh up     # 가짜 서버 디렉터리, 공유 망, 데이터 스택을 만든다
#   bash infra/data/test/test-data.sh run    # 초기화·멱등·권한·입력 검증·재시작 시나리오를 돌린다
#   bash infra/data/test/test-data.sh down   # 시험이 만든 컨테이너, 볼륨, 망, 디렉터리를 지운다
# 필요한 것: docker compose(2.24 이상). 시험용 이름은 접두사 fit-datatest로 시작한다.
# OpenSearch는 이미지를 빌드하고 메모리를 많이 쓰므로 기본으로는 띄우지 않는다. FIT_TEST_OPENSEARCH=1이면 함께 띄우고 nori까지 점검한다.
# 시험용 서버는 저장소 안의 .tmp-datatest/에 있다(data.env). 값은 매번 무작위로 만든다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
W="$(pwd -W 2>/dev/null || pwd)"
T="$W/.tmp-datatest"
PREFIX=fit-datatest-
PROJECT=fit-datatest

export FIT_ENV_DIR="$T/etc" FIT_DATA_ENV="$T/etc/data.env" FIT_DATA_PROJECT="$PROJECT"
export FIT_NET_PREFIX="$PREFIX" FIT_NET_DATA="${PREFIX}net-data" FIT_NET_EDGE="${PREFIX}net-edge" FIT_NET_DBACCESS="${PREFIX}net-dbaccess"
export FIT_DATATEST_PG_PORT="${FIT_DATATEST_PG_PORT:-55432}"

dc() { docker compose -p "$PROJECT" -f "$W/infra/data/compose.data.yml" -f "$W/infra/data/test/compose.test.yml" --env-file "$T/etc/data.env" "$@"; }
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

make_env() {
  mkdir -p "$T/etc"
  {
    echo "POSTGRES_PASSWORD=$(hex 12)"
    echo "FIT_MIGRATOR_PASSWORD=$(hex 12)"
    echo "FIT_PROD_APP_PASSWORD=$(hex 12)"
    echo "FIT_DEV_APP_PASSWORD=$(hex 12)"
    echo "REDIS_PROD_PASSWORD=$(hex 12)"
    echo "REDIS_DEV_PASSWORD=$(hex 12)"
    echo "GARAGE_RPC_SECRET=$(hex 32)"
    echo "GARAGE_ADMIN_TOKEN=$(hex 16)"
    echo "S3_PROD_ACCESS_KEY=GK$(hex 12)"
    echo "S3_PROD_SECRET_KEY=$(hex 32)"
    echo "S3_DEV_ACCESS_KEY=GK$(hex 12)"
    echo "S3_DEV_SECRET_KEY=$(hex 32)"
  } >"$T/etc/data.env"
}

up() {
  down >/dev/null 2>&1 || true
  mkdir -p "$T"
  make_env
  bash infra/host/networks.sh
  local -a services=(postgres redis-prod redis-dev garage)
  if [ "${FIT_TEST_OPENSEARCH:-0}" = 1 ]; then services+=(opensearch); fi
  dc up -d --build --wait --wait-timeout 300 "${services[@]}"
  echo "데이터 시험 환경이 떴다(프로젝트 $PROJECT)"
}

down() {
  docker compose -p "$PROJECT" down -v --remove-orphans >/dev/null 2>&1 || true
  local n
  for n in net-edge net-prod net-dev net-data net-obs net-dbaccess; do docker network rm "$PREFIX$n" >/dev/null 2>&1 || true; done
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
succeeds() { if "$@" >/dev/null 2>&1; then echo 1; else echo 0; fi; }
fails() { if "$@" >/dev/null 2>&1; then echo 0; else echo 1; fi; }
OUT_ALL=""
rc=0
out=""

# 시험이 쓰는 함수(psql_admin, pg_as, s3run, svc_container 등)는 스크립트와 같은 lib.sh에서 온다
# shellcheck source=infra/data/lib.sh
. infra/data/lib.sh

run_script() { # run_script 스크립트 [환경 파일]: out, rc를 채운다. 모든 출력을 OUT_ALL에 모은다
  out="$(FIT_DATA_ENV="${2:-$T/etc/data.env}" bash "infra/data/$1" 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
}
mod_env() { # mod_env 이름 sed식 → 이름.env 파일 경로를 돌려준다
  sed -e "$2" "$T/etc/data.env" >"$T/etc/$1.env"
  printf '%s' "$T/etc/$1.env"
}
val() { sed -n "s/^$1=//p" "$T/etc/data.env"; }
rcli() { # rcli prod|dev 인자...
  local pw
  if [ "$1" = prod ]; then pw="$REDIS_PROD_PASSWORD"; else pw="$REDIS_DEV_PASSWORD"; fi
  docker exec -e "REDISCLI_AUTH=$pw" "$(svc_container "redis-$1")" redis-cli "${@:2}"
}
prod_s3() { s3run "$S3_PROD_ACCESS_KEY" "$S3_PROD_SECRET_KEY" "$@" 2>&1; }
dev_s3() { s3run "$S3_DEV_ACCESS_KEY" "$S3_DEV_SECRET_KEY" "$@" 2>&1; }
first_line() { head -n 1 <<<"$1"; }
restart_svc() { # restart_svc 서비스: 컨테이너를 재시작하고 healthy를 기다린다
  docker restart "$(svc_container "$1")" >/dev/null
  wait_healthy "$1" 90
}

run_init_checks() {
  echo "--- 초기화"
  run_script init-data.sh
  ok_if "init-data.sh가 성공한다" "$(is "$rc" 0)"
  ok_if "첫 실행은 Garage 레이아웃을 적용한다" "$(has "$out" '레이아웃을 적용했다')"
  local skip_os=1
  if [ "${FIT_TEST_OPENSEARCH:-0}" = 1 ]; then skip_os=0; fi
  out="$(FIT_VERIFY_SKIP_OPENSEARCH=$skip_os bash infra/data/verify-data.sh 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "verify-data.sh가 모두 통과한다" "$(is "$rc" 0)"
  if [ "$rc" != 0 ]; then out="$(grep '^FAIL' <<<"$out" || true)"; fi
  ok_if "net-data는 internal 망이다" "$(is "$(docker network inspect -f '{{.Internal}}' "${PREFIX}net-data")" true)"
}

run_idempotent_checks() {
  echo "--- 멱등"
  prod_s3 put fit-prod-photos keep.txt keep-me >/dev/null
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'CREATE TABLE keep_rows (id int)' >/dev/null
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'INSERT INTO keep_rows VALUES (7)' >/dev/null
  run_script init-data.sh
  ok_if "다시 실행해도 성공한다" "$(is "$rc" 0)"
  ok_if "두 번째 실행은 Garage 레이아웃을 다시 적용하지 않는다" "$(is "$(has "$out" '레이아웃을 적용했다')" 0)"
  ok_if "role은 3개뿐이다" "$(is "$(psql_admin -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'fit\\_%'")" 3)"
  ok_if "DB는 2개뿐이다" "$(is "$(psql_admin -d postgres -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'fit\\_%'")" 2)"
  ok_if "재실행이 기존 데이터를 건드리지 않는다(Postgres)" "$(is "$(pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'SELECT id FROM keep_rows')" 7)"
  out="$(prod_s3 get fit-prod-photos keep.txt)"
  ok_if "재실행이 기존 객체를 건드리지 않는다(Garage)" "$(has "$out" keep-me)"
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'DROP TABLE keep_rows' >/dev/null
  prod_s3 delete fit-prod-photos keep.txt >/dev/null
}

run_rotation_checks() {
  echo "--- 비밀번호 교체"
  local newpw rotated
  newpw="$(hex 12)rotated"
  rotated="$(mod_env rotated "s/^FIT_PROD_APP_PASSWORD=.*/FIT_PROD_APP_PASSWORD=$newpw/")"
  run_script ensure-databases.sh "$rotated"
  ok_if "data.env의 새 비밀번호로 ensure-databases.sh가 성공한다" "$(is "$rc" 0)"
  ok_if "옛 비밀번호는 더 이상 통하지 않는다" "$(fails pg_as fit_prod_app "$FIT_PROD_APP_PASSWORD" fit_prod 'SELECT 1')"
  ok_if "새 비밀번호로 접속한다" "$(succeeds pg_as fit_prod_app "$newpw" fit_prod 'SELECT 1')"
  run_script ensure-databases.sh
  ok_if "원래 값으로 되돌릴 수 있다" "$(succeeds pg_as fit_prod_app "$FIT_PROD_APP_PASSWORD" fit_prod 'SELECT 1')"
}

run_privilege_checks() {
  echo "--- 권한"
  local m="$FIT_MIGRATOR_PASSWORD" p="$FIT_PROD_APP_PASSWORD" d="$FIT_DEV_APP_PASSWORD"
  pg_as fit_migrator "$m" fit_prod 'CREATE TABLE t_flow (id serial PRIMARY KEY, name text)' >/dev/null
  ok_if "마이그레이터가 만든 테이블에 prod 앱 role이 INSERT한다(시퀀스 포함)" "$(succeeds pg_as fit_prod_app "$p" fit_prod "INSERT INTO t_flow (name) VALUES ('a')")"
  ok_if "prod 앱 role이 SELECT·UPDATE·DELETE한다" \
    "$(succeeds pg_as fit_prod_app "$p" fit_prod "UPDATE t_flow SET name = 'b'; SELECT * FROM t_flow; DELETE FROM t_flow")"
  ok_if "앱 role은 테이블을 지우지 못한다" "$(fails pg_as fit_prod_app "$p" fit_prod 'DROP TABLE t_flow')"
  ok_if "앱 role은 컬럼을 바꾸지 못한다" "$(fails pg_as fit_prod_app "$p" fit_prod 'ALTER TABLE t_flow ADD COLUMN x int')"
  ok_if "앱 role은 TRUNCATE하지 못한다" "$(fails pg_as fit_prod_app "$p" fit_prod 'TRUNCATE t_flow')"
  ok_if "dev 앱 role은 prod DB에 접속하지 못한다" "$(fails pg_as fit_dev_app "$d" fit_prod 'SELECT 1')"
  ok_if "prod 앱 role은 dev DB에 접속하지 못한다" "$(fails pg_as fit_prod_app "$p" fit_dev 'SELECT 1')"
  psql_admin -d fit_prod -c 'CREATE TABLE t_super (id int)' >/dev/null
  ok_if "슈퍼유저가 만든 테이블은 재실행 전까지 앱 role이 못 읽는다" "$(fails pg_as fit_prod_app "$p" fit_prod 'SELECT * FROM t_super')"
  run_script ensure-databases.sh
  ok_if "ensure-databases.sh 재실행이 기존 테이블에도 권한을 준다" "$(succeeds pg_as fit_prod_app "$p" fit_prod 'SELECT * FROM t_super')"
  psql_admin -d fit_prod -c 'DROP TABLE t_super; DROP TABLE t_flow' >/dev/null
}

run_input_checks() {
  echo "--- 입력 검증"
  local f secret
  f="$(mod_env badkey 's/^S3_PROD_ACCESS_KEY=.*/S3_PROD_ACCESS_KEY=short/')"
  run_script init-garage.sh "$f"
  ok_if "형식이 틀린 S3 키 ID는 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'GK')" = 1 ] && echo 1 || echo 0)"
  f="$(mod_env badsecret 's/^S3_DEV_SECRET_KEY=.*/S3_DEV_SECRET_KEY=nothex/')"
  run_script init-garage.sh "$f"
  ok_if "형식이 틀린 S3 비밀 키는 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '64자리')" = 1 ] && echo 1 || echo 0)"
  f="$(mod_env placeholder 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=REPLACE_ME/')"
  run_script ensure-databases.sh "$f"
  ok_if "자리표시자(REPLACE_ME)가 남아 있으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'REPLACE_ME')" = 1 ] && echo 1 || echo 0)"
  f="$(mod_env missing '/^REDIS_DEV_PASSWORD=/d')"
  run_script ensure-databases.sh "$f"
  ok_if "필수 키가 없으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'REDIS_DEV_PASSWORD')" = 1 ] && echo 1 || echo 0)"
  f="$(mod_env sqlinject "s/^FIT_DEV_APP_PASSWORD=.*/FIT_DEV_APP_PASSWORD=aaaaaaaaaaaaaaaa'; CREATE ROLE fit_injected; --/")"
  run_script ensure-databases.sh "$f"
  ok_if "따옴표가 든 비밀번호는 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  ok_if "거부된 값이 SQL로 실행되지 않는다" "$(is "$(psql_admin -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname = 'fit_injected'")" 0)"
  f="$(mod_env shellsyntax "s|^FIT_DEV_APP_PASSWORD=.*|FIT_DEV_APP_PASSWORD=\$(touch $T/pwned)aaaaaaaaaaaaaaaa|")"
  run_script ensure-databases.sh "$f"
  ok_if "비밀번호 값 안의 셸 문법은 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  ok_if "값 안의 셸 문법이 실행되지 않는다" "$([ ! -e "$T/pwned" ] && echo 1 || echo 0)"
  f="$(mod_env short 's/^FIT_DEV_APP_PASSWORD=.*/FIT_DEV_APP_PASSWORD=tooshort/')"
  run_script ensure-databases.sh "$f"
  ok_if "16자 미만 비밀번호는 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  run_script ensure-databases.sh "$T/etc/none.env"
  ok_if "env 파일이 없으면 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  for secret in POSTGRES_PASSWORD FIT_DEV_APP_PASSWORD S3_PROD_SECRET_KEY; do
    ok_if "거부 메시지에 $secret 값이 찍히지 않는다" "$(is "$(has "$OUT_ALL" "$(val "$secret")")" 0)"
  done
}

run_redis_checks() {
  echo "--- Redis"
  rcli prod set keep-me 1 >/dev/null
  rcli prod config set maxmemory 2mb >/dev/null
  rcli prod eval "for i=1,6 do redis.call('set','fill'..i,string.rep('x',1024*1024)) end" 0 >/dev/null 2>&1 || true
  out="$(rcli prod set another x 2>&1 || true)"
  ok_if "maxmemory를 넘으면 쫓아내지 않고 쓰기를 거절한다(noeviction)" "$(has "$out" OOM)"
  ok_if "넘친 뒤에도 기존 키가 남아 있다" "$(is "$(rcli prod get keep-me)" 1)"
  rcli prod eval "for i=1,6 do redis.call('del','fill'..i) end" 0 >/dev/null 2>&1 || true
  rcli prod config set maxmemory 96mb >/dev/null
  rcli prod set persist-me yes >/dev/null
  rcli dev set dev-only 1 >/dev/null
  ok_if "prod와 dev Redis는 데이터가 따로다" "$(is "$(rcli prod get dev-only)" '')"
  sleep 2
  restart_svc redis-prod
  ok_if "재시작해도 AOF로 데이터가 돌아온다" "$(is "$(rcli prod get persist-me)" yes)"
  rcli prod del keep-me persist-me >/dev/null
  rcli dev del dev-only >/dev/null
}

run_postgres_checks() {
  echo "--- Postgres"
  ok_if "shared_buffers가 256MB다" "$(is "$(psql_admin -d postgres -c 'SHOW shared_buffers')" 256MB)"
  ok_if "max_connections가 60이다" "$(is "$(psql_admin -d postgres -c 'SHOW max_connections')" 60)"
  ok_if "idle_in_transaction_session_timeout이 1분이다" "$(is "$(psql_admin -d postgres -c 'SHOW idle_in_transaction_session_timeout')" 1min)"
  ok_if "pgvector가 동작한다" "$(is "$(pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_dev "SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector")" 1)"
  local k bad=0
  for k in FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD; do
    if docker logs "$(svc_container postgres)" 2>&1 | grep -qF "$(val "$k")"; then bad=1; fi
  done
  ok_if "role 비밀번호가 Postgres 로그에 남지 않는다" "$(is "$bad" 0)"
  ok_if "role 비밀번호가 pg_stat_statements에 남지 않는다" \
    "$(is "$(psql_admin -d fit_prod -c "SELECT count(*) FROM pg_stat_statements WHERE query ILIKE '%alter role%' OR query ILIKE '%create role%'")" 0)"
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'CREATE TABLE persist_rows (id int)' >/dev/null
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'INSERT INTO persist_rows VALUES (42)' >/dev/null
  restart_svc postgres
  ok_if "재시작해도 데이터가 남는다" "$(is "$(pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'SELECT id FROM persist_rows')" 42)"
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'DROP TABLE persist_rows' >/dev/null
  run_script init-data.sh
  ok_if "재시작 뒤 init-data.sh가 그대로 성공한다" "$(is "$rc" 0)"
}

run_garage_checks() {
  echo "--- Garage"
  prod_s3 put fit-prod-photos shared.txt prod-secret >/dev/null
  out="$(dev_s3 get fit-prod-photos shared.txt)"
  ok_if "dev 키는 prod 버킷의 객체를 읽지 못한다" "$(is "$(first_line "$out")" 'HTTP 403')"
  dev_s3 put fit-dev-photos mine.txt dev-data >/dev/null
  out="$(prod_s3 get fit-dev-photos mine.txt)"
  ok_if "prod 키는 dev 버킷의 객체를 읽지 못한다" "$(is "$(first_line "$out")" 'HTTP 403')"
  out="$(dev_s3 lifecycle-get fit-dev-photos)"
  ok_if "dev 버킷에도 수명주기가 걸려 있다" "$(has "$out" 'pending/')"
  restart_svc garage
  out="$(prod_s3 get fit-prod-photos shared.txt)"
  ok_if "재시작해도 객체가 남는다" "$(has "$out" prod-secret)"
  run_script init-garage.sh
  ok_if "재시작 뒤 init-garage.sh가 그대로 성공하고 레이아웃을 다시 적용하지 않는다" "$([ "$rc" = 0 ] && [ "$(has "$out" '레이아웃을 적용했다')" = 0 ] && echo 1 || echo 0)"
  tarlist="$(s3run "$S3_PROD_ACCESS_KEY" "$S3_PROD_SECRET_KEY" tar-stdout fit-prod-photos '' 2>/dev/null | tar -t 2>/dev/null || true)"
  ok_if "tar-stdout이 버킷의 객체를 tar로 낸다" "$(has "$tarlist" shared.txt)"
  prod_s3 delete fit-prod-photos shared.txt >/dev/null
  dev_s3 delete fit-dev-photos mine.txt >/dev/null
}

run_port_checks() {
  echo "--- 포트"
  local svc published
  for svc in redis-prod redis-dev garage; do
    published="$(docker port "$(svc_container "$svc")" 2>/dev/null | tr -d '\r\n' || true)"
    ok_if "$svc는 호스트에 포트를 게시하지 않는다" "$(is "$published" '')"
  done
  published="$(docker port "$(svc_container postgres)" 2>/dev/null | tr -d '\r' || true)"
  ok_if "postgres는 127.0.0.1에만 게시한다" "$([ "$(has "$published" '127.0.0.1:')" = 1 ] && [ "$(has "$published" '0.0.0.0')" = 0 ] && echo 1 || echo 0)"
}

run_hygiene_checks() {
  echo "--- 비밀 값 노출"
  local k bad=0
  for k in POSTGRES_PASSWORD FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD REDIS_PROD_PASSWORD REDIS_DEV_PASSWORD GARAGE_RPC_SECRET GARAGE_ADMIN_TOKEN S3_PROD_SECRET_KEY S3_DEV_SECRET_KEY; do
    if [ "$(has "$(cat "$OUT_ALL")" "$(val "$k")")" = 1 ]; then
      bad=1
      echo "FAIL  $k 값이 스크립트 출력에 찍혔다"
    fi
  done
  ok_if "스크립트 출력에 비밀 값이 없다" "$(is "$bad" 0)"
}

run() { # run [구역...]: 구역을 주지 않으면 전부 돌린다. 구역은 앞의 점검 함수 이름에서 run_ 과 _checks를 뗀 것이다
  OUT_ALL="$T/output.log"
  : >"$OUT_ALL"
  load_data_env
  local section
  local -a sections=("$@")
  if [ "${#sections[@]}" = 0 ]; then sections=(init idempotent rotation privilege input redis postgres garage port hygiene); fi
  set +e
  for section in "${sections[@]}"; do "run_${section}_checks"; done
  set -e
  if [ "$FAILED" -gt 0 ]; then
    printf '\n%d개 점검 실패\n' "$FAILED"
    return 1
  fi
  printf '\n데이터 스택 시험 통과\n'
}

case "${1:-}" in
  up) up ;;
  run) shift && run "$@" ;;
  down) down ;;
  *)
    echo "사용: bash infra/data/test/test-data.sh up | run | down" >&2
    exit 2
    ;;
esac
````

- [ ] **Step 2: 시험 compose를 검사 대상에 등록**

````diff
diff --git a/infra/ci/compose-projects.txt b/infra/ci/compose-projects.txt
index 50c4dfa..e50954a 100644
--- a/infra/ci/compose-projects.txt
+++ b/infra/ci/compose-projects.txt
@@ -6,3 +6,4 @@ edge infra/edge/compose.edge.yml --env-file infra/edge/edge.env.example
 edge-test infra/edge/compose.edge.yml infra/edge/test/compose.test.yml --env-file infra/edge/edge.env.example
 app infra/app/compose.app.yml
 data infra/data/compose.data.yml --env-file infra/data/data.env.example
+data-test infra/data/compose.data.yml infra/data/test/compose.test.yml --env-file infra/data/data.env.example
````

- [ ] **Step 3: shellcheck와 정적 검사 확인**

Run:

```bash
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
chmod +x infra/data/test/test-data.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/data/test/test-data.sh; echo "shellcheck exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml infra/data/test/compose.test.yml; echo "yamllint exit=$?"
PYTHONUTF8=1 python infra/ci/check_compose_projects.py | tail -4
```

Expected: `shellcheck exit=0`, `yamllint exit=0`, `== data-test`와 `OK ports (5 service(s))`가 보인다.

- [ ] **Step 4: 시험 환경 켜기 (게이트)**

처음에는 pgvector, redis, garage, python 이미지를 받는다.

Run: `bash infra/data/test/test-data.sh up`

Expected: `만듦  fit-datatest-net-edge` 등 여섯 줄과 네 컨테이너의 `Healthy`에 이어 마지막 줄이 `데이터 시험 환경이 떴다(프로젝트 fit-datatest)`다.

- [ ] **Step 5: 시나리오 실행 (게이트)**

Run: `bash infra/data/test/test-data.sh run 2>&1 | grep -E "^---|^FAIL|^데이터 스택 시험|개 점검 실패"`

Expected: 구역 제목 10개(`--- 초기화`부터 `--- 비밀 값 노출`까지)가 나오고 `FAIL`은 하나도 없으며 마지막 줄이 `데이터 스택 시험 통과`다. 전체 `PASS` 줄은 59개다(`bash infra/data/test/test-data.sh run`의 출력에서 센다). 구역 하나만 돌리려면 구역 이름을 준다(예: `... run privilege`. `init`을 먼저 돌려 둔 환경이어야 한다).

- [ ] **Step 6: 시험이 잡아내는지 확인 (변이)**

스크립트를 일부러 망가뜨리면 시험이 실패해야 한다. 아래는 예시 둘이다(환경을 새로 만들고, 망가뜨린 뒤, 시험하고, 되돌린다).

Run:

```bash
bash infra/data/test/test-data.sh down >/dev/null
cp infra/data/ensure-databases.sh .tmp-ensure.bak
sed -i '/REVOKE ALL ON DATABASE/d' infra/data/ensure-databases.sh
bash infra/data/test/test-data.sh up >/dev/null && bash infra/data/test/test-data.sh run init privilege 2>&1 | grep "^FAIL  [^>]" | head -3
mv .tmp-ensure.bak infra/data/ensure-databases.sh
bash infra/data/test/test-data.sh down
```

Expected: `FAIL  verify-data.sh가 모두 통과한다`와 `FAIL  dev 앱 role은 prod DB에 접속하지 못한다`가 포함된다(다른 환경 DB에 접속할 수 있게 된 것을 시험이 잡는다). 끝나면 `정리했다`가 나온다.

- [ ] **Step 7: 정리 확인**

Run:

```bash
docker ps -a --format '{{.Names}}' | grep -c 'fit-datatest'
docker network ls --format '{{.Name}}' | grep -c '^fit-datatest-'
docker volume ls --format '{{.Name}}' | grep -c '^fit-datatest'
ls -d .tmp-datatest 2>&1 | head -1
```

Expected: 첫 세 줄이 `0`이고 마지막은 `ls: cannot access '.tmp-datatest': No such file or directory`다.

- [ ] **Step 8: 커밋 (허용된 경우)**

```bash
git add infra/data/test infra/ci/compose-projects.txt
git update-index --chmod=+x infra/data/test/test-data.sh
git commit -m "feat(infra): 데이터 스택 시험(실제 Postgres·Redis·Garage) 추가"
```

---

### Task 4: 백업 스크립트

**목표:** Postgres 덤프를 뜨고 임시 DB에 복원해 검증하고 암호화하며, 사진과 Caddy 인증서 볼륨을 같은 방식으로 백업하고, 마이그레이션 전 덤프와 복원 리허설 스크립트를 만든다.

**Files:**
- Create: `infra/backup/lib.sh`, `infra/backup/pg-backup.sh`, `infra/backup/verify-dump.sh`, `infra/backup/files-backup.sh`, `infra/backup/restore-check.sh`

**Interfaces:**
- Consumes: Task 2의 `infra/data/lib.sh`(함수와 컨테이너 찾기), `/etc/fit/data.env`(사진 백업의 prod 키), age 수신자 파일(`/etc/fit/keys/age-recipients.txt`), 1C-2의 `deploy.sh`가 부르는 모양 `pg-backup.sh predeploy <환경> <sha>`
- Produces: `pg-backup.sh scheduled|predeploy <prod|dev> <sha>`, `verify-dump.sh <덤프> [--expect-tables N | --allow-empty] [--sql '<조회문>']`(마지막 줄 `restore_seconds=<초>`), `files-backup.sh photos|caddy`, `restore-check.sh -i <개인키> [--fetch-seconds N] [--allow-empty] [--sql ...] [--record <ssh 대상>] <파일.age>`(`RTO: <초>초`). 결과: `$FIT_BACKUP_DIR/{pg,photos,caddy}/<종류>-<UTC 시각>.<dump|tar>.age`와 짝 `.meta`(name, kind, sha256, size, created), 같은 파일이 `outbox/`에도 하드링크로 놓인다. 환경변수: `FIT_BACKUP_DIR`(`/srv/fit/backups`), `FIT_PREDEPLOY_DIR`(`/srv/fit/predeploy`), `FIT_KEYS_DIR`, `FIT_AGE_RECIPIENTS`, `FIT_METRICS_DIR`(`/var/lib/fit/metrics`), `FIT_EDGE_PROJECT`, `FIT_VERIFY_EVERY_HOURS`(24), `FIT_PG_IMAGE`

핵심 결정:

- 덤프 검증은 임시 컨테이너(망 없음, 메모리 디스크)에 복원하는 것이다. 복원 오류가 없고 복원된 public 테이블 수가 덤프 시점의 수와 같아야 통과한다. 덤프 파일은 호스트 경로를 마운트하지 않고 표준 입력으로 흘려 넣는다(Docker 소켓만 있으면 어디서든 돈다).
- 마지막 검증 뒤 24시간이 지났을 때만 검증한다. 검증에 실패한 덤프는 보내지 않고 `failed-verify-*`로 남기며 지표가 0이 된다.
- 보관 정책(`retention_delete`)은 순수 함수다: 시간창(48시간) 안은 모두 두고, 그보다 오래된 것은 한국 시간(UTC+9 고정) 기준 하루에 가장 늦은 1벌만 14일 동안 둔다. 시간창 안에서 남긴 백업이 있는 날은 그것이 그날의 1벌이다. 가장 최근 백업은 어떤 경우에도 지우지 않고 이름 형식이 다른 항목은 건드리지 않는다.
- 마이그레이션 전 덤프는 평문이다. 개인키가 서버에 없어 암호화하면 급할 때 복원할 수 없고, 이 덤프는 A의 DB 볼륨과 같은 신뢰 범위에 있으며 B로 보내지 않는다. 환경별 최근 5개만 둔다. 위치는 배포 러너(docker 그룹)가 지날 수 있도록 root 전용 `backups/` 밖(`/srv/fit/predeploy`)이다.
- 잠금은 `mkdir`로 건다(flock이 없는 환경에서도 된다). 죽은 프로세스의 잠금은 치운다.
- 사진 백업은 `s3tool.py tar-stdout`으로 prod 버킷 전체를 tar로 묶고(dev는 하지 않는다), 인증서 볼륨은 `<FIT_EDGE_PROJECT>_caddy_data`를 읽기 전용으로 tar로 묶는다. 둘 다 암호화해 같은 이름 규칙을 따른다.

- [ ] **Step 1: 공통 함수 작성**

`infra/backup/lib.sh`:

````bash
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
````

- [ ] **Step 2: 덤프와 검증 스크립트 작성**

`infra/backup/pg-backup.sh`:

````bash
#!/usr/bin/env bash
# Postgres 덤프를 뜬다(설계 8절). 두 가지 모드가 있다.
#   bash infra/backup/pg-backup.sh scheduled            # 4시간마다(timer). 덤프 → 검증(하루 1회 이상) → age 암호화 → 보관 → 금고 전송 대기열
#   bash infra/backup/pg-backup.sh predeploy <환경> <sha>  # 배포 스크립트가 마이그레이션 전에 부른다. 평문 덤프를 A에만 둔다
# scheduled는 fit_prod를 덤프한다. 결과는 $FIT_BACKUP_DIR/pg/pg-<UTC 시각>.dump.age(+ .meta)이고 같은 파일이 outbox/에도 놓인다(push-vault.sh가 B로 보낸다).
# predeploy는 $FIT_PREDEPLOY_DIR(기본 /srv/fit/predeploy)/predeploy-<환경>-<sha>.dump 로 두고 환경별 최근 5개만 남긴다. 암호화하지 않는 이유는
# 개인키가 A에 없어서 급할 때 바로 복원할 수 없기 때문이다. 이 덤프는 A의 DB 볼륨과 같은 신뢰 범위에 있고 B로 보내지 않는다.
# 환경변수: FIT_VERIFY_EVERY_HOURS(24) 마지막 검증 뒤 이 시간이 지났으면 이번 덤프를 복원해 검증한다. FIT_BACKUP_DB(fit_prod).
set -euo pipefail
# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MODE="${1:-}"
PG_DB="${FIT_BACKUP_DB:-fit_prod}"
TMP_FILE=""
OUT_FILE=""

# dump_to 대상 DB 파일: 덤프를 파일로 뜨고 크기와 목차를 확인한다. 실패하면 중간 파일을 지운다
dump_to() {
  local db="$1" dest="$2" pg
  pg="$(require_container postgres)"
  docker exec "$pg" pg_dump -U postgres -Fc -d "$db" >"$dest" || {
    rm -f "$dest"
    die "pg_dump에 실패했다($db)"
  }
  [ -s "$dest" ] || {
    rm -f "$dest"
    die "덤프 파일이 비었다($db)"
  }
  docker exec -i "$pg" pg_restore -l <"$dest" >/dev/null || {
    rm -f "$dest"
    die "덤프의 목차를 읽을 수 없다($db)"
  }
}

table_count() { # table_count DB: public 스키마의 테이블 수
  psql_admin -d "$1" -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
}

scheduled() {
  load_backup_env
  require_recipients
  acquire_lock pg
  umask 077
  mkdir -p "$BACKUP_DIR/pg" "$BACKUP_DIR/outbox" "$BACKUP_DIR/state"
  local ts tmp out tables now last
  ts="$(backup_ts)"
  tmp="$BACKUP_DIR/pg/.tmp-$ts.dump"
  out="$BACKUP_DIR/pg/pg-$ts.dump.age"
  tables="$(table_count "$PG_DB")"
  log "$PG_DB 덤프를 뜬다(테이블 $tables개)"
  TMP_FILE="$tmp"
  OUT_FILE="$out"
  trap 'rm -f "${TMP_FILE:-}" "${OUT_FILE:-}.part"; release_lock' EXIT
  dump_to "$PG_DB" "$tmp"

  now="$(date +%s)"
  last="$(state_get pg.last_verify)"
  if [ $((now - last)) -ge $((${FIT_VERIFY_EVERY_HOURS:-24} * 3600)) ]; then
    log "덤프를 임시 DB에 복원해 검증한다"
    if bash "$BACKUP_LIB_DIR/verify-dump.sh" "$tmp" --expect-tables "$tables"; then
      state_set pg.last_verify "$now"
      state_set pg.last_verify_ok 1
    else
      state_set pg.last_verify "$now"
      state_set pg.last_verify_ok 0
      mv "$tmp" "$BACKUP_DIR/pg/failed-verify-$ts.dump"
      render_backup_metrics
      die "덤프 검증에 실패했다. 이번 덤프는 보내지 않고 failed-verify-$ts.dump 로 남겼다"
    fi
  fi

  age_encrypt "$tmp" "$out"
  write_meta "$out" pg
  rm -f "$tmp"
  mkdir -p "$BACKUP_DIR/outbox"
  ln -f "$out" "$BACKUP_DIR/outbox/$(basename "$out")"
  ln -f "$out.meta" "$BACKUP_DIR/outbox/$(basename "$out").meta"
  state_set pg.last_success "$(date +%s)"
  prune_dir "$BACKUP_DIR/pg" pg
  render_backup_metrics
  log "백업 완료: $(basename "$out") ($(meta_get "$out.meta" size) 바이트)"
}

predeploy() {
  local env="${2:-}" sha="${3:-}" dir dest keep=5 f
  case "$env" in prod | dev) ;; *) die "사용: pg-backup.sh predeploy <prod|dev> <sha>" ;; esac
  [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || die "sha 형식이 틀렸다: $sha"
  dir="$PREDEPLOY_DIR"
  mkdir -p "$dir"
  umask 027
  dest="$dir/predeploy-$env-$sha.dump"
  log "fit_$env를 배포 전에 덤프한다"
  dump_to "fit_$env" "$dest.part"
  mv "$dest.part" "$dest"
  # 환경별 최근 keep개만 남긴다(수정 시각 순)
  while IFS= read -r f; do
    rm -f -- "$f"
  done < <(find "$dir" -maxdepth 1 -type f -name "predeploy-$env-*.dump" -printf '%T@ %p\n' | sort -rn | tail -n +$((keep + 1)) | cut -d' ' -f2-)
  log "사전 덤프 완료: $(basename "$dest")"
}

case "$MODE" in
  scheduled) scheduled ;;
  predeploy) predeploy "$@" ;;
  *)
    echo "사용: bash infra/backup/pg-backup.sh scheduled | predeploy <prod|dev> <sha>" >&2
    exit 2
    ;;
esac
````

`infra/backup/verify-dump.sh`:

````bash
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
  -c 'CREATE ROLE fit_migrator' -c 'CREATE ROLE fit_prod_app' -c 'CREATE ROLE fit_dev_app' >/dev/null
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
````

- [ ] **Step 3: 사진·인증서 백업과 복원 리허설 스크립트 작성**

`infra/backup/files-backup.sh`:

````bash
#!/usr/bin/env bash
# 사진과 Caddy 인증서 볼륨을 백업한다(설계 8절 7번). 사진은 하루 1회, 인증서 볼륨은 주 1회(timer)다.
#   bash infra/backup/files-backup.sh photos|caddy
# 결과는 pg와 같다: $FIT_BACKUP_DIR/<종류>/<종류>-<UTC 시각>.tar.age(+ .meta)이고 같은 파일이 outbox/에도 놓인다.
# photos: fit-prod-photos 버킷 전체를 S3 API로 읽어 tar로 묶는다(infra/data/s3tool.py tar-stdout). dev 버킷은 백업하지 않는다.
# caddy: Caddy 데이터 볼륨(<FIT_EDGE_PROJECT>_caddy_data)을 읽기 전용으로 tar로 묶는다. 인증서는 다시 발급되지만 발급 한도에 걸릴 때를 위한 사본이다.
set -euo pipefail
# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

KIND="${1:-}"
case "$KIND" in
  photos | caddy) ;;
  *)
    echo "사용: bash infra/backup/files-backup.sh photos|caddy" >&2
    exit 2
    ;;
esac

load_backup_env
require_recipients
acquire_lock "files-$KIND"
umask 077
mkdir -p "$BACKUP_DIR/$KIND" "$BACKUP_DIR/outbox" "$BACKUP_DIR/state"
OUT="$BACKUP_DIR/$KIND/$KIND-$(backup_ts).tar.age"
trap 'rm -f "$OUT.part"; release_lock' EXIT

case "$KIND" in
  photos)
    load_data_env
    log "fit-prod-photos 버킷을 묶는다"
    s3run "$S3_PROD_ACCESS_KEY" "$S3_PROD_SECRET_KEY" tar-stdout fit-prod-photos '' | age -R "$RECIPIENTS" -o "$OUT.part"
    ;;
  caddy)
    VOLUME="${EDGE_PROJECT}_caddy_data"
    docker volume inspect "$VOLUME" >/dev/null 2>&1 || die "볼륨 $VOLUME이 없다"
    log "$VOLUME 볼륨을 묶는다"
    docker run --rm -v "$VOLUME:/d:ro" "$PYTHON_IMAGE" tar -C /d -c . | age -R "$RECIPIENTS" -o "$OUT.part"
    ;;
esac

[ -s "$OUT.part" ] || die "백업 파일이 비었다"
mv "$OUT.part" "$OUT"
write_meta "$OUT" "$KIND"
ln -f "$OUT" "$BACKUP_DIR/outbox/$(basename "$OUT")"
ln -f "$OUT.meta" "$BACKUP_DIR/outbox/$(basename "$OUT").meta"
state_set "$KIND.last_success" "$(date +%s)"
prune_dir "$BACKUP_DIR/$KIND" "$KIND"
render_backup_metrics
log "백업 완료: $(basename "$OUT") ($(meta_get "$OUT.meta" size) 바이트)"
````

`infra/backup/restore-check.sh`:

````bash
#!/usr/bin/env bash
# 복원 리허설(설계 8절 5번). 사람이 노트북(Docker Desktop)에서 B의 백업 사본을 복호화하고 복원해 보고 걸린 시간(RTO)을 잰다.
#   bash infra/backup/restore-check.sh -i <개인키 파일> [--fetch-seconds N] [--allow-empty] [--sql '<조회문>'] [--record <ssh 대상>] <백업 파일.age>
# pg-*.dump.age는 임시 Postgres 컨테이너에 복원하고 테이블 수를 확인한다. photos-*, caddy-*(.tar.age)는 복호화해 목록을 확인한다.
# --fetch-seconds는 B에서 내려받는 데 걸린 시간이다(RTO에 더한다). --record user@host를 주면 그 서버에서 `sudo vault-ingest.sh record-restore`로
# 결과를 기록해 지표(fit_vault_last_restore_check_*)로 보이게 한다. 개인키는 수신자가 오프라인으로 보관하는 파일이고 서버에는 없다.
# 필요한 것: docker, age(https://github.com/FiloSottile/age), 이 저장소.
set -euo pipefail
# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

IDENTITY="" FETCH=0 ALLOW_EMPTY="" RECORD="" FILE="" SQL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sql)
      SQL="${2:-}"
      shift 2
      ;;
    -i)
      IDENTITY="${2:-}"
      shift 2
      ;;
    --fetch-seconds)
      FETCH="${2:-}"
      shift 2
      ;;
    --allow-empty)
      ALLOW_EMPTY="--allow-empty"
      shift
      ;;
    --record)
      RECORD="${2:-}"
      shift 2
      ;;
    -*)
      die "알 수 없는 옵션: $1"
      ;;
    *)
      FILE="$1"
      shift
      ;;
  esac
done
[ -n "$FILE" ] && [ -s "$FILE" ] || die "사용: restore-check.sh -i <개인키> [옵션] <백업 파일.age>"
[ -n "$IDENTITY" ] && [ -s "$IDENTITY" ] || die "개인키 파일(-i)이 필요하다"
[[ "$FETCH" =~ ^[0-9]+$ ]] || die "--fetch-seconds에는 숫자를 준다"
command -v age >/dev/null 2>&1 || die "age가 없다(https://github.com/FiloSottile/age 에서 설치한다)"
command -v docker >/dev/null 2>&1 || die "docker가 없다(Docker Desktop을 켠다)"

NAME="$(basename "$FILE")"
backup_name_ok "$NAME" || die "백업 파일 이름 형식이 아니다: $NAME"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
START="$(date +%s)"

log "복호화한다: $NAME"
age -d -i "$IDENTITY" -o "$WORK/plain" "$FILE" || die "복호화에 실패했다(개인키가 수신자 중 하나가 아니다)"

case "$NAME" in
  pg-*)
    log "임시 Postgres에 복원한다"
    bash "$BACKUP_LIB_DIR/verify-dump.sh" "$WORK/plain" ${ALLOW_EMPTY:+"$ALLOW_EMPTY"} ${SQL:+--sql "$SQL"} | tail -n 4
    ;;
  *)
    entries="$(tar -tf "$WORK/plain" | wc -l | tr -d ' ')"
    log "tar 목록을 읽었다(항목 $entries개)"
    ;;
esac

END="$(date +%s)"
RTO=$((END - START + FETCH))
echo "RTO: ${RTO}초 (내려받기 ${FETCH}초 + 복호화·복원 $((END - START))초). 목표는 7200초(2시간)다"
if [ -n "$RECORD" ]; then
  [[ "$RECORD" =~ ^[A-Za-z0-9._@-]+$ ]] || die "--record 대상 형식이 틀렸다"
  # END와 RTO는 위에서 만든 숫자라 클라이언트에서 펼쳐도 안전하다
  # shellcheck disable=SC2029
  ssh -t "$RECORD" "sudo /usr/local/lib/fit/repo/infra/backup/vault-ingest.sh record-restore $END $RTO"
else
  echo "B에 기록하려면 B에서: sudo /usr/local/lib/fit/repo/infra/backup/vault-ingest.sh record-restore $END $RTO"
fi
````

- [ ] **Step 4: shellcheck와 입력 검증, 보관 정책 함수 확인 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
chmod +x infra/backup/*.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/backup/lib.sh infra/backup/pg-backup.sh infra/backup/verify-dump.sh infra/backup/files-backup.sh infra/backup/restore-check.sh; echo "shellcheck exit=$?"
bash infra/backup/pg-backup.sh nothing; echo "exit=$?"
bash infra/backup/pg-backup.sh predeploy staging abcdef1234567; echo "exit=$?"
bash infra/backup/files-backup.sh nothing; echo "exit=$?"
bash infra/backup/verify-dump.sh /nonexistent; echo "exit=$?"
bash infra/backup/restore-check.sh; echo "exit=$?"
bash -c '
. infra/backup/lib.sh
now=$(date -u -d "2026-10-21 12:00:00" +%s)
nm() { printf "pg-%s.dump.age\n" "$(date -u -d "$1" +%Y%m%dT%H%M%SZ)"; }
echo "--- 같은 날 두 개(둘째가 지워진다)"
{ nm "2026-10-19 11:00:00"; nm "2026-10-19 08:00:00"; nm "2026-10-21 11:00:00"; } | retention_delete "$now" 48 14
echo "--- 15일 지난 것"
{ nm "2026-10-21 11:00:00"; nm "2026-10-06 11:00:00"; } | retention_delete "$now" 48 14'
```

Expected: `shellcheck exit=0`. 나머지 다섯 호출은 사용법이나 `FAIL …`을 내고 `exit=2` 또는 `exit=1`이다(`pg-backup.sh nothing`, `files-backup.sh nothing`, `restore-check.sh`는 사용법과 `exit=2` 또는 `FAIL`과 `exit=1`). 보관 정책: `--- 같은 날 두 개` 아래에 `pg-20261019T080000Z.dump.age`, `--- 15일 지난 것` 아래에 `pg-20261006T110000Z.dump.age`가 나온다. 실제 동작은 Task 6의 시험이 확인한다.

- [ ] **Step 5: 커밋 (허용된 경우)**

```bash
git add infra/backup/lib.sh infra/backup/pg-backup.sh infra/backup/verify-dump.sh infra/backup/files-backup.sh infra/backup/restore-check.sh
git update-index --chmod=+x infra/backup/pg-backup.sh infra/backup/verify-dump.sh infra/backup/files-backup.sh infra/backup/restore-check.sh
git commit -m "feat(infra): Postgres 덤프·복원 검증·사진/인증서 백업·복원 리허설 스크립트 추가"
```

---

### Task 5: 금고 전송·수신 검증과 설치

**목표:** A의 백업을 B의 쓰기 전용 금고로 보내고, B가 받은 파일을 다시 검증해 보관소로 옮기며, 서버에 한 번에 설치하는 스크립트와 systemd 타이머를 만든다.

**Files:**
- Create: `infra/backup/push-vault.sh`, `infra/backup/vault-ingest.sh`, `infra/backup/vault-authorize.sh`, `infra/backup/backup-run.sh`, `infra/backup/install.sh`, `infra/backup/conf/systemd/fit-backup@.service`, `fit-backup-pg.timer`, `fit-backup-photos.timer`, `fit-backup-caddy.timer`, `fit-vault-ingest.service`, `fit-vault-ingest.timer`

**Interfaces:**
- Consumes: Task 4의 산출물(outbox의 `.age`와 `.meta`), `/etc/fit/backup.env`(`BACKUP_VAULT_HOST`, `BACKUP_VAULT_PORT`), 1F가 만든 B의 `vault` 계정과 `/srv/vault/{incoming,store}`
- Produces: `push-vault.sh`, `vault-ingest.sh [ingest | record-restore <epoch> <초>]`, `vault-authorize.sh '<공개키 한 줄>' [IP]`, `backup-run.sh pg|photos|caddy`(백업 뒤 결과와 상관없이 전송도 시도, 하나라도 실패하면 실패), `install.sh app|ops|pin-vault-host [--yes]`. 지표 파일: A `/var/lib/fit/metrics/fit_backup.prom`, B `/srv/vault/metrics/fit_vault.prom`(Prometheus textfile 형식)
- 타이머: A `fit-backup-pg`(00:15부터 4시간마다), `fit-backup-photos`(매일 04:40), `fit-backup-caddy`(일요일 04:50), B `fit-vault-ingest`(10분마다)

핵심 결정:

- **금고는 쓰기 전용이다.** `vault` 계정의 `authorized_keys`는 `command="rrsync -wo -no-del /srv/vault/incoming",restrict`(선택적으로 `from="<A의 IP>"`) 한 줄이다. A가 뚫려도 금고의 백업을 읽거나 지울 수 없고 셸을 열 수 없다.
- **보내는 순서가 완료 표시다.** `.age`를 먼저, `.meta`를 나중에 보낸다. B는 `.meta`가 있어야 받은 것으로 친다. 성공한 파일만 outbox에서 지운다. 호스트 키는 사람이 지문을 대조해 등록한 `known_hosts`로 고정한다(`StrictHostKeyChecking=yes`).
- **B는 A를 신뢰하지 않는다.** `incoming/`의 파일을 root만 쓰는 staging으로 옮긴 뒤(검증 뒤에 바꿔치기하지 못하게) 이름 형식, `.meta`의 형식, sha256, 크기, 종류, 일반 파일 여부를 검사한다. 통과하면 `store/<종류>/`, 아니면 `store/quarantine/`이다. 짝이 없는 `.meta`는 1시간, 이상한 이름과 끊긴 전송 임시 파일은 하루가 지나면 격리한다(진행 중인 전송은 건드리지 않는다).
- **코드 사본.** 타이머는 `install.sh`가 `/usr/local/lib/fit/repo`에 만드는 root 소유 사본(`infra/backup`, `infra/data`, `infra/ci/tool-images.sh`. 시험 디렉터리는 제외)을 실행한다. 배포 러너가 저장소 체크아웃을 바꿔도 root로 도는 코드는 바뀌지 않는다. 코드를 고치면 `install.sh`를 다시 실행한다.
- **설치는 멱등이다.** `put_file`/`ensure_dir`로 바뀐 것만 알리고 마지막 줄에 `변경 N건`을 낸다. 전송 키가 이미 있으면 바꾸지 않는다. 수동 단계(B에 키 등록, 호스트 키 고정, 수신자 공개키, `BACKUP_VAULT_HOST`)는 출력으로 안내한다.

- [ ] **Step 1: 전송과 진입점 작성**

`infra/backup/push-vault.sh`:

````bash
#!/usr/bin/env bash
# outbox/의 새 백업을 B의 금고(vault)로 보낸다(설계 8절 2번). 백업 스크립트가 끝난 뒤 timer가 부른다. 몇 번 실행해도 안전하다.
#   bash infra/backup/push-vault.sh
# 암호화된 파일(.age)을 먼저, 짝 파일(.meta)을 나중에 보낸다. B는 .meta가 있어야 받은 것으로 친다(.meta가 완료 표시다).
# B의 vault 계정은 쓰기 전용 강제 명령(rrsync -wo -no-del)이라 A가 뚫려도 금고 안의 백업을 읽거나 지울 수 없다.
# 보내기에 성공한 파일만 outbox에서 지운다. 실패하면 남겨 두었다가 다음 실행에서 다시 보낸다.
# 필요한 것: backup.env의 BACKUP_VAULT_HOST(와 BACKUP_VAULT_PORT), 키 $FIT_KEYS_DIR/vault_ed25519, B의 호스트 키를 등록한 $FIT_KEYS_DIR/vault_known_hosts(install.sh pin-vault-host).
set -euo pipefail
# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

load_backup_env
case "$BACKUP_VAULT_HOST" in "" | *REPLACE_ME*) die "backup.env의 BACKUP_VAULT_HOST를 B의 주소로 채운다" ;; esac
[[ "$BACKUP_VAULT_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || die "BACKUP_VAULT_HOST 형식이 틀렸다"
KEY="$KEYS_DIR/vault_ed25519"
KNOWN="$KEYS_DIR/vault_known_hosts"
[ -f "$KEY" ] || die "전송 키가 없다: $KEY (install.sh app이 만든다)"
[ -s "$KNOWN" ] || die "B의 호스트 키가 등록돼 있지 않다: $KNOWN (install.sh pin-vault-host)"
OUTBOX="$BACKUP_DIR/outbox"
mkdir -p "$OUTBOX"
acquire_lock push

SSH="ssh -p $BACKUP_VAULT_PORT -i $KEY -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$KNOWN -o ConnectTimeout=15"

# push_set 패턴: outbox에서 패턴에 맞는 파일을 보내고 성공하면 지운다
push_set() {
  local -a files
  mapfile -t files < <(cd "$OUTBOX" && find . -maxdepth 1 -type f -name "$1" -printf '%f\n' | sort)
  [ "${#files[@]}" -gt 0 ] || return 0
  log "보낸다: ${#files[@]}개($1)"
  printf '%s\n' "${files[@]}" | rsync -t --no-perms --no-owner --no-group --chmod=F600 --timeout=120 \
    --files-from=- -e "$SSH" "$OUTBOX/" "vault@$BACKUP_VAULT_HOST:." || die "rsync에 실패했다(남은 파일은 다음 실행에서 다시 보낸다)"
  (cd "$OUTBOX" && rm -f -- "${files[@]}")
}

push_set '*.age'
push_set '*.meta'
state_set last_push "$(date +%s)"
render_backup_metrics
log "금고로 보내기 완료"
````

`infra/backup/backup-run.sh`:

````bash
#!/usr/bin/env bash
# timer가 부르는 진입점이다(fit-backup@<종류>.service). 백업을 하고 결과와 상관없이 금고 전송도 시도한다.
#   bash infra/backup/backup-run.sh pg|photos|caddy
# 백업이 실패해도 앞서 쌓인 파일은 보내고, 둘 중 하나라도 실패하면 실패로 끝낸다(systemd가 실패로 기록한다).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIND="${1:-}"
rc=0
case "$KIND" in
  pg) bash "$HERE/pg-backup.sh" scheduled || rc=1 ;;
  photos | caddy) bash "$HERE/files-backup.sh" "$KIND" || rc=1 ;;
  *)
    echo "사용: bash infra/backup/backup-run.sh pg|photos|caddy" >&2
    exit 2
    ;;
esac
bash "$HERE/push-vault.sh" || rc=1
exit "$rc"
````

- [ ] **Step 2: 금고 수신 검증과 키 등록 작성**

`infra/backup/vault-ingest.sh`:

````bash
#!/usr/bin/env bash
# B의 금고가 받은 백업을 검증해 보관소로 옮긴다(설계 8절 3번). root로 돌고 timer가 10분마다 부른다.
#   bash infra/backup/vault-ingest.sh                              # incoming/의 새 백업을 검증하고 보관 정책을 적용한다
#   bash infra/backup/vault-ingest.sh record-restore <epoch> <초>   # 복원 리허설 결과를 기록한다(사람이 sudo로 부른다)
# incoming/은 vault 계정(A가 접속하는 계정)이 쓰는 곳이라 신뢰하지 않는다. 이름 형식을 검사하고, 파일을 먼저 root만 쓰는 staging으로 옮긴 뒤
# 그 사본의 sha256과 크기를 .meta와 대조한다. 통과하면 store/<종류>/로, 아니면 store/quarantine/으로 옮긴다.
# 보관 정책(BACKUP_KEEP_HOURS 시간 단위 + BACKUP_KEEP_DAYS 일 단위)은 종류마다 적용한다. 마지막 수신 시각 등은 지표 파일로 쓴다.
# 경로: FIT_VAULT_DIR(/srv/vault), 지표 FIT_VAULT_METRICS_DIR($FIT_VAULT_DIR/metrics).
set -euo pipefail
# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

VAULT="${FIT_VAULT_DIR:-/srv/vault}"
INCOMING="$VAULT/incoming"
STORE="$VAULT/store"
STAGING="$STORE/.staging"
QUARANTINE="$STORE/quarantine"
VAULT_METRICS_DIR="${FIT_VAULT_METRICS_DIR:-$VAULT/metrics}"
# 잠금과 상태 파일은 금고 디렉터리에 둔다(lib.sh의 state_get/state_set이 BACKUP_DIR/state를 쓴다)
BACKUP_DIR="$VAULT"
load_backup_env
ORPHAN_DATA_MINUTES=$((24 * 60))
ORPHAN_META_MINUTES=60

quarantine() { # quarantine 파일... : 이름이 겹치지 않게 시각을 붙여 격리한다
  local f
  mkdir -p "$QUARANTINE"
  for f in "$@"; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    mv -- "$f" "$QUARANTINE/$(basename "$f").$(date +%s)"
  done
}

count_files() { find "$1" -maxdepth 1 -type f -name '*.age' 2>/dev/null | wc -l | tr -d ' '; }
dir_bytes() { find "$1" -maxdepth 1 -type f -printf '%s\n' 2>/dev/null | awk '{ s += $1 } END { print s + 0 }'; }

render_vault_metrics() {
  local kind
  {
    echo '# HELP fit_vault_last_received_timestamp_seconds 금고가 마지막으로 검증을 통과한 백업을 받은 시각(UTC epoch)'
    echo '# TYPE fit_vault_last_received_timestamp_seconds gauge'
    for kind in pg photos caddy; do echo "fit_vault_last_received_timestamp_seconds{kind=\"$kind\"} $(state_get "received.$kind")"; done
    echo '# HELP fit_vault_backups 보관 중인 백업 수'
    echo '# TYPE fit_vault_backups gauge'
    for kind in pg photos caddy; do echo "fit_vault_backups{kind=\"$kind\"} $(count_files "$STORE/$kind")"; done
    echo '# HELP fit_vault_store_bytes 보관 중인 백업의 전체 크기'
    echo '# TYPE fit_vault_store_bytes gauge'
    for kind in pg photos caddy; do echo "fit_vault_store_bytes{kind=\"$kind\"} $(dir_bytes "$STORE/$kind")"; done
    echo '# HELP fit_vault_quarantined_files 격리된 파일 수'
    echo '# TYPE fit_vault_quarantined_files gauge'
    echo "fit_vault_quarantined_files $(find "$QUARANTINE" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')"
    echo '# HELP fit_vault_ingest_failures_total 검증에 실패해 격리한 백업 수(누적)'
    echo '# TYPE fit_vault_ingest_failures_total counter'
    echo "fit_vault_ingest_failures_total $(state_get ingest_failures)"
    echo '# HELP fit_vault_ingest_last_run_timestamp_seconds ingest가 마지막으로 끝까지 돈 시각'
    echo '# TYPE fit_vault_ingest_last_run_timestamp_seconds gauge'
    echo "fit_vault_ingest_last_run_timestamp_seconds $(state_get ingest_last_run)"
    echo '# HELP fit_vault_last_restore_check_timestamp_seconds 마지막 복원 리허설 시각'
    echo '# TYPE fit_vault_last_restore_check_timestamp_seconds gauge'
    echo "fit_vault_last_restore_check_timestamp_seconds $(state_get restore.last)"
    echo '# HELP fit_vault_last_restore_check_rto_seconds 마지막 복원 리허설에 걸린 시간(RTO 측정값)'
    echo '# TYPE fit_vault_last_restore_check_rto_seconds gauge'
    echo "fit_vault_last_restore_check_rto_seconds $(state_get restore.rto)"
  } | write_atomic "$VAULT_METRICS_DIR/fit_vault.prom"
}

# ingest_pair 이름(.age): 짝 파일과 함께 검증하고 보관소나 격리 구역으로 옮긴다
ingest_pair() {
  local data="$1" meta="$1.meta" kind want_sum want_size got_sum got_size
  mkdir -p "$STAGING"
  # incoming/은 신뢰하지 않으므로 먼저 root만 쓰는 곳으로 옮기고 그 사본을 검사한다
  mv -- "$INCOMING/$data" "$STAGING/$data"
  mv -- "$INCOMING/$meta" "$STAGING/$meta"
  if [ -L "$STAGING/$data" ] || [ ! -f "$STAGING/$data" ] || [ -L "$STAGING/$meta" ] || [ ! -f "$STAGING/$meta" ]; then
    log "일반 파일이 아니다: $data"
    quarantine "$STAGING/$data" "$STAGING/$meta"
    state_set ingest_failures $(($(state_get ingest_failures) + 1))
    return 0
  fi
  kind="${data%%-*}"
  want_sum="$(meta_get "$STAGING/$meta" sha256)"
  want_size="$(meta_get "$STAGING/$meta" size)"
  if ! [[ "$want_sum" =~ ^[0-9a-f]{64}$ ]] || ! [[ "$want_size" =~ ^[0-9]+$ ]] \
    || [ "$(meta_get "$STAGING/$meta" name)" != "$data" ] || [ "$(meta_get "$STAGING/$meta" kind)" != "$kind" ]; then
    log ".meta 내용이 형식에 맞지 않는다: $data"
    quarantine "$STAGING/$data" "$STAGING/$meta"
    state_set ingest_failures $(($(state_get ingest_failures) + 1))
    return 0
  fi
  got_sum="$(sha256sum "$STAGING/$data" | cut -d' ' -f1)"
  got_size="$(wc -c <"$STAGING/$data" | tr -d ' ')"
  if [ "$got_sum" != "$want_sum" ] || [ "$got_size" != "$want_size" ]; then
    log "sha256 또는 크기가 다르다: $data"
    quarantine "$STAGING/$data" "$STAGING/$meta"
    state_set ingest_failures $(($(state_get ingest_failures) + 1))
    return 0
  fi
  mkdir -p "$STORE/$kind"
  mv -- "$STAGING/$data" "$STORE/$kind/$data"
  mv -- "$STAGING/$meta" "$STORE/$kind/$meta"
  state_set "received.$kind" "$(date +%s)"
  log "받았다: $kind/$data ($got_size 바이트)"
}

ingest() {
  acquire_lock ingest
  umask 077
  mkdir -p "$STORE" "$QUARANTINE" "$STAGING" "$VAULT/state"
  local f name base
  # 짝이 완성된(.meta가 있는) 파일부터 처리한다
  while IFS= read -r f; do
    name="$(basename "$f")"
    base="${name%.meta}"
    backup_name_ok "$base" || continue
    if [ -f "$INCOMING/$base" ] || [ -L "$INCOMING/$base" ]; then
      ingest_pair "$base"
    fi
  done < <(find "$INCOMING" -maxdepth 1 -name '*.meta' -type f | sort)
  # 짝이 맞지 않거나 이름이 이상한 파일은 시간이 지나면 격리한다(진행 중인 전송은 건드리지 않는다)
  while IFS= read -r f; do
    log "짝이 없거나 이름이 이상해서 격리한다: $(basename "$f")"
    quarantine "$f"
  done < <(find "$INCOMING" -maxdepth 1 \( -type f -o -type l \) \( -name '*.meta' -mmin +"$ORPHAN_META_MINUTES" -o ! -name '*.meta' -mmin +"$ORPHAN_DATA_MINUTES" \) | sort)
  for f in pg photos caddy; do
    [ -d "$STORE/$f" ] && prune_dir "$STORE/$f" "$f"
  done
  find "$QUARANTINE" -maxdepth 1 -type f -mtime +30 -delete 2>/dev/null || true
  state_set ingest_last_run "$(date +%s)"
  render_vault_metrics
}

record_restore() {
  local epoch="${2:-}" rto="${3:-}"
  [[ "$epoch" =~ ^[0-9]{9,11}$ ]] && [[ "$rto" =~ ^[0-9]{1,7}$ ]] || die "사용: vault-ingest.sh record-restore <epoch 초> <RTO 초>"
  acquire_lock ingest
  mkdir -p "$VAULT/state"
  state_set restore.last "$epoch"
  state_set restore.rto "$rto"
  printf '%s %s\n' "$epoch" "$rto" >>"$VAULT/state/restore-checks.log"
  render_vault_metrics
  log "복원 리허설 결과를 기록했다(RTO ${rto}초)"
}

case "${1:-ingest}" in
  ingest) ingest ;;
  record-restore) record_restore "$@" ;;
  *)
    echo "사용: bash infra/backup/vault-ingest.sh [ingest | record-restore <epoch> <초>]" >&2
    exit 2
    ;;
esac
````

`infra/backup/vault-authorize.sh`:

````bash
#!/usr/bin/env bash
# B에서 한 번 한다(root). A의 백업 전송용 공개키를 vault 계정에 등록한다(설계 8절 2번, 13.3절).
#   sudo bash infra/backup/vault-authorize.sh '<A의 vault_ed25519.pub 한 줄>' [A의 IP]
# 등록한 키는 쓰기 전용 rsync(rrsync -wo -no-del)로 incoming/에만 쓸 수 있다. 읽기, 삭제, 셸, 포트 포워딩은 막힌다.
# authorized_keys에는 이 키 한 줄만 둔다(다시 실행하면 그 줄로 바뀐다). A의 IP를 주면 그 주소에서만 접속할 수 있다.
# 경로: FIT_VAULT_DIR(/srv/vault), FIT_VAULT_HOME(/home/vault).
set -euo pipefail
# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

KEY="${1:-}"
PEER_IP="${2:-}"
VAULT="${FIT_VAULT_DIR:-/srv/vault}"
VAULT_HOME="${FIT_VAULT_HOME:-/home/vault}"
[[ "$KEY" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ [^[:space:]]+)?$ ]] || die "사용: vault-authorize.sh '<ssh-ed25519 공개키 한 줄>' [A의 IP]"
if [ -n "$PEER_IP" ]; then
  [[ "$PEER_IP" =~ ^[0-9a-fA-F:.]+(/[0-9]+)?$ ]] || die "IP 형식이 틀렸다: $PEER_IP"
fi
RRSYNC="$(command -v rrsync || true)"
[ -n "$RRSYNC" ] || die "rrsync가 없다(apt install rsync. Ubuntu 22.04는 python3도 필요하다)"
id vault >/dev/null 2>&1 || die "vault 계정이 없다(infra/host/bootstrap.sh ROLE=ops가 만든다)"

OPTIONS="command=\"$RRSYNC -wo -no-del $VAULT/incoming\",restrict"
if [ -n "$PEER_IP" ]; then OPTIONS="$OPTIONS,from=\"$PEER_IP\""; fi
mkdir -p "$VAULT_HOME/.ssh"
chmod 700 "$VAULT_HOME/.ssh"
printf '%s %s\n' "$OPTIONS" "$KEY" >"$VAULT_HOME/.ssh/authorized_keys"
chmod 600 "$VAULT_HOME/.ssh/authorized_keys"
chown -R vault:vault "$VAULT_HOME/.ssh"
log "vault 계정에 키를 등록했다(쓰기 전용 rrsync${PEER_IP:+, $PEER_IP에서만})"
````

- [ ] **Step 3: 설치 스크립트와 systemd 유닛 작성**

`infra/backup/install.sh`:

````bash
#!/usr/bin/env bash
# 서버에 백업 구성을 설치한다. 몇 번 실행해도 같은 결과다(멱등). root로 실행한다.
#   sudo bash infra/backup/install.sh app                  # 서버 A: 백업 스크립트, 디렉터리, 전송 키, 타이머
#   sudo bash infra/backup/install.sh ops                  # 서버 B: 금고 ingest, 디렉터리, 타이머
#   sudo bash infra/backup/install.sh pin-vault-host [--yes]  # A에서: B의 호스트 키를 확인하고 등록한다
# 타이머가 도는 코드는 저장소 체크아웃이 아니라 root만 쓸 수 있는 사본($FIT_INSTALL_ROOT, 기본 /usr/local/lib/fit/repo)이다.
# 배포 러너(gitlab-runner)가 저장소를 바꿔도 root로 도는 백업 코드는 바뀌지 않게 하려는 것이다. 코드를 고치면 이 스크립트를 다시 실행한다.
# 환경변수(선택): FIT_SKIP(쉼표로 구분, 시험용) apt, systemd. FIT_INSTALL_ROOT, FIT_SYSTEMD_DIR(/etc/systemd/system), FIT_ENV_DIR(/etc/fit),
#   FIT_BACKUP_DIR(/srv/fit/backups), FIT_VAULT_DIR(/srv/vault), FIT_METRICS_DIR(/var/lib/fit/metrics), FIT_VAULT_METRICS_DIR($FIT_VAULT_DIR/metrics)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SKIP=",${FIT_SKIP:-},"
INSTALL_ROOT="${FIT_INSTALL_ROOT:-/usr/local/lib/fit/repo}"
SYSTEMD_DIR="${FIT_SYSTEMD_DIR:-/etc/systemd/system}"
ENV_DIR="${FIT_ENV_DIR:-/etc/fit}"
KEYS_DIR="${FIT_KEYS_DIR:-$ENV_DIR/keys}"
BACKUP_DIR="${FIT_BACKUP_DIR:-/srv/fit/backups}"
PREDEPLOY_DIR="${FIT_PREDEPLOY_DIR:-$(dirname "$BACKUP_DIR")/predeploy}"
VAULT_DIR="${FIT_VAULT_DIR:-/srv/vault}"
METRICS_DIR="${FIT_METRICS_DIR:-/var/lib/fit/metrics}"
VAULT_METRICS_DIR="${FIT_VAULT_METRICS_DIR:-$VAULT_DIR/metrics}"
CHANGES=0
PUT=0

step() { printf '\n== %s\n' "$*"; }
log() { printf '%s\n' "$*"; }
die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
skipped() { case "$SKIP" in *",$1,"*) log "건너뜀($1)"; return 0 ;; esac; return 1; }
changed() { CHANGES=$((CHANGES + 1)); log "변경: $*"; }

# put_file 원본 대상 모드 [소유자:그룹]: 내용, 모드, 소유자 중 하나라도 다르면 설치하고 PUT=1로 둔다
put_file() {
  local src="$1" dst="$2" mode="$3" owner="${4:-root:root}"
  PUT=0
  if [ -f "$dst" ] && cmp -s "$src" "$dst" && [ "$(stat -c %a "$dst")" = "$mode" ] && [ "$(stat -c %U:%G "$dst")" = "$owner" ]; then
    return 0
  fi
  install -D -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$src" "$dst"
  PUT=1
  changed "$dst"
}
ensure_dir() { # ensure_dir 경로 모드 소유자:그룹
  if [ -d "$1" ] && [ "$(stat -c %a "$1")" = "$2" ] && [ "$(stat -c %U:%G "$1")" = "$3" ]; then return 0; fi
  install -d -m "$2" -o "${3%%:*}" -g "${3##*:}" "$1"
  chmod "$2" "$1" # install -d는 setgid 비트를 빼먹을 수 있어 한 번 더 맞춘다
  changed "디렉터리 $1"
}

preflight() {
  [ "$(id -u)" = 0 ] || die "root로 실행한다(sudo)"
  for d in "$REPO/infra/backup" "$REPO/infra/data" "$REPO/infra/ci/tool-images.sh"; do
    [ -e "$d" ] || die "저장소 구조가 맞지 않는다: $d"
  done
}

install_packages() { # install_packages 패키지...: 없는 명령이 있을 때만 apt로 설치한다
  local pkgs=("$@")
  step "패키지"
  skipped apt && return 0
  if command -v age >/dev/null 2>&1 && command -v rsync >/dev/null 2>&1 && command -v ssh >/dev/null 2>&1 && { [ "$ROLE" != ops ] || command -v rrsync >/dev/null 2>&1; }; then
    log "필요한 패키지가 이미 있다"
    return 0
  fi
  apt-get -o Acquire::Retries=3 update -qq
  DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y -qq "${pkgs[@]}" >/dev/null
  changed "패키지 ${pkgs[*]}"
}

# mirror_code: 저장소의 backup, data(시험 제외), ci/tool-images.sh를 root 소유 사본으로 둔다. 바뀐 파일만 갱신하고 사라진 파일은 지운다
mirror_code() {
  step "코드 사본 $INSTALL_ROOT"
  local stage rel
  stage="$(mktemp -d)"
  mkdir -p "$stage/infra/backup" "$stage/infra/data" "$stage/infra/ci"
  (cd "$REPO/infra/backup" && tar -c --exclude=./test .) | tar -x -C "$stage/infra/backup"
  (cd "$REPO/infra/data" && tar -c --exclude=./test .) | tar -x -C "$stage/infra/data"
  cp "$REPO/infra/ci/tool-images.sh" "$stage/infra/ci/tool-images.sh"
  if [ -d "$INSTALL_ROOT" ] && diff -rq "$stage" "$INSTALL_ROOT" >/dev/null 2>&1; then
    log "코드 사본이 최신이다"
  else
    rm -rf "$INSTALL_ROOT.new"
    install -d -m 755 -o root -g root "$(dirname "$INSTALL_ROOT")" "$INSTALL_ROOT.new"
    cp -a "$stage/." "$INSTALL_ROOT.new/"
    chown -R root:root "$INSTALL_ROOT.new"
    chmod -R go-w "$INSTALL_ROOT.new"
    rm -rf "$INSTALL_ROOT.old"
    if [ -d "$INSTALL_ROOT" ]; then mv "$INSTALL_ROOT" "$INSTALL_ROOT.old"; fi
    mv "$INSTALL_ROOT.new" "$INSTALL_ROOT"
    rm -rf "$INSTALL_ROOT.old"
    changed "코드 사본 $INSTALL_ROOT"
  fi
  rm -rf "$stage"
  for rel in infra/backup/backup-run.sh infra/backup/vault-ingest.sh; do
    [ -x "$INSTALL_ROOT/$rel" ] || die "$INSTALL_ROOT/$rel에 실행 권한이 없다"
  done
}

install_units() { # install_units 파일...: 유닛을 설치하고 타이머를 켠다
  step "systemd 유닛"
  local any=0 f
  for f in "$@"; do
    put_file "$HERE/conf/systemd/$f" "$SYSTEMD_DIR/$f" 644
    [ "$PUT" = 0 ] || any=1
  done
  skipped systemd && return 0
  if [ "$any" = 1 ]; then systemctl daemon-reload; fi
  for f in "$@"; do
    case "$f" in *.timer) systemctl enable --now "$f" >/dev/null 2>&1 ;; esac
  done
}

setup_app() {
  ROLE=app
  preflight
  install_packages age rsync openssh-client
  mirror_code
  step "디렉터리와 설정"
  ensure_dir "$BACKUP_DIR" 700 root:root
  local d
  for d in pg photos caddy outbox state; do ensure_dir "$BACKUP_DIR/$d" 700 root:root; done
  # 배포 러너(gitlab-runner, docker 그룹)가 마이그레이션 전 덤프를 쓴다. 평문이라 다른 사용자는 읽지 못하게 한다(2770 = setgid).
  # 러너가 지나갈 수 있도록 root 전용인 백업 디렉터리 밖에 둔다
  ensure_dir "$PREDEPLOY_DIR" 2770 root:docker
  ensure_dir "$METRICS_DIR" 755 root:root
  if [ ! -e "$ENV_DIR/backup.env" ]; then
    install -D -m 640 -o root -g docker "$REPO/infra/backup/backup.env.example" "$ENV_DIR/backup.env"
    changed "$ENV_DIR/backup.env(예제에서 만들었다. BACKUP_VAULT_HOST를 채운다)"
  fi
  step "전송 키"
  ensure_dir "$KEYS_DIR" 700 root:root
  if [ ! -f "$KEYS_DIR/vault_ed25519" ]; then
    ssh-keygen -q -t ed25519 -N '' -C fit-a-backup -f "$KEYS_DIR/vault_ed25519"
    changed "$KEYS_DIR/vault_ed25519(새 키)"
  fi
  install_units fit-backup@.service fit-backup-pg.timer fit-backup-photos.timer fit-backup-caddy.timer
  step "남은 수동 단계"
  log "1. B에서: sudo bash infra/backup/vault-authorize.sh '$(cat "$KEYS_DIR/vault_ed25519.pub")' <A의 IP>"
  log "2. A에서: sudo bash infra/backup/install.sh pin-vault-host   (B의 호스트 키 지문을 B의 지문과 대조한 뒤 --yes)"
  log "3. A에서: $KEYS_DIR/age-recipients.txt 에 수신자 2명의 공개키(age1...)를 한 줄씩 넣는다"
  log "4. A에서: $ENV_DIR/backup.env 의 BACKUP_VAULT_HOST를 B의 주소로 채운다"
  log "변경 $CHANGES건"
}

setup_ops() {
  ROLE=ops
  preflight
  install_packages rsync python3 openssh-server
  mirror_code
  step "디렉터리와 설정"
  ensure_dir "$VAULT_DIR/store" 700 root:root
  ensure_dir "$VAULT_DIR/state" 700 root:root
  ensure_dir "$VAULT_METRICS_DIR" 755 root:root
  if [ ! -e "$ENV_DIR/backup.env" ]; then
    install -D -m 640 -o root -g docker "$REPO/infra/backup/backup.env.example" "$ENV_DIR/backup.env"
    changed "$ENV_DIR/backup.env(예제에서 만들었다. 보관 기간 BACKUP_KEEP_*을 확인한다)"
  fi
  install_units fit-vault-ingest.service fit-vault-ingest.timer
  log "변경 $CHANGES건"
}

# pin-vault-host: B의 ed25519 호스트 키를 받아 지문을 보여 주고, 사람이 B의 지문과 대조한 뒤 --yes를 주면 등록한다
pin_vault_host() {
  [ "$(id -u)" = 0 ] || die "root로 실행한다(sudo)"
  # shellcheck source=infra/backup/lib.sh
  . "$HERE/lib.sh"
  load_backup_env
  case "$BACKUP_VAULT_HOST" in "" | *REPLACE_ME*) die "backup.env의 BACKUP_VAULT_HOST를 먼저 채운다" ;; esac
  [[ "$BACKUP_VAULT_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || die "BACKUP_VAULT_HOST 형식이 틀렸다"
  local tmp
  tmp="$(mktemp)"
  ssh-keyscan -p "$BACKUP_VAULT_PORT" -t ed25519 "$BACKUP_VAULT_HOST" >"$tmp" 2>/dev/null
  [ -s "$tmp" ] || die "B($BACKUP_VAULT_HOST:$BACKUP_VAULT_PORT)에서 호스트 키를 받지 못했다"
  log "B의 호스트 키 지문(B에서 ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 의 결과와 같아야 한다):"
  ssh-keygen -lf "$tmp"
  if [ "${1:-}" = "--yes" ]; then
    install -d -m 700 "$KEYS_DIR"
    install -m 600 "$tmp" "$KEYS_DIR/vault_known_hosts"
    log "$KEYS_DIR/vault_known_hosts 에 등록했다"
  else
    log "지문이 같으면 --yes를 붙여 다시 실행한다"
  fi
  rm -f "$tmp"
}

case "${1:-}" in
  app) setup_app ;;
  ops) setup_ops ;;
  pin-vault-host) pin_vault_host "${2:-}" ;;
  *)
    echo "사용: sudo bash infra/backup/install.sh app | ops | pin-vault-host [--yes]" >&2
    exit 2
    ;;
esac
````

`infra/backup/conf/systemd/fit-backup@.service`:

````ini
[Unit]
Description=Fit backup %i (dump or archive, encrypt, send to the vault)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/lib/fit/repo/infra/backup/backup-run.sh %i
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=3h
````

`infra/backup/conf/systemd/fit-backup-pg.timer`:

````ini
[Unit]
Description=Postgres dump every 4 hours (fit)

[Timer]
# 00:15, 04:15, 08:15 ... 새벽 4시 일괄 처리(BE 배치)가 막 끝난 뒤의 덤프도 한 번 잡힌다. 시간대는 서버의 Asia/Seoul이다
OnCalendar=*-*-* 00/4:15:00
RandomizedDelaySec=2min
Persistent=true
Unit=fit-backup@pg.service

[Install]
WantedBy=timers.target
````

`infra/backup/conf/systemd/fit-backup-photos.timer`:

````ini
[Unit]
Description=Photo bucket backup once a day (fit)

[Timer]
OnCalendar=*-*-* 04:40:00
RandomizedDelaySec=5min
Persistent=true
Unit=fit-backup@photos.service

[Install]
WantedBy=timers.target
````

`infra/backup/conf/systemd/fit-backup-caddy.timer`:

````ini
[Unit]
Description=Caddy certificate volume backup once a week (fit)

[Timer]
OnCalendar=Sun *-*-* 04:50:00
RandomizedDelaySec=5min
Persistent=true
Unit=fit-backup@caddy.service

[Install]
WantedBy=timers.target
````

`infra/backup/conf/systemd/fit-vault-ingest.service`:

````ini
[Unit]
Description=Verify received backups and apply retention (fit vault)

[Service]
Type=oneshot
ExecStart=/usr/local/lib/fit/repo/infra/backup/vault-ingest.sh ingest
Nice=10
IOSchedulingClass=idle
````

`infra/backup/conf/systemd/fit-vault-ingest.timer`:

````ini
[Unit]
Description=Vault ingest every 10 minutes (fit)

[Timer]
OnCalendar=*:0/10
Persistent=true

[Install]
WantedBy=timers.target
````

- [ ] **Step 4: shellcheck와 입력 검증 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
chmod +x infra/backup/*.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/backup/push-vault.sh infra/backup/backup-run.sh infra/backup/vault-ingest.sh infra/backup/vault-authorize.sh infra/backup/install.sh; echo "shellcheck exit=$?"
bash infra/backup/backup-run.sh nothing; echo "exit=$?"
bash infra/backup/vault-ingest.sh nothing; echo "exit=$?"
bash infra/backup/vault-authorize.sh 'not a key'; echo "exit=$?"
bash infra/backup/install.sh nothing; echo "exit=$?"
```

Expected: `shellcheck exit=0`. 네 호출은 사용법이나 `FAIL …`을 내고 `exit=2`(`vault-authorize.sh`는 `FAIL`과 `exit=1`)다. 실제 전송·수신·설치는 Task 6의 시험이 확인한다.

- [ ] **Step 5: 커밋 (허용된 경우)**

```bash
git add infra/backup/push-vault.sh infra/backup/backup-run.sh infra/backup/vault-ingest.sh infra/backup/vault-authorize.sh infra/backup/install.sh infra/backup/conf
git update-index --chmod=+x infra/backup/push-vault.sh infra/backup/backup-run.sh infra/backup/vault-ingest.sh infra/backup/vault-authorize.sh infra/backup/install.sh
git commit -m "feat(infra): 금고 전송·수신 검증·설치 스크립트와 systemd 타이머 추가"
```

---

### Task 6: 백업 시험

**목표:** A와 B를 컨테이너 두 개로 흉내 내(실제 sshd, rsync, rrsync, age) 실제 Postgres·Garage를 백업하고, 전송·수신·격리·보관 정책·복원 리허설을 시험한다.

**Files:**
- Create: `infra/backup/test/node/Dockerfile`, `infra/backup/test/test-backup.sh`

**Interfaces:**
- Consumes: Task 3의 `test-data.sh`(데이터 스택), Task 4·5의 스크립트
- Produces: `bash infra/backup/test/test-backup.sh up|run [구역...]|down`. 구역: `retention units install trust pg predeploy files push ingest restore wrapper hygiene`. A 컨테이너는 Docker 소켓으로 호스트의 데몬을 쓴다(덤프·복원 검증용 임시 컨테이너, 사진 읽기). 시험용 서버 이미지는 `fit-backuptest/node`(ubuntu 24.04 + age, rsync, openssh, python3 + docker CLI)

시나리오(구역):

- `retention`: 보관 정책 순수 함수(시간창, 같은 날 하루 1벌, 한국 시간 자정 경계, 14일 초과, 최신 보호, 이름 형식 무시, 빈 목록).
- `units`: systemd가 있는 임시 컨테이너에서 `systemd-analyze calendar`가 타이머 4개의 `OnCalendar`를 해석하고 `systemd-analyze verify`가 서비스와 타이머를 오류 없이 읽는다.
- `install`: A·B 설치 결과(디렉터리 모드, 코드 사본이 root 외에는 쓸 수 없고 시험 디렉터리가 없다, 유닛 파일, docker 그룹의 사전 덤프 디렉터리 쓰기와 러너의 백업 디렉터리 접근 거부), 두 번째 실행은 변경 0건이고 전송 키를 바꾸지 않는다, 유닛의 `ExecStart`와 `Unit=`이 가리키는 파일이 있다.
- `trust`: 형식이 틀린 공개키·IP 거부, `authorized_keys`가 쓰기 전용 rrsync와 `restrict`와 `from`을 갖고 한 줄뿐이다, `pin-vault-host`는 `--yes` 없이는 등록하지 않고 보여 준 지문이 B의 실제 지문과 같다.
- `pg`: 수신자 파일이 없으면 거부, 암호화 파일에서 테이블 이름·데이터가 보이지 않는다, 수신자 2명이 풀 수 있고 비수신자는 못 푼다, 복원한 DB에서 원래 3행이 조회된다, 잘린 덤프·잡음 파일·없는 파일·잘못된 테이블 수는 검증에 실패한다, 검증 주기 안의 두 번째 백업은 검증을 건너뛴다, 검증 실패 시 보내지 않고 지표가 0이 되며 다음 실행이 회복한다, 잠금(살아 있는 pid는 거부, 죽은 pid는 치운다), 14일 지난 백업과 짝 파일이 지워진다.
- `predeploy`: 평문 덤프가 640 docker 그룹으로 생기고 읽힌다, 잘못된 sha·환경 거부, 환경별 최근 5개만 남고 다른 환경은 그대로다.
- `files`: 사진 tar에 prod 객체만 있고 내용이 그대로다, 인증서 볼륨 tar, 볼륨이 없으면 실패.
- `push`: 호스트 키가 다르면 보내지 않는다, 성공하면 outbox가 비고 B의 incoming에 `.age`와 `.meta`가 vault 소유 600으로 온다, **A의 키로 셸 명령·금고 읽기·`--delete`·`incoming/` 밖 쓰기가 모두 거부된다**, 등록한 주소가 아니면 같은 키도 거부된다.
- `ingest`: 정상 파일은 종류별 보관소로, sha256·크기·`.meta` 형식·종류가 틀린 파일과 심볼릭 링크는 격리, 짝 없는 `.meta`와 이상한 이름은 시간이 지나면 격리하고 방금 온 것은 건드리지 않는다, B의 보관 정책, `record-restore`, 잠금, 지표(`fit_vault_*`).
- `restore`: B의 사본을 복호화·복원해 3행을 조회하고 RTO를 내며 비수신자 키·개인키 누락·이름 형식 오류는 거부, 사진 tar는 목록을 확인한다.
- `wrapper`: 전송이 실패해도 백업은 만들고 실패로 끝나며 outbox에 남는다, 다음 실행이 밀린 파일까지 보낸다.
- `hygiene`: 스크립트 출력에 비밀 값, SSH·age 개인키가 없고 A의 서버 설정 경로에는 공개키만 있다.

- [ ] **Step 1: 시험용 서버 이미지 작성**

`infra/backup/test/node/Dockerfile`:

````dockerfile
# 시험용 서버(A와 B 역할 모두)다. 실제 서버에서 쓰는 도구(age, rsync, rrsync, ssh)를 갖추고 Docker CLI는 소켓으로 호스트의 데몬을 쓴다.
FROM docker:29.9.0-cli AS dockercli

FROM ubuntu:24.04
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends age rsync openssh-server openssh-client ca-certificates python3 sudo \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd docker \
 && useradd --create-home --shell /bin/bash --groups docker runner
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
CMD ["sleep", "infinity"]
````

- [ ] **Step 2: 시험 스크립트 작성**

`infra/backup/test/test-backup.sh`:

````bash
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
````

- [ ] **Step 3: shellcheck와 hadolint 확인**

Run:

```bash
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
chmod +x infra/backup/test/test-backup.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/backup/test/test-backup.sh; echo "shellcheck exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$HADOLINT_IMAGE" hadolint infra/backup/test/node/Dockerfile; echo "hadolint exit=$?"
PYTHONUTF8=1 python infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --dockerfile infra/backup/test/node/Dockerfile
```

Expected: `shellcheck exit=0`, `hadolint exit=0`, `OK arch linux/arm64,linux/amd64 (2 image(s))`

- [ ] **Step 4: 시험 환경 켜기 (게이트)**

데이터 스택(Task 3)을 띄우고 초기화한 뒤 시험용 서버 이미지를 빌드해 A·B 컨테이너를 만든다. 처음에는 `ubuntu:24.04`와 `docker:29.9.0-cli`를 받고 apt로 패키지를 설치한다(수 분).

Run: `bash infra/backup/test/test-backup.sh up`

Expected: 데이터 스택의 `Healthy` 줄과 `데이터 초기화 완료`에 이어 마지막 줄이 `백업 시험 환경이 떴다(A=fit-backuptest-a, B=fit-backuptest-b)`다.

- [ ] **Step 5: 시나리오 실행 (게이트)**

Run: `bash infra/backup/test/test-backup.sh run 2>&1 | grep -E "^---|^FAIL|^백업 시험|개 점검 실패"`

Expected: 구역 제목 12개(`--- 보관 정책(순수 함수)`부터 `--- 비밀 값 노출`까지)가 나오고 `FAIL`은 하나도 없으며 마지막 줄이 `백업 시험 통과`다. 전체 `PASS` 줄은 159개다(`bash infra/backup/test/test-backup.sh run`의 출력에서 센다). `pg-backup.sh`를 이미 커밋해서 git이 추적하면 `predeploy` 구역에 실행 권한(100755) 점검이 하나 더 붙어 160개다. 구역 하나만 돌리려면 구역 이름을 준다(앞 구역이 만든 상태를 쓰는 구역은 순서대로 이어서 돌린다: `install trust pg push ingest` 등).

- [ ] **Step 6: 시험이 잡아내는지 확인 (변이)**

아래는 예시 둘이다. 환경을 새로 만들고, 망가뜨린 뒤, 시험하고, 되돌린다.

Run:

```bash
bash infra/backup/test/test-backup.sh down >/dev/null
cp infra/backup/vault-ingest.sh .tmp-ingest.bak
sed -i 's/if \[ "\$got_sum" != "\$want_sum" \] || \[ "\$got_size" != "\$want_size" \]; then/if false; then/' infra/backup/vault-ingest.sh
bash infra/backup/test/test-backup.sh up >/dev/null && bash infra/backup/test/test-backup.sh run install trust pg files push ingest 2>&1 | grep "^FAIL  [^>]" | head -6
mv .tmp-ingest.bak infra/backup/vault-ingest.sh
bash infra/backup/test/test-backup.sh down >/dev/null
cp infra/backup/vault-authorize.sh .tmp-auth.bak
sed -i 's/ -wo -no-del / -no-del /' infra/backup/vault-authorize.sh
bash infra/backup/test/test-backup.sh up >/dev/null && bash infra/backup/test/test-backup.sh run install trust pg push 2>&1 | grep "^FAIL  [^>]" | head -6
mv .tmp-auth.bak infra/backup/vault-authorize.sh
bash infra/backup/test/test-backup.sh down
```

Expected: 첫 시험의 출력에 `FAIL  sha256이 다르면 보관소로 옮기지 않는다`가(검증을 끄면 손상 파일이 보관소에 들어가는 것을 잡는다), 둘째 시험의 출력에 `FAIL  A의 키로 금고의 파일을 내려받을 수 없다`가(`-wo`를 빼면 A가 금고를 읽을 수 있게 되는 것을 잡는다) 포함된다. 같은 원인으로 이어서 실패하는 점검이 몇 줄 더 보일 수 있다. 끝나면 `정리했다`가 나온다.

- [ ] **Step 7: 정리 확인**

Run:

```bash
docker ps -a --format '{{.Names}}' | grep -c 'fit-backuptest\|fit-datatest\|fit-verify'
docker network ls --format '{{.Name}}' | grep -c '^fit-backuptest\|^fit-datatest'
docker volume ls --format '{{.Name}}' | grep -c '^fit-backuptest\|^fit-datatest'
docker image ls --format '{{.Repository}}' | grep -c '^fit-backuptest/'
ls -d .tmp-backuptest .tmp-datatest 2>&1 | head -2
```

Expected: 앞 네 줄이 `0`이고 마지막은 두 경로 모두 `No such file or directory`다.

- [ ] **Step 8: 커밋 (허용된 경우)**

```bash
git add infra/backup/test
git update-index --chmod=+x infra/backup/test/test-backup.sh
git commit -m "feat(infra): 백업 시험 환경(실제 sshd·rrsync·age, 전송·수신·복원 시나리오) 추가"
```

---

### Task 7: 배포 연결, 문서, 검사 연결

**목표:** `fit-up.sh`가 데이터 스택을 올리고 초기화하게 하고, 1C-2의 배포 시험이 데이터 스택을 건너뛰게 하며, 문서와 CI 검사를 이 계획에 맞춘다.

**Files:**
- Modify: `infra/deploy/fit-up.sh`, `infra/deploy/test/test-deploy.sh`, `infra/deploy/README.md`, `infra/README.md`, `docs/infra/design.md`, `docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md`, `.gitlab-ci.yml`, `infra/ci/run-local-checks.sh`
- Create: `infra/data/README.md`, `infra/backup/README.md`

핵심 결정:

- `fit-up.sh`는 data compose 파일이 있으면 `up -d --wait`(제한 600초) 뒤 `init-data.sh`를 돌린다. 재부팅 뒤에도 DB·role·버킷이 설계대로 맞춰진다(멱등). 파일이 없으면(시험, 1E 이전의 obs) 건너뛴다. 경로는 `FIT_DATA_COMPOSE`, `FIT_OBS_COMPOSE`로 바꾼다.
- 1C-2의 배포 시험은 배포 흐름만 본다. 데이터 스택의 실제 기동은 이 계획의 `test-data.sh`가 시험하므로 배포 시험은 없는 파일을 가리켜 건너뛴다.
- 문서는 현재 사실만 적는다. 설계 7·8·13·17절과 부록 B(결정 로그), 1A의 로드맵 행, 인프라 README를 맞춘다.

- [ ] **Step 1: fit-up과 배포 시험 수정**

````diff
diff --git a/infra/deploy/fit-up.sh b/infra/deploy/fit-up.sh
index cd6ce81..8e671c3 100755
--- a/infra/deploy/fit-up.sh
+++ b/infra/deploy/fit-up.sh
@@ -1,8 +1,9 @@
 #!/usr/bin/env bash
 # 호스트를 재부팅했거나 장애를 복구한 뒤 서비스를 순서대로 올린다(설계 10.2절).
 #   bash infra/deploy/fit-up.sh
-# 순서: 공유 망 → data → edge → app(prod·dev의 활성 색만) → obs → 스모크(실패는 알리기만 한다).
-# 아직 없는 프로젝트(data, obs)는 건너뛴다. 이 스크립트는 상태를 바꾸지 않고 멈춘 컨테이너를 올리기만 한다.
+# 순서: 공유 망 → data(올린 뒤 DB·버킷 초기화 스크립트) → edge → app(prod·dev의 활성 색만) → obs → 스모크(실패는 알리기만 한다).
+# compose 파일이 없는 프로젝트(obs)는 건너뛴다. data와 obs의 compose 파일은 FIT_DATA_COMPOSE, FIT_OBS_COMPOSE로 바꾼다(시험용).
+# 이 스크립트는 상태를 바꾸지 않고 멈춘 컨테이너를 올리기만 한다(data 초기화 스크립트는 몇 번 실행해도 같은 결과다).
 # 활성이 아닌 색(이전 배포)은 올리지 않는다. 롤백이 필요하면 rollback.sh를 쓴다.
 # 시험 환경은 FIT_EDGE_COMPOSE_ARGS(edgectl.sh와 같다), FIT_NET_PREFIX(networks.sh와 같다), lib.sh의 환경변수를 쓴다.
 set -uo pipefail
@@ -15,14 +16,16 @@ warn() {
   WARN=1
 }
 
-up_project() { # up_project 이름 compose파일 env파일: 파일이 없으면 건너뛴다
+up_project() { # up_project 이름 compose파일 env파일: 파일이 없으면 건너뛴다. 올렸으면 0, 건너뛰거나 실패하면 1을 돌려준다
   local name="$1" file="$2" envfile="$3"
   if [ ! -f "$file" ]; then
     log "$name: 건너뜀($file 없음)"
-    return 0
+    return 1
   fi
   log "$name: 올린다"
-  docker compose -p "fit-$name" -f "$file" --env-file "$envfile" up -d --wait || warn "$name를 올리지 못했다"
+  if docker compose -p "fit-$name" -f "$file" --env-file "$envfile" up -d --wait --wait-timeout 600; then return 0; fi
+  warn "$name를 올리지 못했다"
+  return 1
 }
 
 log "== 공유 Docker 망"
@@ -32,7 +35,9 @@ bash "$ROOT_DIR/infra/host/networks.sh" || {
 }
 
 log "== data"
-up_project data "$ROOT_DIR/infra/data/compose.data.yml" "$ENV_DIR/data.env"
+if up_project data "${FIT_DATA_COMPOSE:-$ROOT_DIR/infra/data/compose.data.yml}" "$ENV_DIR/data.env"; then
+  bash "$ROOT_DIR/infra/data/init-data.sh" || warn "데이터 초기화(DB·버킷)에 실패했다"
+fi
 
 log "== edge"
 if [ -n "${FIT_EDGE_COMPOSE_ARGS:-}" ]; then
@@ -73,7 +78,7 @@ for env in prod dev; do
 done
 
 log "== obs"
-up_project obs "$ROOT_DIR/infra/obs/compose.obs.yml" "$ENV_DIR/obs.env"
+up_project obs "${FIT_OBS_COMPOSE:-$ROOT_DIR/infra/obs/compose.obs.yml}" "$ENV_DIR/obs.env" || true
 
 log "== 스모크"
 for env in prod dev; do
````

````diff
diff --git a/infra/deploy/test/test-deploy.sh b/infra/deploy/test/test-deploy.sh
index 42ebe09..1a0ec1d 100755
--- a/infra/deploy/test/test-deploy.sh
+++ b/infra/deploy/test/test-deploy.sh
@@ -32,6 +32,8 @@ export FIT_SMOKE_SEARCH_PATH="/api/v1/search?q=a"
 export FIT_DRAIN_SECONDS=1 FIT_BE_READY_TIMEOUT=40 FIT_FE_READY_TIMEOUT=30
 export FIT_MEM_AVAILABLE_MB=8000 FIT_SKIP_PERM=1 FIT_PREDEPLOY_DUMP="$ROOT/infra/deploy/test/fake-dump.sh"
 export FIT_NOTIFY_WEBHOOK=http://127.0.0.1:18099/hook
+# 이 시험은 배포 흐름만 본다. data(실제 Postgres 등)와 obs는 없는 파일을 가리켜 건너뛰게 한다(data는 infra/data/test/test-data.sh가 따로 시험한다)
+export FIT_DATA_COMPOSE="$T/none-data.yml" FIT_OBS_COMPOSE="$T/none-obs.yml"
 
 PY=""
 for c in "${PYTHON:-}" python3 python; do
@@ -375,7 +377,7 @@ run_fit_up_checks() {
   ok_if "엣지가 다시 떴고 prod·dev 서비스가 전과 같은 버전으로 응답한다" \
     "$(is "$(be_sha)$(fe_sha)$(dev_be_sha)$(dev_fe_sha)" "$C6$C6$C2$C1")"
   ok_if "활성이 아닌 prod 색은 올리지 않는다(green은 멈춘 채)" "$(is "$(running be-prod-green)$(running fe-prod-green)" falsefalse)"
-  ok_if "data·obs 프로젝트는 아직 없어서 건너뛴다고 알린다" "$([ "$(has "$out" 'data: 건너뜀')$(has "$out" 'obs: 건너뜀')" = 11 ] && echo 1 || echo 0)"
+  ok_if "compose 파일이 없는 data·obs는 건너뛰고 data 초기화도 하지 않는다" "$([ "$(has "$out" 'data: 건너뜀')$(has "$out" 'obs: 건너뜀')$(has "$out" '데이터 초기화')" = 110 ] && echo 1 || echo 0)"
 }
 
 run_hygiene_checks() {
````

- [ ] **Step 2: 배포 시험으로 1C-2가 그대로 통과하는지 확인 (게이트)**

Run:

```bash
bash infra/deploy/test/test-deploy.sh up >/dev/null
bash infra/deploy/test/test-deploy.sh run 2>&1 | grep -E "^---|^FAIL|^배포 시험|개 점검 실패"
bash infra/deploy/test/test-deploy.sh down
```

Expected: 구역 제목 15개가 나오고 `FAIL`은 하나도 없으며 `배포 시험 통과`다. 전체 `PASS` 줄은 76개다. `fit-up` 구역의 점검 `compose 파일이 없는 data·obs는 건너뛰고 data 초기화도 하지 않는다`가 통과한다.

- [ ] **Step 3: README 작성**

`infra/data/README.md`:

````markdown
# 데이터 스택 (data)

서버 A의 Postgres(pgvector), OpenSearch, Redis 2개, Garage(사진 저장소)다. 설계는 [design.md](../../docs/infra/design.md) 7절이다. 환경(prod, dev)별 DB·role·버킷·키는 compose가 아니라 멱등 스크립트가 만든다.

## 자주 하는 일

| 하고 싶은 일 | 명령 |
|---|---|
| 데이터 스택 올리기(처음, 재부팅 뒤) | `bash infra/deploy/fit-up.sh`(data를 올리고 아래 초기화까지 한다) |
| 스택만 직접 올리기 | `docker compose -p fit-data -f infra/data/compose.data.yml --env-file /etc/fit/data.env up -d --wait` |
| DB·role·버킷·키 맞추기(몇 번 해도 같은 결과) | `bash infra/data/init-data.sh` |
| 설계대로인지 점검(읽기 전용) | `bash infra/data/verify-data.sh` |
| DB role 비밀번호 바꾸기 | `/etc/fit/data.env`의 값을 바꾸고 `bash infra/data/ensure-databases.sh`, 이어서 `/etc/fit/<env>.env`와 `migrate-<env>.env`의 같은 값을 바꾸고 그 환경의 BE를 다시 배포한다 |
| Redis 비밀번호 바꾸기 | `/etc/fit/data.env`와 `<env>.env`를 바꾸고 `docker compose -p fit-data ... up -d redis-<env>`(컨테이너를 다시 만든다. AOF로 데이터는 돌아온다) |
| 개발자가 dev DB에 접속 | `ssh -N -L 5432:127.0.0.1:5432 fit-dev@<A>`로 터널을 열고 `fit_dev_app` 자격으로 `127.0.0.1:5432`에 접속한다 |

Garage 키 교체는 런북 RB-08이다(이 스크립트는 이미 있는 키를 바꾸지 않는다).

## 구성

| 서비스 | 이미지 | 메모리 | 망 | 비고 |
|---|---|---|---|---|
| `postgres` | `pgvector/pgvector:0.8.7-pg16` | 1g | net-data, net-dbaccess | `127.0.0.1:5432`만 호스트에 게시한다(터널용). shared_buffers 256MB, max_connections 60, `pg_stat_statements` |
| `opensearch` | `infra/local/opensearch`를 빌드(3.9.0 + analysis-nori) | 2g(힙 768m) | net-data | single-node, 보안 플러그인 끔, 호스트 게시 없음 |
| `redis-prod`, `redis-dev` | `redis:7.4.9-alpine` | 128m(maxmemory 96mb) | net-data | `noeviction`, AOF everysec, requirepass |
| `garage` | `dxflrs/garage:v2.4.1` | 192m | net-data, net-edge | S3 API 3900, 웹 엔드포인트 3902를 엣지가 프록시한다 |

BE는 서비스 이름으로 접속한다(`postgres`, `redis-prod`, `redis-dev`, `garage`, `opensearch`). 프로젝트 이름은 `fit-data`다.

## 환경별 분리

| 대상 | prod | dev |
|---|---|---|
| Postgres | DB `fit_prod`, role `fit_prod_app`(DML만) | DB `fit_dev`, role `fit_dev_app`(DML만, `statement_timeout` 30초) |
| DDL | `fit_migrator`(두 DB의 소유자. 마이그레이션 컨테이너가 쓴다) | 〃 |
| Redis | `redis-prod`(자기 비밀번호) | `redis-dev`(자기 비밀번호) |
| Garage | 버킷 `fit-prod-photos`, prod 전용 키 | 버킷 `fit-dev-photos`, dev 전용 키 |

각 앱 role은 자기 DB에만 접속한다. 마이그레이터가 만드는 테이블과 시퀀스에는 앱 role의 DML 권한이 자동으로 붙는다. 초기화 스크립트를 다시 돌리면 다른 방법으로 만든 기존 테이블에도 같은 권한을 준다.

## data.env

`/etc/fit/data.env`(root:docker 0640)에 12개 키가 있다. 키 목록과 소비자는 [env.md](../../docs/infra/contracts/env.md)의 `data` 그룹이고 예제는 `data.env.example`이다. 값 규칙은 스크립트가 검사하고 어긋나면 값을 찍지 않고 어떤 키가 틀렸는지만 알려 준다.

| 키 | 규칙 | 만드는 법 |
|---|---|---|
| `*_PASSWORD`, `GARAGE_ADMIN_TOKEN` | 영문·숫자·`._~-`만, 16자 이상(SQL과 compose 보간에 그대로 들어간다) | `openssl rand -hex 16` |
| `GARAGE_RPC_SECRET` | 16진수 64자리 | `openssl rand -hex 32` |
| `S3_*_ACCESS_KEY` | `GK` + 16진수 24자리(Garage의 키 형식) | `printf 'GK%s\n' "$(openssl rand -hex 12)"` |
| `S3_*_SECRET_KEY` | 16진수 64자리 | `openssl rand -hex 32` |

`FIT_MIGRATOR_PASSWORD`는 `migrate-<env>.env`의 DDL 비밀번호와 같아야 한다. 스크립트는 `data.env`를 셸로 실행하지 않고 `KEY=VALUE` 줄만 읽는다. 값은 화면과 로그에 찍지 않는다.

## 파일

| 경로 | 내용 |
|---|---|
| `compose.data.yml` | 위 서비스 정의(외부 망은 `FIT_NET_DATA`, `FIT_NET_EDGE`, `FIT_NET_DBACCESS`로 이름을 바꿀 수 있다) |
| `lib.sh` | 공통 함수(data.env 읽기와 검사, 컨테이너 찾기, `psql_admin`, `s3run`, `wait_healthy`). 직접 실행하지 않는다 |
| `init-data.sh` | postgres와 garage가 healthy가 되길 기다린 뒤 아래 두 스크립트를 돌린다 |
| `ensure-databases.sh` | role과 DB, 확장(`vector`, `pg_stat_statements`), 접속·테이블 권한 |
| `init-garage.sh` | 레이아웃, 버킷, 환경 전용 키, 웹 엔드포인트 공개 읽기, 수명주기(`pending/`와 끝나지 않은 멀티파트를 1일 뒤 삭제) |
| `verify-data.sh` | 서비스 상태, 접속 범위, 비밀번호 거부, Redis 정책, 버킷 분리를 점검한다(PASS/FAIL, 값은 찍지 않는다) |
| `s3tool.py` | 표준 라이브러리만 쓰는 SigV4 S3 클라이언트. 호스트에 S3 도구가 없고 Garage 포트를 게시하지 않아서 `s3run`이 net-data에 붙인 python 컨테이너에서 실행한다 |
| `garage/garage.toml` | Garage 설정(단일 노드, lmdb, 웹 루트 도메인 `.web.garage.localhost`) |
| `data.env.example` | 키 이름과 자리표시자 |
| `test/` | 노트북 시험 |

## 알아 둘 것

- 공식 Postgres 이미지는 컨테이너 안의 loopback 접속을 비밀번호 없이 허용한다(trust). 다른 컨테이너와 호스트 게시 포트로 들어오는 접속은 비밀번호(scram-sha-256)를 확인한다. 스크립트의 `pg_as`가 서비스 이름으로 접속하는 이유다.
- 초기화 스크립트는 SQL을 표준 입력으로 넘기고 `log_statement`와 `pg_stat_statements.track_utility`를 꺼서 비밀번호가 프로세스 목록, Postgres 로그, 통계에 남지 않게 한다.
- OpenSearch는 인증이 없다. 두 환경의 BE가 같은 망을 공유하므로 인덱스 이름 접두사(`prod-`, `dev-`)는 관례일 뿐이다(설계 13.4절).
- 마이그레이션 전 덤프는 [backup](../backup/README.md)의 `pg-backup.sh predeploy`다.

## 노트북에서 시험하기

```bash
bash infra/data/test/test-data.sh up     # 공유 망과 실제 Postgres·Redis·Garage를 띄운다(접두사 fit-datatest)
bash infra/data/test/test-data.sh run    # 초기화·멱등·권한·입력 검증·재시작 시나리오
bash infra/data/test/test-data.sh down   # 시험이 만든 것을 모두 지운다
FIT_TEST_OPENSEARCH=1 bash infra/data/test/test-data.sh up   # OpenSearch(이미지 빌드, 메모리 2GB)도 띄우고 nori까지 점검한다
```

`run`에 구역 이름을 주면 그 구역만 돈다(`init idempotent rotation privilege input redis postgres garage port hygiene`). Postgres의 호스트 포트는 55432(`FIT_DATATEST_PG_PORT`)다.

## 서버에서만 확인되는 것

실제 `/etc/fit/data.env`의 권한, 호스트 게시 포트(`127.0.0.1:5432`)로 들어오는 접속이 비밀번호를 확인하는지(개발자 터널), 메모리 상한 안에서의 동작과 재시작 시간, 호스트 재부팅 뒤 자동 기동, OpenSearch의 실제 메모리 사용(설계 4.1절 예산), 디스크 용량.
````

`infra/backup/README.md`:

````markdown
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

## 자주 하는 일

| 하고 싶은 일 | 명령 |
|---|---|
| 지금 백업하고 B로 보내기 | `sudo systemctl start fit-backup@pg.service`(`photos`, `caddy`도 같다) |
| 보내지 못한 파일 확인 | `ls /srv/fit/backups/outbox`(A). 다음 실행이 다시 보낸다 |
| 백업 상태 지표 보기 | `cat /var/lib/fit/metrics/fit_backup.prom`(A), `cat /srv/vault/metrics/fit_vault.prom`(B) |
| 격리된 파일 보기 | `ls /srv/vault/store/quarantine`(B). 검증에 실패했거나 짝이 없는 파일이다 |
| 덤프 검증만 따로 | `bash infra/backup/verify-dump.sh <평문 덤프> --expect-tables <N>`(복호화한 파일) |

## 지표 (1E가 알림 규칙을 건다)

A는 `/var/lib/fit/metrics/fit_backup.prom`(`FIT_METRICS_DIR`)에, B는 `/srv/vault/metrics/fit_vault.prom`에 Prometheus textfile 형식으로 쓴다. node_exporter의 textfile collector가 읽는 디렉터리로 마운트하는 것은 계획 1E다.

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
````

- [ ] **Step 4: 문서와 검사 연결 수정**

````diff
diff --git a/infra/deploy/README.md b/infra/deploy/README.md
index 40a3075..607041a 100644
--- a/infra/deploy/README.md
+++ b/infra/deploy/README.md
@@ -41,7 +41,8 @@ dev는 같은 흐름이지만 색이 없어서 교체하고, 확인에 실패하
 - 이미지 `be:<sha>`, `fe:<sha>`(CI의 `build:images`가 만든다. 환경변수 `FIT_BE_IMAGE`, `FIT_FE_IMAGE`로 저장소 이름을 바꿀 수 있다)
 - `/etc/fit/<env>.env`, `fe-<env>.env`, `migrate-<env>.env`(키는 [env.md](../../docs/infra/contracts/env.md)의 `app`, `fe`, `migrate` 그룹). 다른 사용자가 읽을 수 없어야 한다
 - 호스트 설정(`infra/host/`)과 엣지(`infra/edge/`)가 먼저 떠 있어야 한다. 엣지의 첫 상태 파일은 `infra/edge/state-sample/`을 `/srv/fit/state/`에 복사한 것이다(prod는 blue를 가리킨다)
-- prod 마이그레이션이 있는 배포는 사전 덤프 스크립트가 있어야 한다. 기본은 `infra/backup/pg-backup.sh`이고 `predeploy <환경> <sha>`로 부른다(계획 1D가 만든다). `FIT_PREDEPLOY_DUMP`로 바꿀 수 있다
+- prod 마이그레이션이 있는 배포는 사전 덤프 스크립트가 있어야 한다. 기본은 `infra/backup/pg-backup.sh`이고 `predeploy <환경> <sha>`로 부른다(결과는 `/srv/fit/predeploy/`, [backup](../backup/README.md)). `FIT_PREDEPLOY_DUMP`로 바꿀 수 있다
+- 데이터 스택(`infra/data/`)과 `/etc/fit/data.env`. `fit-up.sh`가 올리고 DB·버킷 초기화까지 한다([data](../data/README.md))
 - 웹훅 알림은 `FIT_NOTIFY_WEBHOOK` 또는 `/etc/fit/obs.env`의 `MATTERMOST_WEBHOOK_URL`을 읽는다(없으면 화면에만 출력)
 
 ## 이미지 계약
@@ -71,6 +72,7 @@ dev는 같은 흐름이지만 색이 없어서 교체하고, 확인에 실패하
 | `FIT_MIN_DISK_GB`, `FIT_MIN_MEM_MB` | 5, prod 2560 / dev 512 | 사전 점검의 여유 기준 |
 | `FIT_FORCE_MIGRATE=1` | | 마이그레이션 파일이 안 바뀌어도 마이그레이션을 실행한다 |
 | `FIT_SMOKE_SEARCH_PATH` | 없음 | 검색 1건을 호출해 `X-Fallback` 헤더가 없는지 본다(예: `/api/v1/search?q=김치`). 없으면 건너뛴다 |
+| `FIT_DATA_COMPOSE`, `FIT_OBS_COMPOSE` | `infra/data/compose.data.yml`, `infra/obs/compose.obs.yml` | `fit-up.sh`가 올릴 data·obs compose 파일. 파일이 없으면 건너뛴다(시험이 없는 파일을 가리킨다) |
 | `FIT_ENV_DIR`, `FIT_STATE_DIR`, `FIT_WEB_DIR`, `FIT_REPO_DIR`, `FIT_EDGE_PROJECT`, `FIT_NET_PROD`·`FIT_NET_DEV`·`FIT_NET_DATA` | `/etc/fit`, `/srv/fit/state`, `/srv/fit/web`, 저장소 루트, `fit-edge`, 망 이름 | 시험 환경이 바꾼다 |
 
 ## 노트북에서 시험하기
@@ -85,4 +87,4 @@ bash infra/deploy/test/test-deploy.sh down   # 시험이 만든 것을 모두 
 
 ## 서버에서만 확인되는 것
 
-실제 BE(Spring)와 FE(Next.js) 이미지의 준비 시간과 메모리, 실제 Postgres와 사전 덤프(계획 1D), 실제 도메인과 인증서를 거친 스모크, 서버의 파일 권한(`root:docker 0640`), 메모리 여유 판정(`MemAvailable`), 재부팅 뒤 `fit-up.sh`의 실제 기동 순서.
+실제 BE(Spring)와 FE(Next.js) 이미지의 준비 시간과 메모리, 실제 BE 마이그레이션과 사전 덤프의 조합(사전 덤프 스크립트 자체는 실제 Postgres로 시험했다. [backup](../backup/README.md)), 이 시험이 건너뛰는 data 스택의 기동과 초기화(`infra/data/test/test-data.sh`가 따로 시험한다), 실제 도메인과 인증서를 거친 스모크, 서버의 파일 권한(`root:docker 0640`), 메모리 여유 판정(`MemAvailable`), 재부팅 뒤 `fit-up.sh`의 실제 기동 순서.
````

````diff
diff --git a/infra/README.md b/infra/README.md
index d354f9c..ca8fd5d 100644
--- a/infra/README.md
+++ b/infra/README.md
@@ -10,6 +10,8 @@ Fit Dining 인프라 코드. 설계는 [docs/infra/design.md](../docs/infra/desi
 - `host/` 서버 부트스트랩(`bootstrap.sh`)과 점검(`verify-host.sh`), 공유 Docker 망, 컨테이너 시험. 사용법은 [host/README.md](host/README.md)
 - `app/` BE·FE 컨테이너 정의(`compose.app.yml`)와 환경변수 예제(`app.env.example`, `migrate.env.example`, `fe.env.example`). 키 계약은 [docs/infra/contracts/env.md](../docs/infra/contracts/env.md)
 - `deploy/` 배포·롤백·사전 점검·스모크·재부팅 뒤 기동(`deploy.sh` 등)과 노트북 시험 환경. 사용법은 [deploy/README.md](deploy/README.md)
+- `data/` 데이터 스택(Postgres, OpenSearch, Redis 2개, Garage)의 compose와 멱등 초기화 스크립트(DB·role·버킷·키), 점검, 노트북 시험. 사용법은 [data/README.md](data/README.md)
+- `backup/` Postgres 덤프·사진·인증서 볼륨의 암호화 백업, B 금고로 전송과 수신 검증, 복원 리허설, 마이그레이션 전 덤프, 설치 스크립트와 systemd 타이머, 노트북 시험. 사용법은 [backup/README.md](backup/README.md)
 
 가드가 강제하는 규칙:
 
````

````diff
diff --git a/docs/infra/design.md b/docs/infra/design.md
index 933e23f..70b8d59 100644
--- a/docs/infra/design.md
+++ b/docs/infra/design.md
@@ -438,7 +438,7 @@ Caddy 컨테이너(`caddy:2.x`, 구현 시 최신 2.x를 핀)가 A의 80·443만
 **`lint:*` 잡**
 
 - `lint:guards`: 단위 테스트, CRLF, `infra/`의 env 예제 형식, env 계약과 예제 파일의 키 일치, 포트 규칙
-- `lint:image-arch`: 도구 이미지 핀, 로컬 스택, 엣지 이미지가 바뀔 때만 돈다
+- `lint:image-arch`: 도구 이미지 핀, 로컬 스택, 엣지, 데이터 스택, 백업 시험 이미지가 바뀔 때만 돈다
 - `lint:shell`, `lint:docker`, `lint:yaml`: `infra/`와 루트 설정만 엄격하게 본다. be의 Dockerfile은 오류 수준만 막는다. 다른 팀 코드는 각자의 잡이 맡는다
 - `lint:secrets`: 저장소 전체와 MR 커밋 이력
 - `lint:history`: MR에서만 돈다. MR 안의 병합 커밋(3-way merge)을 막는다
@@ -469,7 +469,7 @@ BE와 FE는 같은 절차로 전환하되 BE가 먼저, FE가 나중이다. 새
 
 - `fit-app-prod`와 `fit-app-dev`는 `infra/app/compose.app.yml` 하나를 프로필(`prod`, `dev`)로 나눠 쓴다. 이미지 태그와 활성 색은 상태 파일 `/srv/fit/state/deploy-<환경>.env`가 정하고(compose의 `--env-file`), 처음 배포는 활성이 green으로 시작해 blue로 간다(엣지 견본의 upstream과 같다).
 - 준비 확인과 idle 색 확인은 호스트에 게시하지 않는 포트를 위해 같은 망의 caddy 컨테이너 안에서 `wget`으로 한다. BE는 `/actuator/health/readiness`, `/healthz`, `/api/v1/version`(SHA), FE는 `/fe-healthz`, `/`, `/config.json`(`env`)이다.
-- 마이그레이션은 이전 배포 SHA와 새 SHA 사이에 `be/src/main/resources/db/migration`이 바뀌었을 때(첫 배포 포함)만 실행한다. prod는 그 전에 `infra/backup/pg-backup.sh predeploy <환경> <sha>`(계획 1D)로 덤프하고, 덤프나 마이그레이션이 실패하면 트래픽을 건드리기 전에 멈춘다.
+- 마이그레이션은 이전 배포 SHA와 새 SHA 사이에 `be/src/main/resources/db/migration`이 바뀌었을 때(첫 배포 포함)만 실행한다. prod는 그 전에 `infra/backup/pg-backup.sh predeploy <환경> <sha>`(8절)로 덤프하고, 덤프나 마이그레이션이 실패하면 트래픽을 건드리기 전에 멈춘다.
 - 새 색의 준비·직접 확인이나 엣지 전환 뒤 확인에 실패하면 새 색을 치우고 엣지를 이전 색으로 되돌린다. BE는 성공하고 FE가 실패하면 BE는 새 버전, FE는 이전 버전으로 남는다(새 BE가 직전 FE와 호환돼야 한다). `rollback.sh`는 서비스별로 이전 색(컨테이너와 이미지가 남아 있다)으로 옮기고, 전체 롤백이면 `DEPLOYED_SHA`와 `PREVIOUS_SHA`를 맞바꾼다.
 - 사전 점검은 FE env의 `BE_INTERNAL_URL`이 이 환경의 엣지 내부 리스너(prod `caddy:8081`, dev `caddy:8082`)인지 확인한다. 같은 망의 컨테이너는 어느 환경의 리스너에도 닿으므로 환경 간 호출을 여기서 막는다.
 - 정적 자산 풀(`/srv/fit/web/<환경>/pool/_next/static`)은 FE 이미지의 `/app/.next/static`을 `docker cp`로 꺼내 이미 있는 파일은 덮어쓰지 않고 쌓는다. 이번 릴리스가 가진 파일의 수정 시각을 갱신하고, 14일 넘게 어느 릴리스에도 없던 파일은 지운다.
@@ -512,12 +512,15 @@ FE는 `fe/`의 Next.js를 `output: 'standalone'`으로 빌드한 Node 컨테이
 
 - 이미지는 `pgvector/pgvector:0.8.7-pg16`으로 핀한다(로컬 스택과 같다).
 - 튜닝은 mount한 설정 파일이 아니라 `command:` 플래그로 한다(shared_buffers 256MB, max_connections 60, `idle_in_transaction_session_timeout`, `pg_stat_statements`).
-- 환경별 DB·role은 init 스크립트가 아니라 멱등 `ensure-databases.sh`로 만든다. init 스크립트는 빈 볼륨에서 한 번만 돌기 때문이다(A503 함정). dev role에는 `statement_timeout`을 건다.
+- 환경별 DB·role은 init 스크립트가 아니라 멱등 `infra/data/ensure-databases.sh`로 만든다. init 스크립트는 빈 볼륨에서 한 번만 돌기 때문이다(A503 함정). role은 `fit_migrator`(DDL, 두 DB의 소유자), `fit_prod_app`, `fit_dev_app`(DML만)이고 DB는 `fit_prod`, `fit_dev`다. 각 앱 role은 자기 DB에만 접속하고(`REVOKE ... FROM PUBLIC`), 마이그레이터가 만드는 테이블·시퀀스에는 기본 권한으로 DML 권한이 따라간다. 비밀번호는 실행할 때마다 `/etc/fit/data.env` 값으로 맞춘다(교체는 값을 바꾸고 다시 실행). dev role에는 `statement_timeout` 30초를 건다 (확인: `infra/data/test/test-data.sh`).
+- 비밀번호는 SQL에 그대로 들어가므로 영문·숫자·`._~-`만 쓴 16자 이상으로 제한하고 스크립트가 그 밖의 값을 거부한다. data.env는 셸로 실행하지 않고 `KEY=VALUE` 줄만 읽는다. SQL은 표준 입력으로 넘기고 `log_statement`와 `pg_stat_statements.track_utility`를 꺼서 비밀번호가 프로세스 목록, Postgres 로그, 통계에 남지 않는다 (확인: 위 시험).
+- 공식 이미지는 컨테이너 안 loopback 접속을 비밀번호 없이 허용(trust)한다. 다른 컨테이너가 서비스 이름으로 들어오는 접속은 scram-sha-256 비밀번호 검사를 받는다 (확인: 틀린 비밀번호가 거부됨). 호스트 게시 포트(`127.0.0.1:5432`)로 들어오는 접속은 출발지가 loopback이 아니라 같은 규칙을 받는다 (서버에서 터널로 확인).
 - 개발자용 dev DB 접근은 SSH 터널 → `127.0.0.1:5432`이고 dev role 비밀번호만 공유한다.
 
 ### 7.2 OpenSearch
 
 - 공식 이미지(`opensearchproject/opensearch:3.9.0`)에 `analysis-nori`를 설치한 커스텀 이미지다(힙 768MB). 설치는 `opensearch-plugin install --batch analysis-nori`다. 로컬에서 빌드해 `analysis-nori`와 `opensearch-knn` 플러그인이 있고 nori 분석기가 동작함을 확인했다 (확인: `infra/local/fit-local.sh`).
+- 서버용 정의는 `infra/data/compose.data.yml`이고 로컬과 같은 Dockerfile(`infra/local/opensearch`)을 빌드한다(메모리 상한 2GB, 힙 768MB, 호스트 게시 없음). 이 compose로 띄운 OpenSearch에서 nori 분석기가 한국어를 형태소로 나눈다(`닭가슴살` → `닭`, `가슴`, `살`) (확인: `FIT_TEST_OPENSEARCH=1 bash infra/data/test/test-data.sh`). 빈 인덱스 상태에서 컨테이너 메모리는 약 1.3GiB였다(4.1절의 평상시 추정과 같다. Postgres 약 63MiB, Redis 각 약 4MiB, Garage 약 5MiB는 유휴 값이라 실제 데이터로 다시 잰다).
 - single-node이고 보안 플러그인은 끈다. 내부 망이고 호스트 게시가 없다는 전제이며 잔여 위험은 13절에 있다.
 - `action.destructive_requires_name=true`, 인덱스 템플릿은 `replicas: 0`이다(아니면 yellow).
 - 무중단 재색인은 별칭 전환이다(BE 계약).
@@ -527,7 +530,7 @@ FE는 `fe/`의 Next.js를 `output: 'standalone'`으로 빌드한 Node 컨테이
 
 ### 7.3 Redis ×2
 
-`redis-prod`, `redis-dev`. maxmemory 96MB, `noeviction`(멱등성 키가 쫓겨나지 않게), AOF everysec, requirepass.
+`redis-prod`, `redis-dev`. maxmemory 96MB, `noeviction`(멱등성 키가 쫓겨나지 않게), AOF everysec, requirepass(환경별 비밀번호). maxmemory를 넘으면 기존 키를 쫓아내지 않고 쓰기를 `OOM` 오류로 거절하고, 재시작하면 AOF로 데이터가 돌아오며, dev 비밀번호로는 prod Redis에 들어가지 못한다 (확인: `infra/data/test/test-data.sh`).
 
 ### 7.4 사진 저장소 (Garage)
 
@@ -540,7 +543,7 @@ Garage(`dxflrs/garage:v2.4.1`, 데이터·메타 볼륨, 설정은 디렉터리
 
 **첫 주 스파이크(2시간):** PostObject의 `content-length-range` 강제 여부, presigned PUT/POST가 Caddy 경유(Host 보존)로 서명이 통과하는지, 수명주기 동작, 웹 엔드포인트(3902)로 `confirmed/` 공개 읽기가 되고 익명 S3 GET은 거부되는지를 확인한다. 웹 엔드포인트의 공개 읽기와 익명 S3 GET 거부는 로컬 스택 점검에서 확인했다 (확인). 나머지는 서버에서 확인한다. 실패하면 Cloudflare R2나 Firebase Storage로 간다(계정·결제수단 필요, 국외 이전이면 처리방침 고지).
 
-Garage는 단일 노드라도 레이아웃 설정이 필요하다(`layout assign/apply`, 버킷·키 생성). 로컬에서 v2.4.1로 확인했고 멱등 스크립트는 `infra/local/fit-local.sh`의 `init_garage`다 (확인). 서버용 스크립트는 계획 1D가 같은 순서로 만들고 키는 `/etc/fit/*.env`에 둔다. 메모리는 작을 것으로 보고(추정) 0.25GB를 잡았다.
+Garage는 단일 노드라도 레이아웃 설정이 필요하다(`layout assign/apply`, 버킷·키 생성). 로컬의 멱등 스크립트는 `infra/local/fit-local.sh`의 `init_garage`다 (확인). 서버용 멱등 스크립트는 `infra/data/init-garage.sh`이고 환경별 키는 `/etc/fit/data.env`에 둔다. 키 ID는 `GK` + 16진수 24자리, 비밀 키는 16진수 64자리여야 하고(Garage의 `key import` 형식) 스크립트가 이미 있는 키는 바꾸지 않는다. 버킷마다 자기 환경의 키에만 읽기·쓰기·소유 권한을 주고 웹 엔드포인트 공개 읽기와 수명주기(`pending/`와 끝나지 않은 멀티파트를 1일 뒤 삭제)를 건다. 호스트에는 S3 도구가 없고 Garage의 S3 포트를 게시하지 않으므로 스크립트는 net-data에 붙인 python 컨테이너에서 서명한 요청(`infra/data/s3tool.py`, 표준 라이브러리 SigV4)으로 수명주기 설정과 사진 읽기를 한다. 실제 Garage v2.4.1에서 dev 키가 prod 버킷을 읽거나 쓰지 못하고, 서명 없는 S3 GET은 거부되며 웹 엔드포인트 읽기는 되고, 재시작 뒤에도 객체와 레이아웃이 남으며 초기화를 다시 실행해도 변경이 없음을 확인했다 (확인: `infra/data/test/test-data.sh`). 메모리는 작을 것으로 보고(추정) 0.25GB를 잡았다.
 
 ## 8. 백업·복구
 
@@ -549,21 +552,23 @@ Garage는 단일 노드라도 레이아웃 설정이 필요하다(`layout assign
 | 대상 | 주기 | 보관 위치 |
 |---|---|---|
 | Postgres 덤프 | 4시간마다 | A 로컬, B 금고(4시간 단위 48시간 + 일 단위 14일) |
-| 사진 | 하루 1회(사진의 RPO는 24시간) | B 금고(rclone, S3 API 경유) |
+| 사진 | 하루 1회(사진의 RPO는 24시간) | A 로컬, B 금고(S3 API로 읽어 tar로 묶는다) |
 | Caddy 인증서 볼륨 | 주 1회 | B 금고 |
 | `/etc/fit/*.env` | 변경 때마다(수동) | 팀 비밀번호 관리자(암호화) |
 | OpenSearch | 백업하지 않는다 | Postgres에서 재색인 |
 
-1. **덤프와 검증(A):** A가 4시간마다 `pg_dump -Fc`를 뜬다. 하루 1회 이상은 같은 덤프를 임시 컨테이너 DB에 복원해 sanity 검사를 한다(덤프 시점 검증, `verify-dump.sh`). 통과하면 `age`로 암호화한다. 수신자는 2명(인프라 담당, 백업 담당)이고 공개키만 A에 둔다.
-2. **전송:** B로 `rsync`한다. 전용 `vault` 사용자가 쓰기 전용 강제 명령(`rrsync -wo -no-del /srv/vault/incoming`)으로만 접속하므로 삭제 옵션이 막힌다. `rrsync`는 구현 시 확인한다 (미확인).
-3. **보관(B):** B의 timer가 sha256·크기를 검증하고 `incoming`에서 `store`로 옮기며 보관 정책(4시간 단위 48시간 + 일 단위 14일)을 적용한다. 마지막 수신 시각을 지표로 낸다. 8시간 넘게 새 백업이 안 오면 B가 알린다(A가 죽어도 감지).
+1. **덤프와 검증(A):** A가 4시간마다 `pg_dump -Fc`를 뜬다(`infra/backup/pg-backup.sh scheduled`). 마지막 검증 뒤 24시간이 지났으면 같은 덤프를 임시 컨테이너 DB(망 없음, 메모리 디스크)에 복원해 검사한다(덤프 시점 검증, `verify-dump.sh`). 복원 오류가 없고 복원된 public 테이블 수가 덤프 시점의 수와 같아야 통과한다. 통과하면 `age`로 암호화한다. 실패하면 그 덤프는 보내지 않고 `failed-verify-*`로 남기며 지표 `fit_backup_last_verify_ok`가 0이 된다. 수신자는 2명(인프라 담당, 백업 담당)이고 공개키만 A에 둔다(`/etc/fit/keys/age-recipients.txt`). 수신자 2명이 각자 풀 수 있고 수신자가 아닌 키로는 풀 수 없으며, 암호화 파일에서 테이블 이름이나 데이터가 보이지 않고, 복원한 DB에서 원래 행이 조회됨을 확인했다 (확인: `infra/backup/test/test-backup.sh`).
+2. **전송:** B로 `rsync`한다(`push-vault.sh`). 암호화 파일을 먼저, sha256·크기를 적은 `.meta`를 나중에 보내고 B는 `.meta`가 있어야 받은 것으로 친다. 전용 `vault` 사용자가 쓰기 전용 강제 명령(`rrsync -wo -no-del /srv/vault/incoming`, `restrict`, 선택적으로 `from=<A의 IP>`)으로만 접속한다. Ubuntu 24.04에서 A의 키로 셸 명령 실행, 금고 읽기, `--delete`, `incoming/` 밖 쓰기가 모두 거부되고 등록하지 않은 주소에서는 같은 키도 거부됨을 확인했다 (확인: 위 시험). 22.04의 `rrsync`는 `python3`가 있어야 한다. B의 호스트 키는 사람이 지문을 B의 지문과 대조한 뒤 등록한 `known_hosts`로 고정하고, 다른 키가 오면 보내지 않는다 (확인: 위 시험). 보내기에 성공한 파일만 A의 outbox에서 지우고 실패하면 다음 실행이 다시 보낸다.
+3. **보관(B):** B의 timer가 10분마다 `vault-ingest.sh`를 돌린다. `incoming`의 파일을 root만 쓰는 staging으로 옮긴 뒤(vault 계정이 검증 뒤에 바꿔치기하지 못하게) 이름 형식, sha256, 크기, 일반 파일 여부를 검증해 `store/<종류>/`로 옮기고 실패한 것은 `store/quarantine/`으로 보낸다. 보관 정책(4시간 단위 48시간 + 한국 시간 기준 하루 1벌 14일)을 적용하고 마지막 수신 시각, 보관 수·크기, 격리·실패 수를 지표로 낸다. 8시간 넘게 새 백업이 안 오면 B가 알린다(A가 죽어도 감지, 알림 규칙은 계획 1E). 손상된 파일, 크기가 다른 파일, 형식이 틀린 `.meta`, 심볼릭 링크는 격리되고 보관소에 들어가지 않음을 확인했다 (확인: 위 시험).
 4. **복호화 키:** 개인키는 A·B 어디에도 두지 않고 수신자 2명이 각자 오프라인으로 보관한다. 서버가 뚫려도 백업 평문이 나가지 않는 대신 자동 복원 리허설은 하지 않는다.
-5. **복원 리허설:** 사람이 노트북(Docker Desktop)에서 B 사본을 내려받아 복호화·복원하고 걸린 시간(RTO)을 `restore-check.sh`로 기록한다. 주 1회 하고 11/06 전에는 최소 2회 한다. 결과는 B에 기록해 지표로 낸다. 내려받은 암호화 덤프 최신 1벌은 노트북에 남긴다(3번째 사본, 13.4절).
-6. **A 로컬 보관:** 같은 보관 정책(4시간 단위 48시간 + 일 단위 14일)을 쓴다.
-7. **그 외 대상:** 사진과 Caddy 인증서 볼륨도 같은 경로로 B에 보낸다. OpenSearch는 Postgres에서 재색인한다. `/etc/fit/*.env`는 자동화하지 않고 인프라 담당이 변경 때마다 암호화해 팀 비밀번호 관리자에 둔다.
+5. **복원 리허설:** 사람이 노트북(Docker Desktop, `age`)에서 B 사본을 내려받아 복호화·복원하고 걸린 시간(RTO)을 `restore-check.sh`로 잰다. 주 1회 하고 11/06 전에는 최소 2회 한다. 결과는 B에서 `vault-ingest.sh record-restore <epoch> <RTO>`로 기록해 지표(`fit_vault_last_restore_check_*`)로 낸다. 내려받은 암호화 덤프 최신 1벌은 노트북에 남긴다(3번째 사본, 13.4절). 절차는 `infra/backup/README.md`다.
+6. **A 로컬 보관:** 같은 보관 정책(4시간 단위 48시간 + 일 단위 14일)을 쓴다(`/srv/fit/backups/{pg,photos,caddy}`, 보낼 파일은 `outbox/`).
+7. **그 외 대상:** 사진(`files-backup.sh photos`: prod 버킷 전체를 S3 API로 읽어 tar)과 Caddy 인증서 볼륨(`files-backup.sh caddy`: 데이터 볼륨을 읽기 전용으로 tar)도 암호화해 같은 경로로 B에 보낸다. OpenSearch는 Postgres에서 재색인한다. `/etc/fit/*.env`는 자동화하지 않고 인프라 담당이 변경 때마다 암호화해 팀 비밀번호 관리자에 둔다. 백업하는 DB는 `fit_prod`뿐이다(dev DB와 dev 사진은 하지 않는다).
 8. **선택(P2):** GitLab Package Registry에 암호화 사본을 2차로 올린다. Lightsail 스냅샷은 권한이 있으면 일 1회 자동으로 켠다(권한 (미확인)).
 9. **B 소실:** 금고 내용은 사라지지만 A에 로컬 사본이 있다. B를 재구축한다(RB-01).
 10. **A 소실(RB-12):** bootstrap → 금고에서 복원(사람, 개인키 사용) → OpenSearch 재색인 → 사진 복원 → env를 팀 비밀번호 관리자에서 복구 → 배포 순서다.
+11. **마이그레이션 전 덤프:** `pg-backup.sh predeploy <환경> <sha>`가 평문 덤프를 `/srv/fit/predeploy/`에 두고 환경별 최근 5개만 남긴다. 개인키가 서버에 없어 암호화하면 급할 때 복원할 수 없고, 이 덤프는 A의 DB 볼륨과 같은 신뢰 범위에 있으며 B로 보내지 않는다. 디렉터리는 배포 러너(`gitlab-runner`, docker 그룹)가 쓸 수 있도록 root 전용 백업 디렉터리 밖에 두고(`root:docker 2770`) 파일은 640이다.
+12. **설치:** `infra/backup/install.sh app|ops`가 패키지(`age`, `rsync`), 디렉터리, 전송 키, systemd 타이머(A: `fit-backup-pg`(00:15부터 4시간마다), `fit-backup-photos`(04:40), `fit-backup-caddy`(일요일 04:50), B: `fit-vault-ingest`(10분마다))를 멱등하게 만든다. 타이머는 저장소 체크아웃이 아니라 root만 쓸 수 있는 사본(`/usr/local/lib/fit/repo`)을 실행해서 배포 러너가 저장소를 바꿔도 root로 도는 백업 코드가 바뀌지 않는다. 유닛 파일은 `systemd-analyze`로 `OnCalendar` 표현과 문법을 확인했다 (확인: `test-backup.sh`의 `units` 구역, systemd 255). 지표는 Prometheus textfile 형식으로 A는 `/var/lib/fit/metrics/fit_backup.prom`, B는 `/srv/vault/metrics/fit_vault.prom`에 쓰고 수집은 계획 1E다. 타이머의 실제 실행, A↔B의 실제 네트워크, 22.04의 `rrsync`는 서버에서 확인한다.
 
 종료(11/18)에는 합성 데이터 덤프를 만들어 포팅 매뉴얼에 첨부한다(실데이터를 커밋한 A603 사고 방지). 실데이터와 호스트 밖 사본은 RB-10으로 삭제한다.
 
@@ -896,7 +901,8 @@ AI 팀과 M1 전에 합의한다. FastAPI는 Modal에서 돌고 A·B에는 AI 
 | `/etc/fit/data.env` | A | root:docker 0640 | DB·Redis·Garage 자격 |
 | `/etc/fit/edge.env` | A | root:docker 0640 | `ACME_EMAIL`, `ACME_MODE`, `HSTS_MODE`, `PROD_HOST`, `DEV_HOST`, B의 IP, `/_ops` basic auth 해시, dev 게이트 키(`?k=` 쿠키 발급용) |
 | `/etc/fit/obs.env` | A | root:docker 0640 | Grafana admin, Mattermost 웹훅 |
-| `/etc/fit/keys/` | A | root:root 0400 | vault SSH 개인키, B 접속 정보, age 공개키(호스트 간 전송용) |
+| `/etc/fit/backup.env` | A, B | root:docker 0640 | 백업 설정(B의 주소와 SSH 포트, 보관 기간). 비밀은 없다 |
+| `/etc/fit/keys/` | A | root:root 0700(파일 0600) | vault SSH 개인키(`vault_ed25519`), B의 호스트 키(`vault_known_hosts`), age 수신자 공개키(`age-recipients.txt`) |
 | `/etc/fit/ops.env` | B | root:docker 0640 | Mattermost 웹훅, A의 `/_ops` 자격 |
 | age 개인키 | 서버 없음 | 수신자 2명이 오프라인 보관 | 백업 복호화 |
 
@@ -914,7 +920,7 @@ AI 팀과 M1 전에 합의한다. FastAPI는 Modal에서 돌고 A·B에는 AI 
 | A (root timer) | B | `vault` | `rrsync -wo -no-del /srv/vault/incoming` |
 | B | A | 없음 | HTTPS 프로브만(`/healthz`, `/_ops/*`) |
 
-키 자체는 repo에 두지 않는다. 배포 러너 사용자(`gitlab-runner`)는 `/etc/fit/keys/`를 읽지 못한다(root 0400, systemd timer만 사용).
+키 자체는 repo에 두지 않는다. 배포 러너 사용자(`gitlab-runner`)는 `/etc/fit/keys/`를 읽지 못한다(root 0700, systemd timer만 사용).
 
 ### 13.4 한계
 
@@ -998,7 +1004,7 @@ AI 팀과 M1 전에 합의한다. FastAPI는 Modal에서 돌고 A·B에는 AI 
 | 14 | 푸시 방식(FCM 웹 푸시 vs VAPID 직접 구현) | 프런트 팀 | M2 |
 | 15 | Docker 29일 때 cAdvisor·Dozzle 호환 | 인프라 | 사전(로컬 Docker 29.7.2로 확인) |
 | 16 | 포팅 매뉴얼 필요 여부와 양식 | 팀, 코치 | M3 전 |
-| 17 | `rrsync` 가용성, buildx 자원 상한 방법 | 인프라 | M0~M1 |
+| 17 | buildx 자원 상한 방법. `rrsync`는 24.04에서 확인했고(8절) 22.04는 서버에서 확인한다 | 인프라 | M0~M1 |
 | 18 | 프런트 팀 합의: 12.5절 계약(standalone 빌드, 같은 출처, 환경 값, 헬스, 이미지, 서비스 워커, dev 게이트, 쿠키, SSE, 공유) | 프런트 팀, 인프라 | M1 전 |
 | 19 | 가게 데이터에 네이버 장소 ID(또는 URL)가 포함되는지. 없으면 상호·주소 검색 링크로 대체(정확도 낮음) | BE·AI 팀 | M1 전 |
 | 20 | Modal 워크스페이스 접근 권한, 지출 한도·알림 설정 담당, 콜드 스타트·상시 가동 정책과 비용 상한 | AI 팀, 인프라 | M1 전 |
@@ -1016,12 +1022,12 @@ AI 팀과 M1 전에 합의한다. FastAPI는 Modal에서 돌고 A·B에는 AI 
 infra/
   host/        bootstrap.sh, verify-host.sh, networks.sh, docker-prune.sh, README.md, conf/(sshd, sysctl, daemon.json, fail2ban, apt, systemd units), test/(test-host.sh, run-in-container.sh)
   edge/        compose.edge.yml, conf/(Caddyfile, acme/, hsts/), state-sample/, edge.env.example, edgectl.sh, verify-edge.sh, README.md, test/(compose.test.yml, test-edge.sh, 목 BE·FE)
-  data/        compose.data.yml, ensure-databases.sh, opensearch/Dockerfile, garage/ 설정과 초기화 스크립트
+  data/        compose.data.yml, data.env.example, lib.sh, init-data.sh, ensure-databases.sh, init-garage.sh, verify-data.sh, s3tool.py, garage/garage.toml, README.md, test/(test-data.sh, compose.test.yml). OpenSearch는 local/opensearch/Dockerfile을 빌드한다
   app/         compose.app.yml(프로필 prod·dev), *.env.example
   obs/         compose.obs.yml, prometheus/(rules, tests), alertmanager/, grafana/(provisioning, dashboards), blackbox/
-  ops/         (B) compose.ops.yml, prometheus/, alertmanager/, blackbox, port-audit.sh, vault-ingest.sh
+  ops/         (B) compose.ops.yml, prometheus/, alertmanager/, blackbox, port-audit.sh
   deploy/      deploy.sh, rollback.sh, preflight.sh, smoke.sh, notify.sh, fit-up.sh, lib.sh, README.md, test/(test-deploy.sh, 목 BE·FE 이미지)
-  backup/      pg-backup.sh, verify-dump.sh, push-vault.sh, photos-backup.sh, restore-check.sh(노트북용)
+  backup/      lib.sh, pg-backup.sh, verify-dump.sh, files-backup.sh(photos, caddy), push-vault.sh, backup-run.sh, vault-ingest.sh(B), vault-authorize.sh(B), restore-check.sh(노트북용), install.sh, backup.env.example, conf/systemd/, README.md, test/(test-backup.sh, node/Dockerfile)
   ci/          ports_invariant.py, check_compose_projects.py, check_env_files.py, check_env_contract.py, check_eol.py, check_linear_history.py, no-merge-commit.sh, check-caddy.sh, migration_immutability.py, images_arch.py, run-local-checks.sh, tool-images.sh, compose-projects.txt, tests/
   local/       compose.yml (profile: core, search), fit-local.sh, local.env.example, garage/, opensearch/Dockerfile, README.md
 .gitlab-ci.yml
@@ -1093,6 +1099,10 @@ docs/infra/
 | 보안 | 팀원 접근 | 비특권 계정 + SSH 터널 | infra 담당만, 전원 sudo |
 | 백업 | 백업 키 | 서버에 두지 않고 2인 오프라인 보관 | B에 키를 두고 복원 자동화 |
 | 백업 | 호스트 밖 백업 위치 | B 금고. GitLab Package Registry는 선택적 2차 사본(P2) | GitLab Package Registry를 주 저장소로 |
+| 백업 | 마이그레이션 전 덤프 | 평문, A의 `/srv/fit/predeploy`(최근 5개), B로 보내지 않는다 | 암호화(개인키가 서버에 없어 급할 때 복원하지 못한다) |
+| 백업 | 백업 코드 실행 위치 | root 소유 사본(`/usr/local/lib/fit/repo`)에서 타이머가 돈다 | 저장소 체크아웃에서 실행(배포 러너가 root로 도는 코드를 바꿀 수 있다) |
+| 백업 | 금고 수신 검증 | incoming을 신뢰하지 않고 root 전용 staging에서 sha256·크기·이름을 검증, 실패는 격리 | incoming에서 바로 검증해 이동(검증 뒤 바꿔치기 가능) |
+| 백업 | 덤프 검증 방식 | 임시 컨테이너에 복원하고 테이블 수를 덤프 시점 값과 비교 | `pg_restore -l` 목차 확인만(데이터가 읽히는지 모른다) |
 | 관측성 | B 감시 구성 | Prometheus-B·Alertmanager-B·blackbox(설정이 repo에 남는다) | Uptime Kuma 한 개(설정이 UI에 남아 repo 관리 원칙과 어긋난다) |
 | 관측성 | 우선순위 | 감시 체계 감시(`/_ops`)는 P0, `lint:image-arch`는 P1 | 둘 다 P2로 내리기(비용이 거의 없어 유지) |
 
````

````diff
diff --git a/docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md b/docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md
index 12f3c31..198379d 100644
--- a/docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md
+++ b/docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md
@@ -94,7 +94,7 @@
 |---|---|
 | [1B 로컬 개발 환경과 서비스 계약](2026-10-19-plan-1b-local-env-contracts.md) | `infra/local/compose.yml`(profile `core`: Postgres(pgvector)·Redis·Garage, `search`: nori를 넣은 OpenSearch)과 `fit-local.sh`, `docs/infra/contracts/`(env.md와 합의 상태 목록. BE·AI(Modal 호출)·프런트 계약은 합의되면 옮긴다), `*.env.example`, 계약과 예제의 일치 검사. BE·FE 팀이 이미 개발 중이라 서버 없이도 가장 먼저 쓰이는 산출물이고, 계약은 M1 전에 합의해야 한다 |
 | 1C 엣지와 배포(셋으로 나눈다) | **1C-1 엣지**([계획](2026-10-20-plan-1c1-edge.md)): Caddyfile(호스트별 사이트, Next.js SSR 프록시와 정적 자산 풀, dev 쿠키 게이트, 사진 업로드·읽기 프록시), `compose.edge.yml`, `edgectl.sh`, `verify-edge.sh`, 노트북 시험 환경. **1C-2 배포 스크립트**([계획](2026-10-21-plan-1c2-deploy.md)): `compose.app.yml`(be, fe), `deploy.sh`(BE·FE Blue/Green과 정적 자산 풀 동기화)·`rollback.sh`·`preflight.sh`(다운그레이드 가드, `BE_INTERNAL_URL` 포트 확인 포함)·`smoke.sh`(검색 1건의 폴백 표시 확인 포함)·`fit-up.sh`(재부팅 뒤 기동 순서), 로컬 시뮬레이션. **1C-3 CI 파이프라인**: `.gitlab-ci.yml`의 `be:test`·`fe:test`·`fe:build`(FE 산출물 검사 포함)·`build`·`deploy`(`environment`, 환경별 `resource_group`)·`smoke` 잡. 이 계획의 `check_env_files.py`, `ports_invariant.py`를 호출한다 |
-| 1D 데이터와 백업 | compose.data.yml, `ensure-databases.sh`, 백업·검증·전송·복원 스크립트 |
+| 1D 데이터와 백업([계획](2026-10-21-plan-1d-data-backup.md)) | `infra/data/`(`compose.data.yml`, `ensure-databases.sh`, `init-garage.sh`, `init-data.sh`, `verify-data.sh`, 노트북 시험), `infra/backup/`(`pg-backup.sh`(scheduled, predeploy), `verify-dump.sh`, `files-backup.sh`, `push-vault.sh`, `vault-ingest.sh`, `vault-authorize.sh`, `restore-check.sh`, `install.sh`, systemd 유닛, 노트북 시험), `fit-up.sh`의 data 연결 |
 | 1E 관측성 | A와 B의 Prometheus·Alertmanager·blackbox 설정, 알림 규칙(Modal 폴백·예산 알림, B 도달 알림 포함)과 `promtool test`, 포트 노출 감사, 대시보드. B의 ops 스택 compose가 생기면 그 이미지의 arm64 검사를 `lint:image-arch`에 추가한다 |
 | 1F 호스트 부트스트랩([계획](2026-10-20-plan-1f-host.md)) | `infra/host/`(`bootstrap.sh` ROLE=app\|ops, `verify-host.sh`, `networks.sh`, `docker-prune.sh`, daemon.json, sysctl, sshd drop-in, fail2ban, 자동 업데이트, systemd 유닛), 컨테이너 시험. 설계 3절 |
 | 1G 런북과 포팅 매뉴얼 | 런북 초안 RB-01~13(설계 10.2절), 포팅 매뉴얼 골격(설계 17절) |
````

````diff
diff --git a/.gitlab-ci.yml b/.gitlab-ci.yml
index ee74ef1..59092b7 100644
--- a/.gitlab-ci.yml
+++ b/.gitlab-ci.yml
@@ -61,6 +61,7 @@ lint:image-arch:
     - python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --images-from-sh infra/ci/tool-images.sh
     - python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/local/compose.yml --env-file infra/local/local.env.example --dockerfile infra/local/opensearch/Dockerfile
     - python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/edge/compose.edge.yml --compose infra/edge/test/compose.test.yml --env-file infra/edge/edge.env.example
+    - python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/data/compose.data.yml --env-file infra/data/data.env.example --dockerfile infra/backup/test/node/Dockerfile
   rules:
     - changes:
         - infra/ci/tool-images.sh
@@ -69,6 +70,8 @@ lint:image-arch:
         - infra/local/opensearch/Dockerfile
         - infra/edge/compose.edge.yml
         - infra/edge/test/compose.test.yml
+        - infra/data/compose.data.yml
+        - infra/backup/test/node/Dockerfile
 
 # 인프라 소유 파일만 엄격하게 검사한다. be·fe·ai는 각 팀 린트가 맡는다(스펙 6.3, 12.2).
 lint:shell:
````

````diff
diff --git a/infra/ci/run-local-checks.sh b/infra/ci/run-local-checks.sh
index 46cb680..08072cc 100755
--- a/infra/ci/run-local-checks.sh
+++ b/infra/ci/run-local-checks.sh
@@ -121,6 +121,8 @@ check_all() {
     run_step "arch (로컬 스택)" "$PY" infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/local/compose.yml --env-file infra/local/local.env.example --dockerfile infra/local/opensearch/Dockerfile
     # 엣지는 서버 A(x86)에서, 시험 환경은 개발자 PC에서 돈다
     run_step "arch (엣지)" "$PY" infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/edge/compose.edge.yml --compose infra/edge/test/compose.test.yml --env-file infra/edge/edge.env.example
+    # 데이터 스택은 서버 A(x86)에서, 백업 시험 이미지는 개발자 PC에서 돈다
+    run_step "arch (데이터, 백업 시험)" "$PY" infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/data/compose.data.yml --env-file infra/data/data.env.example --dockerfile infra/backup/test/node/Dockerfile
   fi
   # 인프라 소유 파일만 엄격하게 본다. be·fe·ai는 각 팀 린트가 맡는다(스펙 6.3, 12.2). be의 Dockerfile은 오류만 막는다.
   check_tool shellcheck "$SHELLCHECK_IMAGE" 'infra/*.sh' -- shellcheck -x
````

- [ ] **Step 5: 전체 검사 (게이트)**

Run:

```bash
python -m unittest discover -s infra/ci/tests
bash infra/ci/run-local-checks.sh
bash infra/ci/run-local-checks.sh --self-test
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" sh -ec "find infra -type f -name '*.sh' -print0 | xargs -0 -r shellcheck -x"; echo "lint:shell exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$HADOLINT_IMAGE" sh -ec "find infra -type f \( -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name '*.Dockerfile' \) -print0 | xargs -0 -r hadolint"; echo "lint:docker exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml .gitlab-ci.yml .yamllint.yaml infra; echo "lint:yaml exit=$?"
git status --short
ls -a | grep -E 'tmp-' ; true
```

Expected: 단위 테스트 통과, `run-local-checks.sh`의 모든 줄이 `PASS`(또는 `SKIP`)이고 마지막이 `모든 검사 통과`, `--self-test`도 `모든 검사 통과`, `lint:shell exit=0`, `lint:docker exit=0`, `lint:yaml exit=0`. `git status`에는 이 계획이 만든 파일만 있고 `tmp-` 디렉터리는 남지 않는다.

- [ ] **Step 6: 커밋 (허용된 경우)**

```bash
git add infra/deploy/fit-up.sh infra/deploy/test/test-deploy.sh infra/deploy/README.md infra/data/README.md infra/backup/README.md infra/README.md docs/infra/design.md docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md .gitlab-ci.yml infra/ci/run-local-checks.sh
git commit -m "docs(infra): 데이터·백업 문서, fit-up 연결, 설계·로드맵·CI 동기화"
```
