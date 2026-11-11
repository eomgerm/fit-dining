# 추천 검색을 AI 검색 API로 (place-ai-search)

Status: approved
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

이번 반복 전에는 DB 모드(`PLACE_MOCK_ENABLED`가 꺼진 환경)의 추천 검색(`POST /api/v1/places/search`)이 문장에 "근처"가 들어 있으면 카탈로그 전체를 점수 없이 주고, 그 밖의 문장은 모두 503이었다(place-lookup-db#D-13). AI 파트의 검색 API(`POST /v1/search`)가 요청 해석, 후보 추출, 정렬, 카드의 AI 필드를 만들 수 있게 됐지만 BE는 부르지 않았다. 그래서 운영에서는 자연어 검색을 쓸 수 없었고, 홈 카드에도 점수와 라벨이 없었다.

이번 반복(Jira S15P31A302-133)은 BE와 FE를 함께 한다(D-1). DB 모드 엔진의 추천 검색이 AI 검색 API를 부르고, AI가 준 카드에 장소 정보와 영업 상태를 붙여 돌려준다. AI가 실패하면 오류 화면 대신 키워드나 카탈로그로 만든 대체 결과와 `X-Fallback` 헤더를 준다. 검색은 로그인을 선택으로 받아, 회원이면 회원 id를, 비회원이면 기기의 온보딩 답을 AI에 넘긴다. AI가 장소를 읽는 뷰를 BE 마이그레이션으로 만든다(D-15). FE는 검색 요청에 토큰이나 답을 싣고 대체 결과를 알린다(D-16). 그 반복에서 Mock 엔진은 바꾸지 않았다.

다음 반복(Jira S15P31A302-168)은 BE가 AI를 기다리는 방식만 고친다. 그전에는 AI가 `503 BUSY`와 `Retry-After: 1`을 줘도 BE가 기다리지 않고 바로 재요청해, AI의 동시 처리 개수가 아직 차 있어 다시 `BUSY`를 받기 쉬웠다. 또 BE에서 AI 응답을 기다리는 검색이 8개면 9번째는 semaphore permit이 곧 반납돼도 바로 키워드 결과를 받았다. 실패 로그에는 상태 코드만 있어 503이 임베딩 실패인지 장소 DB 실패인지 알 수 없었다. 이번에는 `Retry-After`만큼 기다린 뒤 재요청하고(남은 예산이 모자라면 기다리지 않고 대체), permit이 없으면 예산 안에서 반납을 잠깐 기다리며, 실패 로그에 ProblemDetail `code`와 걸린 시간을 남긴다(D-3, D-17).

그다음 반복(Jira S15P31A302-201)은 추천 검색 API를 목적별로 나눈다(D-18). 그전에는 홈 주변 카드, 자연어 검색, "이 지역에서 검색"이 모두 `POST /api/v1/places/search`로 왔다. 그래서 BE는 `"근처 맛집"` 문자열 비교로 홈 요청을 가렸고, AI는 "이 지역에서 검색"을 후속 검색과 구분하지 못했다. 구로 화면의 홈은 AI가 전국 100곳을 주고 FE가 1km로 잘라 0곳이 되었고, "강남역 파스타" 결과에서 지도를 선릉으로 옮겨 "이 지역에서 검색"을 눌러도 강남역 결과가 나왔다. 이번에는 `POST /api/v1/places/nearby`(NEARBY)와 `POST /api/v1/places/search/region`(REGION)을 더하고, 기존 `/places/search`(SEARCH)는 옛 요청 모양 그대로 둔다. BE는 목적에 맞는 표시(NEARBY `rulesOnly`, REGION `mapFirst`)를 AI에 보내고(D-8), AI 실패 때의 대체 결과(D-6)와 Mock 응답도 목적별로 나눈다. FE가 새 API를 부르는 일은 place-search의 다음 이슈들(S15P31A302-202~204)이 하고, AI가 두 표시를 받는 일은 S15P31A302-196이 한다.

## Assumptions

1. local과 dev는 `PLACE_MOCK_ENABLED=true`라 계속 Mock 엔진이 응답한다. AI 연동은 서버에 장소 DB가 적재된 뒤 스위치를 끄면 보이고, 그 전까지는 가짜 AI 서버를 쓰는 테스트로 확인한다(D-1, D-13).
2. AI 검색 API는 `ai/docs/comparison/api.md`(초안 v0.5)의 모양을 따른다. 비회원 취향 `tasteProfile`은 온보딩 답 모양이고, 모양이 틀리면 AI는 취향 없이 정렬하고 `TASTE_INVALID`를 담는다(D-4). 요청에 모르는 속성이 있으면 400이고, 응답의 `items`는 `score` 내림차순이며 일반 20개·근처 100개까지다(D-2).
3. AI 주소 설정 `fitdining.ai.base-url`(환경변수 `MODAL_BASE_URL`, 코드 기본값 `http://localhost:8000`)과 `fitdining.ai.modal-key`·`modal-secret`은 온보딩 취향 연결(S15P31A302-129)이 이미 쓰고 있다. 환경변수를 빈 문자열로 주면 주소가 빈다(D-3).
4. 회원 취향(`user_preferences.features`)은 -129가 가입 때 저장하고 AI가 DB에서 직접 읽는다. 검색 쪽 BE는 회원 id만 넘긴다(D-12).
5. 검색은 선택적인 세션 인증 주체를 사용한다. Authorization 헤더는 무시하며 모든 검색 POST에는 CSRF 토큰이 필요하다(D-4).
6. `migrate` 프로필은 웹 서버 없이 뜨고 인증 빈을 만들지 않는다. 지금 `PlaceController`는 이 프로필에서도 만들어진다(D-4).
7. 이번 반복 전 FE는 검색 요청에 `preferences`와 토큰을 싣지 않았다(`fe/src/domains/place/model/search-request.ts`). 비회원 온보딩 답은 기기에 가입과 같은 모양으로 저장돼 있고, 읽을 때 지금 선택지에 맞지 않으면 지운다(`fe/src/domains/onboarding/model/storage.ts#readAnswers`)(D-4, D-16).
8. FE의 API 요청은 기본 10초에 끊기고 요청마다 바꿀 수 있다(`fe/src/shared/api/client.ts`의 `timeoutMs`). 대체 결과가 화면에 닿으려면 BE가 FE보다 먼저 응답해야 한다(D-3).
9. AI DB 계정은 `ai_place_search`와 `user_preferences`만 읽고(2026-11-10에 페르소나 뷰 `ai_place_personas`(V33)를 더했다, S15P31A302-161), 배포는 마이그레이션 뒤에 그 권한을 다시 맞춘다(`infra/data/grant-ai-read.sh`, `infra/deploy/deploy.sh`). 서버 dev DB에는 아직 이 뷰가 없다(D-15).
10. FE의 도메인끼리는 서로 import하지 않고 app 계층이 잇는다(`fe/eslint.config.mjs`). place 도메인은 auth와 onboarding을 import하지 않는다(D-16).
11. AI 검색 API는 모르는 요청 속성을 400으로 막는다(`extra="forbid"`). `rulesOnly`와 `mapFirst`를 받는 AI(S15P31A302-196)가 배포되기 전에는 NEARBY·REGION 요청이 AI의 400을 받아 AC-7 ⑥으로 대체된다. 배포 순서는 AI → BE → FE이고 같은 배포 창이다(D-18).
12. 이번 반복의 FE는 새 API를 부르지 않는다. 지금 FE와 배포 직후 남은 옛 FE 탭은 홈 주변 카드를 `/places/search` `{query: "근처 맛집"}`으로 보낸다(D-18).
13. Security는 `/api/v1/places/search`, `/api/v1/places/nearby`, `/api/v1/places/search/region`의 비회원 POST를 허용한다. 세 경로 모두 CSRF 토큰이 필요하다. 장소 경로는 Origin 검사 대상이 아니며, Authorization은 무시하고 세션이 없으면 비회원이다(D-4, D-18).
14. "근처 맛집"을 AI 규칙 해석(`interpret_by_rules`)에 넣으면 지역 HERE와 `nearby: true`가 나온다(2026-11-10 AI 코드에서 실행해 확인). 그래서 NEARBY는 LLM 없이도 지도 영역 안 근처 검색이 된다(D-8).

## Usage

DB 모드 BE로 확인한다. AI 성공 경로(1, 2)는 장소 id가 맞는 AI 서버가 있어야 보이고(D-13), 그 전에는 대체 결과(⑧)가 온다. 1과 5(NEARBY, REGION)는 AI가 `rulesOnly`·`mapFirst`를 받기 전(S15P31A302-196 전)에는 AI의 400으로 ⑥ 대체가 온다(Assumption 11). 4는 언제든 확인할 수 있다.

```bash
# be/.env: PLACE_MOCK_ENABLED=false, MODAL_BASE_URL=http://localhost:8000 (AI 서버 주소)
# 1) 비회원 홈 화면. 지도 영역 안 장소 10곳까지
curl -i -X POST http://localhost:8080/api/v1/places/nearby -H "Content-Type: application/json" \
  -d '{"mapBounds":{"swLat":37.49,"swLng":127.02,"neLat":37.51,"neLng":127.05}}'
# 2) 회원의 자연어 검색. AI 요청에 회원 id가 실린다
curl -i -X POST http://localhost:8080/api/v1/places/search -H "Content-Type: application/json" \
  -b cookies.txt -H "X-XSRF-TOKEN: $XSRF" -d '{"query":"역삼역 조용하게 대화하기 좋은 식당"}'
# 3) 비회원이 기기에 저장한 온보딩 답변을 싣는다. AI 요청의 tasteProfile로 넘어간다
curl -i -X POST http://localhost:8080/api/v1/places/search -H "Content-Type: application/json" \
  -d '{"query":"데이트하기 좋은 카페","preferences":{"mood":"QUIET","purposes":["DATE"]}}'
# 4) AI를 끈 채(MODAL_BASE_URL= 또는 닿지 않는 주소)로 같은 요청: 200과 X-Fallback: AI_UNAVAILABLE
# 5) "강남역 파스타" 결과를 보다가 지도를 선릉으로 옮겨 "이 지역에서 검색". 보던 query와 보던 응답의 conditions를 싣는다
curl -i -X POST http://localhost:8080/api/v1/places/search/region -H "Content-Type: application/json" \
  -d '{"query":"강남역 파스타","conditions":{"schema":"..."},"mapBounds":{"swLat":37.50,"swLng":127.04,"neLat":37.51,"neLng":127.06}}'
```

## Acceptance criteria

기준은 따로 적지 않으면 DB 모드(`place.mock.enabled`가 false)를 말한다. Mock 모드는 "바뀌지 않는 것"의 마지막 기준이다.

AI 호출

- [x] AC-1: 세 API(`/places/nearby`, `/places/search`, `/places/search/region`)에서 인증과 본문 검증을 통과하고 `cursor`가 없는 모든 추천 검색 요청은 요청마다 AI `POST {base-url}/v1/search`를 부른다(차단 중, 주소가 빈 경우, permit을 받지 못한 경우는 AC-13, AC-7, AC-28). 이전 요청의 결과를 다시 쓰지 않는다. `query`에 "근처"가 들어 있다는 이유로 AI 없이 응답하지 않는다. (D-2, D-8, D-9, D-18)
- [x] AC-2: AI 요청 본문은 [AI 요청](#ai-요청) 표의 속성만 담는다. `query`, `previousConditions`, `mapBounds`, `rulesOnly`, `mapFirst`는 그 표의 목적별 규칙대로이고, `userId`와 `tasteProfile`은 세 목적 모두 AC-3의 경우에만 있다. `cursor`, `preferences`, `conditions`는 없다. `fitdining.ai.modal-key`·`modal-secret`이 비어 있지 않으면 각각 `Modal-Key`·`Modal-Secret` 헤더로 실린다. (D-2, D-3, D-4, D-5, D-18)
- [x] AC-3: 세션 인증 주체가 있으면(Authorization 헤더는 무시한다) AI 요청의 `userId`는 그 주체의 사용자 id이고, 본문에 `preferences`가 있어도 AI에 보내지 않는다(`tasteProfile` 없음). 로그인 세션이 없으면 비회원이고 AI 요청에 `userId`가 없다. 비회원 요청에 `preferences`가 있으면 AI 요청의 `tasteProfile`은 그 `preferences`를 검증과 정리(AC-18)를 거친 값 그대로 담은 것이다. 속성 이름과 값은 같고, null인 `mood`와 칩의 null인 `code`·`vector`는 빠지며(칩 벡터가 있으면 그대로 싣는다, S15P31A302-230), `priorities`·`purposes`·`tastes`는 비어 있어도 `[]`로 싣는다. `preferences`가 없으면 `tasteProfile`도 없다. (D-4, D-12)
- [x] AC-4: DB 모드에서 `cursor`가 null이 아닌 요청(빈 문자열 포함)은 AI를 부르지 않고 400이다. Authorization은 무시하므로 이 헤더 때문에 401이 먼저 반환되지 않는다. Mock 모드에는 별도 커서 규칙이 적용된다. (D-10)

AI 결과를 카드로

- [x] AC-5: AI 응답의 카드는 AI 응답 순서 그대로 나오고, 같은 `placeId`가 다시 오면 처음 카드만 남는다. 각 카드의 `place`는 카탈로그의 그 `placeId` 장소 요약, `openStatus`는 요청을 처리하는 동안의 서울 시각 기준 영업 상태이고, `score`·`labels`·`reasons`·`scoreItems`는 AI 값 그대로이고 AI가 뺀 `labels`·`reasons`·`scoreItems`는 빈 목록, 뺀 `score`는 없음이며, `caution`은 없고, `reasons`의 `quote`·`quoteSource`는 AI가 주면 그대로 옮긴다. 카탈로그에 없는 `placeId`의 카드는 빠지고(다른 장소로 채우지 않는다) 빠진 id 수(중복을 지운 뒤)가 WARN 로그에 남는다. `totalCount`는 남은 카드 수이고 `nextCursor`는 없다. `conditions`·`nearby`·`changeSummary`·`emptyReason`은 AI 값 그대로다. AI가 `conditions`를 빼면 `{}`, `nearby`를 빼면 false이고, `changeSummary`·`emptyReason`을 빼면 응답에서도 빠진다. AI 응답의 모르는 속성은 어느 깊이에서든 무시하고 정상 응답한다. (D-5, D-11)
- [x] AC-6: AI 응답의 `fallbacks`가 비어 있지 않으면 응답에 `X-Fallback` 헤더가 붙고 값은 `fallbacks`의 원소를 받은 순서대로, 고치지 않고 쉼표로 이은 문자열(`PREVIOUS_INVALID,TASTE_INVALID`)이다. 비었거나 없으면 헤더가 없다. 대체로 끝난 응답의 헤더는 AC-7이다. (D-7)

AI 실패와 대체

- [x] AC-7: 아래 경우 모두 응답은 200, [대체 결과](#대체-결과) 모양이고 `X-Fallback: AI_UNAVAILABLE`이 붙는다. ① `fitdining.ai.base-url`이 비었거나 공백뿐(부르기 전에 판정) ② 연결 실패(이름 풀이 실패, 연결 거부·끊김, TLS 실패, 200 헤더 뒤 본문을 읽다 끊김 등 시간 초과가 아닌 I/O 오류) ③ 재시도까지 합쳐 12초 안에 응답이 없음 ④ 5xx(`BUSY` 제외) ⑤ `503 BUSY`가 재시도 뒤에도 옴 ⑥ 200이 아닌 그 밖의 상태(4xx, 3xx, 200 외 2xx) ⑦ 200이지만 [읽을 수 없는 응답](#ai-응답), 또는 AI 호출 중 난 I/O 오류가 아닌 그 밖의 예외(형식이 잘못된 주소 포함. 이 경우에도 기동은 실패하지 않는다) ⑧ 카드가 하나 이상인데 모든 `placeId`가 카탈로그에 없음 ⑨ 차단 중 ⑩ AI를 기다리는 검색이 상한만큼 있고 기다려도 permit을 받지 못함(AC-28). ⑧에서 AI 응답에 `fallbacks`가 있어도 헤더 값은 `AI_UNAVAILABLE` 하나다. AC-15의 DB 오류 말고는 어느 경우에도 5xx를 주지 않는다. (D-3, D-6, D-7, D-11)
- [x] AC-8: AI가 `503 BUSY`(상태 503이고 ProblemDetail `code`가 `BUSY`)를 주면 BE는 12초 예산 안에서 한 번만 재요청한다. 재요청 전에 `Retry-After`의 초만큼 기다린다. 값이 없거나 0 이상의 정수 초가 아니면(날짜 형식 포함) 기다리지 않고, 2초보다 크면 2초만 기다린다. 기다리기 전에 남은 예산이 "기다릴 시간 + 최소 처리 시간 3.4초"보다 적으면 기다리지도 재요청하지도 않고 ⑤다. 기다린 뒤 남은 예산을 다시 재서 3.4초보다 적어도 ⑤다. 기다리는 동안 thread가 interrupt되면 재요청하지 않고 대체하며, 차단기에 세지 않고 ERROR 로그를 남긴다. 재시도는 남은 예산을 제한 시간으로 하고, 그 안에 응답이 없으면 ③이다. 재시도가 성공하면 AC-5대로 정상 응답한다. `BUSY`가 아닌 503과 다른 실패는 다시 부르지 않는다. (D-3)
- [x] AC-9: NEARBY(`/places/nearby`)의 대체 결과는 `mapBounds` 안(AC-11) 장소를 `place_id` 오름차순으로 앞 10곳 담은 카드이고 `nearby: true`, `conditions: {}`다. (D-6)
- [x] AC-10: SEARCH(`/places/search`)의 대체 결과는 `query`의 키워드 검색 결과를 순위 순으로 카드로 만든 것이고 `nearby: false`다. 순서는 키워드 검색 히트 전체 → 앞 20곳 → 카탈로그에서 id로 읽기이고, 카탈로그에서 읽히지 않는 장소는 빠진다(그래서 20곳보다 적을 수 있다). `mapBounds`는 결과에 영향을 주지 않는다. 같은 `query`와 카탈로그면 `mapBounds`가 없든 어떤 값이든 같은 장소가 같은 순서로 나온다. `query`가 "근처 맛집"이어도 같은 규칙이다. (D-6, D-18)
- [x] AC-11: REGION(`/places/search/region`)의 대체 결과는 `mapBounds` 안 장소를 `place_id` 오름차순으로 앞 20곳 담은 카드이고 `nearby: false`, `conditions: {}`다. NEARBY와 REGION 대체에서 영역 안은 위도가 `swLat` 이상 `neLat` 이하이고 경도가 `swLng` 이상 `neLng` 이하인 것이다(경계 포함). (D-6)
- [x] AC-12: 대체 결과의 카드에는 `score`가 없고 `labels`·`reasons`·`scoreItems`는 빈 목록이다. `nextCursor`·`changeSummary`는 없고 `totalCount`는 카드 수다. SEARCH의 `conditions`는 받은 `previousConditions`(없거나 `{}`면 `{}`)다. 남은 카드가 없으면 `items: []`와 `emptyReason`이 온다. SEARCH의 `emptyReason`은 원인 "지금은 가게 이름, 메뉴, 업종, 역 이름으로만 찾을 수 있어요", 제안 "가게 이름이나 메뉴 이름으로 다시 검색해 보세요"이고, NEARBY와 REGION은 원인 "이 지역에는 아직 보여 드릴 장소가 없어요", 제안 "지도를 옮기거나 넓혀서 다시 찾아 보세요"이다. (D-6)
- [x] AC-13: 차단기 실패(②~⑤: 연결 실패, 시간 초과, 5xx, 재시도 뒤 `BUSY`)마다 연속 실패 수가 1 늘고, 그 결과 3 이상이면 그때부터 30초 동안(차단 중. 차단 중에 끝난 차단기 실패도 끝 시각을 그때부터 30초 뒤로 다시 잡는다) 오는 검색은 AI를 부르지 않고 바로 대체한다. 30초가 지난 뒤 오는 요청은 AI를 부르고, 차단기 실패면 다시 30초 동안 차단한다. 읽을 수 있는 200 응답은 언제 끝났든(차단 전에 시작해 차단 중에 끝난 요청 포함) 연속 실패 수를 0으로 만들고 차단을 푼다. ⑥, ⑦, ⑩은 대체하지만 연속 실패 수와 차단을 바꾸지 않는다. 읽을 수 있는 200 응답(카드 id가 전부 카탈로그에 없는 응답 포함)은 성공이다. (D-3)
- [x] AC-14: `fitdining.ai.base-url`이 빈 값이거나 AI 서버가 닿지 않아도 BE는 정상으로 뜨고 readiness는 DB만 본다. (D-3)
- [x] AC-15: 카탈로그 DB를 읽지 못하면(카드 조립이나 대체 중) 지금처럼 503 ProblemDetail이다. DB 장애는 AI 장애로 대체하지 않는다(엔진이 DB 오류나 키워드 검색의 503 예외를 삼켜 대체 결과로 바꾸지 않는다. 대체로 바꾸는 것은 AI 호출에서 난 실패뿐이다). (D-6)
- [x] AC-16: 검색이 ①~⑦로 대체되면 요청마다 실패 종류(예외 클래스나 상태 코드)가 로그에 남는다. 200이 아닌 응답이면 상태 코드 뒤에 본문 ProblemDetail `code`를 붙인다(`503:EMBEDDING_UNAVAILABLE`). `code`가 없거나 문자열이 아니거나 대문자 상수 모양(`[A-Z][A-Z0-9_]{0,39}`)이 아니면 상태 코드만 남긴다. ②~⑦ 로그에는 검색이 permit을 기다리기 시작한 때부터 걸린 시간(ms)도 남고, ⑤에서 재요청을 건너뛰었으면 그때 남은 예산(ms)도 남는다. ⑥, ⑦, ① 주소 없음은 ERROR, ②~⑤는 WARN이다. ⑧은 AC-5의 빠진 id WARN 로그로 갈음한다. ⑨ 차단 중에 대체한 요청은 요청마다 남기지 않고, 차단이 풀릴 때의 INFO에 그동안 AI를 부르지 않은 검색 수를 남긴다. ⑩은 요청마다 상한 값과 기다린 시간과 함께 WARN이다. 차단을 시작하거나 다시 시작할 때마다(AC-13) WARN을, 차단 중이거나 연속 실패 수가 3 이상일 때 성공해 차단이 풀리면 INFO를 남긴다. 읽을 수 있는 AI 응답을 받은 검색(⑧ 포함)마다 `interpretedBy`, `rankedBy`, `models`가 INFO 로그에 남는다. (D-3, D-5)

취향과 인증

- [x] AC-17: `Authorization` 헤더는 빈 값·잘못된 Bearer 값을 포함해 무시한다. 세션 쿠키가 있으면 회원, 없으면 비회원으로 검색하며 이 헤더만으로 401을 반환하거나 AI 호출을 막지 않는다. 상태 변경 요청에는 CSRF 토큰이 필요하다. (D-4)
- [x] AC-18: `preferences`는 가입의 `preferences`와 같은 모양(`mood`, `priorities`, `purposes`, `tastes`)과 검증을 따른다. 검증에 맞지 않거나 모르는 속성이 있으면 회원이든 비회원이든 400이다. 예전 모양(문자열 목록)은 Mock 모드에서도 400이다. (D-4)
- [x] AC-19: `migrate` 프로필이 인증 환경 변수 없이 뜨고 끝난다(인증을 붙인 뒤에도). (D-4)

절대 일어나면 안 되는 일

- [x] AC-20: 세 API의 어떤 요청이든(성공, 대체 ①~⑩, 400, 401, 503) 처리한 뒤 BE 로그 출력에 검색 문장(`query`), `previousConditions`·`conditions`의 값, `mapBounds`의 좌표 값(대략의 위치다), `preferences`의 값, AI 요청·응답 본문(본문 조각을 담을 수 있는 HTTP·JSON 예외 메시지 포함)이 나타나지 않는다. 예외는 AC-16이 남기라는 `interpretedBy`, `rankedBy`, `models` 값뿐이다. (D-11)
- [x] AC-21: 세 API의 어떤 요청 본문과 헤더 조합이든 AI 요청의 `userId`는 검증된 토큰이나 로그인 세션의 사용자 id이거나 없다. 본문에 `userId`를 넣으면 400이다. (D-11)

바뀌지 않는 것

- [x] AC-22: Mock 모드의 추천 검색은 세 API 모두 AI를 부르지 않고 `X-Fallback`이 없다. SEARCH는 지금과 같은 결과와 페이지 나눔(`cursor`, `nextCursor`, 잘못된 커서 400)을 주되 `query`의 "근처"로 결과가 달라지지 않는다. NEARBY와 REGION은 AC-33이다. `preferences`는 받기만 하고 결과에 반영하지 않는다. 인증 규칙(AC-17), `preferences` 검증(AC-18), 요청 검증(AC-29, AC-30)은 Mock 모드에도 같다. (D-1, D-4, D-10, D-18)
- [x] AC-23: 자동완성(`GET /places/suggest`)과 상세(`GET /places/{id}`)는 DB 모드에서도 지금과 같고 AI를 부르지 않으며, `Authorization` 헤더를 보지 않는다(잘못된 토큰이어도 401이 아니다). (D-2, D-4)

AI가 읽는 뷰

- [x] AC-24: BE 마이그레이션을 끝까지 적용한 DB에 뷰 `ai_place_search`가 있고(새 마이그레이션 하나로 만든다), 프로필이 있는 장소마다 한 행이 [AI가 읽는 뷰](#ai가-읽는-뷰)의 컬럼과 값을 갖는다. 프로필이 없는 장소는 행이 없다. 편의시설은 표의 이름이 있을 때만 그 코드가 `true`이고 그 밖의 코드는 키가 없다(`false`가 아니다). (D-15)

FE 검색 요청

- [x] AC-25: FE의 추천 검색 요청(`POST /api/v1/places/search`, 홈 주변 카드와 다음 페이지 포함)은 15초가 지나야 시간 초과다. 그 밖의 FE API 요청은 기능이 따로 정하지 않으면 기본 10초다(취향 분석은 온보딩이 15초로 정했다). (D-3, D-16)
- [x] AC-26: FE는 추천 검색 요청(홈 주변 카드, 첫 검색, 후속 검색, 다음 페이지)을 보낼 때마다 로그인 세션을 확인한다(검색 기록 저장과 같은 확인. 확인되지 않았으면 복원을 3초까지 기다린다). 확인된 회원이면 `Authorization: Bearer <그 세션의 AT>`를 싣고 `preferences`는 싣지 않으며, 만료로 401이 오면 토큰을 한 번 갱신해 다시 보낸다. 갱신하고도 실패하거나 보내는 사이 세션이 바뀌면 그 요청은 지금의 검색 실패와 같이 끝난다. 확인된 비회원이면 `Authorization` 없이, 기기에 저장된 온보딩 답이 있고 모든 칩의 `code`가 없거나 BE 규칙(`^[A-Z][A-Z0-9_]{0,63}$`)에 맞으면 그 값을 `preferences`로 싣고, 맞지 않으면 `preferences` 없이 보낸다. 확인하지 못했으면 둘 다 싣지 않는다. 검색 기록에 저장되는 요청(검색 thread의 turn)과 화면 상태의 요청에는 `preferences`가 들어가지 않는다(FE의 검색 요청 타입에 `preferences`가 없다). (D-4, D-16)
- [x] AC-27: 첫 페이지 응답의 `X-Fallback` 값(쉼표로 나눈 원소)에 `AI_UNAVAILABLE`이 있고 응답 `items`가 하나 이상이면, 그 결과를 보여 줄 때 카드 목록 위(홈 주변 카드와 검색 결과 모두)에 안내 한 줄 "지금은 AI 추천을 쓸 수 없어 가게 이름·메뉴로 찾았어요"가 보인다. 응답 `items`가 없으면 안내 없이 지금 화면 그대로다. 헤더가 없거나 `AI_UNAVAILABLE`이 없으면 안내가 없다. 대체 여부는 응답 본문(검색 기록에 저장되는 첫 페이지) 밖에 두어, 검색 기록에서 연 결과에는 안내가 없다. 홈 주변 카드가 대체 결과였으면 홈 주변 카드를 다시 마운트할 때(첫 화면으로 돌아올 때) 새로 받고, 창 포커스나 네트워크 재연결로는 다시 받지 않는다. 대체가 아닌 홈 결과와 모든 검색 결과는 지금처럼 페이지가 열린 동안 다시 받지 않는다. (D-6, D-16)

AI를 기다리는 검색 수

- [x] AC-28: 한 BE 컨테이너에서 AI 응답을 기다리는 검색(재요청과 그 전의 대기 포함)은 동시에 8개까지다(semaphore permit 8개). permit이 모두 쓰이는 중에 온 검색은 반납을 최대 2초, 남은 예산이 그보다 적으면 남은 예산만큼 기다린다. 기다리는 시간은 12초 예산에 든다. 그 사이 permit이 반납되면 바로 받아 AI를 부르고(기다린 순서대로 받는다), 끝내 받지 못하면 AI를 부르지 않고 대체한다(AC-7 ⑩). permit을 받은 뒤 차단 중이면 AI를 부르지 않고 대체한다(⑨). 검색이 끝나면(성공, 실패, 예외 모두) permit을 반납한다. 주소가 비었거나(①) 차단 중(⑨)인 검색은 permit을 쓰지 않는다. (D-17)

목적별 API (S15P31A302-201)

- [x] AC-29: `/places/nearby`와 `/places/search/region`의 `mapBounds`는 필수다. 다음 중 하나면 400 ProblemDetail(장소 API의 기존 400)이고 AI를 부르지 않는다. `mapBounds`가 없거나 null이다. 네 값(`swLat`, `swLng`, `neLat`, `neLng`) 중 하나라도 없거나 null이다. 유한하지 않은 값이 있다(JSON 숫자가 `Double` 범위를 넘어 무한대가 되는 `1e400` 포함). 위도(`swLat`, `neLat`)가 -90~90 밖이거나 경도(`swLng`, `neLng`)가 -180~180 밖이다. `swLat >= neLat`이거나 `swLng >= neLng`이다. 범위 경계값(-90, 90, -180, 180)은 받는다. `/places/search`의 `mapBounds`는 지금처럼 선택이고 이 검증을 하지 않는다. (D-18)
- [x] AC-30: `/places/nearby`는 `mapBounds`와 `preferences`만, `/places/search/region`은 `query`, `conditions`, `mapBounds`, `preferences`, `cursor`만 받고, 정의되지 않은 속성(nearby의 `query`, region의 `previousConditions`, 둘의 `userId` 등)이 있으면 400이다. region의 `query`는 `/places/search`와 같은 검증(1~200자, 공백뿐인 값 제외)이고, `conditions`는 JSON 객체(BE는 해석하지 않음)이며 배열 같은 다른 JSON 값이면 400이다. `conditions: null`은 `conditions`가 없는 것과 같다. 판단 순서와 CSRF 403은 `/places/search`와 같다([`POST /api/v1/places/search`](#post-apiv1placessearch)). DB 모드에서 region의 `cursor`가 null이 아니면 AC-4대로 400이다. (D-4, D-10, D-18)
- [x] AC-31: 두 API는 그 밖의 규칙을 `/places/search`와 같이 따른다. 로그인은 선택이고 헤더도 세션도 없으면 비회원으로 200이다. 인증과 취향은 AC-3·AC-17·AC-18·AC-21, 응답 본문(`PlaceSearchResponse`)과 `X-Fallback`은 AC-5~AC-7, 재요청·차단기·permit·로그는 AC-8·AC-13·AC-16·AC-28, DB 오류는 AC-15를 따른다. 세 API는 차단기 상태와 permit을 함께 쓴다. (D-4, D-18)
- [x] AC-32: NEARBY의 AI 성공 응답은 AC-5대로 같은 id를 지우고 카탈로그에 없는 id를 뺀 카드에서 앞 10곳만 남긴다. `totalCount`는 10곳으로 자른 뒤 응답한 카드 수이고, `conditions`·`nearby`·`changeSummary`·`emptyReason`·`X-Fallback`은 AC-5·AC-6대로 AI 값을 그대로 옮긴다. SEARCH와 REGION은 AI 카드를 자르지 않는다. 카드가 있는데 id가 전부 카탈로그에 없으면 세 목적 모두 AC-7 ⑧이다. (D-18)
- [x] AC-33: Mock 모드의 NEARBY와 REGION. 장소 순서는 Mock SEARCH와 같은 점수 내림차순(같으면 파일 순서)이고, 영역 안은 AC-11과 같다(경계 포함). NEARBY는 영역 안 장소의 앞 10곳이고 `nextCursor`와 `changeSummary`가 없으며 `nearby: true`, `conditions: {}`, `totalCount`는 응답한 카드 수다. 영역 안 장소가 없으면 `items: []`, `totalCount: 0`과 Mock의 기존 `emptyReason`이 온다. REGION은 영역 안 장소를 20곳씩 `cursor`로 나눈 페이지이고, 다음 페이지도 그 요청의 `mapBounds`로 거른 목록에서 오프셋을 센다. 커서 형식, 잘못된 커서 400, 빈 문자열 `cursor`는 첫 페이지라는 규칙, `cursor`가 있으면 `X-Mock-Scenario` 헤더를 무시하는 규칙은 Mock SEARCH와 같다. REGION 응답은 첫 페이지와 커서 페이지 모두 `nearby: false`이고, `conditions`는 받은 `conditions`(없거나 null이면 `{}`), `changeSummary`는 없으며 `totalCount`는 영역 안 장소 수다. 첫 페이지가 비면 `items: []`와 Mock의 기존 `emptyReason`이 오고, 오프셋이 영역 안 장소 수 이상인 커서 페이지는 `emptyReason`과 `nextCursor` 없이 빈 `items`만 온다. `cursor`가 없거나 빈 문자열이고 `X-Mock-Scenario: empty`면 세 목적 모두 `items: []`, `totalCount: 0`, Mock의 기존 `emptyReason`이고, NEARBY는 이때도 `nearby: true`다. (D-18)

절대 일어나면 안 되는 일 (목적별 API)

- [x] AC-34: 어떤 요청과 데이터에서든(AI 성공, 대체, Mock) `/places/nearby` 응답의 `items`는 10개를 넘지 않는다. (D-11, D-18)
- [x] AC-35: 어떤 `mapBounds`와 카탈로그·mock 데이터에서든 NEARBY·REGION의 대체 결과와 Mock 응답(REGION 다음 페이지 포함)에는 영역 밖 장소가 없다. AI 성공 응답의 카드는 BE가 영역으로 다시 거르지 않는다. (D-11, D-18)
- [x] AC-36: 어떤 요청에서든 AI 요청 본문의 `rulesOnly`는 NEARBY에만 `true`로 있고 `mapFirst`는 REGION에만 `true`로 있다. SEARCH 본문에는 둘 다 없다(`false`로도 넣지 않는다). (D-11, D-18)

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

판단 순서는 인증(401) → 본문 형식·검증(400) → `cursor`(400) → 검색이다. 인증은 Security 필터가 컨트롤러보다 먼저 하므로 본문이 틀리고 토큰도 무효면 401이다(S15P31A302-191 이후, D-4 Default). 로그인 세션으로 보낸 POST에 CSRF 토큰이 없으면 Security 설정이 403을 준다(`Authorization` 헤더가 있으면 CSRF를 보지 않는다). 응답 본문의 JSON 모양이 바뀌지 않는 것이 의무이고, 헤더 값을 나르는 내부 타입은 재량이다.

이 API의 목적은 SEARCH(새 검색, 후속 검색)다. 요청 모양과 검증은 이번 반복에도 바뀌지 않는다(D-18).

### `POST /api/v1/places/nearby`, `POST /api/v1/places/search/region` (D-18)

목적은 NEARBY(홈 주변 카드)와 REGION("이 지역에서 검색")이다. 헤더, 응답 본문(`PlaceSearchResponse`), 상태 표, `X-Fallback`, 판단 순서는 `/places/search`와 같다(AC-31). 지도 영역은 사용자 위치가 아니라 검색 대상 지역이지만, 대략의 위치가 서버로 간다(로그에는 남기지 않는다, AC-20).

새 요청 DTO는 기존 요청 DTO와 같은 `kr.co.fitdining.api.place.dto`에 둔다(place-search#D-54). 목적을 나르는 타입의 이름과 위치는 재량이다.

```
NearbyRequest {                 // 이름은 재량. 아래 속성만 받는다(AC-30)
  mapBounds: MapBounds          // 필수, AC-29
  preferences?: Preferences     // /places/search와 같은 타입·검증
}

RegionSearchRequest {           // 이름은 재량
  query: string                 // 1~200자, 공백뿐인 값 제외. 보던 요청의 query
  conditions?: object           // 보던 결과의 conditions. BE는 해석하지 않는다
  mapBounds: MapBounds          // 필수, AC-29
  preferences?: Preferences
  cursor?: string               // Mock은 다음 페이지, DB 모드는 null이 아니면 400 (D-10)
}

MapBounds { swLat, swLng, neLat, neLng: number }   // 네 값 모두 필수, 유한, 위도 -90~90, 경도 -180~180, sw < ne
```

| 목적 | AI 성공 응답 | 대체 결과 | Mock |
|---|---|---|---|
| NEARBY | AC-5에 앞 10곳 자르기(AC-32) | AC-9, AC-12 | AC-33 |
| REGION | AC-5 그대로 | AC-11, AC-12 | AC-33 |

### AI 요청

`POST {fitdining.ai.base-url}/v1/search`, `Content-Type: application/json`. 값이 없는 속성은 넣지 않는다(null로도 넣지 않는다).

| 속성 | 언제 | 값 |
|---|---|---|
| `query` | 항상 | SEARCH·REGION은 요청의 `query` 그대로. NEARBY는 BE 상수 `"근처 맛집"` |
| `previousConditions` | SEARCH는 요청의 `previousConditions`가, REGION은 요청의 `conditions`가 있고 빈 객체가 아닐 때. NEARBY는 없음 | 받은 값 그대로(내부 null 포함) |
| `mapBounds` | SEARCH는 요청에 있고 네 값 중 하나라도 있을 때. NEARBY·REGION은 항상 | SEARCH는 요청 값에서 빈 값을 뺀 것. NEARBY·REGION은 검증한 네 값 |
| `rulesOnly` | NEARBY만 | `true` (AI가 LLM 없이 규칙으로 해석, D-8) |
| `mapFirst` | REGION만 | `true` (AI가 이전 조건의 지역을 지우고 지도 영역에서 찾음) |
| `userId` | 인증 주체(유효한 토큰이나 로그인 세션)가 있을 때 | 그 주체의 사용자 id |
| `tasteProfile` | 인증 주체가 없고 요청에 `preferences`가 있을 때 | 검증과 정리를 거친 `preferences` 그대로(`mood`, `priorities`, `purposes`, `tastes[{polarity, label, code}]`). null인 `mood`·`code`는 빠지고 목록은 비어 있어도 `[]` |

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
- 시간 예산: 한 검색에서 AI를 기다리는 시간은 permit 대기(AC-28)부터 연결, 응답 본문을 다 읽을 때까지, 재요청과 그 전의 대기까지 합쳐 12초다(시도마다 따로 12초가 아니다). 재요청(`503 BUSY` 한 번)은 남은 예산 안에서만 하고, 대기 뒤에도 최소 처리 시간이 남을 때만 한다(AC-8).
- 차단기: AC-13. 상태는 BE 메모리의 값 두 개(연속 실패 수, 차단이 끝나는 시각. D-3의 "다시 열 시각")이고 컨테이너마다 따로이며 재시작하면 처음부터 센다. 30초가 지난 뒤 동시에 온 요청이 함께 AI를 부를 수 있다. 동시 요청 사이의 엄밀한 순서는 보장하지 않는다(값 두 개를 원자적으로 다루면 된다).
- 동시성 상한: AC-28. 값 8은 AI 컨테이너 하나가 받는 검색 수(`MAX_CONCURRENT_REQUESTS` 기본 8)와 같은 임시값이다(D-17). 상한 값과 permit 대기 시간을 설정 키로 둘지 코드 상수로 둘지는 재량이다.
- `Modal-Key`·`Modal-Secret`: 값이 공백뿐이면 빈 값으로 보고 싣지 않는다(온보딩 AI 클라이언트와 같다).
- 로그: 실패 종류(예외 클래스나 상태 코드)만 남기고 본문과 예외 메시지는 남기지 않는다(AC-16, AC-20).

임시값(D-3·D-17 Default): 12초는 AI의 검색 예산 9초(실제 최대 8.6초)가 들어가고 FE 검색 요청의 15초(AC-25)보다 짧은 값이다. 연속 3번, 30초는 임시값이다. 최소 처리 시간 3.4초(AI API 문서의 응답 시간 중앙값), `Retry-After` 상한 2초, permit 대기 2초도 임시값이고 BE가 AI 호출 시간을 잰 뒤 다시 정한다.

### 대체 결과

AC-9 ~ AC-12가 규칙이다(D-6). 목적은 API가 정한다(D-18). 요약하면 다음과 같다.

| 목적 | 카드 출처 | `nearby` | `conditions` | 개수 | 빈 결과 `emptyReason` |
|---|---|---|---|---|---|
| SEARCH | `query`의 키워드 검색(순위 순), 지도 영역 무시 | false | 받은 `previousConditions` 또는 `{}` | 앞 20곳 | 키워드 문구 |
| NEARBY | 지도 영역 안 장소(`place_id` 오름차순) | true | `{}` | 앞 10곳 | 지역 문구 |
| REGION | 지도 영역 안 장소(`place_id` 오름차순) | false | `{}` | 앞 20곳 | 지역 문구 |

카드의 `place`와 `openStatus`는 AI 결과 카드와 같은 방법(카탈로그 읽기, 영업 상태 계산기)으로 채운다. 지도 영역 안 장소는 카탈로그에서 영역과 개수로 걸러 읽는다. 카탈로그 전체를 읽어 메모리에서 거르는 기존 기능(`nearbyCandidates`)은 쓰지 않는다(D-6).

### 취향과 인증

- 로그인은 선택이다. `Authorization` 헤더가 있으면 반드시 유효해야 하고(AC-17), 헤더가 없으면 로그인 세션의 주체를 쓰며, 세션도 없으면 비회원이다(S15P31A302-191 이후). 토큰 확인은 DB를 보지 않아 탈퇴한 회원의 토큰도 회원으로 지나간다(D-4 Default, 감수).
- 회원: AI에 `userId`만 보낸다. 취향은 AI가 DB에서 읽는다(D-12).
- `preferences`가 있으면 회원이든 비회원이든 가입과 같은 검증과 정리(중복 제거, `label` 앞뒤 공백 제거)를 한다. 회원의 답변은 검증만 하고 쓰지 않는다. 비회원의 답변은 AI 요청의 `tasteProfile`로 그대로 넘긴다(AC-3). 칩의 문장 벡터(`vector`)는 붙이지 않는다(D-4 Default).

### AI가 읽는 뷰

뷰 `ai_place_search`는 Flyway 마이그레이션으로 만든다(D-15). 버전 번호는 머지 직전 develop과 먼저 머지될 브랜치의 가장 높은 번호 다음이다. 이 뷰는 V12로 머지됐고, 뒤에 머지된 리뷰 FK(S15P31A302-128)는 V13이다(Flyway는 이미 적용된 번호보다 낮은 새 번호를 거부한다). `places`와 `place_profiles`를 `place_id`로 이은 행이고, AI 코드(`ai/src/fit_ai/match/pg_store.py`)가 읽는 이름과 모양이 의무다.

| 컬럼 | 값 |
|---|---|
| `place_id`, `category_group`, `station`, `lat`, `lng` | `places`의 값 그대로 |
| `facilities` | jsonb 객체. `places.facilities`(네이버 이름)에 `주차` 또는 `발렛파킹`이 있으면 `"PARKING": true`, `무선 인터넷`이면 `"WIFI": true`, `단체 이용 가능`이면 `"GROUP": true`, `예약`이면 `"RESERVATION": true`. 해당 이름이 없는 코드는 키가 없다 |
| `profile` | jsonb 객체 `{"schema": "place-profile/v0", "summary": {"text": place_profiles.summary_text}, "features": place_profiles.features, "embedding": {"model": "dragonkue/snowflake-arctic-embed-l-v2.0-ko", "revision": "55ec6e9358a56d56af759bc8372e970caf8c305f", "prompt": "document"}}` |
| `summary_vector` | `place_profiles.summary_vector` 그대로 |
| `name`, `food_type`, `dong`, `district`, `pet_allowed`, `parking_free`, `corkage_allowed` | `places`의 값 그대로. V17이 뒤에 더했다(`CREATE OR REPLACE VIEW`, AI 검색 2차) |
| `subways` | jsonb 배열 `[{"station", "exit", "walk_minutes"}]`. `place_subways`를 PK 순서로 모은다. 없으면 `[]`. V17 |
| `hours` | jsonb 배열 `[{"day", "open", "close", "closed", "breaks"}]`. `place_hours`를 월요일부터 모은다. 시각은 `"HH:MM"`이고 없으면 null이다. 없으면 `[]`. V17 |
| `menus` | jsonb 배열 `[{"name", "category", "price", "representative"}]`. `place_menus`를 `sort_order` 순서로 모은다. 없으면 `[]`. V17 |
| `price` | integer. 가게 가격(원)이다. 네이버 리뷰 메뉴로 계산하는 값이라 장소 분석 적재가 채우기 전까지 NULL이다(place-catalog D-4). V17 |
| `category` | `places`의 네이버 업종 이름 그대로("카페,디저트", "돈가스"). AI 검색 메뉴 거르기가 메뉴판 없이도 메뉴를 찾는 데 쓴다. V19 |

`embedding`의 두 값은 AI 코드의 인코더 상수(`ai/src/fit_ai/embedding.py`)와 같아야 한다. 적재된 벡터가 그 인코더로 만들어졌는지는 이 spec이 보장하지 않는다(D-13, D-15 Default).

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
- `PLACE_MOCK_ENABLED`의 뜻은 바꾸지 않는다. Mock 엔진은 목적별 응답(AC-22, AC-33) 말고는 바꾸지 않는다. (D-1, D-18)
- `/places/search`의 요청 모양과 검증은 바꾸지 않는다. 문자열 "근처 맛집"으로 홈 요청을 가리는 분기를 남기지 않는다. (D-18)
- 검색 기록 형식(`TurnFormat`)은 바꾸지 않는다. (D-18)
- FE의 도메인끼리 import하지 않는다. 검색 요청에 필요한 세션과 온보딩 답은 app 계층이 place 도메인에 넘긴다. (D-16)
- 뷰 `ai_place_search`는 새 버전 Flyway 마이그레이션 하나로만 만든다. 이미 적용된 마이그레이션 파일, AI 코드, 배포 스크립트, 권한 스크립트는 바꾸지 않는다. (D-15)
- 다음 페이지 FE 동작(`cursor`, `nextCursor`)은 바꾸지 않는다. (D-10)

## Existing code

| Locator | Action | Obligation | Decision |
|---|---|---|---|
| `be/src/main/java/kr/co/fitdining/api/place/engine/CatalogPlaceSearchEngine.java#CatalogPlaceSearchEngine` | modify | DB 모드 엔진. 추천 검색만 AI 호출과 대체로 바꾸고 자동완성과 상세는 그대로 둔다. "근처"만 처리하고 나머지는 503이던 분기는 없앤다. -201: `HOME_QUERY` 문자열 비교를 없애고 목적별 대체(AC-9~AC-12)와 NEARBY 10곳 자르기(AC-32)를 둔다 | D-2, D-6, D-8, D-18 |
| `be/src/main/java/kr/co/fitdining/api/place/engine/MockPlaceSearchEngine.java#MockPlaceSearchEngine` | modify | 목적을 받아 NEARBY·REGION 응답(AC-33)을 두고, `query`의 "근처"로 판단하는 분기(`NEARBY_KEYWORD`)를 없앤다. 자동완성, 상세, SEARCH의 결과와 페이지 나눔은 그대로 둔다 | D-18 |
| `be/src/main/java/kr/co/fitdining/api/auth/infrastructure/SecurityConfiguration.java#SecurityConfiguration` | modify | 비회원 허용 POST 목록에 `/api/v1/places/nearby`와 `/api/v1/places/search/region`을 `/api/v1/places/search`와 같이 더한다. 다른 경로 규칙, 인증 필터, CSRF, Origin 검사는 바꾸지 않는다 | D-4, D-18 |
| `be/src/main/java/kr/co/fitdining/api/searchthread/TurnFormat.java#TurnFormat` | reuse | region의 새 요청 모양도 `request` 안쪽을 해석하지 않고 그대로 저장한다 | D-18 |
| `be/src/main/resources/application.yml#fitdining` | reuse | `fitdining.ai.base-url`, `modal-key`, `modal-secret`을 온보딩과 함께 쓴다. 검색 전용 주소 키나 켜고 끄는 스위치를 더하지 않는다 | D-3 |
| `be/src/main/java/kr/co/fitdining/api/user/Preferences.java#Preferences` | reuse | 비회원 답변의 모양, 검증, 정리 규칙. 가입이 쓰는 것과 같은 타입을 그대로 쓴다 | D-4 |
| `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSearchRequest.java#PlaceSearchRequest` | modify | `preferences`의 타입만 `Preferences`로 바꾸고(검증 포함) 나머지 필드는 그대로 둔다. -201: 필드와 검증은 그대로 두고, `mapBounds` 주석에 "지도 영역은 검색 대상 지역이지만 대략의 위치로 서버에 간다(로그에 남기지 않는다)"를 적는다. FE가 언제 싣는지는 place-search가 정하므로 BE 주석에 적지 않는다(지금 주석의 "'이 지역에서 검색'이나 위치 실패 때만 보낸다"는 지운다) | D-4, D-18 |
| `be/src/main/java/kr/co/fitdining/api/place/PlaceController.java#PlaceController` | modify | 추천 검색에 선택 로그인(`Authorization`)과 `X-Fallback` 헤더를 더한다. 인증 빈이 없는 `migrate` 프로필에서도 기동이 깨지지 않게 한다(리뷰 API처럼 웹 앱에서만 만들기). 자동완성과 상세는 그대로 둔다. -201: `/places/nearby`와 `/places/search/region`을 더하고, `/places/search`·자동완성·상세·id 목록은 그대로 둔다 | D-4, D-7, D-18 |
| `be/src/main/java/kr/co/fitdining/api/place/exception/PlaceExceptionHandler.java#PlaceExceptionHandler` | modify | `AuthFailure`를 401 ProblemDetail로(만료면 `type` 유지) 바꾼다. 리뷰 API의 처리(`ReviewExceptionHandler#handleAuthFailure`)와 같은 모양. 기존 400·404·503 처리는 그대로 둔다 | D-4 |
| `be/src/main/java/kr/co/fitdining/api/place/engine/PlaceSearchEngine.java#PlaceSearchEngine` | modify | 엔진에 회원 id를 넘기고 대체 사유를 돌려받을 수 있게 검색 시그니처를 바꿀 수 있다. -201: 검색이 목적(NEARBY, SEARCH, REGION)을 받는다. 목적을 나르는 타입과 시그니처의 모양은 재량이다 | D-4, D-7, D-18 |
| `be/src/main/java/kr/co/fitdining/api/auth/ports/AuthUseCases.java#authenticate` | reuse | 토큰 확인과 만료 판정은 이 인증 모듈을 거친다. 리뷰 목록(`ReviewController#list`)의 선택 로그인과 같은 방식이다 | D-4, D-11 |
| `be/src/main/java/kr/co/fitdining/api/place/catalog/PlaceCatalog.java#PlaceCatalog` | modify | id 목록으로 카드용 장소 정보를 한 번에 읽는 기능을 더한다(Postgres 구현 `JdbcPlaceCatalog` 포함). -201: 지도 영역 안(경계 포함) 장소를 `place_id` 오름차순으로 n곳 읽는 기능을 더한다. 영역과 개수는 DB 조회에서 거르고, 좌표는 SQL 문자열에 넣지 않고 바인딩해 DB 오류 로그에 좌표가 남지 않게 한다(AC-20). `nearbyCandidates()`를 포함한 기존 기능은 그대로 둔다 | D-5, D-6, D-11 |
| `be/src/main/java/kr/co/fitdining/api/place/catalog/OpenStatusCalculator.java#OpenStatusCalculator` | reuse | AI 카드와 대체 카드의 `openStatus` 계산 | D-5 |
| `be/src/main/java/kr/co/fitdining/api/place/keyword/PlaceKeywordSearch.java#PlaceKeywordSearch` | reuse | SEARCH의 대체 결과를 얻는다. 매칭 규칙은 place-lookup-db spec 그대로다 | D-6 |
| `be/src/main/java/kr/co/fitdining/api/place/engine/InvalidCursorException.java#InvalidCursorException` | reuse | `cursor`가 온 DB 모드 요청을 400으로 돌려준다 | D-10 |
| `be/src/main/java/kr/co/fitdining/api/place/engine/AiSearchClient.java#AiSearchClient` | modify | 요청 본문에 `tasteProfile`(AC-3)을 더하고 시간 예산을 12초로 바꾼다. `BUSY` 재요청 전의 대기(AC-8)와 permit 대기(AC-28)를 더하고 예산을 permit 대기부터 잰다. 실패 로그에 ProblemDetail `code`, 걸린 시간, 차단 중 건너뛴 수를 더한다(AC-16). 차단기와 실패 분류는 그대로 둔다. -201: 목적을 받아 [AI 요청](#ai-요청) 표의 목적별 본문만 바꾼다. 예산, 재요청, 차단기, permit, 실패 분류, 로그는 그대로이고 세 목적이 같은 차단기와 permit을 쓴다 | D-3, D-4, D-17, D-18 |
| `fe/src/shared/api/client.ts#request` | modify | 요청별 `timeoutMs`를 쓴다. 검색이 응답 헤더를 읽을 수 있게 더하되, 기존 호출의 동작(오류 변환, 시간 초과, 기본 10초)은 그대로 둔다 | D-16 |
| `fe/src/domains/place/api/place-api.ts#searchPlaces` | modify | 검색 요청에 헤더·`preferences`·15초를 싣고 `X-Fallback`을 읽는다. 자동완성과 상세는 그대로 둔다 | D-16 |
| `fe/src/domains/place/api/place-queries.ts#placeQueries` | modify | 검색과 홈 주변 카드 쿼리가 세션에 맞는 요청을 보내고, 홈 대체 결과를 다시 받게 한다. 쿼리 키와 검색 결과의 캐시 규칙은 그대로 둔다 | D-16 |
| `fe/src/domains/place/model/place-types.ts#PlaceSearchRequest` | modify | 옛 모양 `preferences?: string[]`을 없앤다. 화면 상태와 검색 기록의 요청이 이 타입이라 `preferences`가 들어가지 않는다. 다른 필드는 그대로 둔다 | D-16 |
| `fe/src/app/search-thread-auth.ts#threadAuth` | reuse | 세션 확인(`current`, `resolve`)과 토큰 갱신을 거친 전송(`send`). 검색 기록 저장과 같은 것을 쓴다 | D-16 |
| `fe/src/domains/onboarding/model/storage.ts#readAnswers` | reuse | 비회원 온보딩 답 읽기와 검증 | D-4, D-16 |

## Seams & test plan

새 의존성 없이(D-14) 다음 이음매로 확인한다. 로그 검사(AC-20)는 검색 문장, 답변, `previousConditions`, AI 응답의 `conditions`·카드 문구(`reasons` 제목 등)와 깨진 응답 본문에 다른 로그에 나올 리 없는 고유 표식 문자열을 넣고 출력에서 찾는다(기존 `LOG_SECRET` 방식). `interpretedBy`·`rankedBy`·`models`에는 표식을 넣지 않는다.

- AI 클라이언트 (example, `MockRestServiceServer`), AC-2, AC-6(값 파싱), AC-7 ①②④~⑦, AC-8, AC-13, AC-16, AC-20: 요청 본문의 속성 집합(모르는 속성 없음, `userId` 규칙, 빈 `previousConditions` 생략, `previousConditions` 안쪽 null 유지), Modal 헤더(공백뿐인 값 제외), 응답 변환(어느 깊이든 모르는 속성 무시, 빠진 목록은 빈 목록), 읽을 수 없는 응답의 종류(모르는 enum 값 포함), `BUSY` 판정과 한 번 재시도, `Retry-After` 읽기(정수 초, 상한, 없거나 읽을 수 없는 값)와 대기 전 남은 예산 판정과 대기 중 interrupt(대기는 주입한 함수로 기록만 한다), 200 외 상태 분류와 로그의 `code`(대문자 상수만, 그 밖의 값은 상태 코드만), 걸린 시간, 차단이 풀릴 때 건너뛴 수, 공백뿐인 주소(①), 이름 풀이 실패·연결 끊김(②), 형식이 잘못된 주소와 그 밖의 예외(⑦), 목록 안 null 원소(⑦), 실패 종류와 로그 수준, 차단기(3번·30초·⑥⑦ 미집계·성공 시 해제·실패한 시험 호출 뒤 재차단·차단 중 끝난 실패의 끝 시각 연장·차단 중 끝난 성공의 해제·차단 시작/해제 로그, 시각은 주입한 `Clock`), 실패 로그에 본문 표식이 없음을 잡는다. 실제 네트워크와 Modal 프록시는 놓친다. Prior art: `be/src/test/java/kr/co/fitdining/api/onboarding/AiTasteAnalyzerTests.java`.
- AI 클라이언트 시간 예산과 동시성 상한 (example, JDK 내장 `com.sun.net.httpserver.HttpServer`로 늦게 응답), AC-7 ③⑩, AC-8, AC-28: `MockRestServiceServer`는 요청 팩토리를 바꿔 실제 타임아웃이 돌지 않으므로 실제 HTTP 서버로 확인한다. 예산 값은 짧게 주입한다. 헤더 뒤 본문이 늦는 응답을 포함한 시간 초과, `BUSY` 뒤 재시도가 예산을 넘지 않음, `Retry-After`만큼 실제로 기다린 뒤 재요청함, 대기 뒤 남은 예산이 모자라면 재요청하지 않음, 시간 초과 로그에 본문 표식이 없음, 상한만큼 기다리는 중에 온 검색이 permit 대기 시간만 기다리고 AI를 부르지 않고 대체되며 차단기를 바꾸지 않음, 기다리는 동안 permit이 반납되면 AI를 부름, permit 대기가 예산 안에서 끝남, 실패한 검색도 permit을 반납함을 잡는다. Prior art: `AiTasteAnalyzerTests#configuredProfileTimeout_throwsTimeout`.
- DB 모드 엔진 (example, 가짜 AI 클라이언트 + 가짜 카탈로그·키워드 검색), AC-1, AC-4, AC-5, AC-7 ⑧⑨, AC-9 ~ AC-12, AC-15, AC-16(⑧⑨ 로그, 성공 시 `models` 로그), AC-20(엔진 로그), AC-21, AC-23: 요청마다 AI 호출("근처 맛집" 포함), `cursor`(빈 문자열 포함)면 AI를 부르지 않고 400 예외, 순서 유지, `conditions`·`nearby`·`changeSummary`·`emptyReason` 옮기기와 빠진 값의 기본값, 중복 id 제거, 없는 id 제외와 WARN 로그, 전부 없을 때 대체와 헤더 값, 키워드 대체의 순서(20곳 → id 읽기)와 카탈로그에 없는 히트 제외, 대체 카드 모양과 `emptyReason` 문구, DB 예외와 키워드 검색의 503 예외를 삼키지 않음, AI 클라이언트의 예상 못 한 예외는 대체로 바꿈, 넘겨받은 회원 id만 `userId`가 됨, 자동완성·상세는 AI를 부르지 않음을 잡는다. HTTP 직렬화는 놓친다. Prior art: `be/src/test/java/kr/co/fitdining/api/place/engine/CatalogPlaceSearchEngineTest.java`, `be/src/test/java/kr/co/fitdining/api/place/keyword/FakePlaceCatalog.java`.
- 컨트롤러 (example, `@WebMvcTest` + 가짜 엔진·`AuthUseCases`, `OutputCaptureExtension`), AC-3, AC-4, AC-6(헤더), AC-7(헤더), AC-15, AC-17, AC-18, AC-20, AC-21, AC-22: `X-Fallback` 헤더, 401과 만료 `type`, `Bearer` 아닌 헤더와 빈 헤더, 토큰 없는 비회원 처리, 판단 순서(401 → 본문 400 → `cursor` 400), `cursor: null`은 커서 없음, `preferences` 검증 400(회원 포함)과 옛 모양 400(Mock 포함), 본문 `userId` 400, DB 오류 503, 로그에 표식이 없음, Mock 모드 페이지 나눔·잘못된 커서 400·헤더 없음, 자동완성·상세가 잘못된 `Authorization`을 무시함을 잡는다. DB 모드의 `cursor` 400(AC-4)은 실제 DB 모드 엔진과 가짜 AI 클라이언트를 붙인 컨트롤러 예시(`PlaceControllerMockDisabledTest` 방식)로 HTTP 수준에서도 확인한다. Prior art: `be/src/test/java/kr/co/fitdining/api/place/PlaceControllerTest.java`, `be/src/test/java/kr/co/fitdining/api/place/PlaceControllerMockDisabledTest.java`, `be/src/test/java/kr/co/fitdining/api/review/ReviewControllerTest.java`.
- 기동 (example, Spring Boot 기동, Postgres 테스트 컨테이너), AC-14, AC-19: 주소가 빈 값이거나 닿지 않는 주소로 웹 앱이 뜨고 readiness가 UP인지, `migrate` 프로필이 인증 환경 없이 뜨고 끝나는지를 잡는다. Prior art: `be/src/test/java/kr/co/fitdining/api/auth/AuthServiceTests.java#migrate_withoutAuthEnvironment_startsAndCloses`(이미 DB 모드 전체 컨텍스트를 띄워 AC-19를 지킨다), readiness는 `ManagementEndpointsTest`.
- 카탈로그 id 읽기 (example, Postgres 통합), AC-5의 장소 요약·영업 상태: 여러 id를 한 번에 읽기, 없는 id 누락, 결과 모양을 잡는다. Prior art: `be/src/test/java/kr/co/fitdining/api/place/catalog/JdbcPlaceCatalogTest.java`.
- AI 뷰 (example, Postgres 테스트 컨테이너에 전체 마이그레이션), AC-24: 뷰의 컬럼 이름, `profile`·`facilities`의 값(표의 이름 → 코드, 없는 시설은 키 없음), 프로필 없는 장소 제외를 잡는다. AI 코드가 실제로 읽는지는 놓친다(수동). Prior art: `be/src/test/java/kr/co/fitdining/api/place/catalog/JdbcPlaceCatalogTest.java`.
- FE 검색 API (example, Vitest + 가짜 `fetch`), AC-25, AC-26(헤더와 본문), AC-27(헤더 읽기): 검색만 15초이고 자동완성·상세는 10초, 넘긴 토큰과 `preferences`가 실림, `X-Fallback` 값 읽기를 잡는다. Prior art: `fe/src/domains/place/api/place-api.test.ts`, `fe/src/shared/api/client.test.ts`.
- FE 검색 세션 연결 (example, Vitest + 가짜 세션·저장소), AC-26: 회원·비회원·확인 못 함에 따라 싣는 값, 만료 뒤 한 번 갱신, 화면 상태와 검색 기록의 요청에 `preferences`가 없음을 잡는다. Prior art: `fe/src/app/search-thread-storage.test.ts`, `fe/src/app/use-bookmark-access.test.tsx`.
- FE 결과 화면 (example, Testing Library), AC-27: 대체 결과의 안내 문구(홈 주변 카드와 검색 결과), 카드가 없을 때 안내 없음, 홈 대체 결과의 다시 받기를 잡는다. Prior art: `fe/src/domains/place/ui/search-screen.test.tsx`.
- 목적별 API 컨트롤러 (example, `@WebMvcTest` + 가짜 엔진, Mock 엔진, 실제 DB 모드 엔진과 가짜 AI 클라이언트), AC-29, AC-30, AC-31(본문·헤더·판단 순서·DB 모드 `cursor` 400), AC-22, AC-33(HTTP 수준 한 예), AC-20(새 API의 로그): `mapBounds` 없음·null·네 값 중 하나 없음·null·`1e400`·위도/경도 범위 밖·경계값(-90, 90, -180, 180) 통과·`swLat == neLat`·`swLng > neLng`, 모르는 속성(nearby의 `query`, region의 `previousConditions`, `userId`), region `query` 검증과 배열 `conditions`, 본문 400 → `cursor` 400 순서, 400일 때 AI를 부르지 않음, `/places/search`는 범위 밖·뒤집힌 bounds도 받음, 200·400·401·503 응답 뒤 로그에 `query`·`conditions`·`preferences` 표식과 `mapBounds` 고유 좌표(예: 37.4987654321)가 없음을 잡는다. 401 → 400 순서는 Security 설정이 있어야 해서 아래 인증 이음매에서 잡는다. Prior art: `be/src/test/java/kr/co/fitdining/api/place/PlaceControllerTest.java`, `be/src/test/java/kr/co/fitdining/api/place/PlaceControllerMockDisabledTest.java`.
- 목적별 API 인증 (example, `@WebMvcTest` + `SecurityConfiguration` + 실제 DB 모드 엔진 + `MockRestServiceServer`), AC-3, AC-21, AC-31: 두 새 경로가 헤더도 세션도 없는 비회원에게 200이고, 세션 주체(CSRF 토큰과 함께)와 Bearer가 AI 요청의 `userId`가 되며 그때 `tasteProfile`이 없고, 비회원이 두 새 경로에 실은 `preferences`가 AI 요청의 `tasteProfile`까지 이어지며, 잘못된 Bearer는 401, 만료 Bearer는 만료 `type`, 본문이 틀리고 Bearer도 무효면 401, 세션만 있고 CSRF 토큰이 없으면 403임을 잡는다. 같은 구성에서 새 경로의 `preferences` 검증 400과 옛 모양 400, 카탈로그 DB 오류 503도 잡는다. Prior art: `be/src/test/java/kr/co/fitdining/api/place/engine/SessionSearchHttpTests.java`.
- AI 클라이언트 목적별 본문 (example, `MockRestServiceServer`), AC-2, AC-36: 목적마다 본문 속성 집합(NEARBY의 상수 `query`·`rulesOnly`·네 값 `mapBounds`, REGION의 `conditions` → `previousConditions`·빈 `conditions` 생략·`mapFirst`, SEARCH에 두 플래그 없음), 세 목적 모두의 `userId`·`tasteProfile` 규칙, NEARBY 실패로 시작한 차단이 SEARCH·REGION도 막음(같은 차단기), permit 상한이 목적과 상관없이 하나임(늦게 응답하는 HTTP 서버를 쓰는 시간 예산 이음매 방식), 실패 로그에 `mapBounds` 고유 좌표와 `conditions` 표식이 없음을 잡는다. Prior art: `be/src/test/java/kr/co/fitdining/api/place/engine/AiSearchClientTest.java`.
- DB 모드 엔진 목적별 (example, 가짜 AI 클라이언트 + 가짜 카탈로그·키워드 검색), AC-1, AC-9 ~ AC-12, AC-32, AC-34, AC-35: 목적이 AI 클라이언트까지 전달됨, "근처 맛집" SEARCH도 키워드 대체, SEARCH 대체가 `mapBounds` 유무·값과 무관함, NEARBY·REGION 대체의 개수·순서·`nearby`·`conditions: {}`·지역 문구, 영역 대체가 카탈로그 전체 읽기를 쓰지 않음, NEARBY AI 결과의 카탈로그 확인 뒤 10곳 자르기(앞쪽 id가 카탈로그에 없을 때 포함)와 `totalCount`, SEARCH·REGION은 자르지 않음, NEARBY·REGION의 AI 카드 id가 전부 카탈로그에 없으면 영역 대체(⑧), AI 결과를 영역으로 다시 거르지 않음, 영역 조회의 DB 예외를 대체로 삼키지 않음, 엔진 로그에 좌표 표식이 없음을 잡는다. Prior art: `be/src/test/java/kr/co/fitdining/api/place/engine/CatalogPlaceSearchEngineTest.java`.
- Mock 엔진 목적별 (example, 고정 시계와 `mock/places.json`), AC-22, AC-33, AC-34, AC-35: NEARBY 10곳·`nearby: true`·`totalCount`, 강남 밖 영역의 빈 결과와 `emptyReason`, REGION 페이지가 같은 영역으로 이어지고 영역 밖 장소가 없음, 경계 포함, 빈 `cursor`, REGION의 `conditions` 되돌림(있음, 없음, null)과 `changeSummary` 없음·잘못된 커서 400·넘어간 빈 페이지·`totalCount`, `X-Mock-Scenario: empty`의 세 목적과 커서가 있을 때 헤더 무시, `preferences`가 결과를 바꾸지 않음, SEARCH에서 "근처"가 결과를 바꾸지 않음을 잡는다. Prior art: `be/src/test/java/kr/co/fitdining/api/place/engine/MockPlaceSearchEngineTest.java`.
- 카탈로그 영역 읽기 (example, Postgres 통합), AC-9, AC-11, AC-35: 경계 포함, `place_id` 오름차순, 개수 상한, 영역 밖 제외를 잡는다(`places.lat`·`lng`는 `NOT NULL`이라 좌표 없는 장소는 없다). 기존 `strict` 카탈로그처럼 DB 오류를 일으켰을 때 예외 메시지와 장소 예외 처리의 로그에 고유 좌표가 없음(AC-20의 503 경로)도 잡는다. Prior art: `be/src/test/java/kr/co/fitdining/api/place/catalog/JdbcPlaceCatalogTest.java`.
- 검색 기록 저장 (example, 기존 search-thread 저장 테스트), D-18 `TurnFormat` reuse: region의 새 요청 모양 `{query, conditions, mapBounds}`를 담은 turn이 그대로 저장되고 읽힘을 잡는다. Prior art: `be/src/test/java/kr/co/fitdining/api/searchthread/SearchThreadPersistenceTest.java`.
- 수동 (manual), D-18 배포 확인: AI(S15P31A302-196)가 배포된 뒤, DB 모드로 도는 BE(운영 배포 뒤의 서버, 또는 로컬 `PLACE_MOCK_ENABLED=false`에 그 AI 서버를 붙인 BE)에서 Usage 1과 5의 curl이 `X-Fallback` 없이 AI 결과로 오는지 확인한다. dev는 Mock 모드라 이 확인에 쓰지 않는다. AI가 배포되기 전에는 두 요청이 ⑥으로 `AI_UNAVAILABLE` 대체되는 것이 맞다(Assumption 11).
- 수동 (manual): Usage 4의 curl로 AI를 끈 대체와 헤더를, 3으로 답변 검증을 확인한다. AC-24의 뷰는 마이그레이션을 적용한 로컬 DB에서 AI `PgPlaceStore`로 읽혀 후보가 나오는지 확인한다. AI 성공 경로의 실제 연동은 D-13 선행 작업 뒤라 이번 계획에 없다.

이 spec과 어긋나는 기존 테스트는 이 spec의 기준으로 바꾼다. 확인된 것: `PlaceControllerMockDisabledTest#search_naturalLanguage_returnsServiceUnavailable`, `#search_withCursor_returnsServiceUnavailable`, `CatalogPlaceSearchEngineTest`의 "근처" 분기와 빈 문자열 `cursor`를 커서 없음으로 보는 검사, `PlaceControllerTest`에서 예전 모양 `preferences`를 쓰는 검사(`search_preferences_acceptedButIgnored` 등). 장소 `@WebMvcTest`들은 가짜 `AuthUseCases`가 필요하고, `PlaceEngineWiringTest`는 새 AI 클라이언트의 의존 빈을 줘야 한다. -201에서 확인된 것: `CatalogPlaceSearchEngineTest`의 홈 요청 판정과 SEARCH 대체의 `mapBounds` 거르기 검사, `MockPlaceSearchEngineTest`와 `PlaceControllerTest`의 "근처" 질의 검사(place-search AC-4)와 "근처" 질의로 전체 장소를 받던 `MockPlaceSearchEngineTest`의 카드 도우미(`cards()`, 이를 쓰는 영업 상태 검사가 범위를 잃지 않게 전체 장소를 받는 다른 방법으로 바꾼다), "근처 맛집" 홈 대체에 기대는 `PlaceControllerMockDisabledTest#search_aiUnavailable_returnsFallbackWithHeader`·`#search_catalogError_returnsServiceUnavailable`과 `CatalogPlaceSearchEngineTest#fallback_keywordAndCatalogErrors_propagate`(AC-7 헤더와 AC-15는 SEARCH 키워드 대체나 영역 조회의 DB 예외로 다시 증명한다). `PlaceCatalog`에 기능이 늘면 테스트용 `be/src/test/java/kr/co/fitdining/api/place/keyword/FakePlaceCatalog.java`도 따라간다.

## Out of scope

- 칩의 문장 벡터(`vector`) 만들기와 싣기(회원·비회원 모두) (D-4)
- 검색 기록에서 연 과거 결과의 대체 안내 (D-6, D-16)
- 사용자·IP별 속도 제한(인프라 BE 계약 #18), 호출·폴백 지표(`modal_*_total`) (D-1)
- BE 검색 결과 캐시와 홈 결과 캐시 (D-9)
- 검색 기록(search-thread)에 대체 표시 남기기, 대체된 후속 검색의 조건 이어 붙이기 (D-6)
- 대체 결과에 BE가 점수 매기기 (D-6)
- 회원 취향 계산·저장(S15P31A302-129가 함) (D-12)
- 인프라·AI 쪽 선행 작업: AI 컨테이너, `MODAL_BASE_URL` 내부 주소, dev·prod 장소 적재, AI 임베딩·적재 벡터의 인코더 확인·예시 id 맞추기 (D-13)
- 뷰를 BE 컬럼 그대로의 모양으로 바꾸기(AI가 BE 컬럼을 그대로 읽기로 하면) (D-15)
- BE가 Modal이나 OpenSearch를 직접 부르기 (D-2)
- Mock 엔진이 AI를 부르기 (D-1)
- FE가 새 API를 부르기, 지도 영역 정규화·cache, 위치 처리(place-search, S15P31A302-202~204) (D-18)
- AI의 `rulesOnly`·`mapFirst`와 지역 우선순위 변경(S15P31A302-196) (D-18)
- `/places/search`의 `mapBounds` 검증, "근처 맛집" 문자열 호환 분기 (D-18)
- BE가 AI 성공 결과를 지도 영역으로 다시 거르기 (D-18)

## Open questions

- AI의 근처 검색 로직이 확정되면 모두에게 같은 홈 결과 하나를 캐시할지 다시 본다. (D-9)
