"""리뷰 본문 → 근거 행(spec 2·3단계). LLM 출력을 코드 규칙으로 다시 검사한다."""

import json
import re
from collections.abc import Callable

from fit_ai import gms
from fit_ai.features import FEATURES
from fit_ai.place.profile import Evidence

DEDUPE_MIN_LEN = 10
DEDUPE_JACCARD = 0.8  # 글자 5개 조각이 80% 넘게 겹치면 같은 리뷰(기술 설계 §3.3)
BATCH_SIZE = 10
TIMEOUT = 60.0  # 리뷰 10개를 한 번에 보내서 39의 기본값(10초)보다 길게 둔다

MODEL = "gpt-6-luna"
"""추출 모델. 실제 리뷰 50개(5곳)를 한 번씩: gpt-4o-mini 대비 항목 63 → 108개, 검사에서 버려진
항목 36 → 1개, 코드가 다른 리뷰 29개 중 21개에서 나았고 2개에서 못했다("조용해요"·"인테리어
예뻐요"·뷰를 잡고, 리뷰에 없는 코드를 덜 붙였다)(2026-11-06, ai/experiments/prompt_opt/README.md)."""

REASONING_EFFORT = "none"
"""추론 강도. 묶음(10개)당 중앙값 12.6초 → 8.1초, 최대 18.4초 → 12.6초였다. 이 모델은
temperature 0을 받지 않아 temperature는 보내지 않는다."""

# 기술 설계 §3.2의 8칸과 칸마다 붙을 수 있는 코드
SLOTS: dict[str, tuple[str, ...]] = {
    "메뉴 평가": (),
    "맛 성향": ("FOOD_SPICY",),
    "소음·분위기": ("QUIET", "LIVELY", "COZY", "UNIQUE_CONCEPT", "GOOD_MUSIC"),
    "공간": ("SPACIOUS_SEATING", "PRETTY_SPACE", "VIEW_OUTDOOR"),
    "대기·서비스": ("SHORT_WAIT", "FAST_SERVING"),
    "양·가격 만족": ("GENEROUS_PORTION", "VALUE_FOR_MONEY"),
    "방문 목적": (
        "PURPOSE_TALK",
        "PURPOSE_SOLO",
        "PURPOSE_DATE",
        "PURPOSE_GROUP",
        "PURPOSE_WORK",
    ),
    "방문 맥락": (),
}

_SLOT_LINES = "\n".join(
    f"- {slot}: "
    + (
        ", ".join(f"{c}({FEATURES[c].phrase})" for c in codes)
        if codes
        else "코드 없음. text에 문장으로 남긴다"
    )
    for slot, codes in SLOTS.items()
)
_SYSTEM = f"""음식점·카페·술집 방문자 리뷰에서 장소의 특징을 뽑는다.

칸과 칸마다 붙일 수 있는 코드(코드(설명)):
{_SLOT_LINES}

규칙:
- 리뷰에 없는 내용은 쓰지 않는다. quote는 리뷰에서 그대로 따온 구절이다.
- 항목 하나에는 코드를 하나만 붙인다. 그 칸에 없는 코드는 쓰지 않는다.
- direction은 손님이 그 특징을 좋게 봤으면 1, 아쉬워했으면 -1이다.
- 소음은 손님이 실제로 느낀 쪽을 코드로 고른다. 조용했으면 QUIET, 시끄럽거나 북적였으면 LIVELY.
  예: "너무 시끄러워서 대화가 힘들었어요"는 LIVELY, -1. "썰렁했어요"는 QUIET, -1.
- 그 밖의 코드는 설명대로였으면 1, 아니었으면 -1이다. 예: "자리가 좁았어요"는 SPACIOUS_SEATING, -1.
- 붐빈다는 말만으로 시끄럽다고 하지 않는다.
- 시간대나 요일이 붙은 관찰은 그 조건을 text에 남긴다. 예: "주말 저녁엔 시끄럽다".
- 맛있다, 친절하다, 깨끗하다 같은 일반 품질에는 코드를 붙이지 않는다.
  메뉴 이야기라면 메뉴 평가 칸에 code 없이 text로 남긴다.
- 코드를 붙였으면 text는 null이다. 코드가 없으면 text에 짧은 문장으로 정리한다.
- 특징이 없는 리뷰는 items를 비운다.

리뷰 번호(no)를 키로, 그 리뷰의 항목 목록을 값으로 답한다. JSON으로 답한다."""

_ALL_CODES = [c for codes in SLOTS.values() for c in codes]
_ITEM = {
    "type": "object",
    "additionalProperties": False,
    # 칸과 코드를 먼저 정하고 그 기준으로 방향을 정하게 순서를 둔다
    "required": ["slot", "quote", "code", "direction", "text"],
    "properties": {
        "slot": {"type": "string", "enum": list(SLOTS)},
        "quote": {"type": "string"},
        "code": {"type": ["string", "null"], "enum": [*_ALL_CODES, None]},
        "direction": {"type": "integer", "enum": [1, -1]},
        "text": {"type": ["string", "null"]},
    },
}


