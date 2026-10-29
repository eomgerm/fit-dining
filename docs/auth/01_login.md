# 로그인·회원가입 (JWT)

2026-10-23 기준 현재 구현의 동작과 실행 방법이다. 서버는 Java 21, Spring Boot 4.1.1이며, 프런트는 Next.js를 사용한다.

## 1. 결정 사항

2026-10-23에 확정한 인증 정책은 다음과 같다.

- 이메일·비밀번호·닉네임과 필수 약관 동의로 가입하며, 가입 성공 시 자동 로그인한다. 이메일 소유 여부는 인증하지 않는다.
- 만 14세 이상, 서비스 이용약관, 개인정보 수집·이용의 세 항목이 모두 필수다. 닉네임은 대소문자를 무시하고 중복을 금지한다.
- AT(Access Token)는 무상태 JWT다. 보호 요청의 인증 확인은 DB를 조회하지 않는다. 로그아웃·RT 재사용 탐지 뒤에도 이미 발급한 AT는 만료까지 최대 30분 유효하다.
- AT 수명은 30분이며, 실제 만료는 `min(발급 시각 + 30분, RT 묶음 만료)`다. RT(Refresh Token) 묶음은 가입·로그인 시점부터 24시간 뒤 절대 만료하며, 갱신으로 연장되지 않는다.
- 세션 테이블은 없다. 가입·로그인마다 새 `family_id`를 만들고 API의 `sessionId`로 반환한다. 묶음 식별자와 만료는 RT 행에서 읽는다.
- JWT에는 표준 클레임과 `token_type`만 담는다. 계정 정보는 응답 본문이나 내 정보 API로 제공한다.
- DB에는 비밀번호 해시와 RT 식별자·메타데이터를 저장한다. 평문 비밀번호, JWT 원문, AT, 서명 키는 저장하지 않는다.
- 소셜 로그인·가입은 아래 소셜 로그인 절을 따른다. 이메일 인증, 비밀번호 찾기, 다른 기기 관리 UI는 구현되어 있지 않다.

## 2. 화면과 사용자 흐름

디자인 레퍼런스는 `C:/Users/SSAFY/pjt/design_fitdining_v1/project/`의 개별 화면이다. 실제 UI는 develop 공통 컴포넌트와 Tailwind 토큰을 사용한다.

| 실제 화면·상태 | 레퍼런스 | 현재 동작 |
|---|---|---|
| `/signup` | `Signup` (2-01) | 기능 소개 캐러셀 3장과 점 표시. 시각물은 정적 그림이다. 카카오·네이버·구글 버튼으로 소셜 가입을 시작한다. 이메일 가입 링크는 `/signup/email`로 이동한다. |
| 건너뛰기 대화상자 | `SignupLater` (2-E01) | “가입하지 않고 시작할까요?”에서 “가입 없이 시작”은 `/`로 이동하고 “가입하기”는 창을 닫는다. “시작하면 이용약관과 개인정보처리방침에 동의한 것으로 간주해요.”를 고지한다. 링크 모양의 “이용약관”, “개인정보처리방침” 버튼을 누르면 각각 “이용약관은 준비 중이에요.”, “개인정보처리방침은 준비 중이에요.” 토스트를 표시한다. |
| `/signup/email` | `SignupEmail` (2-02) | 이메일·비밀번호·비밀번호 확인·닉네임 입력. 모두 유효하면 “다음”이 활성화된다. |
| 약관 바텀시트 | `SignupTerms` (2-03) | 전체 동의와 필수 3개 항목. 모두 동의하면 “동의하고 시작하기”가 활성화된다. “보기”는 본문 준비 중 토스트를 표시한다. |
| 가입 입력 오류 | `SignupEmailError` (2-E02) | 가입 실패 시 시트를 닫고 해당 입력칸 아래에 오류를 표시한다. 이메일 중복이면 로그인 링크도 표시한다. 일반 실패·시도 제한은 안내 문구로 표시한다. |
| `/login` | `Login` (3-01), `LoginError` (3-E01) | 이메일·비밀번호 입력, 비밀번호 표시 전환, 로그인 오류 안내. “이메일로 가입하기”는 `/signup`으로 이동한다. 비밀번호 찾기는 준비 중 안내, 소셜 버튼으로 로그인을 시작한다. |
| `/my` | `MyInfo` | 본인 프로필·로그인 방식 표시. 로그아웃 성공 시 `/` 이동. 나머지 메뉴는 준비 중 토스트. |
| `/auth-demo` | 인증 확인용 화면 | 닉네임, 묶음 식별자, AT·묶음 만료 시각을 표시한다. 인증 API 호출, 수동 갱신, 현재 묶음 로그아웃을 제공한다. 토큰 원문은 표시하지 않는다. |

가입 흐름은 `/signup` → `/signup/email` → 약관 시트 → 자동 로그인 → `/`다. `/login`의 로그인 성공 또는 기존 로그인 복구 성공은 `/`로 이동한다. `/auth-demo`는 복구와 `/me` 확인에 실패하여 401을 받으면 `/login`으로 이동하며, 로그아웃 성공 뒤에도 `/login`으로 이동한다.

서비스 로그아웃 진입은 지도 화면의 “내 정보” → `/my`다. 세션 복구 실패·401 또는 다른 탭 세션이 비면 `/login`으로 이동한다.

바텀시트는 열림 320ms·닫힘 220ms이며, 움직임 줄이기 설정에서는 이동 없이 투명도 중심의 120ms 전환을 사용한다.

## 3. 인증 처리 흐름

