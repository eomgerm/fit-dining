"""비교 검색 한 번. 요청 해석부터 카드 만들기까지 잇는다.

요청 해석 → 요청문 인코딩 → ① 후보 뽑기(장소 저장소) → ⓪ 취향 고르기 → ② 점수 →
③ 카드 만들기 순서다. 뽑힌 장소가 없으면 점수를 내지 않고 결과 없음 이유를 만든다.
LLM은 요청 해석에만 쓰고, 순서는 핏 점수로 정한다(docs/comparison/spec.md 3장). 후보를 거를
지역은 "이 지역에서 검색"이면 지도 영역만 쓰고, 그 밖에는 이번 요청에 말한 지역, 이전 요청의
지역, 사용자 위치에서 1km 안 순서로 정한다. 어느 것도 없으면 전국에서 찾는다. 이번 요청에 말한
지역은 해석이 낸 이번 요청의 조건(`Interpretation.turn`)에서 꺼낸다.
영업시간과 가격은 안 맞는다고 확인된 곳만 거르고, 메뉴는 그 메뉴를 판다고 확인된 곳만
남긴다(docs/comparison/spec.md 4.2).
HTTP 요청·응답 모양과 폴백 코드로 바꾸는 일은 API(`server/search.py`)가 한다.
"""

import re
import time
from collections.abc import Sequence
from dataclasses import dataclass, replace

import httpx

from fit_ai import embedding
from fit_ai.match.candidates import (
    CANDIDATE_K,
    GENERAL_K,
    Area,
    Candidate,
    MapBounds,
    OpenHours,
    PlaceFilter,
    PlaceStore,
    RadiusArea,
    RegionArea,
    StationArea,
    menu_key,
)
from fit_ai.match.cards import Card, build_card
from fit_ai.match.conditions import (
    CATEGORY_NAMES,
    CITY_BY_STATION,
    SERVED_STATIONS,
    STATION_NAMES,
)
from fit_ai.match.interpretation import (
    Conditions,
    Interpretation,
    interpret,
    station_code,
)
from fit_ai.match.interpretation.segments import (
    DAYS,
    Hours,
    Location,
    LocationKind,
    Menu,
    Price,
)
from fit_ai.match.scoring import baseline_for, scope_of, score_places
from fit_ai.match.taste_select import TasteProfile, select_tastes

FACILITY_PHRASES = {
    "PARKING": ("주차할 수 있는", "주차"),
    "WIFI": ("와이파이가 되는", "와이파이"),
    "GROUP": ("단체로 갈 수 있는", "단체"),
    "RESERVATION": ("예약할 수 있는", "예약"),
}
"""결과가 없을 때 문구에 쓰는 시설 말. (원인 문구, 제안 문구)다."""

PRICE_MARGIN = 0.1
"""가격 거르기 여유 폭. 가게 가격이 요청 금액을 이 비율까지 넘어도 남긴다("2만원 이하"면
22,000원까지). 가게 가격이 메뉴판으로 추정한 값이라 둔다. 시작값이다(2026-11-02)."""

NEXT_DAY_BEFORE = 6 * 60
"""이 시각 전의 마감 시각 요청은 다음 날 새벽으로 본다("새벽 2시까지"는 그날 26시)."""

BROAD_MENUS = frozenset(
    menu_key(word)
    for word in (
        *("커피", "음료", "음료수", "마실 것", "마실 거", "차"),
        *("술", "주류", "맥주", "소주", "와인", "칵테일", "사케", "안주"),
        *("디저트", "간식", "빵", "베이커리", "브런치"),
        *("고기", "해산물", "면", "면 요리", "국물", "국물 요리"),
        *("식사", "밥", "요리", "음식", "분식"),
        *("한식", "일식", "중식", "양식", "아시안", "매운 음식"),
    )
)
"""메뉴로 거르지 않는 넓은 말. 여러 메뉴를 묶어 부르는 말이라 메뉴판에 그 이름이 잘 오르지
않는다. 원본 300곳에서 커피 메뉴가 있는 카페 60곳 중 메뉴 이름에 "커피"가 든 곳은 14곳,
"선릉역 디저트 카페" 32곳 중 메뉴 이름에 "디저트"가 든 곳은 0곳이었다(2026-11-03). 넓은 말과
메뉴를 잇는 사전은 보류했다. 그때까지 업종과 요청문 유사도로만 찾는다. 음식 종류는 메뉴가
아니지만 LLM이 메뉴로 낼 때를 막으려고 넣는다."""

