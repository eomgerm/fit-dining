import pytest

from fit_ai.match.conditions import CATEGORY_NAMES
from fit_ai.taste.profile import (
    CATEGORIES,
    body_codes,
    body_phrases,
    build_profile,
    compute_features,
    onboarding_rows,
)

T0 = "2026-10-22T10:00:00+09:00"


def review(code, place, created_at=T0, **kw):
    return (
        {"user_id": "u1", "code": code, "direction": 1, "source": "review"}
        | {
            "place_id": place,
            "review_id": f"r-{place}-{created_at}",
            "category": "카페",
            "created_at": created_at,
        }
        | kw
    )


def free_text(code, direction=1, **kw):
    row = {"user_id": "u1", "code": code, "direction": direction, "source": "free_text"}
    return row | {"created_at": T0} | kw


def day(d):
    return f"2026-10-{d:02d}T10:00:00+09:00"


def feat(code, like, weight, category=None):
    layer = {"QUIET": "axis", "LIVELY": "axis"}.get(code)
    if code.startswith("FOOD_"):
        layer = "food"
    layer = layer or ("purpose" if code.startswith("PURPOSE_") else "importance")
    return {
        "code": code,
        "layer": layer,
        "like": like,
        "weight": weight,
        "category": category,
    }


def w(after, revisit=False):
    """뒤에 쓴 리뷰가 `after`건인 근거 하나의 무게(spec 3단계)."""
    return 0.5 ** (after / 10) * (1.5 if revisit else 1)


def strengths(features, category=None):
    """한 업종(None이면 전체)의 {(코드, 좋아함): 세기}."""
    return {
        (f["code"], f["like"]): f["weight"]
        for f in features
        if f["category"] == category
    }


def approx(expected):
    return pytest.approx(expected, abs=1e-3)


def test_onboarding_pole_dislikes_opposite_pole():
    # 온보딩만 한 회원은 지금과 같다. 세기는 1이고 업종별 취향은 없다
    rows = onboarding_rows("u1", ["QUIET", "PURPOSE_WORK"], T0)
    assert compute_features(rows) == [
        feat("QUIET", True, 1),
        feat("LIVELY", False, 1),
        feat("PURPOSE_WORK", True, 1),
    ]


def test_unchosen_tags_are_not_dislikes():
    rows = onboarding_rows("u2", ["PURPOSE_TALK", "VALUE_FOR_MONEY"], T0)
    assert all(f["like"] for f in compute_features(rows))


def test_tag_at_4_places_is_stronger_than_at_1_place_without_cap():
    rows = [review("VALUE_FOR_MONEY", p) for p in "abcd"] + [review("COZY", "e")]
    assert strengths(compute_features(rows)) == {
        ("COZY", True): 1,
        ("VALUE_FOR_MONEY", True): 4,
    }


def test_reviews_at_many_places_add_up_past_old_cap_3():
    # 온보딩 근거는 뒤에 리뷰 4건이 쌓여 w(4)다
    rows = onboarding_rows("u1", ["QUIET"], T0) + [review("QUIET", p) for p in "abcd"]
    assert strengths(compute_features(rows)) == approx(
        {("QUIET", True): w(4) + 4, ("LIVELY", False): w(4) + 4}
    )


def test_old_evidence_weighs_half_after_10_more_reviews():
    rows = [review("VALUE_FOR_MONEY", "a", day(1))]
    rows += [review("COZY", str(d), day(d)) for d in range(2, 12)]
    assert strengths(compute_features(rows))[("VALUE_FOR_MONEY", True)] == 0.5


def test_onboarding_answer_is_older_than_every_review():
    # 온보딩에서 골랐지만 그 뒤 리뷰 10곳에서 한 번도 고르지 않았다
    rows = onboarding_rows("u1", ["VALUE_FOR_MONEY"], T0)
    rows += [review("COZY", str(d), day(d)) for d in range(1, 11)]
    assert strengths(compute_features(rows))[("VALUE_FOR_MONEY", True)] == 0.5


def test_older_review_of_same_place_is_not_counted_as_later_review():
    # 장소 b의 리뷰 2건 중 최신 1건만 뒤에 쓴 리뷰로 센다
    rows = [review("VALUE_FOR_MONEY", "a", day(1))]
    rows += [review("COZY", "b", day(2)), review("COZY", "b", day(3))]
    assert strengths(compute_features(rows))[("VALUE_FOR_MONEY", True)] == approx(w(1))


