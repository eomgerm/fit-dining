"""요청 해석부터 카드 만들기까지 잇는 검색 한 번을 확인한다.

거르기 조건 만들기(지역 우선순위 포함), 점수 순서(취향, 점수 없음, 근처 검색), 후보 없음,
인코딩·저장소 실패와 결과 없음 문구를 본다. 공유 모듈 `fit_ai.embedding`, `fit_ai.gms`는 가짜로
바꿔 끼우고 장소 저장소도 가짜다. 점수 기준은 가짜 저장소의 장소 전체(기본은 후보 세 곳)로
만든다.
"""

from collections.abc import Callable, Sequence

import pytest

from fit_ai import embedding, gms
from fit_ai.match import interpretation
from fit_ai.match.candidates import (
    Candidate,
    Found,
    MapBounds,
    OpenHours,
    PlaceFilter,
    RegionArea,
    StationArea,
    StoreError,
)
from fit_ai.match.cards import Source
from fit_ai.match.conditions import Layer
from fit_ai.match.interpretation import Conditions
from fit_ai.match.interpretation.segments import (
    Hours,
    Location,
    LocationKind,
    Menu,
    Price,
)
from fit_ai.match.place import ConditionEvidence, Place, PlaceInfo
from fit_ai.match.search import (
    EmbeddingError,
    SearchRequest,
    SearchResult,
    _where,
    empty_reason,
    menu_terms,
    open_hours,
    price_range,
    search,
)
from fit_ai.match.taste_select import TasteFeature, TasteProfile

QUERY = "강남역 조용한 카페"

INTERPRETED = {
    "text": None,
    "embedding_text": "강남역 조용한 카페",
    "codes": ["QUIET"],
    "category_group": "CAFE",
    "station": "GANGNAM",
    "nearby": False,
    "change_summary": None,
}


def make_candidate(place_id: int, similarity: float, quiet: int) -> Candidate:
    """리뷰 100건 중 `quiet`건이 조용하다고 한 강남역 카페 후보"""
    place = Place(
        place_id=place_id,
        info=PlaceInfo(place_id, "CAFE", "GANGNAM", {}, review_count=100),
        summary=f"설명 {place_id}",
        conditions={"QUIET": ConditionEvidence(pos=quiet)},
    )
    return Candidate(place, similarity)


CANDIDATES = (
    make_candidate(1, 1.0, quiet=2),
    make_candidate(2, 0.8, quiet=10),
    make_candidate(3, 0.6, quiet=5),
)
"""유사도는 1번이 가장 높고, 조용하다는 리뷰는 2번 > 3번 > 1번이다. 세 곳을 견준 조용함 조건
점수는 0.80, 0.45, 0.19다(점수 모듈이 계산한 값)."""

TASTE = TasteProfile(
    user_id="u1",
    features=(
        TasteFeature("QUIET", Layer.AXIS, True, 1),
        TasteFeature("LIVELY", Layer.AXIS, False, 1),
        TasteFeature("PURPOSE_WORK", Layer.PURPOSE, True, 1),
    ),
    free_texts=(),
)

FakeGms = Callable[[Callable[[list[dict]], object]], list[list[dict]]]


class FakeStore:
    """정해 둔 후보를 돌려주고 받은 거르기 조건, 요청문 벡터, k를 남긴다.

    `matches`가 거짓인 거르기 조건에는 아무 곳도 돌려주지 않는다. 점수 기준을 만들 장소
    전체는 후보의 장소다. `places_fail`이면 장소 전체를 읽지 못한다.
    """

    def __init__(
        self,
        candidates: Sequence[Candidate] = CANDIDATES,
        invalid: tuple[int, ...] = (),
        fail: bool = False,
        matches: Callable[[PlaceFilter], bool] = lambda place_filter: True,
        places_fail: bool = False,
    ) -> None:
        self.candidates = tuple(candidates)
        self.invalid = invalid
        self.fail = fail
        self.matches = matches
        self.places_fail = places_fail
        self.calls: list[tuple[PlaceFilter, Sequence[float], int]] = []

    def places(self) -> tuple[Place, ...]:
        if self.places_fail:
            raise StoreError("장소 저장소를 읽지 못했다: OperationalError")
        return tuple(c.place for c in self.candidates)

    def find(self, place_filter: PlaceFilter, query: Sequence[float], k: int) -> Found:
        if self.fail:
            raise StoreError("장소 저장소를 읽지 못했다: OperationalError")
        self.calls.append((place_filter, query, k))
        if not self.matches(place_filter):
            return Found(())
        return Found(self.candidates[:k], self.invalid)

    def mismatched(self) -> int:
        return 0


