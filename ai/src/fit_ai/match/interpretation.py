"""요청 해석. 요청문을 BE가 장소를 거를 값과 정렬에 넘길 조건으로 바꾼다.

GMS를 한 번 부르고, 호출이 실패하거나 출력이 형식에 맞지 않으면 낱말 규칙으로
해석한다(인프라 설계 11.2). 후속 조건이면 이전 조건과 새 요청문을 합친다(검색 spec
D-50). 정리는 docs/comparison/spec.md 4.1에 있다.
"""

import json
import re
import time
from dataclasses import asdict, dataclass

from fit_ai.features import FEATURES
from fit_ai.match.conditions import CONDITIONS, Layer
from fit_ai.match.llm import LlmClient, LlmError, strip_json_fence
from fit_ai.match.place import CATEGORY_NAMES, STATION_NAMES

MAX_TEXT_LENGTH = 400
"""합친 요청문 길이 상한. 후속 조건이 쌓여도 정렬 LLM 입력이 커지지 않게 한다."""

MAX_CODES = 30
"""조건 코드 수 상한"""

MAX_CHANGE_SUMMARY_LENGTH = 60
"""LLM이 쓴 바뀐 점 문구의 길이 상한. 넘으면 기본 문구를 쓴다."""

DEFAULT_CHANGE_SUMMARY = "요청하신 조건을 반영했어요"
"""LLM이 바뀐 점을 쓰지 못했을 때의 문구. BE Mock과 같다."""

GROUP_SIZE = 4
"""이 인원 이상이면 모임(`PURPOSE_GROUP`)으로 본다. 임시 값이다."""

CODE_PHRASES: dict[str, str] = {
    **{code: feature.phrase for code, feature in FEATURES.items()},
    **{
        condition.id: condition.label
        for condition in CONDITIONS.values()
        if condition.layer is Layer.FACILITY
    },
}
"""해석이 낼 수 있는 조건 코드와 LLM에 보여 줄 문구. 취향 코드표와 시설 코드다."""

SYSTEM_PROMPT = f"""\
너는 장소 검색 서비스의 요청 해석기다. 사용자의 검색 요청을 조건으로 바꾼다.
- category_group: RESTAURANT(식당), CAFE(카페), BAR(술집) 중 하나. \
음식 종류나 메뉴(한식, 라멘, 파스타, 국물 요리 등)를 말하면 RESTAURANT다. \
술 마시는 곳(이자카야, 포차, 호프, 와인바, 칵테일바, 루프탑 바 등)은 BAR다. \
커피나 디저트를 먹는 곳은 CAFE다. 알 수 없으면 null.
- station: GANGNAM(강남역), YEOKSAM(역삼역), SEOLLEUNG(선릉역) 중 하나. \
요청에 없으면 null.
- nearby: 역 이름 없이 "근처", "주변"처럼 지금 있는 곳을 기준으로 찾으면 true, \
아니면 false다. null을 쓰지 않는다. "강남역 근처"는 false다.
- codes: 아래 코드표에서 요청에 있는 조건을 빠짐없이 고른다. 없으면 빈 목록이다. \
"시끄러운 곳 말고"처럼 부정한 조건도 바라는 쪽 코드(QUIET)로 반드시 넣는다. \
메뉴는 음식 종류 코드로 바꾼다(라멘·초밥은 FOOD_JAPANESE, 파스타·스테이크는 \
FOOD_WESTERN, 쌀국수·팟타이는 FOOD_ASIAN, 짜장면·마라탕은 FOOD_CHINESE). \
국물 요리, 고기, 면 요리처럼 어느 나라 음식인지 모르는 말에는 음식 종류 코드를 \
넣지 않는다. \
인원은 1명이면 PURPOSE_SOLO, {GROUP_SIZE}명 이상이면 PURPOSE_GROUP으로 바꾼다.
- codes에는 요청에 없는 조건을 넣지 않는다. "식당"이라는 말만으로 음식 종류 코드를, \
"모임", "회식", 인원만으로 시설 GROUP을 넣지 않는다. GROUP은 단체석, 단체 예약처럼 \
시설을 말할 때만 넣는다.
- embedding_text: 요청을 긍정형 한 문장으로 쓴다. \
부정 표현은 바라는 쪽으로 바꾼다("시끄러운 곳 말고" → "조용한 곳").
- 이전 조건이 있으면 새 요청은 이전 조건에 더하거나 바꾸는 말이다. \
둘을 합친 조건을 낸다. "A 말고 B"는 A를 빼고 B를 넣는다. \
text는 합친 요청을 한 문장으로, \
change_summary는 바뀐 점을 "~했어요"로 끝나는 짧은 한 문장으로 쓴다.
- 이전 조건이 없으면 text와 change_summary는 null이다.

코드표:
{chr(10).join(f"{code}: {phrase}" for code, phrase in CODE_PHRASES.items())}

예시:
- "선릉역 라멘집" → codes ["FOOD_JAPANESE"], category_group "RESTAURANT", \
station "SEOLLEUNG"
- "북적이는 데 말고 공부할 카페" → codes ["QUIET", "PURPOSE_WORK"], \
category_group "CAFE", embedding_text "조용하고 공부하기 좋은 카페"
- "역삼 포차" → codes [], category_group "BAR", station "YEOKSAM"
- "주차 되는 카페" → codes ["PARKING"], category_group "CAFE"
- "강남 5명 저녁 먹을 데" → codes ["PURPOSE_GROUP"], category_group "RESTAURANT", \
station "GANGNAM"

아래 형식의 JSON만 출력한다.
{{"text": null, "embedding_text": "...", "codes": [], "category_group": null, \
"station": null, "nearby": false, "change_summary": null}}"""
"""요청 해석 시스템 지시. 예시 문장은 평가 질의(experiments/interpretation)와
겹치지 않게 고른다."""

