# JWT 로그인 구현 계획 및 사용 방법

## 1. 범위와 합의 사항
- 서버 Java 21, Spring Boot 4.1.1. FE API 경로·요청·성공 응답과 오류 해석은 유지한다.
- 2026-10-23 사용자 결정: AT는 무상태 JWT로 검증해 보호 요청의 DB 조회를 제거한다. 로그아웃·재사용 탐지 뒤에도 이미 발급된 AT는 만료까지 **최대 30분 유효**하다.
- AT 수명은 30분 유지한다. RT 묶음의 절대 만료는 로그인 후 24시간이며, 갱신으로 연장하지 않는다. AT 만료도 묶음 만료를 넘지 않는다.
- 세션 테이블은 없다. 로그인마다 새 `family_id`를 만들고 JWT의 `sid`, API의 `sessionId`에 그대로 사용한다.
- DB에는 RT의 jti와 메타데이터만 저장한다. AT, JWT 원문, 평문 비밀번호, 서명 키는 저장하지 않는다.
- RT 회전 시 이전 행에 `used_at`을 기록하고 같은 묶음에 새 RT 한 행을 저장한다.
- RT 재사용은 해당 묶음의 RT를 즉시 폐기한다. 묶음별 이벤트 수로 재사용 횟수를 계산하고 세 번째부터 `ATTACK_DETECTED`를 기록한다. 서명 오류는 이벤트에 넣지 않는다.
- 로그아웃은 현재 RT 묶음만 폐기한다. 다른 기기/브라우저의 묶음에는 영향을 주지 않는다.
- 회원가입·소셜 로그인·다른 기기 관리 UI는 범위 밖이다. 선택한 개발 계정은 최초 생성 시에만 시드한다.

## 2. 화면 예시 (CSS 없음)
`/login`: 아이디 입력, 비밀번호 입력, 로그인 버튼, 오류 메시지, 기존 로그인 복구.

```text
로그인
아이디   [            ]
비밀번호 [            ]
[로그인]
```

`/auth-demo`: 사용자, sid, AT/세션 만료 시각, 인증 API 호출·수동 갱신·현재 세션 로그아웃 버튼, 처리 결과.
토큰 원문은 화면에 노출하지 않는다. `/`에서 두 화면으로 이동할 수 있다.

## 3. 인증 흐름
```text
로그인 → 주소별 시도 기록·제한 → 사용자 조회 → 트랜잭션 밖 BCrypt → 새 family와 RT 한 행 저장 → AT/RT 발급
보호 요청 → JWT 서명·issuer·audience·type·시간 검증 → 클레임으로 응답(SQL 0건)
AT 만료 → RT 갱신 → 해당 RT 행 잠금·used_at 기록 + 새 RT 한 행 저장 → 요청 1회 재시도
RT 재사용 → family의 RT 폐기 + 보안 이벤트 → 401(AT는 만료까지 유효)
로그아웃 → family의 RT 폐기 + 쿠키/메모리 제거(AT는 만료까지 유효)
새로고침 → HttpOnly RT 쿠키 갱신 → 메모리 AT 복구
```

## 4. 모듈과 저장소
- `domain`: `AuthUser`, `AuthRefreshToken`, `AuthSecurityEvent`, `AuthLoginAttempt` JPA 엔티티.
- `repository`: Spring Data JPA 리포지토리. 사용자 이름 조회, jti 행 잠금, 묶음 폐기, 범위·상한이 있는 정리 쿼리.
- `application`: `AuthService`는 트랜잭션 밖 흐름을 조정한다. `AuthTransactions`의 별도 프록시 메서드가 짧은 DB 트랜잭션을 담당한다.
- `infrastructure`: BCrypt, Nimbus JWT, 웹 전용 설정·데모 계정 시드.
- `presentation`: REST API, 쿠키, 인증 경로만 다루는 인터셉터, ProblemDetail.

V1은 사용자·RT·보안 이벤트·로그인 시도 4개 테이블이며 시각은 모두 `timestamptz`다. `family_id`는 RT 묶음 식별자이고 이벤트에는 FK가 없어 RT 정리 뒤에도 증거가 남는다. 아직 공유 DB에 적용하지 않은 V1을 최종 스키마로 재작성한다. V2는 추가하지 않는다.

