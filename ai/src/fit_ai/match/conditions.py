"""비교가 쓰는 낱말표. 카드 조건 목록과 업종·역 이름이다.

카드 조건은 공유 코드표(`fit_ai.features`)의 온보딩 코드와 시설 4개다. 온보딩 코드의
코드와 층은 공유 코드표에서 가져오고, 여기에는 코드표에 없는 것만 둔다. 카드 문구,
시설(BE의 `Facility` 코드, docs/comparison/spec.md 2장), 업종·역 이름이다. 다른 비교
모듈을 가져다 쓰지 않는다.
"""

from dataclasses import dataclass
from enum import StrEnum

from fit_ai.features import FEATURES


class Layer(StrEnum):
    """조건의 층. 값은 공유 코드표의 `layer` 값과 같고 시설만 더했다."""

    AXIS = "axis"
    """성향 축(PRD L1). 조용함과 활기처럼 한쪽을 고르면 반대쪽은 비선호다."""
    IMPORTANCE = "importance"
    """중요 기준(PRD L2)"""
    PURPOSE = "purpose"
    """방문 목적(PRD L3)"""
    FACILITY = "facility"
    """시설(PRD L4). 취향 spec에는 없다. 리뷰가 아니라 장소 정보로 먼저 판정한다."""
    FOOD = "food"
    """음식 종류와 매운맛. 취향에만 있고 카드 조건에는 아직 없다."""


@dataclass(frozen=True)
class Condition:
    """조건 하나.

    Attributes:
        id: 조건 코드. 장소 프로필의 `conditions` 키와 같다.
            시설은 `facilities` 키와도 같다.
        label: 화면에 보이는 문구. 근거 항목, 추천 이유, 특징 라벨에 쓴다.
        layer: 조건의 층
    """

    id: str
    label: str
    layer: Layer


CARD_LABELS = {
    "QUIET": "조용해요",
    "LIVELY": "활기차요",
    "SPACIOUS_SEATING": "자리가 넉넉해요",
    "SHORT_WAIT": "대기가 짧아요",
    "GENEROUS_PORTION": "양이 넉넉해요",
    "PRETTY_SPACE": "공간이 예뻐요",
    "VIEW_OUTDOOR": "전망이 좋아요",
    "COZY": "아늑해요",
    "VALUE_FOR_MONEY": "가격만큼 만족해요",
    "PURPOSE_TALK": "대화하기 좋아요",
    "PURPOSE_SOLO": "혼밥하기 좋아요",
    "PURPOSE_DATE": "데이트하기 좋아요",
    "PURPOSE_GROUP": "모임하기 좋아요",
    "PURPOSE_WORK": "작업하기 좋아요",
}
"""온보딩 코드의 카드 문구. 코드표의 `label`은 온보딩 태그 문구("조용하고 차분한 곳")라
카드에는 이 문구를 쓴다. 코드표에 온보딩 코드가 늘면 여기도 더해야 한다(없으면 불러올
때 KeyError로 드러난다)."""

FACILITY_LABELS = {
    "PARKING": "주차할 수 있어요",
    "WIFI": "와이파이가 돼요",
    "GROUP": "단체로 갈 수 있어요",
    "RESERVATION": "예약할 수 있어요",
}
"""시설 코드와 카드 문구. 시설은 공유 코드표에 없다."""

CONDITIONS: dict[str, Condition] = {
    **{
        code: Condition(code, CARD_LABELS[code], Layer(feature.layer))
        for code, feature in FEATURES.items()
        if feature.onboarding
    },
    **{
        code: Condition(code, label, Layer.FACILITY)
        for code, label in FACILITY_LABELS.items()
    },
}
"""조건 id로 찾는 조건 목록. 공유 코드표 순서, 그다음 시설이다. 순서는 특징 라벨을
고를 때 동점을 가르는 데 쓴다."""

EXTRA_LABELS = {
    "FOOD_KOREAN": "한식이에요",
    "FOOD_JAPANESE": "일식이에요",
    "FOOD_CHINESE": "중식이에요",
    "FOOD_WESTERN": "양식이에요",
    "FOOD_ASIAN": "아시아 음식이에요",
    "FOOD_SPICY": "매콤해요",
    "UNIQUE_CONCEPT": "컨셉이 독특해요",
    "FAST_SERVING": "음식이 빨리 나와요",
    "GOOD_MUSIC": "음악이 좋아요",
}
"""코드표의 확장 코드(온보딩에 없는 코드)의 카드 문구. 카드 조건 목록에는 없지만 요청과
취향에 나오면 점수를 내고 근거 항목에 보인다. 코드표에 확장 코드가 늘면 여기도 더해야
한다(없으면 불러올 때 KeyError로 드러난다)."""

SCORE_LABELS: dict[str, str] = {
    **{code: condition.label for code, condition in CONDITIONS.items()},
    **{
        code: EXTRA_LABELS[code]
        for code, feature in FEATURES.items()
        if not feature.onboarding
    },
}
"""점수를 내는 코드와 근거 항목 문구. 카드 조건과 코드표의 확장 코드다."""

CATEGORY_NAMES = {"RESTAURANT": "식당", "CAFE": "카페", "BAR": "술집"}
"""업종 코드의 화면 이름. BE `CategoryGroup`과 같다."""

STATION_NAMES = {"GANGNAM": "강남역", "YEOKSAM": "역삼역", "SEOLLEUNG": "선릉역"}
"""역 코드의 화면 이름. BE `Station`과 같다."""
