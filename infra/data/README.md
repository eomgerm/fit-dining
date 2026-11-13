# 데이터 스택 (data)

## 세션 저장소 용량과 알림

배포 순서는 **데이터 스택 반영 → `bash infra/data/verify-data.sh` 통과 → BE 배포**다. BE를 배포하기 전에 변경된 compose로 `redis-prod`·`redis-dev` 컨테이너를 먼저 재생성해 `notify-keyspace-events`를 적용한다. AOF와 기존 볼륨은 유지하며, 재생성 중 짧은 연결 끊김이 생긴다. 앱이 자동 CONFIG를 하지 않으므로 이 순서를 바꾸면 만료 알림이 빠져 세션 인덱스 정리가 지연된다.

BE는 환경마다 `fitdining:session:<APP_ENV>` 네임스페이스의 Spring Session 인덱스 저장소를 사용한다. Redis 명령의 `--notify-keyspace-events Egx`는 만료·삭제 이벤트를 전달한다. 앱은 `ConfigureRedisAction.NO_OP`와 `configure-action: none`으로 자동 `CONFIG SET`을 하지 않으므로 compose 변경 후 Redis 컨테이너를 재생성해야 한다.

용량은 2026-11-10에 dev에서 실측했다. 로그인 세션 1개가 키 4개(세션 본체, 만료 표시, 만료 목록, 사용자 인덱스)를 쓰고 합계 1,912 B(약 1.9 KiB)였다. 처음 추정(세션당 약 4 KiB)의 절반이다. 세션이 없을 때 Redis의 기본 사용량은 약 1.0 MiB(dev는 세션 1개로 1.4 MiB)이고 상한은 96 MiB(`maxmemory 96mb`)다. 80% 지점(약 77 MiB)까지 실측 기준으로 약 4만 세션, 4 KiB로 잡아도 약 1.9만 세션이 들어간다. 표본이 세션 1개뿐이라 세션이 많이 쌓였을 때의 평균은 아직 모른다. 같은 사용자의 세션이 여럿이면 사용자 인덱스를 나눠 쓰므로 세션당 값은 줄어드는 쪽으로 보인다. 호출 예산 카운터 같은 다른 Redis 용도와 allocator 단편화는 이 계산에 넣지 않았다. `noeviction`이므로 한도 도달 시 세션 저장이 실패한다. 사용률 알림은 없고, 컨테이너가 사라지는 것만 `FitRedisProdDown`과 `FitRedisDevDown`이 알린다(떠 있지만 응답하지 않는 경우는 잡지 못한다). 다시 재려면 서버에서 `INFO memory`, `INFO keyspace`, `MEMORY USAGE <세션 키>`를 본다(세션 키는 `fitdining:session:<환경>:` 아래에 있다).

BE readiness는 DB와 Redis를 모두 확인한다. Redis 장애 시 새 배포 전환을 막는다. 로그인·가입 성공 시 Redis에 로그인 세션을 생성한다. 전체 로그아웃은 [RB-08](../../docs/infra/runbooks/RB-08.md)의 환경별 세션 네임스페이스 삭제 절차를 따른다.

통합 테스트는 JVM당 Redis 7.4.9-alpine 컨테이너 하나를 공유한다. CI `be:test`는 기존 `verify-heavy-be` 직렬화 설정을 유지한다. Redis 추가에 따른 전체 테스트 시간·메모리 실측은 Docker를 사용하는 검증 단계에서 확인해야 한다.

서버 A의 Postgres(pgvector), OpenSearch, Redis 2개, Garage(사진 저장소)다. 설계는 [design.md](../../docs/infra/design.md) 7절이다. 환경(prod, dev)별 DB·role·버킷·키는 compose가 아니라 멱등 스크립트가 만든다.

## 자주 하는 일

