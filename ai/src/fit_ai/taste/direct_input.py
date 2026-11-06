"""직접 입력 → 근거 장부 행(spec 1·2단계). LLM 해석을 코드 규칙으로 다시 검사한다."""

import unicodedata
from collections.abc import Callable

from fit_ai import gms
from fit_ai.features import FEATURES
from fit_ai.taste.profile import Row

MAX_LEN = 100  # 온보딩 직접 입력 상한(PRD FR-06)
MAX_CHIPS = 10  # BE `Preferences.tastes` 상한
MAX_LABEL = 20  # BE `TasteChip.label` 상한. Java처럼 UTF-16 단위로 센다

MODEL = "gpt-6-luna"
"""해석 모델. 합성 test 108개를 3번씩: gpt-4o-mini 평균 0.838~0.869·완전 일치 87~90개에서
0.921~0.935·98~100개가 됐다. 주로 부정·불만 문장을 코드 없는 비선호로 흘리던 실수가 줄었다
(2026-11-06, ai/experiments/prompt_opt/README.md)."""

REASONING_EFFORT = "none"
"""추론 강도. `none`은 p95 1.87초로 gpt-4o-mini(2.34초)보다 빨랐다. `low`·`medium`은 정확도가
비슷하거나 조금 높지만 응답 324개 중 35·68개가 3초를 넘었다. 입력을 멈추면 바로 칩을 띄우는
화면이라 `none`으로 둔다. 이 모델은 temperature 0을 받지 않아 temperature는 보내지 않는다."""

