from fit_ai.features import FEATURES, FLAVORS


def test_code_table_has_onboarding_and_extension_codes():
    # 2단계에서 맛 코드 8개를 더해 23 → 31개다
    assert len(FEATURES) == 31
    assert sum(f.onboarding for f in FEATURES.values()) == 14


def test_flavors_are_nine_food_codes_in_the_table():
    assert len(FLAVORS) == 9
    assert all(FEATURES[c].layer == "food" for c in FLAVORS)


def test_noise_poles_point_to_each_other():
    assert FEATURES["QUIET"].opposite == "LIVELY"
    assert FEATURES["LIVELY"].opposite == "QUIET"
    assert [f.code for f in FEATURES.values() if f.opposite] == ["QUIET", "LIVELY"]


def test_layer_and_prefix_match():
    for code, f in FEATURES.items():
        assert f.code == code
        assert code.startswith("PURPOSE_") == (f.layer == "purpose")
        assert code.startswith("FOOD_") == (f.layer == "food")
    assert not any(f.onboarding for f in FEATURES.values() if f.layer == "food")
