"""JSON 파일 장소 저장소를 확인한다.

`test_pg_store.py`와 같은 예시 장소와 같은 기대값을 써서 두 구현체가 같은 결과를 내는지
본다. 벡터는 2차원 가짜 값이고, 모델·리비전은 공유 모듈 `fit_ai.embedding`의 값을 쓴다.
커밋한 예시 파일(`samples/place/mock.json`)이 지금 인코더와 맞는지도 본다.
"""

import json
from pathlib import Path

import pytest

from fit_ai import embedding
from fit_ai.match.candidates import MapBounds, PlaceFilter, StoreError, VectorCounts
from fit_ai.match.json_store import JsonPlaceStore

QUERY = (1.0, 0.0)
MOCK_FILE = Path(__file__).resolve().parents[2] / "samples" / "place" / "mock.json"


def profile(
    vector: tuple[float, float] | None,
    model: str = embedding.MODEL_ID,
    prompt: str = "document",
) -> dict:
    summary: dict = {"text": "설명"}
    if vector is not None:
        summary["vector"] = list(vector)
    return {
        "schema": "place-profile/v0",
        "summary": summary,
        "embedding": {"model": model, "revision": embedding.REVISION, "prompt": prompt},
        "features": [
            {"code": "QUIET", "layer": "axis", "like_count": 5, "dislike_count": 0}
        ],
    }


# (id, 업종, 역, 위도, 경도, 시설, 프로필). test_pg_store.py의 ROWS와 같은 장소다.
ROWS = [
    (1, "CAFE", "GANGNAM", 37.50, 127.02, {"PARKING": True}, profile((1.0, 0.0))),
    (2, "CAFE", "GANGNAM", 37.51, 127.03, {"PARKING": False}, profile((0.8, 0.6))),
    (3, "CAFE", "YEOKSAM", 37.50, 127.04, {}, profile((0.6, 0.8))),
    (4, "BAR", "GANGNAM", 37.49, 127.02, {"PARKING": None}, profile((0.9, 0.44))),
    (5, "CAFE", "GANGNAM", 37.50, 127.02, {}, profile((1.0, 0.0), model="other")),
    (6, "CAFE", "GANGNAM", 37.50, 127.02, {}, profile((1.0, 0.0), prompt="query")),
    (7, "CAFE", "GANGNAM", 37.50, 127.02, {}, {"schema": "place-profile/v1"}),
    (8, "CAFE", "GANGNAM", 37.50, 127.02, {}, profile(None)),
]


def write(path: Path, rows: list) -> Path:
    keys = ("place_id", "category_group", "station", "lat", "lng", "facilities")
    data = [dict(zip(keys, head, strict=True), profile=p) for *head, p in rows]
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


def changed(row_id: int, **values: object) -> list:
    """ROWS에서 한 장소의 값만 바꾼 목록"""
    keys = ("place_id", "category_group", "station", "lat", "lng", "facilities")
    rows = []
    for row in ROWS:
        if row[0] == row_id:
            fields = dict(zip((*keys, "profile"), row, strict=True)) | values
            row = tuple(fields[k] for k in (*keys, "profile"))
        rows.append(row)
    return rows


@pytest.fixture
def store(tmp_path: Path) -> JsonPlaceStore:
    return JsonPlaceStore(write(tmp_path / "places.json", ROWS))


def find_ids(
    store: JsonPlaceStore, place_filter: PlaceFilter, k: int = 10
) -> list[int]:
    return [c.place.place_id for c in store.find(place_filter, QUERY, k).candidates]


