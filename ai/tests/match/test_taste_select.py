"""⓪ 취향 고르기를 확인한다.

취향 프로필 읽기, 저장 모양(회원 DB 행과 비회원 요청) 읽기, 요청과 겹치는 취향을 빼는
규칙을 본다.
"""

import pytest

from fit_ai.match.conditions import Layer
from fit_ai.match.taste_select import (
    Bundle,
    TasteFeature,
    TasteProfile,
    select_bundles,
    select_tastes,
)

# spec 샘플 5번 사용자에 소음, 음식 종류 취향과 취향 문장을 더했다.
PROFILE = {
    "schema": "taste-profile/v1",
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
        with pytest.raises(ValueError, match="형식"):
            TasteProfile.from_dict({**PROFILE, "schema": "taste-profile/v0"})

    def test_reads_real_weight_and_category(self) -> None:
        """프로필읽기_세기가실수이고업종이있으면_그대로읽는다"""
        feature = {"code": "COZY", "layer": "importance", "like": True}
        profile = TasteProfile.from_dict(
            {
                **PROFILE,
                "features": [
                    {**feature, "weight": 4.319, "category": "CAFE"},
                    {**feature, "weight": 12.5, "category": None},
                ],
            }
        )

        assert profile.features == (
            TasteFeature("COZY", Layer.IMPORTANCE, True, 4.319, "CAFE"),
            TasteFeature("COZY", Layer.IMPORTANCE, True, 12.5),
        )

    @pytest.mark.parametrize(
        ("feature", "error"),
        [
            ({"code": ["QUIET"]}, TypeError),
            ({"code": {"x": 1}}, TypeError),
            ({"weight": [1]}, TypeError),
            ({"weight": True}, TypeError),
            ({"weight": "2"}, TypeError),
            ({"weight": 0}, ValueError),
            ({"weight": -1.5}, ValueError),
            ({"weight": float("nan")}, ValueError),
            ({"weight": float("inf")}, ValueError),
            ({"category": "PUB"}, ValueError),
            ({"category": ["CAFE"]}, TypeError),
            ({"like": "false"}, TypeError),
            ({"layer": "unknown"}, ValueError),
        ],
    )
    def test_reject_bad_feature(self, feature: dict, error: type[Exception]) -> None:
        """프로필읽기_취향의타입이나값이틀리면_검색중에터지지않게읽을때거부한다"""
        bad = {"code": "COZY", "layer": "importance", "like": True, "weight": 1}

        with pytest.raises(error):
            TasteProfile.from_dict({**PROFILE, "features": [{**bad, **feature}]})

    @pytest.mark.parametrize(
        ("free_text", "error"),
        [
            ({"text": "가" * 101}, ValueError),
            ({"text": 3}, TypeError),
            ({"like": "yes"}, TypeError),
            ({"vector": "0.1"}, TypeError),
            ({"vector": [0.1, "x"]}, TypeError),
        ],
    )
    def test_reject_bad_free_text(
        self, free_text: dict, error: type[Exception]
    ) -> None:
        """프로필읽기_취향문장이100자를넘거나타입이틀리면_거부한다"""
        bad = {"text": "조용한 곳", "like": True, "vector": [0.1, 0.2]}

        with pytest.raises(error):
            TasteProfile.from_dict({**PROFILE, "free_texts": [{**bad, **free_text}]})

    def test_reject_non_list(self) -> None:
        """프로필읽기_features가목록이아니면_거부한다"""
        with pytest.raises(TypeError):
            TasteProfile.from_dict({**PROFILE, "features": {"code": "QUIET"}})


class TestReadStored:
    """저장 모양 읽기"""

    def test_reads_features_and_uncoded_chips(self) -> None:
        """저장모양읽기_계산결과와칩이있으면_계산결과는그대로코드없는칩만취향문장으로읽는다"""
        profile = TasteProfile.from_stored(
            "",
            [{"code": "QUIET", "layer": "axis", "like": True, "weight": 2}],
            [
                {"polarity": "LIKE", "label": "조용한 곳", "code": "QUIET"},
                {
                    "polarity": "LIKE",
                    "label": "창가 자리",
                    "code": None,
                    "vector": [0.6, 0.8],
                },
                {"polarity": "DISLIKE", "label": "비싼 곳"},
            ],
        )

        assert profile.user_id == ""
        # 옛 정수 세기와 category가 없는 옛 원소(전체 취향)도 읽는다
        assert profile.features == (TasteFeature("QUIET", Layer.AXIS, True, 2, None),)
        assert [(t.text, t.like, t.usable) for t in profile.free_texts] == [
            ("창가 자리", True, True),
            ("비싼 곳", False, False),
        ]

    def test_no_chips(self) -> None:
        """저장모양읽기_칩이없으면_계산결과만읽는다"""
        profile = TasteProfile.from_stored("u1", PROFILE["features"], None)

        assert profile.features == FEATURES
        assert profile.free_texts == ()

    @pytest.mark.parametrize(
        ("tastes", "error"),
        [
            ([{"polarity": "MAYBE", "label": "조용한 곳"}], ValueError),
            ([{"polarity": "LIKE"}], KeyError),
            ({"polarity": "LIKE", "label": "조용한 곳"}, TypeError),
            (["조용한 곳"], TypeError),
        ],
    )
    def test_reject_bad_chips(self, tastes: object, error: type[Exception]) -> None:
        """저장모양읽기_칩의polarity나모양이틀리면_거부한다"""
        with pytest.raises(error):
            TasteProfile.from_stored("u1", [], tastes)


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

    def test_menu_request_drops_cuisine(self) -> None:
        """취향고르기_메뉴로거른요청이면_음식종류취향을빼고매운맛은남긴다"""
        selected = select_tastes(FEATURES, [], menu_requested=True)

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

    def test_cuisine_and_spicy_requests_keep_other_flavors(self) -> None:
        """취향고르기_음식종류나매운맛요청은_다른맛취향을빼지않는다"""
        features = [*FEATURES, TasteFeature("FOOD_SWEET", Layer.FOOD, False, 1)]

        for request_codes in (["FOOD_KOREAN"], ["FOOD_SPICY"]):
            assert "FOOD_SWEET" in codes(select_tastes(features, request_codes))
        assert "FOOD_SWEET" in codes(select_tastes(features, [], menu_requested=True))

    @pytest.mark.parametrize("request_codes", [[], ["SPACIOUS_SEATING", "PARKING"]])
    def test_other_requests_keep_all(self, request_codes: list[str]) -> None:
        """취향고르기_요청이중요기준이나시설뿐이면_취향을모두남긴다"""
        assert select_tastes(FEATURES, request_codes) == FEATURES


class TestSelectCategory:
    """업종별 취향 고르기"""

    TASTES = (
        TasteFeature("QUIET", Layer.AXIS, True, 0.66),
        TasteFeature("QUIET", Layer.AXIS, True, 3.66, "CAFE"),
        TasteFeature("LIVELY", Layer.AXIS, True, 2.34, "BAR"),
        TasteFeature("VALUE_FOR_MONEY", Layer.IMPORTANCE, True, 2.5, "BAR"),
    )

    def test_request_category_uses_that_category(self) -> None:
        """취향고르기_요청업종의취향이있으면_그업종취향만쓴다"""
        selected = select_tastes(self.TASTES, [], category_group="BAR")

        assert selected == self.TASTES[2:]

    def test_request_category_without_its_tastes_uses_overall(self) -> None:
        """취향고르기_요청업종의취향이없으면_전체취향을쓴다"""
        selected = select_tastes(self.TASTES, [], category_group="RESTAURANT")

        assert selected == self.TASTES[:1]

    def test_request_without_category_uses_overall(self) -> None:
        """취향고르기_요청에업종이없으면_전체취향을쓴다"""
        assert select_tastes(self.TASTES, []) == self.TASTES[:1]

    def test_old_features_without_category_serve_every_category(self) -> None:
        """취향고르기_category가없는옛취향만있으면_어느업종요청에도그것을쓴다"""
        selected = select_tastes(FEATURES, ["PURPOSE_DATE"], category_group="CAFE")

        assert "QUIET" in codes(selected)
        assert "PURPOSE_GROUP" not in codes(selected)


def bundle_element(text, vector, weight=1.0, category=None):
    return {
        "code": None,
        "layer": None,
        "like": True,
        "weight": weight,
        "category": category,
        "text": text,
        "vector": vector,
    }


def axis_vector(i):
    v = [0.0] * 1024
    v[i] = 1.0
    return v


class TestBundles:
    """취향 묶음(taste-profile spec 4단계)"""

    def test_reads_bundle_elements_apart_from_code_features(self) -> None:
        """묶음읽기_code가null인원소는_코드취향이아니라묶음으로읽는다"""
        data = PROFILE | {
            "features": PROFILE["features"]
            + [bundle_element("창가 자리가 있는 곳", axis_vector(0), 2.5, "CAFE")]
        }
        profile = TasteProfile.from_dict(data)

        assert len(profile.features) == len(PROFILE["features"])
        assert profile.bundles == (
            Bundle("창가 자리가 있는 곳", 2.5, "CAFE", tuple(axis_vector(0))),
        )

    @pytest.mark.parametrize(
        "broken",
        [
            {"vector": [0.1] * 3},
            {"text": ""},
            {"weight": 0},
            {"like": False},
            {"category": "PUB"},
        ],
    )
    def test_rejects_broken_bundle(self, broken) -> None:
        """묶음읽기_벡터나문구나세기가틀리면_오류로멈춘다"""
        data = PROFILE | {"features": [bundle_element("창가", axis_vector(0)) | broken]}
        with pytest.raises((TypeError, ValueError)):
            TasteProfile.from_dict(data)

    def test_category_bundles_or_overall(self) -> None:
        """묶음고르기_요청업종의묶음이있으면그것을_없으면전체묶음을쓴다"""
        overall = Bundle("전체", 1.0, None, tuple(axis_vector(0)))
        cafe = Bundle("카페", 1.0, "CAFE", tuple(axis_vector(1)))

        assert select_bundles([overall, cafe], "CAFE", []) == (cafe,)
        assert select_bundles([overall, cafe], "BAR", []) == (overall,)
        assert select_bundles([overall, cafe], None, []) == (overall,)

    def test_drops_bundle_close_to_request_phrase(self) -> None:
        """묶음고르기_요청문구와유사도가기준이상인묶음은_뺀다"""
        reading = Bundle("조용히 독서할 수 있는 곳", 2.0, None, tuple(axis_vector(0)))
        brunch = Bundle("브런치 먹기 좋은 곳", 1.0, None, tuple(axis_vector(1)))
        request = [0.0] * 1024
        request[0], request[2] = 0.7, 0.714  # 독서 묶음과 코사인 0.7

        assert select_bundles([reading, brunch], None, [request]) == (brunch,)
