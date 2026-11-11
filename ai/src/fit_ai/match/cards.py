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
        condition_id: 조건 id. 코드 없는 조건 문구면 None이다. BE로는 보내지 않는다.
        source: 근거 출처
        label: 항목 이름
        matched: 근거가 충분한지(조건 점수가 `MATCHED_SCORE` 이상). False면 확인할 근거가
            부족하거나 아니라는 근거가 있는 항목이다.
        evidence_count: 근거가 된 리뷰 수. 0 이상이다. 장소 정보로 판정했으면 0이다.
    """

    condition_id: str | None
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
        labels: 카드 태그 2개. 이번 검색에서 맞은 조건이 먼저다.
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
    취향과 피해 달라는 요청("안 매운")은 점수에는 들어가지만 화면 문구가 정해질 때까지 항목에
    넣지 않는다(2026-11-03 결정).

    Args:
        scored: ② 점수(`scoring.py`)가 낸 후보 하나의 핏 점수

    Returns:
        카드
    """
    place = scored.candidate.place
    shown = [item for item in scored.items if item.like]
    return Card(
        place_id=place.place_id,
        score=scored.score,
        labels=_labels(place, shown),
        reasons=_reasons(shown),
        score_items=tuple(_score_item(item) for item in shown),
    )


def _score_item(item: ItemScore) -> ScoreItem:
    return ScoreItem(
        condition_id=item.code,
        source=Source.REQUEST if item.request else Source.PREFERENCE,
        label=_label(item),
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
                    _label(item),
                ),
            ),
        )
        for item in items
        if item.value >= MATCHED_SCORE
    ]
    return tuple(reasons[:MAX_REASONS])


def _label(item: ItemScore) -> str:
    """근거 항목 이름. 코드 조각은 코드 문구, 코드 없는 조건은 그 문구다."""
    return SCORE_LABELS[item.code] if item.code is not None else item.phrase or ""


def _reason_title(item: ItemScore) -> str:
    if item.code is None:
        # 장소 페르소나로 판정한 코드 없는 조건이다(docs/comparison/spec.md 4.4).
        return f"{item.phrase}에 맞아요"
    label = SCORE_LABELS[item.code]
    if item.from_reviews:
        return f'리뷰에서 "{label}"라는 말이 많아요'
    # 리뷰가 아니라 장소 정보(시설, 음식 종류)로 확인한 조건이다.
    return label


def _labels(place: Place, items: list[ItemScore]) -> tuple[str, ...]:
    """카드 태그 2개. 이번 검색에서 맞은 조건을 먼저 쓰고, 모자라면 장소 특징으로 채운다.

    맞은 조건은 조건 점수가 `MATCHED_SCORE` 이상인 항목이다. 요청 조각을 조건 점수 순으로,
    그다음 좋아하는 취향을 세기 순으로 놓는다. 문구는 근거 항목의 `label`과 같아서, FE는
    `matched`인 근거 항목과 문구가 같은 태그에만 강조색을 칠한다(docs/comparison/api.md).

    Args:
        place: 장소
        items: 카드에 보이는 근거 항목. 요청 조각과 좋아하는 취향이다.

    Returns:
        태그 문구. `LABEL_COUNT`개이고, 채울 것이 모자라면 더 적다.
    """
    matched = [item for item in items if item.value >= MATCHED_SCORE]
    requested = sorted(
        (item for item in matched if item.request), key=lambda item: -item.value
    )
    # 세기가 같으면 조건 점수가 높은 쪽이 먼저다. 취향 묶음(코드 없는 취향)은 대표 문구가 리뷰 문장일 수
    # 있어("돈가스는 바삭하고 속은 촉촉하며…") 태그로 쓰지 않는다. 점수와 근거 항목에는 남는다.
    tastes = sorted(
        (item for item in matched if not item.request and item.code is not None),
        key=lambda item: (-item.weight, -item.value),
    )
    chosen = requested + tastes
    # 코드 없는 조건 문구 항목은 문구를 태그로 쓴다(근거 항목 `label`과 같다)
    labels = [_label(item) for item in chosen[:LABEL_COUNT]]
    if len(labels) < LABEL_COUNT:
        labels += _place_labels(place, {i.code for i in chosen if i.code is not None})
    return tuple(labels[:LABEL_COUNT])


def _place_labels(place: Place, chosen: set[str]) -> list[str]:
    """근거가 많은 장소 특징, 그다음 업종과 역 이름. 이미 고른 조건은 뺀다.

    부정이 긍정보다 많거나 같은 특징은 넣지 않는다.
    """
    candidates = [
        condition_id
        for condition_id in CONDITIONS
        if condition_id not in chosen
        and place.evidence(condition_id).pos > place.evidence(condition_id).neg
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
    # 근거 있는 특징이 모자라면 업종과 역 이름으로 채운다.
    for filler in (
        CATEGORY_NAMES.get(place.info.category_group),
        STATION_NAMES.get(place.info.station),
    ):
        if filler is not None:
            labels.append(filler)
    return labels
