"""특징 코드표. 39가 관리하고 40·41과 공유한다(docs/specs/taste-profile/spec.md 0단계)."""

from dataclasses import dataclass
from typing import Literal

Layer = Literal["axis", "importance", "purpose", "food"]


@dataclass(frozen=True)
class Feature:
    code: str
    layer: Layer
    label: str  # 화면 태그 문구
    phrase: str  # 임베딩 문구
    opposite: str | None = None  # 반대 극 코드(성향 축만)
    onboarding: bool = True  # False면 직접 입력 해석에서만 붙는 확장 코드


_TABLE = [
    Feature(
        "QUIET", "axis", "조용하고 차분한 곳", "조용하고 차분한 곳", opposite="LIVELY"
    ),
    Feature("LIVELY", "axis", "활기찬 곳", "활기찬 곳", opposite="QUIET"),
    Feature(
        "SPACIOUS_SEATING",
        "importance",
        "자리가 넉넉한 곳",
        "매장이 넓고 좌석이 편한 곳",
    ),
    Feature("SHORT_WAIT", "importance", "웨이팅 적은 곳", "대기가 적은 곳"),
    Feature(
        "GENEROUS_PORTION",
        "importance",
        "양이 충분한 곳",
        "양이 많아서 배부르게 먹을 수 있는 곳",
    ),
    Feature("PRETTY_SPACE", "importance", "공간이 예쁜 곳", "인테리어가 멋진 곳"),
    Feature("VIEW_OUTDOOR", "importance", "전망·야외가 좋은 곳", "전망·야외가 좋은 곳"),
    Feature("COZY", "importance", "아늑한 곳", "아늑한 곳"),
    Feature("VALUE_FOR_MONEY", "importance", "가성비 좋은 곳", "가성비 좋은 곳"),
    Feature("PURPOSE_TALK", "purpose", "대화", "대화하기 좋은 곳"),
    Feature("PURPOSE_SOLO", "purpose", "혼밥", "혼밥하기 좋은 곳"),
    Feature(
        "PURPOSE_DATE",
        "purpose",
        "데이트·특별한 날",
        "데이트나 특별한 날에 가기 좋은 곳",
    ),
    Feature("PURPOSE_GROUP", "purpose", "모임", "단체 모임 하기 좋은 곳"),
    Feature("PURPOSE_WORK", "purpose", "작업·공부", "작업이나 공부하기 좋은 곳"),
    Feature("FOOD_KOREAN", "food", "한식", "한식당", onboarding=False),
    Feature("FOOD_JAPANESE", "food", "일식", "일식당", onboarding=False),
    Feature("FOOD_CHINESE", "food", "중식", "중식당", onboarding=False),
    Feature("FOOD_WESTERN", "food", "양식", "양식당", onboarding=False),
    Feature("FOOD_ASIAN", "food", "아시안", "아시아 음식점", onboarding=False),
    Feature(
        "FOOD_SPICY",
        "food",
        "매운 음식",
        "매콤한 음식을 먹을 수 있는 곳",
        onboarding=False,
    ),
    Feature(
        "UNIQUE_CONCEPT",
        "importance",
        "컨셉이 독특한 곳",
        "컨셉이 독특한 곳",
        onboarding=False,
    ),
    Feature(
        "FAST_SERVING",
        "importance",
        "음식이 빨리 나오는 곳",
        "음식이 빨리 나오는 곳",
        onboarding=False,
    ),
    Feature(
        "GOOD_MUSIC", "importance", "음악이 좋은 곳", "음악이 좋은 곳", onboarding=False
    ),
]

FEATURES: dict[str, Feature] = {f.code: f for f in _TABLE}
