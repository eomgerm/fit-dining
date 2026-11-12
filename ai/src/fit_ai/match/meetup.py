"""모임 계산 한 번(docs/specs/meetup/spec.md "AI 계약", decisions.md D-15, D-32).

거르기 → 후보 뽑기 → 사람별 취향 만들기 → 항목별로 합치기 → 모임 점수 → 참여자 취향 점수
순서다. 지금 검색(`fit_ai.match.search`)의 후보 뽑기, 거르기, 조건 점수 기준, 카드 만들기를
그대로 다시 쓰고, 모임에 필요한 것만 더한다.

- 지역·업종은 요청 값이 모임 설명(`conditions`)보다 앞선다. 업종이 없으면 업종으로 거르지
  않는다. 설명이 비면 업종 이름(상관없음이면 "맛집")으로 후보를 뽑는다.
- 모임 날짜·시각에 영업하지 않는다고 확인된 곳, 브레이크타임, 1시간 안에 닫거나 쉬는 곳을
  뺀다. 영업시간을 모르면 남긴다. 판정은 BE의 영업 상태 계산(`OpenStatusCalculator`)과 같다.
- 제약(못 먹는 음식, 매운 음식)은 한 명이라도 해당하면 적용한다.
- 선호(분위기, 선호 음식, 먹고 싶은 메뉴, 메뉴 가격 상한, 평소 취향)는 고른 사람의
  비율을 무게로 합친다(PRD FR-22, D-42). 근거가 없는 쪽은 감점하지 않고 무게에서 빼고 다시 나눈다.
- 모임 점수는 지금 검색의 핏 점수 식(요청 0.7, 취향 0.3)에 "요청 = 모임 설명 조건",
  "취향 = 합친 취향"을 넣는다. 참여자 취향 점수는 그 사람의 취향만 근거 있는 항목으로 낸다.
"""

import math
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field, replace

from fit_ai.features import FEATURES
from fit_ai.match.candidates import (
    CANDIDATE_K,
    GENERAL_K,
    Area,
    Candidate,
    DayHours,
    PlaceDetails,
    PlaceFilter,
    PlaceStore,
    RadiusArea,
    RegionArea,
    StationArea,
    menu_key,
)
from fit_ai.match.cards import Card, build_card
from fit_ai.match.conditions import CATEGORY_NAMES, CONDITIONS, SCORE_LABELS, Layer
from fit_ai.match.interpretation import FOOD_TYPES, Conditions
from fit_ai.match.interpretation.segments import DAYS, Menu
from fit_ai.match.meetup_menus import MenuReading
from fit_ai.match.place import Place, Verdict
from fit_ai.match.scoring import (
    MIN_CONDITION_SCORE,
    REQUEST_WEIGHT,
    Baseline,
    ItemScore,
    PlaceScore,
    baseline_for,
    from_reviews,
    scope_of,
)
from fit_ai.match.search import (
    PRICE_MARGIN,
    _encode,
    _place_filter,
    empty_reason,
    menu_terms,
)
from fit_ai.match.taste_select import TasteFeature, TasteProfile, select_tastes

MOOD_MIN_WEIGHT = 0.5
"""분위기 항목에서 근거가 있는 쪽의 무게 합이 이보다 작으면 분위기를 비교에서 뺀다. 소수
취향의 근거 하나가 점수를 정하지 않게 한다(PRD FR-22, 잠정 OQ-29)."""

SPLIT_FOOD_WEIGHT = 0.25
"""선호 음식이 모두 다른 종류로 갈렸을 때(무게가 모두 1/N) 음식 항목의 비중(잠정 OQ-29)"""

USUAL_TASTE_WEIGHT = 0.5
"""평소 취향의 무게. 이번 모임에서 직접 답한 것보다 약하게 반영한다(잠정 OQ-29)."""

CLOSING_MARGIN_MINUTES = 60
"""모임 시각부터 이 시간 안에 닫거나 브레이크타임이 시작하는 곳은 뺀다(PRD D-37)."""

FETCH_K = CANDIDATE_K * 2
"""영업시간 거르기 전에 뽑는 후보 수. 저장소는 쉬는 날만 미리 빼고 세부 규칙은 후보를 뽑은
뒤 거르므로, 거르고도 점수를 낼 후보(`CANDIDATE_K`)가 남게 넉넉히 뽑는다."""

EMPTY_QUERY = "맛집"
"""모임 설명이 비고 업종이 상관없음일 때 후보를 뽑는 문장(spec AC-57, 잠정)"""

FOOD_CODES = {
    "KOREAN": "FOOD_KOREAN",
    "JAPANESE": "FOOD_JAPANESE",
    "CHINESE": "FOOD_CHINESE",
    "WESTERN": "FOOD_WESTERN",
    "ASIAN": "FOOD_ASIAN",
}
"""모임 질문의 음식 종류(BE `FoodType`)와 점수용 코드"""

