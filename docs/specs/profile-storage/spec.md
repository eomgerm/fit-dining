# 사용자 취향·장소 특징·페르소나 저장 (profile-storage)

Status: draft
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

39(취향 프로필, [taste-profile](../taste-profile/spec.md))와 40(장소 특징·페르소나, [place-profile](../place-profile/spec.md))은 결과를 JSON 파일로만 낸다. 검색과 핏 점수(41)가 쓰려면 DB에 저장해야 하고, 누가 언제 어떤 컬럼을 쓰는지 정해야 한다.

이 spec은 Jira S15P31A302-103([BE] 장소 페르소나·사용자 취향 저장 설계)의 저장 구조와 쓰기 시점을 다룬다. 갱신 알고리즘(앱 리뷰를 취향과 장소에 반영하는 계산)은 다른 일감이다(D-1).

## Assumptions

1. 1차 MVP는 Postgres의 pgvector만 쓴다. OpenSearch는 쓰지 않는다(D-2).
2. 39·40의 베이스라인은 첫 생성만 다룬다. 사용자 취향은 온보딩 때, 장소 특징·페르소나는 릴리즈 전에 네이버 리뷰로 한 번 만든다(D-6, D-9).
3. 첫 생성 이후의 갱신은 모두 매일 04:00 배치에서만 한다. 장소는 앱 리뷰로만 갱신하고 네이버 리뷰는 다시 쓰지 않는다(D-6, D-9).
4. 벡터는 arctic-ko 1024차원이고 L2 정규화되어 있다(39·40 spec).
5. `vector` 확장은 DB 관리자가 미리 만든다(`infra/data/ensure-databases.sh`, `infra/local/fit-local.sh`). 마이그레이션 계정(`fit_migrator`)은 확장을 만들 수 없다.

## 스키마

마이그레이션: `be/src/main/resources/db/migration/V6__create_places_and_profiles.sql`. 컬럼 설명은 `COMMENT ON`으로 DB에도 남겼다.

### `feature_codes`(새 테이블)

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `code` | text PK | 특징 코드(`QUIET` 등). `ai/src/fit_ai/features.py`의 `FEATURES` 23개 |
| `layer` | text NOT NULL, CHECK | `axis` \| `importance` \| `purpose` \| `food` |
| `phrase` | text NOT NULL | 코드 설명 문구("조용하고 차분한 곳"). `vector`를 만든 문장 |
| `vector` | vector(1024) NOT NULL | 문구 임베딩. 질의 인코딩(`query: ` 접두사), L2 정규화. 41이 사용자의 코드를 페르소나와 비교할 때 쓴다 |
| `created_at`, `updated_at` | timestamptz NOT NULL, 기본 `now()` | |

- V6이 23행을 넣는다. 벡터는 `encode_queries`(39 임베딩 함수)로 미리 만들어 SQL에 넣었다(D-14).
- `reason_tags.feature_code`는 `fk_reason_tags_feature_code`로 이 테이블을 가리킨다.

### `user_preferences`(기존 V2에 컬럼 추가)

| 컬럼 | 타입 | 내용 | 쓰는 쪽 |
|---|---|---|---|
| `mood`, `priorities`, `purposes` | 기존 | 온보딩 원본 | 온보딩(-58). 바꾸지 않는다 |
| `tastes` | jsonb(기존) | 온보딩 원본 칩. 칩 하나는 39가 직접 입력을 해석한 항목 하나다(taste-profile spec 1단계 "칩 표시"). 원소에 `code`, `vector`가 더해진다: `[{polarity, label, code, vector}]`. `code`는 코드표 코드 또는 null, 코드 없는 칩의 `label`은 39의 `positive_text`이고, `vector`는 코드 없는 LIKE 칩만 | `polarity`, `label`은 온보딩. `code`, `vector`는 온보딩 때 39 |
| `features` | jsonb, NOT NULL, 기본 `[]`, 배열 CHECK | 취향 프로필 결과 `[{code, layer, like, weight, category}]`. `weight`는 0보다 큰 실수이고 상한이 없다. `category`는 null이면 전체 취향, `RESTAURANT`·`CAFE`·`BAR`면 그 업종의 취향이다(D-20). 취향 묶음 원소 `{code: null, layer: null, like: true, weight, category, text, vector}`가 업종마다 3개까지 더해진다(D-22) | 온보딩 때 39, 이후 04:00 배치 |
| `features_refreshed_at` | timestamptz, null 허용(V21) | 04:00 배치가 `features`를 마지막으로 다시 계산한 실행 시작 시각. null은 아직 배치가 계산하지 않음이고, 다음 04:00 배치의 대상이다(D-15, D-22) | 04:00 배치 |

