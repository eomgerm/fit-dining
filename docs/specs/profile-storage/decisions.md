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
- Status: settled. 앱 리뷰 추출 결과는 D-21로 바뀌었다(저장한다)
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
- Status: settled. 대상 조건의 "고친 리뷰는 대상이 아니다"는 D-21로, "아직 갱신한 적 없이 `features`가 빈 회원"은 D-22로("갱신한 적 없는 회원" 모두) 바뀌었다
- Decision: Jira S15P31A302-165. BE 앱 안의 스케줄러가 매일 04:00 KST에 회원 취향을 다시 계산한다. 대상은 탈퇴하지 않은 회원 중 `user_preferences` 행이 있고, 마지막 갱신(`features_refreshed_at`, V21) 이후에 리뷰를 쓰거나 지운 회원이다(`greatest(created_at, deleted_at)`로 본다). 아직 갱신한 적 없이 `features`가 빈 회원(온보딩 때 AI 호출 실패)도 넣는다. 리뷰는 본문과 사진만 고칠 수 있어(리뷰 D-6) 고친 리뷰는 대상이 아니다. 배치는 대상 회원마다 저장된 원본과 지우지 않은 리뷰 전체의 이유 태그를 AI 취향 갱신 API(`POST /v1/taste/refresh`, S15P31A302-164)로 보내고 받은 `features`만 쓴다. AI가 상태 없이 같은 장소 최신 1건과 소음 축 전환(서로 다른 장소 3곳)을 전체 근거로 세므로 새 리뷰만 보내지 않는다. 태그 코드는 `ReasonTagRule.userFeatureCode`로 사용자 쪽 코드로 바꾼다(리뷰 D-36). 성공하면 `features_refreshed_at`을 실행 시작 5분 전(DB 시각)으로 쓴다. 실행 중에 쓴 리뷰와 먼저 시작해 늦게 커밋된 리뷰는 다음 실행에 다시 잡힌다. AI 호출이 실패한 회원은 기존 값과 시각을 그대로 두어 다음 날 다시 대상이 된다. `updated_at`은 바꾸지 않는다. 사용자가 답을 바꾼 시각이고 `GET /preferences`에 `features`가 없기 때문이다(spec 문제 3). Blue/Green 두 색이 함께 깨어나도 한 번만 돌도록 ShedLock(`shedlock` 테이블, DB 시각)으로 잠근다(인프라 BE 계약 #19). `lockAtLeastFor` 30분이라 먼저 끝난 색 뒤에 깨어난 색도 건너뛴다. `BATCH_ENABLED`(기본 `false`)가 켜져 있을 때만 배치 빈이 생긴다.
- Rejected: Postgres advisory lock → 의존성과 테이블이 없지만, 먼저 끝난 색이 잠금을 풀면 늦게 깨어난 색이 한 번 더 돈다. 호스트 cron이나 CI 스케줄이 관리 엔드포인트를 부름 → 인증된 내부 엔드포인트와 인프라 설정이 함께 필요하다. 리뷰가 있는 회원 전원을 매일 다시 계산 → 바뀌지 않은 회원도 매일 AI를 불러 결과가 같다. 컬럼 없이 직전 24시간에 쓰거나 지운 리뷰만 봄 → AI가 실패한 회원이나 배치를 못 돈 날의 변경이 영영 반영되지 않는다. `user_preferences` 행이 없는 회원(온보딩 답 없이 가입)에게 행을 만들어 채움 → `GET /preferences`의 뜻이 바뀐다. 이 회원은 리뷰를 써도 `features`가 생기지 않는다.
- Anchors: `be/src/main/java/kr/co/fitdining/api/onboarding/TasteRefreshBatch.java#TasteRefreshBatch.run` (new) · `be/src/main/java/kr/co/fitdining/api/config/SchedulerLockConfiguration.java#SchedulerLockConfiguration` (new) · `be/src/main/resources/db/migration/V20__create_shedlock.sql` (new) · `be/src/main/resources/db/migration/V21__add_features_refreshed_at.sql` (new) · `be/src/main/java/kr/co/fitdining/api/review/tag/ReasonTagRule.java#ReasonTagRule.userFeatureCode` (new) · `be/src/main/java/kr/co/fitdining/api/onboarding/AiTasteClient.java#AiTasteClient.refresh` (new)

## D-16 `places.station`을 가장 가까운 역 코드로 넓히고 NULL을 허용한다
- Status: settled
- Decision: Jira S15P31A302-179. `places.station`은 "수집 지역 역 3개"가 아니라 "장소에서 가장 가까운 역 코드"다. 서울의 `GANGNAM`, `YEOKSAM`, `SEOLLEUNG`에 대전 9개(`YUSEONG_ONCHEON`, `GUAM`, `NOEUN`, `BANSEOK`, `DAEJEON_WORLDCUP_STADIUM`, `JIJOK`, `GAPCHEON`, `HYEONCHUNGWON`, `WOLPYEONG`), 구미 2개(`GUMI`, `SAGOK`), 부산 8개(`JEONPO`, `SEOMYEON`, `GEUMNYEONSAN`, `SASANG`, `HADAN`, `GWANGAN`, `NAMPO`, `DONGNAE`)를 더해 22개다. 서울의 나머지 역은 서울 상세 수집이 끝난 뒤 같은 방식으로 더한다(강남권 12개는 D-17이 먼저 더했다). 가까운 역은 네이버 상세의 `subwayStations`에서 도보 거리가 가장 짧은 역이고, 네이버가 약 1km 안만 알려 주므로 없으면 NULL이다(2026-11-06 수집분에서 하남산단은 전부, 구미와 부산은 대부분 NULL, 대전은 절반 가까이 NULL).
  코드 이름은 역 이름의 로마자(국어의 로마자 표기법)를 대문자와 `_`로 쓴다. 같은 이름이 다른 지역에 있으면 지역을 붙인다(대전 월드컵경기장역은 `DAEJEON_WORLDCUP_STADIUM`이고 서울 6호선은 나중에 `WORLDCUP_STADIUM`). 호선마다 역 ID가 다른 같은 역(부산 서면역 1호선과 2호선)은 코드 하나다.
  구현은 V22가 `ck_places_station`을 22개 코드로 다시 만들고 NOT NULL을 푼다. BE `Station`은 "역"을 뺀 짧은 이름(`shortName`)을 갖고 키워드 검색이 위치 이름으로 쓰며, 역이 null이면 JSON에서 생략하고 위치 이름은 비운다. AI는 `STATION_NAMES`와 요청 스키마를 늘리고, 규칙 해석은 일상말이나 메뉴 이름과 겹치는 "구미", "서면", "사상", "하단", "동래"를 "구미역"처럼 역을 붙여 말했을 때만 역으로 읽는다("구미가 당기는", "동래파전"). FE는 `station?: Station`이다. 네 곳의 목록과 순서가 같은지 `ai/tests/match/test_station_contract.py`가 견준다.
  AI의 "준비 중인 지역" 안내는 `SERVED_STATIONS`(지금은 강남, 역삼, 선릉, 유성온천, 구미. 유성온천과 구미는 S15P31A302-194가 더했다)의 역 근처를 제안한다. 코드를 넓혔다고 제안이 22개 역으로 늘지 않게 따로 둔 목록이고, 다른 지역의 장소를 적재할 때 그 역을 여기에 더한다. S15P31A302-195부터는 이 목록이 도시표(`CITIES`: 서울, 대전, 구미의 이름 말, 대표 역, 중심 좌표, 반경)에서 나오고, 안내는 요청문의 도시 이름 또는 지도 영역 중심이 든 도시의 대표 역만 제안한다(도시를 모르면 전부). 새 도시는 도시표에 한 줄을 더한다.
  배포 순서는 BE, DB 마이그레이션, 장소 적재, AI, FE다. enum에 없는 코드가 DB에 먼저 들어가면 `Station.valueOf`가 예외를 내서 주변 카드 전체를 읽지 못한다.
- Rejected: 권역 코드(`GUMI_AREA` 등) → 역 코드를 원했다. 역 ID로 만든 코드(`S239`) → 읽기 어렵고 영어 역 이름을 쓰기로 했다. 서울 역 409개를 지금 enum에 넣기 → 서울 상세 수집이 32%라 역 목록이 아직 늘어난다. enum 대신 `regions` 테이블 → 코드 변경 없이 지역을 늘릴 수 있지만 이번에는 enum을 유지하기로 했다(지역이 크게 늘면 다시 본다).
- Anchors: `be/src/main/resources/db/migration/V22__allow_null_place_station_and_add_region_stations.sql` (new) · `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSummary.java#PlaceSummary.Station` · `be/src/main/java/kr/co/fitdining/api/place/catalog/JdbcPlaceCatalog.java#JdbcPlaceCatalog.station` (new) · `ai/src/fit_ai/match/conditions.py#STATION_NAMES` · `ai/src/fit_ai/match/interpretation/request.py#STATION_WORDS` · `ai/server/schemas.py#Station` · `fe/src/domains/place/model/place-types.ts#Station` · `ai/tests/match/test_station_contract.py` (new)

## D-17 서울 강남권의 가까운 역 12개를 코드에 더한다
- Status: settled
- Decision: Jira S15P31A302-180. D-16이 "나중에"로 남긴 서울의 역 가운데, 강남권 후보 7,326곳(적재한 300곳과 새 후보 7,026곳)의 가장 가까운 역 15개 중 없던 12개를 더해 34개가 된다. 신논현 `SINNONHYEON`, 논현 `NONHYEON`, 언주 `EONJU`, 한티 `HANTI`, 삼성중앙 `SAMSEONG_JUNGANG`, 교대 `GYODAE`, 선정릉 `SEONJEONGNEUNG`, 삼성 `SAMSEONG`, 학동 `HAKDONG`, 사평 `SAPYEONG`, 도곡 `DOGOK`, 봉은사 `BONGEUNSA`다. 지하철 항목이 있는 7,297곳을 이 15개가 모두 덮고, 28곳은 항목이 없어 NULL이 된다. 호선마다 네이버 역 ID가 다른 같은 역(강남, 선릉, 신논현, 논현, 교대, 선정릉, 도곡)은 코드 하나다.
  구현은 V23이 `ck_places_station`을 34개 코드로 다시 만든다. 새 코드는 서울 3개 바로 뒤에 두고 BE enum, FE 타입, AI(`STATION_NAMES`, 요청 스키마)가 같은 순서를 따른다(계약 테스트가 견준다). 규칙 해석은 "삼성페이", "교대 근무"처럼 일상말에도 쓰이는 "삼성"과 "교대"를 "삼성역"처럼 역을 붙여 말했을 때만 역으로 읽는다. `SERVED_STATIONS`는 그대로 강남, 역삼, 선릉이고(대전·구미 장소를 적재한 뒤 S15P31A302-194가 유성온천, 구미를 더했다), 새 코드를 가진 장소를 적재할 때 그 역을 더한다.
  이미 적재한 서울 장소의 `station`은 바꾸지 않는다. 그 값은 좌표로 고른 수집 역(강남, 역삼, 선릉 중 하나)이고, 적재한 4,613곳 중 2,098곳은 가장 가까운 역이 다르다. 가장 가까운 역을 `subwayStations`로 정하는 규칙(D-18)은 새로 적재하는 장소부터 쓴다.
  배포 순서는 D-16과 같다(BE, DB 마이그레이션, 장소 적재, AI, FE).
- Rejected: 가장 많은 8개만 더하기 → 학동 72곳, 사평 13곳, 도곡 10곳, 봉은사 2곳이 빠져 예외 규칙이 필요하다. 서울 역 409개 전체 → D-16과 같은 이유로 지금은 하지 않는다.
- Anchors: `be/src/main/resources/db/migration/V23__add_seoul_gangnam_stations.sql` (new) · `be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSummary.java#PlaceSummary.Station` · `ai/src/fit_ai/match/conditions.py#STATION_NAMES` · `ai/src/fit_ai/match/conditions.py#SERVED_STATIONS` · `ai/src/fit_ai/match/conditions.py#CITIES` · `ai/src/fit_ai/match/interpretation/request.py#_EVERYDAY_WORDS` · `fe/src/domains/place/model/place-types.ts#Station` · `ai/tests/match/test_station_contract.py`

## D-18 가까운 역은 네이버 역 ID 표로 코드를 정하고, 코드 없는 역이 가장 가까우면 NULL이다
- Status: settled
- Decision: Jira S15P31A302-181. 크롤링 원본을 정제 CSV로 바꿀 때(`from_crawl`) `places.station`은 `subwayStations` 중 걷는 거리(`walkingDistance`)가 가장 짧은 역이다. 거리가 같으면 네이버 목록 순서가 앞선 역이고, 거리를 모르는 역은 뒤로 보낸다. 그 역의 네이버 역 ID를 `STATION_CODE_BY_NAVER_ID` 표로 코드로 바꾼다. 가장 가까운 역이 표에 없으면 두 번째로 가까운 역으로 넘어가지 않고 NULL이다(그 역은 가장 가까운 역이 아니다). 지하철 항목이 아예 없는 장소는 D-19가 좌표로 채운다. 좌표로 강남, 역삼, 선릉 중 고르던 예전 방식은 없앴다.
  이름이 아니라 ID를 쓰는 이유는 호선마다 ID가 다른 같은 역(강남 222와 1910)을 코드 하나로 묶고, 이름이 같은 다른 지역의 역(서울과 대전의 월드컵경기장)을 가르기 위해서다. 코드 없는 가장 가까운 역은 export 보고서(`report.json`의 `stations_without_code`)에 역 이름별로 센다. 새 지역을 적재할 때 이 목록이 코드를 더할 역이고, 코드를 더하고 ID를 빠뜨리면 계약 테스트가 알려 준다.
  실제 원본(2026-11-03 수집분)에 돌린 결과다. 서울 강남권 7,326곳 중 7,297곳이 코드를 얻고 28곳은 지하철 항목이 없다. 대전은 2,325/4,300, 구미는 901/6,336, 부산은 30/201, 하남산단은 0/3,636이 지하철 항목으로 코드를 얻는다. 어느 지역에서도 "가장 가까운 역에 코드가 없어서" NULL이 된 곳은 없고, 쓰인 코드는 34개 전부다.
  가까운 역이 없는 장소의 소개문(임베딩 입력)에는 "근처"를 쓰지 않는다(`profile.summary_text`). 이미 적재한 장소의 `station`은 바꾸지 않는다(D-17).
- Rejected: 역 이름으로 코드 찾기 → 동명 역과 호선별 ID를 가르지 못한다. 코드 없는 역이면 다음으로 가까운 역 쓰기 → 가장 가까운 역이 아닌 역이 들어간다. 서울만 좌표 방식 유지 → D-17로 서울의 가까운 역 15개가 모두 코드를 가져서 예외가 필요 없다.
- Anchors: `ai/src/fit_ai/place/from_crawl.py#STATION_CODE_BY_NAVER_ID` · `ai/src/fit_ai/place/from_crawl.py#nearest_station` · `ai/scripts/export_clean_from_crawl.py` · `ai/src/fit_ai/place/profile.py#summary_text` · `ai/tests/match/test_station_contract.py`

## D-19 지하철 항목이 없는 장소는 직선거리 3km 안의 가장 가까운 역으로 채운다
- Status: settled
- Decision: Jira S15P31A302-181. 네이버는 약 1km 안의 역만 알려 줘서, 새 지역에서 5가지 정보(대표 사진, 영업시간, 메뉴, 사진 목록, 리뷰 본문)를 모두 갖춘 7,098곳 중 5,350곳(75%)의 지하철 항목이 비었다. 그런 장소는 `STATION_LOCATION_BY_NAVER_ID`의 좌표로 직선거리 3km(`STATION_FILL_MAX_KM`) 안의 가장 가까운 역 코드를 `places.station`에 채우고, 3km 밖이면 NULL이다. 네이버가 지하철 항목을 준 장소는 D-18 그대로다(가장 가까운 역에 코드가 없으면 좌표로 채우지 않고 NULL). 채운 장소는 `station_name`이 None이라 소개문에 "근처"를 쓰지 않는다(먼 역을 근처라고 쓰지 않으려고). `place_subways`(네이버가 준 목록)는 바꾸지 않는다.
  결과: 역이 있는 장소가 1,748곳에서 3,688곳(52%)으로 늘었다. 대전 2,194/2,541, 구미 1,464/2,614, 부산 30/121, 하남산단 0/1,822다. 하남산단은 어느 장소에도 지하철 정보가 없어 알려진 역이 하나도 없어서 채울 수 없다. 알려진 역은 수집한 장소의 지하철 목록에 한 번이라도 나온 34개 코드의 역뿐이라, 실제로는 목록에 없는 더 가까운 역이 있을 수 있다.
  주의: `places.station`으로 거르는 "OO역 근처" 검색에는 채운 장소(최대 3km)가 섞인다.
- Rejected: 거리 상관없이 전부 채우기 → 구미는 최대 12km, 부산은 중앙값 8km 떨어진 역이 들어가서 역 근처 검색이 부정확해진다. 하남산단 역(광주 지하철)을 새로 구해 코드 추가 → 별도 작업이라 이번에는 하지 않는다. 비워 두기 → 요청으로 채우기로 했다.
- Anchors: `ai/src/fit_ai/place/from_crawl.py#STATION_LOCATION_BY_NAVER_ID` · `ai/src/fit_ai/place/from_crawl.py#STATION_FILL_MAX_KM` · `ai/src/fit_ai/place/from_crawl.py#nearest_station` · `ai/tests/match/test_station_contract.py`
## D-20 취향 세기는 실수이고, 업종별 취향은 `features` 원소의 `category`로 둔다
- Status: settled
- Decision: Jira S15P31A302-200. `features` 원소는 `{code, layer, like, weight, category}`다. `weight`는 0보다 큰 실수이고 상한이 없다. 근거마다 0.5^(뒤에 쌓인 리뷰 수 ÷ 10)에 재방문 의사면 1.5를 곱한 무게의 합이다(taste-profile spec 3단계). `category`가 null이면 전체 취향, `RESTAURANT`·`CAFE`·`BAR`면 그 업종의 취향이다(spec 4단계). 업종별 원소는 리뷰가 있는 회원만 있고, 전체 취향과 한 목록에 둔다. 새 컬럼은 없다. 04:00 배치는 리뷰마다 `reviews.revisit_intent`를 함께 보낸다.
  배포 때 V24가 `features_refreshed_at`을 비운다. 그러면 리뷰가 있는 회원(지운 리뷰만 있는 회원 포함)이 다음 04:00에 모두 새 규칙으로 다시 계산된다. 리뷰가 없는 회원은 근거가 온보딩뿐이라 결과가 같아 대상이 아니다. 다시 계산되기 전에도 AI는 옛 정수 `weight`를 읽고 `category`가 없는 원소를 전체 취향으로 읽는다. 회원 데이터를 한꺼번에 바꾸는 마이그레이션이라 넣을 때 승인을 받는다.
  AI와 BE는 서로 모르는 속성을 거절한다(AI 요청 `extra="forbid"`, BE `fail-on-unknown-properties`). 그래서 BE만 먼저 배포하면 AI가 `revisitIntent`를 거절하고, AI만 먼저 배포하면 BE가 `category`를 읽지 못해 배치가 실패한다. 둘을 같이 배포한다.
- Rejected: 업종별 취향을 별도 컬럼이나 테이블로 → 사용자당 한 번에 읽고 쓰는 값이라 나눌 이유가 없고(D-3), 원소에 칸 하나를 더하면 옛 행도 그대로 읽힌다. 배포 뒤 새 리뷰를 쓴 회원만 다시 계산 → 리뷰를 쉬는 회원에게 옛 세기(최대 3, 업종 없음)가 계속 남는다. 리뷰가 없는 회원까지 다시 계산 → 결과가 같다.
- Anchors: `be/src/main/resources/db/migration/V24__recompute_taste_features.sql` (new) · `be/src/main/java/kr/co/fitdining/api/user/TasteFeature.java#TasteFeature` · `be/src/main/java/kr/co/fitdining/api/onboarding/TasteRefreshBatch.java#TasteRefreshBatch.evidence` · `ai/src/fit_ai/taste/profile.py#compute_features` · `ai/src/fit_ai/match/taste_select.py#select_tastes`

## D-21 앱 리뷰 본문 추출 결과를 리뷰마다 저장하고, 고친 리뷰도 갱신 대상이다
- Status: settled
- Decision: Jira S15P31A302-229. 04:00 배치가 맨 앞에서 새 리뷰와 고친 리뷰의 본문을 AI `/v1/reviews/extract`로 10건씩 보내고, 결과를 `review_extractions`(V31)에 리뷰마다 한 행으로 둔다. 행은 리뷰 ID, 추출 항목(JSON), 모델, 프롬프트 버전, 추출 시각이다. 추출할 리뷰는 지우지 않았고 본문이 있으며, 결과가 없거나 `updated_at`이 `extracted_at`보다 늦은 리뷰다. `extracted_at`은 갱신 시각과 같은 "실행 시작 5분 전"이라 읽은 뒤 고친 리뷰는 다음 실행에서 다시 추출한다(그 5분 안에 고친 리뷰는 한 번 더 추출된다).
  대상 조건은 `greatest(created_at, updated_at, deleted_at)`으로 본다. D-15의 "고친 리뷰는 대상이 아니다"를 바꾼다. 본문을 고치면 맛 근거가 달라지기 때문이다. 사진만 고쳐도 `updated_at`이 바뀌어 다시 추출하지만 횟수가 적어 그대로 둔다.
  갱신 API에는 이유 태그와 함께 지우지 않은 리뷰의 추출 결과를 보낸다. 고친 뒤 아직 추출하지 못한 결과는 보내지 않는다. 추출이 남은 회원(AI 실패, `GMS_ENABLED`가 꺼져 AI가 503)은 그날 태그로 계산한 `features`는 쓰고 `features_refreshed_at`은 그대로 두어 다음 날 다시 대상이 된다. 지운 리뷰(soft delete)의 결과는 남기되 읽지 않고, 리뷰 행이 지워지면 함께 지운다(`ON DELETE CASCADE`).
  맛 코드 8개를 `feature_codes`에 더한다(V32). 기존 회원의 직접 입력은 다시 해석하지 않는다(taste-profile spec 확장 코드).
- Rejected: 결과를 저장하지 않고 매번 추출 → 매일 모든 리뷰를 다시 추출해야 한다. 추출만 끄는 스위치를 따로 둠 → `GMS_ENABLED`가 꺼지면 AI가 503을 주어 같은 동작이 된다. 장소 리뷰에서 새 맛 코드만 다시 뽑기 → D-6 예외와 PRD OQ-20(외부 리뷰 원문의 이용 범위)이 정해져야 해서 이번에 하지 않는다. 그동안 새 맛은 회원 취향에만 쌓이고 장소 근거가 기준을 넘을 때까지 점수에 쓰지 않는다.
- Anchors: `be/src/main/resources/db/migration/V31__create_review_extractions.sql` (new) · `be/src/main/resources/db/migration/V32__add_flavor_feature_codes.sql` (new) · `be/src/main/java/kr/co/fitdining/api/onboarding/TasteRefreshBatch.java#TasteRefreshBatch.extract` (new) · `be/src/main/java/kr/co/fitdining/api/onboarding/AiTasteClient.java#AiTasteClient.extract` (new) · `ai/server/review_extract.py` (new)

## D-22 취향 묶음은 `features` 원소로 두고, 배포 때 모든 회원을 한 번 다시 계산한다
- Status: settled
- Decision: Jira S15P31A302-230. 코드 없는 취향 묶음(taste-profile spec 4단계)을 새 테이블이나 컬럼 없이 `features` 원소 `{code: null, layer: null, like: true, weight, category, text, vector}`로 둔다(업종마다 3개까지). 읽는 쪽은 `code`가 null이면 묶음으로 본다.
  04:00 배치는 저장된 칩 벡터를 갱신 요청에 싣고, AI가 리뷰 문장을 임베딩한다. AI가 임베딩에 실패했다고 알리면(`embeddingFailed`) BE는 새 코드 취향에 저장된 묶음 원소를 그대로 붙여 쓰고 `features_refreshed_at`을 올리지 않아 다음 날 다시 계산한다.
  배치 대상에 "한 번도 갱신하지 않은 회원"(`features_refreshed_at IS NULL`)을 더한다. 전에는 그중 `features`가 빈 회원만 대상이었다. V34가 갱신 시각을 비워, 다음 04:00에 리뷰가 없는 회원까지 모두 한 번 다시 계산되어 묶음이 채워진다. 운영 실행 전에 승인을 받는다. 새 가입 회원도 첫 04:00에 한 번 다시 계산된다.
  비회원은 직접 입력 해석 API가 준 칩 벡터를 기기에 저장해 검색 요청에 싣고, AI가 검색할 때마다 묶음을 계산한다. BE 직접 입력 기록(`taste_input_logs`)에는 벡터를 남기지 않는다.
- Rejected: 묶음을 새 테이블로 → 회원당 한 번에 읽고 쓰는 값이라 나눌 이유가 없다(D-3, D-20). 리뷰가 있는 회원만 다시 계산(V24 방식) → 온보딩 칩만 있는 회원은 리뷰를 쓰기 전까지 묶음이 생기지 않는다. 임베딩이 실패하면 묶음을 비움 → 하루 동안 취향 점수에서 묶음이 사라진다.
- Anchors: `be/src/main/resources/db/migration/V34__recompute_taste_bundles.sql` (new) · `be/src/main/java/kr/co/fitdining/api/onboarding/TasteRefreshBatch.java#TasteRefreshBatch.keepBundles` (new) · `be/src/main/java/kr/co/fitdining/api/user/TasteFeature.java#TasteFeature` · `ai/src/fit_ai/taste/profile.py#bundles` (new)
