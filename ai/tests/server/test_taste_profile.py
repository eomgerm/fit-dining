import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fit_ai import embedding
from server.app import create_app
from server.common import Dependencies

SAMPLES = json.loads(
    (Path(__file__).parents[2] / "samples" / "taste" / "profiles.json").read_text(
        encoding="utf-8"
    )
)


VECTOR = [0.5] * 1024


def client(**deps: object) -> TestClient:
    return TestClient(
        create_app(Dependencies(**deps)),  # type: ignore[arg-type]
        raise_server_exceptions=False,
    )


@pytest.fixture
def encoded(monkeypatch: pytest.MonkeyPatch) -> list[tuple[list[str], float, int]]:
    calls: list[tuple[list[str], float, int]] = []

    def fake(texts: list[str], timeout: float, attempts: int) -> list[list[float]]:
        calls.append((texts, timeout, attempts))
        return [VECTOR for _ in texts]

    monkeypatch.setattr(embedding, "encode_queries", fake)
    return calls


def chip(polarity, label, code):
    return {"polarity": polarity, "label": label, "code": code}


# 샘플 사용자 1~6(spec 6단계)의 온보딩을 BE 저장 형식으로 옮긴 요청.
# 7번은 리뷰 근거라 갱신 API 테스트에서 따로 만든다.
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


@pytest.mark.parametrize("path", ["/v1/taste/profile", "/v1/taste/refresh"])
@pytest.mark.parametrize("no", REQUESTS)
def test_features_match_sample_profile(no, path):
    resp = client().post(path, json=REQUESTS[no])
    assert resp.status_code == 200
    assert resp.json()["features"] == SAMPLES[no]["features"]


def review(code, place, day, category="카페", revisit=False):
    """배치가 보내는 리뷰 근거. `code`는 사용자 쪽 코드다."""
    return {
        "placeId": place,
        "reviewId": place * 100 + day,
        "category": category,
        "code": code,
        "createdAt": f"2026-10-{day}T12:00:00+09:00",
        "revisitIntent": revisit,
    }


def test_refresh_sample_7_matches_sample_profile():
    # 1번 + 카페 4곳 "조용해서 좋았어요"(1번 카페는 두 번) + "대기가 길었어요" 1건
    body = REQUESTS["1"] | {
        "reviews": [review("QUIET", p, 23) for p in (1, 2, 3, 4)]
        + [review("QUIET", 1, 24), review("SHORT_WAIT", 5, 24)]
    }
    resp = client().post("/v1/taste/refresh", json=body)
    assert resp.status_code == 200
    assert resp.json() == {
        "features": SAMPLES["7"]["features"],
        "embeddingFailed": False,
    }


def test_refresh_flips_noise_pole_after_3_opposite_places():
    body = {"mood": "QUIET", "reviews": [review("LIVELY", p, 23) for p in (1, 2, 3)]}
    resp = client().post("/v1/taste/refresh", json=body)
    assert [
        (f["code"], f["like"]) for f in resp.json()["features"] if f["category"] is None
    ] == [("QUIET", False), ("LIVELY", True)]


def test_refresh_weighs_revisit_reviews_and_returns_category_tastes():
    body = {
        "reviews": [
            review("COZY", 1, 23, revisit=True),
            review("VALUE_FOR_MONEY", 2, 23, category="식당"),
        ]
    }
    resp = client().post("/v1/taste/refresh", json=body)
    assert resp.status_code == 200
    assert [
        (f["category"], f["code"], f["weight"]) for f in resp.json()["features"]
    ] == [
        (None, "COZY", 1.5),
        (None, "VALUE_FOR_MONEY", 1.0),
        ("RESTAURANT", "COZY", 0.75),
        ("RESTAURANT", "VALUE_FOR_MONEY", 1.0),
        ("CAFE", "COZY", 1.5),
        ("CAFE", "VALUE_FOR_MONEY", 0.5),
        ("BAR", "COZY", 0.75),
        ("BAR", "VALUE_FOR_MONEY", 0.5),
    ]


@pytest.mark.parametrize(
    "evidence",
    [
        review("QUIET", 1, 23) | {"createdAt": "2026-10-23T12:00:00"},  # 시간대 없음
        review("NOPE", 1, 23),
        review("QUIET", 1, 23) | {"direction": 1},
        {k: v for k, v in review("QUIET", 1, 23).items() if k != "placeId"},
        {k: v for k, v in review("QUIET", 1, 23).items() if k != "revisitIntent"},
        review("QUIET", 1, 23, category="편의점"),
    ],
)
def test_refresh_rejects_invalid_review(evidence):
    resp = client().post("/v1/taste/refresh", json={"reviews": [evidence]})
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_REQUEST"


def test_profile_does_not_take_reviews():
    resp = client().post(
        "/v1/taste/profile", json={"reviews": [review("QUIET", 1, 23)]}
    )
    assert resp.status_code == 400


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
    # 고른 13개 + 소음 반대 극
    assert {f["code"] for f in resp.json()["features"]} == {
        "QUIET",
        "LIVELY",
        "SPACIOUS_SEATING",
        "SHORT_WAIT",
        "GENEROUS_PORTION",
        "PRETTY_SPACE",
        "VIEW_OUTDOOR",
        "COZY",
        "VALUE_FOR_MONEY",
        "PURPOSE_TALK",
        "PURPOSE_SOLO",
        "PURPOSE_DATE",
        "PURPOSE_GROUP",
        "PURPOSE_WORK",
    }


