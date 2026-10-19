# 장소 검색 (place-search)

Status: draft
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

사용자는 자연어로 장소를 찾고 싶다. 입력하는 동안 장소 후보를 보고, 요청을 보내면 추천 장소를 지도와 카드 목록으로 받고, "더 조용하게" 같은 후속 조건으로 결과를 좁히고, 카드를 눌러 장소 상세를 보고 싶다.

검색의 내부 로직(요청 해석, 임베딩, OpenSearch 질의, 점수 계산)은 AI 파트가 맡고 아직 데이터 구조와 전달 방식이 정해지지 않았다. 이 기능은 Spring BE와 Next.js FE를 연결하는 부분을 Mock 데이터로 끝까지 동작하게 만들고, 확정되면 구현과 DTO 레이어만 교체할 수 있게 한다(D-1, D-18).

## Assumptions

1. `id`는 타입이 미결이라 DTO에서 불투명한 문자열로 다룬다. 정수로 확정되면 DTO와 FE 타입만 바꾼다(D-24).
2. `mapBounds`는 `{swLat, swLng, neLat, neLng}` 형태다. 형태가 결정 로그에 없어서 이 spec이 정한다(D-24).
3. 입력 길이는 `q`와 `query` 모두 1~200자다. 공백뿐이거나 비어 있으면 400이다. 상한은 결정 로그에 없어서 이 spec이 정하는 임시 값이다(D-24, D-10).
4. 존재하지 않는 `id`는 404 ProblemDetail이다(D-24, D-10).
5. 자동완성 항목은 `type` 필드(`PLACE` 또는 `ACTION`)로 구분한다(D-24).
6. Mock 구현은 요청 헤더 `X-Mock-Scenario`를 현재 요청에서 직접 읽는다. `PlaceSearchEngine`의 메서드 인자에는 시나리오를 넣지 않는다(D-16, D-18).
7. Mock이 꺼져 있고 다른 `PlaceSearchEngine` 구현도 없으면 세 엔드포인트 모두 503 ProblemDetail을 돌려준다(D-16).
8. Spring Boot 4.1.1의 JSON 라이브러리에서 "알 수 없는 속성 거부" 설정의 정확한 속성 이름은 구현 때 확인한다(D-17).
9. 장소 업종은 `RESTAURANT`, `CAFE`, `BAR`, 역은 `GANGNAM`, `YEOKSAM`, `SEOLLEUNG`, 시설은 `PARKING`, `WIFI`, `GROUP`, `RESERVATION`이다. PRD FR-01, FR-09의 분류를 따른다(D-24).
10. Mock의 근처 판정은 질의 문자열에 "근처"가 부분 문자열로 들어 있는지로 한다(D-16, D-22).
11. Mock의 자동완성은 이름이 `q`로 시작하는 장소를 먼저, 그다음 이름, 메뉴, 업종에 `q`를 포함하는 장소를 담고, 장소 항목은 최대 5개다. `ACTION` 항목의 `label`은 "이 조건으로 추천받기"로 고정이다(D-16, D-24).
12. Mock의 `cursor`는 오프셋을 담은 불투명 문자열이다. `cursor`가 있으면 Mock은 다른 요청 필드를 무시하고, 해석할 수 없는 `cursor`는 400이다(D-8, D-16).
13. Mock의 `conditions`는 `previousConditions`가 있으면 그대로, 없으면 `{}`다(D-16).
14. Mock 스위치는 환경변수 `PLACE_MOCK_ENABLED`(속성 `place.mock.enabled`)이고 기본값은 꺼짐이다. local과 dev에서만 켜며 `docs/infra/contracts/env.md`에 행을 추가한다(D-16).
15. 근처 반경의 임시값은 FE 상수 1000m이고, Mock의 `id`는 `p-001` 같은 문자열이다(D-22, D-24).
16. `?mock`과 `?id`는 브라우저에서 읽는다. `cacheComponents`가 켜져 있으면 `useSearchParams`가 Suspense를 요구할 수 있으므로 구현 전에 `fe/node_modules/next/dist/docs/`를 확인한다(`fe/AGENTS.md`)(D-11, D-16).
17. 입력 검증은 공백 여부(`isBlank`)와 원문 길이로 한다. `q` 누락도 400이다. FE 입력창은 `maxLength` 200을 둔다(D-10, D-24).
18. 오류 응답은 ProblemDetail을 만드는 예외 처리 클래스 하나로 모은다. `detail`은 일반 문구이고 예외 메시지와 요청 본문은 로그에 남기지 않는다(D-10, D-20).
19. 알 수 없는 속성 거부는 요청 record에 정의된 필드 밖의 키에만 적용한다. `previousConditions`와 `preferences`의 내부는 대상이 아니다(D-17, D-24).
20. 자동완성의 `ACTION` 항목은 장소 항목이 있어도 항상 포함된다. 이름 접두 일치가 없으면 맨 위, 있으면 맨 뒤다. 매칭은 `q`의 앞뒤 공백을 제거한 뒤 대소문자를 구분하지 않고 하며, 업종은 한글 이름(식당, 카페, 술집)과 코드로 매칭한다(D-16, D-24).
21. Mock 검색은 질의와 `mapBounds`를 무시하고 모든 장소를 `score` 내림차순으로 돌려준다. Mock 장소는 25~39곳이다. `cursor`는 오프셋의 인코딩이며 숫자가 아니거나 음수면 400, 범위를 넘으면 빈 페이지다. `cursor`가 있으면 헤더와 "근처"도 무시한다. 헤더 `empty`와 "근처"가 함께 있으면 `empty`가 이기고 `nearby`는 false다. 알 수 없는 헤더 값은 정상 결과이고, 헤더는 검색에만 적용된다(D-16, D-22).
22. `conditions`와 `previousConditions`는 JSON 객체만 받는다. 객체가 아닌 값(배열 등)은 400이다. 응답에서 null인 선택 필드는 JSON에서 생략하고(`application.properties`에 null 제외 설정), `conditions: {}`와 빈 목록은 그대로 내보낸다(D-17, D-24).
23. Mock의 `emptyReason`, 추천 이유, 주의점, 주소는 고정 한글 문자열이고 `dayOfWeek`는 `MON`~`SUN`, 시각은 `HH:mm`이다(D-16, D-24).
24. 입력 검증은 컨트롤러에서 직접 한다(`build.gradle`에 validation starter가 없고 추가하지 않는다). 길이는 UTF-16 문자 수로 센다. AC-14는 엔진 반환값을 가공하지 않는다는 뜻이며 요청 검증을 막지 않는다(D-10, D-18).
25. 엔진이 없을 때의 503은 컨트롤러가 `PlaceSearchEngine`을 선택적 의존성으로 받아 처리한다. 엔진이 없어도 기동은 실패하지 않는다(D-16).
26. FE는 항상 상대 경로 `/api/v1/...`를 부른다. 로컬에서 BE에 닿는 방법은 미결이다(D-28).
27. FE는 `mapBounds`를 지도가 있고 사용자가 "이 지역에서 검색"을 눌렀거나 현재 위치를 얻을 수 없을 때만 담고, 지도 키가 없으면 생략한다. 현재 위치 요청은 응답이 `nearby: true`일 때 처음 한다(D-13, D-22).
28. 저장된 검색 카드가 없을 때(주소 직접 열기, 재로드)는 상세 화면이 추천 이유 영역을 숨기고 장소 정보만 보여 준다(D-24, D-27).
29. `?mock=empty`는 커서 요청을 포함한 모든 검색 호출에 붙이고 매 검색마다 다시 읽는다. 400, 503, 네트워크 오류는 한 줄의 일반 오류 문구로 보여 준다(D-16).
30. 환경변수 `PLACE_MOCK_ENABLED`는 `env.md`에 필수 `X`, 그룹 `app, local`로 올리고 `infra/local/local.env.example`에 `PLACE_MOCK_ENABLED=true`를 넣는다. `app.env.example`은 건드리지 않으며 dev는 서버의 `/etc/fit/dev.env`에서 켠다. 코드의 기본값은 꺼짐이다(D-16).
31. 프레임워크 로거는 기본 수준을 유지하고, JSON 파싱 오류 메시지가 입력을 로그에 남기는지는 AC-13 테스트로 확인한다. 테스트가 실패하면 해당 로거의 수준을 올리는 것은 허용한다(D-20).
32. 입력 검증(400)은 엔진 유무 확인(503)보다 먼저 한다(D-10, D-16).
33. 엔진이 잘못된 `cursor`를 알리는 방법은 검사 불가 예외를 던지고 예외 처리 클래스가 400으로 바꾸는 것이다. 컨트롤러는 `cursor`를 직접 해석하지 않는다(D-10, D-18).
34. Mock의 `cursor`는 십진수 오프셋의 base64url 인코딩이다. 해석할 수 없거나 음수이면 400이고, 범위를 넘으면 빈 페이지에 `nextCursor`가 없다(D-8, D-16).
35. 첫 검색 요청에는 사용자가 "이 지역에서 검색"을 누르기 전에는 `mapBounds`를 담지 않는다. 위치를 얻지 못한 것이 확인된 뒤의 요청에는 담는다(D-22).
36. 알 수 없는 속성 거부는 `mapBounds` 같은 중첩 record에도 적용한다. 선택 필드의 명시적 `null`은 없는 것으로 보고, 필드 타입이 틀리면 400이다(D-17).
37. Mock의 `score` 정렬이 같으면 파일 순서를 따른다. 자동완성에서 접두 일치가 여럿이면 파일 순서이고, 메뉴 이름에 `q`가 들어 있어도 일치로 보며, 역 이름은 매칭하지 않고, 5개 상한은 장소 항목에만 적용한다(D-16, D-24).
38. 상세 화면은 같은 장소가 여러 검색에 있으면 가장 최근에 저장된 검색의 카드를 쓴다(D-24, D-27).
39. 화면 문구는 쉬운 한국어로 하고 다음 페이지는 스크롤 위치로 불러온다(IntersectionObserver). 자동완성 훅은 `fe/src/lib/useSuggest.ts`에 둔다(D-12, D-30).
40. Vitest 버전은 구현 때 확인하고 `fe/pnpm-workspace.yaml`의 빌드 스크립트 허용 정책(`allowBuilds`)에 걸리는지 확인한다(D-30).

