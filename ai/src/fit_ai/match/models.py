"""비교가 내보내는 카드의 모양. BE의 `PlaceCard`와 맞춘다.

BE 정의는 be/src/main/java/kr/co/fitdining/api/place/dto/PlaceCard.java에 있다.
BE로 보내는 JSON 이름(camelCase)으로 바꾸는 일은 API 쪽에서 한다.
"""

from dataclasses import dataclass
from enum import StrEnum


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
