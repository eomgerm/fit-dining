"""비교 검색 한 번. 요청 해석부터 카드 만들기까지 잇는다.

요청 해석 → 요청문 인코딩 → ① 후보 뽑기(장소 저장소) → ⓪ 취향 고르기 → ② 정렬 →
③ 카드 만들기 순서다. 뽑힌 장소가 없으면 정렬하지 않고 결과 없음 이유를 만든다. 근처
검색과 LLM 실패 때는 LLM 없이 같은 모양의 카드를 만든다(docs/comparison/spec.md 3장).
검색 한 번은 시간 예산(`SEARCH_BUDGET_SECONDS`) 안에서 끝내려고, 남은 시간이 모자라면
정렬 LLM을 부르지 않는다. HTTP 요청·응답 모양과 폴백 코드로 바꾸는 일은
API(`server/app.py`)가 한다.
"""

import random
import time
from collections.abc import Sequence
from dataclasses import dataclass, replace
from enum import StrEnum

import httpx

from fit_ai import embedding
from fit_ai.match.candidates import (
    GENERAL_K,
    NEARBY_K,
    Candidate,
    MapBounds,
    PlaceFilter,
    PlaceStore,
)
from fit_ai.match.cards import Card, build_card
from fit_ai.match.conditions import CATEGORY_NAMES, STATION_NAMES
from fit_ai.match.interpretation import Conditions, Interpretation, interpret
from fit_ai.match.ranking import RankingError, rank_by_similarity, rank_with_llm
from fit_ai.match.taste_select import TasteProfile, select_tastes

FACILITY_PHRASES = {
    "PARKING": ("주차할 수 있는", "주차"),
    "WIFI": ("와이파이가 되는", "와이파이"),
    "GROUP": ("단체로 갈 수 있는", "단체"),
    "RESERVATION": ("예약할 수 있는", "예약"),
}
"""결과가 없을 때 문구에 쓰는 시설 말. (원인 문구, 제안 문구)다."""

SEARCH_BUDGET_SECONDS = 9.0
"""검색 한 번의 시간 예산. BE 타임아웃(12초 제안) 안에 대신 처리한 결과라도 돌려주려고
둔다. 해석이 GMS를 기다리다 실패하면 10초까지 걸리고, 그때는 정렬 LLM을 부르지 않는다.
임시 값이다."""

MIN_RANK_WAIT_SECONDS = 1.5
"""정렬 LLM 한 번에 줄 수 있는 가장 짧은 대기 시간. 이보다 짧으면 부르지 않는다."""


class Fallback(StrEnum):
    """LLM 없이 정렬한 이유."""

    NEARBY = "NEARBY"
    """근처 검색. 정렬할 때 어느 장소가 반경 안에 남을지 모른다."""
    LLM_FAILED = "LLM_FAILED"
    """LLM 호출이 실패했거나, 출력이 형식에 맞지 않았거나, 시간 예산이 모자라 부르지
    않았다."""


class EmbeddingError(Exception):
    """요청문을 벡터로 바꾸지 못했다. torch 오류(CUDA 메모리 부족 등)나 모델 파일 오류다."""


@dataclass(frozen=True)
class SearchRequest:
    """검색 요청 하나.

    Attributes:
        query: 사용자가 이번에 입력한 요청문
        previous: 후속 조건이면 기준 요청의 조건. 새 검색이면 None이다.
        taste: 사용자 취향 프로필. 취향이 없거나 읽지 못했으면 None이다.
        bounds: 지도 영역("이 지역에서 검색"). 있으면 역 대신 좌표로 거른다.
    """

    query: str
    previous: Conditions | None = None
    taste: TasteProfile | None = None
    bounds: MapBounds | None = None


@dataclass(frozen=True)
class EmptyReason:
    """결과가 없을 때의 원인과 제안. BE `EmptyReason`과 같다.

    Attributes:
        cause: 원인
        suggestion: 수정 제안
    """

    cause: str
    suggestion: str


