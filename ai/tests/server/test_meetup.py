"""모임 API를 확인한다(spec AC-55와 계약의 요청·응답 모양).

해석 주소는 GMS를 가짜로 바꾸고, 계산 주소는 계산(`meetup_search`)을 가짜로 바꿔 요청 검사,
응답 모양, 오류를 본다. 계산의 규칙은 tests/match/test_meetup.py가 본다.
"""

from collections.abc import Sequence

import pytest
from fastapi.testclient import TestClient

from fit_ai.match import interpretation
from fit_ai.match.candidates import (
    Found,
    PlaceFilter,
    RadiusArea,
    StationArea,
    StoreError,
    VectorCounts,
)
from fit_ai.match.cards import Card, Reason, ReasonTag, Source
from fit_ai.match.meetup import (
    Applied,
    MeetupEmpty,
    MeetupItem,
    MeetupRequest,
    MeetupResult,
    MemberScore,
)
from fit_ai.match.search import EmbeddingError
from server import meetup as server_meetup
from server.app import create_app
from server.common import Dependencies, Slots

CARD = Card(
    place_id=10,
    score=99,
    labels=("조용해요", "한식이에요"),
    reasons=(
        Reason(
            '리뷰에서 "조용해요"라는 말이 많아요',
            (ReasonTag(Source.PREFERENCE, "조용해요"),),
        ),
    ),
    score_items=(),
)
RESULT = MeetupResult(
    items=(
        MeetupItem(
            CARD,
            86,
            (
                MemberScore("1", 100),
                MemberScore("2", 40, unverified=True, missed_menu="곱창"),
                MemberScore("3", None),
            ),
        ),
    ),
    applied=Applied(
        mood="QUIET",
        like_foods=("FOOD_KOREAN",),
        no_spicy=True,
        price_cap=20000,
        want_menus=("곱창",),
    ),
)


class FakeStore:
    def find(self, place_filter: PlaceFilter, query: Sequence[float], k: int) -> Found:
        raise NotImplementedError

    def vector_counts(self) -> VectorCounts:
        return VectorCounts(30, 0)


class FakeMeetup:
    """`meetup_search` 대신 정해 둔 결과를 내거나 예외를 던진다. 받은 요청을 남긴다."""

    def __init__(self) -> None:
        self.outcome: MeetupResult | Exception = RESULT
        self.requests: list[MeetupRequest] = []

    def __call__(self, request, store, read_menus, tastes=None) -> MeetupResult:
        self.requests.append(request)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


@pytest.fixture(autouse=True)
def calculated(monkeypatch: pytest.MonkeyPatch) -> FakeMeetup:
    fake = FakeMeetup()
    monkeypatch.setattr(server_meetup, "meetup_search", fake)
    return fake


def client(**overrides: object) -> TestClient:
    deps = {"embedding_ready": True, "store": FakeStore()}
    deps.update(overrides)
    return TestClient(create_app(Dependencies(**deps)))  # type: ignore[arg-type]


SEARCH = {
    "area": {"kind": "STATION", "name": "선릉"},
    "category": "RESTAURANT",
    "when": {"date": "2026-11-14", "time": "19:00"},
    "members": [
        {"key": "1", "userId": "user-1", "mood": "QUIET", "likeFoods": ["KOREAN"]},
        {"key": "2", "noSpicy": True, "menuPriceCapWon": 20000, "wantMenu": "곱창"},
        {"key": "3"},
    ],
}