_REGION = re.compile(r"[가-힣]+?(\d*)([동구시군읍면])")
"""동·구·시·군·읍·면 이름. "역삼1동"처럼 숫자가 붙은 행정동도 받는다. 구가 없는 시(구미시)와
읍·면(선산읍)은 장소의 `district`·`dong`과 맞춘다. 장소가 없는 이름은 거른 뒤 비면 준비 중인
지역으로 안내한다. 그 밖의 동네·랜드마크(가로수길, 코엑스)는 장소 데이터에 없어 거르지 못한다."""

_STATION_CODES = {name: code for code, name in STATION_NAMES.items()}
"""서비스 역 이름("강남역")으로 역 코드를 찾는 표"""


class EmbeddingError(Exception):
    """요청문을 벡터로 바꾸지 못했다. torch 오류(CUDA 메모리 부족 등)나 모델 파일 오류다."""


@dataclass(frozen=True)
class UserLocation:
    """사용자 위치(기기 위치). 조건과 로그에 남기지 않는다.

    Attributes:
        lat: 위도
        lng: 경도
    """

    lat: float
    lng: float


@dataclass(frozen=True)
class SearchRequest:
    """검색 요청 하나.

    Attributes:
        query: 사용자가 이번에 입력한 요청문
        previous: 후속 조건이면 기준 요청의 조건. 새 검색이면 None이다.
        taste: 사용자 취향 프로필. 취향이 없거나 읽지 못했으면 None이다.
        bounds: "이 지역에서 검색"으로 고른 지도 영역. 오면 요청문에 든 지역과 이전 요청의
            지역을 보지 않고 이 영역으로만 거른다. 버튼이 아닌 요청에 함께 온 지도 영역은
            API가 넘기지 않는다(`mapFirst`, docs/comparison/api.md).
        previous_bounds: 이전 요청이 "이 지역에서 검색"으로 고른 지도 영역. 이번 요청에
            지역을 말하지 않았으면 이전 요청의 지역으로 쓴다.
        location: 사용자 위치. FE가 얻었으면 온다. 이번 요청에도 이전 요청에도 지역이
            없거나 "근처"를 말했으면 이 위치에서 반경(`NEARBY_RADIUS_M`) 안으로 거른다.
        rules_only: 참이면 해석 LLM을 부르지 않고 규칙으로만 해석한다. 첫 화면 주변 카드의
            고정 문장("근처 맛집")에 쓴다.
    """

    query: str
    previous: Conditions | None = None
    taste: TasteProfile | None = None
    bounds: MapBounds | None = None
    previous_bounds: MapBounds | None = None
    location: UserLocation | None = None
    rules_only: bool = False


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
class _Where:
    """후보를 거를 곳.

    Attributes:
        areas: 거를 지역. 비어 있으면 전국에서 찾는다.
        unready: 장소 데이터에 없어 거르지 못하는 지역(랜드마크 등)의 이름
        kept: 다음 후속 요청이 이전 요청의 지역으로 쓸 지도 영역. "이 지역에서 검색"으로
            고른 영역으로 거를 때만 있다.
    """

    areas: tuple[Area, ...] = ()
    unready: tuple[str, ...] = ()
    kept: MapBounds | None = None


@dataclass(frozen=True)
class SearchTrace:
    """검색 한 번의 기록(docs/comparison/spec.md 5장).

    공개 전에 결과를 확인할 때와 나중에 라벨링할 때 쓴다. 요청 해석의 기록은
    `Interpretation`에 있다.

    Attributes:
        embed_seconds: 요청문 인코딩에 걸린 시간(초)
        store_seconds: 후보 뽑기에 걸린 시간(초)
        candidates: 뽑힌 후보 수
        score_seconds: 점수를 내는 데 걸린 시간(초). 기준을 만들 장소 전체를 읽는 시간을
            포함한다. 후보가 없으면 0이다.
    """

    embed_seconds: float
    store_seconds: float
    candidates: int
    score_seconds: float = 0.0