| 요청·상황 | 처리 |
|---|---|
| 가입 | DTO 정규화·형식·약관 검증 → 주소·행동별 시도 기록 → 이메일·닉네임 중복 확인 → 트랜잭션 밖 BCrypt 해시 → 사용자와 최초 RT를 한 트랜잭션에 저장 → AT 본문·RT 쿠키 발급 |
| 로그인 | 입력 검증·이메일 정규화 → 주소·행동별 시도 기록 → 사용자 조회 → 트랜잭션 밖 BCrypt 비교 → 새 묶음과 RT 저장 → AT 본문·RT 쿠키 발급. 없는 사용자도 더미 해시로 비교한다. |
| 보호 요청 | AT 서명·클레임 검증으로 인증한다(SQL 0건). `/protected`는 검증된 사용자 id로 응답한다. `/me`는 인증 후 사용자 PK 1건을 추가 조회한다. |
| 갱신 | RT 서명·클레임 검증 → `jti`의 RT 행을 비관적 쓰기 잠금 → 사용자 id·만료 일치와 사용·폐기 여부 확인 → `used_at` 기록 → 사용자 PK 1건 조회 → 같은 묶음에 새 RT 저장·토큰 응답 |
| RT 재사용 | 사용·폐기된 RT가 제시되면 회전 트랜잭션을 끝낸 뒤 별도 트랜잭션에서 묶음을 폐기하고 보안 이벤트를 남긴다. 세 번째부터 `ATTACK_DETECTED`를 기록하고 401을 반환한다. 서명 오류는 재사용 이벤트로 기록하지 않는다. |
| 쿠키 로그아웃 | RT 쿠키의 서명·용도를 검증하고 `jti`로 RT를 조회해 해당 사용자 묶음을 폐기한다. 쿠키를 지우고 204를 반환한다. AT는 필요 없다. RT가 없거나 무효이거나 DB에 없으면 폐기할 묶음 없이 쿠키를 지우고 204를 반환한다. |
| 새로고침 복구 | 메모리에 세션이 없으면 HttpOnly RT 쿠키로 갱신하고 새 AT를 메모리에 보관한다. 갱신 401이면 메모리를 비우고 서버도 RT 쿠키를 지운다. |

가입의 중복 사전 검사 이후 INSERT가 경합해도 DB 유니크 제약 충돌을 트랜잭션 밖에서 재확인하여 이메일·닉네임별 409로 변환한다. 사용자 생성과 최초 RT 발급은 함께 성공하거나 함께 롤백된다.

갱신은 전체 이력을 조회하지 않고 제시된 RT와 사용자 PK를 조회하므로 정상 경로 SQL 수가 이력 크기와 무관하다. 묶음 폐기는 PostgreSQL advisory lock을 먼저 잡고 RT를 갱신하며, 동시에 회전이 발생할 수 있어 미폐기 행이 없는지 재확인한다. 최초 폐기 시각·사유는 유지한다.

## 4. API 계약

인증 경로의 접두사는 `/api/auth`다. 사용자 프로필은 전체 경로로 표기한다. 성공 응답은 DTO, 오류는 `application/problem+json`의 ProblemDetail이다.

| 메서드 | 경로 | 인증·입력 | 성공 응답 |
|---|---|---|---|
| POST | `/signup` | 이메일·비밀번호·닉네임·필수 약관 | 201, 토큰 응답과 RT 쿠키 |
| POST | `/login` | 이메일·비밀번호 | 200, 토큰 응답과 RT 쿠키 |
| POST | `/refresh` | RT 쿠키 | 200, 같은 묶음의 토큰 응답과 새 RT 쿠키 |
| POST | `/logout` | RT 쿠키, Bearer AT 불필요 | 204, 현재 묶음 폐기와 쿠키 제거 |
| GET | `/api/v1/users/{userId}` | Bearer AT, 본인만 | 200, `userId`, `nickname`, `loginMethod` (`email`, `google`, `kakao`, `naver`). 남의 id는 403, 탈퇴·없는 사용자는 404 |
| GET | `/me` | Bearer AT | 200, `nickname`, `email` |
| GET | `/protected` | Bearer AT | 200, `message`, `userId` |

가입 요청 예시:

```json
{
  "email": "new@example.com",
  "password": "example-password123",
  "nickname": "새이름",
  "agreements": { "ageOver14": true, "terms": true, "privacy": true }
}
```

로그인 요청 예시:

```json
{ "email": "new@example.com", "password": "example-password123" }
```

가입·로그인·갱신의 공통 응답 본문 예시다. 토큰과 시각은 설명용 값이다. RT는 본문에 포함하지 않는다.

```json
{
  "userId": "<user-id>",
  "accessToken": "<access-jwt>",
  "nickname": "새이름",
  "sessionId": "<family-id>",
  "accessExpiresAt": 1792715400,
  "sessionExpiresAt": 1792800000
}
```

`sessionId`는 DB의 `family_id`이고 만료 시각은 epoch 초다. 닉네임은 로그인·가입에서 이미 읽거나 생성한 사용자 행을 사용한다. 갱신은 RT에 연결된 사용자 PK 1건을 읽어 채우며 닉네임만 따로 조회하지 않는다. `/me` 응답은 `{"nickname":"새이름","email":"new@example.com"}`, `/protected` 응답은 `{"message":"인증에 성공했습니다.","userId":"<user-id>"}`다.

인증 컨트롤러에 매핑된 POST는 `Origin`이 `AUTH_FRONTEND_ORIGIN`과 정확히 같아야 한다. CLI 요청에도 Origin 헤더가 필요하다. JSON 본문이 있는 요청은 `Content-Type: application/json`을 사용한다. 인증 응답에는 `Cache-Control: no-store`, 인터셉터에는 `X-Content-Type-Options: nosniff`가 설정되어 있다.

| 상태 | 의미·추가 정보 |
|---|---|
| 400 | 잘못된 입력, 약관 누락·미동의, 깨진 JSON, 알 수 없는 요청 필드. DTO 검증 오류는 `errors: [{field, reason}]`를 포함하고, JSON 파싱 오류 등 모든 400에 이 확장 필드가 있는 것은 아니다. |
| 401 | 자격 증명 또는 토큰 검증 실패. 로그인은 이메일 존재 여부와 비밀번호 오류를 구분하지 않는다. `/refresh`의 401은 쿠키도 삭제한다. |
| 403 | Origin 누락·불일치 |
| 409 | 이메일·닉네임 중복. 아래 type으로 구분한다. |
| 415 | 지원하지 않는 요청 미디어 형식 |
| 429 | 주소·행동별 시도 제한. `Retry-After: 900` |
| 503 | 인증 저장소 접근·트랜잭션 장애 |

명시적으로 부여하는 ProblemDetail type은 다음 세 가지다. 그 외 오류에는 별도 업무 type을 부여하지 않는다.

| 상태 | type | FE 처리 |
|---|---|---|
| 401 | `urn:fitdining:auth:access-token-expired` | 보호 API 호출에서만 갱신 후 1회 재시도 |
| 409 | `urn:fitdining:auth:email-taken` | “이미 가입한 이메일이에요. 로그인해 주세요.” |
| 409 | `urn:fitdining:auth:nickname-taken` | “이미 쓰는 닉네임이에요.” |

필드 오류 응답 예시:

