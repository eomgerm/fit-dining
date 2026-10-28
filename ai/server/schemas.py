"""AI API의 요청·응답 모양. BE가 이 이름 그대로 보내고 받는다.

JSON 이름은 BE와 같은 camelCase다. 요청의 모르는 속성은 거부하고(검색 spec D-41),
응답의 null 필드는 뺀다. 명세는 docs/comparison/api.md에 있다.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from fit_ai.match.interpretation import MAX_CODES, MAX_TEXT_LENGTH

MAX_QUERY_LENGTH = 200
"""요청문 길이 상한. BE 검색 요청과 같다(검색 spec 3번, 인프라 BE 계약 #18)."""

MAX_USER_ID_LENGTH = 64
"""회원 id 길이 상한. BE 회원 id는 UUID 문자열(36자)이다."""


class _Body(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="forbid"
    )


CategoryGroup = Literal["RESTAURANT", "CAFE", "BAR"]
"""업종. BE `CategoryGroup`과 같다."""

Station = Literal["GANGNAM", "YEOKSAM", "SEOLLEUNG"]
"""역. BE `Station`과 같다."""


class ModelsBody(_Body):
    """이번 결과를 낸 모델 버전(인프라 설계 12.2-2, 12.2-7).

    Attributes:
        embedding: 임베딩 모델(`이름@리비전`)
        llm: 해석이나 정렬에 결과를 쓴 LLM. 둘 다 LLM 결과를 쓰지 않았으면 빠진다.
    """

    embedding: str | None = None
    llm: str | None = None


Coordinate = Annotated[float | None, Field(strict=True, allow_inf_nan=False)]
"""좌표 하나. 숫자만 받는다. 문자열("37.4")이나 참거짓, NaN은 거부한다."""


class MapBoundsBody(_Body):
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


class SearchBody(_Body):
    """검색 요청. BE가 검색 요청(첫 페이지)을 받으면 그대로 넘긴다.

    Attributes:
        query: 사용자가 이번에 입력한 요청문
        previous_conditions: 후속 조건이면 FE가 돌려보낸 기준 요청의 `conditions`.
            BE는 해석하지 않고 그대로 넘긴다. 읽지 못하면 새 검색으로 본다.
        map_bounds: 지도 영역. 있으면 역 대신 좌표로 거른다.
        user_id: 회원 id. BE가 로그인으로 확인한 id다. 있으면 취향 저장소에서 그 회원의
            취향을 꺼내고 `taste_profile`은 읽지 않는다. 비회원이면 null이다.
        taste_profile: 비회원 취향 프로필(`taste-profile/v0`) JSON. 기기가 저장한
            프로필을 BE가 그대로 넘긴다. 읽지 못하면 취향 없이 검색하고 `fallbacks`에
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


class ConditionsBody(_Body):
    """해석한 조건. BE와 FE에는 불투명한 객체다.

    BE는 검색 응답의 `conditions`로 FE에 그대로 준다. FE는 후속 조건 때
    `previousConditions`로 돌려보낸다.

    Attributes:
        text: 정렬 LLM에 넣을 요청문. 후속 조건이면 이전 요청과 합친 문장이다.
        embedding_text: 후보 추출에 쓸 긍정형 문장
        codes: 요청 조건 코드. 취향 코드표 코드와 시설 코드다.
        category_group: 업종. 요청에 없으면 null이다.
        station: 역. 요청에 없으면 null이다.
        nearby: 근처 검색인지
    """

    text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    embedding_text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    codes: list[str] = Field(default_factory=list, max_length=MAX_CODES)
    category_group: CategoryGroup | None = None
    station: Station | None = None
    nearby: bool = False


class ReasonTagBody(_Body):
    """추천 이유의 근거 칩. BE `ReasonTag`와 같다.

    Attributes:
        source: 근거 출처(`REQUEST`, `PREFERENCE`)
        label: 칩 문구
    """

    source: str
    label: str


class ReasonBody(_Body):
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


class ScoreItemBody(_Body):
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


class CardBody(_Body):
    """카드의 AI 필드. 장소 이름·좌표·사진·영업 상태는 BE가 채운다.

    Attributes:
        place_id: 장소 id
        score: 핏 점수. 0~100 정수다.
        labels: 장소 특징 2개
        reasons: 추천 이유
        score_items: 핏 점수를 이루는 항목
        caution: 주의점. MVP는 없어서 응답에서 빠진다.
    """

    place_id: int
    score: int
    labels: list[str]
    reasons: list[ReasonBody]
    score_items: list[ScoreItemBody]
    caution: str | None = None


class EmptyReasonBody(_Body):
    """결과가 없을 때의 원인과 제안. BE `EmptyReason`과 같다.

    Attributes:
        cause: 원인
        suggestion: 수정 제안
    """

    cause: str
    suggestion: str


Fallback = Literal[
    "INTERPRET_LLM_FAILED",
    "RANK_LLM_FAILED",
    "PREVIOUS_INVALID",
    "TASTE_INVALID",
    "PROFILE_INVALID",
]
"""사용자 모르게 대신 처리한 이유. BE는 하나라도 있으면 `X-Fallback` 헤더를 붙인다
(인프라 BE 계약 #17)."""


class SearchResponse(_Body):
    """검색 응답. BE는 카드에 장소 정보를 붙여 검색 응답을 만든다.

    Attributes:
        conditions: 해석한 조건. 검색 응답의 `conditions`로 FE에 그대로 준다.
        nearby: 근처 검색인지. 검색 응답의 `nearby`로 쓴다.
        change_summary: 후속 조건에서 바뀐 점. 새 검색이면 빠진다.
        items: 카드 목록. 핏 점수 내림차순이다. 결과가 없으면 비어 있다.
        empty_reason: 결과가 없을 때의 원인과 제안. 결과가 있으면 빠진다.
        interpreted_by: 해석한 방법. `LLM`이나 `RULE`이다.
        ranked_by: 순서를 정한 방법. `LLM`이나 `SIMILARITY`다. 결과가 없으면 빠진다.
        fallbacks: 사용자 모르게 대신 처리한 이유
        models: 이번 결과를 낸 모델 버전
    """

    conditions: ConditionsBody
    nearby: bool
    change_summary: str | None = None
    items: list[CardBody]
    empty_reason: EmptyReasonBody | None = None
    interpreted_by: Literal["LLM", "RULE"]
    ranked_by: Literal["LLM", "SIMILARITY"] | None = None
    fallbacks: list[Fallback]
    models: ModelsBody


class ProblemBody(BaseModel):
    """오류 응답(`application/problem+json`). BE 컨벤션의 ProblemDetail과 같은 모양이다.

    Attributes:
        type: 문제 종류 URI. 지금은 `about:blank`다.
        title: HTTP 상태 이름
        status: HTTP 상태 코드
        detail: 일반 문구. 요청 내용은 넣지 않는다.
        code: BE가 분기할 오류 코드
    """

    type: str = "about:blank"
    title: str
    status: int
    detail: str
    code: str