@dataclass(frozen=True)
class SearchResult:
    """검색 결과.

    Attributes:
        interpretation: 요청 해석 결과
        cards: 카드 목록. 핏 점수 내림차순이다. 뽑힌 장소가 없으면 비어 있다.
        empty_reason: 뽑힌 장소가 없을 때 원인과 제안. 있으면 None이다.
        invalid_place_ids: 프로필을 읽지 못해 뺀 장소의 id
        trace: 이번 검색의 기록
        bounds: 다음 후속 요청이 이전 요청의 지역으로 쓸 지도 영역
            (`SearchRequest.previous_bounds`). "이 지역에서 검색"으로 고른 영역으로 걸렀을
            때만 있다.
        nationwide: 전국에서 찾았는지. 지도 영역, 말한 지역, 이전 요청의 지역, 사용자 위치가
            모두 없어 거를 지역이 하나도 없을 때 참이다. FE는 위치를 확인할 수 없어 전체
            지역 결과를 보여 준다고 알린다.
    """

    interpretation: Interpretation
    cards: tuple[Card, ...]
    empty_reason: EmptyReason | None
    invalid_place_ids: tuple[int, ...]
    trace: SearchTrace
    bounds: MapBounds | None = None
    nationwide: bool = False


def search(
    request: SearchRequest,
    store: PlaceStore,
    timeout: float = 5.0,
    client: httpx.Client | None = None,
) -> SearchResult:
    """검색 한 번을 한다.

    Args:
        request: 검색 요청
        store: 장소 저장소
        timeout: 요청 해석이 GMS를 한 번 부를 때 기다리는 시간(초)
        client: GMS 연결을 다시 쓰는 HTTP 클라이언트. 없으면 부를 때마다 만든다.

    Returns:
        카드 목록과 해석 결과, 기록

    Raises:
        EmbeddingError: 요청문을 벡터로 바꾸지 못했을 때
        StoreError: 장소 저장소를 읽지 못했을 때
    """
    interpretation = interpret(
        request.query,
        request.previous,
        timeout,
        client,
        rules_only=request.rules_only,
    )
    if request.bounds is not None:
        # 지도 영역은 "이 지역에서 검색"에만 오고 오면 지도 영역으로만 거른다. 지도 영역이 이긴
        # 요청문 속 지역은 조건에서 뺀다. 남기면 다음 후속 요청이 그 지역으로 돌아간다.
        interpretation = replace(
            interpretation, conditions=replace(interpretation.conditions, locations=())
        )
    conditions = interpretation.conditions
    where = _where(conditions, interpretation.turn, request)
    if where.unready and not where.areas:
        # 거를 수 있는 지역 없이 랜드마크만 말했으면 어디서 찾을지 몰라 찾지 않는다.
        reason = empty_reason(conditions, unready=where.unready)
        return SearchResult(interpretation, (), reason, (), SearchTrace(0.0, 0.0, 0))
    # 거를 지역이 하나도 없으면 전국에서 찾는다(docs/comparison/spec.md 4.2).
    nationwide = not where.areas

    start = time.perf_counter()
    query = _encode(conditions.embedding_text)
    embed_seconds = time.perf_counter() - start

    start = time.perf_counter()
    found = store.find(_place_filter(conditions, where.areas), query, CANDIDATE_K)
    trace = SearchTrace(
        embed_seconds, time.perf_counter() - start, len(found.candidates)
    )

    if not found.candidates:
        unready = _unready(store, where, query)
        reason = empty_reason(conditions, where.areas, unready)
        return SearchResult(
            interpretation, (), reason, found.invalid, trace, where.kept, nationwide
        )
    start = time.perf_counter()
    cards = _score_cards(found.candidates, conditions, request.taste, store)
    trace = replace(trace, score_seconds=time.perf_counter() - start)
    return SearchResult(
        interpretation, cards, None, found.invalid, trace, where.kept, nationwide
    )


