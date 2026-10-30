"""검색 API(`POST /v1/search`). BE가 검색마다 한 번 부른다.

검색 자체(요청 해석부터 카드 만들기까지)는 `fit_ai.match.search`가 한다. 여기서는 요청을
검사해 검색에 넘기고, 결과를 응답 모양과 폴백 코드로 바꾸고, 로그를 남긴다. 장소
데이터를 들고 있지 않고 검색마다 장소 저장소(DB나 장소 파일)에서 읽는다. BE 요구(검색
spec의 카드 계약, BE 컨벤션의 ProblemDetail)와 인프라 요구를 맞춘다. 인프라 요구는
design.md 12.2의 모델 버전·로그·서버 쪽 방어, 12.1 BE 계약 #17의 폴백 표시,
contracts/metrics.md의 폴백 지표다. 요청·응답 모양은 `server/schemas.py`, 명세는
docs/comparison/api.md에 있다.
"""

import threading
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from fit_ai import embedding, gms
from fit_ai.match.candidates import MapBounds, StoreError
from fit_ai.match.cards import Card
from fit_ai.match.interpretation import Conditions
from fit_ai.match.search import (
    EmbeddingError,
    Fallback,
    SearchRequest,
    SearchResult,
    search,
)
from fit_ai.match.taste_select import TasteProfile, TasteStore
from fit_ai.taste.profile import compute_features
from server.common import Dependencies, log, problem
from server.schemas import (
    CardBody,
    ConditionsBody,
    EmptyReasonBody,
    GuestChipBody,
    GuestTasteBody,
    MapBoundsBody,
    ModelsBody,
    ReasonBody,
    ReasonTagBody,
    ScoreItemBody,
    SearchBody,
    SearchResponse,
)
from server.taste_profile import to_rows

MAX_TASTE_FEATURES = 50
"""취향 프로필의 취향 수 상한. 넘으면 읽지 않는다(요청당 비용 상한)."""

MAX_TASTE_FREE_TEXTS = 20
"""취향 프로필의 취향 문장 수 상한. 넘으면 읽지 않는다(요청당 비용 상한)."""

GUEST_ID = ""
"""비회원 취향의 사용자 id. 취향 spec처럼 비운다. 검색은 이 값을 읽지 않는다."""


def router(deps: Dependencies) -> APIRouter:
    """검색 엔드포인트를 만든다.

    Args:
        deps: 바깥 의존성

    Returns:
        `POST /v1/search`가 있는 라우터
    """
    if not deps.embedding_ready:
        log("not_ready", reason="EMBEDDING_UNAVAILABLE")
    if deps.store is None:
        log("not_ready", reason="PLACES_UNAVAILABLE")
    slots = threading.BoundedSemaphore(deps.max_concurrent)

    def limited(handle: Callable[[], JSONResponse]) -> JSONResponse:
        if not slots.acquire(blocking=False):
            return problem(
                503, "BUSY", "요청이 많다. 잠시 뒤 다시 시도한다", {"Retry-After": "1"}
            )
        try:
            return handle()
        finally:
            slots.release()

    r = APIRouter()

    @r.post(
        "/v1/search", response_model=SearchResponse, response_model_exclude_none=True
    )
    def search_request(body: SearchBody) -> JSONResponse:
        return limited(lambda: _search(deps, body))

    return r


def health(deps: Dependencies) -> JSONResponse | None:
    """검색이 준비됐는지 본다. `/healthz`가 부른다.

    Returns:
        준비됐으면 None, 아니면 503 ProblemDetail
    """
    if not deps.embedding_ready:
        return problem(
            503, "EMBEDDING_UNAVAILABLE", "요청문 인코더가 아직 준비되지 않았다"
        )
    if deps.store is None:
        return problem(503, "PLACES_UNAVAILABLE", "장소 저장소가 설정되지 않았다")
    try:
        counts = deps.store.vector_counts()
    except StoreError as e:
        log("store_failed", error=str(e))
        return problem(503, "PLACES_UNAVAILABLE", "장소 저장소를 읽지 못했다")
    if counts.mismatched and not counts.comparable:
        # 모델이나 버전이 다른 벡터끼리는 비교할 수 없다(인프라 설계 12.2-7).
        return problem(
            503,
            "MODEL_MISMATCH",
            f"장소 {counts.mismatched}곳 모두 벡터가 요청문 인코더와 맞지 않는다",
        )
    if counts.mismatched:
        # 프로필이 아직 없는 새 장소처럼 일부만 빠지면 검색은 되므로 경고만 남긴다.
        log("places_mismatched", count=counts.mismatched)
    return None


