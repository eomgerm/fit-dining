"""40 장소 프로필과 장소 정보를 합쳐 읽는지, 장소가 조건을 채우는지 판정하는지 확인한다.

판정은 카드의 근거 항목과 정렬의 등급 기준이 같이 쓴다.
"""

import pytest

from fit_ai.match.place import (
    NO_EVIDENCE,
    ConditionEvidence,
    Place,
    PlaceInfo,
    Verdict,
)

PROFILE = {
    "schema": "place-profile/v0",
    "place_id": "1114913849",
    "food_type": None,
    "embedding": {"model": "fake", "revision": "0", "prompt": "document"},
    "summary": {"text": "조용한 카페. 카페. 강남역 근처.", "vector": [0.6, 0.8]},
    "features": [
        {
            "code": "PURPOSE_WORK",
            "layer": "purpose",
            "like_count": 7,
            "dislike_count": 1,
            "label": True,
        },
    ],
    "personas": [],
    "evidence": [],
}

INFO = PlaceInfo(1, "CAFE", "GANGNAM", {"PARKING": False, "WIFI": True, "GROUP": None})


def load(profile: dict) -> Place:
    return Place.from_dict(profile, INFO)


def with_features(*features: tuple[str, int, int]) -> dict:
    """(코드, 좋았어요 수, 아쉬웠어요 수)로 특징 목록을 바꾼 프로필"""
    return {
        **PROFILE,
        "features": [
            {"code": code, "layer": "", "like_count": like, "dislike_count": dislike}
            for code, like, dislike in features
        ],
    }


def test_joins_profile_and_info() -> None:
    """장소읽기_프로필과장소정보가있으면_장소정보의id로합쳐필드를채운다"""
    place = load(PROFILE)

    # 40 프로필의 place_id는 원본 데이터의 id일 수 있어 BE가 보낸 id를 쓴다.
    assert place.place_id == 1
    assert place.info is INFO
    assert place.summary == "조용한 카페. 카페. 강남역 근처."
    assert place.evidence("PURPOSE_WORK") == ConditionEvidence(pos=7, neg=1)


def test_missing_condition_has_no_evidence() -> None:
    """장소읽기_프로필에없는조건이면_근거없음으로본다"""
    place = load(PROFILE)

    assert place.evidence("COZY") is NO_EVIDENCE


def test_noise_axis_counts_felt_side() -> None:
    """장소읽기_소음축이면_느낀쪽의좋았어요와아쉬웠어요를모두긍정으로센다"""
    # "조용해서 좋았어요" 5, "너무 썰렁했어요" 1, "너무 시끄러웠어요" 2
    place = load(with_features(("QUIET", 5, 1), ("LIVELY", 0, 2)))

    assert place.evidence("QUIET") == ConditionEvidence(pos=6, neg=2)
    assert place.evidence("LIVELY") == ConditionEvidence(pos=2, neg=6)


def test_noise_axis_fills_opposite() -> None:
    """장소읽기_소음축한쪽만있으면_반대극의부정근거로도센다"""
    place = load(with_features(("LIVELY", 2, 4)))

    assert place.evidence("LIVELY") == ConditionEvidence(pos=6, neg=0)
    assert place.evidence("QUIET") == ConditionEvidence(pos=0, neg=6)


def test_vector_not_needed() -> None:
    """장소읽기_요약벡터가없어도_읽는다_유사도는DB가잰다"""
    profile = {**PROFILE, "summary": {"text": "요약"}}
    del profile["embedding"]

    assert load(profile).summary == "요약"


@pytest.mark.parametrize(
    ("profile", "error", "message"),
    [
        ({**PROFILE, "schema": "place-profile/v1"}, ValueError, "place-profile/v1"),
        ({**PROFILE, "summary": {"text": None}}, TypeError, "요약"),
    ],
)
def test_reject_unusable_profile(
    profile: dict, error: type[Exception], message: str
) -> None:
    """장소읽기_형식이다르면ValueError고_요약문장이없으면TypeError다"""
    with pytest.raises(error, match=message):
        load(profile)


def evidence(pos: int = 0, neg: int = 0) -> ConditionEvidence:
    return ConditionEvidence(pos=pos, neg=neg)


def make_place(
    conditions: dict[str, ConditionEvidence] | None = None,
    facilities: dict[str, bool | None] | None = None,
) -> Place:
    """강남역 카페 하나. 근거와 시설만 바꿔 쓴다."""
    return Place(
        place_id=1,
        info=PlaceInfo(1, "CAFE", "GANGNAM", facilities or {}),
        summary="",
        conditions=conditions or {},
    )


class TestSupported:
    """근거가 충분한지"""

    @pytest.mark.parametrize(
        ("pos", "neg", "expected"),
        [
            (2, 0, True),
            (2, 1, True),
            (1, 0, False),
            (3, 2, False),
            (0, 0, False),
        ],
    )
    def test_threshold(self, pos: int, neg: int, expected: bool) -> None:
        """근거판정_긍정2개이상이고부정의2배이상일때만_충분하다"""
        assert evidence(pos, neg).supported is expected


class TestJudge:
    """확인, 반대, 모름"""

    @pytest.mark.parametrize(
        ("pos", "neg", "expected"),
        [
            (5, 1, Verdict.CONFIRMED),
            (1, 3, Verdict.CONTRARY),
            (3, 2, Verdict.UNKNOWN),
            (1, 0, Verdict.UNKNOWN),
            (0, 0, Verdict.UNKNOWN),
        ],
    )
    def test_by_reviews(self, pos: int, neg: int, expected: Verdict) -> None:
        """판정_리뷰조건이면_충분하면확인이고부정이더많으면반대고나머지는모름이다"""
        place = make_place({"QUIET": evidence(pos, neg)})

        assert place.judge("QUIET") is expected

    @pytest.mark.parametrize(
        ("known", "expected"), [(True, Verdict.CONFIRMED), (False, Verdict.CONTRARY)]
    )
    def test_facility_info_first(self, known: bool, expected: Verdict) -> None:
        """판정_시설정보가있으면_리뷰보다시설정보를따른다"""
        place = make_place({"PARKING": evidence(0, 5)}, {"PARKING": known})

        assert place.judge("PARKING") is expected

    def test_unknown_facility_uses_reviews(self) -> None:
        """판정_시설정보를모르면_리뷰로판정한다"""
        place = make_place({"PARKING": evidence(4)}, {"PARKING": None})

        assert place.judge("PARKING") is Verdict.CONFIRMED
