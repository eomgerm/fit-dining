"""Postgres 장소·취향 저장소를 실제 SQL로 확인한다.

pgserver(개발 의존성)로 임시 Postgres(pgvector)를 띄우고, 뷰 `ai_place_search`와 같은
컬럼의 테이블을 만들어 거르기, 유사도 순서, 모델 확인, 깨진 프로필을 본다.
벡터는 2차원 가짜 값이고, 모델·리비전은 공유 모듈 `fit_ai.embedding`의 값을 쓴다.
취향은 저장 설계(V6)와 같은 `user_preferences`를 만들어 회원 취향을 읽는지 본다.
"""

import json
from collections.abc import Iterator

import pytest

from fit_ai import embedding
from fit_ai.match.candidates import (
    MapBounds,
    OpenHours,
    PlaceFilter,
    RegionArea,
    StationArea,
    StoreError,
    VectorCounts,
)

pgserver = pytest.importorskip("pgserver")
psycopg = pytest.importorskip("psycopg")

from fit_ai.match import pg_store as pg_module
from fit_ai.match.pg_store import PgPlaceStore, PgTasteStore

QUERY = (1.0, 0.0)


def profile(
    place_id: int, model: str = embedding.MODEL_ID, prompt: str = "document"
) -> dict:
    return {
        "schema": "place-profile/v0",
        "summary": {"text": f"설명 {place_id}", "vector": [1.0, 0.0]},
        "embedding": {"model": model, "revision": embedding.REVISION, "prompt": prompt},
        "features": [
            {"code": "QUIET", "layer": "axis", "like_count": 5, "dislike_count": 0}
        ],
    }


# (id, 업종, 역, 위도, 경도, 시설, 프로필, 벡터). 요청문과 유사도는 벡터 각도로 정했다.
ROWS = [
    (1, "CAFE", "GANGNAM", 37.50, 127.02, {"PARKING": True}, profile(1), (1.0, 0.0)),
    (2, "CAFE", "GANGNAM", 37.51, 127.03, {"PARKING": False}, profile(2), (0.8, 0.6)),
    (3, "CAFE", "YEOKSAM", 37.50, 127.04, {}, profile(3), (0.6, 0.8)),
    (4, "BAR", "GANGNAM", 37.49, 127.02, {"PARKING": None}, profile(4), (0.9, 0.44)),
    (5, "CAFE", "GANGNAM", 37.50, 127.02, {}, profile(5, model="other"), (1.0, 0.0)),
    (6, "CAFE", "GANGNAM", 37.50, 127.02, {}, profile(6, prompt="query"), (1.0, 0.0)),
    (7, "CAFE", "GANGNAM", 37.50, 127.02, {}, {"schema": "place-profile/v1"}, (1, 0)),
    (8, "CAFE", "GANGNAM", 37.50, 127.02, {}, profile(8), None),
]

# 장소별 (동, 구, 가까운 역). test_json_store.py와 같다. 비교할 수 있는 1~4번에만 둔다. 2번은 강남에서 수집했지만 가장
# 가까운 역이 신논현역이고, 4번은 강남에서 수집했지만 역삼역도 가깝다. 4번의 강남역 도보
# 분은 모른다.
AREAS = {
    1: ("역삼동", "강남구", [{"station": "강남역", "exit": "11", "walk_minutes": 3}]),
    2: (None, "강남구", [{"station": "신논현역", "exit": "5", "walk_minutes": 4}]),
    3: (None, "강남구", [{"station": "역삼역", "exit": "3", "walk_minutes": 6}]),
    4: (
        "서초동",
        "서초구",
        [
            {"station": "강남역", "exit": "10", "walk_minutes": None},
            {"station": "역삼역", "exit": "7", "walk_minutes": 9},
        ],
    ),
}

