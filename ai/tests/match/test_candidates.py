"""후보 합치기, 페르소나 항목의 순위 비율, 역 지역의 거리 한도를 확인한다. 저장소 구현은
test_pg_store.py에 있다."""

import pytest

from fit_ai.match.candidates import (
    STATION_WALK_M,
    WALK_DETOUR,
    WALK_M_PER_MINUTE,
    Candidate,
    Found,
    StationArea,
    merge_found,
    persona_rank,
)
from fit_ai.match.place import Place, PlaceInfo


class TestStationArea:
    """역 지역의 이름과 거리 한도"""

    def test_default_limit(self) -> None:
        """역지역_도보분이없으면_기본거리를도보분과직선거리로바꾼다"""
        area = StationArea("강남역", "GANGNAM")

        assert area.walk_limit_m == STATION_WALK_M
        assert area.walk_limit_minutes == STATION_WALK_M / WALK_M_PER_MINUTE
        assert area.straight_limit_m == STATION_WALK_M / WALK_DETOUR

    def test_walk_minutes_limit(self) -> None:
        """역지역_도보분을말하면_그분만큼걷는거리가한도다"""
        area = StationArea("강남역", "GANGNAM", walk_minutes=5)

        assert area.walk_limit_m == 5 * WALK_M_PER_MINUTE
        assert area.walk_limit_minutes == 5

    def test_station_name_and_points(self) -> None:
        """역지역_끝의역을뗀이름으로견주고_서비스역만좌표가있다"""
        assert StationArea("강남역", "GANGNAM").station == "강남"
        # 강남역은 2호선과 신분당선 좌표가 따로 있다.
        assert len(StationArea("강남역", "GANGNAM").points) == 2
        assert StationArea("신사역").points == ()


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
