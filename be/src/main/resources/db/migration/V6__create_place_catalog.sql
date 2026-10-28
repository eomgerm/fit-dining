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
    district           text,          -- 구(주소에서 뽑음)
    dong               text,          -- 동(주소에서 뽑음)
    directions         text,          -- 찾아오는 길(업체 작성)
    description        text,          -- 업체 소개
    phone              text,          -- 대표 전화(일반 번호가 없으면 안심번호)
    website            text,
    extra_links        text[] NOT NULL DEFAULT '{}',   -- 대표 홈페이지 말고 업체가 등록한 링크 URL
    booking_url        text,                           -- 가게의 네이버 예약 페이지
    facilities         text[] NOT NULL DEFAULT '{}',   -- 네이버 편의시설 이름 그대로
    parking_free       boolean,
    parking_note       text,
    pet_allowed        boolean,
    pet_note           text,
    corkage_allowed    boolean,
    corkage_note       text,
    payment_methods    text[] NOT NULL DEFAULT '{}',
    keywords           text[] NOT NULL DEFAULT '{}',
    menu_updated_on    date,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE place_hours (
    place_hour_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id      bigint NOT NULL
                  CONSTRAINT fk_place_hours_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    day_of_week   text NOT NULL
                  CONSTRAINT ck_place_hours_day_of_week CHECK (day_of_week IN ('MON','TUE','WED','THU','FRI','SAT','SUN')),
    open_time     time,
    close_time    time,                                  -- open_time 이하면 다음 날 마감
    closed        boolean NOT NULL DEFAULT false,
    breaks        jsonb NOT NULL DEFAULT '[]'
                  CONSTRAINT ck_place_hours_breaks CHECK (jsonb_typeof(breaks) = 'array'),  -- [{start, end}]
    last_orders   time[] NOT NULL DEFAULT '{}',
    CONSTRAINT uk_place_hours_place_id_day_of_week UNIQUE (place_id, day_of_week),
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
    price          integer,                            -- 정가(FIXED)일 때만
    price_text     text,                               -- 가격 원문("10,000~13,000원", "가격 변동")
    price_type     text,                               -- FIXED, DYNAMIC, FREE, RANGE
    representative boolean NOT NULL DEFAULT false,
    labels         text[] NOT NULL DEFAULT '{}',       -- "2인이상", "사전예약" 등
    photo_urls     text[] NOT NULL DEFAULT '{}',       -- 원본 URL
    CONSTRAINT uk_place_menus_place_id_sort_order UNIQUE (place_id, sort_order)
);

-- 업체 사진과 메뉴판 사진만(방문자 리뷰 사진은 저장하지 않는다).
CREATE TABLE place_photos (
    place_photo_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id       bigint NOT NULL
                   CONSTRAINT fk_place_photos_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    source         text NOT NULL CONSTRAINT ck_place_photos_source CHECK (source IN ('business', 'menuBoard')),
    sort_order     integer NOT NULL CONSTRAINT ck_place_photos_sort_order CHECK (sort_order >= 0),  -- 출처별 0부터
    url            text NOT NULL,                      -- 원본 URL(프록시 없음)
    CONSTRAINT uk_place_photos_place_id_source_sort_order UNIQUE (place_id, source, sort_order)
);

CREATE TABLE place_subways (
    place_subway_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    place_id        bigint NOT NULL
                    CONSTRAINT fk_place_subways_place_id REFERENCES places(place_id) ON DELETE CASCADE,
    station         text NOT NULL,   -- 네이버 역 이름 그대로
    line            text,            -- 네이버 노선 값 그대로('2', '신분당')
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
    aired_on           date,
    menu               text
);
CREATE INDEX idx_place_broadcasts_place_id ON place_broadcasts (place_id);
