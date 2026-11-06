import pytest

from fit_ai.place import from_crawl


def test_category_group_is_decided_by_the_second_code_not_the_first():
    # 실제 샘플로 확인: 음식점/카페/술집 모두 첫 코드는 "220036"이고, 둘째 코드가 종류를 가른다
    assert from_crawl.category_group(["220036", "220039"]) == (
        "RESTAURANT",
        "음식점",
    )  # 양꼬치(중식)
    assert from_crawl.category_group(["220036", "220052"]) == (
        "CAFE",
        "카페",
    )  # 퍼스트커피랩 강남점
    assert from_crawl.category_group(["220036", "220051"]) == (
        "BAR",
        "술집",
    )  # 복태포차, 조선 팰리스 라운지&바


def test_category_group_falls_back_to_restaurant_for_any_other_second_code():
    # 이 크롤러는 음식점/카페/술집만 수집하므로, 카페·술집이 아니면 음식점이다(뷔페 등 food_type 없는 곳 포함)
    assert from_crawl.category_group(["220036", "220046"]) == ("RESTAURANT", "음식점")


def test_category_group_is_unknown_without_a_second_code():
    assert from_crawl.category_group(["220036"]) == (None, None)
    assert from_crawl.category_group([]) == (None, None)
    assert from_crawl.category_group(None) == (None, None)


def test_place_row_maps_base_fields_and_splits_district_and_dong():
    base = {
        "name": "니호우양꼬치양갈비 논현본점",
        "category": "양꼬치",
        "categoryCode": "230767",
        "categoryCodeList": ["220036", "220039"],
        "roadAddress": "서울 강남구 강남대로124길 3-6 2층",
        "address": "서울 강남구 논현동 143-16",
    }
    row = from_crawl.place_row("2042795310", base, "서울 강남구 논현동", {}, [])

    assert row == {
        "naver_place_id": "2042795310",
        "name": "니호우양꼬치양갈비 논현본점",
        "category_group_code": "RESTAURANT",
        "category_group_name": "음식점",
        "category_name": "양꼬치",
        "category_code": "230767",
        "lat": None,
        "lng": None,
        "road_address": "서울 강남구 강남대로124길 3-6 2층",
        "jibun_address": "서울 강남구 논현동 143-16",
        "full_address": None,
        "district_name": "강남구",
        "dong_name": "논현동",
        "station_code": None,
        "station_name": None,
        "directions_text": None,
        "place_description": None,
        "primary_phone": None,
        "homepage_url": None,
        "naver_booking_url": None,
        "representative_photo_url": None,
        "menu_updated_on": None,
    }


def test_place_row_handles_a_missing_common_address():
    row = from_crawl.place_row("1", {"categoryCodeList": []}, None, {}, [])
    assert (row["district_name"], row["dong_name"]) == (None, None)


def test_place_row_fills_contact_links_and_photo_from_sibling_fields():
    # 실제 샘플(37792495)로 확인: 좌표는 base.coordinate(x=lng, y=lat), 전화는 virtualPhone(안심번호),
    # 길 안내는 base.road, 홈페이지는 homepages.repr(부가 링크는 place_links로 따로), 예약 링크는
    # naverBooking.naverBookingUrl, 대표 사진은 topPhotos 첫 장, 메뉴 갱신일은 placeMenus.updatedAt
    # (두 자리 연도, "26.04.16" 모양).
    base = {
        "categoryCodeList": [],
        "coordinate": {"x": "127.02", "y": "37.5"},
        "virtualPhone": "0507-1-2",
        "road": "2호선 강남역 11번 출구에서 150m",
    }
    pd = {
        "description": "소개 문구",
        "homepages": {"repr": {"url": "http://a.kr"}, "etc": []},
        "naverBooking": {"naverBookingUrl": "https://m.booking.naver.com/booking/6/1"},
        "placeMenus": {"updatedAt": "26.08.03"},
    }
    photo_items = [
        {"originalUrl": "https://img/1.jpg"},
        {"originalUrl": "https://img/2.jpg"},
    ]

    row = from_crawl.place_row("1", base, None, pd, photo_items)

    assert (row["lat"], row["lng"]) == (37.5, 127.02)
    assert row["primary_phone"] == "0507-1-2"
    assert row["directions_text"] == "2호선 강남역 11번 출구에서 150m"
    assert row["place_description"] == "소개 문구"
    assert row["homepage_url"] == "http://a.kr"
    assert row["naver_booking_url"] == "https://m.booking.naver.com/booking/6/1"
    assert row["representative_photo_url"] == "https://img/1.jpg"
    assert row["menu_updated_on"] == "2026-08-03"


