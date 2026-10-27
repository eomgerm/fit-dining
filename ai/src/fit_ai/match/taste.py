"""⓪ 취향 고르기. 분석이 만든 취향 프로필을 읽고 이번 요청과 겹치는 취향을 뺀다.

요청이 장기 취향보다 앞선다(PRD AC-28, AC-30). 규칙은 docs/comparison/spec.md 4.3이다.
취향 프로필 형식은 분석 담당의 spec(S15P31A302-39)을 따른다.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from fit_ai.features import FEATURES
from fit_ai.match.conditions import Layer

FOOD_SPICY = "FOOD_SPICY"
"""매운맛 코드. 음식 층이지만 음식 종류는 아니라 따로 다룬다."""

SCHEMA = "taste-profile/v0"
"""읽을 수 있는 취향 프로필 형식"""


@dataclass(frozen=True)
class TasteFeature:
    """취향 하나. 취향 프로필의 `features` 원소다.

    Attributes:
        code: 특징 코드(`QUIET`, `PURPOSE_GROUP`, `FOOD_SPICY` 등)
        layer: 층
        like: 좋아하면 True, 싫어하면 False
        weight: 강도. 1~3이다.
    """

    code: str
    layer: Layer
    like: bool
    weight: int


@dataclass(frozen=True)
class FreeText:
    """코드가 붙지 않은 취향 문장. 취향 프로필의 `free_texts` 원소다.

    Attributes:
        text: 문장
        like: 좋아하면 True, 싫어하면 False. 해석을 기다리는 원문이면 None이다.
        vector: 문장 벡터. 보관만 하는 문장(시설, 범용 품질, 예산, 싫어하는 문장,
            해석 대기)이면 None이다.
    """

    text: str
    like: bool | None
    vector: tuple[float, ...] | None

    @property
    def usable(self) -> bool:
        """비교에 쓰는 문장인지. spec은 벡터가 있는 문장만 취향으로 반영한다."""
        return self.vector is not None


@dataclass(frozen=True)
class TasteProfile:
    """사용자 한 명의 취향 프로필. 비교가 쓰는 필드만 읽는다.

    `evidence`는 업종별로 근거를 고를 때 쓰는데 공개 뒤로 미뤘다.

    Attributes:
        user_id: 사용자 id
        features: 취향 목록
        free_texts: 코드가 붙지 않은 취향 문장 목록
    """

    user_id: str
    features: tuple[TasteFeature, ...]
    free_texts: tuple[FreeText, ...]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TasteProfile":
        """취향 프로필 JSON 객체를 읽는다.

        Args:
            data: JSON 객체 하나

        Returns:
            취향 프로필

        Raises:
            ValueError: `schema`가 `SCHEMA`와 다르거나 모르는 층이 있을 때
            KeyError: 필수 필드가 없을 때
        """
        if data.get("schema") != SCHEMA:
            raise ValueError(f"읽을 수 없는 취향 프로필 형식이다: {data.get('schema')}")
        return cls(
            user_id=data["user_id"],
            features=tuple(
                TasteFeature(
                    code=feature["code"],
                    layer=Layer(feature["layer"]),
                    like=feature["like"],
                    weight=feature["weight"],
                )
                for feature in data.get("features", [])
            ),
            free_texts=tuple(
                FreeText(
                    text=free_text["text"],
                    like=free_text["like"],
                    vector=None
                    if free_text["vector"] is None
                    else tuple(free_text["vector"]),
                )
                for free_text in data.get("free_texts", [])
            ),
        )


def select_tastes(
    features: Sequence[TasteFeature], request_codes: Iterable[str]
) -> tuple[TasteFeature, ...]:
    """요청과 겹치는 묶음의 취향을 뺀다.

    묶음은 소음(성향 축), 방문 목적, 음식 종류, 매운맛 네 가지다. 요청에 한 묶음의
    코드가 하나라도 있으면 그 묶음의 취향은 좋아함과 싫어함을 모두 뺀다. 중요 기준과
    시설은 요청과 같은 코드여도 남긴다. 카드에서는 요청 쪽으로 한 번만 보인다.
    코드가 없는 취향 문장(`free_texts`)은 묶음을 알 수 없어 거르지 않고 그대로 쓴다.

    Args:
        features: 취향 목록
        request_codes: 요청 해석이 낸 조건 코드. 인원은 목적 코드(`PURPOSE_GROUP` 등)로
            바꿔서 넘긴다.

    Returns:
        남은 취향. 순서는 그대로다.
    """
    request_groups = {_group(code) for code in request_codes} - {None}
    return tuple(
        feature for feature in features if _group(feature.code) not in request_groups
    )


def _group(code: str) -> str | None:
    """요청이 덮어쓰는 묶음. None이면 요청과 상관없이 남긴다."""
    feature = FEATURES.get(code)
    if feature is None:
        # 시설처럼 코드표에 없는 요청 조건이다.
        return None
    if code == FOOD_SPICY:
        # "한식"을 찾아도 매운 것을 싫어하는 취향은 그대로 맞는다.
        return FOOD_SPICY
    if feature.layer in (Layer.AXIS, Layer.PURPOSE, Layer.FOOD):
        return feature.layer
    return None
