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

### `user_preferences`(기존 V2에 컬럼 추가)

| 컬럼 | 타입 | 내용 | 쓰는 쪽 |
|---|---|---|---|
| `mood`, `priorities`, `purposes` | 기존 | 온보딩 원본 | 온보딩(-58). 바꾸지 않는다 |
| `tastes` | jsonb(기존) | 온보딩 원본 칩. 칩 하나는 39가 직접 입력을 해석한 항목 하나다(taste-profile spec 1단계 "칩 표시"). 원소에 `code`, `vector`가 더해진다: `[{polarity, label, code, vector}]`. `code`는 코드표 코드 또는 null, 코드 없는 칩의 `label`은 39의 `positive_text`이고, `vector`는 코드 없는 LIKE 칩만 | `polarity`, `label`은 온보딩. `code`, `vector`는 온보딩 때 39 |
| `features` | jsonb, NOT NULL, 기본 `[]`, 배열 CHECK | 취향 프로필 결과 `[{code, layer, like, weight}]`, `weight`는 1~3 | 온보딩 때 39, 이후 04:00 배치 |

원본을 남기는 이유: `weight`는 min(긍정 − 부정, 3)이고 같은 장소는 최신 평가 하나만 센다(taste-profile spec 4단계). 상한에서 정보가 잘려 `features`만으로는 리뷰를 빼거나 더해 다시 계산할 수 없다. 코드표에 없는 칩의 `vector`도 검색에 쓴다(D-3).

### `places`(새 테이블, 최소 구성)

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `place_id` | bigint identity PK | 서비스 자체 ID. 네이버 장소 ID는 저장하지 않는다(D-12) |
| `name` | text NOT NULL | 장소 이름 |
| `category_group` | text NOT NULL, CHECK | `RESTAURANT` \| `CAFE` \| `BAR`(BE `PlaceSummary.CategoryGroup`). `is_label` 업종 그룹 평균의 단위 |
| `food_type` | text, CHECK | `FOOD_KOREAN` \| `FOOD_CHINESE` \| `FOOD_JAPANESE` \| `FOOD_WESTERN` \| `FOOD_ASIAN` \| null(카페·술집·뷔페·처음 보는 코드) |
| `summary_text` | text NOT NULL | 장소 요약 문장 |
| `summary_vector` | vector(1024) NOT NULL | 요약 임베딩 |
| `features` | jsonb NOT NULL, 기본 `[]`, 배열 CHECK | 근거가 있는 특징만 `[{code, layer, like_count, dislike_count, is_label}]`, 카드 노출 순서로 정렬 |
| `analyzed_review_count` | integer NOT NULL, `>= 0` CHECK | 분석한 리뷰 수(화면의 리뷰 수 아님). `is_label` 비율의 분모(D-8) |
| `created_at`, `updated_at` | timestamptz NOT NULL, 기본 `now()` | 적재·갱신 시각 |

- 분석 컬럼(`food_type` 제외)은 NOT NULL이다. 릴리즈 전에 모두 채워서 적재한다(D-4).
- 주소, 좌표, 영업시간 같은 나머지 수집 컬럼은 장소 수집 담당이 이후 마이그레이션으로 더한다.
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
| `user_preferences` | 온보딩 저장 때 원본과 39 결과(`tastes[].code`, `tastes[].vector`, `features`). 39 호출이 실패하면 원본만 저장하고 `features`는 `[]` | 원본과 앱 리뷰로 `features`를 다시 계산한다. 비어 있는 `features`와 `vector`를 채운다. 원본은 바꾸지 않는다 |
| `places` | 릴리즈 전 네이버 리뷰로 분석해 적재 | 앱 리뷰 추가·삭제만큼 `like_count`, `dislike_count`, `analyzed_review_count`를 더하고 뺀 뒤, 업종 그룹 평균과 `is_label`을 전체 장소에 대해 다시 계산하고 다시 정렬한다 |
| `place_personas` | 릴리즈 전 네이버 리뷰로 만든 페르소나 중 근거 3개 이상만 적재 | 앱 리뷰 추가·삭제에 따라 `review_ids`와 문장을 갱신한다(방식은 Open questions) |