# 장소별 (영업시간, 가게 가격). test_json_store.py와 같다. 1번은 매일 22시까지, 2번은
# 일요일에 쉬고 다른 날은 새벽 2시까지, 3번은 월요일 시각만 모르고, 4번은 일요일에 쉬고
# 다른 날은 24시간 연다. 3번은 가격도 모른다.
WEEKDAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT")
SUNDAY_OFF = {"day": "SUN", "open": None, "close": None, "closed": True}
HOURS = {
    1: (
        [
            {"day": d, "open": "10:00", "close": "22:00", "closed": False}
            for d in (*WEEKDAYS, "SUN")
        ],
        9000,
    ),
    2: (
        [
            *(
                {"day": d, "open": "18:00", "close": "02:00", "closed": False}
                for d in WEEKDAYS
            ),
            SUNDAY_OFF,
        ],
        15000,
    ),
    3: ([{"day": "MON", "open": None, "close": None, "closed": False}], None),
    4: (
        [
            *(
                {"day": d, "open": "00:00", "close": "00:00", "closed": False}
                for d in WEEKDAYS
            ),
            SUNDAY_OFF,
        ],
        30000,
    ),
}

# (거르기 조건, 뽑히는 장소). 안 맞는다고 확인된 곳만 빼고 모르면 남긴다.
HOURS_PRICE_CASES = [
    # 요일이 없으면 하루라도 그 시각까지 열 수 있으면 남는다.
    (PlaceFilter(hours=OpenHours(until=26 * 60)), [4, 2, 3]),
    (PlaceFilter(hours=OpenHours(until=22 * 60)), [1, 4, 2, 3]),
    (PlaceFilter(hours=OpenHours(since=8 * 60)), [4, 3]),
    (PlaceFilter(hours=OpenHours(days=("SUN",))), [1, 3]),
    (PlaceFilter(hours=OpenHours(days=("SUN",), until=26 * 60)), [3]),
    # 요일이 여럿이면 그중 하루라도 맞으면 된다.
    (PlaceFilter(hours=OpenHours(days=("FRI", "SUN"), until=23 * 60)), [4, 2, 3]),
    (PlaceFilter(max_price=10000), [1, 3]),
    (PlaceFilter(max_price=15000), [1, 2, 3]),
    (PlaceFilter(min_price=18000, max_price=32999), [4, 3]),
]

# 장소별 (음식 종류, 분석 리뷰 수). test_json_store.py와 같다. 3번은 리뷰 수를 모른다.
REVIEWS = {1: ("FOOD_WESTERN", 120), 2: (None, 80), 3: (None, None), 4: (None, 100)}

# 장소별 (가게 이름, 네이버 업종 이름, 메뉴판). test_json_store.py와 같다. 3번은 메뉴판이 없다.
MENUS = {
    1: ("도치피자 강남", "피자", ["[대표] 마르게리따 피자", "크림 파스타"]),
    2: ("냉동고집", "돼지고기구이", ["안주 돈까스", "생삼겹살 150g"]),
    3: ("동네카페", "카페,디저트", []),
    4: ("기네스72", "맥주,호프", ["Guinness 생맥주", "피쉬앤칩스"]),
}

# (거르기 조건, 뽑히는 장소). 메뉴마다 찾을 말 중 하나가 메뉴 이름, 업종 이름, 가게 이름에
# 들어 있어야 남는다.
MENU_CASES = [
    (PlaceFilter(menus=(("돈까스", "돈가스"),)), [2]),
    # 다른 표기가 없으면 "돈까스" 메뉴를 못 찾는다.
    (PlaceFilter(menus=(("돈가스",),)), []),
    (PlaceFilter(menus=(("피자",),)), [1]),
    # 메뉴판이 없어도 업종 이름으로 찾는다.
    (PlaceFilter(menus=(("디저트",),)), [3]),
    # 영문은 소문자로 견주고, 가게 이름으로도 찾는다.
    (PlaceFilter(menus=(("guinness",),)), [4]),
    (PlaceFilter(menus=(("기네스",),)), [4]),
    # 메뉴가 여럿이면 모두 있어야 한다.
    (PlaceFilter(menus=(("피자",), ("파스타",))), [1]),
    (PlaceFilter(menus=(("피자",), ("돈까스",))), []),
]


