"""정제한 네이버 수집 CSV(clean/)를 places와 장소 자식 테이블 7개(V7)에 넣는 SQL을 만든다(S15P31A302-113).

    cd ai && uv run python scripts/load_places.py <clean 폴더> > places.sql   # 테이블별 행 수는 stderr
    psql "<DB 접속 URL>" -v ON_ERROR_STOP=1 -f places.sql

변형 규칙은 docs/specs/place-catalog/spec.md의 "적재·mock 변형 규칙"을 따른다. 다시 돌려도 장소는
중복되지 않고 place_id도 그대로다. 리뷰에서 나온 CSV는 열지 않는다(place-catalog D-4, D-5).
장소 분석 결과(place_profiles, place_personas)는 40 프롬프트가 정해지면 따로 넣는다.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

from fit_ai.place.clean import by_place, read
from fit_ai.place.rules import food_type


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


def hhmm(v: str | None) -> str | None:
    """time은 24:00을 받지만 Java LocalTime은 못 받아 00:00으로 넣는다(D-10)."""
    return "00:00" if v == "24:00" else v


def child_rows(clean: Path) -> dict[str, list[dict]]:
    """place-catalog spec의 "적재·mock 변형 규칙"대로 만든 자식 테이블 행. 테이블 이름 → 행."""
    hours = read(clean, "place_hours.csv")
    services = defaultdict(set)
    for r in hours:
        services[r["naver_place_id"]].add(r["service_type"])

    def chosen(r: dict) -> bool:
        # 기본 시간표가 없으면(스타벅스 12곳) 매장 시간표만 쓴다(D-10)
        pid = r["naver_place_id"]
        return r["service_type"] == (
            "DEFAULT" if "DEFAULT" in services[pid] else "DINE_IN"
        )

    def day(r: dict) -> tuple[str, str]:
        return r["naver_place_id"], r["day_of_week"]

    breaks = defaultdict(list)
    for r in sorted(
        read(clean, "place_hours_breaks.csv"), key=lambda r: int(r["break_seq"])
    ):
        if chosen(r):
            breaks[day(r)].append(
                {"start": hhmm(r["break_start"]), "end": hhmm(r["break_end"])}
            )
    last_orders = defaultdict(list)
    for r in sorted(
        read(clean, "place_hours_last_orders.csv"), key=lambda r: int(r["seq"])
    ):
        if chosen(r):
            last_orders[day(r)].append(hhmm(r["last_order_time"]))

    place_hours = [
        {
            "naver_place_id": r["naver_place_id"],
            "day_of_week": r["day_of_week"],
            "open_time": hhmm(r["open_time"]),
            "close_time": hhmm(r["close_time"]),
            # 날짜가 붙은 휴무("금(10/23) 휴무")는 정규 시간을 몰라 휴무가 아니라 정보 없음이다(D-24)
            "closed": r["is_closed"] == "true" and r["label_date"] is None,
            "breaks": json.dumps(breaks[day(r)], ensure_ascii=False),
            "last_orders": last_orders[day(r)],
        }
        for r in hours
        if chosen(r)
    ]

    # 업체 사진과 메뉴판 사진만, 순서는 출처마다 0부터 다시 센다(D-7, D-9)
    place_photos = []
    seen = defaultdict(int)
    for r in sorted(read(clean, "place_photos.csv"), key=lambda r: int(r["position"])):
        if r["photo_kind"] == "BUSINESS" and r["media_source"] == "business":
            source = "business"
        elif r["photo_kind"] == "MENU_BOARD":
            source = "menuBoard"
        else:
            continue
        key = (r["naver_place_id"], source)
        place_photos.append(
            {
                "naver_place_id": key[0],
                "source": source,
                "sort_order": seen[key],
                "url": r["original_url"],
            }
        )
        seen[key] += 1

    def by_menu(name: str, col: str) -> dict[str, list[str]]:
        out = defaultdict(list)
        for r in sorted(read(clean, name), key=lambda r: int(r["position"])):
            out[r["menu_item_id"]].append(r[col])
        return out

    labels = by_menu("menu_item_labels.csv", "label")
    images = by_menu("menu_item_images.csv", "url")
    place_menus = [
        {
            "naver_place_id": pid,
            "sort_order": i,
            "category": m["category_name"],
            "name": m["name"],
            "description": m["description"],
            "price": int(m["price"])
            if m["price_type"] == "FIXED" and m["price"]
            else None,
            "price_text": m["price_text"],
            "price_type": m["price_type"],
            "representative": m["is_representative"] == "true",
            "labels": labels[m["menu_item_id"]],
            "photo_urls": images[m["menu_item_id"]],
        }
        for pid, items in by_place(read(clean, "menu_items.csv"), "position").items()
        for i, m in enumerate(items)
    ]

    # 순서 열이 없는 테이블은 원본 순서로 넣어 PK 순서가 원본 순서다(D-9)
    transit = sorted(read(clean, "place_transit.csv"), key=lambda r: int(r["position"]))
    place_subways = [
        {
            "naver_place_id": r["naver_place_id"],
            "station": r["stop_name"],
            "line": r["line_name"],
            "exit": r["exit_number"],
            "walk_minutes": int(r["walk_minutes"]),
            "walk_meters": int(r["walk_meters"]),
        }
        for r in transit
        if r["kind"] == "SUBWAY"
    ]
    place_bus_stops = [
        {
            "naver_place_id": r["naver_place_id"],
            "name": r["stop_name"],
            "code": r["stop_code"],
            "walk_minutes": int(r["walk_minutes"]),
            "walk_meters": int(r["walk_meters"]),
        }
        for r in transit
        if r["kind"] == "BUS"
    ]
    place_seats = [
        {
            "naver_place_id": r["naver_place_id"],
            "name": r["seat_name"],
            "description": r["description"],
        }
        for r in sorted(
            read(clean, "place_seat_types.csv"), key=lambda r: int(r["position"])
        )
    ]
    place_broadcasts = [
        {
            "naver_place_id": r["naver_place_id"],
            "channel": r["channel"],
            "program": r["program"],
            "episode": r["episode"],
            "aired_on": r["aired_on"],
            "menu": r["menu"],
        }
        for r in sorted(
            read(clean, "place_broadcasts.csv"), key=lambda r: int(r["position"])
        )
    ]
    return {
        "place_hours": place_hours,
        "place_menus": place_menus,
        "place_photos": place_photos,
        "place_subways": place_subways,
        "place_bus_stops": place_bus_stops,
        "place_seats": place_seats,
        "place_broadcasts": place_broadcasts,
    }


def literal(v) -> str:
    """배열은 '{...}' 문자열로 내 열 타입(text[], time[])에 맞게 바뀌게 한다."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int | float):
        return repr(v)
    if isinstance(v, list):
        items = ('"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"' for s in v)
        v = "{" + ",".join(items) + "}"
    return "'" + str(v).replace("'", "''") + "'"