- 삭제된 앱 리뷰는 soft delete라 원문(`reviews.description`)이 남는다. 배치가 다시 읽어 그 몫을 뺀다. 리뷰별 추출 결과는 저장하지 않는다(D-6).
- 리뷰를 쓰자마자 반영되는 경로는 없다. 다음 04:00 배치에 반영된다(D-9).

## Implementation anchors

| Anchor | Action | Decision |
|---|---|---|
| `be/src/main/resources/db/migration/V6__create_places_and_profiles.sql` | new | D-3~D-13 |
| `be/src/test/java/kr/co/fitdining/api/support/PostgresTestSupport.java#migrate` | `vector` 확장 생성 추가 | Assumption 5 |
| `be/src/test/java/kr/co/fitdining/api/auth/AuthServiceTests.java#migrate_withoutAuthEnvironment_startsAndCloses` | 새로 만드는 `fit_dev` DB에 `vector` 확장 생성 추가 | Assumption 5 |
| `be/src/test/java/kr/co/fitdining/api/place/ProfileSchemaTest.java#ProfileSchemaTest` | new | D-4, D-7, D-10 |

## Seams & test plan

`ProfileSchemaTest`가 앱 계정(`fit_dev_app`)으로 V6을 확인한다.
- 정상 장소·페르소나가 저장되고 `review_ids` 기본값이 빈 배열이다.
- 음식 종류 코드가 아닌 `food_type`(`FOOD_SPICY`)은 `ck_places_food_type`으로 거부된다.
- 장소를 지우면 페르소나도 지워진다.
- `features` 없이 저장한 취향의 `features`는 `[]`이다.

## Out of scope

- 갱신 알고리즘: 앱 리뷰를 취향(티켓 20)과 장소 특징·페르소나(담당 미정)에 반영하는 계산
- 04:00 배치 구현, 39·40 결과를 DB에 쓰는 적재 코드, 첫 적재 실행
- `places`의 수집 컬럼(장소 수집 담당), 검색·점수 쿼리(41)
- `reviews.place_id`의 FK(D-13)
- 취향 수정 기능(PRD에 없음)

## Open questions

### 이번 변경으로 생기는 문제