def test_chip_without_code_key_is_accepted():
    # BE는 null 속성을 직렬화하지 않아(jackson non_null) 코드 없는 칩에 code 키가 없다
    body = {"purposes": ["SOLO"], "tastes": [{"polarity": "LIKE", "label": "국물"}]}
    resp = client().post("/v1/taste/profile", json=body)
    assert resp.json() == {"features": SAMPLES["4"]["features"], "vectors": [None]}


def test_tag_and_chip_on_opposite_poles_cancel():
    # 온보딩 조용 + 직접 입력 "활기찬 곳 좋아요"는 소음 취향이 없다(spec 3단계 계산 예)
    body = {"mood": "QUIET", "tastes": [chip("LIKE", "활기찬 곳", "LIVELY")]}
    resp = client().post("/v1/taste/profile", json=body)
    assert resp.json() == {"features": [], "vectors": [None]}


@pytest.mark.parametrize(
    "body",
    [
        {"priorities": ["SPACIOUS_SEATING"]},  # 코드표 이름이 아니라 BE 이름을 받는다
        {"tastes": [chip("LIKE", "없는 코드", "NOPE")]},
        {"tastes": [chip("LIKE", "조용", "QUIET") | {"vector": [0.1]}]},
        {"tastes": [chip("LIKE", "가", None)] * 11},
        {"tastes": [chip("LIKE", "", None)]},
        {"tastes": [chip("LIKE", "가" * 21, None)]},
    ],
    ids=["be-name", "code", "vector", "11", "empty", "21"],
)
def test_invalid_request(body):
    resp = client().post("/v1/taste/profile", json=body)
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_REQUEST"


CHIPS = {
    "tastes": [
        chip("LIKE", "국물", None),
        chip("LIKE", "조용", "QUIET"),
        chip("DISLIKE", "매운", None),
        chip("LIKE", "창가", None),
    ]
}


def test_uncoded_like_chips_get_vectors_in_chip_order(encoded):
    resp = client(embedding_ready=True).post("/v1/taste/profile", json=CHIPS)
    assert resp.status_code == 200
    assert resp.json()["vectors"] == [VECTOR, None, None, VECTOR]
    [(texts, timeout, attempts)] = encoded
    assert texts == ["국물", "창가"]
    # BE 프로필 타임아웃(3초) 안에 features를 돌려준다: 연결·읽기 단계를 합쳐도 3초 미만
    assert attempts == 1 and timeout * 2 < 3


def test_no_embedding_call_without_uncoded_like_chip(encoded):
    body = {"tastes": [chip("LIKE", "조용", "QUIET"), chip("DISLIKE", "매운", None)]}
    resp = client(embedding_ready=True).post("/v1/taste/profile", json=body)
    assert resp.json()["vectors"] == [None, None]
    assert encoded == []


def test_embedding_not_ready_keeps_features(encoded):
    resp = client().post("/v1/taste/profile", json=CHIPS | {"mood": "QUIET"})
    assert resp.status_code == 200
    assert resp.json()["features"] != []
    assert resp.json()["vectors"] == [None] * 4
    assert encoded == []


def test_embedding_failure_keeps_features_without_text(monkeypatch, caplog):
    def fail(texts: list[str], timeout: float, attempts: int) -> list[list[float]]:
        raise embedding.EmbeddingUnavailable("timeout")

    monkeypatch.setattr(embedding, "encode_queries", fail)
    caplog.set_level("INFO", logger="server")
    body = {"mood": "QUIET", "tastes": [chip("LIKE", "비밀 취향", None)]}
    resp = client(embedding_ready=True).post("/v1/taste/profile", json=body)
    assert resp.status_code == 200
    assert resp.json()["features"] != []
    assert resp.json()["vectors"] == [None]
    assert "embedding_failed" in caplog.text
    assert "비밀 취향" not in caplog.text


@pytest.mark.parametrize(
    "bad",
    [[0.5] * 1023, [float("nan")] * 1024, ["0.5"] * 1024],
    ids=["dim", "nan", "str"],
)
def test_bad_vector_keeps_features(monkeypatch, bad):
    monkeypatch.setattr(
        embedding, "encode_queries", lambda texts, timeout, attempts: [bad]
    )
    body = {"mood": "QUIET", "tastes": [chip("LIKE", "국물", None)]}
    resp = client(embedding_ready=True).post("/v1/taste/profile", json=body)
    assert resp.status_code == 200
    assert resp.json()["features"] != []
    assert resp.json()["vectors"] == [None]


def review_body(place, day, items, category="카페"):
    """배치가 보내는 리뷰 하나의 본문 추출 결과."""
    return {
        "placeId": place,
        "reviewId": place * 100 + day,
        "category": category,
        "createdAt": f"2026-10-{day}T12:00:00+09:00",
        "revisitIntent": False,
        "items": items,
    }


