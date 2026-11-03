"""규칙 해석. 낱말표와 정규식으로 요청에서 조각을 찾는다.

LLM이 꺼져 있거나 실패하면 해석 전체를 맡고(`interpret_by_rules`), LLM 해석의 코드 확인
(`checks`)에도 쓰인다. 낱말이 들어 있는지만 보므로 철자 교정과 가게 이름은 못 한다.
"""

import re
from dataclasses import dataclass

from fit_ai.features import FEATURES
from fit_ai.match.conditions import CATEGORY_NAMES, STATION_NAMES
from fit_ai.match.interpretation.codes import GROUP_SIZE
from fit_ai.match.interpretation.merge import merge
from fit_ai.match.interpretation.request import (
    STATION_CODES,
    STATION_WORDS,
    Conditions,
    _assemble,
    _known_codes,
    _without_location,
)
from fit_ai.match.interpretation.segments import (
    DAYS,
    MAX_SEGMENTS,
    FeatureText,
    Hours,
    Location,
    LocationKind,
    Menu,
    Price,
)

CATEGORY_WORDS = {
    "카페": "CAFE",
    "술집": "BAR",
    "식당": "RESTAURANT",
    "밥집": "RESTAURANT",
    "음식점": "RESTAURANT",
    "이자카야": "BAR",
    "포차": "BAR",
    "호프": "BAR",
    "와인바": "BAR",
    "칵테일": "BAR",
    "맥주": "BAR",
    "커피": "CAFE",
    "디저트": "CAFE",
    "케이크": "CAFE",
    "빙수": "CAFE",
    "하이볼": "BAR",
    "맛집": "RESTAURANT",
    "한식": "RESTAURANT",
    "일식": "RESTAURANT",
    "중식": "RESTAURANT",
    "양식": "RESTAURANT",
    "초밥": "RESTAURANT",
    "라멘": "RESTAURANT",
    "파스타": "RESTAURANT",
    "쌀국수": "RESTAURANT",
    "국밥": "RESTAURANT",
    "국물": "RESTAURANT",
    "매운": "RESTAURANT",
}
"""규칙 해석에서 업종을 찾는 낱말. 앞에 있는 낱말이 먼저다.
"카페 맛집"처럼 업종 이름이 함께 있으면 업종 이름을 따른다. 음식 낱말은 식당이고, 디저트는
카페, 술 메뉴는 술집이다."""


CATEGORY_NAME_WORDS = ("카페", "술집", "식당", "밥집", "음식점")
"""빼 달라는 업종으로 보는 낱말. 업종 이름만이다. "일식 말고", "포차 말고"는 음식 종류나 가게
종류를 빼 달라는 말이라 업종 전체를 빼지 않는다. 음식 낱말로 빼면 "강남역 일식 말고"에서
식당이 모두 빠졌다(2026-11-03)."""


NEARBY_WORDS = ("근처", "주변", "가까운")
"""규칙 해석에서 근처 검색을 찾는 낱말. 역 이름과 함께 있으면 근처 검색이 아니다."""


