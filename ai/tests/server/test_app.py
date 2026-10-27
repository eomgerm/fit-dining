"""AI API를 확인한다.

요청을 검색 요청으로 바꾸는지, 검색 결과를 응답 모양(BE 카드 계약)과 폴백 표시로
바꾸는지, 준비 안 됨·혼잡·입력 오류·검색 실패의 ProblemDetail, 로그에 요청문이 남지
않는지를 본다. 검색 자체는 tests/match/test_search.py에서 보고, 여기서는 `search`를
정해 둔 결과를 내는 가짜로 바꿔 끼운다.
"""

import json
import logging
from collections.abc import Sequence

import pytest
from fastapi.testclient import TestClient

from fit_ai import embedding
from fit_ai.match.candidates import Found, MapBounds, PlaceFilter, StoreError
from fit_ai.match.cards import Card, Reason, ReasonTag, ScoreItem, Source
from fit_ai.match.interpretation import Conditions, Interpretation
from fit_ai.match.search import (
    EmbeddingError,
    EmptyReason,
    Fallback,
    SearchRequest,
    SearchResult,
    SearchTrace,
)
from fit_ai.match.taste import TasteProfile
from server import app as server_app
from server.app import Dependencies, create_app

QUERY_TEXT = "역삼역 조용한 술집 찾아요"

CONDITIONS = Conditions(
    text=QUERY_TEXT,
    embedding_text="역삼역 조용한 술집",
    codes=("QUIET",),
    category_group="BAR",
    station="YEOKSAM",
)

CONDITIONS_BODY = {
    "text": QUERY_TEXT,
    "embeddingText": "역삼역 조용한 술집",
    "codes": ["QUIET"],
    "categoryGroup": "BAR",
    "station": "YEOKSAM",
    "nearby": False,
}

TASTE_BODY = {
    "schema": "taste-profile/v0",
    "user_id": "u1",
    "features": [{"code": "QUIET", "layer": "axis", "like": True, "weight": 1}],
}

CARD = Card(
    place_id=2,
    score=100,
    labels=("조용해요", "술집"),
    reasons=(
        Reason(
            '리뷰에서 "조용해요"라는 말이 많아요',
            (ReasonTag(Source.REQUEST, "조용해요"),),
        ),
    ),
    score_items=(ScoreItem("QUIET", Source.REQUEST, "조용해요", True, 5),),
)

MODELS = {
    "embedding": f"{embedding.MODEL_ID}@{embedding.REVISION}",
    "llm": "gpt-4o-mini",
}


def make_result(
    cards: tuple[Card, ...] = (CARD,),
    conditions: Conditions = CONDITIONS,
    change_summary: str | None = None,
    interpret_error: str | None = None,
    fallback: Fallback | None = None,
    empty: EmptyReason | None = None,
    invalid: tuple[int, ...] = (),
) -> SearchResult:
    """검색 결과. 기본은 LLM으로 해석하고 정렬해 카드 한 장이 나온 결과다."""
    failed = fallback is Fallback.LLM_FAILED
    ranked_by_llm = bool(cards) and fallback is None
    trace = SearchTrace(
        embed_seconds=0.1,
        store_seconds=0.01,
        candidates=len(cards),
        fallback=fallback,
        rank_llm_error="후보 밖 번호다: 9" if failed else None,
        rank_llm_raw='{"ranking": [{"id": 1}]}' if ranked_by_llm else None,
        rank_llm_seconds=1.0 if failed or ranked_by_llm else None,
    )
    return SearchResult(
        interpretation=Interpretation(conditions, change_summary, interpret_error, 1.0),
        cards=cards,
        empty_reason=empty,
        invalid_place_ids=invalid,
        trace=trace,
    )


