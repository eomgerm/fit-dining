"""JSON 파일 장소 저장소를 확인한다.

`test_pg_store.py`와 같은 예시 장소와 같은 기대값을 써서 두 구현체가 같은 결과를 내는지
본다. 벡터는 2차원 가짜 값이고, 모델·리비전은 공유 모듈 `fit_ai.embedding`의 값을 쓴다.
커밋한 예시 파일(`samples/place/mock.json`)이 지금 인코더와 맞는지, BE Mock과 같은
장소인지도 본다.
"""

import json
from pathlib import Path

import pytest

from fit_ai import embedding
from fit_ai.match.candidates import (
    MapBounds,
    OpenHours,
    PlaceFilter,
    RadiusArea,
    RegionArea,
    StationArea,
    StoreError,
    VectorCounts,
    distance_m,
)
from fit_ai.match.json_store import JsonPlaceStore

QUERY = (1.0, 0.0)
MOCK_FILE = Path(__file__).resolve().parents[2] / "samples" / "place" / "mock.json"
BE_MOCK_FILE = (
    Path(__file__).resolve().parents[3] / "be/src/main/resources/mock/places.json"
)


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

# 장소별 (동, 구, 가까운 역). 비교할 수 있는 1~4번에만 둔다. 2번은 강남에서 수집했지만 가장
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

# 장소별 (영업시간, 가게 가격). test_pg_store.py와 같다. 1번은 매일 22시까지, 2번은
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
# 장소별 (음식 종류, 분석 리뷰 수). test_pg_store.py와 같다. 3번은 리뷰 수를 모른다.
REVIEWS = {1: ("FOOD_WESTERN", 120), 2: (None, 80), 3: (None, None), 4: (None, 100)}

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

# 장소별 (가게 이름, 네이버 업종 이름, 메뉴판). test_pg_store.py와 같다. 3번은 메뉴판이 없다.
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

SOUTH_4 = distance_m(37.50, 127.02, 37.49, 127.02)
"""1번 장소(37.50, 127.02)에서 4번 장소(37.49, 127.02)까지의 거리(m)"""

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
    # 사용자 위치(1번 자리)에서 1km 안. 4번은 남쪽으로 약 1,112m라 빠진다.
    (PlaceFilter(areas=(RadiusArea(37.50, 127.02),)), [1]),
    # 반경 경계. 4번까지의 거리보다 0.5m 길면 들고 0.5m 짧으면 빠진다.
    (PlaceFilter(areas=(RadiusArea(37.50, 127.02, SOUTH_4 + 0.5),)), [1, 4]),
    (PlaceFilter(areas=(RadiusArea(37.50, 127.02, SOUTH_4 - 0.5),)), [1]),
]


def write(path: Path, rows: list) -> Path:
    keys = ("place_id", "category_group", "station", "lat", "lng", "facilities")
    area_keys = ("dong", "district", "subways")
    data = [
        dict(zip(keys, head, strict=True))
        | dict(zip(area_keys, AREAS.get(head[0], (None, None, [])), strict=True))
        | dict(zip(("hours", "price"), HOURS.get(head[0], ([], None)), strict=True))
        | dict(
            zip(
                ("food_type", "analyzed_review_count"),
                REVIEWS.get(head[0], (None, 50)),
                strict=True,
            )
        )
        | _menu_fields(head[0])
        | {"profile": p}
        for *head, p in rows
    ]
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