STATION_WORDS = {"강남": "GANGNAM", "역삼": "YEOKSAM", "선릉": "SEOLLEUNG"}
"""규칙 해석에서 역을 찾는 낱말"""

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
"카페 맛집"처럼 업종 이름이 함께 있으면 업종 이름을 따른다. 음식 낱말은 식당이다."""

NEARBY_WORDS = ("근처", "주변", "가까운")
"""규칙 해석에서 근처 검색을 찾는 낱말. 역 이름과 함께 있으면 근처 검색이 아니다."""

CODE_WORDS = {
    "QUIET": ("조용", "차분"),
    "LIVELY": ("활기", "북적"),
    "SPACIOUS_SEATING": ("넓은", "넓고", "자리 넉넉", "자리가 넉넉"),
    "SHORT_WAIT": ("웨이팅", "대기", "기다리지"),
    "GENEROUS_PORTION": ("양 많", "양이 많", "푸짐"),
    "PRETTY_SPACE": ("예쁜", "인테리어"),
    "VIEW_OUTDOOR": ("전망", "야외", "테라스", "루프탑"),
    "COZY": ("아늑",),
    "VALUE_FOR_MONEY": ("가성비", "저렴"),
    "PURPOSE_TALK": ("대화", "이야기 나누", "수다"),
    "PURPOSE_SOLO": ("혼밥", "혼술", "혼자"),
    "PURPOSE_DATE": ("데이트", "기념일", "특별한 날"),
    "PURPOSE_GROUP": ("모임", "단체", "회식"),
    "PURPOSE_WORK": ("작업", "공부", "노트북", "카공"),
    "FOOD_KOREAN": ("한식",),
    "FOOD_JAPANESE": ("일식", "초밥", "스시", "라멘"),
    "FOOD_CHINESE": ("중식", "중국집"),
    "FOOD_WESTERN": ("양식", "파스타", "스테이크"),
    "FOOD_ASIAN": ("아시안", "쌀국수"),
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
찾는다."""

_NEGATED = re.compile(r"\S+\s*(?:말고|대신|아니고)")
""""카페 말고 술집"의 "카페 말고"처럼 빼 달라는 말. 업종과 역을 찾을 때 지운다."""

_PEOPLE = re.compile(r"(\d+)\s*(?:명|인)")

FACILITY_PHRASES = {
    "PARKING": ("주차할 수 있는", "주차"),
    "WIFI": ("와이파이가 되는", "와이파이"),
    "GROUP": ("단체로 갈 수 있는", "단체"),
    "RESERVATION": ("예약할 수 있는", "예약"),
}
"""결과가 없을 때 문구에 쓰는 시설 말. (원인 문구, 제안 문구)다."""


