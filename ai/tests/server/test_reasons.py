import pytest
from fastapi.testclient import TestClient

from fit_ai import gms
from server.app import create_app
from server.common import Dependencies

URL = "/v1/reasons/titles"
BODY = {
    "request": "조용한 카페",
    "categoryGroup": "CAFE",
    "items": [
        {
            "source": "REQUEST",
            "code": "QUIET",
            "value": 0.95,
            "fromReviews": True,
            "persona": {
                "name": "조용한 독서가",
                "description": "책 읽는 손님입니다.",
                "reason": "차분합니다.",
            },
        },
        {"source": "PREFERENCE", "code": "PARKING", "value": 1.0, "fromReviews": False},
    ],
}


@pytest.fixture
def reply(monkeypatch):
    """GMS 대신 `reasons`를 돌려준다. None이면 실패다."""
    state = {
        "reasons": [
            {
                "index": 0,
                "title": "차분해서 책 읽기 좋아요",
                "persona_related": True,
                "persona_summary": "책 읽으러 오는 손님",
            }
        ]
    }

    def call_json(messages, parse, **kw):
        return (
            None if state["reasons"] is None else parse({"reasons": state["reasons"]})
        )

    monkeypatch.setattr(gms, "call_json", call_json)
    return state


def post(body):
    return TestClient(create_app(Dependencies())).post(URL, json=body)


def test_titles(reply) -> None:
    """제목API_고른이유마다_제목과요약을같은순서로돌려준다"""
    resp = post(BODY)

    assert resp.status_code == 200
    data = resp.json()
    assert data["titles"] == [
        {"title": "차분해서 책 읽기 좋아요", "personaSummary": "책 읽으러 오는 손님"},
        {"title": "주차할 수 있어요"},
    ]
    assert data["fallbacks"] == []
    assert data["model"] == gms.MODEL


def test_llm_failure_still_200(reply) -> None:
    """제목API_LLM이실패해도_대체제목으로200이고실패를알린다"""
    reply["reasons"] = None

    data = post(BODY).json()

    # 관계를 판단하지 못해 페르소나 요약은 빠진다
    assert data["titles"][0] == {"title": "카페 중 손꼽히게 조용해요"}
    assert data["fallbacks"] == ["TITLE_LLM_FAILED"]


@pytest.mark.parametrize(
    "change",
    [
        {"items": []},
        {"categoryGroup": "PUB"},
        {
            "items": [
                {"source": "REQUEST", "code": "NOPE", "value": 0.9, "fromReviews": True}
            ]
        },
        {
            "items": [
                {
                    "source": "REQUEST",
                    "code": "QUIET",
                    "value": 1.2,
                    "fromReviews": True,
                }
            ]
        },
        {
            "items": [
                {
                    "source": "REQUEST",
                    "code": "QUIET",
                    "value": 0.9,
                    "fromReviews": True,
                    "quotes": ["a", "b", "c"],
                }
            ]
        },
    ],
)
def test_invalid(reply, change) -> None:
    """제목API_이유가없거나모르는코드거나범위밖이면_400이다"""
    resp = post({**BODY, **change})

    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_REQUEST"
