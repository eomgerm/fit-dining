"""코드 확인. LLM 해석이 놓치거나 잘못 넣은 조각을 규칙 해석으로 바로잡는다.

분류를 늘리자 LLM이 근처, 후속의 이전 역, 메뉴를 놓치고 피함을 넓게 썼다(2026-11-02
평가). 규칙으로 확실히 잡히는 것만 고친다. 무엇을 고치는지는 `_checked`에 있다.
"""

import re
from dataclasses import replace

from fit_ai.match.interpretation.request import (
    FOOD_CODES,
    FOOD_TYPES,
    Conditions,
    _assemble,
    _plain,
    locations_of,
)
from fit_ai.match.interpretation.rules import (
    _NEGATION,
    CATEGORY_NAME_WORDS,
    CATEGORY_WORDS,
    CODE_WORDS,
    VALUE_WORDS,
    _has,
    _kept_codes,
    _rule_parts,
)
from fit_ai.match.interpretation.segments import (
    MAX_SEGMENTS,
    LocationKind,
    PlaceName,
)


def _checked(query: str, previous: Conditions | None, **llm) -> Conditions:
    """LLM이 놓치거나 잘못 넣은 조각을 규칙 해석으로 바로잡는다.

    LLM 해석은 분류가 늘자 근처, 후속의 이전 역, 메뉴를 놓치고 피함을 넓게 썼다
    (2026-11-02 평가). 규칙으로 확실히 잡히는 것만 고친다.

    - 지역: 이번 요청에 근처 말만 있으면 근처다. LLM이 지역을 비우면 규칙이 찾은 지역, 그것도
      없으면 이전 지역을 잇는다.
    - 시간·가격: 이번 요청에서 규칙이 찾았으면 규칙 값을 쓴다. 꼴이 정해진 말이라 규칙이
      정확하다.
    - 메뉴·특징: LLM이 놓친 것을 규칙 값으로 더한다. 이번 요청에 피하는 말이 없으면 이번
      요청의 메뉴는 원함으로 되돌린다.
    - 음식 종류·매운맛: LLM이 놓친 코드를 규칙 값으로 더한다. 음식 종류나 나라를 말한
      낱말이 없는데 LLM이 낸 음식 종류 코드는 뗀다. gpt-4o-mini는 지시해도 "초밥"에
      일식을 붙였다(2026-11-03 평가). 이번 요청에 피하는 말이 없으면 새로 빼 달라고 한
      음식은 원하는 코드로 되돌린다("매운 거 먹고 싶다").
    - 가성비: 싼 곳을 찾는데 가성비 낱말이 없으면 뗀다.
    - 업종: LLM이 비우면 규칙 값을 쓴다.
    - 빼 달라는 업종: 음식이나 메뉴를 빼 달라는 요청이면 요청에 이름이 없는 업종은 LLM이
      냈어도 뗀다("일식 말고"에서 식당 전체를 빼지 않는다, 2026-11-03).
    - 후속의 코드: 이번 요청이 빼지 않은 이전 코드는 남긴다.
    """
    parts = _rule_parts(query)
    locations = llm["locations"]
    mentioned = [
        loc
        for loc in locations
        if loc.kind is not LocationKind.HERE and _plain(loc.text) in _plain(query)
    ]
    rule_places = [loc for loc in parts.locations if loc.kind is not LocationKind.HERE]
    rule_here = [loc for loc in parts.locations if loc.kind is LocationKind.HERE]
    if rule_places and not mentioned:
        # "선릉역 근처"에서 LLM이 근처만 내도 역을 기준으로 찾는다.
        locations = tuple(rule_places)
    elif rule_here and not mentioned:
        locations = (rule_here[0],)
    elif not locations:
        locations = parts.locations or (locations_of(previous) if previous else ())

    menus = _with_rule_items(llm["menus"], parts.menus)
    before_codes = previous.codes if previous is not None else ()
    codes = [
        c
        for c in llm["codes"]
        if isinstance(c, str)
        and (c not in FOOD_TYPES or c in before_codes or _has(query, CODE_WORDS[c]))
    ]
    codes += [c for c in parts.codes if c in FOOD_CODES and c not in codes]
    avoid_foods = [*llm["avoid_foods"], *parts.avoid_foods]
    if not _NEGATION.search(query):
        menus = tuple(
            replace(m, want=True) if _plain(m.text) in _plain(query) else m
            for m in menus
        )
        before = previous.avoid_foods if previous is not None else ()
        codes += [c for c in avoid_foods if c not in before]
        avoid_foods = [c for c in avoid_foods if c in before]
    if previous is not None:
        codes = [*_kept_codes(previous, query, codes, avoid_foods), *codes]
    price = parts.price or llm["price"]
    if price is not None and price.cheap and not _has(query, VALUE_WORDS):
        had_value = previous is not None and "VALUE_FOR_MONEY" in previous.codes
        codes = [c for c in codes if c != "VALUE_FOR_MONEY" or had_value]
    hours = (
        tuple(h for h in llm["hours"] if _plain(h.text) not in _plain(query))
        + parts.hours
        if parts.hours
        else llm["hours"]
    )
    category_group = llm["category_group"] or parts.category_group
    avoid_categories = llm["avoid_categories"]
    if avoid_foods or any(not m.want for m in menus):
        avoid_categories = tuple(
            c for c in avoid_categories if _has(query, _category_names(c))
        )
    return _assemble(
        text=llm["text"],
        embedding_text=llm["embedding_text"],
        codes=codes,
        category_group=category_group,
        locations=locations,
        menus=menus,
        hours=hours,
        price=price,
        place_name=_not_similar(llm["place_name"], query),
        features=_with_rule_items(llm["features"], parts.features),
        avoid_categories=(*avoid_categories, *parts.avoid_categories),
        avoid_foods=tuple(avoid_foods),
    )


def _category_names(category: str) -> tuple[str, ...]:
    """업종 이름 낱말("식당", "밥집", "음식점" 등)"""
    return tuple(w for w in CATEGORY_NAME_WORDS if CATEGORY_WORDS[w] == category)


def _not_similar(name: PlaceName | None, query: str) -> PlaceName | None:
    """ "바바인디아 같은 곳"은 비슷한 곳을 찾는 말이라 가게 이름으로 보지 않는다."""
    if name is not None and re.search(rf"{re.escape(name.text)}\s*같은", query):
        return None
    return name


def _same_name(a: str, b: str) -> bool:
    """표준 이름이 같은지. 띄어쓰기를 무시하고 한쪽이 다른 쪽에 들어 있으면 같다."""
    return _plain(a) in _plain(b) or _plain(b) in _plain(a)


def _with_rule_items(llm: tuple, rule: tuple) -> tuple:
    """LLM 조각 뒤에 LLM이 놓친 규칙 조각을 붙인다. 표준 이름이 겹치면 같은 조각으로 본다."""
    missed = tuple(
        item for item in rule if not any(_same_name(item.value, i.value) for i in llm)
    )
    return tuple(dict.fromkeys([*llm, *missed]))[:MAX_SEGMENTS]
