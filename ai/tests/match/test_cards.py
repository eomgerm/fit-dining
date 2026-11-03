"""LLM 없이 만드는 카드를 확인한다.

근거 항목, 추천 이유, 특징 라벨을 본다. 조건 점수 계산은 test_scoring.py에 있다.
"""

from fit_ai.match.candidates import Candidate
from fit_ai.match.cards import MATCHED_SCORE, MAX_REASONS, Source, build_card
from fit_ai.match.place import ConditionEvidence, Place, PlaceInfo
from fit_ai.match.scoring import ItemScore, PlaceScore


def evidence(pos: int = 0, neg: int = 0) -> ConditionEvidence:
    return ConditionEvidence(pos=pos, neg=neg)


def make_place(conditions: dict[str, ConditionEvidence] | None = None) -> Place:
    """강남역 카페 하나. 근거만 바꿔 쓴다."""
    return Place(
        place_id=1,
        info=PlaceInfo(1, "CAFE", "GANGNAM", {}),
        summary="",
        conditions=conditions or {},
    )


def item(
    code: str,
    value: float,
    *,
    request: bool = True,
    like: bool = True,
    evidence_count: int = 0,
    from_reviews: bool = True,
) -> ItemScore:
    """조건 점수 하나. 기본은 리뷰로 판정한 요청 조각이다."""
    return ItemScore(code, request, like, 1, value, evidence_count, from_reviews)


def scored(
    *items: ItemScore, score: int | None = 50, place: Place | None = None
) -> PlaceScore:
    return PlaceScore(Candidate(place or make_place(), 1.0), score, items)


class TestScoreItems:
    """근거 항목"""

    def test_request_then_liked_preference(self) -> None:
        """근거항목_요청과취향이있으면_요청다음좋아하는취향이고싫어하는취향은빠진다"""
        card = build_card(
            scored(
                item("QUIET", 0.9, evidence_count=5),
                item("PURPOSE_WORK", 0.3, request=False, evidence_count=1),
                item("LIVELY", 0.8, request=False, like=False, evidence_count=6),
            )
        )

        assert [
            (i.condition_id, i.source, i.matched, i.evidence_count)
            for i in card.score_items
        ] == [
            ("QUIET", Source.REQUEST, True, 5),
            ("PURPOSE_WORK", Source.PREFERENCE, False, 1),
        ]

    def test_matched_from_threshold(self) -> None:
        """근거항목_조건점수가기준이상이면_근거가충분하다"""
        card = build_card(
            scored(item("QUIET", MATCHED_SCORE), item("COZY", MATCHED_SCORE - 0.01))
        )

        assert [i.matched for i in card.score_items] == [True, False]

    def test_extended_codes_labeled(self) -> None:
        """근거항목_카드조건목록밖의코드도_문구를붙여넣는다"""
        card = build_card(
            scored(
                item("FAST_SERVING", 0.8, evidence_count=4),
                item("FOOD_WESTERN", 1.0, from_reviews=False),
            )
        )

        assert [(i.label, i.evidence_count) for i in card.score_items] == [
            ("음식이 빨리 나와요", 4),
            ("양식이에요", 0),
        ]


class TestReasons:
    """추천 이유"""

    def test_only_matched(self) -> None:
        """추천이유_근거가충분한항목만_리뷰와장소정보문구로만든다"""
        card = build_card(
            scored(
                item("QUIET", 0.9),
                item("PURPOSE_TALK", 0.4),
                item("PARKING", 1.0, from_reviews=False),
            )
        )

        assert [r.title for r in card.reasons] == [
            '리뷰에서 "조용해요"라는 말이 많아요',
            "주차할 수 있어요",
        ]
        assert card.reasons[0].tags[0].source is Source.REQUEST
        assert card.reasons[0].quote is None

    def test_capped(self) -> None:
        """추천이유_충분한항목이많으면_최대개수까지만넣는다"""
        codes = ["QUIET", "SPACIOUS_SEATING", "COZY", "PURPOSE_TALK"]

        card = build_card(scored(*(item(code, 0.9) for code in codes)))

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

        card = build_card(scored(place=place))

        assert card.labels == ("아늑해요", "조용해요")

    def test_fall_back_to_category_and_station(self) -> None:
        """특징라벨_특징이2개보다적으면_업종과역이름으로채운다"""
        card = build_card(scored(place=make_place({"QUIET": evidence(1)})))

        assert card.labels == ("조용해요", "카페")


def test_card_without_score() -> None:
    """카드_판정할항목이없으면_점수와이유와항목없이채운라벨만있다"""
    card = build_card(scored(score=None))

    assert card.score is None
    assert card.labels == ("카페", "강남역")
    assert card.reasons == ()
    assert card.score_items == ()
    assert card.caution is None
