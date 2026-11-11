# 로그인·회원가입 (세션 인증)

2026-11-10 기준. 브라우저 인증은 Spring Security + Spring Session Redis 세션 쿠키를 사용한다.

## 인증 계약

- 이메일 로그인, 이메일 가입, 기존 회원 소셜 콜백, 소셜 가입, 개발 로그인은 기존 세션을 무효화하고 `SessionLogin.establish`에서 새 세션과 SecurityContext를 저장한다.
- 로그인·가입 응답은 `{ userId, nickname, sessionExpiresAt }`다. `sessionExpiresAt`은 로그인 처리에서 계산한 절대 만료 시각(epoch seconds)이다. AT·RT를 발급하지 않으며 `/api/auth/refresh`, `/api/auth/protected`는 제거했다.
- `Authorization` 헤더는 무시한다. 유효한 세션이 있으면 회원이고 없으면 비회원이다. Bearer 헤더만으로 보호 API를 호출하면 401이다. 공개 API는 잘못된 헤더가 있어도 비회원 요청으로 처리한다.
- `GET /api/auth/me`는 `{ userId, nickname, email, sessionExpiresAt }`을 반환하며, 소셜 회원의 없는 email은 생략한다. 인증되지 않았으면 401 ProblemDetail이다.
- 세션 주체는 `Identity(userId, nickname, sessionExpiresAt)`다. Redis JSON의 모르는 Identity 필드는 무시하므로 옛 `sessionId`, `accessExpiresAt`이 남은 세션도 읽는다. 네임스페이스 변경이나 강제 재로그인은 하지 않는다.
- 비회원 요청, CSRF 준비, 인증 실패는 서버 세션을 만들지 않는다. RequestCache는 끄고 CSRF는 쿠키 저장소를 사용한다.

## 쿠키와 만료

| 쿠키 | 속성·용도 |
|---|---|
| `fitdining_session` | HttpOnly, SameSite=Lax, Path=/, Secure는 `AUTH_COOKIE_SECURE`를 따른다. 인증 수단이다 |
| `XSRF-TOKEN` | JS로 읽을 수 있는 CSRF 토큰, SameSite=Lax, Path=/ |
| `fd_signed_in` | 기존 FE 로그인 표시. 인증 수단이 아니며 401 복구와 기존 수명 정책을 유지한다 |
| `fitdining_rt` | 신규 발급하지 않는다. 로그아웃에서 Path=/api/auth, Max-Age=0으로 옛 쿠키만 지운다 |

일반 모드는 미사용 2시간, 로그인 후 절대 24시간이다. 간편 모드는 미사용 12시간, 절대 30일이다. 로그아웃은 현재 세션을 무효화하고, 탈퇴는 DB 커밋 뒤 해당 userId의 모든 Redis 세션을 삭제한다. DB 롤백 시 세션은 유지한다.

## CSRF 첫 요청 흐름

1. 첫 상태 변경 전에 FE 공통 클라이언트가 `XSRF-TOKEN` 쿠키를 확인한다.
2. 없으면 `GET /api/auth/csrf`를 호출한다. 응답은 204와 CSRF 쿠키이며 인증 세션을 만들지 않는다. 동시에 시작한 준비 요청은 하나로 합친다.
3. 쿠키 값을 `X-XSRF-TOKEN` 헤더에 넣어 POST·PUT·PATCH·DELETE를 보낸다. 쿠키도 브라우저가 함께 보낸다.
4. 로그인 성공 시 CSRF 토큰을 교체한다. 다음 쓰기 요청은 새 쿠키 값을 읽는다.

로그인·가입·인증번호 발송/확인·로그아웃·비회원 검색/취향 분석·리뷰/북마크를 포함한 모든 상태 변경 요청에 적용한다. 토큰이 없거나 틀리면 403이고 `detail`은 "CSRF 토큰이 없거나 올바르지 않습니다."다. 브라우저 이동인 소셜 시작·콜백 GET은 토큰이 필요 없다. 개발 전용 `/api/auth/dev/token`은 기존 CSRF·Origin 예외를 유지한다.