| 하고 싶은 일 | 명령 |
|---|---|
| 데이터 스택 올리기(처음, 재부팅 뒤) | `bash infra/deploy/fit-up.sh`(data를 올리고 아래 초기화까지 한다) |
| 스택만 직접 올리기 | `docker compose -p fit-data -f infra/data/compose.data.yml --env-file /etc/fit/data.env up -d --wait` |
| DB·role·버킷·키 맞추기(몇 번 해도 같은 결과) | `bash infra/data/init-data.sh` |
| 설계대로인지 점검(읽기 전용) | `bash infra/data/verify-data.sh` |
| 한 환경의 장소 데이터를 다른 환경으로 한 번 복사(prod 첫 공개) | `bash infra/data/copy-places.sh dev prod`(점검만), 확인 뒤 `--apply`를 붙인다 |
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
| Postgres | DB `fit_prod`, role `fit_prod_app`(DML만), `fit_prod_ai`(AI API용 읽기 전용) | DB `fit_dev`, role `fit_dev_app`(DML만, `statement_timeout` 30초), `fit_dev_ai`(읽기 전용) |
| DDL | `fit_migrator`(두 DB의 소유자. 마이그레이션 컨테이너가 쓴다) | 〃 |
| Redis | `redis-prod`(자기 비밀번호) | `redis-dev`(자기 비밀번호) |
| Garage | 버킷 `fit-prod-photos`, prod 전용 키 | 버킷 `fit-dev-photos`, dev 전용 키 |

관측용 role `fit_monitor`(`pg_monitor` 멤버)는 postgres-exporter가 `postgres` DB에서 통계만 읽는 데 쓴다. `fit_prod`, `fit_dev`에는 접속하지 못한다. 비밀번호는 `FIT_MONITOR_PASSWORD`이고 `obs.env`의 같은 키와 같아야 한다.

**서버에 처음 적용할 때는 순서를 지킨다.** ① 백업 스크립트의 설치본을 새 저장소로 갱신한다(`sudo bash infra/backup/install.sh app`). 백업 타이머는 `/usr/local/lib/fit/repo`의 사본을 쓰고, 복원 검증용 임시 DB가 AI role을 만들어야 덤프가 복원된다. ② `data.env`에 `FIT_PROD_AI_PASSWORD`, `FIT_DEV_AI_PASSWORD`를 `envset.py`로 넣는다(없으면 `data.env`를 읽는 스크립트가 멈춘다). ③ `bash infra/data/ensure-databases.sh`를 돌린다. 순서를 바꿔 AI role부터 만들면 그 뒤 백업의 복원 검증이 실패해 덤프가 B로 가지 않는다.

AI API용 role `fit_prod_ai`, `fit_dev_ai`는 읽기 전용이다. `grant-ai-read.sh`의 목록에 있는 객체(뷰 `ai_place_search`, 테이블 `user_preferences`)의 SELECT만 받고, 뷰는 소유자 권한으로 실행되므로 뷰 밑의 테이블과 인증 테이블은 읽지 못한다. 마이그레이터가 만드는 새 객체에는 기본 권한을 주지 않는다(앱 role과 다르다). 목록에 객체를 더하려면 BE·AI 팀과 정한 뒤 그 스크립트의 목록을 고치는 MR을 만든다. 접속은 6개까지, 쿼리는 10초, 트랜잭션은 기본이 읽기 전용이다. 비밀번호는 `FIT_PROD_AI_PASSWORD`, `FIT_DEV_AI_PASSWORD`이고 AI 컨테이너 env의 `DATABASE_URL`에 같은 값이 들어간다.

팀원이 prod 장소 데이터를 직접 볼 때 쓰는 읽기 전용 계정 `fit_prod_ro1`~`fit_prod_ro5`는 스크립트가 아니라 서버에서 SQL로 만들었다(임시 접근이라 스크립트와 시험을 늘리지 않았다). 권한은 접속할 수 없는 그룹 role `fit_prod_ro`가 갖고 `ensure-databases.sh`는 이 그룹 role의 이름만 만든다. prod 덤프에 이 role의 권한이 들어가서, 복원 검증(`verify-dump.sh`)과 서버를 새로 세운 뒤의 복원에 role이 있어야 하기 때문이다. **권한을 주기 전에 서버의 백업 코드 사본을 먼저 갱신한다**(`sudo bash ~/fit-repo/infra/backup/install.sh app`). 순서를 바꾸면 그 뒤 백업의 복원 검증이 실패해 덤프가 B로 가지 않는다(AI role과 같은 함정이다). 읽는 것은 장소 테이블 10개(`copy-places.sh`의 `TABLES`)뿐이고 사용자·리뷰·인증 테이블과 마이그레이션 기록은 읽지 못한다. 계정에는 쿼리 10초, 접속 2개, 읽기 전용 기본값이 걸려 있다. 서버에서 한 일은 아래와 같다(한 번만 실행한다). 비밀번호는 `psql`의 `\password fit_prod_ro1`처럼 입력창에 넣는다(셸 기록에 남지 않는다).