def menu_items(names: list[str]) -> list[dict]:
    """뷰 `menus` 모양의 메뉴판"""
    return [
        {"name": n, "category": None, "price": None, "representative": False}
        for n in names
    ]


YEOKSAM_CAFE = PlaceFilter(
    category_group="CAFE", areas=(StationArea("역삼역", "YEOKSAM"),)
)
"""3번 장소만 뽑는 거르기 조건"""

# (거르기 조건, 뽑히는 장소). 유사도 순서는 1, 4, 2, 3번이다.
AREA_CASES = [
    # 도보 거리가 없는 역은 수집 역이 같거나 가까운 역 목록에 있으면 든다.
    (
        PlaceFilter(category_group="CAFE", areas=(StationArea("강남역", "GANGNAM"),)),
        [1, 2],
    ),
    (PlaceFilter(areas=(StationArea("역삼역", "YEOKSAM"),)), [4, 3]),
    (PlaceFilter(areas=(StationArea("신논현역"),)), [2]),
    # 도보 거리나 출구가 있으면 가까운 역 목록만 보고, 도보 분을 모르면 뺀다.
    (PlaceFilter(areas=(StationArea("강남역", "GANGNAM", walk_minutes=5),)), [1]),
    (PlaceFilter(areas=(StationArea("역삼역", "YEOKSAM", walk_minutes=8),)), [3]),
    (PlaceFilter(areas=(StationArea("강남역", "GANGNAM", exit="10"),)), [4]),
    # 동이 없으면 이름이 같은 서비스 역의 장소로 본다.
    (PlaceFilter(areas=(RegionArea("역삼동", "YEOKSAM"),)), [1, 3]),
    (PlaceFilter(areas=(RegionArea("서초구"),)), [4]),
    # 지역이 여럿이면 그중 하나에 들면 된다.
    (
        PlaceFilter(
            areas=(
                StationArea("신논현역"),
                StationArea("역삼역", "YEOKSAM", walk_minutes=8),
            )
        ),
        [2, 3],
    ),
    (PlaceFilter(areas=(MapBounds(ne_lat=37.495), StationArea("신논현역"))), [4, 2]),
    (PlaceFilter(excluded_categories=("BAR",)), [1, 2, 3]),
]


QUIET_FEATURES = [
    {"code": "QUIET", "layer": "axis", "like": True, "weight": 1},
    {"code": "LIVELY", "layer": "axis", "like": False, "weight": 1},
]

# (회원 id, 온보딩 칩, 취향 계산 결과). 칩 모양은 저장 설계 V6의 [{polarity, label, code, vector}]다.
TASTE_ROWS = [
    (
        "user-1",
        [
            {"polarity": "LIKE", "label": "조용한 곳", "code": "QUIET", "vector": None},
            {
                "polarity": "LIKE",
                "label": "담백한 국물 요리를 먹을 수 있는 곳",
                "code": None,
                "vector": [0.6, 0.8],
            },
            {"polarity": "DISLIKE", "label": "비싼 곳", "code": None, "vector": None},
        ],
        QUIET_FEATURES,
    ),
    # 취향 분석 결과를 더하기 전의 온보딩 원본 칩(code, vector 키 없음), 계산 실패한 결과([])
    ("user-2", [{"polarity": "LIKE", "label": "넓은 데"}], []),
    ("user-3", None, [{"code": "QUIET", "layer": "axis", "like": True, "weight": 9}]),
    ("user-4", [{"polarity": "MAYBE", "label": "조용한 곳"}], QUIET_FEATURES),
]