인증 확인은 DB를 조회하지 않는다. 갱신은 제시된 RT만 `PESSIMISTIC_WRITE`로 잠그며 정상 경로의 SQL 수는 전체 데이터 양과 무관하다. 로그인 시도는 주소별 PostgreSQL 트랜잭션 advisory lock 안에서 횟수 확인·INSERT만 수행한다. 해당 트랜잭션이 끝나고 사용자 조회가 끝난 뒤 BCrypt를 실행하므로 느린 비밀번호 검사가 다른 묶음 갱신을 막지 않는다. 데모 계정 해시도 트랜잭션 밖에서 만들고, 동시 시드 유니크 충돌은 기존 사용자 존재를 확인해 처리한다.

`AuthCleanup`은 웹 앱에서 기본 10분마다 각 테이블 최대 1,000행씩 삭제한다. RT는 만료 후 7일, 이벤트는 생성 후 90일, 로그인 시도는 15분 보관한다. 경계 시각과 같은 행은 남긴다. `auth.cleanup.interval`, `token-retention`, `event-retention`, `attempt-retention`, `batch-size`로 조정한다. 두 인스턴스가 동시에 실행해도 삭제가 멱등이고 작업량이 제한되므로 ShedLock을 쓰지 않는다.

웹 앱은 DML 계정 `fit_dev_app`을 사용한다. `fit_migrator`의 기본 테이블·시퀀스 권한을 로컬 초기화 스크립트가 앱 계정에 부여하므로 infra 변경과 V1의 별도 GRANT는 없다. 스키마 변경은 Flyway만 수행하며 JPA는 `ddl-auto=validate`, `open-in-view=false`다.

## 5. API 계약
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | /api/auth/login | 아이디·비밀번호 | AT 응답, RT 쿠키 설정 |
| POST | /api/auth/refresh | RT 쿠키 | RT 회전, AT 응답 |
| POST | /api/auth/logout | Bearer AT | 현재 sid 폐기, RT 쿠키 제거 |
| GET | /api/auth/me | Bearer AT | 사용자·세션·만료 정보 |
| GET | /api/auth/protected | Bearer AT | 보호 API 확인 |

로그인 요청: `{"username":"demo","password":"환경 변수로 설정한 비밀번호"}`.
토큰 응답: accessToken, accessExpiresAt, sessionExpiresAt, sessionId, username.
오류는 `application/problem+json`의 ProblemDetail이다. 입력 형식 400, 인증 실패 401, Origin 거부 403, 시도 제한 429(`Retry-After: 900`), 저장소 장애 503을 반환한다. `detail`은 일반 안내 문구이며 업무 코드를 노출하지 않는다. AT 만료의 401에만 `type: "urn:fitdining:auth:access-token-expired"`를 설정한다(BE `AuthFailure.ACCESS_TOKEN_EXPIRED`, FE `ACCESS_TOKEN_EXPIRED_TYPE`). FE는 상태와 type을 함께 검사해 한 번 갱신·재시도한다. 나머지 401에는 별도의 type을 넣지 않으며, 로그인 401은 아이디·비밀번호 불일치로 표시한다. `/refresh` 401은 RT 쿠키도 삭제한다.
POST는 설정된 프론트 Origin을 필수로 검증한다. CLI 호출에도 Origin 헤더를 보낸다. JSON만 입력받고, FE는 같은 출처 `/api`로 호출한다. 인증 응답에는 Cache-Control: no-store를 설정한다.

## 6. 브라우저 보안과 동시성
- AT는 모듈 메모리에서만 보관한다. RT는 HttpOnly, SameSite=Strict, Path=/api/auth 쿠키에 저장한다. 운영 HTTPS에서 Secure=true 필수.
- 브라우저 탭 내부에서는 갱신 Promise를 공유한다. Web Locks API로 같은 Origin의 여러 탭 갱신도 직렬화한다. 지원하지 않는 브라우저는 갱신을 거절하며 재로그인을 안내한다.
- 로그아웃/로그인도 같은 브라우저 잠금에 참여하며 완료 후 BroadcastChannel로 다른 탭의 AT를 비운다. 같은 브라우저 프로필의 탭은 하나의 쿠키 세션을 공유한다.
- 다중 서버/복제본은 같은 PostgreSQL DB와 서명 키를 사용한다. 다른 기기는 독립적인 쿠키와 sid를 갖는다.
- 로그인 실패 메시지는 동일하게 반환한다. IP당 15분간 최대 20번의 로그인 요청으로 제한한다. 프록시 헤더는 신뢰하지 않으며 reverse proxy 배포 시 신뢰할 프록시 설정을 별도로 적용해야 한다.
- 서명 알고리즘 HS256 고정, 최소 32바이트 Base64 키, iss/aud/type/필수 식별자/시간 검증. JWT에 민감 정보를 넣지 않는다.

