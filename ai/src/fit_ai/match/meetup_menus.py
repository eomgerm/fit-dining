"""모임 참여자들의 먹고 싶은 메뉴 해석(docs/specs/meetup/decisions.md D-26).

참여자들이 적은 글을 계산 한 번에 모두 모아 LLM을 한 번만 부른다. 글에서는 메뉴 이름만
꺼내고 지역·시간·가격·분위기 같은 다른 조건은 버린다. 참여자 글이 모임의 다른 조건을 바꾸지
못하게 하기 위해서다. LLM에는 글만 보내고 누가 적었는지는 보내지 않는다. LLM이 실패하면
지금 검색의 규칙 해석(낱말표)으로 대신하고, 낱말표에도 없으면 글을 쉼표로 나눈 말을 그대로
메뉴로 쓴다(곱창처럼 낱말표에 없는 메뉴가 많아서다).
"""

import re
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from fit_ai import gms
from fit_ai.match.interpretation import MODEL
from fit_ai.match.interpretation.rules import rule_turn
from fit_ai.match.interpretation.segments import MAX_SEGMENT_LENGTH, Menu

MENU_TIMEOUT_SECONDS = 4.0
"""메뉴 해석 LLM을 기다리는 시간(초). 모임 계산의 BE 예산(12초) 안에 들어가게 짧게 둔다.
시간 초과면 다시 부르지 않고 규칙으로 대신한다. 시작값이다(PRD OQ-29)."""

MAX_MENUS_PER_TEXT = 3
"""글 하나에서 쓰는 메뉴 수 상한. 20자 글에 메뉴가 많이 들 수 없어 넉넉히 둔다."""

SYSTEM_PROMPT = """너는 모임 참여자들이 적은 "먹고 싶은 메뉴" 글에서 메뉴 이름만 꺼낸다.

- 입력은 번호를 붙인 글 목록이다. 글마다 메뉴를 0~3개 꺼낸다.
- 메뉴는 가게 메뉴판에 오를 만한 음식이나 음료 이름이다(예: 곱창, 마라탕, 돈까스, 아메리카노).
- 지역, 시간, 가격, 분위기, 인원, 가게 이름처럼 메뉴가 아닌 말은 버린다.
- value는 메뉴의 표준 이름, spellings는 메뉴판에 쓰일 만한 다른 표기다(최대 3개, 없으면 빈 목록).
- 메뉴가 없으면 menus를 빈 목록으로 둔다.

JSON만 답한다. 모양:
{"items": [{"index": 0, "menus": [{"value": "곱창", "spellings": ["소곱창"]}]}]}"""

_SPLIT = re.compile(r"[,，/·&+]|\s+(?:(?:이나|또는|아니면|랑|하고)\s+)?")


@dataclass(frozen=True)
class MenuReading:
    """메뉴 해석 결과.

    Attributes:
        menus: 글마다 해석한 메뉴. 입력 순서와 같다. 글 안의 순서는 적은 순서다.
        llm_failed: LLM이 꺼져 있거나 실패해 규칙으로 대신했는지
        seconds: LLM을 기다린 시간(초). 부르지 않았으면 0이다.
    """

    menus: tuple[tuple[Menu, ...], ...]
    llm_failed: bool = False
    seconds: float = 0.0


def read_menus(
    texts: Sequence[str],
    *,
    call: Callable[..., Any] = gms.call_json,
    client: httpx.Client | None = None,
    timeout: float = MENU_TIMEOUT_SECONDS,
) -> MenuReading:
    """참여자들의 먹고 싶은 메뉴 글을 한 번에 해석한다.

    Args:
        texts: 글. 빈 목록이면 LLM을 부르지 않는다.
        call: GMS 호출 함수. 테스트가 바꿔 끼운다.
        client: GMS 연결을 다시 쓰는 HTTP 클라이언트
        timeout: LLM을 기다리는 시간(초)

    Returns:
        글마다 메뉴
    """
    if not texts:
        return MenuReading(())
    start = time.perf_counter()
    data = call(
        [
            {"role": "developer", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _user_prompt(texts)},
        ],
        lambda data: data,
        timeout=timeout,
        client=client,
        model=MODEL,
        temperature=None,
        reasoning_effort="none",
        retry_on_timeout=False,
    )
    seconds = time.perf_counter() - start
    if data is not None:
        try:
            return MenuReading(_parse(data, texts), seconds=seconds)
        except (ValueError, TypeError, KeyError):
            pass
    return MenuReading(
        tuple(rule_menus(text) for text in texts), llm_failed=True, seconds=seconds
    )


def rule_menus(text: str) -> tuple[Menu, ...]:
    """규칙으로 메뉴를 꺼낸다. 글을 쉼표와 띄어쓰기로 나눈 조각마다 낱말표의 메뉴를 쓰고,
    낱말표에 없으면 조각을 그대로 메뉴로 쓴다. 적은 순서를 지킨다."""
    menus: dict[str, Menu] = {}
    for piece in (w.strip() for w in _SPLIT.split(text) if w and w.strip()):
        known = [m for m in rule_turn(piece).menus if m.want]
        for menu in known or [Menu(piece, piece, (), True)]:
            if len(menu.value) <= MAX_SEGMENT_LENGTH:
                menus.setdefault(menu.value, menu)
    return tuple(menus.values())[:MAX_MENUS_PER_TEXT]


def _user_prompt(texts: Sequence[str]) -> str:
    return "\n".join(f"{i}. {text}" for i, text in enumerate(texts))


def _parse(data: Any, texts: Sequence[str]) -> tuple[tuple[Menu, ...], ...]:
    """LLM 응답을 글마다 메뉴로 읽는다. 모양이 틀리면 ValueError나 TypeError다."""
    items = data["items"]
    if not isinstance(items, list):
        raise TypeError("items가 목록이 아니다")
    by_index: dict[int, tuple[Menu, ...]] = {}
    for item in items:
        index = item["index"]
        if not isinstance(index, int) or not 0 <= index < len(texts):
            raise ValueError("index가 글 번호가 아니다")
        menus = []
        for menu in item["menus"][:MAX_MENUS_PER_TEXT]:
            value = menu["value"]
            spellings = menu.get("spellings") or []
            if not isinstance(value, str) or not value.strip():
                raise TypeError("value가 문자열이 아니다")
            if not isinstance(spellings, list) or not all(
                isinstance(s, str) for s in spellings
            ):
                raise TypeError("spellings가 문자열 목록이 아니다")
            value = value.strip()[:MAX_SEGMENT_LENGTH]
            menus.append(
                Menu(
                    value,
                    value,
                    tuple(
                        s.strip()[:MAX_SEGMENT_LENGTH]
                        for s in spellings[:3]
                        if s.strip()
                    ),
                    True,
                )
            )
        by_index[index] = tuple(menus)
    return tuple(by_index.get(i, ()) for i in range(len(texts)))
