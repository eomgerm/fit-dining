"""LLM 해석. 프롬프트, 이전 조건 보여 주기, LLM 출력(JSON) 읽기.

출력은 꼴을 검사한 뒤 코드 확인(`checks`)으로 넘긴다. 프롬프트 예시는 평가 질의
(experiments/interpretation)와 겹치지 않게 고른다.
"""

import json
import re
from dataclasses import asdict

from fit_ai.match.conditions import CATEGORY_NAMES, STATION_NAMES
from fit_ai.match.interpretation.checks import _checked
from fit_ai.match.interpretation.codes import FOOD_CODES, GROUP_SIZE
from fit_ai.match.interpretation.request import (
    CODE_PHRASES,
    MAX_WALK_MINUTES,
    Conditions,
    _join,
    _known_codes,
    _without_location,
    locations_of,
)
from fit_ai.match.interpretation.segments import (
    DAYS,
    MAX_SEGMENT_LENGTH,
    MAX_SEGMENTS,
    MAX_SPELLINGS,
    FeatureText,
    Hours,
    Location,
    LocationKind,
    Menu,
    PlaceName,
    Price,
)

MAX_CHANGE_SUMMARY_LENGTH = 60
"""LLM이 쓴 바뀐 점 문구의 길이 상한. 넘으면 기본 문구를 쓴다."""


DEFAULT_CHANGE_SUMMARY = "요청하신 조건을 반영했어요"
"""LLM이 바뀐 점을 쓰지 못했을 때의 문구. BE Mock과 같다."""


