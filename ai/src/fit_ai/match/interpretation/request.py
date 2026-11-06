"""요청 해석 결과의 모양. 조건(`Conditions`)과 해석 결과(`Interpretation`), 그리고 규칙 해석,
LLM 해석, 코드 확인이 같이 쓰는 값과 함수(조각을 모아 조건 만들기 등)를 둔다.

밑줄로 시작하는 이름은 이 패키지(`fit_ai.match.interpretation`) 안에서만 쓴다.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass

from fit_ai.features import FEATURES
from fit_ai.match.conditions import CATEGORY_NAMES, CONDITIONS, STATION_NAMES, Layer
from fit_ai.match.interpretation.codes import (
    avoided_codes,
    score_codes,
    split_codes,
)
from fit_ai.match.interpretation.segments import (
    MAX_SEGMENTS,
    Choice,
    Feature,
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


CODE_PHRASES: dict[str, str] = {
    **{code: feature.phrase for code, feature in FEATURES.items()},
    **{
        condition.id: condition.label
        for condition in CONDITIONS.values()
        if condition.layer is Layer.FACILITY
    },
}
"""해석이 낼 수 있는 조건 코드와 LLM에 보여 줄 문구. 취향 코드표와 시설 코드다."""


STATION_CODES = {
    **{name: code for code, name in STATION_NAMES.items()},
    **{name.removesuffix("역"): code for code, name in STATION_NAMES.items()},
}
"""서비스 역 이름("강남역", "강남")으로 역 코드를 찾는 표"""


_EVERYDAY_WORDS = frozenset({"구미", "서면", "사상", "하단", "동래", "삼성", "교대"})
"""역 이름이 일상말이나 메뉴·결제 이름에도 쓰이는 낱말("구미가 당기는", "서면으로", "사상 최고",
"하단 메뉴", "동래파전", "삼성페이", "교대 근무"). 규칙 해석은 이 낱말을 "구미역"처럼 역을
붙여 말했을 때만 역으로 읽는다."""

STATION_WORDS = dict(
    sorted(
        (
            (
                name
                if name.removesuffix("역") in _EVERYDAY_WORDS
                else name.removesuffix("역"),
                code,
            )
            for code, name in STATION_NAMES.items()
        ),
        # 정규식이 짧은 낱말에 먼저 걸리지 않게 긴 낱말부터 둔다
        key=lambda item: -len(item[0]),
    )
)
"""규칙 해석에서 역을 찾는 낱말과 역 코드. 서비스 역 이름에서 만든다(강남, 유성온천, 구미역 ...)."""


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

    요청을 분류별로 나눈 결과다(`segments` 모듈 설명, docs/comparison/conditions-v3.md).
    업종·음식 종류·맛·메뉴는 항목마다 원함과 피함이 있고, 특징·시설은 원함만 있다. 점수용
    코드는 `codes`로 꺼낸다.

    Attributes:
        text: 해석한 요청문. 후속 조건이면 이전 요청과 합친 한 문장이다.
        embedding_text: 후보 추출에 쓸 문장. 부정 표현을 긍정형으로 바꿨고 위치 말(역
            이름, 근처, 지역 원문)은 뺐다.
        categories: 업종. 원함은 하나까지다. 피함은 "카페 말고"다.
        food_types: 음식 종류("일식", "일식 말고"). 메뉴에서 짐작해 넣지 않는다.
        flavors: 맛("매운", "매운 거 빼고")
        menus: 메뉴. 피하는 메뉴("오이 빼고")는 `want`가 거짓이다.
        features: 특징. 코드표에 있으면 코드가 붙는다.
        facilities: 시설 코드(`PARKING` 등)
        party_size: 인원. 요청에 없으면 None이다.
        locations: 지역. 여럿이면 그중 하나에 들면 된다.
        hours: 시간
        price: 가격. 요청에 없으면 None이다.
        place_name: 가게 이름. 요청에 없으면 None이다.
    """

    text: str
    embedding_text: str
    categories: tuple[Choice, ...] = ()
    food_types: tuple[Choice, ...] = ()
    flavors: tuple[Choice, ...] = ()
    menus: tuple[Menu, ...] = ()
    features: tuple[Feature, ...] = ()
    facilities: tuple[str, ...] = ()
    party_size: int | None = None
    locations: tuple[Location, ...] = ()
    hours: tuple[Hours, ...] = ()
    price: Price | None = None
    place_name: PlaceName | None = None

    @classmethod
    def from_codes(
        cls,
        text: str,
        embedding_text: str,
        codes: Sequence[str] = (),
        category_group: str | None = None,
        station: str | None = None,
        nearby: bool = False,
        locations: Sequence[Location] = (),
        menus: Sequence[Menu] = (),
        hours: Sequence[Hours] = (),
        price: Price | None = None,
        place_name: PlaceName | None = None,
        features: Sequence[FeatureText | Feature] = (),
        avoid_categories: Sequence[str] = (),
        avoid_foods: Sequence[str] = (),
        party_size: int | None = None,
    ) -> "Conditions":
        """옛 꼴(코드 목록과 빼 달라는 업종·음식)의 값으로 조건을 만든다.

        2차 조건과 같은 인자를 받는다. 코드는 분류로 나누고(`codes.split_codes`), 1차 꼴의
        역과 근처는 지역 조각으로 바꾼다. 코드가 있는 특징은 `codes`가 정하고, 특징 인자에
        같은 코드의 `Feature`가 있으면 그 원문을 쓴다(없으면 코드표 문구). 피하는 특징은
        버린다.

        Args:
            text: 해석한 요청문
            embedding_text: 후보 추출에 쓸 문장
            codes: 원하는 조건 코드(취향 코드표 코드와 시설 코드)
            category_group: 원하는 업종
            station: 1차 꼴의 역 코드. 지역이 있으면 읽지 않는다.
            nearby: 1차 꼴의 근처 검색 여부. 지역이 있으면 읽지 않는다.
            locations: 지역
            menus: 메뉴
            hours: 시간
            price: 가격
            place_name: 가게 이름
            features: 코드표에 없는 특징
            avoid_categories: 빼 달라는 업종
            avoid_foods: 빼 달라는 음식 종류·매운맛 코드
            party_size: 인원

        Returns:
            조건
        """
        feature_codes, food_types, flavors, facilities = split_codes(codes, avoid_foods)
        said = {f.code: f for f in features if isinstance(f, Feature) and f.code}
        if not locations and station in STATION_NAMES:
            name = STATION_NAMES[station]
            locations = (Location(name, LocationKind.STATION, name),)
        elif not locations and nearby:
            locations = (Location("근처", LocationKind.HERE),)
        categories = (
            () if category_group is None else (Choice(category_group),)
        ) + tuple(
            Choice(c, want=False)
            for c in dict.fromkeys(avoid_categories)
            if c != category_group
        )
        return cls(
            text=text,
            embedding_text=embedding_text,
            categories=categories,
            food_types=food_types,
            flavors=flavors,
            menus=tuple(menus),
            features=tuple(
                said.get(c) or Feature(FEATURES[c].label, FEATURES[c].label, c)
                for c in feature_codes
            )
            + tuple(
                dict.fromkeys(
                    Feature(f.text, f.value)
                    for f in features
                    if isinstance(f, FeatureText)
                    and f.want
                    or isinstance(f, Feature)
                    and f.code is None
                )
            ),
            facilities=facilities,
            party_size=party_size,
            locations=tuple(locations),
            hours=tuple(hours),
            price=price,
            place_name=place_name,
        )

    @property
    def codes(self) -> tuple[str, ...]:
        """원하는 조건의 점수용 코드(`codes.score_codes`). 특징, 음식 종류, 맛, 시설, 인원
        순서다."""
        return score_codes(
            (f.code for f in self.features),
            self.food_types,
            self.flavors,
            self.facilities,
            self.party_size,
        )

    @property
    def avoid_foods(self) -> tuple[str, ...]:
        """빼 달라는 음식 종류·매운맛 코드(`FOOD_*`)"""
        return avoided_codes(self.food_types, self.flavors)

    @property
    def category_group(self) -> str | None:
        """원하는 업종. 없으면 None이다."""
        return next((c.code for c in self.categories if c.want), None)

    @property
    def avoid_categories(self) -> tuple[str, ...]:
        """빼 달라는 업종("카페 말고")"""
        return tuple(c.code for c in self.categories if not c.want)

    @property
    def station(self) -> str | None:
        """지역 중 처음 나온 서비스 역 코드. 없으면 None이다. 로그와 1차 꼴 LLM 출력을
        견줄 때 쓴다."""
        return next((s for s in map(station_code, self.locations) if s), None)

    @property
    def nearby(self) -> bool:
        """근처 검색인지. 서비스 역 없이 "여기"(`LocationKind.HERE`)를 말했으면 참이다."""
        return self.station is None and any(
            loc.kind is LocationKind.HERE for loc in self.locations
        )

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


