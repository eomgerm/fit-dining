from fit_ai.place import clean

CSV = {
    "places.csv": """naver_place_id,name,category_name,category_group_name,station_name
1,카페 A,카페,카페,강남
2,한식 B,한식,식당,역삼
""",
    "place_category_codes.csv": """naver_place_id,position,category_code,is_category_path
1,2,220052,true
1,1,220036,true
1,3,1004760,false
""",
    "place_facilities.csv": """naver_place_id,facility_label,in_conveniences
1,무선 인터넷,true
1,주차,false
""",
    "place_transit.csv": """naver_place_id,kind,position,stop_name
1,SUBWAY,2,역삼역
1,BUS,1,강남역 정류장
1,SUBWAY,1,강남역
""",
    "menu_items.csv": """naver_place_id,position,name,description,is_representative
1,2,라떼,,false
1,1,아메리카노,진한,true
""",
    "external_reviews.csv": """naver_place_id,review_id,body
1,r1,좋아요
1,r2,
""",
    "external_review_keywords.csv": """naver_place_id,review_id,position,keyword
1,r1,2,뷰가 좋아요
1,r1,1,대화하기 좋아요
""",
}


def test_places_reads_clean_csv_into_collected_place_shape(tmp_path):
    for name, text in CSV.items():
        (tmp_path / name).write_text(text, encoding="utf-8")

    cafe, korean = clean.places(tmp_path)

    assert cafe == {
        "place_id": "1",
        "name": "카페 A",
        "group": "카페",
        "category": "카페",
        "categoryCodeList": ["220036", "220052"],
        "station": "강남",
        "conveniences": ["무선 인터넷"],
        "subwayStations": [{"stationName": "강남역"}, {"stationName": "역삼역"}],
        "menu": {
            "items": [
                {"name": "아메리카노", "description": "진한", "representative": True},
                {"name": "라떼", "description": None, "representative": False},
            ]
        },
        "visitorReviews": [
            {
                "review_id": "r1",
                "body": "좋아요",
                "voted_keywords": ["대화하기 좋아요", "뷰가 좋아요"],
            },
            {"review_id": "r2", "body": None, "voted_keywords": []},
        ],
    }
    assert korean["categoryCodeList"] == []
    assert korean["menu"] == {"items": []}
    assert korean["visitorReviews"] == []
