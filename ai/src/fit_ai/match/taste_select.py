"""⓪ 취향 고르기. 분석이 만든 취향 프로필을 읽고 이번 요청과 겹치는 취향을 뺀다.

요청이 장기 취향보다 앞선다(PRD AC-28, AC-30). 규칙은 docs/comparison/spec.md 4.3이다.
취향 프로필 형식은 분석 담당의 spec(S15P31A302-39)을 따른다. 회원 취향은 취향
저장소(`TasteStore`)에서 꺼낸다. 구현은 `pg_store.py`(DB)다. 회원 취향과 검색 요청에
실린 비회원 취향은 같은 저장 모양(`features`, `tastes`)이라 `TasteProfile.from_stored`
하나로 읽는다.
"""

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from fit_ai.features import FEATURES, FLAVORS
from fit_ai.match.conditions import CATEGORY_NAMES, Layer

SCHEMA = "taste-profile/v1"
"""읽을 수 있는 취향 프로필 형식"""

POLARITY = {"LIKE": True, "DISLIKE": False}
"""온보딩 칩의 `polarity`(BE `Preferences.Polarity`)를 좋아함 여부로 바꾸는 표"""

MAX_FREE_TEXT_LENGTH = 100
"""취향 문장 길이 상한. 온보딩 직접 입력 상한(PRD FR-06)과 같다. 문장은 정렬 LLM
입력에 들어가므로 길이를 막는다."""


