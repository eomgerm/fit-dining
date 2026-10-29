"""AI API(FastAPI). BE가 부른다.

앱은 공통 오류 처리와 `/healthz`만 맡는다. 기능별 엔드포인트는 `server/<기능>.py`의
`router(deps)`가 만들고, 새 기능은 라우터 파일을 만든 뒤 `create_app`에 한 줄 더한다.
BE가 분기할 오류는 `HTTPException`이 아니라 `server.common.problem()`을 돌려줘서 낸다.
`HTTPException`은 `HTTP_ERROR`로 바뀌고 detail이 사라진다.
"""

from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from server import direct_input, search
from server.common import Dependencies, log, problem


def create_app(deps: Dependencies) -> FastAPI:
    """AI API 앱을 만든다.

    Args:
        deps: 바깥 의존성

    Returns:
        FastAPI 앱. `GET /healthz`와 기능별 엔드포인트가 있다.
    """
    app = FastAPI(title="Fit Dining AI", version="0.3.0")

    @app.exception_handler(RequestValidationError)
    async def _invalid_request(_: Request, __: RequestValidationError) -> JSONResponse:
        # 요청 내용은 개인정보일 수 있어 응답과 로그에 되돌려 쓰지 않는다.
        return problem(400, "INVALID_REQUEST", "요청 형식이 올바르지 않다")

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, e: StarletteHTTPException) -> JSONResponse:
        if e.status_code == HTTPStatus.BAD_REQUEST:
            # 본문을 JSON으로 읽지 못한 경우(깨진 UTF-8 등)도 형식 오류다.
            return problem(400, "INVALID_REQUEST", "요청 형식이 올바르지 않다")
        return problem(e.status_code, "HTTP_ERROR", "요청을 처리할 수 없다")

    # exception_handler(Exception)는 응답 뒤 예외를 다시 던져 uvicorn이 메시지째
    # traceback을 남긴다. 메시지에 입력이 섞일 수 있어(pydantic 검사 오류 등) 여기서 끝낸다.
    @app.middleware("http")
    async def _unexpected(request: Request, call_next):
        try:
            return await call_next(request)
        except Exception as e:  # noqa: BLE001
            log("error", error=type(e).__name__)
            return problem(500, "INTERNAL_ERROR", "AI 서비스 내부 오류다")

    @app.get("/healthz")
    def healthz() -> JSONResponse:
        # 지금은 검색만 준비 상태가 있다. 검색이 준비되지 않았으면 앱 전체가 503이다.
        not_ready = search.health(deps)
        return not_ready if not_ready is not None else JSONResponse({"status": "ok"})

    app.include_router(search.router(deps))
    app.include_router(direct_input.router(deps))
    return app
