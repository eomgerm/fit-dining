# place-ai-search decisions

Glossary: none · ADRs: none

## D-1 범위
- Status: settled
- Decision: 이번 반복은 BE와 FE를 함께 한다. BE는 DB 모드 엔진의 추천 검색을 AI 검색 API로 바꾸고, 카드 조립, AI 실패 시 대체와 `X-Fallback`, 차단기, 선택 로그인, 비회원 답변 전달, AI가 읽는 뷰를 만든다. FE는 검색 요청에 토큰이나 비회원 답변을 싣고, 검색만 타임아웃을 늘리고, `X-Fallback`을 읽는다(D-16). Mock 엔진과 `PLACE_MOCK_ENABLED`는 그대로이고 AI 동작은 가짜 AI 서버 테스트로 확인한다. 범위 밖 목록은 spec.md Out of scope.
- Rejected: Mock 엔진도 AI를 부르고 `mock/places.json`으로 카드 채우기 → AI 예시 장소와 BE Mock의 id가 맞지 않아 연결이 어렵고, Mock을 쓸 거면 AI가 필요 없다. FE는 다음 반복으로 미루기(처음 범위) → FE가 토큰과 답변을 싣지 않으면 BE 연동이 늘 비회원·취향 없음으로만 돌고, BE 예산을 12초로 되돌릴 수 없다.

## D-2 AI 파트와의 경계
- Status: settled
- Decision: DB 모드 엔진의 추천 검색이 AI 검색 API(`POST /v1/search`, `ai/docs/comparison/api.md`)를 부른다. AI는 해석·후보·정렬·카드의 AI 필드와 `conditions`를, BE는 장소 정보와 영업 상태를 맡는다. place-search#D-62의 "연동 주체 미결"을 정한다.
- Rejected: BE가 Modal이나 OpenSearch를 직접 부르기 → 해석부터 정렬까지 AI 서버가 맡는다.

