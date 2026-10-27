"""⓪~③을 잇는 검색 한 번을 확인한다.

일반 검색, 근처 검색, LLM 실패, 후보 없음에서 카드와 기록을 본다. 후보는 저장소가
뽑았다고 치고 유사도와 함께 넘긴다. LLM은 정해 둔 문자열로 답하는 가짜이고 후보는
섞지 않는다.
"""

import json
import random

from fit_ai.match.candidates import Candidate
from fit_ai.match.conditions import Layer
from fit_ai.match.models import Source
from fit_ai.match.place import ConditionEvidence, Place, PlaceInfo
from fit_ai.match.search import Fallback, SearchRequest, search
from fit_ai.match.taste import TasteFeature, TasteProfile


def make_candidate(place_id: int, similarity: float) -> Candidate:
    """조용함 근거가 충분한 강남역 카페 후보"""
    place = Place(
        place_id=place_id,
        info=PlaceInfo(place_id, "CAFE", "GANGNAM", {}),
        summary=f"설명 {place_id}",
        conditions={"QUIET": ConditionEvidence(pos=5)},
    )
    return Candidate(place, similarity)


CANDIDATES = [make_candidate(1, 1.0), make_candidate(2, 0.8), make_candidate(3, 0.6)]

TASTE = TasteProfile(
    user_id="u1",
    features=(
        TasteFeature("QUIET", Layer.AXIS, True, 1),
        TasteFeature("LIVELY", Layer.AXIS, False, 1),
        TasteFeature("PURPOSE_WORK", Layer.PURPOSE, True, 1),
    ),
    free_texts=(),
)


class NoShuffle(random.Random):
    """후보를 섞지 않는다. LLM 입력 번호가 유사도 순서와 같다."""

    def shuffle(self, x: list) -> None:
        pass


class FixedLlm:
    """정해 둔 문자열로 답하고 받은 입력을 남긴다."""

    def __init__(self, raw: str) -> None:
        self.raw = raw
        self.prompts: list[str] = []

    def complete_json(self, system: str, user: str) -> str:
        self.prompts.append(user)
        return self.raw


def make_request(nearby: bool = False) -> SearchRequest:
    return SearchRequest(
        text="강남역 조용한 카페",
        request_codes=("QUIET",),
        nearby=nearby,
        taste=TASTE,
    )


def ranking(*pairs: tuple[int, str]) -> str:
    return json.dumps(
        {"ranking": [{"id": number, "fit": fit} for number, fit in pairs]},
        ensure_ascii=False,
    )


def test_general_search_uses_llm() -> None:
    """검색_일반검색이면_코드등급과LLM순서로카드를만들고원본을남긴다"""
    raw = ranking((3, "딱 맞음"), (1, "대체로"), (2, "일부"))

    result = search(CANDIDATES, make_request(), FixedLlm(raw), NoShuffle())

    # 세 곳 모두 조용함이 확인이라 등급은 모두 딱 맞음이고, LLM이 낸 등급은 쓰지 않는다.
    assert [(c.place_id, c.score) for c in result.cards] == [(3, 100), (1, 95), (2, 90)]
    assert result.trace.fallback is None
    assert result.trace.llm_raw == raw
    assert result.trace.llm_seconds is not None


def test_cards_use_selected_liked_tastes() -> None:
    """검색_요청에소음조건이있으면_카드취향항목에서소음취향을빼고좋아함만남긴다"""
    result = search(
        CANDIDATES,
        make_request(),
        FixedLlm(ranking((1, "딱 맞음"), (2, "딱 맞음"), (3, "딱 맞음"))),
    )

    items = [(i.condition_id, i.source) for i in result.cards[0].score_items]
    assert items == [("QUIET", Source.REQUEST), ("PURPOSE_WORK", Source.PREFERENCE)]


def test_nearby_skips_llm() -> None:
    """검색_근처검색이면_LLM을부르지않고코드등급과유사도로점수를매긴다"""
    llm = FixedLlm(ranking())

    result = search(CANDIDATES, make_request(nearby=True), llm)

    assert llm.prompts == []
    assert [(c.place_id, c.score) for c in result.cards] == [
        (1, 100),
        (2, 95),
        (3, 90),
    ]
    assert result.trace.fallback is Fallback.NEARBY


def test_llm_picks_some() -> None:
    """검색_LLM이일부만고르면_고른후보뒤에나머지를유사도순서로붙인다"""
    raw = ranking((2, "딱 맞음"))

    result = search(CANDIDATES, make_request(), FixedLlm(raw), NoShuffle())

    assert [(c.place_id, c.score) for c in result.cards] == [(2, 100), (1, 95), (3, 90)]
    assert result.trace.fallback is None


def test_llm_failure_falls_back() -> None:
    """검색_LLM출력이형식에맞지않으면_유사도순서로넘어가고이유와원본을남긴다"""
    raw = json.dumps({"ranking": [{"id": 9}]})

    result = search(CANDIDATES, make_request(), FixedLlm(raw), NoShuffle())

    assert [c.place_id for c in result.cards] == [1, 2, 3]
    assert result.trace.fallback is Fallback.LLM_FAILED
    assert result.trace.llm_error is not None
    assert result.trace.llm_raw == raw


def test_no_candidates() -> None:
    """검색_장소가없으면_LLM을부르지않고빈목록을돌려준다"""
    llm = FixedLlm(ranking())

    result = search([], make_request(), llm)

    assert result.cards == ()
    assert llm.prompts == []
    assert result.trace.fallback is None