CODE_WORDS = {
    "QUIET": ("조용", "차분"),
    "LIVELY": ("활기", "북적", "시끄", "시끌"),
    "SPACIOUS_SEATING": ("넓은", "넓고", "자리 넉넉", "자리가 넉넉"),
    "SHORT_WAIT": ("웨이팅", "대기", "기다리지"),
    "GENEROUS_PORTION": ("양 많", "양이 많", "푸짐"),
    "PRETTY_SPACE": ("예쁜", "인테리어"),
    "VIEW_OUTDOOR": ("전망", "야외", "테라스", "루프탑"),
    "COZY": ("아늑",),
    "VALUE_FOR_MONEY": ("가성비",),
    "PURPOSE_TALK": ("대화", "이야기 나누", "수다"),
    "PURPOSE_SOLO": ("혼밥", "혼술", "혼자"),
    "PURPOSE_DATE": ("데이트", "기념일", "특별한 날"),
    "PURPOSE_GROUP": ("모임", "단체", "회식"),
    "PURPOSE_WORK": ("작업", "공부", "노트북", "카공"),
    "FOOD_KOREAN": ("한식", "한국 음식", "한정식"),
    "FOOD_JAPANESE": ("일식", "일본"),
    "FOOD_CHINESE": ("중식", "중국", "중화"),
    "FOOD_WESTERN": ("양식", "서양", "이탈리", "프렌치", "프랑스", "스페인", "멕시"),
    "FOOD_ASIAN": ("아시안", "아시아", "동남아", "베트남", "태국", "인도"),
    "FOOD_SPICY": ("매운", "매콤", "얼큰"),
    "UNIQUE_CONCEPT": ("컨셉", "독특"),
    "FAST_SERVING": ("빨리 나오", "빨리 먹"),
    "GOOD_MUSIC": ("음악",),
    "PARKING": ("주차",),
    "WIFI": ("와이파이",),
    "GROUP": ("단체석",),
    "RESERVATION": ("예약",),
}
"""규칙 해석에서 조건 코드를 찾는 낱말. "리뷰"의 "뷰", "비싼"의 "싼"처럼 다른 말에
섞이는 짧은 낱말은 넣지 않는다. 시설 `GROUP`은 모임과 헷갈리지 않게 "단체석"으로만
찾는다. "저렴"은 특징이 아니라 가격이다(`_CHEAP`). 음식 종류 코드는 음식 종류나 나라를 말한
낱말로만 찾는다. 메뉴("라멘")는 메뉴 조각이다(`MENU_WORDS`). 코드 확인은 이 낱말이 없는데 LLM이
낸 음식 종류 코드를 뗀다."""


NEGATION_WANTS = frozenset({"SHORT_WAIT"})
"""낱말을 부정하면 그 코드를 바라는 코드. 낱말이 피하고 싶은 것("웨이팅", "대기")이라 "웨이팅
싫어", "웨이팅 없이"는 짧은 대기를 바라는 말이다. 그 밖에 반대 극이 없는 코드를 부정하면
("데이트 말고") 버린다."""


MENU_WORDS = {
    "초밥": "초밥",
    "스시": "초밥",
    "라멘": "라멘",
    "오마카세": "오마카세",
    "파스타": "파스타",
    "스파게티": "파스타",
    "스테이크": "스테이크",
    "쌀국수": "쌀국수",
    "팟타이": "팟타이",
    "마라탕": "마라탕",
    "짜장": "짜장면",
    "짬뽕": "짬뽕",
    "국밥": "국밥",
    "삼겹살": "삼겹살",
    "국물": "국물 요리",
    "와인": "와인",
    "하이볼": "하이볼",
    "칵테일": "칵테일",
    "디카페인": "디카페인",
    "케이크": "케이크",
    "디저트": "디저트",
    "브런치": "브런치",
    "고기": "고기",
    "고깃": "고기",
}
"""규칙 해석에서 메뉴를 찾는 낱말과 표준 이름. 같은 메뉴의 다른 표기("스시")는 표준 이름
("초밥")으로 바꾼다. "고깃집"은 "고기"를 품지 않아 따로 둔다."""


FEATURE_WORDS = {
    "콘센트": "콘센트",
    "충전": "콘센트",
    "반려견": "반려견",
    "반려동물": "반려견",
    "강아지": "반려견",
    "애견": "반려견",
    "아이랑": "아이 동반",
    "아기랑": "아이 동반",
    "애기랑": "아이 동반",
    "룸 있": "룸",
    "룸이": "룸",
    "개별룸": "룸",
}
"""규칙 해석에서 코드표에 없는 특징을 찾는 낱말과 표준 이름. "룸"은 "베이커리룸"처럼
다른 말에 섞이므로 "룸 있", "룸이", "개별룸" 꼴로만 찾는다."""


HERE_WORDS = (*NEARBY_WORDS, "여기")
"""규칙 해석에서 지금 보는 곳(`LocationKind.HERE`)을 찾는 낱말"""


_CHEAP = re.compile(r"저렴|(?<!비)싼\s|(?<!비)싸[고게]|비싸지\s*않|안\s*비싼")
"""규칙 해석에서 싼 곳을 찾는 꼴. "비싼"의 "싼"은 싼 곳이 아니므로 앞 글자가 "비"면 뺀다."""


