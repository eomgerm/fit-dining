# 장소 조회를 Mock에서 DB로, 자동완성은 키워드 검색 (place-lookup-db)

Status: approved
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

자동완성(`GET /api/v1/places/suggest`), 장소 상세(`GET /api/v1/places/{id}`), 첫 화면 주변 카드(`POST /api/v1/places/search`의 "근처" 요청)는 `be/src/main/resources/mock/places.json`의 36곳으로만 응답한다. 네이버에서 수집해 정제한 300곳을 담은 장소 카탈로그 테이블(place-catalog, V6·V7)이 있지만 API는 읽지 않는다. Mock을 끈 운영에서는 이 세 API가 모두 503이다. 자동완성은 입력 전체를 한 덩어리로 이름이나 메뉴에서 찾아서, 디자인(`Typing`)의 "역삼 쌀국수"처럼 단어를 섞어 입력하면 아무것도 찾지 못한다.

이번 반복(Jira S15P31A302-115)은 세 가지를 한다(D-1). 첫째, 세 API를 카탈로그 DB에서 읽게 한다. 둘째, 자동완성을 단어 단위 키워드 검색(위치와 한글 조합 포함)으로 만든다. 셋째, 키워드 검색 구현을 포트 뒤에 두어 나중에 OpenSearch로 구현만 바꿀 수 있게 한다(D-2, D-5). 자연어 검색(`search`, "근처"가 없는 요청)은 AI 엔진이 붙을 때까지 503이다. dev와 운영 서버 적재와 `reviews.place_id` FK는 이번 범위가 아니다(D-15).

## Assumptions

1. 카탈로그 테이블(`places`와 자식 7개)은 place-catalog spec의 V6·V7 그대로이고, 이번 반복은 마이그레이션을 더하지 않는다.
2. dev와 운영의 `places`는 비어 있고 서버 적재는 별도 티켓이다. 이번 반복은 로컬 DB와 Postgres 테스트 컨테이너로 검증한다(D-15).
3. `place.mock.enabled`(환경변수 `PLACE_MOCK_ENABLED`, 코드 기본값 false)의 이름과 뜻은 그대로다. 켜면 `MockPlaceSearchEngine`, 끄거나 없으면 `CatalogPlaceSearchEngine`이 응답한다. 환경변수 계약(`docs/infra/contracts/env.md`)은 local과 dev에서만 true이고 운영은 설정하지 않는다고 적고 있다(D-2, D-15).
4. 웹 앱은 `ddl-auto=validate`이고 DML 전용 계정(`fit_dev_app`)으로 접속한다. 장소 JPA 엔티티를 만들지 않고 읽기 전용 SQL로 읽는다(D-4).
5. Mock의 장소 id(1~36)와 DB의 `place_id`는 같은 공간이 아니다. 자동완성, 상세, 주변 카드는 같은 스위치로 함께 전환한다(D-3).
6. 카탈로그 300곳은 `station`이 강남·역삼·선릉 각 100곳이고 `PlaceSummary.Station`과 같다. `dong`은 5종(역삼동 186곳 등), `district`는 2종(강남구 268곳)이라 위치 매칭에 쓰지 않는다(D-7, 2026-10-29 `places.csv` 집계).
7. FE는 입력의 앞뒤 공백을 제거한 값을 300ms 늦춰 요청하고 입력이 비면 요청하지 않는다(place-search 32번). 서버는 앞뒤 공백을 한 번 더 제거한다.
8. 서버는 사용자의 위치를 모른다. 요청 어디에도 좌표가 없고, 주변 카드는 후보 전체를 내려 주면 FE가 반경으로 거른다(place-search D-7, D-22).
9. 이 spec의 매칭 규칙(Interfaces)이 정본이고 코드는 그것을 따른다. 나중에 OpenSearch 구현이 생기면 같은 규칙과 같은 계약 테스트를 따른다(D-5).

## Usage

로컬에서 Mock 없이 DB 모드를 확인한다.

```bash
# 1) 로컬 DB에 마이그레이션과 300곳 적재 (place-catalog spec의 Usage 1~2)
# 2) be/.env에서 PLACE_MOCK_ENABLED=true 줄을 지우거나 false로 바꾸고 BE를 띄운다
# 3) 자동완성 (단어를 섞어 입력)
curl -G http://localhost:8080/api/v1/places/suggest --data-urlencode "q=역삼 쌀국수"
# 4) 장소 상세와 첫 화면 주변 카드
curl http://localhost:8080/api/v1/places/1
curl -X POST http://localhost:8080/api/v1/places/search -H "Content-Type: application/json" -d '{"query":"근처 맛집"}'
# 5) "근처"가 없는 자연어 검색은 AI 엔진 전까지 503
curl -X POST http://localhost:8080/api/v1/places/search -H "Content-Type: application/json" -d '{"query":"조용한 데이트 장소"}'
```

## Acceptance criteria

키워드 검색(자동완성)

