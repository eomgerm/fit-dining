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
    weight: int = 1,
    evidence_count: int = 0,
    from_reviews: bool = True,
) -> ItemScore:
    """조건 점수 하나. 기본은 리뷰로 판정한 요청 조각이다."""
    return ItemScore(code, request, like, weight, value, evidence_count, from_reviews)


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

    def test_matched_before_place_features(self) -> None:
        """특징라벨_맞은조건이있으면_장소특징보다먼저쓴다"""
        place = make_place({"PURPOSE_TALK": evidence(9), "COZY": evidence(8)})

        card = build_card(scored(item("PURPOSE_WORK", 0.8), place=place))

        assert card.labels == ("작업하기 좋아요", "대화하기 좋아요")

    def test_request_by_score(self) -> None:
        """특징라벨_맞은요청이여럿이면_조건점수가높은순서다"""
        card = build_card(
            scored(
                item("QUIET", 0.75),
                item("COZY", 0.95),
                item("PURPOSE_WORK", 0.9),
            )
        )

        assert card.labels == ("아늑해요", "작업하기 좋아요")

    def test_request_then_taste_by_weight(self) -> None:
        """특징라벨_요청다음취향이고_취향은세기가같으면조건점수순서다"""
        card = build_card(
            scored(
                item("QUIET", 0.7),
                item("COZY", 0.99, request=False, weight=1),
                item("PURPOSE_WORK", 0.75, request=False, weight=3),
                item("PURPOSE_TALK", 0.8, request=False, weight=3),
            )
        )

        assert card.labels == ("조용해요", "대화하기 좋아요")

    def test_unmatched_and_disliked_not_used(self) -> None:
        """특징라벨_기준미만이거나싫어하는취향은_맞은조건으로쓰지않는다"""
        card = build_card(
            scored(
                item("PURPOSE_WORK", MATCHED_SCORE - 0.01),
                item("LIVELY", 0.9, request=False, like=False),
            )
        )

        assert card.labels == ("카페", "강남역")

    def test_matched_not_repeated_in_place_features(self) -> None:
        """특징라벨_맞은조건이장소특징에도있으면_한번만쓴다"""
        place = make_place({"QUIET": evidence(9), "COZY": evidence(3)})

        card = build_card(scored(item("QUIET", 0.9), place=place))

        assert card.labels == ("조용해요", "아늑해요")

    def test_matched_labels_equal_matched_score_items(self) -> None:
        """특징라벨_맞은조건태그는_matched인근거항목과문구가같다"""
        place = make_place({"COZY": evidence(8)})

        card = build_card(
            scored(item("FOOD_WESTERN", 1.0, from_reviews=False), place=place)
        )

        matched = {i.label for i in card.score_items if i.matched}
        assert card.labels == ("양식이에요", "아늑해요")
        assert [label in matched for label in card.labels] == [True, False]


class TestPhraseAndAvoid:
    """코드 없는 조건 문구와 피해 달라는 요청"""

    def test_phrase_item(self) -> None:
        """카드_코드없는조건문구는_문구를항목이름으로쓰고이유제목은맞아요꼴이다"""
        reading = ItemScore(None, True, True, 1, 0.8, 0, False, "책 읽기 좋은 곳")

        card = build_card(scored(reading))

        [score_item] = card.score_items
        assert (score_item.condition_id, score_item.label, score_item.matched) == (
            None,
            "책 읽기 좋은 곳",
            True,
        )
        assert card.reasons[0].title == "책 읽기 좋은 곳에 맞아요"
        assert card.reasons[0].tags[0].label == "책 읽기 좋은 곳"

    def test_phrase_item_label(self) -> None:
        """카드_맞은코드없는조건문구는_문구그대로태그가된다"""
        reading = ItemScore(None, True, True, 1, 0.9, 0, False, "책 읽기 좋은 곳")

        card = build_card(scored(reading, item("QUIET", 0.8)))

        assert card.labels == ("책 읽기 좋은 곳", "조용해요")

    def test_avoided_request_hidden(self) -> None:
        """카드_피해달라는요청은_점수에만들어가고항목과이유에넣지않는다"""
        card = build_card(
            scored(item("QUIET", 0.8), item("FOOD_SPICY", 0.9, like=False))
        )

        assert [i.condition_id for i in card.score_items] == ["QUIET"]
        assert [r.tags[0].label for r in card.reasons] == ["조용해요"]


def test_card_without_score() -> None:
    """카드_판정할항목이없으면_점수와이유와항목없이채운라벨만있다"""
    card = build_card(scored(score=None))

    assert card.score is None
    assert card.labels == ("카페", "강남역")
    assert card.reasons == ()
    assert card.score_items == ()
    assert card.caution is None
