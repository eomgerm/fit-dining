"""장소. 40(장소 특징 분석)의 장소 프로필을 읽고 장소가 조건을 채우는지 판정한다.

카드의 근거 항목(③)과 LLM 정렬의 등급 기준(②)이 같은 판정(`Place.judge`)을 쓴다.
그래야 화면의 근거 항목과 핏 점수가 같은 근거를 말한다(docs/comparison/spec.md 4.3).

비교는 장소 프로필을 만들지 않고 읽기만 한다. 장소 데이터는 AI가 들고 있지 않고
검색마다 장소 저장소에서 거른 장소를 프로필째 읽는다(`candidates.PlaceStore`).
프로필 형식은 40 spec 7단계의 `place-profile/v0`을 따른다. 40 spec이 초안이라 읽는
방식도 확정이 아니다. 정리는 docs/comparison/spec.md 4.2에 있다.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from fit_ai.match.conditions import CONDITIONS, Layer


class Verdict(StrEnum):
    """조건 하나의 판정. 값은 LLM 입력에 쓰는 말이다."""

    CONFIRMED = "확인"
    """근거가 충분하거나 장소 정보에 있다고 나온다."""
    CONTRARY = "반대"
    """아니라는 리뷰가 더 많거나 장소 정보에 없다고 나온다."""
    UNKNOWN = "모름"
    """리뷰가 없거나 적어서 판단할 수 없다."""


@dataclass(frozen=True)
class ConditionEvidence:
    """조건 하나에 대한 근거 리뷰 수. 앱 리뷰와 외부 리뷰를 합쳐 센다.

    Attributes:
        pos: 조건을 채웠다고 말한 리뷰 수
        neg: 조건을 채우지 못했다고 말한 리뷰 수
    """

    pos: int = 0
    neg: int = 0

    @property
    def supported(self) -> bool:
        """근거가 충분한지. 긍정 리뷰가 2개 이상이고 부정 리뷰의 2배 이상이면 True다."""
        return self.pos >= 2 and self.pos >= 2 * self.neg


NO_EVIDENCE = ConditionEvidence()
"""긍정·부정 리뷰가 모두 0개인 근거. 장소 프로필에 줄이 없는 조건은 이 값으로 본다."""

SCHEMA = "place-profile/v0"
"""읽을 수 있는 장소 프로필 형식"""

AXIS_OPPOSITES = {"QUIET": "LIVELY", "LIVELY": "QUIET"}
"""소음 축의 반대 극"""


@dataclass(frozen=True)
class PlaceInfo:
    """장소 정보. 40 프로필에 없어서 장소 저장소가 BE 장소 정보를 함께 읽는다.

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
            리뷰 내용은 없다. 요약 벡터는 읽지 않고 유사도는 장소 저장소가 잰다.
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

    def judge(self, condition_id: str) -> Verdict:
        """조건을 채우는지 판정한다. 시설은 장소 정보를 먼저 보고 모르면 리뷰로 본다.

        Args:
            condition_id: 조건 id. `CONDITIONS`에 있는 id만 받는다.

        Returns:
            판정
        """
        if CONDITIONS[condition_id].layer is Layer.FACILITY:
            known = self.info.facilities.get(condition_id)
            if known is not None:
                return Verdict.CONFIRMED if known else Verdict.CONTRARY
        evidence = self.evidence(condition_id)
        if evidence.supported:
            return Verdict.CONFIRMED
        if evidence.neg > evidence.pos:
            return Verdict.CONTRARY
        return Verdict.UNKNOWN

    @classmethod
    def from_dict(cls, data: dict[str, Any], info: PlaceInfo) -> "Place":
        """40 장소 프로필 하나를 읽은 JSON 객체와 장소 정보로 장소를 만든다.

        장소 id는 장소 정보의 값을 쓴다. 40 프로필의 `place_id`는 원본 데이터의 id일 수
        있어 읽지 않는다. 요약 벡터와 `embedding`은 장소 저장소가 유사도를 잴 때 쓰므로
        읽지 않는다. `personas`, `evidence`, `food_type`, `features[].label`도 MVP에서 쓰지
        않아 읽지 않는다.

        Args:
            data: 40 장소 프로필 JSON 객체 하나
            info: 같은 장소의 장소 정보

        Returns:
            장소

        Raises:
            ValueError: `schema`가 `SCHEMA`와 다르거나 리뷰 수가 음수일 때
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


def read_facilities(value: object) -> dict[str, bool | None]:
    """장소 정보의 시설 값을 읽는다. true·false가 아닌 값은 모름으로 본다.

    장소 저장소 구현체(`pg_store.py`, `json_store.py`)가 함께 쓴다.

    Args:
        value: 시설 코드별 유무를 담은 JSON 값. None이면 모두 모름이다.

    Returns:
        시설 코드별 유무. None은 모름이다.

    Raises:
        TypeError: JSON 객체가 아닐 때. 그 장소는 읽지 못한 장소로 뺀다.
    """
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise TypeError("facilities가 JSON 객체가 아니다")
    return {
        code: known if isinstance(known, bool) else None
        for code, known in value.items()
    }


def _conditions(features: list[dict[str, Any]]) -> dict[str, ConditionEvidence]:
    """40 특징 목록을 조건별 근거로 바꾼다.

    40은 소음 축을 손님이 느낀 쪽(코드)과 그게 좋았는지(좋았어요·아쉬웠어요)로 센다.
    "너무 썰렁했어요"는 `QUIET` 아쉬웠어요다. 카드는 그 조건을 채웠는지로 세므로
    느낀 쪽의 좋았어요·아쉬웠어요를 모두 긍정으로, 반대 극의 것을 모두 부정으로 본다.
    나머지 코드는 좋았어요를 긍정, 아쉬웠어요를 부정으로 그대로 쓴다. 타입이 틀린
    값은 카드와 정렬에서 터지므로 여기서 막는다.
    """
    if not isinstance(features, list) or not all(isinstance(f, dict) for f in features):
        raise TypeError("features가 객체 목록이 아니다")
    counts = {f["code"]: (f["like_count"], f["dislike_count"]) for f in features}
    for code, pair in counts.items():
        if not isinstance(code, str) or not all(_is_count(n) for n in pair):
            raise TypeError("특징의 code나 리뷰 수 타입이 다르다")
        if min(pair) < 0:
            raise ValueError("리뷰 수가 음수다")
    felt = {code: sum(counts.get(code, (0, 0))) for code in AXIS_OPPOSITES}
    conditions: dict[str, ConditionEvidence] = {}
    for code, (like, dislike) in counts.items():
        if code not in AXIS_OPPOSITES:
            conditions[code] = ConditionEvidence(pos=like, neg=dislike)
    for code, opposite in AXIS_OPPOSITES.items():
        if felt[code] or felt[opposite]:
            conditions[code] = ConditionEvidence(pos=felt[code], neg=felt[opposite])
    return conditions


def _is_count(value: object) -> bool:
    # bool은 int의 하위 타입이라 따로 막는다.
    return isinstance(value, int) and not isinstance(value, bool)
