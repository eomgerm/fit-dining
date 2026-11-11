"""② 점수를 확인한다.

리뷰 근거의 조건 점수(평균 쪽으로 당기기, 업종 범위 안 위치), 장소 정보로 판정하는 조건
(시설, 음식 종류), 핏 점수 합치기, 후보 순서를 본다.
"""

import pytest

from fit_ai.match.candidates import Candidate
from fit_ai.match.conditions import Layer
from fit_ai.match.place import ConditionEvidence, Place, PlaceInfo
from fit_ai.match.scoring import (
    MIN_CONDITION_SCORE,
    PRIOR_REVIEWS_RANGE,
    REQUEST_WEIGHT,
    UNKNOWN,
    Baseline,
    ItemScore,
    PhraseScores,
    fit_score,
    scope_of,
    score_places,
)
from fit_ai.match.taste_select import TasteFeature

CAFE = frozenset({"CAFE"})
ALL = frozenset({"RESTAURANT", "CAFE", "BAR"})


def make_place(
    place_id: int,
    mentions: dict[str, int] | None = None,
    reviews: int | None = 100,
    category: str = "CAFE",
    facilities: dict[str, bool | None] | None = None,
    food_type: str | None = None,
) -> Place:
    """리뷰 `reviews`건 중 코드마다 `mentions`건이 그렇다고 한 장소"""
    return Place(
        place_id=place_id,
        info=PlaceInfo(
            place_id, category, "GANGNAM", facilities or {}, food_type, reviews
        ),
        summary="",
        conditions={
            code: ConditionEvidence(pos=n) for code, n in (mentions or {}).items()
        },
    )


QUIET_CAFES = [
    make_place(i, {"QUIET": n}) for i, n in enumerate([0, 0, 3, 6, 10, 17], start=1)
]
"""리뷰 100건씩인 카페 여섯 곳. 조용하다는 리뷰가 0, 0, 3, 6, 10, 17건이다."""


def item(value: float, request: bool = True, like: bool = True, weight: int = 1):
    return ItemScore("QUIET", request, like, weight, value, 0, True)


class TestReviewScore:
    """리뷰로 판정하는 조건 점수"""

    def test_position_in_scope(self) -> None:
        """조건점수_리뷰가많은곳은_업종범위안위치대로다"""
        baseline = Baseline(QUIET_CAFES)

        values = [baseline.value(p, "QUIET", CAFE) for p in QUIET_CAFES]

        assert values == sorted(values)
        assert values[0] == values[1] < 0.2
        assert values[-1] > 0.9

    def test_few_reviews_pulled_to_middle(self) -> None:
        """조건점수_비율이같으면_리뷰가적을수록가운데에가깝다"""
        none_few = make_place(7, {"QUIET": 0}, reviews=6)
        half_few = make_place(8, {"QUIET": 3}, reviews=6)
        half_many = make_place(9, {"QUIET": 50}, reviews=100)
        baseline = Baseline([*QUIET_CAFES, none_few, half_few, half_many])

        def value(place: Place) -> float:
            return baseline.value(place, "QUIET", CAFE)

        # 0%: 리뷰 100건이면 맨 아래지만 6건이면 판단할 근거가 적어 가운데 쪽이다.
        assert value(QUIET_CAFES[0]) < value(none_few) < 0.5
        # 50%: 6건 중 3건은 100건 중 50건보다 덜 확실해 가운데 쪽이다.
        assert 0.5 < value(half_few) < value(half_many)

    def test_no_mentions_in_scope_unknown(self) -> None:
        """조건점수_범위안어느곳도말하지않은코드는_가운데다"""
        baseline = Baseline(QUIET_CAFES)

        assert baseline.value(QUIET_CAFES[-1], "PURPOSE_WORK", CAFE) == UNKNOWN

    def test_unknown_review_count(self) -> None:
        """조건점수_분석리뷰수를모르면_가운데다"""
        place = make_place(9, {"QUIET": 50}, reviews=None)

        assert Baseline(QUIET_CAFES).value(place, "QUIET", CAFE) == UNKNOWN

    def test_same_rates_all_middle(self) -> None:
        """조건점수_장소끼리차이가없으면_가상리뷰가상한근처이고모두가운데다"""
        same = [make_place(i, {"QUIET": 5}) for i in range(1, 5)]
        baseline = Baseline(same)

        assert all(
            baseline.value(p, "QUIET", CAFE) == pytest.approx(0.5, abs=0.05)
            for p in same
        )
        stats = baseline._review_stats(CAFE, "QUIET")
        assert stats.prior_reviews > PRIOR_REVIEWS_RANGE[1] / 2

    def test_scope_mixes_categories(self) -> None:
        """조건점수_업종을말하지않으면_업종을섞어견준다"""
        cafes = [make_place(i, {"PURPOSE_WORK": n}) for i, n in [(1, 10), (2, 17)]]
        restaurants = [
            make_place(i, {"PURPOSE_WORK": n}, category="RESTAURANT")
            for i, n in [(3, 0), (4, 0), (5, 2)]
        ]
        baseline = Baseline([*cafes, *restaurants])
        best_restaurant = restaurants[-1]

        # 식당끼리는 1등이지만, 섞으면 작업 언급이 많은 카페보다 낮다.
        alone = baseline.value(
            best_restaurant, "PURPOSE_WORK", frozenset({"RESTAURANT"})
        )
        mixed = baseline.value(best_restaurant, "PURPOSE_WORK", ALL)
        assert alone > mixed
        assert baseline.value(cafes[0], "PURPOSE_WORK", ALL) > mixed


