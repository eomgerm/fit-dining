import pytest
from fastapi.testclient import TestClient

from fit_ai import embedding
from server.app import create_app
from server.common import Dependencies

VECTOR = [0.5] * 1024


def client(**overrides: object) -> TestClient:
    deps = {"embedding_ready": True, **overrides}
    return TestClient(
        create_app(Dependencies(**deps)),  # type: ignore[arg-type]
        raise_server_exceptions=False,
    )


@pytest.fixture
def encoded(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    calls: list[list[str]] = []

    def fake(texts: list[str]) -> list[list[float]]:
        calls.append(texts)
        return [VECTOR for _ in texts]

    monkeypatch.setattr(embedding, "encode_queries", fake)
    return calls


def test_vectors_in_input_order(encoded):
    resp = client().post(
        "/v1/taste/vectors", json={"texts": ["국물 요리", "창가 자리"]}
    )
    assert resp.status_code == 200
    assert resp.json() == {
        "model": embedding.MODEL_VERSION,
        "vectors": [VECTOR, VECTOR],
    }
    assert encoded == [["국물 요리", "창가 자리"]]


@pytest.mark.parametrize(
    "texts",
    [[], ["가"] * 11, [""], ["가" * 21], [" "]],
    ids=["empty", "11", "blank", "21", "space"],
)
def test_rejects_texts_outside_chip_limits(encoded, texts):
    resp = client().post("/v1/taste/vectors", json={"texts": texts})
    assert resp.status_code == 400
    assert encoded == []


def test_embedding_not_ready(encoded):
    resp = client(embedding_ready=False).post(
        "/v1/taste/vectors", json={"texts": ["국물"]}
    )
    assert resp.status_code == 503
    assert resp.json()["code"] == "EMBEDDING_UNAVAILABLE"
    assert encoded == []


def test_embedding_failure_is_503_without_text(monkeypatch, caplog):
    def fail(_: list[str]) -> list[list[float]]:
        raise embedding.EmbeddingUnavailable("timeout")

    monkeypatch.setattr(embedding, "encode_queries", fail)
    caplog.set_level("INFO", logger="server")
    resp = client().post("/v1/taste/vectors", json={"texts": ["비밀 취향"]})
    assert resp.status_code == 503
    assert resp.json()["code"] == "EMBEDDING_UNAVAILABLE"
    assert "embedding_failed" in caplog.text
    assert "비밀 취향" not in caplog.text + resp.text
