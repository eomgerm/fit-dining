"""arctic-ko 임베딩. 질의와 문서는 인코딩이 달라서 함수를 나눈다(spec 5단계)."""

from functools import cache

import numpy as np

MODEL_ID = "dragonkue/snowflake-arctic-embed-l-v2.0-ko"
REVISION = "55ec6e9358a56d56af759bc8372e970caf8c305f"
QUERY_PREFIX = "query: "


@cache
def _model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(MODEL_ID, revision=REVISION)


def _encode(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    vecs = np.asarray(_model().encode(texts), dtype=np.float64)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    return np.round(vecs, 6).tolist()


def encode_queries(texts: list[str]) -> list[list[float]]:
    """검색하는 쪽 문장(요청문, 취향 문구). 앞에 `query: `를 붙인다."""
    return _encode([QUERY_PREFIX + t for t in texts])


def encode_documents(texts: list[str]) -> list[list[float]]:
    """검색 대상 글(장소 요약, 페르소나). 아무것도 붙이지 않는다."""
    return _encode(texts)
