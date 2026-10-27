# 장소 카탈로그 저장소 (place-catalog)

Status: approved
Decisions: [decisions.md](decisions.md) · Glossary and ADRs: none

## Problem

장소 검색(place-search)은 지금 Mock 데이터로만 동작한다. 네이버에서 강남·역삼·선릉 주변 300곳을 수집해 변환해 두었지만, 그 데이터를 담을 DB 테이블이 없다. 이번 작업은 수집 데이터 중 담기로 정한 값(decisions.md)을 손실 없이 담을 수 있고, 나중에 전국으로 넓혀도 그대로 쓸 수 있는 장소 테이블을 PostgreSQL에 만든다. 데이터 적재와 API 연결은 다음 작업이다(D-1).

테이블은 상세 화면(장소 정보, 영업시간, 메뉴, 사진, 찾아가는 길)에 필요한 값과, 검색 엔진(AI 파트)이 쓸 수 있는 외부 리뷰 집계값과 리뷰 사진을 담는다. 외부 리뷰에서 나온 값은 응답이 읽지 않는 별도 테이블에 두어, 아무 조건 없이 읽어도 응답에 섞이지 않게 한다(D-4, place-search#D-41). 다른 열에서 만들 수 있는 값은 저장하지 않고 BE가 응답할 때 계산해 담는다(D-6).

## Assumptions

1. DB는 PostgreSQL 16이다(`pgvector/pgvector:0.8.7-pg16`, 테스트도 같은 이미지). `UNIQUE NULLS NOT DISTINCT`(15 이상)를 쓸 수 있다(D-10).
2. 마이그레이션은 migrate 프로필에서 마이그레이션 계정(`fit_migrator`)이 실행하고, 웹 앱은 DML만 하는 계정(`fit_dev_app`)으로 접속한다. 새 테이블과 identity 시퀀스에 대한 앱 계정 권한은 인프라(`infra/data/ensure-databases.sh`)와 테스트 지원이 설정한 기본 권한(`ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator`)으로 생긴다(D-1).
3. 웹 앱은 `spring.jpa.hibernate.ddl-auto=validate`다. 이번에는 새 테이블의 JPA 엔티티를 만들지 않으므로 기동 검증에 영향이 없다(D-1).
4. 담을 데이터의 기준은 저장소 밖 변환 결과(`FIELDS.md` 형식, 300곳)다. 300곳에서 이름, 대분류, 좌표, 세 가지 주소는 모두 있고, 메뉴 카테고리는 7,018개 중 1,412개에만 있다. 주소처럼 300곳에 모두 있어도 네이버에서 비어 올 수 있는 값은 NULL을 허용한다(D-3, D-12, D-13).
5. 네이버 수집 데이터에는 역 좌표와 행정구역 코드가 없다(D-6, D-11).
6. CI의 `lint:migrations`(`infra/ci/migration_immutability.py`)가 MR에서 기존 버전 마이그레이션의 수정·삭제와 버전 중복·역순을 막는다(D-1).
7. develop에는 리뷰 담당의 `reviews`(V4)가 있고, `reviews.place_id bigint`가 장소 번호를 FK 없이 받는다. 이 값이 가리킬 대상이 `places.place_id`다(D-2).

## Usage

다음 작업(적재)이 장소 하나를 넣는 모습. 장소 단위로 한 트랜잭션이고, 다시 수집하면 `naver_place_id`로 같은 행을 갱신한 뒤 자식 행을 지우고 다시 넣는다. `updated_at`은 DB가 자동으로 바꾸지 않으므로 적재가 넣는다.

```sql
INSERT INTO places (naver_place_id, name, category_group, lat, lng, address, facilities)
VALUES ('38562941', '고수닭갈비', 'RESTAURANT', 37.4997744, 127.0281716,
        '서울 강남구 강남대로96길 12', '{단체 이용 가능,무선 인터넷}')
ON CONFLICT (naver_place_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
RETURNING place_id;

DELETE FROM place_menus WHERE place_id = :place_id;
INSERT INTO place_menus (place_id, sort_order, name, price, price_text, price_type, photo_urls)
VALUES (:place_id, 0, '닭갈비', 15000, '15,000', 'fixed', '{https://ldb-phinf.pstatic.net/...jpg}');
```

다음 작업(API 연결)이 상세 화면을 읽는 모습. 자식 테이블을 한 SQL에서 함께 조인하지 않고 테이블마다 따로 읽는다. 응답은 `place_naver_snapshots`와 `place_review_photos`를 읽지 않는다.

```sql
SELECT * FROM places       WHERE place_id = :place_id;
SELECT * FROM place_hours  WHERE place_id = :place_id;
SELECT * FROM place_menus  WHERE place_id = :place_id ORDER BY sort_order;
SELECT * FROM place_photos WHERE place_id = :place_id ORDER BY source, sort_order;
-- 정보 탭: 지하철역과 정류장은 sort_order 없이 도보 거리, 같으면 PK 순(D-9)
SELECT * FROM place_subways WHERE place_id = :place_id ORDER BY walk_meters, place_subway_id;
```

Usage의 SQL은 다음 작업이 이 테이블을 쓰는 방식을 보이는 예다. 적재, 조회, 정렬을 구현하는 것은 이번 작업이 아니다(D-1).

## Acceptance criteria

- [ ] AC-1: 마이그레이션 계정으로 Flyway를 실행하면 새 마이그레이션이 `flyway_schema_history`에 성공으로 기록되고, 아래 Interfaces의 10개 테이블이 각각 정확히 그 열만 가진다. 각 열의 타입(배열의 원소 타입과 `numeric`의 자릿수 포함), NULL 허용 여부, 기본값이 Interfaces와 같고, `place_naver_snapshots`를 뺀 9개 테이블의 PK 열(`place_id`, `place_hour_id` 등)은 `GENERATED ALWAYS` identity다. 이름을 붙인 제약과 인덱스는 Interfaces에 적힌 이름 그대로 있다. (D-1, D-2, D-3, D-6, D-7, D-8, D-9, D-11, D-12, D-13)
- [ ] AC-2: 앱 계정으로 `places`에 `place_id` 없이 넣으면 `place_id`가 발급되고, 일반 INSERT로 `place_id`를 직접 넣으면 거부된다. 일반 INSERT로 같은 `naver_place_id`를 두 번 넣거나 빈 문자열 `naver_place_id`를 넣으면 거부된다. 필수 열(`naver_place_id`, `name`, `category_group`, `lat`, `lng`)만 넣으면 배열 열은 빈 배열이고, `created_at`과 `updated_at`은 그 INSERT 트랜잭션의 `now()`다. (D-2, D-13)
- [ ] AC-3: `category_group`이 `RESTAURANT`, `CAFE`, `BAR` 밖이거나, `lat`이 -90~90 밖이거나, `lng`이 -180~180 밖이면 거부된다. (D-13)
- [ ] AC-4: `place_hours`에서 같은 장소, 같은 묶음, 같은 요일 줄을 두 번 넣으면 거부된다. 묶음 이름이 NULL(기본 묶음)이어도 거부되고, 묶음 이름이 다르면 받아들인다. 요일이 `MON`~`SUN` 밖이거나, 묶음 이름이 빈 문자열이거나, 개점과 마감 중 하나만 있거나, `closed = true`인데 개점이 있거나, 개점이나 마감이 `24:00`이거나, `breaks`가 JSON 배열이 아니면 거부된다. 필수 열만 넣으면 `closed`는 false, `breaks`는 빈 JSON 배열, `last_orders`는 빈 배열이다. (D-10, D-13)
- [ ] AC-5: `place_photos.source`가 `business`, `menuBoard` 밖이거나 `place_review_photos.source`가 `aiView`, `placeReview` 밖이면 거부된다. 두 사진 테이블 각각에서 같은 장소, 같은 출처, 같은 `sort_order` 사진과, `place_menus`에서 같은 장소, 같은 `sort_order` 메뉴는 두 번째가 거부된다. 출처가 다르면 같은 `sort_order`를 받아들인다. 세 테이블 모두 음수 `sort_order`는 거부된다. 메뉴의 필수 열만 넣으면 `representative`는 false, `photo_urls`는 빈 배열이다. (D-4, D-7, D-8, D-9, D-13)
- [ ] AC-6: 앱 계정으로 `places` 행을 지우면 그 장소의 9개 자식 테이블 행이 모두 지워지고 다른 장소의 행은 남는다. (D-13)
- [ ] AC-7: 9개 자식 테이블은 모두 첫 열이 `place_id`인 인덱스를 가진다. PK나 UNIQUE 제약이 만든 인덱스도 인정한다(`place_naver_snapshots`는 PK). (D-13)
- [ ] AC-8: 앱 계정으로 10개 테이블 각각에 SELECT, INSERT, UPDATE, DELETE를 실제로 실행하면 모두 성공한다. (D-1)
- [ ] AC-9: 기존 BE 테스트 전체가 통과한다. 여기에는 앱이 `ddl-auto=validate`로 기동하는 것을 확인하는 기존 컨텍스트 로드 테스트(`ApiApplicationTests`)가 포함된다. (D-1)

## Interfaces

새 마이그레이션이 만드는 스키마 전부다. 여기에 없는 열, 인덱스, 제약은 더하지 않는다.

이름 규칙(D-2, D-13):
- PK 열은 `<테이블 단수형>_id`이고, 그 PK를 가리키는 FK 열도 같은 이름이다(`places.place_id` ← `place_hours.place_id`). PK 제약 자체에는 이름을 붙이지 않는다.
- 그 밖의 제약과 인덱스는 아래 DDL에 적힌 이름을 그대로 쓴다. 형식은 `<접두어>_<테이블>_<열 또는 뜻>`이고 접두어는 CHECK `ck`, FK `fk`, UNIQUE `uk`, 인덱스 `idx`다.
- 테이블 안 열의 순서만 구현 재량이다. 인덱스 안 열의 순서는 적힌 대로다.

```sql
CREATE TABLE places (
    place_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    naver_place_id     text NOT NULL
                       CONSTRAINT uk_places_naver_place_id UNIQUE
                       CONSTRAINT ck_places_naver_place_id CHECK (naver_place_id <> ''),
    name               text NOT NULL,
    category_group     text NOT NULL
                       CONSTRAINT ck_places_category_group CHECK (category_group IN ('RESTAURANT', 'CAFE', 'BAR')),
    category           text,
    category_code      text,
    category_code_path text[] NOT NULL DEFAULT '{}',
    lat                double precision NOT NULL CONSTRAINT ck_places_lat CHECK (lat BETWEEN -90 AND 90),
    lng                double precision NOT NULL CONSTRAINT ck_places_lng CHECK (lng BETWEEN -180 AND 180),
    address            text,          -- 도로명
    jibun_address      text,
    full_address       text,          -- 층 등 상세 포함
    directions         text,          -- 찾아오는 길(업체 작성)
    description        text,          -- 업체 소개
    phone              text,          -- 대표 전화
    website            text,
    extra_links        text[] NOT NULL DEFAULT '{}',   -- 대표 홈페이지 말고 업체가 등록한 링크 URL
    booking_url        text,                           -- 네이버 예약 페이지
    facilities         text[] NOT NULL DEFAULT '{}',   -- 네이버 편의시설 이름 그대로
    parking_free       boolean,
    parking_note       text,
    pet_allowed        boolean,
    pet_note           text,
    payment_methods    text[] NOT NULL DEFAULT '{}',
    keywords           text[] NOT NULL DEFAULT '{}',
    menu_updated_on    date,          -- 네이버 메뉴 정보 수정일(날짜만)
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- 응답 제외: 외부 리뷰 집계와 수집 기록(D-4). 장소와 1:1이라 PK가 place_id다.
CREATE TABLE place_naver_snapshots (
    place_id             bigint PRIMARY KEY
                         CONSTRAINT fk_place_naver_snapshots_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    crawled_at           timestamptz NOT NULL,
    extra_category_codes text[] NOT NULL DEFAULT '{}',
    visitor_review_score numeric(3,2),
    visitor_review_count integer,
    blog_review_count    integer,
    review_themes        jsonb,          -- NULL이면 수집되지 않음
    review_menus         jsonb,
    voted_keywords       jsonb,
    naver_one_liner      text,           -- 네이버 AI 리뷰 요약(microReviews)
    save_count           integer,
    search_keyword       text,
    search_rank          integer
);

CREATE TABLE place_hours (
    place_hour_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id      bigint NOT NULL
                  CONSTRAINT fk_place_hours_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    set_name      text CONSTRAINT ck_place_hours_set_name CHECK (set_name <> ''),   -- NULL이면 기본 묶음
    day_of_week   text NOT NULL
                  CONSTRAINT ck_place_hours_day_of_week CHECK (day_of_week IN ('MON','TUE','WED','THU','FRI','SAT','SUN')),
    open_time     time,
    close_time    time,                                  -- open_time 이하면 다음 날 마감
    closed        boolean NOT NULL DEFAULT false,
    breaks        jsonb NOT NULL DEFAULT '[]'
                  CONSTRAINT ck_place_hours_breaks CHECK (jsonb_typeof(breaks) = 'array'),  -- [{start, end}]
    last_orders   time[] NOT NULL DEFAULT '{}',
    CONSTRAINT uk_place_hours_place_id_set_name_day_of_week
        UNIQUE NULLS NOT DISTINCT (place_id, set_name, day_of_week),
    CONSTRAINT ck_place_hours_time_pair CHECK ((open_time IS NULL) = (close_time IS NULL)),
    CONSTRAINT ck_place_hours_closed_no_time CHECK (NOT closed OR open_time IS NULL),
    CONSTRAINT ck_place_hours_no_2400 CHECK (open_time <> '24:00' AND close_time <> '24:00')
);

CREATE TABLE place_menus (
    place_menu_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id       bigint NOT NULL
                   CONSTRAINT fk_place_menus_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    sort_order     integer NOT NULL CONSTRAINT ck_place_menus_sort_order CHECK (sort_order >= 0),
    category       text,
    name           text NOT NULL,
    description    text,
    price          integer,
    price_text     text,
    price_type     text,                               -- 가격 유형(fixed, dynamic, free, amountRange 등)
    representative boolean NOT NULL DEFAULT false,
    photo_urls     text[] NOT NULL DEFAULT '{}',       -- 원본 URL
    CONSTRAINT uk_place_menus_place_id_sort_order UNIQUE (place_id, sort_order)
);

-- 응답에 쓰는 사진: 업체 사진과 메뉴판 사진.
CREATE TABLE place_photos (
    place_photo_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id       bigint NOT NULL
                   CONSTRAINT fk_place_photos_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    source         text NOT NULL CONSTRAINT ck_place_photos_source CHECK (source IN ('business', 'menuBoard')),
    sort_order     integer NOT NULL CONSTRAINT ck_place_photos_sort_order CHECK (sort_order >= 0),  -- 출처별 네이버 순서
    url            text NOT NULL,                      -- 원본 URL(프록시 없음)
    CONSTRAINT uk_place_photos_place_id_source_sort_order UNIQUE (place_id, source, sort_order)
);

-- 응답 제외: 방문자 리뷰 사진(D-4, D-7).
CREATE TABLE place_review_photos (
    place_review_photo_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id              bigint NOT NULL
                          CONSTRAINT fk_place_review_photos_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    source                text NOT NULL
                          CONSTRAINT ck_place_review_photos_source CHECK (source IN ('aiView', 'placeReview')),
    sort_order            integer NOT NULL
                          CONSTRAINT ck_place_review_photos_sort_order CHECK (sort_order >= 0),  -- 출처별 네이버 순서
    url                   text NOT NULL,               -- 원본 URL(프록시 없음)
    theme                 text,                        -- aiView 주제("내부", "음식·음료" 등)
    CONSTRAINT uk_place_review_photos_place_id_source_sort_order UNIQUE (place_id, source, sort_order)
);

CREATE TABLE place_subways (
    place_subway_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id        bigint NOT NULL
                    CONSTRAINT fk_place_subways_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    station         text NOT NULL,   -- '강남역'
    line            text,            -- '2호선'
    exit            text,
    walk_minutes    integer,
    walk_meters     integer
);
CREATE INDEX idx_place_subways_place_id_walk_meters ON place_subways (place_id, walk_meters);

CREATE TABLE place_bus_stops (
    place_bus_stop_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id          bigint NOT NULL
                      CONSTRAINT fk_place_bus_stops_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    name              text NOT NULL,
    code              text,
    walk_minutes      integer,
    walk_meters       integer
);
CREATE INDEX idx_place_bus_stops_place_id_walk_meters ON place_bus_stops (place_id, walk_meters);

CREATE TABLE place_seats (
    place_seat_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id      bigint NOT NULL
                  CONSTRAINT fk_place_seats_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    name          text NOT NULL,
    description   text
);
CREATE INDEX idx_place_seats_place_id ON place_seats (place_id);

CREATE TABLE place_broadcasts (
    place_broadcast_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id           bigint NOT NULL
                       CONSTRAINT fk_place_broadcasts_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    channel            text,
    program            text,
    episode            text,
    aired_on           text,   -- 네이버 표기 그대로('19.08.06.')
    menu               text
);
CREATE INDEX idx_place_broadcasts_place_id ON place_broadcasts (place_id);
```

`place_naver_snapshots`는 PK로, `place_hours`, `place_menus`, `place_photos`, `place_review_photos`는 UNIQUE 제약으로 `place_id`로 시작하는 인덱스를 갖춘다(D-13).

DB가 보장하는 것은 위 SQL이 적은 것뿐이다. 장소마다 스냅샷은 0개나 1개이고(필수 아님), `24:00` 금지는 `open_time`, `close_time`에만 걸린다. `breaks`의 원소 모양(`{start, end}`), `last_orders`의 값, 스냅샷 집계 jsonb의 내부 모양, 공백뿐인 문자열은 DB가 검사하지 않고 적재(다음 작업)가 맞춘다. 이런 검사를 이번에 더하지 않는다.

## Constraints

- 새 마이그레이션은 파일 하나이고, 버전은 그 시점 마지막 버전의 다음 번호다(작성 시점 develop은 V5 `reason_tags`까지 있어 V6. 다른 작업이 V6을 먼저 병합하면 V7). 기존 마이그레이션 파일은 고치지 않는다(D-1).
- 새 마이그레이션에는 `CREATE TABLE`과 `CREATE INDEX`만 쓴다. 기존 객체의 ALTER와 DROP, `CREATE EXTENSION`, 트리거, 함수, GRANT, COMMENT는 쓰지 않는다. `reviews.place_id`에 FK를 거는 것도 이번에 하지 않는다(D-1, D-11).
- 리뷰 글, 리뷰어 닉네임과 ID, 블로거 프로필 사진을 담는 열을 만들지 않는다(D-5).
- Interfaces에 없는 파생값 열(대표 사진, 휴무 안내, 영업 상태, 기준 역 이름과 거리, 안심번호 여부, 링크 종류, 네이버 링크, 사진 프록시 주소, 노키즈존, 발렛, 행정구역, 지하철·정류장 순서)을 만들지 않는다(D-6).
- `infra/`와 `docs/infra/`는 고치지 않는다. 계정 권한에 바꿀 것이 생기면 인프라 담당에게 넘긴다.

## Existing code

| Locator | Action | Obligation | Decision |
|---|---|---|---|
| `be/src/main/resources/application-migrate.yml#spring.flyway` | reuse | 마이그레이션은 migrate 프로필의 Flyway로만 실행한다. 새 파일은 기본 위치(`be/src/main/resources/db/migration/`)에 두고, 웹 앱 설정(`flyway.enabled: false`)은 그대로 둔다 | D-1 |
| `be/src/test/java/kr/co/fitdining/api/support/PostgresTestSupport.java#PostgresTestSupport` | reuse | 테스트 DB를 같은 이미지, 마이그레이션 계정과 앱 계정, 기본 권한으로 구성하고 Flyway 기본 위치의 마이그레이션을 적용한다. 고치지 않는다 | D-1 |

## Seams & test plan

- PostgreSQL 통합 테스트(example), AC-1~AC-8: `PostgresTestSupport`를 상속해 공유 컨테이너에 마이그레이션을 적용한다. 이 클래스의 Flyway는 migrate 프로필과 같은 기본 위치와 같은 마이그레이션 계정을 쓰므로 migrate 프로필 실행을 대신한다. `flyway_schema_history`로 적용을, `information_schema.columns`(`udt_name`, `numeric_precision`, `numeric_scale`, `is_nullable`, `column_default`, `is_identity`, `identity_generation`)로 열을 정확히 비교하고, `pg_constraint`와 `pg_indexes`로 제약·인덱스의 이름과 첫 열을 확인하고, 앱 계정(`appSource()`)으로 실제 DML을 실행해 제약 위반 예외, 기본값, 권한을 확인한다. 컨테이너를 JVM 안에서 공유하므로 테스트 데이터는 실행마다 겹치지 않게 만든다. Spring 컨텍스트를 띄울지 `migrate()`를 직접 부를지는 재량이다. 잡는 것: 열 누락이나 남는 열, 타입, NULL 허용, 기본값, identity 방식, 제약·인덱스 이름, CHECK, UNIQUE, CASCADE, 인덱스, 앱 계정 권한. 놓치는 것: 운영 DB의 계정 권한(인프라 몫), 실제 수집 데이터 300곳의 적재(다음 작업). Prior art: `be/src/test/java/kr/co/fitdining/api/user/PreferencesFlowTests.java`(V2 스키마를 `information_schema`와 `pg_indexes`로 확인).
- 기존 BE 테스트 전체(example), AC-9: `./gradlew test`(Docker 필요)와 CI `be:test`. 잡는 것: 새 마이그레이션이 기존 스키마(기존 마이그레이션을 확인하는 기존 테스트)나 기동(`ddl-auto=validate`)을 깨는 것. Prior art: `be/src/test/java/kr/co/fitdining/api/ApiApplicationTests.java`.
- CI `lint:migrations`(example, 기존), Constraints: 기존 마이그레이션 수정과 버전 중복·역순을 자동으로 막는다.
- 새 마이그레이션 파일 검토(manual), Constraints: 파일이 하나인지, `CREATE TABLE`과 `CREATE INDEX`만 쓰는지, `infra/`와 `docs/infra/`가 바뀌지 않았는지 diff로 확인한다.

## Out of scope

- 수집 데이터를 DB에 넣는 적재 스크립트와 `convert_places.py` 수정. 리뷰 발췌를 집계 jsonb에 넣지 않는 것도 적재의 의무다(D-1, D-5).
- 새 테이블의 JPA 엔티티, 리포지토리, place API가 Mock 대신 DB를 읽게 바꾸는 일(D-1).
- `reviews.place_id`에서 `places.place_id`로 FK를 거는 일. 리뷰 담당과 함께 다른 마이그레이션으로 한다(D-1).
- place-search의 응답 계약 변경(`PlaceSummary.station` 삭제, 사진 `src`/`srcSet`, `breaks` 목록, 상세 `tags`, BE가 파생값을 계산해 담는 규칙)과 `mock/places.json` 교체(D-1, D-6).
- 역 테이블(`stations`, `station_lines`), 공간 인덱스와 확장(D-11).
- 행정구역 열이나 법정동 코드(D-6).
- `places`를 목록용과 상세용으로 나누는 일(D-3).
- `updated_at` 자동 갱신 트리거. 적재가 넣는다.
- 찜(`saved_places`), 검색 기록, 리뷰 테이블. 회원 테이블(`auth_users`, `user_preferences`) 변경.

## Open questions

- place-search에서 상세 `tags`를 적재할 때 한 번 만들기로 정하면 `places.tags text[]`를 다른 마이그레이션으로 더한다. 이번 테이블과 검증에는 영향이 없다.