Origin 검사는 기존 인증·사용자·온보딩·검색 기록 경로의 POST·DELETE에만 적용한다. PUT·PATCH와 다른 모듈로 확대하지 않았다. 일반 CSRF 적용과 Origin 범위 확대는 별개다.

## 공개 경로와 오류

- 공개 POST: `/api/auth/login`, `/signup`, `/logout`, `/dev/token`, `/email-verifications`, `/email-verifications/confirm`, `/social/signup`(모두 `/api/auth` 아래), `/api/v1/places/search`, `/api/v1/onboarding/taste-analysis`.
- 공개 GET: `/api/auth/csrf`, OAuth 시작·콜백, 장소 suggest·ids·상세·리뷰 목록, `/healthz`, `/api/v1/version`.
- 나머지 경로는 기본 인증 필수다. `/actuator/**`의 실제 노출은 Boot exposure 설정이 정하며, ERROR 디스패치는 원래 상태를 보존한다.
- 장소 검색과 리뷰 목록은 선택 인증이다. 검색은 세션 회원이면 본문 preferences 대신 회원 취향을 사용한다.
- 인증이 필요한 요청은 입력 검증보다 인증을 먼저 검사한다. CSRF 없는 쓰기는 인증·입력 검증 전에 403이 될 수 있다.
- 오류는 application/problem+json, no-store, nosniff를 사용한다. `/api/**`에 nosniff를 적용하며 공개 장소 API 성공 응답의 캐시 정책은 유지한다.

## 회원가입과 소셜 로그인

이메일 가입은 이메일 소유 확인, 비밀번호, 닉네임, 만 14세 이상·이용약관·개인정보 동의가 필요하다. 성공 시 자동 로그인한다. 닉네임은 대소문자 구분 없이 중복을 막고 비밀번호는 BCrypt로 저장한다. 세부 이메일 인증 규칙은 아래를 따른다.

소셜 로그인은 기존 무상태 OAuth·PKCE 흐름을 유지한다. 시작 시 `fitdining_oauth` 서명 쿠키를 발급하고, 콜백에서 제공자·state·코드를 검증한다. 기존 회원은 세션을 발급하고 `/`로 이동한다. 미가입자는 `fitdining_social` 서명 쿠키로 `/signup/social`에 이동하여 약관/취향을 제출한 뒤 세션을 발급한다. 실패는 로그인·가입 화면으로 안전하게 리다이렉트한다. `TokenCodec`은 `oauth_state`, `social_signup` 쿠키 서명만 허용한다.

## 로그인 감사와 정리

`V25__session_login_audit.sql`은 `auth_security_events`만 확장한다. 기존 행, family_id, reuse_count는 과거 증거로 보존한다. `auth_refresh_tokens` 테이블과 기존 행은 V25에서 192 BE의 동시 운영·롤백을 위해 유지했으며, contract 단계인 `V30__drop_auth_refresh_tokens.sql`에서 삭제했다. 인덱스도 함께 삭제하며 감사 이벤트의 기존 행과 값은 변경하지 않는다.

V24(`V24__recompute_taste_features.sql`)는 `user_preferences`의 갱신 시각과 컬럼 설명만 변경한다. V25는 별도 테이블인 `auth_security_events`에 적용하므로 V24 뒤에 실행해도 충돌하지 않는다.