def test_revisit_review_weighs_more_than_plain_review():
    rows = [review("COZY", "a", revisit_intent=True), review("VALUE_FOR_MONEY", "b")]
    assert strengths(compute_features(rows)) == {
        ("COZY", True): 1.5,
        ("VALUE_FOR_MONEY", True): 1,
    }


def test_same_place_counts_latest_review_only():
    rows = [review("QUIET", "a", f"2026-10-2{d}T10:00:00+09:00") for d in range(5)]
    assert strengths(compute_features(rows)) == {
        ("QUIET", True): 1,
        ("LIVELY", False): 1,
    }


def test_latest_review_is_chosen_by_time_not_string():
    # 11:00 KST가 10:00 KST보다 늦다. 문자열로 비교하면 반대로 고른다.
    rows = [
        review("QUIET", "a", "2026-10-22T10:00:00+09:00"),
        review("LIVELY", "a", "2026-10-22T02:00:00+00:00"),
    ]
    assert strengths(compute_features(rows)) == {
        ("QUIET", False): 1,
        ("LIVELY", True): 1,
    }


def test_opposite_reviews_lower_strength_without_flipping_onboarding_pole():
    rows = onboarding_rows("u1", ["QUIET"], T0) + [review("LIVELY", p) for p in "ab"]
    assert compute_features(rows) == []


def test_opposite_reviews_at_3_places_and_majority_flip_onboarding_pole():
    # 조용 1곳 대 활기 3곳. 반대 평가가 3곳이고 과반이라 활기로 바꾼다(PRD FR-14).
    # 세기는 활기 3 − 온보딩 조용 w(3)이다
    rows = onboarding_rows("u1", ["QUIET"], T0) + [review("LIVELY", p) for p in "abc"]
    assert strengths(compute_features(rows)) == approx(
        {("QUIET", False): 3 - w(3), ("LIVELY", True): 3 - w(3)}
    )


def test_heavy_opposite_reviews_at_2_places_do_not_flip():
    # 방향은 무게가 아니라 장소 수로 정한다. 재방문 리뷰 2곳은 무게가 커도 바꾸지 못한다
    rows = onboarding_rows("u1", ["QUIET"], T0) + [
        review("LIVELY", p, revisit_intent=True) for p in "ab"
    ]
    assert compute_features(rows) == []


def test_opposite_reviews_at_one_place_do_not_flip():
    days = [f"2026-10-2{d}T10:00:00+09:00" for d in range(3)]
    rows = onboarding_rows("u1", ["QUIET"], T0) + [
        review("LIVELY", "a", d) for d in days
    ]
    assert compute_features(rows) == []


def test_opposite_reviews_at_3_places_without_majority_do_not_flip():
    # 조용 4(온보딩, 직접 입력, 리뷰 2곳) 대 활기 3곳. 과반이 아니라 방향을 지킨다
    rows = (
        onboarding_rows("u1", ["QUIET"], T0)
        + [free_text("QUIET")]
        + [review("QUIET", p) for p in "ab"]
        + [review("LIVELY", p) for p in "cde"]
    )
    quiet = 2 * w(5) + 2 - 3
    assert strengths(compute_features(rows)) == approx(
        {("QUIET", True): quiet, ("LIVELY", False): quiet}
    )


def test_opposite_free_text_does_not_count_as_opposite_place():
    # 반대 평가는 서로 다른 장소의 리뷰만 센다. 직접 입력은 장소가 아니다
    rows = (
        onboarding_rows("u1", ["QUIET"], T0)
        + [free_text("LIVELY")]
        + [review("LIVELY", p) for p in "ab"]
    )
    assert compute_features(rows) == []


def test_free_text_opposite_pole_cancels_onboarding_pole():
    rows = onboarding_rows("u1", ["QUIET"], T0) + [free_text("LIVELY")]
    assert compute_features(rows) == []


def test_noise_direction_follows_evidence_without_onboarding_pole():
    assert compute_features([free_text("QUIET")]) == [
        feat("QUIET", True, 1),
        feat("LIVELY", False, 1),
    ]


def test_disliked_food_from_free_text():
    assert compute_features([free_text("FOOD_SPICY", -1)]) == [
        feat("FOOD_SPICY", False, 1)
    ]


def test_importance_and_purpose_never_become_dislikes():
    rows = [free_text("SHORT_WAIT", -1), free_text("PURPOSE_SOLO", -1)]
    assert compute_features(rows) == []


