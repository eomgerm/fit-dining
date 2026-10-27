"""AI API(FastAPI). BE가 Modal 위의 이 앱을 검색마다 한 번 부른다.

검색 자체(요청 해석부터 카드 만들기까지)는 `fit_ai.match.search`가 한다. 앱은 요청을
검사해 검색에 넘기고, 결과를 응답 모양과 폴백 코드로 바꾸고, 로그를 남긴다. 앱은 장소
데이터를 들고 있지 않고 검색마다 DB 뷰에서 읽는다. BE 요구(검색 spec의 카드 계약, BE 컨벤션의
ProblemDetail)와 인프라 요구를 맞춘다. 인프라 요구는 design.md 12.2의 모델 버전·
로그·서버 쪽 방어, 12.1 BE 계약 #17의 폴백 표시, contracts/metrics.md의 폴백
지표다. 명세는 docs/comparison/api.md에 있다.
"""

import json
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from fit_ai import embedding, gms
from fit_ai.match.candidates import MapBounds, PlaceStore, StoreError
from fit_ai.match.cards import Card
from fit_ai.match.interpretation import Conditions
from fit_ai.match.search import (
    EmbeddingError,
    Fallback,
    SearchRequest,
    SearchResult,
    search,
)
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
        gms_client: GMS 연결을 다시 쓰는 HTTP 클라이언트. 없으면 부를 때마다 만든다.
        max_concurrent: 컨테이너 하나가 동시에 처리하는 요청 수 상한
    """

    embedding_ready: bool
    store: PlaceStore | None
    gms_timeout: float = 5.0
    gms_client: httpx.Client | None = None
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
        if e.status_code == HTTPStatus.BAD_REQUEST:
            # 본문을 JSON으로 읽지 못한 경우(깨진 UTF-8 등)도 형식 오류다.
            return _problem(400, "INVALID_REQUEST", "요청 형식이 올바르지 않다")
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
        counts = deps.store.vector_counts()
    except StoreError as e:
        _log("store_failed", error=str(e))
        return _problem(503, "PLACES_UNAVAILABLE", "장소 저장소를 읽지 못했다")
    if counts.mismatched and not counts.comparable:
        # 모델이나 버전이 다른 벡터끼리는 비교할 수 없다(인프라 설계 12.2-7).
        return _problem(
            503,
            "MODEL_MISMATCH",
            f"장소 {counts.mismatched}곳 모두 벡터가 요청문 인코더와 맞지 않는다",
        )
    if counts.mismatched:
        # 프로필이 아직 없는 새 장소처럼 일부만 빠지면 검색은 되므로 경고만 남긴다.
        _log("places_mismatched", count=counts.mismatched)
    return JSONResponse({"status": "ok"})


def _search(deps: Dependencies, body: SearchBody) -> JSONResponse:
    if not deps.embedding_ready:
        return _problem(
            503, "EMBEDDING_UNAVAILABLE", "요청문 인코더가 아직 준비되지 않았다"
        )
    if deps.store is None:
        return _problem(503, "PLACES_UNAVAILABLE", "장소 저장소가 설정되지 않았다")

    previous = None
    if body.previous_conditions is not None:
        previous = _read_previous(body.previous_conditions)
    taste = _read_taste(body.taste_profile)
    request = SearchRequest(body.query, previous, taste, _bounds(body.map_bounds))
    try:
        result = search(
            request, deps.store, timeout=deps.gms_timeout, client=deps.gms_client
        )
    except EmbeddingError as e:
        _log("embedding_failed", error=str(e))
        return _problem(503, "EMBEDDING_UNAVAILABLE", "요청문을 벡터로 바꾸지 못했다")
    except StoreError as e:
        _log("store_failed", error=str(e))
        return _problem(503, "PLACES_UNAVAILABLE", "장소 저장소를 읽지 못했다")
    if result.invalid_place_ids:
        _log("profile_invalid", place_ids=list(result.invalid_place_ids))

    interpretation, trace = result.interpretation, result.trace
    conditions = interpretation.conditions
    fallbacks = _fallbacks(body, previous, taste, result)
    ranked_by = _ranked_by(result)
    used_llm = interpretation.llm_error is None or ranked_by == "LLM"
    reason = result.empty_reason
    response = SearchResponse(
        conditions=_conditions_body(conditions),
        nearby=conditions.nearby,
        change_summary=interpretation.change_summary,
        items=[_card_body(card) for card in result.cards],
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
        in_map_bounds=request.bounds is not None,
        candidates=trace.candidates,
        items=len(result.cards),
        ranked_by=ranked_by,
        fallbacks=fallbacks,
        interpret_llm_error=interpretation.llm_error,
        interpret_llm_seconds=interpretation.llm_seconds,
        embed_seconds=trace.embed_seconds,
        store_seconds=trace.store_seconds,
        rank_llm_error=trace.rank_llm_error,
        rank_llm_seconds=trace.rank_llm_seconds,
        # 검사를 통과한 LLM 응답에는 후보 번호와 등급만 있다. 실패한 응답은 요청문을
        # 되풀이했을 수 있어 길이만 남긴다(인프라 설계 12.2-5).
        rank_llm_raw=trace.rank_llm_raw if ranked_by == "LLM" else None,
        rank_llm_raw_length=(
            len(trace.rank_llm_raw) if trace.rank_llm_raw is not None else None
        ),
    )
    return JSONResponse(response.model_dump(by_alias=True, exclude_none=True))


def _fallbacks(
    body: SearchBody,
    previous: Conditions | None,
    taste: TasteProfile | None,
    result: SearchResult,
) -> list[str]:
    """응답에 담을 폴백 코드. 읽지 못한 입력, 실패한 LLM, 빠진 장소를 이 순서로 담는다."""
    happened = {
        "PREVIOUS_INVALID": body.previous_conditions is not None and previous is None,
        "INTERPRET_LLM_FAILED": result.interpretation.llm_error is not None,
        "TASTE_INVALID": body.taste_profile is not None and taste is None,
        "PROFILE_INVALID": bool(result.invalid_place_ids),
        "RANK_LLM_FAILED": result.trace.fallback is Fallback.LLM_FAILED,
    }
    return [code for code, yes in happened.items() if yes]


def _ranked_by(result: SearchResult) -> str | None:
    """정렬 방법. 뽑힌 장소가 없어 정렬하지 않았으면 None이다."""
    if result.empty_reason is not None:
        return None
    return "LLM" if result.trace.fallback is None else "SIMILARITY"


def _read_previous(data: dict[str, Any]) -> Conditions | None:
    """FE가 돌려보낸 이전 조건을 읽는다. 읽지 못하면 None이다."""
    try:
        return _conditions(ConditionsBody.model_validate(data))
    except ValidationError:
        _log("previous_invalid")
        return None


def _bounds(body: MapBoundsBody | None) -> MapBounds | None:
    """지도 영역을 읽는다. 값이 하나도 없으면 영역이 없는 것으로 본다.

    BE는 지도 영역을 검증하지 않고 넘기므로 `{}`가 올 수 있다. 이를 영역으로 보면 역
    필터가 빠져 모든 역의 장소가 나온다.
    """
    if body is None:
        return None
    bounds = MapBounds(body.sw_lat, body.sw_lng, body.ne_lat, body.ne_lng)
    return None if bounds == MapBounds() else bounds


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