- nullable `user_id`를 추가하고 `family_id`를 nullable로 바꾼다.
- 기존 `REFRESH_REUSE`, `ATTACK_DETECTED`에 `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `LOGOUT`, `SESSIONS_REVOKED`를 추가한다.
- 이메일·소셜·dev 로그인 성공은 세션 생성이 완료된 뒤 기록한다. 세션 생성 실패에는 성공 행을 남기지 않는다.
- 이메일 로그인 실패는 형식 검사와 시도 제한을 통과한 인증 실패만 기록한다. 400·429는 기록하지 않는다. 소셜 콜백 실패도 서명 state 쿠키 확인과 시도 제한을 통과한 뒤에만 기록한다. 실패 계정은 user_id가 null이며 IP를 저장하지 않는다.
- 인증된 세션의 로그아웃과 계정 세션 일괄 폐기를 기록한다. 세션 없는 로그아웃은 기록하지 않는다.
- 비밀번호, 세션 ID, 이메일 원문을 감사 기록에 저장하지 않는다. 보안 이벤트는 기존 90일 정책으로 정리한다.
- 로그인 시도, 취향 입력 로그, 이메일 인증 기록 정리는 유지한다. RT 정리 작업은 제거했다.

V30의 머지·배포 조건은 193(`a05ed87`)이 prod에 배포되고 192 인스턴스와 롤백 대상이 모두 사라진 것이다. V30 적용 후 192 BE는 `ddl-auto: validate`로 기동할 수 없다. 머지 직전에 develop의 마지막 마이그레이션 번호를 다시 확인한다.

배포 전 덤프(`pg-backup.sh predeploy`)는 마이그레이션 전에 실행된다. 삭제 전 `infra/backup/README.md`와 `pg-backup.sh`, `verify-dump.sh`, `restore-check.sh` 절차로 백업·복구 가능 여부를 확인한다.

192 매핑을 사용하던 `compat/session192` 호환 테스트는 V30의 테이블 삭제로 제거했다. 현재 BE의 통합 테스트는 Testcontainers에서 V1~V30 적용 후 `ddl-auto: validate` 기동을 확인하며, 별도 마이그레이션 검사는 과거 감사 이벤트 보존과 RT 테이블 삭제를 확인한다.

## 로컬 및 개발 로그인

BE는 PostgreSQL·Redis, FE는 기존 프록시 설정을 사용한다. 로컬 HTTP에서는 `AUTH_COOKIE_SECURE=false`가 필요하다. Origin은 FE 출처와 일치해야 한다. FE는 세션 쿠키를 포함하고 Web Locks 지원 여부와 무관하게 로그인할 수 있다.

간편 모드(`AUTH_SIMPLE_ENABLED=true`)의 개발 API는 올바른 `X-Dev-Key`로 기존 데모 계정 또는 요청의 email 계정을 로그인시킨다. 서버 dev 키 검사는 유지한다. 일반 모드는 이 경로를 제공하지 않는다.

```bash
# 간편 모드에서 세션 쿠키를 저장한다. 응답에 accessToken은 없다.
curl -i -c cookies.txt -X POST http://localhost:8080/api/auth/dev/token \
  -H 'X-Dev-Key: <개발 키>'
# 세션 쿠키로 회원 확인
curl -b cookies.txt http://localhost:8080/api/auth/me
# 쓰기 전에 XSRF-TOKEN 쿠키를 받는다.
curl -i -b cookies.txt -c cookies.txt http://localhost:8080/api/auth/csrf
# cookies.txt의 XSRF-TOKEN 값을 헤더에도 넣는다.
curl -i -b cookies.txt -X POST http://localhost:8080/api/auth/logout \
  -H 'Origin: http://localhost:3000' -H 'X-XSRF-TOKEN: <쿠키 값>'
