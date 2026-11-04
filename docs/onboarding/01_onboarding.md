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

## 취향 분석

공개 `POST /api/v1/onboarding/taste-analysis`는 `{ "text": "..." }`를 받아 `{ "tastes": [...] }`를 반환한다.
Origin은 `AUTH_FRONTEND_ORIGIN`과 같아야 한다. 공백 제거 후 1~100자이며 실패·3초 타임아웃은 일반 문구의 503이다.
주소(`getRemoteAddr`)별 15분에 30회, 초과는 429다. 고정 창과 주소만 메모리에 저장한다.

`fitdining.onboarding.taste-analyzer` 기본값은 `mock`이다. `TasteAnalyzer` 구현을 Bean으로 등록하고
설정값별 조건으로 선택한다. Mock은 사전·부정어로 칩을 만들고 사전에 없으면 앞 20자로 LIKE 칩을 만든다.
`#실패`는 Mock에서만 503을 재현한다. 입력·결과는 로깅하지 않는다.

실제 AI 연결, 서킷브레이커·예산·킬스위치 정책은 design.md 11절 기준으로 후속 합의한다.
속도 제한은 인스턴스마다 별도로 센다. 분석 실행은 4개 스레드와 16개 대기 슬롯으로 제한한다.

## 탈퇴

`DELETE /api/v1/users/{userId}`는 본인 Bearer AT와 일치하는 Origin을 요구한다.
한 트랜잭션으로 `deleted_at` 설정, 취향 행 삭제, 모든 RT의 `WITHDRAWN` 폐기를 처리한다.
응답은 204, 기존 로그아웃과 같은 `/api/auth` RT 쿠키를 삭제한다. 같은 AT로 반복해도 204다.
활성 계정만 로그인·중복 검사 대상이며 이메일·닉네임 재사용 가입은 새 userId를 발급한다.
로그인·갱신·탈퇴는 계정 행 잠금으로 직렬화해 탈퇴 직후 RT가 새로 생기는 경합을 막는다.

AT는 무상태여서 최대 30분까지 서명 검증을 통과한다. 새 사용자 API는 DB를 읽어 404/204로 처리하지만,
DB 조회가 없는 다른 보호 API의 탈퇴 사용자 차단은 후속 과제다.
이메일·닉네임·비밀번호 해시는 soft delete 행에 남는다. 보관 기간·영구 삭제 작업과 개인정보 처리방침 확인은 범위 밖이다.

## FE 흐름

`/`는 정적 HTML 200이며 마운트 후 로그인 복구와 `fd.guest.v1=1` 표시로 홈을 판정한다.
판정 중에는 빈 바탕을 보여주며 3초가 지나면 로그인 아님으로 본다. 복구 실패도 동일하다.
처음 방문은 온보딩을 거쳐 `/signup` → `/signup/email`로 이동한다.
완료 답변은 sessionStorage `fd.onboarding.answers.v1`로 전달하고 가입 요청의 `preferences`에 담는다.
잘못된 저장값은 버리며 저장소 예외가 흐름을 막지 않는다. 가입 성공 시 답변을 지운다.
1~3단계 건너뛰기는 해당 단계까지의 선택만, 분석 없이 시작은 칩 없이 전달한다.

가입 없이 시작은 답변을 지우고 localStorage에는 비회원 표시만 남긴다. 취향 내용은 남기지 않는다.
로그인 성공·기존 로그인 복구의 목적지는 `/`이다.
분석은 공통 API 클라이언트를 사용하며 모든 오류(429 포함)는 실패 상태로 보여준다.
분석 덮개는 성공·실패 모두 최소 600ms 유지한다. 검색에 취향을 전달하는 연동은 이번 범위 밖이다.

## 남은 이슈: 실제 분석기 연결 시 확인

- 시도 제한 표는 인스턴스별 메모리에 최대 10,000개 주소를 보관한다. 15분 창 안에 표가 가득 차면
  새 주소는 첫 요청부터 429를 받는다. 기존 주소는 자신의 30회 제한을 적용받으며, 만료된 창이 제거되면
  새 주소를 다시 받는다. 분산 주소로 정상 사용자의 요청이 막힐 수 있으므로 실제 분석기 연결 시
  공유 저장소 기반 제한과 주소 수 상한 정책을 함께 검토한다.
- 서비스는 현재 `TasteAnalyzer` 결과가 포트 계약을 지키는지 검사하지 않는다. 계약은 비어 있지 않은
  최대 10개 칩과 1~20자 라벨이며, 실제 분석기가 이를 어기면 FE에서 답변을 버리거나 가입이 400으로
  실패할 수 있다. 실제 분석기 연결 시 서비스에서 결과 계약을 검증하고 위반은 일반 문구의 503으로
  처리한다. 이번 변경에서는 시도 제한과 결과 검증 동작을 바꾸지 않는다.