def empty_reason(
    conditions: Conditions,
    areas: Sequence[Area] = (),
    unready: Sequence[str] = (),
) -> EmptyReason:
    """뽑힌 장소가 없을 때 원인과 제안을 만든다.

    Args:
        conditions: 해석한 조건
        areas: 후보를 거른 지역. 비어 있으면 위치로 거르지 않았다(전국 검색).
        unready: 장소 데이터가 없어 결과가 없는 지역의 이름. 있으면 다른 조건보다 앞서
            준비 중인 지역이라고 한다.

    Returns:
        원인과 제안
    """
    if unready:
        names = "·".join(unready)
        served = ", ".join(STATION_NAMES[code] for code in SERVED_STATIONS)
        return EmptyReason(
            f"{names}{_topic(names)} 아직 준비 중인 지역이에요",
            f"{served} 근처에서 찾아 보세요",
        )
    in_map_bounds = any(isinstance(area, MapBounds) for area in areas)
    where = "이 지역" if in_map_bounds else "·".join(map(_area_label, areas)) or None
    what = CATEGORY_NAMES.get(conditions.category_group or "", "가게")
    scope = f"{where} {what}" if where else what
    menus = [m.value for m in conditions.menus if menu_terms((m,))]
    if menus:
        names = "·".join(menus)
        both = " 모두" if len(menus) > 1 else ""
        return EmptyReason(
            f"{scope} 중 {names}{_object(names)}{both} 파는 곳이 없어요",
            "메뉴를 바꾸거나 빼고 다시 찾아 보세요",
        )
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
    if open_hours(conditions.hours) is not None:
        return EmptyReason(
            f"{scope} 중 요청한 시간에 여는 곳이 없어요",
            "영업시간 조건을 빼고 다시 찾아 보세요",
        )
    if price_range(conditions.price) != (None, None):
        return EmptyReason(
            f"{scope} 중 요청한 가격대인 곳이 없어요",
            "가격 조건을 빼고 다시 찾아 보세요",
        )
    if in_map_bounds:
        return EmptyReason(
            f"{scope} 중 조건에 맞는 곳이 없어요",
            "지도를 옮기거나 넓혀서 다시 찾아 보세요",
        )
    if any(
        isinstance(area, StationArea) and (area.walk_minutes or area.exit)
        for area in areas
    ):
        return EmptyReason(
            f"{scope} 중 조건에 맞는 곳이 없어요",
            "도보 거리나 출구 조건을 빼고 다시 찾아 보세요",
        )
    return EmptyReason(
        f"{scope} 중 조건에 맞는 곳이 없어요", "다른 역이나 업종으로 다시 찾아 보세요"
    )


def _area_label(area: Area) -> str:
    """결과 없음 문구에 쓰는 지역 이름("강남역 11번 출구", "역삼역 도보 5분", "내 주변")."""
    match area:
        case StationArea():
            exit_text = f" {area.exit}번 출구" if area.exit else ""
            walk_text = f" 도보 {area.walk_minutes}분" if area.walk_minutes else ""
            return f"{area.name}{exit_text}{walk_text}"
        case RegionArea():
            return area.name
        case MapBounds():
            return "이 지역"
        case RadiusArea():
            return "내 주변"


def _topic(word: str) -> str:
    """주제 조사. 받침이 있으면 "은", 없으면 "는"이다. 한글이 아니면 "은(는)"이다."""
    last = word[-1] if word else ""
    if not "가" <= last <= "힣":
        return "은(는)"
    return "은" if (ord(last) - ord("가")) % 28 else "는"


def _object(word: str) -> str:
    """목적 조사. 받침이 있으면 "을", 없으면 "를"이다. 한글이 아니면 "을(를)"이다."""
    last = word[-1] if word else ""
    if not "가" <= last <= "힣":
        return "을(를)"
    return "을" if (ord(last) - ord("가")) % 28 else "를"


