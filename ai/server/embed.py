"""임베딩 Modal 앱. docs/infra/design.md 12.3절의 `POST /embed`.

ai/에서 `uv run modal deploy --env fit-dev -m server.embed`로 배포한다. 환경은 Modal Environment로 나눈다(design 11.2절).
BE는 `Modal-Key`·`Modal-Secret` 헤더로 `<URL>/embed`를 호출한다.
"""

import threading
from typing import Annotated, Literal

import modal
from fastapi import FastAPI, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from fit_ai import embedding

MAX_TEXTS = 64
MAX_CHARS = 2000
MODEL_VERSION = embedding.MODEL_VERSION
WARMUP_TEXT = "워밍업"

# 한 컨테이너에 입력이 동시에 들어와도(@modal.concurrent) 모델과 토크나이저는 한 번에 하나씩만 쓴다.
# 동기 엔드포인트의 동시 입력은 별도 스레드에서 돌고, Hugging Face 빠른 토크나이저는 스레드 안전이 보장되지 않는다
_ENCODE_LOCK = threading.Lock()


def warm_up() -> None:
    """모델을 올리고 한 번 인코딩한다. 첫 encode의 CUDA 초기화(0.6~2.3초)가 사용자 요청에 얹히지 않게 한다."""
    embedding.encode_queries_locally([WARMUP_TEXT])


class EmbedRequest(BaseModel):
    texts: Annotated[
        list[Annotated[str, Field(max_length=MAX_CHARS)]],
        Field(min_length=1, max_length=MAX_TEXTS),
    ]
    kind: Literal["query", "passage"]


def create_api() -> FastAPI:
    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    # 기본 422 본문은 받은 값(input)을 되돌려 BE 로그에 요청 텍스트가 남을 수 있다(design 12.2절 5)
    @api.exception_handler(RequestValidationError)
    def reject(_, exc: RequestValidationError):
        errors = [{k: e[k] for k in ("loc", "msg", "type")} for e in exc.errors()]
        return JSONResponse({"detail": errors}, status_code=422)

    @api.post("/embed")
    def embed(req: EmbedRequest, response: Response):
        encode = (
            embedding.encode_queries_locally
            if req.kind == "query"
            else embedding.encode_documents
        )
        with _ENCODE_LOCK:
            vectors = encode(req.texts)
        response.headers["X-Model-Version"] = MODEL_VERSION
        return {"model": MODEL_VERSION, "dim": len(vectors[0]), "vectors": vectors}

    return api


image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_sync(
        groups=["server"],
        extras=["encoder", "cu128"],
        extra_options="--no-dev",
        uv_version="0.13.4",
    )
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
# 568M 모델은 T4로 충분하다(2026-10-29 T4·A10 실측 차이가 네트워크 잡음 안). 한 종류만 쓰면 재고가 없을 때
# 수 분씩 배정을 기다리므로(fit-dev에서 L4 150초 넘게 대기) 앞에서부터 남는 GPU를 쓴다
# scaledown_window: 요청 간격이 이보다 짧으면 GPU가 계속 켜져 있어 그 시간만큼 비용이 든다(기본 60초에서 콜드 스타트가
# fit-dev 요청 기준 16회에서 6회로 준다. 한도는 20분)
# concurrent: 콜드 스타트 중에 요청이 더 와도 부팅 중인 컨테이너가 받게 해서 컨테이너를 하나 더 띄우지 않는다
# 상시 가동(min_containers)은 여기 두지 않는다. server/warm.py가 서비스 시간(한국 09~21시)에만 1로 올린다
@app.cls(gpu=["T4", "L4", "A10"], max_containers=2, scaledown_window=600)
@modal.concurrent(max_inputs=4)
class Embedder:
    @modal.enter()
    def load(self):
        warm_up()

    @modal.method()
    def ping(self) -> str:
        """`server/warm.py`가 이 클래스의 오토스케일러를 조절할 때 붙잡는 손잡이다. 하는 일은 없다."""
        return "ok"

    @modal.asgi_app(requires_proxy_auth=True)
    def api(self):
        return create_api()