```json
{
  "status": 400,
  "detail": "입력 형식을 확인해주세요.",
  "errors": [{ "field": "password", "reason": "영문과 숫자를 섞어 8자 이상" }]
}
```

약관 오류의 field는 `agreements` 또는 `agreements.terms` 같은 중첩 경로다. FE는 400의 이메일·비밀번호·닉네임 오류를 각 입력칸에 대응시키고, 그 외 오류는 일반 안내로 표시한다. `detail`에는 일반 문구를 사용하며 내부 예외·요청 본문을 응답하지 않는다.

약관 검증 오류의 `errors[].reason`은 로캘과 무관하게 아래 문구로 고정된다. 개별 항목은 누락·null과 false에 같은 문구를 사용한다.

| field | 고정 reason |
|---|---|
| `agreements` | 필수 약관에 모두 동의해 주세요. |
| `agreements.ageOver14` | 만 14세 이상 확인에 동의해 주세요. |
| `agreements.terms` | 서비스 이용약관에 동의해 주세요. |
| `agreements.privacy` | 개인정보 수집·이용에 동의해 주세요. |

## 5. JWT 페이로드와 검증

서명은 HS256, issuer는 `fitdining-auth`, audience는 `fitdining-api`다. 발급하는 클레임은 아래 목록으로 제한된다.

| 클레임 | AT | RT | 의미 |
|---|---|---|---|
| `iss` | 포함 | 포함 | 발급자 |
| `aud` | 포함 | 포함 | 대상 API |
| `sub` | 포함 | 포함 | 사용자 id |
| `iat` | 포함 | 포함 | 발급 시각 |
| `exp` | 포함 | 포함 | AT 만료 또는 RT 묶음 만료 |
| `token_type` | `access` | `refresh` | 토큰 용도 |
| `jti` | 없음 | 포함 | RT 행의 기본 키 |

이메일·닉네임·`sid`·`family_exp`는 담지 않는다. 계정 정보와 묶음 상태를 JWT에 복제하지 않고, 계정 정보는 사용자 행에서, 묶음 id·만료는 RT 행에서 읽는다. AT에는 `jti`도 발급하지 않는다.

검증은 서명·HS256, `iss` 일치, `aud`에 대상 API 포함, 요청 용도와 `token_type` 일치, 비어 있지 않은 `sub`, `iat`·`exp` 존재, `iat <= 현재`, `exp > iat`, `exp > 현재`를 확인한다. RT는 비어 있지 않은 `jti`도 필요하다. `nbf`가 제공되면 미래 시각을 거부하지만 자체 발급에는 넣지 않는다. 문자열이 없거나 비어 있거나 8,192자를 넘으면 거부한다. AT 만료는 위 401 type으로 구분하고 RT 만료는 일반 401이다.

발급 키 목록과 검증 조건은 별개다. 검증기는 추가 클레임 자체를 이유로 거부하지 않는다. 갱신에서는 JWT 검증 뒤 DB RT의 사용자 id·만료와도 대조한다. 보호 요청의 인증에는 DB 폐기 여부 조회가 없으므로 AT는 자체 만료까지 유효하다.

## 6. 입력 규칙과 시도 제한

| 항목 | 가입 규칙 |
|---|---|
| 이메일 | 앞뒤 유니코드 공백 제거·소문자 정규화 후 254자 이하. 공백·중복 `@` 없이 도메인에 점이 있는 이메일 형식. 정규화된 이메일 중복 금지 |
| 비밀번호 | 8자 이상, 영문자와 숫자를 모두 포함, UTF-8 72바이트 이하. 공백을 임의로 제거하지 않는다. BCrypt cost는 12다. |
| 비밀번호 확인 | FE에서 비밀번호와 일치 여부만 검사하며 BE에는 전송하지 않는다. |
| 닉네임 | 앞뒤 유니코드 공백 제거 후 코드 포인트 기준 2~15자. 내부 제어 문자는 거부하며, `lower(nickname)` 비교로 중복을 금지 |
| 약관 | `agreements.ageOver14`, `terms`, `privacy`가 모두 존재하고 true여야 한다. 세 동의 시각과 약관 버전을 저장한다. |

BE의 `AuthText.strip`은 `strip()`과 추가 유니코드 공백 처리를 함께 사용해 NBSP·전각 공백도 제거한다. 최종 가입 형식 검증은 BE의 `SignupRequest`·`SignupValue`가 수행한다. 로그인도 이메일을 정규화하며, 로그인 DTO는 비어 있지 않은 이메일·최대 254자와 비어 있지 않은 비밀번호를 요구한다. 로그인 서비스는 비밀번호 UTF-8 72바이트 상한을 확인하고 실제 자격 증명을 비교한다. 로그인에 가입용 비밀번호 복잡도 규칙을 다시 적용하지는 않는다.

시도 제한은 native 전달 헤더 처리 후의 사용자 주소 `request.getRemoteAddr()`와 `action`(`login`, `signup`) 조합별 15분에 최대 20회다. 신뢰 프록시를 거치지 않은 연결은 직접 연결 주소를 사용한다. 형식 검증을 통과해 서비스의 기록 단계에 도달한 시도를 센다. 주소·행동별 PostgreSQL 트랜잭션 advisory lock 안에서 횟수 확인과 INSERT를 수행한다. 로그인과 가입 횟수는 독립적이며, 해당 트랜잭션이 끝난 뒤 BCrypt를 실행한다.

## 7. 스키마·보관 정책·DB 권한

스키마 정의는 `be/src/main/resources/db/migration/V1__auth.sql`과 `V2__user_preferences_and_soft_delete.sql`이다. 시각 컬럼은 모두 `timestamptz`이고, 아래에서 nullable로 적지 않은 컬럼은 NOT NULL이다.

### `auth_users`

| 컬럼 | 타입 | 제약·용도 |
|---|---|---|
| `id` | text | PRIMARY KEY, 사용자 id |
| `email` | varchar(254) | 활성 계정 부분 UNIQUE, `email = lower(email)` CHECK |
| `nickname` | varchar(15) | `char_length(nickname) BETWEEN 2 AND 15` CHECK |
| `age_confirmed_at`, `terms_agreed_at`, `privacy_agreed_at` | timestamptz | 필수 동의 시각 |
| `terms_version` | text | 가입 시 적용한 약관 버전 |
| `password_hash` | text | BCrypt 해시 |
| `created_at` | timestamptz | 생성 시각 |

