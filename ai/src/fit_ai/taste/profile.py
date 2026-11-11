"""근거 장부 행 → 취향 프로필(spec 2~6단계). LLM은 쓰지 않는다."""

from bisect import bisect_right
from collections import defaultdict
from collections.abc import Callable
from datetime import datetime
from typing import Literal, TypedDict

from fit_ai.embedding import MODEL_ID, REVISION, encode_queries
from fit_ai.features import FEATURES, FLAVORS

SCHEMA = "taste-profile/v1"
HALF_LIFE_REVIEWS = 10  # 근거 무게가 절반이 되는 뒤 리뷰 수. 시작값
REVISIT_WEIGHT = 1.5  # 재방문 의사가 있는 리뷰 근거의 무게 배수. 시작값
OTHER_CATEGORY_SHARE = 0.5  # 업종별 취향에 섞는 다른 업종 리뷰 근거의 몫. 시작값
WEIGHT_DIGITS = 3  # 세기를 저장할 소수 자리
FLIP_PLACES = 3  # 소음 축 방향을 바꾸는 반대 평가 장소 수(PRD FR-14)
NOISE = ("QUIET", "LIVELY")
CATEGORIES = {"식당": "RESTAURANT", "카페": "CAFE", "술집": "BAR"}
"""리뷰 근거의 업종 → 업종별 취향의 `category`. 값은 검색 요청의 업종 코드와 같다."""
_ORDER = {code: i for i, code in enumerate(FEATURES)}


class Row(TypedDict, total=False):
    """근거 장부 한 줄. 계산 결과가 아니라 사용자가 한 일만 적는다."""

    user_id: str | None
    code: str | None  # 코드 없는 취향 문장은 None
    direction: int  # +1 또는 -1
    source: Literal["onboarding", "review", "free_text"]
    place_id: str
    review_id: str
    category: str  # 식당, 카페, 술집
    revisit_intent: bool  # 리뷰 근거만. 없으면 False로 본다
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


def body_codes(items: list[dict]) -> dict[str, int]:
    """리뷰 본문 추출 항목 한 리뷰분 → {사용자 쪽 코드: 근거 방향}(taste-profile spec 2단계).

    본문에서 말한 코드는 그 리뷰에서 그 태그를 고른 것과 같이 본다. 그래서 이유 태그처럼
    아쉬웠다는 말도 그 특징을 따진다는 근거(+1)이고, 소음 축만 아쉬웠으면 반대 극이다(리뷰 D-36).
    맛은 "그 맛이 났나"(direction)와 "좋았나"(liked)를 곱한 방향이다. 났는데 좋았거나 안 났는데
    아쉬웠으면 좋아함(+1), 났는데 아쉬웠거나 안 났는데 좋았으면 싫어함(−1)이다. 좋고 나쁨이
    드러나지 않은 맛은 장소 쪽에만 쓰고 여기서는 뺀다. 한 리뷰에서 같은 코드의 방향이 엇갈리면
    그 코드는 세지 않는다.
    """
    seen: dict[str, set[int]] = defaultdict(set)
    for it in items:
        code = it.get("code")
        if code is None or code not in FEATURES:
            continue
        if code in FLAVORS:
            if it.get("liked") is None:
                continue
            seen[code].add(it["direction"] * it["liked"])
        elif code in NOISE and it["direction"] < 0:
            seen[FEATURES[code].opposite].add(1)
        else:
            seen[code].add(1)
    return {code: dirs.pop() for code, dirs in seen.items() if len(dirs) == 1}


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


def _when(r: Row) -> datetime:
    return datetime.fromisoformat(r["created_at"])


def _weigher(rows: list[Row]) -> Callable[[Row], float]:
    """근거 하나의 무게를 내는 함수를 만든다(spec 3단계).

    무게는 0.5^(뒤에 쓴 리뷰 수 ÷ `HALF_LIFE_REVIEWS`)이고, 재방문 의사가 있는 리뷰면
    `REVISIT_WEIGHT`를 곱한다. 시간이 아니라 리뷰 수로 줄여서 리뷰를 쉬는 동안에는 바뀌지
    않는다. 리뷰는 장소마다 가장 늦은 것 하나만 센다. 온보딩 답과 직접 입력은 가장 오래된
    근거라 뒤에 쓴 리뷰가 그 회원의 리뷰 전체다.
    """
    latest: dict[str, datetime] = {}
    for r in rows:
        if r["source"] == "review":
            when = _when(r)
            if r["place_id"] not in latest or when > latest[r["place_id"]]:
                latest[r["place_id"]] = when
    times = sorted(latest.values())

    def weigh(r: Row) -> float:
        after = (
            len(times) - bisect_right(times, _when(r))
            if r["source"] == "review"
            else len(times)
        )
        revisit = REVISIT_WEIGHT if r.get("revisit_intent") else 1
        return 0.5 ** (after / HALF_LIFE_REVIEWS) * revisit

    return weigh


