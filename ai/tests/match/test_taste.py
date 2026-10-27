"""⓪ 취향 고르기를 확인한다.

취향 프로필 읽기와 요청과 겹치는 취향을 빼는 규칙을 본다.
"""

import pytest

from fit_ai.match.conditions import Layer
from fit_ai.match.taste import TasteFeature, TasteProfile, select_tastes

# spec 샘플 5번 사용자에 소음, 음식 종류 취향과 취향 문장을 더했다.
PROFILE = {
    "schema": "taste-profile/v0",
    "user_id": "u5",
    "original_text": "너무 매운 건 못 먹어요",
    "features": [
        {"code": "QUIET", "layer": "axis", "like": True, "weight": 2},
        {"code": "LIVELY", "layer": "axis", "like": False, "weight": 2},
        {"code": "SPACIOUS_SEATING", "layer": "importance", "like": True, "weight": 1},
        {"code": "PURPOSE_GROUP", "layer": "purpose", "like": True, "weight": 1},
        {"code": "FOOD_JAPANESE", "layer": "food", "like": True, "weight": 1},
        {"code": "FOOD_SPICY", "layer": "food", "like": False, "weight": 1},
    ],
    "free_texts": [
        {
            "text": "점심엔 담백한 국물 요리가 좋아요",
            "like": True,
            "vector": [0.6, 0.8],
        },
        {"text": "주차되는 곳", "like": True, "vector": None},
    ],
    "evidence": [],
}

FEATURES = TasteProfile.from_dict(PROFILE).features


def codes(features: tuple[TasteFeature, ...]) -> list[str]:
    return [feature.code for feature in features]


class TestReadProfile:
    """프로필 읽기"""

    def test_reads_features(self) -> None:
        """프로필읽기_spec형식이면_취향을순서대로읽는다"""
        profile = TasteProfile.from_dict(PROFILE)

        assert profile.user_id == "u5"
        assert profile.features[0] == TasteFeature("QUIET", Layer.AXIS, True, 2)
        assert profile.features[-1] == TasteFeature("FOOD_SPICY", Layer.FOOD, False, 1)

    def test_reads_free_texts(self) -> None:
        """프로필읽기_취향문장이있으면_벡터있는문장만쓸수있다고본다"""
        profile = TasteProfile.from_dict(PROFILE)

        assert profile.free_texts[0].vector == (0.6, 0.8)
        assert [t.usable for t in profile.free_texts] == [True, False]

    def test_reject_other_schema(self) -> None:
        """프로필읽기_형식버전이다르면_오류로멈춘다"""
        with pytest.raises(ValueError, match="taste-profile/v1"):
            TasteProfile.from_dict({**PROFILE, "schema": "taste-profile/v1"})


class TestSelectTastes:
    """취향 고르기"""

    def test_noise_request_drops_both_poles(self) -> None:
        """취향고르기_요청에소음조건이있으면_소음좋아함과싫어함을뺀다"""
        selected = select_tastes(FEATURES, ["LIVELY"])

        assert "QUIET" not in codes(selected)
        assert "LIVELY" not in codes(selected)

    def test_purpose_request_drops_purpose(self) -> None:
        """취향고르기_요청에목적이있으면_다른목적취향도뺀다"""
        selected = select_tastes(FEATURES, ["PURPOSE_DATE"])

        assert "PURPOSE_GROUP" not in codes(selected)

    def test_cuisine_request_keeps_spicy(self) -> None:
        """취향고르기_요청에음식종류가있으면_음식종류만빼고매운맛은남긴다"""
        selected = select_tastes(FEATURES, ["FOOD_KOREAN"])

        assert "FOOD_JAPANESE" not in codes(selected)
        assert "FOOD_SPICY" in codes(selected)

    def test_spicy_request_drops_spicy(self) -> None:
        """취향고르기_요청에매운맛이있으면_매운맛취향을뺀다"""
        selected = select_tastes(FEATURES, ["FOOD_SPICY"])

        assert codes(selected) == [
            "QUIET",
            "LIVELY",
            "SPACIOUS_SEATING",
            "PURPOSE_GROUP",
            "FOOD_JAPANESE",
        ]

    @pytest.mark.parametrize("request_codes", [[], ["SPACIOUS_SEATING", "PARKING"]])
    def test_other_requests_keep_all(self, request_codes: list[str]) -> None:
        """취향고르기_요청이중요기준이나시설뿐이면_취향을모두남긴다"""
        assert select_tastes(FEATURES, request_codes) == FEATURES
