"""정제한 네이버 수집 CSV(clean/) 읽기. 컬럼 뜻은 clean/DATA_DICTIONARY.md를 따른다."""

import csv
from collections import defaultdict
from pathlib import Path


def read(clean: Path, name: str) -> list[dict]:
    """빈 값은 None이다(정제본 규약: 빈 문자열을 쓰지 않는다)."""
    with open(clean / name, encoding="utf-8", newline="") as f:
        return [{k: v or None for k, v in r.items()} for r in csv.DictReader(f)]


def by_place(rows: list[dict], order: str | None = None) -> dict[str, list[dict]]:
    """장소별로 묶는다. order 열이 있으면 그 순서, 없으면 파일 순서다."""
    if order:
        rows = sorted(rows, key=lambda r: int(r[order]))
    out = defaultdict(list)
    for r in rows:
        out[r["naver_place_id"]].append(r)
    return out


def places(clean: Path) -> list[dict]:
    """장소 분석(pipeline) 입력. 수집 원본(places.json)에서 분석이 쓰는 키만 같은 모양으로 만든다.

    원본과 견주면 300곳의 리뷰·키워드·메뉴·시설은 같다. 정제본에 원본 순서가 없어 리뷰와 시설의
    순서가 다르고(그래서 똑같은 리뷰를 합칠 때 남는 리뷰가 달라 키워드 근거 수가 조금 달라질 수 있다),
    본문의 줄 끝 공백과 폭 없는 공백(U+200B)은 정제 때 지워졌다.
    """
    codes = by_place(
        [
            r
            for r in read(clean, "place_category_codes.csv")
            if r["is_category_path"] == "true"
        ],
        "position",
    )
    # 원본 conveniences는 정제본 편의시설 중 in_conveniences인 것이다
    conveniences = by_place(
        [
            r
            for r in read(clean, "place_facilities.csv")
            if r["in_conveniences"] == "true"
        ]
    )
    subways = by_place(
        [r for r in read(clean, "place_transit.csv") if r["kind"] == "SUBWAY"],
        "position",
    )
    menus = by_place(read(clean, "menu_items.csv"), "position")
    keywords = defaultdict(list)
    for r in sorted(
        read(clean, "external_review_keywords.csv"), key=lambda r: int(r["position"])
    ):
        keywords[r["review_id"]].append(r["keyword"])
    reviews = by_place(read(clean, "external_reviews.csv"))

    return [
        {
            "place_id": (pid := p["naver_place_id"]),
            "name": p["name"],
            "group": p["category_group_name"],
            "category": p["category_name"],
            "categoryCodeList": [r["category_code"] for r in codes[pid]],
            "station": p["station_name"],
            "conveniences": [r["facility_label"] for r in conveniences[pid]],
            "subwayStations": [{"stationName": r["stop_name"]} for r in subways[pid]],
            "menu": {
                "items": [
                    {
                        "name": m["name"],
                        "description": m["description"],
                        "representative": m["is_representative"] == "true",
                    }
                    for m in menus[pid]
                ]
            },
            "visitorReviews": [
                {
                    "review_id": r["review_id"],
                    "body": r["body"],
                    "voted_keywords": keywords[r["review_id"]],
                }
                for r in reviews[pid]
            ],
        }
        for p in read(clean, "places.csv")
    ]