class TestFind:
    """거르기"""

    def test_order_by_similarity(self, store: JsonPlaceStore) -> None:
        """저장소_거르기가없으면_유사도순서로뽑고유사도를돌려준다"""
        found = store.find(PlaceFilter(), QUERY, 10)

        assert [c.place.place_id for c in found.candidates] == [1, 4, 2, 3]
        assert found.candidates[0].similarity == pytest.approx(1.0)
        assert found.candidates[-1].similarity == pytest.approx(0.6)

    def test_limit_k(self, store: JsonPlaceStore) -> None:
        """저장소_k가작으면_가까운k곳만뽑는다"""
        assert find_ids(store, PlaceFilter(), k=2) == [1, 4]

    def test_category_and_station(self, store: JsonPlaceStore) -> None:
        """저장소_업종과역이있으면_둘다맞는곳만뽑는다"""
        place_filter = PlaceFilter(category_group="CAFE", station="GANGNAM")

        assert find_ids(store, place_filter) == [1, 2]

    def test_map_bounds(self, store: JsonPlaceStore) -> None:
        """저장소_지도영역이있으면_좌표안만뽑고빠진값은제한하지않는다"""
        place_filter = PlaceFilter(bounds=MapBounds(sw_lat=37.495, ne_lng=127.035))

        assert find_ids(store, place_filter) == [1, 2]

    def test_map_bounds_without_coordinates(self, tmp_path: Path) -> None:
        """저장소_지도영역이있는데좌표가없으면_SQL처럼영역밖으로본다"""
        store = JsonPlaceStore(write(tmp_path / "p.json", changed(1, lat=None)))

        assert find_ids(store, PlaceFilter(bounds=MapBounds(sw_lat=37.0))) == [4, 2, 3]

    def test_facility_known_absent_excluded(self, store: JsonPlaceStore) -> None:
        """저장소_시설을요청하면_없다고확인된곳만빼고모르는곳은남긴다"""
        place_filter = PlaceFilter(facilities=("PARKING",))

        assert find_ids(store, place_filter) == [1, 4, 3]

    def test_dimension_mismatch(self, store: JsonPlaceStore) -> None:
        """저장소_요청문벡터의차원이다르면_StoreError다"""
        with pytest.raises(StoreError):
            store.find(PlaceFilter(), (1.0, 0.0, 0.0), 10)


class TestInvalid:
    """깨진 데이터"""

    def test_unreadable_profile_reported(self, tmp_path: Path) -> None:
        """저장소_프로필을읽지못하면_그장소만빼고id를남긴다"""
        broken = profile((0.6, 0.8)) | {"schema": "x"}
        store = JsonPlaceStore(write(tmp_path / "p.json", changed(3, profile=broken)))

        found = store.find(PlaceFilter(station="YEOKSAM"), QUERY, 10)

        assert found.candidates == ()
        assert found.invalid == (3,)

    @pytest.mark.parametrize("facilities", [["PARKING", "WIFI"], "PARKING", 3, True])
    def test_facilities_not_object(self, tmp_path: Path, facilities: object) -> None:
        """저장소_시설이JSON객체가아니면_검색을멈추지않고그장소만뺀다"""
        rows = changed(3, facilities=facilities)
        store = JsonPlaceStore(write(tmp_path / "p.json", rows))

        found = store.find(PlaceFilter(station="YEOKSAM"), QUERY, 10)

        assert found.candidates == ()
        assert found.invalid == (3,)

    def test_non_bool_facility_is_unknown(self, tmp_path: Path) -> None:
        """저장소_시설값이참거짓이아니면_모름으로읽는다"""
        rows = changed(3, facilities={"PARKING": "yes"})
        store = JsonPlaceStore(write(tmp_path / "p.json", rows))

        found = store.find(PlaceFilter(station="YEOKSAM"), QUERY, 10)

        assert found.candidates[0].place.info.facilities == {"PARKING": None}

    @pytest.mark.parametrize("content", ['{"place_id": 1}', "[1, 2]", "not json"])
    def test_file_not_object_list(self, tmp_path: Path, content: str) -> None:
        """저장소_파일이객체목록이아니면_시작할때ValueError다"""
        path = tmp_path / "p.json"
        path.write_text(content, encoding="utf-8")

        with pytest.raises(ValueError):
            JsonPlaceStore(path)

    def test_place_id_not_int(self, tmp_path: Path) -> None:
        """저장소_place_id가정수가아닌장소가있으면_시작할때ValueError다"""
        path = write(tmp_path / "p.json", changed(1, place_id="mock-1"))

        with pytest.raises(ValueError, match="place_id"):
            JsonPlaceStore(path)

    def test_missing_file(self, tmp_path: Path) -> None:
        """저장소_파일이없으면_시작할때OSError다"""
        with pytest.raises(OSError):
            JsonPlaceStore(tmp_path / "none.json")


class TestCounts:
    """벡터 상태"""

    def test_vector_counts(self, store: JsonPlaceStore) -> None:
        """저장소_비교할수있는장소와_모델이다르거나질의쪽이거나벡터가없는장소를센다"""
        # 빠지는 곳: 5번(모델 다름), 6번(질의 쪽), 7번(embedding 없음), 8번(벡터 없음)
        assert store.vector_counts() == VectorCounts(comparable=4, mismatched=4)

    def test_mock_file_matches_encoder(self) -> None:
        """예시파일_지금인코더로만든벡터라_모든장소를비교할수있다"""
        store = JsonPlaceStore(MOCK_FILE)

        assert store.vector_counts() == VectorCounts(comparable=30, mismatched=0)
        assert store.find(PlaceFilter(), [1.0] * 1024, 30).invalid == ()
