"""비교가 쓰는 낱말표. 카드 조건 목록과 업종·역 이름이다.

카드 조건은 공유 코드표(`fit_ai.features`)의 온보딩 코드와 시설 4개다. 온보딩 코드의
코드와 층은 공유 코드표에서 가져오고, 여기에는 코드표에 없는 것만 둔다. 카드 문구,
시설(BE의 `Facility` 코드, docs/comparison/spec.md 2장), 업종·역 이름이다. 다른 비교
모듈을 가져다 쓰지 않는다.
"""

from dataclasses import dataclass
from enum import StrEnum

from fit_ai.features import FEATURES


class Layer(StrEnum):
    """조건의 층. 값은 공유 코드표의 `layer` 값과 같고 시설만 더했다."""

    AXIS = "axis"
    """성향 축(PRD L1). 조용함과 활기처럼 한쪽을 고르면 반대쪽은 비선호다."""
    IMPORTANCE = "importance"
    """중요 기준(PRD L2)"""
    PURPOSE = "purpose"
    """방문 목적(PRD L3)"""
    FACILITY = "facility"
    """시설(PRD L4). 취향 spec에는 없다. 리뷰가 아니라 장소 정보로 먼저 판정한다."""
    FOOD = "food"
    """음식 종류와 매운맛. 취향에만 있고 카드 조건에는 아직 없다."""


@dataclass(frozen=True)
class Condition:
    """조건 하나.

    Attributes:
        id: 조건 코드. 장소 프로필의 `conditions` 키와 같다.
            시설은 `facilities` 키와도 같다.
        label: 화면에 보이는 문구. 근거 항목, 추천 이유, 특징 라벨에 쓴다.
        layer: 조건의 층
    """

    id: str
    label: str
    layer: Layer


CARD_LABELS = {
    "QUIET": "조용해요",
    "LIVELY": "활기차요",
    "SPACIOUS_SEATING": "자리가 넉넉해요",
    "SHORT_WAIT": "대기가 짧아요",
    "GENEROUS_PORTION": "양이 넉넉해요",
    "PRETTY_SPACE": "공간이 예뻐요",
    "VIEW_OUTDOOR": "전망이 좋아요",
    "COZY": "아늑해요",
    "VALUE_FOR_MONEY": "가격만큼 만족해요",
    "PURPOSE_TALK": "대화하기 좋아요",
    "PURPOSE_SOLO": "혼밥하기 좋아요",
    "PURPOSE_DATE": "데이트하기 좋아요",
    "PURPOSE_GROUP": "모임하기 좋아요",
    "PURPOSE_WORK": "작업하기 좋아요",
}
"""온보딩 코드의 카드 문구. 코드표의 `label`은 온보딩 태그 문구("조용하고 차분한 곳")라
카드에는 이 문구를 쓴다. 코드표에 온보딩 코드가 늘면 여기도 더해야 한다(없으면 불러올
때 KeyError로 드러난다)."""

FACILITY_LABELS = {
    "PARKING": "주차할 수 있어요",
    "WIFI": "와이파이가 돼요",
    "GROUP": "단체로 갈 수 있어요",
    "RESERVATION": "예약할 수 있어요",
}
"""시설 코드와 카드 문구. 시설은 공유 코드표에 없다."""

CONDITIONS: dict[str, Condition] = {
    **{
        code: Condition(code, CARD_LABELS[code], Layer(feature.layer))
        for code, feature in FEATURES.items()
        if feature.onboarding
    },
    **{
        code: Condition(code, label, Layer.FACILITY)
        for code, label in FACILITY_LABELS.items()
    },
}
"""조건 id로 찾는 조건 목록. 공유 코드표 순서, 그다음 시설이다. 순서는 특징 라벨을
고를 때 동점을 가르는 데 쓴다."""

EXTRA_LABELS = {
    "FOOD_KOREAN": "한식이에요",
    "FOOD_JAPANESE": "일식이에요",
    "FOOD_CHINESE": "중식이에요",
    "FOOD_WESTERN": "양식이에요",
    "FOOD_ASIAN": "아시아 음식이에요",
    "FOOD_SPICY": "매콤해요",
    "UNIQUE_CONCEPT": "컨셉이 독특해요",
    "FAST_SERVING": "음식이 빨리 나와요",
    "GOOD_MUSIC": "음악이 좋아요",
    "FOOD_SWEET": "달콤해요",
    "FOOD_SOUR": "산미가 있어요",
    "FOOD_SALTY": "짭짤해요",
    "FOOD_BITTER": "쌉싸름해요",
    "FOOD_UMAMI": "감칠맛이 나요",
    "FOOD_NUTTY": "고소해요",
    "FOOD_RICH": "맛이 진해요",
    "FOOD_CLEAN": "담백하고 깔끔해요",
}
"""코드표의 확장 코드(온보딩에 없는 코드)의 카드 문구. 카드 조건 목록에는 없지만 요청과
취향에 나오면 점수를 내고 근거 항목에 보인다. 코드표에 확장 코드가 늘면 여기도 더해야
한다(없으면 불러올 때 KeyError로 드러난다)."""

