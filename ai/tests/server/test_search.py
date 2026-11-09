"""검색 API를 확인한다.

요청을 검색 요청으로 바꾸는지, 검색 결과를 응답 모양(BE 카드 계약)과 폴백 표시로
바꾸는지, 준비 안 됨·혼잡·입력 오류·검색 실패의 ProblemDetail, 상태 확인, 로그에
요청문이 남지 않는지를 본다. 검색 자체는 tests/match/test_search.py에서 보고, 여기서는
`search`를 정해 둔 결과를 내는 가짜로 바꿔 끼운다. 기능과 상관없는 오류 응답은
test_app.py에서 본다.
"""

import json
import logging
from collections.abc import Sequence
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from fit_ai import embedding
from fit_ai.match.candidates import (
    Found,
    MapBounds,
    PlaceFilter,
    StoreError,
    VectorCounts,
)
from fit_ai.match.cards import Card, Reason, ReasonTag, ScoreItem, Source
from fit_ai.match.conditions import Layer
from fit_ai.match.interpretation import Conditions, Interpretation
from fit_ai.match.interpretation.segments import (
    Hours,
    Location,
    LocationKind,
    Menu,
    Price,
)
from fit_ai.match.search import (
    EmbeddingError,
    EmptyReason,
    SearchRequest,
    SearchResult,
    SearchTrace,
    UserLocation,
)
from fit_ai.match.taste_select import FreeText, TasteFeature, TasteProfile
from server import search as server_search
from server.app import create_app
from server.common import Dependencies

QUERY_TEXT = "역삼역 조용한 술집 찾아요"

CONDITIONS = Conditions.from_codes(
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
"""1차 모양의 조건. 2차에 더한 조각 필드가 없다. 그대로 돌려보낸 이전 조건도 읽어야 한다."""

CONDITIONS_V3_BODY = {
    "version": 3,
    "text": QUERY_TEXT,
    "embeddingText": "역삼역 조용한 술집",
    "categories": [{"code": "BAR", "want": True}],
    "foodTypes": [],
    "flavors": [],
    "menus": [],
    "features": [
        {"text": "조용하고 차분한 곳", "value": "조용하고 차분한 곳", "code": "QUIET"}
    ],
    "facilities": [],
    "locations": [{"text": "역삼역", "kind": "STATION", "value": "역삼역"}],
    "hours": [],
}
"""1차 조건(`CONDITIONS`)의 3차 응답 모양. 역은 지역이 된다. null인 값은 빠진다."""

SEGMENT_CONDITIONS = Conditions.from_codes(
    text="션릉역 새벽까지 하는 3만원 이하 초밥",
    embedding_text="3만원 이하 초밥",
    codes=("QUIET",),
    category_group="RESTAURANT",
    station="SEOLLEUNG",
    locations=(
        Location("션릉역", LocationKind.STATION, "선릉역"),
        Location("역삼역 걸어서 5분", LocationKind.STATION, "역삼역", 5, "3"),
    ),
    menus=(Menu("초밥", "초밥", ("스시",)), Menu("오이", "오이", want=False)),
    hours=(Hours("새벽까지", open_until="02:00"),),
    price=Price("3만원 이하", max_won=30000),
    avoid_categories=("CAFE",),
    avoid_foods=("FOOD_SPICY",),
)

SEGMENT_BODY = {
    "text": "션릉역 새벽까지 하는 3만원 이하 초밥",
    "embeddingText": "3만원 이하 초밥",
    "codes": ["QUIET"],
    "categoryGroup": "RESTAURANT",
    "station": "SEOLLEUNG",
    "nearby": False,
    "locations": [
        {"text": "션릉역", "kind": "STATION", "value": "선릉역"},
        {
            "text": "역삼역 걸어서 5분",
            "kind": "STATION",
            "value": "역삼역",
            "walkMinutes": 5,
            "exit": "3",
        },
    ],
    "menus": [
        {"text": "초밥", "value": "초밥", "spellings": ["스시"], "want": True},
        {"text": "오이", "value": "오이", "spellings": [], "want": False},
    ],
    "hours": [{"text": "새벽까지", "openUntil": "02:00", "now": False}],
    "price": {"text": "3만원 이하", "maxWon": 30000, "cheap": False},
    "features": [],
    "avoidCategories": ["CAFE"],
    "avoidFoods": ["FOOD_SPICY"],
}
"""2차 모양의 조건. 검색 대화에 저장된 이전 조건으로 돌아오므로 읽어야 한다."""

SEGMENT_V3_BODY = {
    "version": 3,
    "text": "션릉역 새벽까지 하는 3만원 이하 초밥",
    "embeddingText": "3만원 이하 초밥",
    "categories": [
        {"code": "RESTAURANT", "want": True},
        {"code": "CAFE", "want": False},
    ],
    "foodTypes": [],
    "flavors": [{"code": "SPICY", "want": False}],
    "menus": SEGMENT_BODY["menus"],
    "features": CONDITIONS_V3_BODY["features"],
    "facilities": [],
    "locations": SEGMENT_BODY["locations"],
    "hours": SEGMENT_BODY["hours"],
    "price": SEGMENT_BODY["price"],
}
"""조각이 있는 조건(`SEGMENT_CONDITIONS`)의 3차 응답 모양. null인 값은 빠진다."""

VECTOR = [0.01] * 1024
"""칩 벡터. 길이만 맞춘 예시 값이다."""

TASTE_BODY = {
    "mood": "QUIET",
    "priorities": ["SPACIOUS"],
    "purposes": [],
    "tastes": [
        {"polarity": "LIKE", "label": "조용한 곳", "code": "QUIET"},
        {"polarity": "LIKE", "label": "창가 자리", "code": None, "vector": VECTOR},
    ],
}
"""비회원 취향. 기기가 저장한 온보딩 답에 칩 벡터가 더해진 모양이다."""

QUIET_FEATURE = {"code": "QUIET", "layer": "axis", "like": True, "weight": 1}

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
    "llm": "gpt-6-luna",
}