FOOD_SPICY = "FOOD_SPICY"
MOODS = ("QUIET", "LIVELY")
_DAY_MINUTES = 24 * 60


@dataclass(frozen=True)
class MeetupMember:
    """참여자 한 명의 이번 모임 답. 이름은 받지 않는다.

    Attributes:
        key: 프로필 번호. 결과의 참여자 점수와 후보 없음 원인에 그대로 돌려준다.
        user_id: 회원이면 회원 id. 평소 취향을 읽는다.
        mood: 분위기(`QUIET`, `LIVELY`). 답하지 않았으면 None이다.
        like_foods: 선호 음식 코드(`FOOD_KOREAN` 등)
        avoid_foods: 못 먹는 음식 코드
        no_spicy: 매운 음식을 못 먹는지. 답하지 않았으면 None이다.
        price_cap: 메뉴 하나 가격의 상한(원). 없으면 None이다.
        want_menu: 먹고 싶은 메뉴 글. 없으면 None이다.
    """

    key: str
    user_id: str | None = None
    mood: str | None = None
    like_foods: tuple[str, ...] = ()
    avoid_foods: tuple[str, ...] = ()
    no_spicy: bool | None = None
    price_cap: int | None = None
    want_menu: str | None = None


@dataclass(frozen=True)
class MeetupWhen:
    """모임 날짜와 시각.

    Attributes:
        day: 요일(`MON`~`SUN`)
        minute: 0시부터 센 분. 시각이 없으면 None이다.
    """

    day: str
    minute: int | None = None


@dataclass(frozen=True)
class MeetupRequest:
    """모임 계산 요청.

    Attributes:
        conditions: 저장한 모임 설명 해석. 설명이 비었으면 None이다.
        area: 지역. 역, 동, 지점 반경이다.
        category: 업종. 상관없음이면 None이다.
        when: 모임 날짜와 시각. 날짜가 없으면 None이다.
        members: 참여자
    """

    conditions: Conditions | None
    area: StationArea | RegionArea | RadiusArea
    category: str | None
    when: MeetupWhen | None
    members: tuple[MeetupMember, ...]


@dataclass(frozen=True)
class MemberScore:
    """장소 하나의 참여자 취향 점수.

    Attributes:
        key: 프로필 번호
        score: 0~100 정수. 판정할 항목이 없으면 None이다.
        unverified: 근거가 없어 뺀 항목이 있는지
        missed_menu: 그 사람이 원한 메뉴가 메뉴판에 하나도 없으면 적은 순서의 첫 메뉴
    """

    key: str
    score: int | None
    unverified: bool = False
    missed_menu: str | None = None


@dataclass(frozen=True)
class MeetupItem:
    """결과 장소 하나.

    Attributes:
        card: 카드(추천 이유, 라벨). 카드의 점수 대신 `score`를 쓴다.
        score: 모임 점수(0~100 정수). 점수를 매길 조건이 없으면 None이다.
        member_scores: 참여자 취향 점수. 요청의 참여자 순서다.
    """

    card: Card
    score: int | None
    member_scores: tuple[MemberScore, ...]


@dataclass(frozen=True)
class Applied:
    """적용한 합친 취향. 결과 위 조건 칩에 쓴다.

    Attributes:
        mood: 무게가 큰 쪽의 분위기. 같으면 None이다.
        like_foods: 선호 음식 코드. 고른 사람이 많은 순서다.
        avoid_foods: 못 먹는 음식 코드
        no_spicy: 매운 음식을 덜 추천했는지
        price_cap: 참여자들의 메뉴 가격 상한 중 가장 낮은 값(원). 거르지 않고 점수에
            반영한다.
        want_menus: 해석한 메뉴 이름. 적은 사람이 많은 순서다.
    """

    mood: str | None = None
    like_foods: tuple[str, ...] = ()
    avoid_foods: tuple[str, ...] = ()
    no_spicy: bool = False
    price_cap: int | None = None
    want_menus: tuple[str, ...] = ()


@dataclass(frozen=True)
class MeetupEmpty:
    """후보가 없을 때의 원인.

    Attributes:
        cause: 원인
        suggestion: 수정 제안
        member_keys: 원인이 참여자 조건이면 그 프로필 번호
    """

    cause: str
    suggestion: str
    member_keys: tuple[str, ...] = ()


@dataclass(frozen=True)
class MeetupResult:
    """모임 계산 결과.

    Attributes:
        items: 결과 장소. 모임 점수 내림차순이고, 점수가 없으면 후보 순서다. 20곳까지다.
        applied: 적용한 합친 취향
        empty: 후보가 없을 때의 원인. 있으면 None이다.
        invalid_place_ids: 프로필을 읽지 못해 뺀 장소 id
        menus_failed: 먹고 싶은 메뉴 LLM이 실패해 규칙으로 해석했는지
        taste_invalid: 회원의 평소 취향을 읽지 못한 사람이 있는지
    """

    items: tuple[MeetupItem, ...]
    applied: Applied
    empty: MeetupEmpty | None = None
    invalid_place_ids: tuple[int, ...] = ()
    menus_failed: bool = False
    taste_invalid: bool = False


