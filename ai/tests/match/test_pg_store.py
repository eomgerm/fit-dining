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
from fit_ai.match.candidates import MapBounds, PlaceFilter, StoreError, VectorCounts

pgserver = pytest.importorskip("pgserver")
psycopg = pytest.importorskip("psycopg")

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
              lat double precision, lng double precision, facilities jsonb,
              profile jsonb, summary_vector vector(2)
            )"""
        )
        for *head, facilities, data, vector in ROWS:
            conn.execute(
                "INSERT INTO ai_place_search VALUES (%s,%s,%s,%s,%s,%s,%s,%s::vector)",
                (
                    *head,
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


def test_limit_k(store: PgPlaceStore) -> None:
    """저장소_k가작으면_가까운k곳만뽑는다"""
    assert find_ids(store, PlaceFilter(), k=2) == [1, 4]


def test_category_and_station(store: PgPlaceStore) -> None:
    """저장소_업종과역이있으면_둘다맞는곳만뽑는다"""
    place_filter = PlaceFilter(category_group="CAFE", station="GANGNAM")

    assert find_ids(store, place_filter) == [1, 2]


def test_map_bounds(store: PgPlaceStore) -> None:
    """저장소_지도영역이있으면_좌표안만뽑고빠진값은제한하지않는다"""
    place_filter = PlaceFilter(bounds=MapBounds(sw_lat=37.495, ne_lng=127.035))

    assert find_ids(store, place_filter) == [1, 2]


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
        found = store.find(PlaceFilter(station="YEOKSAM"), QUERY, 10)
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
        found = store.find(PlaceFilter(station="YEOKSAM"), QUERY, 10)
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
        found = store.find(PlaceFilter(station="YEOKSAM"), QUERY, 10)
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
