"""조건 하나의 근거 판정을 확인한다. 카드의 근거 항목과 정렬의 등급 기준이 같이 쓴다."""

import pytest

from fit_ai.match.evidence import Verdict, is_supported, judge
from fit_ai.match.place import ConditionEvidence, Place, PlaceInfo


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


class TestIsSupported:
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
        assert is_supported(evidence(pos, neg)) is expected


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

        assert judge(place, "QUIET") is expected

    @pytest.mark.parametrize(
        ("known", "expected"), [(True, Verdict.CONFIRMED), (False, Verdict.CONTRARY)]
    )
    def test_facility_info_first(self, known: bool, expected: Verdict) -> None:
        """판정_시설정보가있으면_리뷰보다시설정보를따른다"""
        place = make_place({"PARKING": evidence(0, 5)}, {"PARKING": known})

        assert judge(place, "PARKING") is expected

    def test_unknown_facility_uses_reviews(self) -> None:
        """판정_시설정보를모르면_리뷰로판정한다"""
        place = make_place({"PARKING": evidence(4)}, {"PARKING": None})

        assert judge(place, "PARKING") is Verdict.CONFIRMED
