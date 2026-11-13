"""모임 API(`POST /v1/meetup/interpret`, `POST /v1/meetup/search`). BE의 모임 추천이 부른다.

해석 주소는 모임을 만들거나 설명을 고칠 때 한 번, 계산 주소는 추천받기마다 한 번 부른다
(docs/specs/meetup/spec.md "AI 계약"). 계산 자체는 `fit_ai.match.meetup`이 한다. 여기서는
요청을 검사해 넘기고, 결과를 응답 모양으로 바꾸고, 로그를 남긴다. 이름은 받지 않고 프로필
번호만 받는다. 참여자 답과 설명 원문은 로그에 남기지 않는다. 명세는 docs/comparison/api.md에
있다.
"""

from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import Field, ValidationError, field_validator, model_validator

from fit_ai.match.candidates import RadiusArea, RegionArea, StationArea, StoreError
from fit_ai.match.conditions import STATION_NAMES
from fit_ai.match.interpretation import Conditions, interpret
from fit_ai.match.interpretation.segments import DAYS
from fit_ai.match.meetup import (
    FOOD_CODES,
    MeetupMember,
    MeetupRequest,
    MeetupResult,
    MeetupWhen,
    meetup_search,
)
from fit_ai.match.meetup_menus import read_menus
from fit_ai.match.search import EmbeddingError
from fit_ai.match.taste_select import TasteProfile
from server.common import Body, Dependencies, Slots, log, problem
from server.schemas import ConditionsBody, LegacyConditionsBody
from server.search import (
    MAX_TASTE_FEATURES,
    MAX_TASTE_FREE_TEXTS,
    _card_body,
    _conditions,
    _conditions_body,
    _legacy_conditions,
)

MAX_DESCRIPTION_LENGTH = 100
"""모임 설명 길이 상한. BE의 모임 설명 상한과 같다."""

MAX_MEMBERS = 8
"""참여자 수 상한. BE의 프로필 수 상한과 같다."""

MAX_WANT_MENU_LENGTH = 20
"""먹고 싶은 메뉴 글 길이 상한. BE와 같다."""

FoodName = Literal["KOREAN", "JAPANESE", "CHINESE", "WESTERN", "ASIAN"]
_STATION_CODES = {name: code for code, name in STATION_NAMES.items()}
_BE_FOODS = {code: name for name, code in FOOD_CODES.items()}


class MeetupInterpretBody(Body):
    """모임 설명 해석 요청.

    Attributes:
        text: 모임 설명. 앞뒤 공백을 지운 값이 1~100자다.
    """

    text: str = Field(min_length=1, max_length=MAX_DESCRIPTION_LENGTH)

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("빈 설명")
        return value


class SummaryBody(Body):
    """해석 요약. BE가 보일 질문을 정하는 데 쓴다.

    Attributes:
        mentions_food: 설명에 음식 종류나 메뉴가 있는지
    """

    mentions_food: bool


class MeetupInterpretResponse(Body):
    """모임 설명 해석 응답.

    Attributes:
        conditions: 해석한 조건. BE는 해석하지 않고 저장했다가 계산 요청에 돌려보낸다.
        summary: 해석 요약
        interpreted_by: LLM으로 해석했는지(`LLM`), 규칙으로 대신했는지(`RULE`)
        fallbacks: 대신한 처리. LLM이 실패했으면 `INTERPRET_LLM_FAILED`다.
    """

    conditions: ConditionsBody
    summary: SummaryBody
    interpreted_by: Literal["LLM", "RULE"]
    fallbacks: list[str]


class NamedAreaBody(Body):
    """역·동 지역. 이름으로 보낸다(역은 "역"을 뺀 이름, 동은 동 이름).

    Attributes:
        kind: `STATION` 또는 `DONG`
        name: 이름
    """

    kind: Literal["STATION", "DONG"]
    name: str = Field(min_length=1, max_length=20)


class CircleAreaBody(Body):
    """모임 지점에서 반경 안.

    Attributes:
        kind: `CIRCLE`
        lat: 위도
        lng: 경도
        radius_m: 반경(m)
    """

    kind: Literal["CIRCLE"]
    lat: float = Field(strict=True, allow_inf_nan=False, ge=-90, le=90)
    lng: float = Field(strict=True, allow_inf_nan=False, ge=-180, le=180)
    radius_m: Literal[500, 1000, 2000, 5000]