def test_sample_7_reviews_add_to_onboarding():
    rows = onboarding_rows("u1", ["QUIET", "PURPOSE_WORK"], T0)
    rows += [review("QUIET", p) for p in "abcd"] + [review("SHORT_WAIT", "e")]
    assert strengths(compute_features(rows)) == approx(
        {
            ("QUIET", True): w(5) + 4,
            ("LIVELY", False): w(5) + 4,
            ("SHORT_WAIT", True): 1,
            ("PURPOSE_WORK", True): w(5),
        }
    )


def test_category_tastes_keep_noise_of_each_category_apart():
    # 온보딩 조용, 카페 3곳 조용, 술집 3곳 활기. 온보딩 근거는 w(6)이다
    rows = onboarding_rows("u1", ["QUIET"], T0)
    rows += [review("QUIET", p, category="카페") for p in "abc"]
    rows += [review("LIVELY", p, category="술집") for p in "def"]
    features = compute_features(rows)
    # 전체 취향은 서로 지워서 온보딩 몫만 남는다
    overall = {("QUIET", True): w(6), ("LIVELY", False): w(6)}
    assert strengths(features) == approx(overall)
    assert strengths(features, "CAFE") == approx(
        {("QUIET", True): w(6) + 3, ("LIVELY", False): w(6) + 3}
    )
    # 술집 안에서 반대 근거가 3곳이고 과반이라 활기로 바꾼다
    assert strengths(features, "BAR") == approx(
        {("QUIET", False): 3 - w(6), ("LIVELY", True): 3 - w(6)}
    )
    # 식당 리뷰 근거가 없어서 전체 취향을 쓴다
    assert strengths(features, "RESTAURANT") == approx(overall)


def test_category_noise_flips_only_with_3_places_in_that_category():
    # 활기 3곳은 전체로는 방향을 바꾸지만 술집 안에서는 2곳뿐이다
    rows = onboarding_rows("u1", ["QUIET"], T0)
    rows += [review("LIVELY", p, category="술집") for p in "ab"]
    rows += [review("LIVELY", "c", category="카페")]
    features = compute_features(rows)
    assert ("LIVELY", True) in strengths(features)
    assert strengths(features, "BAR") == {}


def test_one_way_tastes_mix_other_category_reviews_at_half():
    rows = [review("VALUE_FOR_MONEY", p, category="식당") for p in "abcd"]
    rows += [review("VALUE_FOR_MONEY", "e", category="카페")]
    features = compute_features(rows)
    assert [
        strengths(features, c)[("VALUE_FOR_MONEY", True)]
        for c in (None, "RESTAURANT", "CAFE", "BAR")
    ] == [5, 4.5, 3, 2.5]


def test_onboarding_counts_fully_in_every_category():
    rows = onboarding_rows("u1", ["PURPOSE_WORK"], T0)
    rows += [review("COZY", "a", category="카페")]
    features = compute_features(rows)
    for category in CATEGORIES.values():
        assert strengths(features, category)[("PURPOSE_WORK", True)] == approx(w(1))


def test_category_codes_are_request_category_codes():
    assert set(CATEGORIES.values()) == set(CATEGORY_NAMES)


@pytest.mark.parametrize("codes", [["FOOD_SPICY"], ["UNKNOWN"], ["QUIET", "LIVELY"]])
def test_onboarding_rejects_extension_unknown_and_both_poles(codes):
    with pytest.raises(ValueError):
        onboarding_rows("u1", codes, T0)


def fake_encode(texts):
    return [[float(len(t))] for t in texts]


def test_profile_free_texts_get_vectors_only_when_liked_with_positive_text():
    rows = onboarding_rows("u4", ["PURPOSE_SOLO"], T0) + [
        free_text(
            None, quote="점심엔 담백한 국물 요리가 좋아요", positive_text="담백한 국물"
        ),
        free_text(None, quote="또 담백한 국물", positive_text="담백한 국물"),
        free_text(None, quote="주차 되는 곳"),
        free_text(None, -1, quote="사람 많은 데 싫어요"),
    ]
    profile = build_profile("u4", rows, original_text="원문", encode=fake_encode)
    assert profile["free_texts"] == [
        {"text": "담백한 국물", "like": True, "vector": [6.0]},
        {"text": "주차 되는 곳", "like": True, "vector": None},
        {"text": "사람 많은 데 싫어요", "like": False, "vector": None},
    ]
    assert profile["evidence"] == rows
    assert profile["features"] == [feat("PURPOSE_SOLO", True, 1)]


