"""이전 조건과 이번 요청 합치기. 해석은 이번 요청만 조각으로 내고 합치는 일은 여기서 한다.

분류마다 규칙이 정해져 있다(docs/comparison/conditions-v3.md 4장). 업종·지역·가격·가게
이름·인원은 이번 요청에 있으면 바꾸고, 음식 종류·맛·메뉴는 같은 값을 이번 것으로 덮고,
특징·시설은 잇고, 시간은 같은 종류를 덮는다.
"""

from collections.abc import Callable, Collection, Sequence

from fit_ai.features import FEATURES
from fit_ai.match.interpretation.request import (
    MAX_TEXT_LENGTH,
    Conditions,
    _join,
    _plain,
    _without_location,
)
from fit_ai.match.interpretation.segments import MAX_SEGMENTS, Choice, Hours


def merge(
    previous: Conditions, turn: Conditions, dropped: Collection[str] = ()
) -> Conditions:
    """이전 조건에 이번 요청의 조각을 합친다.

    Args:
        previous: 이전 조건
        turn: 이번 요청만 해석한 조건
        dropped: 이번 요청이 빼 달라고 한 이전 코드("조용한 데 말고"의 `QUIET`). 특징과
            시설에서 지운다.

    Returns:
        합친 조건
    """
    wanted = {f.code for f in turn.features if f.code}
    removed = {*dropped, *(_opposite(code) for code in wanted)}
    features = [
        f for f in previous.features if f.code is None or f.code not in removed
    ] + list(turn.features)
    categories = _categories(previous.categories, turn.categories)
    category_group = next((c.code for c in categories if c.want), None)
    return Conditions(
        text=_join(previous.text, turn.text)[:MAX_TEXT_LENGTH],
        embedding_text=_without_location(
            _join(previous.embedding_text, turn.embedding_text), category_group
        ).strip()[:MAX_TEXT_LENGTH],
        categories=categories,
        food_types=_override(previous.food_types, turn.food_types, _code),
        flavors=_override(previous.flavors, turn.flavors, _code),
        menus=_override(previous.menus, turn.menus, lambda m: _plain(m.value)),
        features=tuple(_unique(features, lambda f: f.code or _plain(f.value)))[
            -MAX_SEGMENTS:
        ],
        facilities=tuple(
            dict.fromkeys(
                [c for c in previous.facilities if c not in dropped]
                + list(turn.facilities)
            )
        ),
        party_size=turn.party_size or previous.party_size,
        # "근처로"라고 하면 이전 역을 버린다.
        locations=turn.locations or previous.locations,
        hours=_hours(previous.hours, turn.hours),
        price=turn.price or previous.price,
        place_name=turn.place_name or previous.place_name,
    )


def _categories(
    previous: Sequence[Choice], turn: Sequence[Choice]
) -> tuple[Choice, ...]:
    """업종. 이번에 원한 업종이 있으면 바꾸고, 피함은 잇는다. 이번에 원한 업종은 이전에
    피했어도 원함이고, 이번에 피한 업종은 이전에 원했어도 피함이다("카페 말고 술집으로")."""
    turn_codes = {c.code for c in turn}
    want = next((c for c in turn if c.want), None) or next(
        (c for c in previous if c.want and c.code not in turn_codes), None
    )
    avoid = [
        c
        for c in (*previous, *turn)
        if not c.want and (want is None or c.code != want.code)
    ]
    return tuple(_unique([*([want] if want else []), *avoid], _code))


def _override[T](previous: Sequence[T], turn: Sequence[T], key: Callable[[T], str]):
    """같은 값(`key`)은 이번 것으로 덮고 나머지는 잇는다. 이번 것이 뒤에 온다."""
    keys = {key(item) for item in turn}
    return tuple([item for item in previous if key(item) not in keys] + list(turn))[
        -MAX_SEGMENTS:
    ]


def _hours(previous: Sequence[Hours], turn: Sequence[Hours]) -> tuple[Hours, ...]:
    """시간. 이번 요청이 말한 종류(요일, 마감, 시작, 지금)의 이전 조각은 지운다."""
    kinds = {kind for h in turn for kind in _kinds(h)}
    kept = [h for h in previous if not kinds & _kinds(h)]
    return tuple(_unique([*kept, *turn], lambda h: h))[-MAX_SEGMENTS:]


def _kinds(hours: Hours) -> set[str]:
    return {
        kind
        for kind, value in (
            ("day", hours.day),
            ("until", hours.open_until),
            ("from", hours.open_from),
            ("now", hours.now),
        )
        if value
    }


def _opposite(code: str) -> str | None:
    feature = FEATURES.get(code)
    return feature.opposite if feature else None


def _code(choice: Choice) -> str:
    return choice.code


def _unique[T](items: Sequence[T], key: Callable[[T], object]) -> list[T]:
    """같은 값(`key`)은 처음 것 하나만 남긴다."""
    seen: set[object] = set()
    unique = []
    for item in items:
        if key(item) not in seen:
            seen.add(key(item))
            unique.append(item)
    return unique