- [x] AC-1: Mock을 끄고 카탈로그를 적재한 상태에서 `GET /places/suggest?q=`는 입력의 모든 단어가 이름, 메뉴 이름, 업종, 위치 중 하나에 있는 장소만 `PLACE` 후보로 돌려준다. 이름에 "쌀국수"와 "역삼"이 모두 있는 장소는 `q=역삼 쌀국수`에 나오고, 이름에 "역삼"이 없고 역삼 소속도 아닌 장소는 메뉴에 "쌀국수"가 있어도 나오지 않는다. (D-6)
- [x] AC-2: 위치는 `station`의 이름(강남, 역삼, 선릉)과 "역"을 붙인 형태(강남역, 역삼역, 선릉역)로만 맞는다. `station`이 역삼인 장소는 이름과 메뉴에 "역삼"이 없어도 `q=역삼 쌀국수`(메뉴에 쌀국수)에 나오고, `q=역삼역 쌀국수`에도 나온다. `dong`, `district`, 주소만 역삼인 장소(`station`이 강남이거나 선릉)는 이름과 메뉴에 "역삼"이 없으면 나오지 않는다. (D-7)
- [x] AC-3: 업종은 그룹 한글명(식당, 카페, 술집), 그룹 코드(`restaurant`, `cafe`, `bar`), 네이버 업종 이름(`places.category`)으로 맞는다. (D-8)
- [x] AC-4: 마지막 단어의 마지막 글자는 덜 쓴 글자로 맞는다. `쌀구`와 `쌀ㄱ`는 "쌀국수"를 담은 이름이나 메뉴에 맞고, `알`은 "아라"를 담은 이름에 맞고, `달`은 "닭"을, `고`는 "과"를 담은 이름이나 메뉴에 맞는다. 마지막 글자가 아닌 글자에는 완화가 없어서 `살국`은 "쌀국수"에 맞지 않는다. (D-9)
- [x] AC-5: 순위는 0(이름이 입력 전체로 시작) → 1(모든 단어가 이름에) → 2(일부는 이름, 나머지는 메뉴·업종·위치) → 3(이름에는 없고 메뉴나 업종으로) → 4(모두 위치로만) 순이고 같은 순위 안에서는 `place_id` 오름차순이다. (D-10)
- [x] AC-6: `PLACE` 후보는 최대 5개다. "이 조건으로 추천받기"(`ACTION`, `label`)는 항상 하나 있고, 순위 0 후보가 있으면 맨 뒤, 없으면 맨 위다. `PLACE` 후보에는 `label`이 없다. 결과가 없으면 `ACTION`만 온다. (D-10, place-search 20번)
- [x] AC-7: `matchedMenu`는 이름·업종·위치로 채워지지 않는 단어가 있을 때만 있고, 그 단어를 가장 많이 담은 메뉴(동점이면 원본 순서가 앞선 메뉴)다. 이름으로 맞은 단어만 있으면 없다. (Mock은 단어가 업종으로 맞아도 그 단어를 담은 메뉴가 있으면 `matchedMenu`를 담지만, 이 규칙은 이름·업종·위치로 채워진 단어를 메뉴로 설명하지 않는다.) (D-10)
- [x] AC-8: 대소문자를 구분하지 않고(`Locale.ROOT`), 앞뒤와 연속 공백을 정규화하고(NBSP, U+3000 같은 줄바꿈 없는 공백도 공백이다. 공백뿐인 입력은 결과가 없다), 결합 문자로 쓴 한글도 완성형과 같게 맞추며, `%`, `_`, `\`와 정규식 문자는 글자 그대로 맞는다. (D-6)
- [x] AC-9: 스냅샷은 첫 요청에서 읽고 60초가 지난 뒤 처음 오는 요청이 새로 읽는다. 동시 요청이 겹쳐도 갱신은 한 번이다. 갱신에 실패하면 마지막 스냅샷으로 응답하고, 한 번도 못 읽었으면 503이다. 읽기가 실패한 뒤 5초 동안은 DB를 다시 읽지 않는다(기다리던 요청도 함께 실패한다). 기동 때는 읽지 않는다. (D-11)
- [x] AC-10: 자동완성을 처리한 뒤(오류 포함) BE 로그 출력에 `q` 값이 나타나지 않는다. (place-search AC-13, D-11)
- [x] AC-11: `PlaceKeywordSearchContract`의 모든 검사를 `DocumentKeywordSearch`가 통과한다. 다른 구현이 생기면 같은 검사를 그대로 상속한다. (D-5)

상세

- [x] AC-12: `GET /places/{id}`는 카탈로그 DB의 장소를 place-catalog spec의 `PlaceDetailResponse` 모양으로 돌려준다. 응답 키는 문서화된 필드를 벗어나지 않고, `hours`는 월~일 7개이며 요일마다 `breaks`와 `lastOrders`가 있다. 없는 id는 404, 정수가 아닌 id는 400이다. (D-2)
- [x] AC-13: `openStatus`는 place-catalog spec의 영업 상태 규칙대로 서울 시각(주입한 `Clock`)으로 계산하고, 카드와 상세와 Mock이 같은 계산기(`OpenStatusCalculator`)를 쓴다. 기존 Mock의 영업 상태 테스트가 그대로 통과한다. (D-2)
- [x] AC-14: `closedDayNote`는 정기휴무 요일을 월요일부터 세어 "매주 일요일 휴무", 여럿이면 "매주 토·일요일 휴무"로 읽을 때 계산하고, 정기휴무가 없으면 생략한다. 날짜가 붙은 휴무(DB에서 정보 없음으로 저장된 요일)는 정기휴무가 아니다.
- [x] AC-15: 읽을 때의 변환이 규칙대로다. 요일 행이 없는 요일은 `closed: false`에 시각이 없다. `photos`는 업체 사진 다음 메뉴판 사진이고 각각 `sort_order` 순이다. `subways`는 도보 거리 오름차순(값이 없으면 뒤), 같으면 PK 순이다. `noKidsZone`과 `parking.valet`은 `facilities`의 "노키즈존", "발렛파킹"으로 정하고, `parking`, `pet`, `corkage`는 place-catalog spec대로 값이 없으면 생략한다. `tags`는 빈 목록이다. `breaks`는 시작과 끝이 모두 시각인 항목만 읽고 나머지는 버린다. `address`가 비었으면 `full_address`, `jibun_address` 순으로 대신한다.
- [ ] AC-16: (선택) `places.json`의 36곳을 같은 모양으로 테이블에 넣었을 때 `findPlace`의 응답이 JSON 상세와 `tags`, `openStatus`를 뺀 모든 필드에서 같다. 두 데이터가 같은 규칙으로 만들어졌으므로 `closedDayNote` 계산을 검증한다. (이 반복에서 구현하지 않았다. 후속)

주변 카드

- [x] AC-17: 쿼리에 "근처"가 있고 `cursor`가 없는 `POST /places/search`는 `nearby: true`로 카탈로그 전체를 `place_id` 오름차순으로 돌려준다. `nextCursor`, `emptyReason`, `changeSummary`는 없고 `totalCount`는 `items`의 수와 같다. (D-13)
- [x] AC-18: 카드는 `place`, `openStatus`, 빈 `labels`, 빈 `reasons`, 빈 `scoreItems`를 담고 `score`와 `caution`은 JSON에서 생략한다. (D-12)
- [x] AC-19: 쿼리에 "근처"가 없거나 `cursor`가 있는 요청은 503 ProblemDetail이다. (D-13)

전환과 오류

- [x] AC-20: `place.mock.enabled=true`이면 지금과 똑같이 `MockPlaceSearchEngine`이 응답하고 기존 Mock 테스트가 모두 통과한다. 그 밖의 값(false, 없음, 빈 값, `yes`, `1` 등)이면 `CatalogPlaceSearchEngine`이 응답하고, 어떤 값이든 엔진 빈은 정확히 하나다. DB 모드 빈(`CatalogPlaceSearchEngine`, `JdbcPlaceCatalog`, `DocumentKeywordSearch`)은 Mock 엔진 조건의 부정일 때만 등록된다. (D-2)
- [x] AC-21: DB 접근 오류는 503 ProblemDetail이고 `detail`에 일반 문구만 있으며 예외는 서버 로그에만 남는다. (D-14)
- [x] AC-22: `PlaceService`는 엔진을 직접 주입받고(엔진 빈이 항상 하나), 컨트롤러와 `ReviewService`는 바뀌지 않는다. (D-2)

FE

- [x] AC-23: 후보 줄의 이름과 "메뉴: ..." 글에서 입력을 공백으로 나눈 단어마다 대소문자 무시 부분 문자열을 강조하고 겹치는 구간을 합친다. 마지막 단어가 글자 그대로 맞지 않으면(한글 조합 중이면) 그 단어 전체를 강조하지 않는다. (D-6, D-9)
- [x] AC-24: 점수가 없는 카드는 검색 결과 카드와 주변 캐러셀에 핏 점수 영역을 그리지 않고, 상세에는 핏 점수 버튼을 그리지 않는다. 추천 이유와 주의 영역은 비어 있으면 그대로 숨는다. (D-12)
- [x] AC-25: 첫 화면 주변 카드는 모든 카드에 점수가 없을 때 기준 지점에서 반경 안의 카드를 거리 오름차순으로 정렬해 앞 10곳을 고른다. 점수가 있는 카드가 있으면 서버 순서를 그대로 따른다. 입력한 "근처" 검색의 결과 목록(순위 번호와 지도 핀)도 응답의 모든 카드에 점수가 없으면 같은 기준(위치가 있으면 그 위치, 없으면 역삼역)으로 가까운 순이다. (D-12)

문서와 범위

- [x] AC-26: place-search spec의 19·20번(매칭 규칙), 32번(후보 강조), Interfaces의 `PlaceCard` 문구, AC-1이 새 동작과 어긋나지 않고 이 spec을 가리키며, 각 수정은 그 계약을 바꾸는 코드와 같은 커밋에 있다. (D-16)
- [x] AC-27: 마이그레이션 추가, `infra/`와 `docs/infra/` 수정, 장소 JPA 엔티티, `data/naver-places/` 커밋이 없다. (D-4, D-15, D-16)
- [x] AC-28: `./gradlew test`(Docker 필요)와 FE의 `vitest`, `tsc`, `eslint`, `prettier`가 통과한다. 엔진 빈이 항상 하나가 되므로 Mock 없이 뜨는 모든 컨텍스트에서 DB 모드 빈이 만들어져도 기존 테스트 전체가 통과한다.

## Interfaces

### 구조

```text
PlaceController → PlaceService → PlaceSearchEngine            (기존 인터페이스, 변경 없음)
                                    ├─ MockPlaceSearchEngine     place.mock.enabled=true  (기존 그대로)
                                    └─ CatalogPlaceSearchEngine  place.mock.enabled=false 또는 없음 (신규)
                                          ├─ PlaceCatalog         상세 · 주변 후보 · 검색 문서 읽기 (Postgres, JdbcClient)
                                          └─ PlaceKeywordSearch   자동완성 (지금: 문서 스냅샷 + Java 매처, 나중: OpenSearch)