def make_result(
    cards: tuple[Card, ...] = (CARD,),
    conditions: Conditions = CONDITIONS,
    change_summary: str | None = None,
    interpret_error: str | None = None,
    empty: EmptyReason | None = None,
    invalid: tuple[int, ...] = (),
    nationwide: bool = False,
) -> SearchResult:
    """검색 결과. 기본은 LLM으로 해석하고 점수로 정렬해 카드 한 장이 나온 결과다."""
    trace = SearchTrace(
        embed_seconds=0.1,
        store_seconds=0.01,
        candidates=len(cards),
        score_seconds=0.02 if cards else 0.0,
    )
    return SearchResult(
        interpretation=Interpretation(conditions, change_summary, interpret_error, 1.0),
        cards=cards,
        empty_reason=empty,
        invalid_place_ids=invalid,
        trace=trace,
        nationwide=nationwide,
    )


class FakeSearch:
    """`search` 대신 정해 둔 결과를 내거나 예외를 던진다. 받은 인자를 남긴다."""

    def __init__(self) -> None:
        self.outcome: SearchResult | Exception = make_result()
        self.calls: list[tuple[SearchRequest, object, float]] = []
        self.clients: list[object] = []

    def __call__(
        self,
        request: SearchRequest,
        store: object,
        timeout: float = 5.0,
        client: object = None,
    ) -> SearchResult:
        self.calls.append((request, store, timeout))
        self.clients.append(client)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class FakeStore:
    """상태 확인에 쓰는 장소 저장소. 검색은 가짜 `search`가 하므로 `find`는 쓰지 않는다."""

    def __init__(
        self, fail: bool = False, comparable: int = 30, mismatched: int = 0
    ) -> None:
        self.fail = fail
        self.counts = VectorCounts(comparable, mismatched)

    def find(self, place_filter: PlaceFilter, query: Sequence[float], k: int) -> Found:
        raise NotImplementedError

    def vector_counts(self) -> VectorCounts:
        if self.fail:
            raise StoreError("장소 저장소를 읽지 못했다: OperationalError")
        return self.counts


STORED_TASTE = TasteProfile.from_stored("user-1", [QUIET_FEATURE], None)


class FakeTasteStore:
    """정해 둔 취향을 돌려주거나 예외를 던지는 회원 취향 저장소. 받은 회원 id를 남긴다."""

    def __init__(self, outcome: object = STORED_TASTE) -> None:
        self.outcome = outcome
        self.calls: list[str] = []

    def find(self, user_id: str) -> TasteProfile | None:
        self.calls.append(user_id)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome  # type: ignore[return-value]


