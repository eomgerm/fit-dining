"""카드 조건 목록이 공유 코드표(`fit_ai.features`)에서 제대로 만들어지는지 확인한다."""

import pytest

from fit_ai.features import FEATURES
from fit_ai.match.conditions import CARD_LABELS, CONDITIONS, Layer, standard_sido


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


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("대전", "대전"),
        ("대전광역시", "대전"),
        ("대구 광역시", "대구"),
        ("경상북도", "경북"),
        # 광주광역시와 전라남도는 2026-07-01부터 주소가 "전남광주"로 시작한다
        ("광주", "전남광주"),
        ("전라남도", "전남광주"),
        # 표에 없는 이름은 그대로 둔다
        ("평양", "평양"),
    ],
)
def test_standard_sido(name: str, expected: str) -> None:
    """시도이름_다른이름이면_주소첫낱말꼴로바꾼다"""
    assert standard_sido(name) == expected