@pytest.fixture(autouse=True)
def encoder(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    """공유 모듈의 요청문 인코딩을 같은 벡터를 내는 가짜로 바꾼다."""
    seen: list[list[str]] = []

    def encode_queries(texts: list[str]) -> list[list[float]]:
        seen.append(texts)
        return [[1.0, 0.0] for _ in texts]

    monkeypatch.setattr(embedding, "encode_queries", encode_queries)
    return seen


def answers(**interpreted: object) -> Callable[[list[dict]], object]:
    """가짜 GMS 답. 해석에는 정해 둔 조건으로 답하고, 그 밖의 호출에는 None(실패)이다."""

    def answer(messages: list[dict]) -> object:
        if messages[0]["content"] == interpretation.SYSTEM_PROMPT:
            return {**INTERPRETED, **interpreted}
        return None

    return answer


def other_calls(calls: list[list[dict]]) -> int:
    """GMS 호출 중 해석이 아닌 호출 수. 정렬 LLM이 빠져 늘 0이어야 한다."""
    return sum(m[0]["content"] != interpretation.SYSTEM_PROMPT for m in calls)


def run(store: FakeStore | None = None, **request: object) -> SearchResult:
    return search(
        SearchRequest(QUERY, **request),  # type: ignore[arg-type]
        store or FakeStore(),
    )


def scores(result: SearchResult) -> list[tuple[int, int | None]]:
    return [(card.place_id, card.score) for card in result.cards]


def areas_of(store: FakeStore) -> tuple:
    """처음 뽑을 때 거른 지역"""
    place_filter, _, _ = store.calls[0]
    return place_filter.areas


GANGNAM = StationArea("강남역", "GANGNAM")
BOUNDS = MapBounds(sw_lat=37.49, ne_lng=127.04)
PREVIOUS = Conditions.from_codes(
    "강남역 조용한 카페", "조용한 카페", ("QUIET",), "CAFE", "GANGNAM"
)
"""1차 꼴의 이전 조건(지역 조각 없이 역만 있다)"""


def location(text: str, kind: str, value: str | None = None, **extra: object) -> dict:
    """LLM이 내는 지역 조각"""
    return {"text": text, "kind": kind, "value": value, **extra}


class TestFilter:
    """거르기 조건과 요청문 벡터"""

    def test_from_conditions(self, fake_gms: FakeGms, encoder: list) -> None:
        """거르기_해석한업종역시설로_벡터용문장벡터와함께점수를매길100곳을뽑는다"""
        fake_gms(answers(codes=["QUIET", "PARKING"]))
        store = FakeStore()

        run(store)

        # 벡터용 문장의 위치 말은 해석이 지운다. 역은 거르기에만 쓴다.
        assert encoder == [["조용한 카페"]]
        assert store.calls == [
            (
                PlaceFilter(
                    category_group="CAFE", areas=(GANGNAM,), facilities=("PARKING",)
                ),
                [1.0, 0.0],
                100,
            )
        ]

    def test_avoided_category_excluded(self, fake_gms: FakeGms) -> None:
        """거르기_빼달라는업종이있으면_그업종을뺀다"""
        fake_gms(
            answers(
                category_group=None,
                avoid_categories=["BAR"],
            )
        )
        store = FakeStore()

        search(SearchRequest("강남역 조용한 곳 술집 말고"), store)

        place_filter, _, _ = store.calls[0]
        assert place_filter.excluded_categories == ("BAR",)

    def test_hours_and_price(self, fake_gms: FakeGms) -> None:
        """거르기_시간과가격이있으면_영업시간조건하나와여유폭을둔가격범위로거른다"""
        fake_gms(
            answers(
                hours=[
                    {"text": "일요일", "day": "SUN"},
                    {"text": "새벽까지", "open_until": "02:00"},
                ],
                price={"text": "2만원 이하", "max_won": 20000},
            )
        )
        store = FakeStore()

        search(SearchRequest("일요일 새벽까지 2만원 이하 술집"), store)

        place_filter, _, _ = store.calls[0]
        assert place_filter.hours == OpenHours(("SUN",), until=26 * 60)
        assert (place_filter.min_price, place_filter.max_price) == (None, 22000)

    def test_menus(self, fake_gms: FakeGms) -> None:
        """거르기_메뉴가있으면_메뉴마다찾을말로거르고넓은말과피하는메뉴는거르지않는다"""
        fake_gms(
            answers(
                codes=[],
                category_group="RESTAURANT",
                menus=[
                    {"text": "돈까스", "value": "돈가스", "spellings": ["돈카츠"]},
                    {"text": "맥주", "value": "맥주"},
                    {"text": "오이", "value": "오이", "want": False},
                ],
            )
        )
        store = FakeStore()

        search(SearchRequest("강남역 돈까스에 맥주 오이 빼고"), store)

        place_filter, _, _ = store.calls[0]
        assert place_filter.menus == (("돈까스", "돈가스", "돈카츠"),)

    @pytest.mark.parametrize(
        ("menus", "expected"),
        [
            # 띄어쓰기와 기호를 지우고 영문은 소문자로 바꾼다. 같은 말은 한 번만 둔다.
            ([Menu("등심 돈까스", "등심돈가스")], (("등심돈까스", "등심돈가스"),)),
            ([Menu("IPA", "IPA 맥주")], (("ipa", "ipa맥주"),)),
            (
                [Menu("삼겹살", "삼겹살"), Menu("냉면", "냉면")],
                (("삼겹살",), ("냉면",)),
            ),
            # 사용자 말이나 표준 이름이 넓은 말이면 거르지 않는다.
            ([Menu("마실 거", "음료")], ()),
            ([Menu("커피", "커피")], ()),
            ([Menu("일식", "일식")], ()),
            ([Menu("오이", "오이", want=False)], ()),
            ([Menu("!!", "")], ()),
        ],
    )
    def test_menu_terms(self, menus: list[Menu], expected: tuple) -> None:
        """거르기_메뉴조각을_메뉴마다견주는꼴의찾을말묶음으로바꾼다"""
        assert menu_terms(menus) == expected

    @pytest.mark.parametrize(
        ("hours", "expected"),
        [
            # 새벽 시각은 다음 날로, 자정은 24시로 본다.
            ([Hours("새벽까지", open_until="02:00")], OpenHours(until=26 * 60)),
            ([Hours("밤 11시까지", open_until="23:00")], OpenHours(until=23 * 60)),
            ([Hours("자정까지", open_until="00:00")], OpenHours(until=24 * 60)),
            (
                [
                    Hours("토요일", day="SAT"),
                    Hours("일요일", day="SUN"),
                    Hours("아침 8시 전", open_from="08:00"),
                    Hours("10시 전", open_from="10:00"),
                ],
                OpenHours(("SAT", "SUN"), since=8 * 60),
            ),
            ([Hours("지금 여는", now=True)], None),
            ([], None),
        ],
    )
    def test_open_hours(self, hours: list[Hours], expected: object) -> None:
        """거르기_시간조각을_요일과마감시작시각하나로합친다"""
        assert open_hours(hours) == expected

    @pytest.mark.parametrize(
        ("price", "expected"),
        [
            (Price("2만원대", min_won=20000, max_won=29999), (18000, 32999)),
            (Price("만원 이하", max_won=10000), (None, 11000)),
            (Price("저렴한", cheap=True), (None, None)),
            (None, (None, None)),
        ],
    )
    def test_price_range(self, price: Price | None, expected: tuple) -> None:
        """거르기_가격조각을_양쪽에여유폭10퍼센트를둔범위로바꾸고저렴한은거르지않는다"""
        assert price_range(price) == expected


class TestWhere:
    """거를 지역. 이번 요청에 말한 지역 > 지도 영역 > 이전 요청의 지역"""

    @pytest.mark.parametrize(
        ("turn_locations", "bounds", "areas"),
        [
            # 이번 요청에 지역이 없으면 이전 역보다 지도 영역이 앞선다. 이전 역 이름이
            # 요청문에 섞여 있는지는 보지 않는다(이번 요청의 조건만 본다).
            ((), BOUNDS, (BOUNDS,)),
            ((), None, (GANGNAM,)),
            ((Location("근처", LocationKind.HERE),), BOUNDS, (BOUNDS,)),
            ((Location("회사 근처", LocationKind.UNKNOWN),), None, (GANGNAM,)),
            (
                (Location("역삼역", LocationKind.STATION, "역삼역"),),
                BOUNDS,
                (StationArea("역삼역", "YEOKSAM"),),
            ),
        ],
    )
    def test_turn_locations(
        self,
        turn_locations: tuple[Location, ...],
        bounds: MapBounds | None,
        areas: tuple,
    ) -> None:
        """지역_이번요청의조건에말한지역이있으면_그지역이고없으면지도영역다음이전지역이다"""
        turn = Conditions("요청", "요청", locations=turn_locations)

        assert _where(PREVIOUS, turn, bounds).areas == areas

    def test_said_location_beats_map_bounds(self, fake_gms: FakeGms) -> None:
        """지역_이번요청에역을말하면_지도영역이있어도역으로거른다"""
        fake_gms(answers())
        store = FakeStore()

        run(store, bounds=BOUNDS)

        assert areas_of(store) == (GANGNAM,)

    def test_map_bounds_beat_previous_location(self, fake_gms: FakeGms) -> None:
        """지역_이번요청에지역이없고지도영역이있으면_이전역대신지도영역으로거른다"""
        # 해석은 이전 역을 이어 붙인다.
        fake_gms(answers())
        store = FakeStore()

        search(
            SearchRequest("주차되는 데로", previous=PREVIOUS, bounds=BOUNDS),
            store,
        )

        assert areas_of(store) == (BOUNDS,)

    def test_previous_location_without_bounds(self, fake_gms: FakeGms) -> None:
        """지역_이번요청에지역도지도영역도없으면_이전역으로거른다"""
        fake_gms(answers())
        store = FakeStore()

        search(SearchRequest("주차되는 데로", previous=PREVIOUS), store)

        assert areas_of(store) == (GANGNAM,)

    def test_new_location_in_follow_up(self, fake_gms: FakeGms) -> None:
        """지역_후속조건에서다른역을말하면_지도영역보다그역이앞선다"""
        fake_gms(answers(station="YEOKSAM"))
        store = FakeStore()

        search(
            SearchRequest("역삼역으로 바꿔줘", previous=PREVIOUS, bounds=BOUNDS),
            store,
        )

        assert areas_of(store) == (StationArea("역삼역", "YEOKSAM"),)

    def test_here_uses_map_bounds(self, fake_gms: FakeGms) -> None:
        """지역_근처를말하고지도영역이있으면_지도영역으로100곳을뽑는다"""
        fake_gms(answers(nearby=True, station=None))
        store = FakeStore()

        search(SearchRequest("근처 조용한 카페", bounds=BOUNDS), store)

        assert (areas_of(store), store.calls[0][2]) == ((BOUNDS,), 100)

    def test_many_locations_with_walk_and_exit(self, fake_gms: FakeGms) -> None:
        """지역_역이여럿이고도보거리와출구가있으면_역마다그대로거른다"""
        locations = [
            location("강남역 11번 출구", "STATION", "강남역", exit="11"),
            location("신논현역 걸어서 5분", "STATION", "신논현역", walk_minutes=5),
        ]
        fake_gms(answers(station=None, locations=locations))
        store = FakeStore()

        query = "강남역 11번 출구나 신논현역 걸어서 5분 카페"
        search(SearchRequest(query), store)

        assert areas_of(store) == (
            StationArea("강남역", "GANGNAM", exit="11"),
            StationArea("신논현역", walk_minutes=5),
        )

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("역삼동", RegionArea("역삼동", "YEOKSAM")),
            ("역삼1동", RegionArea("역삼동", "YEOKSAM")),
            ("대치동", RegionArea("대치동")),
            ("강남구", RegionArea("강남구")),
            ("강남", GANGNAM),
        ],
    )
    def test_region(self, fake_gms: FakeGms, value: str, expected: object) -> None:
        """지역_동이나구면_행정구역으로거르고서비스역이름이면_역으로거른다"""
        locations = [location(value, "AREA", value)]
        fake_gms(answers(station=None, locations=locations))
        store = FakeStore()

        search(SearchRequest(f"{value} 조용한 카페"), store)

        assert areas_of(store) == (expected,)

    def test_landmark_only_not_searched(self, fake_gms: FakeGms, encoder: list) -> None:
        """지역_랜드마크만말하면_찾지않고준비중인지역이라고한다"""
        locations = [location("코엑스", "AREA", "코엑스")]
        calls = fake_gms(answers(station=None, locations=locations))
        store = FakeStore()

        result = search(SearchRequest("코엑스 조용한 카페"), store)

        assert (store.calls, encoder, other_calls(calls)) == ([], [], 0)
        assert result.cards == ()
        assert result.empty_reason is not None
        assert result.empty_reason.cause == "코엑스는 아직 준비 중인 지역이에요"

    def test_landmark_with_station(self, fake_gms: FakeGms) -> None:
        """지역_랜드마크와역을같이말하면_역으로만거른다"""
        locations = [
            location("코엑스", "AREA", "코엑스"),
            location("선릉역", "STATION", "선릉역"),
        ]
        fake_gms(answers(station=None, locations=locations))
        store = FakeStore()

        result = search(SearchRequest("코엑스나 선릉역 카페"), store)

        assert areas_of(store) == (StationArea("선릉역", "SEOLLEUNG"),)
        assert len(result.cards) == 3

    def test_station_without_places(self, fake_gms: FakeGms) -> None:
        """지역_장소가하나도없는역이면_준비중인지역이라고한다"""
        locations = [location("홍대", "STATION", "홍대입구역")]
        fake_gms(answers(station=None, locations=locations))
        store = FakeStore(candidates=())

        result = search(SearchRequest("홍대 조용한 카페"), store)

        # 처음 뽑기와, 도보 거리·업종 없이 그 역에 장소가 있는지 본 것
        assert [(f.areas, f.category_group, k) for f, _, k in store.calls] == [
            ((StationArea("홍대입구역"),), "CAFE", 100),
            ((StationArea("홍대입구역"),), None, 1),
        ]
        assert result.empty_reason is not None
        assert result.empty_reason.cause == "홍대입구역은 아직 준비 중인 지역이에요"
        assert result.empty_reason.suggestion == (
            "강남역, 역삼역, 선릉역 근처에서 찾아 보세요"
        )