class TestInterpret:
    """해석 주소"""

    def test_interpret_with_llm(self, fake_gms) -> None:
        """해석_LLM으로해석하면_조건과음식언급요약을준다"""
        fake_gms(
            lambda messages: (
                {
                    "embedding_text": "곱창 먹기 좋은 곳",
                    "menus": [{"text": "곱창", "value": "곱창", "want": True}],
                }
                if messages[0]["content"] == interpretation.SYSTEM_PROMPT
                else None
            )
        )

        response = client().post("/v1/meetup/interpret", json={"text": "곱창 먹을 곳"})

        assert response.status_code == 200
        body = response.json()
        assert body["conditions"]["version"] == 3
        assert body["summary"] == {"mentionsFood": True}
        assert body["interpretedBy"] in ("LLM", "RULE")

    def test_interpret_rule_fallback(self, fake_gms) -> None:
        """해석_LLM이실패하면_규칙으로해석하고실패를알린다"""
        fake_gms(lambda messages: None)

        body = client().post("/v1/meetup/interpret", json={"text": "조용한 곳"}).json()

        assert body["interpretedBy"] == "RULE"
        assert body["fallbacks"] == ["INTERPRET_LLM_FAILED"]
        assert body["summary"] == {"mentionsFood": False}

    @pytest.mark.parametrize("text", ["", "   ", "가" * 101])
    def test_interpret_length(self, text: str) -> None:
        """해석_설명이비었거나100자를넘으면_400이다"""
        response = client().post("/v1/meetup/interpret", json={"text": text})

        assert response.status_code == 400
        assert response.json()["code"] == "INVALID_REQUEST"


