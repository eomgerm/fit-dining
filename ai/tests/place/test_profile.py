import pytest

from fit_ai.place.profile import (
    build_profile,
    count,
    features,
    group_means,
    summary_text,
)


def ev(review_id, code, direction=1, source="naver_text"):
    return {
        "review_id": review_id,
        "source": source,
        "code": code,
        "direction": direction,
    }


def test_count_once_per_review_and_code_across_sources():
    rows = [
        ev("r1", "QUIET", source="naver_keyword"),
        ev("r1", "QUIET"),  # 같은 리뷰의 키워드와 본문은 하나
        ev("r2", "QUIET"),
        ev("r3", "LIVELY", -1),
    ]
    assert count(rows) == {"QUIET": (2, 0), "LIVELY": (0, 1)}


def test_count_skips_a_code_that_conflicts_inside_one_review():
    rows = [
        ev("r1", "SPACIOUS_SEATING", 1),
        ev("r1", "SPACIOUS_SEATING", -1),
        ev("r2", "SPACIOUS_SEATING", -1),
    ]
    assert count(rows) == {"SPACIOUS_SEATING": (0, 1)}


def test_count_menu_evidence_once_and_ignores_rows_without_code():
    rows = [
        ev(None, "FOOD_SPICY", source="menu"),
        ev(None, "FOOD_SPICY", source="menu"),
        ev("r1", None),
    ]
    assert count(rows) == {"FOOD_SPICY": (1, 0)}


def test_group_means_count_missing_codes_as_zero():
    places = {
        "a": ("카페", {"PURPOSE_TALK": 0.3}),
        "b": ("카페", {}),
        "c": ("술집", {"PURPOSE_TALK": 0.1}),
    }
    means = group_means(places)
    assert means["카페"]["PURPOSE_TALK"] == 0.15
    assert means["술집"]["PURPOSE_TALK"] == 0.1


def test_label_needs_three_majority_and_above_group_mean():
    counts = {
        "PURPOSE_TALK": (30, 0),  # 30% > 평균 15.8%
        "PRETTY_SPACE": (10, 0),  # 10% < 평균 29.2%
        "LIVELY": (2, 4),
        "SPACIOUS_SEATING": (3, 3),  # 과반이 아님
    }
    means = {"PURPOSE_TALK": 0.158, "PRETTY_SPACE": 0.292, "SPACIOUS_SEATING": 0.01}
    out = {f["code"]: f for f in features(counts, 100, means)}
    assert out["PURPOSE_TALK"]["is_label"] is True
    assert out["PRETTY_SPACE"]["is_label"] is False
    assert out["LIVELY"]["is_label"] is False
    assert out["SPACIOUS_SEATING"]["is_label"] is False
    assert out["PURPOSE_TALK"] == {
        "code": "PURPOSE_TALK",
        "layer": "purpose",
        "like_count": 30,
        "dislike_count": 0,
        "is_label": True,
    }


def test_label_needs_at_least_three_reviews_even_above_the_mean():
    out = features({"COZY": (2, 0)}, 10, {"COZY": 0.01})
    assert out[0]["is_label"] is False


def test_features_are_ordered_labels_then_base_then_rest_by_ratio_to_mean():
    counts = {
        "VALUE_FOR_MONEY": (20, 0),  # 라벨, 평균의 1.25배
        "GOOD_MUSIC": (48, 0),  # 라벨, 평균의 3배
        "PRETTY_SPACE": (10, 0),  # 기본 조건만, 평균의 0.5배
        "COZY": (3, 0),  # 기본 조건만, 평균의 0.75배
        "PURPOSE_TALK": (1, 0),  # 나머지, 평균의 0.5배
        "QUIET": (2, 0),  # 나머지, 평균의 2배
        "LIVELY": (1, 4),  # 나머지, 평균의 0.5배. 같으면 코드표 순서
    }
    means = {
        "VALUE_FOR_MONEY": 0.16,
        "GOOD_MUSIC": 0.16,
        "PRETTY_SPACE": 0.2,
        "COZY": 0.04,
        "PURPOSE_TALK": 0.02,
        "QUIET": 0.01,
        "LIVELY": 0.02,
    }
    assert [f["code"] for f in features(counts, 100, means)] == [
        "GOOD_MUSIC",
        "VALUE_FOR_MONEY",
        "COZY",
        "PRETTY_SPACE",
        "QUIET",
        "LIVELY",
        "PURPOSE_TALK",
    ]