# 프롬프트는 라벨 설명을 붙인 제로샷 지시(Gen-Z, arXiv 2311.07115)를 GEPA로 최적화한 것이다
# (S15P31A302-107, ai/experiments/prompt_opt). 합성 test 108개 평균이 0.675에서 0.849가 됐다.
# 예시 일부는 GEPA 학습 문장이다. 문구를 고치면 같은 test로 다시 재고 바꾼다.
# LLM은 부정에 약해서(arXiv 2306.08189) like는 parse_items에서 코드 규칙으로 다시 검사한다.
_CODES = "\n".join(
    f"- {f.code} [{f.layer}] {f.label}: {f.phrase}" for f in FEATURES.values()
)
_TEMPLATE = """너는 사용자가 음식점·카페·술집 취향을 적은 한국어 문장을 읽고, 명시적으로 드러난 “가게 선택 기준/취향”을 코드표의 코드로 해석한다.

입력:
- 사용자의 자유 문장(text)

출력:
- 반드시 JSON 객체만 출력한다.
- JSON 외의 설명, 마크다운, 주석은 절대 출력하지 않는다.
- 형식:
{
  "items": [
    {
      "quote": "입력에서 그대로 따온 구절",
      "kind": "taste | facility | quality | budget",
      "like": true 또는 false,
      "code": "코드표에 있는 코드" 또는 null,
      "positive_text": "코드가 없는 긍정 취향을 설명하는 구" 또는 null
    }
  ]
}
- 해당하는 항목이 없으면 {"items": []}를 출력한다.

코드표:
{{codes}}

핵심 원칙:
1. code에는 반드시 코드표에 실제로 있는 코드만 쓴다. 코드표에 없는 코드를 만들지 않는다.
2. 입력에 명시되지 않은 내용은 추론해서 만들지 않는다.
3. 입력을 의미 단위로 최대한 잘게 쪼갠다. 한 item에는 코드 하나만 붙인다.
   - 하나의 구절 안에 여러 취향이 섞여 있으면 각각 별도 item으로 만든다.
   - 특히 “수식어 + 음식 카테고리” 형태는 분리한다.
   - 예: "가성비 좋은 한식" →
     1) "가성비 좋은" → taste, VALUE_FOR_MONEY, like true
     2) "한식" → taste, FOOD_KOREAN, like true
4. quote는 반드시 입력 문장에서 그대로 가져온 구절이어야 한다.
   - 분리 가능한 경우 해당 의미에 해당하는 최소 구절을 quote로 쓴다.
5. 같은 의미를 중복 출력하지 않는다.
6. 단순 잡담이나 음식점·카페·술집 선택 취향으로 볼 수 없는 문장은 출력하지 않는다.
7. 부정 표현은 표면만 보지 말고 사용자가 실제로 원하는 조건이 무엇인지 해석한다.
   - "시끄러운 데 싫어요" → 조용한 곳을 원하는 것 → QUIET, like true
   - "주차 안 되면 싫어요" → 주차 가능을 원하는 것 → facility, like true
   - "줄 서서 먹는 건 싫어요" → 짧은 대기를 원하는 것 → SHORT_WAIT, like true
   - "양 적게 주는 곳은 별로예요" → 넉넉한 양을 원하는 것 → GENEROUS_PORTION, like true

항목을 만들지 말아야 하는 경우:
- 사용자가 특정 취향이나 조건을 말한 것이 아니라 “제약 없음/아무거나 가능”을 말한 경우는 항목을 만들지 않는다.
- 예:
  - "아무거나 잘 먹어요"
  - "뭐든 잘 먹어요"
  - "가리는 거 없어요"
  - "다 괜찮아요"
  - "상관없어요"
  - "딱히 취향 없어요"
  - "주차 없어도 돼요"
  - "웨이팅 있어도 괜찮아요"
- 이런 문장을 positive_text로 바꾸지 않는다.
- 단, 같은 문장 안에 별도의 명시적 선호가 있으면 그 부분만 항목으로 만든다.
  - 예: "아무거나 잘 먹는데 조용한 곳이 좋아요" → QUIET만 출력

kind 판정:
1. facility
   - 있다/없다, 가능/불가능으로 갈리는 편의시설이나 설비
   - 예: 주차, 콘센트, 와이파이, 키즈존, 반려동물 동반, 강아지 동반, 룸, 좌석 유무, 예약 가능 여부
   - facility 항목은 code null, positive_text null
   - like는 “그 시설/기능이 있는 상태를 원하는가” 기준
     - 시설이 있거나 가능하기를 원함 → like true
     - 시설이 있거나 가능한 상태를 싫어함/피함 → like false
     - 시설 부재를 싫어함 → 그 시설을 원하는 것 → like true
   - 예:
     - "강아지 데려갈 수 있는 곳" → facility, like true
     - "주차 되는 곳 좋아요" → facility, like true
     - "주차 안 되면 싫어요" → facility, like true
     - "콘센트 없으면 불편해요" → facility, like true
     - "반려동물 동반 가능한 곳은 피하고 싶어요" → facility, like false

2. quality
   - 맛, 친절, 청결, 서비스처럼 범용적인 품질 평가
   - 예: "맛있는 곳", "친절한 곳", "깨끗한 곳", "불친절한 곳", "맛없는 곳"
   - quality 항목은 code null, positive_text null
   - like는 원문에서 언급된 품질 표현에 대한 태도를 따른다.
   - 예:
     - "맛있는 곳 좋아요" → quality, like true
     - "친절한 곳이 좋아요" → quality, like true
     - "친절하면 더 좋고" → quality, like true
     - "깨끗한 곳이면 돼요" → quality, like true
     - "불친절한 곳 싫어요" → quality, like false
     - "맛없는 집은 피하고 싶어요" → quality, like false

3. budget
   - 가격, 예산, 지출 한도, 저렴함, 비쌈 등 금액 자체가 중심인 조건
   - budget 항목은 code null, positive_text null
   - like는 원문에서 언급된 가격/예산 조건에 대한 태도를 따른다.
   - 예:
     - "저렴한 곳 좋아요" → budget, like true
     - "2만 원 이하였으면 좋겠어요" → budget, like true
     - "2만원 넘지 않게" → budget, like true
     - "비싼 곳은 싫어요" → budget, like false
     - "2만 원 넘는 곳은 부담돼요" → budget, like false

4. taste
   - facility, quality, budget이 아닌 음식점·카페·술집 취향
   - 분위기, 목적, 음식 종류, 맛 성향, 양, 좌석 분위기, 웨이팅/대기 시간, 가성비 같은 선택 기준 등
   - 코드표에 맞는 코드가 있으면 code를 붙인다.
   - 코드가 없고 좋아하는 취향이면 positive_text를 작성한다.
   - 코드가 없고 싫어하는 취향이면 positive_text null

가성비와 가격 구분:
- “가성비”, “가격 대비 만족”, “가격 대비 퀄리티”, “돈값”, “가격 대비 양/맛이 좋다”처럼 단순히 싸다는 뜻이 아니라 가격 대비 만족도를 말하면, 코드표에 VALUE_FOR_MONEY가 있을 경우 taste, VALUE_FOR_MONEY로 출력한다.
  - 예: "가성비 좋은 곳" → taste, VALUE_FOR_MONEY, like true
  - 예: "가성비 좋은 한식" →
    1) "가성비 좋은" → taste, VALUE_FOR_MONEY, like true
    2) "한식" → taste, FOOD_KOREAN, like true
- “저렴한”, “싸다”, “비싸다”, “예산”, “몇 원 이하/이상”처럼 금액 자체가 중심이면 budget, code null이다.

taste 항목의 code 판정:
1. 표현이 달라도 뜻이 코드 설명과 맞으면 해당 코드를 붙인다.
   - "양 많이 주는 집이 최고" → GENEROUS_PORTION, like true
   - "가성비 좋은 곳" → VALUE_FOR_MONEY, like true
2. like는 원문의 긍정/부정 표면이 아니라 “해당 코드 설명 같은 곳을 원하는가” 기준이다.
   - 코드 설명 같은 곳을 원하면 true
   - 코드 설명 같은 곳 자체를 싫어하면 false
3. 사용자가 어떤 특성을 싫어하지만, 그 반대 특성의 코드가 있고 그 반대를 원하는 뜻이면 반대 코드에 like true를 붙인다.
   - "시끄러운 데 싫어요" → QUIET, like true
   - "시끌벅적한 술집은 피곤해요" → QUIET, like true
   - "너무 활기찬 데는 기 빨려요" → QUIET, like true
   - "좁은 데는 답답해요" → SPACIOUS_SEATING, like true
4. 사용자가 코드 설명 자체를 싫어하면 해당 코드에 like false를 붙인다.
   - "양식은 별로예요" → FOOD_WESTERN, like false
   - "조용한 곳은 답답해요" → QUIET, like false 또는 반대 극 코드가 명확히 있으면 LIVELY, like true
5. 반대 극(axis) 코드가 명확히 있으면, 싫어하는 극 대신 원하는 반대 극 하나만 출력한다.
   - QUIET와 LIVELY가 모두 코드표에 있고 서로 반대 극이면:
     - "조용한 데보다 북적이는 데가 좋아요" → LIVELY, like true
6. 코드가 “좋은 상태/선호되는 조건”을 나타내는 경우, 그 반대의 나쁜 상태를 싫어하는 말은 code false가 아니라 code true로 출력한다.
   - "양 적게 주는 곳은 별로예요" → GENEROUS_PORTION, like true
   - "양이 너무 적으면 싫어요" → GENEROUS_PORTION, like true
   - "대기 긴 곳은 싫어요" → SHORT_WAIT, like true
   - "좁은 곳은 싫어요" → SPACIOUS_SEATING, like true
7. 반대로, 코드 설명 그 자체를 싫어하는 경우에만 해당 code에 like false를 붙인다.
   - "양 많은 곳은 부담스러워요" → GENEROUS_PORTION, like false
   - "너무 넓은 곳은 싫어요" → SPACIOUS_SEATING, like false

음식 종류 코드 규칙:
- FOOD_KOREAN, FOOD_JAPANESE, FOOD_CHINESE, FOOD_WESTERN, FOOD_ASIAN 같은 음식 종류 코드는 음식 종류/카테고리 자체를 직접 말할 때만 붙인다.
- 음식 종류/카테고리의 직접 표현에는 다음도 포함한다.
  - "한식", "한식집", "한국 음식", "한식당" → FOOD_KOREAN
  - "일식", "일식집", "일본 음식", "일식당" → FOOD_JAPANESE
  - "중식", "중국 음식", "중국집", "중화요리", "중화요리집", "중식당" → FOOD_CHINESE
  - "양식", "양식집", "서양 음식", "이탈리안/프렌치 등 양식 카테고리 표현" → FOOD_WESTERN, 단 코드표에 더 정확한 코드가 없을 때만
  - "아시안 음식", "동남아 음식", "베트남/태국 등 아시안 카테고리 표현" → FOOD_ASIAN, 단 코드표에 더 정확한 코드가 없을 때만
- 음식 카테고리가 부정으로 표현되어도 카테고리 코드가 있으면 그 코드에 like false를 붙인다.
  - "중국집은 안 가요" → taste, FOOD_CHINESE, like false
  - "중식은 별로예요" → taste, FOOD_CHINESE, like false
  - "양식은 싫어요" → taste, FOOD_WESTERN, like false
- 음식 카테고리가 다른 조건과 함께 한 구절 안에 있어도 반드시 별도 item으로 추출한다.
  - "가성비 좋은 한식, 친절하면 더 좋고" →
    1) "가성비 좋은" → taste, VALUE_FOR_MONEY, like true
    2) "한식" → taste, FOOD_KOREAN, like true
    3) "친절하면 더 좋고" → quality, code null, like true
- 구체적인 메뉴명, 재료명, 특정 음식명은 음식 종류 코드로 일반화하지 않는다.
  - 특정 메뉴를 보고 임의로 FOOD_ASIAN, FOOD_KOREAN, FOOD_JAPANESE, FOOD_CHINESE 등으로 추론하지 않는다.
  - 예:
    - "곱창은 못 먹어요" → taste, code null, like false, positive_text null
    - "마라탕 좋아해요" → taste, code null, like true, positive_text "마라탕을 먹을 수 있는 곳"
    - "떡볶이 먹고 싶어요" → taste, code null, like true, positive_text "떡볶이를 먹을 수 있는 곳"
    - "초밥 좋아해요" → taste, code null, like true, positive_text "초밥을 먹을 수 있는 곳"
    - "파스타 싫어요" → taste, code null, like false, positive_text null
- 단, "중국집", "일식집", "한식집"처럼 특정 메뉴가 아니라 음식점 카테고리를 직접 말한 표현은 음식 종류 코드로 매핑한다.

웨이팅/대기 시간 규칙:
- “줄 서다”, “웨이팅”, “대기”, “기다리다”, “오래 기다리다”와 관련된 표현은 음식점·카페·술집 선택 기준이므로 taste로 처리한다.
- 코드표에 SHORT_WAIT가 있으면, 대기 시간이 짧거나 웨이팅이 적은 곳을 뜻하는 표현은 SHORT_WAIT로 매핑한다.
- 긴 줄/긴 웨이팅/오래 기다림을 싫어하는 표현도 실제 원하는 조건은 짧은 대기이므로 SHORT_WAIT, like true로 출력한다.
- code가 있으면 positive_text는 null이다.
- 예:
  - "웨이팅 짧은 곳 좋아요" → taste, SHORT_WAIT, like true
  - "대기 없는 곳이 좋아요" → taste, SHORT_WAIT, like true
  - "줄 서서 먹는 건 진짜 싫어요" → taste, SHORT_WAIT, like true
  - "오래 기다리는 맛집은 피곤해요" → taste, SHORT_WAIT, like true
- 단순히 “웨이팅 있어도 괜찮아요”처럼 제약이 없다는 뜻이면 항목을 만들지 않는다.

positive_text 규칙:
- positive_text는 taste 항목 중, 좋아하는 취향이지만 코드표에 맞는 코드가 없을 때만 쓴다.
- code가 있으면 positive_text는 null로 둔다.
- facility, quality, budget은 positive_text를 쓰지 않는다.
- 싫어하는 취향인데 코드표에 맞는 코드도 없고 반대 코드로 바꿀 수도 없으면 positive_text는 null로 둔다.
- positive_text는 원문의 뜻을 빠뜨리지 않고, 코드 설명처럼 자연스러운 한국어 구로 쓴다.
- 가능하면 “곳”으로 끝낸다.
  - "루프탑에서 맥주 마시는 거 좋아해요" → "루프탑에서 맥주를 마실 수 있는 곳"
  - "새벽까지 하는 술집 좋아요" → "새벽까지 영업하는 술집"
  - "비 오는 날엔 따뜻한 국수가 당겨요" → "비 오는 날 따뜻한 국수를 먹을 수 있는 곳"

최종 점검:
- 모든 item은 quote, kind, like, code, positive_text를 포함해야 한다.
- quote는 원문 그대로의 부분 문자열이어야 한다.
- code가 null이 아닌 경우 반드시 코드표에 있는 코드여야 한다.
- facility, quality, budget은 항상 code null, positive_text null이다.
- taste에서 code가 있으면 positive_text null이다.
- “중국집은 안 가요”처럼 음식점 카테고리를 직접 거부하는 문장은 code null로 두지 말고, 해당 음식 종류 코드가 코드표에 있으면 반드시 매핑한다."""
_SYSTEM = _TEMPLATE.replace("{{codes}}", _CODES)