원본을 남기는 이유: `weight`는 근거마다 뒤에 쌓인 리뷰 수로 줄인 무게의 합이고 같은 장소는 최신 평가 하나만 센다(taste-profile spec 3단계). 합에서 근거별 정보가 사라져 `features`만으로는 리뷰를 빼거나 더해 다시 계산할 수 없다. 코드표에 없는 칩의 `vector`도 검색에 쓴다(D-3).

### `places`(새 테이블)

수집한 값과 그 값에서 규칙으로 바로 나오는 분류만 둔다. 분석 결과는 `place_profiles`에 있다(D-4).

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `place_id` | bigint identity PK | 서비스 자체 ID(D-12) |
| `naver_place_id` | text NOT NULL, UNIQUE, 빈 문자열 금지 | 네이버 장소 ID. 적재 재실행 중복 방지, 재수집 대상과 40 출력을 찾는 키(D-12) |
| `name` | text NOT NULL | 장소 이름 |
| `category_group` | text NOT NULL, CHECK | `RESTAURANT` \| `CAFE` \| `BAR`(BE `PlaceSummary.CategoryGroup`). `is_label` 업종 그룹 평균의 단위 |
| `food_type` | text, CHECK | `FOOD_KOREAN` \| `FOOD_CHINESE` \| `FOOD_JAPANESE` \| `FOOD_WESTERN` \| `FOOD_ASIAN` \| null(카페·술집·뷔페·처음 보는 코드). 네이버 업종 코드로 정한다(ai `rules.food_type`) |
| `station` | text, CHECK(NULL 허용) | 장소에서 가장 가까운 역 코드 34개(BE `PlaceSummary.Station`): 서울 강남권 15개(`GANGNAM` \| `YEOKSAM` \| `SEOLLEUNG` 등)와 대전·구미·부산의 역(목록은 D-16, D-17). 가까운 역이 없으면 null(V22, V23) |
| `thumbnail_url` | text | 대표 사진 |
| `category`, `category_code`, `category_code_path` | text, text, text[] | 네이버 업종 이름과 코드 |
| `lat`, `lng` | double precision NOT NULL, 범위 CHECK | 좌표 |
| `address`, `jibun_address`, `full_address`, `district`, `dong`, `directions` | text | 도로명·지번·상세 주소, 구·동(주소에서 뽑음), 찾아오는 길 |
| `description`, `phone`, `website`, `extra_links`, `booking_url` | text(`extra_links`는 text[]) | 업체 소개, 대표 전화(없으면 안심번호), 홈페이지, 그 밖의 링크, 네이버 예약 |
| `facilities`, `payment_methods`, `keywords` | text[] NOT NULL, 기본 `{}` | 편의시설, 결제 수단, 업체가 등록한 키워드(리뷰 투표 키워드 아님) |
| `parking_*`, `pet_*`, `corkage_*` | boolean, text | 주차 무료·반려동물·콜키지 여부와 안내 |
| `menu_updated_on` | date | 메뉴 갱신일 |
| `created_at`, `updated_at` | timestamptz NOT NULL, 기본 `now()` | 수집·재수집 시각 |

### `place_profiles`(새 테이블)

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `place_id` | bigint PK, FK `places` ON DELETE CASCADE | 장소(1:1) |
| `summary_text` | text NOT NULL | 장소 요약 문장 |
| `summary_vector` | vector(1024) NOT NULL | 요약 임베딩 |
| `features` | jsonb NOT NULL, 기본 `[]`, 배열 CHECK | 근거가 있는 특징만 `[{code, layer, like_count, dislike_count, is_label}]`, 카드 노출 순서로 정렬 |
| `analyzed_review_count` | integer NOT NULL, `>= 0` CHECK | 분석한 리뷰 수(화면의 리뷰 수 아님). `is_label` 비율의 분모(D-8) |
| `created_at`, `updated_at` | timestamptz NOT NULL, 기본 `now()` | 적재·04:00 배치 시각 |

