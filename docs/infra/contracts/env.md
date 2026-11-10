# 환경변수 계약

서비스가 읽는 환경변수의 키 목록이다. 값은 서버의 `/etc/fit/*.env`에만 두고 저장소에는 `*.env.example`(키와 자리표시자)만 둔다([design.md](../design.md) 12.4절, 13.2절).

- 상태: **제안**. BE·프런트 팀과 M1 전에 합의한다([README.md](README.md)).
- 형식: `KEY=VALUE`만 쓴다. 공백, 따옴표, `#`, `$`, 백슬래시, 백틱, CRLF를 금지한다. `check_env_files.py`가 검사한다.
- 일치: 아래 표와 예제 파일의 키는 `infra/ci/check_env_contract.py`가 맞춰 본다. 예제 파일에 있는 키는 표에 있어야 하고, 필수 키는 예제 파일에 있어야 한다. 키를 바꾸면 이 표와 예제 파일을 함께 고친다.
- 자리표시자: 예제의 `REPLACE_ME`는 비밀이 아직 없다는 표시다. BE는 이 값이나 비어 있는 값으로는 기동을 거부한다(BE 계약 #8).
- 데모 계정 키(`AUTH_DEMO_EMAIL`, `AUTH_DEMO_PASSWORD`, `AUTH_DEMO_NICKNAME`)는 세 값이 한 묶음이다. **간소 모드가 꺼져 있으면(prod, 또는 `AUTH_SIMPLE_ENABLED=false`인 dev) 셋 중 하나라도 있을 때 세 값이 모두 있고 가입 규칙에 맞아야 하며, 아니면 BE가 기동을 거부한다**(예: 비밀번호만 있으면 거부). 간소 모드에서는 이메일과 닉네임에 기본값이 있어 비밀번호만 줘도 된다. 간소 모드를 끄려고 하면 `AUTH_DEMO_PASSWORD`를 같이 지우거나 나머지 두 값을 함께 넣는다. (BE 코드 `AuthSettings`를 읽고 쓴 규칙이며 서버에서 간소 모드를 끄고 기동해 본 것은 아니다.)
- 소셜 로그인 키(`AUTH_{GOOGLE,KAKAO,NAVER}_CLIENT_ID`와 `_CLIENT_SECRET`)는 제공자마다 한 쌍이고 선택이다(BE 구현은 S15P31A302-95). 쌍의 두 값이 다 있으면 그 제공자 로그인이 켜지고, 둘 다 없으면 꺼지며, 하나만 있으면 BE가 기동을 거부한다. 값을 아직 모르면 서버 env에 키를 넣지 않는다. 예제 파일에는 두지 않고(선택 키), `REPLACE_ME`를 넣으면 배포 preflight가 막는다.
- `$`가 필요한 값(bcrypt 해시 등)은 base64로 인코딩해 둔다(design.md 13.2절).
- `*_BASE_URL` 값은 끝에 `/`를 붙이지 않는다(예: `https://gms.ssafy.io/gmsapi`).
- 서버의 `/etc/fit/*.env`에 값을 넣고 바꾸는 도구는 `infra/host/envset.py`다(사용법은 [infra/host/README.md](../../../infra/host/README.md)). 위 형식과 `*_BASE_URL` 규칙을 지키고, 이 표에 없는 키를 넣으면 알려 준다.

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
| `ai` | `infra/app/ai.env.example` | AI API 컨테이너(`/etc/fit/ai-dev.env`, `/etc/fit/ai-prod.env`, design.md 11.4절) |

## 키 목록

필수가 `O`이면 그 그룹의 예제 파일에 반드시 있어야 하고 `X`이면 선택이다.

| 키 | 그룹 | 필수 | 설명 |
|---|---|---|---|
| `APP_ENV` | app, migrate, fe, ai | O | 환경 이름 `dev` 또는 `prod`. 부팅 때 DB 이름, Redis 호스트, OpenSearch 접두사가 이 값과 맞는지 검사한다 |
| `SPRING_PROFILES_ACTIVE` | app, migrate | O | 웹은 `dev` 또는 `prod`, 마이그레이션 컨테이너는 `migrate` |
| `TZ` | app, migrate | O | `Asia/Seoul` |
| `SPRING_DATASOURCE_URL` | app, migrate | O | JDBC URL. 환경별 DB는 `fit_dev`, `fit_prod` |
| `SPRING_DATASOURCE_USERNAME` | app, migrate | O | app은 `fit_dev_app`·`fit_prod_app`(DML), migrate는 `fit_migrator`(DDL) |
| `SPRING_DATASOURCE_PASSWORD` | app, migrate | O | 비밀 |
| `SPRING_DATA_REDIS_HOST` | app | O | `redis-dev` 또는 `redis-prod`. dev·prod 웹 앱은 누락·공백·`REPLACE_ME`이면 기동 거부. 다른 환경 호스트도 거부. migrate는 필수 검사 제외 |
| `SPRING_DATA_REDIS_PORT` | app | O | `6379`. dev·prod 웹 앱은 누락·공백·`REPLACE_ME`이면 기동 거부. migrate 제외 |
| `SPRING_DATA_REDIS_PASSWORD` | app | O | 비밀(requirepass). dev·prod 웹 앱은 누락·공백·`REPLACE_ME`이면 기동 거부. migrate 제외 |
| `OPENSEARCH_URL` | app | O | `http://opensearch:9200` |
| `OPENSEARCH_INDEX_PREFIX` | app | O | `dev-` 또는 `prod-` |
| `S3_ENDPOINT` | app | O | Garage S3 API. 서버는 `http://garage:3900` |
| `S3_PUBLIC_ENDPOINT` | app | X | 브라우저가 리뷰 사진을 올리는 출처. BE가 사진 업로드 주소(presigned PUT)를 이 Host로 서명하고 같은 출처 상대 경로(`/fit-<env>-photos/...`)로 돌려준다. Caddy가 Host를 그대로 넘기므로 `https://<DEV_HOST>` 또는 `https://<PROD_HOST>`이고 끝에 `/`를 붙이지 않는다. 없으면 사진 없는 리뷰만 쓸 수 있고 사진 업로드는 503이다(리뷰 D-45) |
| `S3_REGION` | app | O | `garage` |
| `S3_BUCKET` | app, local | O | `fit-dev-photos` 또는 `fit-prod-photos` |
| `S3_ACCESS_KEY` | app, local | O | 환경 전용 키 |
| `S3_SECRET_KEY` | app, local | O | 비밀 |
| `S3_PATH_STYLE` | app | O | `true`. Garage는 path-style을 쓴다 |
| `JWT_SECRET` | app | O | 비밀. 소셜 쿠키 서명 키이며 이메일 인증번호 HMAC에도 사용한다. AT·RT 인증 토큰은 발급하지 않는다 |
| `AUTH_FRONTEND_ORIGIN` | app | O | 인증 API(`/api/auth/**`)의 POST가 우리 화면에서 온 것인지 가르는 기준 출처(CSRF 방어). 브라우저가 붙이는 `Origin` 헤더와 정확히 같아야 하므로 경로와 끝 `/` 없이 `https://호스트`만 쓴다. prod는 `https://<PROD_HOST>`, dev는 `https://<DEV_HOST>`이고 둘 다 443이라 포트를 붙이지 않는다. 환경마다 달라 기본값이 없고, 값이 형식에 맞지 않으면 BE가 기동을 거부한다(BE 계약 #8). 로컬 개발은 이 계약 밖이고 `be/.env`에서 `http://localhost:3000`을 쓴다 |
| `AUTH_COOKIE_SECURE` | app | O | RT 쿠키의 `Secure` 속성 여부(`true` 또는 `false`). dev와 prod 서버는 Caddy 뒤 HTTPS라 둘 다 `true`다. 로컬(`http://localhost`)만 `false`다. 기본값이 없고 `true`·`false`가 아닌 값은 BE가 기동을 거부한다(BE 계약 #8, 쿠키는 #21) |
| `SPRING_MAIL_HOST` | app | X | 이메일 가입 인증번호를 보내는 SMTP 호스트. Gmail은 `smtp.gmail.com`. **prod는 필수**이고 없으면 BE가 기동을 거부한다. dev·local은 키를 넣지 않으면 메일을 보내지 않고 인증번호를 BE 로그에 남긴다(로그 발송기). 값을 넣으면 아래 `SPRING_MAIL_USERNAME`, `SPRING_MAIL_PASSWORD`, `AUTH_MAIL_FROM`도 모두 있어야 하고, 하나라도 비었거나 `REPLACE_ME`면 BE가 기동을 거부한다 |
| `SPRING_MAIL_PORT` | app | X | SMTP 포트. 기본 `587`(STARTTLS 필수) |
| `SPRING_MAIL_USERNAME` | app | X | SMTP 로그인 계정. Gmail은 발송용 팀 공용 계정 주소 |
| `SPRING_MAIL_PASSWORD` | app | X | SMTP 비밀번호. Gmail은 2단계 인증을 켠 계정의 앱 비밀번호. 비밀 |
| `AUTH_MAIL_FROM` | app | X | 인증 메일의 보내는 주소. 보내는 사람 표시 이름은 `핏다이닝`이다. Gmail은 `SPRING_MAIL_USERNAME`과 같은 주소를 쓴다 |
| `AUTH_SIMPLE_ENABLED` | app | X | 인증 간소 모드 스위치. 기본 `false`, local·dev에서만 허용하며 prod는 `true`이면 기동을 거부한다 |
| `AUTH_DEV_KEY` | app | X | 개발 토큰 발급 키. 비밀. 간소 모드 dev 서버에서 32자 이상 필수이며 local은 선택이고 길이 제한이 없다. prod는 값이 있으면 기동을 거부한다 |
| `AUTH_DEMO_EMAIL` | app | X | 데모 계정 이메일. 간소 모드에서는 비어 있으면 `dev@fitdining.local`이다. 간소 모드가 아니면 `AUTH_DEMO_PASSWORD`, `AUTH_DEMO_NICKNAME`과 셋 다 함께 줄 때만 쓴다(아래 규칙). 쓰지 않을 때는 키를 넣지 않는다(빈 값으로 두지 않는다) |
| `AUTH_DEMO_PASSWORD` | app | X | 데모 계정 비밀번호. 비밀. 간소 모드 dev 서버에서 필수이며 local 기본값은 `fitdining-dev1`이다. 가입 비밀번호 규칙을 지켜야 한다(영문과 숫자를 포함해 8자 이상, UTF-8 72바이트 이하). 간소 모드가 아니면 `AUTH_DEMO_EMAIL`, `AUTH_DEMO_NICKNAME`과 함께 줄 때만 쓴다(아래 규칙) |
| `AUTH_DEMO_NICKNAME` | app | X | 데모 계정 닉네임. 간소 모드에서는 비어 있으면 `개발자`다. 2~15자(가입 규칙). 간소 모드가 아니면 위 두 값과 셋 다 함께 줄 때만 쓴다 |
| `AUTH_GOOGLE_CLIENT_ID` | app | X | 구글 소셜 로그인의 OAuth 클라이언트 ID. `AUTH_GOOGLE_CLIENT_SECRET`과 한 쌍이다(위 규칙). 제공자 콘솔에 콜백 `https://<호스트>/api/auth/oauth/google/callback`을 등록해야 한다. 호스트는 `AUTH_FRONTEND_ORIGIN`과 같다 |
| `AUTH_GOOGLE_CLIENT_SECRET` | app | X | 구글 OAuth 클라이언트 시크릿. 비밀 |
| `AUTH_KAKAO_CLIENT_ID` | app | X | 카카오 로그인의 REST API 키. `AUTH_KAKAO_CLIENT_SECRET`과 한 쌍이다. 콜백 `https://<호스트>/api/auth/oauth/kakao/callback`을 등록한다 |
| `AUTH_KAKAO_CLIENT_SECRET` | app | X | 카카오 클라이언트 시크릿. 비밀. 카카오 콘솔의 클라이언트 시크릿은 ON으로 둔다 |
| `AUTH_NAVER_CLIENT_ID` | app | X | 네이버 로그인의 Client ID. `AUTH_NAVER_CLIENT_SECRET`과 한 쌍이다. 콜백 `https://<호스트>/api/auth/oauth/naver/callback`을 등록한다 |
| `AUTH_NAVER_CLIENT_SECRET` | app | X | 네이버 Client Secret. 비밀 |
| `MODAL_BASE_URL` | app | O | BE가 AI API(`/v1/taste/interpret`, `/v1/taste/profile`, 검색)를 부르는 기준 URL이다(키 이름은 Modal 시절 그대로다). A에서 도는 AI API는 `http://ai-dev:8000`, `http://ai-prod:8000`이다(design.md 11.4절). Modal 임베딩 주소가 아니다(그것은 `ai` 그룹의 `EMBED_BASE_URL`) |
| `MODAL_KEY` | app | X | `Modal-Key` 헤더 값. AI API가 Modal에 있을 때만 쓴다. A의 AI API는 내부 호출이라 비운다. 비밀 |
| `MODAL_SECRET` | app | X | `Modal-Secret` 헤더 값. AI API가 Modal에 있을 때만 쓴다. A의 AI API는 내부 호출이라 비운다. 비밀 |
| `TASTE_ANALYZER` | app | X | 온보딩 해석 구현. 기본 `mock`, AI 연결 시 `ai` |
| `TASTE_PROFILE_ENABLED` | app | X | 가입 시 AI 프로필 계산. 기본 `false`, 실패 시 빈 features로 가입 계속 |
| `MODAL_ENABLED` | app | O | 킬스위치. `false`면 키워드 검색으로 대체한다 |
| `GMS_BASE_URL` | app, ai | O | GMS(SSAFY LLM API) 기준 URL. **AI는 끝에 `/chat/completions`를 붙여 부르므로 `ai` 그룹에는 공급자 경로까지 적는다**(`https://gms.ssafy.io/gmsapi/api.openai.com/v1`). `.../gmsapi`만 쓰면 GMS가 403을 내서 해석과 정렬이 규칙·유사도로 대체된다(2026-11-02 dev에서 확인). `infra/app/ai-env-init.sh`가 BE 쪽 값에서 이 형식으로 만든다 |
| `GMS_API_KEY` | app, ai | O | 비밀 |
| `GMS_ENABLED` | app, ai | O | 킬스위치 |
| `DATABASE_URL` | ai | O | AI API가 읽는 Postgres 접속 주소(`postgresql://fit_<env>_ai:<비밀번호>@postgres:5432/fit_<env>`). 읽기 전용 role이고 비밀번호는 `data.env`의 `FIT_PROD_AI_PASSWORD`(dev는 `FIT_DEV_AI_PASSWORD`)와 같아야 한다. 비밀 |
| `EMBED_BASE_URL` | ai | O | AI API가 임베딩을 부르는 Modal 엔드포인트의 기준 URL(`<URL>/embed`). 환경별 앱이 다르다. 셋 중 하나라도 비면 AI API `/healthz`가 503이다 |
| `EMBED_KEY` | ai | O | Modal `Modal-Key` 헤더 값(프록시 토큰 ID). 비밀 |
| `EMBED_SECRET` | ai | O | Modal `Modal-Secret` 헤더 값. 비밀 |
| `DB_POOL_SIZE` | ai | X | 컨테이너 하나가 장소를 읽으려고 여는 DB 접속 수(취향용 1개를 더 연다). role의 접속 상한 6을 넘지 않게 둔다. 기본 2 |
| `MAX_CONCURRENT_REQUESTS` | ai | X | 컨테이너 하나가 동시에 처리하는 검색 수. 넘으면 503 `BUSY`다. 기본 8 |
| `GMS_TIMEOUT_SECONDS` | ai | X | GMS를 한 번 부를 때 기다리는 시간(초). 기본 5. 검색의 후속 요청 해석은 이 값과 7초 중 긴 쪽을 기다리고 시간 초과면 다시 부르지 않는다 |
| `PLACES_FILE` | ai | X | `DATABASE_URL`이 비었을 때 장소를 읽을 파일(실제 DB가 없을 때의 임시 구현이고 이미지에 파일이 있어야 한다) |
| `BATCH_ENABLED` | app | O | 새벽 배치. dev 기본값은 `false` |
| `MODAL_TIMEOUT_MS` | app | X | 일반 호출 타임아웃 |
| `MODAL_COLD_START_TIMEOUT_MS` | app | X | 첫 호출(콜드 스타트) 타임아웃 |
| `MODAL_DAILY_CALL_BUDGET` | app | X | 하루 호출 예산(Redis 카운터) |
| `GMS_DAILY_CALL_BUDGET` | app | X | 하루 호출 예산 |
| `APIFY_TOKEN` | app | X | 비밀. 리뷰 수집을 쓸 때만 |
| `APIFY_ENABLED` | app | X | 킬스위치 |
| `PLACE_MOCK_ENABLED` | app | X | 장소 검색 Mock 스위치(BE의 `place.mock.enabled`). 켜면 장소 검색이 `be/src/main/resources/mock/places.json`을 쓰는 Mock 엔진으로 응답한다. local과 dev에서만 `true`이고 prod는 설정하지 않는다(기본값 `false`) |
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
| `NAVER_MAP_CLIENT_ID` | fe | X | 네이버 지도 Client ID(NCP 콘솔 Maps 애플리케이션의 인증 정보). 브라우저가 지도 스크립트를 받을 때 쓰는 공개 값이라 비밀이 아니고 `/config.json`의 `naverMapClientId`로 나간다. NCP 콘솔의 Web 서비스 URL에 그 환경의 호스트(`PROD_HOST`, `DEV_HOST`)를 등록해야 지도가 뜬다. 없으면 지도 영역만 비고 나머지 화면은 동작한다 |
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
| `FIT_PROD_AI_PASSWORD` | data | O | `fit_prod_ai` 비밀번호(AI API용 읽기 전용 role. `ai_place_search`와 `user_preferences`만 SELECT한다). `ai-prod.env`의 `DATABASE_URL`에 들어 있는 비밀번호와 같아야 한다 |
| `FIT_DEV_AI_PASSWORD` | data | O | `fit_dev_ai` 비밀번호(위와 같다). `ai-dev.env`의 `DATABASE_URL`에 들어 있는 비밀번호와 같아야 한다 |
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
| `naverMapClientId` | X | 네이버 지도 Client ID |

FE는 `APP_ENV`, `POSTHOG_KEY`, `POSTHOG_HOST`, `PUSH_PUBLIC_KEY`, `NAVER_MAP_CLIENT_ID`를 런타임에 읽어 위 키로 돌려준다(`fe` 그룹).


## 인증 간소 모드 (local·dev)

위 키 표의 `AUTH_SIMPLE_ENABLED`로 켠다.
local은 APP_ENV가 없고 dev/prod/migrate 프로필도 없는 경우다. local에서만 Origin 검사를 생략하고 JWT_SECRET이 비면 고정 개발 서명 키를 쓴다.
dev 서버는 실제 JWT_SECRET과 Origin 검사를 유지한다. 개발 토큰 키와 데모 비밀번호 조건은 위 키 표를 따른다.

이메일·소셜 요청 제한과 시도 기록을 생략하고 BCrypt cost 4를 사용한다. 모르는 계정의 dummy hash를 만들거나 비교하지 않는다.
AT는 12시간, 세션은 30일이다. 사용한 RT는 만료 전까지 같은 family로 재발급할 수 있고 재사용 보안 이벤트를 남기지 않는다. logout으로 폐기한 RT는 거부한다.
데모 기본 계정은 `dev@fitdining.local`, 닉네임 `개발자`다. AUTH_DEMO_EMAIL/PASSWORD/NICKNAME으로 덮어쓴다.

`POST /api/auth/dev/token`은 간소 모드에서만 등록된다. 선택 본문 `{"email":"existing@example.com"}`이 없으면 데모 계정을 쓴다.
AUTH_DEV_KEY를 X-Dev-Key 헤더에 전달한다(local에서 키 미설정 시 생략 가능). 이 경로는 Origin 검사에서 제외된다.
성공 시 일반 TokenResponse와 기존 정책의 RT 쿠키를 반환하며 키 오류는 403, 없는 계정은 404다.
발급한 AT를 `Authorization: Bearer <AT>`로 `/api/auth/me`와 보호 API에 사용한다.

prod 동작 확인 시 dev에서 AUTH_SIMPLE_ENABLED=false로 재시작하여 21번째 시도 429, RT 재사용 시 family 폐기, 30분 AT 수명과 Origin 검사를 확인한다.