# 항목 종류. 벡터로 만들 취향 문장인지를 조건부 지시 대신 분류 필드로 받는다
KINDS = ("taste", "facility", "quality", "budget")
_NULLABLE_STR = {"type": ["string", "null"]}
# strict 스키마로 응답 모양과 코드 범위를 강제한다. JSON 모드는 스키마를 보장하지 않는다
RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "taste_items",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["items"],
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        # 종류와 코드를 먼저 정하고 그 코드 기준으로 like를 정하게 순서를 둔다
                        "required": ["quote", "kind", "code", "like", "positive_text"],
                        "properties": {
                            "quote": {"type": "string"},
                            "kind": {"type": "string", "enum": list(KINDS)},
                            "code": _NULLABLE_STR | {"enum": [*FEATURES, None]},
                            "like": {"type": "boolean"},
                            "positive_text": _NULLABLE_STR,
                        },
                    },
                }
            },
        },
    },
}


def build_messages(text: str) -> list[dict]:
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": text}]


def _check(item: object) -> dict:
    """모양이 틀리면 TypeError. GMS 호출이 한 번 다시 요청하게 된다."""
    ok = (
        isinstance(item, dict)
        and {"quote", "kind", "like", "code", "positive_text"} <= item.keys()
        and isinstance(item["quote"], str)
        and item["kind"] in KINDS
        and isinstance(item["like"], bool)
        and isinstance(item["code"], str | None)
        and isinstance(item["positive_text"], str | None)
    )
    if not ok:
        raise TypeError("응답 항목 모양이 다르다")
    return item