def test_place_row_falls_back_to_the_owner_phone_when_there_is_no_virtual_phone():
    row = from_crawl.place_row(
        "1", {"categoryCodeList": [], "phone": "02-123-4567"}, None, {}, []
    )
    assert row["primary_phone"] == "02-123-4567"


def test_place_row_without_a_coordinate_or_representative_photo_leaves_them_none():
    row = from_crawl.place_row("1", {"categoryCodeList": []}, None, {}, [])
    assert (row["lat"], row["lng"], row["representative_photo_url"]) == (
        None,
        None,
        None,
    )


def subway(station_id, walk, name="역", line="2", display=None):
    """subwayStations 한 항목. station은 extract가 미리 풀어 둔 모양이다."""
    station = {
        "name": name,
        "displayName": display or f"{name}역",
        "walkingDistance": walk,
    }
    if station_id is not None:
        station["id"] = station_id
    return {"name": line, "station": station}


def station_of(subways, **base):
    row = from_crawl.place_row(
        "1", {"categoryCodeList": [], **base}, None, {}, [], subways
    )
    return row["station_code"], row["station_name"]


def test_place_row_station_is_the_subway_station_with_the_shortest_walking_distance():
    # places.station은 장소에서 가장 가까운 역이다(profile-storage D-16). 네이버가 알려 주는 목록의 순서가 아니라 걷는 거리로 고른다
    subways = [subway(221, 300, "역삼"), subway(222, 150, "강남")]

    assert station_of(subways) == ("GANGNAM", "강남역")


@pytest.mark.parametrize(
    ("station_id", "code"),
    [
        (222, "GANGNAM"),
        (1910, "GANGNAM"),  # 신분당선의 강남역은 ID가 따로다
        (1515, "SEOLLEUNG"),
        (925, "SINNONHYEON"),
        (929, "BONGEUNSA"),
        (30119, "DAEJEON_WORLDCUP_STADIUM"),
        (40810, "GUMI"),
        (70119, "SEOMYEON"),  # 1호선과 2호선의 서면역은 ID가 다르고 코드는 하나다
        (70219, "SEOMYEON"),
    ],
)
def test_place_row_station_code_comes_from_the_naver_station_id(station_id, code):
    assert station_of([subway(station_id, 100)])[0] == code


def test_place_row_station_keeps_the_naver_order_when_the_walking_distances_tie():
    subways = [subway(221, 200, "역삼"), subway(222, 200, "강남")]

    assert station_of(subways)[0] == "YEOKSAM"


def test_place_row_station_puts_a_station_without_a_walking_distance_last():
    assert (
        station_of([subway(221, None, "역삼"), subway(222, 500, "강남")])[0]
        == "GANGNAM"
    )
    assert (
        station_of([subway(221, None, "역삼"), subway(222, None, "강남")])[0]
        == "YEOKSAM"
    )


def test_place_row_station_is_null_when_the_nearest_station_has_no_code():
    # 가장 가까운 역이 코드 없는 역이면 두 번째로 가까운 역으로 넘어가지 않는다. 그 역이 가장 가까운 역이 아니기 때문이다
    subways = [subway(999999, 100, "판교"), subway(222, 400, "강남")]

    assert station_of(subways) == (None, None)


def test_place_row_station_is_null_when_the_nearest_station_has_no_id():
    assert station_of([subway(None, 100, "강남")]) == (None, None)


def test_place_row_station_is_null_without_subway_entries_even_with_a_coordinate():
    # 예전에는 좌표로 강남·역삼·선릉 중 가장 가까운 역을 골랐다. 네이버가 가까운 역을 알려 주지 않는 장소는 NULL이다(D-16)
    near_gangnam = {"coordinate": {"x": "127.0280", "y": "37.4985"}}

    assert station_of([], **near_gangnam) == (None, None)
    assert station_of(None, **near_gangnam) == (None, None)


def test_yy_mm_dd_handles_both_with_and_without_a_trailing_period():
    # 실제 샘플: 메뉴 갱신일은 점이 없고("26.04.16") 방송 출연일은 점이 붙는다("13.05.11.")
    assert from_crawl._yy_mm_dd("26.04.16") == "2026-04-16"
    assert from_crawl._yy_mm_dd("13.05.11.") == "2013-05-11"
    assert from_crawl._yy_mm_dd(None) is None


