# profile-storage decisions

Glossary: none · ADRs: none

저장 설계에서 정한 결정만 둔다. 다른 담당이나 팀이 정해야 하는 항목은 [spec.md](spec.md)의 Open questions에 있다.

## D-1 범위
- Status: settled
- Decision: Jira S15P31A302-103의 저장 구조(테이블, 컬럼, 키)와 쓰기 시점을 다룬다. 39·40 결과를 그대로 담고, 갱신 알고리즘과 배치·적재 구현은 다른 일감이다(2026-10-28).
- Rejected: 갱신 알고리즘까지 정하기 → 취향 보정은 티켓 20이고 장소 갱신은 담당이 아직 없다.

## D-2 pgvector만 사용
- Status: settled
- Decision: 1차 MVP는 Postgres pgvector에 벡터를 저장하고 검색한다. 벡터는 저장할 때 한 번 계산하고, 검색할 때마다 계산하지 않는다.
- Rejected: OpenSearch 함께 사용(장소 검색 D-36) → 1차 MVP 범위에서 뺐다. 검색마다 직접 입력 칩을 임베딩 → 바뀌지 않는 값을 매번 계산하는 비용이다.

## D-3 사용자 취향은 `user_preferences` 한 테이블
- Status: settled
- Decision: 온보딩 원본(-58)과 취향 프로필 결과를 같은 행에 둔다. 칩마다 `code`, `vector`를 `tastes` 원소에 더하고, 결과는 `features` 컬럼에 둔다. 원본은 온보딩 때만 쓴다.
- Rejected: 취향 프로필·칩 벡터·근거를 별도 테이블 3개로 → 사용자당 한 번에 읽고 쓰는 값이라 나눌 이유가 없다. 원본 없이 `features`만 → 가중치 상한과 같은 장소 최신 1건 규칙 때문에 다시 계산할 수 없고, 코드 없는 칩의 벡터도 검색에 쓴다. `priorities`, `purposes`를 별도 테이블이나 enum 타입으로 → 기존 V2 구조이고 값이 적어 얻는 것이 없다.

## D-4 수집 값은 `places`, 분석 결과는 `place_profiles`
- Status: settled
- Decision: `places`에는 수집한 값과 그 값에서 규칙으로 바로 나오는 분류(`category_group`, `food_type`)를 둔다. 수집 담당의 초안 컬럼을 V6에 합쳤다. 리뷰나 임베딩 모델로 만든 값(`summary_text`, `summary_vector`, `features`, `analyzed_review_count`)은 `places`와 1:1인 `place_profiles`에 NOT NULL로 둔다. 장소는 수집 데이터만으로 먼저 넣을 수 있고, 프로필 행이 없는 장소는 추천에서 빠진다. `summary_text`는 수집 값으로 만들지만 `summary_vector`의 입력이라 함께 둔다.
- Rejected: 분석 결과를 `places` 컬럼으로 → 분석 컬럼이 NOT NULL이라 수집 데이터를 먼저 넣을 수 없고, 수집과 04:00 배치가 같은 행의 `updated_at`을 바꿔 무엇이 바뀌었는지 알 수 없다. 화면에 쓰지 않는 수집 값을 `place_metadata`로 분리 → 화면에 쓰는 값은 계속 바뀌어 컬럼을 테이블 사이로 옮기는 마이그레이션이 생기고, 쓰는 쪽과 갱신 주기가 `places`와 같다. 분석 컬럼 NULL 허용 → 분석 없는 장소를 추천 쿼리마다 걸러야 한다.

## D-5 페르소나는 행으로 분리
- Status: settled
- Decision: 페르소나를 `place_personas`의 행으로 둔다. PK는 `(place_id, persona_id)`이고 `persona_id`는 40 출력의 `p1` 같은 문자열 그대로다.
- Rejected: `places`에 jsonb 배열로 → pgvector가 페르소나 벡터를 행 단위로 비교할 수 없다(41은 장소별 최대 유사도를 쓴다).

## D-6 네이버 데이터와 중간 결과는 저장하지 않음
- Status: settled
- Decision: 네이버 리뷰 원문, 네이버 리뷰 ID, 40의 리뷰별 추출 결과(`evidence`)를 저장하지 않는다. 첫 생성 뒤 네이버 리뷰는 분석에 쓰지 않는다. 앱 리뷰의 추출 결과도 저장하지 않고, 삭제된 리뷰는 soft delete로 남은 원문을 다시 읽어 뺀다.
- Rejected: `evidence`를 행으로 보관(`quote` 포함 또는 제외) → 네이버 쪽은 다시 쓸 일이 없고, 앱 리뷰는 원문이 남는다. 외부 리뷰 원문의 이용 범위도 정해지지 않았다(PRD OQ-20).