def response_format(n: int) -> dict:
    """리뷰 번호("1"~"n")를 키로 모두 필수로 둔다.

    배열로 받았을 때 모델이 첫 리뷰만 답하고 멈추거나 없는 번호를 더해서,
    temperature 0이라 다시 요청해도 같은 답이 왔다. 키를 고정하면 둘 다 생기지 않는다.
    """
    keys = [str(i) for i in range(1, n + 1)]
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "place_aspects",
            "strict": True,
            "schema": {
                "type": "object",
                "additionalProperties": False,
                "required": keys,
                "properties": {k: {"type": "array", "items": _ITEM} for k in keys},
            },
        },
    }


def _collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


def _shingles(text: str, k: int = 5) -> set[str]:
    return {text[i : i + k] for i in range(len(text) - k + 1)}


def dedupe(reviews: list[dict]) -> tuple[list[dict], int]:
    """같은 장소 안 복사본 리뷰를 합친다. 수집 목록에서 먼저 나온 리뷰를 남긴다.

    방문일·작성일에 연도가 없어 날짜로 고를 수 없다. 합치는 리뷰는 내용이 같다.
    """
    kept, seen = [], []
    for r in reviews:
        # 공백을 줄인 뒤 길이를 잰다. 줄바꿈만 많은 짧은 리뷰는 조각이 없다
        body = _collapse(r.get("body") or "")
        if len(body) >= DEDUPE_MIN_LEN:
            s = _shingles(body)
            if any(len(s & t) / len(s | t) >= DEDUPE_JACCARD for t in seen):
                continue
            seen.append(s)
        kept.append(r)
    return kept, len(reviews) - len(kept)


def build_messages(bodies: list[str]) -> list[dict]:
    """리뷰 ID 대신 1부터 번호를 붙인다. 긴 ID를 옮겨 적다 틀리는 일을 막는다.

    본문에 "1. 맛 2. 양"처럼 번호가 있어도 헷갈리지 않게 JSON 배열로 보낸다.
    """
    numbered = [{"no": i, "review": b} for i, b in enumerate(bodies, 1)]
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": json.dumps(numbered, ensure_ascii=False)},
    ]


def _check(item: object) -> dict:
    """모양이 틀리면 TypeError. GMS 호출이 한 번 다시 요청하게 된다."""
    ok = (
        isinstance(item, dict)
        and {"slot", "quote", "code", "direction", "text"} <= item.keys()
        and item["slot"] in SLOTS
        and isinstance(item["quote"], str)
        and isinstance(item["code"], str | None)
        and item["direction"] in (1, -1)
        and isinstance(item["text"], str | None)
    )
    if not ok:
        raise TypeError("응답 항목 모양이 다르다")
    return item


def parse_batch(resp: dict, bodies: list[str]) -> tuple[list[list[dict]], int]:
    """(리뷰별 항목, 검사에서 버린 항목 수).

    원문에 없는 구절과 그 칸에 붙을 수 없는 코드는 그 항목만 버린다.
    """
    keys = [str(i) for i in range(1, len(bodies) + 1)]
    if not isinstance(resp, dict) or sorted(resp) != sorted(keys):
        raise ValueError("보낸 리뷰 번호와 받은 번호가 다르다")
    out, dropped = [], 0
    for no, body in enumerate(bodies, 1):
        items = resp[str(no)]
        if not isinstance(items, list):
            raise TypeError("items가 목록이 아니다")
        kept, flat = [], _collapse(body)
        for raw in items:
            it = _check(raw)
            # 모델이 리뷰의 줄바꿈을 띄어쓰기로 옮겨 적으므로 공백을 줄여서 대조한다.
            # 빈 구절은 어떤 원문에도 들어 있어 대조를 통과하므로 따로 버린다
            quote = _collapse(it["quote"])
            made_up = not quote or quote not in flat
            # 빈 문자열 코드도 그 칸의 코드가 아니라 버린다
            wrong_code = it["code"] is not None and it["code"] not in SLOTS[it["slot"]]
            if made_up or wrong_code:
                dropped += 1
                continue
            kept.append(
                {**it, "quote": quote, "text": None if it["code"] else it["text"]}
            )
        out.append(kept)
    return out, dropped


def extract(
    reviews: list[dict],
    *,
    call: Callable = gms.call_json,
    batch_size: int = BATCH_SIZE,
    source: str = "naver_text",
) -> tuple[list[Evidence], int, int]:
    """(근거 행, GMS 실패로 버린 리뷰 수, 검사에서 버린 항목 수).

    본문이 빈 리뷰는 보내지 않는다.
    """
    todo = [r for r in reviews if (r.get("body") or "").strip()]
    rows: list[Evidence] = []
    failed = dropped = 0
    for i in range(0, len(todo), batch_size):
        batch = todo[i : i + batch_size]
        bodies = [r["body"] for r in batch]
        result = call(
            build_messages(bodies),
            lambda resp, bodies=bodies: parse_batch(resp, bodies),
            response_format=response_format(len(bodies)),
            timeout=TIMEOUT,
            model=MODEL,
            temperature=None,
            reasoning_effort=REASONING_EFFORT,
        )
        if result is None:  # 두 번 실패하면 그 묶음의 리뷰를 버린다(기술 설계 §3.6)
            failed += len(batch)
            continue
        per_review, n_dropped = result
        dropped += n_dropped
        for r, items in zip(batch, per_review, strict=True):
            rows += [
                Evidence(review_id=r["review_id"], source=source, **it) for it in items
            ]
    return rows, failed, dropped
