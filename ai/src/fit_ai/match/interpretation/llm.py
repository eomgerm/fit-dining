"""LLM 해석. 프롬프트, 이전 조건 보여 주기, LLM 출력(JSON) 읽기.

출력은 꼴만 검사하고 규칙으로 고치지 않는다. 규칙이 하던 보정(근처 말, 부정, 싼 곳과
가성비 등)은 프롬프트 지시로 옮겼다. 프롬프트 예시는 평가 질의(experiments/interpretation)와
겹치지 않게 고른다.
"""

import json
import re
from dataclasses import asdict

from fit_ai.match.conditions import CATEGORY_NAMES, STATION_NAMES
from fit_ai.match.interpretation.codes import (
    FACILITY_CODES,
    FEATURE_CODES,
    FLAVOR_CODES,
    FOOD_CODES,
)
from fit_ai.match.interpretation.merge import merge
from fit_ai.match.interpretation.request import (
    CODE_PHRASES,
    MAX_WALK_MINUTES,
    Conditions,
    _assemble,
    _without_location,
)
from fit_ai.match.interpretation.rules import _kept_codes
from fit_ai.match.interpretation.segments import (
    DAYS,
    MAX_SEGMENT_LENGTH,
    MAX_SEGMENTS,
    MAX_SPELLINGS,
    Feature,
    FeatureText,
    Hours,
    Location,
    LocationKind,
    Menu,
    PlaceName,
    Price,
)

REPEAT_SHARE = 0.7
"""후속에서 LLM이 이전 벡터용 문장을 다시 썼다고 보는 낱말 비율"""

MAX_PARTY_SIZE = 100
"""인원 상한. 넘으면 인원이 없는 것으로 본다."""

MAX_CHANGE_SUMMARY_LENGTH = 60
"""LLM이 쓴 바뀐 점 문구의 길이 상한. 넘으면 기본 문구를 쓴다."""


DEFAULT_CHANGE_SUMMARY = "요청하신 조건을 반영했어요"
"""LLM이 바뀐 점을 쓰지 못했을 때의 문구. BE Mock과 같다."""