@dataclass(frozen=True)
class _Person:
    """사람 한 명의 취향(PRD FR-22 1단계). 이번 답이 있으면 답, 없으면 회원의 평소 취향이다.

    Attributes:
        key: 프로필 번호
        member: 회원인지
        mood: 분위기 코드. 없으면 None이다.
        foods: 선호 음식 코드
        spicy_averse: 매운 음식을 못 먹거나 싫어하는지
        menus: 해석한 먹고 싶은 메뉴. 적은 순서다.
        usual: 평소 취향 중 분위기·음식·방문 목적을 뺀 나머지
        price_cap: 메뉴 가격 상한(원). 답하지 않았으면 None이다.
    """

    key: str
    member: bool
    mood: str | None = None
    foods: tuple[str, ...] = ()
    spicy_averse: bool = False
    menus: tuple[Menu, ...] = ()
    usual: tuple[TasteFeature, ...] = ()
    price_cap: int | None = None


@dataclass(frozen=True)
class _Merged:
    """항목마다 합친 취향(PRD FR-22 2단계).

    Attributes:
        moods: 분위기 코드별 무게(고른 사람 수 / 답한 사람 수)
        foods: 음식 종류별 무게
        food_weight: 음식 항목의 비중. 모두 다른 종류로 갈렸으면 `SPLIT_FOOD_WEIGHT`다.
        spicy: 매운 음식을 덜 추천하는지
        menus: 메뉴별(표준 이름을 `menu_key`로 바꾼 값) (적은 사람 수, 표준 이름, 찾을 말)
        usual: 평소 취향 코드별 (좋아함, 무게)
        prices: 참여자들의 메뉴 가격 상한(원)
    """

    moods: dict[str, float] = field(default_factory=dict)
    foods: dict[str, float] = field(default_factory=dict)
    food_weight: float = 1.0
    spicy: bool = False
    menus: dict[str, tuple[int, str, tuple[str, ...]]] = field(default_factory=dict)
    usual: dict[str, tuple[bool, float]] = field(default_factory=dict)
    prices: tuple[int, ...] = ()


def meetup_search(
    request: MeetupRequest,
    store: PlaceStore,
    read_menus: Callable[[Sequence[str]], MenuReading],
    tastes: Callable[[str], TasteProfile | None] | None = None,
) -> MeetupResult:
    """모임 계산을 한 번 한다.

    Args:
        request: 모임 계산 요청
        store: 장소 저장소
        read_menus: 먹고 싶은 메뉴 글을 한 번에 해석하는 함수
        tastes: 회원 id로 평소 취향을 읽는 함수. 없거나 읽지 못하면 평소 취향 없이 계산하고
            `taste_invalid`를 세운다. 그 회원의 취향이 없으면 None을 돌려준다.

    Returns:
        결과

    Raises:
        EmbeddingError: 후보를 뽑을 문장을 벡터로 바꾸지 못했을 때
        StoreError: 장소 저장소를 읽지 못했을 때
    """
    conditions = request.conditions
    texts = [m.want_menu for m in request.members if m.want_menu]
    reading = read_menus(texts) if texts else MenuReading(())
    menus_by_key = _menus_by_key(request.members, reading)
    people, taste_invalid = _people(request, menus_by_key, tastes)
    merged = _merge(people, conditions)

    avoid = tuple(
        dict.fromkeys(
            [*(f for m in request.members for f in m.avoid_foods)]
            + [
                f
                for f in (conditions.avoid_foods if conditions else ())
                if f in FOOD_TYPES
            ]
        )
    )
    applied = Applied(
        mood=_leading(merged.moods),
        like_foods=tuple(sorted(merged.foods, key=lambda c: -merged.foods[c])),
        avoid_foods=avoid,
        no_spicy=merged.spicy,
        price_cap=min(merged.prices) if merged.prices else None,
        want_menus=tuple(
            name for _, name, _ in sorted(merged.menus.values(), key=lambda m: -m[0])
        ),
    )

    base = PlaceFilter(category_group=request.category, areas=(request.area,))
    full = _full_filter(base, conditions, request.when, avoid)
    query = _encode(_query_text(conditions, request.category))
    found, invalid, details = _fetch(store, full, query, request.when)
    if not found:
        empty = _empty_reason(store, query, base, full, request, conditions, avoid)
        return MeetupResult(
            (), applied, empty, invalid, reading.llm_failed, taste_invalid
        )

    candidates = found[:CANDIDATE_K]
    if not details:
        details = store.details([c.place.place_id for c in candidates])
    baseline = baseline_for(store.places())
    scope = scope_of(request.category, ())
    request_codes = [
        c
        for c in dict.fromkeys(conditions.codes if conditions else ())
        if c in SCORE_LABELS
    ]
    scored = [
        _score(
            c,
            details.get(c.place.place_id, PlaceDetails()),
            request_codes,
            merged,
            people,
            scope,
            baseline,
        )
        for c in candidates
    ]
    # 정렬은 안정적이라 점수가 같거나 없으면 후보 순서(유사도)다.
    scored.sort(key=lambda item: (item.score is None, -(item.score or 0)))
    return MeetupResult(
        tuple(scored[:GENERAL_K]),
        applied,
        None,
        invalid,
        reading.llm_failed,
        taste_invalid,
    )


