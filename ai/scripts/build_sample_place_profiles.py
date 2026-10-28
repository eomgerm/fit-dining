"""샘플 장소 20곳의 장소 프로필과 확인용 리포트를 만든다(spec 7단계 샘플 장소).

    cd ai && uv run --env-file .env python scripts/build_sample_place_profiles.py
    cd ai && uv run --env-file .env python scripts/build_sample_place_profiles.py --reuse  # 페르소나만 새로

출력(samples/place/)에는 네이버 리뷰 원문 구절이 들어가므로 커밋하지 않는다.
"""

import json
import logging
import os
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from fit_ai import gms
from fit_ai.embedding import MODEL_ID, REVISION, encode_documents
from fit_ai.features import FEATURES
from fit_ai.place import extract, persona, profile, rules

DATA = Path(os.environ.get("FIT_AI_DATA_DIR") or Path.home() / "fit-ai-data")
PLACES = DATA / "raw" / "apify-20261023" / "apify-launch" / "places.json"
OUT = Path(__file__).resolve().parents[1] / "samples" / "place"
PER_GROUP = {"식당": 8, "카페": 6, "술집": 6}
WORKERS = 4

# 앱 리뷰 이유 태그 근거를 손으로 만든다(spec 7단계). 대응표는 리뷰 담당과 정한다
APP_TAGS = [
    ("app-1", "너무 시끄러웠어요", "LIVELY", -1),
    ("app-2", "모임하기 좋았어요", "PURPOSE_GROUP", 1),
    ("app-3", "자리가 좁았어요", "SPACIOUS_SEATING", -1),
]

log = logging.getLogger(__name__)
calls: list[bool] = []  # GMS 호출마다 성공 여부


def counted(messages, parse, **kw):
    result = gms.call_json(messages, parse, **kw)
    calls.append(result is not None)
    return result


