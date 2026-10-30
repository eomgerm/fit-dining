# place-ai-search decisions

Glossary: none · ADRs: none

## D-1 범위
- Status: settled
- Decision: 이번 반복은 BE만 한다. DB 모드 엔진의 추천 검색을 AI 검색 API로 바꾸고, 카드 조립, AI 실패 시 대체와 `X-Fallback`, 차단기, 선택 로그인과 비회원 답변 받기를 만든다. Mock 엔진과 `PLACE_MOCK_ENABLED`, FE는 그대로이고 동작은 가짜 AI 서버 테스트로 확인한다. 범위 밖 목록은 spec.md Out of scope.
- Rejected: Mock 엔진도 AI를 부르고 `mock/places.json`으로 카드 채우기 → AI 예시 장소와 BE Mock의 id가 맞지 않아 연결이 어렵고, Mock을 쓸 거면 AI가 필요 없다.

## D-2 AI 파트와의 경계
- Status: settled
- Decision: DB 모드 엔진의 추천 검색이 AI 검색 API(`POST /v1/search`, `ai/docs/comparison/api.md`)를 부른다. AI는 해석·후보·정렬·카드의 AI 필드와 `conditions`를, BE는 장소 정보와 영업 상태를 맡는다. place-search#D-62의 "연동 주체 미결"을 정한다.
- Rejected: BE가 Modal이나 OpenSearch를 직접 부르기 → 해석부터 정렬까지 AI 서버가 맡는다.