```

패키지는 `kr.co.fitdining.api.place` 아래다. `engine/CatalogPlaceSearchEngine`, `catalog/{PlaceCatalog, JdbcPlaceCatalog, PlaceSearchDocument, OpenStatusCalculator, ConditionalOnCatalogMode, CatalogModeCondition}`, `keyword/{PlaceKeywordSearch, PlaceKeywordHit, DocumentKeywordSearch, KeywordMatcher, HangulComposition, IndexedDocument}`다.

```java
public interface PlaceCatalog {
    Optional<PlaceDetailResponse> findPlace(long id);          // 없으면 빈 값 → 404
    List<PlaceCard> nearbyCandidates();                        // 카탈로그 전체, place_id 오름차순, 점수 없는 카드
    List<PlaceSearchDocument> loadSearchDocuments();           // 키워드 검색 문서 전체
}

public interface PlaceKeywordSearch {
    // query는 컨트롤러 검증(1~200자, 공백뿐인 값 제외)을 통과한 값. 순위, place_id 순으로 정렬된 히트.
    List<PlaceKeywordHit> search(String query, int offset, int limit);
}

public record PlaceKeywordHit(PlaceSummary place, String matchedMenu, Boolean namePrefix) {}   // namePrefix = 순위 0

public record PlaceSearchDocument(PlaceSummary place, List<String> menuNames, String naverCategory) {
    List<String> categoryNames();   // 그룹 한글명, 그룹 코드, naverCategory(있으면)
    List<String> locationNames();   // 역 이름과 "역"을 붙인 형태
}
```

`CatalogPlaceSearchEngine`은 조립만 한다. `suggest`는 `PlaceKeywordSearch.search(q, 0, 5)`의 히트로 `PLACE` 후보를 만들고, 첫 히트의 `namePrefix`가 true이면 `ACTION`을 맨 뒤에, 아니면 맨 위에 둔다. `findPlace`는 `PlaceCatalog`에 위임한다. `search`는 쿼리에 "근처"가 있고 `cursor`가 비어 있으면 `PlaceCatalog.nearbyCandidates()`로 근처 응답(`conditions`는 받은 `previousConditions`나 빈 객체)을 만들고, 아니면 `PlaceSearchUnavailableException`이다.

### 키워드 매칭 규칙 (D-5 ~ D-10)

**검색 문서.** 장소마다 이름, 메뉴 이름 목록(`sort_order` 순), 업종 이름들, 위치 이름들을 NFC와 소문자로 정규화해 둔다. 업종 이름들은 그룹 한글명(식당, 카페, 술집), 그룹 코드(`restaurant`, `cafe`, `bar`), 네이버 업종 이름(있으면)이고, 위치 이름들은 `station`의 한글 이름(강남, 역삼, 선릉)과 "역"을 붙인 형태다. `keywords[]`, 업체 소개, 주소, `dong`, `district`는 넣지 않는다.

**단어와 통과.** 입력을 정규화하고 공백으로 나눠 단어로 만들고 중복을 뺀다. 단어마다 위 필드 중 하나라도 그 단어를 부분 문자열로 담으면 통과이고, 모든 단어가 통과해야 후보다. 와일드카드와 정규식은 없다.

**마지막 글자의 조합 완화.** 마지막 단어의 마지막 글자 c만 다음처럼 맞춘다. 나머지 글자는 글자 그대로 맞춘다. 마지막 단어가 한 글자이면 그 글자가 c다.

| c | 텍스트의 같은 자리 글자가 다음이면 맞는다 |
|---|---|
| 받침 없는 완성형 글자 | 같은 초성이고 중성이 같으며 받침이 무엇이든(없음 포함 28개). c의 중성이 ㅗ, ㅜ, ㅡ이면 복합 모음으로 이어진 중성도 맞는다(ㅗ→ㅘ·ㅙ·ㅚ, ㅜ→ㅝ·ㅞ·ㅟ, ㅡ→ㅢ) |
| 받침 있는 완성형 글자 | c 자체. 또는 받침 T가 홑받침일 때 같은 초성·중성에 받침이 없는 글자이고 바로 다음 글자의 초성이 T인 경우. T가 겹받침(T1T2)이면 같은 초성·중성에 받침 T1인 글자이고 다음 글자의 초성이 T2인 경우. 또는 T가 겹받침의 첫 자음일 때(ㄱ→ㄳ, ㄴ→ㄵ·ㄶ, ㄹ→ㄺ·ㄻ·ㄼ·ㄽ·ㄾ·ㄿ·ㅀ, ㅂ→ㅄ) 같은 초성·중성에 그 겹받침인 글자 |
| 홀로 쓴 자음 | 초성이 그 자음인 모든 완성형 글자(자음 자체도 맞는다) |
| 그 밖(모음 홀로, 영문, 숫자, 기호) | c 자체 |

**순위** (같은 순위 안에서는 `place_id` 오름차순)

| 순위 | 조건 |
|---|---|
| 0 | 이름이 정규화한 입력 전체(단어 사이 공백 한 칸)로 시작한다. 마지막 글자는 위 조합 완화를 같은 방식으로 적용한다 |
| 1 | 모든 단어가 이름에 있다(순위 0 제외) |
| 2 | 일부 단어는 이름에 있고 나머지는 메뉴·업종·위치에 있다 |
| 3 | 이름에 있는 단어가 없고 메뉴나 업종으로 맞는다 |
| 4 | 모든 단어가 위치로만 맞는다 |

**`matchedMenu`.** 이름, 업종, 위치로 채워지지 않는 단어(R)가 있을 때만, R의 단어를 가장 많이 담은 메뉴를 돌려준다. 동점이면 원본 순서가 앞선 메뉴다. R이 없으면 없다.

**예.** 입력 `역삼 쌀국수`에서 이름이 "하노이 쌀국수 역삼점"인 장소는 두 단어가 모두 이름에 있어 순위 1이고 `matchedMenu`가 없다. `station`이 역삼이고 이름에 "역삼"이 없는데 메뉴 "양지 쌀국수"가 있는 장소("포레스트 키친")는 "역삼"이 위치, "쌀국수"가 메뉴라서 순위 3이고 `matchedMenu`는 "양지 쌀국수"다.

### 스냅샷 (D-11)

`DocumentKeywordSearch`는 `PlaceCatalog.loadSearchDocuments()`의 결과로 만든 정규화된 문서 목록(`IndexedDocument`)을 스냅샷으로 들고 있다. 첫 요청이 읽고, 읽은 뒤 60초가 지난 다음 처음 오는 요청이 다시 읽는다(주입한 `Clock`). 갱신은 한 번에 하나만 돌고, 기존 스냅샷이 있으면 다른 요청은 기다리지 않고 그것을 쓴다. 스냅샷이 아직 없는 최초 읽기 동안 들어온 요청은 그 결과를 기다린다. 갱신이 실패하면 기존 스냅샷을 유지하고, 스냅샷이 아직 없으면 예외로 503이다. 실패한 뒤 5초 동안은 DB를 다시 읽지 않는다(기존 스냅샷이 있으면 같은 문서를 5초 뒤 만료로 두고, 없으면 락을 기다리던 요청도 읽지 않고 함께 503이다). 기동 때는 읽지 않는다.

### 상세 읽기 (D-2, D-4)

`JdbcPlaceCatalog.findPlace(id)`는 `places`와 자식 6개 테이블(`place_hours`, `place_menus`, `place_photos`, `place_subways`, `place_seats`, `place_broadcasts`)을 각각 `place_id`로 읽는다. 버스 정류장은 응답에 없어서 읽지 않는다. 응답 모양과 영업시간·영업 상태 규칙은 place-catalog spec의 "상세 응답"과 "영업 상태 규칙"을 따르고, 이 반복이 정하는 것은 다음이다.

- `openStatus`는 `OpenStatusCalculator`(Mock에서 꺼낸 순수 함수)가 읽은 `hours`로 계산한다.
- `closedDayNote`는 읽을 때 계산한다(AC-14). `noKidsZone`, `parking.valet`은 `facilities`로 정한다.
- `hours`는 항상 7개다. 요일 행이 없으면 `closed: false`에 시각이 없다.
- `photos`는 `source`가 `business`인 것 다음 `menuBoard`인 것이고 각각 `sort_order` 순이다. `thumbnailUrl`은 `places.thumbnail_url`이다.
- `subways`는 `walk_meters` 오름차순(NULL은 뒤), 같으면 `place_subway_id` 순이다. 좌석과 방송은 PK 순이다.
- `tags`는 빈 목록이다(AI 쪽이 준다, place-catalog D-17).
- `breaks`(jsonb)는 원소의 모양을 스키마가 정하지 않으므로 시작과 끝이 모두 시각인 항목만 읽고 나머지는 버린다. 알 수 없는 속성은 무시한다. 한 곳의 깨진 값이 그 장소의 상세와 첫 화면 주변 카드 전체를 무너뜨리지 않게 한다.
- `address`는 `address`, `full_address`, `jibun_address` 중 비어 있지 않은 첫 값이다(없으면 빈 문자열).

### 주변 카드 (D-12, D-13)

`nearbyCandidates()`는 `places` 전체와 `place_hours` 전체(약 2,100행)를 한 번씩 읽어 카드를 만든다. 카드는 `place`, `openStatus`, `labels: []`, `reasons: []`, `scoreItems: []`이고 `score`와 `caution`은 없다. 후보 수는 카탈로그 전체이고 상한이 없다.

### 카드 계약 (D-12)

`PlaceCard.score`는 AI 엔진이 붙기 전에는 생략한다. `labels`, `reasons`, `scoreItems`는 엔진이 없으면 빈 목록이다. 타입 변경은 없고 Javadoc과 place-search spec의 문구가 바뀐다. FE의 `PlaceCard.score`는 `score?: number`가 된다.

### 오류 (D-13, D-14)

| 상황 | 응답 |
|---|---|
| "근처"가 없거나 `cursor`가 있는 `search` | 503 ProblemDetail (`PlaceSearchUnavailableException`) |
| 스냅샷을 한 번도 읽지 못함, DB 접근 오류(`DataAccessException`) | 503 ProblemDetail, `detail`은 일반 문구 |
| 없는 장소 id | 404 |

### FE 변경

- `model/highlight.ts#highlightParts`: 입력을 공백으로 나눈 단어마다 대소문자 무시 부분 문자열로 찾고 겹치는 구간을 합친다. 시그니처는 그대로다.
- `model/place-types.ts#PlaceCard`: `score?: number`.
- `ui/place-card.tsx`, `ui/nearby-carousel.tsx`, `ui/place-detail-screen.tsx`: 점수가 없으면 점수 영역(버튼 포함)을 그리지 않는다.
- `model/nearby.ts#pickNearby`: 모든 카드에 점수가 없으면 반경 안의 카드를 기준 지점과의 거리 오름차순으로 정렬한 뒤 10곳을 고른다.

