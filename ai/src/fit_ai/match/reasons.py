"""상세 추천 이유. 검색 때 이유 항목을 고르고, 상세를 열 때 LLM으로 제목을 쓴다.

검색은 LLM 없이 핏 점수를 낸 항목에서 이유를 고르고 대체 제목을 붙인다. 상세를 열면 BE가
근거(장소 페르소나, 앱 리뷰 구절)를 모아 제목 API를 부르고, 여기서 장소마다 LLM을 한 번
불러 제목과 페르소나 요약을 쓴다. LLM이 실패하거나 검사에 걸린 이유는 대체 제목을 쓴다
(docs/comparison/spec.md 4.5).
"""

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from fit_ai import gms
from fit_ai.match.conditions import CATEGORY_NAMES, SCORE_LABELS

MODEL = gms.MODEL
"""제목을 쓰는 LLM. 제공자를 바꾸면 `gms.call_json`만 바꾼다."""

STRONG_SCORE = 0.9
"""대체 제목을 "{업종} 중 손꼽히게 ~"로 쓰는 항목 점수. 업종 범위 상위 10% 안이다."""

MAX_TITLE = 50
"""제목 최대 길이. 40자 안팎을 바라고 조금 넘는 것은 받는다."""
MAX_SUMMARY = 40
"""페르소나 요약 최대 길이. 30자 안팎을 바란다."""

NORMAL_FORMS = {
    "QUIET": "조용한 편이에요",
    "LIVELY": "활기찬 편이에요",
    "SPACIOUS_SEATING": "자리가 넉넉한 편이에요",
    "SHORT_WAIT": "대기가 짧은 편이에요",
    "GENEROUS_PORTION": "양이 넉넉한 편이에요",
    "PRETTY_SPACE": "공간이 예쁜 편이에요",
    "VIEW_OUTDOOR": "전망이 좋은 편이에요",
    "COZY": "아늑한 편이에요",
    "VALUE_FOR_MONEY": "가격만큼 만족스러운 편이에요",
    "PURPOSE_TALK": "대화하기 좋은 편이에요",
    "PURPOSE_SOLO": "혼밥하기 좋은 편이에요",
    "PURPOSE_DATE": "데이트하기 좋은 편이에요",
    "PURPOSE_GROUP": "모임하기 좋은 편이에요",
    "PURPOSE_WORK": "작업하기 좋은 편이에요",
    "FOOD_SPICY": "매콤한 편이에요",
    "UNIQUE_CONCEPT": "컨셉이 독특한 편이에요",
    "FAST_SERVING": "음식이 빨리 나오는 편이에요",
    "GOOD_MUSIC": "음악이 좋은 편이에요",
    "FOOD_SWEET": "달콤한 편이에요",
    "FOOD_SOUR": "산미가 있는 편이에요",
    "FOOD_SALTY": "짭짤한 편이에요",
    "FOOD_BITTER": "쌉싸름한 편이에요",
    "FOOD_UMAMI": "감칠맛이 나는 편이에요",
    "FOOD_NUTTY": "고소한 편이에요",
    "FOOD_RICH": "맛이 진한 편이에요",
    "FOOD_CLEAN": "담백하고 깔끔한 편이에요",
}
"""리뷰로 판정하는 코드의 약한 대체 제목(항목 점수 0.7 이상 0.9 미만). 강한 형태는 근거 항목
문구에 "{업종} 중 손꼽히게"를 붙인다. 초안이고 사람이 고친다(2026-11-11)."""

_BANNED = ("리뷰에서", "언급")
_QUOTED = re.compile(r"[\"'“”‘’「」『』]([^\"'“”‘’「」『』]+)[\"'“”‘’「」『』]")
_SPACE = re.compile(r"\s+")


def fallback_title(code: str, value: float, category_group: str, reviews: bool) -> str:
    """LLM 없이 쓰는 제목.

    Args:
        code: 조건 코드
        value: 항목 점수(0~1)
        category_group: 장소 업종 그룹(`RESTAURANT`, `CAFE`, `BAR`)
        reviews: 리뷰로 판정한 항목인지. 시설과 음식 종류는 장소 정보로 판정한다.

    Returns:
        장소 정보로 판정한 항목은 근거 항목 문구 그대로("주차할 수 있어요"). 리뷰로 판정한
        항목은 점수가 `STRONG_SCORE` 이상이면 "카페 중 손꼽히게 조용해요", 아니면 "조용한
        편이에요"다.
    """
    label = SCORE_LABELS[code]
    if not reviews:
        return label
    if value >= STRONG_SCORE:
        return f"{CATEGORY_NAMES[category_group]} 중 손꼽히게 {label}"
    return NORMAL_FORMS[code]


