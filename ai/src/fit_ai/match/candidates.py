"""① 후보 뽑기. 거르기 조건에 맞는 장소 중 요청문과 가까운 순서로 고른다.

거르기와 유사도 계산은 장소 저장소가 한다. 여기에는 저장소가 지켜야 할 모양만 둔다.
구현은 `pg_store.py`(Postgres)와, 실제 장소 DB가 생기기 전에 쓰는 `json_store.py`(JSON
파일)다. 저장소는 ② 점수의 기준을 만들 장소 전체도 읽어 준다.
취향은 쓰지 않는다. 취향은 ② 점수에서만 쓴다(docs/comparison/spec.md 4.2).
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

from fit_ai.match.place import Place

CANDIDATE_K = 100
"""점수를 매길 후보 수. 거른 장소를 유사도 순서로 이만큼 뽑아 모두 점수를 매긴다. 조건은
맞는데 요약이 덜 비슷한 곳이 점수를 받기 전에 잘리지 않게 넉넉히 둔다. 지금 데이터(300곳)는
거르고 나면 대개 이보다 적다."""

GENERAL_K = 20
"""일반 검색에서 돌려줄 카드 수. 점수순으로 자른다."""

NEARBY_K = 100
"""근처 검색에서 돌려줄 카드 수. 폰이 현재 위치로 다시 거른다."""


@dataclass(frozen=True)
class Candidate:
    """뽑은 후보 하나.

    Attributes:
        place: 장소
        similarity: 요청문과 장소 요약의 코사인 유사도. 값은 쓰지 않고 순서만 쓴다.
            후보를 자를 때와 점수가 같은 후보의 순서를 가를 때다.
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
class StationArea:
    """역 지역.

    도보 거리와 출구가 없으면 수집 역이 같거나 가까운 역 목록에 그 역이 있으면 든다.
    가까운 역 목록만 보면 강남에서 수집했지만 가장 가까운 역이 신논현역인 곳이 "강남역"
    검색에서 빠지기 때문이다(2026-11-02 결정). 도보 거리나 출구가 있으면 가까운 역
    목록으로만 본다.

    Attributes:
        name: 역 이름("강남역"). 가까운 역 목록(`place_subways.station`)과 같은 표기다.
        code: 서비스 역 코드(`GANGNAM`). 수집 역과 견준다. 서비스 역이 아니면 None이다.
        walk_minutes: 그 역까지 도보 몇 분 이하인 곳. 없으면 None이다.
        exit: 가장 가까운 출구가 이 출구인 곳. 없으면 None이다.
    """

    name: str
    code: str | None = None
    walk_minutes: int | None = None
    exit: str | None = None


@dataclass(frozen=True)
class RegionArea:
    """동·구·시·군·읍·면. 장소의 동(`places.dong`)이나 구(`places.district`)가 이 이름이면 든다.
    구가 없는 시·군은 그 이름이 `district`에, 동이 없는 읍·면은 그 이름이 `dong`에 든다.

    동 정보가 없는 장소는 이름이 같은 서비스 역("역삼동"이면 역삼역)의 장소로 본다.
    1차와 같은 동작이다.

    Attributes:
        name: 동·구·시·군·읍·면 이름("역삼동", "강남구", "구미시"). 동은 법정동 이름이다.
        code: 이름이 같은 서비스 역 코드. 없으면 None이다.
    """

    name: str
    code: str | None = None


Area = StationArea | RegionArea | MapBounds
"""거르기 지역. 역, 동·구, 지도 영역이다."""


@dataclass(frozen=True)
class OpenHours:
    """영업시간 조건. 요청한 요일 중 하루라도 안 맞는다고 확인되지 않은 곳을 남긴다.

    그 요일에 쉬거나, 여는·닫는 시각을 아는데 조건에 못 미치면 그 요일은 안 맞는다. 그
    요일의 영업시간을 모르면 남긴다(2026-11-03 결정). 여는 시각과 닫는 시각이 같으면 24시간
    영업으로 본다. 닫는 시각이 여는 시각보다 이르면 다음 날 닫는다.

    Attributes:
        days: 요일(`MON`~`SUN`). 비어 있으면 아무 요일이나 된다.
        until: 이 시각까지 여는 곳. 그날 0시부터 센 분이고, 다음 날 새벽이면 1440을
            넘는다("새벽 2시까지"는 1560). 없으면 None이다.
        since: 이 시각 전에 여는 곳. 그날 0시부터 센 분이다. 없으면 None이다.
    """

    days: tuple[str, ...] = ()
    until: int | None = None
    since: int | None = None


@dataclass(frozen=True)
class PlaceFilter:
    """후보를 거르는 조건.

    Attributes:
        category_group: 업종. None이면 거르지 않는다.
        areas: 지역. 여럿이면 그중 하나에 들면 된다. 비어 있으면 위치로 거르지 않는다.
            근처 검색은 폰이 현재 위치로 거르므로 비어 있다.
        facilities: 요청한 시설. 그 시설이 없다고 확인된 장소만 뺀다.
            모르는 장소는 남긴다.
        excluded_categories: 빼 달라는 업종("카페 말고")
        hours: 영업시간. None이면 거르지 않는다.
        min_price: 가게 가격(`price.store_price`) 하한(원). 가격을 모르는 장소는 남긴다.
            None이면 거르지 않는다.
        max_price: 가게 가격 상한(원). 하한과 같다.
        menus: 요청한 메뉴. 메뉴마다 찾을 말(`menu_key`로 바꾼 사용자 말, 표준 이름, 다른
            표기)이다. 모든 메뉴에 대해 그중 하나가 메뉴판의 메뉴 이름, 네이버 업종 이름,
            가게 이름 중 하나에 들어 있는 장소만 남긴다. 메뉴판이 없는 장소도 업종 이름과
            가게 이름으로 본다. 비어 있으면 메뉴로 거르지 않는다.
    """

    category_group: str | None = None
    areas: tuple[Area, ...] = ()
    facilities: tuple[str, ...] = field(default_factory=tuple)
    excluded_categories: tuple[str, ...] = ()
    hours: OpenHours | None = None
    min_price: int | None = None
    max_price: int | None = None
    menus: tuple[tuple[str, ...], ...] = ()


_NOT_KEY = re.compile(r"[^0-9a-z가-힣]")
"""메뉴 맞추기에서 지우는 글자. 소문자로 바꾼 뒤 숫자, 영문, 한글 음절만 남긴다."""


def menu_key(text: str) -> str:
    """메뉴를 맞출 때 견주는 꼴. 띄어쓰기, 괄호, 기호를 지우고 영문은 소문자로 바꾼다.

    "[대표] 등심 돈까스(200g)"는 "대표등심돈까스200g"이다. 저장소는 메뉴 이름, 업종 이름,
    가게 이름을 이 꼴로 바꿔 찾을 말이 들어 있는지 본다(`pg_store.FIND_SQL`과 같다).

    Args:
        text: 메뉴 이름이나 찾을 말

    Returns:
        견주는 꼴. 남는 글자가 없으면 빈 문자열이다.
    """
    return _NOT_KEY.sub("", text.lower())


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

    def places(self) -> tuple[Place, ...]:
        """② 점수의 기준을 만들 장소 전체. 거르지 않고 벡터 상태도 보지 않는다.

        업종 범위 안 장소들과 견줘 조건 점수를 내는 데 쓴다(`scoring.Baseline`). 장소
        데이터는 적재 때만 바뀌므로 구현은 잠시 저장해 두고 다시 써도 된다.

        Returns:
            장소. 프로필을 읽지 못한 장소는 뺀다.

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