- 리뷰나 임베딩 모델로 만든 값이라 `places`와 나눴다. 행이 없는 장소는 추천에서 빠진다(D-4).
- `is_label`은 PRD의 "장소의 태그 라벨" 여부다(PRD FR-08, 기술 설계 §3.2). true인 코드가 카드 특징(`PlaceCard.labels`) 후보다. 조건은 `like_count` 3 이상, `like_count` > `dislike_count`, `like_count ÷ analyzed_review_count`가 업종 그룹 평균 초과다. 마지막 조건은 40의 제안이고 팀 합의 전이다(place-profile spec 4단계).

### `place_personas`(새 테이블)

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `place_id` | bigint, FK `places` ON DELETE CASCADE | 장소 |
| `persona_id` | text | 장소 안 번호(`p1`, `p2` …). PK는 `(place_id, persona_id)` |
| `name`, `description`, `reason` | text NOT NULL | 이름(2~4단어), 설명 3문장, 이유 3문장. `reason`은 추천 이유로 화면에 나간다 |
| `liked` | boolean NOT NULL | 만족 페르소나 true, 불만 페르소나 false(40 출력의 `like`) |
| `review_ids` | bigint[] NOT NULL, 기본 `{}` | 근거 앱 리뷰 ID. 처음엔 비어 있다(D-7) |
| `vector` | vector(1024) NOT NULL | `name. description. reason` 임베딩 |
| `created_at`, `updated_at` | timestamptz NOT NULL, 기본 `now()` | 생성·갱신 시각 |

- 근거 리뷰가 3개 이상인 페르소나만 적재한다. 그래서 모든 행이 점수에 쓰인다(D-7).
- pgvector로 페르소나 단위 최대 유사도를 구하려고 행으로 나눈다(D-5).
- 벡터 인덱스는 아직 없다(D-11).

## 쓰기 시점

| 테이블 | 첫 생성 | 04:00 배치 |
|---|---|---|
| `user_preferences` | 온보딩 저장 때 원본과 39 결과(`tastes[].code`, `tastes[].vector`, `features`). `features`와 `vector`는 AI `/v1/taste/profile` 한 번으로 받는다(taste-profile spec "프로필 계산 API"). 호출이 실패하면 `features`는 `[]`, `vector`는 `null`로 두고 원본은 저장한다. 임베딩만 실패하면 `features`는 저장하고 `vector`만 `null`이다. 빈 `vector`는 `ai/scripts/backfill_taste_vectors.py`가 만든 SQL로 채운다 | 원본과 앱 리뷰로 `features`를 다시 계산한다. 비어 있는 `features`와 `vector`를 채운다. 원본은 바꾸지 않는다 |
| `places` | 정제한 수집 데이터로 적재. 재수집 때 `naver_place_id`로 찾아 고친다 | 바꾸지 않는다 |
| `place_profiles` | 릴리즈 전 네이버 리뷰로 분석해 적재 | 앱 리뷰 추가·삭제만큼 `like_count`, `dislike_count`, `analyzed_review_count`를 더하고 뺀 뒤, 업종 그룹 평균과 `is_label`을 전체 장소에 대해 다시 계산하고 다시 정렬한다 |
| `review_extractions` | 없음 | 새 리뷰와 고친 리뷰의 본문을 추출해 리뷰마다 쓴다(D-21) |
| `place_personas` | 릴리즈 전 네이버 리뷰로 만든 페르소나 중 근거 3개 이상만 적재 | 앱 리뷰 추가·삭제에 따라 `review_ids`와 문장을 갱신한다(방식은 Open questions) |

- 삭제된 앱 리뷰는 soft delete라 원문(`reviews.description`)이 남는다. 배치가 다시 읽어 그 몫을 뺀다. 앱 리뷰 본문 추출 결과는 리뷰마다 `review_extractions`에 저장한다(D-21).
- 리뷰를 쓰자마자 반영되는 경로는 없다. 다음 04:00 배치에 반영된다(D-9).
- `user_preferences`의 04:00 갱신은 `TasteRefreshBatch`가 한다. 대상, 실패 처리, 잠금은 D-15에, 본문 추출은 D-21에 있다. 비어 있는 `tastes[].vector`를 채우는 일은 아직 하지 않는다.

## Implementation anchors