`deleted_at timestamptz NULL`은 탈퇴 시각이며 `deleted_at IS NULL OR deleted_at >= created_at` CHECK를 둔다.
인덱스는 PK와 `auth_users_email_active_idx`(email), `auth_users_nickname_active_idx`(lower(nickname))다.
두 UNIQUE 인덱스는 `WHERE deleted_at IS NULL`로 활성 계정만 검사한다.

### `user_preferences`

| 컬럼 | 타입 | 제약·용도 |
|---|---|---|
| `user_id` | text | PK, auth_users(id) FK ON DELETE CASCADE |
| `mood` | text | nullable, QUIET 또는 LIVELY |
| `priorities`, `purposes` | text[] | NOT NULL, 기본 빈 배열 |
| `tastes` | jsonb | NOT NULL, 기본 [], JSON 배열 CHECK |
| `created_at`, `updated_at` | timestamptz | 생성·수정 시각 |

### `auth_refresh_tokens`

| 컬럼 | 타입 | 제약·용도 |
|---|---|---|
| `jti` | text | PRIMARY KEY, RT 식별자 |
| `family_id` | text | RT 묶음 id |
| `user_id` | text | `auth_users(id)` FOREIGN KEY |
| `created_at` | timestamptz | 발급 시각 |
| `expires_at` | timestamptz | 묶음 만료, `expires_at > created_at` CHECK |
| `used_at`, `revoked_at` | timestamptz | nullable, 사용·폐기 시각 |
| `revoke_reason` | text | nullable, 최초 폐기 사유 |

PK 외 인덱스는 `auth_refresh_tokens_family_id_idx (family_id)`, `auth_refresh_tokens_expires_at_idx (expires_at)`다.

### `auth_security_events`

| 컬럼 | 타입 | 제약·용도 |
|---|---|---|
| `id` | bigint | GENERATED ALWAYS AS IDENTITY, PRIMARY KEY |
| `family_id` | text | 묶음 id, FK 없음 |
| `created_at` | timestamptz | 발생 시각 |
| `type` | text | `REFRESH_REUSE` 또는 `ATTACK_DETECTED` CHECK |
| `reuse_count` | integer | `>= 0` CHECK, 묶음별 누적 횟수 |

PK 외 인덱스는 `auth_security_events_family_id_idx (family_id)`, `auth_security_events_created_at_idx (created_at)`다. RT와 FK로 연결하지 않아 RT 정리 후에도 증거가 남는다.

### `auth_login_attempts`

| 컬럼 | 타입 | 제약·용도 |
|---|---|---|
| `id` | bigint | GENERATED ALWAYS AS IDENTITY, PRIMARY KEY |
| `address` | text | native 전달 헤더 처리 후의 사용자 주소 |
| `action` | text | `login` 또는 `signup` CHECK |
| `created_at` | timestamptz | 시도 시각 |

PK 외 인덱스는 `auth_login_attempts_address_action_created_at_idx (address, action, created_at)`다.

### 정리 작업과 권한

| 설정 키 | 기본값 | 의미 |
|---|---|---|
| `auth.cleanup.interval` | `PT10M` | 최초 실행 지연·실행 완료 후 다음 실행까지 간격 |
| `auth.cleanup.token-retention` | `P7D` | RT 만료 후 보관 기간 |
| `auth.cleanup.event-retention` | `P90D` | 보안 이벤트 생성 후 보관 기간 |
| `auth.cleanup.attempt-retention` | `PT15M` | 시도 기록 생성 후 보관 기간 |
| `auth.cleanup.batch-size` | `1000` | 한 실행에서 테이블마다 삭제하는 최대 행 수 |

`AuthCleanup`은 웹 앱에서만 실행한다. 기준 시각보다 오래된 행만 삭제하며 경계와 같은 행은 남긴다. 각 테이블의 삭제량은 제한되고 멱등이므로 별도 ShedLock은 없다. 배치 크기는 양수, 보관 기간은 음수가 아니어야 한다.

로컬 웹 앱의 기본 DB 역할은 DML 전용 `fit_dev_app`, Flyway 역할은 `fit_migrator`다. 로컬 초기화가 앱 역할에 테이블 SELECT·INSERT·UPDATE·DELETE와 시퀀스 USAGE·SELECT를 부여한다. 웹 앱은 Flyway를 실행하지 않고 JPA `ddl-auto=validate`, `open-in-view=false`로 동작한다. `migrate` 프로필은 비웹 앱으로 Flyway를 실행하며 인증 Bean·데모 시드·스케줄러를 로드하지 않는다.

## 8. 모듈 구조

BE 패키지 기준 경로는 `be/src/main/java/kr/co/fitdining/api/auth/`다.

| 모듈 | 담당 |
|---|---|
| `domain` | 사용자·RT·보안 이벤트·시도 기록 엔티티, 인증 실패·중복 예외 |
| `repository` | 이메일·사용자 PK 조회, 닉네임 중복 검사, RT 행 잠금·묶음 폐기·시도 제한·정리 쿼리 |
| `application` | `AuthService`의 트랜잭션 밖 조정·비밀번호 처리, `AuthTransactions`의 짧은 DB 트랜잭션, `AuthCleanup` |
| `ports` | `AuthUseCases`, `PasswordHasher`, `TokenCodec` 계약 |
| `infrastructure` | BCrypt, Nimbus JWT, 웹 전용 설정·데모 계정 시드 |
| `presentation` | REST DTO·검증, RT 쿠키, Origin·AT 인터셉터, ProblemDetail 변환 |

FE의 `fe/src/domains/auth/api/auth-client.ts`가 인증 요청·메모리 세션·탭 동기화를, `api/signup-error.ts`가 가입 오류 해석을, `model/signup.ts`가 순수 입력 규칙을 담당한다. 화면은 `fe/src/app/signup/page.tsx`, `signup/email/page.tsx`, `login/page.tsx`, `auth-demo/page.tsx`에 있다. 입력 오류는 공통 `TextField`, 약관은 `BottomSheet`·`Checkbox`, 안내는 `AlertDialog`·`Toast` 등을 사용한다.

## 9. 브라우저 보안과 동시성

