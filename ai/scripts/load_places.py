"""정제한 네이버 수집 CSV(clean/)를 places에 넣는 SQL을 만든다(S15P31A302-113).

    cd ai && uv run python scripts/load_places.py <clean 폴더> > places.sql
    psql "<DB 접속 URL>" -v ON_ERROR_STOP=1 -f places.sql

naver_place_id로 upsert해 다시 돌려도 중복이 생기지 않는다. 장소 분석 결과(place_profiles,
place_personas)는 40 프롬프트가 정해지면 따로 넣는다. 사진·영업시간·메뉴·리뷰 CSV는 받을 테이블이 아직 없다.
"""

import csv
import sys
from collections import defaultdict
from pathlib import Path

from fit_ai.place.rules import food_type


def read(clean: Path, name: str) -> list[dict]:
    """빈 값은 None이다(정제본 규약: 빈 문자열을 쓰지 않는다)."""
    with open(clean / name, encoding="utf-8", newline="") as f:
        return [{k: v or None for k, v in r.items()} for r in csv.DictReader(f)]


def by_place(rows: list[dict], order: str | None = None) -> dict[str, list[dict]]:
    if order:
        rows = sorted(rows, key=lambda r: int(r[order]))
    out = defaultdict(list)
    for r in rows:
        out[r["naver_place_id"]].append(r)
    return out


def boolean(v: str | None) -> bool | None:
    return None if v is None else v == "true"


def place_rows(clean: Path) -> list[dict]:
    codes = by_place(
        [
            r
            for r in read(clean, "place_category_codes.csv")
            if r["is_category_path"] == "true"
        ],
        "position",
    )
    facilities = by_place(read(clean, "place_facilities.csv"))
    payments = by_place(read(clean, "place_payments.csv"))
    links = by_place(
        [r for r in read(clean, "place_links.csv") if r["is_dead_url"] != "true"],
        "link_order",
    )
    keywords = by_place(read(clean, "place_keywords.csv"), "position")
    parking = {r["naver_place_id"]: r for r in read(clean, "place_parking.csv")}
    policies = {r["naver_place_id"]: r for r in read(clean, "place_policies.csv")}

    rows = []
    for p in read(clean, "places.csv"):
        pid = p["naver_place_id"]
        path = [r["category_code"] for r in codes[pid]]
        park = parking.get(pid, {})
        policy = policies.get(pid, {})
        rows.append(
            {
                "naver_place_id": pid,
                "name": p["name"],
                "category_group": p["category_group_code"],
                "food_type": food_type(path),
                "station": p["station_code"],
                "thumbnail_url": p["representative_photo_url"],
                "category": p["category_name"],
                "category_code": p["category_code"],
                "category_code_path": path,
                "lat": float(p["lat"]),
                "lng": float(p["lng"]),
                "address": p["road_address"],
                "jibun_address": p["jibun_address"],
                "full_address": p["full_address"],
                "district": p["district_name"],
                "dong": p["dong_name"],
                "directions": p["directions_text"],
                "description": p["place_description"],
                "phone": p["primary_phone"],
                "website": p["homepage_url"],
                "extra_links": [r["url"] for r in links[pid]],
                # CSV의 booking_url은 예약 검색 화면이다. 예약 페이지는 naver_booking_url(DATA_DICTIONARY)
                "booking_url": p["naver_booking_url"],
                "facilities": [r["facility_label"] for r in facilities[pid]],
                "parking_free": boolean(park.get("basic_parking_is_free")),
                "parking_note": park.get("description"),
                "pet_allowed": boolean(policy.get("pet_allowed")),
                "pet_note": policy.get("pet_description"),
                "corkage_allowed": boolean(policy.get("corkage_available")),
                "corkage_note": policy.get("corkage_description")
                or policy.get("corkage_status_description"),
                "payment_methods": [r["payment_label"] for r in payments[pid]],
                "keywords": [r["keyword"] for r in keywords[pid]],
                "menu_updated_on": p["menu_updated_on"],
            }
        )
    return rows


def literal(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, list):
        return f"ARRAY[{', '.join(map(literal, v))}]::text[]" if v else "'{}'::text[]"
    return "'" + str(v).replace("'", "''") + "'"


def upsert_sql(rows: list[dict]) -> str:
    cols = list(rows[0])
    values = ",\n".join(f"({', '.join(literal(r[c]) for c in cols)})" for r in rows)
    updates = "".join(f"{c} = EXCLUDED.{c}, " for c in cols if c != "naver_place_id")
    return (
        f"INSERT INTO places ({', '.join(cols)}) VALUES\n{values}\n"
        f"ON CONFLICT (naver_place_id) DO UPDATE SET {updates}updated_at = now();\n"
    )


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write(upsert_sql(place_rows(Path(sys.argv[1]))))
