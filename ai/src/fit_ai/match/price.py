"""가게 가격. 메뉴 가격이 여럿인 가게를 가격 하나로 요청 금액과 견주려고 정한다.

대표 메뉴 중 리뷰에 많이 나온 메뉴의 가격이다(2026-11-02 결정, 2026-11-03 고침). 네이버
리뷰가 언급한 메뉴와 횟수(정제 CSV `place_review_menus.csv`)를 대표 메뉴와 맞추고, 언급
횟수로 가중한 가격 중앙값을 쓴다. 대표 메뉴가 없으면 전체 메뉴에서 맞춘다. 맞춘 메뉴가
없으면 그 메뉴들 가격의 중앙값이다. 전체 메뉴 중앙값은 작은 요리·사이드가 많으면 내려가고,
대표 메뉴 중앙값은 여럿이 먹는 비싼 메뉴로 치우쳐서 리뷰 메뉴로 고른다. 메뉴판 전체에서
맞추면 계란찜·볶음밥 같은 사이드가 가격을 정해서 대표 메뉴 안에서만 맞춘다. 원본 식당
125곳 중 대표 메뉴 중앙값보다 40% 넘게 낮은 곳이 37곳에서 14곳으로 줄었다(맞추는 법은
`store_price`).

적재 때 장소마다 한 번 계산해 뷰 `ai_place_search`의 `price`로 읽는다고 가정한다. 리뷰
메뉴는 장소 카탈로그 테이블에 넣지 않으므로(place-catalog D-4) 장소 분석 적재가 이 함수로
계산한 숫자만 넣는다. 개발 DB(`scripts/dev_db.py`)는 리뷰 메뉴 없이 메뉴판으로만 계산한다.
"""

import re
import statistics
from collections.abc import Sequence
from dataclasses import dataclass

_BRACKETS = re.compile(r"\([^)]*\)|\[[^\]]*\]|\{[^}]*\}|<[^>]*>")
"""메뉴 이름의 괄호 부분("(연유라떼)", "[대표]")"""

_AMOUNT = re.compile(
    r"\d[\d.,+~/-]*\s*(?:kg|g|ml|인분|인|개|조각|마리|잔|병|호)?", re.IGNORECASE
)
"""메뉴 이름의 숫자와 단위("150g", "2-3인", "1++")"""

_TRAILING_LATIN = re.compile(r"(?<=[가-힣])[A-Za-z]+$")
"""한글 이름 뒤에 붙은 영문("아메리카노ICE"의 "ICE")"""

_DISH_WORDS = (
    "구이",
    "전골",
    "찜",
    "탕",
    "정식",
    "세트",
    "모둠",
    "모듬",
    "주물럭",
    "로스",
    "반마리",
    "한마리",
    "마리",
    "조각",
    "사시미",
    "전",
    "튀김",
    "볶음",
    "덮밥",
    "솥밥",
    "샤브샤브",
    "샤브",
)
"""리뷰 메뉴 바로 뒤에 와도 그 메뉴로 보는 말. 요리 방식과 양이다("곱창" → "곱창전골",
"북경오리" → "북경오리 반마리"). 원본에서 리뷰 메뉴 뒤에 자주 붙는 말로 골랐다(2026-11-03)."""


@dataclass(frozen=True)
class MenuPrice:
    """메뉴판의 메뉴 하나.

    Attributes:
        name: 메뉴 이름
        price: 정가(원). 가격이 없거나 정가가 아니면(변동, 범위) None이다.
        representative: 업체가 고른 대표 메뉴인지
    """

    name: str
    price: int | None
    representative: bool = False


def store_price(
    menus: Sequence[MenuPrice], review_menus: Sequence[tuple[str, int]] = ()
) -> int | None:
    """가게 가격을 정한다.

    리뷰 메뉴는 메뉴 이름(`_head`)이 그 말로 끝나거나, 그 말 바로 뒤에 요리 방식·양을 뜻하는
    말(`_DISH_WORDS`)이 오면 그 메뉴로 본다. 한국어 메뉴 이름은 뒤가 본체라서 "고기"는 "고기듬뿍
    김치찌개"와 맞지 않고, "꽃살"은 "[대표] 프라임 꽃살 150g"과, "곱창"은 "한우곱창모둠
    소금구이"와 맞는다. 메뉴 여럿에 맞으면 언급 횟수를 그 메뉴들에 똑같이 나눈다.

    Args:
        menus: 메뉴판
        review_menus: 리뷰가 언급한 메뉴와 언급 횟수

    Returns:
        가게 가격(원). 가격이 있는 메뉴가 없으면 None이다.
    """
    priced = [m for m in menus if m.price is not None and m.price > 0]
    pool = [m for m in priced if m.representative] or priced
    if not pool:
        return None
    heads = [_head(m.name) for m in pool]
    weights = [0.0] * len(pool)
    for label, count in review_menus:
        key = _head(label)
        hits = [i for i, head in enumerate(heads) if key and _matches(key, head)]
        for i in hits if count > 0 else ():
            weights[i] += count / len(hits)
    prices = [m.price or 0 for m in pool]
    if any(weights):
        return _weighted_median(prices, weights)
    return round(statistics.median(prices))


def _weighted_median(prices: Sequence[int], weights: Sequence[float]) -> int:
    """무게를 더해 절반에 처음 닿는 가격. 무게가 0인 가격은 건너뛴다."""
    half = sum(weights) / 2
    total = 0.0
    for price, weight in sorted(zip(prices, weights, strict=True)):
        total += weight
        if weight and total >= half:
            return price
    raise ValueError("무게가 모두 0이다")


def _matches(label: str, head: str) -> bool:
    """메뉴 이름이 리뷰 메뉴로 끝나거나 리뷰 메뉴 바로 뒤에 요리 방식·양을 뜻하는 말이 오는지"""
    return head.endswith(label) or any(label + word in head for word in _DISH_WORDS)


def _head(text: str) -> str:
    """맞추기에 쓰는 이름. 괄호 부분, 숫자와 단위, 한글·영문이 아닌 글자를 지우고 한글
    뒤에 붙은 영문을 뗀다."""
    text = _AMOUNT.sub("", _BRACKETS.sub("", text))
    return _TRAILING_LATIN.sub("", re.sub(r"[^가-힣A-Za-z]", "", text))