def is_open(hours: Sequence[DayHours], when: MeetupWhen) -> bool:
    """모임 날짜·시각에 남길 장소인지. 안 맞는다고 확인된 곳만 뺀다.

    시각이 없으면 그 요일에 쉬는 곳만 뺀다. 시각이 있으면 BE의 영업 상태 계산과 같은
    규칙으로 그 시각의 상태를 내고, 영업 중이 아니거나(닫음, 브레이크타임), 1시간 안에 닫거나
    브레이크타임이 시작하면 뺀다. 전날 밤부터 이어지는 영업은 영업 중이다. 영업시간을 모르면
    남긴다.

    Args:
        hours: 요일별 영업시간
        when: 모임 날짜와 시각

    Returns:
        남기면 True
    """
    by_day = {h.day: h for h in hours}
    today = DAYS.index(when.day)
    if when.minute is None:
        row = by_day.get(when.day)
        return not (row is not None and row.closed)
    minute = when.minute
    for offset in (-1, 0):
        span = _interval(by_day, today + offset, offset)
        if span is None or not span[0] <= minute < span[1]:
            continue
        _, end, breaks = span
        if any(b0 <= minute < b1 for b0, b1 in breaks):
            return False
        end = _merged_end(by_day, today + offset, offset, end)
        if minute >= end - CLOSING_MARGIN_MINUTES:
            return False
        return not any(
            minute < b0 <= minute + CLOSING_MARGIN_MINUTES for b0, _ in breaks
        )
    row = by_day.get(when.day)
    if _unknown(row):
        return True
    today_span = _interval(by_day, today, 0)
    if today_span is not None and minute < today_span[0]:
        return _unknown(by_day.get(DAYS[(today - 1) % 7]))
    return False


def _unknown(row: DayHours | None) -> bool:
    """그 요일의 영업시간을 모르는지. 쉬는 날이 아닌데 여는 시각이 없거나 읽지 못해도 모른다."""
    if row is None:
        return True
    if row.closed:
        return False
    try:
        _minutes(row.open or "")
        _minutes(row.close or "")
    except ValueError:
        return True
    return False


def _interval(
    by_day: dict[str, DayHours], day_index: int, offset: int
) -> tuple[int, int, list[tuple[int, int]]] | None:
    """요일의 영업 구간(시작, 끝, 브레이크)을 모임 날 0시 기준 분으로. 영업 시각이 없으면 None."""
    row = by_day.get(DAYS[day_index % 7])
    if row is None or row.closed or row.open is None or row.close is None:
        return None
    try:
        open_at, close_at = _minutes(row.open), _minutes(row.close)
        base = offset * _DAY_MINUTES
        breaks = []
        for b_start, b_end in row.breaks:
            s = _minutes(b_start) + (_DAY_MINUTES if _minutes(b_start) < open_at else 0)
            e = _minutes(b_end) + (_DAY_MINUTES if _minutes(b_end) < open_at else 0)
            breaks.append((base + s, base + (e if e > s else e + _DAY_MINUTES)))
    except ValueError:
        return None
    end = close_at if close_at > open_at else close_at + _DAY_MINUTES
    return base + open_at, base + end, breaks


def _merged_end(
    by_day: dict[str, DayHours], day_index: int, offset: int, end: int
) -> int:
    """끝이 다음 요일 구간의 시작과 같은 동안 잇는다. 일주일 뒤에서 멈춘다."""
    for step in range(1, 8):
        following = _interval(by_day, day_index + step, offset + step)
        if following is None or following[0] != end:
            break
        end = following[1]
    return end


def _minutes(clock: str) -> int:
    """ "HH:MM" 또는 "HH:MM:SS"를 0시부터 센 분으로. 모양이 틀리면 ValueError다."""
    hour, minute = clock.split(":")[:2]
    value = int(hour) * 60 + int(minute)
    if not 0 <= value < _DAY_MINUTES:
        raise ValueError(clock)
    return value


def _query_text(conditions: Conditions | None, category: str | None) -> str:
    """후보를 뽑을 문장. 설명이 있으면 해석한 문장, 없으면 업종 이름이다(spec AC-57)."""
    if conditions is not None and conditions.embedding_text.strip():
        return conditions.embedding_text
    return CATEGORY_NAMES.get(category or "", EMPTY_QUERY)


