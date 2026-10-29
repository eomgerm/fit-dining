# 장소 검색 (place-search)

Status: approved
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

사용자는 자연어로 장소를 찾고 싶다. 입력하는 동안 장소 후보를 보고, 요청을 보내면 추천 장소를 지도와 카드 목록으로 받고, "더 조용하게" 같은 후속 조건으로 결과를 좁히고, 이번에 한 요청들을 되돌아보고, 카드를 눌러 장소 상세와 추천 이유를 보고 싶다. 화면 기준은 Figma "5. 검색·추천 결과"(5-01, 5-03~5-07)와 "6. 장소 상세"(6-01, 6-02, 6-04, 6-05)다(D-49). 첫 화면(아래 검색창, 주변 추천 카드, 최근 검색, 지도 위 버튼)은 S15P31A302-42에서 와이어프레임 `Start`, `StartRecent`, `StartNoLoc`, `Typing`, `Results`를 따른다(D-80). 같은 작업에서 입력 중(`Typing`), 검색 중(`Loading`), 요청 기록(`RequestHistory`), 과거 결과(`PastResult`), 장소 상세(`Detail`, `DetailMenu`, `DetailInfo`)도 와이어프레임에 맞춘다(D-87~D-94). 장소 상세의 리뷰 탭과 "방문 평가 남기기"는 리뷰 담당이 상세 화면이 연 자리에 붙인다(D-86).

검색의 내부 로직(요청 해석, 임베딩, OpenSearch 질의, 점수 계산)은 AI 파트가 맡고 아직 데이터 구조와 전달 방식이 정해지지 않았다. 이 기능은 Spring BE와 Next.js FE를 연결하는 부분을 Mock 데이터로 끝까지 동작하게 만들고, 확정되면 구현과 DTO 레이어만 교체할 수 있게 한다(D-49, D-62, D-64).

## Assumptions

### BE 요청과 검증

1. 장소 `id`는 정수다. BE는 `long`, JSON은 숫자, FE는 `number`다. 값은 JavaScript의 안전한 정수 범위(2^53 - 1) 안이라고 가정한다(D-64).
2. `mapBounds`는 `{swLat, swLng, neLat, neLng}`이고 하위 필드는 `Double`이다. BE는 내용을 검증하지 않고, 빠지거나 `null`인 하위 필드도 그대로 엔진에 넘긴다(D-64).
3. `q`와 `query`는 `@NotBlank`와 `@Size(max = 200)`(UTF-16 문자 수)로 검증하고, 어기면 400이다. `q`는 파라미터 어노테이션만으로 Spring MVC 내장 메서드 검증을 받고(컨트롤러 클래스에 `@Validated`를 붙이지 않는다), `query`는 `@Valid @RequestBody PlaceSearchRequest`로 검증한다. `q` 누락도 400이다. 상한 200은 이 spec이 정하는 임시 값이다(D-10, D-64, D-59).
4. 존재하지 않는 `id`는 404, 경로의 `id`가 정수가 아니면 400이다. `PlaceService`가 `findPlace`의 빈 값을 404 예외로 바꾸는 것은 AC-14의 "가공"이 아니다(D-10, D-62, D-64, D-56).
5. `spring-boot-starter-validation`은 사용자가 `be/build.gradle`에 추가한다. 구현은 의존성이 들어온 것을 확인하고 시작하며 그 밖의 `build.gradle` 변경은 하지 않는다. 형식 검증(400)은 요청이 컨트롤러에 들어오기 전에 일어나므로 엔진 유무 확인(503)보다 먼저다. AC-14는 엔진 반환값을 가공하지 않는다는 뜻이며 요청 검증을 막지 않는다(D-55, D-10, D-62).
6. `PlaceController`는 `PlaceService`에 위임만 한다(`@RequiredArgsConstructor`, try-catch 없음). `PlaceService`는 `PlaceSearchEngine` 빈을 직접 주입받는다(환경마다 Mock 또는 DB 모드의 엔진이 정확히 하나, `docs/specs/place-lookup-db/spec.md`). 장소가 없으면 404 예외(`PlaceNotFoundException`)를 던지고, 503 예외(`PlaceSearchUnavailableException`)는 엔진이 던진다(D-56, D-63, place-lookup-db D-2).
7. 오류 응답은 `PlaceExceptionHandler`(`@RestControllerAdvice(basePackageClasses = PlaceController.class)`) 하나로 ProblemDetail을 만든다. `detail`은 일반 문구이고 예외 메시지와 요청 본문은 응답에 담지 않는다. 검색어와 요청 본문은 로그에도 남기지 않는다(DB 접근 오류의 예외 객체만 서버 로그에 남는다). 처리 대상은 검증 실패(`MethodArgumentNotValidException`, `HandlerMethodValidationException`), `HttpMessageNotReadableException`, `MethodArgumentTypeMismatchException`, `MissingServletRequestParameterException`, `InvalidCursorException`(400), 장소 없음(404), 검색을 쓸 수 없음(503: 엔진이 던진 `PlaceSearchUnavailableException`과 DB 접근 오류)이다(D-10, D-20, place-lookup-db D-14).
8. 엔진이 잘못된 `cursor`를 알리는 방법은 `kr.co.fitdining.api.place.engine.InvalidCursorException`(`RuntimeException` 하위)을 던지는 것이다. 이 예외는 `PlaceSearchEngine` 계약의 일부이고 다른 예외는 400으로 바꾸지 않는다. 컨트롤러는 `cursor`를 해석하지 않는다(D-10, D-62).
9. 알 수 없는 속성 거부와 null 필드 생략은 `application.yml`의 전역 JSON 설정이다. 정확한 속성 이름은 Spring Boot 4.1.1(Jackson 3)에서 구현 때 확인한다. 거부는 `mapBounds` 같은 중첩 record에도 적용하지만 `previousConditions` 내부와 `preferences` 원소에는 적용하지 않는다(D-41, D-64).
10. 역직렬화되는 record(요청 DTO와 `places.json` 매핑)의 숫자와 boolean은 박싱 타입이다. 선택 필드의 명시적 `null`은 없는 것으로 본다. 타입은 Jackson 기본 변환을 따른다(`"query": 123`은 문자열로 받는다). 변환할 수 없는 값(문자열 자리의 객체, `previousConditions` 자리의 배열 등)만 400이다. `preferences`는 `List<String>`, `previousConditions`는 `Map<String, Object>`(JSON 객체)다(D-41, D-64).
11. 응답에서 null인 선택 필드는 JSON에서 생략하고, `conditions: {}`와 빈 목록은 그대로 내보낸다. `conditions` 내부의 null 값은 생략하지 않는다(`@JsonInclude(content = ALWAYS)`)(D-41, D-61).
12. 프레임워크 로거는 기본 수준을 유지하고, JSON 파싱 오류 메시지가 입력을 로그에 남기는지는 AC-13 테스트로 확인한다. 테스트가 실패하면 해당 로거의 수준을 올리는 것은 허용한다(D-20).

### Mock 엔진