## Usage

1. **입력 중 후보**: 사용자가 검색창에 "역삼"을 입력하면 300ms 뒤 `GET /api/v1/places/suggest?q=역삼`이 나가고, 입력란 아래에 장소 후보와 "이 조건으로 추천받기"가 뜬다. 계속 입력하면 이전 요청은 취소된다(D-4, D-13).
2. **추천 검색과 후속 조건**: 엔터를 치면 `POST /api/v1/places/search`가 `{query: "역삼에서 데이트할 곳"}`으로 나가고, 응답의 카드 20개가 목록과 지도 핀으로 나온다. 스크롤하면 `nextCursor`로 다음 20개를 가져온다. "더 조용하게"를 입력하면 직전 응답의 `conditions`가 `previousConditions`로 같이 나간다(D-4, D-8).
3. **근처 검색**: "근처 카페"를 입력하면 응답이 `nearby: true`와 후보 전체로 오고, 브라우저가 현재 위치로 반경을 걸러서 보여 준다. 위치는 서버로 나가지 않는다(D-22).
4. **장소 상세**: 카드를 누르면 `/place?id=…`로 이동하고 `GET /api/v1/places/{id}`로 영업시간, 메뉴, 시설을 가져온다. 추천 이유는 검색에서 받은 카드의 값을 쓴다(D-12, D-24).
5. **개발자가 결과 없음 화면을 볼 때**: 주소를 `localhost:3000/?mock=empty`로 열고 평소처럼 검색하면 결과 없음 화면이 나온다(D-16).

