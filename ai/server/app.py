"""AI API(FastAPI). BE가 Modal 위의 이 앱을 검색마다 한 번 부른다.

검색 한 번에 요청 해석, 요청문 인코딩, 거르기와 후보 뽑기(Postgres + pgvector),
LLMRank 정렬, 카드 만들기를 차례로 한다. 앱은 장소 데이터를 들고 있지 않고
검색마다 DB 뷰에서 읽는다. BE 요구(검색 spec의 카드 계약, BE 컨벤션의
ProblemDetail)와 인프라 요구를 맞춘다. 인프라 요구는 design.md 12.2의 모델 버전·
로그·서버 쪽 방어, 12.1 BE 계약 #17의 폴백 표시, contracts/metrics.md의 폴백
지표다. 명세는 docs/comparison/api.md에 있다.
"""

import json
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from fit_ai import embedding, gms
from fit_ai.match.candidates import (
    GENERAL_K,
    NEARBY_K,
    MapBounds,
    PlaceFilter,
    PlaceStore,
    StoreError,
)
from fit_ai.match.interpretation import Conditions, empty_reason, interpret
from fit_ai.match.models import Card
from fit_ai.match.search import Fallback, SearchRequest, search
from fit_ai.match.taste import TasteProfile
from server.schemas import (
    CardBody,
    ConditionsBody,
    EmptyReasonBody,
    MapBoundsBody,
    ModelsBody,
    ProblemBody,
    ReasonBody,
    ReasonTagBody,
    ScoreItemBody,
    SearchBody,
    SearchResponse,
)

logger = logging.getLogger("server")

MAX_TASTE_FEATURES = 50
"""취향 프로필의 취향 수 상한. 넘으면 읽지 않는다(요청당 비용 상한)."""

MAX_TASTE_FREE_TEXTS = 20
"""취향 프로필의 취향 문장 수 상한. 넘으면 읽지 않는다(요청당 비용 상한)."""


@dataclass(frozen=True)
class Dependencies:
    """앱이 쓰는 바깥 의존성. 서비스 시작 때 한 번 만든다.

    요청문 인코딩과 GMS 호출은 공유 모듈 `fit_ai.embedding`, `fit_ai.gms`를 바로 부른다.

    Attributes:
        embedding_ready: 요청문 인코더 모델을 올렸는지. 못 올렸으면 검색이 503이다.
        store: 장소 저장소. 접속 주소가 없으면 None이다.
        gms_timeout: GMS 한 번 부를 때 기다리는 시간(초)
        max_concurrent: 컨테이너 하나가 동시에 처리하는 요청 수 상한
    """

    embedding_ready: bool
    store: PlaceStore | None
    gms_timeout: float = 5.0
    max_concurrent: int = 8


def create_app(deps: Dependencies) -> FastAPI:
    """AI API 앱을 만든다.

    Args:
        deps: 바깥 의존성

    Returns:
        FastAPI 앱. `GET /healthz`와 `POST /v1/search`가 있다.
    """
    app = FastAPI(title="Fit Dining AI", version="0.3.0")
    if not deps.embedding_ready:
        _log("not_ready", reason="EMBEDDING_UNAVAILABLE")
    if deps.store is None:
        _log("not_ready", reason="PLACES_UNAVAILABLE")
    slots = threading.BoundedSemaphore(deps.max_concurrent)

    def limited(handle: Callable[[], JSONResponse]) -> JSONResponse:
        if not slots.acquire(blocking=False):
            return _problem(
                503, "BUSY", "요청이 많다. 잠시 뒤 다시 시도한다", {"Retry-After": "1"}
            )
        try:
            return handle()
        finally:
            slots.release()

    @app.exception_handler(RequestValidationError)
    async def _invalid_request(_: Request, __: RequestValidationError) -> JSONResponse:
        # 요청 내용은 개인정보일 수 있어 응답과 로그에 되돌려 쓰지 않는다.
        return _problem(400, "INVALID_REQUEST", "요청 형식이 올바르지 않다")

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, e: StarletteHTTPException) -> JSONResponse:
        return _problem(e.status_code, "HTTP_ERROR", "요청을 처리할 수 없다")

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, e: Exception) -> JSONResponse:
        _log("error", error=type(e).__name__)
        return _problem(500, "INTERNAL_ERROR", "AI 서비스 내부 오류다")

    @app.get("/healthz")
    def healthz() -> JSONResponse:
        return _health(deps)

    @app.post(
        "/v1/search", response_model=SearchResponse, response_model_exclude_none=True
    )
    def search_request(body: SearchBody) -> JSONResponse:
        return limited(lambda: _search(deps, body))

    return app