def _where(
    conditions: Conditions,
    turn: Conditions | None,
    request: SearchRequest,
) -> _Where:
    """후보를 거를 곳을 정한다.

    지도 영역은 "이 지역에서 검색"에만 오므로 오면 지도 영역만 쓴다. 그 밖에는 이번 요청에
    말한 지역, 이전 요청의 지역, 사용자 위치에서 반경 안 순서로 앞선다. 어느 것도 없으면
    거를 곳이 없다(전국에서 찾는다. 2026-11-09 결정, docs/comparison/spec.md 4.2).
    이전 요청이 "이 지역에서 검색"이었으면 그 지도 영역이 이전 요청의 지역이다. 그 요청은
    조건에서 지역을 빼므로 이전 요청의 지역은 지도 영역과 말한 지역 중 하나만 있다. 그래서
    "강남역 카페"를 찾고 지도를 옮겨 "이 지역에서 검색"을 누르면 지도 영역으로 찾고, 이어서
    "조용한 곳으로"라고 하면 같은 지도 영역에서, "선릉역으로"라고 하면 선릉역에서 찾는다.
    이번 요청에 말한 지역은 해석이 낸 이번 요청의 조건(`turn`, `Interpretation.turn`)에서
    바로 꺼낸다. 어딘지 알 수 없는 곳("회사 근처")과 위치가 없을 때의 "근처"는 말하지 않은
    것으로 본다.

    Args:
        conditions: 이전 조건과 합친 조건
        turn: 이번 요청의 조건(`Interpretation.turn`). None이면 `conditions`와 같다(새 검색).
        request: 검색 요청. 지도 영역, 이전 요청의 지도 영역, 사용자 위치를 꺼낸다.
    """
    if request.bounds is not None:
        return _Where((request.bounds,), kept=request.bounds)
    here = (
        RadiusArea(request.location.lat, request.location.lng)
        if request.location is not None
        else None
    )
    said = _known((turn or conditions).locations, here)
    if said:
        return _areas(said, here)
    if request.previous_bounds is not None:
        return _Where((request.previous_bounds,), kept=request.previous_bounds)
    previous = _known(conditions.locations, here)
    if previous:
        return _areas(previous, here)
    if here is not None:
        return _Where((here,))
    return _Where()


def _known(locations: Sequence[Location], here: RadiusArea | None) -> list[Location]:
    """어딘지 아는 지역 조각. 어딘지 알 수 없는 곳("회사 근처")을 빼고, 사용자 위치가
    없으면 "근처"도 뺀다."""
    return [
        loc
        for loc in locations
        if loc.kind is not LocationKind.UNKNOWN
        and (loc.kind is not LocationKind.HERE or here is not None)
    ]


def _areas(locations: Sequence[Location], here: RadiusArea | None) -> _Where:
    """지역 조각을 거르기 지역으로 바꾼다.

    역은 역 지역, 동·구·시·군·읍·면은 행정 구역이다. 서비스 역 이름을 동네로 낸 것("강남",
    "서면")은 시·군·읍·면·동·구로 끝나도 역으로 본다. 역 이름이 곧 시 이름인 시("구미")는
    "역" 없이 말하고 도보 거리·출구 조건이 없으면 시 전체도 더한다(`CITY_BY_STATION`).
    그 밖의 동네·랜드마크는 장소 데이터에 없어 거르지 못하는 지역으로 둔다(2026-11-02
    결정). 근처("여기")는 사용자 위치에서 반경 안이다. 위치가 없으면 넣지 않는다.
    """
    areas: list[Area] = []
    unready: list[str] = []
    for loc in locations:
        name = _plain(loc.value or loc.text)
        station = name.removesuffix("역") + "역"
        region = _REGION.fullmatch(name)
        if loc.kind is LocationKind.STATION or (
            loc.kind is LocationKind.AREA and station in _STATION_CODES
        ):
            code = station_code(loc) or _STATION_CODES.get(station)
            name = STATION_NAMES[code] if code else station
            areas.append(StationArea(name, code, loc.walk_minutes, loc.exit))
            city = CITY_BY_STATION.get(code or "")
            if (
                city
                and "역" not in _plain(loc.text)
                and not (loc.walk_minutes or loc.exit)
            ):
                # "구미"라고만 하면 역 근처가 아니라 시 전체를 뜻한다. 역에서 재는 조건이 없을 때만 더한다.
                areas.append(RegionArea(city))
        elif loc.kind is LocationKind.AREA and region:
            # 행정동("역삼1동")은 장소 데이터의 법정동("역삼동")으로 찾는다.
            name = name[: region.start(1)] + region.group(2)
            code = _STATION_CODES.get(name.removesuffix("동") + "역")
            areas.append(RegionArea(name, code))
        elif loc.kind is LocationKind.AREA:
            unready.append(loc.value or loc.text)
        elif loc.kind is LocationKind.HERE and here is not None:
            areas.append(here)
    return _Where(tuple(dict.fromkeys(areas)), tuple(dict.fromkeys(unready)))