def _full_filter(
    base: PlaceFilter,
    conditions: Conditions | None,
    when: MeetupWhen | None,
    avoid: tuple[str, ...],
) -> PlaceFilter:
    """모든 거르기. 설명의 시설·메뉴·가격·시간에 못 먹는 음식을 더한다.

    지역·업종은 요청 값이 앞서므로 설명의 지역·업종은 쓰지 않는다. 모임 날짜가 있으면 설명의
    시간 대신 모임 날짜로 거른다. 저장소는 모임 요일에 쉬는 곳만 미리 빼고(시각이 있으면
    전날 밤부터 이어질 수 있는 곳은 남긴다), 세부 규칙은 후보를 뽑은 뒤 `is_open`이 본다.
    참여자의 메뉴 가격 상한은 거르지 않고 점수에 반영한다(`_score`).
    """
    described = (
        _place_filter(conditions, base.areas)
        if conditions is not None
        else PlaceFilter()
    )
    return replace(
        base,
        facilities=described.facilities,
        menus=described.menus,
        hours=None if when is not None else described.hours,
        min_price=described.min_price,
        max_price=described.max_price,
        excluded_food_types=avoid,
        closed_day=when.day if when is not None else None,
        overnight_day=(
            DAYS[DAYS.index(when.day) - 1]
            if when is not None and when.minute is not None
            else None
        ),
    )


def _fetch(
    store: PlaceStore,
    place_filter: PlaceFilter,
    query: Sequence[float],
    when: MeetupWhen | None,
) -> tuple[list[Candidate], tuple[int, ...], dict[int, PlaceDetails]]:
    """후보를 뽑고 모임 날짜·시각으로 거른다. 거르느라 읽은 장소 정보도 돌려준다."""
    found = store.find(place_filter, query, FETCH_K if when else CANDIDATE_K)
    candidates = list(found.candidates)
    details: dict[int, PlaceDetails] = {}
    if when is not None and candidates:
        details = store.details([c.place.place_id for c in candidates])
        candidates = [
            c
            for c in candidates
            if is_open(details.get(c.place.place_id, PlaceDetails()).hours, when)
        ]
    return candidates, found.invalid, details


def _menus_by_key(
    members: Sequence[MeetupMember], reading: MenuReading
) -> dict[str, tuple[Menu, ...]]:
    """참여자마다 해석한 메뉴. 해석은 글을 적은 참여자 순서로 왔다."""
    writers = [m.key for m in members if m.want_menu]
    return dict(zip(writers, reading.menus, strict=False))


def _people(
    request: MeetupRequest,
    menus_by_key: dict[str, tuple[Menu, ...]],
    tastes: Callable[[str], TasteProfile | None] | None,
) -> tuple[list[_Person], bool]:
    """사람마다 취향을 만든다(PRD FR-22 1단계). 이번 답이 평소 취향보다 앞선다.

    평소 취향은 회원만 있다. 분위기·음식·매운맛은 이번에 답하지 않은 항목만 평소 취향으로
    채우고, 방문 목적은 쓰지 않는다. 카페 모임은 음식을 묻지 않으므로 평소 음식 취향도 쓰지
    않는다. 나머지(중요 기준 등)는 평소 취향 묶음으로 둔다.
    """
    people = []
    invalid = False
    food_asked = request.category in (None, "RESTAURANT", "BAR")
    for member in request.members:
        profile = None
        if member.user_id is not None and tastes is not None:
            try:
                profile = tastes(member.user_id)
            except Exception:  # noqa: BLE001 - 평소 취향은 보조라 계산은 막지 않는다
                invalid = True
        elif member.user_id is not None:
            invalid = True
        usual = (
            select_tastes(profile.features, (), category_group=request.category)
            if profile
            else ()
        )
        mood = member.mood or _usual_mood(usual)
        foods = member.like_foods
        if not foods and food_asked and request.category != "BAR":
            foods = tuple(f.code for f in usual if f.like and f.code in FOOD_TYPES)
        spicy = member.no_spicy
        if spicy is None and food_asked:
            spicy = any(f.code == FOOD_SPICY and not f.like for f in usual)
        rest = tuple(
            f
            for f in usual
            if f.code in SCORE_LABELS
            and _layer(f.code) not in (Layer.AXIS, Layer.PURPOSE, Layer.FOOD)
        )
        people.append(
            _Person(
                key=member.key,
                member=member.user_id is not None,
                mood=mood,
                foods=tuple(dict.fromkeys(foods)),
                spicy_averse=bool(spicy),
                menus=menus_by_key.get(member.key, ()),
                usual=rest,
                price_cap=member.price_cap,
            )
        )
    return people, invalid