@pytest.fixture(autouse=True)
def searched(monkeypatch: pytest.MonkeyPatch) -> FakeSearch:
    fake = FakeSearch()
    monkeypatch.setattr(server_search, "search", fake)
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

        assert data["conditions"] == CONDITIONS_V3_BODY
        assert data["nationwide"] is False
        assert "nearby" not in data
        assert data["interpretedBy"] == "LLM"
        assert data["rankedBy"] == "SCORE"
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
                    # 온보딩 답으로 계산한 취향이다. 직접 입력한 "조용한 곳"(QUIET)이
                    # 고른 답에 더해져 강도가 2다. 코드가 붙은 칩은 문장으로 읽지 않는다.
                    taste=TasteProfile(
                        "",
                        (
                            TasteFeature("QUIET", Layer.AXIS, True, 2),
                            TasteFeature("LIVELY", Layer.AXIS, False, 2),
                            TasteFeature("SPACIOUS_SEATING", Layer.IMPORTANCE, True, 1),
                        ),
                        (FreeText("창가 자리", True, tuple(VECTOR)),),
                    ),
                    bounds=MapBounds(sw_lat=37.49, ne_lng=127.04),
                ),
                store,
                3.0,
            )
        ]

    def test_shares_gms_client(self, searched: FakeSearch) -> None:
        """검색_시작때만든GMS클라이언트를_검색에넘긴다"""
        gms_client = object()

        post(client(gms_client=gms_client))

        assert searched.clients == [gms_client]

    @pytest.mark.parametrize(
        "bounds", [{}, {"swLat": None, "swLng": None, "neLat": None, "neLng": None}]
    )
    def test_empty_map_bounds_is_none(self, searched: FakeSearch, bounds: dict) -> None:
        """검색_지도영역에값이하나도없으면_영역이없는것으로보고역으로거른다"""
        post(client(), mapBounds=bounds)

        assert searched.calls[0][0].bounds is None

    def test_user_location_passed(self, searched: FakeSearch) -> None:
        """검색_사용자위치가오면_위도경도를검색요청에넘긴다"""
        post(client(), location={"lat": 36.3551, "lng": 127.2986})

        assert searched.calls[0][0].location == UserLocation(36.3551, 127.2986)

    def test_user_location_not_kept(
        self, searched: FakeSearch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """검색_사용자위치는_응답조건과로그에남기지않고왔는지만남긴다"""
        caplog.set_level(logging.INFO, logger="server")

        data = post(client(), location={"lat": 36.3551, "lng": 127.2986})

        assert "36.3551" not in json.dumps(data)
        assert "36.3551" not in caplog.text
        events = [
            json.loads(r.getMessage()) for r in caplog.records if r.name == "server"
        ]
        assert events[-1]["has_location"] is True

    def test_map_bounds_only_is_rejected(self, searched: FakeSearch) -> None:
        """검색_지도영역은이지역에서검색에만오므로_mapBoundsOnly는모르는속성으로거부한다"""
        response = client().post(
            "/v1/search",
            json={
                "query": QUERY_TEXT,
                "mapBounds": {"swLat": 37.49},
                "mapBoundsOnly": True,
            },
        )

        assert response.status_code == 400
        assert searched.calls == []

    def test_previous_map_bounds_passed(self, searched: FakeSearch) -> None:
        """검색_이전조건에지도영역이있으면_이전요청의지도영역으로넘긴다"""
        previous = {**CONDITIONS_V3_BODY, "mapBounds": {"swLat": 36.35, "neLat": 36.36}}

        post(client(), query="조용한 곳", previousConditions=previous)

        request = searched.calls[0][0]
        assert request.previous_bounds == MapBounds(sw_lat=36.35, ne_lat=36.36)
        assert request.previous is not None

    def test_kept_bounds_in_conditions(self, searched: FakeSearch) -> None:
        """검색_다음후속요청이쓸지도영역이있으면_조건에담고없으면뺀다"""
        kept = MapBounds(36.35, 127.37, 36.36, 127.39)
        searched.outcome = replace(make_result(), bounds=kept)

        data = post(client(), mapBounds={"swLat": 36.35})
        searched.outcome = make_result()
        plain = post(client())

        assert data["conditions"]["mapBounds"] == {
            "swLat": 36.35,
            "swLng": 127.37,
            "neLat": 36.36,
            "neLng": 127.39,
        }
        assert "mapBounds" not in plain["conditions"]

    def test_follow_up(self, searched: FakeSearch) -> None:
        """검색_후속이면_changeSummary를준다"""
        searched.outcome = make_result(change_summary="넓은 곳을 더했어요")

        data = post(client(), query="넓은 곳", previousConditions=CONDITIONS_BODY)

        assert data["changeSummary"] == "넓은 곳을 더했어요"
        assert data["fallbacks"] == []

    def test_segments_in_response(self, searched: FakeSearch) -> None:
        """검색_조건에조각이있으면_3차모양camelCase로돌려주고null인값은뺀다"""
        searched.outcome = make_result(conditions=SEGMENT_CONDITIONS)

        data = post(client())

        assert data["conditions"] == SEGMENT_V3_BODY

    @pytest.mark.parametrize(
        "previous",
        [SEGMENT_BODY, SEGMENT_V3_BODY],
        ids=["2차", "3차"],
    )
    def test_previous_segments_read(self, searched: FakeSearch, previous: dict) -> None:
        """검색_이전조건이2차나3차모양이면_같은조건으로읽어검색에넘긴다"""
        post(client(), previousConditions=previous)

        assert searched.calls[0][0].previous == SEGMENT_CONDITIONS

    def test_previous_v1_read(self, searched: FakeSearch) -> None:
        """검색_이전조건이1차모양이면_역을지역으로바꿔읽는다"""
        post(client(), previousConditions=CONDITIONS_BODY)

        assert searched.calls[0][0].previous == CONDITIONS

    @pytest.mark.parametrize(
        "previous",
        [
            {},
            {"text": "x"},
            {**CONDITIONS_BODY, "codes": "QUIET"},
            {**SEGMENT_BODY, "hours": [{"text": "밤", "openUntil": "25:00"}]},
            {**SEGMENT_BODY, "locations": [{"text": "역삼", "kind": "CITY"}]},
            {
                **SEGMENT_BODY,
                "locations": [{"text": "역삼역", "kind": "STATION", "walkMinutes": 0}],
            },
            {**SEGMENT_BODY, "avoidCodes": ["FOOD_SPICY"]},
            {**SEGMENT_BODY, "avoidFoods": ["QUIET"]},
            # 3차 조건은 3차 모양으로만 읽는다.
            {**SEGMENT_V3_BODY, "codes": ["QUIET"]},
            {
                **SEGMENT_V3_BODY,
                "categories": [
                    {"code": "CAFE", "want": True},
                    {"code": "BAR", "want": True},
                ],
            },
            {**SEGMENT_V3_BODY, "flavors": [{"code": "FOOD_SPICY", "want": False}]},
            {
                **SEGMENT_V3_BODY,
                "features": [{"text": "조용", "value": "조용", "code": "FOOD_SPICY"}],
            },
            # v0.7까지의 메뉴 음식 코드는 이제 모르는 필드다.
            {
                **SEGMENT_BODY,
                "menus": [{"text": "초밥", "value": "초밥", "code": "FOOD_JAPANESE"}],
            },
        ],
    )
    def test_invalid_previous_is_new_search(
        self, searched: FakeSearch, previous: dict
    ) -> None:
        """검색_이전조건을읽지못하면_새검색으로넘기고PREVIOUS_INVALID를담는다"""
        data = post(client(), previousConditions=previous)

        assert searched.calls[0][0].previous is None
        assert data["fallbacks"] == ["PREVIOUS_INVALID"]

    def test_llm_down(self, searched: FakeSearch) -> None:
        """검색_해석LLM이실패하면_규칙으로표시하고LLM모델을빼고답한다"""
        searched.outcome = make_result(
            interpret_error="GMS가 꺼져 있거나 호출이 실패했다"
        )

        data = post(client())

        assert data["interpretedBy"] == "RULE"
        assert data["rankedBy"] == "SCORE"
        assert data["fallbacks"] == ["INTERPRET_LLM_FAILED"]
        assert data["models"] == {"embedding": MODELS["embedding"]}

    def test_no_score(self, searched: FakeSearch) -> None:
        """검색_판정할요청조각도취향도없어점수가없으면_점수를빼고유사도로정렬했다고표시한다"""
        searched.outcome = make_result(cards=(replace(CARD, score=None),))

        data = post(client())

        assert data["rankedBy"] == "SIMILARITY"
        assert "score" not in data["items"][0]
        assert data["fallbacks"] == []

    def test_nearby(self, searched: FakeSearch) -> None:
        """검색_근처검색이면_같은점수로정렬하고폴백도전국검색도아니다"""
        searched.outcome = make_result(
            conditions=Conditions.from_codes(
                "근처 카페", "근처 카페", (), "CAFE", nearby=True
            )
        )

        data = post(client(), location={"lat": 36.3551, "lng": 127.2986})

        assert data["nationwide"] is False
        assert data["rankedBy"] == "SCORE"
        assert data["fallbacks"] == []

    def test_nationwide(self, searched: FakeSearch) -> None:
        """검색_거를지역이없어전국에서찾았으면_nationwide가참이다"""
        searched.outcome = make_result(nationwide=True)

        data = post(client(), query="조용한 술집")

        assert data["nationwide"] is True

    @pytest.mark.parametrize(
        "taste",
        [
            # 취향 분석 출력 모양(taste-profile/v0)은 받지 않는다.
            {
                "schema": "taste-profile/v0",
                "user_id": "u1",
                "features": [QUIET_FEATURE],
            },
            # 계산한 취향은 AI가 만든다. 기기가 보내도 받지 않는다.
            {"features": [QUIET_FEATURE]},
            {"mood": "NOISY"},
            {"tastes": [{"polarity": "MAYBE", "label": "조용한 곳"}]},
            {"tastes": [{"polarity": "LIKE", "label": "가" * 101}]},
            {"tastes": [{"polarity": "LIKE", "label": "창가 자리", "vector": [0.6]}]},
            {
                "tastes": [
                    {"polarity": "LIKE", "label": "창가", "vector": ["0.1"] * 1024}
                ]
            },
            {"tastes": [{"polarity": "LIKE", "label": "조용한 곳"}] * 21},
        ],
    )
    def test_invalid_taste_profile_degrades(
        self, searched: FakeSearch, taste: dict, caplog: pytest.LogCaptureFixture
    ) -> None:
        """검색_취향프로필을읽지못하면_취향없이검색하고TASTE_INVALID를담는다"""
        caplog.set_level(logging.INFO, logger="server")

        data = post(client(), tasteProfile=taste)

        assert searched.calls[0][0].taste is None
        assert data["fallbacks"] == ["TASTE_INVALID"]
        # 모양 오류는 값 오류와 구분해 남기고, 칩 문구는 남기지 않는다.
        assert "INVALID_SHAPE" in caplog.text
        assert "조용한 곳" not in caplog.text

    def test_guest_vector_only_on_uncoded_like(self, searched: FakeSearch) -> None:
        """검색_비회원칩에벡터가있으면_코드없는좋아함칩의벡터만쓴다"""
        post(
            client(),
            tasteProfile={
                "tastes": [
                    {
                        "polarity": "LIKE",
                        "label": "조용한",
                        "code": "QUIET",
                        "vector": VECTOR,
                    },
                    {"polarity": "DISLIKE", "label": "비싼 곳", "vector": VECTOR},
                    {"polarity": "LIKE", "label": "창가 자리", "vector": VECTOR},
                ]
            },
        )

        taste = searched.calls[0][0].taste
        assert [(t.text, t.usable) for t in taste.free_texts] == [
            ("비싼 곳", False),
            ("창가 자리", True),
        ]

    @pytest.mark.parametrize(
        "taste", [{}, {"mood": None, "priorities": [], "purposes": [], "tastes": []}]
    )
    def test_empty_guest_taste(self, searched: FakeSearch, taste: dict) -> None:
        """검색_비회원취향이비었으면_빈취향으로검색하고폴백은없다"""
        data = post(client(), tasteProfile=taste)

        assert searched.calls[0][0].taste == TasteProfile("", (), ())
        assert data["fallbacks"] == []

    def test_member_taste_from_store(self, searched: FakeSearch) -> None:
        """검색_회원id가있으면_취향저장소에서꺼내고요청의취향프로필은읽지않는다"""
        tastes = FakeTasteStore()

        data = post(
            client(taste_store=tastes),
            userId="user-1",
            tasteProfile={"schema": "taste-profile/v1"},
        )

        assert tastes.calls == ["user-1"]
        assert searched.calls[0][0].taste == STORED_TASTE
        assert data["fallbacks"] == []

    def test_member_without_taste(self, searched: FakeSearch) -> None:
        """검색_저장소에회원취향이없으면_취향없이검색하고폴백은없다"""
        data = post(client(taste_store=FakeTasteStore(outcome=None)), userId="u9")

        assert searched.calls[0][0].taste is None
        assert data["fallbacks"] == []

    @pytest.mark.parametrize(
        "outcome",
        [
            StoreError("취향 저장소를 읽지 못했다: OperationalError"),
            ValueError("취향의 weight가 범위를 벗어났다"),
            TasteProfile.from_stored("user-1", [QUIET_FEATURE] * 51, None),
        ],
    )
    def test_member_taste_unreadable(
        self, searched: FakeSearch, outcome: object
    ) -> None:
        """검색_회원취향을읽지못하거나상한을넘으면_취향없이검색하고TASTE_INVALID를담는다"""
        tastes = FakeTasteStore(outcome=outcome)

        data = post(client(taste_store=tastes), userId="user-1")

        assert searched.calls[0][0].taste is None
        assert data["fallbacks"] == ["TASTE_INVALID"]

    def test_member_without_taste_store(self, searched: FakeSearch) -> None:
        """검색_회원id가왔는데취향저장소가없으면_취향없이검색하고TASTE_INVALID를담는다"""
        data = post(client(), userId="user-1")

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
            {"query": QUERY_TEXT, "mapBounds": {"swLat": "37.4"}},
            {"query": QUERY_TEXT, "mapBounds": {"swLat": True}},
            # 사용자 위치는 위도·경도가 모두 있어야 하고 범위 안의 숫자여야 한다.
            {"query": QUERY_TEXT, "location": {"lat": 36.35}},
            {"query": QUERY_TEXT, "location": {"lat": "36.35", "lng": 127.29}},
            {"query": QUERY_TEXT, "location": {"lat": 91, "lng": 127.29}},
            {"query": QUERY_TEXT, "location": {"lat": 36.35, "lng": 181}},
            {"query": QUERY_TEXT, "location": {"lat": 36.35, "lng": 127.29, "acc": 5}},
            {"query": QUERY_TEXT, "userId": ""},
            {"query": QUERY_TEXT, "userId": "u" * 65},
            {"query": QUERY_TEXT, "userId": 3},
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

    def test_nan_coordinate(self) -> None:
        """오류_좌표가NaN이나Infinity면_400이다"""
        response = client().post(
            "/v1/search",
            content=b'{"query": "cafe", "mapBounds": {"swLat": NaN, "neLat": Infinity}}',
            headers={"content-type": "application/json"},
        )

        assert response.status_code == 400
        assert response.json()["code"] == "INVALID_REQUEST"


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
            ({"store": FakeStore(comparable=0, mismatched=3)}, "MODEL_MISMATCH"),
        ],
    )
    def test_not_ready(self, overrides: dict, code: str) -> None:
        """상태확인_인코더나저장소가준비되지않았거나모든장소의모델이다르면_503이다"""
        response = client(**overrides).get("/healthz")

        assert response.status_code == 503
        assert response.json()["code"] == code


def test_partial_mismatch_is_ready(caplog: pytest.LogCaptureFixture) -> None:
    """상태확인_일부장소만모델이다르면_200이고빠진장소수를경고로남긴다"""
    caplog.set_level(logging.INFO, logger="server")

    response = client(store=FakeStore(comparable=29, mismatched=1)).get("/healthz")

    assert response.status_code == 200
    events = [json.loads(r.getMessage()) for r in caplog.records if r.name == "server"]
    assert events == [{"event": "places_mismatched", "count": 1}]


def test_logs_are_json_without_query(caplog: pytest.LogCaptureFixture) -> None:
    """로그_검색하면_JSON한줄을남기고요청문은넣지않는다"""
    caplog.set_level(logging.INFO, logger="server")

    post(client())

    events = [json.loads(r.getMessage()) for r in caplog.records if r.name == "server"]
    assert [event["event"] for event in events] == ["search"]
    assert events[0]["codes"] == ["QUIET"]
    assert events[0]["ranked_by"] == "SCORE"
    assert events[0]["candidates"] == 1
    assert events[0]["score_seconds"] == 0.02
    assert QUERY_TEXT not in caplog.text