@dataclass(frozen=True)
class Interpretation:
    """요청 해석 결과.

    Attributes:
        conditions: 해석한 조건. 후속 조건이면 이전 조건과 합친 조건이다.
        change_summary: 후속 조건에서 바뀐 점. 새 검색이면 None이다.
        llm_error: 규칙으로 해석한 이유. LLM으로 해석했으면 None이다.
        llm_seconds: LLM 호출에 걸린 시간(초)
        gms_failed: GMS 호출 자체가 실패했는지(꺼짐 포함). 출력 검사에 걸린 것과
            다르다. 검색은 이때 정렬 LLM을 부르지 않는다.
        turn: 이번 요청의 조건. 지역 고르기가 이번 요청에 말한 지역을 볼 때 쓴다. 규칙
            해석이면 이번 요청만 해석한 조건이고, LLM 해석의 후속이면 합친 조건에서 이번
            요청에 지역을 말하지 않았을 때 지역을 비운 것이다.
            None이면 `conditions`와 같다고 본다(새 검색).
    """

    conditions: Conditions
    change_summary: str | None
    llm_error: str | None = None
    llm_seconds: float | None = None
    gms_failed: bool = False
    turn: Conditions | None = None


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
    features: tuple[FeatureText | Feature, ...],
    avoid_categories: tuple[str, ...],
    avoid_foods: tuple[str, ...],
    party_size: int | None = None,
) -> Conditions:
    """조각을 모아 조건을 만든다. LLM 해석과 규칙 해석이 같이 쓴다.

    빼 달라는 음식 코드는 원하는 코드에서 뺀다. 동네·랜드마크 원문은 벡터용 문장에서
    지운다. 코드는 분류로 나눠 담는다(`Conditions.from_codes`).
    """
    for loc in locations:
        if loc.kind is LocationKind.STATION or loc.text not in embedding_text:
            continue
        stripped = embedding_text.replace(loc.text, " ")
        embedding_text = (
            stripped
            if any(ch.isalnum() for ch in stripped)
            else CATEGORY_NAMES.get(category_group or "", embedding_text)
        )
    return Conditions.from_codes(
        text=text.strip()[:MAX_TEXT_LENGTH],
        embedding_text=_without_location(embedding_text, category_group).strip()[
            :MAX_TEXT_LENGTH
        ],
        codes=_known_codes(codes),
        category_group=category_group,
        locations=tuple(dict.fromkeys(locations))[:MAX_SEGMENTS],
        menus=menus,
        hours=tuple(dict.fromkeys(hours))[:MAX_SEGMENTS],
        price=price,
        place_name=place_name,
        features=features,
        avoid_categories=avoid_categories,
        avoid_foods=avoid_foods,
        party_size=party_size,
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
