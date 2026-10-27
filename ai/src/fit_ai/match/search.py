"""비교 검색 한 번. ⓪ 취향 고르기, ② 정렬, ③ 카드 만들기를 잇는다.

① 후보 뽑기는 부르는 쪽이 장소 저장소(`candidates.PlaceStore`)로 해서 후보를 넘긴다.
요청 해석과 요청문 인코딩도 부르는 쪽이 한다. 근처 검색과 LLM 실패 때는 LLM 없이
같은 모양의 카드를 만든다(docs/comparison/spec.md 3장).
"""

import random
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

from fit_ai.match.candidates import Candidate
from fit_ai.match.cards import build_card
from fit_ai.match.models import Card
from fit_ai.match.ranking import (
    Ranked,
    RankingError,
    rank_by_similarity,
    rank_with_llm,
)
from fit_ai.match.taste import TasteProfile, select_tastes


class Fallback(StrEnum):
    """LLM 없이 정렬한 이유."""

    NEARBY = "NEARBY"
    """근처 검색. 정렬할 때 어느 장소가 반경 안에 남을지 모른다."""
    LLM_FAILED = "LLM_FAILED"
    """LLM 호출이 실패했거나 출력이 형식에 맞지 않았다."""


@dataclass(frozen=True)
class SearchRequest:
    """요청 해석이 끝난 검색 요청 하나.

    Attributes:
        text: LLM에 넣을 요청문. 후속 조건이면 이전 요청과 합친 문장이다.
        request_codes: 요청 조건 코드. 인원은 목적 코드로 바꿨다.
        nearby: 근처 검색인지
        taste: 사용자 취향 프로필. 온보딩을 하지 않았으면 None이다.
    """

    text: str
    request_codes: tuple[str, ...]
    nearby: bool = False
    taste: TasteProfile | None = None


@dataclass(frozen=True)
class SearchTrace:
    """검색 한 번의 기록(docs/comparison/spec.md 5장).

    공개 전에 결과를 확인할 때와 나중에 라벨링할 때 쓴다.

    Attributes:
        fallback: LLM 없이 정렬한 이유. LLM 순서를 썼거나 후보가 없으면 None이다.
        llm_error: LLM 정렬이 실패한 이유. 실패하지 않았으면 None이다.
        llm_raw: LLM 원본 출력. 부르지 않았거나 호출이 실패했으면 None이다.
        llm_seconds: LLM 호출에 걸린 시간(초). 부르지 않았으면 None이다.
    """

    fallback: Fallback | None = None
    llm_error: str | None = None
    llm_raw: str | None = None
    llm_seconds: float | None = None


@dataclass(frozen=True)
class SearchResult:
    """검색 결과.

    Attributes:
        cards: 카드 목록. 핏 점수 내림차순이다.
        trace: 이번 검색의 기록
    """

    cards: tuple[Card, ...]
    trace: SearchTrace


def search(
    candidates: Sequence[Candidate],
    request: SearchRequest,
    rng: random.Random | None = None,
    timeout: float = 5.0,
) -> SearchResult:
    """후보로 카드 목록을 만든다.

    Args:
        candidates: ① 후보 뽑기 결과. 유사도 내림차순이다.
        request: 요청 해석이 끝난 검색 요청
        rng: LLM에 넣을 후보를 섞는 난수기. 없으면 새로 만든다.
        timeout: GMS 한 번 부를 때 기다리는 시간(초)

    Returns:
        카드 목록과 기록
    """
    taste = request.taste
    tastes = select_tastes(taste.features, request.request_codes) if taste else ()

    ranked: list[Ranked]
    trace = SearchTrace()
    if not candidates:
        ranked = []
    elif request.nearby:
        ranked = rank_by_similarity(candidates, request.request_codes)
        trace = SearchTrace(fallback=Fallback.NEARBY)
    else:
        try:
            result = rank_with_llm(
                request.text,
                request.request_codes,
                candidates,
                tastes,
                taste.free_texts if taste else (),
                rng,
                timeout,
            )
            ranked = result.ranked
            trace = SearchTrace(llm_raw=result.raw, llm_seconds=result.seconds)
        except RankingError as e:
            ranked = rank_by_similarity(candidates, request.request_codes)
            trace = SearchTrace(
                fallback=Fallback.LLM_FAILED,
                llm_error=str(e),
                llm_raw=e.raw,
                llm_seconds=e.seconds,
            )

    # 카드의 취향 항목은 좋아하는 취향만 보여 준다(docs/comparison/spec.md 4.3).
    liked = [feature.code for feature in tastes if feature.like]
    cards = tuple(
        build_card(r.candidate.place, request.request_codes, liked, r.score)
        for r in ranked
    )
    return SearchResult(cards, trace)