class TestSearch:
    """계산 주소"""

    def test_request_mapped(self, calculated: FakeMeetup) -> None:
        """계산_요청을모임계산요청으로바꾼다"""
        response = client().post("/v1/meetup/search", json=SEARCH)

        assert response.status_code == 200
        request = calculated.requests[0]
        assert request.area == StationArea("선릉역", "SEOLLEUNG")
        assert request.category == "RESTAURANT"
        assert request.when is not None and request.when.day == "SAT"
        assert request.when.minute == 19 * 60
        first, second, third = request.members
        assert first.user_id == "user-1" and first.like_foods == ("FOOD_KOREAN",)
        assert second.no_spicy is True and second.price_cap == 20000
        assert second.want_menu == "곱창"
        assert third.mood is None and third.like_foods == ()
        assert request.conditions is None

    def test_circle_area(self, calculated: FakeMeetup) -> None:
        """계산_모임지점은_반경지역으로바꾼다"""
        body = SEARCH | {
            "area": {"kind": "CIRCLE", "lat": 37.5, "lng": 127.05, "radiusM": 1000}
        }
        assert client().post("/v1/meetup/search", json=body).status_code == 200
        assert calculated.requests[0].area == RadiusArea(37.5, 127.05, 1000)

    def test_response_shape(self) -> None:
        """계산_응답은장소와참여자점수와적용한취향을주고_값없는속성은빠진다"""
        body = client().post("/v1/meetup/search", json=SEARCH).json()

        assert body["applied"] == {
            "mood": "QUIET",
            "likeFoods": ["KOREAN"],
            "noSpicy": True,
            "menuPriceCapWon": 20000,
            "wantMenus": ["곱창"],
        }
        item = body["items"][0]
        assert item["placeId"] == 10
        assert item["score"] == 86
        assert item["labels"] == ["조용해요", "한식이에요"]
        assert item["reasons"][0]["tags"] == [
            {"source": "PREFERENCE", "label": "조용해요"}
        ]
        assert item["memberScores"] == [
            {"key": "1", "score": 100},
            {"key": "2", "score": 40, "unverified": True, "missedMenu": "곱창"},
            {"key": "3"},
        ]
        assert "emptyReason" not in body
        assert body["fallbacks"] == []

    def test_empty_reason_with_members(self, calculated: FakeMeetup) -> None:
        """계산_후보가없으면_원인과참여자번호를준다"""
        calculated.outcome = MeetupResult(
            (),
            Applied(),
            MeetupEmpty("못 먹는 음식을 빼면 남는 곳이 없어요", "다시 확인", ("2",)),
            menus_failed=True,
        )

        body = client().post("/v1/meetup/search", json=SEARCH).json()

        assert body["items"] == []
        assert body["emptyReason"] == {
            "cause": "못 먹는 음식을 빼면 남는 곳이 없어요",
            "suggestion": "다시 확인",
            "memberKeys": ["2"],
        }
        assert body["fallbacks"] == ["MENU_LLM_FAILED"]
        assert body["applied"] == {}

    @pytest.mark.parametrize(
        "change",
        [
            {"extra": 1},
            {"area": {"kind": "CIRCLE", "lat": 37.5, "lng": 127.0, "radiusM": 700}},
            {"area": {"kind": "GU", "name": "강남구"}},
            {"category": "ANY"},
            {"when": {"date": "2026-02-30"}},
            {"when": {"date": "2026-11-14", "time": "25:00"}},
            {"members": [{"key": "1"}, {"key": "1"}]},
            {"members": [{"key": "1", "mood": "ANY"}]},
            {"members": [{"key": "1", "likeFoods": ["MEXICAN"]}]},
            {"members": [{"key": "1", "noSpicy": "yes"}]},
            {"members": [{"key": "1", "wantMenu": "가" * 21}]},
            {"members": [{"key": "1", "name": "민지"}]},
            {"members": [{"key": str(i)} for i in range(9)]},
        ],
    )
    def test_invalid_request(self, change: dict, calculated: FakeMeetup) -> None:
        """계산_요청모양이틀리면_취향을빼지않고400이다"""
        response = client().post("/v1/meetup/search", json=SEARCH | change)

        assert response.status_code == 400
        assert response.json()["code"] == "INVALID_REQUEST"
        assert calculated.requests == []

    @pytest.mark.parametrize(
        "conditions", [{"version": 3}, {"version": 3, "text": 1}, {"codes": "x"}]
    )
    def test_conditions_invalid(self, conditions: dict, calculated: FakeMeetup) -> None:
        """계산_저장한해석을읽지못하면_400CONDITIONS_INVALID다"""
        response = client().post(
            "/v1/meetup/search", json=SEARCH | {"conditions": conditions}
        )

        assert response.status_code == 400
        assert response.json()["code"] == "CONDITIONS_INVALID"
        assert calculated.requests == []

    def test_conditions_read(self, fake_gms, calculated: FakeMeetup) -> None:
        """계산_해석주소가준조건을_그대로읽는다"""
        fake_gms(lambda messages: None)
        app = client()
        conditions = app.post(
            "/v1/meetup/interpret", json={"text": "조용한 곳"}
        ).json()["conditions"]

        response = app.post(
            "/v1/meetup/search", json=SEARCH | {"conditions": conditions}
        )

        assert response.status_code == 200
        assert calculated.requests[0].conditions is not None
        assert calculated.requests[0].conditions.text == "조용한 곳"

    @pytest.mark.parametrize(
        ("error", "code"),
        [
            (EmbeddingError("HTTP 401"), "EMBEDDING_UNAVAILABLE"),
            (StoreError("timeout"), "PLACES_UNAVAILABLE"),
        ],
    )
    def test_failures(
        self, error: Exception, code: str, calculated: FakeMeetup
    ) -> None:
        """계산_인코딩이나저장소가실패하면_503이다"""
        calculated.outcome = error

        response = client().post("/v1/meetup/search", json=SEARCH)

        assert response.status_code == 503
        assert response.json()["code"] == code

    def test_not_ready(self) -> None:
        """계산_장소저장소가없으면_503이다"""
        response = client(store=None).post("/v1/meetup/search", json=SEARCH)

        assert response.status_code == 503
        assert response.json()["code"] == "PLACES_UNAVAILABLE"

    def test_shares_slots_with_search(self) -> None:
        """계산_일반검색과같은동시처리칸을쓴다"""
        slots = Slots(1)
        app = client(slots=slots)
        assert slots._slots.acquire(blocking=False)
        try:
            response = app.post("/v1/meetup/search", json=SEARCH)
        finally:
            slots._slots.release()

        assert response.status_code == 503
        assert response.json()["code"] == "BUSY"