@pytest.fixture(scope="module")
def database(tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    """예시 장소를 넣은 임시 DB의 접속 주소"""
    server = pgserver.get_server(tmp_path_factory.mktemp("pg"), cleanup_mode="delete")
    uri = server.get_uri()
    with psycopg.connect(uri) as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        conn.execute(
            """
            CREATE TABLE ai_place_search (
              place_id bigint, category_group text, station text,
              name text, category text, menus jsonb,
              dong text, district text, subways jsonb, hours jsonb, price integer,
              food_type text, analyzed_review_count integer,
              lat double precision, lng double precision, facilities jsonb,
              profile jsonb, summary_vector vector(2)
            )"""
        )
        for place_id, category, station, *coords, facilities, data, vector in ROWS:
            dong, district, subways = AREAS.get(place_id, (None, None, []))
            hours, price = HOURS.get(place_id, ([], None))
            food_type, review_count = REVIEWS.get(place_id, (None, 50))
            name, naver_category, menus = MENUS.get(place_id, (None, None, []))
            conn.execute(
                "INSERT INTO ai_place_search "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::vector)",
                (
                    place_id,
                    category,
                    station,
                    name,
                    naver_category,
                    json.dumps(menu_items(menus), ensure_ascii=False),
                    dong,
                    district,
                    json.dumps(subways, ensure_ascii=False),
                    json.dumps(hours),
                    price,
                    food_type,
                    review_count,
                    *coords,
                    json.dumps(facilities),
                    json.dumps(data, ensure_ascii=False),
                    None if vector is None else f"[{vector[0]},{vector[1]}]",
                ),
            )
        # 저장 설계(V2·V6)의 user_preferences 중 AI가 읽는 컬럼과 온보딩 원본
        conn.execute(
            """
            CREATE TABLE user_preferences (
              user_id text PRIMARY KEY, mood text, priorities text[], purposes text[],
              tastes jsonb, features jsonb NOT NULL DEFAULT '[]'
            )"""
        )
        for user_id, tastes, features in TASTE_ROWS:
            conn.execute(
                "INSERT INTO user_preferences (user_id, mood, tastes, features) "
                "VALUES (%s, 'QUIET', %s, %s)",
                (user_id, json.dumps(tastes, ensure_ascii=False), json.dumps(features)),
            )
    yield uri
    server.cleanup()


@pytest.fixture(scope="module")
def store(database: str) -> Iterator[PgPlaceStore]:
    pg_store = PgPlaceStore(database)
    yield pg_store
    pg_store.close()


def find_ids(store: PgPlaceStore, place_filter: PlaceFilter, k: int = 10) -> list[int]:
    return [c.place.place_id for c in store.find(place_filter, QUERY, k).candidates]


def test_order_by_similarity(store: PgPlaceStore) -> None:
    """저장소_거르기가없으면_유사도순서로뽑고유사도를돌려준다"""
    found = store.find(PlaceFilter(), QUERY, 10)

    assert [c.place.place_id for c in found.candidates] == [1, 4, 2, 3]
    assert found.candidates[0].similarity == pytest.approx(1.0)
    assert found.candidates[-1].similarity == pytest.approx(0.6)


def test_food_type_and_review_count(store: PgPlaceStore) -> None:
    """저장소_후보마다_음식종류와분석리뷰수를읽고모르면None이다"""
    found = store.find(PlaceFilter(), QUERY, 10)

    assert {
        c.place.place_id: (c.place.info.food_type, c.place.info.review_count)
        for c in found.candidates
    } == REVIEWS


def test_places_all_readable(store: PgPlaceStore) -> None:
    """저장소_장소전체는_거르지않고벡터상태와상관없이읽을수있는곳을모두준다"""
    places = store.places()

    # 7번은 프로필 형식이 달라 빠진다. 5·6·8번은 벡터 때문에 검색에서만 빠진다.
    assert sorted(p.place_id for p in places) == [1, 2, 3, 4, 5, 6, 8]
    assert {p.place_id: p.info.review_count for p in places}[1] == 120