- AT는 모듈 메모리에만 저장한다. RT는 `fitdining_rt`라는 HttpOnly·SameSite=Strict·Path=/api/auth 쿠키다. Secure는 환경 설정을 따르며 운영 HTTPS에서는 true를 사용한다. Max-Age는 묶음 만료까지 남은 시간이다.
- 탭 안에서는 갱신 Promise를 공유한다. 가입·로그인·갱신·로그아웃은 같은 Web Lock `fitdining-auth-cookie`에 참여한다. Web Locks가 없으면 인증 요청 전에 오류를 반환하므로 HTTPS 또는 localhost의 지원 브라우저가 필요하다.
- 가입·로그인·로그아웃 성공, 갱신 401은 BroadcastChannel `fitdining-auth`로 다른 탭의 메모리 AT를 비운다. 토큰 자체를 방송하지 않는다. 같은 Origin·브라우저 프로필의 탭은 RT 쿠키를 공유한다.
- 보호 요청은 메모리 세션이 없으면 복구한다. 401과 AT 만료 type이 함께 올 때만 갱신 후 한 번 재시도하며, 그 외 401에는 자동 갱신하지 않는다.
- 로그아웃은 AT 유무·만료와 관계없이 쿠키 요청만 전송한다. 성공 시 메모리를 비우며, 미리 갱신하지 않는다.
- 다중 서버는 같은 DB와 서명 키를 사용한다. 독립된 기기·브라우저 프로필의 묶음은 서로 영향을 받지 않는다.
- `server.forward-headers-strategy: native`로 Tomcat의 `RemoteIpValve`를 사용한다. `AuthController`는 계속 `request.getRemoteAddr()`를 읽으며, 신뢰 대역에서 온 연결의 `X-Forwarded-For`·`X-Forwarded-Proto`가 사용자 주소·프로토콜에 반영된다. 신뢰 대역 밖의 연결이 보낸 전달 헤더는 무시한다.
- `server.tomcat.remoteip.internal-proxies`는 별도로 설정하지 않는다. 현재 Boot/Tomcat 기본 대역은 `192.168.0.0/16`, `172.16.0.0/12`, `169.254.0.0/16`, `fc00::/7`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `fe80::/10`, `::1/128`이다. BE 포트는 호스트에 게시되지 않고 Caddy·FE가 연결된 `net-prod`·`net-dev`는 서브넷을 지정하지 않은 Docker 사설 망이므로 이 기본 신뢰 대역을 사용한다.
- Caddy는 외부 요청의 위조 `X-Forwarded-For`를 버리고 실제 접속 IP를 전달하며 `X-Forwarded-Proto: https`를 붙인다. 기존 경계 시험은 `infra/edge/test/test-edge.sh`의 `check_proxy_headers_and_cookies`다. 이 설정은 관리 리스너의 바인딩 포트(8081)를 변경하지 않는다.
- BE 시험 위치는 `be/src/test/java/kr/co/fitdining/api/auth/NativeForwardedHeadersTests.java`와 `AuthServiceTests.java`다. 서버 소켓 없이 설정에서 만든 native valve의 신뢰·비신뢰 처리와 관리 포트 보존을 확인하고, MockMvc와 실제 DB를 연결해 로그인·가입이 사용자 주소별로 20회씩 집계되며 비신뢰 연결의 헤더 위조로 제한을 피할 수 없는지 검증한다.
- 이메일·비밀번호·JWT·키를 로그에 남기지 않는다. PostgreSQL 드라이버의 `logServerErrorDetail=false`로 제약 충돌 상세의 입력값 노출도 막는다.

## 10. 로컬 실행 방법과 환경변수

로컬 Postgres와 역할 초기화는 [로컬 스택 안내](../../infra/local/README.md)를 따른다. 기본 주소는 `jdbc:postgresql://127.0.0.1:15432/fit_dev`다. Git Bash 기준 초기화 명령은 다음과 같다.

```bash
cp infra/local/local.env.example infra/local/.env
bash infra/local/fit-local.sh up
```

BE는 `be/.env.example`을 `be/.env`로 복사한 설정을 읽는다. 환경변수를 직접 설정할 수도 있으며, 아래 값은 실제 비밀번호·보관 중인 키로 대체한다.

| 환경변수 | 필수 여부·현재 의미 |
|---|---|
| `SPRING_DATASOURCE_URL` | 선택, 위 로컬 JDBC 주소가 기본값 |
| `SPRING_DATASOURCE_USERNAME` | 선택, 웹 기본 역할은 `fit_dev_app`. migrate는 `fit_migrator` 사용 |
| `SPRING_DATASOURCE_PASSWORD` | DB 접속에 필요, 역할에 해당하는 비밀번호 |
| `JWT_SECRET` | 웹 필수, Base64 디코딩 32바이트 이상. 재시작·서버 간 같은 키 사용 |
| `AUTH_FRONTEND_ORIGIN` | 웹 필수, 경로·사용자 정보·쿼리·fragment 없는 http/https Origin. 후행 `/`도 포함하지 않음 |
| `AUTH_COOKIE_SECURE` | 웹 필수, 정확히 `true` 또는 `false` |
| `AUTH_DEMO_EMAIL`, `AUTH_DEMO_PASSWORD`, `AUTH_DEMO_NICKNAME` | 선택, 세 값을 모두 생략하거나 모두 유효하게 설정. 가입 입력 규칙 적용. 이메일 정규화 후 없을 때만 시드하며 기존 비밀번호·닉네임은 덮어쓰지 않음 |
| `AUTH_TERMS_VERSION` | 선택, 기본 `2026-10-23`, `auth.terms-version`에 연결 |
| `BE_INTERNAL_URL` | FE 개발 서버용 선택값, 기본 `http://localhost:8080` |
| `PLACE_MOCK_ENABLED` | 로컬 장소 데이터용 선택값. 앱 기본 false, BE 예제 환경 파일은 true |

PowerShell에서 `be/` 기준 마이그레이션과 웹 실행:

```powershell
$env:SPRING_DATASOURCE_URL = 'jdbc:postgresql://127.0.0.1:15432/fit_dev'
$env:SPRING_DATASOURCE_USERNAME = 'fit_migrator'
$env:SPRING_DATASOURCE_PASSWORD = '<FIT_MIGRATOR_PASSWORD>'
$env:APP_ENV = 'dev'
.\gradlew.bat bootRun --args='--spring.profiles.active=migrate'

Remove-Item Env:APP_ENV
$env:SPRING_DATASOURCE_USERNAME = 'fit_dev_app'
$env:SPRING_DATASOURCE_PASSWORD = '<FIT_DEV_APP_PASSWORD>'
$env:JWT_SECRET = '<안전하게 보관한 32바이트 이상 Base64 키>'
$env:AUTH_FRONTEND_ORIGIN = 'http://localhost:3000'
$env:AUTH_COOKIE_SECURE = 'false'
# 데모 계정은 아래 세 값을 함께 설정하거나 모두 생략한다.
$env:AUTH_DEMO_EMAIL = 'demo@example.com'
$env:AUTH_DEMO_PASSWORD = '<영문과 숫자를 포함한 8자 이상·72바이트 이하 비밀번호>'
$env:AUTH_DEMO_NICKNAME = '데모계정'
.\gradlew.bat bootRun
```

