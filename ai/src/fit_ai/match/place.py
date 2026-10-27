"""40(장소 특징 분석)이 만든 장소 프로필을 장소 정보와 합쳐 읽는다.

비교는 장소 프로필을 만들지 않고 읽기만 한다. 장소 데이터는 AI가 들고 있지 않고
검색마다 Postgres 뷰에서 거른 장소를 프로필째 읽는다(docs/comparison/api.md 5장).
프로필 형식은 40 spec 7단계의 `place-profile/v0`을 따른다. 40 spec이 초안이라 읽는
방식도 확정이 아니다. 정리는 docs/comparison/spec.md 4.2에 있다.
"""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ConditionEvidence:
    """조건 하나에 대한 근거 리뷰 수. 앱 리뷰와 외부 리뷰를 합쳐 센다.

    Attributes:
        pos: 조건을 채웠다고 말한 리뷰 수
        neg: 조건을 채우지 못했다고 말한 리뷰 수
    """

    pos: int = 0
    neg: int = 0


NO_EVIDENCE = ConditionEvidence()
"""긍정·부정 리뷰가 모두 0개인 근거. 장소 프로필에 줄이 없는 조건은 이 값으로 본다."""

SCHEMA = "place-profile/v0"
"""읽을 수 있는 장소 프로필 형식"""

AXIS_OPPOSITES = {"QUIET": "LIVELY", "LIVELY": "QUIET"}
"""소음 축의 반대 극"""

CATEGORY_NAMES = {"RESTAURANT": "식당", "CAFE": "카페", "BAR": "술집"}
"""업종 코드의 화면 이름. BE `CategoryGroup`과 같다."""

STATION_NAMES = {"GANGNAM": "강남역", "YEOKSAM": "역삼역", "SEOLLEUNG": "선릉역"}
"""역 코드의 화면 이름. BE `Station`과 같다."""


@dataclass(frozen=True)
class PlaceInfo:
    """장소 정보. 40 프로필에 없어서 BE 장소 정보를 뷰에서 함께 읽는다.

    Attributes:
        place_id: 장소 id. BE DB의 장소 id다.
        category_group: 업종(`RESTAURANT`, `CAFE`, `BAR`)
        station: 역(`GANGNAM`, `YEOKSAM`, `SEOLLEUNG`)
        facilities: 시설 코드별 유무. True는 있음, False는 없음이다.
            None이나 빠진 코드는 모름이다.
    """

    place_id: int
    category_group: str
    station: str
    facilities: dict[str, bool | None]


@dataclass(frozen=True)
class Place:
    """후보 추출부터 카드 만들기까지 쓰는 장소 하나. 40 프로필과 장소 정보를 합쳤다.

    Attributes:
        place_id: 장소 id. BE DB의 장소 id다.
        info: 장소 정보
        summary: 40이 만든 장소 요약 문장. 장소 정보로만 만든 틀 문장이라
            리뷰 내용은 없다. 요약 벡터는 DB에만 있고 유사도도 DB가 잰다.
        conditions: 조건 코드별 근거. 근거 리뷰가 하나도 없는 조건은 빠진다.
    """

    place_id: int
    info: PlaceInfo
    summary: str
    conditions: dict[str, ConditionEvidence]

    def evidence(self, condition_id: str) -> ConditionEvidence:
        """조건의 근거를 찾는다.

        Args:
            condition_id: 조건 코드

        Returns:
            조건의 근거. 프로필에 없는 조건이면 `NO_EVIDENCE`다.
        """
        return self.conditions.get(condition_id, NO_EVIDENCE)

    @classmethod
    def from_dict(cls, data: dict[str, Any], info: PlaceInfo) -> "Place":
        """40 장소 프로필 하나를 읽은 JSON 객체와 장소 정보로 장소를 만든다.

        장소 id는 장소 정보의 값을 쓴다. 40 프로필의 `place_id`는 원본 데이터의 id일 수
        있어 읽지 않는다. 요약 벡터와 `embedding`은 DB가 유사도를 잴 때 쓰므로 읽지
        않는다. `personas`, `evidence`, `food_type`, `features[].label`도 MVP에서 쓰지
        않아 읽지 않는다.

        Args:
            data: 40 장소 프로필 JSON 객체 하나
            info: 같은 장소의 장소 정보

        Returns:
            장소

        Raises:
            ValueError: `schema`가 `SCHEMA`와 다를 때
            KeyError: 필수 필드가 없을 때
            TypeError: 필드의 타입이 다르거나 요약 문장이 문자열이 아닐 때
        """
        if data.get("schema") != SCHEMA:
            raise ValueError(f"읽을 수 없는 장소 프로필 형식이다: {data.get('schema')}")
        summary = data["summary"]["text"]
        if not isinstance(summary, str):
            raise TypeError(f"장소 요약 문장이 없다: {info.place_id}")
        return cls(
            place_id=info.place_id,
            info=info,
            summary=summary,
            conditions=_conditions(data.get("features", [])),
        )


def _conditions(features: list[dict[str, Any]]) -> dict[str, ConditionEvidence]:
    """40 특징 목록을 조건별 근거로 바꾼다.

    40은 소음 축을 손님이 느낀 쪽(코드)과 그게 좋았는지(좋았어요·아쉬웠어요)로 센다.
    "너무 썰렁했어요"는 `QUIET` 아쉬웠어요다. 카드는 그 조건을 채웠는지로 세므로
    느낀 쪽의 좋았어요·아쉬웠어요를 모두 긍정으로, 반대 극의 것을 모두 부정으로 본다.
    나머지 코드는 좋았어요를 긍정, 아쉬웠어요를 부정으로 그대로 쓴다.
    """
    counts = {f["code"]: (f["like_count"], f["dislike_count"]) for f in features}
    felt = {code: sum(counts.get(code, (0, 0))) for code in AXIS_OPPOSITES}
    conditions: dict[str, ConditionEvidence] = {}
    for code, (like, dislike) in counts.items():
        if code not in AXIS_OPPOSITES:
            conditions[code] = ConditionEvidence(pos=like, neg=dislike)
    for code, opposite in AXIS_OPPOSITES.items():
        if felt[code] or felt[opposite]:
            conditions[code] = ConditionEvidence(pos=felt[code], neg=felt[opposite])
    return conditions
