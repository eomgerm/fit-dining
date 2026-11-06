"""fitcrawl(자체 수집기)의 상세(detail) 끝난 장소를 clean/ CSV로 뽑는다(place-catalog 테이블).

    cd ai && uv run python scripts/export_clean_from_crawl.py <fitcrawl data 폴더> <clean 출력 폴더> <west,south,east,north>

fit_ai.place.from_crawl이 뽑는 전부(이름·카테고리·주소·좌표·연락처·영업시간·메뉴·사진·편의시설·
결제수단·부가링크·키워드·주차·반려동물·콜키지·교통·좌석·방송출연)를 CSV로 쓴다.

장소 분석(build_place_profiles.py의 clean.places)이 읽는 리뷰 두 파일(external_reviews.csv,
external_review_keywords.csv)도 쓴다. 원본은 raw/<스냅샷>/reviews/ 의 방문자 리뷰다. 이 두 파일은
적재 스크립트(load_places.py)가 열면 안 된다(place-catalog 스펙 AC-15). 그 밖의 리뷰 관련 CSV(답글,
블로그, 미시 리뷰 등)는 안 쓴다. 리뷰 파일이 없는 장소는 리뷰 없이 내고 report.json의
places_without_reviews에 남긴다.

상세 단계가 끝나지 않은 장소는 건너뛴다. 원본이 깨졌거나 모양이 다른 장소도 건너뛰고 report.json에
남긴다(적재 실패로 조용히 묻히지 않게).
"""

import csv
import gzip
import json
import logging
import sqlite3
import sys
from collections import Counter
from pathlib import Path

from fit_ai.place import from_crawl

log = logging.getLogger(__name__)

TABLES = {
    "places.csv": [
        "naver_place_id",
        "name",
        "category_group_code",
        "category_group_name",
        "category_name",
        "category_code",
        "lat",
        "lng",
        "road_address",
        "jibun_address",
        "full_address",
        "district_name",
        "dong_name",
        "station_code",
        "station_name",
        "directions_text",
        "place_description",
        "primary_phone",
        "homepage_url",
        "naver_booking_url",
        "representative_photo_url",
        "menu_updated_on",
    ],
    "place_category_codes.csv": [
        "naver_place_id",
        "position",
        "category_code",
        "is_category_path",
    ],
    "place_facilities.csv": ["naver_place_id", "facility_label", "in_conveniences"],
    "place_hours.csv": [
        "naver_place_id",
        "service_type",
        "day_of_week",
        "label_date",
        "is_closed",
        "open_time",
        "close_time",
    ],
    "place_hours_breaks.csv": [
        "naver_place_id",
        "service_type",
        "day_of_week",
        "break_seq",
        "break_start",
        "break_end",
    ],
    "place_hours_last_orders.csv": [
        "naver_place_id",
        "service_type",
        "day_of_week",
        "seq",
        "last_order_time",
    ],
    "menu_items.csv": [
        "naver_place_id",
        "menu_item_id",
        "position",
        "name",
        "description",
        "price_type",
        "price",
        "price_text",
        "is_representative",
        "category_name",
    ],
    "menu_item_labels.csv": ["naver_place_id", "menu_item_id", "position", "label"],
    "menu_item_images.csv": ["naver_place_id", "menu_item_id", "position", "url"],
    "place_photos.csv": [
        "naver_place_id",
        "photo_kind",
        "media_source",
        "position",
        "original_url",
    ],
    "place_payments.csv": ["naver_place_id", "payment_label"],
    "place_links.csv": ["naver_place_id", "link_order", "url", "is_dead_url"],
    "place_keywords.csv": ["naver_place_id", "position", "keyword"],
    "place_parking.csv": ["naver_place_id", "description", "basic_parking_is_free"],
    "place_policies.csv": [
        "naver_place_id",
        "pet_allowed",
        "pet_description",
        "corkage_available",
        "corkage_description",
        "corkage_status_description",
    ],
    "place_transit.csv": [
        "naver_place_id",
        "kind",
        "position",
        "stop_name",
        "line_name",
        "exit_number",
        "stop_code",
        "walk_minutes",
        "walk_meters",
    ],
    "place_seat_types.csv": ["naver_place_id", "position", "seat_name", "description"],
    "place_broadcasts.csv": [
        "naver_place_id",
        "position",
        "channel",
        "program",
        "episode",
        "aired_on",
        "menu",
    ],
    "external_reviews.csv": ["naver_place_id", "review_id", "body"],
    "external_review_keywords.csv": [
        "naver_place_id",
        "review_id",
        "position",
        "keyword",
    ],
}