## Acceptance criteria

- [ ] AC-1: `GET /api/v1/places/suggest`는 `q`(1자 이상)에 대해 장소 후보(`type: PLACE`)와 "이 조건으로 추천받기"(`type: ACTION`)를 돌려준다. `q`와 장소 이름이 정확히 같거나 앞부분이 일치하는 후보가 있으면 그 장소가 맨 위이고, 없으면 `ACTION`이 맨 위다. (D-4, D-16, D-24)
- [ ] AC-2: `POST /api/v1/places/search`에 헤더 없이 일반 질의를 보내면 항목 20개와 `nextCursor`가 온다. 그 커서로 다시 보내면 나머지 항목이 오고 `nextCursor`가 없다. 두 페이지의 항목은 겹치지 않는다. (D-8, D-16)
- [ ] AC-3: 헤더 `X-Mock-Scenario: empty`로 검색하면 200이고 `items`는 비어 있으며 `emptyReason`에 원인과 수정 제안이 있다. (D-10, D-16)
- [ ] AC-4: 질의에 "근처"가 있으면 `nearby: true`이고 `nextCursor`가 없으며, 항목은 후보 전체(최대 100)를 `score` 내림차순으로 담는다. (D-16, D-22)
- [ ] AC-5: 요청에 `previousConditions`를 넣으면 Mock 응답의 `conditions`가 그 값을 그대로 담는다. `conditions`와 `previousConditions`의 내부를 BE는 해석하지 않는다. (D-8, D-16, D-24)
- [ ] AC-6: 임의의 검색 응답에서 모든 `score`는 0 이상 100 이하의 정수이고 `labels`는 2개다. FE는 점수를 정수 그대로 `%` 없이 표시한다. (D-17, D-24)
- [ ] AC-7: 요청 본문에 정의되지 않은 속성(예: `lat`, `lng`)이 있으면 400 ProblemDetail이고, 정의된 필드만 있는 요청은 정상 처리된다. (D-10, D-17)
- [ ] AC-8: 어떤 응답의 JSON 키도 문서화된 DTO 필드 집합을 벗어나지 않으며 외부 리뷰를 담는 필드가 없다. (D-17, D-24)
- [ ] AC-9: Mock이 꺼진 환경(다른 구현도 없음)에서 세 엔드포인트는 503 ProblemDetail을 돌려준다. Mock이 켜진 환경에서는 정상 응답한다. (D-16)
- [ ] AC-10: `GET /api/v1/places/{id}`는 알려진 `id`에 `hours`, `menus`, `facilities`를 돌려주고, 모르는 `id`에는 404 ProblemDetail을 돌려준다. 상세 응답에는 `reasons`와 `missingEvidenceNotes`가 없다. (D-4, D-10, D-24)
- [ ] AC-11: 빈 값이나 200자를 넘는 `q`, `query`는 400 ProblemDetail이다. (D-10, D-24)
- [ ] AC-12: `Authorization` 헤더가 있든 없든 세 엔드포인트의 응답이 같다. `preferences`는 받아 두되 Mock은 결과에 반영하지 않는다. (D-9)
- [ ] AC-13: 검색과 자동완성 요청을 처리한 뒤(잘못된 요청으로 400이 난 경우 포함) BE 로그 출력에 요청 본문, `preferences`, `q`, `query` 값이 나타나지 않는다. (D-20)
- [ ] AC-14: 컨트롤러는 `PlaceSearchEngine`의 반환값을 가공하거나 검증하지 않고 그대로 응답한다. 다른 `PlaceSearchEngine` 구현으로 바꿔도 컨트롤러는 수정할 필요가 없다. (D-18, D-24)
- [ ] AC-15: 자동완성은 입력이 멈춘 뒤 300ms 뒤에 한 번만 요청하고, 입력이 비면 요청하지 않으며, 새 요청을 보내면 이전 요청을 취소하고, 늦게 도착한 응답은 화면에 반영하지 않는다. (D-13)
- [ ] AC-16: FE가 만드는 검색 요청 본문에는 기기 위치가 있어도 기기 위치 좌표 필드가 들어가지 않는다. 검색 대상 지역인 `mapBounds`는 사용자가 "이 지역에서 검색"을 누르거나 위치 권한이 없을 때만 담는다. 근처 응답이 오면 FE는 현재 위치와 반경으로 항목을 걸러 낸다. (D-17, D-22)
- [ ] AC-17: 주소에 `?mock=empty`가 있으면 FE의 검색 요청에 `X-Mock-Scenario: empty` 헤더가 붙고, 없으면 붙지 않는다. (D-16)
- [ ] AC-18: 지도 키가 없으면 지도 영역은 비어 있고 카드 목록은 정상 동작한다. (D-13)
- [ ] AC-19: 결과에서 카드를 누르면 `/place?id=…`로 이동해 상세가 표시되고, 뒤로 가면 기존 결과가 유지된다(보관 방식은 미결이며 어떤 방식이든 이 동작이 목표다). 화면의 이름은 "장소"이고 경로는 `/api/v1/places/...`다. (D-1, D-12, D-23, D-27)
- [ ] AC-20: FE는 Server Actions, Route Handler, 서버에서 쿠키 읽기 같은 서버 전용 기능을 쓰지 않고, 데이터는 브라우저의 `fetch`로 가져온다. (D-11)
- [ ] AC-21: `infra/local`의 Postgres를 띄우고 `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD`를 주면 BE가 기동하고 세 엔드포인트가 응답한다. 공용 뼈대의 `build.gradle`과 datasource 설정은 바뀌지 않는다. (D-4, D-21)