def _menu_fields(place_id: int) -> dict:
    name, category, names = MENUS.get(place_id, (None, None, []))
    return {"name": name, "category": category, "menus": menu_items(names)}


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

    def test_food_type_and_review_count(self, store: JsonPlaceStore) -> None:
        """저장소_후보마다_음식종류와분석리뷰수를읽고모르면None이다"""
        found = store.find(PlaceFilter(), QUERY, 10)

        assert {
            c.place.place_id: (c.place.info.food_type, c.place.info.review_count)
            for c in found.candidates
        } == REVIEWS

    def test_excluded_food_types(self, store: JsonPlaceStore) -> None:
        """저장소_빼는음식종류가있으면_그종류로확인된곳만빼고모르면남긴다"""
        assert find_ids(store, PlaceFilter(excluded_food_types=("FOOD_WESTERN",))) == [
            4,
            2,
            3,
        ]
        assert find_ids(store, PlaceFilter(excluded_food_types=("FOOD_KOREAN",))) == [
            1,
            4,
            2,
            3,
        ]

    def test_details(self, store: JsonPlaceStore) -> None:
        """저장소_장소정보는_영업시간과메뉴판과이름과가격을읽고없는id는뺀다"""
        details = store.details([1, 3, 99])

        assert set(details) == {1, 3}
        assert details[1].name == "도치피자 강남"
        assert details[1].category == "피자"
        assert details[1].menus == ("[대표] 마르게리따 피자", "크림 파스타")
        assert [h.day for h in details[1].hours][:2] == ["MON", "TUE"]
        assert details[1].hours[0].open == "10:00"
        assert details[1].hours[0].closed is False
        assert details[3].menus == ()
        assert details[1].price == 9000
        assert details[3].price is None
        assert details[3].hours[0].open is None

    def test_places_all_readable(self, store: JsonPlaceStore) -> None:
        """저장소_장소전체는_거르지않고벡터상태와상관없이읽을수있는곳을모두준다"""
        places = store.places()

        # 7번은 프로필 형식이 달라 빠진다. 5·6·8번은 벡터 때문에 검색에서만 빠진다.
        assert sorted(p.place_id for p in places) == [1, 2, 3, 4, 5, 6, 8]
        assert store.places() is places

    def test_limit_k(self, store: JsonPlaceStore) -> None:
        """저장소_k가작으면_가까운k곳만뽑는다"""
        assert find_ids(store, PlaceFilter(), k=2) == [1, 4]

    def test_map_bounds(self, store: JsonPlaceStore) -> None:
        """저장소_지도영역이있으면_좌표안만뽑고빠진값은제한하지않는다"""
        place_filter = PlaceFilter(areas=(MapBounds(sw_lat=37.495, ne_lng=127.035),))

        assert find_ids(store, place_filter) == [1, 2]

    def test_map_bounds_without_coordinates(self, tmp_path: Path) -> None:
        """저장소_지도영역이있는데좌표가없으면_SQL처럼영역밖으로본다"""
        store = JsonPlaceStore(write(tmp_path / "p.json", changed(1, lat=None)))
        place_filter = PlaceFilter(areas=(MapBounds(sw_lat=37.0),))

        assert find_ids(store, place_filter) == [4, 2, 3]

    def test_distance_formula(self) -> None:
        """거리_위도0점01도는약1112m이고북위37점5도에서경도0점01도는약882m다"""
        # 경도 1도의 길이는 위도의 cos만큼 줄어든다(cos 37.5도 = 0.793).
        assert distance_m(37.50, 127.02, 37.49, 127.02) == pytest.approx(
            1111.95, abs=0.01
        )
        assert distance_m(37.50, 127.02, 37.50, 127.03) == pytest.approx(
            882.17, abs=0.01
        )

    def test_radius_without_coordinates(self, tmp_path: Path) -> None:
        """저장소_사용자위치반경이있는데좌표가없으면_SQL처럼반경밖으로본다"""
        store = JsonPlaceStore(write(tmp_path / "p.json", changed(1, lat=None)))
        place_filter = PlaceFilter(areas=(RadiusArea(37.50, 127.02),))

        assert find_ids(store, place_filter) == []

    @pytest.mark.parametrize(("place_filter", "expected"), AREA_CASES)
    def test_areas(
        self, store: JsonPlaceStore, place_filter: PlaceFilter, expected: list[int]
    ) -> None:
        """저장소_역동구지도영역과뺄업종이있으면_test_pg_store와같은장소를뽑는다"""
        assert find_ids(store, place_filter) == expected

    def test_areas_without_subways(self, tmp_path: Path) -> None:
        """저장소_가까운역목록이없거나모양이틀리면_수집역으로만거른다"""
        rows = changed(1, station="YEOKSAM")
        path = write(tmp_path / "p.json", rows)
        data = json.loads(path.read_text(encoding="utf-8"))
        data[0]["subways"], data[3]["subways"] = None, ["역삼역"]
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        store = JsonPlaceStore(path)

        assert find_ids(
            store, PlaceFilter(areas=(StationArea("역삼역", "YEOKSAM"),))
        ) == [1, 3]

    @pytest.mark.parametrize(("place_filter", "expected"), HOURS_PRICE_CASES)
    def test_hours_and_price(
        self, store: JsonPlaceStore, place_filter: PlaceFilter, expected: list[int]
    ) -> None:
        """저장소_영업시간이나가격이있으면_test_pg_store와같은장소를뽑는다"""
        assert find_ids(store, place_filter) == expected

    def test_hours_and_price_malformed(self, tmp_path: Path) -> None:
        """저장소_영업시간이나가격모양이틀리면_모름으로보고남긴다"""
        path = write(tmp_path / "p.json", ROWS)
        data = json.loads(path.read_text(encoding="utf-8"))
        data[0]["hours"] = [{"day": "MON", "open": "열시", "close": "22:00"}, "월"]
        data[0]["price"] = "9000원"
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        store = JsonPlaceStore(path)
        place_filter = PlaceFilter(
            hours=OpenHours(since=8 * 60), min_price=18000, max_price=20000
        )

        assert find_ids(store, place_filter) == [1, 3]

    @pytest.mark.parametrize(("place_filter", "expected"), MENU_CASES)
    def test_menus(
        self, store: JsonPlaceStore, place_filter: PlaceFilter, expected: list[int]
    ) -> None:
        """저장소_메뉴가있으면_test_pg_store와같은장소를뽑는다"""
        assert find_ids(store, place_filter) == expected

    def test_menus_malformed(self, tmp_path: Path) -> None:
        """저장소_메뉴판모양이틀리면_그메뉴는건너뛰고업종과가게이름으로만본다"""
        path = write(tmp_path / "p.json", ROWS)
        data = json.loads(path.read_text(encoding="utf-8"))
        data[0]["menus"] = ["피자", {"name": 3}, {"name": "파스타"}]
        data[1]["menus"] = {"name": "돈까스"}
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        store = JsonPlaceStore(path)

        assert find_ids(store, PlaceFilter(menus=(("파스타",),))) == [1]
        assert find_ids(store, PlaceFilter(menus=(("피자",),))) == [1]
        assert find_ids(store, PlaceFilter(menus=(("돈까스",),))) == []

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

        found = store.find(YEOKSAM_CAFE, QUERY, 10)

        assert found.candidates == ()
        assert found.invalid == (3,)

    @pytest.mark.parametrize("facilities", [["PARKING", "WIFI"], "PARKING", 3, True])
    def test_facilities_not_object(self, tmp_path: Path, facilities: object) -> None:
        """저장소_시설이JSON객체가아니면_검색을멈추지않고그장소만뺀다"""
        rows = changed(3, facilities=facilities)
        store = JsonPlaceStore(write(tmp_path / "p.json", rows))

        found = store.find(YEOKSAM_CAFE, QUERY, 10)

        assert found.candidates == ()
        assert found.invalid == (3,)

    def test_non_bool_facility_is_unknown(self, tmp_path: Path) -> None:
        """저장소_시설값이참거짓이아니면_모름으로읽는다"""
        rows = changed(3, facilities={"PARKING": "yes"})
        store = JsonPlaceStore(write(tmp_path / "p.json", rows))

        found = store.find(YEOKSAM_CAFE, QUERY, 10)

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
        count = len(json.loads(MOCK_FILE.read_text(encoding="utf-8")))
        store = JsonPlaceStore(MOCK_FILE)

        assert store.vector_counts() == VectorCounts(comparable=count, mismatched=0)
        assert store.find(PlaceFilter(), [1.0] * 1024, count).invalid == ()


class TestMockFile:
    """예시 파일"""

    def test_mock_file_matches_be_mock(self) -> None:
        """예시파일_BE_Mock과_장소id·업종·역이같다"""
        # 검색 응답에는 placeId만 있어 BE가 자기 Mock에서 가게를 찾는다.
        rows = json.loads(MOCK_FILE.read_text(encoding="utf-8"))
        be_places = json.loads(BE_MOCK_FILE.read_text(encoding="utf-8"))["places"]

        ours = {(r["place_id"], r["category_group"], r["station"]) for r in rows}
        be = {
            (p["id"], p["categoryGroup"], p["station"])
            for p in (place["card"]["place"] for place in be_places)
        }
        assert ours == be, (
            "BE Mock이 바뀌었다. scripts/dev_db.py --json으로 예시 파일을 다시 만든다"
        )