def test_payment_rows_one_label_per_entry():
    assert from_crawl.payment_rows("1", ["지역화폐", "제로페이"]) == [
        {"naver_place_id": "1", "payment_label": "지역화폐"},
        {"naver_place_id": "1", "payment_label": "제로페이"},
    ]


def test_payment_rows_without_payment_info_is_empty():
    assert from_crawl.payment_rows("1", None) == []


def test_link_rows_keep_order_and_dead_flag_as_is():
    # homepages.etc의 부가 링크(홈페이지 외 SNS/블로그 등). 대표 링크(homepages.repr)는 place_row 몫이다
    etc = [
        {"order": 2, "url": "http://insta", "isDeadUrl": False},
        {"order": 1, "url": "http://dead", "isDeadUrl": True},
    ]
    assert from_crawl.link_rows("1", etc) == [
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
    ]


def test_link_rows_without_extra_links_is_empty():
    assert from_crawl.link_rows("1", None) == []


def test_keyword_rows_keep_naver_order_as_position():
    assert from_crawl.keyword_rows("1", ["강남카페", "디저트"]) == [
        {"naver_place_id": "1", "position": "1", "keyword": "강남카페"},
        {"naver_place_id": "1", "position": "2", "keyword": "디저트"},
    ]


def test_keyword_rows_without_a_keyword_list_is_empty():
    assert from_crawl.keyword_rows("1", None) == []


def test_parking_rows_combine_description_and_the_free_flag():
    parking_info = {"description": "건물 주차장", "basicParking": {"isFree": False}}
    assert from_crawl.parking_rows("1", parking_info) == [
        {
            "naver_place_id": "1",
            "description": "건물 주차장",
            "basic_parking_is_free": "false",
        },
    ]


def test_parking_rows_without_basic_parking_leaves_the_flag_empty():
    assert from_crawl.parking_rows(
        "1", {"description": "노상 무료", "basicParking": None}
    ) == [
        {
            "naver_place_id": "1",
            "description": "노상 무료",
            "basic_parking_is_free": None,
        },
    ]


def test_parking_rows_without_parking_info_is_empty():
    assert from_crawl.parking_rows("1", None) == []


def test_policy_rows_combine_pet_and_corkage_info_into_one_row():
    pet = {"isAllowed": True, "description": None}
    corkage = {
        "isAvailable": False,
        "description": None,
        "statusDescription": "외부 주류 반입 불가",
    }
    assert from_crawl.policy_rows("1", pet, corkage) == [
        {
            "naver_place_id": "1",
            "pet_allowed": "true",
            "pet_description": None,
            "corkage_available": "false",
            "corkage_description": None,
            "corkage_status_description": "외부 주류 반입 불가",
        }
    ]


def test_policy_rows_with_only_pet_leaves_corkage_fields_empty():
    assert from_crawl.policy_rows(
        "1", {"isAllowed": True, "description": "환영"}, None
    ) == [
        {
            "naver_place_id": "1",
            "pet_allowed": "true",
            "pet_description": "환영",
            "corkage_available": None,
            "corkage_description": None,
            "corkage_status_description": None,
        }
    ]


def test_policy_rows_without_pet_or_corkage_is_empty():
    assert from_crawl.policy_rows("1", None, None) == []


def test_transit_rows_bus_stations_map_name_code_and_walk():
    bus = [
        {
            "name": "강남역",
            "displayCode": "22173",
            "walkTime": 2,
            "walkingDistance": 150,
        }
    ]
    assert from_crawl.transit_rows("1", [], bus) == [
        {
            "naver_place_id": "1",
            "kind": "BUS",
            "position": "1",
            "stop_name": "강남역",
            "line_name": None,
            "exit_number": None,
            "stop_code": "22173",
            "walk_minutes": 2,
            "walk_meters": 150,
        },
    ]


def test_transit_rows_subway_stations_map_line_station_and_exit():
    subway = [
        {
            "name": "신분당",
            "station": {
                "name": "강남",
                "nearestExit": "10",
                "walkTime": 3,
                "walkingDistance": 200,
            },
        }
    ]
    assert from_crawl.transit_rows("1", subway, []) == [
        {
            "naver_place_id": "1",
            "kind": "SUBWAY",
            "position": "1",
            "stop_name": "강남",
            "line_name": "신분당",
            "exit_number": "10",
            "stop_code": None,
            "walk_minutes": 3,
            "walk_meters": 200,
        },
    ]


