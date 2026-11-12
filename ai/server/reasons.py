"""상세 추천 이유 제목 API. BE가 상세 추천 이유를 처음 만들 때 장소마다 한 번 부른다.

제목은 `fit_ai.match.reasons`가 쓰고, 여기서는 요청을 받아 넘긴다. LLM이 꺼져 있거나 실패해도
대체 제목으로 200을 돌려준다. 명세는 docs/comparison/spec.md 4.5에 있다.
"""

import time
from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import Field, StringConstraints, field_validator

from fit_ai import gms
from fit_ai.match.conditions import SCORE_LABELS
from fit_ai.match.reasons import MODEL, Persona, TitleInput, write_titles
from server.common import Body, Dependencies, log

MAX_ITEMS = 4
"""한 번에 받는 이유 수. 요청 2개와 취향 2개다."""
MAX_QUOTES = 2
"""이유 하나에 받는 앱 리뷰 구절 수"""

_Text = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)
]


class PersonaBody(Body):
    """짝지은 만족한 손님 페르소나"""

    name: _Text
    description: _Text
    reason: _Text


class TitleItemBody(Body):
    """제목을 쓸 이유 하나와 근거. 검색 응답 카드의 `reasons` 항목에 근거를 더한 모양이다.

    Attributes:
        source: 근거 출처(`REQUEST`, `PREFERENCE`)
        code: 조건 코드
        value: 항목 점수(0~1)
        from_reviews: 리뷰로 판정했는지. 거짓이면 근거를 보지 않고 근거 항목 문구를 쓴다.
        persona: 짝지은 장소 페르소나. 없으면 빠진다.
        quotes: 앱 리뷰 구절. 작성자 정보는 보내지 않는다.
    """

    source: Literal["REQUEST", "PREFERENCE"]
    code: str
    value: float = Field(ge=0, le=1)
    from_reviews: bool
    persona: PersonaBody | None = None
    quotes: list[_Text] = Field(default_factory=list, max_length=MAX_QUOTES)

    @field_validator("code")
    @classmethod
    def _known(cls, value: str) -> str:
        if value not in SCORE_LABELS:
            raise ValueError("모르는 조건 코드다")
        return value


class TitlesBody(Body):
    """제목 요청.

    Attributes:
        request: 이번 검색 요청 문장. 둘러보기처럼 문장이 없으면 빠진다.
        category_group: 장소 업종 그룹
        items: 고른 이유. 검색 응답 카드의 `reasons` 순서다.
    """

    request: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None
    ) = None
    category_group: Literal["RESTAURANT", "CAFE", "BAR"]
    items: list[TitleItemBody] = Field(min_length=1, max_length=MAX_ITEMS)


class TitleBody(Body):
    """이유 하나의 제목.

    Attributes:
        title: 제목 한 문장
        persona_summary: "~하는 손님" 한 줄. LLM이 페르소나가 그 특징과 관계있다고 판단했을
            때만 있다. 페르소나가 없거나 관계없거나 LLM이 실패했으면 빠진다.
    """

    title: str
    persona_summary: str | None = None


class TitlesResponse(Body):
    """제목 응답.

    Attributes:
        titles: 요청 `items`와 같은 순서의 제목
        fallbacks: LLM에 넘길 이유가 있었는데 호출이 실패했으면 `TITLE_LLM_FAILED`. BE는
            이 응답을 캐시에 넣지 않는다.
        model: 제목을 쓴 LLM
    """

    titles: list[TitleBody]
    fallbacks: list[Literal["TITLE_LLM_FAILED"]]
    model: str


def router(deps: Dependencies) -> APIRouter:
    r = APIRouter()

    def call(messages, parse, **kw):
        return gms.call_json(
            messages, parse, timeout=deps.gms_timeout, client=deps.gms_client, **kw
        )

    @r.post(
        "/v1/reasons/titles",
        response_model=TitlesResponse,
        response_model_exclude_none=True,
    )
    def titles(body: TitlesBody):
        start = time.perf_counter()
        items = [
            TitleInput(
                request=item.source == "REQUEST",
                code=item.code,
                value=item.value,
                reviews=item.from_reviews,
                persona=Persona(**item.persona.model_dump()) if item.persona else None,
                quotes=tuple(item.quotes),
            )
            for item in body.items
        ]
        result = write_titles(body.request, body.category_group, items, call=call)
        # 문구는 개인정보일 수 있어 남기지 않고 개수만 남긴다
        log(
            "reason_titles",
            items=len(items),
            sent=sum(item.has_evidence for item in items),
            written=sum(t.written for t in result.titles),
            llm_failed=result.llm_failed,
            seconds=round(time.perf_counter() - start, 3),
        )
        return TitlesResponse(
            titles=[
                TitleBody(title=t.title, persona_summary=t.persona_summary)
                for t in result.titles
            ],
            fallbacks=["TITLE_LLM_FAILED"] if result.llm_failed else [],
            model=MODEL,
        )

    return r