def test_profile_header_and_failed_interpretation_keeps_no_sentence():
    # 해석이 실패하면 사용자가 그 자리에서 다시 시도하고, 원문은 저장하지 않는다
    rows = onboarding_rows("u6", ["LIVELY"], T0)
    text = "프로젝트 끝나고 시끌벅적하게 한잔하는 곳"
    profile = build_profile("u6", rows, original_text=text)
    assert profile["schema"] == "taste-profile/v1"
    assert profile["user_id"] == "u6"
    assert profile["original_text"] == text
    assert profile["embedding"] == {
        "model": "dragonkue/snowflake-arctic-embed-l-v2.0-ko",
        "revision": "55ec6e9358a56d56af759bc8372e970caf8c305f",
        "prompt": "query",
    }
    assert profile["free_texts"] == []


def body(code, direction=1, liked=None, kind="taste"):
    return {"code": code, "direction": direction, "liked": liked, "kind": kind}


@pytest.mark.parametrize(
    ("direction", "liked", "expected"),
    [
        (1, 1, 1),  # "칼칼해서 좋았어요": 났고 좋았음 → 좋아함
        (1, -1, -1),  # "너무 매워요": 났고 아쉬움 → 싫어함
        (-1, 1, -1),  # "달지 않아서 좋아요": 안 났고 좋았음 → 싫어함
        (-1, -1, 1),  # "싱거워서 아쉬워요": 안 났고 아쉬움 → 좋아함
    ],
)
def test_body_flavor_direction_is_occurred_times_liked(direction, liked, expected):
    assert body_codes([body("FOOD_SWEET", direction, liked)]) == {
        "FOOD_SWEET": expected
    }


def test_body_flavor_without_liked_is_left_to_the_place_side():
    # "달달한 케이크"처럼 좋고 나쁨이 없는 맛은 사용자 취향에 세지 않는다
    assert body_codes([body("FOOD_SWEET", 1, None)]) == {}


def test_body_codes_follow_reason_tag_rules():
    # 아쉬웠다는 말도 그 특징을 따진다는 근거다. 소음 축만 반대 극이다(리뷰 D-36)
    items = [
        body("SPACIOUS_SEATING", -1),
        body("LIVELY", -1),
        body("PURPOSE_TALK", 1),
        body(None, 1, kind="quality"),  # 코드 없는 항목은 세지 않는다
    ]
    assert body_codes(items) == {"SPACIOUS_SEATING": 1, "QUIET": 1, "PURPOSE_TALK": 1}


def test_body_codes_skip_a_code_with_mixed_directions_in_one_review():
    items = [
        body("FOOD_SPICY", 1, 1),
        body("FOOD_SPICY", 1, -1),
        body("FOOD_SWEET", 1, 1),
    ]
    assert body_codes(items) == {"FOOD_SWEET": 1}


def flavor_review(code, place, direction, created_at=T0):
    return review(code, place, created_at, direction=direction)


def test_flavor_from_free_text_only():
    # 설계 2단계 예: 직접 입력 "매운 거 좋아해요"만 있으면 매운맛 좋아함 1
    assert compute_features([free_text("FOOD_SPICY")]) == [feat("FOOD_SPICY", True, 1)]


def test_flavor_keeps_free_text_direction_with_one_opposite_place():
    # 설계 2단계 예: 위 회원이 본문 "맵게 좋았어요" 2곳, "너무 매웠어요" 1곳 → 좋아함 3 − 싫어함 1.
    # 직접 입력은 리뷰 3곳 뒤라 w(3)이다
    rows = [free_text("FOOD_SPICY")] + [
        flavor_review("FOOD_SPICY", p, d) for p, d in (("a", 1), ("b", 1), ("c", -1))
    ]
    assert strengths(compute_features(rows)) == approx({("FOOD_SPICY", True): w(3) + 1})


def test_flavor_dislike_from_body_without_free_text():
    # 설계 2단계 예: 직접 입력 없이 본문 "달지 않아서 좋아요" 1곳 → 단맛 싫어함 1
    rows = [flavor_review("FOOD_SWEET", "a", -1)]
    assert strengths(compute_features(rows)) == {("FOOD_SWEET", False): 1}


def test_flavor_flips_free_text_with_3_opposite_places_and_majority():
    rows = [free_text("FOOD_SPICY")] + [
        flavor_review("FOOD_SPICY", p, -1) for p in "abc"
    ]
    assert strengths(compute_features(rows)) == approx(
        {("FOOD_SPICY", False): 3 - w(3)}
    )