def test_transit_rows_number_bus_and_subway_positions_independently():
    subway = [
        {
            "name": "2",
            "station": {
                "name": "역삼",
                "nearestExit": "3",
                "walkTime": 9,
                "walkingDistance": 700,
            },
        },
        {
            "name": "신분당",
            "station": {
                "name": "강남",
                "nearestExit": "10",
                "walkTime": 3,
                "walkingDistance": 200,
            },
        },
    ]
    bus = [{"name": "a", "displayCode": "1", "walkTime": 1, "walkingDistance": 10}]
    rows = from_crawl.transit_rows("1", subway, bus)
    assert [r["kind"] for r in rows] == ["SUBWAY", "SUBWAY", "BUS"]
    assert [r["position"] for r in rows] == ["1", "2", "1"]


def test_transit_rows_without_stations_is_empty():
    assert from_crawl.transit_rows("1", [], []) == []
    assert from_crawl.transit_rows("1", None, None) == []


def test_seat_rows_keep_naver_order_as_position():
    seats = [
        {"name": "단체석", "description": "최소 4명"},
        {"name": "창가", "description": None},
    ]
    assert from_crawl.seat_rows("1", seats) == [
        {
            "naver_place_id": "1",
            "position": "1",
            "seat_name": "단체석",
            "description": "최소 4명",
        },
        {
            "naver_place_id": "1",
            "position": "2",
            "seat_name": "창가",
            "description": None,
        },
    ]


def test_seat_rows_without_seats_is_empty():
    assert from_crawl.seat_rows("1", None) == []


def test_broadcast_rows_parse_the_two_digit_year_date():
    broadcasts = [
        {
            "channel": "KBS2",
            "program": "생생정보",
            "episode": "100",
            "date": "15.06.29.",
            "menu": None,
        }
    ]
    assert from_crawl.broadcast_rows("1", broadcasts) == [
        {
            "naver_place_id": "1",
            "position": "1",
            "channel": "KBS2",
            "program": "생생정보",
            "episode": "100",
            "aired_on": "2015-06-29",
            "menu": None,
        },
    ]


def test_broadcast_rows_without_broadcasts_is_empty():
    assert from_crawl.broadcast_rows("1", None) == []


def review_item(review_id, body, keywords=()):
    # 실제 방문자 리뷰의 id는 review_id와 다른 값이다. 리뷰를 가리키는 값은 reviewId다
    return {
        "id": f"apollo-{review_id}",
        "reviewId": review_id,
        "body": body,
        "votedKeywords": [
            {"code": f"code{i}", "iconUrl": "u", "name": k}
            for i, k in enumerate(keywords)
        ],
    }


def test_review_rows_use_the_review_id_and_keep_every_review_even_without_a_body():
    # 본문이 빈 리뷰도 키워드 근거와 리뷰 수(n_reviews)에 들어가므로 버리지 않는다
    items = [review_item("r1", "좋아요\n또 올게요"), review_item("r2", "")]

    reviews, _ = from_crawl.review_rows("1", items)

    assert reviews == [
        {"naver_place_id": "1", "review_id": "r1", "body": "좋아요\n또 올게요"},
        {"naver_place_id": "1", "review_id": "r2", "body": ""},
    ]


def test_review_rows_keywords_are_the_voted_keyword_names_in_naver_order():
    items = [
        review_item("r1", "좋아요", ["대화하기 좋아요", "뷰가 좋아요"]),
        review_item("r2", "굿", ["아늑해요"]),
    ]

    _, keywords = from_crawl.review_rows("1", items)

    assert keywords == [
        {
            "naver_place_id": "1",
            "review_id": "r1",
            "position": "1",
            "keyword": "대화하기 좋아요",
        },
        {
            "naver_place_id": "1",
            "review_id": "r1",
            "position": "2",
            "keyword": "뷰가 좋아요",
        },
        {
            "naver_place_id": "1",
            "review_id": "r2",
            "position": "1",
            "keyword": "아늑해요",
        },
    ]


def test_review_rows_without_reviews_or_voted_keywords_have_no_keyword_rows():
    assert from_crawl.review_rows("1", []) == ([], [])

    reviews, keywords = from_crawl.review_rows(
        "1", [{"reviewId": "r1", "body": "좋아요"}]
    )

    assert len(reviews) == 1
    assert keywords == []


