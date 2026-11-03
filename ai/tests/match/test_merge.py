"""이전 조건과 이번 요청 합치기(`interpretation.merge`)를 확인한다."""

from fit_ai.match.interpretation import Conditions
from fit_ai.match.interpretation.merge import merge
from fit_ai.match.interpretation.segments import (
    Choice,
    Feature,
    Hours,
    Location,
    LocationKind,
    Menu,
    Price,
)

GANGNAM = Location("강남역", LocationKind.STATION, "강남역")
YEOKSAM = Location("역삼역", LocationKind.STATION, "역삼역")
QUIET = Feature("조용한", "조용하고 차분한 곳", "QUIET")
LIVELY = Feature("활기찬", "활기찬 곳", "LIVELY")

PREVIOUS = Conditions(
    text="강남역 조용한 파스타 카페 새벽까지",
    embedding_text="조용한 파스타 카페",
    categories=(Choice("CAFE"), Choice("BAR", want=False)),
    food_types=(Choice("FOOD_WESTERN"),),
    flavors=(Choice("SPICY", want=False),),
    menus=(Menu("파스타", "파스타"), Menu("케이크", "케이크")),
    features=(QUIET, Feature("충전", "콘센트")),
    facilities=("WIFI",),
    party_size=2,
    locations=(GANGNAM,),
    hours=(Hours("새벽까지", open_until="02:00"), Hours("일요일", day="SUN")),
    price=Price("2만원 이하", max_won=20000),
)


def turn(**fields: object) -> Conditions:
    return Conditions(**{"text": "이번 요청", "embedding_text": "이번 요청", **fields})


def test_empty_turn_keeps_previous() -> None:
    """합치기_이번요청에조각이없으면_이전조건을그대로잇고문장만붙인다"""
    merged = merge(PREVIOUS, turn())

    assert merged.text == "강남역 조용한 파스타 카페 새벽까지 이번 요청"
    assert merged.embedding_text == "조용한 파스타 카페 이번 요청"
    assert (merged.categories, merged.menus, merged.features) == (
        PREVIOUS.categories,
        PREVIOUS.menus,
        PREVIOUS.features,
    )
    assert (merged.locations, merged.hours, merged.price, merged.party_size) == (
        PREVIOUS.locations,
        PREVIOUS.hours,
        PREVIOUS.price,
        2,
    )


def test_categories() -> None:
    """합치기_이번에업종을원하거나빼면_원함은바꾸고피함은잇는다"""
    merged = merge(
        PREVIOUS, turn(categories=(Choice("BAR"), Choice("CAFE", want=False)))
    )

    # 이전에 뺀 술집을 이번에 원하면 원함이고, 이전에 원한 카페를 빼면 피함이다.
    assert merged.categories == (Choice("BAR"), Choice("CAFE", want=False))
    assert merged.category_group == "BAR"


def test_same_values_overridden() -> None:
    """합치기_음식종류·맛·메뉴는_같은값을이번것으로덮고나머지는잇는다"""
    merged = merge(
        PREVIOUS,
        turn(
            food_types=(Choice("FOOD_WESTERN", want=False), Choice("FOOD_KOREAN")),
            flavors=(Choice("SPICY"),),
            menus=(Menu("파스타", "파스타", want=False), Menu("피자", "피자")),
        ),
    )

    assert merged.food_types == (
        Choice("FOOD_WESTERN", want=False),
        Choice("FOOD_KOREAN"),
    )
    assert merged.flavors == (Choice("SPICY"),)
    assert merged.menus == (
        Menu("케이크", "케이크"),
        Menu("파스타", "파스타", want=False),
        Menu("피자", "피자"),
    )


def test_features_and_facilities() -> None:
    """합치기_특징·시설은잇고_반대극이나빼달라는코드는이전것을지운다"""
    merged = merge(
        PREVIOUS,
        turn(features=(LIVELY,), facilities=("PARKING",)),
        dropped=("WIFI",),
    )

    assert merged.features == (Feature("충전", "콘센트"), LIVELY)
    assert merged.facilities == ("PARKING",)
    assert merged.codes == ("LIVELY", "FOOD_WESTERN", "PARKING")


def test_replaced() -> None:
    """합치기_지역·가격·인원은_이번요청에있으면바꾼다"""
    merged = merge(
        PREVIOUS,
        turn(
            locations=(YEOKSAM,), price=Price("만원 이하", max_won=10000), party_size=5
        ),
    )

    assert merged.locations == (YEOKSAM,)
    assert merged.price == Price("만원 이하", max_won=10000)
    assert merged.party_size == 5


def test_hours_by_kind() -> None:
    """합치기_시간은_이번요청이말한종류만덮는다"""
    merged = merge(PREVIOUS, turn(hours=(Hours("밤 11시까지", open_until="23:00"),)))

    assert merged.hours == (
        Hours("일요일", day="SUN"),
        Hours("밤 11시까지", open_until="23:00"),
    )