class WhenBody(Body):
    """모임 날짜와 시각.

    Attributes:
        date: 날짜("2026-11-14")
        time: 시각("19:00"). 없으면 날짜만 본다.
    """

    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str | None = Field(default=None, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")

    @field_validator("date")
    @classmethod
    def _real_date(cls, value: str) -> str:
        date.fromisoformat(value)
        return value


class MemberBody(Body):
    """참여자 한 명의 답. 이름은 받지 않는다. 답하지 않은 질문은 빠진다.

    Attributes:
        key: 프로필 번호
        user_id: 회원이면 회원 id
        mood: 분위기
        like_foods: 선호 음식
        avoid_foods: 못 먹는 음식
        no_spicy: 매운 음식을 못 먹는지
        menu_price_cap_won: 메뉴 하나 가격의 상한(원)
        want_menu: 먹고 싶은 메뉴 글. 적은 그대로다.
    """

    key: str = Field(min_length=1, max_length=20)
    user_id: str | None = Field(default=None, min_length=1, max_length=64)
    mood: Literal["QUIET", "LIVELY"] | None = None
    like_foods: list[FoodName] | None = Field(default=None, max_length=5)
    avoid_foods: list[FoodName] | None = Field(default=None, max_length=5)
    no_spicy: bool | None = Field(default=None, strict=True)
    menu_price_cap_won: int | None = Field(default=None, strict=True, ge=1)
    want_menu: str | None = Field(
        default=None, min_length=1, max_length=MAX_WANT_MENU_LENGTH
    )


class MeetupSearchBody(Body):
    """모임 계산 요청.

    Attributes:
        conditions: 저장한 해석(해석 응답의 `conditions`). 설명이 빈 모임이면 빠진다.
            읽지 못하면 400 `CONDITIONS_INVALID`다.
        area: 지역
        category: 업종. 상관없음이면 빠진다.
        when: 모임 날짜와 시각. 날짜가 없으면 빠진다.
        members: 참여자. 프로필 번호는 서로 달라야 한다.
    """

    conditions: dict[str, Any] | None = None
    area: Annotated[NamedAreaBody | CircleAreaBody, Field(discriminator="kind")]
    category: Literal["RESTAURANT", "CAFE", "BAR"] | None = None
    when: WhenBody | None = None
    members: list[MemberBody] = Field(max_length=MAX_MEMBERS)

    @model_validator(mode="after")
    def _unique_keys(self) -> "MeetupSearchBody":
        keys = [m.key for m in self.members]
        if len(set(keys)) != len(keys):
            raise ValueError("프로필 번호가 겹친다")
        return self


class AppliedBody(Body):
    """적용한 합친 취향. 결과 위 조건 칩에 쓴다."""

    mood: Literal["QUIET", "LIVELY"] | None = None
    like_foods: list[FoodName] | None = None
    avoid_foods: list[FoodName] | None = None
    no_spicy: bool | None = None
    menu_price_cap_won: int | None = None
    want_menus: list[str] | None = None


class MemberScoreBody(Body):
    """장소 하나의 참여자 취향 점수."""

    key: str
    score: int | None = None
    unverified: bool | None = None
    missed_menu: str | None = None


class MeetupReasonTagBody(Body):
    """모임 추천 이유의 근거 칩. BE `MeetupRecommendation.ReasonTag`와 같다.

    Attributes:
        source: 근거 출처(`REQUEST`, `PREFERENCE`)
        label: 칩 문구
    """

    source: str
    label: str


class MeetupReasonBody(Body):
    """모임 추천 이유. BE `MeetupRecommendation.Reason`과 같다. 검색 카드의 추천 이유가 상세 제목 API로
    바뀌기 전 모양이고, 모임에서 연 상세가 그대로 보인다.

    Attributes:
        title: 이유 제목
        tags: 근거 칩
    """

    title: str
    tags: list[MeetupReasonTagBody]


class MeetupItemBody(Body):
    """결과 장소 하나. 장소 기본 정보와 영업 상태는 BE가 채운다."""

    place_id: int
    score: int | None = None
    labels: list[str]
    reasons: list[MeetupReasonBody]
    caution: str | None = None
    member_scores: list[MemberScoreBody]


class MeetupEmptyBody(Body):
    """후보가 없을 때의 원인. 참여자 조건이면 그 프로필 번호가 붙는다."""

    cause: str
    suggestion: str | None = None
    member_keys: list[str] | None = None


class MeetupSearchResponse(Body):
    """모임 계산 응답. 장소는 20곳까지이고 모임 점수 내림차순이다."""

    applied: AppliedBody
    items: list[MeetupItemBody]
    empty_reason: MeetupEmptyBody | None = None
    fallbacks: list[str]


class _ConditionsInvalid(Exception):
    """저장한 해석을 읽지 못했다."""


def router(deps: Dependencies) -> APIRouter:
    """모임 엔드포인트를 만든다. 동시 처리 칸은 검색과 함께 쓴다.

    Args:
        deps: 바깥 의존성

    Returns:
        `POST /v1/meetup/interpret`, `POST /v1/meetup/search`가 있는 라우터
    """
    slots = deps.slots or Slots(deps.max_concurrent)
    r = APIRouter()

    @r.post(
        "/v1/meetup/interpret",
        response_model=MeetupInterpretResponse,
        response_model_exclude_none=True,
    )
    def interpret_request(body: MeetupInterpretBody) -> JSONResponse:
        return slots.run(lambda: _interpret(deps, body))

    @r.post(
        "/v1/meetup/search",
        response_model=MeetupSearchResponse,
        response_model_exclude_none=True,
    )
    def search_request(body: MeetupSearchBody) -> JSONResponse:
        return slots.run(lambda: _search(deps, body))

    return r


def _interpret(deps: Dependencies, body: MeetupInterpretBody) -> JSONResponse:
    interpretation = interpret(
        body.text.strip(), None, deps.gms_timeout, deps.gms_client
    )
    conditions = interpretation.conditions
    response = MeetupInterpretResponse(
        conditions=_conditions_body(conditions, None),
        summary=SummaryBody(mentions_food=mentions_food(conditions)),
        interpreted_by="RULE" if interpretation.by_rules else "LLM",
        fallbacks=(
            ["INTERPRET_LLM_FAILED"] if interpretation.llm_error is not None else []
        ),
    )
    log(
        "meetup_interpret",
        interpreted_by=response.interpreted_by,
        codes=list(conditions.codes),
        mentions_food=response.summary.mentions_food,
        interpret_llm_error=interpretation.llm_error,
        interpret_llm_seconds=interpretation.llm_seconds,
    )
    return JSONResponse(response.model_dump(by_alias=True, exclude_none=True))


def mentions_food(conditions: Conditions) -> bool:
    """설명에 음식 종류나 메뉴가 있는지. 피하는 것("오이 빼고")은 세지 않는다."""
    return any(c.want for c in conditions.food_types) or any(
        m.want for m in conditions.menus
    )


def _search(deps: Dependencies, body: MeetupSearchBody) -> JSONResponse:
    if not deps.embedding_ready:
        return problem(503, "EMBEDDING_UNAVAILABLE", "원격 임베딩 설정이 없거나 틀렸다")
    if deps.store is None:
        return problem(503, "PLACES_UNAVAILABLE", "장소 저장소가 설정되지 않았다")
    try:
        conditions = (
            _read_conditions(body.conditions) if body.conditions is not None else None
        )
    except _ConditionsInvalid:
        log("meetup_conditions_invalid")
        return problem(400, "CONDITIONS_INVALID", "저장한 해석을 읽을 수 없다")
    request = MeetupRequest(
        conditions=conditions,
        area=_area(body.area),
        category=body.category,
        when=_when(body.when),
        members=tuple(_member(m) for m in body.members),
    )
    try:
        result = meetup_search(
            request,
            deps.store,
            lambda texts: read_menus(texts, client=deps.gms_client),
            _taste_reader(deps),
        )
    except EmbeddingError as e:
        log("embedding_failed", error=str(e))
        return problem(503, "EMBEDDING_UNAVAILABLE", "후보 문장을 벡터로 바꾸지 못했다")
    except StoreError as e:
        log("store_failed", error=str(e))
        return problem(503, "PLACES_UNAVAILABLE", "장소 저장소를 읽지 못했다")
    if result.invalid_place_ids:
        log("profile_invalid", place_ids=list(result.invalid_place_ids))
    fallbacks = _fallbacks(result)
    response = MeetupSearchResponse(
        applied=_applied_body(result),
        items=[_item_body(item) for item in result.items],
        empty_reason=(
            MeetupEmptyBody(
                cause=result.empty.cause,
                suggestion=result.empty.suggestion,
                member_keys=list(result.empty.member_keys) or None,
            )
            if result.empty
            else None
        ),
        fallbacks=fallbacks,
    )
    log(
        "meetup_search",
        members=len(body.members),
        area_kind=body.area.kind,
        category=body.category,
        has_conditions=conditions is not None,
        has_when=body.when is not None,
        items=len(result.items),
        empty=result.empty is not None,
        fallbacks=fallbacks,
    )
    return JSONResponse(response.model_dump(by_alias=True, exclude_none=True))


def _read_conditions(data: dict[str, Any]) -> Conditions:
    """저장한 해석을 읽는다. 3차 조건이 아니면 옛 조건으로 읽는다. 못 읽으면 예외다."""
    try:
        if data.get("version") == 3:
            return _conditions(ConditionsBody.model_validate(data))
        return _legacy_conditions(LegacyConditionsBody.model_validate(data))
    except (ValidationError, ValueError, TypeError) as e:
        raise _ConditionsInvalid from e


def _area(
    body: NamedAreaBody | CircleAreaBody,
) -> StationArea | RegionArea | RadiusArea:
    """지역을 거르기 지역으로 바꾼다. 역은 지금 검색의 역 지역, 동은 동만 채운 행정 구역이다.
    모임의 동은 장소가 있는 동 목록(BE `areaNames`)에서 고른 동 이름이다."""
    if isinstance(body, CircleAreaBody):
        return RadiusArea(body.lat, body.lng, body.radius_m)
    if body.kind == "STATION":
        name = body.name.removesuffix("역") + "역"
        return StationArea(name, _STATION_CODES.get(name))
    return RegionArea(dong=body.name)


def _when(body: WhenBody | None) -> MeetupWhen | None:
    if body is None:
        return None
    day = DAYS[date.fromisoformat(body.date).weekday()]
    if body.time is None:
        return MeetupWhen(day)
    hour, minute = body.time.split(":")
    return MeetupWhen(day, int(hour) * 60 + int(minute))


def _member(body: MemberBody) -> MeetupMember:
    return MeetupMember(
        key=body.key,
        user_id=body.user_id,
        mood=body.mood,
        like_foods=tuple(FOOD_CODES[f] for f in body.like_foods or ()),
        avoid_foods=tuple(FOOD_CODES[f] for f in body.avoid_foods or ()),
        no_spicy=body.no_spicy,
        price_cap=body.menu_price_cap_won,
        want_menu=body.want_menu.strip() if body.want_menu else None,
    )


def _taste_reader(deps: Dependencies):
    """회원 id로 평소 취향을 읽는 함수. 저장소가 없으면 None이라 회원은 평소 취향 없이 계산한다."""
    store = deps.taste_store
    if store is None:
        return None

    def read(user_id: str) -> TasteProfile | None:
        profile = store.find(user_id)
        if profile is not None and (
            len(profile.features) > MAX_TASTE_FEATURES
            or len(profile.free_texts) > MAX_TASTE_FREE_TEXTS
        ):
            raise ValueError("too_large")
        return profile

    return read


def _fallbacks(result: MeetupResult) -> list[str]:
    happened = {
        "MENU_LLM_FAILED": result.menus_failed,
        "TASTE_INVALID": result.taste_invalid,
        "PROFILE_INVALID": bool(result.invalid_place_ids),
    }
    return [code for code, yes in happened.items() if yes]


def _applied_body(result: MeetupResult) -> AppliedBody:
    applied = result.applied
    return AppliedBody(
        mood=applied.mood,
        like_foods=[_BE_FOODS[c] for c in applied.like_foods] or None,
        avoid_foods=[_BE_FOODS[c] for c in applied.avoid_foods if c in _BE_FOODS]
        or None,
        no_spicy=True if applied.no_spicy else None,
        menu_price_cap_won=applied.price_cap,
        want_menus=list(applied.want_menus) or None,
    )


def _item_body(item) -> MeetupItemBody:
    card = _card_body(item.card)
    return MeetupItemBody(
        place_id=card.place_id,
        score=item.score,
        labels=card.labels,
        reasons=[
            MeetupReasonBody(
                title=reason.title,
                tags=[
                    MeetupReasonTagBody(source=tag.source.value, label=tag.label)
                    for tag in reason.tags
                ],
            )
            for reason in item.reasons
        ],
        caution=card.caution,
        member_scores=[
            MemberScoreBody(
                key=s.key,
                score=s.score,
                unverified=True if s.unverified else None,
                missed_menu=s.missed_menu,
            )
            for s in item.member_scores
        ],
    )