class FakeSearch:
    """`search` 대신 정해 둔 결과를 내거나 예외를 던진다. 받은 인자를 남긴다."""

    def __init__(self) -> None:
        self.outcome: SearchResult | Exception = make_result()
        self.calls: list[tuple[SearchRequest, object, float]] = []

    def __call__(
        self, request: SearchRequest, store: object, timeout: float = 5.0
    ) -> SearchResult:
        self.calls.append((request, store, timeout))
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class FakeStore:
    """상태 확인에 쓰는 장소 저장소. 검색은 가짜 `search`가 하므로 `find`는 쓰지 않는다."""

    def __init__(self, fail: bool = False, mismatched: int = 0) -> None:
        self.fail = fail
        self.mismatched_count = mismatched

    def find(self, place_filter: PlaceFilter, query: Sequence[float], k: int) -> Found:
        raise NotImplementedError

    def mismatched(self) -> int:
        if self.fail:
            raise StoreError("장소 저장소를 읽지 못했다: OperationalError")
        return self.mismatched_count


@pytest.fixture(autouse=True)
def searched(monkeypatch: pytest.MonkeyPatch) -> FakeSearch:
    fake = FakeSearch()
    monkeypatch.setattr(server_app, "search", fake)
    return fake


def client(**overrides: object) -> TestClient:
    deps = {"embedding_ready": True, "store": FakeStore()}
    deps.update(overrides)
    return TestClient(create_app(Dependencies(**deps)))  # type: ignore[arg-type]


def post(app: TestClient, **body: object) -> dict:
    response = app.post("/v1/search", json={"query": QUERY_TEXT, **body})
    assert response.status_code == 200
    return response.json()