def item(code, direction=1, liked=None, kind="taste", text=None):
    return {
        "code": code,
        "direction": direction,
        "liked": liked,
        "kind": kind,
        "text": text,
    }


def overall(resp):
    return {
        (f["code"], f["like"]): f["weight"]
        for f in resp.json()["features"]
        if f["category"] is None
    }


def test_refresh_counts_tag_and_body_of_different_places():
    # 설계 2단계 예: 카페 리뷰에 "대화" 태그 1곳, 본문 "친구랑 수다 떨기 딱" 다른 1곳 → 대화 2
    body = {
        "reviews": [review("PURPOSE_TALK", 1, 23)],
        "bodies": [review_body(2, 23, [item("PURPOSE_TALK")])],
    }
    resp = client().post("/v1/taste/refresh", json=body)
    assert resp.status_code == 200
    assert overall(resp) == {("PURPOSE_TALK", True): 2}


def test_refresh_counts_tag_and_body_of_one_review_once():
    body = {
        "reviews": [review("PURPOSE_TALK", 1, 23)],
        "bodies": [review_body(1, 23, [item("PURPOSE_TALK")])],
    }
    assert overall(client().post("/v1/taste/refresh", json=body)) == {
        ("PURPOSE_TALK", True): 1
    }


def test_refresh_reads_flavor_from_body_and_ignores_text_items():
    body = {
        "bodies": [
            review_body(
                1,
                23,
                [
                    item("FOOD_SWEET", -1, 1),  # "달지 않아서 좋아요"
                    item("FOOD_NUTTY", 1, None),  # 좋고 나쁨 없음
                    item(None, 1, None, "taste", "크림 파스타 소스가 진하다"),
                ],
            )
        ]
    }
    assert overall(client().post("/v1/taste/refresh", json=body)) == {
        ("FOOD_SWEET", False): 1
    }


@pytest.mark.parametrize(
    "bad",
    [
        item("NOPE"),
        item("FOOD_SWEET", 0, 1),
        item("FOOD_SWEET", 1, 2),
        item(None, kind="없는 종류"),
        item(None, text="가" * 201),
    ],
)
def test_refresh_rejects_invalid_body_item(bad):
    resp = client().post(
        "/v1/taste/refresh", json={"bodies": [review_body(1, 23, [bad])]}
    )
    assert resp.status_code == 400


def bundles_of(resp):
    return [
        (f["text"], f["weight"], f["category"])
        for f in resp.json()["features"]
        if f["code"] is None
    ]


def test_profile_bundles_uncoded_like_chips_with_their_vectors(encoded):
    body = {
        "tastes": [
            chip("LIKE", "창가 자리가 있는 곳", None),
            chip("LIKE", "조용하고 차분한 곳", "QUIET"),
        ]
    }
    resp = client(embedding_ready=True).post("/v1/taste/profile", json=body)
    assert resp.status_code == 200
    assert bundles_of(resp) == [("창가 자리가 있는 곳", 1.0, None)]
    [bundle] = [f for f in resp.json()["features"] if f["code"] is None]
    assert (
        bundle["layer"] is None
        and bundle["like"] is True
        and len(bundle["vector"]) == 1024
    )


def test_refresh_embeds_review_phrases_and_uses_stored_chip_vectors(encoded):
    body = {
        "tastes": [chip("LIKE", "창가 자리가 있는 곳", None) | {"vector": VECTOR}],
        "bodies": [
            review_body(
                1,
                23,
                [
                    item(None, 1, None, "taste", "브런치가 맛있었다")
                    | {"slot": "메뉴 평가"},
                    item(None, 1, None, "taste", "부모님과 함께 방문했다")
                    | {"slot": "방문 맥락"},
                    item(None, 1, None, "quality", "맛있다") | {"slot": "메뉴 평가"},
                ],
            )
        ],
    }
    resp = client(embedding_ready=True).post("/v1/taste/refresh", json=body)
    assert resp.status_code == 200
    # 칩은 BE가 보낸 벡터를 쓰고, 리뷰 문장 중 묶음 재료만 임베딩한다
    assert [texts for texts, _, _ in encoded] == [["브런치가 맛있었다"]]
    assert resp.json()["embeddingFailed"] is False
    # 가짜 임베딩이 모든 문장에 같은 벡터를 주어 한 묶음이 된다
    assert len(bundles_of(resp)) == 4  # 전체와 업종 3개


def test_refresh_without_embedding_keeps_codes_and_flags_bundles(encoded):
    body = {
        "reviews": [review("QUIET", 1, 23)],
        "bodies": [
            review_body(
                1,
                23,
                [
                    item(None, 1, None, "taste", "브런치가 맛있었다")
                    | {"slot": "메뉴 평가"}
                ],
            )
        ],
    }
    resp = client(embedding_ready=False).post("/v1/taste/refresh", json=body)
    assert resp.status_code == 200
    assert resp.json()["embeddingFailed"] is True
    assert bundles_of(resp) == []
    assert any(f["code"] == "QUIET" for f in resp.json()["features"])