```

`JWT_SECRET` 이름은 유지한다. OAuth 쿠키 서명과 이메일 인증번호 HMAC에 쓰이며 브라우저 인증 토큰을 발급하는 용도는 아니다. local 간편 모드의 고정 개발 서명 키, dev/prod 키 필수 검증 등 기존 환경 정책을 유지한다.

## 이메일 가입 인증 (2026-11-03)

이메일 가입 전에 그 주소의 소유를 확인한다(S15P31A302-157). 인증하지 않은 이메일로는 가입 API가 계정을 만들지 않는다.

### 결정

| # | 항목 | 결정 |
|---|---|---|
| D1 | 인증 방식 | 6자리 숫자 인증번호. 메일 앱과 브라우저를 오가도 가입 입력값이 남는다 |
| D2 | 인증 시점 | 가입 전. 인증을 마친 이메일만 `signup`이 받으므로 미인증 계정이 생기지 않고, 보호 API는 계속 DB를 조회하지 않는다 |
| D3 | 발송 수단 | Gmail SMTP(`smtp.gmail.com:587`, STARTTLS, 앱 비밀번호). `spring-boot-starter-mail`과 `VerificationMailer` 포트라 설정값만 바꾸면 다른 업체로 옮길 수 있다 |
| D4 | 기존 이메일 가입자 | 인증 없이 그대로 둔다. `auth_users.email_verified_at`은 NULL이고 기능을 막지 않는다 |
| D5 | 이미 가입한 이메일로 요청 | 409 `urn:fitdining:auth:email-taken`. 가입 API와 노출 수준이 같다 |
| D6 | 로컬·dev | SMTP 값이 없으면 메일을 보내지 않고 인증번호를 BE 로그에 남긴다. prod는 로그 발송기로 기동하지 못한다 |
| D7 | 발송 계정 | 팀 공용 Gmail 계정(2단계 인증 + 앱 비밀번호). 보내는 사람 이름은 "핏다이닝" |

Spring Security One-Time Token Login은 이미 있는 사용자의 비밀번호 없는 로그인용이고 필터 체인을 새로 들여와야 해서 쓰지 않았다. Redis도 쓰지 않는다. 시도 제한이 이미 DB 기반이기 때문이다.

### API

| 메서드·경로 | 요청 | 성공 | 오류 |
|---|---|---|---|
| `POST /api/auth/email-verifications` | `{ "email" }` | 202 `{ "expiresAt", "resendAvailableAt" }` | 400 형식(`errors[].field=email`), 409 `email-taken`, 429(재발송 대기·발송 제한, `Retry-After`는 남은 초), 503 `urn:fitdining:auth:mail-unavailable` |
| `POST /api/auth/email-verifications/confirm` | `{ "email", "code" }` | 200 `{ "verificationToken", "expiresAt" }` | 400 형식(`errors[].field=code`), 400 `urn:fitdining:auth:verification-code-mismatch`, 400 `urn:fitdining:auth:verification-expired`, 429 `urn:fitdining:auth:verification-attempts-exceeded` |
| `POST /api/auth/signup` | 기존 본문 + `verificationToken` | 201(기존과 같음) | 토큰이 없거나 만료·사용됨·다른 이메일이면 400 `urn:fitdining:auth:verification-required`. 이메일·닉네임 중복(409)은 토큰 검사보다 먼저 판정한다 |

- 두 인증 API도 `/api/auth/**` Origin 검사를 받는다. 시각은 ISO-8601 문자열이다.
- 같은 이메일로 다시 요청하면 이전 인증번호는 바로 만료된다. 확인을 마친 인증 토큰은 그대로 쓸 수 있다.
- 메일 발송이 실패하면 이번 발송 기록을 지워 바로 다시 요청할 수 있게 하고 503을 준다. 서버 로그에는 받는 주소가 섞이지 않게 예외 종류만 남긴다.

### 정책

| 항목 | 값 |
|---|---|
| 인증번호 | 6자리, `SecureRandom` |
| 인증번호 유효 | 10분 |
| 확인 시도 | 인증번호 1개당 5회. 5번째로 틀리면 429 `verification-attempts-exceeded`를 주고 이후 정답도 거절한다 |
| 재발송 대기 | 같은 이메일 60초 |
| 발송 제한 | 주소별 15분 10회(`auth_login_attempts.action=verify_send`), 이메일별 1시간 5회(`auth_email_verifications` 행 수) |
| 확인 제한 | 주소별 15분 30회(`verify_confirm`) |
| 인증 토큰 | 256비트 난수, 30분, 1회용 |

발송 제한(재발송 대기, 주소별 15분 10회, 이메일별 1시간 5회)은 간소 모드(`AUTH_SIMPLE_ENABLED=true`)에서도 항상 적용한다. dev가 발송 계정의 하루 한도를 다 써서 prod 인증 메일이 막히는 일을 막기 위해서다(scope D9). 인증번호 1개당 5회 제한도 그대로다. 주소별 확인 제한(`verify_confirm`)만 로그인 시도 제한처럼 간소 모드에서 끈다.

### 저장

`V16__email_verification.sql`이 다음을 바꾼다.

- `auth_email_verifications(id, email, code_hash, attempts, created_at, expires_at, verified_at, token_hash, token_expires_at, consumed_at)`. `(email, created_at)`·`created_at` 인덱스, `token_hash` 유일.
- 인증번호는 `HMAC-SHA256(JWT 서명 키, email + 줄바꿈 + 번호)`, 인증 토큰은 `SHA-256`으로만 저장하고 원문은 저장하지 않는다. 비교는 상수 시간이다.
- `auth_users.email_verified_at timestamptz`. 인증 가입과 서버 설정 데모 계정은 가입 시각으로 채우고, 기존 행과 소셜 가입은 NULL이다.
- `auth_login_attempts.action` CHECK에 `verify_send`, `verify_confirm`을 더했다.
- 가입 트랜잭션은 `consumed_at IS NULL AND token_expires_at > now` 조건부 UPDATE로 토큰을 먼저 사용 처리한다. 갱신 행이 1이 아니면 400으로 롤백하므로 같은 토큰의 동시 가입은 한 건만 통과한다. 계정 INSERT가 실패하면 토큰 사용도 함께 롤백된다.
- `AuthCleanup`이 `auth.cleanup.verification-retention`(기본 1일, 1시간보다 짧으면 기동 거부)보다 오래된 발송 기록을 지운다.

### 설정

| 설정 | env | 설명 |
|---|---|---|
| `spring.mail.host`·`port`·`username`·`password` | `SPRING_MAIL_HOST`, `SPRING_MAIL_PORT`(기본 587), `SPRING_MAIL_USERNAME`, `SPRING_MAIL_PASSWORD` | 호스트가 비면 로그 발송기. 호스트가 있으면 나머지와 `AUTH_MAIL_FROM`이 모두 있어야 하고 `REPLACE_ME`면 기동 거부 |
| `auth.mail.from` | `AUTH_MAIL_FROM` | 보내는 주소. 표시 이름은 `auth.mail.from-name`(기본 핏다이닝) |
| `management.health.mail.enabled` | - | `false`. 메일 서버 장애가 앱 health를 흔들지 않게 한다 |

서버 `/etc/fit/prod.env`·`/etc/fit/dev.env`의 실제 값과 발송 계정 준비는 사용자 작업이다. 배포 서버에서 `smtp.gmail.com:587` 아웃바운드가 열려 있는지 먼저 확인한다.

### 화면

`/signup/email`(2-02)에 인증 단계를 더했다. 인증 화면은 레퍼런스에 없어 `SignupEmail`의 도움말·오류 패턴과 `PasswordSent` 문구 톤에 맞췄고, 문구는 `fe/src/domains/auth/model/signup.ts`의 `signupMessages`에 모았다.

- 이메일 칸 오른쪽 [인증번호 받기](형식이 맞을 때만 켜짐) → 인증번호 칸이 나타나고 이메일 칸 아래에 "{email}로 인증번호를 보냈어요. 메일이 안 보이면 스팸함도 확인해 주세요."를 보인다.
- 인증번호 칸은 `inputMode=numeric`, `autocomplete=one-time-code`, 6자리이며 남은 시간(10:00부터)을 보인다. [다시 받기]는 60초 뒤 켜진다. 남은 시간은 표시용이고 만료 판정은 서버가 한다.
- 성공하면 "인증했어요."를 보이고 이메일 칸을 읽기 전용으로 잠근다. [이메일 바꾸기]로 처음부터 다시 받는다. 인증번호를 보낸 뒤 이메일을 고쳐도 처음부터 다시다.
- [다음]은 기존 조건에 더해 지금 이메일의 인증을 마쳤을 때만 켜진다. 인증 토큰은 메모리 state에만 두고 storage에 저장하지 않는다.
- 가입이 `verification-required`로 실패하면 시트를 닫고 이메일 칸에 "이메일 인증이 만료됐어요. 다시 인증해 주세요."를 보이며 인증 단계로 되돌린다.
- 인증번호 칸은 투명도만 200ms(움직임 줄이기 120ms)로 나타난다.

### 남은 이슈

- 실제 Gmail 발송, 배포 서버의 587 포트 접속, 360px 실제 브라우저 레이아웃은 확인하지 않았다(로그 발송기와 jsdom 시험만 했다).
- Gmail 일반 계정은 하루 약 500명 수신 한도가 있다. 넘으면 하루 동안 발송이 막히며 503으로 알린다.
- 비밀번호 찾기 메일은 같은 `VerificationMailer` 포트를 재사용할 수 있게만 만들었다.
