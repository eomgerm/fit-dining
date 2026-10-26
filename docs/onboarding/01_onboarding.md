# 온보딩 API

## 가입과 취향 조회

`POST /api/auth/signup`은 선택 `preferences`를 받는다. 없거나 null이면 취향 행 없이 가입한다.
계정, 취향, 최초 RT는 같은 트랜잭션으로 저장한다. 로그인·가입·갱신 응답의 `userId`는 JWT `sub`와 같다.

`GET /api/v1/users/{userId}/preferences`는 Bearer AT가 필요하다. 본인만 200으로 조회하며 다른 id는 403,
취향 없음은 404, AT 없음·만료는 기존 인증 type을 유지하는 401이다.

- mood: QUIET, LIVELY (선택)
- priorities: SPACIOUS, SHORT_WAIT, GENEROUS_PORTION, PRETTY_SPACE, VIEW_OUTDOOR, COZY, VALUE
- purposes: CONVERSATION, SOLO, DATE, GATHERING, WORK_STUDY
- tastes: `{ polarity: LIKE | DISLIKE, label }`, 최대 10개, 라벨은 공백 제거 후 1~20자, 제어 문자 거부

배열 중복을 제거하며 잘못된 값은 400 `errors[].field`의 `preferences.*`로 안내한다.
취향 내용은 로그에 남기지 않는다.

## 스키마

V1은 유지한다. V2는 `auth_users.deleted_at`과 활성 이메일·소문자 닉네임 부분 유일 인덱스를 추가한다.
`user_preferences`는 `user_id text PK/FK ON DELETE CASCADE`, `mood text NULL`, `priorities text[]`,
`purposes text[]`, `tastes jsonb`, `created_at/updated_at timestamptz`다.
배열·JSONB는 Hibernate 네이티브 매핑으로 저장하며 scope의 스키마를 유지한다.