@dataclass(frozen=True)
class Persona:
    """제목의 근거가 되는 만족한 손님 페르소나.

    Attributes:
        name: 페르소나 이름
        description: 어떤 손님인지 3문장
        reason: 좋아하는 이유 3문장
    """

    name: str
    description: str
    reason: str


@dataclass(frozen=True)
class TitleInput:
    """제목을 쓸 이유 하나와 그 근거.

    Attributes:
        request: 요청 조건이면 True, 취향이면 False다.
        code: 조건 코드
        value: 항목 점수(0~1)
        reviews: 리뷰로 판정한 항목인지
        persona: 짝지은 장소 페르소나. 없으면 None이다.
        quotes: 앱 리뷰 구절. 작성자 정보는 넣지 않는다.
    """

    request: bool
    code: str
    value: float
    reviews: bool
    persona: Persona | None = None
    quotes: tuple[str, ...] = ()

    @property
    def has_evidence(self) -> bool:
        """LLM에 넘길 근거가 있는지. 장소 정보로 판정한 항목은 넘기지 않는다."""
        return self.reviews and (self.persona is not None or bool(self.quotes))


@dataclass(frozen=True)
class Title:
    """이유 하나의 제목.

    Attributes:
        title: 제목 한 문장
        persona_summary: "~하는 손님"으로 끝나는 페르소나 요약. 화면의 "이런 손님이 많이
            찾아요" 아래에 보인다. LLM이 페르소나가 그 특징과 관계있다고 판단했을 때만 있다.
            요약이 검사에 걸리면 페르소나 이름이다. 페르소나가 없거나, 관계없다고 판단했거나,
            LLM이 실패해 판단하지 못했으면 None이다. 가게마다 페르소나가 적어서(prod 평균
            2.4개) 가장 가까운 페르소나도 다른 특징 이야기인 경우가 많기 때문이다.
        written: LLM이 쓴 제목이 검사를 통과했으면 True, 대체 제목이면 False다.
    """

    title: str
    persona_summary: str | None
    written: bool


@dataclass(frozen=True)
class Titles:
    """장소 하나의 제목.

    Attributes:
        titles: 입력 이유와 같은 순서의 제목
        llm_failed: LLM에 넘길 이유가 있었는데 호출이 실패했는지. BE는 이 결과를 캐시에
            넣지 않는다.
    """

    titles: tuple[Title, ...]
    llm_failed: bool


_SYSTEM = f"""장소 상세 화면의 "AI 추천 이유" 제목을 쓴다.
이유마다 주어진 근거(이 장소를 좋아하는 손님 설명, 앱 리뷰 구절)만 보고 쓴다.

- title: "~해요" 말투의 한 문장, 40자 안팎. 그 이유의 특징(예: "전망이 좋아요")이 이 장소에서 어떤지를
  쓴다. 다른 특징을 제목의 중심으로 삼지 않는다.
- 출처가 [요청]이면 "찾으신 ~", [내 취향]이면 "평소 좋아하시는 ~"처럼 자연스러울 때만 잇는다.
- 손님 설명이 그 특징과 관계없으면 손님 설명을 쓰지 말고 특징만으로 짧게 쓴다.
- 근거에 그 특징과 관련된 메뉴, 시간대, 공간 같은 구체적인 신호가 있으면 살린다.
- 숫자를 쓰지 않는다. 근거에 없는 사실을 더하지 않는다.
- "리뷰에서 ~", "~라는 언급" 처럼 근거를 가리키지 말고 장소를 직접 설명한다.
- 따옴표 안에는 앱 리뷰 구절을 글자 그대로만 쓴다. 다른 말은 따옴표로 감싸지 않는다.
- persona_related: 손님 설명이 그 이유의 특징을 직접 다루면 true, 다른 특징 이야기면 false.
  손님 설명이 없으면 false.
- persona_summary: persona_related가 true일 때만 쓴다. 그 특징과 관련된 손님을 "~하는 손님"으로
  끝나는 30자 안팎 한 줄로 쓴다. false면 null.
- 이유 번호(index)는 입력의 번호 그대로 쓴다. 제목 길이 상한은 {MAX_TITLE}자다.

JSON으로 답한다."""

RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "reason_titles",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["reasons"],
            "properties": {
                "reasons": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": [
                            "index",
                            "title",
                            "persona_related",
                            "persona_summary",
                        ],
                        "properties": {
                            "index": {"type": "integer"},
                            "title": {"type": "string"},
                            "persona_related": {"type": "boolean"},
                            "persona_summary": {"type": ["string", "null"]},
                        },
                    },
                }
            },
        },
    },
}


