"""LLM 없이 만드는 카드를 확인한다.

근거 항목, 추천 이유, 특징 라벨을 본다. 근거 판정은 test_evidence.py에 있다.
"""

from fit_ai.match.cards import MAX_REASONS, build_card
from fit_ai.match.models import Source
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


class TestScoreItems:
    """근거 항목"""

    def test_request_then_preference(self) -> None:
        """근거항목_요청과취향조건이있으면_요청이먼저온다"""
        place = make_place({"QUIET": evidence(5), "PURPOSE_WORK": evidence(1)})

        card = build_card(place, ["QUIET"], ["PURPOSE_WORK"], score=80)

        assert [
            (i.condition_id, i.source, i.matched, i.evidence_count)
            for i in card.score_items
        ] == [
            ("QUIET", Source.REQUEST, True, 5),
            ("PURPOSE_WORK", Source.PREFERENCE, False, 1),
        ]

    def test_skip_unknown_and_duplicate(self) -> None:
        """근거항목_목록에없거나중복된조건은_빼고요청으로한번만넣는다"""
        card = build_card(
            make_place(), ["QUIET", "taste:담백한_국물"], ["QUIET"], score=0
        )

        assert [(i.condition_id, i.source) for i in card.score_items] == [
            ("QUIET", Source.REQUEST)
        ]

    def test_facility_info_before_reviews(self) -> None:
        """근거항목_시설정보가있으면_리뷰보다먼저본다"""
        # 주차는 장소 정보에 있음, 리뷰는 부정. 와이파이는 모름이고 리뷰도 없다.
        place = make_place(
            conditions={"PARKING": evidence(neg=3)},
            facilities={"PARKING": True, "WIFI": None},
        )

        card = build_card(place, ["PARKING", "WIFI"], [], score=0)

        assert {i.condition_id: i.matched for i in card.score_items} == {
            "PARKING": True,
            "WIFI": False,
        }


class TestReasons:
    """추천 이유"""

    def test_only_matched(self) -> None:
        """추천이유_근거가충분한조건만_리뷰와시설문구로만든다"""
        place = make_place(
            conditions={"QUIET": evidence(4), "PURPOSE_TALK": evidence(1)},
            facilities={"PARKING": True},
        )

        card = build_card(place, ["QUIET", "PURPOSE_TALK", "PARKING"], [], score=0)

        assert [r.title for r in card.reasons] == [
            '리뷰에서 "조용해요"라는 말이 많아요',
            "주차할 수 있어요",
        ]
        assert card.reasons[0].tags[0].source is Source.REQUEST
        assert card.reasons[0].quote is None

    def test_capped(self) -> None:
        """추천이유_충분한조건이많으면_최대개수까지만넣는다"""
        ids = ["QUIET", "SPACIOUS_SEATING", "COZY", "PURPOSE_TALK"]
        place = make_place({condition_id: evidence(3) for condition_id in ids})

        card = build_card(place, ids, [], score=0)

        assert len(card.reasons) == MAX_REASONS


class TestLabels:
    """특징 라벨"""

    def test_prefer_supported_with_more_reviews(self) -> None:
        """특징라벨_근거가충분하고긍정이많은특징을_먼저고른다"""
        place = make_place(
            {
                "QUIET": evidence(3),
                "COZY": evidence(8),
                "LIVELY": evidence(1),  # 근거 부족
                "SPACIOUS_SEATING": evidence(9, 9),  # 부정이 같아서 제외
            }
        )

        card = build_card(place, [], [], score=0)

        assert card.labels == ("아늑해요", "조용해요")

    def test_fall_back_to_category_and_station(self) -> None:
        """특징라벨_특징이2개보다적으면_업종과역이름으로채운다"""
        card = build_card(make_place({"QUIET": evidence(1)}), [], [], score=0)

        assert card.labels == ("조용해요", "카페")


def test_card_without_any_evidence() -> None:
    """카드_근거가하나도없으면_이유없이점수와채운라벨만있다"""
    card = build_card(make_place(), ["QUIET"], [], score=42)

    assert card.score == 42
    assert card.labels == ("카페", "강남역")
    assert card.reasons == ()
    assert card.score_items[0].matched is False
    assert card.caution is None
