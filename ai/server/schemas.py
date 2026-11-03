"""검색 API의 요청·응답 모양. BE가 이 이름 그대로 보내고 받는다.

JSON 이름은 BE와 같은 camelCase다. 요청의 모르는 속성은 거부하고(검색 spec D-41),
응답의 null 필드는 뺀다. 명세는 docs/comparison/api.md에 있다.
"""

from typing import Annotated, Any, Literal

from pydantic import Field, field_validator

from fit_ai.match.interpretation import (
    FOOD_CODES,
    FOOD_TYPES,
    MAX_CODES,
    MAX_TEXT_LENGTH,
    MAX_WALK_MINUTES,
)
from fit_ai.match.interpretation.codes import (
    FACILITY_CODES,
    FEATURE_CODES,
    FLAVOR_CODES,
)
from fit_ai.match.interpretation.segments import (
    DAYS,
    MAX_SEGMENT_LENGTH,
    MAX_SEGMENTS,
    MAX_SPELLINGS,
    LocationKind,
)
from fit_ai.match.taste_select import MAX_FREE_TEXT_LENGTH
from server.common import Body
from server.taste_profile import (
    PRIORITIES,
    PURPOSES,
    VECTOR_SIZE,
    ProfileBody,
    TasteChip,
)

MAX_QUERY_LENGTH = 200
"""요청문 길이 상한. BE 검색 요청과 같다(검색 spec 3번, 인프라 BE 계약 #18)."""

MAX_USER_ID_LENGTH = 64
"""회원 id 길이 상한. BE 회원 id는 UUID 문자열(36자)이다."""

MAX_GUEST_CHIPS = 20
"""비회원 칩 수 상한. 코드가 붙은 칩도 센다(요청당 비용 상한). FE는 10개까지 저장한다."""

MAX_PARTY_SIZE = 100
"""조건의 인원 상한. 넘으면 옛 조건처럼 읽지 못한 이전 조건이다."""


CategoryGroup = Literal["RESTAURANT", "CAFE", "BAR"]
"""업종. BE `CategoryGroup`과 같다."""

Station = Literal["GANGNAM", "YEOKSAM", "SEOLLEUNG"]
"""역. BE `Station`과 같다."""


class ModelsBody(Body):
    """이번 결과를 낸 모델 버전(인프라 설계 12.2-2, 12.2-7).

    Attributes:
        embedding: 임베딩 모델(`이름@리비전`)
        llm: 해석이나 정렬에 결과를 쓴 LLM. 둘 다 LLM 결과를 쓰지 않았으면 빠진다.
    """

    embedding: str | None = None
    llm: str | None = None


Coordinate = Annotated[float | None, Field(strict=True, allow_inf_nan=False)]
"""좌표 하나. 숫자만 받는다. 문자열("37.4")이나 참거짓, NaN은 거부한다."""


VectorValue = Annotated[float, Field(strict=True, allow_inf_nan=False)]
"""벡터 값 하나. 숫자만 받는다."""


class GuestChipBody(TasteChip):
    """비회원 칩. 온보딩 칩에 벡터가 더해진다.

    Attributes:
        label: 칩 문구
        vector: 문구 벡터. 온보딩 담당이 코드 없는 좋아함 칩에 붙인다. 다른 칩에 붙어
            오면 쓰지 않는다.
    """

    label: str = Field(min_length=1, max_length=MAX_FREE_TEXT_LENGTH)
    vector: list[VectorValue] | None = Field(
        default=None, min_length=VECTOR_SIZE, max_length=VECTOR_SIZE
    )


class GuestTasteBody(ProfileBody):
    """비회원 취향. 기기가 저장한 온보딩 답이고, 회원 `user_preferences` 행에서
    `features`를 뺀 모양이다. 취향 프로필 계산 API의 요청과 같고 칩에 벡터가 더해진다.
    """

    priorities: list[Literal[tuple(PRIORITIES)]] = Field(
        default_factory=list, max_length=len(PRIORITIES)
    )
    purposes: list[Literal[tuple(PURPOSES)]] = Field(
        default_factory=list, max_length=len(PURPOSES)
    )
    tastes: list[GuestChipBody] = Field(
        default_factory=list, max_length=MAX_GUEST_CHIPS
    )