SYSTEM_PROMPT = f"""\
너는 장소 검색 서비스의 요청 해석기다. 사용자의 검색 요청을 분류별로 나눠 조건으로 \
바꾼다. 조각마다 사용자가 쓴 말은 text에 그대로 두고, 철자가 틀렸거나 줄여 쓴 말은 \
고쳐서 value에 표준 이름으로 쓴다.
- category_group: RESTAURANT(식당), CAFE(카페), BAR(술집) 중 하나. \
음식 종류나 식사 메뉴(한식, 라멘, 파스타, 국물 요리 등)를 말하면 RESTAURANT다. \
맛집, 밥집, 먹을 데처럼 식사하는 곳을 찾는 말도 RESTAURANT다. \
술 마시는 곳(이자카야, 포차, 호프, 와인바, 칵테일바, 루프탑 바 등)과 술 메뉴(하이볼, \
와인)는 BAR다. 커피, 음료, 디저트 메뉴(케이크, 빙수)는 CAFE다. 알 수 없으면 null.
- avoid_categories: "카페 말고"처럼 빼 달라는 업종. 없으면 빈 목록이다.
- locations: 지역 목록. 없으면 빈 목록이다. "강남역이나 역삼역"처럼 여럿이면 모두 \
넣는다. [{{"text", "kind", "value", "walk_minutes", "exit"}}]. kind는 STATION(역. \
"강남", "역삼"처럼 역 이름만 써도, "강남역 근처"처럼 근처를 붙여도 역이다), \
AREA(동네, 거리, 랜드마크. 신사동, 가로수길, 코엑스), HERE(근처, 주변, 여기처럼 \
지금 보는 곳. 역 이름 없이 "근처 카페"라고 하면 HERE다), UNKNOWN(회사 근처, \
집 근처처럼 어딘지 알 수 없는 곳) 중 하나다. value는 STATION이면 "○○역", AREA면 \
표준 이름, HERE와 UNKNOWN이면 null이다. walk_minutes는 "걸어서 5분"의 분, exit는 \
"11번 출구"의 "11"이고 없으면 null이다.
- codes: 아래 코드표에서 요청에 있는 조건을 빠짐없이 고른다. 없으면 빈 목록이다. \
부정한 조건도 바라는 쪽 코드로 반드시 넣는다("시끄러운 곳 말고"는 QUIET, \
"오래 기다리는 데 싫어"는 SHORT_WAIT). \
인원은 1명이면 PURPOSE_SOLO, {GROUP_SIZE}명 이상이면 PURPOSE_GROUP으로 바꾼다. \
"가성비"는 VALUE_FOR_MONEY다. "저렴한", "싼", "비싸지 않은"은 VALUE_FOR_MONEY가 \
아니라 price다.
- 음식 종류 코드(FOOD_KOREAN, FOOD_JAPANESE, FOOD_CHINESE, FOOD_WESTERN, FOOD_ASIAN)는 \
한식, 일식, 중국집, 양식, 베트남 음식처럼 음식 종류를 직접 말했을 때만 codes에 넣는다. \
메뉴 이름(라멘, 돈가스, 파스타)만으로 음식 종류 코드를 넣지 않는다. 매운 음식을 원하면 \
FOOD_SPICY다.
- codes에는 요청에 없는 조건을 넣지 않는다. "식당"이라는 말만으로 음식 종류 코드를, \
"모임", "회식", 인원만으로 시설 GROUP을 넣지 않는다. GROUP은 단체석, 단체 예약처럼 \
시설을 말할 때만 넣는다.
- avoid_foods: "일식 말고", "매운 거 빼고"처럼 빼 달라는 음식 종류나 매운맛의 코드. \
없으면 빈 목록이다.
- menus: 먹고 마시는 메뉴(돈가스, 라멘, 하이볼, 케이크, 커피, 술, 디저트). 음식 종류(한식, \
일식)와 매운맛은 menus가 아니라 codes다. 없으면 빈 목록이다. \
[{{"text", "value", "spellings", "want"}}]. value는 표준 이름이다("스시"는 "초밥", \
"스파게티"는 "파스타"). spellings는 메뉴판에 흔히 쓰는 같은 메뉴의 다른 \
표기다("돈가스"는 ["돈까스", "돈카츠"]). 다른 메뉴나 더 넓은 말은 넣지 않고, 없으면 \
빈 목록이다. want는 원하면 true다. "말고", "빼고", "싫어", "않은"처럼 피한다고 분명히 \
말했을 때만 false다.
- hours: 영업시간. 없으면 빈 목록이다. [{{"text", "day", "open_until", "open_from", \
"now"}}]. day는 요일(MON, TUE, WED, THU, FRI, SAT, SUN)이고 없으면 null이다. \
open_until은 그 시각 이후까지 여는 곳이다("늦게까지"는 "23:00", "새벽까지"는 \
"02:00"). open_from은 그 시각 이전부터 여는 곳이다("아침 8시 전에 여는"은 "08:00"). \
지금 여는 곳을 찾으면 now는 true다.
- price: 가격. 없으면 null이다. {{"text", "min_won", "max_won", "cheap"}}. \
"만원 이하"는 max_won 10000, "2만원대"는 min_won 20000과 max_won 29999다. \
"저렴한", "싼", "비싸지 않은"은 cheap true다.
- place_name: 가게 이름이나 체인 이름. 없으면 null이다. {{"text", "value"}}. \
value는 표준 이름이다("스벅"은 "스타벅스"). "○○ 같은 곳"처럼 비슷한 곳을 찾는 \
말은 가게 이름이 아니다.
- features: 코드표에 없는 장소 특징(콘센트, 반려견, 아이 동반, 룸 등). 없으면 빈 \
목록이다. [{{"text", "value", "want"}}]. value는 표준 이름이다("충전"은 "콘센트", \
"강아지랑"은 "반려견").
- embedding_text: 요청을 긍정형 검색어로 쓴다. 비우거나 줄이지 않는다. \
"찾고 있어요", "찾습니다" 같은 말은 붙이지 않는다. \
역과 업종만 있는 짧은 요청도 그대로 쓴다. \
부정 표현은 바라는 쪽으로 바꾸고, 리뷰에서 실제로 쓰는 말로 쓴다("시끄러운 곳 말고" \
→ "조용한 곳", "오래 기다리는 데 싫어" → "웨이팅 없이 바로 들어가는 곳", \
"안 매운" → "담백한").
- 이전 조건이 있으면 새 요청은 이전 조건에 더하거나 바꾸는 말이다. \
둘을 합친 조건을 낸다. 새 요청에 없는 분류는 지역을 포함해 이전 값을 그대로 둔다. \
"A 말고 B"는 A를 빼고 B를 넣는다. \
text와 embedding_text에는 새 요청 내용을 반드시 넣는다. \
text는 합친 요청을 한 문장으로, \
change_summary는 바뀐 점을 "~했어요"로 끝나는 짧은 한 문장으로 쓴다.
- 이전 조건이 없으면 text와 change_summary는 null이다.

코드표:
{chr(10).join(f"{code}: {phrase}" for code, phrase in CODE_PHRASES.items())}

예시:
- "선릉역 라멘집" → category_group "RESTAURANT", \
locations [{{"text": "선릉역", "kind": "STATION", "value": "선릉역"}}], \
menus [{{"text": "라멘", "value": "라멘", "spellings": [], "want": true}}], \
embedding_text "선릉역 라멘집"
- "북적이는 데 말고 공부할 카페" → category_group "CAFE", \
codes ["QUIET", "PURPOSE_WORK"], embedding_text "조용하고 공부하기 좋은 카페"
- "역삼 포차" → category_group "BAR", \
locations [{{"text": "역삼", "kind": "STATION", "value": "역삼역"}}], \
embedding_text "역삼 포차"
- "강남 5명 저녁 먹을 데" → category_group "RESTAURANT", \
locations [{{"text": "강남", "kind": "STATION", "value": "강남역"}}], \
codes ["PURPOSE_GROUP"], embedding_text "강남에서 5명이 저녁 먹기 좋은 곳"
- "근처 주차 되는 곳" → locations [{{"text": "근처", "kind": "HERE"}}], \
codes ["PARKING"], embedding_text "주차할 수 있는 곳"
- "논현동이나 신사역 걸어서 10분 3만원 이하 오마카세 밤 11시까지" → \
category_group "RESTAURANT", locations [{{"text": "논현동", "kind": "AREA", \
"value": "논현동"}}, {{"text": "신사역 걸어서 10분", "kind": "STATION", \
"value": "신사역", "walk_minutes": 10}}], \
menus [{{"text": "오마카세", "value": "오마카세", "spellings": [], "want": true}}], \
hours [{{"text": "밤 11시까지", "open_until": "23:00"}}], \
price {{"text": "3만원 이하", "max_won": 30000}}, embedding_text "3만원 이하 오마카세"
- "투썸 신논현 3번 출구" → category_group "CAFE", \
locations [{{"text": "신논현 3번 출구", "kind": "STATION", "value": "신논현역", \
"exit": "3"}}], place_name {{"text": "투썸", "value": "투썸플레이스"}}, \
embedding_text "투썸플레이스"
- "얼큰한 짬뽕집" → category_group "RESTAURANT", codes ["FOOD_SPICY"], \
menus [{{"text": "짬뽕", "value": "짬뽕", "spellings": [], "want": true}}], \
embedding_text "얼큰한 짬뽕집"
- "애기랑 갈 만한 데 일요일 점심 매운 거 빼고" → category_group "RESTAURANT", \
avoid_foods ["FOOD_SPICY"], hours [{{"text": "일요일", "day": "SUN"}}], \
features [{{"text": "애기랑", "value": "아이 동반", "want": true}}], \
embedding_text "아이와 가기 좋은 담백한 점심 식당"

아래 형식의 JSON만 출력한다. 값이 없는 분류도 빼지 않는다.
{{"text": null, "embedding_text": "<긍정형 검색어>", "category_group": null, \
"avoid_categories": [], "locations": [], "codes": [], "avoid_foods": [], "menus": [], \
"hours": [], "price": null, "place_name": null, "features": [], "change_summary": null}}"""
"""요청 해석 시스템 지시. 예시 문장은 평가 질의(experiments/interpretation)와
겹치지 않게 고른다."""


