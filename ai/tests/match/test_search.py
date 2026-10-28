"""요청 해석부터 카드 만들기까지 잇는 검색 한 번을 확인한다.

거르기 조건 만들기, 일반 검색, 근처 검색, LLM 실패, 후보 없음, 인코딩·저장소 실패와
결과 없음 문구를 본다. 공유 모듈 `fit_ai.embedding`, `fit_ai.gms`는 가짜로 바꿔 끼우고
장소 저장소도 가짜다. LLM에 넣는 후보는 섞지 않는다.
"""

import json
import random
from collections.abc import Callable, Sequence

import pytest

from fit_ai import embedding, gms
from fit_ai.match import interpretation
from fit_ai.match import search as search_module
from fit_ai.match.candidates import (
    Candidate,
    Found,
    MapBounds,
    PlaceFilter,
    StoreError,
)
from fit_ai.match.cards import Source
from fit_ai.match.conditions import Layer
from fit_ai.match.interpretation import Conditions
from fit_ai.match.place import ConditionEvidence, Place, PlaceInfo
from fit_ai.match.search import (
    EmbeddingError,
    Fallback,
    SearchRequest,
    SearchResult,
    empty_reason,
    search,
)
from fit_ai.match.taste_select import TasteFeature, TasteProfile

QUERY = "강남역 조용한 카페"

INTERPRETED = {
    "text": None,
    "embedding_text": "강남역 조용한 카페",
    "codes": ["QUIET"],
    "category_group": "CAFE",
    "station": "GANGNAM",
    "nearby": False,
    "change_summary": None,
}


def make_candidate(place_id: int, similarity: float) -> Candidate:
    """조용함 근거가 충분한 강남역 카페 후보"""
    place = Place(
        place_id=place_id,
        info=PlaceInfo(place_id, "CAFE", "GANGNAM", {}),
        summary=f"설명 {place_id}",
        conditions={"QUIET": ConditionEvidence(pos=5)},
    )
    return Candidate(place, similarity)


CANDIDATES = (make_candidate(1, 1.0), make_candidate(2, 0.8), make_candidate(3, 0.6))

TASTE = TasteProfile(
    user_id="u1",
    features=(
        TasteFeature("QUIET", Layer.AXIS, True, 1),
        TasteFeature("LIVELY", Layer.AXIS, False, 1),
        TasteFeature("PURPOSE_WORK", Layer.PURPOSE, True, 1),
    ),
    free_texts=(),
)

FakeGms = Callable[[Callable[[list[dict]], object]], list[list[dict]]]


class NoShuffle(random.Random):
    """후보를 섞지 않는다. LLM 입력 번호가 유사도 순서와 같다."""

    def shuffle(self, x: list) -> None:
        pass


class FakeStore:
    """정해 둔 후보를 돌려주고 받은 거르기 조건, 요청문 벡터, k를 남긴다."""

    def __init__(
        self,
        candidates: Sequence[Candidate] = CANDIDATES,
        invalid: tuple[int, ...] = (),
        fail: bool = False,
    ) -> None:
        self.candidates = tuple(candidates)
        self.invalid = invalid
        self.fail = fail
        self.calls: list[tuple[PlaceFilter, Sequence[float], int]] = []

    def find(self, place_filter: PlaceFilter, query: Sequence[float], k: int) -> Found:
        if self.fail:
            raise StoreError("장소 저장소를 읽지 못했다: OperationalError")
        self.calls.append((place_filter, query, k))
        return Found(self.candidates[:k], self.invalid)

    def mismatched(self) -> int:
        return 0


