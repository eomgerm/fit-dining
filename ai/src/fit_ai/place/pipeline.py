"""장소 목록 → 장소 프로필(spec 1~7단계). 샘플 스크립트와 전체 실행 스크립트가 같이 쓴다.

장소 dict는 수집 원본(places.json)의 모양이다: place_id, name, group, category, categoryCodeList,
station, conveniences, subwayStations[{stationName}], menu{items[{name, description, representative}]},
visitorReviews[{review_id, body, voted_keywords}].
"""

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from fit_ai import gms
from fit_ai.embedding import MODEL_ID, REVISION, encode_documents
from fit_ai.place import extract, persona, profile, rules

WORKERS = 4

log = logging.getLogger(__name__)


def analyze(
    place: dict,
    app_evidence: list[profile.Evidence] = (),
    *,
    call: Callable = gms.call_json,
) -> dict:
    """규칙 근거, 똑같은 리뷰 합치기, 본문 추출. GMS를 부르는 부분이라 장소마다 병렬로 돈다."""
    reviews, merged = extract.dedupe(place["visitorReviews"])
    evidence = [e for r in reviews for e in rules.keyword_evidence(r)]
    text_rows, failed, dropped = extract.extract(reviews, call=call)
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
    evidence += app_evidence
    n_reviews = len(reviews) + len({e["review_id"] for e in app_evidence})
    log.info("%s: 근거 %d행", place["name"], len(evidence))
    return {
        "place": place,
        "merged": merged,
        "failed": failed,
        "dropped": dropped,
        "n_reviews": n_reviews,
        "evidence": evidence,
    }


def guarded(fn: Callable, name: str):
    """한 곳이 실패해도 나머지 장소의 유료 호출 결과는 남긴다. 예외 내용 대신 종류만 남긴다."""
    try:
        return fn()
    except Exception as e:  # noqa: BLE001 - 어떤 예외든 다른 장소 결과를 지키려는 것이다
        log.error("%s 실패: %s", name, type(e).__name__)
        return None


def analyze_all(
    places: list[dict],
    app_evidence: Callable[[int], list[profile.Evidence]] = lambda i: [],
    *,
    call: Callable = gms.call_json,
    workers: int = WORKERS,
) -> list[dict]:
    """실패한 장소는 빠진다. app_evidence는 장소 순번 → 앱 리뷰 근거(샘플 확인용)."""
    with ThreadPoolExecutor(workers) as pool:
        results = pool.map(
            lambda ip: guarded(
                lambda: analyze(ip[1], app_evidence(ip[0]), call=call), ip[1]["name"]
            ),
            enumerate(places),
        )
        return [r for r in results if r]


def build_profiles(
    results: list[dict],
    *,
    call: Callable = gms.call_json,
    encode: Callable[[list[str]], list[list[float]]] = encode_documents,
    workers: int = WORKERS,
) -> tuple[list[dict], dict[str, dict[str, float]], dict[str, list[dict]]]:
    """(프로필, 업종 그룹 평균, 장소별 특징). results에 summary와 personas를 채운다.

    업종 그룹 평균은 넘겨받은 장소로 구한다. 전체 장소를 넘겨야 is_label이 spec 4단계대로다.
    """
    counts = {r["place"]["place_id"]: profile.count(r["evidence"]) for r in results}
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

    def make_personas(r: dict) -> list[dict]:
        # 4단계 특징 목록을 받아야 해서 모든 장소의 근거를 센 뒤에 만든다
        bodies = {
            x["review_id"]: x["body"]
            for x in r["place"]["visitorReviews"]
            if x.get("body")
        }
        made = persona.generate(
            r["summary"],
            r["evidence"],
            bodies,
            feats[r["place"]["place_id"]],
            call=call,
        )
        log.info("%s: 페르소나 %d개", r["place"]["name"], len(made))
        return made

    with ThreadPoolExecutor(workers) as pool:
        made = pool.map(
            lambda r: guarded(lambda: make_personas(r), r["place"]["name"]), results
        )
        for r, personas in zip(results, made, strict=True):
            r["personas"] = personas or []

    texts = [r["summary"] for r in results] + [
        persona.persona_text(p) for r in results for p in r["personas"]
    ]
    vectors = iter(encode(texts))
    summary_vecs = [next(vectors) for _ in results]
    for r in results:
        for p in r["personas"]:
            p["vector"] = next(vectors)

    embedding = {"model": MODEL_ID, "revision": REVISION, "prompt": "document"}
    profiles = [
        profile.build_profile(
            r["place"]["place_id"],
            rules.food_type(r["place"]["categoryCodeList"]),
            r["summary"],
            vec,
            feats[r["place"]["place_id"]],
            r["personas"],
            r["evidence"],
            embedding,
            analyzed_review_count=r["n_reviews"],
        )
        for r, vec in zip(results, summary_vecs, strict=True)
    ]
    return profiles, means, feats