def test_category_rows_keep_naver_order_as_position():
    rows = from_crawl.category_rows("1", ["220036", "220039", "230767"])
    assert rows == [
        {
            "naver_place_id": "1",
            "position": "1",
            "category_code": "220036",
            "is_category_path": "true",
        },
        {
            "naver_place_id": "1",
            "position": "2",
            "category_code": "220039",
            "is_category_path": "true",
        },
        {
            "naver_place_id": "1",
            "position": "3",
            "category_code": "230767",
            "is_category_path": "true",
        },
    ]


def test_category_rows_of_an_empty_list_is_empty():
    assert from_crawl.category_rows("1", None) == []


def test_facility_rows_pass_conveniences_through_as_labels():
    # 시설은 전부 base.conveniences에서 오므로 in_conveniences는 항상 true다. 장소 분석(clean.places)이
    # 이 열로 "원본 conveniences"를 가려내 읽는다
    rows = from_crawl.facility_rows("1", ["단체 이용 가능", "포장"])
    assert rows == [
        {
            "naver_place_id": "1",
            "facility_label": "단체 이용 가능",
            "in_conveniences": "true",
        },
        {"naver_place_id": "1", "facility_label": "포장", "in_conveniences": "true"},
    ]


def working_day(
    day, start=None, end=None, description=None, breaks=None, last_orders=None
):
    return {
        "day": day,
        "businessHours": {"start": start, "end": end} if start else None,
        "description": description,
        "breakHours": breaks or [],
        "lastOrderTimes": last_orders or [],
    }


def test_hour_rows_of_a_single_schedule_place_is_the_default_service_type():
    schedules = [{"name": "", "businessHours": [working_day("화", "13:00", "01:00")]}]
    hours, breaks, orders = from_crawl.hour_rows("1", schedules, year=2026)

    assert hours == [
        {
            "naver_place_id": "1",
            "service_type": "DEFAULT",
            "day_of_week": "TUE",
            "label_date": None,
            "is_closed": "false",
            "open_time": "13:00",
            "close_time": "01:00",
        }
    ]
    assert breaks == [] and orders == []


def test_hour_rows_a_date_can_be_embedded_in_the_day_field_itself():
    # 실제 샘플: 요일마다 돌아가며 보이는 집("화(11/3)", "수(11/4)", ...) -- 날짜가 description이 아니라
    # day 글자 자체에 붙어 온다
    schedules = [
        {"name": "매장", "businessHours": [working_day("화(11/3)", "06:30", "22:00")]}
    ]
    hours, _, _ = from_crawl.hour_rows("1", schedules, year=2026)

    assert hours[0]["day_of_week"] == "TUE"
    assert hours[0]["label_date"] == "2026-11-03"
    assert hours[0]["open_time"] == "06:30" and hours[0]["close_time"] == "22:00"


def test_hour_rows_a_rest_day_with_no_date_is_closed_with_no_label_date():
    schedules = [
        {
            "name": "기본",
            "businessHours": [working_day("화", description="정기휴무 (매주 화요일)")],
        }
    ]
    hours, _, _ = from_crawl.hour_rows("1", schedules, year=2026)

    assert hours[0]["is_closed"] == "true"
    assert hours[0]["open_time"] is None and hours[0]["close_time"] is None
    assert hours[0]["label_date"] is None


def test_hour_rows_a_description_with_a_date_becomes_a_label_date():
    schedules = [
        {
            "name": "기본",
            "businessHours": [
                working_day("금", "11:00", "15:30", description="금(10/23) 휴무")
            ],
        }
    ]
    hours, _, _ = from_crawl.hour_rows("1", schedules, year=2026)

    assert hours[0]["label_date"] == "2026-10-23"


def test_hour_rows_collects_breaks_and_last_orders_in_order():
    schedules = [
        {
            "name": "",
            "businessHours": [
                working_day(
                    "월",
                    "10:00",
                    "22:00",
                    breaks=[
                        {"start": "15:00", "end": "16:00"},
                        {"start": "20:00", "end": "20:30"},
                    ],
                    last_orders=[{"time": "21:00"}],
                )
            ],
        }
    ]
    _, breaks, orders = from_crawl.hour_rows("1", schedules, year=2026)

    assert breaks == [
        {
            "naver_place_id": "1",
            "service_type": "DEFAULT",
            "day_of_week": "MON",
            "break_seq": "1",
            "break_start": "15:00",
            "break_end": "16:00",
        },
        {
            "naver_place_id": "1",
            "service_type": "DEFAULT",
            "day_of_week": "MON",
            "break_seq": "2",
            "break_start": "20:00",
            "break_end": "20:30",
        },
    ]
    assert orders == [
        {
            "naver_place_id": "1",
            "service_type": "DEFAULT",
            "day_of_week": "MON",
            "seq": "1",
            "last_order_time": "21:00",
        },
    ]


