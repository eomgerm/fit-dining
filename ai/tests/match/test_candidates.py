"""후보 합치기와 페르소나 항목의 순위 비율을 확인한다. 저장소 구현은 test_pg_store.py에 있다."""

import pytest

from fit_ai.match.candidates import Candidate, Found, merge_found, persona_rank
from fit_ai.match.place import Place, PlaceInfo


def candidate(place_id: int, similarity: float) -> Candidate:
    place = Place(place_id, PlaceInfo(place_id, "CAFE", "GANGNAM", {}), "", {})
    return Candidate(place, similarity)


class TestMergeFound:
    """요약 경로와 페르소나 경로 합치기"""

    def test_union_by_similarity(self) -> None:
        """합치기_같은장소는한번만두고_요약유사도내림차순이다"""
        summary = Found((candidate(1, 0.9), candidate(2, 0.5)), invalid=(7,))
        persona = Found((candidate(3, 0.7), candidate(2, 0.5)), invalid=(7, 8))

        merged = merge_found(summary, persona)

        assert [c.place.place_id for c in merged.candidates] == [1, 3, 2]
        assert merged.invalid == (7, 8)

    def test_empty_persona(self) -> None:
        """합치기_페르소나경로가비면_요약경로그대로다"""
        summary = Found((candidate(1, 0.9),))

        assert merge_found(summary, Found(())) == summary


@pytest.mark.parametrize(
    ("best", "expected"),
    [(0.1, 0.0), (0.5, 0.25), (0.65, 0.75), (0.9, 1.0)],
)
def test_persona_rank(best: float, expected: float) -> None:
    """순위비율_기준장소중값이더낮은곳의비율이다"""
    assert persona_rank([0.2, 0.5, 0.6, 0.8], best) == expected


def test_persona_rank_without_reference() -> None:
    """순위비율_기준장소가없으면_판단할수없어0점5다"""
    assert persona_rank([], 0.9) == 0.5
