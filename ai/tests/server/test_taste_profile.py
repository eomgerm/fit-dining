import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.common import Dependencies

SAMPLES = json.loads(
    (Path(__file__).parents[2] / "samples" / "taste" / "profiles.json").read_text(
        encoding="utf-8"
    )
)


def client() -> TestClient:
    return TestClient(create_app(Dependencies()), raise_server_exceptions=False)


def chip(polarity, label, code):
    return {"polarity": polarity, "label": label, "code": code}


# 샘플 사용자 1~6(spec 6단계)의 온보딩을 BE 저장 형식으로 옮긴 요청.
# 7번은 리뷰 근거라 온보딩 계산 범위 밖이다.
REQUESTS = {
    "1": {"mood": "QUIET", "purposes": ["WORK_STUDY"]},
    "2": {"priorities": ["VALUE"], "purposes": ["CONVERSATION"]},
    "3": {
        "purposes": ["DATE"],
        "tastes": [chip("LIKE", "조용하고 차분한 곳", "QUIET")],
    },
    "4": {
        "purposes": ["SOLO"],
        "tastes": [chip("LIKE", "담백한 국물 요리를 먹을 수 있는 곳", None)],
    },
    "5": {
        "purposes": ["GATHERING"],
        "tastes": [chip("DISLIKE", "매운 음식", "FOOD_SPICY")],
    },
    "6": {"mood": "LIVELY"},
}


@pytest.mark.parametrize("no", REQUESTS)
def test_features_match_sample_profile(no):
    resp = client().post("/v1/taste/profile", json=REQUESTS[no])
    assert resp.status_code == 200
    assert resp.json() == {"features": SAMPLES[no]["features"]}


def test_every_be_tag_is_accepted():
    body = {
        "mood": "QUIET",
        "priorities": [
            "SPACIOUS",
            "SHORT_WAIT",
            "GENEROUS_PORTION",
            "PRETTY_SPACE",
            "VIEW_OUTDOOR",
            "COZY",
            "VALUE",
        ],
        "purposes": ["CONVERSATION", "SOLO", "DATE", "GATHERING", "WORK_STUDY"],
    }
    resp = client().post("/v1/taste/profile", json=body)
    assert resp.status_code == 200
    assert len(resp.json()["features"]) == 14  # 고른 13개 + 소음 반대 극


def test_tag_and_chip_on_opposite_poles_cancel():
    # 온보딩 조용 + 직접 입력 "활기찬 곳 좋아요"는 소음 취향이 없다(spec 3단계 계산 예)
    body = {"mood": "QUIET", "tastes": [chip("LIKE", "활기찬 곳", "LIVELY")]}
    resp = client().post("/v1/taste/profile", json=body)
    assert resp.json() == {"features": []}


@pytest.mark.parametrize(
    "body",
    [
        {"priorities": ["SPACIOUS_SEATING"]},  # 코드표 이름이 아니라 BE 이름을 받는다
        {"tastes": [chip("LIKE", "없는 코드", "NOPE")]},
        {"tastes": [chip("LIKE", "조용", "QUIET") | {"vector": [0.1]}]},
    ],
)
def test_invalid_request(body):
    resp = client().post("/v1/taste/profile", json=body)
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_REQUEST"