@dataclass(frozen=True)
class Conditions:
    """해석한 검색 조건. FE가 다음 후속 조건 때 그대로 돌려보낸다.

    Attributes:
        text: 정렬 LLM에 넣을 요청문. 후속 조건이면 이전 요청과 합친 한 문장이다.
        embedding_text: 후보 추출에 쓸 문장. 부정 표현을 긍정형으로 바꿨다.
        codes: 요청 조건 코드. 취향 코드표의 코드와 시설 코드다.
            인원은 목적 코드로 바꿨다.
        category_group: 업종. 요청에 없으면 None이다.
        station: 역. 요청에 없으면 None이다.
        nearby: 근처 검색인지
    """

    text: str
    embedding_text: str
    codes: tuple[str, ...] = ()
    category_group: str | None = None
    station: str | None = None
    nearby: bool = False

    @property
    def facilities(self) -> tuple[str, ...]:
        """요청한 시설 코드. BE가 그 시설이 없다고 확인된 장소를 뺀다."""
        return tuple(
            code
            for code in self.codes
            if code in CONDITIONS and CONDITIONS[code].layer is Layer.FACILITY
        )


@dataclass(frozen=True)
class Interpretation:
    """요청 해석 결과.

    Attributes:
        conditions: 해석한 조건
        change_summary: 후속 조건에서 바뀐 점. 새 검색이면 None이다.
        llm_error: 규칙으로 해석한 이유. LLM으로 해석했으면 None이다.
        llm_seconds: LLM 호출에 걸린 시간(초)
    """

    conditions: Conditions
    change_summary: str | None
    llm_error: str | None = None
    llm_seconds: float | None = None


@dataclass(frozen=True)
class EmptyReason:
    """결과가 없을 때의 원인과 제안. BE `EmptyReason`과 같다.

    Attributes:
        cause: 원인
        suggestion: 수정 제안
    """

    cause: str
    suggestion: str


def interpret(
    llm: LlmClient, query: str, previous: Conditions | None = None
) -> Interpretation:
    """요청문을 조건으로 바꾼다. LLM이 실패하면 규칙으로 해석한다.

    Args:
        llm: LLM
        query: 사용자가 이번에 입력한 요청문
        previous: 후속 조건이면 기준 요청의 조건. 새 검색이면 None이다.

    Returns:
        해석 결과
    """
    seconds = None
    start = time.perf_counter()
    try:
        try:
            raw = llm.complete_json(SYSTEM_PROMPT, _user_prompt(query, previous))
        finally:
            seconds = time.perf_counter() - start
        conditions, summary = _parse(raw, query, previous)
    except LlmError as e:
        return _by_rules(query, previous, f"LLM 호출이 실패했다: {e}", seconds)
    except (ValueError, TypeError) as e:
        return _by_rules(query, previous, str(e), seconds)
    return Interpretation(conditions, summary, llm_seconds=seconds)


def interpret_by_rules(query: str, previous: Conditions | None = None) -> Conditions:
    """낱말 규칙으로 해석한다. LLM이 실패했을 때 쓴다.

    부정 표현("시끄러운 곳 말고")은 알아듣지 못한다. 후속 조건이면 이전 조건에 새 코드를
    더하고, 업종과 역은 새 요청에 있을 때만 바꾼다.

    Args:
        query: 사용자가 이번에 입력한 요청문
        previous: 후속 조건이면 기준 요청의 조건

    Returns:
        해석한 조건
    """
    codes = [code for code, words in CODE_WORDS.items() if _has(query, words)]
    for count in _PEOPLE.findall(query):
        if int(count) == 1:
            codes.append("PURPOSE_SOLO")
        elif int(count) >= GROUP_SIZE:
            codes.append("PURPOSE_GROUP")
    # "카페 말고 술집으로"에서 카페를 고르지 않도록 빼 달라는 말은 지우고 찾는다.
    wanted = _NEGATED.sub(" ", query)
    category_group = _first(CATEGORY_WORDS, wanted)
    station = _first(STATION_WORDS, wanted)
    # "강남역 근처"는 역을 기준으로 찾는 말이다.
    nearby = station is None and _has(query, NEARBY_WORDS)
    if previous is None:
        return Conditions(
            query, query, _known_codes(codes), category_group, station, nearby
        )
    return Conditions(
        text=_join(previous.text, query),
        embedding_text=_join(previous.embedding_text, query),
        codes=_known_codes([*previous.codes, *codes]),
        category_group=category_group or previous.category_group,
        station=station or previous.station,
        nearby=nearby or previous.nearby,
    )


