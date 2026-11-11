import pytest
from fastapi.testclient import TestClient

from fit_ai import gms
from fit_ai.place import extract
from server.app import create_app
from server.common import Dependencies

URL = "/v1/reviews/extract"


def it(slot, quote, code=None, direction=1, liked=None, kind="taste", text=None):
    return {
        "slot": slot,
        "quote": quote,
        "code": code,
        "direction": direction,
        "liked": liked,
        "kind": kind,
        "text": text,
    }


@pytest.fixture
def answers(monkeypatch):
    """GMS 대신 리뷰 번호마다 `answers["items"]`를 돌려준다. None이면 실패다."""
    seen = {"items": [], "calls": []}

    def call_json(messages, parse, **kw):
        seen["calls"].append(kw)
        if seen["items"] is None:
            return None
        return parse({str(i + 1): items for i, items in enumerate(seen["items"])})

    monkeypatch.setattr(gms, "call_json", call_json)
    return seen


def client() -> TestClient:
    return TestClient(create_app(Dependencies()), raise_server_exceptions=False)


def test_returns_items_per_review_in_request_order(answers):
    # 지어낸 문장이다
    answers["items"] = [
        [it("맛 성향", "달지 않아서 좋아요", "FOOD_SWEET", -1, 1)],
        [],
    ]
    resp = client().post(
        URL,
        json={
            "reviews": [
                {"reviewId": 7, "body": "달지 않아서 좋아요"},
                {"reviewId": 3, "body": "그냥 그랬어요"},
            ]
        },
    )
    assert resp.status_code == 200
    assert resp.json() == {
        "results": [
            {
                "reviewId": 7,
                "items": [it("맛 성향", "달지 않아서 좋아요", "FOOD_SWEET", -1, 1)],
            },
            {"reviewId": 3, "items": []},
        ],
        "model": extract.MODEL,
        "promptVersion": extract.PROMPT_VERSION,
    }
    # 리뷰 10건까지 GMS 한 번이고, 추출기의 시간 제한과 모델을 쓴다
    assert len(answers["calls"]) == 1
    assert answers["calls"][0]["timeout"] == extract.TIMEOUT
    assert answers["calls"][0]["model"] == extract.MODEL


def test_gms_failure_is_503(answers):
    answers["items"] = None
    resp = client().post(URL, json={"reviews": [{"reviewId": 1, "body": "좋아요"}]})
    assert resp.status_code == 503
    assert resp.json()["code"] == "EXTRACT_FAILED"


@pytest.mark.parametrize(
    "reviews",
    [
        [],
        [{"reviewId": i, "body": "좋아요"} for i in range(extract.BATCH_SIZE + 1)],
        [{"reviewId": 1, "body": "   "}],
        [{"reviewId": 1, "body": "가" * 501}],
        [{"reviewId": 1, "body": "좋아요"}, {"reviewId": 1, "body": "또 좋아요"}],
    ],
)
def test_invalid_request(answers, reviews):
    resp = client().post(URL, json={"reviews": reviews})
    assert resp.status_code == 400
    assert not answers["calls"]