`migrate`에는 DB 설정과 `APP_ENV`가 필요하다. `migrate`는 서버 프로필이라 env 계약 검사가 `APP_ENV`를 요구하고, 로컬 DB 이름이 `fit_dev`이므로 `dev`를 준다. 웹을 로컬로 띄울 때는 `APP_ENV`를 지운다. 남아 있으면 웹도 dev 서버로 보고 서버용 env 계약을 검사한다. 웹 필수 인증 설정이 누락되거나 유효하지 않으면 기동을 거부한다. 기존 `.env`에 데모 계정 설정이 일부만 남아 있어도 기동을 거부하므로 세 설정은 함께 관리한다.

다른 터미널의 `fe/`에서 `pnpm dev`를 실행하고 `http://localhost:3000/signup` 또는 `/login`으로 접속한다. 필요하면 `$env:BE_INTERNAL_URL = 'http://localhost:8080'`으로 BE 대상을 지정한다. `/api` 프록시는 개발 서버에서만 활성화되고 운영에서는 Caddy가 전달한다. 브라우저 주소와 `AUTH_FRONTEND_ORIGIN`의 호스트·포트를 일치시키며 localhost와 127.0.0.1을 섞지 않는다.

BE 테스트는 Docker 데몬이 필요하며 외부 DB는 불필요하다. `be/`에서 `.\gradlew.bat cleanTest test`를 실행한다. 공통 Testcontainers 기반이 `pgvector/pgvector:0.8.7-pg16` DB와 시험용 인증 설정을 제공한다.

## 11. 검증 결과 요약

2026-10-23 추가 반영과 프록시 전달 헤더 처리를 포함한 최신 검증 결과다. BE 수치는 직전 실행의 테스트 XML, FE 수치는 직전 실행 기록과 재검증 문서에 근거한다. 이 문서 갱신 작업에서 테스트를 다시 실행한 결과를 뜻하지 않는다.

| 실행·검증 | 결과 |
|---|---|
| BE `be/`에서 `.\gradlew.bat cleanTest test` | 260개 통과, 실패·오류·건너뜀 0건 |
| FE `fe/`에서 `pnpm lint` | 통과 |
| `pnpm exec prettier --check .` | 통과 |
| `pnpm exec tsc --noEmit` | 통과 |
| `pnpm test` | 31개 파일, 303개 테스트 통과 |
| `pnpm build` | 통과, 가입 화면 두 경로 포함 |
| 인증 필드 검색·변경 공백 검사 | 이전 계정명 필드는 인증 코드에 남아 있지 않으며 DB 접속 계정 설정만 남음. `git diff --check` 통과 |

핵심 검증은 가입 201·토큰·쿠키, 이메일 정규화와 로그인, 이메일·닉네임별 중복 409, 동시 INSERT 경합의 한쪽 성공, 입력 규칙·약관 400, 독립된 가입 제한 429, 트랜잭션 밖 BCrypt, JWT 키 목록·용도 혼용 차단, 쿠키 로그아웃·RT 무효화, 갱신 닉네임, 인증 SQL 0건·이력 3,000행 전후 갱신 SQL 수 일정, 재사용·폐기 동시성, 보관 기간·삭제 상한이다. FE는 입력·오류 해석, 메모리 세션·Web Lock·탭 알림, 약관·중복 제출 방지·오류 표시·홈 이동 요청을 검증했다.

추가 반영에서 확인한 핵심 항목은 다음과 같다.

- 유니코드 닉네임 판정: `σ`/`ς`, 켈빈 기호 `K`(U+212A)/`k`에 대해 사전 검사와 DB `lower()` 유니크 판정의 일치를 확인했다. 닉네임 경합의 유니크 위반도 503 대신 409로 처리된다.
- 약관 문구 고정: en-US·ko-KR·fr-FR에서 누락·null·false 오류의 고정 reason을 확인했다. 약관 객체 누락 문구도 검증했다.
- 공백 정규화: 이메일·닉네임 앞뒤의 NBSP·U+3000·U+202F·U+FEFF 등 제거와 가입·로그인 정규화, 이메일 내부 유니코드 공백과 닉네임 내부 제어 문자 거부를 검증했다.
- 프록시 전달 헤더: 신뢰 대역에서 사용자 주소·HTTPS를 반영하고 로그인·가입 제한을 주소별로 집계하는지, 비신뢰 연결의 헤더 위조를 무시하는지, 관리 포트 8081과 직접 요청의 연결 정보를 보존하는지 확인했다.
- FE 표시: 409 `email-taken` type에 따른 로그인 링크 표시·이메일 수정 시 해제, 비회원 고지의 전체 문구와 각 준비 중 토스트를 검증했다. 실제 브라우저에서의 모달 위 토스트 표시·접근성 확인은 포함하지 않는다.

로컬 통합은 임시 Postgres에 migrate를 적용한 뒤 BE와 Next `pnpm dev`의 실제 `/api` 프록시를 연결했다. `/signup`, `/signup/email`, `/login`, `/`의 HTTP 200과 가입 → 약관 동의 → 홈 이동 요청·로그인 상태 → 중복 이메일 오류 → 쿠키 로그아웃 → 이메일 재로그인을 확인했다. 화면 조작은 jsdom, 라우터는 모의 객체였고 API·DB는 실제 서버였다. 실제 브라우저 렌더링·내비게이션 확인은 포함하지 않는다. 검증용 서버·컨테이너는 정리했고 기존 프로세스·컨테이너·볼륨·네트워크는 유지했다.

## 12. 남은 이슈