def _unready(
    store: PlaceStore, where: _Where, query: Sequence[float]
) -> tuple[str, ...]:
    """결과가 없을 때 지역 탓인지 본다.

    거른 역·동·사용자 위치 반경이 모두 장소가 하나도 없는 곳이면 그 이름(랜드마크 포함)을
    낸다. 사용자 위치 반경은 "내 주변"이다(서비스 지역 밖에 있을 때). 지도 영역으로
    걸렀거나 장소가 있는 지역이 하나라도 있으면 다른 조건 탓이라 빈 튜플이다. 결과가 없을
    때만 지역마다 한 곳씩 더 찾아본다.

    Raises:
        StoreError: 장소 저장소를 읽지 못했을 때
    """
    if any(isinstance(area, MapBounds) for area in where.areas):
        return ()
    named = [
        a for a in where.areas if isinstance(a, StationArea | RegionArea | RadiusArea)
    ]
    if not named or any(_has_places(store, area, query) for area in named):
        return ()
    names = (_area_label(a) if isinstance(a, RadiusArea) else a.name for a in named)
    return (*where.unready, *names)


def _has_places(
    store: PlaceStore,
    area: StationArea | RegionArea | RadiusArea,
    query: Sequence[float],
) -> bool:
    """지역에 검색할 수 있는 장소가 하나라도 있는지. 도보 거리와 출구는 보지 않는다."""
    if isinstance(area, StationArea):
        area = replace(area, walk_minutes=None, exit=None)
    found = store.find(PlaceFilter(areas=(area,)), query, 1)
    return bool(found.candidates or found.invalid)


def _plain(text: str) -> str:
    """띄어쓰기를 지운 말"""
    return "".join(text.split())


def _encode(text: str) -> list[float]:
    """요청문을 공유 모듈 `fit_ai.embedding`으로 인코딩한다(서버에서는 Modal 원격 호출)."""
    try:
        [query] = embedding.encode_queries([text])
    except embedding.EmbeddingUnavailable as e:
        # 원격 실패는 메시지가 실패 종류(`HTTP 401` 등)뿐이라 그대로 남긴다.
        raise EmbeddingError(str(e)) from e
    except (RuntimeError, OSError, ValueError) as e:
        # 메시지에 요청문이 섞일 수 있어 종류만 남긴다.
        raise EmbeddingError(type(e).__name__) from e
    return query


def open_hours(hours: Sequence[Hours]) -> OpenHours | None:
    """시간 조각을 영업시간 조건 하나로 합친다.

    "일요일"과 "새벽까지"처럼 나뉘어 와도 "일요일 새벽 2시까지"로 본다. 요일이 여럿이면
    그중 하루라도 맞으면 된다. 시각이 여럿이면 가장 늦은 마감과 가장 이른 시작을 쓴다.
    "지금 영업 중"(`now`)은 거르지 않는다. 검색 시각이 필요하고, BE가 카드에 영업 상태를
    붙인다.

    Args:
        hours: 시간 조각

    Returns:
        영업시간 조건. 요일도 시각도 없으면 None이다.
    """
    days = tuple(dict.fromkeys(h.day for h in hours if h.day in DAYS))
    untils = [m for h in hours if (m := _clock_minutes(h.open_until)) is not None]
    sinces = [m for h in hours if (m := _clock_minutes(h.open_from)) is not None]
    until = max(
        (m + 24 * 60 if m < NEXT_DAY_BEFORE else m for m in untils), default=None
    )
    since = min(sinces, default=None)
    if not days and until is None and since is None:
        return None
    return OpenHours(days, until, since)


