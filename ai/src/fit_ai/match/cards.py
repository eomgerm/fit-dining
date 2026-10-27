"""③ 카드 만들기. 정렬된 후보마다 핏 점수, 추천 이유, 근거 항목, 특징 라벨을 채운다.

카드 모양은 BE의 `PlaceCard`와 맞춘다. BE 정의는
be/src/main/java/kr/co/fitdining/api/place/dto/PlaceCard.java에 있다. BE로 보내는 JSON
이름(camelCase)으로 바꾸는 일은 API 쪽에서 한다. LLM을 쓰지 않는다. 근처 검색과 LLM이
실패했을 때도 이 모듈로 카드를 만든다(docs/comparison/spec.md 3장, 4.4).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

from fit_ai.match.conditions import CATEGORY_NAMES, CONDITIONS, STATION_NAMES
from fit_ai.match.place import Place, Verdict

MAX_REASONS = 3
LABEL_COUNT = 2


class Source(StrEnum):
    """근거 출처. BE의 `EvidenceSource`와 같다."""

    REQUEST = "REQUEST"
    """이번 검색 요청에서 나온 조건. 화면: "요청 ·" """
    PREFERENCE = "PREFERENCE"
    """사용자 취향에서 나온 조건. 화면: "내 취향 ·" """


@dataclass(frozen=True)
class ScoreItem:
    """핏 점수를 이루는 항목 1개. BE의 `ScoreItem`에 조건 id를 더했다.

    Attributes:
        condition_id: 조건 id. BE로는 보내지 않는다.
        source: 근거 출처
        label: 항목 이름
        matched: 근거가 충분한지. False면 확인할 근거가 부족한 항목이다.
        evidence_count: 근거가 된 리뷰 수. 0 이상이다.
    """

    condition_id: str
    source: Source
    label: str
    matched: bool
    evidence_count: int


@dataclass(frozen=True)
class ReasonTag:
    """추천 이유의 근거 칩. 화면에 "요청 · 조용해요"처럼 보인다.

    Attributes:
        source: 근거 출처
        label: 칩 문구
    """

    source: Source
    label: str


@dataclass(frozen=True)
class Reason:
    """추천 이유 1개.

    Attributes:
        title: 이유 제목
        tags: 이 이유의 근거 칩
        quote: 근거가 된 문장 인용. MVP는 넣지 않아 None이다.
        quote_source: 인용 출처(예: "앱 리뷰"). 인용이 없으면 None이다.
    """

    title: str
    tags: tuple[ReasonTag, ...]
    quote: str | None = None
    quote_source: str | None = None


@dataclass(frozen=True)
class Card:
    """카드의 AI 필드.

    장소 기본 정보와 영업 상태는 BE가 채운다(docs/comparison/spec.md 4.4).

    Attributes:
        place_id: 장소 id
        score: 핏 점수. 0~100 정수다.
        labels: 카드에 보이는 장소 특징 2개
        reasons: 추천 이유. 근거가 충분한 조건이 없으면 비어 있다.
        score_items: 핏 점수를 이루는 항목. 질의 조건마다 1개다.
        caution: 주의점. MVP는 넣지 않아 None이다.
    """

    place_id: int
    score: int
    labels: tuple[str, ...]
    reasons: tuple[Reason, ...]
    score_items: tuple[ScoreItem, ...]
    caution: str | None = None


def build_card(
    place: Place,
    request_conditions: Sequence[str],
    preference_conditions: Sequence[str],
    score: int,
) -> Card:
    """장소 하나의 카드를 만든다.

    Args:
        place: 장소
        request_conditions: 요청 조건 id 목록. 목록에 없는 id는 무시한다.
        preference_conditions: 취향 조건 id 목록. 목록에 없는 id는 무시한다.
        score: 핏 점수. ② 정렬(`ranking.py`)에서 받는다.

    Returns:
        카드
    """
    items = _score_items(place, request_conditions, preference_conditions)
    return Card(
        place_id=place.place_id,
        score=score,
        labels=_labels(place),
        reasons=_reasons(place, items),
        score_items=items,
    )


def _score_items(
    place: Place,
    request_conditions: Sequence[str],
    preference_conditions: Sequence[str],
) -> tuple[ScoreItem, ...]:
    """질의 조건마다 근거 항목을 만든다. 요청 조건이 먼저다."""
    items: list[ScoreItem] = []
    seen: set[str] = set()
    for source, condition_ids in (
        (Source.REQUEST, request_conditions),
        (Source.PREFERENCE, preference_conditions),
    ):
        for condition_id in condition_ids:
            condition = CONDITIONS.get(condition_id)
            # 목록에 없는 조건은 근거를 세지 않는다.
            # 요청과 취향에 모두 있으면 요청으로 한 번만 넣는다.
            if condition is None or condition_id in seen:
                continue
            seen.add(condition_id)
            items.append(
                ScoreItem(
                    condition_id=condition_id,
                    source=source,
                    label=condition.label,
                    matched=place.judge(condition_id) is Verdict.CONFIRMED,
                    evidence_count=place.evidence(condition_id).pos,
                )
            )
    return tuple(items)


def _reasons(place: Place, items: tuple[ScoreItem, ...]) -> tuple[Reason, ...]:
    """근거가 충분한 항목마다 이유를 하나씩 만든다. 최대 `MAX_REASONS`개다."""
    reasons = [
        Reason(
            title=_reason_title(place, item),
            tags=(ReasonTag(item.source, item.label),),
        )
        for item in items
        if item.matched
    ]
    return tuple(reasons[:MAX_REASONS])


def _reason_title(place: Place, item: ScoreItem) -> str:
    if place.evidence(item.condition_id).supported:
        return f'리뷰에서 "{item.label}"라는 말이 많아요'
    # 리뷰가 아니라 장소 정보(시설)로 확인한 조건이다.
    return item.label


def _labels(place: Place) -> tuple[str, ...]:
    """근거가 많은 특징 2개. 부정이 긍정보다 많거나 같은 특징은 넣지 않는다."""
    candidates = [
        condition_id
        for condition_id in CONDITIONS
        if place.evidence(condition_id).pos > place.evidence(condition_id).neg
    ]
    # 근거가 충분한 특징 먼저, 그 안에서는 긍정 리뷰가 많은 순서다.
    # 같으면 조건 목록 순서다.
    candidates.sort(
        key=lambda condition_id: (
            not place.evidence(condition_id).supported,
            -place.evidence(condition_id).pos,
        )
    )
    labels = [CONDITIONS[condition_id].label for condition_id in candidates]
    # 근거 있는 특징이 2개보다 적으면 업종과 역 이름으로 채운다.
    for filler in (
        CATEGORY_NAMES.get(place.info.category_group),
        STATION_NAMES.get(place.info.station),
    ):
        if filler is not None:
            labels.append(filler)
    return tuple(labels[:LABEL_COUNT])
