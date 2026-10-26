from fit_ai.features import FEATURES
from fit_ai.place.rules import (
    FOOD_BY_CODE,
    KEYWORD_CODES,
    food_type,
    keyword_evidence,
    spicy_menu,
)


def test_food_type_uses_second_category_code():
    assert food_type(["220036", "220037", "220075"]) == "FOOD_KOREAN"
    assert food_type(["220036", "220038"]) == "FOOD_JAPANESE"
    assert food_type(["220036", "220041"]) == "FOOD_ASIAN"


def test_food_type_is_none_for_cafe_bar_buffet_and_unknown():
    for second in ("220052", "220051", "220046", "999999"):
        assert food_type(["220036", second]) is None
    assert food_type(["220036"]) is None


def test_tables_only_use_codes_from_the_code_table():
    assert set(FOOD_BY_CODE.values()) <= set(FEATURES)
    assert set(KEYWORD_CODES.values()) <= set(FEATURES)


def test_keyword_evidence_gives_one_row_per_code_and_skips_unmapped():
    review = {
        "review_id": "r1",
        "voted_keywords": [
            "매장이 넓어요",
            "좌석이 편해요",
            "음식이 맛있어요",
            "혼술하기 좋아요",
        ],
    }
    rows = keyword_evidence(review)
    assert sorted(r["code"] for r in rows) == ["PURPOSE_SOLO", "SPACIOUS_SEATING"]
    assert all(r["direction"] == 1 and r["source"] == "naver_keyword" for r in rows)
    assert all(r["review_id"] == "r1" and r["slot"] is None for r in rows)


def test_spicy_menu_reads_name_and_description_but_not_bare_mara():
    assert spicy_menu([{"name": "고구마라떼", "description": None}]) is None
    assert (
        spicy_menu([{"name": "치즈닭갈비", "description": "매콤한 치즈 닭갈비"}])
        == "치즈닭갈비"
    )
    assert spicy_menu([{"name": "마라탕", "description": None}]) == "마라탕"
    assert spicy_menu([]) is None