class TestSearch:
    """검색 응답"""

    def test_cards_in_be_shape(self) -> None:
        """검색_새검색이면_조건과BE카드모양과모델버전을돌려준다"""
        data = post(client())

        assert data["conditions"] == CONDITIONS_BODY
        assert data["nearby"] is False
        assert data["interpretedBy"] == "LLM"
        assert data["rankedBy"] == "LLM"
        assert data["fallbacks"] == []
        assert data["models"] == MODELS
        card = data["items"][0]
        assert set(card) == {"placeId", "score", "labels", "reasons", "scoreItems"}
        assert (card["placeId"], card["score"]) == (2, 100)
        assert card["scoreItems"][0] == {
            "source": "REQUEST",
            "label": "조용해요",
            "matched": True,
            "evidenceCount": 5,
        }
        # 인용이 없으면 null을 보내지 않고 필드를 뺀다.
        assert "quote" not in card["reasons"][0]
        assert "changeSummary" not in data
        assert "emptyReason" not in data

    def test_request_passed_to_search(self, searched: FakeSearch) -> None:
        """검색_요청본문을_검색요청으로바꿔저장소와GMS대기시간과함께넘긴다"""
        store = FakeStore()

        post(
            client(store=store, gms_timeout=3.0),
            previousConditions=CONDITIONS_BODY,
            mapBounds={"swLat": 37.49, "neLng": 127.04},
            tasteProfile=TASTE_BODY,
        )

        assert searched.calls == [
            (
                SearchRequest(
                    QUERY_TEXT,
                    previous=CONDITIONS,
                    taste=TasteProfile.from_dict(TASTE_BODY),
                    bounds=MapBounds(sw_lat=37.49, ne_lng=127.04),
                ),
                store,
                3.0,
            )
        ]

    def test_follow_up(self, searched: FakeSearch) -> None:
        """검색_후속이면_changeSummary를준다"""
        searched.outcome = make_result(change_summary="넓은 곳을 더했어요")

        data = post(client(), query="넓은 곳", previousConditions=CONDITIONS_BODY)

        assert data["changeSummary"] == "넓은 곳을 더했어요"
        assert data["fallbacks"] == []

    @pytest.mark.parametrize(
        "previous", [{}, {"text": "x"}, {**CONDITIONS_BODY, "codes": "QUIET"}]
    )
    def test_invalid_previous_is_new_search(
        self, searched: FakeSearch, previous: dict
    ) -> None:
        """검색_이전조건을읽지못하면_새검색으로넘기고PREVIOUS_INVALID를담는다"""
        data = post(client(), previousConditions=previous)

        assert searched.calls[0][0].previous is None
        assert data["fallbacks"] == ["PREVIOUS_INVALID"]

    def test_llm_down(self, searched: FakeSearch) -> None:
        """검색_해석과정렬LLM이모두실패하면_규칙과유사도로표시하고LLM모델을빼고답한다"""
        searched.outcome = make_result(
            interpret_error="GMS가 꺼져 있거나 호출이 실패했다",
            fallback=Fallback.LLM_FAILED,
        )

        data = post(client())

        assert data["interpretedBy"] == "RULE"
        assert data["rankedBy"] == "SIMILARITY"
        assert data["fallbacks"] == ["INTERPRET_LLM_FAILED", "RANK_LLM_FAILED"]
        assert data["models"] == {"embedding": MODELS["embedding"]}

    def test_rank_llm_failure_only(self, searched: FakeSearch) -> None:
        """검색_정렬LLM만실패하면_RANK_LLM_FAILED만담고LLM모델은남긴다"""
        searched.outcome = make_result(fallback=Fallback.LLM_FAILED)

        data = post(client())

        assert data["interpretedBy"] == "LLM"
        assert data["rankedBy"] == "SIMILARITY"
        assert data["fallbacks"] == ["RANK_LLM_FAILED"]
        assert data["models"]["llm"] == "gpt-4o-mini"

    def test_nearby(self, searched: FakeSearch) -> None:
        """검색_근처검색이면_유사도로정렬했다고표시하지만폴백은아니다"""
        searched.outcome = make_result(
            conditions=Conditions("근처 카페", "근처 카페", (), "CAFE", nearby=True),
            fallback=Fallback.NEARBY,
        )

        data = post(client())

        assert data["nearby"] is True
        assert data["rankedBy"] == "SIMILARITY"
        assert data["fallbacks"] == []

    @pytest.mark.parametrize(
        "taste",
        [
            {"schema": "taste-profile/v1", "user_id": "u1"},
            {"schema": "taste-profile/v0", "user_id": "u1", "features": [{}]},
            {
                "schema": "taste-profile/v0",
                "user_id": "u1",
                "features": [
                    {"code": "QUIET", "layer": "axis", "like": True, "weight": 1}
                ]
                * 51,
            },
        ],
    )
    def test_invalid_taste_profile_degrades(
        self, searched: FakeSearch, taste: dict
    ) -> None:
        """검색_취향프로필을읽지못하면_취향없이검색하고TASTE_INVALID를담는다"""
        data = post(client(), tasteProfile=taste)

        assert searched.calls[0][0].taste is None
        assert data["fallbacks"] == ["TASTE_INVALID"]

    def test_unreadable_profiles_reported(self, searched: FakeSearch) -> None:
        """검색_저장소가읽지못한프로필이있으면_PROFILE_INVALID를담는다"""
        searched.outcome = make_result(invalid=(7,))

        data = post(client())

        assert data["fallbacks"] == ["PROFILE_INVALID"]
        assert len(data["items"]) == 1

    def test_no_candidates(self, searched: FakeSearch) -> None:
        """검색_뽑힌장소가없으면_빈목록과결과없음이유를돌려주고정렬방법은뺀다"""
        searched.outcome = make_result(
            cards=(),
            empty=EmptyReason(
                "이 지역 술집 중 주차할 수 있는 곳이 없어요",
                "주차 조건을 빼고 다시 찾아 보세요",
            ),
        )

        data = post(client())

        assert data["items"] == []
        assert "rankedBy" not in data
        assert data["emptyReason"] == {
            "cause": "이 지역 술집 중 주차할 수 있는 곳이 없어요",
            "suggestion": "주차 조건을 빼고 다시 찾아 보세요",
        }