## Implementation anchors

| Anchor | Action | Decision |
|---|---|---|
| `be/src/main/java/kr/co/fitdining/api/ApiApplication.java#ApiApplication` | reuse | D-4 |
| `be/src/main/java/kr/co/fitdining/api/place/PlaceController.java#PlaceController` | new | D-4 |
| `be/src/main/java/kr/co/fitdining/api/place/PlaceSearchEngine.java#PlaceSearchEngine` | new | D-18 |
| `be/src/main/java/kr/co/fitdining/api/place/MockPlaceSearchEngine.java#MockPlaceSearchEngine` | new | D-16 |
| `be/src/main/resources/mock/places.json#places` | new | D-16 |
| `be/src/main/java/kr/co/fitdining/api/place/PlaceDtos.java#PlaceDtos` | new | D-24 |
| `be/src/main/resources/application.properties#spring` | modify | D-17 |
| `fe/src/app/page.tsx#Home` | modify | D-12 |
| `fe/src/app/place/page.tsx#PlaceDetailPage` | new | D-12 |
| `fe/src/lib/placeApi.ts#searchPlaces` | new | D-12 |
| `fe/src/app/components/PlaceMap.tsx#PlaceMap` | new | D-13 |
| `fe/package.json#scripts` | modify | D-30 |
| `fe/src/lib/nearby.test.ts#nearby` | new | D-30 |

