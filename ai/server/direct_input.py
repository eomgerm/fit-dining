"""직접 입력 해석 API. BE `TasteAnalyzer`가 온보딩 직접 입력마다 한 번 부른다.

해석은 `fit_ai.taste.direct_input`이 하고, 여기서는 칩 목록으로 돌려준다. 명세는
docs/specs/taste-profile/spec.md 1단계 "해석 API"에 있다.
"""

import time
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import StringConstraints

from fit_ai import gms
from fit_ai.taste.direct_input import MAX_LEN, interpret, to_chips
from server.common import Body, Dependencies, log, problem


class InterpretBody(Body):
    text: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_LEN)
    ]


class ChipBody(Body):
    polarity: Literal["LIKE", "DISLIKE"]
    label: str
    code: str | None


class InterpretResponse(Body):
    """해석할 취향이 없으면 `tastes`가 빈 목록이다. `model`은 해석한 LLM이다."""

    tastes: list[ChipBody]
    model: str


def router(deps: Dependencies) -> APIRouter:
    r = APIRouter()

    def call(messages, parse, **kw):
        return gms.call_json(
            messages, parse, timeout=deps.gms_timeout, client=deps.gms_client, **kw
        )

    @r.post("/v1/taste/interpret", response_model=InterpretResponse)
    def interpret_text(body: InterpretBody):
        start = time.perf_counter()
        # 행은 칩으로만 바꾸고 저장하지 않으므로 회원 id 없이 해석한다
        rows = interpret(body.text, None, datetime.now(UTC).isoformat(), call=call)
        seconds = round(time.perf_counter() - start, 3)
        if rows is None:
            log("direct_input_failed", seconds=seconds)
            return problem(
                503, "INTERPRET_FAILED", "취향을 해석하지 못했다. 다시 시도한다"
            )
        chips = to_chips(rows)
        log("direct_input", chips=len(chips), seconds=seconds)
        return InterpretResponse(tastes=chips, model=gms.MODEL)

    return r
