import pytest

from fit_ai.taste.profile import build_profile, compute_features, onboarding_rows

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


def feat(code, like, weight):
    layer = {"QUIET": "axis", "LIVELY": "axis", "FOOD_SPICY": "food"}.get(code)
    layer = layer or ("purpose" if code.startswith("PURPOSE_") else "importance")
    return {"code": code, "layer": layer, "like": like, "weight": weight}


def test_onboarding_pole_dislikes_opposite_pole():
    rows = onboarding_rows("u1", ["QUIET", "PURPOSE_WORK"], T0)
    assert compute_features(rows) == [
        feat("QUIET", True, 1),
        feat("LIVELY", False, 1),
        feat("PURPOSE_WORK", True, 1),
    ]


def test_unchosen_tags_are_not_dislikes():
    rows = onboarding_rows("u2", ["PURPOSE_TALK", "VALUE_FOR_MONEY"], T0)
    assert all(f["like"] for f in compute_features(rows))


def test_reviews_at_many_places_cap_weight_at_3():
    rows = onboarding_rows("u1", ["QUIET"], T0) + [review("QUIET", p) for p in "abcd"]
    assert compute_features(rows) == [feat("QUIET", True, 3), feat("LIVELY", False, 3)]


def test_same_place_counts_latest_review_only():
    rows = [review("QUIET", "a", f"2026-10-2{d}T10:00:00+09:00") for d in range(5)]
    assert compute_features(rows) == [feat("QUIET", True, 1), feat("LIVELY", False, 1)]


def test_latest_review_is_chosen_by_time_not_string():
    # 11:00 KST가 10:00 KST보다 늦다. 문자열로 비교하면 반대로 고른다.
    rows = [
        review("QUIET", "a", "2026-10-22T10:00:00+09:00"),
        review("LIVELY", "a", "2026-10-22T02:00:00+00:00"),
    ]
    assert compute_features(rows) == [feat("QUIET", False, 1), feat("LIVELY", True, 1)]


def test_opposite_reviews_lower_strength_without_flipping_onboarding_pole():
    rows = onboarding_rows("u1", ["QUIET"], T0) + [review("LIVELY", p) for p in "ab"]
    assert compute_features(rows) == []


def test_opposite_reviews_at_3_places_and_majority_flip_onboarding_pole():
    # 조용 1 − 활기 3 = −2. 반대 평가가 3곳이고 과반이라 활기로 바꾼다(PRD FR-14)
    rows = onboarding_rows("u1", ["QUIET"], T0) + [review("LIVELY", p) for p in "abc"]
    assert compute_features(rows) == [feat("QUIET", False, 2), feat("LIVELY", True, 2)]


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
    assert compute_features(rows) == [feat("QUIET", True, 1), feat("LIVELY", False, 1)]


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
    assert compute_features(rows) == [
        feat("QUIET", True, 3),
        feat("LIVELY", False, 3),
        feat("SHORT_WAIT", True, 1),
        feat("PURPOSE_WORK", True, 1),
    ]


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
    assert profile["schema"] == "taste-profile/v0"
    assert profile["user_id"] == "u6"
    assert profile["original_text"] == text
    assert profile["embedding"] == {
        "model": "dragonkue/snowflake-arctic-embed-l-v2.0-ko",
        "revision": "55ec6e9358a56d56af759bc8372e970caf8c305f",
        "prompt": "query",
    }
    assert profile["free_texts"] == []