## D-7 근거 3개 이상인 페르소나만 적재, `review_ids`는 앱 리뷰만
- Status: settled
- Decision: 첫 적재 때 네이버 근거 리뷰가 3개 이상인 페르소나만 넣는다. 네이버 근거는 지워지지 않으므로 이 페르소나들은 계속 점수에 쓰인다. `review_ids`는 앱 리뷰 ID(`bigint[]`)만 담고 처음엔 비어 있다. 앱 리뷰 삭제 때 고칠 페르소나를 찾는 데 쓴다. 네이버에서 나온 근거는 보여 주지 않는다.
- Rejected: 근거 개수 컬럼(`review_count`) → 3개 미만을 적재하지 않으면 필요 없다. 네이버 리뷰 ID를 `text[]`로 → 가리킬 원본이 없다. 3개 미만도 적재 → 점수에 쓰지 않아 남길 이유가 없다.

## D-8 `place_profiles.analyzed_review_count`
- Status: settled
- Decision: 분석한 리뷰 수를 둔다. 첫 값은 네이버 리뷰 수이고 이후 앱 리뷰만큼 더하고 뺀다. `is_label`의 업종 그룹 평균 조건의 분모이며, 네이버 리뷰를 저장하지 않아 다른 곳에서 되살릴 수 없다. 화면의 리뷰 수와 헷갈리지 않게 `review_count` 대신 이 이름을 쓴다. 업종 그룹 평균 조건이 팀 합의에서 빠지면 지운다.
- Rejected: 배치 때마다 계산 → 네이버 리뷰 수는 첫 적재 뒤 알 수 없다.

## D-9 갱신은 04:00 배치에서만
- Status: settled
- Decision: 첫 생성(온보딩 저장, 릴리즈 전 적재) 이후의 갱신은 모두 04:00 배치가 한다. 배치는 업종 그룹 평균이 바뀌므로 `is_label`을 전체 장소에 대해 다시 계산한다. 온보딩 때 39 호출이 실패하면 원본만 저장하고 `features`를 `[]`로 두며, 배치가 비어 있는 `features`와 `vector`를 채운다.
- Rejected: 리뷰 작성 때 즉시 반영 → 갱신 경로가 둘이 된다. 39 실패 시 온보딩 실패 → AI 장애가 온보딩 장애가 된다.

## D-10 이름과 제약
- Status: settled
- Decision: 새 테이블은 V4~V5 방식을 따른다. PK는 `<대상>_id`, 제약은 `ck_`/`fk_`/`uk_`, 인덱스는 `idx_`다. jsonb 키는 39·40 출력 이름(snake_case)을 그대로 쓴다. 좋아함을 나타내는 이름은 지금대로 둔다(`tastes[].polarity`, jsonb의 `like`, 예약어를 피한 `place_personas.liked`). 장소 특징의 태그 라벨 여부만 `label`에서 `is_label`로 바꾼다. 저장소에서 `label`은 화면 문구(`reason_tags.label`, `TasteChip.label`)를 뜻하기 때문이다. `features`(두 테이블), `vector`, `summary_vector`는 그대로 둔다. 장소 삭제 시 프로필과 페르소나는 함께 지운다(`ON DELETE CASCADE`). CHECK는 `features` 배열 여부, `analyzed_review_count >= 0`, `food_type`·`category_group`·`station`의 값 목록, 좌표 범위, 빈 `naver_place_id` 금지다.
- Rejected: `polarity` 또는 boolean으로 모두 통일 → 공개 API(`TasteChip.polarity`)나 39·40 출력을 바꿔야 한다. `isLabel`(camelCase) → jsonb 키가 모두 snake_case다. V1~V3 방식 이름 → 최신 마이그레이션과 다르다.

## D-11 벡터 인덱스는 나중에
- Status: settled
- Decision: 벡터 인덱스(HNSW)를 만들지 않는다. 41이 거리 연산자를 정하면 그에 맞는 연산자 클래스로 만든다. 장소 300곳, 페르소나 2,100행 이하라 전체를 읽어도 된다.
- Rejected: `vector_cosine_ops`로 미리 생성 → 41의 쿼리 연산자와 다르면 쓰이지 않는다.

## D-12 장소 ID는 서비스 자체 ID, 네이버 장소 ID는 유니크 컬럼
- Status: settled
- Decision: `places.place_id`는 서비스가 매기는 `bigint` identity다. 네이버 장소 ID는 `naver_place_id`(UNIQUE)로 둔다. 적재를 다시 실행할 때 중복을 막고(`ON CONFLICT`), 재수집 때 고칠 행을 찾고, 40 출력(네이버 ID가 `place_id`)을 장소와 잇는 데 쓴다.
- Rejected: 네이버 장소 ID를 PK로 → 서비스 API는 자체 ID를 쓴다. 네이버 장소 ID를 저장하지 않음 → 적재 재실행과 재수집 때 같은 장소를 찾을 키가 없다.