## Interfaces

엔드포인트(모두 인증 없음, 오류는 Spring ProblemDetail):

| 메서드와 경로 | 요청 | 응답 |
|---|---|---|
| `GET /api/v1/places/suggest` | 쿼리 `q` (1~200자) | `SuggestItem[]` |
| `POST /api/v1/places/search` | `SearchRequest` | `SearchResponse` |
| `GET /api/v1/places/{id}` | 경로 `id` | `PlaceDetail` |

요청 헤더 `X-Mock-Scenario: empty`는 Mock 구현만 읽는다.

```java
// PlaceSearchEngine: 교체 지점. 구현이 바뀌면 시그니처도 바뀔 수 있다(D-18).
public interface PlaceSearchEngine {
    List<PlaceDtos.SuggestItem> suggest(String q);
    PlaceDtos.SearchResponse search(PlaceDtos.SearchRequest request);
    Optional<PlaceDtos.PlaceDetail> findPlace(String id);
}
```

```text
PlaceDtos (record 모음, 필드 목록만)
  PlaceSummary   : id(String), name, categoryGroup(RESTAURANT|CAFE|BAR),
                   station(GANGNAM|YEOKSAM|SEOLLEUNG), lat, lng
  SuggestItem    : type(PLACE|ACTION), place?(PlaceSummary), label?
  SearchRequest  : query(1..200자), preferences?(String[] 태그 코드),
                   previousConditions?(JSON 객체, 불투명),
                   mapBounds?({swLat, swLng, neLat, neLng}), cursor?(String, 불투명)
  SearchResponse : conditions(JSON 객체, 불투명), nearby(boolean),
                   items(PlaceCard[]), nextCursor?, emptyReason?({cause, suggestion})
  PlaceCard      : place(PlaceSummary), score(int 0..100), labels(String[2]),
                   caution?, reasons({text, evidencePhrase?}[]), missingEvidenceNotes(String[])
  PlaceDetail    : place(PlaceSummary), address,
                   hours({dayOfWeek, open?, close?, breakStart?, breakEnd?, closed}[]),
                   menus({name, price?}[]), facilities(PARKING|WIFI|GROUP|RESERVATION)[]
```