```sql
-- sudo docker exec -it fit-data-postgres-1 psql -U postgres -d fit_prod -v ON_ERROR_STOP=1
GRANT CONNECT ON DATABASE fit_prod TO fit_prod_ro;
GRANT USAGE ON SCHEMA public TO fit_prod_ro;
GRANT SELECT ON places, place_profiles, place_personas, place_hours, place_menus,
  place_photos, place_subways, place_bus_stops, place_seats, place_broadcasts TO fit_prod_ro;
DO $$
BEGIN
  FOR n IN 1..5 LOOP
    EXECUTE format('CREATE ROLE %I LOGIN IN ROLE fit_prod_ro CONNECTION LIMIT 2', 'fit_prod_ro' || n);
    EXECUTE format('ALTER ROLE %I SET statement_timeout = ''10s''', 'fit_prod_ro' || n);
    EXECUTE format('ALTER ROLE %I SET default_transaction_read_only = on', 'fit_prod_ro' || n);
  END LOOP;
END $$;
```

한 사람만 막으려면 `ALTER ROLE fit_prod_ro3 NOLOGIN;`과 `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'fit_prod_ro3';`를 실행한다. 서비스를 종료할 때는 RB-10 전에 `DROP OWNED BY fit_prod_ro; DROP ROLE fit_prod_ro1, fit_prod_ro2, fit_prod_ro3, fit_prod_ro4, fit_prod_ro5, fit_prod_ro;`로 지운다.

각 앱 role은 자기 DB에만 접속한다. 마이그레이터가 만드는 테이블과 시퀀스에는 앱 role의 DML 권한이 자동으로 붙는다. 초기화 스크립트를 다시 돌리면 다른 방법으로 만든 기존 테이블에도 같은 권한을 준다.

## data.env

`/etc/fit/data.env`(root:docker 0640)에 15개 키가 있다. 키 목록과 소비자는 [env.md](../../docs/infra/contracts/env.md)의 `data` 그룹이고 예제는 `data.env.example`이다. 값 규칙은 스크립트가 검사하고 어긋나면 값을 찍지 않고 어떤 키가 틀렸는지만 알려 준다.

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
| `ensure-databases.sh` | role과 DB, 확장(`vector`, `pg_stat_statements`), 접속·테이블 권한(마지막에 `grant-ai-read.sh`를 부른다) |
| `grant-ai-read.sh` | AI role이 읽을 객체의 SELECT를 맞춘다. 마이그레이션이 객체를 만든 뒤에 다시 돌려야 읽힌다(없는 객체는 건너뛴다) |
| `copy-places.sh` | 장소 테이블 10개(`places`, `place_profiles`, `place_personas`, 딸린 7개)를 `<원본> <대상>`(`dev`, `prod`)으로 복사한다. 옵션이 없으면 점검만 하고 `--apply`를 줘야 쓴다. 대상 테이블이 모두 비어 있고 두 DB의 열 구성이 같을 때만 하며(덮어쓰지 않는다), 복사와 번호표 보정은 한 트랜잭션이다. 끝나면 행 수·값 해시·번호표·AI 뷰의 행 수를 원본과 대조한다. 북마크·리뷰·사용자·코드표는 복사하지 않는다. 행 수·값 해시 대조는 시험으로 어긋남을 만들 수 없어 안전망으로만 둔다(번호표 대조는 시험이 확인한다) |
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
bash infra/data/test/test-copy-places.sh  # copy-places.sh: 실제 마이그레이션(V1~V14)으로 만든 Postgres 한 개에서 복사·거부·원자성·번호표를 시험한다
FIT_TEST_OPENSEARCH=1 bash infra/data/test/test-data.sh up   # OpenSearch(이미지 빌드, 메모리 2GB)도 띄우고 nori까지 점검한다
```

`run`에 구역 이름을 주면 그 구역만 돈다(`init idempotent rotation privilege input redis postgres garage port hygiene`). Postgres의 호스트 포트는 55432(`FIT_DATATEST_PG_PORT`)다.

## 서버에서만 확인되는 것

실제 `/etc/fit/data.env`의 권한, 호스트 게시 포트(`127.0.0.1:5432`)로 들어오는 접속이 비밀번호를 확인하는지(개발자 터널), 메모리 상한 안에서의 동작과 재시작 시간, 호스트 재부팅 뒤 자동 기동, OpenSearch의 실제 메모리 사용(설계 4.1절 예산), 디스크 용량.
