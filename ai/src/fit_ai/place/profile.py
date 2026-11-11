"""근거 행 → 장소 프로필(spec 4·6·7단계). LLM은 쓰지 않는다."""

import re
from collections import defaultdict
from typing import Literal, NotRequired, TypedDict

from fit_ai.features import FEATURES

SCHEMA = "place-profile/v0"
MIN_EVIDENCE = 3  # 검증 전 초기값(PRD §8)
MAX_MENUS = 10  # 장소 요약에 넣는 메뉴 수(임시)
_ORDER = {code: i for i, code in enumerate(FEATURES)}
# 메뉴 이름에 가격을 적어 둔 곳이 있다("아메리카노 2,000원", "소주(2,000원할인)").
# "원" 뒤에 붙은 말까지 지운다. "원" 없이 숫자만 쓴 가격은 남는다
_PRICE = re.compile(r"\(?\s*\d[\d,]*\s*원[^\s)]*\s*\)?")
# 비율이 평균과 같은데 부동소수점 오차로 "높다"가 되지 않게 둔다
_EPS = 1e-9


class Evidence(TypedDict):
    """근거 한 줄. 리뷰가 지워지면 이 행만 빼고 다시 센다."""

    review_id: str | None  # 메뉴 근거는 None
    source: Literal["naver_text", "naver_keyword", "app_text", "app_tag", "menu"]
    code: str | None  # 코드 없는 항목(메뉴 평가 등)은 None
    direction: int  # 좋았어요 1, 아쉬웠어요 -1. 맛 코드는 그 맛이 났으면 1, 안 났거나 약했으면 -1
    slot: str | None  # 3단계 칸. 키워드·이유 태그·메뉴는 None
    quote: str
    text: str | None  # 코드가 없을 때 정리한 문장
    liked: NotRequired[
        int | None
    ]  # 맛 코드만. 좋았음 1, 아쉬웠음 -1, 드러나지 않음 None
    kind: NotRequired[str]  # 본문 추출 항목만. taste, facility, quality, budget


def count(evidence: list[Evidence]) -> dict[str, tuple[int, int]]:
    """코드별 (좋았어요 리뷰 수, 아쉬웠어요 리뷰 수).

    맛 코드는 (그 맛이 났다는 리뷰 수, 안 났거나 약했다는 리뷰 수)다. 장소 쪽 맛 근거는 좋았는지와
    상관없이 "그 맛이 났나"만 본다. 한 리뷰에서 같은 코드는 한 번만 세고, 방향이 엇갈리면 그
    리뷰에서는 세지 않는다.
    메뉴 근거는 장소당 최대 1개다.
    """
    seen: dict[tuple[str | None, str], set[int]] = defaultdict(set)
    for e in evidence:
        if e["code"]:
            seen[(e["review_id"], e["code"])].add(e["direction"])
    out: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for (_, code), dirs in seen.items():
        if len(dirs) == 1:
            out[code][0 if 1 in dirs else 1] += 1
    return {c: (like, dislike) for c, (like, dislike) in out.items()}


def group_means(
    places: dict[str, tuple[str, dict[str, float]]],
) -> dict[str, dict[str, float]]:
    """업종 그룹별 코드 비율 평균. 입력은 {장소: (그룹, {코드: 비율})}, 근거 없는 코드는 0."""
    by_group: dict[str, list[dict[str, float]]] = defaultdict(list)
    for group, rates in places.values():
        by_group[group].append(rates)
    return {
        g: {c: sum(r.get(c, 0.0) for r in rs) / len(rs) for c in FEATURES}
        for g, rs in by_group.items()
    }


def features(
    counts: dict[str, tuple[int, int]], n_reviews: int, means: dict[str, float]
) -> list[dict]:
    """특징 목록. 라벨 → 기본 조건만 채운 코드 → 나머지 순서이고,
    각 묶음 안에서는 업종 그룹 평균 대비 비율이 큰 코드가 앞이다(spec 4단계 제안)."""

    def lift(code: str, like: int) -> float:
        rate, mean = like / n_reviews if n_reviews else 0.0, means.get(code, 0.0)
        if mean:
            return rate / mean
        return float("inf") if rate else 0.0

    rows = []
    for code, (like, dislike) in counts.items():
        base = like >= MIN_EVIDENCE and like > dislike
        label = base and lift(code, like) > 1 + _EPS
        tier = 0 if label else 1 if base else 2
        rows.append((tier, -lift(code, like), _ORDER[code], code, like, dislike, label))
    rows.sort()
    return [
        {
            "code": code,
            "layer": FEATURES[code].layer,
            "like_count": like,
            "dislike_count": dislike,
            "is_label": label,
        }
        for *_, code, like, dislike, label in rows
    ]


def summary_text(place: dict) -> str:
    """이름, 업종, 메뉴, 시설, 가까운 역. 가격은 넣지 않는다(기술 설계 §3.1)."""
    items = (place.get("menu") or {}).get("items") or []
    # 대표 메뉴를 먼저, 그다음 메뉴판 순서(sorted는 같은 값의 순서를 유지한다)
    names = [
        _PRICE.sub("", m["name"]).strip()
        for m in sorted(items, key=lambda m: not m.get("representative"))
    ]
    menus = list(dict.fromkeys(n for n in names if n))[:MAX_MENUS]
    parts = [place["name"], f"{place['group']}, {place['category']}"]
    if menus:
        parts.append("메뉴: " + ", ".join(menus))
    if place.get("conveniences"):
        parts.append("시설: " + ", ".join(place["conveniences"]))
    # 역 목록은 걷는 거리순이라 첫 역이 가장 가깝다. 목록이 비면 station(가장 가까운 역, 없으면 None)을 쓴다.
    # 가까운 역이 없는 장소는 "근처"를 쓰지 않는다
    stations = place.get("subwayStations") or []
    if stations:
        nearest = stations[0]["stationName"]
    elif place.get("station"):
        nearest = place["station"].removesuffix("역") + "역"
    else:
        nearest = None
    if nearest:
        parts.append(f"{nearest} 근처")
    return ". ".join(parts) + "."


def build_profile(
    place_id: str,
    food_type: str | None,
    summary: str,
    summary_vector: list[float],
    feature_rows: list[dict],
    personas: list[dict],
    evidence: list[Evidence],
    embedding: dict,
    *,
    analyzed_review_count: int,
) -> dict:
    return {
        "schema": SCHEMA,
        # 네이버 장소 ID다. 적재 때 places.naver_place_id로 서비스 장소를 찾는다(profile-storage D-12)
        "place_id": int(place_id),
        "food_type": food_type,
        "analyzed_review_count": analyzed_review_count,
        "embedding": embedding,
        "summary": {"text": summary, "vector": summary_vector},
        "features": feature_rows,
        "personas": personas,
        "evidence": evidence,
    }