## D-13 `reviews.place_id` FK는 이번에 더하지 않음
- Status: settled
- Decision: V6은 `reviews.place_id`에 FK를 더하지 않는다. 리뷰 등록이 Mock 검색 엔진으로 장소를 확인하고 V6 직후 `places`가 비어 있어, FK를 더하면 dev 리뷰 작성과 리뷰 테스트가 실패한다. 이 문제를 고치는 일은 이 일감 밖이라 spec의 Open questions에 남긴다.
- Rejected: V6에서 FK 추가(`NOT VALID` 포함) → 첫 적재 전까지 새 리뷰 INSERT가 모두 실패하고, 리뷰 기능과 테스트까지 범위가 넓어진다.

## D-14 특징 코드표 `feature_codes`
- Status: settled
- Decision: 특징 코드표를 `feature_codes`에 둔다. PK는 `code`다. 코드, 층, 설명 문구, 문구 벡터를 담고 V6이 23행을 넣는다. 벡터는 39의 `encode_queries`로 미리 만들어 SQL에 넣는다(모델과 리비전은 컬럼 주석). `reason_tags.feature_code`는 이 테이블을 FK로 가리킨다. `places.food_type`은 FK 대신 지금의 CHECK를 둔다. FK로는 `FOOD_SPICY`나 `QUIET`도 통과해 음식 종류 5개로 좁힐 수 없다.
- Rejected: 별도 `code_id` PK → 코드를 쓰는 곳(`reason_tags`, jsonb)이 모두 코드 문자열이라 id를 둘 곳이 없다. `code_vectors.json` 파일로 → 41이 페르소나 벡터와 DB 안에서 바로 비교할 수 없다. 벡터를 NULL로 두고 적재 작업이 채움 → 코드 23개뿐이라 미리 만들어 넣는 편이 단순하다. jsonb 안의 코드와 `priorities`·`purposes` 배열에 FK → 배열과 jsonb에는 FK를 걸 수 없고, 걸려면 행으로 쪼개야 한다.

## D-15 04:00 취향 갱신 배치
- Status: settled
- Decision: Jira S15P31A302-165. BE 앱 안의 스케줄러가 매일 04:00 KST에 회원 취향을 다시 계산한다. 대상은 탈퇴하지 않은 회원 중 `user_preferences` 행이 있고, `features`가 비었거나 리뷰 행(지운 리뷰 포함)이 하나라도 있는 회원이다. 지운 리뷰만 남은 회원도 넣어야 삭제가 반영된다. 배치는 회원마다 저장된 원본과 지우지 않은 리뷰의 이유 태그를 AI 취향 갱신 API(`POST /v1/taste/refresh`, S15P31A302-164)로 보내고 받은 `features`만 쓴다. 태그 코드는 `ReasonTagRule.userFeatureCode`로 사용자 쪽 코드로 바꾼다(리뷰 D-36). 매번 지금 남아 있는 근거 전체로 계산하므로 상태를 두지 않는다. AI 호출이 실패한 회원은 기존 값을 두고 다음 날 다시 계산한다. `updated_at`은 바꾸지 않는다. 사용자가 답을 바꾼 시각이고 `GET /preferences`에 `features`가 없기 때문이다(spec 문제 3). Blue/Green 두 색이 함께 깨어나도 한 번만 돌도록 ShedLock(`shedlock` 테이블, DB 시각)으로 잠근다(인프라 BE 계약 #19). `lockAtLeastFor` 30분이라 먼저 끝난 색 뒤에 깨어난 색도 건너뛴다. `BATCH_ENABLED`(기본 `false`)가 켜져 있을 때만 배치 빈이 생긴다.
- Rejected: Postgres advisory lock → 의존성과 테이블이 없지만, 먼저 끝난 색이 잠금을 풀면 늦게 깨어난 색이 한 번 더 돈다. 호스트 cron이나 CI 스케줄이 관리 엔드포인트를 부름 → 인증된 내부 엔드포인트와 인프라 설정이 함께 필요하다. 바뀐 리뷰가 있는 회원만 대상 → 마지막 실행 시각을 따로 저장해야 한다. `user_preferences` 행이 없는 회원(온보딩 답 없이 가입)에게 행을 만들어 채움 → `GET /preferences`의 뜻이 바뀐다. 이 회원은 리뷰를 써도 `features`가 생기지 않는다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/onboarding/TasteRefreshBatch.java#TasteRefreshBatch.run` (new) · `be/src/main/java/kr/co/fitdining/api/config/SchedulerLockConfiguration.java#SchedulerLockConfiguration` (new) · `be/src/main/resources/db/migration/V20__create_shedlock.sql` (new) · `be/src/main/java/kr/co/fitdining/api/review/tag/ReasonTagRule.java#ReasonTagRule.userFeatureCode` (new) · `be/src/main/java/kr/co/fitdining/api/onboarding/AiTasteClient.java#AiTasteClient.refresh` (new)