def _usual_mood(usual: Iterable[TasteFeature]) -> str | None:
    """평소 취향의 분위기. 좋아하는 소음 축 중 세기가 가장 큰 쪽이다."""
    liked = [f for f in usual if f.like and f.code in MOODS]
    return max(liked, key=lambda f: f.weight).code if liked else None


def _layer(code: str) -> Layer | None:
    feature = FEATURES.get(code)
    if feature is not None:
        return Layer(feature.layer)
    condition = CONDITIONS.get(code)
    return condition.layer if condition else None


def _merge(people: Sequence[_Person], conditions: Conditions | None) -> _Merged:
    """항목마다 합친다(PRD FR-22 2단계). 선호는 고른 사람의 비율이 무게다.

    모임 설명에 분위기가 있으면 설명을 따르고 참여자의 분위기는 합치지 않는다. 설명에 음식
    종류나 메뉴가 있으면 음식 질문을 묻지 않으므로 평소 음식 취향도 합치지 않는다.
    """
    described = set(conditions.codes) if conditions else set()
    described_food = bool(
        conditions
        and (any(c.want for c in conditions.food_types) or menu_terms(conditions.menus))
    )
    moods: dict[str, float] = {}
    if not described & set(MOODS):
        voters = [p.mood for p in people if p.mood in MOODS]
        moods = {
            code: voters.count(code) / len(voters) for code in dict.fromkeys(voters)
        }
    foods: dict[str, float] = {}
    food_weight = 1.0
    choosers = [p.foods for p in people if p.foods] if not described_food else []
    if choosers:
        counts: dict[str, int] = {}
        for chosen in choosers:
            for code in chosen:
                counts[code] = counts.get(code, 0) + 1
        foods = {code: n / len(choosers) for code, n in counts.items()}
        if len(choosers) >= 2 and max(foods.values()) <= 1 / len(choosers) + 1e-9:
            food_weight = SPLIT_FOOD_WEIGHT
    menus: dict[str, tuple[int, str, tuple[str, ...]]] = {}
    for person in people:
        mine: dict[str, tuple[str, tuple[str, ...]]] = {}
        for terms, name in _menu_terms(person.menus):
            # 같은 사람이 같은 메뉴를 여러 표기로 적어도 한 번만 센다.
            key = menu_key(name)
            known = mine.get(key, (name, ()))
            mine[key] = (known[0], tuple(dict.fromkeys(known[1] + terms)))
        for key, (name, terms) in mine.items():
            count, first, before = menus.get(key, (0, name, ()))
            menus[key] = (count + 1, first, tuple(dict.fromkeys(before + terms)))
    members = [p for p in people if p.member]
    usual: dict[str, tuple[bool, float]] = {}
    if members:
        holders: dict[str, list[bool]] = {}
        for person in members:
            for feature in {f.code: f for f in person.usual}.values():
                holders.setdefault(feature.code, []).append(feature.like)
        for code, likes in holders.items():
            like = likes.count(True) >= likes.count(False)
            usual[code] = (like, len(likes) / len(members) * USUAL_TASTE_WEIGHT)
    return _Merged(
        moods=moods,
        foods=foods,
        food_weight=food_weight,
        spicy=any(p.spicy_averse for p in people),
        menus=menus,
        usual=usual,
        prices=tuple(p.price_cap for p in people if p.price_cap is not None),
    )


def _menu_terms(menus: Sequence[Menu]) -> list[tuple[tuple[str, ...], str]]:
    """메뉴마다 (찾을 말 묶음, 표준 이름). 넓은 말(커피, 고기 등)은 뺀다."""
    pairs = []
    for menu in menus:
        terms = menu_terms((menu,))
        if terms:
            pairs.append((terms[0], menu.value))
    return pairs


def _leading(weights: dict[str, float]) -> str | None:
    """무게가 가장 큰 하나. 같으면 None이다."""
    if not weights:
        return None
    top = max(weights.values())
    leaders = [code for code, w in weights.items() if math.isclose(w, top)]
    return leaders[0] if len(leaders) == 1 else None


def _known(place: Place, code: str) -> bool:
    """장소에 그 조건을 판정할 근거가 있는지. 근거가 없으면 감점하지 않고 비교에서 뺀다."""
    if code in FOOD_TYPES:
        return place.info.food_type is not None
    if not from_reviews(code):
        return place.info.facilities.get(code) is not None
    evidence = place.evidence(code)
    return bool(place.info.review_count) and evidence.pos + evidence.neg > 0


def _verdict(place: Place, code: str) -> float | None:
    """참여자 점수의 항목 판정. 맞음 1, 아님 0, 모름 None이다."""
    if code in FOOD_TYPES:
        if place.info.food_type is None:
            return None
        return float(place.info.food_type == code)
    if code in CONDITIONS:
        verdict = place.judge(code)
        if verdict is Verdict.UNKNOWN:
            return None
        return 1.0 if verdict is Verdict.CONFIRMED else 0.0
    evidence = place.evidence(code)
    if evidence.supported:
        return 1.0
    if evidence.neg > evidence.pos:
        return 0.0
    return None


