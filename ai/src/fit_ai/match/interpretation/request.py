"""요청 해석 결과의 모양. 조건(`Conditions`)과 해석 결과(`Interpretation`), 그리고 규칙 해석,
LLM 해석, 코드 확인이 같이 쓰는 값과 함수(조각을 모아 조건 만들기 등)를 둔다.

밑줄로 시작하는 이름은 이 패키지(`fit_ai.match.interpretation`) 안에서만 쓴다.
"""

import re
from dataclasses import dataclass

from fit_ai.features import FEATURES
from fit_ai.match.conditions import CATEGORY_NAMES, CONDITIONS, STATION_NAMES, Layer
from fit_ai.match.interpretation.segments import (
    MAX_SEGMENTS,
    FeatureText,
    Hours,
    Location,
    LocationKind,
    Menu,
    PlaceName,
    Price,
)

MAX_TEXT_LENGTH = 400
"""합친 요청문 길이 상한. 후속 조건이 쌓여도 정렬 LLM 입력이 커지지 않게 한다."""


MAX_CODES = 30
"""조건 코드 수 상한"""


GROUP_SIZE = 4
"""이 인원 이상이면 모임(`PURPOSE_GROUP`)으로 본다. 임시 값이다."""


CODE_PHRASES: dict[str, str] = {
    **{code: feature.phrase for code, feature in FEATURES.items()},
    **{
        condition.id: condition.label
        for condition in CONDITIONS.values()
        if condition.layer is Layer.FACILITY
    },
}
"""해석이 낼 수 있는 조건 코드와 LLM에 보여 줄 문구. 취향 코드표와 시설 코드다."""


FOOD_TYPES = (
    "FOOD_KOREAN",
    "FOOD_JAPANESE",
    "FOOD_CHINESE",
    "FOOD_WESTERN",
    "FOOD_ASIAN",
)
"""음식 종류 코드"""


FOOD_CODES = (*FOOD_TYPES, "FOOD_SPICY")
"""음식 코드. 음식 종류와 매운맛이다. 빼 달라는 음식(`Conditions.avoid_foods`)은 이 코드만
받는다."""


STATION_CODES = {
    **{name: code for code, name in STATION_NAMES.items()},
    **{name.removesuffix("역"): code for code, name in STATION_NAMES.items()},
}
"""서비스 역 이름("강남역", "강남")으로 역 코드를 찾는 표"""


STATION_WORDS = {"강남": "GANGNAM", "역삼": "YEOKSAM", "선릉": "SEOLLEUNG"}
"""규칙 해석에서 역을 찾는 낱말"""


_LOCATION = re.compile(
    rf"(?:{'|'.join(STATION_WORDS)})[역동]?(?:\s*(?:근처|주변|부근|인근|쪽))?(?:에서|에|의)?"
    r"|(?:내\s*|지금\s*)?(?:근처|주변|부근|인근)(?:에서|에|의)?|가까운"
)
"""벡터용 문장에서 지울 위치 말. 역 이름(뒤의 "역", "근처", 조사 포함)과 근처를 뜻하는
말이다. 위치는 거르기(역, 지도 영역)가 맡는다. 벡터에 남으면 이름이나 요약에 역 이름이
든 장소가 요청과 상관없이 올라간다(10-28 실제 장소 62곳 측정)."""


MAX_WALK_MINUTES = 60
"""지역 조각의 도보 거리 상한(분). 넘으면 거리가 없는 것으로 본다."""