def place_id(naver_place_id: str) -> str:
    return f"(SELECT place_id FROM places WHERE naver_place_id = {literal(naver_place_id)})"


def load_sql(places: list[dict], tables: dict[str, list[dict]]) -> str:
    """한 트랜잭션. 장소는 naver_place_id로 갱신해 place_id를 유지하고, 그 장소들의 자식 행은 지운 뒤 다시 넣는다(D-15)."""
    cols = list(places[0])
    values = ",\n".join(f"({', '.join(literal(r[c]) for c in cols)})" for r in places)
    updates = "".join(f"{c} = EXCLUDED.{c}, " for c in cols if c != "naver_place_id")
    ids = ", ".join(literal(p["naver_place_id"]) for p in places)
    sql = [
        "BEGIN;",
        (
            f"INSERT INTO places ({', '.join(cols)}) VALUES\n{values}\n"
            f"ON CONFLICT (naver_place_id) DO UPDATE SET {updates}updated_at = now();"
        ),
    ]
    for table, rows in tables.items():
        sql.append(
            f"DELETE FROM {table} WHERE place_id IN "
            f"(SELECT place_id FROM places WHERE naver_place_id IN ({ids}));"
        )
        if rows:
            cols = [c for c in rows[0] if c != "naver_place_id"]
            values = ",\n".join(
                f"({', '.join([place_id(r['naver_place_id'])] + [literal(r[c]) for c in cols])})"
                for r in rows
            )
            sql.append(
                f"INSERT INTO {table} (place_id, {', '.join(cols)}) VALUES\n{values};"
            )
    sql.append("COMMIT;")
    return "\n".join(sql) + "\n"


def dropped(
    clean: Path, places: list[dict], tables: dict[str, list[dict]]
) -> dict[str, int]:
    """버린 이유별 행 수. CSV 행 수에서 넣은 행 수를 뺀다."""
    hours = tables["place_hours"]
    kept_times = sum(
        len(json.loads(h["breaks"])) + len(h["last_orders"]) for h in hours
    )
    n = lambda name: len(read(clean, name))
    return {
        "매장 외 시간표 요일": n("place_hours.csv") - len(hours),
        "매장 외 시간표 브레이크·라스트오더": n("place_hours_breaks.csv")
        + n("place_hours_last_orders.csv")
        - kept_times,
        "업체·메뉴판 외 사진(대표, 방문자, 클립, 영상, pai)": n("place_photos.csv")
        - len(tables["place_photos"]),
        "죽은 링크": n("place_links.csv") - sum(len(p["extra_links"]) for p in places),
    }


if __name__ == "__main__":
    clean = Path(sys.argv[1])
    places, tables = place_rows(clean), child_rows(clean)
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write(load_sql(places, tables))
    sys.stderr.reconfigure(encoding="utf-8")
    counts = {"places": len(places)} | {t: len(rows) for t, rows in tables.items()}
    print(
        "[넣은 행]",
        *(f"  {k} {v}" for k, v in counts.items()),
        sep="\n",
        file=sys.stderr,
    )
    print(
        "[버린 행]",
        *(f"  {k} {v}" for k, v in dropped(clean, places, tables).items()),
        sep="\n",
        file=sys.stderr,
    )
