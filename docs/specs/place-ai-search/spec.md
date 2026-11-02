# 추천 검색을 AI 검색 API로 (place-ai-search)

Status: approved
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

DB 모드(`PLACE_MOCK_ENABLED`가 꺼진 환경)의 추천 검색(`POST /api/v1/places/search`)은 문장에 "근처"가 들어 있으면 카탈로그 전체를 점수 없이 주고, 그 밖의 문장은 모두 503이다(place-lookup-db#D-13). AI 파트의 검색 API(`POST /v1/search`)가 요청 해석, 후보 추출, 정렬, 카드의 AI 필드를 만들 수 있게 됐지만 BE는 부르지 않는다. 그래서 운영에서는 자연어 검색을 쓸 수 없고, 홈 카드에도 점수와 라벨이 없다.

이번 반복(Jira S15P31A302-133)은 BE와 FE를 함께 한다(D-1). DB 모드 엔진의 추천 검색이 AI 검색 API를 부르고, AI가 준 카드에 장소 정보와 영업 상태를 붙여 돌려준다. AI가 실패하면 오류 화면 대신 키워드나 카탈로그로 만든 대체 결과와 `X-Fallback` 헤더를 준다. 검색은 로그인을 선택으로 받아, 회원이면 회원 id를, 비회원이면 기기의 온보딩 답을 AI에 넘긴다. AI가 장소를 읽는 뷰를 BE 마이그레이션으로 만든다(D-15). FE는 검색 요청에 토큰이나 답을 싣고 대체 결과를 알린다(D-16). Mock 엔진은 바꾸지 않는다.

## Assumptions

1. local과 dev는 `PLACE_MOCK_ENABLED=true`라 계속 Mock 엔진이 응답한다. AI 연동은 서버에 장소 DB가 적재된 뒤 스위치를 끄면 보이고, 그 전까지는 가짜 AI 서버를 쓰는 테스트로 확인한다(D-1, D-13).
2. AI 검색 API는 `ai/docs/comparison/api.md`(초안 v0.5)의 모양을 따른다. 비회원 취향 `tasteProfile`은 온보딩 답 모양이고, 모양이 틀리면 AI는 취향 없이 정렬하고 `TASTE_INVALID`를 담는다(D-4). 요청에 모르는 속성이 있으면 400이고, 응답의 `items`는 `score` 내림차순이며 일반 20개·근처 100개까지다(D-2).
3. AI 주소 설정 `fitdining.ai.base-url`(환경변수 `MODAL_BASE_URL`, 코드 기본값 `http://localhost:8000`)과 `fitdining.ai.modal-key`·`modal-secret`은 온보딩 취향 연결(S15P31A302-129)이 이미 쓰고 있다. 환경변수를 빈 문자열로 주면 주소가 빈다(D-3).
4. 회원 취향(`user_preferences.features`)은 -129가 가입 때 저장하고 AI가 DB에서 직접 읽는다. 검색 쪽 BE는 회원 id만 넘긴다(D-12).
5. 액세스 토큰 확인(`AuthUseCases#authenticate`)은 DB를 보지 않고 서명과 만료만 본다. 만료면 `type`이 `urn:fitdining:auth:access-token-expired`인 `AuthFailure`(401)를 던진다(D-4).
6. `migrate` 프로필은 웹 서버 없이 뜨고 인증 빈을 만들지 않는다. 지금 `PlaceController`는 이 프로필에서도 만들어진다(D-4).
7. FE는 지금 검색 요청에 `preferences`와 토큰을 싣지 않는다(`fe/src/domains/place/model/search-request.ts`). 비회원 온보딩 답은 기기에 가입과 같은 모양으로 저장돼 있고, 읽을 때 지금 선택지에 맞지 않으면 지운다(`fe/src/domains/onboarding/model/storage.ts#readAnswers`)(D-4, D-16).
8. FE의 API 요청은 기본 10초에 끊기고 요청마다 바꿀 수 있다(`fe/src/shared/api/client.ts`의 `timeoutMs`). 대체 결과가 화면에 닿으려면 BE가 FE보다 먼저 응답해야 한다(D-3).
9. AI DB 계정은 `ai_place_search`와 `user_preferences`만 읽고, 배포는 마이그레이션 뒤에 그 권한을 다시 맞춘다(`infra/data/grant-ai-read.sh`, `infra/deploy/deploy.sh`). 서버 dev DB에는 아직 이 뷰가 없다(D-15).
10. FE의 도메인끼리는 서로 import하지 않고 app 계층이 잇는다(`fe/eslint.config.mjs`). place 도메인은 auth와 onboarding을 import하지 않는다(D-16).

## Usage

DB 모드 BE로 확인한다. AI 성공 경로(1, 2)는 장소 id가 맞는 AI 서버가 있어야 보이고(D-13), 그 전에는 대체 결과(⑧)가 온다. 4는 언제든 확인할 수 있다.

```bash
# be/.env: PLACE_MOCK_ENABLED=false, MODAL_BASE_URL=http://localhost:8000 (AI 서버 주소)
# 1) 비회원 홈 화면
curl -i -X POST http://localhost:8080/api/v1/places/search -H "Content-Type: application/json" \
  -d '{"query":"근처 맛집"}'
# 2) 회원의 자연어 검색. AI 요청에 회원 id가 실린다
curl -i -X POST http://localhost:8080/api/v1/places/search -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AT" -d '{"query":"역삼역 조용하게 대화하기 좋은 식당"}'
# 3) 비회원이 기기에 저장한 온보딩 답변을 싣는다. AI 요청의 tasteProfile로 넘어간다
curl -i -X POST http://localhost:8080/api/v1/places/search -H "Content-Type: application/json" \
  -d '{"query":"데이트하기 좋은 카페","preferences":{"mood":"QUIET","purposes":["DATE"]}}'
# 4) AI를 끈 채(MODAL_BASE_URL= 또는 닿지 않는 주소)로 같은 요청: 200과 X-Fallback: AI_UNAVAILABLE
```

## Acceptance criteria

기준은 따로 적지 않으면 DB 모드(`place.mock.enabled`가 false)를 말한다. Mock 모드는 "바뀌지 않는 것"의 마지막 기준이다.

AI 호출

- [x] AC-1: `cursor`가 없는 모든 추천 검색 요청은 홈의 "근처 맛집"을 포함해 요청마다 AI `POST {base-url}/v1/search`를 부른다(차단 중과 주소가 빈 경우는 AC-13, AC-7). 이전 요청의 결과를 다시 쓰지 않는다. "근처"가 들어 있다는 이유로 AI 없이 응답하지 않는다. (D-2, D-8, D-9)
- [x] AC-2: AI 요청 본문은 [AI 요청](#ai-요청) 표의 속성만 담는다. `query`는 받은 값 그대로, `previousConditions`는 받은 값 그대로이되 없거나 빈 객체(`{}`)면 빠지고, `mapBounds`는 [AI 요청](#ai-요청) 표의 규칙대로, `userId`와 `tasteProfile`은 AC-3의 경우에만 있다. `cursor`와 `preferences`는 없다. `fitdining.ai.modal-key`·`modal-secret`이 비어 있지 않으면 각각 `Modal-Key`·`Modal-Secret` 헤더로 실린다. (D-2, D-3, D-4, D-5)
- [x] AC-3: `Authorization: Bearer <AT>`가 유효하면 AI 요청의 `userId`는 그 토큰의 사용자 id이고, 본문에 `preferences`가 있어도 AI에 보내지 않는다(`tasteProfile` 없음). `Authorization` 헤더가 없으면 비회원이고 AI 요청에 `userId`가 없다. 비회원 요청에 `preferences`가 있으면 AI 요청의 `tasteProfile`은 그 `preferences`를 검증과 정리(AC-18)를 거친 값 그대로 담은 것이다. 속성 이름과 값은 같고, null인 `mood`와 칩의 null인 `code`는 빠지며, `priorities`·`purposes`·`tastes`는 비어 있어도 `[]`로 싣는다. `preferences`가 없으면 `tasteProfile`도 없다. (D-4, D-12)
- [x] AC-4: `cursor`가 null이 아닌(빈 문자열 포함) 요청은 AI를 부르지 않고 400이다. `cursor`가 없거나 null이면 커서 없음이다. 이 판정은 DB 모드 엔진이 인증 뒤에 하므로 토큰이 무효면 401이 먼저이고, Mock 모드에는 적용되지 않는다. (D-10)

AI 결과를 카드로

- [x] AC-5: AI 응답의 카드는 AI 응답 순서 그대로 나오고, 같은 `placeId`가 다시 오면 처음 카드만 남는다. 각 카드의 `place`는 카탈로그의 그 `placeId` 장소 요약, `openStatus`는 요청을 처리하는 동안의 서울 시각 기준 영업 상태이고, `score`·`labels`·`reasons`·`scoreItems`는 AI 값 그대로이고 AI가 뺀 `labels`·`reasons`·`scoreItems`는 빈 목록, 뺀 `score`는 없음이며, `caution`은 없고, `reasons`의 `quote`·`quoteSource`는 AI가 주면 그대로 옮긴다. 카탈로그에 없는 `placeId`의 카드는 빠지고(다른 장소로 채우지 않는다) 빠진 id 수(중복을 지운 뒤)가 WARN 로그에 남는다. `totalCount`는 남은 카드 수이고 `nextCursor`는 없다. `conditions`·`nearby`·`changeSummary`·`emptyReason`은 AI 값 그대로다. AI가 `conditions`를 빼면 `{}`, `nearby`를 빼면 false이고, `changeSummary`·`emptyReason`을 빼면 응답에서도 빠진다. AI 응답의 모르는 속성은 어느 깊이에서든 무시하고 정상 응답한다. (D-5, D-11)
- [x] AC-6: AI 응답의 `fallbacks`가 비어 있지 않으면 응답에 `X-Fallback` 헤더가 붙고 값은 `fallbacks`의 원소를 받은 순서대로, 고치지 않고 쉼표로 이은 문자열(`PREVIOUS_INVALID,TASTE_INVALID`)이다. 비었거나 없으면 헤더가 없다. 대체로 끝난 응답의 헤더는 AC-7이다. (D-7)

AI 실패와 대체

- [x] AC-7: 아래 경우 모두 응답은 200, [대체 결과](#대체-결과) 모양이고 `X-Fallback: AI_UNAVAILABLE`이 붙는다. ① `fitdining.ai.base-url`이 비었거나 공백뿐(부르기 전에 판정) ② 연결 실패(이름 풀이 실패, 연결 거부·끊김, TLS 실패, 200 헤더 뒤 본문을 읽다 끊김 등 시간 초과가 아닌 I/O 오류) ③ 재시도까지 합쳐 12초 안에 응답이 없음 ④ 5xx(`BUSY` 제외) ⑤ `503 BUSY`가 재시도 뒤에도 옴 ⑥ 200이 아닌 그 밖의 상태(4xx, 3xx, 200 외 2xx) ⑦ 200이지만 [읽을 수 없는 응답](#ai-응답), 또는 AI 호출 중 난 I/O 오류가 아닌 그 밖의 예외(형식이 잘못된 주소 포함. 이 경우에도 기동은 실패하지 않는다) ⑧ 카드가 하나 이상인데 모든 `placeId`가 카탈로그에 없음 ⑨ 차단 중. ⑧에서 AI 응답에 `fallbacks`가 있어도 헤더 값은 `AI_UNAVAILABLE` 하나다. AC-15의 DB 오류 말고는 어느 경우에도 5xx를 주지 않는다. (D-3, D-6, D-7, D-11)
- [x] AC-8: AI가 `503 BUSY`(상태 503이고 ProblemDetail `code`가 `BUSY`)를 주면 BE는 12초 예산 안에서 한 번만 다시 부른다. 다시 부르기 전에 기다릴지(`Retry-After: 1`)는 재량이지만, 기다림과 재시도 모두 예산 안이어야 한다. 재시도는 남은 예산을 제한 시간으로 하고, 그 안에 응답이 없으면 ③이다. 남은 예산이 없어 재시도하지 못하면 ⑤다. 재시도가 성공하면 AC-5대로 정상 응답한다. `BUSY`가 아닌 503과 다른 실패는 다시 부르지 않는다. (D-3)
- [x] AC-9: 홈 요청(`query`의 앞뒤 공백을 지운 값이 정확히 "근처 맛집"이고 `previousConditions`가 없거나 `{}`인 요청. `mapBounds`는 있어도 된다)의 대체 결과는 카탈로그 전체 카드이고 `nearby: true`다. (D-6)
- [x] AC-10: 홈 요청이 아닌 요청의 대체 결과는 `query`의 키워드 검색 결과를 순위 순으로 카드로 만든 것이고 `nearby: false`다. 순서는 키워드 검색 히트 전체 → 히트의 좌표로 `mapBounds` 거르기 → 앞 20곳 → 카탈로그에서 id로 읽기이고, 카탈로그에서 읽히지 않는 장소는 빠진다(그래서 20곳보다 적을 수 있다). (D-6)
- [x] AC-11: 대체 결과에서 `mapBounds`가 있으면 위도·경도가 그 영역 안(경계 포함)인 장소만 남는다. 네 값 중 빈 값은 그쪽을 제한하지 않는다. 홈 요청도 `mapBounds`가 있으면 영역 안만 남는다. (D-6)
- [x] AC-12: 대체 결과의 카드에는 `score`가 없고 `labels`·`reasons`·`scoreItems`는 빈 목록이다. `conditions`는 받은 `previousConditions`(없거나 `{}`면 `{}`), `nextCursor`·`changeSummary`는 없고, `totalCount`는 카드 수다. 남은 카드가 없으면 `items: []`와 `emptyReason`(원인 "지금은 가게 이름, 메뉴, 업종, 역 이름으로만 찾을 수 있어요", 제안 "가게 이름이나 메뉴 이름으로 다시 검색해 보세요")이 온다. (D-6)
- [x] AC-13: 차단기 실패(②~⑤: 연결 실패, 시간 초과, 5xx, 재시도 뒤 `BUSY`)마다 연속 실패 수가 1 늘고, 그 결과 3 이상이면 그때부터 30초 동안(차단 중. 차단 중에 끝난 차단기 실패도 끝 시각을 그때부터 30초 뒤로 다시 잡는다) 오는 검색은 AI를 부르지 않고 바로 대체한다. 30초가 지난 뒤 오는 요청은 AI를 부르고, 차단기 실패면 다시 30초 동안 차단한다. 읽을 수 있는 200 응답은 언제 끝났든(차단 전에 시작해 차단 중에 끝난 요청 포함) 연속 실패 수를 0으로 만들고 차단을 푼다. ⑥과 ⑦은 대체하지만 연속 실패 수와 차단을 바꾸지 않는다. 읽을 수 있는 200 응답(카드 id가 전부 카탈로그에 없는 응답 포함)은 성공이다. (D-3)
- [x] AC-14: `fitdining.ai.base-url`이 빈 값이거나 AI 서버가 닿지 않아도 BE는 정상으로 뜨고 readiness는 DB만 본다. (D-3)
- [x] AC-15: 카탈로그 DB를 읽지 못하면(카드 조립이나 대체 중) 지금처럼 503 ProblemDetail이다. DB 장애는 AI 장애로 대체하지 않는다(엔진이 DB 오류나 키워드 검색의 503 예외를 삼켜 대체 결과로 바꾸지 않는다. 대체로 바꾸는 것은 AI 호출에서 난 실패뿐이다). (D-6)
- [x] AC-16: 검색이 ①~⑦로 대체되면 요청마다 실패 종류(예외 클래스나 상태 코드)가 로그에 남는다. ⑥, ⑦, ① 주소 없음은 ERROR, ②~⑤는 WARN이다. ⑧은 AC-5의 빠진 id WARN 로그로 갈음한다. ⑨ 차단 중에 대체한 요청은 요청마다 남기지 않는다. 차단을 시작하거나 다시 시작할 때마다(AC-13) WARN을, 차단 중이거나 연속 실패 수가 3 이상일 때 성공해 차단이 풀리면 INFO를 남긴다. 읽을 수 있는 AI 응답을 받은 검색(⑧ 포함)마다 `interpretedBy`, `rankedBy`, `models`가 INFO 로그에 남는다. (D-3, D-5)

취향과 인증

- [x] AC-17: `Authorization` 헤더가 있는데(빈 값 포함) `Bearer `로 시작하지 않거나 토큰이 유효하지 않으면 401 ProblemDetail이고 AI를 부르지 않는다. 만료된 토큰이면 `type`이 `urn:fitdining:auth:access-token-expired`다. 비회원으로 계속하지 않는다. (D-4)
- [x] AC-18: `preferences`는 가입의 `preferences`와 같은 모양(`mood`, `priorities`, `purposes`, `tastes`)과 검증을 따른다. 검증에 맞지 않거나 모르는 속성이 있으면 회원이든 비회원이든 400이다. 예전 모양(문자열 목록)은 Mock 모드에서도 400이다. (D-4)
- [x] AC-19: `migrate` 프로필이 인증 환경 변수 없이 뜨고 끝난다(인증을 붙인 뒤에도). (D-4)

절대 일어나면 안 되는 일

- [x] AC-20: 어떤 요청이든(성공, 대체 ①~⑨, 400, 401, 503) 처리한 뒤 BE 로그 출력에 검색 문장(`query`), `previousConditions`, `preferences`의 값, AI 요청·응답 본문(본문 조각을 담을 수 있는 HTTP·JSON 예외 메시지 포함)이 나타나지 않는다. 예외는 AC-16이 남기라는 `interpretedBy`, `rankedBy`, `models` 값뿐이다. (D-11)
- [x] AC-21: 어떤 요청 본문과 헤더 조합이든 AI 요청의 `userId`는 검증된 토큰의 사용자 id이거나 없다. 본문에 `userId`를 넣으면 400이다. (D-11)

바뀌지 않는 것

- [x] AC-22: Mock 모드의 추천 검색은 AI를 부르지 않고 지금과 같은 결과와 페이지 나눔(`cursor`, `nextCursor`, 잘못된 커서 400)을 주며 `X-Fallback`이 없다. 새 모양의 `preferences`는 받기만 하고 결과에 반영하지 않는다. 인증 규칙(AC-17)과 `preferences` 검증(AC-18)은 Mock 모드에도 같다. Mock 엔진의 동작은 그대로이고, 공용 엔진 인터페이스가 바뀌어 생기는 코드 변경은 허용한다. (D-1, D-4, D-10)
- [x] AC-23: 자동완성(`GET /places/suggest`)과 상세(`GET /places/{id}`)는 DB 모드에서도 지금과 같고 AI를 부르지 않으며, `Authorization` 헤더를 보지 않는다(잘못된 토큰이어도 401이 아니다). (D-2, D-4)

AI가 읽는 뷰

- [x] AC-24: BE 마이그레이션을 끝까지 적용한 DB에 뷰 `ai_place_search`가 있고(새 마이그레이션 하나로 만든다), 프로필이 있는 장소마다 한 행이 [AI가 읽는 뷰](#ai가-읽는-뷰)의 컬럼과 값을 갖는다. 프로필이 없는 장소는 행이 없다. 편의시설은 표의 이름이 있을 때만 그 코드가 `true`이고 그 밖의 코드는 키가 없다(`false`가 아니다). (D-15)

FE 검색 요청

- [x] AC-25: FE의 추천 검색 요청(`POST /api/v1/places/search`, 홈 주변 카드와 다음 페이지 포함)은 15초가 지나야 시간 초과다. 그 밖의 FE API 요청은 지금처럼 10초다. (D-3, D-16)
- [x] AC-26: FE는 추천 검색 요청(홈 주변 카드, 첫 검색, 후속 검색, 다음 페이지)을 보낼 때마다 로그인 세션을 확인한다(검색 기록 저장과 같은 확인. 확인되지 않았으면 복원을 3초까지 기다린다). 확인된 회원이면 `Authorization: Bearer <그 세션의 AT>`를 싣고 `preferences`는 싣지 않으며, 만료로 401이 오면 토큰을 한 번 갱신해 다시 보낸다. 갱신하고도 실패하거나 보내는 사이 세션이 바뀌면 그 요청은 지금의 검색 실패와 같이 끝난다. 확인된 비회원이면 `Authorization` 없이, 기기에 저장된 온보딩 답이 있고 모든 칩의 `code`가 없거나 BE 규칙(`^[A-Z][A-Z0-9_]{0,63}$`)에 맞으면 그 값을 `preferences`로 싣고, 맞지 않으면 `preferences` 없이 보낸다. 확인하지 못했으면 둘 다 싣지 않는다. 검색 기록에 저장되는 요청(검색 thread의 turn)과 화면 상태의 요청에는 `preferences`가 들어가지 않는다(FE의 검색 요청 타입에 `preferences`가 없다). (D-4, D-16)
- [x] AC-27: 첫 페이지 응답의 `X-Fallback` 값(쉼표로 나눈 원소)에 `AI_UNAVAILABLE`이 있고 응답 `items`가 하나 이상이면, 그 결과를 보여 줄 때 카드 목록 위(홈 주변 카드와 검색 결과 모두)에 안내 한 줄 "지금은 AI 추천을 쓸 수 없어 가게 이름·메뉴로 찾았어요"가 보인다. 응답 `items`가 없으면 안내 없이 지금 화면 그대로다. 헤더가 없거나 `AI_UNAVAILABLE`이 없으면 안내가 없다. 대체 여부는 응답 본문(검색 기록에 저장되는 첫 페이지) 밖에 두어, 검색 기록에서 연 결과에는 안내가 없다. 홈 주변 카드가 대체 결과였으면 홈 주변 카드를 다시 마운트할 때(첫 화면으로 돌아올 때) 새로 받고, 창 포커스나 네트워크 재연결로는 다시 받지 않는다. 대체가 아닌 홈 결과와 모든 검색 결과는 지금처럼 페이지가 열린 동안 다시 받지 않는다. (D-6, D-16)

## Interfaces

### `POST /api/v1/places/search`

요청 헤더 `Authorization: Bearer <AT>`는 선택이다(D-4). 본문(`PlaceSearchRequest`)은 `preferences`의 모양만 바뀐다. FE가 무엇을 싣는지는 [FE 검색 요청](#fe-검색-요청)에 있다.

```
PlaceSearchRequest {
  query: string                 // 1~200자, 공백뿐인 값 제외 (그대로)
  preferences?: Preferences     // 바뀜: 문자열 목록 → 가입과 같은 Preferences (kr.co.fitdining.api.user.Preferences)
  previousConditions?: object   // 그대로. BE는 해석하지 않는다
  mapBounds?: { swLat?, swLng?, neLat?, neLng?: number }   // 그대로
  cursor?: string               // 그대로. DB 모드에서는 있으면 400 (D-10)
}

Preferences {
  mood?: "QUIET" | "LIVELY"
  priorities?: ("SPACIOUS" | "SHORT_WAIT" | "GENEROUS_PORTION" | "PRETTY_SPACE" | "VIEW_OUTDOOR" | "COZY" | "VALUE")[]
  purposes?: ("CONVERSATION" | "SOLO" | "DATE" | "GATHERING" | "WORK_STUDY")[]
  tastes?: { polarity: "LIKE" | "DISLIKE", label: string /* 1~20자, 제어문자 없음 */, code?: string }[]  // 최대 10개
}
```

응답 본문(`PlaceSearchResponse`, `PlaceCard`)의 모양은 바뀌지 않는다. 응답 헤더 `X-Fallback`이 생긴다(D-7).

| 상황 | 상태 | 본문 | `X-Fallback` |
|---|---|---|---|
| AI 성공 | 200 | AC-5 | AI `fallbacks`가 있으면 그 값(AC-6) |
| AI 실패(AC-7) | 200 | [대체 결과](#대체-결과) | `AI_UNAVAILABLE` 하나만. 대체로 끝난 응답에는 AI `fallbacks`를 싣지 않는다 |
| 본문 형식·검증 오류 | 400 | ProblemDetail(장소 API의 기존 400) | 없음 |
| 헤더가 있는데 인증 실패 | 401 | ProblemDetail(리뷰 API와 같은 모양), 만료면 `type` `urn:fitdining:auth:access-token-expired` | 없음 |
| DB 모드에서 `cursor`가 null이 아님 | 400 | ProblemDetail(장소 API의 기존 400) | 없음 |
| 카탈로그 DB 오류 | 503 | ProblemDetail(장소 API의 기존 503) | 없음 |

판단 순서는 본문 형식·검증(400) → 인증(401) → `cursor`(400) → 검색이다. 본문이 틀리고 토큰도 무효면 400이다(D-4 Default). 응답 본문의 JSON 모양이 바뀌지 않는 것이 의무이고, 헤더 값을 나르는 내부 타입은 재량이다.

### AI 요청

`POST {fitdining.ai.base-url}/v1/search`, `Content-Type: application/json`. 값이 없는 속성은 넣지 않는다(null로도 넣지 않는다).

| 속성 | 언제 | 값 |
|---|---|---|
| `query` | 항상 | 요청의 `query` 그대로 |
| `previousConditions` | 요청에 있고 빈 객체가 아닐 때 | 요청 값 그대로(내부 null 포함) |
| `mapBounds` | 요청에 있고 네 값 중 하나라도 있을 때 | 요청 값에서 빈 값을 뺀 것 |
| `userId` | 유효한 토큰이 있을 때 | 토큰의 사용자 id |
| `tasteProfile` | 토큰이 없고 요청에 `preferences`가 있을 때 | 검증과 정리를 거친 `preferences` 그대로(`mood`, `priorities`, `purposes`, `tastes[{polarity, label, code}]`). null인 `mood`·`code`는 빠지고 목록은 비어 있어도 `[]` |

### AI 응답

BE가 읽는 속성만 적는다. 그 밖의 속성은 카드와 이유 안쪽까지 어느 깊이에서든 무시한다(전역 설정 `fail-on-unknown-properties: true`와 달리)(D-5). 값의 범위(`score` 0~100, `labels` 개수)는 검증하지 않는다. 숫자·문자열 변환은 앱 전역 설정이 아닌 Jackson 라이브러리 기본 규칙을 따른다. 요청 쪽도 전역 null 생략과 달리 `previousConditions` 안쪽 null을 지킨다. `reasons`·`scoreItems`는 `PlaceCard`의 타입으로 읽는다. `interpretedBy`·`rankedBy`·`models`는 로그에만 쓰므로 어떤 JSON 값이 와도 읽을 수 없는 응답이 되지 않는다.

```
{
  conditions: object                 // → 응답 conditions 그대로
  nearby: boolean                    // → 그대로
  changeSummary?: string             // → 그대로
  emptyReason?: { cause, suggestion }// → 그대로
  items: [{ placeId: integer, score?, labels?, reasons?, scoreItems? }]   // → 카드 (AC-5)
  fallbacks?: string[]               // → X-Fallback (AC-6)
  interpretedBy?, rankedBy?, models? // → 로그에만 (AC-16)
}
```

**읽을 수 없는 응답**: 200인데 본문이 JSON이 아니거나, 위 속성의 타입이 맞지 않거나(`source`처럼 enum인 값에 모르는 값이 온 경우 포함), `items`가 없거나 null이거나, null 카드나 `placeId`가 없거나 null인 카드가 있거나, 목록(`labels`, `reasons`, `tags`, `scoreItems`, `fallbacks`) 안에 null 원소가 있는 응답(D-3, D-6). 그 밖의 속성이 빠진 것은 읽을 수 없는 응답이 아니다.

### 호출 규칙 (D-3)

- 주소: `fitdining.ai.base-url`. 검색 전용 주소 변수나 켜고 끄는 스위치는 없다. 비었거나 공백뿐이면 AI를 부르지 않고 대체한다(①). 예산·차단 임계값을 설정 키로 둘지 코드 상수로 둘지는 재량이다.
- 시간 예산: 한 검색에서 AI를 기다리는 시간은 연결부터 응답 본문을 다 읽을 때까지, 재시도와 그 앞의 기다림까지 합쳐 12초다(시도마다 따로 12초가 아니다). 재시도(`503 BUSY` 한 번)는 남은 예산 안에서만 한다.
- 차단기: AC-13. 상태는 BE 메모리의 값 두 개(연속 실패 수, 차단이 끝나는 시각. D-3의 "다시 열 시각")이고 컨테이너마다 따로이며 재시작하면 처음부터 센다. 30초가 지난 뒤 동시에 온 요청이 함께 AI를 부를 수 있다. 동시 요청 사이의 엄밀한 순서는 보장하지 않는다(값 두 개를 원자적으로 다루면 된다).
- `Modal-Key`·`Modal-Secret`: 값이 공백뿐이면 빈 값으로 보고 싣지 않는다(온보딩 AI 클라이언트와 같다).
- 로그: 실패 종류(예외 클래스나 상태 코드)만 남기고 본문과 예외 메시지는 남기지 않는다(AC-16, AC-20).

임시값(D-3 Default): 12초는 AI의 검색 예산 9초(실제 최대 8.6초)가 들어가고 FE 검색 요청의 15초(AC-25)보다 짧은 값이다. 연속 3번, 30초는 임시값이다.

### 대체 결과

AC-9 ~ AC-12가 규칙이다(D-6). 요약하면 다음과 같다.

| 요청 | 카드 출처 | `nearby` | 개수 |
|---|---|---|---|
| 홈 요청 | 카탈로그 전체(`place_id` 오름차순) | true | `mapBounds`로 거른 전부 |
| 그 밖 | `query`의 키워드 검색(순위 순) | false | `mapBounds`로 거른 뒤 앞 20곳 |

키워드 대체 카드의 `place`와 `openStatus`는 AI 결과 카드와 같은 방법(카탈로그 id 읽기, 영업 상태 계산기)으로 채운다. 홈 대체는 카탈로그 전체 카드를 읽는 기존 기능(`nearbyCandidates`)을 써도 된다.

### 취향과 인증

- 로그인은 선택이다. 헤더가 없으면 비회원, 있으면 반드시 유효해야 한다(AC-17). 토큰 확인은 DB를 보지 않아 탈퇴한 회원의 토큰도 회원으로 지나간다(D-4 Default, 감수).
- 회원: AI에 `userId`만 보낸다. 취향은 AI가 DB에서 읽는다(D-12).
- `preferences`가 있으면 회원이든 비회원이든 가입과 같은 검증과 정리(중복 제거, `label` 앞뒤 공백 제거)를 한다. 회원의 답변은 검증만 하고 쓰지 않는다. 비회원의 답변은 AI 요청의 `tasteProfile`로 그대로 넘긴다(AC-3). 칩의 문장 벡터(`vector`)는 붙이지 않는다(D-4 Default).

### AI가 읽는 뷰

뷰 `ai_place_search`는 Flyway 마이그레이션으로 만든다(D-15). 버전 번호는 머지 직전 develop과 먼저 머지될 브랜치의 가장 높은 번호 다음이다. 지금 develop은 V11이고 이 브랜치가 리뷰 FK 브랜치(S15P31A302-128)보다 먼저 머지되므로 V12다. 그 브랜치는 머지 전에 자기 번호를 V13으로 다시 맞춘다(Flyway는 이미 적용된 번호보다 낮은 새 번호를 거부한다). `places`와 `place_profiles`를 `place_id`로 이은 행이고, AI 코드(`ai/src/fit_ai/match/pg_store.py`)가 읽는 이름과 모양이 의무다.

| 컬럼 | 값 |
|---|---|
| `place_id`, `category_group`, `station`, `lat`, `lng` | `places`의 값 그대로 |
| `facilities` | jsonb 객체. `places.facilities`(네이버 이름)에 `주차` 또는 `발렛파킹`이 있으면 `"PARKING": true`, `무선 인터넷`이면 `"WIFI": true`, `단체 이용 가능`이면 `"GROUP": true`, `예약`이면 `"RESERVATION": true`. 해당 이름이 없는 코드는 키가 없다 |
| `profile` | jsonb 객체 `{"schema": "place-profile/v0", "summary": {"text": place_profiles.summary_text}, "features": place_profiles.features, "embedding": {"model": "dragonkue/snowflake-arctic-embed-l-v2.0-ko", "revision": "55ec6e9358a56d56af759bc8372e970caf8c305f", "prompt": "document"}}` |
| `summary_vector` | `place_profiles.summary_vector` 그대로 |

`embedding`의 두 값은 AI 코드의 인코더 상수(`ai/src/fit_ai/embedding`)와 같아야 한다. 적재된 벡터가 그 인코더로 만들어졌는지는 이 spec이 보장하지 않는다(D-13, D-15 Default).

### FE 검색 요청

AC-25 ~ AC-27이 규칙이다(D-16). 요약하면 다음과 같다.

| 세션 | `Authorization` | `preferences` |
|---|---|---|
| 확인된 회원 | 그 세션의 AT(만료면 한 번 갱신해 다시 보냄) | 없음 |
| 확인된 비회원 | 없음 | 기기에 저장된 온보딩 답(없으면 없음) |
| 확인 못 함 | 없음 | 없음 |

`preferences`는 보낼 때만 붙이고, 화면 상태와 검색 기록에 남기는 요청에는 넣지 않는다. 세션과 온보딩 답은 app 계층이 place 도메인에 넘긴다(넘기는 타입의 모양은 재량). 대체 안내 문구와 다시 받는 범위는 AC-27이다.

## Constraints

- 새 의존성을 더하지 않는다. 차단기 라이브러리(Resilience4j 등)도 쓰지 않는다. (D-3, D-14)
- 엔진 관련 새 코드는 `kr.co.fitdining.api.place.engine` 패키지에 둔다. (D-2)
- AI 주소는 온보딩과 같은 `fitdining.ai.base-url`(`MODAL_BASE_URL`)을 쓴다. 검색 전용 주소 변수(`AI_BASE_URL` 등)나 AI 켜고 끄는 스위치를 만들지 않는다. 주소가 비어도 기동을 실패시키지 않는다. readiness 그룹에 AI를 넣지 않는다. (D-3)
- BE에 검색 결과 캐시를 두지 않는다(메모리, Redis 모두). (D-9)
- Mock 엔진과 `PLACE_MOCK_ENABLED`의 뜻은 바꾸지 않는다. (D-1)
- FE의 도메인끼리 import하지 않는다. 검색 요청에 필요한 세션과 온보딩 답은 app 계층이 place 도메인에 넘긴다. (D-16)
- 뷰 `ai_place_search`는 새 버전 Flyway 마이그레이션 하나로만 만든다. 이미 적용된 마이그레이션 파일, AI 코드, 배포 스크립트, 권한 스크립트는 바꾸지 않는다. (D-15)
- 다음 페이지 FE 동작(`cursor`, `nextCursor`)은 바꾸지 않는다. (D-10)

## Existing code

| Locator | Action | Obligation | Decision |
|---|---|---|---|
| `be/src/main/java/kr/co/fitdining/api/place/engine/CatalogPlaceSearchEngine.java#CatalogPlaceSearchEngine` | modify | DB 모드 엔진. 추천 검색만 AI 호출과 대체로 바꾸고 자동완성과 상세는 그대로 둔다. "근처"만 처리하고 나머지는 503이던 분기는 없앤다 | D-2, D-8 |
| `be/src/main/resources/application.yml#fitdining` | reuse | `fitdining.ai.base-url`, `modal-key`, `modal-secret`을 온보딩과 함께 쓴다. 검색 전용 주소 키나 켜고 끄는 스위치를 더하지 않는다 | D-3 |
| `be/src/main/java/kr/co/fitdining/api/user/Preferences.java#Preferences` | reuse | 비회원 답변의 모양, 검증, 정리 규칙. 가입이 쓰는 것과 같은 타입을 그대로 쓴다 | D-4 |
| `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSearchRequest.java#PlaceSearchRequest` | modify | `preferences`의 타입만 `Preferences`로 바꾸고(검증 포함) 나머지 필드는 그대로 둔다 | D-4 |
| `be/src/main/java/kr/co/fitdining/api/place/PlaceController.java#PlaceController` | modify | 추천 검색에 선택 로그인(`Authorization`)과 `X-Fallback` 헤더를 더한다. 인증 빈이 없는 `migrate` 프로필에서도 기동이 깨지지 않게 한다(리뷰 API처럼 웹 앱에서만 만들기). 자동완성과 상세는 그대로 둔다 | D-4, D-7 |
| `be/src/main/java/kr/co/fitdining/api/place/exception/PlaceExceptionHandler.java#PlaceExceptionHandler` | modify | `AuthFailure`를 401 ProblemDetail로(만료면 `type` 유지) 바꾼다. 리뷰 API의 처리(`ReviewExceptionHandler#handleAuthFailure`)와 같은 모양. 기존 400·404·503 처리는 그대로 둔다 | D-4 |
| `be/src/main/java/kr/co/fitdining/api/place/engine/PlaceSearchEngine.java#PlaceSearchEngine` | modify | 엔진에 회원 id를 넘기고 대체 사유를 돌려받을 수 있게 검색 시그니처를 바꿀 수 있다. `PlaceService`와 `MockPlaceSearchEngine`은 이 변경을 따라가되 Mock의 동작은 그대로다 | D-4, D-7 |
| `be/src/main/java/kr/co/fitdining/api/auth/ports/AuthUseCases.java#authenticate` | reuse | 토큰 확인과 만료 판정은 이 인증 모듈을 거친다. 리뷰 목록(`ReviewController#list`)의 선택 로그인과 같은 방식이다 | D-4, D-11 |
| `be/src/main/java/kr/co/fitdining/api/place/catalog/PlaceCatalog.java#PlaceCatalog` | modify | id 목록으로 카드용 장소 정보를 한 번에 읽는 기능을 더한다(Postgres 구현 `JdbcPlaceCatalog` 포함). 기존 기능은 그대로 둔다 | D-5 |
| `be/src/main/java/kr/co/fitdining/api/place/catalog/OpenStatusCalculator.java#OpenStatusCalculator` | reuse | AI 카드와 대체 카드의 `openStatus` 계산 | D-5 |
| `be/src/main/java/kr/co/fitdining/api/place/keyword/PlaceKeywordSearch.java#PlaceKeywordSearch` | reuse | 홈이 아닌 요청의 대체 결과를 얻는다. 매칭 규칙은 place-lookup-db spec 그대로다 | D-6 |
| `be/src/main/java/kr/co/fitdining/api/place/engine/InvalidCursorException.java#InvalidCursorException` | reuse | `cursor`가 온 DB 모드 요청을 400으로 돌려준다 | D-10 |
| `be/src/main/java/kr/co/fitdining/api/place/engine/AiSearchClient.java#AiSearchClient` | modify | 요청 본문에 `tasteProfile`(AC-3)을 더하고 시간 예산을 12초로 바꾼다. 차단기, 실패 분류, 로그 규칙은 그대로 둔다 | D-3, D-4 |
| `fe/src/shared/api/client.ts#request` | modify | 요청별 `timeoutMs`를 쓴다. 검색이 응답 헤더를 읽을 수 있게 더하되, 기존 호출의 동작(오류 변환, 시간 초과, 기본 10초)은 그대로 둔다 | D-16 |
| `fe/src/domains/place/api/place-api.ts#searchPlaces` | modify | 검색 요청에 헤더·`preferences`·15초를 싣고 `X-Fallback`을 읽는다. 자동완성과 상세는 그대로 둔다 | D-16 |
| `fe/src/domains/place/api/place-queries.ts#placeQueries` | modify | 검색과 홈 주변 카드 쿼리가 세션에 맞는 요청을 보내고, 홈 대체 결과를 다시 받게 한다. 쿼리 키와 검색 결과의 캐시 규칙은 그대로 둔다 | D-16 |
| `fe/src/domains/place/model/place-types.ts#PlaceSearchRequest` | modify | 옛 모양 `preferences?: string[]`을 없앤다. 화면 상태와 검색 기록의 요청이 이 타입이라 `preferences`가 들어가지 않는다. 다른 필드는 그대로 둔다 | D-16 |
| `fe/src/app/search-thread-auth.ts#threadAuth` | reuse | 세션 확인(`current`, `resolve`)과 토큰 갱신을 거친 전송(`send`). 검색 기록 저장과 같은 것을 쓴다 | D-16 |
| `fe/src/domains/onboarding/model/storage.ts#readAnswers` | reuse | 비회원 온보딩 답 읽기와 검증 | D-4, D-16 |

## Seams & test plan

새 의존성 없이(D-14) 다음 이음매로 확인한다. 로그 검사(AC-20)는 검색 문장, 답변, `previousConditions`, AI 응답의 `conditions`·카드 문구(`reasons` 제목 등)와 깨진 응답 본문에 다른 로그에 나올 리 없는 고유 표식 문자열을 넣고 출력에서 찾는다(기존 `LOG_SECRET` 방식). `interpretedBy`·`rankedBy`·`models`에는 표식을 넣지 않는다.

- AI 클라이언트 (example, `MockRestServiceServer`), AC-2, AC-6(값 파싱), AC-7 ①②④~⑦, AC-8, AC-13, AC-16, AC-20: 요청 본문의 속성 집합(모르는 속성 없음, `userId` 규칙, 빈 `previousConditions` 생략, `previousConditions` 안쪽 null 유지), Modal 헤더(공백뿐인 값 제외), 응답 변환(어느 깊이든 모르는 속성 무시, 빠진 목록은 빈 목록), 읽을 수 없는 응답의 종류(모르는 enum 값 포함), `BUSY` 판정과 한 번 재시도, 200 외 상태 분류, 공백뿐인 주소(①), 이름 풀이 실패·연결 끊김(②), 형식이 잘못된 주소와 그 밖의 예외(⑦), 목록 안 null 원소(⑦), 실패 종류와 로그 수준, 차단기(3번·30초·⑥⑦ 미집계·성공 시 해제·실패한 시험 호출 뒤 재차단·차단 중 끝난 실패의 끝 시각 연장·차단 중 끝난 성공의 해제·차단 시작/해제 로그, 시각은 주입한 `Clock`), 실패 로그에 본문 표식이 없음을 잡는다. 실제 네트워크와 Modal 프록시는 놓친다. Prior art: `be/src/test/java/kr/co/fitdining/api/onboarding/AiTasteAnalyzerTests.java`.
- AI 클라이언트 시간 예산 (example, JDK 내장 `com.sun.net.httpserver.HttpServer`로 늦게 응답), AC-7 ③, AC-8: `MockRestServiceServer`는 요청 팩토리를 바꿔 실제 타임아웃이 돌지 않으므로 실제 HTTP 서버로 확인한다. 예산 값은 짧게 주입한다. 헤더 뒤 본문이 늦는 응답을 포함한 시간 초과, `BUSY` 뒤 재시도가 예산을 넘지 않음, 시간 초과 로그에 본문 표식이 없음을 잡는다. Prior art: `AiTasteAnalyzerTests#configuredProfileTimeout_throwsTimeout`.
- DB 모드 엔진 (example, 가짜 AI 클라이언트 + 가짜 카탈로그·키워드 검색), AC-1, AC-4, AC-5, AC-7 ⑧⑨, AC-9 ~ AC-12, AC-15, AC-16(⑧⑨ 로그, 성공 시 `models` 로그), AC-20(엔진 로그), AC-21, AC-23: 요청마다 AI 호출("근처 맛집" 포함), `cursor`(빈 문자열 포함)면 AI를 부르지 않고 400 예외, 순서 유지, `conditions`·`nearby`·`changeSummary`·`emptyReason` 옮기기와 빠진 값의 기본값, 중복 id 제거, 없는 id 제외와 WARN 로그, 전부 없을 때 대체와 헤더 값, 홈 요청 판정(앞뒤 공백), 지도 영역 거르기(빈 값, 경계), 키워드 대체의 순서(거르기 → 20곳 → id 읽기)와 카탈로그에 없는 히트 제외, 대체 카드 모양과 `emptyReason` 문구, DB 예외와 키워드 검색의 503 예외를 삼키지 않음, AI 클라이언트의 예상 못 한 예외는 대체로 바꿈, 넘겨받은 회원 id만 `userId`가 됨, 자동완성·상세는 AI를 부르지 않음을 잡는다. HTTP 직렬화는 놓친다. Prior art: `be/src/test/java/kr/co/fitdining/api/place/engine/CatalogPlaceSearchEngineTest.java`, `be/src/test/java/kr/co/fitdining/api/place/keyword/FakePlaceCatalog.java`.
- 컨트롤러 (example, `@WebMvcTest` + 가짜 엔진·`AuthUseCases`, `OutputCaptureExtension`), AC-3, AC-4, AC-6(헤더), AC-7(헤더), AC-15, AC-17, AC-18, AC-20, AC-21, AC-22: `X-Fallback` 헤더, 401과 만료 `type`, `Bearer` 아닌 헤더와 빈 헤더, 토큰 없는 비회원 처리, 판단 순서(본문 400 → 401 → `cursor` 400), `cursor: null`은 커서 없음, `preferences` 검증 400(회원 포함)과 옛 모양 400(Mock 포함), 본문 `userId` 400, DB 오류 503, 로그에 표식이 없음, Mock 모드 페이지 나눔·잘못된 커서 400·헤더 없음, 자동완성·상세가 잘못된 `Authorization`을 무시함을 잡는다. DB 모드의 `cursor` 400(AC-4)은 실제 DB 모드 엔진과 가짜 AI 클라이언트를 붙인 컨트롤러 예시(`PlaceControllerMockDisabledTest` 방식)로 HTTP 수준에서도 확인한다. Prior art: `be/src/test/java/kr/co/fitdining/api/place/PlaceControllerTest.java`, `be/src/test/java/kr/co/fitdining/api/place/PlaceControllerMockDisabledTest.java`, `be/src/test/java/kr/co/fitdining/api/review/ReviewControllerTest.java`.
- 기동 (example, Spring Boot 기동, Postgres 테스트 컨테이너), AC-14, AC-19: 주소가 빈 값이거나 닿지 않는 주소로 웹 앱이 뜨고 readiness가 UP인지, `migrate` 프로필이 인증 환경 없이 뜨고 끝나는지를 잡는다. Prior art: `be/src/test/java/kr/co/fitdining/api/auth/AuthServiceTests.java#migrate_withoutAuthEnvironment_startsAndCloses`(이미 DB 모드 전체 컨텍스트를 띄워 AC-19를 지킨다), readiness는 `ManagementEndpointsTest`.
- 카탈로그 id 읽기 (example, Postgres 통합), AC-5의 장소 요약·영업 상태: 여러 id를 한 번에 읽기, 없는 id 누락, 결과 모양을 잡는다. Prior art: `be/src/test/java/kr/co/fitdining/api/place/catalog/JdbcPlaceCatalogTest.java`.
- AI 뷰 (example, Postgres 테스트 컨테이너에 전체 마이그레이션), AC-24: 뷰의 컬럼 이름, `profile`·`facilities`의 값(표의 이름 → 코드, 없는 시설은 키 없음), 프로필 없는 장소 제외를 잡는다. AI 코드가 실제로 읽는지는 놓친다(수동). Prior art: `be/src/test/java/kr/co/fitdining/api/place/catalog/JdbcPlaceCatalogTest.java`.
- FE 검색 API (example, Vitest + 가짜 `fetch`), AC-25, AC-26(헤더와 본문), AC-27(헤더 읽기): 검색만 15초이고 자동완성·상세는 10초, 넘긴 토큰과 `preferences`가 실림, `X-Fallback` 값 읽기를 잡는다. Prior art: `fe/src/domains/place/api/place-api.test.ts`, `fe/src/shared/api/client.test.ts`.
- FE 검색 세션 연결 (example, Vitest + 가짜 세션·저장소), AC-26: 회원·비회원·확인 못 함에 따라 싣는 값, 만료 뒤 한 번 갱신, 화면 상태와 검색 기록의 요청에 `preferences`가 없음을 잡는다. Prior art: `fe/src/app/search-thread-storage.test.ts`, `fe/src/app/use-bookmark-access.test.tsx`.
- FE 결과 화면 (example, Testing Library), AC-27: 대체 결과의 안내 문구(홈 주변 카드와 검색 결과), 카드가 없을 때 안내 없음, 홈 대체 결과의 다시 받기를 잡는다. Prior art: `fe/src/domains/place/ui/search-screen.test.tsx`.
- 수동 (manual): Usage 4의 curl로 AI를 끈 대체와 헤더를, 3으로 답변 검증을 확인한다. AC-24의 뷰는 마이그레이션을 적용한 로컬 DB에서 AI `PgPlaceStore`로 읽혀 후보가 나오는지 확인한다. AI 성공 경로의 실제 연동은 D-13 선행 작업 뒤라 이번 계획에 없다.

이 spec과 어긋나는 기존 테스트는 이 spec의 기준으로 바꾼다. 확인된 것: `PlaceControllerMockDisabledTest#search_naturalLanguage_returnsServiceUnavailable`, `#search_withCursor_returnsServiceUnavailable`, `CatalogPlaceSearchEngineTest`의 "근처" 분기와 빈 문자열 `cursor`를 커서 없음으로 보는 검사, `PlaceControllerTest`에서 예전 모양 `preferences`를 쓰는 검사(`search_preferences_acceptedButIgnored` 등). 장소 `@WebMvcTest`들은 가짜 `AuthUseCases`가 필요하고, `PlaceEngineWiringTest`는 새 AI 클라이언트의 의존 빈을 줘야 한다.

## Out of scope

- 칩의 문장 벡터(`vector`) 만들기와 싣기(회원·비회원 모두) (D-4)
- 검색 기록에서 연 과거 결과의 대체 안내 (D-6, D-16)
- 사용자·IP별 속도 제한(인프라 BE 계약 #18), 호출·폴백 지표(`modal_*_total`) (D-1)
- BE 검색 결과 캐시와 홈 결과 캐시 (D-9)
- 검색 기록(search-thread)에 대체 표시 남기기, 대체된 후속 검색의 조건 이어 붙이기 (D-6)
- 대체 결과에 BE가 점수 매기기 (D-6)
- 회원 취향 계산·저장(S15P31A302-129가 함) (D-12)
- 인프라·AI 쪽 선행 작업: AI 컨테이너, `MODAL_BASE_URL` 내부 주소, dev·prod 장소 적재, AI 임베딩·적재 벡터의 인코더 확인·예시 id 맞추기, 근처 검색이 위치 없이 100곳만 주는 문제 (D-13)
- 뷰를 BE 컬럼 그대로의 모양으로 바꾸기(AI가 바뀐 뒤) (D-15)
- BE가 Modal이나 OpenSearch를 직접 부르기 (D-2)
- Mock 엔진이 AI를 부르기 (D-1)

## Open questions

- 근처 검색은 AI가 위치 없이 100곳을 주고 FE가 1km로 걸러 남는 곳이 적을 수 있다. 위치를 보내지 않는 place-search#D-82와 부딪혀 AI 쪽 해법이 필요하다. 이번 BE 의무와 검증에는 영향이 없다. (D-13)
- AI의 근처 검색 로직이 확정되면 모두에게 같은 홈 결과 하나를 캐시할지 다시 본다. (D-9)