SCORE_LABELS: dict[str, str] = {
    **{code: condition.label for code, condition in CONDITIONS.items()},
    **{
        code: EXTRA_LABELS[code]
        for code, feature in FEATURES.items()
        if not feature.onboarding
    },
}
"""점수를 내는 코드와 근거 항목 문구. 카드 조건과 코드표의 확장 코드다."""

CATEGORY_NAMES = {"RESTAURANT": "식당", "CAFE": "카페", "BAR": "술집"}
"""업종 코드의 화면 이름. BE `CategoryGroup`과 같다."""

STATION_NAMES = {
    "GANGNAM": "강남역",
    "YEOKSAM": "역삼역",
    "SEOLLEUNG": "선릉역",
    "SINNONHYEON": "신논현역",
    "NONHYEON": "논현역",
    "EONJU": "언주역",
    "HANTI": "한티역",
    "SAMSEONG_JUNGANG": "삼성중앙역",
    "GYODAE": "교대역",
    "SEONJEONGNEUNG": "선정릉역",
    "SAMSEONG": "삼성역",
    "HAKDONG": "학동역",
    "SAPYEONG": "사평역",
    "DOGOK": "도곡역",
    "BONGEUNSA": "봉은사역",
    # 대전
    "YUSEONG_ONCHEON": "유성온천역",
    "GUAM": "구암역",
    "NOEUN": "노은역",
    "BANSEOK": "반석역",
    "DAEJEON_WORLDCUP_STADIUM": "월드컵경기장역",
    "JIJOK": "지족역",
    "GAPCHEON": "갑천역",
    "HYEONCHUNGWON": "현충원역",
    "WOLPYEONG": "월평역",
    # 구미
    "GUMI": "구미역",
    "SAGOK": "사곡역",
    # 부산
    "JEONPO": "전포역",
    "SEOMYEON": "서면역",
    "GEUMNYEONSAN": "금련산역",
    "SASANG": "사상역",
    "HADAN": "하단역",
    "GWANGAN": "광안역",
    "NAMPO": "남포역",
    "DONGNAE": "동래역",
}
"""역 코드의 화면 이름. BE `Station`과 같다(`tests/match/test_station_contract.py`가 견준다)."""

CITY_BY_STATION = {"GUMI": "구미시"}
"""역 이름이 곧 시 이름인 시. 구가 없어 장소의 `district`가 시 이름이다. 그 시를 "역" 없이
말하면("구미 맛집") 역 근처만이 아니라 시 전체를 찾는다. 가장 가까운 역이 구미역인 장소만
역으로 걸려 구미 2,614곳 중 854곳만 나오기 때문이다(2026-11-07). 광역시는 구가 있어 해당 없다."""


@dataclass(frozen=True)
class City:
    """장소 데이터가 적재돼 서비스하는 도시. "준비 중인 지역" 안내가 요청한 도시의
    대표 역만 제안하게 한다.

    Attributes:
        name: 도시 이름
        keywords: 요청문에서 이 도시를 가리키는 말. 띄어쓰기를 지운 요청문에 들어 있으면
            그 도시를 말한 것으로 본다.
        stations: 도시에서 장소가 가장 많은 대표 역 코드
        lat: 도시 중심(시청)의 위도
        lng: 도시 중심의 경도
        radius_m: 지도 화면의 중심이 이 도시 안이라고 볼 도시 중심에서의 거리(m). 행정
            경계가 아니라 어림값이다. 이웃한 도시(서울 옆 하남, 대전 옆 세종, 구미 옆
            칠곡)는 들지 않게 잡았다.
    """

    name: str
    keywords: tuple[str, ...]
    stations: tuple[str, ...]
    lat: float
    lng: float
    radius_m: float


CITIES = (
    City(
        "서울",
        ("서울",),
        ("GANGNAM", "YEOKSAM", "SEOLLEUNG"),
        37.5665,
        126.9780,
        18_000,
    ),
    City("대전", ("대전",), ("YUSEONG_ONCHEON",), 36.3504, 127.3845, 15_000),
    City("구미", ("구미",), ("GUMI",), 36.1195, 128.3446, 12_000),
)
"""장소 데이터가 적재돼 서비스하는 도시. 다른 지역의 장소를 적재하면 그 도시와 대표 역을
여기에 더한다. 지역마다 장소가 가장 많은 대표 역만 둔다(2026-11-09: 대전 유성온천역
897곳, 구미 구미역 854곳). 부산(121곳)과 하남(역이 없는 데이터)은 아직 없다."""

SERVED_STATIONS = tuple(code for city in CITIES for code in city.stations)
"""서비스하는 모든 도시의 대표 역. 어느 도시를 찾았는지 알 수 없을 때 "준비 중인 지역"
안내가 이 역 근처를 제안한다."""