## 7. 남은 운영 이슈
로그인 제한은 현재 `request.getRemoteAddr()` 기준이다. Next rewrite/Caddy 뒤에서 프록시 주소를 공유할 수 있다. 신뢰할 프록시·전달 헤더 설정은 인프라 팀과 정할 범위 밖 후속 작업이다. 새 `AUTH_*` 환경변수의 인프라 계약 반영도 후속 작업이다.

## 8. 실행 방법
먼저 `infra/local/README.md`에 따라 로컬 Postgres를 초기화한다. `be/.env.example`을 `.env`로 복사하고 앱 DB 비밀번호와 필수 인증 설정을 지정한다. 키는 최초 생성 후 안전하게 보관하며 재시작 시 같은 값을 사용한다.

PowerShell, `be` 디렉터리:
```powershell
# migrate는 인증 설정 없이 DB 설정만으로 실행한다.
$env:SPRING_DATASOURCE_USERNAME = 'fit_migrator'
$env:SPRING_DATASOURCE_PASSWORD = '<FIT_MIGRATOR_PASSWORD>'
.\gradlew.bat bootRun --args='--spring.profiles.active=migrate'

# 웹 앱에만 인증 설정을 제공한다. 재시작 때 같은 키를 사용한다.
$env:SPRING_DATASOURCE_USERNAME = 'fit_dev_app'
$env:SPRING_DATASOURCE_PASSWORD = '<FIT_DEV_APP_PASSWORD>'
$env:JWT_SECRET = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:AUTH_FRONTEND_ORIGIN = 'http://localhost:3000'
$env:AUTH_COOKIE_SECURE = 'false'
# 선택: 두 키를 함께 지정한다. 기존 사용자 비밀번호는 덮어쓰지 않는다.
$env:AUTH_DEMO_USERNAME = 'demo'
$env:AUTH_DEMO_PASSWORD = '<직접 정한 12자 이상의 개발 비밀번호>'
.\gradlew.bat bootRun
```

필수 키는 `JWT_SECRET`(Base64 디코딩 32바이트 이상), `AUTH_FRONTEND_ORIGIN`(경로 없는 http/https origin), `AUTH_COOKIE_SECURE`(`true` 또는 `false`)다. 누락·빈 값·약한 키는 기동을 거부한다. 선택 키 `AUTH_DEMO_USERNAME`, `AUTH_DEMO_PASSWORD`는 둘 다 지정하거나 둘 다 생략하며, 비밀번호는 12자 이상, UTF-8 72바이트 이하다. 운영 HTTPS에서는 Secure를 true로 지정한다. 인증과 스케줄러는 웹 앱에서만 활성화된다. `migrate`는 인증 Bean·스케줄러·데모 시드를 로드하지 않는다.

`fe`에서 `pnpm dev` 후 http://localhost:3000/login 접속. 같은 출처 `/api`가 BE로 전달된다. FE 서버의 `BE_INTERNAL_URL`로 대상을 바꿀 수 있다(기본 http://localhost:8080). 운영은 Caddy가 `/api`를 전달한다. localhost와 127.0.0.1을 섞지 않는다. 새 `AUTH_*` 키의 인프라 환경변수 계약 반영은 인프라 팀 후속 작업이다.

서버 검증: `.\gradlew.bat test`. 프론트 검증: `pnpm lint`, `pnpm exec prettier --check .`, `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build`.
인증 클라이언트와 Vitest 테스트는 `fe/src/domains/auth/api/auth-client.ts`, `auth-client.test.ts`에 있다.

## 9. 검증 시나리오
- 독립 RT 묶음, 로그아웃/재사용 뒤 RT 즉시 무효와 AT 만료까지 유효.
- 동일 RT 동시 갱신은 한 번만 성공, 세 번 재사용 시 공격 기록.
- AT 30분 만료 및 갱신 반복 시 묶음 절대 만료 24시간 유지.
- 서명·issuer·audience·type·필수 클레임 오류 차단, 미등록 RT 차단.
- 인증 SQL 0건, 이력 3,000행 전후 갱신 SQL 수 일정.
- BCrypt가 트랜잭션 밖이며 느린 검증 중 다른 묶음 갱신 가능.
- 정리 기간 경계·배치 상한·RT 삭제 뒤 보안 이벤트 유지.
- 인증 env 없는 migrate 기동·종료와 웹 필수 env 기동 거부.
- 쿠키·Origin·ProblemDetail·429 Retry-After와 공개 장소·리뷰 API 공존.