@dataclass(frozen=True)
class Conditions:
    """해석한 검색 조건. FE가 다음 후속 조건 때 그대로 돌려보낸다.

    요청을 분류별로 나눈 결과다(`segments` 모듈 설명). `locations`부터 뒤의 필드는 2차에
    더했다. 그 전에 만든 이전 조건에는 없으므로 모두 기본값이 있다.

    Attributes:
        text: 해석한 요청문. 후속 조건이면 이전 요청과 합친 한 문장이다.
        embedding_text: 후보 추출에 쓸 문장. 부정 표현을 긍정형으로 바꿨고 위치 말(역
            이름, 근처, 지역 원문)은 뺐다.
        codes: 원하는 조건 코드. 취향 코드표의 코드(음식 종류·매운맛 포함)와 시설
            코드다. 인원은 목적 코드로 넣었다. 메뉴에서 음식 종류를 짐작해 넣지 않는다.
        category_group: 업종. 요청에 없으면 None이다.
        station: 지역 중 처음 나온 서비스 역. 없으면 None이다. 장소 저장소가 지역을 여러
            개 거르기 전까지 쓰는 값이다.
        nearby: 근처 검색인지. 서비스 역 없이 "여기"(`LocationKind.HERE`)를 말했으면 참이다.
        locations: 지역. 여럿이면 그중 하나에 들면 된다.
        menus: 메뉴. 피하는 메뉴("오이 빼고")는 `want`가 거짓이다.
        hours: 시간
        price: 가격. 요청에 없으면 None이다.
        place_name: 가게 이름. 요청에 없으면 None이다.
        features: 코드표에 없는 특징
        avoid_categories: 빼 달라는 업종("카페 말고")
        avoid_foods: 빼 달라는 음식 종류·매운맛 코드("일식 말고", "매운 거 빼고").
            음식 코드(`FOOD_CODES`)만 둔다.
    """

    text: str
    embedding_text: str
    codes: tuple[str, ...] = ()
    category_group: str | None = None
    station: str | None = None
    nearby: bool = False
    locations: tuple[Location, ...] = ()
    menus: tuple[Menu, ...] = ()
    hours: tuple[Hours, ...] = ()
    price: Price | None = None
    place_name: PlaceName | None = None
    features: tuple[FeatureText, ...] = ()
    avoid_categories: tuple[str, ...] = ()
    avoid_foods: tuple[str, ...] = ()

    @property
    def corrections(self) -> tuple[tuple[str, str], ...]:
        """지역과 가게 이름에서 고친 말(원문, 표준 이름). 응답에 알려 사용자가 잘못 고친
        것을 알아챌 수 있게 한다. "역삼"→"역삼역"처럼 한쪽이 다른 쪽에 들어 있으면 고친
        것으로 보지 않는다."""
        segments = (*self.locations, self.place_name)
        return tuple(
            (s.text, s.value)
            for s in segments
            if s is not None
            and s.value
            and _plain(s.value) not in _plain(s.text)
            and _plain(s.text) not in _plain(s.value)
        )

    @property
    def facilities(self) -> tuple[str, ...]:
        """요청한 시설 코드. 장소 저장소가 그 시설이 없다고 확인된 장소를 빼고, 결과가
        없을 때 이유 문구에도 쓴다."""
        return tuple(
            code
            for code in self.codes
            if code in CONDITIONS and CONDITIONS[code].layer is Layer.FACILITY
        )


@dataclass(frozen=True)
class Interpretation:
    """요청 해석 결과.

    Attributes:
        conditions: 해석한 조건
        change_summary: 후속 조건에서 바뀐 점. 새 검색이면 None이다.
        llm_error: 규칙으로 해석한 이유. LLM으로 해석했으면 None이다.
        llm_seconds: LLM 호출에 걸린 시간(초)
        gms_failed: GMS 호출 자체가 실패했는지(꺼짐 포함). 출력 검사에 걸린 것과
            다르다. 검색은 이때 정렬 LLM을 부르지 않는다.
    """

    conditions: Conditions
    change_summary: str | None
    llm_error: str | None = None
    llm_seconds: float | None = None
    gms_failed: bool = False


def locations_of(conditions: Conditions) -> tuple[Location, ...]:
    """조건의 지역을 꺼낸다. 1차에 만든 조건은 지역 조각이 없으므로 역과 근처로 만든다.

    Args:
        conditions: 해석한 조건. FE가 돌려보낸 1차 꼴의 이전 조건일 수 있다.

    Returns:
        지역 조각. 지역이 없으면 빈 튜플이다.
    """
    if conditions.locations:
        return conditions.locations
    if conditions.station in STATION_NAMES:
        name = STATION_NAMES[conditions.station]
        return (Location(name, LocationKind.STATION, name),)
    if conditions.nearby:
        return (Location("근처", LocationKind.HERE),)
    return ()