def _sold(details: PlaceDetails, terms: tuple[str, ...]) -> bool | None:
    """메뉴판에 그 메뉴가 있는지. 가게 이름과 업종 이름도 본다. 메뉴판을 모르면 None이다."""
    names = [menu_key(n) for n in details.menus]
    names += [menu_key(n) for n in (details.name, details.category) if n]
    if any(term in name for term in terms for name in names):
        return True
    return False if details.menus else None


def _within(price: int, cap: int) -> bool:
    """가게 가격이 메뉴 가격 상한의 여유(`PRICE_MARGIN`) 안인지"""
    return price <= round(cap * (1 + PRICE_MARGIN))


def _score(
    candidate: Candidate,
    details: PlaceDetails,
    request_codes: Sequence[str],
    merged: _Merged,
    people: Sequence[_Person],
    scope: frozenset[str],
    baseline: Baseline,
) -> MeetupItem:
    """후보 하나의 모임 점수, 참여자 점수, 카드를 낸다."""
    place = candidate.place
    shown: list[ItemScore] = []
    request = []
    for code in request_codes:
        value = baseline.value(place, code, scope)
        request.append(max(value, MIN_CONDITION_SCORE))
        shown.append(_shown(place, code, True, 1.0, value))
    taste: list[tuple[float, float]] = []

    # 분위기: 근거가 있는 쪽만 남겨 다시 나눈다. 남은 무게가 작으면 뺀다.
    sides = {code: w for code, w in merged.moods.items() if _known(place, code)}
    if sides and sum(sides.values()) >= MOOD_MIN_WEIGHT:
        total = sum(sides.values())
        value = (
            sum(baseline.value(place, c, scope) * w for c, w in sides.items()) / total
        )
        taste.append((1.0, value))
        for code, w in sides.items():
            shown.append(
                _shown(place, code, False, w, baseline.value(place, code, scope))
            )
    # 선호 음식: 그 장소에 맞는 종류의 무게 ÷ 가장 큰 무게
    if merged.foods and place.info.food_type is not None:
        top = max(merged.foods.values())
        value = merged.foods.get(place.info.food_type, 0.0) / top
        taste.append((merged.food_weight, value))
        if place.info.food_type in merged.foods:
            shown.append(
                _shown(place, place.info.food_type, False, merged.food_weight, 1.0)
            )
    # 매운 음식: 빼지 않고 덜 추천한다. 근거가 없으면 감점하지 않는다.
    if merged.spicy and _known(place, FOOD_SPICY):
        taste.append((1.0, 1 - baseline.value(place, FOOD_SPICY, scope)))
    # 메뉴 가격: 가게 가격이 상한의 110% 안인 사람의 비율. 가게 가격을 모르면 뺀다.
    if merged.prices and details.price is not None:
        fits = [_within(details.price, cap) for cap in merged.prices]
        taste.append((1.0, sum(fits) / len(fits)))
    # 먹고 싶은 메뉴: 파는 메뉴 중 가장 큰 무게 ÷ 가장 큰 무게. 메뉴판을 모르면 뺀다.
    if merged.menus:
        sold = [(n, _sold(details, terms)) for n, _, terms in merged.menus.values()]
        if any(v is not None for _, v in sold):
            top = max(n for n, _ in sold)
            best = max((n for n, v in sold if v), default=0)
            taste.append((1.0, best / top))
    # 평소 취향: 가진 사람 비율 × 0.5. 근거가 없으면 뺀다.
    for code, (like, weight) in merged.usual.items():
        if code in request_codes or not _known(place, code):
            continue
        value = baseline.value(place, code, scope)
        taste.append((weight, value if like else 1 - value))
        if like:
            shown.append(_shown(place, code, False, weight, value))

    score = _fit(request, taste)
    card = build_card(PlaceScore(candidate, score, tuple(shown)))
    return MeetupItem(
        card, score, tuple(_member_score(p, place, details) for p in people)
    )


def _shown(
    place: Place, code: str, request: bool, weight: float, value: float
) -> ItemScore:
    """카드의 추천 이유와 라벨에 쓰는 항목"""
    reviews = from_reviews(code)
    return ItemScore(
        code=code,
        request=request,
        like=True,
        weight=weight,
        value=value,
        evidence_count=place.evidence(code).pos if reviews else 0,
        from_reviews=reviews,
    )