def test_place_exactly_at_the_group_mean_gets_no_label():
    # 0.04, 0.05, 0.06의 평균은 부동소수점으로 0.049999…가 된다
    rates = {
        p: ("카페", {"COZY": r}) for p, r in [("a", 0.04), ("b", 0.05), ("c", 0.06)]
    }
    means = group_means(rates)["카페"]
    out = features({"COZY": (5, 0)}, 100, means)
    assert out[0]["is_label"] is False


def test_summary_text_uses_representative_menus_first_and_no_price():
    place = {
        "name": "고수닭갈비",
        "group": "식당",
        "category": "닭갈비",
        "station": "강남",
        "subwayStations": [{"stationName": "신논현역"}, {"stationName": "강남역"}],
        "conveniences": ["단체 이용 가능", "무선 인터넷"],
        "menu": {
            "items": [
                {"name": "볶음밥", "representative": False, "price": 3000},
                {"name": "치즈닭갈비", "representative": True, "price": 13900},
            ]
        },
    }
    text = summary_text(place)
    assert (
        text
        == "고수닭갈비. 식당, 닭갈비. 메뉴: 치즈닭갈비, 볶음밥. 시설: 단체 이용 가능, 무선 인터넷. 신논현역 근처."
    )
    assert "13900" not in text


def test_summary_text_leaves_out_the_station_when_the_place_has_none():
    # 가까운 역이 없는 장소는 지하철 항목도 없다(D-16). "None역 근처"가 소개문, 곧 임베딩 입력에 들어가면 안 된다
    place = {
        "name": "이름",
        "group": "식당",
        "category": "닭갈비",
        "station": None,
        "subwayStations": [],
        "conveniences": [],
        "menu": {"items": []},
    }

    assert summary_text(place) == "이름. 식당, 닭갈비."


@pytest.mark.parametrize("station", ["강남", "강남역"])
def test_summary_text_names_the_station_once_when_there_are_no_subway_entries(station):
    place = {
        "name": "이름",
        "group": "식당",
        "category": "닭갈비",
        "station": station,
        "subwayStations": [],
        "conveniences": [],
        "menu": {"items": []},
    }

    assert summary_text(place) == "이름. 식당, 닭갈비. 강남역 근처."


def test_summary_text_strips_prices_written_in_menu_names_and_dedupes_before_cutting():
    names = [
        "아메리카노 2,000원",
        "라떼(3000원)",
        "아메리카노",
        "소주(2,000원할인)",
        "갓김치등갈비찜 1000원할인",
    ] + [f"메뉴{i}" for i in range(10)]
    place = {
        "name": "카페",
        "group": "카페",
        "category": "카페",
        "station": "역삼",
        "conveniences": [],
        "menu": {"items": [{"name": n, "representative": False} for n in names]},
    }
    text = summary_text(place)
    assert "원" not in text.replace("메뉴", "")
    menus = text.split("메뉴: ")[1].split(". ")[0].split(", ")
    assert menus[:4] == ["아메리카노", "라떼", "소주", "갓김치등갈비찜"]
    assert len(menus) == 10


def test_summary_text_falls_back_to_collection_station_without_subway_info():
    # station은 수집 지역(강남·역삼·선릉)이라 가장 가까운 역이 있으면 그 역을 쓴다
    place = {"name": "카페", "group": "카페", "category": "카페", "station": "역삼"}
    assert summary_text(place) == "카페. 카페, 카페. 역삼역 근처."


def test_summary_text_skips_missing_menu_and_facilities():
    place = {
        "name": "카페",
        "group": "카페",
        "category": "카페",
        "station": "역삼",
        "conveniences": [],
        "menu": None,
    }
    assert summary_text(place) == "카페. 카페, 카페. 역삼역 근처."


def test_profile_keeps_analyzed_review_count_for_the_label_denominator():
    # 네이버 리뷰를 저장하지 않아 적재 뒤에는 이 값을 다시 구할 수 없다(profile-storage D-8)
    out = build_profile(
        "1", None, "카페.", [0.1], [], [], [], {}, analyzed_review_count=37
    )
    assert out["analyzed_review_count"] == 37
