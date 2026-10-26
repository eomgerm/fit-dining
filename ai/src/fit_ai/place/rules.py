"""장소 정보와 키워드에서 규칙으로 뽑는 근거(spec 1단계). LLM은 쓰지 않는다."""

import re

from fit_ai.place.profile import Evidence

# 네이버 업종 코드 목록의 두 번째 코드 → 음식 종류. 네이버 분류를 그대로 따른다(PRD FR-01).
# 카페(220052), 술집(220051), 뷔페(220046)와 처음 보는 코드는 음식 종류가 없다
FOOD_BY_CODE = {
    "220037": "FOOD_KOREAN",
    "220048": "FOOD_KOREAN",  # 분식은 한식의 하위 분류(39 spec)
    "220038": "FOOD_JAPANESE",
    "220039": "FOOD_CHINESE",
    "220044": "FOOD_WESTERN",
    "220041": "FOOD_ASIAN",
    "220042": "FOOD_ASIAN",
}

# 네이버 키워드 → 코드. 맛·친절 같은 범용 품질과 뜻이 분명하지 않은 키워드는 넣지 않는다
KEYWORD_CODES = {
    "차분한 분위기예요": "QUIET",
    "매장이 넓어요": "SPACIOUS_SEATING",
    "좌석이 편해요": "SPACIOUS_SEATING",
    "양이 많아요": "GENEROUS_PORTION",
    "인테리어가 멋져요": "PRETTY_SPACE",
    "뷰가 좋아요": "VIEW_OUTDOOR",
    "야외공간이 멋져요": "VIEW_OUTDOOR",
    "아늑해요": "COZY",
    "가성비가 좋아요": "VALUE_FOR_MONEY",
    "비싼 만큼 가치있어요": "VALUE_FOR_MONEY",
    "컨셉이 독특해요": "UNIQUE_CONCEPT",
    "음식이 빨리 나와요": "FAST_SERVING",
    "음악이 좋아요": "GOOD_MUSIC",
    "대화하기 좋아요": "PURPOSE_TALK",
    "혼밥하기 좋아요": "PURPOSE_SOLO",
    "혼술하기 좋아요": "PURPOSE_SOLO",
    "특별한 날 가기 좋아요": "PURPOSE_DATE",
    "단체모임 하기 좋아요": "PURPOSE_GROUP",
    "집중하기 좋아요": "PURPOSE_WORK",
}

# '마라'만 쓰면 '고구마라떼'에도 걸려서 붙여 쓴다(임시)
_SPICY = re.compile("매운|매콤|얼큰|불닭|땡초|마라탕|마라샹궈|마라룽샤")


def food_type(category_codes: list[str]) -> str | None:
    return FOOD_BY_CODE.get(category_codes[1]) if len(category_codes) > 1 else None


def keyword_evidence(review: dict) -> list[Evidence]:
    """같은 코드의 키워드 두 개에 투표해도 근거는 하나다. 키워드는 좋은 말만 있다."""
    rows: dict[str, Evidence] = {}
    for kw in review.get("voted_keywords") or []:
        code = KEYWORD_CODES.get(kw)
        if code and code not in rows:
            rows[code] = Evidence(
                review_id=review["review_id"],
                source="naver_keyword",
                code=code,
                direction=1,
                slot=None,
                quote=kw,
                text=None,
            )
    return list(rows.values())


def spicy_menu(items: list[dict]) -> str | None:
    """매운 메뉴가 하나라도 있으면 그 이름. 메뉴 근거는 장소당 1개만 쓴다."""
    for m in items:
        if _SPICY.search(f"{m.get('name') or ''} {m.get('description') or ''}"):
            return m["name"]
    return None
