"""점수용 코드. 분류별 조건과 공유 코드표(`fit_ai.features`)·시설 코드를 잇는다.

조건의 분류(특징, 음식 종류, 맛, 시설, 인원)를 코드로 바꾸는 곳은 여기 하나다. 옛 조건의
코드 목록(`codes`)을 분류로 나누는 일도 여기서 한다(docs/comparison/conditions-v3.md 3장,
5장).
"""

from collections.abc import Iterable, Sequence

from fit_ai.features import FEATURES
from fit_ai.match.conditions import CONDITIONS, Layer
from fit_ai.match.interpretation.segments import Choice

GROUP_SIZE = 4
"""이 인원 이상이면 모임(`PURPOSE_GROUP`)으로 본다. 임시 값이다."""

FOOD_TYPES = (
    "FOOD_KOREAN",
    "FOOD_JAPANESE",
    "FOOD_CHINESE",
    "FOOD_WESTERN",
    "FOOD_ASIAN",
)
"""음식 종류 코드"""

FLAVOR_CODES = {"SPICY": "FOOD_SPICY"}
"""맛 코드와 공유 코드표 코드. 코드표는 매운맛을 음식 층에 둔다."""

FOOD_CODES = (*FOOD_TYPES, *FLAVOR_CODES.values())
"""옛 조건의 음식 코드. 음식 종류와 매운맛이다."""

FACILITY_CODES = tuple(
    code for code, condition in CONDITIONS.items() if condition.layer is Layer.FACILITY
)
"""시설 코드(BE `Facility`)"""

FEATURE_CODES = tuple(
    code for code, feature in FEATURES.items() if feature.layer != Layer.FOOD
)
"""특징 코드. 공유 코드표의 성향 축·중요 기준·방문 목적 코드다."""

_FLAVORS = {code: flavor for flavor, code in FLAVOR_CODES.items()}


def score_codes(
    feature_codes: Iterable[str | None],
    food_types: Sequence[Choice],
    flavors: Sequence[Choice],
    facilities: Sequence[str],
    party_size: int | None,
) -> tuple[str, ...]:
    """원하는 조건의 점수용 코드. 특징, 음식 종류, 맛, 시설, 인원 순서다.

    Args:
        feature_codes: 특징의 코드. 코드표에 없는 특징(None)은 건너뛴다.
        food_types: 음식 종류
        flavors: 맛
        facilities: 시설 코드
        party_size: 인원. 1명이면 `PURPOSE_SOLO`, `GROUP_SIZE`명 이상이면 `PURPOSE_GROUP`이다.

    Returns:
        코드. 같은 코드는 한 번만 둔다.
    """
    codes = [code for code in feature_codes if code is not None]
    codes += [c.code for c in food_types if c.want]
    codes += [
        FLAVOR_CODES[c.code] for c in flavors if c.want and c.code in FLAVOR_CODES
    ]
    codes += facilities
    if party_size == 1:
        codes.append("PURPOSE_SOLO")
    elif party_size is not None and party_size >= GROUP_SIZE:
        codes.append("PURPOSE_GROUP")
    return tuple(dict.fromkeys(codes))


def avoided_codes(
    food_types: Sequence[Choice], flavors: Sequence[Choice]
) -> tuple[str, ...]:
    """빼 달라는 음식 종류와 맛의 코드. 옛 조건의 `avoidFoods`와 같은 꼴이다."""
    codes = [c.code for c in food_types if not c.want]
    codes += [
        FLAVOR_CODES[c.code] for c in flavors if not c.want and c.code in FLAVOR_CODES
    ]
    return tuple(dict.fromkeys(codes))


def split_codes(
    codes: Iterable[str], avoided: Iterable[str] = ()
) -> tuple[tuple[str, ...], tuple[Choice, ...], tuple[Choice, ...], tuple[str, ...]]:
    """옛 조건의 코드 목록을 분류로 나눈다. 모르는 코드는 버린다.

    Args:
        codes: 원하는 코드(옛 조건의 `codes`)
        avoided: 빼 달라는 음식 코드(옛 조건의 `avoidFoods`). 빼 달라는 코드는 원하는
            코드에 있어도 피함이다.

    Returns:
        (특징 코드, 음식 종류, 맛, 시설 코드). 순서는 처음 나온 순서다.
    """
    avoided = tuple(dict.fromkeys(c for c in avoided if c in FOOD_CODES))
    wanted = [c for c in dict.fromkeys(codes) if c not in avoided]
    features = tuple(c for c in wanted if c in FEATURE_CODES)
    food_types = tuple(Choice(c) for c in wanted if c in FOOD_TYPES) + tuple(
        Choice(c, want=False) for c in avoided if c in FOOD_TYPES
    )
    flavors = tuple(Choice(_FLAVORS[c]) for c in wanted if c in _FLAVORS) + tuple(
        Choice(_FLAVORS[c], want=False) for c in avoided if c in _FLAVORS
    )
    facilities = tuple(c for c in wanted if c in FACILITY_CODES)
    return features, food_types, flavors, facilities