_STATION_TEXT = re.compile(rf"(?:{'|'.join(STATION_WORDS)})[역동]?")
"""규칙 해석에서 역 원문("역삼역", "역삼동")을 찾는 꼴"""


_WALK = re.compile(r"(?:걸어서|도보로?)\s*(\d{1,2})\s*분")
"""규칙 해석에서 도보 거리("걸어서 5분", "도보 10분")를 찾는 꼴"""


_EXIT = re.compile(r"(\d{1,2})\s*번\s*출구")
"""규칙 해석에서 역 출구("11번 출구")를 찾는 꼴"""


_NEGATION = re.compile(r"말고|빼고|대신|아니고|싫|않|없는|없이|제외|별로")
"""피한다고 분명히 말하는 말. 메뉴의 피함(`Menu.want`)은 요청에 이 말이 있을 때만 믿는다.
"매운 거 먹고 싶다"를 매운 음식을 피하는 것으로 읽는 일을 막는다(2026-11-02 평가)."""


_SPICY_AVOID = re.compile(r"맵지\s*않|안\s*매운|덜\s*매운")
"""규칙 해석에서 매운 음식을 피하는 말("맵지 않은", "안 매운")을 찾는 꼴"""


VALUE_WORDS = ("가성비", "가격 대비", "가격대비", "값어치")
"""가성비(`VALUE_FOR_MONEY`)를 말했다고 볼 낱말. 싼 곳만 찾는 요청("저렴한")에 LLM이
가성비를 붙이면 이 낱말이 없을 때 뗀다."""


_MARKER = r"(?:말고|빼고|대신|아니고|제외|싫(?:어|고|은|다|음)|않(?:은|는|고|게)|없(?:는|이|고))"
"""앞의 말을 부정하는 말. "고기 없는", "매운 건 싫어", "맵지 않은"도 본다. "조용한 카페
없을까?"처럼 묻는 말(없을까, 없나)은 부정이 아니라서 "없"은 "없는", "없이", "없고"만 본다.
규칙 해석이 "싫어", "없는"을 놓쳐 "매운 건 싫어"를 매운 음식을 원함으로 읽었다(2026-11-03)."""


_GENERIC_HEAD = re.compile(
    r"(?:거|건|것|게|걸|데|곳|집|쪽|음식|요리|메뉴|종류|분위기|스타일|느낌)"
    r"(?:은|는|도|이|가|을|를|만|들)?"
)
"""뜻을 앞 낱말이 정하는 말. "매운 거 말고", "시끄러운 데 싫어"는 앞 낱말까지 부정이다."""


_LISTED = re.compile(r"\S(?:이나|이랑|랑|하고|과|와|,)$")
"""다음 낱말과 묶인 낱말("일식이나 중식 말고"의 "일식이나")"""


_EXCLUDED_WIDE = re.compile(r"(?:\S+\s+)?\S+\s*(?:말고|대신|아니고|빼고)")
"""후속에서 이전 코드를 뺐는지 보는 꼴(`_kept_codes`). 빼 달라는 말만 본다. "웨이팅 싫어"는
짧은 대기를 원하는 말이라 "싫어"로 이전 코드를 빼지 않는다."""


_PRICE_MAX_MIXED = re.compile(
    r"(\d+)\s*만\s*(\d+)\s*천\s*원?\s*(?:이하|이내|아래|미만|까지)"
)
""""1만5천원 이하"처럼 만과 천이 섞인 상한. `_PRICE_MAX`가 "5천원 이하"만 읽지 않게 먼저
본다."""


_PRICE_MAX = re.compile(
    r"(\d+(?:\.\d+)?)\s*(만|천)\s*원?\s*(?:이하|이내|아래|미만|까지)"
)


_PRICE_MAX_MAN = re.compile(r"(?<![\d만천])만\s*원\s*(?:이하|이내|아래|미만|까지)")


_PRICE_RANGE = re.compile(r"(\d+)\s*만\s*원?\s*대")


_UNTIL_LATE = re.compile(r"새벽\s*(?:(\d{1,2})\s*시\s*)?까지|늦게까지|밤늦게|심야")


_UNTIL_HOUR = re.compile(r"(밤|저녁)?\s*(\d{1,2})\s*시\s*(?:넘어서|이후)?\s*까지")