_CLOCK = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d")
"""시간 조각의 시각 형식("HH:MM")"""


def _user_prompt(query: str, previous: Conditions | None) -> str:
    if previous is None:
        return f"요청: {query}"
    # 이전 조건은 LLM이 낼 꼴과 같게 보여 준다. 1차 조건의 역을 지역으로 바꾸지 않으면
    # LLM이 이전 역을 잇지 못한다(2026-11-02 평가, 후속 12번 중 10번). 후보 추출용 문장은
    # LLM이 새로 쓰므로 보여 주지 않는다.
    data = {
        "text": previous.text,
        # 이전 조건은 FE가 돌려보낸 값이라 모르는 코드로 프롬프트를 키울 수 있다.
        "codes": list(_known_codes(list(previous.codes))),
        "category_group": previous.category_group,
        "locations": [asdict(loc) for loc in locations_of(previous)],
        "menus": [asdict(m) for m in previous.menus],
        "hours": [asdict(h) for h in previous.hours],
        "price": None if previous.price is None else asdict(previous.price),
        "place_name": None
        if previous.place_name is None
        else asdict(previous.place_name),
        "features": [
            {"text": f.text, "value": f.value, "want": True}
            for f in previous.features
            if f.code is None
        ],
        "avoid_categories": list(previous.avoid_categories),
        "avoid_foods": list(previous.avoid_foods),
    }
    return "\n".join(
        [f"이전 조건: {json.dumps(data, ensure_ascii=False)}", f"새 요청: {query}"]
    )