def test_hour_rows_a_daily_day_expands_to_all_seven_days():
    # 실제 샘플(24시간 연중무휴 장소): 하루하루 대신 day="매일" 한 줄로 온다
    schedules = [
        {
            "name": "",
            "businessHours": [
                working_day(
                    "매일",
                    "00:00",
                    "24:00",
                    breaks=[{"start": "09:00", "end": "10:00"}],
                )
            ],
        }
    ]
    hours, breaks, _ = from_crawl.hour_rows("1", schedules, year=2026)

    assert [h["day_of_week"] for h in hours] == [
        "MON",
        "TUE",
        "WED",
        "THU",
        "FRI",
        "SAT",
        "SUN",
    ]
    assert all(h["open_time"] == "00:00" and h["close_time"] == "24:00" for h in hours)
    assert [b["day_of_week"] for b in breaks] == [
        "MON",
        "TUE",
        "WED",
        "THU",
        "FRI",
        "SAT",
        "SUN",
    ]
    assert all(b["break_start"] == "09:00" for b in breaks)


def test_hour_rows_of_several_schedules_maps_known_names_to_service_types():
    schedules = [
        {"name": "매장", "businessHours": [working_day("월", "09:00", "20:00")]},
        {"name": "배달", "businessHours": [working_day("월", "10:00", "22:00")]},
    ]
    hours, _, _ = from_crawl.hour_rows("1", schedules, year=2026)

    assert [h["service_type"] for h in hours] == ["DINE_IN", "DELIVERS"]


def menu_item(
    item_id,
    name,
    price_type=None,
    display=None,
    badges=None,
    labels=None,
    images=None,
    description=None,
):
    return {
        "name": name,
        "description": description,
        "badges": badges or [],
        "labels": labels or [],
        "images": images or [],
        "price": {"priceType": price_type, "displayText": display}
        if price_type
        else {},
    }


def test_menu_rows_keep_naver_order_and_parse_a_fixed_price():
    place_menus = {"items": [{"__ref": "PlaceMenuItem:a"}], "categories": []}
    items_by_id = {
        "a": menu_item(
            "a",
            "왕양꼬치(250g)",
            "fixed",
            "18,000원",
            badges=["repr"],
            description="일단 이거 안 시키면 후회",
        )
    }
    items, labels, images = from_crawl.menu_rows("1", place_menus, items_by_id)

    assert items == [
        {
            "naver_place_id": "1",
            "menu_item_id": "a",
            "position": "1",
            "name": "왕양꼬치(250g)",
            "description": "일단 이거 안 시키면 후회",
            "price_type": "FIXED",
            "price": 18000,
            "price_text": "18,000원",
            "is_representative": "true",
            "category_name": None,
        }
    ]
    assert labels == [] and images == []


def test_menu_rows_a_range_price_keeps_the_text_but_no_numeric_price():
    place_menus = {"items": [{"__ref": "PlaceMenuItem:b"}], "categories": []}
    items_by_id = {"b": menu_item("b", "라떼", "range", "5,000~6,000원")}
    items, _, _ = from_crawl.menu_rows("1", place_menus, items_by_id)

    assert (items[0]["price_type"], items[0]["price"], items[0]["price_text"]) == (
        "RANGE",
        None,
        "5,000~6,000원",
    )


def test_menu_rows_category_comes_from_a_normal_category_not_the_recommend_one():
    place_menus = {
        "items": [{"__ref": "PlaceMenuItem:a"}],
        "categories": [
            {"kind": "recommend", "name": "추천 메뉴", "itemIds": ["a"]},
            {"kind": "normal", "name": "대표 메뉴", "itemIds": ["a"]},
        ],
    }
    items_by_id = {"a": menu_item("a", "양꼬치")}
    items, _, _ = from_crawl.menu_rows("1", place_menus, items_by_id)

    assert items[0]["category_name"] == "대표 메뉴"


