import csv
import importlib.util
from pathlib import Path

import pytest

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


CHILD_CSV = {
    "place_hours.csv": """naver_place_id,service_type,day_of_week,label_date,is_closed,open_time,close_time
1,DEFAULT,MON,,false,17:00,02:00
1,DEFAULT,TUE,,true,,
1,DEFAULT,FRI,2026-10-23,true,,
1,DEFAULT,SAT,,false,11:00,24:00
2,DELIVERS,WED,,false,10:00,20:00
2,DINE_IN,WED,2026-10-21,false,07:00,22:00
""",
    "place_hours_breaks.csv": """naver_place_id,service_type,day_of_week,break_seq,break_start,break_end
1,DEFAULT,MON,2,20:00,20:30
1,DEFAULT,MON,1,18:00,18:30
2,DELIVERS,WED,1,15:00,16:00
""",
    "place_hours_last_orders.csv": """naver_place_id,service_type,day_of_week,seq,last_order_time
1,DEFAULT,MON,1,01:00
2,DINE_IN,WED,1,21:00
""",
    "place_photos.csv": """naver_place_id,photo_kind,media_source,position,original_url
1,REPRESENTATIVE,,1,rep
1,BUSINESS,business,3,b3
1,BUSINESS,pai,2,pai
1,BUSINESS,business,1,b1
1,VISITOR,aiView,4,visitor
1,MENU_BOARD,,1,m1
""",
    "menu_items.csv": """naver_place_id,menu_item_id,position,name,description,price_type,price,price_text,is_representative,category_name
1,mb,2,라떼,,RANGE,,"5,000~6,000원",false,커피
1,ma,1,아메리카노,진한,FIXED,4500,"4,500원",true,
""",
    "menu_item_images.csv": """naver_place_id,menu_item_id,position,url
1,ma,2,u2
1,ma,1,u1
""",
    "menu_item_labels.csv": """naver_place_id,menu_item_id,position,label
1,mb,1,사전예약
""",
    "place_transit.csv": """naver_place_id,kind,position,stop_name,line_name,exit_number,stop_code,walk_minutes,walk_meters
1,BUS,1,강남역,,,22173,2,150
1,SUBWAY,2,역삼,2,3,,9,700
1,SUBWAY,1,강남,신분당,10,,3,200
""",
    "place_seat_types.csv": """naver_place_id,position,seat_name,description
1,1,단체석,최소 4명
""",
    "place_broadcasts.csv": """naver_place_id,position,channel,program,episode,aired_on,menu
1,1,KBS2,생생정보,100,2015-06-29,
""",
}


def test_child_rows_follow_place_catalog_rules(tmp_path):
    for name, text in CHILD_CSV.items():
        (tmp_path / name).write_text(text, encoding="utf-8")

    rows = load_places.child_rows(tmp_path)

    def hour(pid, day, open, close, closed=False, breaks="[]", last_orders=()):
        return {
            "naver_place_id": pid,
            "day_of_week": day,
            "open_time": open,
            "close_time": close,
            "closed": closed,
            "breaks": breaks,
            "last_orders": list(last_orders),
        }

    # 기본 시간표가 없으면 매장 시간표만, 날짜가 붙은 휴무는 정보 없음, 24:00은 00:00(D-10, D-24)
    assert rows["place_hours"] == [
        hour(
            "1",
            "MON",
            "17:00",
            "02:00",
            breaks='[{"start": "18:00", "end": "18:30"}, {"start": "20:00", "end": "20:30"}]',
            last_orders=["01:00"],
        ),
        hour("1", "TUE", None, None, closed=True),
        hour("1", "FRI", None, None),
        hour("1", "SAT", "11:00", "00:00"),
        hour("2", "WED", "07:00", "22:00", last_orders=["21:00"]),
    ]
    photos = sorted(rows["place_photos"], key=lambda r: (r["source"], r["sort_order"]))
    assert photos == [
        {"naver_place_id": "1", "source": "business", "sort_order": 0, "url": "b1"},
        {"naver_place_id": "1", "source": "business", "sort_order": 1, "url": "b3"},
        {"naver_place_id": "1", "source": "menuBoard", "sort_order": 0, "url": "m1"},
    ]
    assert rows["place_menus"] == [
        {
            "naver_place_id": "1",
            "sort_order": 0,
            "category": None,
            "name": "아메리카노",
            "description": "진한",
            "price": 4500,
            "price_text": "4,500원",
            "price_type": "FIXED",
            "representative": True,
            "labels": [],
            "photo_urls": ["u1", "u2"],
        },
        {
            "naver_place_id": "1",
            "sort_order": 1,
            "category": "커피",
            "name": "라떼",
            "description": None,
            "price": None,
            "price_text": "5,000~6,000원",
            "price_type": "RANGE",
            "representative": False,
            "labels": ["사전예약"],
            "photo_urls": [],
        },
    ]
    assert [r["station"] for r in rows["place_subways"]] == ["강남", "역삼"]
    assert rows["place_subways"][0] == {
        "naver_place_id": "1",
        "station": "강남",
        "line": "신분당",
        "exit": "10",
        "walk_minutes": 3,
        "walk_meters": 200,
    }
    assert rows["place_bus_stops"] == [
        {
            "naver_place_id": "1",
            "name": "강남역",
            "code": "22173",
            "walk_minutes": 2,
            "walk_meters": 150,
        }
    ]
    assert rows["place_seats"] == [
        {"naver_place_id": "1", "name": "단체석", "description": "최소 4명"}
    ]
    assert rows["place_broadcasts"] == [
        {
            "naver_place_id": "1",
            "channel": "KBS2",
            "program": "생생정보",
            "episode": "100",
            "aired_on": "2015-06-29",
            "menu": None,
        }
    ]


