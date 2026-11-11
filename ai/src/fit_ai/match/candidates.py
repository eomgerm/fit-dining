"""① 후보 뽑기. 거르기 조건에 맞는 장소 중 요청문과 가까운 순서로 고른다.

요청에 코드 없는 조건 문구("책 읽기 좋은 곳")가 있으면, 그 문구와 비슷한 만족한 손님
페르소나가 있는 장소도 더 뽑는다(페르소나 경로). 장소 요약에는 분위기나 목적 이야기가 없어서다.
거르기와 유사도 계산은 장소 저장소가 한다. 여기에는 저장소가 지켜야 할 모양만 둔다.
구현은 `pg_store.py`(Postgres)와, 실제 장소 DB가 생기기 전에 쓰는 `json_store.py`(JSON
파일)다. 저장소는 ② 점수의 기준을 만들 장소 전체도 읽어 준다.
취향은 쓰지 않는다. 취향은 ② 점수에서만 쓴다(docs/comparison/spec.md 4.2).
"""

import math
import re
from bisect import bisect_left
from collections.abc import Collection, Sequence
from dataclasses import dataclass, field
from typing import Protocol

from fit_ai.match.place import Place

CANDIDATE_K = 100
"""점수를 매길 후보 수. 거른 장소를 유사도 순서로 이만큼 뽑아 모두 점수를 매긴다. 조건은
맞는데 요약이 덜 비슷한 곳이 점수를 받기 전에 잘리지 않게 넉넉히 둔다. 지금 데이터(300곳)는
거르고 나면 대개 이보다 적다."""

PERSONA_K = 100
"""페르소나 경로로 더 뽑을 후보 수. 요약 경로(`CANDIDATE_K`)와 같다."""

REFERENCE_PLACES = 500
"""페르소나 항목을 낼 때 견주는 기준 장소 수. 업종 범위 안에서 페르소나가 있는 장소를 장소
id의 해시 순서로 이만큼 고른다. 범위 안 전체와 견주면 prod에서 770ms, 500곳이면 27ms였고
값의 평균 차이는 0.007이었다(2026-11-09, 취향 보정 설계 4단계)."""

GENERAL_K = 20
"""돌려줄 카드 수. 점수순으로 자른다. 사용자 위치로 찾을 때도 같다."""

NEARBY_RADIUS_M = 1000
"""사용자 위치로 찾을 때의 반경(m). FE가 거리를 보여 주는 근처 반경과 같다(2026-11-09 결정)."""

EARTH_RADIUS_M = 6_371_000
"""지구 반지름(m). 거리 공식(`distance_m`)에 쓴다. FE의 거리 계산과 같은 값이다."""


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


@dataclass(frozen=True)
class RadiusArea:
    """사용자 위치에서 반경 안. 장소까지의 거리(`distance_m`)가 반경 이하면 든다.

    사각형(위도·경도 범위)으로 거르면 모서리가 반경의 약 1.41배까지 들어오고, 경도 1도의
    길이가 위도마다 달라(북위 36도에서 약 90km, 위도 1도는 약 111km) 원으로 잰다. 좌표가
    없는 장소는 들지 않는다.

    Attributes:
        lat: 사용자 위치의 위도
        lng: 사용자 위치의 경도
        radius_m: 반경(m)
    """

    lat: float
    lng: float
    radius_m: float = NEARBY_RADIUS_M


Area = StationArea | RegionArea | MapBounds | RadiusArea
"""거르기 지역. 역, 동·구, 지도 영역, 사용자 위치 반경이다."""


def distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """두 좌표 사이의 거리(m). 지구를 공으로 보고 잰 표면 거리다(하버사인 공식).

    `pg_store.FIND_SQL`의 반경 조건과 같은 식이다. FE도 거리를 보여 줄 때 같은 식과 반지름을
    써서, 화면에 "980m"로 보이는 장소는 1km 반경 결과에도 든다.
    """
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lng / 2) ** 2
    )
    # 부동소수점 오차로 1을 조금 넘으면 asin이 실패하므로 막는다.
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


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
        areas: 지역. 여럿이면 그중 하나에 들면 된다. 비어 있으면 위치로 거르지 않는다
            (전국에서 찾는다).
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
        excluded_food_types: 빼는 음식 종류(`FOOD_KOREAN` 등). 그 종류로 확인된 장소만
            빼고, 음식 종류를 모르는 장소는 남긴다. 모임 계산이 못 먹는 음식에 쓴다.
        closed_day: 모임 요일(`MON`~`SUN`). 그 요일에 쉰다고 확인된 장소만 뺀다. 모임
            계산이 영업시간의 세부 규칙(`meetup.is_open`) 전에 후보를 줄이려고 쓴다.
            Postgres 저장소만 거르고 JSON 저장소는 무시한다.
        overnight_day: 모임 시각이 있을 때의 전날. 이 요일에 쉬지 않고 닫는 시각이
            여는 시각보다 늦다고 확인되지 않은 장소는 `closed_day`에 쉬어도 남긴다
            (전날 밤부터 이어지는 영업).
    """

    category_group: str | None = None
    areas: tuple[Area, ...] = ()
    facilities: tuple[str, ...] = field(default_factory=tuple)
    excluded_categories: tuple[str, ...] = ()
    hours: OpenHours | None = None
    min_price: int | None = None
    max_price: int | None = None
    menus: tuple[tuple[str, ...], ...] = ()
    excluded_food_types: tuple[str, ...] = ()
    closed_day: str | None = None
    overnight_day: str | None = None


@dataclass(frozen=True)
class DayHours:
    """요일 하나의 영업시간. 뷰 `hours`의 원소 하나다.

    Attributes:
        day: 요일(`MON`~`SUN`)
        open: 여는 시각("HH:MM"). 모르면 None이다.
        close: 닫는 시각("HH:MM"). 여는 시각과 같거나 이르면 다음 날 닫는다.
        closed: 그 요일에 쉬는지
        breaks: 브레이크타임(시작, 끝)("HH:MM")
    """

    day: str
    open: str | None
    close: str | None
    closed: bool
    breaks: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class PlaceDetails:
    """후보를 뽑은 뒤 모임 계산이 더 읽는 장소 정보. 후보 행에는 없어서 따로 읽는다.

    Attributes:
        hours: 요일별 영업시간. 모르는 요일은 빠진다.
        menus: 메뉴판의 메뉴 이름. 메뉴판이 없으면 비어 있다.
        name: 가게 이름. 모르면 None이다.
        category: 네이버 업종 이름. 모르면 None이다.
        price: 가게 가격(원). 모르면 None이다.
    """

    hours: tuple[DayHours, ...] = ()
    menus: tuple[str, ...] = ()
    name: str | None = None
    category: str | None = None
    price: int | None = None


def read_details(row: dict[str, object]) -> PlaceDetails:
    """뷰 한 행의 `hours`, `menus`, `name`, `category`, `price`를 읽는다. 모양이 틀린 원소는 버린다.

    두 저장소 구현이 함께 쓴다. 영업시간 한 줄이 깨져도 그 요일만 모르는 것으로 보고,
    메뉴 하나가 깨져도 그 메뉴만 뺀다.
    """
    hours = []
    for item in row.get("hours") or ():
        if not isinstance(item, dict) or not isinstance(item.get("day"), str):
            continue
        open_at, close_at = item.get("open"), item.get("close")
        breaks = tuple(
            (b["start"], b["end"])
            for b in item.get("breaks") or ()
            if isinstance(b, dict)
            and isinstance(b.get("start"), str)
            and isinstance(b.get("end"), str)
        )
        hours.append(
            DayHours(
                item["day"],
                open_at if isinstance(open_at, str) else None,
                close_at if isinstance(close_at, str) else None,
                item.get("closed") is True,
                breaks,
            )
        )
    menus = tuple(
        m["name"]
        for m in row.get("menus") or ()
        if isinstance(m, dict) and isinstance(m.get("name"), str)
    )
    name, category, price = row.get("name"), row.get("category"), row.get("price")
    return PlaceDetails(
        tuple(hours),
        menus,
        name if isinstance(name, str) else None,
        category if isinstance(category, str) else None,
        price if isinstance(price, int) and not isinstance(price, bool) else None,
    )


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


def merge_found(summary: Found, persona: Found) -> Found:
    """요약 경로와 페르소나 경로의 후보를 합친다. 같은 장소는 한 번만 두고, 모두 요약
    유사도 내림차순으로 놓는다."""
    seen = {c.place.place_id for c in summary.candidates}
    extra = tuple(c for c in persona.candidates if c.place.place_id not in seen)
    return Found(
        tuple(
            sorted(summary.candidates + extra, key=lambda c: c.similarity, reverse=True)
        ),
        tuple(dict.fromkeys(summary.invalid + persona.invalid)),
    )


def persona_rank(reference: Sequence[float], best: float) -> float:
    """기준 장소 중 가장 비슷한 값이 `best`보다 낮은 곳의 비율(0~1)이다. 기준 장소가 없으면
    판단할 수 없어 0.5다.

    Args:
        reference: 기준 장소마다 문구와 가장 비슷한 페르소나의 유사도. 오름차순이다.
        best: 그 장소의 값

    Returns:
        페르소나 항목
    """
    if not reference:
        return 0.5
    return bisect_left(reference, best) / len(reference)


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

    def find_by_personas(
        self,
        place_filter: PlaceFilter,
        query: Sequence[float],
        phrase: Sequence[float],
        k: int,
    ) -> Found:
        """조건에 맞는 장소 중 만족한 손님 페르소나가 문구와 가장 가까운 k곳을 뽑는다.

        장소마다 페르소나와 문구의 유사도 중 가장 큰 값으로 줄 세운다. 페르소나가 없는
        장소는 뽑지 않는다.

        Args:
            place_filter: 거르기 조건
            query: 요청문 벡터. 후보의 `similarity`(요약 유사도)를 낼 때 쓴다.
            phrase: 코드 없는 조건 문구를 이어 붙인 질의의 벡터
            k: 뽑을 후보 수

        Returns:
            뽑은 후보. 요약 유사도 내림차순이다.

        Raises:
            StoreError: 저장소를 읽지 못했을 때
        """
        ...

    def persona_items(
        self,
        phrases: Sequence[Sequence[float]],
        place_ids: Sequence[int],
        scope: Collection[str],
    ) -> list[dict[int, float]]:
        """문구마다 장소의 페르소나 항목(0~1)을 낸다.

        장소마다 만족한 손님 페르소나와 문구의 유사도 중 가장 큰 값을 구하고, 업종 범위
        안 기준 장소 `REFERENCE_PLACES`곳의 같은 값과 견준다(`persona_rank`). 기준 장소는
        요청과 상관없이 고정이라 같은 장소, 같은 문구면 늘 같은 값이다.

        Args:
            phrases: 문구 벡터
            place_ids: 값을 낼 장소
            scope: 업종 범위(`scoring.scope_of`)

        Returns:
            문구마다 장소 id → 페르소나 항목. 페르소나가 없는 장소는 없다.

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

    def details(self, place_ids: Sequence[int]) -> dict[int, PlaceDetails]:
        """장소마다 영업시간, 메뉴판, 가게 이름, 업종 이름, 가게 가격을 읽는다. 모임 계산이 쓴다.

        Args:
            place_ids: 장소 id

        Returns:
            장소 id별 정보. 저장소에 없는 id는 빠진다.

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
