"""직접 입력 해석 API. BE `TasteAnalyzer`가 온보딩 직접 입력마다 한 번 부른다.

해석은 `fit_ai.taste.direct_input`이 하고, 여기서는 칩 목록으로 돌려준다. 코드 없는 좋아함 칩은
벡터도 함께 준다. 비회원 기기가 저장했다가 검색 요청에 실어 취향 묶음 재료로 쓴다(taste-profile spec
4단계). 명세는 docs/specs/taste-profile/spec.md 1단계 "해석 API"에 있다.
"""

import time
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import StringConstraints

from fit_ai import gms
from fit_ai.taste.direct_input import MAX_LEN, MODEL, interpret, to_chips
from server.common import Body, Dependencies, log, problem
from server.taste_profile import TasteChip, chip_vectors


class InterpretBody(Body):
    text: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_LEN)
    ]


class ChipBody(Body):
    polarity: Literal["LIKE", "DISLIKE"]
    label: str
    code: str | None


class InterpretResponse(Body):
    """해석할 취향이 없으면 `tastes`가 빈 목록이다. `model`은 해석한 LLM이다.

    `vectors`는 `tastes`와 같은 순서다. 코드 없는 좋아함 칩만 벡터가 있고, 나머지와 임베딩에
    실패한 칩은 null이다. 임베딩이 실패해도 칩은 돌려준다.
    """

    tastes: list[ChipBody]
    model: str
    vectors: list[list[float] | None]


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
        vectors = chip_vectors([TasteChip(**c) for c in chips], deps.embedding_ready)
        log(
            "direct_input",
            chips=len(chips),
            vectors=sum(v is not None for v in vectors),
            seconds=seconds,
        )
        return InterpretResponse(tastes=chips, model=MODEL, vectors=vectors)

    return r