def _parse(
    data: object, query: str, previous: Conditions | None
) -> tuple[Conditions, str | None]:
    """LLM 출력(JSON을 읽은 값)을 조건으로 바꾼다. 형식이 틀리면 실패다.

    모르는 코드는 버리고, 모르는 업종·역은 거르지 않도록 None으로 본다. 분류별 조각은
    꼴이 틀린 조각만 버린다. 그다음 LLM이 놓치거나 잘못 넣은 조각을 규칙 해석으로
    바로잡는다(`_checked`). 메시지는 로그에 남으므로 출력 내용을 넣지 않는다.
    """
    if not isinstance(data, dict):
        raise TypeError("JSON 객체가 아니다")
    embedding_text = data.get("embedding_text")
    if not isinstance(embedding_text, str):
        raise TypeError("embedding_text가 문자열이 아니다")
    codes = data.get("codes", [])
    if not isinstance(codes, list):
        raise TypeError("codes가 목록이 아니다")
    # 위치 말이 없을 때 null을 내는 일이 잦아서 근처 검색이 아닌 것으로 본다.
    nearby = data.get("nearby") or False
    if not isinstance(nearby, bool):
        raise TypeError("nearby가 참거짓이 아니다")
    locations = _items(data.get("locations"), _location) or _legacy_locations(
        data.get("station"), nearby, previous
    )

    category_group = data.get("category_group")
    if category_group not in CATEGORY_NAMES:
        category_group = None

    # 새 검색은 사용자가 쓴 요청문을 그대로 정렬에 넣는다.
    text = query
    summary = None
    if previous is not None:
        text = data.get("text")
        if not _is_text(text):
            raise ValueError("후속 조건인데 text가 없다")
        summary = data.get("change_summary")
        if not _is_text(summary) or len(summary) > MAX_CHANGE_SUMMARY_LENGTH:
            summary = DEFAULT_CHANGE_SUMMARY
        # "넓은 곳이면 좋겠어"처럼 조건을 더하는 후속에서 LLM이 이전 문장을 그대로 낼
        # 때가 있다. 그러면 새 요청이 정렬과 후보 추출에서 빠지므로 뒤에 붙인다(규칙
        # 해석과 같다). 벡터용 문장은 위치 말만 다른 것도 같은 문장으로 본다.
        if text.strip() == previous.text.strip():
            text = _join(previous.text, query)
        if _without_location(embedding_text, category_group) == _without_location(
            previous.embedding_text, category_group
        ):
            embedding_text = _join(previous.embedding_text, query)
    # 짧은 요청에서 "..."처럼 글자 없는 문장을 내는 일이 있다(10-27 평가 216번 중
    # 12번). 그대로 인코딩하면 유사도가 무의미해져서 요청문으로 대신한다.
    if not any(ch.isalnum() for ch in embedding_text):
        embedding_text = text
    conditions = _checked(
        query,
        previous,
        text=text,
        embedding_text=embedding_text,
        codes=codes,
        category_group=category_group,
        locations=locations,
        menus=_items(data.get("menus"), _menu),
        hours=_items(data.get("hours"), _hours),
        price=_price(data.get("price")),
        place_name=_place_name(data.get("place_name")),
        features=_items(data.get("features"), _feature),
        avoid_categories=tuple(
            c for c in _list(data.get("avoid_categories")) if c in CATEGORY_NAMES
        ),
        avoid_foods=tuple(c for c in _list(data.get("avoid_foods")) if c in FOOD_CODES),
    )
    return conditions, summary


