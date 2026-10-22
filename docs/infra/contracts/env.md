# 환경변수 계약

서비스가 읽는 환경변수의 키 목록이다. 값은 서버의 `/etc/fit/*.env`에만 두고 저장소에는 `*.env.example`(키와 자리표시자)만 둔다([design.md](../design.md) 12.4절, 13.2절).

- 상태: **제안**. BE·프런트 팀과 M1 전에 합의한다([README.md](README.md)).
- 형식: `KEY=VALUE`만 쓴다. 공백, 따옴표, `#`, `$`, 백슬래시, 백틱, CRLF를 금지한다. `check_env_files.py`가 검사한다.
- 일치: 아래 표와 예제 파일의 키는 `infra/ci/check_env_contract.py`가 맞춰 본다. 예제 파일에 있는 키는 표에 있어야 하고, 필수 키는 예제 파일에 있어야 한다. 키를 바꾸면 이 표와 예제 파일을 함께 고친다.
- 자리표시자: 예제의 `REPLACE_ME`는 비밀이 아직 없다는 표시다. BE는 이 값이나 비어 있는 값으로는 기동을 거부한다(BE 계약 #8).
- `$`가 필요한 값(bcrypt 해시 등)은 base64로 인코딩해 둔다(design.md 13.2절).

## 파일 대응

| 그룹 | 예제 파일 | 소비자 |
|---|---|---|
| `app` | `infra/app/app.env.example` | BE 웹 컨테이너(`/etc/fit/dev.env`, `/etc/fit/prod.env`) |
| `migrate` | `infra/app/migrate.env.example` | 마이그레이션 일회성 컨테이너. DDL 자격만 담고 웹 컨테이너에는 넣지 않는다 |
| `local` | `infra/local/local.env.example` | 로컬 개발 스택(`infra/local/compose.yml`) |
| `fe` | `infra/app/fe.env.example` | FE Node 컨테이너(`/etc/fit/fe-dev.env`, `/etc/fit/fe-prod.env`). 비밀을 담지 않는다 |
| `edge` | `infra/edge/edge.env.example` | 엣지 Caddy(`/etc/fit/edge.env`). compose가 `--env-file`로 읽는다 |
| `data` | `infra/data/data.env.example` | 데이터 스택(`infra/data/compose.data.yml`)과 DB·버킷 초기화 스크립트(`/etc/fit/data.env`). 환경별 자격이 앱 env와 같아야 한다 |
| `backup` | `infra/backup/backup.env.example` | A의 백업 스크립트와 타이머(`/etc/fit/backup.env`) |
| `obs` | `infra/obs/obs.env.example` | A의 관측 스택(`/etc/fit/obs.env`). compose가 `--env-file`로 읽고, 일일 점검 요약이 웹훅 주소를 읽는다 |
| `ops` | `infra/ops/ops.env.example` | B의 감시 스택과 포트 노출 감사(`/etc/fit/ops.env`) |

## 키 목록

필수가 `O`이면 그 그룹의 예제 파일에 반드시 있어야 하고 `X`이면 선택이다.

| 키 | 그룹 | 필수 | 설명 |
|---|---|---|---|
| `APP_ENV` | app, migrate, fe | O | 환경 이름 `dev` 또는 `prod`. 부팅 때 DB 이름, Redis 호스트, OpenSearch 접두사가 이 값과 맞는지 검사한다 |
| `SPRING_PROFILES_ACTIVE` | app, migrate | O | 웹은 `dev` 또는 `prod`, 마이그레이션 컨테이너는 `migrate` |
| `TZ` | app, migrate | O | `Asia/Seoul` |
| `SPRING_DATASOURCE_URL` | app, migrate | O | JDBC URL. 환경별 DB는 `fit_dev`, `fit_prod` |
| `SPRING_DATASOURCE_USERNAME` | app, migrate | O | app은 `fit_dev_app`·`fit_prod_app`(DML), migrate는 `fit_migrator`(DDL) |
| `SPRING_DATASOURCE_PASSWORD` | app, migrate | O | 비밀 |
| `SPRING_DATA_REDIS_HOST` | app | O | `redis-dev` 또는 `redis-prod` |
| `SPRING_DATA_REDIS_PORT` | app | O | `6379` |
| `SPRING_DATA_REDIS_PASSWORD` | app | O | 비밀(requirepass) |
| `OPENSEARCH_URL` | app | O | `http://opensearch:9200` |
| `OPENSEARCH_INDEX_PREFIX` | app | O | `dev-` 또는 `prod-` |
| `S3_ENDPOINT` | app | O | Garage S3 API. 서버는 `http://garage:3900` |
| `S3_REGION` | app | O | `garage` |
| `S3_BUCKET` | app, local | O | `fit-dev-photos` 또는 `fit-prod-photos` |
| `S3_ACCESS_KEY` | app, local | O | 환경 전용 키 |
| `S3_SECRET_KEY` | app, local | O | 비밀 |
| `S3_PATH_STYLE` | app | O | `true`. Garage는 path-style을 쓴다 |
| `JWT_SECRET` | app | O | 비밀. 서명 방식은 BE 팀이 정한다 |
| `MODAL_BASE_URL` | app | O | Modal 엔드포인트의 기준 URL. 환경별 앱이 다르다 |
| `MODAL_KEY` | app | O | `Modal-Key` 헤더 값. 비밀 |
| `MODAL_SECRET` | app | O | `Modal-Secret` 헤더 값. 비밀 |
| `MODAL_ENABLED` | app | O | 킬스위치. `false`면 키워드 검색으로 대체한다 |
| `GMS_BASE_URL` | app | O | GMS(SSAFY LLM API) 기준 URL |
| `GMS_API_KEY` | app | O | 비밀 |
| `GMS_ENABLED` | app | O | 킬스위치 |
| `BATCH_ENABLED` | app | O | 새벽 배치. dev 기본값은 `false` |
| `MODAL_TIMEOUT_MS` | app | X | 일반 호출 타임아웃 |
| `MODAL_COLD_START_TIMEOUT_MS` | app | X | 첫 호출(콜드 스타트) 타임아웃 |
| `MODAL_DAILY_CALL_BUDGET` | app | X | 하루 호출 예산(Redis 카운터) |
| `GMS_DAILY_CALL_BUDGET` | app | X | 하루 호출 예산 |
| `APIFY_TOKEN` | app | X | 비밀. 리뷰 수집을 쓸 때만 |
| `APIFY_ENABLED` | app | X | 킬스위치 |
| `PLACE_MOCK_ENABLED` | app | X | 장소 검색 Mock 스위치(BE의 `place.mock.enabled`). 켜면 장소 검색이 `be/src/main/resources/mock/places.json`을 쓰는 Mock 엔진으로 응답한다. local과 dev에서만 `true`이고 prod는 설정하지 않는다(기본값 `false`) |
| `REVIEW_MOCK_ENABLED` | app | X | 리뷰 Mock 저장소 스위치(BE의 `review.mock.enabled`). 켜면 리뷰 API가 메모리 저장소로 응답하고 `be/src/main/resources/mock/reviews.json`을 시드로 넣는다. 재시작하면 시드만 남는다. local과 dev에서만 `true`이고 prod는 설정하지 않는다(기본값 `false`, 꺼지면 리뷰 API는 503) |
| `PUSH_ENABLED` | app | X | 웹 푸시 킬스위치. 방식은 미정이다(design.md 16절) |
| `PUSH_VAPID_PUBLIC_KEY` | app | X | VAPID 방식일 때 |
| `PUSH_VAPID_PRIVATE_KEY` | app | X | VAPID 방식일 때. 비밀 |
| `PUSH_VAPID_SUBJECT` | app | X | VAPID 방식일 때 `mailto:` 주소 |
| `NODE_ENV` | fe | O | `production` |
| `PORT` | fe | O | `3000`. Caddy가 이 포트로 프록시한다 |
| `HOSTNAME` | fe | O | `0.0.0.0`. Docker가 컨테이너 ID로 채우는 값을 덮어써야 Caddy가 닿는다 |
| `NODE_OPTIONS` | fe | O | 힙 상한(`--max-old-space-size=384`). 컨테이너 메모리 한도(design.md 4.1절)보다 작게 둔다 |
| `BE_INTERNAL_URL` | fe | O | 서버 쪽 호출이 BE로 가는 주소. prod는 `http://caddy:8081`, dev는 `http://caddy:8082`다(Caddy가 활성 색을 고른다) |
| `NEXT_TELEMETRY_DISABLED` | fe | X | `1` |
| `POSTHOG_KEY` | fe | X | PostHog 공개 키. `/config.json`의 `posthogKey`로 나간다 |
| `POSTHOG_HOST` | fe | X | PostHog 호스트. `/config.json`의 `posthogHost`로 나간다 |
| `PUSH_PUBLIC_KEY` | fe | X | 웹 푸시 공개 키. `/config.json`의 `pushPublicKey`로 나간다 |
| `PROD_HOST` | edge, ops | O | prod 호스트명(예: `fit.<도메인>`). 호스트마다 인증서를 따로 받는다. ops에서는 B가 프로브하고 포트를 감사할 A의 주소다 |
| `DEV_HOST` | edge, ops | O | dev 호스트명(예: `dev.fit.<도메인>`). prod와 다른 호스트여야 쿠키·서비스 워커가 분리된다. ops에서는 B가 인증서를 볼 A의 dev 주소다 |
| `ACME_EMAIL` | edge | O | 인증서 발급 알림을 받을 이메일 |
| `ACME_MODE` | edge | O | `staging`이면 staging CA만 쓴다. `production`이면 기본 이슈어(Let's Encrypt, ZeroSSL)를 쓴다 |
| `HSTS_MODE` | edge | O | `off` 또는 `on`. 운영 인증서가 확정된 뒤에만 `on`으로 바꾼다 |
| `DEV_GATE_KEY` | edge | O | dev 접근 키. `/?k=<키>`로 접속하면 쿠키를 받는다. 영문자·숫자·`_`·`-` 32자 이상, 비밀 |
| `B_IP` | edge, obs | O | 서버 B의 공인 IP. edge에서는 `/_ops` 접근을 이 주소로 제한하고(`remote_ip`, CIDR도 된다), obs에서는 A가 B의 22번 포트를 프로브할 대상이다. 문서나 저장소에 적지 않는다 |
| `OPS_BASIC_AUTH_USER` | edge, ops | O | A의 `/_ops` basic auth 사용자 이름. edge와 ops가 같아야 한다. 영문·숫자·`._-` 64자 이하 |
| `OPS_BASIC_AUTH_HASH` | edge | O | `/_ops` basic auth 비밀번호의 해시. `caddy hash-password` 출력을 base64로 인코딩한다(원본의 `$`가 env 형식 규칙에 걸린다. Caddy는 base64 형태도 받는다). ops의 비밀번호와 짝이다 |
| `OPS_BASIC_AUTH_PASSWORD` | ops | O | `/_ops` basic auth 비밀번호(평문). 영문·숫자·`._~-`만 쓴 16자 이상, 비밀 |
| `MATTERMOST_WEBHOOK_URL` | obs, ops | O | 알림을 받을 Mattermost 수신 웹훅(`http(s)://`). obs에서는 prod와 A 전체 알림과 일일 점검 요약, ops에서는 B의 알림이 간다. 비밀 |
| `MATTERMOST_WEBHOOK_URL_DEV` | obs | O | dev 알림을 받을 Mattermost 수신 웹훅(채널을 나눈다). 비밀 |
| `GRAFANA_ADMIN_PASSWORD` | obs | O | Grafana admin 비밀번호. 비밀 |
| `FIT_MONITOR_PASSWORD` | data, obs | O | `fit_monitor` 비밀번호(`pg_monitor` 권한. postgres_exporter가 통계를 읽는다). `data.env`와 `obs.env`의 값이 같아야 한다 |
| `FIT_PROD_APP_PASSWORD` | data | O | `fit_prod_app` 비밀번호. `prod.env`의 `SPRING_DATASOURCE_PASSWORD`와 같아야 한다 |
| `REDIS_PROD_PASSWORD` | data | O | `redis-prod` 비밀번호. `prod.env`의 `SPRING_DATA_REDIS_PASSWORD`와 같아야 한다 |
| `REDIS_DEV_PASSWORD` | data | O | `redis-dev` 비밀번호. `dev.env`의 `SPRING_DATA_REDIS_PASSWORD`와 같아야 한다 |
| `S3_PROD_ACCESS_KEY` | data | O | prod 버킷 전용 Garage 키 ID. `prod.env`의 `S3_ACCESS_KEY`와 같아야 한다 |
| `S3_PROD_SECRET_KEY` | data | O | prod 버킷 전용 Garage 비밀 키. `prod.env`의 `S3_SECRET_KEY`와 같아야 한다 |
| `S3_DEV_ACCESS_KEY` | data | O | dev 버킷 전용 Garage 키 ID. `dev.env`의 `S3_ACCESS_KEY`와 같아야 한다 |
| `S3_DEV_SECRET_KEY` | data | O | dev 버킷 전용 Garage 비밀 키. `dev.env`의 `S3_SECRET_KEY`와 같아야 한다 |
| `BACKUP_VAULT_HOST` | backup | O | 백업 금고(B)의 주소(공인 IP나 호스트 이름). 문서나 저장소에 적지 않는다 |
| `BACKUP_VAULT_PORT` | backup | X | 금고의 SSH 포트. 기본 `22` |
| `BACKUP_KEEP_HOURS` | backup | X | 4시간 단위 덤프를 모두 보관하는 시간. 기본 `48` |
| `BACKUP_KEEP_DAYS` | backup | X | 그 뒤 하루 한 벌씩 보관하는 일수. 기본 `14` |
| `FIT_LOCAL_PG_PORT` | local | X | 호스트에 게시하는 Postgres 포트. 기본 `15432` |
| `FIT_LOCAL_REDIS_PORT` | local | X | Redis 포트. 기본 `16379` |
| `FIT_LOCAL_S3_PORT` | local | X | Garage S3 API 포트. 기본 `13900` |
| `FIT_LOCAL_S3_WEB_PORT` | local | X | Garage 웹 엔드포인트 포트. 기본 `13902` |
| `FIT_LOCAL_OPENSEARCH_PORT` | local | X | OpenSearch 포트. 기본 `19200` |
| `POSTGRES_PASSWORD` | local, data | O | Postgres 관리자(`postgres`) 비밀번호 |
| `FIT_MIGRATOR_PASSWORD` | local, data | O | `fit_migrator` 비밀번호. `migrate-<env>.env`의 `SPRING_DATASOURCE_PASSWORD`와 같아야 한다 |
| `FIT_DEV_APP_PASSWORD` | local, data | O | `fit_dev_app` 비밀번호. `dev.env`의 `SPRING_DATASOURCE_PASSWORD`와 같아야 한다 |
| `REDIS_PASSWORD` | local | O | Redis 비밀번호 |
| `GARAGE_RPC_SECRET` | local, data | O | Garage RPC 비밀. 64자리 16진수 |
| `GARAGE_ADMIN_TOKEN` | local, data | O | Garage 관리 API 토큰 |

로컬 그룹의 값은 개발용 가짜 값이다. 서버 값으로 쓰지 않는다.

`obs`와 `ops` 그룹의 값은 시작 때 `obs-init`, `ops-init`(`render.py`)이 검사한다. 비었거나 `REPLACE_ME`이면 스택이 뜨지 않는다.

`data` 그룹의 값 형식은 스크립트가 검사한다(`infra/data/lib.sh`, `init-garage.sh`). 비밀번호와 토큰(`*_PASSWORD`, `GARAGE_ADMIN_TOKEN`)은 영문·숫자·`._~-`만 쓴 16자 이상이고, `GARAGE_RPC_SECRET`과 `S3_*_SECRET_KEY`는 16진수 64자리, `S3_*_ACCESS_KEY`는 `GK` + 16진수 24자리다.

## 프런트 런타임 설정 (`/config.json`)

번들에는 환경 값을 넣지 않고 시작할 때 `/config.json`을 받아 쓴다(design.md 12.5절 #3). 브라우저에 공개되는 값만 둔다. 이 표는 파일이 없어 검사기가 보지 않는다.

| 키 | 필수 | 설명 |
|---|---|---|
| `env` | O | `dev` 또는 `prod` |
| `posthogKey` | X | PostHog 공개 키 |
| `posthogHost` | X | PostHog 호스트 |
| `pushPublicKey` | X | 웹 푸시 공개 키 |

FE는 `APP_ENV`, `POSTHOG_KEY`, `POSTHOG_HOST`, `PUSH_PUBLIC_KEY`를 런타임에 읽어 위 키로 돌려준다(`fe` 그룹).