1. **리뷰와 `places`가 연결되지 않는다.** `reviews.place_id`에는 FK가 없다(V4는 `CHECK (place_id > 0)`뿐). 리뷰 등록은 장소 존재를 Mock 검색 엔진(`places.json`, ID 1부터)으로 확인하고(`ReviewService.create`), V6 직후 `places`는 비어 있다. 첫 적재가 서비스 ID를 새로 매기면 Mock ID로 쓴 dev 리뷰는 엉뚱한 장소나 없는 장소를 가리킨다. FK를 더할 때 이 리뷰들 때문에 마이그레이션이 실패할 수 있다. 리뷰·장소 담당이 첫 적재와 함께 정한다(D-13). Mock ID를 그대로 살리려고 `OVERRIDING SYSTEM VALUE`로 넣으면 identity 시퀀스를 최댓값 뒤로 맞춰야 한다. 아니면 이후 자동 채번이 PK 중복으로 실패한다.
2. **`tastes` 원소에 키가 늘면 기존 코드가 읽지 못할 수 있다.** `UserPreferences`는 `tastes`를 `List<Preferences.TasteChip>`(`polarity`, `label`)으로 읽고, 앱 설정은 `spring.jackson.deserialization.fail-on-unknown-properties: true`다. 배치가 `code`, `vector`를 쓰면 엔티티 읽기와 `GET /api/v1/users/{userId}/preferences`가 실패하거나 응답에 `vector`가 섞일 수 있다. V6은 기존 데이터를 바꾸지 않아 지금은 문제가 없다. 배치 구현 전에 -58 담당과 정한다.
3. **`user_preferences.updated_at`의 뜻이 넓어진다.** 배치가 `features`를 갱신할 때도 바뀐다. `GET /preferences` 응답의 `updatedAt`이 사용자 동작 없이 바뀐다. -58 담당과 정한다.
4. **`vector` 확장이 없는 DB에서는 V6이 실패한다.** 서버와 로컬은 인프라 스크립트가 만들고, 테스트는 `PostgresTestSupport`가 만든다. 다른 경로로 DB를 만들면 확장을 먼저 만들어야 한다.
5. **`places`에 분석 컬럼 없이 행을 넣을 수 없다.** 분석 컬럼이 NOT NULL이라 수집과 분석 결과를 함께 적재해야 한다. 수집 담당과 적재 순서를 맞춘다.
6. **칩에 코드가 없다.** 해석 API(`POST /api/v1/onboarding/taste-analysis`, -59)는 `TasteChip(polarity, label)`만 돌려준다. `tastes[].code`를 채우려면 해석 결과의 `code`가 칩과 함께 저장 요청까지 와야 한다. -59·-58 담당과 정한다.
7. **해석 대기를 둘 곳이 없다.** 39는 해석에 실패한 직접 입력을 `like: null`로 보관하고 다음 배치에서 다시 해석한다(taste-profile spec 1단계). 지금 온보딩은 해석이 실패하면 503을 돌려주고 아무것도 저장하지 않아, `tastes`에는 해석 대기 상태가 없다. 대기를 살릴지(살린다면 `tastes`에 원문과 상태를 어떻게 둘지) 39·-59 담당과 정한다.
8. **코드 문구 벡터(`code_vectors.json`)의 위치가 정해지지 않았다.** 사용자와 무관한 고정 값이라 이 설계의 테이블에 넣지 않았다. 41이 파일로 읽을지 테이블로 둘지 정한다.
9. **장소 검색 D-36과 다르다.** D-36은 pgvector를 임시로 두고 OpenSearch가 벡터를 최종 관리한다고 정했다. 이 spec은 1차 MVP에서 pgvector만 쓴다(D-2). 검색 담당과 D-36을 정리한다.

### 다른 담당과 맞출 것

| 담당 | 항목 |
|---|---|
| 40 | 반영함: 특징 키 `is_label`, 출력의 `analyzed_review_count`, `report.json`의 근거 3개 이상 페르소나가 없는 장소 수, `place_id`가 네이버 ID라는 주석과 스펙. 남은 일은 적재 코드 몫이다. `review_ids`가 3개 미만인 페르소나는 넣지 않고, 네이버 리뷰 ID인 `review_ids`는 `{}`로 바꾸고, `place_id`를 서비스 ID로, `group`(식당·카페·술집)을 `category_group`으로, `like`를 `liked`로 옮긴다 |
| 39·-58·-59 | `tastes` 원소의 `code`, `vector` 추가와 위 문제 2·3·6·7. BE enum과 코드표 이름이 다르다(`SPACIOUS`↔`SPACIOUS_SEATING`, `VALUE`↔`VALUE_FOR_MONEY`, `CONVERSATION`·`SOLO`·`DATE`·`GATHERING`·`WORK_STUDY`↔`PURPOSE_*`). AI 경계에서 대응표로 바꾼다 |
| 41 | 벡터 거리 연산자를 정하면 벡터 인덱스를 만든다(D-11). 점수에 쓸 페르소나가 없는 장소의 처리 |
| 장소 수집 | `places`의 나머지 컬럼, `category_group` 이름, 적재 순서(문제 5) |
| 갱신 로직(티켓 20, 장소 쪽 미정) | 앱 리뷰 추가·삭제를 `features`와 페르소나에 반영하는 방식. 새 리뷰를 어느 페르소나에 붙일지, 앱 리뷰만으로 새 페르소나를 만들지(만든다면 근거 3개 판단에 필요한 컬럼 추가) |
| 팀 | `is_label`의 업종 그룹 평균 조건 채택 여부. 빠지면 `analyzed_review_count`를 지운다(D-8) |
