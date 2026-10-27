"""카드 조건 목록이 공유 코드표(`fit_ai.features`)와 맞는지 확인한다."""

from fit_ai.features import FEATURES
from fit_ai.match.conditions import CONDITIONS, Layer


def test_same_codes_as_shared_table() -> None:
    """카드조건_시설을뺀코드는_공유코드표의온보딩코드와같고층도같다"""
    cards = {
        c.id: c.layer for c in CONDITIONS.values() if c.layer is not Layer.FACILITY
    }
    shared = {f.code: f.layer for f in FEATURES.values() if f.onboarding}

    assert cards == shared