def test_menu_rows_labels_and_images_are_separate_ordered_rows():
    place_menus = {"items": [{"__ref": "PlaceMenuItem:a"}], "categories": []}
    items_by_id = {
        "a": menu_item(
            "a", "세트", labels=["사전예약"], images=[{"url": "u1"}, {"url": "u2"}]
        )
    }
    _, labels, images = from_crawl.menu_rows("1", place_menus, items_by_id)

    assert labels == [
        {
            "naver_place_id": "1",
            "menu_item_id": "a",
            "position": "1",
            "label": "사전예약",
        }
    ]
    assert images == [
        {"naver_place_id": "1", "menu_item_id": "a", "position": "1", "url": "u1"},
        {"naver_place_id": "1", "menu_item_id": "a", "position": "2", "url": "u2"},
    ]


def test_photo_rows_skip_a_photo_without_an_original_url_and_keep_counting():
    # 하남산단 장소 19867625의 업체 사진 하나는 originalUrl이 없다. 주소 없는 사진은 보여 줄 수 없고,
    # place_photos.url이 NOT NULL이라 그대로 두면 적재 SQL 전체가 취소된다. 건너뛰고 번호는 이어 센다
    items = [
        {"mediaSource": "business", "originalUrl": "b1"},
        {"mediaSource": "business", "originalUrl": None},
        {"mediaSource": "business", "originalUrl": ""},
        {"mediaSource": "business", "originalUrl": "b3"},
    ]

    rows = from_crawl.photo_rows("1", items)

    assert [(r["position"], r["original_url"]) for r in rows] == [
        ("1", "b1"),
        ("2", "b3"),
    ]


def test_photo_rows_keep_only_business_and_menu_board_with_per_source_positions():
    items = [
        {"mediaSource": "business", "originalUrl": "b1"},
        {"mediaSource": "clip", "originalUrl": "c1"},
        {"mediaSource": "business", "originalUrl": "b2"},
        {"mediaSource": "visitor", "originalUrl": "v1"},
        {"mediaSource": "menuBoard", "originalUrl": "m1"},
    ]
    rows = from_crawl.photo_rows("1", items)

    assert rows == [
        {
            "naver_place_id": "1",
            "photo_kind": "BUSINESS",
            "media_source": "business",
            "position": "1",
            "original_url": "b1",
        },
        {
            "naver_place_id": "1",
            "photo_kind": "BUSINESS",
            "media_source": "business",
            "position": "2",
            "original_url": "b2",
        },
        {
            "naver_place_id": "1",
            "photo_kind": "MENU_BOARD",
            "media_source": "menuBoard",
            "position": "1",
            "original_url": "m1",
        },
    ]


def test_extract_picks_the_station_after_resolving_the_subway_station_refs():
    # subwayStations[i].station은 ref다. 풀지 않으면 ID도 걷는 거리도 없어서 가까운 역을 못 고른다
    def state(station):
        return {
            "PlaceDetailBase:1": {"name": "가게", "categoryCodeList": []},
            "SubwayStationInfo:1": station,
            "ROOT_QUERY": {
                'placeDetail({"id":"1"})': {
                    "base": {"__ref": "PlaceDetailBase:1"},
                    "subwayStations": [
                        {"name": "2", "station": {"__ref": "SubwayStationInfo:1"}}
                    ],
                }
            },
        }

    coded = from_crawl.extract(
        state(
            {"id": 222, "name": "강남", "displayName": "강남역", "walkingDistance": 120}
        ),
        "1",
        None,
        2026,
    )
    uncoded = from_crawl.extract(
        state(
            {
                "id": 999999,
                "name": "판교",
                "displayName": "판교역",
                "walkingDistance": 90,
            }
        ),
        "1",
        None,
        2026,
    )

    assert (coded["place"]["station_code"], coded["place"]["station_name"]) == (
        "GANGNAM",
        "강남역",
    )
    assert coded["station_without_code"] is None
    assert (uncoded["place"]["station_code"], uncoded["place"]["station_name"]) == (
        None,
        None,
    )
    # 코드 없는 역은 적재 때 조용히 묻히지 않게 이름을 알려 준다(export가 보고서에 센다)
    assert uncoded["station_without_code"] == "판교역"


