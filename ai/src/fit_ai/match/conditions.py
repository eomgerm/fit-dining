"""비교가 쓰는 낱말표. 카드 조건 목록과 업종·역 이름이다.

카드 조건은 취향 코드표의 온보딩 코드 14개와 시설 4개다. id는 취향 프로필
spec(S15P31A302-39)의 코드표를 따른다. 시설 4개는 코드표에 없어서 BE의 `Facility`
코드를 쓴다(docs/comparison/spec.md 2장). 다른 비교 모듈을 가져다 쓰지 않는다.
"""

from dataclasses import dataclass
from enum import StrEnum


class Layer(StrEnum):
    """조건의 층. 값은 취향 프로필 spec의 `layer` 값과 같다."""

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


CONDITIONS: dict[str, Condition] = {
    c.id: c
    for c in (
        Condition("QUIET", "조용해요", Layer.AXIS),
        Condition("LIVELY", "활기차요", Layer.AXIS),
        Condition("SPACIOUS_SEATING", "자리가 넉넉해요", Layer.IMPORTANCE),
        Condition("SHORT_WAIT", "대기가 짧아요", Layer.IMPORTANCE),
        Condition("GENEROUS_PORTION", "양이 넉넉해요", Layer.IMPORTANCE),
        Condition("PRETTY_SPACE", "공간이 예뻐요", Layer.IMPORTANCE),
        Condition("VIEW_OUTDOOR", "전망이 좋아요", Layer.IMPORTANCE),
        Condition("COZY", "아늑해요", Layer.IMPORTANCE),
        Condition("VALUE_FOR_MONEY", "가격만큼 만족해요", Layer.IMPORTANCE),
        Condition("PURPOSE_TALK", "대화하기 좋아요", Layer.PURPOSE),
        Condition("PURPOSE_SOLO", "혼밥하기 좋아요", Layer.PURPOSE),
        Condition("PURPOSE_DATE", "데이트하기 좋아요", Layer.PURPOSE),
        Condition("PURPOSE_GROUP", "모임하기 좋아요", Layer.PURPOSE),
        Condition("PURPOSE_WORK", "작업하기 좋아요", Layer.PURPOSE),
        Condition("PARKING", "주차할 수 있어요", Layer.FACILITY),
        Condition("WIFI", "와이파이가 돼요", Layer.FACILITY),
        Condition("GROUP", "단체로 갈 수 있어요", Layer.FACILITY),
        Condition("RESERVATION", "예약할 수 있어요", Layer.FACILITY),
    )
}
"""조건 id로 찾는 조건 목록. 순서는 특징 라벨을 고를 때 동점을 가르는 데 쓴다."""

CATEGORY_NAMES = {"RESTAURANT": "식당", "CAFE": "카페", "BAR": "술집"}
"""업종 코드의 화면 이름. BE `CategoryGroup`과 같다."""

STATION_NAMES = {"GANGNAM": "강남역", "YEOKSAM": "역삼역", "SEOLLEUNG": "선릉역"}
"""역 코드의 화면 이름. BE `Station`과 같다."""
