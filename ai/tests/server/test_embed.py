import threading
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from fit_ai import embedding
from server import embed


class FakeModel:
    def __init__(self):
        self.seen: list[str] = []

    def encode(self, texts, **_):
        self.seen += texts
        return np.array([[3.0, 4.0]] * len(texts))


@pytest.fixture
def model(monkeypatch):
    fake = FakeModel()
    monkeypatch.setattr(embedding, "_model", lambda: fake)
    return fake


@pytest.fixture
def client():
    return TestClient(embed.create_api())


def test_query_embeds_with_model_version(model, client):
    res = client.post("/embed", json={"texts": ["조용한 곳"], "kind": "query"})

    assert res.status_code == 200
    version = f"{embedding.MODEL_ID}@{embedding.REVISION}"
    assert res.headers["X-Model-Version"] == version
    assert res.json() == {"model": version, "dim": 2, "vectors": [[0.6, 0.8]]}
    assert model.seen == ["query: 조용한 곳"]


def test_query_stays_local_even_with_remote_set(model, client, monkeypatch):
    # Modal 앱에 EMBED_*가 들어가도 자기 자신을 부르지 않는다
    monkeypatch.setenv("EMBED_BASE_URL", "https://embed.example")
    monkeypatch.setattr(embedding, "_client", lambda: pytest.fail("원격을 불렀다"))

    res = client.post("/embed", json={"texts": ["조용한 곳"], "kind": "query"})

    assert res.status_code == 200
    assert model.seen == ["query: 조용한 곳"]


def test_passage_is_encoded_without_prefix(model, client):
    client.post("/embed", json={"texts": ["조용한 곳"], "kind": "passage"})
    assert model.seen == ["조용한 곳"]


@pytest.mark.parametrize(
    "body",
    [
        {"texts": ["a"], "kind": "doc"},
        {"texts": [], "kind": "query"},
        {"texts": ["a"] * (embed.MAX_TEXTS + 1), "kind": "query"},
        {"texts": ["a" * (embed.MAX_CHARS + 1)], "kind": "query"},
    ],
)
def test_rejects_out_of_contract_requests(model, client, body):
    assert client.post("/embed", json=body).status_code == 422
    assert model.seen == []


def test_rejection_does_not_echo_request_text(model, client):
    secret = "가" * (embed.MAX_CHARS + 1)
    res = client.post("/embed", json={"texts": [secret], "kind": "query"})
    assert res.status_code == 422
    assert secret not in res.text


def test_warm_up_runs_one_encode_after_loading_the_model(model):
    # 첫 encode의 CUDA 초기화(0.6~2.3초)를 사용자 요청이 아니라 컨테이너 기동 중에 치른다
    embed.warm_up()
    assert len(model.seen) == 1


def test_concurrent_requests_never_overlap_in_the_model(monkeypatch):
    # @modal.concurrent로 한 컨테이너에 입력이 동시에 들어와도 모델과 토크나이저는 한 번에 하나씩만 쓴다
    running = peak = 0
    guard = threading.Lock()

    class SlowModel:
        def encode(self, texts, **_):
            nonlocal running, peak
            with guard:
                running += 1
                peak = max(peak, running)
            time.sleep(0.05)
            with guard:
                running -= 1
            return np.array([[3.0, 4.0]] * len(texts))

    monkeypatch.setattr(embedding, "_model", lambda: SlowModel())
    start = threading.Barrier(4)
    statuses: list[int] = []

    def call():
        c = TestClient(embed.create_api())
        start.wait()
        res = c.post("/embed", json={"texts": ["a"], "kind": "query"})
        statuses.append(res.status_code)

    threads = [threading.Thread(target=call) for _ in range(4)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()

    assert statuses == [200] * 4
    assert peak == 1