def _fit(request: Sequence[float], taste: Sequence[tuple[float, float]]) -> int | None:
    """모임 점수. 요청은 기하평균, 취향은 무게 평균이고 요청 0.7, 취향 0.3으로 더한다.

    한쪽만 있으면 그쪽만 쓴다. 설명이 빈 모임은 취향만으로 100%를 낸다. 둘 다 없으면 None이다.
    """
    request_score = (
        math.exp(sum(map(math.log, request)) / len(request)) if request else None
    )
    weights = sum(w for w, _ in taste)
    taste_score = sum(w * v for w, v in taste) / weights if weights else None
    if request_score is None and taste_score is None:
        return None
    if request_score is None:
        fit = taste_score
    elif taste_score is None:
        fit = request_score
    else:
        fit = REQUEST_WEIGHT * request_score + (1 - REQUEST_WEIGHT) * taste_score
    return round(100 * fit)


def _member_score(person: _Person, place: Place, details: PlaceDetails) -> MemberScore:
    """참여자 한 명의 취향 점수. 그 사람의 취향만, 근거가 있는 항목만으로 낸다.

    이번 답은 무게 1, 평소 취향은 `USUAL_TASTE_WEIGHT`다. 모임 설명은 넣지 않는다.
    """
    items: list[tuple[float, float]] = []
    skipped = False

    def add(weight: float, value: float | None) -> None:
        nonlocal skipped
        if value is None:
            skipped = True
        else:
            items.append((weight, value))

    if person.mood:
        add(1.0, _verdict(place, person.mood))
    if person.foods:
        add(
            1.0,
            None
            if place.info.food_type is None
            else float(place.info.food_type in person.foods),
        )
    if person.spicy_averse:
        spicy = _verdict(place, FOOD_SPICY)
        add(1.0, None if spicy is None else 1 - spicy)
    if person.price_cap is not None:
        add(
            1.0,
            None
            if details.price is None
            else float(_within(details.price, person.price_cap)),
        )
    missed = None
    groups = _menu_terms(person.menus)
    if groups:
        sold = [_sold(details, terms) for terms, _ in groups]
        if all(v is None for v in sold):
            add(1.0, None)
        else:
            hit = any(sold)
            add(1.0, float(hit))
            if not hit:
                missed = groups[0][1]
    for feature in person.usual:
        value = _verdict(place, feature.code)
        add(
            USUAL_TASTE_WEIGHT,
            None if value is None else value if feature.like else 1 - value,
        )
    weights = sum(w for w, _ in items)
    score = round(100 * sum(w * v for w, v in items) / weights) if weights else None
    return MemberScore(person.key, score, skipped, missed)


def _empty_reason(
    store: PlaceStore,
    query: Sequence[float],
    base: PlaceFilter,
    full: PlaceFilter,
    request: MeetupRequest,
    conditions: Conditions | None,
    avoid: tuple[str, ...],
) -> MeetupEmpty:
    """후보가 없을 때 조건을 하나씩 빼 보고 결과가 생기는 조건을 원인으로 준다.

    조건을 자동으로 완화하지 않는다. 원인이 참여자의 조건이면 그 프로필 번호를 붙인다.
    """
    where = _area_label(request.area)
    what = CATEGORY_NAMES.get(request.category or "", "가게")
    if not _fetch(store, base, query, None)[0]:
        return MeetupEmpty(
            f"{where} {what} 중 아직 찾을 수 있는 곳이 없어요",
            "다른 지역이나 업종으로 모임 정보를 바꿔 보세요",
        )
    members = request.members
    tries: list[tuple[PlaceFilter, MeetupWhen | None, MeetupEmpty]] = []
    if request.when is not None:
        tries.append(
            (
                replace(full, closed_day=None, overnight_day=None),
                None,
                MeetupEmpty(
                    f"{where} {what} 중 모임 시간에 여는 곳이 없어요",
                    "모임 날짜나 시간을 바꿔 보세요",
                ),
            )
        )
    if avoid:
        keys = tuple(m.key for m in members if m.avoid_foods)
        tries.append(
            (
                replace(full, excluded_food_types=()),
                request.when,
                MeetupEmpty(
                    f"{where} {what} 중 못 먹는 음식을 빼면 남는 곳이 없어요",
                    "못 먹는 음식을 다시 확인해 보세요",
                    keys,
                ),
            )
        )
    if conditions is not None:
        constraint = _full_filter(base, None, request.when, avoid)
        reason = empty_reason(conditions, (request.area,))
        tries.append(
            (constraint, request.when, MeetupEmpty(reason.cause, reason.suggestion))
        )
    for place_filter, when, empty in tries:
        if _fetch(store, place_filter, query, when)[0]:
            return empty
    return MeetupEmpty(
        f"{where} {what} 중 모든 조건에 맞는 곳이 없어요",
        "조건을 하나씩 줄여 보세요",
    )


def _area_label(area: Area) -> str:
    """원인 문구의 지역 이름"""
    match area:
        case StationArea() | RegionArea():
            return area.name
        case RadiusArea():
            radius = area.radius_m
            distance = f"{radius / 1000:g}km" if radius >= 1000 else f"{radius:g}m"
            return f"모임 지점 {distance} 안"
    return "모임 지역"
