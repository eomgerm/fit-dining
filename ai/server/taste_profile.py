"""취향 프로필 계산·갱신 API. BE가 부르고 돌려받은 `features`를 저장한다.

`/v1/taste/profile`은 온보딩 취향을 저장할 때 한 번 부르고, 코드 없는 LIKE 칩은 문장을 질의로
인코딩해 `vectors`로 돌려준다(S15P31A302-166). 임베딩이 실패해도 `features`는 돌려준다.
`/v1/taste/refresh`는 04:00 배치가 리뷰 근거를 더해 부르고 `features`만 돌려준다.
계산은 `fit_ai.taste.profile`이 하고, 여기서는 BE 저장 형식(`Preferences`)과 리뷰 근거를
장부 행으로 바꾼다. 명세는 docs/specs/taste-profile/spec.md 6단계에 있다.
"""

import math
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import AwareDatetime, Field

from fit_ai import embedding
from fit_ai.features import FEATURES
from fit_ai.taste.direct_input import MAX_CHIPS, MAX_LABEL
from fit_ai.taste.profile import Row, compute_features, onboarding_rows
from server.common import Body, Dependencies, log

# BE 온보딩 태그 → 코드표 코드. 태그 이름을 통일하기 전까지 AI 경계에서 바꾼다
# (profile-storage spec 문제 8)
MOODS = {"QUIET": "QUIET", "LIVELY": "LIVELY"}
PRIORITIES = {
    "SPACIOUS": "SPACIOUS_SEATING",
    "SHORT_WAIT": "SHORT_WAIT",
    "GENEROUS_PORTION": "GENEROUS_PORTION",
    "PRETTY_SPACE": "PRETTY_SPACE",
    "VIEW_OUTDOOR": "VIEW_OUTDOOR",
    "COZY": "COZY",
    "VALUE": "VALUE_FOR_MONEY",
}
PURPOSES = {
    "CONVERSATION": "PURPOSE_TALK",
    "SOLO": "PURPOSE_SOLO",
    "DATE": "PURPOSE_DATE",
    "GATHERING": "PURPOSE_GROUP",
    "WORK_STUDY": "PURPOSE_WORK",
}


class TasteChip(Body):
    """해석 API가 준 칩. 계산에는 코드가 있는 칩만 쓴다."""

    polarity: Literal["LIKE", "DISLIKE"]
    label: str = Field(min_length=1, max_length=MAX_LABEL)
    code: Literal[tuple(FEATURES)] | None = None  # BE는 null 속성을 빼고 보낸다


class ProfileBody(Body):
    mood: Literal[tuple(MOODS)] | None = None
    priorities: list[Literal[tuple(PRIORITIES)]] = Field(default_factory=list)
    purposes: list[Literal[tuple(PURPOSES)]] = Field(default_factory=list)
    tastes: list[TasteChip] = Field(default_factory=list, max_length=MAX_CHIPS)


class ReviewEvidence(Body):
    """리뷰 이유 태그 하나. `code`는 사용자 쪽 코드로 바꿔서 받는다(리뷰 D-36).

    같은 장소 최신 1건을 시각으로 고르므로 `created_at`은 시간대가 있어야 한다.
    """

    place_id: int
    review_id: int
    category: str
    code: Literal[tuple(FEATURES)]
    created_at: AwareDatetime


class RefreshBody(ProfileBody):
    reviews: list[ReviewEvidence] = Field(default_factory=list)


class FeatureBody(Body):
    code: str
    layer: str
    like: bool
    weight: int


class RefreshResponse(Body):
    features: list[FeatureBody]


class ProfileResponse(RefreshResponse):
    """`vectors`는 요청 `tastes`와 같은 순서다. 코드 없는 LIKE 칩만 벡터가 있고, 나머지와
    임베딩에 실패한 칩은 null이다."""

    vectors: list[list[float] | None]


VECTOR_SIZE = 1024  # `tastes[].vector` 차원. BE `AiTasteClient`도 같은 값을 검사한다
# 임베딩이 콜드 스타트(17~85초)에 걸려도 BE 프로필 타임아웃(3초) 안에 features를 돌려주려고
# 단계(연결·읽기)마다 1초만 기다리고 다시 부르지 않는다. 최악 2초쯤이다
EMBED_TIMEOUT_SECONDS = 1.0


def to_rows(body: ProfileBody, reviews: list[ReviewEvidence] = ()) -> list[Row]:
    """회원 id 없이 계산한다. 행은 돌려주지 않고 BE도 저장하지 않는다."""
    now = datetime.now(UTC).isoformat()
    codes = [MOODS[body.mood]] if body.mood else []
    codes += [PRIORITIES[p] for p in body.priorities]
    codes += [PURPOSES[p] for p in body.purposes]
    rows = onboarding_rows(None, codes, now)
    rows += [
        Row(
            user_id=None,
            code=c.code,
            direction=1 if c.polarity == "LIKE" else -1,
            source="free_text",
            created_at=now,
        )
        for c in body.tastes
        if c.code
    ]
    # 리뷰 이유 태그는 항상 +1이다(spec 2단계 기록 규칙)
    rows += [
        Row(
            user_id=None,
            code=r.code,
            direction=1,
            source="review",
            place_id=str(r.place_id),
            review_id=str(r.review_id),
            category=r.category,
            created_at=r.created_at.isoformat(),
        )
        for r in reviews
    ]
    return rows


def _valid(vector: list[float]) -> bool:
    return len(vector) == VECTOR_SIZE and all(
        isinstance(x, float | int) and math.isfinite(x) for x in vector
    )


def chip_vectors(chips: list[TasteChip], ready: bool) -> list[list[float] | None]:
    vectors: list[list[float] | None] = [None] * len(chips)
    wanted = [i for i, c in enumerate(chips) if c.code is None and c.polarity == "LIKE"]
    if not wanted or not ready:
        return vectors
    try:
        encoded = embedding.encode_queries(
            [chips[i].label for i in wanted],
            timeout=EMBED_TIMEOUT_SECONDS,
            attempts=1,
        )
    except embedding.EmbeddingUnavailable as e:
        log("embedding_failed", error=str(e))  # 메시지는 실패 종류뿐이다
        return vectors
    if not all(_valid(v) for v in encoded):
        log("embedding_failed", error="벡터 모양이 다르다")
        return vectors
    for i, v in zip(wanted, encoded, strict=True):
        vectors[i] = v
    return vectors


def router(deps: Dependencies) -> APIRouter:
    r = APIRouter()

    @r.post("/v1/taste/profile", response_model=ProfileResponse)
    def profile(body: ProfileBody):
        features = compute_features(to_rows(body))
        vectors = chip_vectors(body.tastes, deps.embedding_ready)
        log(
            "taste_profile",
            features=len(features),
            vectors=sum(v is not None for v in vectors),
        )
        return ProfileResponse(features=features, vectors=vectors)

    @r.post("/v1/taste/refresh", response_model=RefreshResponse)
    def refresh(body: RefreshBody):
        features = compute_features(to_rows(body, body.reviews))
        log("taste_refresh", reviews=len(body.reviews), features=len(features))
        return RefreshResponse(features=features)

    return r
