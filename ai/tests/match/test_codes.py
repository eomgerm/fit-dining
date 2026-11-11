"""분류별 조건과 점수용 코드를 잇는 `interpretation.codes`와 조건의 옛 꼴 보기를 확인한다."""

import pytest

from fit_ai.features import FEATURES, FLAVORS
from fit_ai.match.interpretation import Conditions
from fit_ai.match.interpretation.codes import (
    FACILITY_CODES,
    FEATURE_CODES,
    FOOD_CODES,
    avoided_codes,
    score_codes,
    split_codes,
)
from fit_ai.match.interpretation.segments import (
    Choice,
    Feature,
    FeatureText,
    Location,
    LocationKind,
)


def test_code_groups_cover_shared_table() -> None:
    """코드묶음_특징·음식·시설코드는_요청에서받지않는맛을빼고_코드표와시설을겹치지않고모두덮는다"""
    groups = [set(FEATURE_CODES), set(FOOD_CODES), set(FACILITY_CODES)]
    # 매운맛 밖의 맛 코드는 아직 취향에만 있다. 요청 해석의 맛 칸을 9개로 늘리는 일은 4단계다
    taste_only = set(FLAVORS) - set(FOOD_CODES)

    assert set().union(*groups) == {*FEATURES, *FACILITY_CODES} - taste_only
    assert sum(map(len, groups)) == len(set().union(*groups))


def test_split_codes() -> None:
    """코드나누기_옛코드목록이면_분류별로나누고빼달라는음식은피함으로둔다"""
    features, food_types, flavors, facilities = split_codes(
        ["QUIET", "FOOD_KOREAN", "PARKING", "FOOD_SPICY", "UNKNOWN", "QUIET"],
        ["FOOD_SPICY", "FOOD_JAPANESE", "QUIET"],
    )

    assert features == ("QUIET",)
    assert food_types == (Choice("FOOD_KOREAN"), Choice("FOOD_JAPANESE", want=False))
    # 원하는 코드에 있어도 빼 달라는 코드면 피함이다.
    assert flavors == (Choice("SPICY", want=False),)
    assert facilities == ("PARKING",)


@pytest.mark.parametrize(
    ("party_size", "extra"),
    [(None, ()), (1, ("PURPOSE_SOLO",)), (3, ()), (4, ("PURPOSE_GROUP",))],
)
def test_score_codes(party_size: int | None, extra: tuple[str, ...]) -> None:
    """점수용코드_분류별조건이면_특징·음식종류·맛·시설·인원순서로원함만낸다"""
    codes = score_codes(
        ["QUIET", None],
        [Choice("FOOD_KOREAN"), Choice("FOOD_JAPANESE", want=False)],
        [Choice("SPICY")],
        ["WIFI"],
        party_size,
    )

    assert codes == ("QUIET", "FOOD_KOREAN", "FOOD_SPICY", "WIFI", *extra)


def test_avoided_codes() -> None:
    """피함코드_음식종류와맛의피함이면_옛avoidFoods꼴로낸다"""
    assert avoided_codes(
        [Choice("FOOD_KOREAN"), Choice("FOOD_JAPANESE", want=False)],
        [Choice("SPICY", want=False)],
    ) == ("FOOD_JAPANESE", "FOOD_SPICY")


class TestFromCodes:
    """옛 꼴 값으로 조건 만들기"""

    def test_classified(self) -> None:
        """옛꼴_코드와빼달라는업종·음식이면_분류별칸으로나눈다"""
        conditions = Conditions.from_codes(
            "강남역 조용한 한식당 카페 말고 매운 거 말고",
            "조용한 한식당",
            codes=("QUIET", "FOOD_KOREAN", "PARKING"),
            category_group="RESTAURANT",
            avoid_categories=("CAFE", "RESTAURANT"),
            avoid_foods=("FOOD_SPICY",),
        )

        assert conditions.categories == (
            Choice("RESTAURANT"),
            Choice("CAFE", want=False),
        )
        assert conditions.food_types == (Choice("FOOD_KOREAN"),)
        assert conditions.flavors == (Choice("SPICY", want=False),)
        assert conditions.facilities == ("PARKING",)
        assert [f.code for f in conditions.features] == ["QUIET"]
        # 옛 꼴 보기
        assert conditions.codes == ("QUIET", "FOOD_KOREAN", "PARKING")
        assert conditions.category_group == "RESTAURANT"
        assert conditions.avoid_categories == ("CAFE",)
        assert conditions.avoid_foods == ("FOOD_SPICY",)

    def test_features(self) -> None:
        """옛꼴_특징이면_코드없는원함만남기고코드있는특징은코드목록을따른다"""
        conditions = Conditions.from_codes(
            "충전되는 곳",
            "충전되는 곳",
            codes=("QUIET",),
            features=(
                FeatureText("충전", "콘센트"),
                FeatureText("강아지 말고", "반려견", want=False),
                # 코드 목록에서 뺀 코드가 이전 조건의 특징으로 되살아나지 않는다.
                Feature("활기찬", "활기찬 곳", "LIVELY"),
                Feature("충전", "콘센트"),
            ),
        )

        assert conditions.features == (
            Feature("조용하고 차분한 곳", "조용하고 차분한 곳", "QUIET"),
            Feature("충전", "콘센트"),
        )

    @pytest.mark.parametrize(
        ("station", "nearby", "locations"),
        [
            ("YEOKSAM", False, (Location("역삼역", LocationKind.STATION, "역삼역"),)),
            (None, True, (Location("근처", LocationKind.HERE),)),
            (None, False, ()),
        ],
    )
    def test_legacy_location(
        self, station: str | None, nearby: bool, locations: tuple[Location, ...]
    ) -> None:
        """옛꼴_1차역과근처면_지역조각으로바꾸고역·근처는지역에서다시낸다"""
        conditions = Conditions.from_codes(
            "카페", "카페", station=station, nearby=nearby
        )

        assert conditions.locations == locations
        assert (conditions.station, conditions.nearby) == (station, nearby)
