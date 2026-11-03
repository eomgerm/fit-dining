"""가게 가격을 확인한다. 대표 메뉴(없으면 전체 메뉴) 중 리뷰 메뉴로 가중한 가격이다."""

from fit_ai.match.price import MenuPrice, store_price

# 북경오리를 먹으러 가는 중식당. 군만두·공기밥은 대표 메뉴가 아니다.
MENUS = [
    MenuPrice("북경오리 반마리", 39000, representative=True),
    MenuPrice("짜장면", 8000, representative=True),
    MenuPrice("깐풍기", 25000, representative=True),
    MenuPrice("군만두", 7000),
    MenuPrice("공기밥", 1000),
    MenuPrice("시가", None),
]


def test_review_weighted_in_representative() -> None:
    """가게가격_리뷰메뉴가대표메뉴와맞으면_언급횟수로가중한중앙값이다"""
    reviews = [("북경오리", 30), ("짜장면", 10), ("탕수육", 50)]

    # 메뉴판에 없는 탕수육은 버리고 북경오리 30, 짜장면 10으로 가중한다.
    assert store_price(MENUS, reviews) == 39000


def test_side_menu_ignored() -> None:
    """가게가격_대표메뉴가아닌사이드가많이언급돼도_대표메뉴안에서만가중한다"""
    reviews = [("군만두", 100), ("공기밥", 80), ("짜장면", 10)]

    assert store_price(MENUS, reviews) == 8000


def test_match_by_menu_name_ending() -> None:
    """가게가격_메뉴이름이리뷰메뉴로끝나거나바로뒤가요리방식이면_그메뉴로본다"""
    menus = [
        MenuPrice("고기듬뿍 김치찌개", 9000),
        MenuPrice("[대표] 프라임 꽃살 150g", 29000),
        MenuPrice("양념 막창1인분)", 16000),
        MenuPrice("한우곱창모둠 소금구이", 23000),
    ]

    # "고기"는 김치찌개와 맞지 않는다. 괄호와 숫자·단위를 떼고 끝을 본다.
    assert store_price(menus, [("고기", 1000), ("꽃살", 10)]) == 29000
    assert store_price(menus, [("고기", 1000), ("막창", 10)]) == 16000
    # "곱창" 바로 뒤에 "모둠"이 오면 맞는다.
    assert store_price(menus, [("고기", 1000), ("곱창", 10)]) == 23000


def test_review_label_split_between_menus() -> None:
    """가게가격_리뷰메뉴가여러메뉴에맞으면_언급횟수를똑같이나눈다"""
    menus = [
        MenuPrice("카페라떼", 4500),
        MenuPrice("돌체라떼 (연유라떼)", 5500),
        MenuPrice("바닐라빈라떼 ICE", 6000),
        MenuPrice("바스크 치즈케이크", 7500),
    ]

    # "라떼" 9를 세 메뉴에 3씩 나누면 치즈케이크 4가 가장 무겁고 중앙값은 6,000원이다.
    assert store_price(menus, [("라떼", 9), ("치즈케이크", 4)]) == 6000


def test_median_when_no_review_match() -> None:
    """가게가격_맞춘리뷰메뉴가없으면_대표메뉴가격의중앙값이다"""
    assert store_price(MENUS, [("탕수육", 50)]) == 25000


def test_all_menus_when_no_representative() -> None:
    """가게가격_대표메뉴가없으면_전체메뉴에서맞추고중앙값을낸다"""
    menus = [MenuPrice("아메리카노", 4500), MenuPrice("라떼", 5000), MenuPrice("빵", 0)]

    # 0원과 가격 없는 메뉴는 뺀다.
    assert store_price(menus) == 4750
    assert store_price(menus, [("아메리카노", 3)]) == 4500


def test_unknown_without_prices() -> None:
    """가게가격_가격이있는메뉴가없으면_모름이다"""
    assert store_price([MenuPrice("오마카세", None)], [("오마카세", 10)]) is None
    assert store_price([]) is None