class MapBoundsBody(Body):
    """지도 영역("이 지역에서 검색"). BE `MapBounds`와 같다. 빠진 값은 제한하지 않는다.

    Attributes:
        sw_lat: 남서쪽 위도
        sw_lng: 남서쪽 경도
        ne_lat: 북동쪽 위도
        ne_lng: 북동쪽 경도
    """

    sw_lat: Coordinate = None
    sw_lng: Coordinate = None
    ne_lat: Coordinate = None
    ne_lng: Coordinate = None


class SearchBody(Body):
    """검색 요청. BE가 검색 요청(첫 페이지)을 받으면 그대로 넘긴다.

    Attributes:
        query: 사용자가 이번에 입력한 요청문
        previous_conditions: 후속 조건이면 FE가 돌려보낸 기준 요청의 `conditions`.
            BE는 해석하지 않고 그대로 넘긴다. 읽지 못하면 새 검색으로 본다.
        map_bounds: 지도 영역. 있으면 역 대신 좌표로 거른다.
        user_id: 회원 id. BE가 로그인으로 확인한 id다. 있으면 취향 저장소에서 그 회원의
            취향을 꺼내고 `taste_profile`은 읽지 않는다. 비회원이면 null이다.
        taste_profile: 비회원 취향(`GuestTasteBody`). 기기가 저장한 온보딩 답을 BE가
            그대로 넘긴다. 읽지 못하면 취향 없이 검색하고 `fallbacks`에
            `TASTE_INVALID`를 담는다.
    """

    query: str = Field(min_length=1, max_length=MAX_QUERY_LENGTH)
    previous_conditions: dict[str, Any] | None = None
    map_bounds: MapBoundsBody | None = None
    user_id: str | None = Field(
        default=None, min_length=1, max_length=MAX_USER_ID_LENGTH
    )
    taste_profile: dict[str, Any] | None = None

    @field_validator("query")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("공백만 있다")
        return value


Segment = Annotated[str, Field(min_length=1, max_length=MAX_SEGMENT_LENGTH)]
"""조각의 원문과 표준 이름"""