def _assemble(
    *,
    text: str,
    embedding_text: str,
    codes: list[str],
    category_group: str | None,
    locations: tuple[Location, ...],
    menus: tuple[Menu, ...],
    hours: tuple[Hours, ...],
    price: Price | None,
    place_name: PlaceName | None,
    features: tuple[FeatureText, ...],
    avoid_categories: tuple[str, ...],
    avoid_foods: tuple[str, ...],
) -> Conditions:
    """조각을 모아 조건을 만든다. LLM 해석과 규칙 해석이 같이 쓴다.

    빼 달라는 음식 코드는 원하는 코드에서 뺀다. 역은 지역 중 처음 나온 서비스 역이고,
    근처 검색은 서비스 역 없이 "여기"를 말했을 때다. 동네·랜드마크 원문은 벡터용 문장에서
    지운다.
    """
    avoided = tuple(dict.fromkeys(c for c in avoid_foods if c in FOOD_CODES))
    station = next((s for s in map(station_code, locations) if s is not None), None)
    nearby = station is None and any(loc.kind is LocationKind.HERE for loc in locations)
    for loc in locations:
        if loc.kind is LocationKind.STATION or loc.text not in embedding_text:
            continue
        stripped = embedding_text.replace(loc.text, " ")
        embedding_text = (
            stripped
            if any(ch.isalnum() for ch in stripped)
            else CATEGORY_NAMES.get(category_group or "", embedding_text)
        )
    return Conditions(
        text=text.strip()[:MAX_TEXT_LENGTH],
        embedding_text=_without_location(embedding_text, category_group).strip()[
            :MAX_TEXT_LENGTH
        ],
        codes=tuple(c for c in _known_codes(codes) if c not in avoided),
        category_group=category_group,
        station=station,
        nearby=nearby,
        locations=tuple(dict.fromkeys(locations))[:MAX_SEGMENTS],
        menus=menus,
        hours=tuple(dict.fromkeys(hours))[:MAX_SEGMENTS],
        price=price,
        place_name=place_name,
        features=features,
        avoid_categories=tuple(
            dict.fromkeys(c for c in avoid_categories if c != category_group)
        ),
        avoid_foods=avoided,
    )


def station_code(location: Location) -> str | None:
    """지역이 서비스 역이면 역 코드를 낸다. 표준 이름이 틀렸으면 원문으로 한 번 더 찾는다.

    역 이름과 같은 동("역삼동")은 그 역으로 본다. 동 정보가 없는 장소를 1차처럼 그 역으로
    거르려고 쓴다.

    Args:
        location: 지역 조각

    Returns:
        서비스 역 코드(`GANGNAM` 등). 서비스 역이 아니면 None이다.
    """
    if location.kind is LocationKind.AREA:
        value = _plain(location.value or location.text)
        return next(
            (code for word, code in STATION_CODES.items() if value == f"{word}동"), None
        )
    if location.kind is not LocationKind.STATION:
        return None
    for name in (location.value, location.text):
        if name is None:
            continue
        for word, code in STATION_CODES.items():
            # "강남역 근처"처럼 원문에 다른 말이 붙어 있어도 역 이름으로 시작하면 그 역이다.
            if _plain(name) == word or _plain(name).startswith(f"{word}역"):
                return code
    return None


def _plain(text: str) -> str:
    """띄어쓰기를 지운 말. 표준 이름과 원문을 견줄 때 쓴다."""
    return "".join(text.split())


def _without_location(text: str, category_group: str | None) -> str:
    """벡터용 문장에서 위치 말을 지운다.

    지우고 남는 글자가 없으면("강남역", "근처") 업종 이름으로, 업종도 없으면 지우기 전
    문장으로 대신한다. 빈 문장을 인코딩하면 유사도가 무의미해진다.
    """
    stripped = " ".join(_LOCATION.sub(" ", text).split())
    if any(ch.isalnum() for ch in stripped):
        return stripped
    return CATEGORY_NAMES.get(category_group or "", text)


def _known_codes(codes: list) -> tuple[str, ...]:
    """아는 코드만 처음 나온 순서대로 한 번씩 남긴다."""
    known = [code for code in codes if isinstance(code, str) and code in CODE_PHRASES]
    return tuple(dict.fromkeys(known))[:MAX_CODES]


def _join(before: str, after: str) -> str:
    """이전 문장 뒤에 새 요청을 붙인다. 너무 길면 새 요청만 남긴다."""
    joined = f"{before} {after}"
    return joined if len(joined) <= MAX_TEXT_LENGTH else after[:MAX_TEXT_LENGTH]
