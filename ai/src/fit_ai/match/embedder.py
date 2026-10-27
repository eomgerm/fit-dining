"""요청문을 벡터로 바꾼다. API는 `QueryEmbedder`만 보고 테스트는 가짜를 쓴다.

실제 인코딩은 공유 모듈 `fit_ai.embedding`(arctic-ko, 질의 쪽은 `query: ` 붙임)이 한다.
40이 장소 요약을 같은 모듈의 문서 쪽 함수로 인코딩하므로 모델과 리비전이 같다.
"""

from dataclasses import dataclass
from typing import Protocol

from fit_ai import embedding


@dataclass(frozen=True)
class Embedding:
    """문장 하나의 벡터. 모델과 버전이 같은 벡터끼리만 비교한다.

    Attributes:
        model: 임베딩 모델 이름
        revision: 모델 버전(커밋 해시)
        vector: 벡터
    """

    model: str
    revision: str
    vector: tuple[float, ...]


class EmbeddingError(Exception):
    """요청문을 벡터로 바꾸지 못했다. 모델 로드 실패, 시간 초과 등이다.

    메시지는 로그에 남으므로 요청문을 넣지 않는다(인프라 설계 12.2-5).
    """


class QueryEmbedder(Protocol):
    """요청문을 질의 쪽 벡터로 바꾼다.

    Attributes:
        model: 임베딩 모델 이름. 장소 프로필 벡터의 모델과 같아야 한다.
        revision: 모델 버전(커밋 해시). 장소 프로필 벡터의 버전과 같아야 한다.
    """

    model: str
    revision: str

    def encode_query(self, text: str) -> Embedding:
        """요청문 하나를 질의 쪽(`query: ` 붙임)으로 인코딩한다.

        Args:
            text: 요청문

        Returns:
            요청문 벡터

        Raises:
            EmbeddingError: 인코딩하지 못했을 때
        """
        ...


class SharedEmbedder:
    """공유 모듈 `fit_ai.embedding`으로 요청문을 인코딩한다.

    공유 모듈은 처음 부를 때 모델을 올린다. 첫 검색이 모델 로드를 기다리지 않도록
    만들 때 한 번 인코딩해 미리 올린다. GPU는 `CUDA_VISIBLE_DEVICES`로 고른다.

    Attributes:
        model: 임베딩 모델 이름
        revision: 모델 버전(커밋 해시)
    """

    model = embedding.MODEL_ID
    revision = embedding.REVISION

    def __init__(self) -> None:
        """모델을 내려받아 메모리에 올린다. 처음에는 2GB 남짓을 내려받는다.

        Raises:
            EmbeddingError: 모델을 불러오지 못했을 때
        """
        try:
            embedding.encode_queries(["준비"])
        except Exception as e:  # 내려받기·로드 실패의 종류가 많다.
            raise EmbeddingError(f"모델을 불러오지 못했다: {type(e).__name__}") from e

    def encode_query(self, text: str) -> Embedding:
        """요청문 하나를 질의 쪽(`query: ` 붙임)으로 인코딩한다.

        Args:
            text: 요청문

        Returns:
            요청문 벡터

        Raises:
            EmbeddingError: 인코딩하지 못했을 때
        """
        try:
            [vector] = embedding.encode_queries([text])
        except Exception as e:  # torch 오류의 종류가 많다.
            raise EmbeddingError(f"인코딩하지 못했다: {type(e).__name__}") from e
        return Embedding(self.model, self.revision, tuple(vector))
