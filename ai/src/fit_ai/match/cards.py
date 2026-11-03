"""③ 카드 만들기. 점수를 낸 후보마다 핏 점수, 추천 이유, 근거 항목, 특징 라벨을 채운다.

근거 항목과 추천 이유는 ② 점수가 낸 조건 점수로 만든다. 그래서 화면의 항목과 핏 점수가 같은
근거를 말한다. 카드 모양은 BE의 `PlaceCard`와 맞춘다. BE 정의는
be/src/main/java/kr/co/fitdining/api/place/dto/PlaceCard.java에 있다. BE로 보내는 JSON
이름(camelCase)으로 바꾸는 일은 API 쪽에서 한다. LLM을 쓰지 않는다(docs/comparison/spec.md
4.4).
"""

from dataclasses import dataclass
from enum import StrEnum

from fit_ai.match.conditions import (
    CATEGORY_NAMES,
    CONDITIONS,
    SCORE_LABELS,
    STATION_NAMES,
)
from fit_ai.match.place import Place
from fit_ai.match.scoring import ItemScore, PlaceScore

MAX_REASONS = 3
LABEL_COUNT = 2

MATCHED_SCORE = 0.7
"""근거가 충분하다고 보는 조건 점수. 리뷰 근거는 업종 범위에서 상위 30% 안이고, 장소 정보는
있다고 확인된 것이다. 이 값 이상이면 근거 항목이 `matched`이고 추천 이유가 된다. 시작값이다
(2026-11-03)."""


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
        matched: 근거가 충분한지(조건 점수가 `MATCHED_SCORE` 이상). False면 확인할 근거가
            부족하거나 아니라는 근거가 있는 항목이다.
        evidence_count: 근거가 된 리뷰 수. 0 이상이다. 장소 정보로 판정했으면 0이다.
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
        score: 핏 점수. 0~100 정수다. 판정할 요청 조각도 취향도 없으면 None이다.
        labels: 카드에 보이는 장소 특징 2개
        reasons: 추천 이유. 근거가 충분한 조건이 없으면 비어 있다.
        score_items: 핏 점수를 이루는 항목. 요청 조각과 좋아하는 취향마다 1개다.
        caution: 주의점. MVP는 넣지 않아 None이다.
    """

    place_id: int
    score: int | None
    labels: tuple[str, ...]
    reasons: tuple[Reason, ...]
    score_items: tuple[ScoreItem, ...]
    caution: str | None = None


def build_card(scored: PlaceScore) -> Card:
    """점수를 낸 후보 하나의 카드를 만든다.

    근거 항목은 점수를 낸 조각과 같다. 요청 조각, 그다음 좋아하는 취향이다. 싫어하는
    취향은 점수에는 들어가지만 화면 문구가 정해질 때까지 항목에 넣지 않는다(2026-11-03
    결정).

    Args:
        scored: ② 점수(`scoring.py`)가 낸 후보 하나의 핏 점수

    Returns:
        카드
    """
    place = scored.candidate.place
    shown = [item for item in scored.items if item.request or item.like]
    return Card(
        place_id=place.place_id,
        score=scored.score,
        labels=_labels(place),
        reasons=_reasons(shown),
        score_items=tuple(_score_item(item) for item in shown),
    )


def _score_item(item: ItemScore) -> ScoreItem:
    return ScoreItem(
        condition_id=item.code,
        source=Source.REQUEST if item.request else Source.PREFERENCE,
        label=SCORE_LABELS[item.code],
        matched=item.value >= MATCHED_SCORE,
        evidence_count=item.evidence_count,
    )


def _reasons(items: list[ItemScore]) -> tuple[Reason, ...]:
    """근거가 충분한 항목마다 이유를 하나씩 만든다. 최대 `MAX_REASONS`개다."""
    reasons = [
        Reason(
            title=_reason_title(item),
            tags=(
                ReasonTag(
                    Source.REQUEST if item.request else Source.PREFERENCE,
                    SCORE_LABELS[item.code],
                ),
            ),
        )
        for item in items
        if item.value >= MATCHED_SCORE
    ]
    return tuple(reasons[:MAX_REASONS])


def _reason_title(item: ItemScore) -> str:
    label = SCORE_LABELS[item.code]
    if item.from_reviews:
        return f'리뷰에서 "{label}"라는 말이 많아요'
    # 리뷰가 아니라 장소 정보(시설, 음식 종류)로 확인한 조건이다.
    return label


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