### 스위치

| `place.mock.enabled` | 엔진 | `search` ("근처" 아님) | 상세, 자동완성, 주변 카드 |
|---|---|---|---|
| true | `MockPlaceSearchEngine` | Mock | Mock |
| true가 아닌 값(false, 없음, 빈 값 등) | `CatalogPlaceSearchEngine` | 503 | 카탈로그 DB |

## Constraints

- 마이그레이션을 더하지 않는다. 장소 JPA 엔티티를 만들지 않는다(D-4).
- `infra/`와 `docs/infra/`를 고치지 않는다. 환경변수 계약 문서도 바꾸지 않는다(스위치의 뜻이 그대로다, D-15).
- 입력 문자열(`q`, `query`)을 로그에 남기지 않는다(place-search AC-13). 서버 오류는 예외 객체를 마지막 인자로 로그에 남기고 응답 `detail`에는 일반 문구만 둔다(BE 컨벤션 3, 4번).
- 브랜치 하나(`S15P31A302-115/feat/place-lookup-db`), MR 하나, 커밋 여러 개다. 각 커밋은 그 시점의 전체 테스트(`./gradlew test`, FE 검사)를 통과한다. 커밋 메시지는 `[S15P31A302-115] 종류: 설명`이다(D-1).
- place-search spec 수정은 그 계약을 바꾸는 코드와 같은 커밋에 넣는다(D-16).
- MR 설명은 사람이 쓴다. MR은 제목만으로 올리고 검증 방법은 따로 전한다.
- 서버 적재와 `reviews.place_id` FK를 하지 않는다(D-15).