def unit(*weights):
    """앞쪽 성분만 정한 1024차원 단위 벡터. 같은 방향이면 같은 취향으로 묶인다."""
    v = [0.0] * 1024
    for i, x in enumerate(weights):
        v[i] = x
    norm = sum(x * x for x in v) ** 0.5
    return [x / norm for x in v]


def chip_phrase(text, vector):
    return free_text(None) | {"positive_text": text, "vector": vector}


def review_phrase(text, place, vector, category="카페", created_at=T0, **kw):
    return review(
        None,
        place,
        created_at,
        category=category,
        positive_text=text,
        vector=vector,
        **kw,
    )


def bundle_items(features, category=None):
    return {
        f["text"]: f["weight"]
        for f in features
        if f["code"] is None and f["category"] == category
    }


def test_body_phrases_keep_liked_taste_sentences_outside_visit_context():
    items = [
        {
            "slot": "메뉴 평가",
            "code": None,
            "direction": 1,
            "kind": "taste",
            "text": "크림 파스타 소스가 진했다",
        },
        {
            "slot": "메뉴 평가",
            "code": None,
            "direction": 1,
            "kind": "quality",
            "text": "맛있다",
        },
        {
            "slot": "공간",
            "code": None,
            "direction": -1,
            "kind": "taste",
            "text": "자리가 불편했다",
        },
        {
            "slot": "방문 맥락",
            "code": None,
            "direction": 1,
            "kind": "taste",
            "text": "부모님과 함께 방문했다",
        },
        {
            "slot": "방문 목적",
            "code": "PURPOSE_WORK",
            "direction": 1,
            "kind": "taste",
            "text": None,
        },
    ]
    assert body_phrases(items) == ["크림 파스타 소스가 진했다"]


def test_same_taste_phrases_become_one_bundle_and_add_strength():
    # 설계 4단계 예: "콘센트 많아서 좋았다"와 "노트북 하기 편했다"는 한 묶음이고 세기가 더해진다
    rows = [
        review_phrase("콘센트 많아서 좋았다", "a", unit(1, 0.1)),
        review_phrase("노트북 하기 편했다", "b", unit(1, 0.2)),
        chip_phrase("브런치 먹기 좋은 곳", unit(0, 0, 1)),
    ]
    found = bundle_items(compute_features(rows))
    # 대표는 유사도 합이 같으면 문구 순서로 고른다. 칩은 리뷰 2곳 뒤라 w(2)다
    assert found == approx({"노트북 하기 편했다": 2, "브런치 먹기 좋은 곳": w(2)})


def test_bundle_element_shape():
    [bundle] = [
        f
        for f in compute_features([chip_phrase("창가 자리가 있는 곳", unit(1))])
        if f["code"] is None
    ]
    assert bundle == {
        "code": None,
        "layer": None,
        "like": True,
        "weight": 1,
        "category": None,
        "text": "창가 자리가 있는 곳",
        "vector": [round(x, 6) for x in unit(1)],
    }


def test_other_category_review_phrase_counts_half():
    rows = [review_phrase("국물이 시원했다", "a", unit(1), category="식당")]
    features = compute_features(rows)
    assert bundle_items(features) == {"국물이 시원했다": 1}
    assert bundle_items(features, "RESTAURANT") == {"국물이 시원했다": 1}
    assert bundle_items(features, "CAFE") == {"국물이 시원했다": 0.5}


def test_only_overall_bundles_without_review_phrases():
    features = compute_features([chip_phrase("창가 자리가 있는 곳", unit(1))])
    assert {f["category"] for f in features if f["code"] is None} == {None}


def test_phrases_without_vector_or_dislikes_are_not_materials():
    rows = [
        chip_phrase("창가 자리가 있는 곳", None),
        free_text(None, -1) | {"positive_text": "x", "vector": unit(1)},
    ]
    assert [f for f in compute_features(rows) if f["code"] is None] == []


def test_more_than_three_bundles_draw_three_the_same_way_for_same_evidence():
    rows = [
        review_phrase(f"취향 {i}", f"p{i}", unit(*([0] * i + [1]))) for i in range(5)
    ]
    first = bundle_items(compute_features(rows))
    again = bundle_items(compute_features([dict(r) for r in reversed(rows)]))
    assert len(first) == 3
    assert first == again