# extract()의 출력 키 -> 그 행들이 들어갈 CSV 파일
OUTPUT_KEY_TO_FILE = {
    "categories": "place_category_codes.csv",
    "facilities": "place_facilities.csv",
    "hours": "place_hours.csv",
    "hour_breaks": "place_hours_breaks.csv",
    "hour_last_orders": "place_hours_last_orders.csv",
    "menu_items": "menu_items.csv",
    "menu_labels": "menu_item_labels.csv",
    "menu_images": "menu_item_images.csv",
    "photos": "place_photos.csv",
    "payments": "place_payments.csv",
    "links": "place_links.csv",
    "keywords": "place_keywords.csv",
    "parking": "place_parking.csv",
    "policies": "place_policies.csv",
    "transit": "place_transit.csv",
    "seats": "place_seat_types.csv",
    "broadcasts": "place_broadcasts.csv",
}


def places_in_scope(
    db_path: Path, bbox: tuple[float, float, float, float]
) -> list[dict]:
    west, south, east, north = bbox
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT place_id, common_address FROM places"
        " WHERE in_scope=1 AND detail_status='done' AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?",
        (west, east, south, north),
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def latest_raw_dir(data_dir: Path) -> Path:
    candidates = sorted((data_dir / "raw").glob("naver-*"))
    if not candidates:
        raise SystemExit(f"{data_dir / 'raw'} 안에 naver-* 폴더가 없다")
    return candidates[-1]


def read_raw_detail(raw_dir: Path, place_id: str) -> dict:
    path = raw_dir / "detail" / place_id[-2:] / f"{place_id}.json.gz"
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)["apollo"]


def read_raw_reviews(raw_dir: Path, place_id: str) -> list[dict]:
    """방문자 리뷰 원본(첫 페이지, "더보기" 수집이 끝난 장소는 그 결과). 파일이 없으면 FileNotFoundError."""
    path = raw_dir / "reviews" / place_id[-2:] / f"{place_id}.json.gz"
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)["visitor"]["items"]


def write_csv(out_dir: Path, name: str, columns: list[str], rows: list[dict]) -> None:
    with open(out_dir / name, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns)
        w.writeheader()
        w.writerows(rows)


def export(
    data_dir: Path, out_dir: Path, bbox: tuple[float, float, float, float], year: int
) -> dict:
    raw_dir = latest_raw_dir(data_dir)
    tables: dict[str, list[dict]] = {name: [] for name in TABLES}
    skipped = []
    without_reviews = []
    stations_without_code = Counter()

    for place in places_in_scope(data_dir / "state.db", bbox):
        pid = place["place_id"]
        try:
            state = read_raw_detail(raw_dir, pid)
            out = from_crawl.extract(state, pid, place["common_address"], year)
            try:
                visitor_items = read_raw_reviews(raw_dir, pid)
            except (
                FileNotFoundError
            ):  # 리뷰 수집이 실패한 장소: 리뷰만 없고 장소는 그대로 낸다
                visitor_items = None
            reviews, review_keywords = from_crawl.review_rows(pid, visitor_items or [])
        except (OSError, ValueError, KeyError, StopIteration) as e:
            skipped.append({"place_id": pid, "error": f"{type(e).__name__}: {e}"})
            continue
        if visitor_items is None:
            without_reviews.append(pid)
        if out["station_without_code"]:
            stations_without_code[out["station_without_code"]] += 1
        tables["places.csv"].append(out["place"])
        for key, file_name in OUTPUT_KEY_TO_FILE.items():
            tables[file_name] += out[key]
        tables["external_reviews.csv"] += reviews
        tables["external_review_keywords.csv"] += review_keywords

    out_dir.mkdir(parents=True, exist_ok=True)
    for name, columns in TABLES.items():
        write_csv(out_dir, name, columns, tables[name])

    return {
        "places_written": len(tables["places.csv"]),
        "skipped": skipped,
        "places_without_reviews": without_reviews,
        # 가장 가까운 역이 코드 없는 역이라 places.station이 NULL인 장소 수(역 이름별). 코드를 더할 역을 알려 준다
        "stations_without_code": dict(stations_without_code.most_common()),
        "rows": {name: len(rows) for name, rows in tables.items()},
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    data_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    bbox = tuple(float(v) for v in sys.argv[3].split(","))
    year = int(sys.argv[4]) if len(sys.argv) > 4 else 2026

    report = export(data_dir, out_dir, bbox, year)
    (out_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log.info(
        "%s에 %d곳을 썼다. 건너뜀 %d건.",
        out_dir,
        report["places_written"],
        len(report["skipped"]),
    )


if __name__ == "__main__":
    main()