def parse_items(resp: dict, text: str) -> list[dict]:
    """원문에 없는 구절과 코드표에 없는 코드는 버리고, 비선호 규칙을 코드로 다시 정한다."""
    if not isinstance(resp, dict) or not isinstance(resp.get("items"), list):
        raise TypeError("응답에 items 목록이 없다")
    out = []
    for raw in resp["items"]:
        it = _check(raw)
        quote, like, code = it["quote"], it["like"], it["code"]
        # 빈 구절은 어떤 원문에도 들어 있어 대조를 통과하므로 따로 버린다
        if not quote.strip() or quote not in text:
            continue
        if code is not None and code not in FEATURES:
            continue
        if it["kind"] != "taste":  # 시설·품질·예산은 취향 코드로 세지 않는다
            code = None
        if code and not like:
            feature = FEATURES[code]
            if feature.opposite:  # 반대 극 비선호는 반대 극 선호로
                code, like = feature.opposite, True
            # 중요 기준·방문 목적은 싫어하는 방향이 없어 문장으로만 남긴다(D-06)
            elif feature.layer in ("importance", "purpose"):
                code = None
        # 벡터로 만들 문장은 좋아하는 취향(taste)뿐이다. 시설·품질·예산은 보관만 한다
        keep_text = it["kind"] == "taste" and like
        positive_text = it["positive_text"] if keep_text else None
        # 코드도 문장도 없는 선호 취향은 비교에 쓸 수 없어 출력 검사 실패로 다시 요청한다
        if keep_text and not code and not (positive_text or "").strip():
            raise ValueError("코드 없는 선호 취향에 positive_text가 없다")
        out.append(
            {
                "quote": quote,
                "kind": it["kind"],
                "like": like,
                "code": code,
                "positive_text": positive_text,
            }
        )
    # 모델이 준 항목이 검사에서 모두 버려졌으면 형식 실수로 취향을 잃은 것이다.
    # 출력 검사 실패로 알려 다시 요청하고, 그래도 실패하면 해석 실패다
    if resp["items"] and not out:
        raise ValueError("응답 항목이 모두 검사에서 버려졌다")
    return out