_FROM_HOUR = re.compile(r"아침\s*(\d{1,2})\s*시\s*(?:전에|이전|부터)")


_DAY = re.compile(r"(월|화|수|목|금|토|일)요일")


_NOW = re.compile(r"지금\s*(?:열린|여는|영업|문\s*연)")


_DAY_CODES = dict(zip("월화수목금토일", DAYS, strict=True))


_NEGATED = re.compile(rf"\S+?\s*{_MARKER}\S*")
""""카페 말고 술집"의 "카페 말고"처럼 부정한 낱말 하나와 부정하는 말. 지역을 찾을 때
지운다("역삼역 카페 말고"의 역은 남는다)."""


_PEOPLE = re.compile(r"(\d+)\s*(?:명|인)")


def interpret_by_rules(query: str, previous: Conditions | None = None) -> Conditions:
    """낱말 규칙으로 해석한다. LLM이 실패했을 때 쓰고, LLM이 놓친 조각을 채울 때도 쓴다.

    낱말이 들어 있는지만 본다. 지역은 서비스 역, 역 이름과 같은 동, 근처만 찾는다. 부정은
    "말고", "빼고", "싫어", "없는", "않은" 앞의 성향 축(활기↔조용), 음식, 메뉴, 특징, 업종만
    알아듣는다(`_MARKER`). 가게 이름, 다른 동네·랜드마크, 철자 교정은 못 한다. 이번 요청만
    해석하고, 후속 조건이면 이전 조건과 분류별 규칙으로 합친다(`merge.merge`).

    Args:
        query: 사용자가 이번에 입력한 요청문
        previous: 후속 조건이면 기준 요청의 조건

    Returns:
        해석한 조건
    """
    parts = _rule_parts(query)
    turn = _assemble(
        text=query,
        embedding_text=_without_location(
            _without_negated(query, parts.category_group), parts.category_group
        ),
        codes=list(parts.codes),
        category_group=parts.category_group,
        locations=parts.locations,
        menus=parts.menus,
        hours=parts.hours,
        price=parts.price,
        place_name=None,
        features=parts.features,
        avoid_categories=parts.avoid_categories,
        avoid_foods=parts.avoid_foods,
    )
    if previous is None:
        return turn
    kept = set(_kept_codes(previous, query, list(turn.codes), turn.avoid_foods))
    return merge(previous, turn, [c for c in previous.codes if c not in kept])


def _without_negated(query: str, category_group: str | None) -> str:
    """벡터용 문장에서 부정한 말("매운 건 싫어")을 지운다. 벡터 검색은 부정을 알아듣지
    못해 그 말과 가까운 장소를 올린다. 지우고 남는 글자가 없으면 업종 이름, 업종도 없으면
    요청문 그대로다."""
    stripped = _strip_negated(query)
    if any(ch.isalnum() for ch in stripped):
        return stripped
    return CATEGORY_NAMES.get(category_group or "", query)


@dataclass(frozen=True)
class _RuleParts:
    """규칙으로 찾은 조각. 이번 요청문에서만 찾은 값이다."""

    codes: tuple[str, ...]
    category_group: str | None
    avoid_categories: tuple[str, ...]
    avoid_foods: tuple[str, ...]
    locations: tuple[Location, ...]
    menus: tuple[Menu, ...]
    hours: tuple[Hours, ...]
    price: Price | None
    features: tuple[FeatureText, ...]


def _negated_spans(query: str) -> list[tuple[int, int]]:
    """부정한 말의 위치. 부정한 낱말과 부정하는 말이고, 부정한 낱말이 뜻을 앞 낱말이 정하는
    말("매운 거")이거나 메뉴("매운 짬뽕")이거나 앞 낱말과 묶였으면("일식이나 중식") 앞
    낱말까지다. 업종 이름 앞의 낱말("조용한 카페 말고")은 부정하지 않는다. 업종을 빼 달라는
    말이다."""
    spans = []
    for found in _NEGATED.finditer(query):
        start = found.start()
        word = re.split(_MARKER, found.group())[0].strip()
        before = re.search(r"(\S+)\s+$", query[:start])
        if before and (
            _GENERIC_HEAD.fullmatch(word)
            or any(menu in word for menu in MENU_WORDS)
            or _LISTED.search(before.group(1))
        ):
            start = before.start(1)
        spans.append((start, found.end()))
    return spans


