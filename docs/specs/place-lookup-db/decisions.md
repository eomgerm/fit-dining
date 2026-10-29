# place-lookup-db decisions

Glossary: none · ADRs: none

## D-1 범위와 전달 방식
- Status: settled
- Decision: Jira S15P31A302-115의 범위다. 상세(`GET /places/{id}`), 자동완성(`GET /places/suggest`), 첫 화면 주변 카드(`POST /places/search`의 "근처")를 `mock/places.json` 대신 장소 카탈로그 DB에서 읽게 하고, 자동완성은 단어 단위 키워드 검색으로 구현한다. 자연어 검색(`search`, "근처"가 없는 요청)은 AI 엔진(Jira 14)이 붙을 때까지 503이다. 서버(dev, 운영) 적재와 `reviews.place_id` FK는 이번 범위가 아니다(D-15). 브랜치 하나, MR 하나에 커밋을 나눠 쌓고, 각 커밋은 그 시점의 전체 테스트를 통과한다.
- Rejected: 단계마다 MR을 나누기 → 담당자 결정이다(MR 한 번). 서버 적재까지 이번에 하기 → 적재기가 git 미추적이고 localhost만 허용하며, 서버 적재의 허용 여부가 팀 결정이다(D-15). 자연어 검색을 이번에 만들기 → AI 엔진의 일이다.

## D-2 구조: 기존 엔진 인터페이스 아래에 DB 모드 구현을 조립한다
- Status: settled
- Decision: `PlaceSearchEngine`(suggest, search, findPlace)은 그대로 두고, `place.mock.enabled`가 꺼졌거나 없을 때 등록되는 `CatalogPlaceSearchEngine`을 더한다. 이 구현은 두 포트를 조립한다. `PlaceCatalog`(Postgres 읽기: 상세, 주변 후보, 검색 문서)와 `PlaceKeywordSearch`(자동완성 키워드 검색). 스위치 `place.mock.enabled`(환경변수 `PLACE_MOCK_ENABLED`)의 이름과 뜻은 바꾸지 않는다. 켜면 Mock, 끄거나 없으면 DB 모드다. 컨트롤러, `PlaceService`, `ReviewService`와 FE 요청 경로는 바뀌지 않는다. 엔진 빈이 항상 정확히 하나가 되므로 `PlaceService`는 엔진을 직접 주입받는다. 나중에 OpenSearch는 `PlaceKeywordSearch` 구현만, AI 엔진은 `CatalogPlaceSearchEngine`의 `search` 분기만 바꾼다.
- Rejected: 인터페이스를 능력별 셋으로 쪼개고 `PlaceService`가 조립하기 → "서비스는 엔진이 돌려준 값을 가공하지 않는다"(place-search D-62)를 바꾸고 `ReviewService`가 쓰는 `PlaceService`까지 흔든다. 인터페이스 하나에 Postgres 구현 하나 → 키워드 검색은 OpenSearch로, 자연어 검색은 AI로 가는데 세 기능이 한 클래스에 묶인다. 스위치에 새 이름 → 환경변수 계약(`docs/infra/contracts/env.md`)과 인프라 설정이 바뀐다.

## D-3 자동완성, 상세, 주변 카드는 한 스위치로 함께 전환한다
- Status: settled
- Decision: 자동완성 후보를 누르면 `/place?id=<id>`로 가고 카드도 같은 id로 상세를 연다. Mock의 id(1~36)와 DB의 `place_id`는 같은 공간이 아니므로 한쪽만 DB이면 엉뚱한 장소가 열린다. 세 API는 같은 스위치로 함께 바뀐다.
- Rejected: 기능마다 스위치 → id 공간이 섞인다.

## D-4 읽기 모델은 SQL(JdbcClient)이고 장소 JPA 엔티티를 만들지 않는다
- Status: settled
- Decision: 이 API는 카탈로그를 읽기만 한다(쓰기는 적재 스크립트). `places`와 자식 테이블을 JdbcClient의 SQL로 읽어 레코드로 받는다. 웹 앱은 `ddl-auto=validate`이고 `places`는 `text[]`, `time[]`, `jsonb` 열을 가져서, 엔티티 매핑이 하나라도 어긋나면 develop 전체의 기동이 실패한다.
- Rejected: JPA 엔티티와 리포지토리 → 읽기 전용에 얻는 것이 없고 위험만 크다. 장소별 쿼리를 `JdbcTemplate`으로 → 이름 있는 파라미터가 있는 JdbcClient가 더 읽기 쉽다.

