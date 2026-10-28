import csv
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "load_places", Path(__file__).resolve().parents[2] / "scripts" / "load_places.py"
)
load_places = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(load_places)

PLACE = {
    "naver_place_id": "1",
    "name": "카페 A",
    "category_name": "카페",
    "category_code": "221275",
    "category_group_code": "CAFE",
    "station_code": "GANGNAM",
    "lat": "37.5",
    "lng": "127.02",
    "road_address": "서울 강남구 테헤란로 1 2층",
    "jibun_address": "서울 강남구 역삼동 1",
    "full_address": "서울특별시 강남구 역삼동 1 2층",
    "district_name": "강남구",
    "dong_name": "역삼동",
    "directions_text": "",
    "place_description": "소개",
    "primary_phone": "0507-1-2",
    "homepage_url": "http://a.kr",
    "booking_url": "https://m.booking.naver.com/search",
    "naver_booking_url": "https://m.booking.naver.com/booking/6/1",
    "representative_photo_url": "https://img/1.jpg",
    "menu_updated_on": "2026-08-03",
}


def write(dir: Path, name: str, rows: list[dict]):
    with open(dir / name, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def fixture(dir: Path):
    korean = {
        **PLACE,
        "naver_place_id": "2",
        "name": "한식 B",
        "category_group_code": "RESTAURANT",
        "naver_booking_url": "",
        "homepage_url": "",
        "menu_updated_on": "",
    }
    write(dir, "places.csv", [PLACE, korean])
    write(
        dir,
        "place_category_codes.csv",
        [
            {
                "naver_place_id": "1",
                "position": "2",
                "category_code": "220052",
                "is_category_path": "true",
            },
            {
                "naver_place_id": "1",
                "position": "1",
                "category_code": "220036",
                "is_category_path": "true",
            },
            {
                "naver_place_id": "1",
                "position": "3",
                "category_code": "1004760",
                "is_category_path": "false",
            },
            {
                "naver_place_id": "2",
                "position": "1",
                "category_code": "220036",
                "is_category_path": "true",
            },
            {
                "naver_place_id": "2",
                "position": "2",
                "category_code": "220037",
                "is_category_path": "true",
            },
        ],
    )
    write(
        dir,
        "place_facilities.csv",
        [
            {"naver_place_id": "1", "facility_label": "무선 인터넷"},
            {"naver_place_id": "1", "facility_label": "주차"},
        ],
    )
    write(
        dir,
        "place_payments.csv",
        [{"naver_place_id": "1", "payment_label": "지역화폐"}],
    )
    write(
        dir,
        "place_links.csv",
        [
            {
                "naver_place_id": "1",
                "link_order": "2",
                "url": "http://insta",
                "is_dead_url": "false",
            },
            {
                "naver_place_id": "1",
                "link_order": "1",
                "url": "http://dead",
                "is_dead_url": "true",
            },
        ],
    )
    write(
        dir,
        "place_keywords.csv",
        [
            {"naver_place_id": "1", "position": "2", "keyword": "디저트"},
            {"naver_place_id": "1", "position": "1", "keyword": "강남카페"},
        ],
    )
    write(
        dir,
        "place_parking.csv",
        [
            {
                "naver_place_id": "1",
                "description": "건물 주차장",
                "basic_parking_is_free": "false",
            }
        ],
    )
    write(
        dir,
        "place_policies.csv",
        [
            {
                "naver_place_id": "1",
                "pet_allowed": "true",
                "pet_description": "",
                "corkage_available": "false",
                "corkage_description": "",
                "corkage_status_description": "외부 주류 반입 불가",
            }
        ],
    )


def test_place_rows_maps_places_and_child_files(tmp_path):
    fixture(tmp_path)
    cafe, korean = load_places.place_rows(tmp_path)

    assert cafe == {
        "naver_place_id": "1",
        "name": "카페 A",
        "category_group": "CAFE",
        "food_type": None,
        "station": "GANGNAM",
        "thumbnail_url": "https://img/1.jpg",
        "category": "카페",
        "category_code": "221275",
        "category_code_path": ["220036", "220052"],
        "lat": 37.5,
        "lng": 127.02,
        "address": "서울 강남구 테헤란로 1 2층",
        "jibun_address": "서울 강남구 역삼동 1",
        "full_address": "서울특별시 강남구 역삼동 1 2층",
        "district": "강남구",
        "dong": "역삼동",
        "directions": None,
        "description": "소개",
        "phone": "0507-1-2",
        "website": "http://a.kr",
        "extra_links": ["http://insta"],
        "booking_url": "https://m.booking.naver.com/booking/6/1",
        "facilities": ["무선 인터넷", "주차"],
        "parking_free": False,
        "parking_note": "건물 주차장",
        "pet_allowed": True,
        "pet_note": None,
        "corkage_allowed": False,
        "corkage_note": "외부 주류 반입 불가",
        "payment_methods": ["지역화폐"],
        "keywords": ["강남카페", "디저트"],
        "menu_updated_on": "2026-08-03",
    }
    assert korean["food_type"] == "FOOD_KOREAN"
    assert korean["booking_url"] is None
    assert korean["facilities"] == [] and korean["extra_links"] == []
    assert korean["parking_free"] is None and korean["pet_allowed"] is None


def test_upsert_sql_quotes_values_and_updates_on_conflict():
    sql = load_places.upsert_sql(
        [
            {
                "naver_place_id": "1",
                "name": "할매's",
                "food_type": None,
                "parking_free": True,
                "lat": 37.5,
                "keywords": ["a'b"],
                "facilities": [],
            }
        ]
    )

    assert (
        "VALUES\n('1', '할매''s', NULL, true, 37.5, ARRAY['a''b']::text[], '{}'::text[])"
        in sql
    )
    assert "ON CONFLICT (naver_place_id) DO UPDATE SET name = EXCLUDED.name," in sql
    assert "naver_place_id = EXCLUDED" not in sql
    assert sql.rstrip().endswith("updated_at = now();")