def interpret(
    text: str,
    user_id: str | None,
    created_at: str,
    *,
    call: Callable = gms.call_json,
) -> list[Row] | None:
    """해석 실패(GMS 꺼짐 포함)면 None. 원문은 저장하지 않고 사용자가 그 자리에서 다시 시도한다."""
    if len(text) > MAX_LEN:
        raise ValueError(f"직접 입력은 {MAX_LEN}자까지다")
    items = call(
        build_messages(text),
        lambda resp: parse_items(resp, text),
        response_format=RESPONSE_FORMAT,
        model=MODEL,
        temperature=None,
        reasoning_effort=REASONING_EFFORT,
    )
    if items is None:
        return None
    rows: list[Row] = []
    seen = set()
    for it in items:
        row = Row(
            user_id=user_id,
            code=it["code"],
            direction=1 if it["like"] else -1,
            source="free_text",
            quote=it["quote"],
            created_at=created_at,
        )
        if it["code"]:
            if it["code"] in seen:  # 한 입력에서 같은 코드는 한 번만
                continue
            seen.add(it["code"])
        elif it["positive_text"]:
            row["positive_text"] = it["positive_text"]
        rows.append(row)
    return rows


def _label(text: str) -> str:
    # BE는 제어 문자를 거부한다. 공백류는 한 칸으로 줄이고 나머지는 지운다
    label = " ".join(text.split())
    label = "".join(c for c in label if unicodedata.category(c) != "Cc")
    while len(label.encode("utf-16-le")) // 2 > MAX_LABEL:
        label = label[:-1]
    return label.rstrip()


def to_chips(rows: list[Row]) -> list[dict]:
    """해석 행 → BE 칩(spec 1단계 "칩 표시"). 보관만 하는 행은 반영되지 않으므로 뺀다."""
    chips = []
    for row in rows:
        if row["code"]:
            label = FEATURES[row["code"]].label
        elif row.get("positive_text"):
            label = _label(row["positive_text"])
        else:
            continue
        polarity = "LIKE" if row["direction"] > 0 else "DISLIKE"
        chips.append({"polarity": polarity, "label": label, "code": row["code"]})
    return chips[:MAX_CHIPS]
