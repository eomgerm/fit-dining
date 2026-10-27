"""공유 모듈 `fit_ai.embedding`을 요청문 인코더로 감싼 어댑터를 확인한다."""

import pytest

from fit_ai import embedding
from fit_ai.match.embedder import Embedding, EmbeddingError, SharedEmbedder


def test_encodes_with_shared_module(monkeypatch: pytest.MonkeyPatch) -> None:
    """인코더_만들때미리한번인코딩해모델을올리고_요청문은질의쪽함수로바꾼다"""
    calls = []

    def encode_queries(texts: list[str]) -> list[list[float]]:
        calls.append(texts)
        return [[0.6, 0.8]]

    monkeypatch.setattr(embedding, "encode_queries", encode_queries)

    result = SharedEmbedder().encode_query("조용한 카페")

    assert result == Embedding(embedding.MODEL_ID, embedding.REVISION, (0.6, 0.8))
    assert calls == [["준비"], ["조용한 카페"]]


def test_load_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """인코더_모델을올리지못하면_EmbeddingError다"""

    def encode_queries(texts: list[str]) -> list[list[float]]:
        raise RuntimeError("CUDA를 찾지 못했다")

    monkeypatch.setattr(embedding, "encode_queries", encode_queries)

    with pytest.raises(EmbeddingError, match="RuntimeError"):
        SharedEmbedder()


def test_encode_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """인코더_인코딩이실패하면_요청문없이EmbeddingError다"""
    embedder_ready = iter([True])

    def encode_queries(texts: list[str]) -> list[list[float]]:
        if next(embedder_ready, False):
            return [[1.0]]
        raise RuntimeError("메모리 부족")

    monkeypatch.setattr(embedding, "encode_queries", encode_queries)
    embedder = SharedEmbedder()

    with pytest.raises(EmbeddingError) as error:
        embedder.encode_query("조용한 카페")

    assert "조용한 카페" not in str(error.value)