def _health(deps: Dependencies) -> JSONResponse:
    if not deps.embedding_ready:
        return _problem(
            503, "EMBEDDING_UNAVAILABLE", "요청문 인코더가 아직 준비되지 않았다"
        )
    if deps.store is None:
        return _problem(503, "PLACES_UNAVAILABLE", "장소 저장소가 설정되지 않았다")
    try:
        mismatched = deps.store.mismatched()
    except StoreError as e:
        _log("store_failed", error=str(e))
        return _problem(503, "PLACES_UNAVAILABLE", "장소 저장소를 읽지 못했다")
    if mismatched:
        # 모델이나 버전이 다른 벡터끼리는 비교할 수 없다(인프라 설계 12.2-7).
        return _problem(
            503,
            "MODEL_MISMATCH",
            f"장소 {mismatched}곳의 벡터가 요청문 인코더와 맞지 않아 검색에서 빠진다",
        )
    return JSONResponse({"status": "ok"})


def _search(deps: Dependencies, body: SearchBody) -> JSONResponse:
    if not deps.embedding_ready:
        return _problem(
            503, "EMBEDDING_UNAVAILABLE", "요청문 인코더가 아직 준비되지 않았다"
        )
    if deps.store is None:
        return _problem(503, "PLACES_UNAVAILABLE", "장소 저장소가 설정되지 않았다")

    fallbacks: list[str] = []
    previous = None
    if body.previous_conditions is not None:
        previous = _read_previous(body.previous_conditions)
        if previous is None:
            fallbacks.append("PREVIOUS_INVALID")
    interpretation = interpret(body.query, previous, deps.gms_timeout)
    if interpretation.llm_error is not None:
        fallbacks.append("INTERPRET_LLM_FAILED")
    conditions = interpretation.conditions
    taste = _read_taste(body.taste_profile)
    if body.taste_profile is not None and taste is None:
        fallbacks.append("TASTE_INVALID")

    start = time.perf_counter()
    try:
        [query] = embedding.encode_queries([conditions.embedding_text])
    except (RuntimeError, OSError, ValueError) as e:
        # torch(CUDA 메모리 부족 등)와 모델 파일 오류다. 요청문은 남기지 않는다.
        _log("embedding_failed", error=type(e).__name__)
        return _problem(503, "EMBEDDING_UNAVAILABLE", "요청문을 벡터로 바꾸지 못했다")
    embed_seconds = time.perf_counter() - start

    bounds = _bounds(body.map_bounds)
    place_filter = PlaceFilter(
        category_group=conditions.category_group,
        # 지도 영역이 있으면 좌표로 거르고, 근처 검색은 폰이 현재 위치로 거른다.
        station=None if bounds or conditions.nearby else conditions.station,
        bounds=bounds,
        facilities=conditions.facilities,
    )
    start = time.perf_counter()
    try:
        found = deps.store.find(
            place_filter, query, NEARBY_K if conditions.nearby else GENERAL_K
        )
    except StoreError as e:
        _log("store_failed", error=str(e))
        return _problem(503, "PLACES_UNAVAILABLE", "장소 저장소를 읽지 못했다")
    store_seconds = time.perf_counter() - start
    if found.invalid:
        _log("profile_invalid", place_ids=list(found.invalid))
        fallbacks.append("PROFILE_INVALID")

    if found.candidates:
        result = search(
            found.candidates,
            SearchRequest(
                text=conditions.text,
                request_codes=conditions.codes,
                nearby=conditions.nearby,
                taste=taste,
            ),
            timeout=deps.gms_timeout,
        )
        trace = result.trace
        if trace.fallback is Fallback.LLM_FAILED:
            fallbacks.append("RANK_LLM_FAILED")
        ranked_by = "LLM" if trace.fallback is None else "SIMILARITY"
        items = [_card_body(card) for card in result.cards]
        reason = None
    else:
        trace = None
        ranked_by = None
        items = []
        reason = empty_reason(conditions, bounds is not None)

    used_llm = interpretation.llm_error is None or ranked_by == "LLM"
    response = SearchResponse(
        conditions=_conditions_body(conditions),
        nearby=conditions.nearby,
        change_summary=interpretation.change_summary,
        items=items,
        empty_reason=(
            EmptyReasonBody(cause=reason.cause, suggestion=reason.suggestion)
            if reason
            else None
        ),
        interpreted_by="RULE" if interpretation.llm_error else "LLM",
        ranked_by=ranked_by,
        fallbacks=fallbacks,
        models=ModelsBody(
            embedding=f"{embedding.MODEL_ID}@{embedding.REVISION}",
            llm=gms.MODEL if used_llm else None,
        ),
    )
    _log(
        "search",
        interpreted_by=response.interpreted_by,
        follow_up=previous is not None,
        # 코드와 업종·역은 요청문을 되살릴 수 없는 거친 값이라 남긴다.
        codes=list(conditions.codes),
        category_group=conditions.category_group,
        station=conditions.station,
        nearby=conditions.nearby,
        in_map_bounds=bounds is not None,
        candidates=len(found.candidates),
        items=len(items),
        ranked_by=ranked_by,
        fallbacks=fallbacks,
        interpret_llm_error=interpretation.llm_error,
        interpret_llm_seconds=interpretation.llm_seconds,
        embed_seconds=embed_seconds,
        store_seconds=store_seconds,
        rank_llm_error=trace.llm_error if trace else None,
        rank_llm_seconds=trace.llm_seconds if trace else None,
        # 검사를 통과한 LLM 응답에는 후보 번호와 등급만 있다. 실패한 응답은 요청문을
        # 되풀이했을 수 있어 길이만 남긴다(인프라 설계 12.2-5).
        rank_llm_raw=trace.llm_raw if trace and ranked_by == "LLM" else None,
        rank_llm_raw_length=(
            len(trace.llm_raw) if trace and trace.llm_raw is not None else None
        ),
    )
    return JSONResponse(response.model_dump(by_alias=True, exclude_none=True))


