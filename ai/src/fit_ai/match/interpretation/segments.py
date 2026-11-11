"""요청 해석의 분류별 조각. 해석 결과(`interpretation.Conditions`)가 담는다.

요청은 업종, 지역, 메뉴, 음식 종류, 맛, 시간, 가격, 가게 이름, 특징, 시설, 기타로 나눈다(검색
2차 계획, 2026-11-02; 메뉴와 음식 종류는 2026-11-03에 나눔; 분류별 칸은 2026-11-04,
docs/comparison/conditions-v3.md). 업종, 음식 종류, 맛은 코드 항목(`Choice`)이고, 특징은
코드표에 있으면 코드가 붙는다(`Feature`). 기타("맛있는", "추천해줘")는 버린다.

조각마다 사용자가 쓴 말(`text`)과 LLM이 철자를 고치고 표준 이름으로 바꾼 값(`value`)을 같이
둔다. 표준 이름은 아직 사전과 맞춰 보지 않은 값이다. 사전에 없으면 원문으로 찾는 일은 그
조각을 쓰는 곳(지역 사전, 가게 이름 찾기)이 맡는다.

피하는 것은 업종, 음식 종류, 맛, 메뉴에만 항목마다 `want`로 둔다. 그 밖의 부정은 1차처럼
바라는 쪽 코드로 바꾼다
("시끄러운 곳 말고" → `QUIET`). 피함을 넓게 두면 LLM이 칸을 잘못 골라 뜻이 뒤집히기
때문이다(2026-11-02 평가).
"""

from dataclasses import dataclass
from enum import StrEnum

MAX_SEGMENT_LENGTH = 40
"""조각의 원문과 표준 이름 길이 상한"""

MAX_SEGMENTS = 10
"""분류마다 조각 수 상한. 후속 조건이 쌓여도 정렬 LLM 입력이 커지지 않게 한다."""

MAX_SPELLINGS = 3
"""메뉴 조각의 다른 표기 수 상한"""

DAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")
"""시간 조각의 요일 값"""


class LocationKind(StrEnum):
    """지역 표현의 종류"""

    STATION = "STATION"
    """역. 서비스 역이면 `Conditions.station`이 그 역 코드다."""
    AREA = "AREA"
    """동네, 거리, 랜드마크(역삼동, 가로수길, 코엑스)"""
    HERE = "HERE"
    """여기, 이 근처처럼 지금 보는 곳"""
    UNKNOWN = "UNKNOWN"
    """회사 근처, 집 근처처럼 어딘지 알 수 없는 곳"""


@dataclass(frozen=True)
class Location:
    """지역 조각. 요청에 지역이 여럿이면("강남역이나 역삼역") 조각도 여럿이고 그중 하나에
    들면 된다.

    Attributes:
        text: 사용자가 쓴 말("션릉역 근처")
        kind: 종류
        value: 표준 이름("선릉역", "역삼동", "코엑스"). 여기나 알 수 없는 곳이면 None이다.
        walk_minutes: 걸어서 몇 분 안("걸어서 5분"). 없으면 None이다.
        exit: 역 출구 번호("11번 출구"면 "11"). 없으면 None이다.
    """

    text: str
    kind: LocationKind
    value: str | None = None
    walk_minutes: int | None = None
    exit: str | None = None


@dataclass(frozen=True)
class Menu:
    """메뉴 조각. 먹고 마시는 것은 모두 여기다(돈가스, 와인, 커피, 디카페인 포함).

    음식 종류("일식")와 매운맛은 메뉴가 아니라 코드다(`Conditions.codes`). 메뉴에는 음식
    종류 코드를 붙이지 않는다. 메뉴는 메뉴판으로 판정하고, 메뉴를 음식 종류로 바꾸는 것은
    추측이라 흔들린다("돈까스"가 일식일 때도 한식일 때도 있었다, 2026-11-03 결정).

    Attributes:
        text: 사용자가 쓴 말("스시")
        value: 표준 이름("초밥")
        spellings: 메뉴판에 흔히 쓰는 같은 메뉴의 다른 표기("돈가스"면 "돈까스",
            "돈카츠"). 다른 메뉴나 더 넓은 말은 넣지 않는다.
        want: 원하면 True, 피하면("오이 빼고") False
    """

    text: str
    value: str
    spellings: tuple[str, ...] = ()
    want: bool = True