def _search(deps: Dependencies, body: SearchBody) -> JSONResponse:
    if not deps.embedding_ready:
        return problem(
            503, "EMBEDDING_UNAVAILABLE", "요청문 인코더가 아직 준비되지 않았다"
        )
    if deps.store is None:
        return problem(503, "PLACES_UNAVAILABLE", "장소 저장소가 설정되지 않았다")

    previous = None
    if body.previous_conditions is not None:
        previous = _read_previous(body.previous_conditions)
    taste, taste_invalid = _resolve_taste(deps.taste_store, body)
    request = SearchRequest(body.query, previous, taste, _bounds(body.map_bounds))
    try:
        result = search(
            request, deps.store, timeout=deps.gms_timeout, client=deps.gms_client
        )
    except EmbeddingError as e:
        log("embedding_failed", error=str(e))
        return problem(503, "EMBEDDING_UNAVAILABLE", "요청문을 벡터로 바꾸지 못했다")
    except StoreError as e:
        log("store_failed", error=str(e))
        return problem(503, "PLACES_UNAVAILABLE", "장소 저장소를 읽지 못했다")
    if result.invalid_place_ids:
        log("profile_invalid", place_ids=list(result.invalid_place_ids))

    interpretation, trace = result.interpretation, result.trace
    conditions = interpretation.conditions
    fallbacks = _fallbacks(body, previous, taste_invalid, result)
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
    log(
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
    taste_invalid: bool,
    result: SearchResult,
) -> list[str]:
    """응답에 담을 폴백 코드. 읽지 못한 입력, 실패한 LLM, 빠진 장소를 이 순서로 담는다."""
    happened = {
        "PREVIOUS_INVALID": body.previous_conditions is not None and previous is None,
        "INTERPRET_LLM_FAILED": result.interpretation.llm_error is not None,
        "TASTE_INVALID": taste_invalid,
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
        log("previous_invalid")
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


def _resolve_taste(
    store: TasteStore | None, body: SearchBody
) -> tuple[TasteProfile | None, bool]:
    """이번 검색에 쓸 취향을 정한다. 취향은 보조라 읽지 못해도 검색은 막지 않는다.

    회원 id가 있으면 취향 저장소에서 꺼내고, 없으면 요청에 실린 취향 프로필(비회원)을
    읽는다. 둘 다 오면 회원 id를 따른다(docs/comparison/spec.md 2장).

    Returns:
        (취향, 읽지 못했는지). 저장소에 그 회원의 취향이 없으면 읽지 못한 게 아니라
        취향이 없는 것이라 (None, False)다.
    """
    if body.user_id is not None:
        profile, invalid = _stored_taste(store, body.user_id)
    elif body.taste_profile is not None:
        profile, invalid = _sent_taste(body.taste_profile)
    else:
        return None, False
    if profile is not None and (
        len(profile.features) > MAX_TASTE_FEATURES
        or len(profile.free_texts) > MAX_TASTE_FREE_TEXTS
    ):
        log("taste_invalid", error="too_large")
        return None, True
    return profile, invalid


def _stored_taste(
    store: TasteStore | None, user_id: str
) -> tuple[TasteProfile | None, bool]:
    """회원 취향을 저장소에서 꺼낸다. 저장소가 없거나 읽지 못하면 읽지 못한 것이다."""
    if store is None:
        log("taste_invalid", error="NO_TASTE_STORE")
        return None, True
    try:
        return store.find(user_id), False
    except StoreError as e:
        log("taste_store_failed", error=str(e))
    except (ValueError, KeyError, TypeError, AttributeError) as e:
        log("taste_invalid", error=type(e).__name__)
    return None, True


def _sent_taste(data: dict[str, Any]) -> tuple[TasteProfile | None, bool]:
    """요청에 실린 비회원 취향(기기가 저장한 온보딩 답)을 읽는다.

    회원은 가입 때 BE가 취향 프로필 계산 API로 `features`를 저장해 두지만 비회원은
    없다. 그래서 같은 계산(`server.taste_profile.to_rows`, `compute_features`)으로
    `features`를 만들고 회원과 같은 `TasteProfile.from_stored`로 읽는다.
    """
    try:
        body = GuestTasteBody.model_validate(data)
        features = compute_features(to_rows(body))
        chips = [_stored_chip(chip) for chip in body.tastes]
        return TasteProfile.from_stored(GUEST_ID, features, chips), False
    # ValidationError는 ValueError의 하위 타입이라 먼저 잡는다.
    except ValidationError:
        log("taste_invalid", error="INVALID_SHAPE")
    except (ValueError, KeyError, TypeError, AttributeError) as e:
        log("taste_invalid", error=type(e).__name__)
    return None, True


def _stored_chip(chip: GuestChipBody) -> dict[str, Any]:
    """비회원 칩을 회원 행의 칩 모양으로 바꾼다.

    벡터는 회원 행처럼 코드 없는 좋아함 칩에만 남긴다(저장 설계 V6). 다른 칩의 벡터를
    남기면 시설이나 싫어하는 문장이 정렬에 들어간다.
    """
    keep = chip.code is None and chip.polarity == "LIKE"
    return {
        "polarity": chip.polarity,
        "label": chip.label,
        "code": chip.code,
        "vector": chip.vector if keep else None,
    }


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