## Existing code

| Locator | Action | Obligation | Decision |
|---|---|---|---|
| `be/src/main/java/kr/co/fitdining/api/place/engine/PlaceSearchEngine.java#PlaceSearchEngine` | reuse | 인터페이스를 바꾸지 않는다 | D-2 |
| `be/src/main/java/kr/co/fitdining/api/place/engine/MockPlaceSearchEngine.java#openStatus` | modify | 영업 상태 계산을 `OpenStatusCalculator`에 맡긴다. 동작은 같고 Mock의 다른 동작(검색, 자동완성, 커서, 스위치)은 그대로다 | D-2 |
| `be/src/main/java/kr/co/fitdining/api/place/PlaceService.java#PlaceService` | modify | 엔진을 `ObjectProvider` 대신 직접 주입받는다. 503 판단은 엔진 예외가 한다 | D-2 |
| `be/src/main/java/kr/co/fitdining/api/place/exception/PlaceExceptionHandler.java#PlaceExceptionHandler` | modify | `DataAccessException`을 503 ProblemDetail로 바꾼다 | D-14 |
| `be/src/main/java/kr/co/fitdining/api/place/exception/PlaceSearchUnavailableException.java#PlaceSearchUnavailableException` | reuse | 비근처 `search`와 스냅샷 실패에 그대로 쓴다 | D-13 |
| `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceCard.java#PlaceCard` | modify | Javadoc만 바꾼다(`score` 생략 조건, 빈 목록) | D-12 |
| `be/src/test/java/kr/co/fitdining/api/place/PlaceControllerMockDisabledTest.java#PlaceControllerMockDisabledTest` | modify | "Mock을 끄면 503" 전제가 사라지므로 새 동작(DB 모드)에 맞게 다시 쓴다 | D-2 |
| `be/src/test/java/kr/co/fitdining/api/support/PostgresTestSupport.java#PostgresTestSupport` | reuse | Postgres 통합 테스트의 기반이다. 고치지 않는다 | D-4 |
| `be/src/main/resources/mock/places.json` | reuse | 선택 AC-16의 오라클로만 쓴다 | D-5 |
| `fe/src/domains/place/model/highlight.ts#highlightParts` | modify | 단어별 강조 | D-6 |
| `fe/src/domains/place/model/place-types.ts#PlaceCard` | modify | `score?: number` | D-12 |
| `fe/src/domains/place/ui/place-card.tsx`, `ui/nearby-carousel.tsx`, `ui/place-detail-screen.tsx` | modify | 점수가 없으면 점수 영역을 그리지 않는다 | D-12 |
| `fe/src/domains/place/model/nearby.ts#pickNearby` | modify | 점수가 없으면 거리순 | D-12 |
| `docs/specs/place-search/spec.md` 19·20·32번, Interfaces `PlaceCard`, AC-1 | modify | 새 동작과 어긋나지 않게 고치고 이 spec을 가리킨다. 해당 코드와 같은 커밋 | D-16 |
| `docs/specs/place-catalog/spec.md` Out of scope의 "API가 DB를 읽게 하는 일" | modify | 이 spec이 그 일을 한다고 가리킨다 | D-16 |