def _read_previous(data: dict[str, Any]) -> Conditions | None:
    """FE가 돌려보낸 이전 조건을 읽는다. 읽지 못하면 None이다."""
    try:
        return _conditions(ConditionsBody.model_validate(data))
    except ValidationError:
        _log("previous_invalid")
        return None


def _bounds(body: MapBoundsBody | None) -> MapBounds | None:
    if body is None:
        return None
    return MapBounds(body.sw_lat, body.sw_lng, body.ne_lat, body.ne_lng)


def _conditions(body: ConditionsBody) -> Conditions:
    return Conditions(
        text=body.text,
        embedding_text=body.embedding_text,
        codes=tuple(body.codes),
        category_group=body.category_group,
        station=body.station,
        nearby=body.nearby,
    )


def _conditions_body(conditions: Conditions) -> ConditionsBody:
    return ConditionsBody(
        text=conditions.text,
        embedding_text=conditions.embedding_text,
        codes=list(conditions.codes),
        category_group=conditions.category_group,
        station=conditions.station,
        nearby=conditions.nearby,
    )


def _read_taste(data: dict[str, Any] | None) -> TasteProfile | None:
    """취향 프로필을 읽는다. 읽지 못하면 None이다. 취향은 보조라 검색은 막지 않는다."""
    if data is None:
        return None
    try:
        profile = TasteProfile.from_dict(data)
    except (ValueError, KeyError, TypeError, AttributeError) as e:
        _log("taste_invalid", error=type(e).__name__)
        return None
    if (
        len(profile.features) > MAX_TASTE_FEATURES
        or len(profile.free_texts) > MAX_TASTE_FREE_TEXTS
    ):
        _log("taste_invalid", error="too_large")
        return None
    return profile


def _card_body(card: Card) -> CardBody:
    return CardBody(
        place_id=card.place_id,
        score=card.score,
        labels=list(card.labels),
        reasons=[
            ReasonBody(
                title=reason.title,
                tags=[
                    ReasonTagBody(source=t.source.value, label=t.label)
                    for t in reason.tags
                ],
                quote=reason.quote,
                quote_source=reason.quote_source,
            )
            for reason in card.reasons
        ],
        score_items=[
            ScoreItemBody(
                source=item.source.value,
                label=item.label,
                matched=item.matched,
                evidence_count=item.evidence_count,
            )
            for item in card.score_items
        ],
        caution=card.caution,
    )


def _problem(
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


def _log(event: str, **fields: Any) -> None:
    """JSON 한 줄로 남긴다. 요청문과 취향 내용은 넣지 않는다(인프라 설계 12.2-5)."""
    logger.info(json.dumps({"event": event, **fields}, ensure_ascii=False))