def test_load_sql_upserts_places_then_replaces_their_children():
    place = {
        "naver_place_id": "1",
        "name": "할매's",
        "food_type": None,
        "parking_free": True,
        "lat": 37.5,
        "keywords": ['a"b', "c'd"],
        "facilities": [],
    }
    hours = {"naver_place_id": "1", "day_of_week": "MON", "breaks": "[]", "sort": 0}
    tables = {"place_hours": [hours], "place_seats": []}
    sql = load_places.load_sql([place], tables)

    assert sql.startswith("BEGIN;\n") and sql.rstrip().endswith("COMMIT;")
    assert (
        "VALUES\n('1', '할매''s', NULL, true, 37.5, '{\"a\\\"b\",\"c''d\"}', '{}')"
        in sql
    )
    assert "ON CONFLICT (naver_place_id) DO UPDATE SET name = EXCLUDED.name," in sql
    assert "naver_place_id = EXCLUDED" not in sql
    assert "updated_at = now();" in sql
    # 장소 행은 지우지 않아 place_id가 그대로다. 자식 행만 지우고 다시 넣는다(D-15)
    assert "DELETE FROM places" not in sql
    for table in ("place_hours", "place_seats"):
        assert (
            f"DELETE FROM {table} WHERE place_id IN "
            "(SELECT place_id FROM places WHERE naver_place_id IN ('1'));" in sql
        )
    assert (
        "INSERT INTO place_hours (place_id, day_of_week, breaks, sort) VALUES\n"
        "((SELECT place_id FROM places WHERE naver_place_id = '1'), 'MON', '[]', 0);"
        in sql
    )
    assert "INSERT INTO place_seats" not in sql


def test_profile_rows_keep_personas_with_three_reviews_and_drop_evidence():
    persona = {
        "persona_id": "p1",
        "name": "조용한 손님",
        "description": "설명",
        "reason": "이유",
        "like": True,
        "review_ids": ["r1", "r2", "r3"],
        "vector": [0.5, -0.25],
    }
    feature = {
        "code": "QUIET",
        "layer": "axis",
        "like_count": 3,
        "dislike_count": 0,
        "is_label": True,
    }
    profile = {
        "schema": "place-profile/v0",
        "place_id": 1,
        "food_type": None,
        "analyzed_review_count": 12,
        "embedding": {"model": "m"},
        "summary": {"text": "카페 A. 카페.", "vector": [0.1, 0.2]},
        "features": [feature],
        "personas": [
            persona,
            persona | {"persona_id": "p2", "like": False, "review_ids": ["r1", "r2"]},
        ],
        "evidence": [{"review_id": "r1", "quote": "원문"}],
    }

    tables = load_places.profile_rows([profile])

    assert tables == {
        "place_profiles": [
            {
                "naver_place_id": "1",
                "summary_text": "카페 A. 카페.",
                "summary_vector": "[0.1,0.2]",
                "features": '[{"code": "QUIET", "layer": "axis", "like_count": 3, '
                '"dislike_count": 0, "is_label": true}]',
                "analyzed_review_count": 12,
            }
        ],
        # 근거 3개 미만(p2)은 넣지 않고, review_ids는 앱 리뷰용이라 비워 둔다(profile-storage D-7)
        "place_personas": [
            {
                "naver_place_id": "1",
                "persona_id": "p1",
                "name": "조용한 손님",
                "description": "설명",
                "reason": "이유",
                "liked": True,
                "vector": "[0.5,-0.25]",
            }
        ],
    }


def test_profile_rows_rejects_other_schema():
    with pytest.raises(ValueError, match="place-profile/v1"):
        load_places.profile_rows([{"schema": "place-profile/v1", "place_id": 1}])


def test_load_sql_replaces_scoped_tables_only_for_given_places():
    places = [{"naver_place_id": "1"}, {"naver_place_id": "2"}]
    profile = {"naver_place_id": "2", "summary_text": "요약"}
    tables = {"place_seats": [], "place_profiles": [profile]}

    sql = load_places.load_sql(places, tables, {"place_profiles": ["2"]})

    # 분석 결과는 파일에 있는 장소만 바꾼다. 빠진 장소(분석 실패)는 이전 결과가 남는다
    assert (
        "DELETE FROM place_profiles WHERE place_id IN "
        "(SELECT place_id FROM places WHERE naver_place_id IN ('2'));" in sql
    )
    assert (
        "DELETE FROM place_seats WHERE place_id IN "
        "(SELECT place_id FROM places WHERE naver_place_id IN ('1', '2'));" in sql
    )
