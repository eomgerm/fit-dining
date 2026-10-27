"""카드 조건 목록이 공유 코드표(`fit_ai.features`)에서 제대로 만들어지는지 확인한다."""

from fit_ai.features import FEATURES
from fit_ai.match.conditions import CARD_LABELS, CONDITIONS, Layer


def test_codes_and_layers_from_shared_table() -> None:
    """카드조건_시설을뺀조건은_공유코드표의온보딩코드와층을순서대로쓴다"""
    cards = [
        (c.id, c.layer) for c in CONDITIONS.values() if c.layer is not Layer.FACILITY
    ]
    shared = [(f.code, f.layer) for f in FEATURES.values() if f.onboarding]

    assert cards == shared


def test_card_labels_only_for_onboarding_codes() -> None:
    """카드문구_공유코드표에없거나온보딩이아닌코드의문구는_남아있지않다"""
    onboarding = {f.code for f in FEATURES.values() if f.onboarding}

    assert set(CARD_LABELS) == onboarding


def test_facilities_after_shared_codes() -> None:
    """카드조건_시설4개는_공유코드표코드뒤에온다"""
    assert list(CONDITIONS)[-4:] == ["PARKING", "WIFI", "GROUP", "RESERVATION"]
    assert CONDITIONS["PARKING"].label == "주차할 수 있어요"
    assert CONDITIONS["QUIET"].label == "조용해요"