새 파일은 Interfaces의 패키지 목록(`engine/CatalogPlaceSearchEngine`, `catalog/*`, `keyword/*`)과 그 테스트다.

## Commit plan

각 커밋은 독립적으로 전체 테스트를 통과한다. 배선(엔진 빈 등록, `PlaceService` 직접 주입)은 마지막 커밋이다.

1. `docs`: 이 spec과 결정 로그.
2. `refactor`: `OpenStatusCalculator`를 Mock에서 꺼내 공유한다(동작 변화 없음).
3. `feat`: 키워드 검색(문서, 매처, 한글 조합, 스냅샷, 계약 테스트)과 place-search spec 19·20번 수정.
4. `feat`: 카탈로그 읽기(상세, 주변 후보)와 DB 오류 503, Postgres 테스트.
5. `feat`: FE 카드 점수 선택값과 거리순 주변 카드, place-search spec의 카드 계약 수정.
6. `feat`: FE 단어별 강조와 place-search spec 32번 수정.
7. `feat`: DB 모드 엔진 배선(`CatalogPlaceSearchEngine`, `PlaceService` 직접 주입, `MockDisabled` 테스트 재작성), 두 spec의 상태 마무리.

## Seams & test plan

- 키워드 매처 단위 테스트(example), AC-1~AC-8: Docker 없이 문서 목록을 직접 만들어 표 기반으로 검증한다. Interfaces의 예(`역삼 쌀국수`, `쌀구`, `쌀ㄱ`, `알`→아라, `살국`), 순위 0~4와 동순위 `place_id` 순, `matchedMenu`, 5개 상한, `ACTION` 위치, 대소문자와 공백, 와일드카드 문자를 케이스로 둔다. 잡는 것: 규칙 오류, 순위 뒤바뀜. 놓치는 것: 실제 입력기의 조합 동작. Prior art: 없음(새 모듈).
- 포트 계약 테스트(example), AC-11: `PlaceKeywordSearchContract`를 추상 클래스로 만들고 `DocumentKeywordSearchTest`가 상속한다. 같은 픽스처와 기대를 다른 구현이 상속하면 교체가 검증된다.
- 스냅샷 테스트(example), AC-9: 가짜 `Clock`과 가짜 `PlaceCatalog`로 TTL 경과, 갱신 실패 시 마지막 값 유지, 최초 실패 503, 실패 뒤 5초 백오프, 동시 갱신 한 번을 확인한다.
- 엔진 조립 테스트(example), AC-6, AC-17~AC-19: 가짜 두 포트로 `suggest`의 `ACTION` 위치, "근처" 분기, 비근처와 `cursor`의 503을 확인한다.
- Postgres 통합 테스트(example), AC-12~AC-15, AC-17, AC-18: `PostgresTestSupport`를 상속해 `JdbcPlaceCatalog`를 확인한다. 자정 넘김, 24시간 영업, 브레이크, 요일 행 누락, 정기휴무에서 나오는 `closedDayNote`, 숫자 없는 가격, `facilities`에서 나오는 플래그, 사진·지하철 순서, 카탈로그 전체 후보를 시드해 기대 DTO와 비교한다. 잡는 것: 매핑과 계산 오류. 놓치는 것: 300곳 전체의 값 일치. Prior art: `PlaceCatalogSchemaTest`.
- 오라클 테스트(example, 선택), AC-16: `places.json`의 36곳을 테이블에 넣고 DB 상세를 JSON 상세와 비교한다.
- 영업 상태 단위 테스트(example), AC-13: 기존 Mock의 영업 상태 테스트를 `OpenStatusCalculator`로 옮겨 같은 기대로 통과시킨다. 핵심 순수 함수(`KeywordMatcher`, `OpenStatusCalculator`)는 변이를 직접 넣어 테스트가 잡는지 확인한다.
- 컨트롤러 테스트(example), AC-20~AC-22: DB 모드의 503, 404, 400, DB 오류 503을 확인하고 Mock 모드의 기존 테스트가 그대로임을 확인한다. Prior art: `PlaceControllerTest`.
- FE 단위·화면 테스트(example), AC-23~AC-25: `highlight.test.ts`에 다중 단어, 겹침 병합, 대소문자를 더하고, `nearby.test.ts`에 점수 없는 카드의 거리순 선택을 더하며, 점수 없는 카드, 주변 캐러셀, 상세를 Testing Library로 그려 점수 영역이 없는지 확인한다. `tsc`, `eslint`, `prettier`를 통과시킨다.
- 로그 확인(manual), AC-10: 자동완성을 오류 경로까지 한 번씩 호출하고 BE 로그에 입력이 없는지 본다.
- 문서 검토(manual), AC-26, AC-27: place-search spec의 수정 범위, 마이그레이션과 `infra/` 미변경, `data/naver-places/` 미커밋을 diff로 확인한다.
- 기존 테스트 전체(example), AC-28: `./gradlew test`(Docker 필요), CI `be:test`, FE 테스트.

