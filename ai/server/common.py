"""엔드포인트들이 함께 쓰는 의존성, 요청 바탕, 오류 응답, 로그."""

import json
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any

import httpx
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from fit_ai.match.candidates import PlaceStore
from fit_ai.match.taste_select import TasteStore

logger = logging.getLogger("server")


@dataclass(frozen=True)
class Dependencies:
    """앱이 쓰는 바깥 의존성. 서비스 시작 때 한 번 만든다.

    요청문 인코딩과 GMS 호출은 공유 모듈 `fit_ai.embedding`, `fit_ai.gms`를 바로 부른다.

    Attributes:
        embedding_ready: 원격 임베딩 설정(`EMBED_*`)이 맞는지. 틀리면 검색과 `/healthz`가
            503이다. Modal에 닿는지는 보지 않는다.
        store: 장소 저장소. DB 접속 주소와 장소 파일이 모두 없으면 None이다.
        gms_timeout: GMS 한 번 부를 때 기다리는 시간(초)
        gms_client: GMS 연결을 다시 쓰는 HTTP 클라이언트. 없으면 부를 때마다 만든다.
        max_concurrent: 컨테이너 하나가 동시에 처리하는 검색 수 상한
        taste_store: 회원 취향 저장소. DB 접속 주소가 없으면 None이다. 그때 회원 id로
            온 검색은 취향 없이 하고 `fallbacks`에 `TASTE_INVALID`를 담는다.
    """

    embedding_ready: bool = False
    store: PlaceStore | None = None
    gms_timeout: float = 5.0
    gms_client: httpx.Client | None = None
    max_concurrent: int = 8
    taste_store: TasteStore | None = None
    slots: "Slots | None" = None
    """검색과 모임 계산이 함께 쓰는 동시 처리 칸. 없으면 앱이 `max_concurrent`로 만든다."""


class Slots:
    """동시에 처리하는 요청 수 상한. 일반 검색과 모임 계산이 함께 쓴다(AI 컨테이너의 처리
    상한은 하나다). 칸이 없으면 기다리지 않고 503 `BUSY`를 돌려준다."""

    def __init__(self, size: int) -> None:
        self._slots = threading.BoundedSemaphore(size)

    def run(self, handle: Callable[[], JSONResponse]) -> JSONResponse:
        """칸이 있으면 요청을 처리하고, 없으면 503 `BUSY`다."""
        if not self._slots.acquire(blocking=False):
            return problem(
                503, "BUSY", "요청이 많다. 잠시 뒤 다시 시도한다", {"Retry-After": "1"}
            )
        try:
            return handle()
        finally:
            self._slots.release()


class Body(BaseModel):
    """요청·응답 바탕. JSON 이름은 BE와 같은 camelCase이고 요청의 모르는 속성은 거부한다."""

    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="forbid"
    )


class ProblemBody(BaseModel):
    """오류 응답(`application/problem+json`). BE 컨벤션의 ProblemDetail과 같은 모양이다.

    Attributes:
        type: 문제 종류 URI. 지금은 `about:blank`다.
        title: HTTP 상태 이름
        status: HTTP 상태 코드
        detail: 일반 문구. 요청 내용은 넣지 않는다.
        code: BE가 분기할 오류 코드
    """

    type: str = "about:blank"
    title: str
    status: int
    detail: str
    code: str


def problem(
    status: int, code: str, detail: str, headers: dict[str, str] | None = None
) -> JSONResponse:
    """BE 컨벤션의 ProblemDetail 모양으로 오류를 돌려준다."""
    body = ProblemBody(
        title=HTTPStatus(status).phrase, status=status, detail=detail, code=code
    )
    return JSONResponse(
        body.model_dump(),
        status_code=status,
        media_type="application/problem+json",
        headers=headers,
    )


def log(event: str, **fields: Any) -> None:
    """JSON 한 줄로 남긴다. 요청문과 취향 내용은 넣지 않는다(인프라 설계 12.2-5)."""
    logger.info(json.dumps({"event": event, **fields}, ensure_ascii=False))