class TestInfoScore:
    """장소 정보로 판정하는 조건 점수"""

    def test_facility(self) -> None:
        """조건점수_시설은있음1없음0이고_모르면범위안에서있는곳의비율이다"""
        places = [
            make_place(1, facilities={"WIFI": True}),
            make_place(2, facilities={"WIFI": False}),
            make_place(3),
            make_place(4, facilities={"WIFI": True}),
        ]
        baseline = Baseline(places)

        assert [baseline.value(p, "WIFI", CAFE) for p in places] == [1.0, 0.0, 0.5, 1.0]

    def test_food_type(self) -> None:
        """조건점수_음식종류는같으면1다르면0이고_모르면아는곳중그종류의비율이다"""
        places = [
            make_place(1, category="RESTAURANT", food_type="FOOD_WESTERN"),
            make_place(2, category="RESTAURANT", food_type="FOOD_KOREAN"),
            make_place(3, category="RESTAURANT", food_type="FOOD_KOREAN"),
            make_place(4, category="RESTAURANT", food_type="FOOD_KOREAN"),
            make_place(5, category="RESTAURANT"),
            make_place(6),
        ]
        baseline = Baseline(places)
        restaurants = frozenset({"RESTAURANT"})

        assert [baseline.value(p, "FOOD_WESTERN", restaurants) for p in places[:5]] == [
            1.0,
            0.0,
            0.0,
            0.0,
            0.25,
        ]
        # 음식 종류를 아는 카페가 없으면 가운데다.
        assert baseline.value(places[5], "FOOD_WESTERN", CAFE) == UNKNOWN