## Out of scope

- dev와 운영 서버 적재, 적재기를 레포에 올리는 일, 적재 전 dev 전환(D-15)
- `reviews.place_id` FK와 dev 리뷰의 Mock id 정리(D-15)
- 자연어 검색(AI 엔진)과 점수, 추천 이유, 카드 `labels`, 상세 `tags`의 실데이터(D-12, D-13)
- 키워드 결과를 카드로 돌려주는 폴백(D-13)
- OpenSearch 연동(클라이언트, nori 인덱스, 색인, 구현). 이 spec은 교체 지점과 계약 테스트까지다(D-5)
- 초성만 입력하는 검색(D-9)
- 버스 정류장 노출, `keywords[]`와 주소·동·구 매칭(D-7)
- 환경변수 계약 문서(`docs/infra/contracts/env.md`)와 인프라 설정 변경(D-15)

## Open questions

- 서버 적재 티켓이 동결(11-04) 전에 끝나는지. 끝나지 않으면 이 MR은 머지돼도 dev는 Mock이고 DB 모드는 켜지지 않는다.
- Mock id와 DB `place_id`의 대응과 dev 리뷰 정리는 적재 티켓과 리뷰 담당이 정한다.
- AI 엔진이 공개(11-06) 전에 붙는지. 안 붙으면 "추천받기"가 동작하지 않으므로 키워드 폴백(D-13)을 후속으로 할지 정한다.
- 주변 카드가 카탈로그 전체를 내려 주는 응답의 크기. 약 100KB 안팎으로 추정했고 측정하지 않았다.
- 운영에서 데이터가 바뀔 때 스냅샷 갱신 주기 60초가 충분한지.
- 입력한 "근처" 검색의 응답은 카탈로그 전체(300곳 기준 약 96KB로 추정)라서 FE가 thread 저장소(`localStorage`)에 통째로 저장한다. 브라우저 쿼터(약 5MB)를 넘으면 저장이 조용히 멈춘다. 저장하는 카드 수를 줄일지 정한다.
- 위치를 얻지 못하면 입력한 "근처" 검색은 300곳 전체를 목록과 지도 핀으로 보인다(Mock은 100곳). 표시 개수를 제한할지 정한다.
- 한 글자 입력(예: `역`)은 위치 이름(`강남역` 등)에 부분 문자열로 맞아 모든 장소가 후보가 된다. 규칙대로이고 후보는 5개로 잘린다.
