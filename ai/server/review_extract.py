"""앱 리뷰 본문 추출 API. 04:00 취향 갱신 배치가 새 리뷰와 고친 리뷰를 10건씩 보낸다.

추출은 장소 분석과 같은 `fit_ai.place.extract`가 하고, 여기서는 리뷰마다 항목 목록으로 돌려준다.
BE는 결과를 리뷰별로 저장하고(모델, 프롬프트 버전과 함께) 취향 갱신 때 다시 읽는다. 명세는
docs/specs/taste-profile/spec.md 6단계 "본문 추출 API"에 있다.
"""

import time
from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import Field, StringConstraints, field_validator

from fit_ai import gms
from fit_ai.place import extract
from server.common import Body, Dependencies, log, problem

MAX_BODY = 500
"""리뷰 본문 길이 상한. BE 리뷰 본문 상한(`reviews.description` 500자)과 같다."""


class ReviewText(Body):
    review_id: int
    body: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_BODY)
    ]


class ExtractBody(Body):
    """빈 본문은 보내지 않는다. 한 요청이 GMS 한 번이다."""

    reviews: list[ReviewText] = Field(min_length=1, max_length=extract.BATCH_SIZE)

    @field_validator("reviews")
    @classmethod
    def _unique(cls, reviews: list[ReviewText]) -> list[ReviewText]:
        if len({t.review_id for t in reviews}) != len(reviews):
            raise ValueError("같은 리뷰를 두 번 보냈다")
        return reviews


class ItemBody(Body):
    """추출 항목 하나. `direction`은 좋게 봤으면 1, 아쉬워했으면 −1이고, 맛 코드만 그 맛이
    났으면 1, 안 났거나 약했으면 −1이다. `liked`는 맛 코드만 있다."""

    slot: str
    quote: str
    code: str | None
    direction: Literal[1, -1]
    liked: Literal[1, -1] | None
    kind: str
    text: str | None


class ReviewItems(Body):
    review_id: int
    items: list[ItemBody]


class ExtractResponse(Body):
    """`results`는 요청 `reviews`와 같은 순서다. 특징이 없는 리뷰는 `items`가 비어 있다."""

    results: list[ReviewItems]
    model: str
    prompt_version: int


def router(deps: Dependencies) -> APIRouter:
    r = APIRouter()

    def call(messages, parse, **kw):
        # 추출은 리뷰 10건이라 GMS 기본 시간 제한 대신 추출기 값(`extract.TIMEOUT`)을 쓴다
        return gms.call_json(messages, parse, client=deps.gms_client, **kw)

    @r.post("/v1/reviews/extract", response_model=ExtractResponse)
    def extract_reviews(body: ExtractBody):
        start = time.perf_counter()
        reviews = [{"review_id": t.review_id, "body": t.body} for t in body.reviews]
        rows, failed, dropped = extract.extract(
            reviews, call=call, batch_size=extract.BATCH_SIZE, source="app_text"
        )
        seconds = round(time.perf_counter() - start, 3)
        if failed:
            log("review_extract_failed", reviews=len(reviews), seconds=seconds)
            return problem(
                503,
                "EXTRACT_FAILED",
                "리뷰 본문을 추출하지 못했다. 다음 배치에서 다시 시도한다",
            )
        by_review: dict[int, list[dict]] = {t.review_id: [] for t in body.reviews}
        for row in rows:
            item = {k: v for k, v in row.items() if k not in ("review_id", "source")}
            by_review[row["review_id"]].append(item)
        log(
            "review_extract",
            reviews=len(reviews),
            items=len(rows),
            dropped=dropped,
            seconds=seconds,
        )
        return ExtractResponse(
            results=[
                ReviewItems(review_id=rid, items=items)
                for rid, items in by_review.items()
            ],
            model=extract.MODEL,
            prompt_version=extract.PROMPT_VERSION,
        )

    return r