def test_places_reused_until_ttl(
    database: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """저장소_장소전체는_정해둔시간안에는다시읽지않고같은것을준다"""
    pg_store = PgPlaceStore(database)
    try:
        first = pg_store.places()
        assert pg_store.places() is first
        monkeypatch.setattr(pg_module, "PLACES_TTL_SECONDS", -1.0)
        assert pg_store.places() is not first
    finally:
        pg_store.close()


def test_limit_k(store: PgPlaceStore) -> None:
    """저장소_k가작으면_가까운k곳만뽑는다"""
    assert find_ids(store, PlaceFilter(), k=2) == [1, 4]


def test_map_bounds(store: PgPlaceStore) -> None:
    """저장소_지도영역이있으면_좌표안만뽑고빠진값은제한하지않는다"""
    place_filter = PlaceFilter(areas=(MapBounds(sw_lat=37.495, ne_lng=127.035),))

    assert find_ids(store, place_filter) == [1, 2]


@pytest.mark.parametrize(("place_filter", "expected"), AREA_CASES)
def test_areas(
    store: PgPlaceStore, place_filter: PlaceFilter, expected: list[int]
) -> None:
    """저장소_역동구지도영역과뺄업종이있으면_조건하나에라도드는곳을뽑는다"""
    assert find_ids(store, place_filter) == expected


def test_areas_without_subways(store: PgPlaceStore, database: str) -> None:
    """저장소_가까운역목록이없으면_수집역으로만거른다"""
    with psycopg.connect(database) as conn:
        conn.execute("UPDATE ai_place_search SET subways = NULL WHERE place_id = 4")
    try:
        found = find_ids(store, PlaceFilter(areas=(StationArea("역삼역", "YEOKSAM"),)))
    finally:
        with psycopg.connect(database) as conn:
            conn.execute(
                "UPDATE ai_place_search SET subways = %s::jsonb WHERE place_id = 4",
                (json.dumps(AREAS[4][2], ensure_ascii=False),),
            )

    assert found == [3]


@pytest.mark.parametrize(("place_filter", "expected"), HOURS_PRICE_CASES)
def test_hours_and_price(
    store: PgPlaceStore, place_filter: PlaceFilter, expected: list[int]
) -> None:
    """저장소_영업시간이나가격이있으면_안맞는다고확인된곳만빼고모르면남긴다"""
    assert find_ids(store, place_filter) == expected


@pytest.mark.parametrize(("place_filter", "expected"), MENU_CASES)
def test_menus(
    store: PgPlaceStore, place_filter: PlaceFilter, expected: list[int]
) -> None:
    """저장소_메뉴가있으면_메뉴마다찾을말하나가메뉴이름업종이름가게이름에든곳만뽑는다"""
    assert find_ids(store, place_filter) == expected


def test_facility_known_absent_excluded(store: PgPlaceStore) -> None:
    """저장소_시설을요청하면_없다고확인된곳만빼고모르는곳은남긴다"""
    place_filter = PlaceFilter(facilities=("PARKING",))

    assert find_ids(store, place_filter) == [1, 4, 3]


def test_unreadable_profile_reported(store: PgPlaceStore, database: str) -> None:
    """저장소_프로필을읽지못하면_그장소만빼고id를남긴다"""
    with psycopg.connect(database) as conn:
        conn.execute(
            'UPDATE ai_place_search SET profile = profile || \'{"schema": "x"}\' '
            "WHERE place_id = 3"
        )
    try:
        found = store.find(YEOKSAM_CAFE, QUERY, 10)
    finally:
        with psycopg.connect(database) as conn:
            conn.execute(
                "UPDATE ai_place_search SET profile = profile || "
                '\'{"schema": "place-profile/v0"}\' WHERE place_id = 3'
            )

    assert found.candidates == ()
    assert found.invalid == (3,)


def test_vector_counts(store: PgPlaceStore) -> None:
    """저장소_비교할수있는장소와_모델이다르거나질의쪽이거나벡터가없는장소를센다"""
    # 빠지는 곳: 5번(모델 다름), 6번(질의 쪽), 7번(embedding 없음), 8번(벡터 없음)
    assert store.vector_counts() == VectorCounts(comparable=4, mismatched=4)


@pytest.mark.parametrize(
    "facilities", ['["PARKING", "WIFI"]', '"PARKING"', "3", "true"]
)
def test_facilities_not_object(
    store: PgPlaceStore, database: str, facilities: str
) -> None:
    """저장소_시설이JSON객체가아니면_검색을멈추지않고그장소만뺀다"""
    with psycopg.connect(database) as conn:
        conn.execute(
            "UPDATE ai_place_search SET facilities = %s::jsonb WHERE place_id = 3",
            (facilities,),
        )
    try:
        found = store.find(YEOKSAM_CAFE, QUERY, 10)
    finally:
        with psycopg.connect(database) as conn:
            conn.execute(
                "UPDATE ai_place_search SET facilities = '{}' WHERE place_id = 3"
            )

    assert found.candidates == ()
    assert found.invalid == (3,)


def test_non_bool_facility_is_unknown(store: PgPlaceStore, database: str) -> None:
    """저장소_시설값이참거짓이아니면_모름으로읽는다"""
    with psycopg.connect(database) as conn:
        conn.execute(
            'UPDATE ai_place_search SET facilities = \'{"PARKING": "yes"}\' '
            "WHERE place_id = 3"
        )
    try:
        found = store.find(YEOKSAM_CAFE, QUERY, 10)
    finally:
        with psycopg.connect(database) as conn:
            conn.execute(
                "UPDATE ai_place_search SET facilities = '{}' WHERE place_id = 3"
            )

    assert found.candidates[0].place.info.facilities == {"PARKING": None}


def test_connection_failure() -> None:
    """저장소_접속하지못하면_StoreError다"""
    broken = PgPlaceStore("postgresql://nobody@127.0.0.1:1/none")
    try:
        with pytest.raises(StoreError, match="OperationalError|PoolTimeout"):
            broken.find(PlaceFilter(), QUERY, 1)
    finally:
        broken.close()


@pytest.fixture(scope="module")
def tastes(database: str) -> Iterator[PgTasteStore]:
    taste_store = PgTasteStore(database)
    yield taste_store
    taste_store.close()


class TestTasteStore:
    """회원 취향"""

    def test_reads_features_and_uncoded_chips(self, tastes: PgTasteStore) -> None:
        """취향저장소_회원행이있으면_계산결과와코드없는칩을취향문장으로읽는다"""
        profile = tastes.find("user-1")

        assert profile is not None
        assert profile.user_id == "user-1"
        assert [(f.code, f.like, f.weight) for f in profile.features] == [
            ("QUIET", True, 1),
            ("LIVELY", False, 1),
        ]
        # 코드가 붙은 칩은 이미 features에 있어 문장으로 다시 넣지 않는다.
        assert [(t.text, t.like, t.vector) for t in profile.free_texts] == [
            ("담백한 국물 요리를 먹을 수 있는 곳", True, (0.6, 0.8)),
            ("비싼 곳", False, None),
        ]

    def test_onboarding_only_row(self, tastes: PgTasteStore) -> None:
        """취향저장소_분석결과없이원본칩만있으면_취향없고칩은보관만하는문장이다"""
        profile = tastes.find("user-2")

        assert profile is not None
        assert profile.features == ()
        assert [(t.text, t.usable) for t in profile.free_texts] == [("넓은 데", False)]

    def test_missing_user_is_none(self, tastes: PgTasteStore) -> None:
        """취향저장소_회원행이없으면_None이다"""
        assert tastes.find("nobody") is None

    @pytest.mark.parametrize("user_id", ["user-3", "user-4"])
    def test_broken_row_raises(self, tastes: PgTasteStore, user_id: str) -> None:
        """취향저장소_가중치가범위밖이거나polarity가다르면_ValueError다"""
        with pytest.raises(ValueError):
            tastes.find(user_id)

    def test_connection_failure(self) -> None:
        """취향저장소_접속하지못하면_StoreError다"""
        broken = PgTasteStore("postgresql://nobody@127.0.0.1:1/none")
        try:
            with pytest.raises(StoreError, match="취향 저장소"):
                broken.find("user-1")
        finally:
            broken.close()
