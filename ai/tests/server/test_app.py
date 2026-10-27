"""AI API를 확인한다.

검색 응답 모양(BE 카드 계약), 해석 결과로 만든 거르기 조건, 폴백 표시, 결과 없음,
준비 안 됨·혼잡·입력 오류의 ProblemDetail, 로그에 요청문이 남지 않는지를 본다.
공유 모듈 `fit_ai.embedding`, `fit_ai.gms`는 가짜로 바꿔 끼우고 장소 저장소도 가짜다.
"""

import json
import logging
import re
from collections.abc import Callable, Sequence

import pytest
from fastapi.testclient import TestClient

from fit_ai import embedding
from fit_ai.match import interpretation
from fit_ai.match.candidates import (
    Candidate,
    Found,
    MapBounds,
    PlaceFilter,
    StoreError,
)
from fit_ai.match.place import ConditionEvidence, Place, PlaceInfo
from server.app import Dependencies, create_app

QUERY_TEXT = "역삼역 조용한 술집 찾아요"

CONDITIONS = {
    "text": QUERY_TEXT,
    "embeddingText": "역삼역 조용한 술집",
    "codes": ["QUIET"],
    "categoryGroup": "BAR",
    "station": "YEOKSAM",
    "nearby": False,
}

INTERPRETED = {
    "text": None,
    "embedding_text": "역삼역 조용한 술집",
    "codes": ["QUIET"],
    "category_group": "BAR",
    "station": "YEOKSAM",
    "nearby": False,
    "change_summary": None,
}

MODELS = {
    "embedding": f"{embedding.MODEL_ID}@{embedding.REVISION}",
    "llm": "gpt-4o-mini",
}

FakeGms = Callable[[Callable[[list[dict]], object]], list[list[dict]]]


def make_candidate(place_id: int, similarity: float) -> Candidate:
    """조용함 근거가 충분한 역삼역 술집 후보"""
    place = Place(
        place_id=place_id,
        info=PlaceInfo(place_id, "BAR", "YEOKSAM", {"PARKING": None}),
        summary=f"설명 {place_id}",
        conditions={"QUIET": ConditionEvidence(pos=5)},
    )
    return Candidate(place, similarity)


CANDIDATES = (make_candidate(1, 0.8), make_candidate(2, 0.6))


def answers(
    fail_interpret: bool = False, fail_ranking: bool = False, **interpreted: object
) -> Callable[[list[dict]], object]:
    """가짜 GMS 답. 해석에는 정해 둔 조건으로, 정렬에는 장소 id가 큰 순서로 답한다."""

    def answer(messages: list[dict]) -> object:
        system, user = messages[0]["content"], messages[1]["content"]
        if system == interpretation.SYSTEM_PROMPT:
            return None if fail_interpret else {**INTERPRETED, **interpreted}
        if fail_ranking:
            return None
        numbers = {
            int(place_id): int(number)
            for number, place_id in re.findall(
                r"^\[(\d+)\] .* \| 설명 (\d+)(?: \| .*)?$", user, re.MULTILINE
            )
        }
        return {
            "ranking": [
                {"id": numbers[place_id]} for place_id in sorted(numbers, reverse=True)
            ]
        }

    return answer


class FakeStore:
    """정해 둔 후보를 돌려주고 받은 거르기 조건과 k를 남긴다."""

    def __init__(
        self,
        candidates: tuple[Candidate, ...] = CANDIDATES,
        invalid: tuple[int, ...] = (),
        fail: bool = False,
        mismatched: int = 0,
    ) -> None:
        self.candidates = candidates
        self.invalid = invalid
        self.fail = fail
        self.mismatched_count = mismatched
        self.calls: list[tuple[PlaceFilter, int]] = []

    def find(self, place_filter: PlaceFilter, query: Sequence[float], k: int) -> Found:
        if self.fail:
            raise StoreError("장소 저장소를 읽지 못했다: OperationalError")
        self.calls.append((place_filter, k))
        return Found(self.candidates[:k], self.invalid)

    def mismatched(self) -> int:
        if self.fail:
            raise StoreError("장소 저장소를 읽지 못했다: OperationalError")
        return self.mismatched_count