def build_messages(
    request: str | None, category_group: str, items: Sequence[TitleInput]
) -> list[dict]:
    """근거가 있는 이유만 번호(입력 순서)를 붙여 넣는다."""
    blocks = []
    for i, item in enumerate(items):
        if not item.has_evidence:
            continue
        source = "요청" if item.request else "내 취향"
        lines = [f"이유 {i} [{source}] {SCORE_LABELS[item.code]}"]
        if item.persona is not None:
            p = item.persona
            lines.append(
                f"- 이 장소를 좋아하는 손님: {p.name}. {p.description} {p.reason}"
            )
        lines += [f"- 앱 리뷰 구절: {q}" for q in item.quotes]
        blocks.append("\n".join(lines))
    user = (
        f"요청: {request or '없음'}\n업종: {CATEGORY_NAMES[category_group]}\n\n"
        + "\n\n".join(blocks)
    )
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": user}]


def _flat(text: str) -> str:
    return _SPACE.sub("", text)


def title_ok(title: str, quotes: Sequence[str]) -> bool:
    """화면에 내도 되는 제목인지.

    길이, "~요"로 끝나는지, 숫자와 근거를 가리키는 말이 없는지, 따옴표 안 구절이 넘긴 앱
    리뷰 구절에 그대로 있는지(공백 차이는 무시)를 본다.
    """
    text = title.strip()
    if not 0 < len(text) <= MAX_TITLE or not text.rstrip(".!~ ").endswith("요"):
        return False
    if re.search(r"\d", text) or any(word in text for word in _BANNED):
        return False
    flat_quotes = [_flat(q) for q in quotes]
    return all(
        any(_flat(part) in q for q in flat_quotes) for part in _QUOTED.findall(text)
    )


def summary_ok(summary: str) -> bool:
    """페르소나 요약이 "~손님"으로 끝나는 짧은 한 줄인지."""
    text = summary.strip().rstrip(".")
    return (
        0 < len(text) <= MAX_SUMMARY
        and text.endswith("손님")
        and not re.search(r"\d", text)
        and not any(word in text for word in _BANNED)
    )


def _parse(resp: dict, wanted: set[int]) -> dict[int, tuple[str, bool, str | None]]:
    """번호마다 (제목, 페르소나가 관계있는지, 요약). 모르는 번호는 버린다.

    모양이 틀리면 KeyError나 TypeError다.
    """
    out: dict[int, tuple[str, bool, str | None]] = {}
    for r in resp["reasons"]:
        index = r["index"]
        if index in wanted and isinstance(r["title"], str):
            summary = r["persona_summary"]
            out[index] = (
                r["title"],
                r["persona_related"] is True,
                summary if isinstance(summary, str) else None,
            )
    return out


def write_titles(
    request: str | None,
    category_group: str,
    items: Sequence[TitleInput],
    *,
    call: Callable = gms.call_json,
) -> Titles:
    """고른 이유마다 제목을 쓴다. LLM은 근거가 있는 이유가 있을 때만 한 번 부른다.

    Args:
        request: 이번 검색 요청 문장. 없으면 None이다.
        category_group: 장소 업종 그룹
        items: 고른 이유. 최대 4개다.
        call: LLM 호출 함수. `gms.call_json`과 같은 모양이다.

    Returns:
        이유와 같은 순서의 제목
    """
    wanted = {i for i, item in enumerate(items) if item.has_evidence}
    written: dict[int, tuple[str, bool, str | None]] = {}
    failed = False
    if wanted:
        result = call(
            build_messages(request, category_group, items),
            lambda resp: _parse(resp, wanted),
            response_format=RESPONSE_FORMAT,
            model=MODEL,
        )
        failed = result is None
        written = result or {}
    titles = []
    for i, item in enumerate(items):
        fallback = fallback_title(item.code, item.value, category_group, item.reviews)
        title, related, summary = written.get(i, (None, False, None))
        ok = title is not None and title_ok(title, item.quotes)
        titles.append(
            Title(
                title=title.strip() if ok else fallback,
                persona_summary=_summary(item.persona, related, summary),
                written=ok,
            )
        )
    return Titles(tuple(titles), failed)


def _summary(persona: Persona | None, related: bool, summary: str | None) -> str | None:
    """관계있다고 판단한 페르소나만 요약을 보인다. 요약이 검사에 걸리면 이름을 쓴다."""
    if persona is None or not related:
        return None
    if summary is not None and summary_ok(summary):
        return summary.strip()
    return persona.name