class TestFitScore:
    """핏 점수 합치기"""

    def test_request_geometric_mean(self) -> None:
        """핏점수_요청만있으면_조건점수의기하평균이다"""
        assert fit_score([item(0.9), item(0.4)]) == pytest.approx(0.6)

    def test_zero_floored(self) -> None:
        """핏점수_확실히안맞는요청조건은_하한으로넣어다른조건의차이를남긴다"""
        low = fit_score([item(0.0), item(0.9)])
        lower = fit_score([item(0.0), item(0.1)])

        assert low == pytest.approx((MIN_CONDITION_SCORE * 0.9) ** 0.5)
        assert low > lower

    def test_taste_weighted_and_dislike_flipped(self) -> None:
        """핏점수_취향만있으면_가중평균이고싫어함은뒤집는다"""
        tastes = [item(0.9, request=False, weight=2), item(0.8, False, like=False)]

        assert fit_score(tastes) == pytest.approx((2 * 0.9 + 0.2) / 3)

    def test_request_and_taste(self) -> None:
        """핏점수_둘다있으면_요청0점7취향0점3이다"""
        result = fit_score([item(0.8), item(0.2, request=False)])

        assert result == pytest.approx(
            REQUEST_WEIGHT * 0.8 + (1 - REQUEST_WEIGHT) * 0.2
        )

    def test_nothing(self) -> None:
        """핏점수_요청조각도취향도없으면_None이다"""
        assert fit_score([]) is None

    def test_avoided_request_flipped(self) -> None:
        """핏점수_피해달라는요청은_1빼기조건점수로기하평균에넣는다"""
        assert fit_score([item(0.9), item(0.8, like=False)]) == pytest.approx(
            (0.9 * 0.2) ** 0.5
        )