## D-3 AI 서버 주소와 호출 방식
- Status: provisional
- Decision: 검색은 온보딩과 같은 AI 주소 설정(`fitdining.ai.base-url`)을 쓰고 전용 스위치는 없다. AI가 없어도 앱은 뜨고 검색만 대체한다. 시간 예산, `BUSY` 재시도, 메모리 차단기, 로그 규칙은 spec.md "호출 규칙"과 AC-7·8·13·16.
- Default: 서버에서는 인프라가 `MODAL_BASE_URL`을 내부 주소(dev `http://ai-dev:8000`)로 맞추고, 그때 `Modal-Key`·`Modal-Secret`은 비워 둔다. 8초는 FE 검색 요청이 10초에 끊기기 때문이며(`fe/src/shared/api/client.ts`의 기본값), FE가 검색 요청만 15초로 늘리면(D-13) 12초로 되돌린다. 3번과 30초는 임시값이다. AI는 검색 예산 9초, 실제 응답 최대 8.6초라 느리지만 정상인 응답이 8초 시간 초과로 차단기 실패가 될 수 있고, 3번 이어지면 모두가 30초 동안 대체 결과를 받는다. 이 위험은 감수하고 12초로 바꿀 때 함께 풀린다. 차단기 상태는 BE 메모리의 값 두 개(연속 실패 수, 다시 열 시각)라 컨테이너마다 따로이고 재시작하면 처음부터 센다.
- Rejected: 검색 전용 `AI_BASE_URL` → 같은 서버를 가리키는 주소 변수가 둘이 된다. AI 켜고 끄는 스위치 → 주소 하나로 충분하다. 주소가 비면 기동 실패 → AI 없이 띄운 로컬 BE가 뜨지 않고, readiness는 DB에만 의존해야 한다(인프라 BE 계약 #1). Resilience4j 같은 차단기 라이브러리 → 새 의존성이 늘고 필요한 동작은 값 두 개로 충분하다. 응답 타임아웃 12초 → FE가 10초에 먼저 끊어 대체 결과가 화면에 닿지 못한다. 4xx도 차단기 실패로 세기 → 요청 몇 개의 문제로 모든 사용자가 30초 동안 대체 결과를 받는다.

## D-4 취향과 인증
- Status: provisional
- Decision: 검색은 로그인을 선택으로 받는다. 회원이면 회원 id만 AI에 보내고, 비회원은 가입과 같은 모양의 온보딩 답변(`preferences`)을 보낼 수 있다. 잘못된 토큰은 401, 잘못된 답변은 400이다. place-search#D-33을 대신한다. 규칙은 spec.md "취향과 인증"과 AC-3·17·18·19.
- Default: 비회원 답변을 받는 AI 쪽 입구는 AI 담당이 고치고 있다(지금 `tasteProfile`은 `"schema": "taste-profile/v0"`가 없으면 `TASTE_INVALID`로 무시한다). 그 수정이 머지될 때까지 BE는 답변을 AI에 보내지 않고, 머지되면 그 수정이 정한 칸에 담는다. 본문이 틀리고 토큰도 무효면 401보다 400이 먼저 나가는 것, 만료 토큰으로 연 홈 화면이 401이 되는 것(FE의 토큰 갱신 후 재요청에 맡김), 토큰 확인이 DB를 보지 않아 탈퇴한 회원의 토큰도 회원으로 통과하는 것(취향이 지워져 AI가 취향 없이 처리)은 감수한다. FE가 기기 답변을 읽을 때 지금 선택지에 없는 값이면 지우고 보내지 않으므로 400은 드물다.
- Rejected: JWT를 읽지 않고 `preferences`를 태그 코드 목록으로 받기(place-search#D-33) → 회원 취향은 AI가 DB에서 읽고, 비회원은 기기에 온보딩 답변만 있다. 토큰이 잘못되면 비회원으로 계속 → 로그인한 사람이 조용히 취향 없는 결과를 받는다. BE가 `/v1/taste/profile`로 `features`를 만들어 넘기기 → AI의 값을 AI에 중계할 뿐이다. FE가 `features`를 만들어 저장 → FE가 AI 코드표를 알아야 한다. AI 수정 전에 임시 칸에 담아 보내기 → AI가 4xx를 내 답변을 보낸 비회원이 대체 결과를 받는다. 틀린 답변은 버리고 검색 계속 → FE가 이미 틀린 값을 걸러 보내지 않아 얻는 것이 적다.

## D-5 AI 결과를 카드로 만들기
- Status: settled
- Decision: AI 응답의 `placeId`로 카탈로그에서 장소 정보를 한 번에 읽어 카드를 채우고, AI 필드와 순서는 그대로 쓴다. 카탈로그에 없는 id는 빼고, 같은 id가 다시 오면 처음 카드만 남긴다. 요청·응답 변환 규칙은 spec.md "AI 요청"·"AI 응답"과 AC-2·5.
- Rejected: 같은 id의 카드를 둘 다 옮기기 → FE 목록의 key가 겹친다.

## D-6 AI 실패 시 대체
- Status: provisional
- Decision: AI 실패 시 오류 대신 평소 모양의 대체 결과(홈 요청은 카탈로그 전체, 그 밖은 키워드 검색)를 준다. 규칙은 spec.md "대체 결과"와 AC-7·9~12.
- Default: `emptyReason`은 원인 "지금은 가게 이름, 메뉴, 업종, 역 이름으로만 찾을 수 있어요", 제안 "가게 이름이나 메뉴 이름으로 다시 검색해 보세요"이다. FE·기획과 문구를 맞추면 바꾼다. 키워드 검색은 모든 단어를 담은 장소만 찾아 문장 검색은 장애 동안 자주 빈 결과가 되는 것, 대체된 후속 검색이 조건 이어짐에서 빠지고 검색 기록에 대체 표시가 남지 않는 것, FE가 홈 대체 결과를 페이지가 열린 동안 계속 보여 주는 것은 감수한다(FE가 헤더를 읽으면 풀림). DB 장애는 AI 장애가 아니어서 지금처럼 503이다.
- Rejected: 503 오류 화면 → AI 장애가 곧 검색 불가가 되고 인프라 설계 §11.2가 키워드 대체를 요구한다. BE가 대체 결과에 점수를 매기기 → 리뷰 근거가 없는 숫자다. 문장에 "근처"가 들어 있으면 카탈로그 전체 → "강남역 근처 카페"가 역과 업종을 무시한 근처 결과가 된다. `mapBounds`가 있으면 홈 요청이 아님 → 위치를 못 얻은 사용자의 홈이 대체 때 늘 빈 결과가 된다.

## D-7 `X-Fallback` 헤더
- Status: settled
- Decision: AI 응답의 `fallbacks`가 하나라도 있거나 BE가 AI 없이 응답하면 검색 응답에 `X-Fallback` 헤더(사유를 쉼표로 이은 값)를 붙인다. 값은 AI 결과로 응답하면 AI의 `fallbacks` 그대로, BE가 대체 결과로 응답하면 `AI_UNAVAILABLE` 하나다. AI 응답을 받고도 대체로 끝나면 AI의 `fallbacks`는 싣지 않는다(인프라 BE 계약 #17).
- Rejected: 대체로 끝난 응답에 AI `fallbacks`와 `AI_UNAVAILABLE`을 합쳐 싣기 → AI 결과를 버렸으니 AI의 사유는 화면 결과와 무관하다.

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

## D-11 절대 일어나면 안 되는 일
- Status: settled
- Decision: 회원 id는 검증된 토큰에서만 꺼낸다. 한 사람의 결과가 다른 사람에게 가지 않는다. 없는 장소 id를 다른 장소로 채우지 않는다. 검색 문장, 답변, AI 본문을 로그에 남기지 않는다(place-search#D-20을 넓힌다). AI 실패는 대체 결과와 `X-Fallback`으로 준다. 카드 순서는 AI 순서다. spec.md AC-5·7·20·21.

## D-12 회원 취향은 가입 때 저장된 값을 쓴다
- Status: settled
- Decision: 회원 취향(`user_preferences.features`)은 S15P31A302-129가 가입 때 AI `/v1/taste/profile`로 계산해 저장하고(스위치 `TASTE_PROFILE_ENABLED`, 기본 꺼짐, 실패하면 빈 목록), AI 검색이 DB에서 직접 읽는다. 검색 쪽 BE는 회원 id만 보내고 취향을 따로 계산하거나 저장하지 않는다. 스위치가 꺼진 환경과 -129 이전에 가입한 회원은 `features`가 비어 취향 없이 정렬된다.
- Rejected: 검색 작업에서 회원 `features` 저장까지 만들기 → -129가 가입 흐름에서 이미 한다.

## D-13 연동 전에 다른 담당이 풀어야 할 것
- Status: settled
- Decision: 실제 연동 전에 인프라(AI 컨테이너, `MODAL_BASE_URL` 내부 주소, dev·prod 장소 적재), AI(Modal `/embed` 임베딩, 실제 테이블, 비회원 답변 입구, 예시 장소 id), FE(검색 15초 타임아웃, 토큰·답변 싣기, `X-Fallback` 읽기)가 풀어야 한다. 이번 BE 범위가 아니다(spec.md Out of scope). 근처 검색이 위치 없이 100곳만 주는 문제는 place-search#D-82와 부딪혀 AI 쪽 해법이 필요하다.

## D-14 테스트
- Status: settled
- Decision: 새 의존성 없이 AI 클라이언트(`MockRestServiceServer`), 엔진(가짜 AI 클라이언트), 컨트롤러, 기동, 카탈로그(Postgres 통합) 이음매로 확인한다. 상세는 spec.md Seams & test plan.