```text
FE 로직 (src/lib)
  placeApi.ts   : suggestPlaces(q, signal), searchPlaces(request), getPlace(id)
                  검색 요청에 ?mock=empty가 있으면 X-Mock-Scenario 헤더를 붙인다
  nearby        : 현재 위치와 반경(FE 상수)으로 PlaceCard[]를 거르는 순수 함수
  suggest 로직  : React와 무관한 모듈(`fe/src/lib/suggest.ts`). 입력을 300ms 늦추고, 빈 입력은 요청하지 않으며,
                  새 요청을 보내면 이전 요청을 취소하고 늦게 온 응답은 버린다 (타이머와 fetch를 주입받는다)
  자동완성 훅   : 위 모듈을 감싸는 얇은 훅. jsdom, testing-library는 추가하지 않는다 (D-30)
```

anchor 표에 없지만 만들거나 고치는 파일: `fe/src/lib/placeTypes.ts`(DTO 타입), `fe/src/lib/nearby.ts`(근처 필터), `fe/src/lib/suggest.ts`(자동완성 로직), 자동완성 훅, vitest 설정, BE 예외 처리 클래스(ProblemDetail), BE 테스트(컨트롤러, Mock 데이터), `docs/infra/contracts/env.md`의 Mock 스위치 행.

설정:

```text
application.properties : 요청 본문의 알 수 없는 속성을 거부하는 설정 (속성 이름은 구현 때 확인)
Mock 스위치            : 환경변수 이름은 docs/infra/contracts/env.md 계약에 올린다 (D-16)
```

## Seams & test plan

- **BE 컨트롤러 경계** (example), AC-1, AC-2, AC-3, AC-4, AC-5, AC-7, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14: `@WebMvcTest`로 MockMvc가 세 엔드포인트를 호출한다. 일부는 가짜 `PlaceSearchEngine`을 꽂아 컨트롤러가 반환값을 가공하지 않는지 본다. 로그 검증은 출력 캡처를 쓴다. 잡는 것: 경로, 상태 코드, 요청 검증, 페이징, 로그 누출. 놓치는 것: 실제 JSON 직렬화 설정이 전체 앱에서 같은지(기동 테스트는 AC-21). Prior art: 없음(`be/src/test`에는 `ApiApplicationTests`의 기동 테스트뿐).
- **Mock 데이터 검증** (example), AC-2, AC-4, AC-6, AC-8: `places.json`을 읽어 장소가 25곳 이상이고 모든 점수가 0~100 정수이며 라벨이 2개이고 응답 JSON 키가 문서화된 집합을 넘지 않는지 확인한다. 잡는 것: 데이터 오타, 규칙 위반. 놓치는 것: 실제 AI 데이터의 품질.
- **FE 순수 로직** (example), AC-15, AC-16: 근처 필터는 위치와 반경, 경계값을 넣어 기대 항목을 확인하고(`fe/src/lib/nearby.test.ts`), `suggest.ts`의 자동완성 로직은 가짜 타이머와 가짜 fetch로 요청 횟수, 빈 입력, 취소, 늦은 응답 무시를 확인한다(훅은 얇아서 직접 테스트하지 않는다). 잡는 것: 거리 계산 오류, 요청 폭주. 놓치는 것: 실제 브라우저 입력기(한글 조합) 동작. Prior art: 없음(`fe/`에 테스트 러너가 없어 Vitest를 추가한다).
- **FE API 함수** (example), AC-16, AC-17: `fetch`를 가짜로 바꿔 요청 본문에 좌표가 없는지, `?mock=empty`일 때만 헤더가 붙는지 확인한다. 잡는 것: 위치 누출, 헤더 오작동. 놓치는 것: 실제 BE와의 통합.
- **BE 기동** (example), AC-21: `infra/local` Postgres와 환경변수 세 개로 `./gradlew test`와 `bootRun`이 통과하는지 확인한다. 기존 `ApiApplicationTests`는 고치지 않으며 Postgres 스택이 떠 있어야 통과한다. 잡는 것: 의존성과 설정 문제. 놓치는 것: prod 설정.
- **수동 확인** AC-18, AC-19, AC-20: 지도 키 없는 상태의 화면, 결과에서 상세로 갔다가 뒤로 가기, 서버 전용 기능 미사용(코드 검토). E2E는 하지 않는다(D-30).