def _negated_text(query: str) -> str:
    """부정한 말만 이은 문장"""
    return " ".join(query[a:b] for a, b in _negated_spans(query))


def _strip_negated(query: str) -> str:
    """부정한 말을 지운 문장"""
    kept, end = [], 0
    for a, b in _negated_spans(query):
        kept.append(query[end:a])
        end = b
    return " ".join("".join([*kept, query[end:]]).split())


def _rule_parts(query: str) -> _RuleParts:
    """요청문에서 규칙으로 찾을 수 있는 조각을 모두 찾는다."""
    negated = _negated_text(query)
    codes = []
    avoid_foods = ["FOOD_SPICY"] if _SPICY_AVOID.search(query) else []
    for code, words in CODE_WORDS.items():
        if not _has(query, words):
            continue
        opposite = FEATURES[code].opposite if code in FEATURES else None
        if _has(negated, words) and opposite is not None:
            # "북적이는 데 말고"는 반대 극(조용함)을 바라는 말이다.
            codes.append(opposite)
        elif _has(negated, words) and code.startswith("FOOD_"):
            # "매운 거 말고", "일식 말고"는 바라는 쪽 코드가 없어 빼 달라는 음식으로 둔다.
            avoid_foods.append(code)
        elif _has(negated, words) and code not in NEGATION_WANTS:
            # "데이트 말고", "주차 말고"는 바라는 쪽 코드가 없어 버린다.
            continue
        elif code not in avoid_foods:
            # "안 매운"의 "매운"은 원하는 매운맛이 아니다.
            codes.append(code)
    for count in _PEOPLE.findall(query):
        if int(count) == 1:
            codes.append("PURPOSE_SOLO")
        elif int(count) >= GROUP_SIZE:
            codes.append("PURPOSE_GROUP")
    menus = _rule_menus(query, negated)
    # "카페 말고 술집으로"에서 카페를 고르지 않도록 빼 달라는 말은 지우고 찾는다. 부정한
    # 낱말 하나만 지워서 "역삼역 카페 말고"의 역과 "매운 건 싫어"의 음식 낱말(식당)은 남는다.
    wanted = _NEGATED.sub(" ", query)
    category_group = _first(CATEGORY_WORDS, wanted)
    avoid_categories = tuple(
        dict.fromkeys(
            CATEGORY_WORDS[word]
            for word in CATEGORY_NAME_WORDS
            if word in " ".join(_NEGATED.findall(query))
            and CATEGORY_WORDS[word] != category_group
        )
    )
    return _RuleParts(
        codes=tuple(codes),
        category_group=category_group,
        avoid_categories=avoid_categories,
        avoid_foods=tuple(dict.fromkeys(avoid_foods)),
        locations=_rule_locations(wanted),
        menus=menus,
        hours=_rule_hours(query),
        price=_rule_price(query),
        features=_rule_features(query, negated),
    )


def _rule_menus(query: str, negated: str) -> tuple[Menu, ...]:
    """메뉴 낱말을 찾는다. "말고" 앞이면 피하는 메뉴다."""
    return tuple(
        Menu(word, value, want=word not in negated)
        for word, value in MENU_WORDS.items()
        if word in query
    )


def _rule_locations(query: str) -> tuple[Location, ...]:
    """서비스 역, 역 이름과 같은 동, 근처를 찾는다. 역이나 동이 있으면 근처보다 앞선다
    ("강남역 근처"). 도보 거리는 모든 역에, 출구는 바로 앞에 나온 역에 붙인다."""
    walk = _WALK.search(query)
    minutes = int(walk.group(1)) if walk else None
    stations = list(_STATION_TEXT.finditer(query))
    exits: dict[int, str] = {}
    for found in _EXIT.finditer(query):
        before = [i for i, m in enumerate(stations) if m.end() <= found.start()]
        if before:
            exits.setdefault(before[-1], found.group(1))
    locations = []
    for i, match in enumerate(stations):
        text = match.group()
        if text.endswith("동"):
            locations.append(
                Location(text, LocationKind.AREA, text, walk_minutes=minutes)
            )
            continue
        name = STATION_NAMES[STATION_CODES[text.removesuffix("역")]]
        locations.append(
            Location(text, LocationKind.STATION, name, minutes, exits.get(i))
        )
    if locations:
        return tuple(dict.fromkeys(locations))[:MAX_SEGMENTS]
    here = next((word for word in HERE_WORDS if word in query), None)
    return (Location(here, LocationKind.HERE),) if here else ()