class TestErrors:
    """오류 응답"""

    @pytest.mark.parametrize(
        "body",
        [
            {"query": ""},
            {"query": "   "},
            {"query": "가" * 201},
            {"query": QUERY_TEXT, "lat": 37.5},
            {"query": QUERY_TEXT, "mapBounds": {"zoom": 3}},
            {"query": QUERY_TEXT, "previousConditions": ["QUIET"]},
            {"query": QUERY_TEXT, "tasteProfile": "QUIET"},
        ],
    )
    def test_invalid_request_is_problem_400(
        self, searched: FakeSearch, body: dict
    ) -> None:
        """오류_요청형식이틀리면_검색하지않고입력을되풀이하지않는400ProblemDetail이다"""
        response = client().post("/v1/search", json=body)

        assert response.status_code == 400
        assert response.headers["content-type"] == "application/problem+json"
        assert response.json()["code"] == "INVALID_REQUEST"
        assert QUERY_TEXT not in response.text
        assert searched.calls == []

    def test_embedding_not_ready(self, searched: FakeSearch) -> None:
        """오류_요청문인코더를올리지못했으면_검색하지않고503이다"""
        response = client(embedding_ready=False).post(
            "/v1/search", json={"query": QUERY_TEXT}
        )

        assert response.status_code == 503
        assert response.json()["code"] == "EMBEDDING_UNAVAILABLE"
        assert searched.calls == []

    def test_no_store(self) -> None:
        """오류_장소저장소가없으면_503PLACES_UNAVAILABLE이다"""
        response = client(store=None).post("/v1/search", json={"query": QUERY_TEXT})

        assert response.status_code == 503
        assert response.json()["code"] == "PLACES_UNAVAILABLE"

    @pytest.mark.parametrize(
        ("error", "code"),
        [
            (EmbeddingError("RuntimeError"), "EMBEDDING_UNAVAILABLE"),
            (
                StoreError("장소 저장소를 읽지 못했다: OperationalError"),
                "PLACES_UNAVAILABLE",
            ),
        ],
    )
    def test_search_failure(
        self, searched: FakeSearch, error: Exception, code: str
    ) -> None:
        """오류_요청문인코딩이나장소저장소읽기가실패하면_503이다"""
        searched.outcome = error

        response = client().post("/v1/search", json={"query": QUERY_TEXT})

        assert response.status_code == 503
        assert response.json()["code"] == code

    def test_busy(self) -> None:
        """오류_동시처리상한에걸리면_503BUSY와Retry-After다"""
        response = client(max_concurrent=0).post(
            "/v1/search", json={"query": QUERY_TEXT}
        )

        assert response.status_code == 503
        assert response.json()["code"] == "BUSY"
        assert response.headers["retry-after"] == "1"

    def test_unknown_path(self) -> None:
        """오류_없는주소면_404ProblemDetail이다"""
        response = client().get("/v1/unknown")

        assert response.status_code == 404
        assert response.headers["content-type"] == "application/problem+json"


class TestHealth:
    """상태 확인"""

    def test_ok(self) -> None:
        """상태확인_인코더와저장소가준비됐으면_200이다"""
        assert client().get("/healthz").json() == {"status": "ok"}

    @pytest.mark.parametrize(
        ("overrides", "code"),
        [
            ({"embedding_ready": False}, "EMBEDDING_UNAVAILABLE"),
            ({"store": None}, "PLACES_UNAVAILABLE"),
            ({"store": FakeStore(fail=True)}, "PLACES_UNAVAILABLE"),
            ({"store": FakeStore(mismatched=3)}, "MODEL_MISMATCH"),
        ],
    )
    def test_not_ready(self, overrides: dict, code: str) -> None:
        """상태확인_인코더나저장소가준비되지않았거나모델이다르면_503이다"""
        response = client(**overrides).get("/healthz")

        assert response.status_code == 503
        assert response.json()["code"] == code


def test_logs_are_json_without_query(caplog: pytest.LogCaptureFixture) -> None:
    """로그_검색하면_JSON한줄을남기고요청문은넣지않는다"""
    caplog.set_level(logging.INFO, logger="server")

    post(client())

    events = [json.loads(record.getMessage()) for record in caplog.records]
    assert [event["event"] for event in events] == ["search"]
    assert events[0]["codes"] == ["QUIET"]
    assert events[0]["ranked_by"] == "LLM"
    assert events[0]["candidates"] == 1
    assert events[0]["rank_llm_raw"] == '{"ranking": [{"id": 1}]}'
    assert QUERY_TEXT not in caplog.text