@dataclass(frozen=True)
class Hours:
    """시간 조각.

    Attributes:
        text: 사용자가 쓴 말("새벽까지")
        day: 요일(`DAYS`). 없으면 None이다.
        open_until: 이 시각 이후까지 여는 곳("HH:MM"). 없으면 None이다.
        open_from: 이 시각 이전부터 여는 곳("HH:MM"). 없으면 None이다.
        now: 지금 영업 중인 곳을 찾는지
    """

    text: str
    day: str | None = None
    open_until: str | None = None
    open_from: str | None = None
    now: bool = False


@dataclass(frozen=True)
class Price:
    """가격 조각. 금액은 원 단위다. "가성비"는 가격이 아니라 특징(`VALUE_FOR_MONEY`)이다.

    Attributes:
        text: 사용자가 쓴 말("만원 이하")
        min_won: 하한. 없으면 None이다.
        max_won: 상한. 없으면 None이다.
        cheap: "저렴한", "비싸지 않은"처럼 같은 역·업종보다 싼 곳을 찾는지
    """

    text: str
    min_won: int | None = None
    max_won: int | None = None
    cheap: bool = False


@dataclass(frozen=True)
class PlaceName:
    """가게 이름 조각.

    Attributes:
        text: 사용자가 쓴 말("스벅")
        value: 표준 이름("스타벅스")
    """

    text: str
    value: str


@dataclass(frozen=True)
class Choice:
    """코드로 고르는 분류(업종, 음식 종류, 맛)의 항목 하나.

    Attributes:
        code: 코드(`RESTAURANT`, `FOOD_JAPANESE`, `SPICY` 등)
        want: 원하면 True, 피하면("일식 말고") False
    """

    code: str
    want: bool = True


class FeatureKind(StrEnum):
    """코드표에 없는 특징의 종류. 쓰는 곳이 갈린다(docs/comparison/spec.md 4.1)."""

    TASTE = "TASTE"
    """분위기·목적·먹을거리처럼 장소 페르소나에 이야기가 많은 것("책 읽기 좋은 곳").
    후보 뽑기와 점수에 쓴다."""
    FACILITY = "FACILITY"
    """있고 없음이 정해진 시설·사실("콘센트 있는 곳", "룸 있는 곳"). 장소 페르소나에 거의
    나오지 않아 후보 뽑기에만 쓴다."""
    QUALITY = "QUALITY"
    """맛, 친절, 청결, 예산처럼 거의 모든 장소에 해당하는 것("맛있는 곳"). 쓰지 않는다."""


@dataclass(frozen=True)
class Feature:
    """장소 특징 하나. 원함만 받는다. 부정한 특징은 바라는 쪽으로 바꿔 둔다("시끄러운 곳
    말고"는 `QUIET`).

    Attributes:
        text: 사용자가 쓴 말("북적이는 데 말고")
        value: 표준 이름. 코드표에 없는 특징은 "~곳" 문구다("조용하고 차분한 곳",
            "콘센트 있는 곳").
        code: 공유 코드표의 성향 축·중요 기준·방문 목적 코드. 코드표에 없는 특징이면
            None이다.
        kind: 코드표에 없는 특징의 종류. 코드 특징이거나 종류를 모르는 옛 조건이면 None이고
            쓰지 않는다.
    """

    text: str
    value: str
    code: str | None = None
    kind: FeatureKind | None = None


@dataclass(frozen=True)
class FeatureText:
    """규칙·LLM 해석이 찾은 코드표에 없는 특징("콘센트", "반려견"). 조건에는 원하는 것만
    `Feature`로 들어간다.

    Attributes:
        text: 사용자가 쓴 말("충전되는")
        value: "~곳" 문구("콘센트 있는 곳")
        want: 원하면 True, 피하면 False
        kind: 종류. 모르면 None이다.
    """

    text: str
    value: str
    want: bool = True
    kind: FeatureKind | None = None