def pick(places: list[dict]) -> list[dict]:
    """업종마다 수집 목록에서 고르게 뽑는다. 메뉴가 없는 장소를 하나 넣는다."""
    chosen = []
    for group, n in PER_GROUP.items():
        g = [p for p in places if p["group"] == group]
        chosen += g[:: max(1, len(g) // n)][:n]
    if all((p.get("menu") or {}).get("items") for p in chosen):
        no_menu = next(p for p in places if not (p.get("menu") or {}).get("items"))
        chosen[-1] = no_menu
    return chosen


def analyze(place: dict, with_app_tags: bool) -> dict:
    """규칙 근거, 똑같은 리뷰 합치기, 본문 추출. GMS를 부르는 부분이라 장소마다 병렬로 돈다."""
    reviews, merged = extract.dedupe(place["visitorReviews"])
    evidence = [e for r in reviews for e in rules.keyword_evidence(r)]
    text_rows, failed, dropped = extract.extract(reviews, call=counted)
    evidence += text_rows
    menu = rules.spicy_menu((place.get("menu") or {}).get("items") or [])
    if menu:
        evidence.append(
            profile.Evidence(
                review_id=None,
                source="menu",
                code="FOOD_SPICY",
                direction=1,
                slot=None,
                quote=menu,
                text=None,
            )
        )
    n_reviews = len(reviews)
    if with_app_tags:
        n_reviews += len(APP_TAGS)
        evidence += [
            profile.Evidence(
                review_id=rid,
                source="app_tag",
                code=code,
                direction=d,
                slot=None,
                quote=q,
                text=None,
            )
            for rid, q, code, d in APP_TAGS
        ]
    log.info("%s: 근거 %d행", place["name"], len(evidence))
    return {
        "place": place,
        "merged": merged,
        "failed": failed,
        "dropped": dropped,
        "n_reviews": n_reviews,
        "evidence": evidence,
    }


def make_personas(r: dict, feats: list[dict]) -> list[dict]:
    """4단계 특징 목록을 받아야 해서 모든 장소의 근거를 센 뒤에 만든다."""
    bodies = {
        x["review_id"]: x["body"] for x in r["place"]["visitorReviews"] if x.get("body")
    }
    personas = persona.generate(
        r["summary"], r["evidence"], bodies, feats, call=counted
    )
    log.info("%s: 페르소나 %d개", r["place"]["name"], len(personas))
    return personas


def guarded(fn, name: str):
    """한 곳이 실패해도 나머지 장소의 유료 호출 결과는 남긴다. 예외 내용 대신 종류만 남긴다."""
    try:
        return fn()
    except Exception as e:  # noqa: BLE001 - 어떤 예외든 다른 장소 결과를 지키려는 것이다
        log.error("%s 실패: %s", name, type(e).__name__)
        return None


def similarity_stats(values: list[float]) -> dict | None:
    if not values:
        return None
    return {
        "n": len(values),
        "min": round(min(values), 3),
        "median": round(statistics.median(values), 3),
        "max": round(max(values), 3),
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    if os.environ.get("GMS_ENABLED") != "true":
        log.warning("GMS_ENABLED가 true가 아니라 키워드·메뉴 근거만으로 만든다")
    places = pick(json.loads(PLACES.read_text(encoding="utf-8")))
    if "--reuse" in sys.argv:
        # 저장해 둔 본문 추출 결과를 다시 쓴다. 페르소나는 새로 만든다(GMS 장소당 1번)
        by_id = {p["place_id"]: p for p in places}
        saved = json.loads((OUT / "analysis.json").read_text(encoding="utf-8"))
        keep = ("merged", "failed", "dropped", "n_reviews", "evidence")
        results = [
            {k: r[k] for k in keep} | {"place": by_id[r["place_id"]]} for r in saved
        ]
    else:
        with ThreadPoolExecutor(WORKERS) as pool:
            results = pool.map(
                lambda ip: guarded(lambda: analyze(ip[1], ip[0] == 0), ip[1]["name"]),
                enumerate(places),
            )
            results = [r for r in results if r]
        # 본문 추출 결과를 먼저 저장해 둔다. 뒤에서 실패해도 유료 호출 결과를 잃지 않는다
        OUT.mkdir(parents=True, exist_ok=True)
        analysis = [
            {"place_id": r["place"]["place_id"]}
            | {k: v for k, v in r.items() if k != "place"}
            for r in results
        ]
        (OUT / "analysis.json").write_text(
            json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    counts = {r["place"]["place_id"]: profile.count(r["evidence"]) for r in results}
    # 업종 그룹 평균은 실행에 들어온 장소로 구한다. 샘플이 작아 흔들린다(spec 열린 질문)
    means = profile.group_means(
        {
            r["place"]["place_id"]: (
                r["place"]["group"],
                {
                    c: like / r["n_reviews"] if r["n_reviews"] else 0.0
                    for c, (like, _) in counts[r["place"]["place_id"]].items()
                },
            )
            for r in results
        }
    )

    feats = {
        r["place"]["place_id"]: profile.features(
            counts[r["place"]["place_id"]], r["n_reviews"], means[r["place"]["group"]]
        )
        for r in results
    }
    for r in results:
        r["summary"] = profile.summary_text(r["place"])
    with ThreadPoolExecutor(WORKERS) as pool:
        made = pool.map(
            lambda r: guarded(
                lambda: make_personas(r, feats[r["place"]["place_id"]]),
                r["place"]["name"],
            ),
            results,
        )
        for r, personas in zip(results, made, strict=True):
            r["personas"] = personas or []

    texts = [r["summary"] for r in results] + [
        persona.persona_text(p) for r in results for p in r["personas"]
    ]
    vectors = iter(encode_documents(texts))
    summary_vecs = [next(vectors) for _ in results]
    for r in results:
        for p in r["personas"]:
            p["vector"] = next(vectors)

    embedding = {"model": MODEL_ID, "revision": REVISION, "prompt": "document"}
    profiles, report_places = [], []
    for r, vec in zip(results, summary_vecs, strict=True):
        p = r["place"]
        place_feats = feats[p["place_id"]]
        food = rules.food_type(p["categoryCodeList"])
        profiles.append(
            profile.build_profile(
                p["place_id"],
                food,
                r["summary"],
                vec,
                place_feats,
                r["personas"],
                r["evidence"],
                embedding,
                analyzed_review_count=r["n_reviews"],
            )
        )
        report_places.append(
            {
                "place_id": int(p["place_id"]),
                "name": p["name"],
                "group": p["group"],
                "category": p["category"],
                "food_type": food,
                "reviews": len(p["visitorReviews"]),
                "merged": r["merged"],
                "dropped_by_gms_failure": r["failed"],
                "dropped_items_by_check": r["dropped"],
                "labels": [f["code"] for f in place_feats if f["is_label"]],
                "card_order": [f["code"] for f in place_feats[:2]],
                "personas": [
                    {
                        "name": x["name"],
                        "like": x["like"],
                        "reviews": len(x["review_ids"]),
                    }
                    for x in r["personas"]
                ],
            }
        )

    code_stats = {}
    for code in FEATURES:
        rows = [
            (f["like_count"], f["dislike_count"], f["is_label"])
            for pr in profiles
            for f in pr["features"]
            if f["code"] == code
        ]
        code_stats[code] = {
            "like_3_plus": sum(
                1 for like, _, _ in rows if like >= profile.MIN_EVIDENCE
            ),
            "dislike_3_plus": sum(
                1 for _, dislike, _ in rows if dislike >= profile.MIN_EVIDENCE
            ),
            "dislike_any": sum(1 for _, dislike, _ in rows if dislike),
            "labels": sum(1 for *_, label in rows if label),
        }

    # 페르소나끼리 유사도(벡터 길이가 1이라 내적이 코사인 유사도다)
    within, nearest_other = [], []
    owners = [
        (i, np.asarray(p["vector"]))
        for i, pr in enumerate(profiles)
        for p in pr["personas"]
    ]
    for k, (i, v) in enumerate(owners):
        within += [float(v @ w) for j, w in owners[k + 1 :] if j == i]
        other = [float(v @ w) for j, w in owners if j != i]
        if other:
            nearest_other.append(max(other))

    unknown = sorted(
        {
            p["categoryCodeList"][1]
            for p in places
            if p["group"] == "식당"
            and rules.food_type(p["categoryCodeList"]) is None
            and p["categoryCodeList"][1] != "220046"  # 뷔페는 일부러 음식 종류가 없다
        }
    )
    report = {
        "note": "업종 그룹 평균은 샘플 장소만으로 구했다. 그룹마다 6~8곳이라 평균이 흔들린다.",
        "places": report_places,
        "codes": code_stats,
        "group_means": {
            g: {c: round(m, 4) for c, m in ms.items()} for g, ms in means.items()
        },
        "unknown_restaurant_codes": unknown,
        # 근거 3개 이상인 페르소나만 적재하므로(profile-storage D-7) 이 장소들은 페르소나 없이 적재된다
        "places_without_scored_personas": sum(
            1
            for pr in profiles
            if not any(
                len(x["review_ids"]) >= profile.MIN_EVIDENCE for x in pr["personas"]
            )
        ),
        "persona_similarity": {
            "within_place": similarity_stats(within),
            "nearest_other_place": similarity_stats(nearest_other),
        },
        # 꺼져 있으면 모든 호출이 None이라 실패로 잡힌다. calls는 재시도를 세지 않는다
        "gms": {
            "reused_analysis": "--reuse"
            in sys.argv,  # 본문 추출을 다시 쓰면 페르소나 호출만 센다
            "enabled": os.environ.get("GMS_ENABLED") == "true",
            "calls": len(calls),
            "failed": calls.count(False),
        },
    }

    (OUT / "profiles.json").write_text(
        json.dumps(profiles, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log.info(
        "%s에 %d곳을 썼다. GMS 호출 %d번, 실패 %d번",
        OUT,
        len(profiles),
        len(calls),
        calls.count(False),
    )


if __name__ == "__main__":
    main()
