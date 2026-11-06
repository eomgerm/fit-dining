import logging

import pytest
from fastapi.testclient import TestClient

from fit_ai import gms
from fit_ai.features import FEATURES
from server.app import create_app
from server.common import Dependencies

URL = "/v1/taste/interpret"
TEXT = "시끄럽지 않은 데가 좋아요. 마라탕 좋아해요"
ITEMS = [
    {
        "quote": "시끄럽지 않은 데가 좋아요",
        "kind": "taste",
        "code": "QUIET",
        "like": True,
        "positive_text": None,
    },
    {
        "quote": "마라탕 좋아해요",
        "kind": "taste",
        "code": None,
        "like": True,
        "positive_text": "마라탕을 먹을 수 있는 곳",
    },
]


@pytest.fixture
def seen(monkeypatch):
    """GMS 대신 ITEMS를 돌려주고, 받은 인자를 남긴다."""
    seen = {"items": ITEMS}

    def call_json(messages, parse, **kw):
        seen.update(messages=messages, **kw)
        if seen["items"] is None:
            return None
        return parse({"items": seen["items"]})

    monkeypatch.setattr(gms, "call_json", call_json)
    return seen


def client(deps: Dependencies | None = None) -> TestClient:
    return TestClient(create_app(deps or Dependencies()))


def test_returns_chips_for_be(seen):
    resp = client().post(URL, json={"text": TEXT})
    assert resp.status_code == 200
    assert resp.json() == {
        "tastes": [
            {"polarity": "LIKE", "label": FEATURES["QUIET"].label, "code": "QUIET"},
            {"polarity": "LIKE", "label": "마라탕을 먹을 수 있는 곳", "code": None},
        ],
        "model": "gpt-6-luna",
    }


def test_passes_trimmed_text_and_gms_settings(seen):
    gms_client = object()
    deps = Dependencies(gms_timeout=1.5, gms_client=gms_client)
    client(deps).post(URL, json={"text": f"  {TEXT}\n"})
    assert seen["messages"][-1]["content"] == TEXT
    assert (seen["timeout"], seen["client"]) == (1.5, gms_client)


def test_no_taste_found_is_empty_list(seen):
    seen["items"] = []
    resp = client().post(URL, json={"text": "안녕하세요"})
    assert (resp.status_code, resp.json()["tastes"]) == (200, [])


def test_failed_interpretation_is_503(seen):
    seen["items"] = None
    resp = client().post(URL, json={"text": TEXT})
    assert resp.status_code == 503
    assert resp.json()["code"] == "INTERPRET_FAILED"


def test_100_chars_after_trim_is_allowed(seen):
    seen["items"] = []
    resp = client().post(URL, json={"text": " " + "가" * 100 + " "})
    assert resp.status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"text": ""},
        {"text": "  "},
        {"text": "가" * 101},
        {"text": 1},
        {"text": TEXT, "userId": "u1"},
    ],
)
def test_invalid_request_is_400(seen, body):
    resp = client().post(URL, json=body)
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_REQUEST"


def test_logs_counts_without_text_or_labels(seen, caplog):
    caplog.set_level(logging.INFO)
    client().post(URL, json={"text": TEXT})
    seen["items"] = None
    client().post(URL, json={"text": TEXT})
    assert "direct_input" in caplog.text
    for secret in ("시끄럽", "마라탕", FEATURES["QUIET"].label):
        assert secret not in caplog.text
