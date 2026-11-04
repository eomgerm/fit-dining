"""취향 칩 벡터 API. BE가 가입 때 코드 없는 LIKE 칩의 문장을 한 번 보내 `tastes[].vector`로 저장한다.

질의 인코딩(`query: `)이다. 저장 형식은 docs/specs/profile-storage/spec.md `user_preferences.tastes`에 있다.
입력은 칩 상한(10개, 20자)으로 막아 범용 임베딩 프록시가 되지 않게 한다.
"""

from typing import Annotated

from fastapi import APIRouter
from pydantic import Field, StringConstraints

from fit_ai import embedding
from fit_ai.taste.direct_input import MAX_LABEL
from server.common import Body, Dependencies, log, problem

MAX_CHIPS = 10  # BE `Preferences.tastes` 상한

Label = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_LABEL)
]


class VectorsBody(Body):
    texts: list[Label] = Field(min_length=1, max_length=MAX_CHIPS)


class VectorsResponse(Body):
    """`vectors`는 `texts`와 같은 순서다. `model`은 `이름@리비전`이다."""

    model: str
    vectors: list[list[float]]


def router(deps: Dependencies) -> APIRouter:
    r = APIRouter()

    @r.post("/v1/taste/vectors", response_model=VectorsResponse)
    def vectors(body: VectorsBody):
        if not deps.embedding_ready:
            return problem(
                503, "EMBEDDING_UNAVAILABLE", "원격 임베딩 설정이 없거나 틀렸다"
            )
        try:
            result = embedding.encode_queries(body.texts)
        except embedding.EmbeddingUnavailable as e:
            # 메시지는 실패 종류뿐이다
            log("embedding_failed", error=str(e))
            return problem(503, "EMBEDDING_UNAVAILABLE", "취향을 벡터로 바꾸지 못했다")
        log("taste_vectors", count=len(result))
        return VectorsResponse(model=embedding.MODEL_VERSION, vectors=result)

    return r