def _two_way(
    rows: list[Row],
    weigh: Callable[[Row], float],
    sign_of: Callable[[Row], int],
    pole: int | None,
) -> tuple[int, float] | None:
    """양쪽 축(소음, 음식·맛)의 (방향, 세기). 방향은 근거 수로, 세기는 무게 합으로 정한다.

    처음 방향(`pole`)이 있으면 그 방향을 지키고, 없으면 근거 수의 부호를 따른다. 근거 수가
    같으면 무게 합(최근 근거 쪽)을 따른다. 반대 근거가 서로 다른 장소 3곳 이상이고 과반이면
    근거 쪽으로 바꾼다(PRD FR-14). 세기가 0 이하면 None이다.
    """
    count = sum(sign_of(r) for r in rows)
    weighted = sum(sign_of(r) * weigh(r) for r in rows)
    sign = pole or (1 if (count or weighted) > 0 else -1)
    against = {
        r["place_id"] for r in rows if r["source"] == "review" and sign_of(r) == -sign
    }
    if len(against) >= FLIP_PLACES and count * sign < 0:
        sign = -sign
    strength = round(weighted * sign, WEIGHT_DIGITS)
    return (sign, strength) if strength > 0 else None


def _noise(rows: list[Row], weigh: Callable[[Row], float]) -> list[tuple]:
    """소음 축의 (코드, 좋아함, 세기). 처음 방향은 온보딩에서 고른 극이다."""
    pole = next((r["code"] for r in rows if r["source"] == "onboarding"), None)
    found = _two_way(rows, weigh, _noise_sign, {"QUIET": 1, "LIVELY": -1}.get(pole))
    if found is None:
        return []
    liked, disliked = NOISE if found[0] > 0 else NOISE[::-1]
    return [(liked, True, found[1]), (disliked, False, found[1])]


def _food(key: str, rows: list[Row], weigh: Callable[[Row], float]) -> list[tuple]:
    """음식·맛 축의 (코드, 좋아함, 세기). 처음 방향은 직접 입력이다(taste-profile spec 2단계).

    세기는 좋아함 근거의 무게 합 − 싫어함 근거의 무게 합이다. 반대 극 코드가 없어서 싫어하면
    같은 코드의 싫어함으로 낸다.
    """
    pole = next((r["direction"] for r in rows if r["source"] == "free_text"), None)
    found = _two_way(rows, weigh, lambda r: r["direction"], pole)
    return [] if found is None else [(key, found[0] > 0, found[1])]


def _axis(key: str, rows: list[Row], weigh: Callable[[Row], float]) -> list[tuple]:
    """한 축의 (코드, 좋아함, 세기) 목록. 세기는 같은 쪽 무게 합 − 반대쪽 무게 합이다."""
    if key == "NOISE":
        return _noise(rows, weigh)
    if FEATURES[key].layer == "food":
        return _food(key, rows, weigh)
    net = round(sum(r["direction"] * weigh(r) for r in rows), WEIGHT_DIGITS)
    return [(key, True, net)] if net > 0 else []


def _in_category(r: Row, category: str) -> bool:
    return r["source"] != "review" or CATEGORIES[r["category"]] == category


def _category_axis(
    key: str,
    rows: list[Row],
    weigh: Callable[[Row], float],
    category: str,
    overall: list[tuple],
) -> list[tuple]:
    """업종별 취향의 한 축(spec 4단계).

    양쪽 축(소음, 음식·맛)은 그 업종 리뷰와 리뷰가 아닌 근거만으로 정한다. 다른 업종 근거를
    섞으면 방향이 흐려지기 때문이다. 그 업종 리뷰 근거가 없으면 전체 취향을 쓴다. 한 방향
    축(중요 기준, 방문 목적)은 다른 업종 리뷰 근거를 `OTHER_CATEGORY_SHARE`만큼 섞는다.
    """
    if key == "NOISE" or FEATURES[key].layer == "food":
        own = [r for r in rows if _in_category(r, category)]
        if not any(r["source"] == "review" for r in own):
            return overall
        return _axis(key, own, weigh)
    return _axis(
        key,
        rows,
        lambda r: weigh(r) * (1 if _in_category(r, category) else OTHER_CATEGORY_SHARE),
    )


def _features(axes: dict[str, list[tuple]], category: str | None) -> list[dict]:
    out = [
        {
            "code": code,
            "layer": FEATURES[code].layer,
            "like": like,
            "weight": weight,
            "category": category,
        }
        for found in axes.values()
        for code, like, weight in found
    ]
    return sorted(out, key=lambda f: _ORDER[f["code"]])


def compute_features(rows: list[Row]) -> list[dict]:
    """특징마다 좋아하는지와 세기를 정한다. 받은 행은 모두 유효한 근거로 본다.

    전체 취향(`category` None)을 내고, 리뷰 근거가 있으면 업종별 취향(`CATEGORIES`)도
    낸다. 리뷰가 없으면 업종별 취향이 전체 취향과 같아서 내지 않는다.
    """
    coded = _latest_per_place([r for r in rows if r.get("code")])
    weigh = _weigher(rows)
    axes: dict[str, list[Row]] = defaultdict(list)
    for r in coded:
        axes[_feature_key(r["code"])].append(r)
    overall = {key: _axis(key, found, weigh) for key, found in axes.items()}
    out = _features(overall, None)
    if not any(r["source"] == "review" for r in coded):
        return out
    for category in CATEGORIES.values():
        per = {
            key: _category_axis(key, found, weigh, category, overall[key])
            for key, found in axes.items()
        }
        out += _features(per, category)
    return out


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
