"""① 후보 뽑기. 거르기 조건에 맞는 장소 중 요청문과 가까운 순서로 고른다.

거르기와 유사도 계산은 장소 저장소(Postgres + pgvector)가 SQL 한 번으로 한다.
여기에는 저장소가 지켜야 할 모양만 둔다. 구현은 `pg_store.py`(Postgres)와, 실제 장소
DB가 생기기 전에 쓰는 `json_store.py`(JSON 파일)다.
취향은 쓰지 않는다. 취향은 ② 정렬에서만 쓴다(docs/comparison/spec.md 4.2).
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

from fit_ai.match.place import Place

GENERAL_K = 20
"""일반 검색에서 LLM 정렬에 넘길 후보 수"""

NEARBY_K = 100
"""근처 검색에서 돌려줄 후보 수. 폰이 현재 위치로 다시 거른다."""


@dataclass(frozen=True)
class Candidate:
    """뽑은 후보 하나.

    Attributes:
        place: 장소
        similarity: 요청문과 장소 요약의 코사인 유사도. 값은 쓰지 않고 순서만 쓴다.
            후보를 자를 때와 같은 등급 안에서 순서를 가를 때다.
    """

    place: Place
    similarity: float


@dataclass(frozen=True)
class MapBounds:
    """지도 영역("이 지역에서 검색"). 빠진 값은 그쪽을 제한하지 않는다.

    Attributes:
        sw_lat: 남서쪽 위도
        sw_lng: 남서쪽 경도
        ne_lat: 북동쪽 위도
        ne_lng: 북동쪽 경도
    """

    sw_lat: float | None = None
    sw_lng: float | None = None
    ne_lat: float | None = None
    ne_lng: float | None = None


@dataclass(frozen=True)
class PlaceFilter:
    """후보를 거르는 조건.

    Attributes:
        category_group: 업종. None이면 거르지 않는다.
        station: 역. None이면 거르지 않는다. 지도 영역이나 근처 검색이면 None이다.
        bounds: 지도 영역. None이면 좌표로 거르지 않는다.
        facilities: 요청한 시설. 그 시설이 없다고 확인된 장소만 뺀다.
            모르는 장소는 남긴다.
    """

    category_group: str | None = None
    station: str | None = None
    bounds: MapBounds | None = None
    facilities: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class Found:
    """저장소에서 뽑은 후보.

    Attributes:
        candidates: 후보. 유사도 내림차순이다.
        invalid: 프로필을 읽지 못해 뺀 장소의 id
    """

    candidates: tuple[Candidate, ...]
    invalid: tuple[int, ...] = ()


@dataclass(frozen=True)
class VectorCounts:
    """장소 벡터 상태별 장소 수.

    Attributes:
        comparable: 요청문 인코더와 모델·리비전이 같아 비교할 수 있는 장소 수
        mismatched: 벡터가 없거나 모델·리비전이 달라 검색에서 빠지는 장소 수
    """

    comparable: int
    mismatched: int


class StoreError(Exception):
    """장소·취향 저장소를 읽지 못했다. 접속 실패, 시간 초과, SQL 오류 등이다."""


class PlaceStore(Protocol):
    """거르기 조건과 요청문 벡터로 후보를 뽑는 장소 저장소."""

    def find(self, place_filter: PlaceFilter, query: Sequence[float], k: int) -> Found:
        """조건에 맞는 장소 중 요청문과 가까운 k곳을 뽑는다.

        공유 모듈 `fit_ai.embedding`과 모델·리비전이 같은 장소 벡터만 비교한다.

        Args:
            place_filter: 거르기 조건
            query: 요청문 벡터. `fit_ai.embedding.encode_queries`로 인코딩했다.
            k: 뽑을 후보 수

        Returns:
            뽑은 후보

        Raises:
            StoreError: 저장소를 읽지 못했을 때
        """
        ...

    def vector_counts(self) -> VectorCounts:
        """공유 모듈 `fit_ai.embedding`과 비교할 수 있는 장소와 빠지는 장소를 센다.

        벡터가 없거나 모델·리비전이 다른 장소는 `find`에서 빠진다. 상태
        확인(`/healthz`)에서 쓴다.

        Returns:
            장소 수

        Raises:
            StoreError: 저장소를 읽지 못했을 때
        """
        ...