SYSTEM_PROMPT = f"""\
너는 장소 검색 서비스의 요청 해석기다. 사용자의 검색 요청을 아래 칸으로 나눠 JSON으로 낸다.

공통 규칙
- 요청에서 말한 것만 넣는다. 말하지 않은 지역, 코드, 메뉴, 시간을 짐작해 넣지 않는다.
- 조각의 text에는 요청문에 나온 말을 고치지 않고 그대로 옮긴다. 철자가 틀렸거나 줄여 쓴 \
말은 value에 바로잡은 표준 이름으로 쓴다("건대잎구역"은 text "건대잎구역", value "건대입구역").
- want는 원하면 true다. "말고", "빼고", "싫어", "않은", "없는", "대신"처럼 피한다고 분명히 \
말한 것만 false다. "매운 거 당긴다"처럼 바라는 말은 true다.
- 부정은 바로 앞의 말에만 걸린다. "A 말고 B"는 A만 피하고 B는 원한다.
- 피함(want false)을 담는 칸은 categories, food_types, flavors, menus뿐이다. 다른 칸에는 \
원하는 것만 넣는다.
  - 뺀 지역은 locations에 넣지 않는다("합정역 말고 망원역"은 망원역만 넣는다).
  - 뺀 특징은 반대쪽 코드로 넣는다("북적이는 데 말고"는 QUIET, "차분한 데 말고"는 LIVELY, \
"줄 서는 데 싫어"는 SHORT_WAIT). 반대쪽이 없으면("데이트 말고") 넣지 않는다. 뺀 특징의 \
코드를 그대로 넣지 않는다.
  - 뺀 시설은 넣지 않는다.

칸
- categories: 업종 [{{"code", "want"}}]. code는 RESTAURANT(식당), CAFE(카페), BAR(술집)다. \
원하는 업종은 하나까지다. 업종을 알 수 있으면 비우지 않는다. 알 수 없을 때만 빈 목록이다.
  - 음식 종류, 식사 메뉴(돈가스, 국수), 맛집, 밥집, 매운 음식처럼 식사하는 곳이나 밥, \
끼니(아침, 점심, 저녁)를 먹을 곳을 찾으면 RESTAURANT다.
  - 술 마시는 곳(이자카야, 포차, 호프, 와인바, 칵테일바)과 술 메뉴(하이볼, 와인)는 BAR다.
  - 커피, 음료, 디저트 메뉴(케이크, 빙수)는 CAFE다.
  - 업종 이름을 뺄 때만 want false다("카페 말고"는 CAFE false). "양식 말고"는 음식 종류를 \
빼는 말이라 RESTAURANT를 빼지 않는다.
- locations: 지역 [{{"text", "kind", "value", "walk_minutes", "exit"}}]. 여럿이면("○○역이나 \
△△역") 모두 넣는다. 없으면 빈 목록이다.
  - kind는 이름의 종류로 정한다. STATION은 지하철역이다. "강남", "합정"처럼 "역"을 빼고 \
역 이름만 쓰면 동네 이름과 같아도 STATION이다. 철자가 틀려도 역 이름이면 STATION이고, \
가장 적게 고쳐서 되는 역 이름으로 고친다. value는 "○○역"이다. AREA는 동, 구, 거리, 상권, \
랜드마크다(성수동, 송파구, 경리단길, 롯데월드타워). value는 표준 이름이다. HERE는 이름 \
없이 "근처", "주변", "여기"만 말해 지금 보는 곳을 뜻할 때다. UNKNOWN은 "회사 앞", \
"집 근처"처럼 어딘지 알 수 없는 곳이다. HERE와 UNKNOWN의 value는 null이다.
  - 이름 뒤에 "근처", "주변", "쪽", "앞"이 붙어도 kind는 이름을 따른다. "삼성역 근처"는 \
STATION, "성수동 근처"는 AREA다.
  - walk_minutes는 "걸어서 5분", "도보 10분"의 분, exit는 "3번 출구"의 "3"이다. 없으면 null이다.
- features: 장소 특징 [{{"text", "value", "code"}}]. 요청에 있는 특징을 빠짐없이 넣는다.
  - code는 아래 특징 코드표에서 고른다. 표현이 달라도 코드표 문구와 뜻이 같으면 그 코드다. \
비슷하기만 하고 뜻이 다르거나 코드표에 없는 특징이면 null이고 value에 표준 이름을 쓴다("충전"은 "콘센트", "강아지랑"은 "반려견", 아이 동반, 룸).
  - "모임", "회식"은 PURPOSE_GROUP, "혼자"는 PURPOSE_SOLO다.
  - "가성비"는 VALUE_FOR_MONEY다. 싼 곳을 찾는 말("저렴한", "싼", "비싸지 않은", 비싼 \
곳을 빼 달라는 말)은 가성비가 아니라 price의 cheap이다. "가성비"라는 말이 없으면 \
VALUE_FOR_MONEY를 넣지 않는다.
  - 주차, 와이파이, 단체석, 예약은 features가 아니라 facilities다.
- facilities: 시설 코드 목록. PARKING(주차), WIFI(와이파이), GROUP(단체석, 단체 예약), \
RESERVATION(예약). 그 시설을 직접 말했을 때만 넣는다. "모임", "회식", 인원만으로 GROUP을 \
넣지 않는다. 없으면 빈 목록이다.
- party_size: 인원 수("5명"이면 5, "혼자"면 1). 없으면 null이다.
- food_types: 음식 종류 [{{"code", "want"}}]. code는 FOOD_KOREAN(한식), FOOD_JAPANESE(일식), \
FOOD_CHINESE(중식), FOOD_WESTERN(양식), FOOD_ASIAN(아시아 음식). "한식", "중국집", \
"베트남 음식"처럼 음식 종류나 나라를 직접 말했을 때만 넣는다. 메뉴 이름(돈가스, 마라탕, \
버거)이나 "식당"이라는 말만으로 넣지 않는다. "양식 말고"는 FOOD_WESTERN want false다. \
없으면 빈 목록이다.
- flavors: 맛 [{{"code", "want"}}]. code는 SPICY(매운맛)다. 매운 음식을 원하면 true, \
"안 매운", "맵지 않은", "매운 건 빼고"는 false다. 없으면 빈 목록이다.
- menus: 먹고 마시는 메뉴 [{{"text", "value", "spellings", "want"}}]. 돈가스, 하이볼, 케이크, \
커피, 술처럼 먹고 마시는 것은 모두 여기다. 음식 종류(한식, 일식)와 매운맛은 menus가 \
아니다. 없으면 빈 목록이다.
  - 가게 종류를 뜻하는 말에 든 메뉴도 넣는다("곱창집"은 곱창, "횟집"은 회, "칵테일바"는 \
칵테일). 가게 종류 이름 자체(이자카야, 포차, 맛집, 카페)와 끼니(아침, 점심, 저녁)는 메뉴가 \
아니다.
  - value는 메뉴판에 가장 흔히 쓰는 이름이다("스파게티"는 "파스타"). spellings는 메뉴판에서 \
같은 메뉴를 부르는 다른 표기와 다른 이름이다("돈가스"는 ["돈까스", "돈카츠"], "사시미"는 \
value "회"에 ["사시미"]). 다른 메뉴나 더 넓은 말은 넣지 않고 없으면 빈 목록이다.
  - 뺀 메뉴("오이 빼고")는 want false다.
- hours: 영업시간 [{{"text", "day", "open_until", "open_from", "now"}}]. 없으면 빈 목록이다. \
요일과 시각을 함께 말하면 둘 다 담는다. day는 MON, TUE, WED, THU, FRI, SAT, SUN이고 없으면 \
null이다. open_until은 그 시각 이후까지 여는 곳이다("늦게까지"는 "23:00", "새벽까지"는 \
"02:00", "밤 10시까지"는 "22:00"). open_from은 그 시각 이전부터 여는 곳이다("아침 8시 전에 \
여는"은 "08:00"). 지금 여는 곳을 찾으면 now는 true다.
- price: 가격. 없으면 null이다. {{"text", "min_won", "max_won", "cheap"}}. "만원 이하"는 \
max_won 10000, "2만원대"는 min_won 20000과 max_won 29999다. 싼 곳을 찾으면 cheap은 true다.
- place_name: 가게 이름이나 체인 이름. 없으면 null이다. {{"text", "value"}}. value는 표준 \
이름이다("투썸"은 "투썸플레이스"). "○○ 같은 곳"처럼 비슷한 곳을 찾는 말은 가게 이름이 아니다.
- embedding_text: 장소 설명과 견줄 긍정형 검색어다. 리뷰에서 실제로 쓰는 말로 쓴다. \
지역(역, 동네, 근처)은 빼고 업종, 메뉴, 특징은 남긴다. 부정 표현은 바라는 쪽으로 바꾼다 \
("북적이는 데 말고"는 "조용한 곳", "줄 서는 데 싫어"는 "웨이팅 없이 바로 들어가는 곳", \
"안 매운"은 "담백한"). 비우지 않고 "찾고 있어요" 같은 말은 붙이지 않는다.
- change_summary: 이전 조건이 있을 때만 바뀐 점을 "~했어요"로 끝나는 짧은 한 문장으로 \
쓴다. 이전 조건이 없으면 null이다.

이전 조건이 있을 때
- 새 요청은 이전 검색을 고치는 말이다. 이전 조건은 새 요청의 뜻("그거 말고", "술집으로")을 \
알아듣는 데만 쓴다.
- 출력에는 새 요청에서 말한 것만 넣는다. 이전 조건의 지역, 특징, 메뉴를 다시 적지 않는다. \
이전 조건과 합치는 일은 따로 한다.
- embedding_text는 새 요청만 긍정형 검색어로 쓴다.

특징 코드표:
{chr(10).join(f"{code}: {CODE_PHRASES[code]}" for code in FEATURE_CODES)}

예시:
- "삼성역 근처 줄 안 서는 돈가스집" → categories [{{"code": "RESTAURANT", "want": true}}], \
locations [{{"text": "삼성역 근처", "kind": "STATION", "value": "삼성역"}}], \
features [{{"text": "줄 안 서는", "value": "웨이팅 없이 바로 들어가는 곳", "code": "SHORT_WAIT"}}], \
menus [{{"text": "돈가스", "value": "돈가스", "spellings": ["돈까스", "돈카츠"], "want": true}}], \
embedding_text "웨이팅 없이 바로 들어가는 돈가스집"
- "성수동 근처 북적이는 데 말고 대화하기 좋은 카페" → categories [{{"code": "CAFE", \
"want": true}}], locations [{{"text": "성수동 근처", "kind": "AREA", "value": "성수동"}}], \
features [{{"text": "북적이는 데 말고", "value": "조용한 곳", "code": "QUIET"}}, \
{{"text": "대화하기 좋은", "value": "대화하기 좋은 곳", "code": "PURPOSE_TALK"}}], \
embedding_text "조용하고 대화하기 좋은 카페"
- "건대잎구역 2번 출구 걸어서 3분 하이볼" → categories [{{"code": "BAR", "want": true}}], \
locations [{{"text": "건대잎구역 2번 출구 걸어서 3분", "kind": "STATION", "value": "건대입구역", \
"walk_minutes": 3, "exit": "2"}}], menus [{{"text": "하이볼", "value": "하이볼", "spellings": [], \
"want": true}}], embedding_text "하이볼 술집"
- "합정역 말고 망원역 쪽 저렴한 횟집 금요일 밤 10시까지" → categories [{{"code": \
"RESTAURANT", "want": true}}], locations [{{"text": "망원역 쪽", "kind": "STATION", \
"value": "망원역"}}], menus [{{"text": "횟집", "value": "회", "spellings": ["사시미"], "want": true}}], \
hours [{{"text": "금요일", "day": "FRI"}}, {{"text": "밤 10시까지", "open_until": "22:00"}}], \
price {{"text": "저렴한", "cheap": true}}, embedding_text "저렴한 횟집"
- "회사 앞 8명 송년회 예약되는 곳" → locations [{{"text": "회사 앞", "kind": "UNKNOWN"}}], \
features [{{"text": "송년회", "value": "단체 모임 하기 좋은 곳", "code": "PURPOSE_GROUP"}}], \
facilities ["RESERVATION"], party_size 8, embedding_text "8명이 송년회 하기 좋은 곳"
- "투썸 신논현 3번 출구" → categories [{{"code": "CAFE", "want": true}}], \
locations [{{"text": "신논현 3번 출구", "kind": "STATION", "value": "신논현역", \
"exit": "3"}}], place_name {{"text": "투썸", "value": "투썸플레이스"}}, \
embedding_text "투썸플레이스"
- "폴바셋 같은 디저트 카페" → categories [{{"code": "CAFE", "want": true}}], \
menus [{{"text": "디저트", "value": "디저트", "spellings": [], "want": true}}], \
embedding_text "폴바셋 같은 디저트 카페"
- "맵지 않은 떡볶이" → categories [{{"code": "RESTAURANT", "want": true}}], \
flavors [{{"code": "SPICY", "want": false}}], menus [{{"text": "떡볶이", "value": "떡볶이", \
"spellings": [], "want": true}}], embedding_text "순한 떡볶이"
- 이전 조건이 "을지로 조용한 술집"일 때 "술집 말고 빙수 맛집으로" → \
categories [{{"code": "CAFE", "want": true}}, {{"code": "BAR", "want": false}}], \
menus [{{"text": "빙수", "value": "빙수", "spellings": [], "want": true}}], \
embedding_text "빙수 맛집", change_summary "술집 대신 빙수 카페로 바꿨어요"

아래 형식의 JSON만 출력한다. 값이 없는 칸도 빼지 않는다.
{{"embedding_text": "<긍정형 검색어>", "categories": [], "locations": [], "features": [], \
"facilities": [], "party_size": null, "food_types": [], "flavors": [], "menus": [], \
"hours": [], "price": null, "place_name": null, "change_summary": null}}"""

