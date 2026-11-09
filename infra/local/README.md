# 로컬 개발 스택

BE 웹 앱은 Spring Session Redis 인덱스 저장소를 초기화하므로 Redis도 함께 띄워야 한다. 세션 생성은 후속 로그인 전환 단계에서 시작한다. 로컬 기본 접속은 `127.0.0.1:16379`이며 BE `.env`에 `SPRING_DATA_REDIS_PASSWORD=local-redis-password`(compose의 `REDIS_PASSWORD`와 같은 값)를 넣는다. 포트를 바꾸면 `SPRING_DATA_REDIS_PORT`도 맞춘다. 서버와 달리 로컬에서는 Redis 환경변수 계약 검사를 생략하지만 실제 Redis 연결은 필요하다.

Redis 명령에 `--notify-keyspace-events Egx`를 지정하며 앱은 `CONFIG SET`을 실행하지 않는다. 설정을 적용하려면 기존 컨테이너를 재생성한다. Redis가 내려가면 `/actuator/health/readiness`가 DOWN이 된다.

서버 없이 노트북에서 BE·FE를 개발할 때 쓰는 Postgres, Redis, Garage(S3), OpenSearch다. AI는 Modal의 dev 앱을 쓰므로 여기에 없다. 설계는 [design.md](../../docs/infra/design.md) 10.5절이다.

## 필요한 것

Docker(Compose v2 이상), bash(Windows는 Git Bash나 WSL), git, curl 7.75 이상(garage 점검). 메모리는 core가 유휴 상태에서 약 70MB(측정), search를 더하면 OpenSearch가 한도 1GB 가까이(측정 974MiB)를 쓴다.

## 처음 켜기

```bash
cp infra/local/local.env.example infra/local/.env
bash infra/local/fit-local.sh up            # core: postgres, redis, garage
bash infra/local/fit-local.sh up --search   # core에 nori를 넣은 opensearch를 더한다(처음에는 이미지를 만든다)
```

`up`은 컨테이너를 켜고 헬스체크를 기다린 뒤 DB·role·버킷을 만들고 점검한다. 몇 번 실행해도 같은 결과다. `infra/local/.env`는 git이 무시한다.

| 명령 | 하는 일 |
|---|---|
| `bash infra/local/fit-local.sh verify` | 떠 있는 서비스를 점검한다 |
| `bash infra/local/fit-local.sh down` | 중지한다. 데이터는 남는다 |
| `bash infra/local/fit-local.sh reset` | 중지하고 볼륨을 지워 데이터를 초기화한다 |

`FIT_LOCAL_PROJECT=이름`으로 compose 프로젝트 이름을 바꾸면 여러 벌을 따로 띄울 수 있다(기본 `fit-local`). 볼륨도 프로젝트마다 따로다.

## 접속 값

모든 포트는 `127.0.0.1`에만 게시된다. 기본값이 PC에 설치한 Postgres(5432) 등과 겹치지 않게 15432 같은 번호를 쓴다. 바꾸려면 `.env`의 `FIT_LOCAL_*_PORT`를 고친다.

| 서비스 | 값 |
|---|---|
| Postgres | `jdbc:postgresql://127.0.0.1:15432/fit_dev`. 앱은 `fit_dev_app`, Flyway는 `fit_migrator`. 비밀번호는 `.env`의 `FIT_DEV_APP_PASSWORD`, `FIT_MIGRATOR_PASSWORD` |
| Redis | `127.0.0.1:16379`, 비밀번호는 `REDIS_PASSWORD`. maxmemory 96MB, `noeviction` |
| S3(Garage) | 엔드포인트 `http://127.0.0.1:13900`, 리전 `garage`, path-style. 버킷·키는 `.env`의 `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| 사진 웹 읽기 | `http://127.0.0.1:13902`. Host 헤더가 `<버킷>.web.garage.localhost`여야 한다 |
| OpenSearch | `http://127.0.0.1:19200`. 보안 플러그인이 꺼져 있고 인증이 없다 |

환경변수 이름은 [env.md](../../docs/infra/contracts/env.md)의 `app` 그룹을 따른다.

## 서버와 같은 것, 다른 것

- 같다: 이미지 계열과 버전(pgvector, Redis, Garage, OpenSearch+nori), DB·role 구조(DDL 전용 `fit_migrator`, DML 전용 `fit_dev_app`), Redis 정책, Garage 레이아웃.
- 다르다: 컨테이너 망을 나누지 않는다. Redis는 한 개다. 메모리와 힙을 줄였다. 값은 개발용 가짜 값이다.
- 포트 불변식(호스트 게시는 `127.0.0.1`만)은 서버와 같고 `infra/ci/ports_invariant.py`가 검사한다.