Clock = Annotated[str, Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")]
"""시각("HH:MM")"""


class LocationBody(Body):
    """지역 조각. 속성은 `segments.Location`과 같다."""

    text: Segment
    kind: LocationKind
    value: Segment | None = None
    walk_minutes: int | None = Field(default=None, ge=1, le=MAX_WALK_MINUTES)
    exit: Segment | None = None


class MenuBody(Body):
    """메뉴 조각. 속성은 `segments.Menu`와 같다."""

    text: Segment
    value: Segment
    spellings: list[Segment] = Field(default_factory=list, max_length=MAX_SPELLINGS)
    want: bool = True


class HoursBody(Body):
    """시간 조각. 속성은 `segments.Hours`와 같다."""

    text: Segment
    day: Literal[DAYS] | None = None
    open_until: Clock | None = None
    open_from: Clock | None = None
    now: bool = False


class PriceBody(Body):
    """가격 조각. 속성은 `segments.Price`와 같다."""

    text: Segment
    min_won: int | None = Field(default=None, ge=0)
    max_won: int | None = Field(default=None, ge=0)
    cheap: bool = False


class PlaceNameBody(Body):
    """가게 이름 조각. 속성은 `segments.PlaceName`과 같다."""

    text: Segment
    value: Segment


class FeatureTextBody(Body):
    """코드표에 없는 특징. 속성은 `segments.FeatureText`와 같다."""

    text: Segment
    value: Segment
    want: bool = True


class LegacyConditionsBody(Body):
    """2차까지의 조건 모양. BE가 검색 대화에 저장해 둔 조건이 후속 조건으로 돌아오므로
    읽는다(docs/comparison/conditions-v3.md 5장). 응답으로는 내지 않는다.

    `locations`부터 뒤의 속성은 2차에 더했다. 1차 응답을 돌려보낸 `previousConditions`에는
    없으므로 모두 기본값이 있다.

    Attributes:
        text: 해석한 요청문. 후속 조건이면 이전 요청과 합친 문장이다.
        embedding_text: 후보 추출에 쓸 문장. 부정 표현을 긍정형으로 바꿨고 위치 말은 뺐다.
        codes: 원하는 조건 코드. 취향 코드표 코드(음식 종류·매운맛 포함)와 시설 코드다.
        category_group: 업종. 요청에 없으면 null이다.
        station: 지역 중 처음 나온 서비스 역. 없으면 null이다.
        nearby: 근처 검색인지
        locations: 지역. 여럿이면 그중 하나에 들면 된다.
        menus: 메뉴. 피하는 메뉴는 `want`가 거짓이다.
        hours: 시간
        price: 가격. 요청에 없으면 null이다.
        place_name: 가게 이름. 요청에 없으면 null이다.
        features: 코드표에 없는 특징
        avoid_categories: 빼 달라는 업종
        avoid_foods: 빼 달라는 음식 종류·매운맛 코드
    """

    text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    embedding_text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    codes: list[str] = Field(default_factory=list, max_length=MAX_CODES)
    category_group: CategoryGroup | None = None
    station: Station | None = None
    nearby: bool = False
    locations: list[LocationBody] = Field(default_factory=list, max_length=MAX_SEGMENTS)
    menus: list[MenuBody] = Field(default_factory=list, max_length=MAX_SEGMENTS)
    hours: list[HoursBody] = Field(default_factory=list, max_length=MAX_SEGMENTS)
    price: PriceBody | None = None
    place_name: PlaceNameBody | None = None
    features: list[FeatureTextBody] = Field(
        default_factory=list, max_length=MAX_SEGMENTS
    )
    avoid_categories: list[CategoryGroup] = Field(default_factory=list, max_length=3)
    avoid_foods: list[Literal[FOOD_CODES]] = Field(
        default_factory=list, max_length=len(FOOD_CODES)
    )


class CategoryChoiceBody(Body):
    """업종 항목. 속성은 `segments.Choice`와 같다."""

    code: CategoryGroup
    want: bool = True


class FoodTypeChoiceBody(Body):
    """음식 종류 항목. 속성은 `segments.Choice`와 같다."""

    code: Literal[FOOD_TYPES]
    want: bool = True


class FlavorChoiceBody(Body):
    """맛 항목. 속성은 `segments.Choice`와 같다."""

    code: Literal[tuple(FLAVOR_CODES)]
    want: bool = True


class FeatureBody(Body):
    """특징. 속성은 `segments.Feature`와 같다."""

    text: Segment
    value: Segment
    code: Literal[FEATURE_CODES] | None = None


class ConditionsBody(Body):
    """해석한 조건(3차). BE와 FE에는 불투명한 객체다.

    BE는 검색 응답의 `conditions`로 FE에 그대로 준다. FE는 후속 조건 때
    `previousConditions`로 돌려보낸다. 모양은 docs/comparison/conditions-v3.md 3장이고,
    속성은 `interpretation.Conditions`와 같다.

    Attributes:
        version: 조건 모양 판. 3이다. 없으면 옛 조건(`LegacyConditionsBody`)으로 읽는다.
        text: 해석한 요청문. 후속 조건이면 이전 요청과 합친 문장이다.
        embedding_text: 후보 추출에 쓸 문장
        categories: 업종. 원함은 하나까지다.
        food_types: 음식 종류
        flavors: 맛
        menus: 메뉴
        features: 특징
        facilities: 시설 코드
        party_size: 인원. 요청에 없으면 null이다.
        locations: 지역
        hours: 시간
        price: 가격. 요청에 없으면 null이다.
        place_name: 가게 이름. 요청에 없으면 null이다.
    """

    version: Literal[3] = 3
    text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    embedding_text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    categories: list[CategoryChoiceBody] = Field(default_factory=list, max_length=3)
    food_types: list[FoodTypeChoiceBody] = Field(
        default_factory=list, max_length=len(FOOD_TYPES)
    )
    flavors: list[FlavorChoiceBody] = Field(
        default_factory=list, max_length=len(FLAVOR_CODES)
    )
    menus: list[MenuBody] = Field(default_factory=list, max_length=MAX_SEGMENTS)
    features: list[FeatureBody] = Field(default_factory=list, max_length=MAX_CODES)
    facilities: list[Literal[FACILITY_CODES]] = Field(
        default_factory=list, max_length=len(FACILITY_CODES)
    )
    party_size: int | None = Field(default=None, ge=1, le=MAX_PARTY_SIZE)
    locations: list[LocationBody] = Field(default_factory=list, max_length=MAX_SEGMENTS)
    hours: list[HoursBody] = Field(default_factory=list, max_length=MAX_SEGMENTS)
    price: PriceBody | None = None
    place_name: PlaceNameBody | None = None

    @field_validator("categories")
    @classmethod
    def _one_wanted(cls, value: list[CategoryChoiceBody]) -> list[CategoryChoiceBody]:
        if sum(c.want for c in value) > 1:
            raise ValueError("원하는 업종이 둘 이상이다")
        return value


class ReasonTagBody(Body):
    """추천 이유의 근거 칩. BE `ReasonTag`와 같다.

    Attributes:
        source: 근거 출처(`REQUEST`, `PREFERENCE`)
        label: 칩 문구
    """

    source: str
    label: str


class ReasonBody(Body):
    """추천 이유. BE `Reason`과 같다.

    Attributes:
        title: 이유 제목
        tags: 근거 칩
        quote: 근거 문장 인용. 없으면 응답에서 빠진다.
        quote_source: 인용 출처. 없으면 응답에서 빠진다.
    """

    title: str
    tags: list[ReasonTagBody]
    quote: str | None = None
    quote_source: str | None = None


class ScoreItemBody(Body):
    """핏 점수를 이루는 항목. BE `ScoreItem`과 같다.

    Attributes:
        source: 근거 출처(`REQUEST`, `PREFERENCE`)
        label: 항목 이름
        matched: 근거가 충분한지
        evidence_count: 근거 리뷰 수. 0 이상이다.
    """

    source: str
    label: str
    matched: bool
    evidence_count: int


class CardBody(Body):
    """카드의 AI 필드. 장소 이름·좌표·사진·영업 상태는 BE가 채운다.

    Attributes:
        place_id: 장소 id
        score: 핏 점수. 0~100 정수다. 판정할 요청 조각도 취향도 없으면 빠진다.
        labels: 장소 특징 2개
        reasons: 추천 이유
        score_items: 핏 점수를 이루는 항목
        caution: 주의점. MVP는 없어서 응답에서 빠진다.
    """

    place_id: int
    score: int | None = None
    labels: list[str]
    reasons: list[ReasonBody]
    score_items: list[ScoreItemBody]
    caution: str | None = None


class EmptyReasonBody(Body):
    """결과가 없을 때의 원인과 제안. BE `EmptyReason`과 같다.

    Attributes:
        cause: 원인
        suggestion: 수정 제안
    """

    cause: str
    suggestion: str


Fallback = Literal[
    "INTERPRET_LLM_FAILED",
    "PREVIOUS_INVALID",
    "TASTE_INVALID",
    "PROFILE_INVALID",
]
"""사용자 모르게 대신 처리한 이유. BE는 하나라도 있으면 `X-Fallback` 헤더를 붙인다
(인프라 BE 계약 #17)."""


class SearchResponse(Body):
    """검색 응답. BE는 카드에 장소 정보를 붙여 검색 응답을 만든다.

    Attributes:
        conditions: 해석한 조건. 검색 응답의 `conditions`로 FE에 그대로 준다.
        nearby: 근처 검색인지. 검색 응답의 `nearby`로 쓴다.
        change_summary: 후속 조건에서 바뀐 점. 새 검색이면 빠진다.
        items: 카드 목록. 핏 점수 내림차순이다. 결과가 없으면 비어 있다.
        empty_reason: 결과가 없을 때의 원인과 제안. 결과가 있으면 빠진다.
        interpreted_by: 해석한 방법. `LLM`이나 `RULE`이다.
        ranked_by: 순서를 정한 방법. 핏 점수(`SCORE`)이고, 점수가 없으면 유사도
            순서(`SIMILARITY`)다. 결과가 없으면 빠진다.
        fallbacks: 사용자 모르게 대신 처리한 이유
        models: 이번 결과를 낸 모델 버전
    """

    conditions: ConditionsBody
    nearby: bool
    change_summary: str | None = None
    items: list[CardBody]
    empty_reason: EmptyReasonBody | None = None
    interpreted_by: Literal["LLM", "RULE"]
    ranked_by: Literal["SCORE", "SIMILARITY"] | None = None
    fallbacks: list[Fallback]
    models: ModelsBody
