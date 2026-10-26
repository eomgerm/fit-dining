"""직접 입력 → 근거 장부 행(spec 1·2단계). LLM 해석을 코드 규칙으로 다시 검사한다."""

from collections.abc import Callable

from fit_ai import gms
from fit_ai.features import FEATURES
from fit_ai.taste.profile import Row

MAX_LEN = 100  # 온보딩 직접 입력 상한(PRD FR-06)

# 프롬프트 근거: 라벨에 설명을 붙이면 제로샷 분류가 낫고(Gen-Z, arXiv 2311.07115),
# 단순한 제로샷 지시가 CoT·few-shot 같은 복잡한 전략보다 낫거나 비슷했다(arXiv 2412.12564).
# LLM은 부정에 약해서(arXiv 2306.08189) like의 뜻을 코드 기준으로 정의하고 parse_items에서 다시 검사한다.
_CODES = "\n".join(
    f"- {f.code} [{f.layer}] {f.label}: {f.phrase}" for f in FEATURES.values()
)
_SYSTEM = f"""사용자가 음식점·카페·술집 취향을 적은 글을 코드표의 코드로 해석한다.

층:
- axis: 반대 극이 있는 분위기 취향. QUIET와 LIVELY는 서로 반대 극이다
- importance: 가게를 고를 때 중요하게 보는 기준
- purpose: 자주 가는 목적
- food: 음식 종류와 맛

코드표(코드 [층] 이름: 설명):
{_CODES}

규칙:
- kind는 항목 종류다. 있다/없다로 갈리는 편의 시설(주차, 콘센트, 키즈존 등)은
  facility, 맛·친절 같은 범용 품질("맛있는 곳", "친절한 곳")은 quality,
  가격·예산("2만 원 이하")은 budget, 나머지 취향은 taste다.
- 코드표에 있는 코드만 쓴다. 입력에 없는 내용은 쓰지 않는다.
- 입력을 의미 단위로 쪼개고, 항목 하나에는 코드를 하나만 붙인다.
  예: "조용하고 넓은 곳 좋아해요"는 QUIET 항목과 SPACIOUS_SEATING 항목이다.
- 표현이 달라도 뜻이 코드 설명에 맞으면 그 코드를 붙인다.
- like는 원문의 말투가 아니라 코드 설명을 기준으로 정한다. 사용자가 코드 설명 같은
  곳을 원하면 true, 그런 곳을 피하고 싶으면 false다. 불만이나 싫음을 말해도
  그 반대인 코드 설명을 원하는 것이면 true다.
  예: "좁은 데는 답답해요"는 SPACIOUS_SEATING, like true(좁은 곳이 싫다 = 넓은 곳을 원한다).
  예: "시끄러운 데 싫어요"는 QUIET, like true.
- 코드 설명 같은 곳 자체를 싫어하면 like false다.
  예: "양식은 별로예요"는 FOOD_WESTERN, like false.
- 음식 종류 코드(FOOD_KOREAN 등)는 "한식", "일식"처럼 종류 자체를 말할 때만 붙인다.
  구체적인 메뉴나 맛은 code를 null로 두고 positive_text로 남긴다.
  예: "마라탕 좋아해요"는 code null, "마라탕을 먹을 수 있는 곳".
- 코드에 맞지 않는 좋아하는 취향은 code를 null로 두고, positive_text에 원문 뜻을
  빠뜨리지 않고 코드 설명처럼 "곳"으로 끝나는 구로 쓴다.
  예: "비 오는 날엔 따뜻한 국수가 당겨요"는 "비 오는 날 따뜻한 국수를 먹을 수 있는 곳".
- 코드에 맞지 않는 싫어하는 것과 facility·quality·budget 항목은 code와 positive_text를
  모두 null로 둔다. 이때도 like는 원문대로 둔다.
- quote는 입력에서 그대로 따온 구절이다.

JSON으로 답한다."""

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
        if code and not like:
            feature = FEATURES[code]
            if feature.opposite:  # 반대 극 비선호는 반대 극 선호로
                code, like = feature.opposite, True
            # 중요 기준·방문 목적은 싫어하는 방향이 없어 문장으로만 남긴다(D-06)
            elif feature.layer in ("importance", "purpose"):
                code = None
        # 벡터로 만들 문장은 좋아하는 취향(taste)뿐이다. 시설·품질·예산은 보관만 한다
        keep_text = it["kind"] == "taste" and like
        out.append(
            {
                "quote": quote,
                "kind": it["kind"],
                "like": like,
                "code": code,
                "positive_text": it["positive_text"] if keep_text else None,
            }
        )
    # 모델이 준 항목이 검사에서 모두 버려졌으면 형식 실수로 취향을 잃은 것이다.
    # 출력 검사 실패로 알려 다시 요청하고, 그래도 실패하면 해석 대기로 남긴다
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
    """해석 실패(GMS 꺼짐 포함)면 None. 호출하는 쪽은 원문만 보관한다."""
    if len(text) > MAX_LEN:
        raise ValueError(f"직접 입력은 {MAX_LEN}자까지다")
    items = call(
        build_messages(text),
        lambda resp: parse_items(resp, text),
        response_format=RESPONSE_FORMAT,
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