def empty_reason(conditions: Conditions, in_map_bounds: bool) -> EmptyReason:
    """뽑힌 장소가 없을 때 원인과 제안을 만든다.

    Args:
        conditions: 해석한 조건
        in_map_bounds: 역 대신 지도 영역으로 걸렀는지

    Returns:
        원인과 제안
    """
    where = None
    if in_map_bounds:
        where = "이 지역"
    elif conditions.station and not conditions.nearby:
        where = STATION_NAMES[conditions.station]
    what = CATEGORY_NAMES.get(conditions.category_group or "", "가게")
    scope = f"{where} {what}" if where else what
    facilities = conditions.facilities
    if len(facilities) == 1:
        phrase, name = FACILITY_PHRASES[facilities[0]]
        return EmptyReason(
            f"{scope} 중 {phrase} 곳이 없어요", f"{name} 조건을 빼고 다시 찾아 보세요"
        )
    if facilities:
        return EmptyReason(
            f"{scope} 중 요청한 시설을 모두 갖춘 곳이 없어요",
            "시설 조건을 줄여서 다시 찾아 보세요",
        )
    if in_map_bounds:
        return EmptyReason(
            f"{scope} 중 조건에 맞는 곳이 없어요",
            "지도를 옮기거나 넓혀서 다시 찾아 보세요",
        )
    return EmptyReason(
        f"{scope} 중 조건에 맞는 곳이 없어요", "다른 역이나 업종으로 다시 찾아 보세요"
    )


def _by_rules(
    query: str, previous: Conditions | None, error: str, seconds: float | None
) -> Interpretation:
    return Interpretation(
        conditions=interpret_by_rules(query, previous),
        change_summary=None if previous is None else DEFAULT_CHANGE_SUMMARY,
        llm_error=error,
        llm_seconds=seconds,
    )


def _user_prompt(query: str, previous: Conditions | None) -> str:
    if previous is None:
        return f"요청: {query}"
    data = asdict(previous)
    # 후보 추출용 문장은 LLM이 새로 쓰므로 보여 주지 않는다.
    del data["embedding_text"]
    return "\n".join(
        [f"이전 조건: {json.dumps(data, ensure_ascii=False)}", f"새 요청: {query}"]
    )


def _parse(
    raw: str, query: str, previous: Conditions | None
) -> tuple[Conditions, str | None]:
    """LLM 출력을 조건으로 바꾼다. 형식이 틀리면 실패다.

    모르는 코드는 버리고, 모르는 업종·역은 거르지 않도록 None으로 본다.
    메시지는 로그에 남으므로 출력 내용을 넣지 않는다.
    """
    data = json.loads(strip_json_fence(raw))
    if not isinstance(data, dict):
        raise TypeError("JSON 객체가 아니다")
    embedding_text = data.get("embedding_text")
    if not _is_text(embedding_text):
        raise ValueError("embedding_text가 없다")
    codes = data.get("codes", [])
    if not isinstance(codes, list):
        raise TypeError("codes가 목록이 아니다")
    # 위치 말이 없을 때 null을 내는 일이 잦아서 근처 검색이 아닌 것으로 본다.
    nearby = data.get("nearby") or False
    if not isinstance(nearby, bool):
        raise TypeError("nearby가 참거짓이 아니다")

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
    category_group = data.get("category_group")
    station = data.get("station") if data.get("station") in STATION_NAMES else None
    # "강남역 근처"는 역을 기준으로 찾는 말이다. LLM이 헷갈려도 역이 있으면 근처 검색이
    # 아니다(규칙 해석과 같다).
    nearby = nearby and station is None
    conditions = Conditions(
        text=text.strip()[:MAX_TEXT_LENGTH],
        embedding_text=embedding_text.strip()[:MAX_TEXT_LENGTH],
        codes=_known_codes(codes),
        category_group=category_group if category_group in CATEGORY_NAMES else None,
        station=station,
        nearby=nearby,
    )
    return conditions, summary


def _known_codes(codes: list) -> tuple[str, ...]:
    """아는 코드만 처음 나온 순서대로 한 번씩 남긴다."""
    known = [code for code in codes if isinstance(code, str) and code in CODE_PHRASES]
    return tuple(dict.fromkeys(known))[:MAX_CODES]


def _join(before: str, after: str) -> str:
    """이전 문장 뒤에 새 요청을 붙인다. 너무 길면 새 요청만 남긴다."""
    joined = f"{before} {after}"
    return joined if len(joined) <= MAX_TEXT_LENGTH else after[:MAX_TEXT_LENGTH]


def _first(words: dict[str, str], query: str) -> str | None:
    return next((value for word, value in words.items() if word in query), None)


def _has(query: str, words: tuple[str, ...]) -> bool:
    return any(word in query for word in words)


def _is_text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())
