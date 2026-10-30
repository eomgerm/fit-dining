# place-ai-search decisions

Glossary: none · ADRs: none

## D-1 범위
- Status: settled
- Decision: 이번 반복은 BE만 한다. DB 모드 엔진의 추천 검색을 AI 검색 API로 바꾸고, AI 결과에 장소 정보를 붙이고, AI 실패 시 대체와 `X-Fallback`, 차단기, 로그인 선택과 비회원 온보딩 답변 전달을 만든다. Mock 엔진과 `PLACE_MOCK_ENABLED`는 그대로라 local과 dev는 계속 Mock이고, AI 연동은 장소 DB가 적재된 뒤 스위치를 끄면 보인다. 동작 확인은 가짜 AI 서버를 쓰는 테스트로 한다. 사용자·IP별 속도 제한(인프라 BE 계약 #18), 호출·폴백 지표, BE 결과 캐시(D-9), FE 변경은 범위 밖이다.
- Rejected: Mock 엔진도 AI를 부르고 `mock/places.json`으로 카드 채우기 → AI 예시 장소와 BE Mock의 id가 맞지 않아 연결이 어렵고, Mock을 쓸 거면 AI가 필요 없다.

## D-2 AI 파트와의 경계
- Status: settled
- Decision: DB 모드 엔진의 추천 검색이 AI 검색 API(`POST /v1/search`, 명세 `ai/docs/comparison/api.md`)를 부른다. AI는 요청 해석, 후보 추출, 정렬, 카드의 AI 필드(점수, 라벨, 이유, 점수 항목)와 `conditions`를 맡고, BE는 장소 정보와 영업 상태를 붙인다. 엔진 관련 코드는 `kr.co.fitdining.api.place.engine`에 둔다. place-search#D-62의 "연동 주체 미결"을 이 결정으로 정한다.
- Rejected: BE가 Modal이나 OpenSearch를 직접 부르기 → 해석부터 정렬까지 AI 서버가 맡는다.
- Reuse: `be/src/main/java/kr/co/fitdining/api/place/engine/CatalogPlaceSearchEngine.java#CatalogPlaceSearchEngine` (modify) — 추천 검색을 AI 호출로 바꾸고 자동완성과 상세는 그대로 둔다

## D-3 AI 서버 주소와 호출 방식
- Status: provisional
- Decision: 검색은 온보딩 취향 연결(S15P31A302-129)과 같은 AI 주소 설정(`fitdining.ai.base-url`, 환경변수 `MODAL_BASE_URL`)을 쓰고, 검색만의 켜고 끄는 스위치는 두지 않는다. 주소가 비었거나 닿지 않아도 앱은 정상으로 뜨고 검색만 대체한다(D-6). 한 검색에서 AI를 기다리는 시간은 재시도까지 합쳐 8초이고, `503 BUSY`면 그 안에서 한 번 다시 부른다. 차단기: 시간 초과, 연결 실패, 5xx, 재시도 뒤 `BUSY`가 3번 연달아 나면 30초 동안 AI를 부르지 않고 바로 대체하며, 그 뒤 첫 요청이 한 번 시도해 성공하면 원래대로 돌아간다. 4xx와 읽을 수 없는 응답은 대체하되 차단기 실패로 세지 않는다. 실패 원인은 본문 없이 로그에 남기고, 4xx·읽을 수 없는 응답·주소 없음은 error 수준이다.
- Default: 서버에서는 인프라가 `MODAL_BASE_URL`을 내부 주소(dev `http://ai-dev:8000`)로 맞추고, 그때 `Modal-Key`·`Modal-Secret`은 비워 둔다. 8초는 FE 검색 요청이 10초에 끊기기 때문이며(`fe/src/shared/api/client.ts`의 기본값), FE가 검색 요청만 15초로 늘리면(D-13) 12초로 되돌린다. 3번과 30초는 임시값이다. 차단기 상태는 BE 메모리의 값 두 개(연속 실패 수, 다시 열 시각)라 컨테이너마다 따로이고 재시작하면 처음부터 센다.
- Rejected: 검색 전용 `AI_BASE_URL` → 같은 서버를 가리키는 주소 변수가 둘이 된다. AI 켜고 끄는 스위치 → 주소 하나로 충분하다. 주소가 비면 기동 실패 → AI 없이 띄운 로컬 BE가 뜨지 않고, readiness는 DB에만 의존해야 한다(인프라 BE 계약 #1). Resilience4j 같은 차단기 라이브러리 → 새 의존성이 늘고 필요한 동작은 값 두 개로 충분하다. 응답 타임아웃 12초 → FE가 10초에 먼저 끊어 대체 결과가 화면에 닿지 못한다. 4xx도 차단기 실패로 세기 → 요청 몇 개의 문제로 모든 사용자가 30초 동안 대체 결과를 받는다.
- Reuse: `be/src/main/resources/application.yml#fitdining` (reuse) — AI 주소 설정을 온보딩과 함께 쓴다

## D-4 취향과 인증
- Status: provisional
- Decision: `POST /api/v1/places/search`는 로그인을 선택으로 받는다. 유효한 토큰이면 그 회원 id만 AI에 보내고 `preferences`는 넘기지 않는다. 토큰이 없으면 비회원이고, FE가 기기에 저장한 온보딩 답변을 `preferences`(가입과 같은 모양과 검증: `mood`, `priorities`, `purposes`, `tastes`)로 보내면 BE는 가입과 같은 규칙으로 정리한 값을 AI에 넘긴다. 답변이 없으면 취향 없이 검색하고, 답변이 검증에 맞지 않으면 400이다. 토큰이 있는데 유효하지 않으면 다른 API와 같은 401 ProblemDetail이고, 만료면 같은 `type`(`urn:fitdining:auth:access-token-expired`)이다. 인증을 붙여도 웹 서버 없이 뜨는 `migrate` 프로필 기동이 깨지지 않는다. place-search#D-33을 대신한다. Mock은 `preferences`를 받기만 하고 반영하지 않는다.
- Default: 비회원 답변을 받는 AI 쪽 입구는 AI 담당이 고치고 있다(지금 `tasteProfile`은 `"schema": "taste-profile/v0"`가 없으면 `TASTE_INVALID`로 무시한다). 그 수정이 머지될 때까지 BE는 답변을 AI에 보내지 않고, 머지되면 그 수정이 정한 칸에 담는다. 본문이 틀리고 토큰도 무효면 401보다 400이 먼저 나가는 것, 만료 토큰으로 연 홈 화면이 401이 되는 것(FE의 토큰 갱신 후 재요청에 맡김), 토큰 확인이 DB를 보지 않아 탈퇴한 회원의 토큰도 회원으로 통과하는 것(취향이 지워져 AI가 취향 없이 처리)은 감수한다. FE가 기기 답변을 읽을 때 지금 선택지에 없는 값이면 지우고 보내지 않으므로 400은 드물다.
- Rejected: JWT를 읽지 않고 `preferences`를 태그 코드 목록으로 받기(place-search#D-33) → 회원 취향은 AI가 DB에서 읽고, 비회원은 기기에 온보딩 답변만 있다. 토큰이 잘못되면 비회원으로 계속 → 로그인한 사람이 조용히 취향 없는 결과를 받는다. BE가 `/v1/taste/profile`로 `features`를 만들어 넘기기 → AI의 값을 AI에 중계할 뿐이다. FE가 `features`를 만들어 저장 → FE가 AI 코드표를 알아야 한다. AI 수정 전에 임시 칸에 담아 보내기 → AI가 4xx를 내 답변을 보낸 비회원이 대체 결과를 받는다. 틀린 답변은 버리고 검색 계속 → FE가 이미 틀린 값을 걸러 보내지 않아 얻는 것이 적다.
- Reuse: `be/src/main/java/kr/co/fitdining/api/user/Preferences.java#Preferences` (reuse) — 비회원 답변의 모양과 검증

## D-5 AI 결과를 카드로 만들기
- Status: settled
- Decision: AI 응답의 `placeId`들로 카탈로그에서 장소 정보를 한 번에 읽어 카드의 `place`와 `openStatus`를 채우고, 점수·라벨·이유·점수 항목은 AI 값을 그대로 쓴다. 카드 순서는 AI 응답 순서 그대로이고 다시 정렬하지 않는다. 카탈로그에 없는 id의 카드는 빼고 로그를 남긴다. `conditions`, `nearby`, `changeSummary`, `emptyReason`은 그대로 옮기고, `totalCount`는 남은 카드 수, `nextCursor`는 없다. `interpretedBy`, `rankedBy`, `models`는 로그에만 쓴다. AI 요청은 BE 요청과 다른 별도 모양으로 보내 `cursor`를 넣지 않고, 요청의 `previousConditions`가 빈 객체(`{}`)면 없는 것으로 보아 보내지 않는다. AI 응답의 모르는 칸은 무시한다.
- Reuse: `be/src/main/java/kr/co/fitdining/api/place/catalog/PlaceCatalog.java#PlaceCatalog` (modify) — id 목록으로 카드용 장소 정보를 읽는 기능을 더한다 · `be/src/main/java/kr/co/fitdining/api/place/catalog/OpenStatusCalculator.java#OpenStatusCalculator` (reuse) — 카드의 영업 상태 계산

## D-6 AI 실패 시 대체
- Status: provisional
- Decision: D-3의 실패(주소 없음과 차단기가 열린 동안 포함), 200이지만 읽을 수 없는 응답, 카드가 있는데 id가 하나도 카탈로그에 없는 응답이면 AI 없이 평소와 같은 모양의 정상 응답을 준다. 홈 요청(문장이 정확히 "근처 맛집"이고 `previousConditions`가 없거나 빈 객체인 요청, `mapBounds`는 있어도 됨)이면 카탈로그 전체(`nearby: true`), 그 밖에는 키워드 검색 결과를 카드로 준다. `mapBounds`가 있으면 그 영역 안의 장소만 남기고(빈 값은 그쪽을 제한하지 않음), 키워드 결과는 영역으로 거른 뒤 앞 20곳으로 자른다. 카드에 점수, 라벨, 이유는 없다. `conditions`는 받은 `previousConditions`(없거나 빈 객체면 `{}`)이고 다음 페이지는 없다. 남은 결과가 없으면 빈 목록과 `emptyReason`을 준다. 이 응답에는 `X-Fallback: AI_UNAVAILABLE`을 붙인다(D-7).
- Default: `emptyReason`은 원인 "지금은 가게 이름, 메뉴, 업종, 역 이름으로만 찾을 수 있어요", 제안 "가게 이름이나 메뉴 이름으로 다시 검색해 보세요"이다. FE·기획과 문구를 맞추면 바꾼다. 키워드 검색은 모든 단어를 담은 장소만 찾아 문장 검색은 장애 동안 자주 빈 결과가 되는 것, 대체된 후속 검색이 조건 이어짐에서 빠지고 검색 기록에 대체 표시가 남지 않는 것, FE가 홈 대체 결과를 페이지가 열린 동안 계속 보여 주는 것은 감수한다(FE가 헤더를 읽으면 풀림). DB 장애는 AI 장애가 아니어서 지금처럼 503이다.
- Rejected: 503 오류 화면 → AI 장애가 곧 검색 불가가 되고 인프라 설계 §11.2가 키워드 대체를 요구한다. BE가 대체 결과에 점수를 매기기 → 리뷰 근거가 없는 숫자다. 문장에 "근처"가 들어 있으면 카탈로그 전체 → "강남역 근처 카페"가 역과 업종을 무시한 근처 결과가 된다. `mapBounds`가 있으면 홈 요청이 아님 → 위치를 못 얻은 사용자의 홈이 대체 때 늘 빈 결과가 된다.
- Reuse: `be/src/main/java/kr/co/fitdining/api/place/keyword/PlaceKeywordSearch.java#PlaceKeywordSearch` (reuse) — 키워드 대체 결과를 얻는다

## D-7 `X-Fallback` 헤더
- Status: settled
- Decision: AI 응답의 `fallbacks`가 하나라도 있거나 BE가 AI 없이 응답하면 검색 응답에 `X-Fallback` 헤더(사유를 쉼표로 이은 값)를 붙인다. 값은 AI의 `fallbacks` 그대로와 BE의 `AI_UNAVAILABLE`이다(인프라 BE 계약 #17).

## D-8 모든 추천 검색은 AI로
- Status: settled
- Decision: DB 모드에서는 홈 화면의 고정 문장 "근처 맛집"을 포함해 모든 첫 페이지 검색을 AI로 보낸다. place-lookup-db#D-13("근처"만 카탈로그 전체, 나머지는 503)을 대신한다.
- Rejected: 문장이 정확히 "근처 맛집"이면 AI 없이 처리 → 홈 카드에도 AI의 라벨과 점수가 필요하다. "근처"가 들어간 문장은 AI 없이 처리 → "강남역 근처 조용한 카페"도 해석되지 않는다.

## D-9 결과 캐시는 두지 않는다
- Status: provisional
- Decision: 이번에는 BE에 검색 결과 캐시를 두지 않는다. 홈 화면도 앱을 열 때마다 AI를 기다린다. 앱 안에서 다른 화면에 갔다가 홈으로 돌아올 때는 FE의 메모리 캐시(홈 추천 카드 요청은 다시 받지 않음)가 결과를 다시 쓴다.
- Default: AI의 근처 검색 로직이 확정되면 홈 결과 캐시를 다시 본다. 지금 AI 코드의 근처 검색은 취향을 순서와 점수에 쓰지 않아(`ai/src/fit_ai/match/search.py`의 근처 분기), 확정되면 모두에게 같은 결과 하나를 캐시하는 안이 가능하다.
- Rejected: 회원별로 04:00까지 캐시 → 근처 정렬에 취향이 쓰이지 않아 얻는 것이 적고, 메모리 증가·탈퇴 뒤 잔존·키 구분·빈 결과 고정을 따로 막아야 한다. 모두에게 같은 결과 하나를 캐시 → AI의 근처 로직이 아직 반영되지 않았다. Redis → BE에 Redis 의존성이 없다.

## D-10 다음 페이지
- Status: settled
- Decision: 요청의 `cursor`와 응답의 `nextCursor` 필드는 남긴다(Mock이 쓴다). DB 모드 응답에는 `nextCursor`가 없고, `cursor`가 오면 400이다. FE는 바꾸지 않는다.
- Rejected: 두 필드를 없애기 → Mock의 페이지 나눔과 FE 코드를 함께 바꿔야 한다.
- Reuse: `be/src/main/java/kr/co/fitdining/api/place/engine/InvalidCursorException.java#InvalidCursorException` (reuse) — 커서가 온 DB 모드 요청을 400으로 돌려준다

## D-11 절대 일어나면 안 되는 일
- Status: settled
- Decision: 회원 id는 검증된 토큰에서만 꺼내고, 요청 본문이나 비회원 답변 속 값을 회원 id로 보내지 않는다. 한 사람의 취향으로 만든 결과가 다른 사람에게 가지 않는다. AI가 준 장소 id가 카탈로그에 없으면 그 카드를 빼고 다른 장소 정보로 채우지 않는다. 검색 문장, 비회원 답변, AI 요청·응답 본문을 로그에 남기지 않는다(place-search#D-20을 넓힌다). AI가 실패해도 오류 화면이 아니라 대체 결과를 주고, 그때는 반드시 `X-Fallback`을 붙인다. 카드 순서는 AI 응답 순서 그대로다.

## D-12 회원 취향은 가입 때 저장된 값을 쓴다
- Status: settled
- Decision: 회원 취향(`user_preferences.features`)은 S15P31A302-129가 가입 때 AI `/v1/taste/profile`로 계산해 저장하고(스위치 `TASTE_PROFILE_ENABLED`, 기본 꺼짐, 실패하면 빈 목록), AI 검색이 DB에서 직접 읽는다. 검색 쪽 BE는 회원 id만 보내고 취향을 따로 계산하거나 저장하지 않는다. 스위치가 꺼진 환경과 -129 이전에 가입한 회원은 `features`가 비어 취향 없이 정렬된다.
- Rejected: 검색 작업에서 회원 `features` 저장까지 만들기 → -129가 가입 흐름에서 이미 한다.

## D-13 연동 전에 다른 담당이 풀어야 할 것
- Status: settled
- Decision: 이번 BE 작업과 별개로 실제 연동 전에 풀려야 한다. 인프라: FastAPI 이미지와 컨테이너(Modal은 내부망 Postgres에 닿지 못함), `MODAL_BASE_URL`을 내부 주소로, dev·prod의 `places`·`place_profiles`·`place_personas` 적재. AI: 질의 임베딩을 Modal `/embed` 호출로, 개발용 뷰 `ai_place_search` 대신 실제 테이블, 비회원 답변 받기(진행 중), 예시 장소 id 맞추기(`S15P31A302-41/fix/dev-db-mock-format` 미머지). FE: 검색 요청만 타임아웃 15초, 토큰과 비회원 답변 싣기, `preferences` 타입, `X-Fallback` 읽기. 근처 검색은 AI가 위치 없이 100곳을 주고 FE가 1km로 걸러 남는 곳이 적을 수 있으나, 위치를 보내지 않는 place-search#D-82와 부딪혀 AI 쪽 해법이 필요하다.

## D-14 테스트
- Status: settled
- Decision: 새 의존성은 더하지 않는다. AI 클라이언트는 `MockRestServiceServer`로 요청 본문(모르는 칸 없음, 회원 id와 답변 규칙, 빈 `previousConditions` 생략), 응답 변환(모르는 칸 무시), 8초 안의 재시도, 실패 종류, 차단기(4xx는 세지 않음)를 확인한다. 엔진은 가짜 AI 클라이언트로 순서 유지, 없는 id 제외, 대체 규칙(홈 문장, 지도 영역, 읽을 수 없는 응답, id가 전부 없는 응답)을 확인한다. 컨트롤러 테스트는 `X-Fallback`, 잘못된 토큰과 만료 토큰의 401, 토큰 없는 요청의 비회원 처리를 확인한다. `migrate` 프로필 기동이 깨지지 않음을 확인한다. id로 카드 읽기는 Postgres 통합 테스트로 확인한다.