## D-5 키워드 검색은 문서 스냅샷과 Java 매처로 실행한다
- Status: settled
- Decision: `PlaceKeywordSearch`의 지금 구현(`DocumentKeywordSearch`)은 카탈로그에서 읽은 `PlaceSearchDocument` 목록을 메모리에 스냅샷으로 두고, 순수 Java 매처가 거른다. 매칭 규칙(D-6~D-10)은 이 spec이 정본이고 코드는 그것을 따른다. 같은 문서를 나중에 OpenSearch 색인 문서로 쓸 수 있다. `PlaceKeywordSearchContract`(추상 테스트)가 포트의 기대를 고정하고, 다른 구현이 생기면 같은 테스트를 통과해야 한다. 포트는 `offset`을 받는다. 키워드 결과를 카드로 돌려주는 폴백을 나중에 얹을 때 계약이 바뀌지 않게 하려는 것이다.
- Rejected: 요청마다 SQL(`ILIKE`, 정규식) → 단어 수만큼 동적 SQL과 와일드카드 이스케이프가 필요하고, 한글 조합 규칙이 SQL 안으로 스며들어 OpenSearch로 옮길 때 규칙이 흩어지며, 테스트에 Docker가 필요하다. SQL로 후보를 거르고 Java로 순위를 매기는 하이브리드 → 두 방식의 단점을 합친다. 지금 OpenSearch → 티켓이 1차 배포에서 제외했고, BE에 클라이언트, 인덱스 정의, 동기화가 없으며, 인프라의 OpenSearch는 인증 없이 인덱스 접두사 관례로 환경을 나눈다.