@dataclass(frozen=True)
class SearchTrace:
    """검색 한 번의 기록(docs/comparison/spec.md 5장).

    공개 전에 결과를 확인할 때와 나중에 라벨링할 때 쓴다. 요청 해석의 기록은
    `Interpretation`에 있다.

    Attributes:
        embed_seconds: 요청문 인코딩에 걸린 시간(초)
        store_seconds: 후보 뽑기에 걸린 시간(초)
        candidates: 뽑힌 후보 수
        fallback: LLM 없이 정렬한 이유. LLM 순서를 썼거나 후보가 없으면 None이다.
        rank_llm_error: LLM 정렬이 실패한 이유. 실패하지 않았으면 None이다.
        rank_llm_raw: 정렬 LLM 출력. 부르지 않았거나 호출이 실패했으면 None이다.
        rank_llm_seconds: 정렬 LLM 호출에 걸린 시간(초). 부르지 않았으면 None이다.
    """

    embed_seconds: float
    store_seconds: float
    candidates: int
    fallback: Fallback | None = None
    rank_llm_error: str | None = None
    rank_llm_raw: str | None = None
    rank_llm_seconds: float | None = None


@dataclass(frozen=True)
class SearchResult:
    """검색 결과.

    Attributes:
        interpretation: 요청 해석 결과
        cards: 카드 목록. 핏 점수 내림차순이다. 뽑힌 장소가 없으면 비어 있다.
        empty_reason: 뽑힌 장소가 없을 때 원인과 제안. 있으면 None이다.
        invalid_place_ids: 프로필을 읽지 못해 뺀 장소의 id
        trace: 이번 검색의 기록
    """

    interpretation: Interpretation
    cards: tuple[Card, ...]
    empty_reason: EmptyReason | None
    invalid_place_ids: tuple[int, ...]
    trace: SearchTrace


def search(
    request: SearchRequest,
    store: PlaceStore,
    rng: random.Random | None = None,
    timeout: float = 5.0,
    client: httpx.Client | None = None,
) -> SearchResult:
    """검색 한 번을 한다.

    Args:
        request: 검색 요청
        store: 장소 저장소
        rng: LLM에 넣을 후보를 섞는 난수기. 없으면 새로 만든다.
        timeout: GMS 한 번 부를 때 기다리는 시간(초)
        client: GMS 연결을 다시 쓰는 HTTP 클라이언트. 없으면 부를 때마다 만든다.

    Returns:
        카드 목록과 해석 결과, 기록

    Raises:
        EmbeddingError: 요청문을 벡터로 바꾸지 못했을 때
        StoreError: 장소 저장소를 읽지 못했을 때
    """
    deadline = time.perf_counter() + SEARCH_BUDGET_SECONDS
    interpretation = interpret(request.query, request.previous, timeout, client)
    conditions = interpretation.conditions

    start = time.perf_counter()
    query = _encode(conditions.embedding_text)
    embed_seconds = time.perf_counter() - start

    start = time.perf_counter()
    found = store.find(
        _place_filter(conditions, request.bounds),
        query,
        NEARBY_K if conditions.nearby else GENERAL_K,
    )
    trace = SearchTrace(
        embed_seconds, time.perf_counter() - start, len(found.candidates)
    )

    if not found.candidates:
        reason = empty_reason(conditions, in_map_bounds=request.bounds is not None)
        return SearchResult(interpretation, (), reason, found.invalid, trace)
    wait, skipped = _rank_wait(interpretation, deadline, timeout)
    cards, trace = _rank_cards(
        found.candidates, conditions, request.taste, trace, rng, wait, skipped, client
    )
    return SearchResult(interpretation, cards, None, found.invalid, trace)


def empty_reason(conditions: Conditions, in_map_bounds: bool) -> EmptyReason:
    """뽑힌 장소가 없을 때 원인과 제안을 만든다.

    Args:
        conditions: 해석한 조건
        in_map_bounds: 역 대신 지도 영역으로 걸렀는지

    Returns:
        원인과 제안
    """
    where = None
    if in_map_bounds:
        where = "이 지역"
    elif conditions.station and not conditions.nearby:
        where = STATION_NAMES[conditions.station]
    what = CATEGORY_NAMES.get(conditions.category_group or "", "가게")
    scope = f"{where} {what}" if where else what
    facilities = conditions.facilities
    if len(facilities) == 1:
        phrase, name = FACILITY_PHRASES[facilities[0]]
        return EmptyReason(
            f"{scope} 중 {phrase} 곳이 없어요", f"{name} 조건을 빼고 다시 찾아 보세요"
        )
    if facilities:
        return EmptyReason(
            f"{scope} 중 요청한 시설을 모두 갖춘 곳이 없어요",
            "시설 조건을 줄여서 다시 찾아 보세요",
        )
    if in_map_bounds:
        return EmptyReason(
            f"{scope} 중 조건에 맞는 곳이 없어요",
            "지도를 옮기거나 넓혀서 다시 찾아 보세요",
        )
    return EmptyReason(
        f"{scope} 중 조건에 맞는 곳이 없어요", "다른 역이나 업종으로 다시 찾아 보세요"
    )


