"""Postgres 장소 저장소를 실제 SQL로 확인한다.

pgserver(개발 의존성)로 임시 Postgres(pgvector)를 띄우고, 뷰 `ai_place_search`와 같은
컬럼의 테이블을 만들어 거르기, 유사도 순서, 모델 확인, 깨진 프로필을 본다.
벡터는 2차원 가짜 값이고, 모델·리비전은 공유 모듈 `fit_ai.embedding`의 값을 쓴다.
"""

import json
from collections.abc import Iterator

import pytest

from fit_ai import embedding
from fit_ai.match.candidates import MapBounds, PlaceFilter, StoreError, VectorCounts

pgserver = pytest.importorskip("pgserver")
psycopg = pytest.importorskip("psycopg")

from fit_ai.match.pg_store import PgPlaceStore

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