13. Mock 스위치는 환경변수 `PLACE_MOCK_ENABLED`(속성 `place.mock.enabled`, 코드 기본값 꺼짐)이고 local과 dev에서만 켠다. `be/.env.example`에 `PLACE_MOCK_ENABLED=true`로 넣는다. `docs/infra/contracts/env.md`와 `infra/` 아래 파일은 고치지 않고, 계약 등록은 인프라 담당에게 알린다(D-63).
14. Mock은 `classpath:mock/places.json`을 Spring의 JSON 매퍼로 읽는다. 파일은 `{"places": [{"card": PlaceCard, "detail": PlaceDetailResponse}]}` 형태로 DTO 필드와 정확히 맞추고(전역 알 수 없는 속성 거부를 받는다), `card.place`와 `detail.place`는 같은 값이다. 장소는 30~40곳이고 `id`는 파일에 1부터 차례로 적는다. 파일은 정제한 네이버 수집 데이터로 생성 스크립트가 만들고(규칙은 place-catalog spec의 "적재·mock 변형 규칙"), 사진은 원본 URL이며 없으면 FE가 자리표시 그라데이션을 그린다(D-63, D-64, D-60, place-catalog#D-19).
15. Mock은 요청 헤더 `X-Mock-Scenario`를 현재 요청(`RequestContextHolder`)에서 읽는다. `PlaceSearchEngine`의 메서드 인자에는 시나리오를 넣지 않는다. 헤더는 검색에만 적용되고 알 수 없는 값은 정상 결과다(D-63, D-62).
16. Mock 검색은 질의, `mapBounds`, `preferences`를 무시하고 모든 장소를 `score` 내림차순(같으면 파일 순서)으로 돌려준다. `totalCount`는 장소 수다. 질의에 "근처"가 부분 문자열로 있으면 `nearby: true`, 전체 항목, 커서 없음이다. 헤더 `empty`이면 `items: []`, `totalCount: 0`, `emptyReason`이 있고, `empty`와 "근처"가 함께 있으면 `empty`가 이기고 `nearby`는 false다(D-63, D-52).
17. Mock의 `conditions`는 `previousConditions`가 있으면(`null`이 아니면, 빈 객체 `{}`도 포함) 그대로, 없으면 `{}`다. `previousConditions`가 있으면 `changeSummary`는 "요청하신 조건을 반영했어요"이고 없으면 생략한다(D-63, D-50).
18. Mock의 `cursor`는 십진수 오프셋 문자열의 base64url 인코딩(패딩 없음)이다. 빈 문자열은 없는 것(첫 페이지)으로 본다. 패딩이 있거나 base64url이 아니거나, 풀어낸 값이 `0` 또는 `[1-9][0-9]*` 형식의 `int`가 아니면 400이다. 오프셋이 장소 수 이상이면 빈 페이지이고 `nextCursor`와 `emptyReason`이 없다. `cursor`가 있으면 항목을 고를 때 `query`, `mapBounds`, 헤더, "근처"를 무시하고 오프셋만 따른다. 커서 응답은 `nearby: false`, `totalCount`는 장소 수, `emptyReason`과 `changeSummary`는 없고 `conditions`는 17번을 따른다. FE는 커서 응답의 `totalCount`, `conditions`, `changeSummary`를 쓰지 않는다(D-50, D-63).
19. Mock 자동완성은 "이름 접두 일치"(이름이 `q`와 같거나 `q`로 시작) 장소를 먼저, 그다음 "포함 일치"(이름이나 메뉴 이름에 `q`가 들어 있거나, `q`가 업종 한글 이름(식당, 카페, 술집)이나 코드의 부분 문자열인) 장소를 담는다. 각 단계 안은 파일 순서이고 장소 항목은 최대 5개다. 매칭은 `q`의 앞뒤 공백을 제거하고 대소문자를 구분하지 않는다. 역 이름은 매칭하지 않는다. 이름으로 일치하지 않고 메뉴 이름으로만 일치한 항목은 `matchedMenu`에 파일 순서상 첫 번째로 일치한 메뉴 이름을 담는다. 이름으로 일치한 항목에는 담지 않는다(D-63, D-64). 이 규칙은 Mock 엔진의 것이다. `place.mock.enabled`가 꺼졌거나 없을 때(DB 모드)의 자동완성은 이 규칙이 아니라 `docs/specs/place-lookup-db/spec.md`의 키워드 매칭 규칙(단어 단위 AND, 위치 매칭, 한글 조합)을 따른다.
20. 자동완성의 `ACTION` 항목(`label` "이 조건으로 추천받기")은 항상 포함된다. 이름 접두 일치가 있으면 맨 뒤, 없으면 맨 위다. `PLACE` 항목에는 `label`이 없다(D-63, D-64). DB 모드에서는 "이름 접두 일치"가 키워드 매칭의 순위 0(이름이 입력 전체로 시작)이다(`docs/specs/place-lookup-db/spec.md`).
21. Mock의 영업 상태(`openStatus`)는 요청 시각(`Asia/Seoul`)과 그 장소의 `hours`로 place-catalog spec의 "영업 상태 규칙"대로 계산한다. 구간은 모두 시작 포함, 끝 제외이고, 어제 영업의 자정 넘은 부분과 다음 날로 이어지는 영업(24시간)을 한 구간으로 본다. 영업 구간 밖이면 `CLOSED`이되 오늘이 정보 없음이거나, 오늘이 영업일이고 오늘 첫 구간 시작 전인데 어제가 정보 없음이면 `UNKNOWN`(오늘이 휴무일이면 어제와 상관없이 `CLOSED`), 브레이크(하루에 여럿일 수 있다) 안이면 `BREAK`, 구간 끝 60분 전부터 끝 전이면 `CLOSING_SOON`, 그 밖에는 `OPEN`이다. 브레이크 시작 전은 `CLOSING_SOON`으로 보지 않는다. `places.json`의 `openStatus`는 `UNKNOWN`으로 적어 두고 응답할 때 계산값으로 바꾼다(카드와 상세 모두). 시각은 주입한 `java.time.Clock`으로 읽어 테스트에서 고정할 수 있게 한다(없으면 `Asia/Seoul` 시스템 시계)(D-64).
22. Mock의 추천 이유, 주의점, 핏 점수 설명, 주소, `emptyReason`은 고정 한글 문자열이다. `labels`는 2개, 상세 `tags`는 2~4개, `scoreItems`는 2~4개이고 그중 하나 이상은 `matched: false`다. 요일은 `MON`~`SUN`, 시각은 `HH:mm`이다(D-63, D-64).

### FE 검색 흐름

23. FE는 항상 상대 경로 `/api/v1/...`를 부른다. `rewrites`는 `process.env.NODE_ENV === 'development'`일 때만 `/api/:path*`를 `${BE_INTERNAL_URL ?? 'http://localhost:8080'}/api/:path*`로 넘기고, 그 밖에는 빈 배열을 돌려준다. 운영에서는 Caddy가 같은 역할을 한다(D-69).
24. 결과가 없을 때는 화면 아래쪽에 떠 있는 검색창(자동완성 있음, `maxLength` 200, 후보는 검색창 위에 열림)이 보이고, 엔터, 추천받기 버튼, `ACTION` 선택은 새 검색이다. 결과가 있을 때는 이 검색창이 사라지고 결과 패널 아래 입력창("조건을 더 말해 보세요", 자동완성 없음)이 보이며 그 입력은 항상 후속 조건이다. 결과 목록은 그 입력창 위에 있다. 패널의 "새 검색"은 결과, 조건, 커서를 비우고 아래 검색창으로 돌아간다. 여기서 "결과가 있을 때"는 지금 보는 요청이 있을 때이며, 첫 페이지 응답이 0건(`emptyReason`)이어도 결과 패널에 원인과 수정 제안을 보여 주고 후속 입력창과 "새 검색"을 둔다(D-50, D-73, D-81).
25. 후속 조건은 새 입력을 `query`로, 기준 요청의 첫 페이지 응답 `conditions`를 `previousConditions`로 보낸다(빈 객체 `{}`여도 그대로 보낸다). 기준 요청은 항상 지금 보는 요청이다. 요청 기록의 "여기서 이어 검색"은 그 요청을 지금 보는 요청으로 바꾸고 후속 입력창에 초점을 둔다("결과 보기"는 지금 보는 요청을 바꾸지 않는다, 57번). 후속 요청이 성공하면 그 새 요청이 지금 보는 요청이 된다(D-50, D-89, D-90).
26. 커서 요청은 첫 요청의 `query`, `preferences`, `previousConditions`, `mapBounds`를 그대로 다시 보내고 `cursor`만 더한다. 빈 다음 페이지를 받으면 이어 붙이기만 멈추고 결과 없음 화면을 띄우지 않는다. 다음 페이지는 스크롤 위치로 불러온다(IntersectionObserver)(D-50).
27. 요청 기록(5-07)은 지금 thread에서 성공한 첫 페이지 요청(새 검색, 후속 조건, "이 지역에서 검색", "이 조건으로 다시 검색")을 시간순 항목으로 쌓는다. 커서 요청은 새 항목이 아니라 그 항목의 불러온 항목에 이어 붙이고, 실패한 요청은 쌓지 않는다. "이 지역에서 검색" 항목의 문장은 기준 요청의 문장 그대로이고(D-76), 기준 요청은 그때 보던 요청이다. 요청 기록은 지금 thread(53번)의 요청만 보이고, "새 검색"을 누르면 다음 새 검색이 새 thread를 연다. 이전 thread는 최근 검색에서 다시 연다. 요청 기록은 결과 패널 머리글의 "요청 기록"으로 결과 패널 안에 펼친다(29번). 검색창의 기록 아이콘은 요청 기록이 아니라 최근 검색(53번)이다(D-89, D-91). 각 항목은 입력 문장, "<업종> <totalCount>곳 · 오후 h:mm"(업종은 근처 필터 전 첫 페이지 항목에서 가장 많은 업종의 한글 이름이고 같으면 식당, 카페, 술집 순, 곳 수는 첫 페이지 응답의 `totalCount`, 0건이면 "결과 0곳"), 기준 요청이 직전 요청이 아니면 "<n>번째 요청에서 이어 검색"(기준이 1번째면 "첫 요청에서 이어 검색"), 지금 보는 항목에 "보는 중"을 표시한다. 지금 보는 항목이 아닌 줄에는 "결과 보기"와 "여기서 이어 검색"이 있다. "결과 보기"는 네트워크 요청 없이 그 시점의 결과(불러온 페이지 포함)를 과거 결과 화면(57번)으로 보여 준다. 다시 보는 결과의 카드 영업 상태는 검색한 시각의 값이며, 정확한 상태는 상세 화면에서 새로 받는다(D-50, D-74, D-79).
28. 후속 조건 결과에는 응답의 `changeSummary`를 배너로 보여 준다. 칩은 지금 보는 요청에서 기준 요청을 따라 새 검색까지 거슬러 올라가며 만난 후속 입력들을 오래된 순서로 "추가 조건 · <입력>"으로 보여 준다(새 검색 A → 후속 B → 후속 C를 보면 B, C). 갈라진 다른 후속은 넣지 않는다(5-06). 칩은 FE가 요청 기록에서 만든다(D-50, D-64).
29. 결과 패널은 중간(5-04)과 전체(5-05), 요청 기록 펼침의 세 상태다. 중간과 전체는 손잡이를 누르거나 끌어 바꾸고, 전체 상태에서는 "지도 보기" 버튼이 중간 상태로 되돌린다. 머리글의 "요청 기록 ⌄"를 누르면 패널이 지도 위 버튼 아래까지 펼쳐지며 결과 목록 자리에 요청 기록 타임라인이 보이고("요청 기록 ⌃"), 다시 누르거나 "여기서 이어 검색"을 누르면 펼치기 전 상태로 돌아간다. 펼친 동안에도 후속 입력창과 "새 검색"은 그대로다. 검색 중(5-03, 와이어프레임 `Loading`)에는 입력 문장, 깜빡이는 점과 "요청을 이해하는 중", "주변 장소를 찾는 중", "취향과 맞춰 보는 중"을 1.5초마다 차례로 바꾸는 문구(실제 진행 단계가 아닌 안내, 동작 줄이기 설정이면 움직임 없음), 빈 카드 자리표시를 보여 주고, 후속 입력창은 흐리게 비활성이며 최근 검색 버튼을 숨긴다(D-49, D-88, D-89).
30. 카드는 순위 번호, 사진(없으면 자리표시), 이름, 업종 · 거리(위치가 있을 때) · 영업 상태 문구(영업 중, 곧 마감, 브레이크타임, 영업 종료; `UNKNOWN`이면 생략), 라벨 2개, 주의점, 핏 점수를 보여 준다. 카드에 `score`가 없으면(AI 엔진 전) 핏 점수 영역을 그리지 않는다(place-lookup-db D-12). 순위 번호는 지금 보이는 목록에서의 순서(1부터, 다음 페이지에서도 이어짐, 근처 필터 뒤 다시 매김)다(D-70, D-64).
31. FE의 빈 입력 판정은 앞뒤 공백을 제거한 뒤 한다. 공백뿐인 입력은 자동완성과 검색 모두 요청하지 않는다(D-70, D-10).
32. 자동완성은 앞뒤 공백을 뺀 입력을 300ms 늦춘 값을 쿼리 키로 쓴다. 입력이 바뀌면 300ms를 다시 기다리고, 늦춘 값이 바뀌어 새 요청을 보내면 이전 요청을 Query가 넘긴 `signal`로 취소한다. 입력이 비면 기다리지 않고 후보 목록을 비우며 진행 중인 요청도 취소한다. 지금 키가 아닌 요청의 응답은 화면에 쓰지 않는다. 후보 줄은 이름, 업종 · 거리(위치가 있을 때) · "메뉴: <matchedMenu>"(있을 때)이고, 이름과 메뉴에서 입력을 공백으로 나눈 단어마다 대소문자를 무시하고 같은 부분을 강조하며 겹치거나 이어진 구간은 합친다(`model/highlight.ts`, place-lookup-db D-6). `PLACE` 후보를 고르면 `/place?id=<id>`로 이동한다. 후보 상자는 응답의 `ACTION` 항목을 응답 안 위치와 상관없이 맨 위(강조 배경, 원 안의 반짝이 아이콘, ›)에 두고 `PLACE` 항목(원 안의 핀 아이콘)은 응답 순서대로 그 아래에 둔다(`model/suggestions.ts`의 `actionFirst`). 후보가 보이는 동안(검색창에 초점이 있고 공백을 뺀 입력이 있을 때) 지도 위에 어두운 막을 깔아 주변 카드와 지도 버튼을 가리고, 막을 누르면 검색창 초점을 풀어 후보를 닫는다. 검색창은 초점이 있으면 테두리를 강조하고, 입력이 있으면 최근 검색 버튼 대신 "입력 지우기"(✕) 버튼을 두며 누르면 입력을 비우고 검색창에 초점을 둔다(D-70, D-64, D-67, D-87).
33. `place-api.ts`는 공통 `request`로 BE를 부른다. 주소의 `?mock=empty`를 읽지 않고 어떤 요청에도 `X-Mock-Scenario`를 붙이지 않는다(D-95). 오류(`ApiError`의 http, network, timeout)는 한 줄의 일반 오류 문구로 보여 주고, 재시도는 공통 `QueryClient` 기본값(5xx와 연결 실패만 두 번)을 따른다(D-63, D-68, D-66, D-67).
34. 화면 문구는 쉬운 한국어다. `fe/src/app/layout.tsx`의 `metadata`를 서비스 이름("Fit Dining")으로 바꾼다(`lang="ko"`와 Pretendard는 S15P31A302-35에서 들어왔다). 지도 위 "저장한 장소"와 "내 정보" 버튼은 56번, 상세의 "공유"와 "저장" 버튼은 58번, "방문 평가 남기기"는 45번(리뷰 자리)을 따른다(D-66, D-49, D-85, D-86, D-94).

### FE 지도와 위치

35. `fe/src/app/config.json/route.ts`의 `GET`은 요청 때마다 `process.env`에서 읽어 `{ env, naverMapClientId? }`만 돌려준다(`env`는 `APP_ENV`, 없으면 `dev`. `naverMapClientId`는 `NAVER_MAP_CLIENT_ID`, 비어 있으면 생략). 빌드 때 미리 렌더링되면 값이 굳으므로 요청 시점에 실행되게 하고(`cacheComponents`가 켜져 있어 방법은 `fe/node_modules/next/dist/docs/`에서 확인), 응답에 `Cache-Control: no-store`를 둔다. FE는 `fe/src/shared/lib/runtime-config.ts`에서 `/config.json`을 페이지 세션에 한 번만 받아 메모리에 두고, `PlaceMap`은 `naverMapClientId`가 없거나 요청이 실패하면 지도 영역을 비운다(D-57, D-70).
36. 지도 스크립트는 `PlaceMap`이 처음 마운트될 때 한 번만 `<script>`로 넣고, 이미 로드됐으면 다시 넣지 않는다. URL은 `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=<encodeURIComponent(Client ID)>`이며 `submodules`는 붙이지 않는다. `window.navermap_authFailure`는 스크립트를 넣기 전에 정의한다(D-70).
37. 지도 컨테이너는 CSS로 높이를 지정하고, 크기가 바뀌면 `map.setSize`를 호출한다. 결과가 바뀌어도 지도를 새로 만들지 않고 핀만 바꾼다(지도 사용량은 지도 생성 횟수로 집계된다)(D-70).
38. 핀은 `naver.maps.Marker`의 HTML 아이콘(`icon.content`)으로 순위 번호를 그린다. 선택된 핀은 강조 아이콘으로 바꾸고(`setIcon`) 가장 위에 그린다(`setZIndex`). 핀을 누르면 그 카드를 선택하고 목록을 그 카드로 스크롤한다. 선택되지 않은 카드를 누르면 지도를 `panTo`로 그 핀에 옮기고(줌 유지) 선택한다. 선택된 카드를 다시 누르면 `/place?id=<id>`로 간다. 지도가 없을 때도 같은 두 단계로 동작한다. 한 번에 선택된 카드는 하나이고, 보는 결과가 바뀌면(새 요청, "결과 보기") 선택을 비우며 다음 페이지를 이어 붙일 때는 유지한다(D-70).
39. "이 지역에서 검색"은 버튼을 누를 때만 `map.getBounds()`의 `getSW()`, `getNE()`에서 `swLat = sw.lat()`, `swLng = sw.lng()`, `neLat = ne.lat()`, `neLng = ne.lng()`로 `mapBounds`를 만든다. 누르면 지역 고정 상태가 켜지고 지금 보는 요청(같은 `query`, `preferences`, `previousConditions`)을 `cursor` 없이 지도 영역을 담아 바로 다시 보낸다. 지역 고정 상태에서는 후속 조건을 포함한 모든 첫 페이지 요청에 현재 지도 영역을 담고, "새 검색"을 누르면 꺼진다. 버튼은 결과가 있을 때 사용자가 지도를 끌거나(`dragend`) 확대·축소한(`zoom_changed`) 뒤에만 보이고, 버튼을 누르거나 보는 결과가 바뀌거나 "새 검색"을 누르면 다시 숨는다. 카드 선택이나 "내 위치"의 `panTo`로는 보이지 않는다(D-70, D-52, D-77).
40. 위치 요청은 사용자가 "내 위치" 버튼을 누를 때(누를 때마다 다시 요청)와, 근처 응답을 받았는데 아직 위치를 시도한 적이 없을 때 한다. 검색 화면을 열 때 아직 위치를 시도한 적이 없고 위치 권한이 이미 `granted`이면(`navigator.permissions.query`) 묻지 않고 위치를 받는다. `prompt`, `denied`, API 없음이나 실패면 열 때는 요청하지 않고, 열 때 `denied`이면 "위치 권한이 꺼져 있어요. 브라우저 설정에서 허용해 주세요"를 페이지 세션에 한 번 알린다. 얻은 위치는 `search-store.ts`에 두고 지도에 내 위치 점을 표시하며, 지도를 그 위치로 옮긴다(D-52, D-83).
41. 위치를 얻지 못하면(거부, 오류, 시간 초과) "위치를 확인할 수 없어요"를 알리고 거리를 숨긴다. 근처 응답이었다면 다시 검색하지 않고 받은 항목을 거르지 않은 채 보여 주며 "위치를 확인할 수 없어 지역 기준으로 보여 드려요"를 표시한다. "내 위치" 버튼에서 실패해도 같다. 실패가 확인된 뒤에는 지도가 있으면 모든 첫 페이지 요청에 현재 지도 영역을 담는다("새 검색"으로 꺼지지 않고, 나중에 위치를 얻으면 꺼진다). 근처 응답을 받고 위치를 기다리는 동안에는 목록 대신 "위치를 확인하는 중"을 보여 준다(D-52).
42. 거리는 haversine(지구 반지름 6,371,000m)으로 계산한다. 먼저 10m 단위로 반올림하고, 그 값이 1000m 미만이면 "350m", 이상이면 km로 소수 한 자리까지 "1.0km", "1.2km"로 보여 준다(995m는 "1.0km"). 근처 필터는 거리가 반경(FE 상수, 임시 1000m) 이하인 항목을 남긴다(D-52).

### FE 상태와 장소 상세

43. 지금 보는 화면 상태는 메모리에 두고, 검색 thread만 기기에 저장한다(53번, D-27, D-91). 검색 응답(불러온 페이지와 커서)은 TanStack Query 캐시에 요청 기록 항목마다 무한 쿼리 하나로 둔다(`staleTime`, `gcTime` 무한). 첫 페이지는 성공했을 때만 기록에 넣도록 화면을 바꾸기 전에 받는다. `fe/src/domains/place/model/search-store.ts`(React 없는 모듈)에는 지금 thread의 id와 요청 기록(항목 id, 첫 페이지 요청 본문, 첫 페이지 `conditions`와 `totalCount`, 기록 줄의 업종, 시각, 기준 항목), 지금 보는 항목, 선택된 카드, 위치 결과, 지역 고정 상태, 장소 id별 가장 최근 카드, 열린 과거 결과 화면(57번)을 두고, `ui`의 훅이 `useSyncExternalStore`로 구독한다. 재로드하면 이 화면 상태는 사라지고 첫 화면에서 시작하며, 다시 연 thread의 첫 페이지는 저장한 응답을 캐시에 넣어 쓴다(D-27, D-50, D-52, D-67, D-91).
44. `?id`는 상세 화면이 `useSearchParams`로 읽는다. `cacheComponents`가 켜져 있으면 Suspense가 필요할 수 있으므로 `pnpm install` 뒤 `fe/node_modules/next/dist/docs/`를 확인한다(`fe/AGENTS.md`). `?id`가 정규식 `^[1-9][0-9]*$`에 맞고 `Number.isSafeInteger(Number(id))`일 때만 요청하고, 아니면 "장소를 찾을 수 없어요" 화면을 보여 준다(D-38, D-64).
45. 상세 화면(6-01, 모양은 58번)은 사진 슬라이드(없으면 자리표시), 업종 · 거리, 이름, 핏 점수와 ⓘ(카드에 `score`가 없으면 그리지 않는다), 영업 상태(상세 응답의 `openStatus`)와 오늘 안내("오늘"은 `Asia/Seoul` 기준. `OPEN`, `CLOSING_SOON`이면 "오늘 <close>까지"(마감 `00:00`은 "오늘 24:00까지", 자정을 넘으면 "내일 <close>까지", 지금이 어제 영업의 새벽 부분이면 "<close>까지", 다음 날로 이어지는 24시간이면 "24시간 영업"), `BREAK`이면 지금 들어가 있는 브레이크의 "<끝>에 다시 열어요", 개점 전이면 "<open>에 열어요", 휴무일이면 "오늘 휴무", 마감 뒤와 `UNKNOWN`이면 생략. 문구 규칙은 place-catalog AC-17), 상세 `tags`, 탭(홈, 메뉴, 정보)을 보여 준다. 리뷰는 장소 상세가 직접 그리지 않고, 렌더 함수 props `slots`로 받은 자리에 그린다. `reviewTab`이 있으면 탭은 홈, 메뉴, 리뷰, 정보 순서이고, `homeReviews`는 홈 탭 맨 아래(리뷰 탭으로 바꾸는 함수를 받음), `bottomAction`은 하단 막대(`BottomBar`)의 저장 버튼 옆에 그린다. 자리가 없으면 탭은 홈, 메뉴, 정보이고 하단 막대에는 저장 버튼만 있다. 자리는 `src/app/place/place-detail-with-reviews.tsx`가 리뷰 도메인으로 채운다(D-49, D-64, D-86, D-92).
46. 핏 점수, ⓘ 시트(6-05), "AI 추천 이유", 주의점은 `search-store`의 카드에서 가져온다. 과거 결과 화면(57번)에서 들어왔으면 그 스냅샷의 카드를, 그 밖에는 지금 보는 요청에 그 장소의 카드가 있으면 그 카드를, 없으면 가장 최근에 받은 그 장소의 카드를 쓴다. 카드가 없으면(주소 직접 열기, 재로드) 이 영역들을 숨기고 장소 정보만 보여 준다. 카드가 있어도 `score`가 없으면 핏 점수와 ⓘ를 숨기고, 이유와 주의점은 값이 있을 때만 보인다(place-lookup-db D-12). ⓘ 시트는 `scoreItems`를 "요청 · <label>" 또는 "내 취향 · <label>"로 나열하고, `matched`이면 "앱 리뷰 <evidenceCount>개가 근거예요", 아니면 "확인할 근거가 부족해서 점수에 넣지 않았어요"를 보여 준다(D-64, D-27, D-90).
47. 홈 탭은 추천 이유(제목, 출처 칩 "요청 · <label>"/"내 취향 · <label>", 인용과 출처), 주의점, 주소와 거리, 오늘 영업시간(펼치면 요일별), 전화, 웹사이트, "정보 더보기"(정보 탭으로 이동), 메뉴 미리보기(가로 목록, "메뉴 <개수>")를 보여 준다. 메뉴 탭은 메뉴를 원래 순서대로, 이어지는 같은 카테고리마다 머리글을 붙여(카테고리 없는 메뉴는 머리글 없이) 사진, 이름과 라벨·"대표" 칩, 설명, 가격 원문(없으면 생략)으로 보이고 "정보가 실제와 다를 수 있어요"를, 정보 탭은 요일별 영업시간(브레이크타임, 라스트오더, 휴무, 정보 없음, 24시간 영업), `closedDayNote`, 주소와 거리, 위치 지도(59번), 연락처, 시설(네이버 이름 그대로), 그 아래 값이 있는 항목만 place-catalog spec의 "정보 탭 줄"(지하철, 찾아오는 길, 주차, 예약 등)을 보여 준다(D-49, D-64, D-92, D-93, place-catalog#D-18).

### 실행 환경과 테스트

48. 화면 이름은 "장소"이고 API 경로는 `/api/v1/places/...`다. 테이블과 엔티티(`places`, `Place`)는 이 기능에서 만들지 않는다(D-35, D-32).
49. `be/.env`는 `KEY=VALUE` 형식이고 `spring.config.import=optional:file:.env[.properties]`로 BE 실행 위치(`be/`) 기준에서 읽는다. `be/.env.example`에는 `SPRING_DATASOURCE_PASSWORD=REPLACE_ME`(복사한 뒤 `infra/local/.env`의 `FIT_DEV_APP_PASSWORD` 값으로 바꾼다)와 `PLACE_MOCK_ENABLED=true`를 둔다(D-65). 파일이 없으면 환경변수 값을 쓰고, 비밀번호가 둘 다 없으면 기동이 실패한다. env.md의 "`REPLACE_ME`나 빈 값이면 기동 거부"(BE 계약 #8)는 이번 범위가 아니다(D-40).
50. BE 명령은 `be/`에서 실행한다. `@WebMvcTest`는 DB가 필요 없지만 `./gradlew test` 전체는 `ApiApplicationTests` 때문에 Postgres가 떠 있어야 한다. 개발자의 `be/.env`가 Mock을 켜 두어도 "Mock 꺼짐" 테스트는 속성을 명시적으로 `false`로 덮어쓴다(D-40, D-68).
51. Vitest와 `@/` 경로 설정(`fe/vitest.config.mts`)은 이미 있다. 개발 의존성 `jsdom`, `@testing-library/react`, `@testing-library/dom`을 더하고, jsdom이 필요한 테스트 파일만 `// @vitest-environment jsdom`으로 환경을 바꾼다. 상호작용이 없는 렌더링 확인은 팀 공통 컴포넌트 테스트처럼 `renderToStaticMarkup`으로 해도 된다. 설치가 `fe/pnpm-workspace.yaml`의 `allowBuilds`에 걸리면 필요한 패키지만 이 파일에 허용한다. 자동완성 훅은 `fe/src/domains/place/ui/use-suggest.ts`에 둔다(D-68, D-66).
52. 화면은 S15P31A302-35의 semantic 토큰과 `shared/ui` 컴포넌트를 쓰고 ESLint 디자인 시스템 규칙을 지킨다. 결과 패널, 장소 카드, 지도 핀과 순위 배지, 핏 점수, 검색창, 메뉴 카드는 `src/domains/place/ui`에 만든다. ⓘ 시트와 최근 검색은 `BottomSheet`(요청 기록은 결과 패널 안에 펼친다, 29번), 상세 탭은 `Tabs`, 위치 실패 같은 알림은 `useToast`, 검색 중 자리표시는 `skeleton` 유틸, 첫 화면의 주변 카드 목록과 상세 사진은 `Carousel`, 상세 사진의 넘김 점은 `CarouselDots`, 지도와 사진 위 버튼은 `Fab`을 쓴다. 기준은 Figma 디자인 시스템 페이지(node `80:33933`)와 화면 5-xx, 6-xx, 첫 화면과 D-87~D-94의 화면은 와이어프레임이고 픽셀 단위 일치는 요구하지 않는다(D-71, D-80, D-82, D-85, D-89, D-92).

### FE 첫 화면 (S15P31A302-42)

53. thread와 최근 검색: 새 검색 하나가 thread 하나를 시작하고, 그 뒤의 후속 조건, "이 지역에서 검색", "이 조건으로 다시 검색"은 같은 thread에 요청으로 쌓인다(LLM 대화와 같이 요청은 따로 보이고 조건은 `previousConditions`로 이어진다). "새 검색"을 누르면 지금 thread가 닫힌다. thread는 첫 페이지 응답을 받을 때마다 `localStorage`에 저장한다. 요청마다 id, 종류, 기준 요청, 문장, 시각, 첫 페이지 요청 본문, 첫 페이지 응답(`nextCursor` 없이)을 두고, 개수 제한과 지우기 규칙은 없다. 저장에 실패하거나 저장된 값의 형식이 틀리면 그 thread는 저장되지 않거나 버려지고 화면과 검색은 그대로 동작한다. 첫 화면 검색창과 후속 입력창의 최근 검색 버튼은 "최근 검색" 시트(thread 목록)를 연다. 줄은 thread의 첫 문장과 마지막 요청 시각("오늘 오후 2:10", 다른 날은 "10월 14일", 요청 기록의 시각처럼 기기 시간대 기준)이고 마지막 요청 시각 최신순이며 지금 thread에는 "보는 중"을 붙인다. 줄을 누르면 시트를 닫고 그 thread로 바꾼다. 그 thread의 마지막 요청이 지금 보는 요청이 되어 네트워크 요청 없이 그때 결과로 보이고(다시 연 thread의 요청은 저장한 첫 페이지뿐이고 다음 페이지를 부르지 않는다), 이어서 후속 조건을 보낼 수 있다. 비어 있으면 "아직 검색한 요청이 없어요. 원하는 분위기나 목적을 말해 보세요."를 보인다. 재로드하면 첫 화면에서 시작한다. 저장소는 `ui/thread-storage.ts`(목록 읽기, thread 하나 읽기, `saveThread`)로만 읽고 써서 나중에 서버 저장(목록은 cursor paging)으로 이 모듈만 바꾼다. thread의 모양, 요청 더하기(`appendTurn`), 정렬, 형식 검사, 시각 문구는 `model/search-threads.ts`의 순수 함수다(D-91).
54. 주변 추천 카드: 지금 보는 요청이 없고 검색 중이 아닐 때 첫 화면은 검색 API에 `{ query: "근처 맛집" }`(`nearbyRequest()`, 좌표와 `mapBounds` 없음)를 보낸 근처 응답에서 기준 지점과의 거리가 반경(42번) 이하인 카드를 응답 순서대로(모든 카드에 `score`가 없으면 기준 지점에서 가까운 순으로, place-lookup-db D-12) 앞에서 10곳까지 가로 목록으로 보여 주고, 지도에는 같은 순위 번호(1부터)의 핀을 찍는다. 이 요청은 요청 기록과 최근 검색에 넣지 않고, 쿼리는 `placeQueries.nearby()`(기록 항목과 다른 키, 페이지 세션 동안 다시 받지 않음)다. 받은 카드는 장소별 최근 카드에 둔다. 반경 안 카드가 없거나 요청이 실패하면 목록을 그리지 않는다(D-82).
55. 주변 카드의 기준 지점은 기기 위치가 있으면 그 위치, 없으면(시도 전, 실패) 역삼역(위도 37.5006, 경도 127.0364)이다. 역삼역 기준일 때 카드의 거리는 "역삼역 350m"처럼 쓴다. 카드는 위쪽 사진(없으면 자리표시), 순위, 이름, 업종 · 거리 · 영업 상태, 핏 점수(`score`가 없으면 그리지 않는다), 라벨 2개이며 주의점은 없다. 가운데 카드가 선택된 카드이고, 넘기면 그 카드를 선택하고 지도를 그 핀으로 `panTo`한다. 핀이나 가운데가 아닌 카드를 누르면 그 카드로 넘긴다. 선택된 카드를 누르면 `/place?id=<id>`로 간다. 첫 화면의 "내 위치" 버튼은 카드 목록 바로 위 오른쪽(목록이 없으면 검색창 위 오른쪽)에 있다(D-82, D-83).
56. 첫 화면과 결과 화면(결과 패널 중간 상태)의 지도 오른쪽 위에 "저장한 장소"(북마크 아이콘)와 "내 정보"(사람 아이콘) `Fab`을 세로로 두고, 누르면 "준비 중이에요" 토스트를 띄운다. "내 주변 추천" 라벨은 그리지 않는다(D-85, D-80).
57. 과거 결과(와이어프레임 `PastResult`): 요청 기록에서 지금 보는 요청이 아닌 줄의 "결과 보기"는 지금 보는 요청을 바꾸지 않고 과거 결과 화면을 연다. 결과는 다시 받지 않는다. 이번 페이지 세션에 받은 요청은 캐시에 받아 둔 페이지를 그대로 보이며 다음 페이지를 더 부르지 않고, 다시 연 thread의 요청은 저장한 첫 페이지를 보인다. 영업 상태는 그때 값이다(D-79). 근처 응답이면 지금 보는 요청과 같이 위치로 거른다(41번). 화면은 지도 왼쪽 위 "현재 검색으로" 버튼, 결과 패널 위쪽 "<시각> 결과 · “<문장>”"(시각은 53번과 같은 문구), 순위가 붙은 카드 목록과 핀, 패널 아래 "이 조건으로 다시 검색" 버튼과 "새 결과는 기록 끝에 추가되고, 이 결과는 그대로 남아요."다. 패널 머리글(요청 기록, 새 검색), 후속 입력창, "이 지역에서 검색"은 없고, "내 위치"와 지도 위 버튼(56번)은 있다. 카드와 핀은 38번대로 동작하며 선택은 과거 결과를 열거나 닫을 때 비운다. "현재 검색으로"는 요청 기록을 펼친 결과 패널로 돌아간다. "이 조건으로 다시 검색"은 그 요청의 첫 페이지 요청 본문을 그대로 같은 종류와 기준 요청으로 보내고, 성공하면 새 요청이 지금 thread 끝에 쌓여 지금 보는 요청이 되며 과거 결과 화면이 닫힌다. 원래 요청과 결과는 그대로 남는다. 과거 결과 화면은 `search-store`에 있어 상세에 갔다가 돌아와도 그대로다(D-90).
58. 장소 상세의 모양(와이어프레임 `Detail`, `DetailMenu`, `DetailInfo`): 상단 막대 없이 사진(없으면 자리표시)이 화면 폭 가득 크게 보이고 아래쪽이 바탕색으로 흐려지며, 사진 위 왼쪽에 "뒤로", 오른쪽에 "공유" `Fab`을 띄우고 사진이 둘 이상이면 넘김 점을 둔다. 업종 · 거리, 이름, 핏 점수, 영업 상태와 오늘 안내, 상세 `tags`(강조 색 없음)는 흐려진 사진 위 바탕에 둔다. 핏 점수는 "<점수> 핏 점수 ⓘ" 전체가 ⓘ 시트를 여는 하나의 버튼이다(카드에 `score`가 없으면 이 버튼은 없다). 탭은 화면 위쪽에 붙는다. 홈 탭은 섹션(추천 이유와 주의, 장소 정보, 메뉴, 리뷰 자리) 사이를 두꺼운 띠로 나누고, 추천 이유 아래에 `matched: false`인 `scoreItems`마다 "이 장소는 ‘<label>’ 취향을 확인할 근거가 부족해요"(출처가 REQUEST면 "요청을")를 흐린 안내로, 그 아래 주의점을 주의 안내로 보인다. 장소 정보의 영업시간 줄은 "<영업 상태> · 오늘 08:00 – 22:00"이고 펼치면 정보 탭과 같은 요일별 표다. 전화 줄은 ›, 웹사이트 줄은 바깥 링크 아이콘이 붙고, "정보 더보기 ›"는 가운데 둥근 테두리 버튼이다. 메뉴 머리글은 "메뉴 <개수> ›" 링크로 메뉴 탭을 연다. 메뉴 탭은 카테고리 이름을 작은 흐린 글씨로, 줄마다 64px 사진, 굵은 이름과 옆의 작은 라벨·"대표" 칩, 이름 아래 흐린 설명(두 줄까지, 넘치면 말줄임), 오른쪽 가격 원문을 두고 줄 사이를 선으로 나눈다. 정보 탭 영업시간은 위에 "<영업 상태> · <오늘 안내>"(45번)를 두고, 요일별 표에서 오늘 줄은 "<요일> · 오늘"로 굵게, 브레이크타임은 하나마다 "15:00 – 16:00 브레이크타임", 라스트오더는 "14:30, 21:30 라스트오더" 줄로, 휴무일은 "휴무", 정보 없는 요일은 "정보 없음", `00:00`–`00:00`은 "24시간 영업"으로 쓴다. 시각 범위는 "08:00 – 22:00"으로 쓰고, 마감 `00:00`은 "24:00", 자정을 넘는 영업은 "17:00 – 02:00"이다. 주소 줄에는 "주소 복사" 버튼(클립보드에 넣고 "주소를 복사했어요", 실패하면 "주소를 복사하지 못했어요")을 두고, 시설은 아이콘이 붙은 테두리 칩(이름 그대로, 비슷한 시설을 묶은 아이콘, 묶음에 없는 이름은 기본 아이콘)이고, 그 아래 "제목 · 내용" 줄, 맨 아래에 "정보가 실제와 다를 수 있어요"를 둔다. 하단 막대는 "저장"(북마크 테두리 버튼)과 리뷰 자리의 `bottomAction`을 나란히 둔다. "공유"와 "저장"은 누르면 "준비 중이에요" 토스트를 띄운다. 리뷰 자리 안의 모양은 바꾸지 않는다(D-92, D-94).
59. 정보 탭 위치 지도: 주소 줄 아래에 높이를 CSS로 정한 작은 `PlaceMap`을 두고 그 장소 핀 하나만 찍으며 중심은 그 장소다. 정보 탭을 열었을 때만 만들고(지도 사용량은 지도 생성 횟수), 지도 키가 없거나 인증이 실패하면 지도 자리를 그리지 않는다. 내 위치 점과 "이 지역에서 검색"은 없다(D-93).

## Usage

1. **입력 중 후보 (5-01)**: 화면 아래 검색창에 "역삼 쌀국수"를 입력하면 300ms 뒤 `GET /api/v1/places/suggest?q=역삼 쌀국수`가 나가고, "하노이 쌀국수 역삼점 · 식당 · 280m", "포레스트 키친 · 식당 · 600m · 메뉴: 양지 쌀국수"와 "이 조건으로 추천받기"가 뜬다. 거리는 위치를 얻었을 때만 보인다(D-32, D-70, D-52).
2. **추천 검색 (5-03, 5-04)**: 엔터를 치면 `POST /api/v1/places/search`가 `{query: "역삼에서 조용히 대화하기 좋은 카페"}`로 나가고, 응답의 카드 20개가 순위 번호와 함께 목록과 지도 핀으로 나온다. 스크롤하면 `nextCursor`로 다음 20개를 가져온다(D-32, D-50, D-70).
3. **후속 조건과 요청 기록 (5-06, 5-07)**: 패널 아래 입력창에 "더 조용하게"를 보내면 직전 응답의 `conditions`가 `previousConditions`로 나가고 "요청하신 조건을 반영했어요" 배너와 "추가 조건 · 더 조용하게" 칩이 보인다. 요청 기록에서 첫 요청의 "여기서 이어 검색"을 누른 뒤 "카페 말고 식당"을 보내면 첫 요청의 `conditions`가 기준이 된다(D-50).
4. **근처 검색과 내 위치**: "근처 카페"를 보내면 응답이 `nearby: true`와 후보 전체로 오고, 브라우저가 위치 권한을 물은 뒤 현재 위치로 반경을 걸러 보여 준다. 지도의 "내 위치"를 누르면 언제든 위치를 받아 거리를 표시한다. 위치는 서버로 나가지 않는다(D-52).
5. **핀과 카드, 장소 상세 (6-01~6-05)**: 핀을 누르면 그 카드가 선택되고, 다른 카드를 누르면 지도가 그 핀으로 이동한다. 선택된 카드를 다시 누르면 `/place?id=…`로 가서 `GET /api/v1/places/{id}`로 사진, 영업시간, 메뉴, 시설을 가져온다. 추천 이유와 핏 점수 설명은 검색에서 받은 카드의 값을 쓴다(D-66, D-70, D-64).
6. **개발자가 결과 없음 응답을 볼 때**: BE Mock에 `X-Mock-Scenario: empty` 헤더를 붙여 검색을 직접 부르면(curl 등) 결과 없음 응답이 온다. FE의 결과 없음 화면은 테스트가 가짜 응답으로 확인한다(D-63, D-95).
7. **첫 화면 (와이어프레임 Start, StartNoLoc)**: 위치 권한을 이미 허용한 사용자가 `/`를 열면 지도가 내 위치로 옮겨 가고, 아래 검색창 위에 "카페 온담 · 카페 · 350m · 영업 중" 같은 주변 카드가 가로로 넘어가며 지도에 1, 2, 3… 핀이 찍힌다. 권한을 허용하지 않은 사용자에게는 같은 카드가 "역삼역 350m" 기준으로 보인다. 오른쪽 위의 북마크와 사람 버튼은 "준비 중이에요"를 띄운다(D-82, D-83, D-85).
8. **최근 검색 (와이어프레임 StartRecent)**: 어제 "역삼에서 조용히 대화하기 좋은 카페"를 검색한 사용자가 오늘 다시 열어 검색창의 기록 아이콘을 누르면 "최근 검색" 시트에 그 문장과 "10월 22일"이 보이고, 누르면 어제 받은 결과가 "10월 22일 결과 · “역삼에서 조용히 대화하기 좋은 카페”"로 다시 받지 않고 보인다. "이 조건으로 다시 검색"을 누르면 그 문장으로 새 검색이 나간다(D-91, D-90).

## Acceptance criteria

- [x] AC-1: `GET /api/v1/places/suggest`는 `q`(1자 이상)에 대해 장소 후보(`type: PLACE`)와 "이 조건으로 추천받기"(`type: ACTION`)를 돌려준다. 장소 이름이 `q`와 같거나 `q`로 시작하는 후보가 있으면 그 장소가 맨 위이고, 없으면 `ACTION`이 맨 위다(메뉴, 업종 일치는 순서에 영향을 주지 않는다). 메뉴 이름으로 일치한 후보는 `matchedMenu`에 그 메뉴 이름을 담는다. (D-32, D-63, D-64) Mock 모드의 기준이다. DB 모드의 기준은 `docs/specs/place-lookup-db/spec.md`의 AC-1~AC-8이다.
- [x] AC-2: `POST /api/v1/places/search`에 헤더 없이 일반 질의를 보내면 항목 20개, `totalCount`, `nextCursor`가 온다. 그 커서로 다시 보내면 나머지 항목이 오고 `nextCursor`가 없다. 두 페이지의 항목은 겹치지 않는다. (D-50, D-63, D-64)
- [x] AC-3: 헤더 `X-Mock-Scenario: empty`로 검색하면 200이고 `items`는 비어 있으며 `totalCount`는 0이고 `emptyReason`에 원인과 수정 제안이 있다. (D-10, D-63)
- [x] AC-4: 질의에 "근처"가 있으면 `nearby: true`이고 `nextCursor`가 없으며, Mock 모드에서 항목은 후보 전체(최대 100)를 `score` 내림차순으로 담는다. DB 모드에서는 카탈로그 전체(상한 없음)를 `place_id` 오름차순으로 담고 `score`가 없다(place-lookup-db AC-17, AC-18). (D-63, D-52)
- [x] AC-5: 요청에 `previousConditions`를 넣으면 Mock 응답의 `conditions`가 그 값을 그대로 담고 `changeSummary`가 있다. 넣지 않으면 `conditions`는 `{}`이고 `changeSummary`가 없다. BE는 `conditions`의 내부를 해석하지 않는다. (D-50, D-63, D-64)
- [x] AC-6: 임의의 검색 응답에서 모든 `score`는 0 이상 100 이하의 정수, `labels`는 2개, `scoreItems`의 `evidenceCount`는 0 이상의 정수이고 `openStatus`는 정의된 값 중 하나다. FE는 점수를 정수 그대로 `%` 없이 표시한다. (D-41, D-64)
- [x] AC-7: 요청 본문에 정의되지 않은 속성(예: `lat`, `lng`)이 있으면 400 ProblemDetail이고, 정의된 필드만 있는 요청은 정상 처리된다. (D-10, D-41)
- [x] AC-8: 세 엔드포인트의 정상 응답 JSON 키는 문서화된 DTO 필드 집합을 벗어나지 않으며 외부 리뷰를 담는 필드가 없다. `conditions` 객체의 내부 키와 ProblemDetail 표준 키는 검사 대상이 아니다. (D-41, D-64)
- [x] AC-9: Mock이 켜진 환경에서는 Mock이 정상 응답한다. Mock이 꺼진 환경(DB 모드)의 응답은 `docs/specs/place-lookup-db/spec.md`(AC-12, AC-17~AC-21)를 따른다. DB 모드가 생기기 전에는 엔진이 없어 세 엔드포인트가 503이었다. (D-63)
- [x] AC-10: `GET /api/v1/places/{id}`는 알려진 `id`에 `hours`(7일), `menus`(카테고리는 있을 때만), `facilities`(시설 이름), `tags`, `photos`, `openStatus`를 돌려주고, 모르는 `id`에는 404, 정수가 아닌 `id`에는 400 ProblemDetail을 돌려준다. 상세 응답에는 `score`, `reasons`, `scoreItems`가 없다. (D-32, D-10, D-64)
- [x] AC-11: 빈 값, 공백뿐인 값, 200자를 넘는 `q`와 `query`는 400 ProblemDetail이다. (D-10, D-64)
- [x] AC-12: `Authorization` 헤더가 있든 없든 세 엔드포인트의 응답이 같다. `preferences`는 받아 두되 Mock은 결과에 반영하지 않는다. (D-33)
- [x] AC-13: 검색과 자동완성 요청을 처리한 뒤(잘못된 요청으로 400이 난 경우 포함) BE 로그 출력에 요청 본문, `preferences`, `q`, `query` 값이 나타나지 않는다. (D-20)
- [x] AC-14: 컨트롤러와 `PlaceService`는 `PlaceSearchEngine`의 반환값을 가공하거나 검증하지 않고 그대로 응답한다. 다른 `PlaceSearchEngine` 구현으로 바꿔도 컨트롤러와 `PlaceService`는 수정할 필요가 없다. (D-62, D-64, D-56)
- [x] AC-15: 자동완성은 입력이 멈춘 뒤 300ms 뒤에 한 번만 요청하고, 입력이 비면 요청하지 않으며, 새 요청을 보내면 이전 요청을 취소하고, 늦게 도착한 응답은 화면에 반영하지 않는다. (D-70)
- [x] AC-16: FE가 만드는 검색 요청 본문에는 기기 위치를 얻었어도 그 좌표가 어떤 필드에도 들어가지 않는다. 검색 대상 지역인 `mapBounds`는 좌표 금지의 예외이며, 사용자가 "이 지역에서 검색"을 눌렀거나 위치를 얻지 못한 것이 확인된 뒤에만 담는다. 근처 응답이 오고 위치를 얻으면 FE는 현재 위치와 반경으로 항목을 걸러 낸다. (D-41, D-52)
- [x] AC-17: 주소에 `?mock=empty`가 있어도 FE의 검색, 자동완성, 상세 요청에 `X-Mock-Scenario` 헤더가 붙지 않는다. (D-95)
- [x] AC-18: `/config.json`에 지도 키가 없거나 그 요청이 실패하거나 인증이 실패하면(`navermap_authFailure`) 지도 영역은 비어 있고 카드 목록, 후속 조건, 요청 기록은 정상 동작한다. (D-70, D-57)
- [x] AC-19: 선택된 카드를 다시 누르면 `/place?id=…`로 이동해 상세가 표시되고, 뒤로 가면 기존 결과, 선택된 카드, 요청 기록이 유지된다(보관 방식은 미결이며 어떤 방식이든 이 동작이 목표다). (D-49, D-66, D-35, D-27)
- [x] AC-20: 장소 데이터는 브라우저의 `fetch`로 `/api/v1/...`를 불러 가져온다. Server Actions나 Route Handler로 장소 데이터를 가져오지 않는다. (D-38)
- [x] AC-21: `infra/local`의 Postgres를 띄우고 `be/.env.example`을 `be/.env`로 복사하고 `SPRING_DATASOURCE_PASSWORD`를 `infra/local/.env`의 `FIT_DEV_APP_PASSWORD` 값으로 바꾸면 다른 환경변수 없이 BE가 `fit_dev_app` 계정으로 기동하고 세 엔드포인트가 응답한다. Flyway는 실행되지 않는다. 환경변수 `SPRING_DATASOURCE_*`가 있으면 기본값보다 우선한다. `build.gradle`은 사용자가 추가한 validation starter 외에는 바뀌지 않는다. (D-32, D-40, D-55, D-65)
- [x] AC-22: FE 개발 서버(`localhost:3000`)에서 `/api/v1/places/suggest?q=역삼`을 부르면 BE(`localhost:8080`)의 응답이 그대로 오고, BE에는 CORS 설정이 없다. `next build` 산출물(`.next/routes-manifest.json`)에는 rewrites와 `localhost`가 없다. (D-69)
- [x] AC-23: 지도가 있으면 지금 보이는 카드마다 핀이 하나씩 있고, 핀에는 그 카드와 같은 순위 번호가 보인다. 근처 필터로 걸러진 카드의 핀은 보이지 않는다. (D-70)
- [x] AC-24: 핀을 누르면 해당 카드가 선택되고 핀이 강조되며 목록이 그 카드로 스크롤된다. 선택되지 않은 카드를 누르면 지도가 그 핀으로 이동하고 카드와 핀이 선택된다. 한 번에 선택된 카드는 하나다. (D-70)
- [x] AC-25: Mock의 `openStatus`는 고정한 시각에서 영업시간 밖 또는 휴무일이면 `CLOSED`, 브레이크타임이면 `BREAK`, 마감 60분 이내면 `CLOSING_SOON`, 그 밖의 영업시간이면 `OPEN`이다. 자정 넘김, 이어진 24시간, 정보 없는 요일(`UNKNOWN`)은 place-catalog AC-11을 따른다. (D-64)
- [x] AC-26: 결과가 있으면 위쪽 검색창 대신 패널 아래 후속 입력창이 보이고, 그 입력은 기준 요청의 첫 페이지 `conditions`를 `previousConditions`로 담아 보낸다. "새 검색"을 누르면 결과와 조건이 비워지고 위쪽 검색창으로 돌아가며 다음 요청에는 `previousConditions`가 없다. (D-50)
- [x] AC-27: 요청 기록에는 이번 세션의 요청이 입력 문장, 업종과 곳 수, 시각과 함께 쌓인다. "결과 보기"는 네트워크 요청 없이 그 요청의 결과를 과거 결과 화면으로 보여 주고 지금 보는 요청을 바꾸지 않으며, "여기서 이어 검색" 뒤의 후속 입력은 그 요청의 `conditions`를 `previousConditions`로 보낸다. (D-50, D-90)
- [x] AC-28: 위치를 얻기 전에는 자동완성, 결과 카드, 상세에 거리가 보이지 않는다(첫 화면 주변 카드의 "역삼역 <거리>"는 AC-33). "내 위치"를 눌러 위치를 얻으면 지도에 내 위치 점이 생기고 세 곳 모두 거리가 보인다. 이 과정에서 서버로 가는 요청에는 좌표가 없다. (D-52)
- [x] AC-29: 상세 화면은 리뷰 자리를 받지 않으면 홈, 메뉴, 정보 탭만 보여 주고 하단 막대에는 저장 버튼만 있다. 자리를 받으면 탭이 홈, 메뉴, 리뷰, 정보이고 홈 탭 맨 아래와 하단 막대에 받은 내용이 보이며, 홈의 리뷰 자리에서 리뷰 탭으로 바꿀 수 있다. 검색 카드가 있으면 핏 점수와 ⓘ 시트(`scoreItems`), AI 추천 이유, 주의점이 보이고, 없으면 이 영역들이 숨겨지고 장소 정보만 보인다. 카드가 있어도 `score`가 없으면 핏 점수와 ⓘ는 숨겨진다. (D-49, D-64, D-27, D-86, D-92, place-lookup-db D-12)
- [x] AC-30: `GET /config.json`은 요청 시점의 환경변수에서 `env`와 `naverMapClientId`만 돌려주고 다른 키는 없다. 환경변수를 바꾸고 서버를 다시 띄우면 다시 빌드하지 않아도 새 값이 나온다. (D-57)
- [x] AC-31: 지금 보는 요청이 없으면 검색창("분위기나 목적을 말해 보세요")이 화면 아래에 있고 자동완성 후보는 검색창 위에 열린다. 결과가 있으면 이 검색창 대신 결과 패널 아래 후속 입력창이 화면 맨 아래에 있고 결과 목록은 그 위에 있다. (D-81)
- [x] AC-32: 화면을 열 때 위치 권한이 이미 `granted`이면 위치를 받아 지도를 그 위치로 옮기고, 그 위치에서 반경 안의 주변 카드(최대 10곳)를 가로 목록으로, 같은 순위 번호의 핀과 함께 보인다. 권한이 `granted`가 아니면 열 때 위치를 요청하지 않는다(`denied`면 안내를 한 번 띄운다). (D-82, D-83)
- [x] AC-33: 위치가 없거나 실패하면 주변 카드는 역삼역 기준 반경 안 장소이고 거리는 "역삼역 <거리>"로 보인다. 주변 카드의 검색 요청 본문은 `query`뿐이고 좌표와 `mapBounds`가 없으며, 이 요청은 요청 기록과 최근 검색에 쌓이지 않는다. 카드를 넘기면 그 카드가 선택되고 지도가 그 핀으로 옮겨 가며, 선택된 카드를 누르면 상세로 간다. (D-82, D-83)
- [x] AC-34: 새 검색은 새 thread를 시작하고 후속 조건은 같은 thread에 쌓이며, 요청 기록에는 지금 thread의 요청만 보인다. thread는 재로드 뒤에도 "최근 검색" 시트에 첫 문장과 마지막 요청 시각으로 최신순으로 보이고, 줄을 누르면 네트워크 요청 없이 그 thread의 마지막 결과와 요청 기록이 보이며, 이어 보낸 후속 조건은 그 thread의 `conditions`를 `previousConditions`로 담아 같은 thread에 쌓인다. 기록이 없으면 빈 안내가 보이고, `localStorage`를 쓸 수 없거나 저장된 값이 깨져 있어도 검색은 동작한다. (D-91)
- [x] AC-35: 첫 화면과 결과 화면의 지도 오른쪽 위에 "저장한 장소"와 "내 정보" 버튼이 있고, 누르면 "준비 중이에요" 토스트가 뜬다. (D-85)
- [x] AC-36: 자동완성 후보 상자는 응답에서 `ACTION`이 어디 있든 "이 조건으로 추천받기"를 맨 위에, 장소 후보를 응답 순서대로 그 아래에 보인다. 후보가 보이는 동안 어두운 막이 지도와 주변 카드를 가리고 막을 누르면 후보가 닫힌다. 입력이 있으면 "입력 지우기" 버튼이 있고 누르면 입력이 비워진다. (D-87)
- [x] AC-37: 첫 페이지를 받는 동안 결과 패널은 "요청을 이해하는 중", "주변 장소를 찾는 중", "취향과 맞춰 보는 중"을 1.5초마다 차례로 보이고, 후속 입력창은 비활성이다. (D-88)
- [x] AC-38: 결과 패널의 "요청 기록"을 누르면 모달 없이 패널 안에 요청 기록 타임라인이 펼쳐지고 후속 입력창은 그대로 보이며, 다시 누르면 결과 목록으로 돌아온다. "여기서 이어 검색"은 그 요청을 "보는 중"으로 바꾸고 결과 목록과 후속 입력창 초점으로 돌아온다. (D-89)
- [x] AC-39: 과거 결과 화면은 그때의 카드를 네트워크 요청 없이 보이고 "<시각> 결과 · “<문장>”", "현재 검색으로", "이 조건으로 다시 검색"이 있으며 후속 입력창과 패널 머리글은 없다. "현재 검색으로"는 요청 기록을 펼친 결과 패널로 돌아가고 지금 보는 요청은 그대로다. "이 조건으로 다시 검색"은 같은 요청 본문을 보내 새 요청을 지금 thread 끝에 쌓고, 원래 요청과 그 결과는 그대로 남는다. (D-90)
- [x] AC-40: 장소 상세는 상단 막대 없이 큰 사진 위에 "뒤로"와 "공유"가 있고, "<점수> 핏 점수 ⓘ" 버튼(카드에 `score`가 있을 때)이 ⓘ 시트를 연다. 홈 탭에 `matched: false` 항목마다 근거 부족 안내가, 정보 탭에 오늘 줄이 굵은 요일별 표와 "주소 복사", 아이콘이 붙은 시설 칩이 있다. 하단 막대에 "저장"과 리뷰 자리 버튼이 있고 "공유"와 "저장"은 "준비 중이에요"를 띄운다. (D-92, D-94)
- [x] AC-41: 정보 탭을 열면 지도 키가 있을 때 그 장소 핀 하나가 있는 작은 지도가 생기고, 홈과 메뉴 탭에서는 지도를 만들지 않는다. 키가 없거나 인증이 실패하면 지도 자리가 없고 정보 탭의 나머지는 보인다. (D-93)

## Implementation anchors

| Anchor | Action | Decision |
|---|---|---|
| `be/src/main/java/kr/co/fitdining/api/ApiApplication.java#ApiApplication` | reuse | D-32 |
| `be/src/main/java/kr/co/fitdining/api/place/PlaceController.java#PlaceController` | new | D-32 |
| `be/src/main/java/kr/co/fitdining/api/place/engine/PlaceSearchEngine.java#PlaceSearchEngine` | new | D-62 |
| `be/src/main/java/kr/co/fitdining/api/place/engine/MockPlaceSearchEngine.java#MockPlaceSearchEngine` | new | D-63 |
| `be/src/main/resources/mock/places.json#places` | new | D-63 |
| `be/src/main/java/kr/co/fitdining/api/place/PlaceService.java#PlaceService` | new | D-56 |
| `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSearchRequest.java#PlaceSearchRequest` | new | D-64 |
| `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSearchResponse.java#PlaceSearchResponse` | new | D-64 |
| `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSuggestResponse.java#PlaceSuggestResponse` | new | D-64 |
| `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceDetailResponse.java#PlaceDetailResponse` | new | D-64 |
| `be/src/main/resources/application.yml#spring` | new | D-40, D-41 |
| `fe/next.config.ts#nextConfig` | reuse | D-69 |
| `fe/src/shared/api/client.ts#request` | reuse | D-66 |
| `fe/src/app/config.json/route.ts#GET` | new | D-57 |
| `fe/src/app/page.tsx#Home` | modify | D-66 |
| `fe/src/app/place/page.tsx#PlaceDetailPage` | new | D-66 |
| `fe/src/domains/place/api/place-api.ts#searchPlaces` | new | D-66 |
| `fe/src/domains/place/api/place-api.ts#searchPlaces` | modify | D-95 |
| `fe/src/domains/place/api/place-queries.ts#placeQueries` | new | D-67 |
| `fe/src/domains/place/ui/place-map.tsx#PlaceMap` | new | D-70 |
| `fe/package.json#devDependencies` | modify | D-68 |
| `fe/src/domains/place/model/nearby.test.ts#nearby` | new | D-68 |
| `fe/src/shared/ui/layout/tabs.tsx#Tabs` | reuse | D-71 |
| `fe/src/shared/ui/overlay/bottom-sheet.tsx#BottomSheet` | reuse | D-71 |
| `fe/src/shared/ui/overlay/toast.tsx#useToast` | reuse | D-71 |
| `fe/src/domains/place/ui/search-bar.tsx#SearchBar` | modify | D-81 |
| `fe/src/domains/place/ui/search-screen.tsx#SearchScreen` | modify | D-81 |
| `fe/src/domains/place/ui/nearby-carousel.tsx#NearbyCarousel` | new | D-82 |
| `fe/src/domains/place/model/search-request.ts#nearbyRequest` | new | D-82 |
| `fe/src/shared/ui/display/carousel.tsx#Carousel` | reuse | D-82 |
| `fe/src/domains/place/ui/locate-device.ts#locateIfGranted` | new | D-83 |
| `fe/src/domains/place/model/search-threads.ts#appendTurn` | new | D-91 |
| `fe/src/domains/place/ui/thread-storage.ts#saveThread` | new | D-91 |
| `fe/src/domains/place/ui/recent-search-sheet.tsx#RecentSearchSheet` | modify | D-91 |
| `fe/src/shared/ui/button/fab.tsx#Fab` | reuse | D-85, D-94 |
| `fe/src/domains/place/ui/place-detail-screen.tsx#PlaceDetailScreen` | modify | D-86, D-92 |
| `fe/src/app/place/place-detail-with-reviews.tsx#PlaceDetailWithReviews` | reuse | D-86 |
| `fe/src/domains/place/model/suggestions.ts#actionFirst` | new | D-87 |
| `fe/src/domains/place/ui/search-steps.tsx#SearchSteps` | new | D-88 |
| `fe/src/domains/place/ui/history-timeline.tsx#HistoryTimeline` | new | D-89 |
| `fe/src/domains/place/ui/result-panel.tsx#ResultPanel` | modify | D-89 |
| `fe/src/domains/place/ui/past-result-view.tsx#PastResultView` | new | D-90 |
| `fe/src/domains/place/ui/place-detail-tabs.tsx#HomeTab` | modify | D-92 |
| `fe/src/domains/place/ui/place-detail-tabs.tsx#InfoTab` | modify | D-93 |

## Interfaces

엔드포인트(모두 인증 없음, 오류는 Spring ProblemDetail):

| 메서드와 경로 | 요청 | 응답 |
|---|---|---|
| `GET /api/v1/places/suggest` | 쿼리 `q` (1~200자) | `PlaceSuggestResponse[]` |
| `POST /api/v1/places/search` | `PlaceSearchRequest` | `PlaceSearchResponse` |
| `GET /api/v1/places/{id}` | 경로 `id` | `PlaceDetailResponse` |

요청 헤더 `X-Mock-Scenario: empty`는 Mock 구현만 읽는다.

```java
// 계층: PlaceController → PlaceService(404 판단) → PlaceSearchEngine(503을 던짐) (D-56)
// 엔진 관련 타입(PlaceSearchEngine, 구현, InvalidCursorException)은 kr.co.fitdining.api.place.engine에 둔다 (D-62)
// 잘못된 cursor를 알리는 엔진 계약의 예외. 예외 처리 클래스가 400으로 바꾼다.
public class InvalidCursorException extends RuntimeException {}

// PlaceSearchEngine: 교체 지점. 구현이 바뀌면 시그니처도 바뀔 수 있다(D-62).
public interface PlaceSearchEngine {
    List<PlaceSuggestResponse> suggest(String q);
    PlaceSearchResponse search(PlaceSearchRequest request);
    Optional<PlaceDetailResponse> findPlace(long id);
}
```

```text
kr.co.fitdining.api.place.dto (D-64. 파일은 아래 들여쓰지 않은 7개이고, 들여쓴 줄은 바로 위 타입 안에 중첩한
  record와 enum이다. 필드 목록만. ?는 선택 필드로 없으면 JSON에서 생략.
  숫자와 boolean은 박싱 타입(Long, Integer, Double, Boolean))
  PlaceSummary   : id(Long), name, categoryGroup, station, lat(Double), lng(Double), thumbnailUrl?
    enum CategoryGroup : RESTAURANT | CAFE | BAR            (화면: 식당, 카페, 술집)
    enum Station       : GANGNAM | YEOKSAM | SEOLLEUNG
  enum OpenStatus      : OPEN | CLOSING_SOON | BREAK | CLOSED | UNKNOWN
                         (화면: 영업 중, 곧 마감, 브레이크타임, 영업 종료, 표시 안 함)
  PlaceSuggestResponse : type, place?(PlaceSummary), matchedMenu?(String), label?(String)
    enum SuggestType   : PLACE | ACTION
  PlaceSearchRequest   : query(@NotBlank @Size(max = 200)), preferences?(String[] 태그 코드),
                   previousConditions?(JSON 객체, 불투명),
                   mapBounds?(MapBounds), cursor?(String, 불투명)
    MapBounds    : swLat?, swLng?, neLat?, neLng? (Double)
  PlaceSearchResponse  : conditions(JSON 객체, 불투명), nearby(Boolean), totalCount(Integer),
                   items(PlaceCard[]), nextCursor?, emptyReason?(EmptyReason), changeSummary?(String)
    EmptyReason  : cause, suggestion
  PlaceCard      : place(PlaceSummary), score?(Integer 0..100), labels(String[2]), caution?(String),
                   openStatus(OpenStatus), reasons(Reason[]), scoreItems(ScoreItem[])
                   -- DB 모드(AI 엔진 전)에서는 score와 caution을 생략하고 labels, reasons, scoreItems는 빈 목록이다(place-lookup-db D-12)
    Reason       : title, tags(ReasonTag[]), quote?(String), quoteSource?(String, 예: "앱 리뷰")
    ReasonTag    : source(EvidenceSource), label
    ScoreItem    : source(EvidenceSource), label, matched(Boolean), evidenceCount(Integer >= 0)
    enum EvidenceSource: REQUEST | PREFERENCE              (화면: "요청 ·", "내 취향 ·")
  PlaceDetailResponse  : place(PlaceSummary), address, tags(String[]), photos(String[] URL),
                   phone?, website?, openStatus(OpenStatus), hours(Hours[7]), closedDayNote?(String),
                   menus(Menu[]), facilities(String[] 시설 이름), subways(Subway[]), directions?,
                   parking?(Parking), pet?(Pet), noKidsZone(Boolean), corkage?(Corkage), bookingUrl?,
                   seats(Seat[]), description?, paymentMethods(String[]), broadcasts(Broadcast[]),
                   extraLinks(String[])
    Hours        : dayOfWeek(DayCode), open?(HH:mm), close?(HH:mm), breaks(Break[]),
                   lastOrders(String[] HH:mm), closed(Boolean)
                   (close가 open 이하면 다음 날 마감, 24시간은 00:00–00:00, 시각 없이 closed false면 정보 없음)
    Break        : start(HH:mm), end(HH:mm)
    Menu         : category?, name, description?, price?(Integer 원, 정가일 때만), priceText?, labels(String[]),
                   representative(Boolean), photoUrl?
    enum DayCode : MON | TUE | WED | THU | FRI | SAT | SUN
    Subway, Parking, Pet, Corkage, Seat, Broadcast는 place-catalog spec의 Interfaces를 따른다
```

```text
FE (D-66, D-67. 파일 이름은 kebab-case, 테스트는 소스 옆 *.test.ts(x), barrel 없음)
src/app/                       라우트와 레이아웃만
  page.tsx                     검색 화면(place ui의 화면 컴포넌트를 그린다)
  place/page.tsx               장소 상세(?id). place-detail-with-reviews.tsx로 리뷰 자리를 채워 그린다 (D-86)
  config.json/route.ts         GET /config.json
  layout.tsx                   lang ko, metadata
src/domains/place/             의존은 ui → api → model 방향만
  model/place-types.ts         위 DTO의 TS 타입 (id는 number)
  model/nearby.ts              distanceMeters(a, b), formatDistance(m), filterNearby(cards, here, radiusM = 1000)
  model/search-request.ts      다음 요청 본문을 만드는 순수 함수(새 검색, 후속, 커서, 이 지역에서 검색)
  model/search-store.ts        React 없는 store: 요청 기록 메타, 지금 보는 항목, 선택된 카드, 위치 결과,
                               지역 고정 상태, 장소별 최근 카드. 바뀌면 구독자에게 알린다
  model/place-labels.ts        업종, 영업 상태, 근거 출처의 한글 이름, 시설 이름 → 아이콘 묶음 표 (D-72)
  model/opening-hours.ts       Asia/Seoul 기준 오늘 영업시간, 오늘 안내, 요일별 영업시간 문구 (D-72)
  model/highlight.ts           자동완성 후보에서 입력과 같은 부분 나누기 (D-72)
  model/place-id.ts            상세 ?id 검사 (D-72)
  model/search-threads.ts      thread 모양, 요청 더하기(appendTurn), 목록 정렬, 형식 검사, 시각 문구 (D-91)
  model/suggestions.ts         자동완성 후보 순서(actionFirst: ACTION을 맨 위로) (D-87)
  api/place-api.ts             suggestPlaces(q, signal), searchPlaces(request, signal), getPlace(id, signal)
                               공통 request를 쓴다. X-Mock-Scenario 헤더는 보내지 않는다 (D-95)
  api/place-queries.ts         placeQueries.suggest(q), placeQueries.search(entryId, request), placeQueries.detail(id)
                               쿼리 키와 queryOptions는 여기서만 만든다. ui는 useQuery 등에 이것을 넘긴다
  ui/use-suggest.ts            300ms 늦춘 입력으로 placeQueries.suggest를 부르는 훅
  ui/use-search-store.ts       search-store를 useSyncExternalStore로 구독하는 훅
  ui/place-map.tsx             PlaceMap (D-70)
  ui/nearby-carousel.tsx       첫 화면 주변 카드 가로 목록 NearbyCarousel (D-82)
  ui/locate-device.ts          locateDevice(), 권한이 이미 허용일 때만 위치를 받는 locateIfGranted() (D-83)
  ui/thread-storage.ts         thread 저장소(지금은 localStorage, 나중에 서버). 목록 읽기, thread 하나 읽기, saveThread (D-91)
  ui/recent-search-sheet.tsx   최근 검색(thread 목록) 시트 RecentSearchSheet (D-91)
  ui/search-steps.tsx          검색 중 단계 문구 SearchSteps (D-88)
  ui/history-timeline.tsx      결과 패널 안에 펼치는 요청 기록 HistoryTimeline (D-89)
  ui/past-result-view.tsx      과거 결과 화면 PastResultView (D-90)
  ui/(그 밖)                   검색창과 자동완성, 결과 패널과 카드, 후속 입력창, 요청 기록, 상세 탭과 핏 점수 시트
                               (shared/ui와 토큰을 쓰고, 장소 전용 모양만 여기서 만든다. D-71)
src/shared/lib/runtime-config.ts  /config.json을 페이지 세션에 한 번 받아 메모리에 두는 모듈
```

anchor 표에 없지만 만들거나 고치는 파일: 위 FE 구조의 나머지 파일, `fe/src/app/layout.tsx`, `fe/pnpm-workspace.yaml`(필요할 때만), Vitest 설정과 테스트, `be/.env.example`, `fe/.env.example`과 `fe/.gitignore`(D-75), `PlaceExceptionHandler`와 예외 클래스, `dto` 패키지의 `PlaceSummary`, `OpenStatus`, `PlaceCard`와 중첩 타입, BE 테스트(컨트롤러, Mock 데이터, 영업 상태). `docs/infra/` 아래 파일은 고치지 않는다.

설정:

```text
application.yml : application.properties를 대체한다 (D-40)
  spring.application.name   : api
  spring.config.import      : optional:file:.env[.properties]
  spring.datasource.*       : ${SPRING_DATASOURCE_URL:jdbc:postgresql://127.0.0.1:15432/fit_dev},
                              ${SPRING_DATASOURCE_USERNAME:fit_dev_app}, ${SPRING_DATASOURCE_PASSWORD} (기본값 없음)
  spring.flyway.enabled     : false (웹 앱은 DML 전용 계정이다)
  JSON                      : 요청 본문의 알 수 없는 속성 거부, null 필드 생략 (속성 이름은 구현 때 확인, D-41)
  place.mock.enabled        : ${PLACE_MOCK_ENABLED:false} (D-63)
fe/next.config.ts : next dev일 때만 rewrites /api/:path* → ${BE_INTERNAL_URL ?? 'http://localhost:8080'}/api/:path*. master에 이미 있어 고치지 않는다 (D-69)
fe/.env.local     : NAVER_MAP_CLIENT_ID, (선택) APP_ENV, BE_INTERNAL_URL. git 무시 (D-57, D-69)
fe/.env.example   : 위 값의 예제. .env.local로 복사해 쓰고, fe/.gitignore에 !.env.example을 더해 추적한다 (D-75)
GET /config.json  : { env: "dev" | "prod", naverMapClientId?: string }, Cache-Control: no-store (D-57)
```

## Seams & test plan

- **BE 컨트롤러 경계** (example), AC-1, AC-2, AC-3, AC-4, AC-5, AC-7, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14: `@WebMvcTest`로 MockMvc가 세 엔드포인트를 호출한다. `PlaceService`와 Mock 엔진은 `@Import`로 넣고, 일부는 가짜 `PlaceSearchEngine`을 꽂아 컨트롤러와 Service가 반환값을 가공하지 않는지 본다. 테스트 이름은 팀 BE 컨벤션(`method_scenario_expected`, 한글 `@DisplayName`)을 따른다. 로그 검증은 출력 캡처를 쓴다. 잡는 것: 경로, 상태 코드, 요청 검증, 페이징, 로그 누출. 놓치는 것: 실제 JSON 직렬화 설정이 전체 앱에서 같은지(기동 테스트는 AC-21). Prior art: 없음(`be/src/test`에는 `ApiApplicationTests`의 기동 테스트뿐).
- **Mock 데이터와 영업 상태** (example), AC-2, AC-4, AC-6, AC-8, AC-25: `places.json`을 읽어 장소가 30~40곳이고 점수, 라벨, `scoreItems`, `hours` 규칙을 지키며 응답 JSON 키가 문서화된 집합을 넘지 않는지 확인한다. 고정 `Clock`과 테스트 안에서 만든 영업시간으로 영업 상태 경계(마감 60분 전, 브레이크 시작, 휴무일, 자정 넘김, 이어진 24시간, 정보 없음)를 확인한다. 잡는 것: 데이터 오타, 규칙 위반, 시각 계산 오류. 놓치는 것: 실제 AI 데이터의 품질.
- **FE 순수 로직** (example), AC-16, AC-26, AC-27: Node 환경의 Vitest. 근처 필터와 거리 표시(haversine, 반경 이하 포함, "350m"과 "1.2km" 경계)는 `fe/src/domains/place/model/nearby.test.ts`에서, 요청 본문 생성 함수는 새 검색, 후속(기준 요청의 `conditions`), 커서, "이 지역에서 검색", "여기서 이어 검색"의 본문과 좌표 미포함을, `search-store`는 기록 쌓기(커서는 새 항목이 아님, 실패는 쌓지 않음), "결과 보기", 칩의 기준 요청 사슬을 확인한다. 잡는 것: 거리 계산 오류, 잘못된 후속 기준, 기록 규칙 위반. 놓치는 것: 화면과의 연결. Prior art: `fe/src/shared/api/client.test.ts`.
- **FE 훅** (example), AC-15: jsdom 환경에서 `renderHook`, 가짜 타이머, `QueryClientProvider`, 가짜 `fetch`로 `use-suggest`의 요청 횟수(300ms 뒤 한 번), 빈 입력 미요청, 이전 요청 취소(`signal` 중단), 늦은 응답 무시를 확인한다. 잡는 것: 요청 폭주, 오래된 후보 표시. 놓치는 것: 실제 브라우저 입력기(한글 조합) 동작.
- **FE 설정 라우트** (example), AC-30: Vitest에서 `process.env`를 바꿔 가며 `route.ts`의 `GET`을 직접 호출해 돌려주는 키가 `env`, `naverMapClientId`뿐인지, 값이 없으면 생략되는지 확인한다. 잡는 것: 환경변수 누출, 키 이름 오타. 놓치는 것: 빌드 때 미리 렌더링되는지(수동 확인).
- **FE API 함수** (example), AC-16, AC-17: `fetch`를 가짜로 바꿔 `place-api.ts`가 보내는 요청 본문에 기기 좌표가 없는지, 주소에 `?mock=empty`가 있어도 `X-Mock-Scenario` 헤더가 붙지 않는지 확인한다. 잡는 것: 위치 누출, 개발용 헤더가 배포에서 나가는 것. 놓치는 것: 실제 BE와의 통합. Prior art: `fe/src/shared/api/client.test.ts`.
- **FE 화면** (example), AC-18, AC-29: jsdom 환경에서 화면 컴포넌트를 렌더링한다. 검색 화면은 `/config.json`에 키가 없거나 요청이 실패하면 지도 영역이 비고 카드 목록이 보이는지, 상세 화면은 store에 카드가 있을 때 핏 점수, AI 추천 이유, 주의점이 보이고 없을 때 숨는지, 리뷰 자리를 받지 않으면 탭이 셋이고 받으면 리뷰 탭과 하단 막대가 생기는지 확인한다. 잡는 것: 조건부 렌더링 실수. 놓치는 것: 실제 지도 SDK와 레이아웃.
- **FE 첫 화면** (example), AC-31, AC-32, AC-33, AC-34, AC-35: jsdom 환경에서 검색 화면을 렌더링한다. 가짜 `navigator.permissions`와 `geolocation`으로 권한이 `granted`일 때만 열 때 위치를 받는지, 주변 카드 요청 본문이 `query`뿐이고 요청 기록에 쌓이지 않는지, 반경 거르기와 "역삼역 <거리>", 검색창 위치(결과 전후), 상단 버튼의 토스트, 최근 검색 시트의 줄과 누른 뒤의 새 검색을 확인한다. `recent-searches.ts`의 합치기, 상한, 시각 문구는 Node 환경에서 확인한다. 잡는 것: 위치 자동 요청 조건, 좌표 누출, 저장 규칙 위반. 놓치는 것: 실제 브라우저 권한 창과 Carousel의 손가락 넘기기(수동).
- **FE 검색 흐름과 상세 모양** (example), AC-27, AC-34, AC-36, AC-37, AC-38, AC-39, AC-40, AC-41: jsdom 환경에서 검색 화면과 상세 화면을 렌더링한다. 후보 순서(`actionFirst`는 Node 환경에서도)와 어두운 막, 입력 지우기, 가짜 타이머로 단계 문구 바뀜, 요청 기록 펼침과 접기, 과거 결과 화면을 열 때 검색 요청 수가 늘지 않는지와 다시 검색 뒤 기록, 새 검색과 후속 조건의 thread 쌓기, 재로드 뒤 thread 열기와 이어 검색, 깨진 저장 값 무시(`search-threads.ts`는 Node 환경에서도), 상세의 공유와 저장 토스트, 근거 부족 안내, 주소 복사, 정보 탭을 열 때만 지도가 생기는지 확인한다. 잡는 것: 순서 규칙, 스냅샷이 다시 받아지는 실수, 기록 규칙 위반, 조건부 렌더링 실수. 놓치는 것: 와이어프레임과의 모양 차이(수동).
- **BE 기동** (example), AC-21: `infra/local` Postgres와 `be/.env`로 `./gradlew test`와 `bootRun`이 통과하는지 확인한다. 기존 `ApiApplicationTests`는 고치지 않는다. 잡는 것: 의존성, 설정, Flyway 권한 문제. 놓치는 것: prod 설정.
- **수동 확인** AC-18(실제 지도 인증 실패), AC-19, AC-20, AC-22, AC-23, AC-24, AC-28, AC-29, AC-30, AC-32, AC-33(실제 위치 권한 허용과 거부, 카드 넘기기와 핀 이동을 와이어프레임 Start, StartNoLoc과 대조), AC-36~AC-41(입력 중, 검색 중, 요청 기록, 과거 결과, 상세 홈·메뉴·정보 탭과 정보 탭 지도를 와이어프레임 Typing, Loading, RequestHistory, PastResult, Detail, DetailMenu, DetailInfo와 대조)(`next build` 뒤 `next start`로 환경변수를 바꿔 `/config.json` 확인, 산출물에 `localhost` 없음): 지도 키가 없거나 잘못된 상태의 화면, 순위 핀과 핀↔카드 선택, 상세로 갔다가 뒤로 가기, 내 위치 버튼과 거리 표시(브라우저 Network 탭에서 좌표가 나가지 않는지), 상세 탭과 핏 점수 시트, 데이터를 브라우저에서 가져오는지(코드 검토), FE 개발 서버 프록시로 BE 호출을 Figma 화면과 대조한다. E2E는 하지 않는다(D-68).

## Out of scope

- 5-02 "이 조건으로 추천받기" 토글, 5-08 지난날 결과 보기(와이어프레임 PastResult), 리뷰 탭 내용과 "방문 평가 남기기" 이후의 화면(리뷰 담당, 장소 상세는 자리만 연다), 6-06~6-12 리뷰 수정·삭제·신고, 저장한 장소와 내 정보 화면, 저장과 공유 기능(버튼만 그린다), 리뷰 자리 안의 모양(머리글, 닉네임과 재방문 배지와 태그와 사진이 있는 리뷰 항목, 리뷰 담당)(D-49, D-85, D-86, D-92, D-94)
- 와이어프레임의 "내 주변 추천" 라벨, 위치 권한 안내 화면(Location, LocationPrompt), 앱 설치 안내(StartInstall*)(D-80)
- 서버에 저장하는 검색 기록, 온보딩, 인증과 JWT 처리(D-49, D-33)
- 결과에 맞춘 지도 화면 맞춤(`fitBounds`), 지도 서브 모듈(D-70)
- Modal, OpenSearch 호출과 조립, 타임아웃, 서킷 브레이커, 예산, 속도 제한, `X-Fallback` 헤더(D-62)
- OpenSearch 임베딩과 벡터 관리, Postgres에서 OpenSearch로의 동기화 방식(D-36, D-37)
- DB 테이블, JPA 엔티티(`places`, `Place`), Flyway 마이그레이션과 마이그레이션 전용 프로필, validation starter 밖의 `build.gradle` 변경(D-32, D-35, D-40, D-55)
- 공통 응답과 예외 형식의 확정(D-10)
- `docs/infra/` 아래 문서(`design.md`, `contracts/env.md`) 수정. `PLACE_MOCK_ENABLED`, `NAVER_MAP_CLIENT_ID`(fe 그룹)와 `/config.json`의 `naverMapClientId` 키는 인프라 담당에게 알린다(D-63, D-57)
- `X-Mock-Scenario: error`와 개발용 시나리오 선택 상자(D-63)
- Caddy 접근 로그의 `q` 필터. 인프라 담당에게 넘긴다(D-20)
- 추천 이유와 점수를 만드는 방식, 취향을 결과에 반영하는 일(AI 파트 몫, Mock은 반영하지 않음)(D-33, D-64)
- 새로고침과 PWA 재로드에서 검색 상태를 살리는 방식 확정(D-27)

## Open questions

- 추천 이유와 핏 점수 설명을 검색 응답 항목에 담을지, 상세 호출이 검색 맥락을 받을지는 검색 구체화 뒤에 정한다(D-64).
- 후속 조건 전달을 `previousConditions` 되돌려주기로 계속 갈지, 검색 측의 `thread_id`로 바꿀지 정해지지 않았다(D-50).
- 근처 반경의 최종 값은 몇 미터인가요? 임시값은 1000m다(D-52).
- 상세 태그를 미리 정한 분류로 나누고 강조 색을 서버가 어떻게 보낼지 정해지지 않았다. 그동안은 모두 같은 색이다(D-92).
- 실제 검색 엔진에서 첫 화면 주변 추천을 고정 문장 "근처 맛집"의 근처 검색으로 계속 받을지, 취향을 반영한 별도 요청으로 바꿀지 정해지지 않았다(D-82).
- 검색 thread는 지금 `localStorage`에 둔다(D-91). 서버 저장(DB 테이블, thread 목록의 cursor paging API, 로그인 사용자와의 연결)은 인증이 붙은 뒤 정한다. 지금 보는 화면 상태(보는 요청, 선택, 지역 고정)는 메모리에 둔다(D-27).
- 다시 보는 예전 검색 결과에서 시간이 지나 틀려질 수 있는 영업 상태를 어떻게 보여 줄지(그대로, 숨김, 기준 시각 표시, 다시 검색) 정해지지 않았다. 그동안은 그대로 둔다(D-79).
- 요청 기록과 검색 결과 캐시에 개수 상한(예: 최근 N개만 유지)을 둘지 정해지지 않았다. 지금은 상한 없이 재로드 때까지 쌓인다(D-79).
- 공통 응답과 예외 형식은 BE 팀 논의 뒤 정한다(지금은 ProblemDetail)(D-10).
- Postgres에서 OpenSearch로 어떻게 동기화하나요? (D-37)