- 새 인증 환경변수의 배포 인프라 계약 반영이 남아 있다. 현재 코드의 웹 필수 설정과 선택 데모·약관 설정은 위 표와 같다.
- 정리 작업은 기본 10분마다 테이블당 1,000행까지 처리한다. 유입량이 이를 넘을 경우 보관 데이터가 쌓일 수 있어 운영 처리량에 맞춘 설정 확인이 필요하다.
- 약관 본문은 준비 중 안내만 제공하며, 실제 본문은 없다.
- 가입 소개 캐러셀은 정적 그림이며 레퍼런스의 모션 그래픽은 없다.
- 이메일 인증·비밀번호 찾기는 미구현이다. 소셜 로그인은 아래 2026-10-26 절에 정리되어 있다. 로그인 유지 방식 결정 배경은 [세션·소셜 로그인 검토](02_session-and-social-login-review.md)를 참고한다.

## 온보딩 가입 확장 (2026-10-26)

가입 본문의 선택 `preferences`는 계정·최초 RT와 같은 트랜잭션으로 저장한다.
로그인·가입·갱신 응답에 JWT sub와 같은 `userId`를 포함한다.
취향 코드, 조회 API와 V2 스키마는 [온보딩 문서](../onboarding/01_onboarding.md)를 따른다.

## 회원 탈퇴

본인 인증과 Origin 검사를 적용한 `DELETE /api/v1/users/{userId}`는 soft delete 후 204와 RT 쿠키 삭제를 반환한다.
취향은 즉시 삭제하고 모든 RT를 WITHDRAWN으로 폐기한다. 반복 탈퇴는 204다.
로그인·갱신은 탈퇴 계정을 거부하며 활성 계정만 이메일·닉네임 중복을 검사한다.
V2에서 `auth_users.deleted_at` 및 활성 이메일·닉네임 부분 유일 인덱스를 사용한다.
무상태 AT와 개인정보 보관 관련 남은 이슈는 온보딩 문서를 참고한다.


## 소셜 로그인 (2026-10-26)

구글·카카오·네이버를 지원한다. `(provider, provider_user_id)`로만 계정을 찾으며 이메일 계정과 연결하지 않는다. 제공자 토큰은 코드 교환과 사용자 정보 조회 중에만 사용하고 저장하지 않는다. 기존 AT 메모리·RT HttpOnly 쿠키와 절대 만료 24시간은 유지한다. 소셜 사용자의 `GET /api/auth/me` 응답에는 `email`이 없다.

1. `/login`, `/signup`의 전체 페이지 링크가 `GET /api/auth/oauth/{provider}?from=login|signup`을 호출한다.
2. BE가 state와 PKCE를 만들고 서명 쿠키를 설정한 뒤 제공자 인가 화면으로 302 이동한다. 구글 scope는 `openid`, 카카오·네이버는 별도 scope를 요청하지 않는다. 콘솔 동의 항목도 최소로 설정한다.
3. `GET /api/auth/oauth/{provider}/callback`에서 서명·만료·제공자·state를 확인하고 상태 쿠키를 삭제한다. 구글·카카오는 S256 verifier를 토큰 교환에 전송한다. 네이버는 state를 전송한다. HTTP 연결 3초·읽기 5초 제한을 둔다.
4. 기존 활성 계정은 RT를 발급하고 `/`로 이동한다. 이후 인증 요청의 `restore()`가 AT를 얻는다. 신규 계정은 가입 대기 쿠키를 받고 `/signup/social`로 이동한다.
5. 자동으로 열린 약관 시트에서 필수 약관 3개에 동의한 뒤 `POST /api/auth/social/signup`을 호출한다. 성공은 201 `TokenResponse`, RT 설정, 가입 대기 쿠키 삭제이며 FE는 `/`로 이동한다. 닉네임은 서버가 무작위로 배정한다. 동일 제공자 식별자의 동시 가입은 DB 트랜잭션 advisory lock으로 직렬화하여 기존 계정으로 로그인한다.

실패 콜백은 항상 `/login?error=social` 또는 `/signup?error=social`로 302 이동한다. 신뢰할 수 있는 출발 화면이 없으면 `/login`이다. FE는 실패 토스트를 한 번 띄우고 error 쿼리를 제거한다. 코드·토큰·state·제공자 응답은 로그에 남기지 않는다. 가입 API는 쿠키 인증 실패 401, 약관·취향 검증 400, Origin 불일치 403, 시도 제한 429다. 콜백은 `login`, 가입은 `signup` 시도 제한(15분 20회)을 사용한다. 새 경로에도 `Cache-Control: no-store`가 적용된다.

소셜 가입 닉네임 배정 (2026-10-29): 신규 계정은 `/signup/social`에서 바로 열린 `SignupTerms` 시트로 필수 약관에 동의한다. 시트를 닫으면 “약관 동의하고 시작하기” 버튼으로 다시 연다. `POST /api/auth/social/signup` 본문은 `agreements`와 선택 `preferences`만 받으며 구 클라이언트의 `nickname`은 무시한다. 서버는 `{행동}하는 {캐릭터}` 형식의 랜덤 닉네임을 배정한다. 닉네임 사전 중복 또는 유일 인덱스 경합 시 별도 트랜잭션에서 기본 조합 5회, 1000~9999 접미사 조합 5회로 총 10회 시도한다. 소진 시 일반 서버 오류를 반환하며 닉네임 중복 409는 반환하지 않는다. 성공 시 토큰·쿠키를 발급하고 `/`로 이동하며 배정 닉네임은 따로 안내하지 않는다. 이메일 가입의 닉네임 입력은 유지한다.

| 쿠키 | 내용 | 속성 | 수명 |
|---|---|---|---|
| `fitdining_oauth` | provider, state, verifier, from을 서명한 `oauth_state` JWT | HttpOnly, Secure=`AUTH_COOKIE_SECURE`, SameSite=Lax, Path=/api/auth/oauth | 10분, 콜백 즉시 삭제 |
| `fitdining_social` | provider, providerUserId를 서명한 `social_signup` JWT | HttpOnly, Secure=`AUTH_COOKIE_SECURE`, SameSite=Strict, Path=/api/auth/social | 10분, 가입 성공 시 삭제 |
| `fitdining_rt` | 기존 refresh JWT | 기존 속성 유지 | 기존 절대 만료 24시간 |

`V3__social_login.sql`은 `auth_users.email/password_hash`를 함께 NULL일 수 있게 하고 한쪽만 NULL인 경우는 CHECK로 거부한다. `auth_social_accounts`의 복합 PK는 `(provider, provider_user_id)`, `user_id`는 UNIQUE FK다. 기존 닉네임·이메일 제약은 유지한다. 웹에서 마이그레이션하지 않으며 배포 시 `migrate` 프로필을 먼저 실행한다.