"""요청 해석 시스템 지시. 예시 문장은 평가 질의(experiments/interpretation)와
겹치지 않게 고른다."""


_CLOCK = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d")
"""시간 조각의 시각 형식("HH:MM")"""


def _user_prompt(query: str, previous: Conditions | None) -> str:
    if previous is None:
        return f"요청: {query}"
    # 이전 조건은 LLM이 낼 꼴과 같게 보여 준다. 칸 이름이 다르면 LLM이 이전 역을 잇지
    # 못했다(2026-11-02 평가, 후속 12번 중 10번). 후보 추출용 문장은 보여 주지 않는다.
    data = {
        key: value for key, value in asdict(previous).items() if key != "embedding_text"
    }
    # 이전 조건은 FE가 돌려보낸 값이지만 읽을 때 모르는 코드는 이미 걸렀다.
    return "\n".join(
        [f"이전 조건: {json.dumps(data, ensure_ascii=False)}", f"새 요청: {query}"]
    )


def _parse(
    data: object, query: str, previous: Conditions | None
) -> tuple[Conditions, Conditions, str | None]:
    """LLM 출력(JSON을 읽은 값)을 조건으로 바꾼다. 형식이 틀리면 실패다.

    출력은 이번 요청의 분류별 조각이다. 모르는 코드는 버리고, 분류별 조각은 꼴이 틀린
    조각만 버린다. 2차 꼴(`codes`, `category_group`, `avoid_foods`)로 내도 읽는다. 읽은
    조각은 규칙으로 고치지 않고 그대로 조건으로 모은다(규칙 보정은 2026-11-05에 뺐다).
    후속이면 이전 조건과 합친다(`merge.merge`). 메시지는 로그에
    남으므로 출력 내용을 넣지 않는다.

    Returns:
        (이번 요청만 해석한 조건, 합친 조건, 바뀐 점)
    """
    if not isinstance(data, dict):
        raise TypeError("JSON 객체가 아니다")
    embedding_text = data.get("embedding_text")
    if not isinstance(embedding_text, str):
        raise TypeError("embedding_text가 문자열이 아니다")
    if not isinstance(data.get("codes", []), list):
        raise TypeError("codes가 목록이 아니다")
    # 위치 말이 없을 때 null을 내는 일이 잦아서 근처 검색이 아닌 것으로 본다.
    nearby = data.get("nearby") or False
    if not isinstance(nearby, bool):
        raise TypeError("nearby가 참거짓이 아니다")
    locations = _items(data.get("locations"), _location) or _legacy_locations(
        data.get("station"), nearby, previous
    )

    categories = [c for c in _choices(data.get("categories")) if c[0] in CATEGORY_NAMES]
    category_group = next((code for code, want in categories if want), None)
    if category_group is None and data.get("category_group") in CATEGORY_NAMES:
        category_group = data["category_group"]
    foods = [
        (FLAVOR_CODES.get(code, code), want)
        for code, want in (
            *_choices(data.get("food_types")),
            *_choices(data.get("flavors")),
        )
    ]
    features = _items(data.get("features"), _feature)
    codes = [
        *(f.code for f in features if isinstance(f, Feature)),
        *(c for c in _list(data.get("facilities")) if c in FACILITY_CODES),
        *(code for code, want in foods if want and code in FOOD_CODES),
        *(c for c in _list(data.get("codes")) if isinstance(c, str)),
    ]

    summary = None
    if previous is not None:
        summary = data.get("change_summary")
        if not _is_text(summary) or len(summary) > MAX_CHANGE_SUMMARY_LENGTH:
            summary = DEFAULT_CHANGE_SUMMARY
        # 이번 요청만 쓰라고 해도 이전 문장을 다시 낼 때가 있다(2차 평가 후속 12번 중
        # 2번, 2026-11-04 확인). 합칠 때 이전 문장 뒤에 붙으므로 이번 요청문으로 대신한다.
        if _repeats(embedding_text, previous.embedding_text, category_group):
            embedding_text = query
    # 짧은 요청에서 "..."처럼 글자 없는 문장을 내는 일이 있다(10-27 평가 216번 중
    # 12번). 그대로 인코딩하면 유사도가 무의미해져서 요청문으로 대신한다.
    if not any(ch.isalnum() for ch in embedding_text):
        embedding_text = query
    party_size = data.get("party_size")
    turn = _assemble(
        text=query,
        embedding_text=embedding_text,
        codes=codes,
        category_group=category_group,
        locations=locations,
        menus=_items(data.get("menus"), _menu),
        hours=_items(data.get("hours"), _hours),
        price=_price(data.get("price")),
        place_name=_place_name(data.get("place_name")),
        features=features,
        avoid_categories=tuple(
            dict.fromkeys(
                [code for code, want in categories if not want]
                + [
                    c
                    for c in _list(data.get("avoid_categories"))
                    if c in CATEGORY_NAMES
                ]
            )
        ),
        avoid_foods=tuple(
            dict.fromkeys(
                [code for code, want in foods if not want and code in FOOD_CODES]
                + [c for c in _list(data.get("avoid_foods")) if c in FOOD_CODES]
            )
        ),
        party_size=party_size
        if _won(party_size) and party_size <= MAX_PARTY_SIZE
        else None,
    )
    if previous is None:
        return turn, turn, None
    kept = set(_kept_codes(previous, query, list(turn.codes), turn.avoid_foods))
    merged = merge(previous, turn, [c for c in previous.codes if c not in kept])
    return turn, merged, summary