@dataclass(frozen=True)
class TasteFeature:
    """취향 하나. 취향 프로필의 `features` 원소다.

    Attributes:
        code: 특징 코드(`QUIET`, `PURPOSE_GROUP`, `FOOD_SPICY` 등)
        layer: 층
        like: 좋아하면 True, 싫어하면 False
        weight: 세기. 0보다 큰 수다. 상한은 없고 오래된 근거가 약해져 약 15에서 멈춘다.
        category: 업종(`RESTAURANT`, `CAFE`, `BAR`). 전체 취향이면 None이다.
    """

    code: str
    layer: Layer
    like: bool
    weight: float
    category: str | None = None


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
            ValueError: `schema`가 `SCHEMA`와 다르거나, 모르는 층이나 업종이 있거나, 세기나
                문장 길이가 범위를 벗어날 때
            KeyError: 필수 필드가 없을 때
            TypeError: 필드의 타입이 다를 때
        """
        if data.get("schema") != SCHEMA:
            raise ValueError("읽을 수 없는 취향 프로필 형식이다")
        if not isinstance(data["user_id"], str):
            raise TypeError("user_id가 문자열이 아니다")
        return cls(
            user_id=data["user_id"],
            features=tuple(_feature(f) for f in _list(data.get("features", []))),
            free_texts=tuple(_free_text(t) for t in _list(data.get("free_texts", []))),
        )

    @classmethod
    def from_stored(
        cls, user_id: str, features: object, tastes: object
    ) -> "TasteProfile":
        """저장 모양(`user_preferences`의 `features`, `tastes`)을 취향 프로필로 읽는다.

        회원은 DB 행이고, 비회원은 기기가 저장해 검색 요청에 실어 보낸 같은 모양이다.
        `features`는 취향 분석이 계산한 결과라 그대로 쓴다. 칩 중 코드가 붙은 것은 이미
        `features`에 들어 있어 코드가 없는 칩만 취향 문장으로 읽는다. 벡터는 코드 없는
        좋아함 칩에만 있다. `code` 키가 없는 칩(취향 분석 결과를 더하기 전의 온보딩 원본)도
        벡터가 없어 보관만 하는 문장이 된다.

        Args:
            user_id: 사용자 id. 비회원이면 빈 문자열이다.
            features: 취향 계산 결과(`{code, layer, like, weight, category}` 목록).
                `category`가 없는 옛 원소는 전체 취향으로 읽는다.
            tastes: 온보딩 칩(`{polarity, label, code, vector}` 목록). 없으면 None이다.

        Returns:
            취향 프로필

        Raises:
            ValueError: `polarity`가 LIKE·DISLIKE가 아니거나 취향 값이 범위를 벗어났을 때
            KeyError: 칩이나 취향에 필수 필드가 없을 때
            TypeError: 칩 목록이나 취향의 타입이 다를 때
        """
        chips = [] if tastes is None else tastes
        if not isinstance(chips, list) or not all(isinstance(c, dict) for c in chips):
            raise TypeError("tastes가 객체 목록이 아니다")
        if any(chip["polarity"] not in POLARITY for chip in chips):
            raise ValueError("칩의 polarity가 LIKE나 DISLIKE가 아니다")
        free_texts = [
            {
                "text": chip["label"],
                "like": POLARITY[chip["polarity"]],
                "vector": chip.get("vector"),
            }
            for chip in chips
            if chip.get("code") is None
        ]
        return cls.from_dict(
            {
                "schema": SCHEMA,
                "user_id": user_id,
                "features": features,
                "free_texts": free_texts,
            }
        )


class TasteStore(Protocol):
    """사용자 id로 회원의 취향 프로필을 꺼내는 저장소.

    취향 분석이 계산해 둔 결과를 읽기만 한다. 비교는 취향을 계산하지 않는다.
    """

    def find(self, user_id: str) -> TasteProfile | None:
        """회원 한 명의 취향 프로필을 꺼낸다.

        Args:
            user_id: 회원 id. BE가 로그인으로 확인한 id다.

        Returns:
            취향 프로필. 그 회원의 취향이 저장돼 있지 않으면 None이다.

        Raises:
            StoreError: 저장소를 읽지 못했을 때
            ValueError: 저장된 취향의 값이 범위를 벗어났을 때
            KeyError: 저장된 취향에 필수 필드가 없을 때
            TypeError: 저장된 취향의 타입이 다를 때
        """
        ...


def select_tastes(
    features: Sequence[TasteFeature],
    request_codes: Iterable[str],
    menu_requested: bool = False,
    category_group: str | None = None,
) -> tuple[TasteFeature, ...]:
    """요청 업종의 취향을 고르고 요청과 겹치는 묶음의 취향을 뺀다.

    요청에 업종이 있고 그 업종의 취향이 있으면 그것을, 아니면 전체 취향을 쓴다. 업종별
    취향은 리뷰가 있는 회원만 있고, 리뷰가 없으면 전체 취향과 같다.

    묶음은 소음(성향 축), 방문 목적, 음식 종류, 매운맛 네 가지다. 요청에 한 묶음의
    코드가 하나라도 있으면 그 묶음의 취향은 좋아함과 싫어함을 모두 뺀다. 메뉴로 거른
    요청("라멘")도 음식 종류를 정한 것이라 음식 종류 취향을 뺀다. 중요 기준과 시설은
    요청과 같은 코드여도 남긴다. 카드에서는 요청 쪽으로 한 번만 보인다. 코드가 없는 취향
    문장(`free_texts`)은 묶음을 알 수 없어 거르지 않고 그대로 쓴다.

    Args:
        features: 취향 목록
        request_codes: 요청 해석이 낸 조건 코드. 인원은 목적 코드(`PURPOSE_GROUP` 등)로
            바꿔서 넘긴다.
        menu_requested: 요청이 메뉴로 걸렀는지(`search.menu_terms`가 비지 않았는지)
        category_group: 요청 업종. 업종을 말하지 않았으면 None이다.

    Returns:
        남은 취향. 순서는 그대로다.
    """
    in_category = [f for f in features if f.category == category_group]
    if category_group is not None and not in_category:
        in_category = [f for f in features if f.category is None]
    request_groups = {_group(code) for code in request_codes} - {None}
    if menu_requested:
        request_groups.add(Layer.FOOD)
    return tuple(
        feature for feature in in_category if _group(feature.code) not in request_groups
    )


def _list(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not all(isinstance(v, dict) for v in value):
        raise TypeError("객체 목록이 아니다")
    return value


def _feature(data: dict[str, Any]) -> TasteFeature:
    """`features` 원소 하나를 읽는다. 타입이 틀리면 검색 중에 터지므로 여기서 막는다.

    옛 정수 세기(1~3)도 읽는다.
    """
    code, like, weight = data["code"], data["like"], data["weight"]
    category = data.get("category")
    if not isinstance(code, str) or not isinstance(like, bool):
        raise TypeError("취향의 code나 like 타입이 다르다")
    # bool은 int의 하위 타입이라 따로 막는다.
    if not isinstance(weight, int | float) or isinstance(weight, bool):
        raise TypeError("취향의 weight가 수가 아니다")
    if not math.isfinite(weight) or weight <= 0:
        raise ValueError("취향의 weight가 범위를 벗어났다")
    if category is not None and not isinstance(category, str):
        raise TypeError("취향의 category가 문자열이 아니다")
    if category is not None and category not in CATEGORY_NAMES:
        raise ValueError("취향의 category가 모르는 업종이다")
    return TasteFeature(
        code=code,
        layer=Layer(data["layer"]),
        like=like,
        weight=weight,
        category=category,
    )


def _free_text(data: dict[str, Any]) -> FreeText:
    """`free_texts` 원소 하나를 읽는다."""
    text, like, vector = data["text"], data["like"], data["vector"]
    if not isinstance(text, str) or not (like is None or isinstance(like, bool)):
        raise TypeError("취향 문장의 text나 like 타입이 다르다")
    if len(text) > MAX_FREE_TEXT_LENGTH:
        raise ValueError("취향 문장이 너무 길다")
    if vector is not None and not (
        isinstance(vector, list)
        and all(isinstance(v, int | float) and not isinstance(v, bool) for v in vector)
    ):
        raise TypeError("취향 문장의 vector가 숫자 목록이 아니다")
    return FreeText(
        text=text, like=like, vector=None if vector is None else tuple(vector)
    )


def _group(code: str) -> str | None:
    """요청이 덮어쓰는 묶음. None이면 요청과 상관없이 남긴다."""
    feature = FEATURES.get(code)
    if feature is None:
        # 시설처럼 코드표에 없는 요청 조건이다.
        return None
    if code in FLAVORS:
        # 맛 코드는 음식 층이지만 음식 종류가 아니다. "한식"을 찾아도 매운 것을 싫어하는 취향은
        # 그대로 맞는다. 맛마다 따로 덮는다.
        return code
    if feature.layer in (Layer.AXIS, Layer.PURPOSE, Layer.FOOD):
        return feature.layer
    return None