@pytest.fixture(autouse=True)
def encoder(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    """공유 모듈의 요청문 인코딩을 같은 벡터를 내는 가짜로 바꾼다."""
    seen: list[list[str]] = []

    def encode_queries(texts: list[str]) -> list[list[float]]:
        seen.append(texts)
        return [[1.0, 0.0] for _ in texts]

    monkeypatch.setattr(embedding, "encode_queries", encode_queries)
    return seen


def ranking(*pairs: tuple[int, str]) -> dict:
    """정렬 LLM 출력. (후보 번호, 등급) 순서다."""
    return {"ranking": [{"id": number, "fit": fit} for number, fit in pairs]}


def answers(
    rank: object = None, **interpreted: object
) -> Callable[[list[dict]], object]:
    """가짜 GMS 답. 해석에는 정해 둔 조건으로, 정렬에는 `rank`로 답한다.

    `rank`가 None이면 정렬 호출은 실패한다.
    """

    def answer(messages: list[dict]) -> object:
        if messages[0]["content"] == interpretation.SYSTEM_PROMPT:
            return {**INTERPRETED, **interpreted}
        return rank

    return answer


def rank_calls(calls: list[list[dict]]) -> int:
    """GMS 호출 중 정렬 호출 수"""
    return sum(m[0]["content"] != interpretation.SYSTEM_PROMPT for m in calls)


def run(store: FakeStore | None = None, **request: object) -> SearchResult:
    return search(
        SearchRequest(QUERY, **request),  # type: ignore[arg-type]
        store or FakeStore(),
        NoShuffle(),
    )


def scores(result: SearchResult) -> list[tuple[int, int]]:
    return [(card.place_id, card.score) for card in result.cards]


class TestFilter:
    """거르기 조건과 요청문 벡터"""

    def test_from_conditions(self, fake_gms: FakeGms, encoder: list) -> None:
        """거르기_해석한업종역시설로_벡터용문장벡터와함께20곳을뽑는다"""
        fake_gms(answers(ranking((1, "딱 맞음")), codes=["QUIET", "PARKING"]))
        store = FakeStore()

        run(store)

        # 벡터용 문장의 위치 말은 해석이 지운다. 역은 거르기에만 쓴다.
        assert encoder == [["조용한 카페"]]
        assert store.calls == [
            (
                PlaceFilter(
                    category_group="CAFE", station="GANGNAM", facilities=("PARKING",)
                ),
                [1.0, 0.0],
                20,
            )
        ]

    def test_map_bounds_replace_station(self, fake_gms: FakeGms) -> None:
        """거르기_지도영역이있으면_역대신좌표로거른다"""
        fake_gms(answers(ranking((1, "딱 맞음"))))
        store = FakeStore()

        run(store, bounds=MapBounds(sw_lat=37.49, ne_lng=127.04))

        place_filter, _, _ = store.calls[0]
        assert place_filter.station is None
        assert place_filter.bounds == MapBounds(sw_lat=37.49, ne_lng=127.04)


class TestRanking:
    """정렬과 카드"""

    def test_general_search_uses_llm(self, fake_gms: FakeGms) -> None:
        """검색_일반검색이면_코드등급과LLM순서로카드를만들고원본을남긴다"""
        rank = ranking((3, "딱 맞음"), (1, "대체로"), (2, "일부"))
        fake_gms(answers(rank))

        result = run(taste=TASTE)

        # 세 곳 모두 조용함이 확인이라 등급은 모두 딱 맞음이고, LLM이 낸 등급은 쓰지 않는다.
        assert scores(result) == [(3, 100), (1, 95), (2, 90)]
        assert result.interpretation.llm_error is None
        assert result.empty_reason is None
        assert result.trace.candidates == 3
        assert result.trace.fallback is None
        # 로그용 출력에는 읽어 낸 후보 번호만 남는다.
        assert json.loads(result.trace.rank_llm_raw) == {
            "ranking": [{"id": 3}, {"id": 1}, {"id": 2}]
        }
        assert result.trace.rank_llm_seconds is not None

    def test_cards_use_selected_liked_tastes(self, fake_gms: FakeGms) -> None:
        """검색_요청에소음조건이있으면_카드취향항목에서소음취향을빼고좋아함만남긴다"""
        fake_gms(answers(ranking((1, "딱 맞음"), (2, "딱 맞음"), (3, "딱 맞음"))))

        result = run(taste=TASTE)

        items = [(i.condition_id, i.source) for i in result.cards[0].score_items]
        assert items == [
            ("QUIET", Source.REQUEST),
            ("PURPOSE_WORK", Source.PREFERENCE),
        ]

    def test_nearby_skips_llm(self, fake_gms: FakeGms) -> None:
        """검색_근처검색이면_역으로거르지않고100곳을뽑아LLM없이코드등급과유사도로정렬한다"""
        calls = fake_gms(answers(nearby=True, station=None))
        store = FakeStore()

        result = run(store)

        place_filter, _, k = store.calls[0]
        assert (place_filter.station, k) == (None, 100)
        assert rank_calls(calls) == 0
        assert scores(result) == [(1, 100), (2, 95), (3, 90)]
        assert result.trace.fallback is Fallback.NEARBY

    def test_llm_picks_some(self, fake_gms: FakeGms) -> None:
        """검색_LLM이일부만고르면_고른후보뒤에나머지를유사도순서로붙인다"""
        fake_gms(answers(ranking((2, "딱 맞음"))))

        result = run()

        assert scores(result) == [(2, 100), (1, 95), (3, 90)]
        assert result.trace.fallback is None

    def test_bad_llm_output_falls_back(self, fake_gms: FakeGms) -> None:
        """검색_정렬LLM출력이형식에맞지않으면_다시부르지않고유사도순서로넘어가고이유와원본을남긴다"""
        calls = fake_gms(answers({"ranking": [{"id": 9}]}))

        result = run()

        assert rank_calls(calls) == 1
        assert [card.place_id for card in result.cards] == [1, 2, 3]
        assert result.trace.fallback is Fallback.LLM_FAILED
        assert result.trace.rank_llm_error is not None
        assert json.loads(result.trace.rank_llm_raw) == {"ranking": [{"id": 9}]}

    def test_llm_call_failure_falls_back(self, fake_gms: FakeGms) -> None:
        """검색_정렬LLM호출이실패하면_유사도순서로넘어가고원본은없다"""
        fake_gms(answers(None))

        result = run()

        assert [card.place_id for card in result.cards] == [1, 2, 3]
        assert result.trace.fallback is Fallback.LLM_FAILED
        assert result.trace.rank_llm_raw is None


class TestBudget:
    """검색 시간 예산"""

    def test_gms_failure_skips_rank_llm(self, fake_gms: FakeGms) -> None:
        """예산_해석에서GMS호출이실패하면_정렬LLM을부르지않고유사도로정렬한다"""
        calls = fake_gms(lambda messages: None)

        result = run()

        assert result.interpretation.gms_failed is True
        assert rank_calls(calls) == 0
        assert result.trace.fallback is Fallback.LLM_FAILED
        assert "해석에서 GMS" in result.trace.rank_llm_error
        assert len(result.cards) == 3

    def test_no_time_left_skips_rank_llm(
        self, fake_gms: FakeGms, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """예산_남은시간이정렬한번에모자라면_정렬LLM을부르지않는다"""
        calls = fake_gms(answers(ranking((1, "딱 맞음"))))
        monkeypatch.setattr(search_module, "SEARCH_BUDGET_SECONDS", 0.0)

        result = run()

        assert rank_calls(calls) == 0
        assert result.trace.fallback is Fallback.LLM_FAILED
        assert "예산" in result.trace.rank_llm_error

    def test_rank_wait_and_shared_client(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """예산_정렬LLM은남은예산의절반까지만기다리고_해석과정렬이같은클라이언트를쓴다"""
        seen: list[tuple[bool, float, object]] = []
        answer = answers(ranking((1, "딱 맞음")))

        def call_json(
            messages, parse, *, response_format=None, timeout=10.0, client=None
        ):
            is_interpret = messages[0]["content"] == interpretation.SYSTEM_PROMPT
            seen.append((is_interpret, timeout, client))
            return parse(answer(messages))

        monkeypatch.setattr(gms, "call_json", call_json)
        client = object()

        search(SearchRequest(QUERY), FakeStore(), NoShuffle(), 5.0, client)  # type: ignore[arg-type]

        [(first, interpret_wait, c1), (second, rank_wait, c2)] = seen
        assert (first, second) == (True, False)
        assert interpret_wait == 5.0
        assert 4.0 < rank_wait <= search_module.SEARCH_BUDGET_SECONDS / 2
        assert c1 is client and c2 is client


class TestEmptyAndFailures:
    """결과 없음과 실패"""

    def test_no_candidates(self, fake_gms: FakeGms) -> None:
        """검색_뽑힌장소가없으면_정렬LLM을부르지않고결과없음이유를준다"""
        calls = fake_gms(answers(codes=["PARKING"]))

        result = run(FakeStore(candidates=()))

        assert result.cards == ()
        assert rank_calls(calls) == 0
        assert result.trace.fallback is None
        assert result.empty_reason is not None
        assert result.empty_reason.cause == "강남역 카페 중 주차할 수 있는 곳이 없어요"

    def test_invalid_profiles_reported(self, fake_gms: FakeGms) -> None:
        """검색_저장소가읽지못한프로필이있으면_그id를결과에담는다"""
        fake_gms(answers(ranking((1, "딱 맞음"))))

        result = run(FakeStore(invalid=(7,)))

        assert result.invalid_place_ids == (7,)
        assert len(result.cards) == 3

    def test_embedding_failure(
        self, fake_gms: FakeGms, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """검색_요청문인코딩이실패하면_저장소를읽지않고EmbeddingError를낸다"""

        def encode_queries(texts: list[str]) -> list[list[float]]:
            raise RuntimeError("CUDA out of memory")

        fake_gms(answers())
        monkeypatch.setattr(embedding, "encode_queries", encode_queries)
        store = FakeStore()

        with pytest.raises(EmbeddingError, match="RuntimeError"):
            run(store)
        assert store.calls == []

    def test_store_failure(self, fake_gms: FakeGms) -> None:
        """검색_장소저장소를읽지못하면_StoreError를그대로낸다"""
        fake_gms(answers())

        with pytest.raises(StoreError):
            run(FakeStore(fail=True))


class TestEmptyReason:
    """결과 없음 문구"""

    def test_one_facility(self) -> None:
        """결과없음_시설하나면_그시설을빼보라고한다"""
        conditions = Conditions("t", "t", ("PARKING",), "BAR", "YEOKSAM")

        reason = empty_reason(conditions, in_map_bounds=False)

        assert reason.cause == "역삼역 술집 중 주차할 수 있는 곳이 없어요"
        assert reason.suggestion == "주차 조건을 빼고 다시 찾아 보세요"

    def test_many_facilities(self) -> None:
        """결과없음_시설이여럿이면_시설조건을줄이라고한다"""
        conditions = Conditions("t", "t", ("PARKING", "WIFI"), "CAFE")

        reason = empty_reason(conditions, in_map_bounds=False)

        assert reason.cause == "카페 중 요청한 시설을 모두 갖춘 곳이 없어요"

    def test_map_bounds(self) -> None:
        """결과없음_지도영역으로걸렀으면_역대신이지역이라하고지도를옮기라고한다"""
        conditions = Conditions("t", "t", (), "CAFE", "GANGNAM")

        reason = empty_reason(conditions, in_map_bounds=True)

        assert reason.cause == "이 지역 카페 중 조건에 맞는 곳이 없어요"
        assert reason.suggestion == "지도를 옮기거나 넓혀서 다시 찾아 보세요"

    def test_nearby_without_category(self) -> None:
        """결과없음_근처검색에업종이없으면_역없이가게라고한다"""
        conditions = Conditions("t", "t", station="GANGNAM", nearby=True)

        assert empty_reason(conditions, in_map_bounds=False).cause == (
            "가게 중 조건에 맞는 곳이 없어요"
        )