def _rule_hours(query: str) -> tuple[Hours, ...]:
    hours = []
    if found := _UNTIL_LATE.search(query):
        hour = int(found.group(1)) if found.group(1) else None
        late = "02:00" if found.group().startswith("새벽") else "23:00"
        hours.append(
            Hours(found.group(), open_until=f"{hour:02d}:00" if hour else late)
        )
    elif found := _UNTIL_HOUR.search(query):
        hour = int(found.group(2))
        # "밤 11시까지"는 23시다. "새벽 2시까지"처럼 이른 시각은 그대로 둔다.
        if found.group(1) and hour < 12:
            hour += 12
        if hour <= 24:
            hours.append(Hours(found.group().strip(), open_until=f"{hour % 24:02d}:00"))
    if found := _FROM_HOUR.search(query):
        hours.append(Hours(found.group(), open_from=f"{int(found.group(1)):02d}:00"))
    if found := _DAY.search(query):
        hours.append(Hours(found.group(), day=_DAY_CODES[found.group(1)]))
    if found := _NOW.search(query):
        hours.append(Hours(found.group(), now=True))
    return tuple(hours)


def _rule_price(query: str) -> Price | None:
    if found := _PRICE_MAX_MIXED.search(query):
        high = int(found.group(1)) * 10000 + int(found.group(2)) * 1000
        return Price(found.group(), max_won=high)
    if found := _PRICE_MAX.search(query):
        unit = 10000 if found.group(2) == "만" else 1000
        return Price(found.group(), max_won=int(float(found.group(1)) * unit))
    if found := _PRICE_MAX_MAN.search(query):
        return Price(found.group(), max_won=10000)
    if found := _PRICE_RANGE.search(query):
        low = int(found.group(1)) * 10000
        return Price(found.group(), min_won=low, max_won=low + 9999)
    if found := _CHEAP.search(query):
        return Price(found.group().strip(), cheap=True)
    # "비싼 데 말고"는 싼 곳을 바라는 말이다.
    spans = (query[a:b] for a, b in _negated_spans(query))
    if span := next((s for s in spans if "비싼" in s), None):
        return Price(span, cheap=True)
    return None


def _rule_features(query: str, negated: str) -> tuple[FeatureText, ...]:
    """코드표에 없는 특징을 찾는다. "강아지랑 반려견 동반"처럼 같은 특징을 두 번 말해도
    처음 찾은 낱말로 하나만 둔다."""
    found: dict[str, FeatureText] = {}
    for word, value in FEATURE_WORDS.items():
        if word in query:
            found.setdefault(value, FeatureText(word, value, want=word not in negated))
    return tuple(found.values())


def _kept_codes(
    previous: Conditions,
    query: str,
    codes: list[str],
    avoid_foods: tuple[str, ...] | list[str],
) -> list[str]:
    """후속에서 남길 이전 코드. 이번 요청이 "말고"로 뺐거나, 반대 극을 바라거나, 빼 달라는
    음식이 된 코드는 버린다. LLM이 업종을 바꾸며 이전 조건을 통째로 버리는 일을 막는다
    ("카페 말고 술집으로")."""
    negated = " ".join(_EXCLUDED_WIDE.findall(query))
    avoided = set(avoid_foods)
    kept = []
    for code in _known_codes(list(previous.codes)):
        opposite = FEATURES[code].opposite if code in FEATURES else None
        removed = (
            _has(negated, CODE_WORDS.get(code, ()))
            or (opposite is not None and opposite in codes)
            or code in avoided
        )
        if not removed:
            kept.append(code)
    return kept


def _first(words: dict[str, str], query: str) -> str | None:
    return next((value for word, value in words.items() if word in query), None)


def _has(query: str, words: tuple[str, ...]) -> bool:
    return any(word in query for word in words)
