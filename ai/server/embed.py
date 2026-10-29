"""임베딩 Modal 앱. docs/infra/design.md 12.3절의 `POST /embed`.

ai/에서 `uv run modal deploy --env fit-dev -m server.embed`로 배포한다. 환경은 Modal Environment로 나눈다(design 11.2절).
BE는 `Modal-Key`·`Modal-Secret` 헤더로 `<URL>/embed`를 호출한다.
"""

from typing import Annotated, Literal

import modal
from fastapi import FastAPI, Response
from pydantic import BaseModel, Field

from fit_ai import embedding

MAX_TEXTS = 64
MAX_CHARS = 2000
MODEL_VERSION = f"{embedding.MODEL_ID}@{embedding.REVISION}"


class EmbedRequest(BaseModel):
    texts: Annotated[
        list[Annotated[str, Field(max_length=MAX_CHARS)]],
        Field(min_length=1, max_length=MAX_TEXTS),
    ]
    kind: Literal["query", "passage"]


def create_api() -> FastAPI:
    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @api.post("/embed")
    def embed(req: EmbedRequest, response: Response):
        encode = (
            embedding.encode_queries
            if req.kind == "query"
            else embedding.encode_documents
        )
        vectors = encode(req.texts)
        response.headers["X-Model-Version"] = MODEL_VERSION
        return {"model": MODEL_VERSION, "dim": len(vectors[0]), "vectors": vectors}

    return api


image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_sync(groups=["server"], extras=["cu128"], extra_options="--no-dev")
    # 가중치를 이미지에 넣어 콜드 스타트마다 내려받지 않는다. 리비전은 embedding.REVISION에 고정돼 있다
    .run_commands(
        "python -c 'from huggingface_hub import snapshot_download; "
        f'snapshot_download("{embedding.MODEL_ID}", revision="{embedding.REVISION}")\''
    )
    .env({"HF_HUB_OFFLINE": "1"})
    .add_local_python_source("fit_ai", "server")
)
app = modal.App("fit-embed", image=image)


# ponytail: 컨테이너 상한 2·상시 가동 0이 서버 쪽 비용 방어 전부다. 비용 상한이 정해지면 조정한다(design 12.2절 3·4)
# L4가 모자라면 수 분씩 배정을 기다린다(2026-10-29 fit-dev에서 150초 넘게 대기). 앞에서부터 남는 GPU를 쓴다
@app.cls(gpu=["L4", "A10", "T4"], max_containers=2)
class Embedder:
    @modal.enter()
    def load(self):
        embedding._model()

    @modal.asgi_app(requires_proxy_auth=True)
    def api(self):
        return create_api()