| Anchor | Action | Decision |
|---|---|---|
| `be/src/main/resources/db/migration/V6__create_places_and_profiles.sql` | new | D-3~D-14 |
| `be/src/test/java/kr/co/fitdining/api/support/PostgresTestSupport.java#migrate` | `vector` 확장 생성 추가 | Assumption 5 |
| `be/src/test/java/kr/co/fitdining/api/auth/AuthServiceTests.java#migrate_withoutAuthEnvironment_startsAndCloses` | 새로 만드는 `fit_dev` DB에 `vector` 확장 생성 추가 | Assumption 5 |
| `be/src/test/java/kr/co/fitdining/api/place/ProfileSchemaTest.java#ProfileSchemaTest` | new | D-4, D-7, D-10 |

## Seams & test plan

`ProfileSchemaTest`가 앱 계정(`fit_dev_app`)으로 V6을 확인한다.
- 정상 장소·프로필·페르소나가 저장되고 `review_ids` 기본값이 빈 배열이다.
- 음식 종류 코드가 아닌 `food_type`(`FOOD_SPICY`)은 `ck_places_food_type`으로 거부된다.
- 같은 `naver_place_id`는 `uk_places_naver_place_id`로 거부된다.
- 장소를 지우면 프로필과 페르소나도 지워진다.
- `features` 없이 저장한 취향의 `features`는 `[]`이다.
- 코드표에 없는 `feature_code`의 이유 태그는 `fk_reason_tags_feature_code`로 거부된다.
- `feature_codes`에 23행이 있고 벡터는 모두 길이 1이다.

## Out of scope

- 갱신 알고리즘: 앱 리뷰를 취향(티켓 20)과 장소 특징·페르소나(담당 미정)에 반영하는 계산
- 04:00 배치 구현(취향 `features` 갱신은 S15P31A302-165, D-15), 39·40 결과를 DB에 쓰는 적재 코드, 첫 적재 실행
- 장소 사진·영업시간·메뉴 테이블(장소 수집 담당), 검색·점수 쿼리(41)
- `reviews.place_id`의 FK(D-13)
- 취향 수정 기능(PRD에 없음)

## Open questions

### 이번 변경으로 생기는 문제