## Out of scope

- 검색 기록, 온보딩, 장소 저장, 리뷰 작성, 인증과 JWT 처리(D-1, D-9)
- Modal, OpenSearch 호출과 조립, 타임아웃, 서킷 브레이커, 예산, 속도 제한, `X-Fallback` 헤더(D-18)
- 임베딩 계산 주체, 벡터 저장 위치, 상세 데이터 출처, Postgres와 OpenSearch 동기화(D-25, D-26)
- DB 테이블, JPA 엔티티, Flyway 마이그레이션과 `build.gradle`, datasource 설정 변경(D-4, D-21)
- 공통 응답과 예외 형식의 확정(D-10)
- 정적 export 설정으로의 전환과 `next.config.ts` 변경(D-11)
- `X-Mock-Scenario: error`와 개발용 시나리오 선택 상자(D-16)
- BE 루트 패키지 변경과 FE 폴더 규칙 합의(D-4, D-12)
- Caddy 접근 로그의 `q` 필터(D-20)
- 근처 반경 값의 확정(D-22)
- 추천 이유를 만드는 방식과 취향 반영 여부(D-9, D-24)
- 테이블과 엔티티 이름의 확정(D-23)
- 로컬 FE→BE 연결 방식(CORS, 프록시)의 확정(D-28)
- 지도 클라이언트 ID의 주입 방식 확정(D-29)
- 새로고침과 PWA 재로드에서 검색 상태를 살리는 방식 확정(D-27)

## Open questions

- 검색 상태를 프런트 메모리에만 둘지 `sessionStorage`까지 쓸지, 새로고침이나 PWA 재로드에서 결과를 살려야 하나요? (D-27)
- 로컬에서 FE가 BE를 부르는 방법은 BE CORS와 개발 서버 프록시 중 무엇으로 하나요? (D-28)
- 지도 클라이언트 ID를 FE에 넣는 방식(빌드 시점 환경변수, 런타임 설정 파일)은 보안 확인 결과 무엇으로 정해졌나요? (D-29)
- 후속 조건 전달을 `previousConditions` 되돌려주기로 계속 갈지, 검색 측이 `thread_id`로 관리하는 방식으로 바꿀지 AI 파트와 정했나요? (D-8)
- 검색이 `preferences`를 실제로 점수에 반영하나요? (D-9)
- 추천 이유를 검색 응답 항목에 담는 방식을 AI 파트와 확정했나요, 아니면 상세 호출이 검색 맥락을 받나요? (D-24)
- `id`는 정수인가요, 문자열인가요? (D-24)
- 근처 반경은 몇 미터로 하나요? (D-22)
- 임베딩 계산 주체와 벡터 저장 위치는 어떻게 정해졌나요? (D-25)
- 상세 정보는 Postgres에서 읽나요, OpenSearch 문서에서 읽나요? 두 저장소는 어떻게 동기화하나요? (D-26)
- 10-23 데모를 prod에서 Mock으로 보여 줘야 하나요? (D-16)
- FE를 정적 export로 배포하나요, Node 서버로 배포하나요? (D-11)
- 공통 응답과 예외 형식은 BE 팀이 어떻게 정했나요? (D-10)
- BE 루트 패키지와 FE 폴더 규칙은 팀에서 합의됐나요? (D-4, D-12)
- Caddy 접근 로그에서 `q`를 지우도록 인프라 담당과 정했나요? (D-20)
- Flyway가 마이그레이션 파일 없이 켜졌을 때 기동이 되는지는 구현 단계에서 확인하면 되나요? (D-21)
- 테이블과 엔티티 이름은 내일 확정되면 어떻게 되나요? (D-23)