class TestScoring:
    """핏 점수와 순서"""

    def test_orders_by_score(self, fake_gms: FakeGms) -> None:
        """검색_일반검색이면_GMS는해석에만쓰고조건점수로순서와핏점수를정한다"""
        calls = fake_gms(answers())

        result = run()

        # 유사도는 1번이 가장 높지만 조용하다는 리뷰가 많은 순서(2, 3, 1)로 놓인다.
        assert scores(result) == [(2, 80), (3, 45), (1, 19)]
        assert other_calls(calls) == 0
        assert result.interpretation.llm_error is None
        assert result.empty_reason is None
        assert result.trace.candidates == 3

    def test_liked_taste_in_score_and_card(self, fake_gms: FakeGms) -> None:
        """검색_요청에소음조건이있으면_소음취향은빼고남은좋아함취향을점수와카드항목에넣는다"""
        fake_gms(answers())

        result = run(taste=TASTE)

        # 작업 근거는 세 곳 모두 없어 가운데(0.5)다. 핏 = 0.7 × 요청 + 0.3 × 0.5
        assert scores(result) == [(2, 71), (3, 47), (1, 29)]
        items = [(i.condition_id, i.source) for i in result.cards[0].score_items]
        assert items == [
            ("QUIET", Source.REQUEST),
            ("PURPOSE_WORK", Source.PREFERENCE),
        ]

    def test_disliked_taste_lowers_score_not_card(self, fake_gms: FakeGms) -> None:
        """검색_조건없는요청에서조용한곳을싫어하면_조용한곳일수록낮고카드항목에는없다"""
        fake_gms(answers(codes=[]))
        taste = TasteProfile(
            "u1", (TasteFeature("QUIET", Layer.AXIS, False, 1),), free_texts=()
        )

        result = run(taste=taste)

        assert scores(result) == [(1, 81), (3, 55), (2, 20)]
        assert all(card.score_items == () for card in result.cards)

    def test_nothing_to_judge_no_score(self, fake_gms: FakeGms) -> None:
        """검색_판정할요청조각도취향도없으면_점수없이유사도순서다"""
        fake_gms(answers(codes=[]))

        result = run()

        assert scores(result) == [(1, None), (2, None), (3, None)]

    def test_nearby_scores_the_same_way(self, fake_gms: FakeGms) -> None:
        """검색_근처검색이면_역으로거르지않고100곳을뽑아같은점수로정렬한다"""
        calls = fake_gms(answers(nearby=True, station=None))
        store = FakeStore()

        # 요청문에 역이 있으면 역이 근처보다 앞서므로 근처 말만 있는 요청문을 쓴다.
        result = search(SearchRequest("근처 조용한 카페"), store)

        place_filter, _, k = store.calls[0]
        assert (place_filter.areas, k) == ((), 100)
        assert other_calls(calls) == 0
        assert scores(result) == [(2, 80), (3, 45), (1, 19)]

    def test_general_returns_top_20_by_score(self, fake_gms: FakeGms) -> None:
        """검색_일반검색이면_뽑은후보모두에점수를매기고점수순으로20곳을준다"""
        fake_gms(answers())
        # 유사도가 낮은 곳일수록 조용하다는 리뷰가 많다.
        many = [make_candidate(i, 1 - i / 100, quiet=i) for i in range(1, 26)]

        result = run(FakeStore(many))

        assert [card.place_id for card in result.cards] == list(range(25, 5, -1))

    def test_interpret_failure_still_scores(self, fake_gms: FakeGms) -> None:
        """검색_해석에서GMS호출이실패해도_규칙해석으로조건점수를내고정렬한다"""
        calls = fake_gms(lambda messages: None)

        result = run()

        assert result.interpretation.gms_failed is True
        assert other_calls(calls) == 0
        assert [card.place_id for card in result.cards] == [2, 3, 1]

    def test_timeout_and_client_for_interpretation(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """검색_GMS는해석에서한번만_받은대기시간과클라이언트로부른다"""
        seen: list[tuple[float, object]] = []
        answer = answers()

        def call_json(
            messages, parse, *, response_format=None, timeout=10.0, client=None
        ):
            seen.append((timeout, client))
            return parse(answer(messages))

        monkeypatch.setattr(gms, "call_json", call_json)
        client = object()

        search(SearchRequest(QUERY), FakeStore(), 5.0, client)  # type: ignore[arg-type]

        assert seen == [(5.0, client)]

    def test_places_failure(self, fake_gms: FakeGms) -> None:
        """검색_점수기준을만들장소를읽지못하면_StoreError를그대로낸다"""
        fake_gms(answers())

        with pytest.raises(StoreError):
            run(FakeStore(places_fail=True))


class TestEmptyAndFailures:
    """결과 없음과 실패"""

    def test_no_candidates(self, fake_gms: FakeGms) -> None:
        """검색_뽑힌장소가없으면_점수를내지않고결과없음이유를준다"""
        calls = fake_gms(answers(codes=["PARKING"]))

        # 강남역에 장소는 있지만 주차 조건에 맞는 곳이 없다.
        result = run(
            FakeStore(matches=lambda place_filter: not place_filter.facilities)
        )

        assert result.cards == ()
        assert other_calls(calls) == 0
        assert result.empty_reason is not None
        assert result.empty_reason.cause == "강남역 카페 중 주차할 수 있는 곳이 없어요"

    def test_invalid_profiles_reported(self, fake_gms: FakeGms) -> None:
        """검색_저장소가읽지못한프로필이있으면_그id를결과에담는다"""
        fake_gms(answers())

        result = run(FakeStore(invalid=(7,)))

        assert result.invalid_place_ids == (7,)
        assert len(result.cards) == 3

    def test_embedding_failure(
        self, fake_gms: FakeGms, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """검색_원격임베딩이실패하면_저장소를읽지않고실패종류를담은EmbeddingError를낸다"""

        def encode_queries(texts: list[str]) -> list[list[float]]:
            raise embedding.EmbeddingUnavailable("HTTP 401")

        fake_gms(answers())
        monkeypatch.setattr(embedding, "encode_queries", encode_queries)
        store = FakeStore()

        # RB-14 진단에 쓰도록 실패 종류(요청문 없음)를 남긴다
        with pytest.raises(EmbeddingError, match="HTTP 401"):
            run(store)
        assert store.calls == []

    def test_store_failure(self, fake_gms: FakeGms) -> None:
        """검색_장소저장소를읽지못하면_StoreError를그대로낸다"""
        fake_gms(answers())

        with pytest.raises(StoreError):
            run(FakeStore(fail=True))


class TestEmptyReason:
    """결과 없음 문구"""

    def test_one_facility(self) -> None:
        """결과없음_시설하나면_그시설을빼보라고한다"""
        conditions = Conditions.from_codes("t", "t", ("PARKING",), "BAR", "YEOKSAM")

        reason = empty_reason(conditions, (StationArea("역삼역", "YEOKSAM"),))

        assert reason.cause == "역삼역 술집 중 주차할 수 있는 곳이 없어요"
        assert reason.suggestion == "주차 조건을 빼고 다시 찾아 보세요"

    def test_many_facilities(self) -> None:
        """결과없음_시설이여럿이면_시설조건을줄이라고한다"""
        conditions = Conditions.from_codes("t", "t", ("PARKING", "WIFI"), "CAFE")

        reason = empty_reason(conditions)

        assert reason.cause == "카페 중 요청한 시설을 모두 갖춘 곳이 없어요"

    def test_map_bounds(self) -> None:
        """결과없음_지도영역으로걸렀으면_역대신이지역이라하고지도를옮기라고한다"""
        conditions = Conditions.from_codes("t", "t", (), "CAFE", "GANGNAM")

        reason = empty_reason(conditions, (BOUNDS,))

        assert reason.cause == "이 지역 카페 중 조건에 맞는 곳이 없어요"
        assert reason.suggestion == "지도를 옮기거나 넓혀서 다시 찾아 보세요"

    def test_nearby_without_category(self) -> None:
        """결과없음_근처검색에업종이없으면_역없이가게라고한다"""
        conditions = Conditions.from_codes("t", "t", station="GANGNAM", nearby=True)

        assert empty_reason(conditions).cause == "가게 중 조건에 맞는 곳이 없어요"

    def test_walk_and_exit(self) -> None:
        """결과없음_역에도보거리나출구가있으면_그대로보여주고그조건을빼보라고한다"""
        conditions = Conditions.from_codes("t", "t", (), "CAFE")
        areas = (
            StationArea("강남역", "GANGNAM", exit="11"),
            StationArea("역삼역", "YEOKSAM", walk_minutes=5),
        )

        reason = empty_reason(conditions, areas)

        assert (
            reason.cause
            == "강남역 11번 출구·역삼역 도보 5분 카페 중 조건에 맞는 곳이 없어요"
        )
        assert reason.suggestion == "도보 거리나 출구 조건을 빼고 다시 찾아 보세요"

    def test_hours(self) -> None:
        """결과없음_영업시간으로걸렀으면_영업시간조건을빼보라고한다"""
        conditions = Conditions.from_codes(
            "t", "t", (), "BAR", hours=(Hours("새벽까지", open_until="02:00"),)
        )

        reason = empty_reason(conditions, (GANGNAM,))

        assert reason.cause == "강남역 술집 중 요청한 시간에 여는 곳이 없어요"
        assert reason.suggestion == "영업시간 조건을 빼고 다시 찾아 보세요"

    @pytest.mark.parametrize(
        ("menus", "cause"),
        [
            ((Menu("돈까스", "돈가스"),), "강남역 식당 중 돈가스를 파는 곳이 없어요"),
            (
                (Menu("삼겹살", "삼겹살"), Menu("냉면", "냉면")),
                "강남역 식당 중 삼겹살·냉면을 모두 파는 곳이 없어요",
            ),
        ],
    )
    def test_menus(self, menus: tuple[Menu, ...], cause: str) -> None:
        """결과없음_메뉴로걸렀으면_그메뉴를파는곳이없다고하고메뉴를바꿔보라고한다"""
        conditions = Conditions.from_codes(
            "t",
            "t",
            (),
            "RESTAURANT",
            menus=menus,
            price=Price("만원 이하", max_won=10000),
        )

        reason = empty_reason(conditions, (GANGNAM,))

        assert reason.cause == cause
        assert reason.suggestion == "메뉴를 바꾸거나 빼고 다시 찾아 보세요"

    def test_broad_menu_not_reason(self) -> None:
        """결과없음_넓은말메뉴는걸지않았으니_다른조건으로이유를정한다"""
        conditions = Conditions.from_codes(
            "t", "t", (), "CAFE", menus=(Menu("커피", "커피"),), price=Price("x", 1, 2)
        )

        assert empty_reason(conditions).cause == "카페 중 요청한 가격대인 곳이 없어요"

    def test_price(self) -> None:
        """결과없음_가격으로걸렀으면_가격조건을빼보라고한다"""
        conditions = Conditions.from_codes(
            "t", "t", (), "CAFE", price=Price("만원 이하", max_won=10000)
        )

        reason = empty_reason(conditions)

        assert reason.cause == "카페 중 요청한 가격대인 곳이 없어요"
        assert reason.suggestion == "가격 조건을 빼고 다시 찾아 보세요"

    def test_now_and_cheap_not_filtered(self) -> None:
        """결과없음_지금영업중이나저렴한만있으면_거르지않았으니시간가격탓으로보지않는다"""
        conditions = Conditions.from_codes(
            "t",
            "t",
            (),
            "CAFE",
            hours=(Hours("지금 여는", now=True),),
            price=Price("저렴한", cheap=True),
        )

        assert empty_reason(conditions).cause == "카페 중 조건에 맞는 곳이 없어요"

    def test_region(self) -> None:
        """결과없음_동이나구로걸렀으면_그이름을쓴다"""
        conditions = Conditions.from_codes("t", "t", (), "BAR")

        reason = empty_reason(conditions, (RegionArea("역삼동", "YEOKSAM"),))

        assert reason.cause == "역삼동 술집 중 조건에 맞는 곳이 없어요"

    @pytest.mark.parametrize(
        ("unready", "cause"),
        [
            (("코엑스",), "코엑스는 아직 준비 중인 지역이에요"),
            (("홍대입구역", "신촌역"), "홍대입구역·신촌역은 아직 준비 중인 지역이에요"),
            (("COEX",), "COEX은(는) 아직 준비 중인 지역이에요"),
        ],
    )
    def test_unready(self, unready: tuple[str, ...], cause: str) -> None:
        """결과없음_장소데이터가없는지역이면_시설조건보다앞서준비중이라고한다"""
        conditions = Conditions.from_codes("t", "t", ("PARKING",), "CAFE")

        reason = empty_reason(conditions, (), unready)

        assert reason.cause == cause
        assert reason.suggestion == "강남역, 역삼역, 선릉역 근처에서 찾아 보세요"