@pytest.fixture(autouse=True)
def encoder(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    """공유 모듈의 요청문 인코딩을 같은 벡터를 내는 가짜로 바꾼다."""
    seen: list[list[str]] = []

    def encode_queries(texts: list[str]) -> list[list[float]]:
        seen.append(texts)
        return [[1.0, 0.0] for _ in texts]

    monkeypatch.setattr(embedding, "encode_queries", encode_queries)
    return seen


@pytest.fixture
def gms(fake_gms: FakeGms) -> FakeGms:
    """기본은 해석과 정렬이 모두 성공하는 가짜 GMS다. 테스트에서 다시 바꿔 끼울 수 있다."""
    fake_gms(answers())
    return fake_gms


def client(**overrides: object) -> TestClient:
    deps = {"embedding_ready": True, "store": FakeStore()}
    deps.update(overrides)
    return TestClient(create_app(Dependencies(**deps)))  # type: ignore[arg-type]


def post(app: TestClient, **body: object) -> dict:
    response = app.post("/v1/search", json={"query": QUERY_TEXT, **body})
    assert response.status_code == 200
    return response.json()


@pytest.mark.usefixtures("gms")
class TestSearch:
    """검색 응답"""

    def test_cards_in_be_shape(self) -> None:
        """검색_새검색이면_조건과BE카드모양과모델버전을돌려준다"""
        data = post(client())

        assert data["conditions"] == CONDITIONS
        assert data["nearby"] is False
        assert data["interpretedBy"] == "LLM"
        assert data["rankedBy"] == "LLM"
        assert data["fallbacks"] == []
        assert data["models"] == MODELS
        # 카드 id는 40 프로필의 place_id가 아니라 BE 장소 id다.
        assert [item["placeId"] for item in data["items"]] == [2, 1]
        card = data["items"][0]
        assert set(card) == {"placeId", "score", "labels", "reasons", "scoreItems"}
        assert card["score"] == 100
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

    def test_encodes_embedding_text(self, encoder: list[list[str]]) -> None:
        """검색_요청문이아니라해석이낸벡터용문장을_공유모듈로인코딩한다"""
        post(client())

        assert encoder == [["역삼역 조용한 술집"]]

    def test_filter_from_conditions(self, gms: FakeGms) -> None:
        """검색_해석한업종역시설로_저장소에서20곳을뽑는다"""
        gms(answers(codes=["QUIET", "PARKING"]))
        store = FakeStore()

        post(client(store=store))

        assert store.calls == [
            (
                PlaceFilter(
                    category_group="BAR", station="YEOKSAM", facilities=("PARKING",)
                ),
                20,
            )
        ]

    def test_map_bounds_replace_station(self) -> None:
        """검색_지도영역이있으면_역대신좌표로거른다"""
        store = FakeStore()

        post(client(store=store), mapBounds={"swLat": 37.49, "neLng": 127.04})

        place_filter, _ = store.calls[0]
        assert place_filter.station is None
        assert place_filter.bounds == MapBounds(sw_lat=37.49, ne_lng=127.04)

    def test_nearby(self, gms: FakeGms) -> None:
        """검색_근처검색이면_역으로거르지않고100곳을코드등급과유사도로정렬한다"""
        calls = gms(answers(nearby=True, station=None))
        store = FakeStore()

        data = post(client(store=store))

        place_filter, k = store.calls[0]
        assert (place_filter.station, k) == (None, 100)
        assert data["nearby"] is True
        assert data["rankedBy"] == "SIMILARITY"
        # 근처 검색은 처음부터 LLM 없이 정렬하므로 폴백이 아니다.
        assert data["fallbacks"] == []
        assert len(calls) == 1

    def test_follow_up(self, gms: FakeGms) -> None:
        """검색_이전조건이있으면_후속으로합치고changeSummary를준다"""
        gms(
            answers(
                text="역삼역 조용하고 넓은 술집", change_summary="넓은 곳을 더했어요"
            )
        )

        data = post(client(), query="넓은 곳", previousConditions=CONDITIONS)

        assert data["conditions"]["text"] == "역삼역 조용하고 넓은 술집"
        assert data["changeSummary"] == "넓은 곳을 더했어요"
        assert data["fallbacks"] == []

    @pytest.mark.parametrize(
        "previous", [{}, {"text": "x"}, {**CONDITIONS, "codes": "QUIET"}]
    )
    def test_invalid_previous_is_new_search(self, previous: dict) -> None:
        """검색_이전조건을읽지못하면_새검색으로보고PREVIOUS_INVALID를담는다"""
        data = post(client(), previousConditions=previous)

        assert data["fallbacks"] == ["PREVIOUS_INVALID"]
        assert "changeSummary" not in data

    def test_llm_down(self, gms: FakeGms) -> None:
        """검색_GMS가꺼져있거나모두실패하면_규칙해석과유사도정렬로답한다"""
        gms(answers(fail_interpret=True, fail_ranking=True))

        data = post(client())

        assert data["interpretedBy"] == "RULE"
        assert data["rankedBy"] == "SIMILARITY"
        assert data["fallbacks"] == ["INTERPRET_LLM_FAILED", "RANK_LLM_FAILED"]
        assert data["models"] == {"embedding": MODELS["embedding"]}
        assert data["conditions"]["codes"] == ["QUIET"]
        assert [item["placeId"] for item in data["items"]] == [1, 2]

    def test_rank_llm_failure_only(self, gms: FakeGms) -> None:
        """검색_정렬LLM만실패하면_유사도로정렬하고RANK_LLM_FAILED만담는다"""
        gms(answers(fail_ranking=True))

        data = post(client())

        assert data["interpretedBy"] == "LLM"
        assert data["rankedBy"] == "SIMILARITY"
        assert data["fallbacks"] == ["RANK_LLM_FAILED"]
        assert data["models"]["llm"] == "gpt-4o-mini"

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
    def test_invalid_taste_profile_degrades(self, taste: dict) -> None:
        """검색_취향프로필을읽지못하면_취향없이검색하고TASTE_INVALID를담는다"""
        data = post(client(), tasteProfile=taste)

        assert data["fallbacks"] == ["TASTE_INVALID"]

    def test_unreadable_profiles_reported(self) -> None:
        """검색_저장소가읽지못한프로필이있으면_PROFILE_INVALID를담는다"""
        data = post(client(store=FakeStore(invalid=(7,))))

        assert data["fallbacks"] == ["PROFILE_INVALID"]
        assert len(data["items"]) == 2

    def test_no_candidates(self, gms: FakeGms) -> None:
        """검색_뽑힌장소가없으면_빈목록과결과없음이유를돌려준다"""
        gms(answers(codes=["PARKING"]))

        data = post(client(store=FakeStore(candidates=())), mapBounds={"swLat": 37.4})

        assert data["items"] == []
        assert "rankedBy" not in data
        assert data["emptyReason"] == {
            "cause": "이 지역 술집 중 주차할 수 있는 곳이 없어요",
            "suggestion": "주차 조건을 빼고 다시 찾아 보세요",
        }


@pytest.mark.usefixtures("gms")
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
    def test_invalid_request_is_problem_400(self, body: dict) -> None:
        """오류_요청형식이틀리면_입력을되풀이하지않는400ProblemDetail이다"""
        response = client().post("/v1/search", json=body)

        assert response.status_code == 400
        assert response.headers["content-type"] == "application/problem+json"
        assert response.json()["code"] == "INVALID_REQUEST"
        assert QUERY_TEXT not in response.text

    def test_embedding_not_ready(self, gms: FakeGms) -> None:
        """오류_요청문인코더를올리지못했으면_GMS를부르지않고503이다"""
        calls = gms(answers())

        response = client(embedding_ready=False).post(
            "/v1/search", json={"query": QUERY_TEXT}
        )

        assert response.status_code == 503
        assert response.json()["code"] == "EMBEDDING_UNAVAILABLE"
        assert calls == []

    def test_no_store(self) -> None:
        """오류_장소저장소가없으면_503PLACES_UNAVAILABLE이다"""
        response = client(store=None).post("/v1/search", json={"query": QUERY_TEXT})

        assert response.status_code == 503
        assert response.json()["code"] == "PLACES_UNAVAILABLE"

    def test_embedding_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """오류_요청문인코딩이실패하면_503EMBEDDING_UNAVAILABLE이다"""

        def encode_queries(texts: list[str]) -> list[list[float]]:
            raise RuntimeError("CUDA out of memory")

        monkeypatch.setattr(embedding, "encode_queries", encode_queries)

        response = client().post("/v1/search", json={"query": QUERY_TEXT})

        assert response.status_code == 503
        assert response.json()["code"] == "EMBEDDING_UNAVAILABLE"

    def test_store_failure(self) -> None:
        """오류_장소저장소를읽지못하면_503PLACES_UNAVAILABLE이다"""
        response = client(store=FakeStore(fail=True)).post(
            "/v1/search", json={"query": QUERY_TEXT}
        )

        assert response.status_code == 503
        assert response.json()["code"] == "PLACES_UNAVAILABLE"

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


@pytest.mark.usefixtures("gms")
def test_logs_are_json_without_query(caplog: pytest.LogCaptureFixture) -> None:
    """로그_검색하면_JSON한줄을남기고요청문은넣지않는다"""
    caplog.set_level(logging.INFO, logger="server")

    post(client())

    events = [json.loads(record.getMessage()) for record in caplog.records]
    assert [event["event"] for event in events] == ["search"]
    assert events[0]["codes"] == ["QUIET"]
    assert events[0]["ranked_by"] == "LLM"
    assert events[0]["candidates"] == 2
    assert QUERY_TEXT not in caplog.text