class TestScorePlaces:
    """후보 순서"""

    def test_sorted_by_score_then_candidate_order(self) -> None:
        """순서_핏점수내림차순이고_같으면후보순서다"""
        candidates = [Candidate(p, 1.0 - p.place_id / 10) for p in QUIET_CAFES]

        scored = score_places(candidates, ["QUIET"], [], CAFE, Baseline(QUIET_CAFES))

        assert [s.candidate.place.place_id for s in scored] == [6, 5, 4, 3, 1, 2]
        assert [s.score for s in scored] == sorted(
            (s.score for s in scored), reverse=True
        )

    def test_same_place_same_score(self) -> None:
        """순서_같은장소같은요청이면_함께나온후보와상관없이같은점수다"""
        baseline = Baseline(QUIET_CAFES)
        target = Candidate(QUIET_CAFES[3], 1.0)

        alone = score_places([target], ["QUIET"], [], CAFE, baseline)
        crowded = score_places(
            [Candidate(p, 0.5) for p in QUIET_CAFES], ["QUIET"], [], CAFE, baseline
        )

        [mine] = [s for s in crowded if s.candidate.place.place_id == 4]
        assert alone[0].score == mine.score

    def test_items_and_unknown_codes(self) -> None:
        """순서_카드조건목록밖의확장코드는넣고모르는코드와요청과같은취향은뺀다"""
        tastes = [
            TasteFeature("QUIET", Layer.AXIS, True, 1),
            TasteFeature("COZY", Layer.IMPORTANCE, False, 2),
        ]

        [scored] = score_places(
            [Candidate(QUIET_CAFES[0], 1.0)],
            ["QUIET", "FAST_SERVING", "taste:담백한_국물"],
            tastes,
            CAFE,
            Baseline(QUIET_CAFES),
        )

        assert [(i.code, i.request, i.like, i.weight) for i in scored.items] == [
            ("QUIET", True, True, 1),
            ("FAST_SERVING", True, True, 1),
            ("COZY", False, False, 2),
        ]

    def test_phrase_items(self) -> None:
        """순서_코드없는조건문구는_장소의페르소나항목이고페르소나가없으면0점5다"""
        candidates = [Candidate(p, 1.0) for p in QUIET_CAFES[:2]]
        reading = PhraseScores("책 읽기 좋은 곳", {1: 0.9})

        scored = score_places(
            candidates, [], [], CAFE, Baseline(QUIET_CAFES), phrases=[reading]
        )

        assert [
            (s.candidate.place.place_id, s.score, s.items[0].phrase) for s in scored
        ] == [(1, 90, "책 읽기 좋은 곳"), (2, 50, "책 읽기 좋은 곳")]
        assert scored[0].items[0].code is None
        assert scored[0].items[0].request

    def test_avoided_codes(self) -> None:
        """순서_피해달라는코드는요청조각으로뒤집어넣고_그코드의취향은뺀다"""
        tastes = [
            TasteFeature("QUIET", Layer.AXIS, True, 1),
            TasteFeature("COZY", Layer.IMPORTANCE, True, 1),
        ]

        [scored] = score_places(
            [Candidate(QUIET_CAFES[5], 1.0)],
            [],
            tastes,
            CAFE,
            Baseline(QUIET_CAFES),
            avoid_codes=["QUIET"],
        )

        assert [(i.code, i.request, i.like) for i in scored.items] == [
            ("QUIET", True, False),
            ("COZY", False, True),
        ]

    def test_no_items_no_score(self) -> None:
        """순서_판정할요청조각도취향도없으면_점수없이후보순서다"""
        candidates = [Candidate(p, 1.0) for p in QUIET_CAFES[:3]]

        scored = score_places(candidates, [], [], CAFE, Baseline(QUIET_CAFES))

        assert [(s.candidate.place.place_id, s.score) for s in scored] == [
            (1, None),
            (2, None),
            (3, None),
        ]

    def test_flavor_taste_only_where_category_has_evidence(self) -> None:
        """순서_맛취향은_그업종에근거3건이상장소가10퍼센트이상일때만넣는다"""
        # 카페 10곳 중 1곳(10%)만 단맛 근거가 3건이다. 식당 10곳은 2건뿐이다
        cafes = [
            make_place(i, {"FOOD_SWEET": 3 if i == 1 else 0}) for i in range(1, 11)
        ]
        restaurants = [
            make_place(i, {"FOOD_SWEET": 2}, category="RESTAURANT")
            for i in range(11, 21)
        ]
        baseline = Baseline([*cafes, *restaurants])
        tastes = [
            TasteFeature("FOOD_SWEET", Layer.FOOD, True, 1),
            TasteFeature("QUIET", Layer.AXIS, True, 1),
        ]

        scored = score_places(
            [Candidate(cafes[0], 1.0), Candidate(restaurants[0], 0.9)],
            [],
            tastes,
            ALL,
            baseline,
        )

        codes = {s.candidate.place.place_id: [i.code for i in s.items] for s in scored}
        assert codes == {1: ["FOOD_SWEET", "QUIET"], 11: ["QUIET"]}

    def test_flavor_taste_dropped_below_ten_percent(self) -> None:
        """순서_근거있는장소가10퍼센트에못미치면_맛취향을뺀다"""
        cafes = [
            make_place(i, {"FOOD_SWEET": 3 if i == 1 else 0}) for i in range(1, 12)
        ]

        [scored] = score_places(
            [Candidate(cafes[0], 1.0)],
            [],
            [TasteFeature("FOOD_SWEET", Layer.FOOD, False, 1)],
            CAFE,
            Baseline(cafes),
        )

        assert scored.items == () and scored.score is None

    def test_requested_flavor_is_scored_without_place_evidence(self) -> None:
        """순서_요청한맛은_장소근거가적어도점수에넣는다"""
        [scored] = score_places(
            [Candidate(QUIET_CAFES[0], 1.0)],
            ["FOOD_SPICY"],
            [],
            CAFE,
            Baseline(QUIET_CAFES),
        )

        assert [i.code for i in scored.items] == ["FOOD_SPICY"]


@pytest.mark.parametrize(
    ("category", "excluded", "expected"),
    [
        ("CAFE", (), CAFE),
        (None, (), ALL),
        (None, ("BAR",), frozenset({"RESTAURANT", "CAFE"})),
    ],
)
def test_scope_of(category: str | None, excluded: tuple, expected: frozenset) -> None:
    """업종범위_요청한업종이있으면그업종_없으면빼달라는업종을뺀전체다"""
    assert scope_of(category, excluded) == expected