def price_range(price: Price | None) -> tuple[int | None, int | None]:
    """가격 조각을 거를 가게 가격 범위로 바꾼다. 양쪽에 여유 폭(`PRICE_MARGIN`)을 둔다.

    "저렴한"(`cheap`)은 거르지 않는다. 같은 업종 안에서 견주는 점수로 쓸 예정이다.

    Args:
        price: 가격 조각. 요청에 없으면 None이다.

    Returns:
        (하한, 상한) 원. 없는 쪽은 None이다.
    """
    if price is None:
        return None, None
    low, high = price.min_won, price.max_won
    return (
        None if low is None else round(low * (1 - PRICE_MARGIN)),
        None if high is None else round(high * (1 + PRICE_MARGIN)),
    )


def menu_terms(menus: Sequence[Menu]) -> tuple[tuple[str, ...], ...]:
    """메뉴 조각을 메뉴 거르기의 찾을 말로 바꾼다.

    원하는 메뉴마다 사용자 말, 표준 이름, 다른 표기를 `menu_key` 꼴로 바꿔 한 묶음으로
    둔다. 묶음 중 하나라도 메뉴판에 있으면 그 메뉴를 판다고 본다. 사용자 말이나 표준 이름이
    넓은 말(`BROAD_MENUS`)이면 거르지 않는다. 피하는 메뉴("오이 빼고")도 거르지 않는다.
    그 메뉴가 메뉴판에 있어도 빼 달라는 뜻은 아니어서다.

    Args:
        menus: 메뉴 조각

    Returns:
        메뉴마다 찾을 말. 거를 메뉴가 없으면 빈 튜플이다.
    """
    terms = []
    for menu in menus:
        if not menu.want or {menu_key(menu.text), menu_key(menu.value)} & BROAD_MENUS:
            continue
        words = (menu_key(w) for w in (menu.text, menu.value, *menu.spellings))
        terms.append(tuple(dict.fromkeys(w for w in words if w)))
    return tuple(dict.fromkeys(words for words in terms if words))


def _clock_minutes(clock: str | None) -> int | None:
    """시각("HH:MM")을 0시부터 센 분으로 바꾼다. 없거나 모양이 틀리면 None이다."""
    hour, _, minute = (clock or "").partition(":")
    if not (hour.isdigit() and minute.isdigit()):
        return None
    return int(hour) * 60 + int(minute)


def _place_filter(conditions: Conditions, areas: tuple[Area, ...]) -> PlaceFilter:
    """해석한 조건과 거를 지역으로 거르기 조건을 만든다."""
    min_price, max_price = price_range(conditions.price)
    return PlaceFilter(
        category_group=conditions.category_group,
        areas=areas,
        facilities=conditions.facilities,
        excluded_categories=conditions.avoid_categories,
        hours=open_hours(conditions.hours),
        min_price=min_price,
        max_price=max_price,
        menus=menu_terms(conditions.menus),
    )


def _score_cards(
    candidates: Sequence[Candidate],
    conditions: Conditions,
    taste: TasteProfile | None,
    store: PlaceStore,
) -> tuple[Card, ...]:
    """⓪ 취향을 고르고 ② 점수를 내서 ③ 카드를 만든다. 점수순으로 돌려줄 수만큼 자른다.

    Raises:
        StoreError: 점수 기준을 만들 장소를 읽지 못했을 때
    """
    tastes = (
        select_tastes(
            taste.features,
            conditions.codes,
            menu_requested=bool(menu_terms(conditions.menus)),
        )
        if taste
        else ()
    )
    scored = score_places(
        candidates,
        conditions.codes,
        tastes,
        scope_of(conditions.category_group, conditions.avoid_categories),
        baseline_for(store.places()),
    )
    return tuple(build_card(s) for s in scored[:GENERAL_K])
