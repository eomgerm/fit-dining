"""근거 장부 행 → 취향 프로필(spec 2·3·5·6단계). LLM은 쓰지 않는다."""

from collections import defaultdict
from collections.abc import Callable
from datetime import datetime
from typing import Literal, TypedDict

from fit_ai.embedding import MODEL_ID, REVISION, encode_queries
from fit_ai.features import FEATURES

SCHEMA = "taste-profile/v0"
MAX_WEIGHT = 3  # 검증 전 초기값(PRD OQ-11)
FLIP_PLACES = 3  # 소음 축 방향을 바꾸는 반대 평가 장소 수(PRD FR-14)
NOISE = ("QUIET", "LIVELY")
_ORDER = {code: i for i, code in enumerate(FEATURES)}


class Row(TypedDict, total=False):
    """근거 장부 한 줄. 계산 결과가 아니라 사용자가 한 일만 적는다."""

    user_id: str | None
    code: str | None  # 코드 없는 취향 문장은 None
    direction: int  # +1 또는 -1
    source: Literal["onboarding", "review", "free_text"]
    place_id: str
    review_id: str
    category: str
    quote: str
    positive_text: str
    created_at: str  # ISO 8601, 시간대 포함


def onboarding_rows(
    user_id: str | None, codes: list[str], created_at: str
) -> list[Row]:
    """고른 태그마다 +1. 고르지 않은 태그는 기록하지 않는다."""
    for code in codes:
        if code not in FEATURES or not FEATURES[code].onboarding:
            raise ValueError(f"온보딩 코드가 아니다: {code}")
    if set(NOISE) <= set(codes):
        raise ValueError("소음 축은 한 극만 고를 수 있다")
    return [
        Row(
            user_id=user_id,
            code=c,
            direction=1,
            source="onboarding",
            created_at=created_at,
        )
        for c in dict.fromkeys(codes)
    ]


def _noise_sign(r: Row) -> int:
    """소음 축 근거를 QUIET 쪽 부호로 바꾼다."""
    return r["direction"] if r["code"] == "QUIET" else -r["direction"]


def _feature_key(code: str) -> str:
    return "NOISE" if code in NOISE else code


def _latest_per_place(rows: list[Row]) -> list[Row]:
    """리뷰 근거는 장소·특징마다 가장 늦은 행 하나만 남긴다(PRD FR-14)."""
    latest: dict[tuple[str, str], Row] = {}
    others = []
    for r in rows:
        if r["source"] != "review":
            others.append(r)
            continue
        key = (r["place_id"], _feature_key(r["code"]))
        when = datetime.fromisoformat(r["created_at"])
        if key not in latest or when > datetime.fromisoformat(
            latest[key]["created_at"]
        ):
            latest[key] = r
    return others + list(latest.values())


def _feature(code: str, like: bool, weight: int) -> dict:
    return {"code": code, "layer": FEATURES[code].layer, "like": like, "weight": weight}


def compute_features(rows: list[Row]) -> list[dict]:
    """특징마다 좋아하는지와 가중치를 정한다. 받은 행은 모두 유효한 근거로 본다."""
    coded = _latest_per_place([r for r in rows if r.get("code")])

    net: dict[str, int] = defaultdict(int)  # 소음 축은 QUIET 쪽 부호로 한 번에 센다
    for r in coded:
        if r["code"] in NOISE:
            net["QUIET"] += _noise_sign(r)
        else:
            net[r["code"]] += r["direction"]

    out = []
    noise = net.pop("QUIET", 0)
    pole = next(
        (
            r["code"]
            for r in coded
            if r["source"] == "onboarding" and r["code"] in NOISE
        ),
        None,
    )
    # 온보딩 극이 있으면 그 극을 지키고, 없으면 근거 합의 부호를 따른다
    sign = {"QUIET": 1, "LIVELY": -1}.get(pole, 1 if noise > 0 else -1)
    # 반대 평가가 서로 다른 장소 3곳 이상이고 과반이면 근거 쪽으로 바꾼다(PRD FR-14)
    against = {
        r["place_id"]
        for r in coded
        if r["source"] == "review" and r["code"] in NOISE and _noise_sign(r) == -sign
    }
    if len(against) >= FLIP_PLACES and noise * sign < 0:
        sign = -sign
    if (strength := noise * sign) > 0:
        liked, disliked = NOISE if sign > 0 else NOISE[::-1]
        weight = min(strength, MAX_WEIGHT)
        out += [_feature(liked, True, weight), _feature(disliked, False, weight)]

    for code, n in net.items():
        if n > 0:
            out.append(_feature(code, True, min(n, MAX_WEIGHT)))
        elif (
            n < 0 and FEATURES[code].layer == "food"
        ):  # 반대 극이 없는 비선호는 음식·맛만
            out.append(_feature(code, False, min(-n, MAX_WEIGHT)))
    return sorted(out, key=lambda f: _ORDER[f["code"]])


def _free_texts(
    rows: list[Row], encode: Callable[[list[str]], list[list[float]]]
) -> list[dict]:
    """코드 없는 문장. 똑같은 문장은 합치고, 좋아하는 긍정형 문장만 벡터로 만든다."""
    items: dict[tuple[str, bool], dict] = {}
    to_embed = []
    for r in rows:
        text = r.get("positive_text") or r.get("quote")
        like = r["direction"] > 0
        if r.get("code") or (text, like) in items:
            continue
        items[text, like] = {"text": text, "like": like, "vector": None}
        if like and r.get("positive_text"):
            to_embed.append(items[text, like])
    for t, vec in zip(to_embed, encode([t["text"] for t in to_embed]), strict=True):
        t["vector"] = vec
    return list(items.values())


def build_profile(
    user_id: str | None,
    rows: list[Row],
    *,
    original_text: str | None = None,
    encode: Callable[[list[str]], list[list[float]]] = encode_queries,
) -> dict:
    free_texts = _free_texts(rows, encode)
    return {
        "schema": SCHEMA,
        "user_id": user_id,
        "original_text": original_text,
        "embedding": {"model": MODEL_ID, "revision": REVISION, "prompt": "query"},
        "features": compute_features(rows),
        "free_texts": free_texts,
        "evidence": rows,
    }
