"""취향 프로필 계산 API. BE가 온보딩 취향을 저장할 때 한 번 부르고 `features`를 저장한다.

계산은 `fit_ai.taste.profile`이 하고, 여기서는 BE 저장 형식(`Preferences`)을 장부 행으로
바꾼다. 명세는 docs/specs/taste-profile/spec.md 6단계 "프로필 계산 API"에 있다.
"""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import Field

from fit_ai.features import FEATURES
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
    label: str
    code: Literal[tuple(FEATURES)] | None


class ProfileBody(Body):
    mood: Literal[tuple(MOODS)] | None = None
    priorities: list[Literal[tuple(PRIORITIES)]] = Field(default_factory=list)
    purposes: list[Literal[tuple(PURPOSES)]] = Field(default_factory=list)
    tastes: list[TasteChip] = Field(default_factory=list)


class FeatureBody(Body):
    code: str
    layer: str
    like: bool
    weight: int


class ProfileResponse(Body):
    features: list[FeatureBody]


def to_rows(body: ProfileBody) -> list[Row]:
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
    return rows


def router(_: Dependencies) -> APIRouter:
    r = APIRouter()

    @r.post("/v1/taste/profile", response_model=ProfileResponse)
    def profile(body: ProfileBody):
        features = compute_features(to_rows(body))
        log("taste_profile", features=len(features))
        return ProfileResponse(features=features)

    return r