def _repeats(text: str, before: str, category_group: str | None) -> bool:
    """이전 벡터용 문장을 다시 쓴 것인지. 위치 말을 지운 낱말의 `REPEAT_SHARE` 이상이 이전
    문장에 있으면 다시 쓴 것으로 본다("4명이 회식하기 좋은 고깃집"과 "4명 회식하기 좋은
    고깃집")."""
    words = _without_location(text, category_group).split()
    seen = _plain_words(_without_location(before, category_group))
    if not words:
        return False
    shared = sum(any(w in s or s in w for s in seen) for w in map(_plain_word, words))
    return shared / len(words) >= REPEAT_SHARE


def _plain_words(text: str) -> list[str]:
    return [_plain_word(w) for w in text.split()]


def _plain_word(word: str) -> str:
    """조사 하나를 떼어 낸 낱말. "4명이"와 "4명"을 같은 낱말로 본다."""
    return re.sub(r"(?<=.)(?:이|가|을|를|은|는|에|에서|으로|로|도)$", "", word)


def _choices(data: object) -> list[tuple[str, bool]]:
    """코드 항목 목록(`[{"code", "want"}]`)을 읽는다. 꼴이 틀린 항목은 버린다."""
    return [
        (item["code"], item.get("want") is not False)
        for item in _list(data)
        if isinstance(item, dict) and isinstance(item.get("code"), str)
    ]


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


def _feature(data: dict) -> Feature | FeatureText | None:
    """LLM이 낸 특징을 읽는다. 특징 코드표의 코드가 있으면 코드 특징이고, 없으면 코드 없는
    특징이다. 2차 꼴의 `want`가 거짓이면 피하는 특징이다."""
    text = _segment(data.get("text"))
    if text is None:
        return None
    value = _segment(data.get("value")) or text
    if data.get("code") in FEATURE_CODES:
        return Feature(text, value, data["code"])
    return FeatureText(text, value, data.get("want") is not False)


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