## D-3 AI 서버 주소와 호출 방식
- Status: provisional
- Decision: 검색은 온보딩과 같은 AI 주소 설정(`fitdining.ai.base-url`)을 쓰고 전용 스위치는 없다. AI가 없어도 앱은 뜨고 검색만 대체한다. `BUSY`면 AI가 준 `Retry-After`만큼 기다린 뒤 한 번 재요청하되, 대기 뒤에도 AI가 처리할 시간이 남을 때만 한다. 실패 로그에는 ProblemDetail `code`와 걸린 시간을 남겨 503의 원인(임베딩, 장소 DB)과 재요청 판단을 로그로 구분한다. 지표(Micrometer)는 나중에 더한다. 시간 예산, `BUSY` 재시도, 메모리 차단기, 로그 규칙은 spec.md "호출 규칙"과 AC-7·8·13·16.
- Default: 서버에서는 인프라가 `MODAL_BASE_URL`을 내부 주소(dev `http://ai-dev:8000`)로 맞추고, 그때 `Modal-Key`·`Modal-Secret`은 비워 둔다. 시간 예산은 12초다. AI의 검색 예산 9초(실제 응답 최대 8.6초)가 들어가고, FE가 검색 요청만 15초로 기다려(D-16) BE가 12초에 포기해도 대체 결과가 화면에 닿는다. 3번과 30초는 임시값이다. 차단기 상태는 BE 메모리의 값 두 개(연속 실패 수, 다시 열 시각)라 컨테이너마다 따로이고 재시작하면 처음부터 센다. 재시도에 필요한 최소 처리 시간 3.4초는 AI API 문서의 응답 시간 중앙값이고, `Retry-After` 상한 2초는 AI가 큰 값을 보내도 요청 스레드가 오래 멈추지 않게 둔 값이다. 둘 다 임시값이라 BE가 AI 호출 시간을 잰 뒤 다시 정한다. AI의 `BUSY`는 일을 시작하기 전에 바로 오므로 보통은 예산이 11초 넘게 남아 이 조건에 걸리지 않는다.
- Rejected: 검색 전용 `AI_BASE_URL` → 같은 서버를 가리키는 주소 변수가 둘이 된다. AI 켜고 끄는 스위치 → 주소 하나로 충분하다. 주소가 비면 기동 실패 → AI 없이 띄운 로컬 BE가 뜨지 않고, readiness는 DB에만 의존해야 한다(인프라 BE 계약 #1). Resilience4j 같은 차단기 라이브러리 → 새 의존성이 늘고 필요한 동작은 값 두 개로 충분하다. 8초(처음 값. FE가 10초에 끊던 때) → AI 예산 9초보다 짧아 느리지만 정상인 응답이 시간 초과로 차단기 실패가 되고, 3번 이어지면 모두가 30초 동안 대체 결과를 받는다. 4xx도 차단기 실패로 세기 → 요청 몇 개의 문제로 모든 사용자가 30초 동안 대체 결과를 받는다. `BUSY` 뒤 기다리지 않고 바로 재요청(처음 값) → AI의 동시 처리 개수가 아직 차 있어 다시 `BUSY`를 받기 쉽고, 두 번째 `BUSY`는 차단기 실패로 센다. 남은 예산이 0보다 크기만 하면 재요청(처음 값) → 1초만 남은 재요청은 성공하기 어렵고 AI 부하만 더한다. 이번에 Micrometer 지표까지 내기 → 로그만으로 원인을 구분할 수 있고 지표는 나중에 같은 곳에 `MeterRegistry`만 더하면 된다. ProblemDetail `code`를 그대로 남기기 → AI가 보낸 문자열이라 대문자 상수 모양일 때만 남긴다(AC-20).

## D-4 취향과 인증
- Status: provisional
- Decision: 검색은 로그인을 선택으로 받는다. 회원이면 회원 id만 AI에 보내고, 비회원은 가입과 같은 모양의 온보딩 답변(`preferences`)을 보낼 수 있으며 BE는 그 답변을 AI의 `tasteProfile`로 그대로 넘긴다. 잘못된 토큰은 401, 잘못된 답변은 400이다. place-search#D-33을 대신한다. 규칙은 spec.md "취향과 인증"과 AC-3·17·18·19.
- Default: AI의 비회원 답변 입구는 온보딩 답 모양(`mood`, `priorities`, `purposes`, `tastes`)으로 고쳐져 develop에 머지됐다(`ai/docs/comparison/api.md` v0.5, 1111ea3). 그 모양이 BE `Preferences`와 같아 BE는 고치지 않고 넘긴다. 칩의 문장 벡터(`vector`)는 붙이지 않는다. 회원 행에도 지금 벡터가 없고, AI는 벡터 없는 코드 없는 칩을 보관만 하고 정렬에 쓰지 않는다. 본문이 틀리고 토큰도 무효면 401보다 400이 먼저 나가는 것, 만료 토큰으로 연 홈 화면이 401이 되는 것(FE의 토큰 갱신 후 재요청에 맡김), 토큰 확인이 DB를 보지 않아 탈퇴한 회원의 토큰도 회원으로 통과하는 것(취향이 지워져 AI가 취향 없이 처리)은 감수한다. FE가 기기 답변을 읽을 때 지금 선택지에 없는 값이면 지우고, 칩 `code`가 BE 규칙에 맞지 않으면 답 없이 보내므로(D-16) 400은 드물다.
- Rejected: JWT를 읽지 않고 `preferences`를 태그 코드 목록으로 받기(place-search#D-33) → 회원 취향은 AI가 DB에서 읽고, 비회원은 기기에 온보딩 답변만 있다. 토큰이 잘못되면 비회원으로 계속 → 로그인한 사람이 조용히 취향 없는 결과를 받는다. BE가 `/v1/taste/profile`로 `features`를 만들어 넘기기 → AI의 값을 AI에 중계할 뿐이다. FE가 `features`를 만들어 저장 → FE가 AI 코드표를 알아야 한다. BE나 FE가 칩 벡터를 만들어 붙이기 → 회원도 벡터가 없어 비회원만 다르게 정렬되고, 인코더 호출이 하나 더 는다. 틀린 답변은 버리고 검색 계속 → FE가 이미 틀린 값을 걸러 보내지 않아 얻는 것이 적다.

## D-5 AI 결과를 카드로 만들기
- Status: settled
- Decision: AI 응답의 `placeId`로 카탈로그에서 장소 정보를 한 번에 읽어 카드를 채우고, AI 필드와 순서는 그대로 쓴다. 카탈로그에 없는 id는 빼고, 같은 id가 다시 오면 처음 카드만 남긴다. 요청·응답 변환 규칙은 spec.md "AI 요청"·"AI 응답"과 AC-2·5.
- Rejected: 같은 id의 카드를 둘 다 옮기기 → FE 목록의 key가 겹친다.

## D-6 AI 실패 시 대체
- Status: provisional
- Decision: AI 실패 시 오류 대신 평소 모양의 대체 결과(홈 요청은 카탈로그 전체, 그 밖은 키워드 검색)를 준다. 규칙은 spec.md "대체 결과"와 AC-7·9~12.
- Default: `emptyReason`은 원인 "지금은 가게 이름, 메뉴, 업종, 역 이름으로만 찾을 수 있어요", 제안 "가게 이름이나 메뉴 이름으로 다시 검색해 보세요"이다. FE·기획과 문구를 맞추면 바꾼다. 키워드 검색은 모든 단어를 담은 장소만 찾아 문장 검색은 장애 동안 자주 빈 결과가 되는 것, 대체된 후속 검색이 조건 이어짐에서 빠지고 검색 기록에 대체 표시가 남지 않는 것은 감수한다. 홈 대체 결과는 FE가 헤더를 읽어 다시 받는다(D-16). DB 장애는 AI 장애가 아니어서 지금처럼 503이다.
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
- Decision: 이번에는 BE에 검색 결과 캐시를 두지 않는다. 홈 화면도 앱을 열 때마다 AI를 기다린다. 앱 안에서 다른 화면에 갔다가 홈으로 돌아올 때는 FE의 메모리 캐시(홈 추천 카드 요청은 다시 받지 않음)가 결과를 다시 쓴다. 대체 결과만은 돌아올 때 다시 받는다(D-16).
- Default: AI의 근처 검색 로직이 확정되면 홈 결과 캐시를 다시 본다. 지금 AI 코드의 근처 검색은 취향을 순서와 점수에 쓰지 않아(`ai/src/fit_ai/match/search.py`의 근처 분기), 확정되면 모두에게 같은 결과 하나를 캐시하는 안이 가능하다.
- Rejected: 회원별로 04:00까지 캐시 → 근처 정렬에 취향이 쓰이지 않아 얻는 것이 적고, 메모리 증가·탈퇴 뒤 잔존·키 구분·빈 결과 고정을 따로 막아야 한다. 모두에게 같은 결과 하나를 캐시 → AI의 근처 로직이 아직 반영되지 않았다. Redis → BE에 Redis 의존성이 없다.

## D-10 다음 페이지
- Status: settled
- Decision: 요청의 `cursor`와 응답의 `nextCursor` 필드는 남긴다(Mock이 쓴다). DB 모드 응답에는 `nextCursor`가 없고, `cursor`가 오면 400이다. FE의 다음 페이지 동작은 바꾸지 않는다(타임아웃과 인증은 D-16).
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
- Decision: 실제 연동 전에 인프라(AI 컨테이너, `MODAL_BASE_URL` 내부 주소, dev·prod 장소 적재)와 AI(Modal `/embed` 임베딩, 적재된 장소 벡터의 인코더 확인, 예시 장소 id)가 풀어야 한다. 이번 범위가 아니다(spec.md Out of scope). AI가 읽는 뷰는 D-15, FE 쪽 일은 D-16으로 이번 범위에 들어왔다. 근처 검색이 위치 없이 100곳만 주는 문제는 place-search#D-82와 부딪혀 AI 쪽 해법이 필요하다.

## D-14 테스트
- Status: settled
- Decision: 새 의존성 없이 AI 클라이언트(`MockRestServiceServer`), 엔진(가짜 AI 클라이언트), 컨트롤러, 기동, 카탈로그와 AI 뷰(Postgres 통합), FE 검색 API·검색 인증 연결·결과 화면(Vitest) 이음매로 확인한다. 상세는 spec.md Seams & test plan.

## D-15 AI가 읽는 뷰는 BE 마이그레이션이 만든다
- Status: provisional
- Decision: AI DB 계정은 뷰 `ai_place_search`와 `user_preferences`만 읽을 수 있고(`infra/data/grant-ai-read.sh`), 뷰를 만들 수 있는 것은 BE 마이그레이션 계정뿐이라 BE가 Flyway 마이그레이션으로 만든다. 모양은 지금 AI 코드(`ai/src/fit_ai/match/pg_store.py`)가 읽는 모양에 맞춰 `places`와 `place_profiles`로 조립한다. 규칙은 spec.md "AI가 읽는 뷰"와 AC-24. 권한은 배포가 마이그레이션 뒤에 다시 맞춘다(`infra/deploy/deploy.sh`).
- Default: 뷰의 `profile.embedding`(모델·리비전·`document`)은 BE DB에 없는 값이라 AI 코드의 상수를 그대로 적는다. 적재된 장소 벡터가 다른 인코더로 만들어졌다면 AI가 오류 없이 엉뚱하게 정렬하므로 적재 담당과 확인한다(D-13). 편의시설은 네이버 이름 `주차`·`발렛파킹`→`PARKING`, `무선 인터넷`→`WIFI`, `단체 이용 가능`→`GROUP`, `예약`→`RESERVATION`만 바꾸고, 없는 시설은 "없음"이 아니라 "모름"(키 없음)으로 둬 시설 조건에서 빠지지 않게 한다. 주차 안내 문구(`parking_note`)는 "주차 불가" 같은 부정문이 섞여 쓰지 않는다. 지금 AI 코드(`ai/src/fit_ai/match/pg_store.py`)는 이 뷰의 컬럼에 의존한다고 적고 있다. AI가 BE 컬럼을 그대로 읽기로 하면 뷰를 그 모양으로 바꾼다.
- Rejected: BE 컬럼을 그대로 내보내는 뷰 → 지금 AI 코드는 `profile` 컬럼을 찾아 모든 조회가 `UndefinedColumn`으로 실패한다(로컬에서 AI `PgPlaceStore`로 확인). AI 팀이 뷰를 만들기 → AI 계정은 읽기 전용이다. 뷰 대신 테이블 복사 → 적재·갱신마다 따로 맞춰야 한다.

## D-16 FE 검색 요청
- Status: provisional
- Decision: 검색 요청(홈 주변 카드 포함)은 검색 기록 저장과 같은 세션 확인(`fe/src/app/search-thread-auth.ts#threadAuth`)으로 회원은 토큰, 비회원은 기기의 온보딩 답을 싣고, 확인하지 못하면 둘 다 싣지 않는다. 검색만 15초를 기다리고, `X-Fallback`의 `AI_UNAVAILABLE`은 안내 한 줄과 홈 카드 다시 받기로 알린다. 규칙은 spec.md "FE 검색 요청"과 AC-25~27.
- Default: 확인하지 못한 채 받은 홈 카드는 나중에 세션이 확인돼도 다시 받지 않는다(확인은 세션 변경이 아니다). 이 경우가 잦으면 다시 본다.
- Rejected: 확인하지 못했어도 기기 답이 있으면 싣기 → 실제로는 회원인데 남은 답으로 정렬된다. 모든 요청 타임아웃을 15초로 → 다른 화면의 실패 안내가 늦어진다. 검색 결과도 대체면 다시 받기 → 검색 결과는 받은 그대로 검색 기록에 저장되고 상세에서 돌아올 때 캐시로 그리는 설계라, 다시 받으면 기록과 화면이 달라진다. 대체 여부를 응답 본문에 넣기 → 첫 페이지가 그대로 검색 기록에 저장돼 범위 밖인 "기록에 대체 표시"가 생긴다. 400이 오면 기기 답을 지우고 다시 보내기 → 요청이 둘이 되고, 보내기 전에 BE 규칙으로 거르면 충분하다. 답변을 검색 기록의 요청에 넣기 → 서버 기록에 비회원 답이 남고 기록 형식이 바뀐다.

## D-17 AI를 기다리는 검색 수의 상한
- Status: provisional
- Decision: BE 컨테이너 하나에서 AI 응답을 기다리는 검색은 동시에 8개까지이고, 넘는 검색은 12초 예산 안에서 semaphore permit 반납을 잠깐 기다렸다가(기다린 순서대로) 그래도 받지 못하면 대체한다. 인프라 설계 §11.2 "호출 방어"가 BE→AI 호출에 동시성 상한을 요구한다. 상한을 넘은 대체는 AI 장애가 아니라서 차단기에 세지 않는다. 규칙은 spec.md AC-28.
- Default: 8은 AI 컨테이너 하나가 받는 검색 수(`MAX_CONCURRENT_REQUESTS` 기본 8)와 같은 임시값이다. 그보다 많이 보내도 AI가 503 `BUSY`를 줄 뿐이다. AI 컨테이너가 늘거나 AI 값이 바뀌면 함께 맞춘다. Blue/Green이 겹치는 동안은 두 컨테이너가 각각 8개라 AI가 `BUSY`를 줄 수 있고, 그때는 재시도 뒤 대체한다. permit 대기는 최대 2초인 임시값이다. 검색 하나가 3~4초 걸려 permit이 모두 쓰이는 동안에도 0.4초에 하나꼴로 반납되고, AI가 응답하지 않을 때도 요청 thread가 묶이는 시간은 2초로 끝난다. BE가 AI 호출 시간을 잰 뒤 다시 정한다.
- Rejected: 상한 없이 AI의 `BUSY`에만 맡기기 → AI가 연결을 받고 응답하지 않으면 차단이 시작되기 전까지 검색마다 BE 요청 스레드가 12초씩 묶여 리뷰·로그인 같은 다른 API까지 느려질 수 있다. 예산 밖에서 permit 반납을 기다리기 → FE 15초를 넘길 수 있다. 기다리지 않고 바로 대체(처음 값) → 앞 검색이 곧 끝나도 9번째 사람은 키워드 결과를 받는다. 3~4초 안에 9명이 검색하면 1명이 대체된다. 상한을 넘은 대체를 차단기 실패로 세기 → 사용자가 몰린 것만으로 모두가 30초 동안 대체 결과를 받는다.