1. **리뷰와 `places`가 연결되지 않는다.** `reviews.place_id`에는 FK가 없다(V4는 `CHECK (place_id > 0)`뿐). 리뷰 등록은 장소 존재를 Mock 검색 엔진(`places.json`, ID 1부터)으로 확인하고(`ReviewService.create`), V6 직후 `places`는 비어 있다. 첫 적재가 서비스 ID를 새로 매기면 Mock ID로 쓴 dev 리뷰는 엉뚱한 장소나 없는 장소를 가리킨다. FK를 더할 때 이 리뷰들 때문에 마이그레이션이 실패할 수 있다. 리뷰·장소 담당이 첫 적재와 함께 정한다(D-13). Mock ID를 그대로 살리려고 `OVERRIDING SYSTEM VALUE`로 넣으면 identity 시퀀스를 최댓값 뒤로 맞춰야 한다. 아니면 이후 자동 채번이 PK 중복으로 실패한다.
2. **`tastes` 원소에 키가 늘면 기존 코드가 읽지 못할 수 있다.** `UserPreferences`는 `tastes`를 `List<Preferences.TasteChip>`(`polarity`, `label`)으로 읽고, 앱 설정은 `spring.jackson.deserialization.fail-on-unknown-properties: true`다. 배치가 `code`, `vector`를 쓰면 엔티티 읽기와 `GET /api/v1/users/{userId}/preferences`가 실패하거나 응답에 `vector`가 섞일 수 있다. V6은 기존 데이터를 바꾸지 않아 지금은 문제가 없다. 배치 구현 전에 -58 담당과 정한다. → 해결(S15P31A302-166): 엔티티는 `tastes`를 DB용 `StoredTasteChip`(`polarity`, `label`, `code`, `vector`)으로 읽고, `GET /preferences`는 API용 `TasteChip`으로 바꿔 `vector`를 내보내지 않는다. `code`가 없으면 키를 빼지 않고 `null`로 쓴다.
3. ~~**`user_preferences.updated_at`의 뜻이 넓어진다.**~~ 취향 갱신 배치는 `updated_at`을 바꾸지 않기로 했다(D-15).
4. **`vector` 확장이 없는 DB에서는 V6이 실패한다.** 서버와 로컬은 인프라 스크립트가 만들고, 테스트는 `PostgresTestSupport`가 만든다. 다른 경로로 DB를 만들면 확장을 먼저 만들어야 한다.
5. **상세 화면의 사진·영업시간·메뉴를 둘 곳이 없다.** `PlaceDetailResponse`의 `photos`, `hours`, `menus`는 장소당 여러 행이라 별도 테이블이 필요하다. 그전까지 상세 화면은 Mock 데이터를 쓴다. 장소 수집 담당이 정한다.
6. **칩에 코드가 없다.** 해석 API(`POST /api/v1/onboarding/taste-analysis`, -59)는 `TasteChip(polarity, label)`만 돌려준다. `tastes[].code`를 채우려면 해석 결과의 `code`가 칩과 함께 저장 요청까지 와야 한다. -59·-58 담당과 정한다.
7. **코드표가 두 곳에 있다.** AI의 `FEATURES`와 DB의 `feature_codes`다. 코드나 문구를 바꾸면 벡터를 다시 만들어 새 마이그레이션으로 고쳐야 한다. 어긋남을 잡는 자동 검사는 없다.
8. **온보딩 태그 코드가 코드표와 다르다.** BE enum과 FE 선택지(`fe/src/domains/onboarding/model/answers.ts`, `fe/src/domains/auth/model/signup.ts`)는 `SPACIOUS`, `VALUE`, `CONVERSATION`, `SOLO`, `DATE`, `GATHERING`, `WORK_STUDY`를 쓰고, 코드표는 `SPACIOUS_SEATING`, `VALUE_FOR_MONEY`, `PURPOSE_*`를 쓴다. 통일하려면 공개 API(-58 가입·조회), FE, 저장된 `user_preferences`를 함께 바꿔야 한다. 그전까지는 AI 경계에서 대응표로 바꾼다.
9. **장소 검색 D-36과 다르다.** D-36은 pgvector를 임시로 두고 OpenSearch가 벡터를 최종 관리한다고 정했다. 이 spec은 1차 MVP에서 pgvector만 쓴다(D-2). 검색 담당과 D-36을 정리한다.

### 다른 담당과 맞출 것

| 담당 | 항목 |
|---|---|
| 40 | 반영함: 특징 키 `is_label`, 출력의 `analyzed_review_count`, `report.json`의 근거 3개 이상 페르소나가 없는 장소 수, `place_id`가 네이버 ID라는 주석과 스펙. 남은 일은 적재 코드 몫이다. `review_ids`가 3개 미만인 페르소나는 넣지 않고, 네이버 리뷰 ID인 `review_ids`는 `{}`로 바꾸고, 출력의 `place_id`(네이버 ID)로 `places.naver_place_id`를 찾아 서비스 ID로 잇고, `like`를 `liked`로 옮긴다 |
| -58·-59(이현우) | `tastes` 원소의 `code`, `vector` 추가와 위 문제 2·3·6. 온보딩 태그 코드 통일(문제 8) |
| 41 | 벡터 거리 연산자를 정하면 벡터 인덱스를 만든다(D-11). 점수에 쓸 페르소나가 없는 장소의 처리. 코드 문구 벡터는 `feature_codes.vector`에서 읽는다 |
| 장소 수집(강기호) | `places` 수집 컬럼은 초안대로 V6에 합쳤다. 사진·영업시간·메뉴 테이블(문제 5). 정제 CSV에 `food_type`이 없으면 적재 때 `rules.food_type`으로 채운다 |
| 갱신 로직(티켓 20, 장소 쪽 미정) | 앱 리뷰 추가·삭제를 `features`와 페르소나에 반영하는 방식. 새 리뷰를 어느 페르소나에 붙일지, 앱 리뷰만으로 새 페르소나를 만들지(만든다면 근거 3개 판단에 필요한 컬럼 추가) |
| 리뷰 | `reason_tags.feature_code`에 FK가 생겼다. 시드에 새 태그를 넣을 때 `feature_codes`에 있는 코드만 쓴다 |
| 팀 | `is_label`의 업종 그룹 평균 조건 채택 여부. 빠지면 `analyzed_review_count`를 지운다(D-8) |