선택 env는 `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET`, `AUTH_KAKAO_CLIENT_ID`, `AUTH_KAKAO_CLIENT_SECRET`, `AUTH_NAVER_CLIENT_ID`, `AUTH_NAVER_CLIENT_SECRET`다. 제공자마다 둘 다 비어 있으면 비활성이고 하나만 있으면 기동을 거부한다. 기본 자격 증명은 없다. `JWT_SECRET`, `AUTH_FRONTEND_ORIGIN`, `AUTH_COOKIE_SECURE`는 기존 값을 사용한다. 인프라 담당자가 env 계약과 서버 배포를 처리해야 한다.

각 제공자 콘솔에 다음 콜백을 등록한다(DEV_HOST/PROD_HOST는 해당 배포 호스트로 치환).

| 환경 | 구글 | 카카오 | 네이버 |
|---|---|---|---|
| local | `http://localhost:3000/api/auth/oauth/google/callback` | `http://localhost:3000/api/auth/oauth/kakao/callback` | `http://localhost:3000/api/auth/oauth/naver/callback` |
| dev | `https://<DEV_HOST>/api/auth/oauth/google/callback` | `https://<DEV_HOST>/api/auth/oauth/kakao/callback` | `https://<DEV_HOST>/api/auth/oauth/naver/callback` |
| prod | `https://<PROD_HOST>/api/auth/oauth/google/callback` | `https://<PROD_HOST>/api/auth/oauth/kakao/callback` | `https://<PROD_HOST>/api/auth/oauth/naver/callback` |

공식 문서 확인(2026-10-26): [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Google UserInfo](https://developers.google.com/identity/openid-connect/reference), [카카오 REST API](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [네이버 로그인 API](https://developers.naver.com/docs/login/api/api.md), [네이버 개발 가이드](https://developers.naver.com/docs/login/devguide/devguide.md). 엔드포인트는 범위 문서와 동일하다. 카카오 공식 discovery 설명의 `code_challenge_methods_supported`는 `S256`이므로 PKCE를 적용한다. 로그인에 OIDC ID 토큰을 사용하지 않으며 카카오는 `/v2/user/me`의 숫자 `id`만 추출한다. 네이버는 `response.id`만 추출한다.

운영 전에는 제공자 키 발급·콜백 등록 후 실제 로그인을 확인해야 한다. 네이버 검수 전에는 등록한 테스터 범위로 제한될 수 있다. 네이버 버튼은 브랜드 색과 흰 N을 사용했으며 디자인 확인이 남아 있다.

네이버 버튼 색은 범위 문서의 `#03C75A` 대신 [현행 공식 버튼 가이드](https://developers.naver.com/docs/login/bi/bi.md)의 변경된 지정색 `#03A94D`를 적용했다. 흰 N 로고와 8px 간격을 사용한다.

소셜 자격 증명은 데모 계정 설정처럼 `AUTH_*_CLIENT_ID`와 `AUTH_*_CLIENT_SECRET` env를 직접 읽는다. `application.yml`에 별도의 `auth.social.*` 설정은 두지 않는다. 카카오 콘솔의 클라이언트 시크릿은 ON으로 둔다.

소셜 통합 (2026-10-27): V1 → V2(취향·soft delete) → V3 순서로 적용한다. V2의 활성 이메일·닉네임 부분 유일 인덱스와 deleted_at을 유지한다. 탈퇴 트랜잭션에서 auth_social_accounts 연결과 취향을 삭제하고 RT를 폐기한다. 같은 소셜 식별자로 돌아오면 /signup/social에서 새 계정으로 가입하며 탈퇴 계정의 닉네임도 다시 사용할 수 있다. 남아 있는 탈퇴 계정 연결은 기존 activeUser 판정으로 로그인을 거부한다.

POST /api/auth/social/signup은 이메일 가입과 같은 선택 preferences 타입·검증·저장을 사용한다. FE는 sessionStorage의 온보딩 답변을 읽어 전달하고 성공 후에만 삭제한다. 취향 생략 시 행을 만들지 않는다. 소셜 가입 응답도 userId를 포함하는 TokenResponse이며 기존 계정 콜백은 JSON 대신 RT 쿠키와 홈(/) 리다이렉트를 반환한다.

## 인증 간소 모드 (local·dev)

`AUTH_SIMPLE_ENABLED=true`로 켠다(기본 false). prod는 간소 모드와 값이 있는 `AUTH_DEV_KEY`를 거부한다.
local은 APP_ENV가 없고 dev/prod/migrate 프로필도 없는 경우다. local에서만 Origin 검사를 생략하고 JWT_SECRET이 비면 고정 개발 서명 키를 쓴다.
dev 서버는 실제 JWT_SECRET, Origin 검사, AUTH_DEV_KEY와 AUTH_DEMO_PASSWORD가 필수다.

이메일·소셜 요청 제한과 시도 기록을 생략하고 BCrypt cost 4를 사용한다. 모르는 계정의 dummy hash를 만들거나 비교하지 않는다.
AT는 12시간, 세션은 30일이다. 사용한 RT는 만료 전까지 같은 family로 재발급할 수 있고 재사용 보안 이벤트를 남기지 않는다. logout으로 폐기한 RT는 거부한다.
간소 모드에서 받은 RT는 Strict로 바꿔도 만료(30일)까지 유효하다. 확인하려면 로그아웃 후 다시 로그인한다.
데모 기본 계정은 `dev@fitdining.local`, 닉네임 `개발자`, local 기본 비밀번호는 `fitdining-dev1`이다. AUTH_DEMO_EMAIL/PASSWORD/NICKNAME으로 덮어쓴다.

`POST /api/auth/dev/token`은 간소 모드에서만 등록된다. 선택 본문 `{"email":"existing@example.com"}`이 없으면 데모 계정을 쓴다.
AUTH_DEV_KEY를 X-Dev-Key 헤더에 전달한다(local에서 키 미설정 시 생략 가능). 이 경로는 Origin 검사에서 제외된다.
성공 시 일반 TokenResponse와 기존 정책의 RT 쿠키를 반환하며 키 오류는 403, 없는 계정은 404다.
발급한 AT를 `Authorization: Bearer <AT>`로 `/api/auth/me`와 보호 API에 사용한다.

prod 동작 확인 시 dev에서 AUTH_SIMPLE_ENABLED=false로 재시작하여 21번째 시도 429, RT 재사용 시 family 폐기, 30분 AT 수명과 Origin 검사를 확인한다.