def _encode(text: str) -> list[float]:
    """요청문을 공유 모듈 `fit_ai.embedding`으로 인코딩한다."""
    try:
        [query] = embedding.encode_queries([text])
    except (RuntimeError, OSError, ValueError) as e:
        # 메시지에 요청문이 섞일 수 있어 종류만 남긴다.
        raise EmbeddingError(type(e).__name__) from e
    return query


def _place_filter(conditions: Conditions, bounds: MapBounds | None) -> PlaceFilter:
    """해석한 조건으로 거르기 조건을 만든다."""
    return PlaceFilter(
        category_group=conditions.category_group,
        # 지도 영역이 있으면 좌표로 거르고, 근처 검색은 폰이 현재 위치로 거른다.
        station=None if bounds or conditions.nearby else conditions.station,
        bounds=bounds,
        facilities=conditions.facilities,
    )


def _rank_wait(
    interpretation: Interpretation, deadline: float, timeout: float
) -> tuple[float | None, str | None]:
    """정렬 LLM 한 번에 기다릴 시간을 정한다.

    해석에서 GMS 호출이 실패했으면 정렬도 실패할 가능성이 커서 부르지 않는다. 공유
    모듈은 호출이 실패하면 한 번 더 부르므로 남은 예산의 절반까지만 기다린다.

    Returns:
        (기다릴 시간, 부르지 않는 이유). 부르지 않으면 기다릴 시간이 None이다.
    """
    if interpretation.gms_failed:
        return None, "해석에서 GMS 호출이 실패해 정렬 LLM을 부르지 않았다"
    wait = min(timeout, (deadline - time.perf_counter()) / 2)
    if wait < MIN_RANK_WAIT_SECONDS:
        return None, "검색 시간 예산이 모자라 정렬 LLM을 부르지 않았다"
    return wait, None


def _rank_cards(
    candidates: Sequence[Candidate],
    conditions: Conditions,
    taste: TasteProfile | None,
    trace: SearchTrace,
    rng: random.Random | None,
    wait: float | None,
    skipped: str | None,
    client: httpx.Client | None,
) -> tuple[tuple[Card, ...], SearchTrace]:
    """⓪ 취향을 고르고 ② 정렬해서 ③ 카드를 만든다.

    근처 검색이거나, 정렬 LLM을 부르지 않았거나(`wait`가 None), LLM 정렬이 실패하면
    LLM 없이 정렬하고 기록에 이유를 남긴다.
    """
    tastes = select_tastes(taste.features, conditions.codes) if taste else ()
    if conditions.nearby:
        ranked = rank_by_similarity(candidates, conditions.codes)
        trace = replace(trace, fallback=Fallback.NEARBY)
    elif wait is None:
        ranked = rank_by_similarity(candidates, conditions.codes)
        trace = replace(trace, fallback=Fallback.LLM_FAILED, rank_llm_error=skipped)
    else:
        try:
            result = rank_with_llm(
                conditions.text,
                conditions.codes,
                candidates,
                tastes,
                taste.free_texts if taste else (),
                rng,
                wait,
                client,
            )
            ranked = result.ranked
            trace = replace(
                trace, rank_llm_raw=result.raw, rank_llm_seconds=result.seconds
            )
        except RankingError as e:
            ranked = rank_by_similarity(candidates, conditions.codes)
            trace = replace(
                trace,
                fallback=Fallback.LLM_FAILED,
                rank_llm_error=str(e),
                rank_llm_raw=e.raw,
                rank_llm_seconds=e.seconds,
            )

    # 카드의 취향 항목은 좋아하는 취향만 보여 준다(docs/comparison/spec.md 4.3).
    liked = [feature.code for feature in tastes if feature.like]
    cards = tuple(
        build_card(r.candidate.place, conditions.codes, liked, r.score) for r in ranked
    )
    return cards, trace