## D-6 단어 단위 AND, 단어마다 부분 문자열
- Status: settled
- Decision: 입력을 앞뒤 공백을 제거하고 공백으로 나눠 단어로 만들고 중복은 뺀다. 단어마다 이름, 메뉴 이름, 업종, 위치 중 하나라도 그 단어를 부분 문자열로 담으면 통과이고, 모든 단어가 통과해야 후보가 된다. 정규화는 NFC와 소문자(`Locale.ROOT`)다. 와일드카드와 정규식은 없고 `%`, `_`, `\`는 글자 그대로다. FE 강조도 같은 단어 분리로 각 단어를 대소문자 무시 부분 문자열로 찾고 겹치는 구간을 합친다.
- Rejected: 입력 전체를 한 덩어리로 맞추기(현재 Mock) → 디자인의 "역삼 쌀국수" 예시가 재현되지 않고 FE 강조도 한 덩어리로만 된다. 단어 OR → 단어가 늘수록 결과가 늘어 자동완성이 흐려진다.

## D-7 위치는 `places.station`의 이름만 쓴다
- Status: settled
- Decision: 위치 필드는 역 이름(강남, 역삼, 선릉)과 "역"을 붙인 형태(강남역, 역삼역, 선릉역)다. 정제 CSV 300곳을 집계한 값은 `station`이 강남 100·역삼 100·선릉 100이고 `PlaceSummary.Station`과 같다. `dong`은 역삼동 186·대치동 56·서초동 32·삼성동 24·논현동 2라 "역삼"이 186곳(62%)에 걸리고 그중에는 강남·선릉 수집 장소가 섞이며, `district`는 강남구가 268곳(89%)이라 "강남"이 거의 전부에 걸린다. 동, 구, 주소는 매칭에 쓰지 않는다. 이름에 지역어가 이미 들어 있는 장소가 많다(강남 92, 선릉 62, 역삼 55). 디자인(`Typing`)의 "역삼 쌀국수" 예시가 이름도 메뉴도 아닌 위치로 맞는 행을 보여 주므로 place-search 스펙 19번의 "역 이름은 매칭하지 않는다"를 이 결정으로 대체한다.
- Rejected: 역 이름은 매칭하지 않기(기존 스펙 19번) → 디자인 예시가 재현되지 않는다. `dong`, `district`, `full_address` → 위 수치대로 너무 넓다.

## D-8 업종은 그룹 이름과 코드, 네이버 업종 이름이다
- Status: settled
- Decision: 업종 필드는 그룹 한글명(식당, 카페, 술집), 그룹 코드(`restaurant`, `cafe`, `bar`), 네이버 업종 이름(`places.category`, 있을 때)이다. 네이버 업종 이름은 기존 스펙과 티켓에 없던 확장이고 담당자가 승인했다. 예를 들어 "이자카야", "국밥"으로 업종을 찾을 수 있다.
- Rejected: 그룹 이름과 코드만 → "이자카야"처럼 사용자가 쓰는 말로 업종을 못 찾는다.

## D-9 한글 조합 중 글자는 마지막 단어의 마지막 글자에만 느슨하게 맞춘다
- Status: settled
- Decision: 입력이 300ms 멈췄을 때 서버는 아직 덜 쓴 글자를 받을 수 있다(`쌀국` 입력 중 `쌀구`). 마지막 단어의 마지막 글자만 다음처럼 맞춘다. 받침 없는 글자는 같은 초성과 중성의 모든 글자(받침 없음을 포함해 28개)에 맞는다. 받침 있는 글자는 그 글자 자체, 또는 받침이 다음 글자의 초성으로 넘어간 형태(앞 글자는 겹받침의 앞 자음만 남기고 뒤 글자의 초성이 겹받침의 뒤 자음인 형태)에 맞고, 받침이 겹받침의 첫 자음이면 그 겹받침인 글자에도 맞는다(`달`→`닭`). 받침 없는 글자의 중성이 ㅗ, ㅜ, ㅡ이면 그 모음이 복합 모음으로 이어진 글자에도 맞는다(`고`→`과`). 홀로 쓴 자음은 그 자음을 초성으로 하는 모든 글자에 맞는다. 앞쪽 글자와 완성된 단어는 글자 그대로 맞춘다. FE 강조는 이 완화를 하지 않고 조합 중인 마지막 글자만 강조하지 않는다(다음 키 입력에서 사라진다).
- Rejected: 전체 텍스트를 자모로 분해해 맞추기 → "알"이 "아랑"에 걸리는 오탐이 모든 글자에서 생긴다. 초성만 입력하는 검색(`ㅅㄱㅅ`) → 디자인에 없고 이번 범위가 아니다. FE에도 같은 완화를 구현하기 → 같은 규칙이 두 언어에 있게 되어 어긋나기 쉽고, 한 글자 차이가 다음 키 입력에서 사라진다.

## D-10 순위와 `matchedMenu`
- Status: settled
- Decision: 순위는 0(이름이 입력 전체로 시작), 1(모든 단어가 이름에 있음), 2(일부 단어는 이름에, 나머지는 메뉴·업종·위치에 있음), 3(이름에는 없고 메뉴나 업종으로 맞음), 4(모든 단어가 위치로만 맞음)다. 같은 순위 안에서는 `place_id` 오름차순이다. 후보는 최대 5개다. 순위 0 후보가 있으면 "이 조건으로 추천받기"(ACTION)가 맨 뒤, 없으면 맨 위다(place-search 20번 그대로). `matchedMenu`는 이름·업종·위치로 채워지지 않는 단어가 있을 때만, 그 단어를 가장 많이 담은 메뉴(동점이면 원본 순서가 앞선 메뉴)다. 이름으로 맞은 단어만 있으면 없다. 단일 단어에서는 현재 Mock과 같은 결과다.
- Rejected: 위치로만 맞은 후보를 이름 일치보다 앞에 두기 → "역삼"만 쳐도 이름이 "역삼"인 곳이 밀린다. 위치만 맞은 후보 사이에서 무작위·거리순 → 근거가 없고 서버는 위치를 모른다.

## D-11 스냅샷은 60초마다 새로 읽고 실패하면 마지막 값을 쓴다
- Status: settled
- Decision: 첫 요청에서 읽고, 60초가 지난 뒤 처음 오는 요청이 새로 읽는다. 동시 요청이 겹쳐도 갱신은 한 번이다. 갱신에 실패하면 마지막 스냅샷을 계속 쓰고, 한 번도 못 읽었으면 요청이 503이다. 기동 때는 읽지 않는다(기동이 장소 테이블에 의존하지 않게). 입력 문자열은 로그에 남기지 않는다(place-search AC-13).
- Rejected: 요청마다 새로 읽기 → 키 입력마다 DB를 읽는다. 갱신 없이 기동 때만 읽기 → 적재 뒤 재기동이 필요하다.

## D-12 AI 엔진 전에는 카드의 점수, 라벨, 이유를 비운다
- Status: settled
- Decision: 카드의 `score`와 `caution`은 JSON에서 생략하고 `labels`, `reasons`, `scoreItems`는 빈 목록으로 보낸다(`PlaceCard`의 `score`는 이미 박싱 `Integer`이고 null은 전역 설정으로 생략되므로 타입은 바뀌지 않고 Javadoc과 스펙 문구가 바뀐다). FE는 `PlaceCard.score`를 선택값으로 바꾸고, 점수를 그리는 곳(카드, 주변 캐러셀, 상세)은 점수가 없으면 점수 영역을 그리지 않는다. 상세 탭의 추천 이유와 주의 영역은 이미 비어 있으면 숨긴다. 첫 화면 주변 카드는 서버 순서의 앞 10곳이었는데, 모든 카드에 점수가 없을 때만 반경 안에서 거리순으로 정렬해 10곳을 고른다.
- Rejected: Mock처럼 고정 문구로 점수와 이유를 지어내기 → "근거 없는 점수는 보이지 않는다"는 약속(place-search)과 충돌하고 운영에 근거 없는 점수가 나간다. 주변 카드 전용 점수 없는 응답과 새 엔드포인트 → BE, FE, 계약 변경이 가장 크다.

## D-13 "근처" 요청은 카탈로그 전체를 내려 주고, 그 밖의 `search`는 503이다
- Status: settled
- Decision: 쿼리에 "근처"가 있고 `cursor`가 없으면 `nearby: true`로 카탈로그 전체를 `place_id` 오름차순으로, 커서와 `emptyReason` 없이 내려 준다. 서버가 위치를 모르므로(place-search D-7, D-22) 후보를 거를 수 없고, 상한이 100이면 300곳 중 100곳 밖 지역의 캐러셀이 빈다. "근처"가 없거나 `cursor`가 있는 요청은 `PlaceSearchUnavailableException`(503)이다. FE에 "추천을 불러오지 못했어요"(5-E03)가 이미 있다. AI 엔진이 없는 채로 공개하면 "추천받기"는 동작하지 않는다.
- Rejected: 키워드 결과를 점수 없는 카드로 돌려주는 폴백 → 범위가 커지고(페이징 커서, 카드 조립) 화면은 "추천"인데 실제는 키워드 일치라는 문구 문제가 있다. 후속으로 얹을 수 있다(D-5의 `offset`). Mock 검색을 DB 장소 위에서 돌리기 → 검색어와 무관한 결과가 "추천"으로 보인다. 상한 100 유지 → 위 이유로 일부 지역이 빈다.

## D-14 DB 접근 오류는 503으로 바꾼다
- Status: settled
- Decision: `PlaceExceptionHandler`가 `DataAccessException`을 503 ProblemDetail로 바꾼다. `detail`은 일반 문구이고 예외는 서버 로그에만 남긴다(BE 컨벤션 3, 4번). FE의 상세 실패(6-02)와 후보 실패(5-E01) 화면이 이미 있다. 리뷰 흐름의 핸들러는 바꾸지 않는다.
- Rejected: 기본 500 → 엔진이 없을 때의 503과 일관되지 않는다.

## D-15 서버 적재와 리뷰 FK는 이 작업이 아니다
- Status: settled
- Decision: dev와 운영의 `places`는 비어 있고 적재기는 `data/naver-places/`에 커밋되지 않은 Python이며 localhost만 허용한다(place-catalog D-15). 서버 적재는 적재기 담당(Jira 100)과 인프라가 별도 티켓으로 한다. 이 작업은 로컬 DB와 Postgres 테스트 컨테이너로 검증하고, 서버 확인은 적재 티켓이 끝난 뒤에 한다. 환경변수 계약 문서는 바꾸지 않는다(스위치의 뜻이 그대로다). 계약상 dev는 `PLACE_MOCK_ENABLED=true`이므로 이 MR이 develop에 머지돼 dev에 배포돼도 dev는 Mock 그대로이고, 적재 뒤 dev의 값을 끄면 DB 모드가 된다. `reviews.place_id`의 FK와 dev 리뷰 id 정리는 리뷰 담당과 적재 뒤에 한다(place-catalog D-21).
- Rejected: 적재와 전환을 이 작업에 포함하기 → 데이터 반입 정책이 정해지지 않았다. 적재 전에 dev를 DB 모드로 바꾸기 → 빈 테이블로 상세가 404가 된다.

## D-16 문서
- Status: settled
- Decision: 이 spec을 `docs/specs/place-lookup-db/`에 새로 둔다. place-search spec은 충돌하는 부분(19·20번 매칭 규칙, 32번 후보 강조, `PlaceCard` 계약 문구, AC-1)만 고쳐 이 spec을 가리키게 하고, 각 수정은 그 계약을 바꾸는 코드와 같은 커밋에 넣는다(place-catalog와 같은 규칙). `docs/infra/`와 `infra/`는 고치지 않는다.
- Rejected: place-search spec에 모두 쓰기 → 이미 76KB다.
