"""직접 입력 → 근거 장부 행(spec 1·2단계). LLM 해석을 코드 규칙으로 다시 검사한다."""

from collections.abc import Callable

from fit_ai import gms
from fit_ai.features import FEATURES
from fit_ai.taste.profile import Row

MAX_LEN = 100  # 온보딩 직접 입력 상한(PRD FR-06)

_CODES = "\n".join(f"- {f.code} ({f.layer}): {f.label}" for f in FEATURES.values())
_SYSTEM = f"""사용자가 음식점·카페·술집 취향을 적은 글을 해석한다.

코드표:
{_CODES}

규칙:
- 위 코드표에 있는 코드만 쓴다. 입력에 없는 내용은 쓰지 않는다.
- 입력을 의미 단위로 쪼개고, 항목 하나에는 코드를 하나만 붙인다.
  예: "조용하고 넓은 곳 좋아해요"는 QUIET 항목과 SPACIOUS_SEATING 항목이다.
- 부정 표현은 긍정형으로 바꾼다. 예: "시끄러운 데 싫어요"는 QUIET, like true.
- 코드가 없는 취향은 code를 null로 두고 positive_text에 긍정형 문장으로 정리한다.
- 시설, 범용 품질("맛있는 곳", "친절한 곳"), 예산("2만 원 이하")은 code와
  positive_text를 모두 null로 둔다.
- quote는 입력에서 그대로 따온 구절이다.

JSON으로만 답한다:
{{"items": [{{"quote": "...", "like": true, "code": "QUIET", "positive_text": null}}]}}"""


def build_messages(text: str) -> list[dict]:
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": text}]


def _check(item: object) -> dict:
    """모양이 틀리면 TypeError. GMS 호출이 한 번 다시 요청하게 된다."""
    ok = (
        isinstance(item, dict)
        and {"quote", "like", "code", "positive_text"} <= item.keys()
        and isinstance(item["quote"], str)
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
        if quote not in text or (code is not None and code not in FEATURES):
            continue
        if code and not like:
            feature = FEATURES[code]
            if feature.opposite:  # 반대 극 비선호는 반대 극 선호로
                code, like = feature.opposite, True
            # 중요 기준·방문 목적은 싫어하는 방향이 없어 문장으로만 남긴다(D-06)
            elif feature.layer in ("importance", "purpose"):
                code = None
        out.append(
            {
                "quote": quote,
                "like": like,
                "code": code,
                "positive_text": it["positive_text"],
            }
        )
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
    items = call(build_messages(text), lambda resp: parse_items(resp, text))
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