def _legacy_locations(
    station: object, nearby: bool, previous: Conditions | None
) -> tuple[Location, ...]:
    """지역 목록 없이 1차 꼴(station, nearby)로 낸 출력을 지역으로 바꾼다."""
    if station in STATION_NAMES:
        if nearby and previous is not None and station == previous.station:
            # 역 검색 뒤 "근처로"라고 했는데 LLM이 이전 역을 남긴 경우다.
            return (Location("근처", LocationKind.HERE),)
        # "강남역 근처"는 역을 기준으로 찾는 말이다(규칙 해석과 같다).
        name = STATION_NAMES[station]
        return (Location(name, LocationKind.STATION, name),)
    return (Location("근처", LocationKind.HERE),) if nearby else ()


def _location(data: dict) -> Location | None:
    """LLM이 낸 지역을 읽는다. 형식이 틀리면 버린다."""
    text = _segment(data.get("text"))
    try:
        kind = LocationKind(data.get("kind"))
    except ValueError:
        return None
    if text is None:
        return None
    value = _segment(data.get("value"))
    if kind in (LocationKind.HERE, LocationKind.UNKNOWN):
        value = None
    minutes = _won(data.get("walk_minutes"))
    exit_ = data.get("exit")
    return Location(
        text,
        kind,
        value,
        walk_minutes=minutes if minutes and minutes <= MAX_WALK_MINUTES else None,
        # bool은 int의 하위 타입이라 따로 막는다.
        exit=_segment(str(exit_))
        if isinstance(exit_, str | int) and not isinstance(exit_, bool)
        else None,
    )


def _menu(data: dict) -> Menu | None:
    """LLM이 낸 메뉴를 읽는다. 음식 코드(`code`)를 내도 버린다. 메뉴에는 음식 종류를 붙이지
    않는다."""
    text = _segment(data.get("text"))
    if text is None:
        return None
    value = _segment(data.get("value")) or text
    spellings = (_segment(s) for s in _list(data.get("spellings")))
    return Menu(
        text=text,
        value=value,
        spellings=tuple(
            dict.fromkeys(
                s for s in spellings if s is not None and s not in (text, value)
            )
        )[:MAX_SPELLINGS],
        want=data.get("want") is not False,
    )


def _hours(data: dict) -> Hours | None:
    text = _segment(data.get("text"))
    day = data.get("day") if data.get("day") in DAYS else None
    until = _clock(data.get("open_until"))
    since = _clock(data.get("open_from"))
    now = data.get("now") is True
    # 무엇을 바라는지 알 수 없는 조각은 버린다.
    if text is None or not (day or until or since or now):
        return None
    return Hours(text, day, until, since, now)


def _price(data: object) -> Price | None:
    """LLM이 낸 가격을 읽는다. 금액도 싼 곳 여부도 없으면 가격이 없는 것으로 본다."""
    if not isinstance(data, dict):
        return None
    text = _segment(data.get("text"))
    low, high = _won(data.get("min_won")), _won(data.get("max_won"))
    if low is not None and high is not None and low > high:
        low = high = None
    cheap = data.get("cheap") is True
    if text is None or not (low is not None or high is not None or cheap):
        return None
    return Price(text, low, high, cheap)


def _place_name(data: object) -> PlaceName | None:
    if not isinstance(data, dict):
        return None
    text = _segment(data.get("text"))
    if text is None:
        return None
    return PlaceName(text, _segment(data.get("value")) or text)


def _feature(data: dict) -> FeatureText | None:
    text = _segment(data.get("text"))
    if text is None:
        return None
    return FeatureText(
        text, _segment(data.get("value")) or text, data.get("want") is not False
    )


def _items(data: object, read) -> tuple:
    """조각 목록을 읽는다. 형식이 틀린 조각만 버리고, 같은 조각은 한 번만 남긴다."""
    items = (read(item) for item in _list(data) if isinstance(item, dict))
    return tuple(dict.fromkeys(item for item in items if item is not None))[
        :MAX_SEGMENTS
    ]


def _list(data: object) -> list:
    return data if isinstance(data, list) else []


def _segment(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()[:MAX_SEGMENT_LENGTH]


def _clock(value: object) -> str | None:
    if isinstance(value, str) and _CLOCK.fullmatch(value.strip()):
        return value.strip()
    return None


def _won(value: object) -> int | None:
    # bool은 int의 하위 타입이라 따로 막는다.
    if isinstance(value, bool) or not isinstance(value, int | float) or value < 0:
        return None
    return int(value)


def _is_text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())