def test_extract_resolves_apollo_refs_end_to_end():
    state = {
        "PlaceDetailBase:1": {
            "name": "슬로우커피",
            "category": "카페",
            "categoryCode": "221275",
            "categoryCodeList": ["220052"],
            "roadAddress": "서울 강남구 1",
            "address": "서울 강남구 역삼동 1",
            "conveniences": ["무선 인터넷"],
            "paymentInfo": ["지역화폐"],
        },
        "PlaceMenuItem:a": {
            "name": "아메리카노",
            "price": {"priceType": "fixed", "displayText": "4,500원"},
        },
        "PlaceDetailTopPhotoItem:1_business_1": {
            "mediaSource": "business",
            "originalUrl": "b1",
        },
        "SubwayStationInfo:1": {
            "name": "강남",
            "nearestExit": "10",
            "walkTime": 3,
            "walkingDistance": 200,
        },
        "BusStation:1": {
            "name": "강남역",
            "displayCode": "22173",
            "walkTime": 2,
            "walkingDistance": 150,
        },
        "RestaurantSeatItems:1": {"name": "단체석", "description": None},
        "ROOT_QUERY": {
            'placeDetail({"id":"1"})': {
                "base": {"__ref": "PlaceDetailBase:1"},
                "newBusinessHours": [
                    {"name": "", "businessHours": [working_day("월", "10:00", "20:00")]}
                ],
                "placeMenus": {
                    "items": [{"__ref": "PlaceMenuItem:a"}],
                    "categories": [],
                },
                "topPhotos": {
                    "items": [{"__ref": "PlaceDetailTopPhotoItem:1_business_1"}]
                },
                "homepages": {
                    "repr": {"url": "http://a.kr"},
                    "etc": [{"order": 1, "url": "http://insta", "isDeadUrl": False}],
                },
                "naverBooking": {"naverBookingUrl": "https://booking/1"},
                "informationTab": {
                    "keywordList": ["강남카페"],
                    "pet": None,
                    "parkingInfo": None,
                },
                "restaurantInfoTabDetails": {
                    "seat": [{"__ref": "RestaurantSeatItems:1"}],
                    "alcoholCorkage": None,
                },
                "subwayStations": [
                    {"name": "신분당", "station": {"__ref": "SubwayStationInfo:1"}}
                ],
                "busStations": [{"__ref": "BusStation:1"}],
                "broadcastInfos": None,
            }
        },
    }

    out = from_crawl.extract(state, "1", "서울 강남구 역삼동", year=2026)

    assert out["place"]["name"] == "슬로우커피"
    assert out["place"]["homepage_url"] == "http://a.kr"
    assert out["place"]["naver_booking_url"] == "https://booking/1"
    assert out["place"]["representative_photo_url"] == "b1"
    assert out["categories"] == [
        {
            "naver_place_id": "1",
            "position": "1",
            "category_code": "220052",
            "is_category_path": "true",
        }
    ]
    assert out["facilities"] == [
        {
            "naver_place_id": "1",
            "facility_label": "무선 인터넷",
            "in_conveniences": "true",
        }
    ]
    assert out["hours"][0]["open_time"] == "10:00"
    assert out["menu_items"][0]["name"] == "아메리카노"
    assert out["photos"] == [
        {
            "naver_place_id": "1",
            "photo_kind": "BUSINESS",
            "media_source": "business",
            "position": "1",
            "original_url": "b1",
        }
    ]
    assert out["payments"] == [{"naver_place_id": "1", "payment_label": "지역화폐"}]
    assert out["links"] == [
        {
            "naver_place_id": "1",
            "link_order": "1",
            "url": "http://insta",
            "is_dead_url": "false",
        }
    ]
    assert out["keywords"] == [
        {"naver_place_id": "1", "position": "1", "keyword": "강남카페"}
    ]
    assert out["parking"] == []
    assert out["policies"] == []
    # busStations의 각 원소도 subwayStations[i].station과 마찬가지로 ref다(실제 샘플 37792495로 확인:
    # BusStation:106227). 처음엔 놓쳐서 place_transit.csv의 BUS 행이 전부 빈 칸으로 나갔었다.
    assert out["transit"] == [
        {
            "naver_place_id": "1",
            "kind": "SUBWAY",
            "position": "1",
            "stop_name": "강남",
            "line_name": "신분당",
            "exit_number": "10",
            "stop_code": None,
            "walk_minutes": 3,
            "walk_meters": 200,
        },
        {
            "naver_place_id": "1",
            "kind": "BUS",
            "position": "1",
            "stop_name": "강남역",
            "line_name": None,
            "exit_number": None,
            "stop_code": "22173",
            "walk_minutes": 2,
            "walk_meters": 150,
        },
    ]
    # restaurantInfoTabDetails.seat의 각 원소도 ref다(실제 샘플 1185221694로 확인: RestaurantSeatItems:310)
    assert out["seats"] == [
        {
            "naver_place_id": "1",
            "position": "1",
            "seat_name": "단체석",
            "description": None,
        }
    ]
    assert out["broadcasts"] == []
