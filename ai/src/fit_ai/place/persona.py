"""장소 페르소나 생성과 검사(spec 5단계). Persona4Rec 구조를 참고해 새로 쓴 프롬프트다."""

import re
from collections.abc import Callable

from fit_ai import gms
from fit_ai.features import FEATURES
from fit_ai.place.profile import Evidence

MIN_PERSONAS, MAX_PERSONAS = 2, 7  # 기술 설계 §3.4
COPY_LEN = 20  # 외부 리뷰 원문과 연속 20자 이상 겹치면 버린다(기술 설계 §3.6)
# 따옴표로 감싼 구절은 5자 이상이면 리뷰와 대조한다. '혼밥' 같은 짧은 말은 넘긴다
QUOTE_MIN = 5
_QUOTED = re.compile(r"[\"'‘“「『](.+?)[\"'’”」』]")
TIMEOUT = 60.0

_SOURCE = {
    "naver_keyword": "네이버 키워드",
    "naver_text": "네이버 리뷰",
    "app_text": "앱 리뷰",
    "app_tag": "앱 이유 태그",
}

# Persona4Rec(arXiv 2602.21756) 공개 저장소의 Yelp 페르소나 프롬프트 구조를 참고했다.
# 그 코드에는 라이선스가 없어 문장은 새로 썼다(기술 설계 §3.4)
_SYSTEM = f"""방문자 리뷰에서 뽑은 근거를 종합해 이 장소의 손님 페르소나를 만든다.
리뷰 근거가 주 자료이고, 장소 요약은 참고용이다.

- 페르소나는 "이 장소를 좋아할(또는 아쉬워할) 손님은 이런 사람"이라는 설명이다.
- {MIN_PERSONAS}~{MAX_PERSONAS}개를 만든다. 근거가 다양할수록 많이 만든다.
- 중복이나 거의 같은 페르소나는 만들지 않는다.
- 만족한 손님은 like true, 아쉬워한 손님은 like false다. 소수의 아쉬운 의견은 긍정 다수와
  섞어 중립으로 만들지 말고 따로 남긴다.
- name: 2~4단어. 근거에 기대어 구체적으로 짓고, 흐릿하고 흔한 말은 피한다.
- description: 3문장. 근거에서 찾은 방문 동기와 기준으로 어떤 손님인지 설명한다.
- reason: 3문장. 근거의 구체적인 신호(메뉴, 방문 상황, 시간대, 공간 등)를 반드시 들고,
  그 점이 왜 이 손님에게 중요한지 설명한다.
- 근거에 나온 취향 특징은 빠짐없이 다룬다. "이 장소에서 두드러진 특징"을 먼저 다루되,
  가성비처럼 여러 장소에 있는 특징도 빼지 않는다. 같은 특징이라도 이 장소의 메뉴와
  상황을 들어 다른 장소와 구별되게 쓴다.
- review_ids에는 그 페르소나의 근거가 된 리뷰 번호(r1, r2 …)를 모두 넣는다. 목록에 없는 번호는 쓰지 않는다.
- 근거에 없는 특징을 지어내지 않는다.
- 리뷰 문장을 그대로 옮기지 말고 자기 말로 쓴다. 리뷰 구절을 따옴표로 인용하지 않는다.
  근거는 메뉴 이름이나 방문 상황으로 풀어 쓴다.

JSON으로 답한다."""

RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "place_personas",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["personas"],
            "properties": {
                "personas": {
                    "type": "array",
                    # 근거가 많은 장소에서 8개를 만들었고 다시 요청해도 같았다
                    "minItems": MIN_PERSONAS,
                    "maxItems": MAX_PERSONAS,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": [
                            "name",
                            "description",
                            "reason",
                            "like",
                            "review_ids",
                        ],
                        "properties": {
                            "name": {"type": "string"},
                            "description": {"type": "string"},
                            "reason": {"type": "string"},
                            "like": {"type": "boolean"},
                            "review_ids": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                        },
                    },
                }
            },
        },
    },
}


def _item(e: Evidence) -> str:
    """네이버 리뷰 구절(quote)은 넣지 않는다. 넣었더니 모델이 따옴표로 옮겨 적었다.

    코드가 있으면 코드 이름, 없으면 3단계에서 정리한 문장을 쓴다(Persona4Rec도
    리뷰 원문 대신 추출 문장을 넣는다). 앱 이유 태그는 우리 문구라 그대로 둔다.
    """
    what = " / ".join(x for x in (e["slot"], e["code"]) if x)  # 칸과 코드를 함께 넣는다
    mood = "좋았어요" if e["direction"] == 1 else "아쉬웠어요"
    if e["source"] == "app_tag":
        content = e["quote"]
    else:
        content = e["text"] or (FEATURES[e["code"]].label if e["code"] else "")
    return f"  - {what} / {mood}: {content}"


def build_messages(
    summary: str, evidence: list[Evidence], feature_rows: list[dict] = ()
) -> tuple[list[dict], dict[str, str]]:
    """리뷰 근거를 리뷰 단위로 묶고 리뷰 ID는 짧은 번호로 바꾼다.

    코드와 키워드 투표만 줄줄이 넣었더니 "가성비 중시 손님"처럼 흐린 페르소나가
    장소마다 똑같이 나왔다. Persona4Rec처럼 리뷰마다 구체적인 근거를 묶어 넣고,
    키워드 투표는 개수로만 센다. 아쉬웠어요가 있는 리뷰는 앞에 따로 둔다(LFOSum).
    """
    keywords: dict[str, int] = {}
    by_review: dict[str, list[Evidence]] = {}
    for e in evidence:
        if e["source"] == "naver_keyword":
            keywords[e["quote"]] = keywords.get(e["quote"], 0) + 1
        elif e["review_id"] is not None:  # 메뉴 근거는 리뷰가 아니다
            by_review.setdefault(e["review_id"], []).append(e)
    ids = {rid: f"r{i}" for i, rid in enumerate(by_review, 1)}  # 리뷰 ID → 짧은 번호

    def block(rid: str) -> str:
        source = _SOURCE.get(by_review[rid][0]["source"], "")
        return f"- {ids[rid]} [{source}]\n" + "\n".join(map(_item, by_review[rid]))

    mixed = [r for r, es in by_review.items() if any(e["direction"] == -1 for e in es)]
    liked = [r for r in by_review if r not in mixed]
    standout = [f["code"] for f in feature_rows if f["label"]]
    votes = ", ".join(
        f"{k} {n}건" for k, n in sorted(keywords.items(), key=lambda kv: -kv[1])
    )
    user = (
        f"장소 요약(참고용): {summary}\n\n"
        "이 장소에서 두드러진 특징(같은 업종 평균보다 많이 언급됨): "
        + (", ".join(FEATURES[c].label for c in standout) or "없음")
        + f"\n네이버 키워드 투표: {votes or '없음'}\n\n"
        "아쉬웠어요 근거가 있는 리뷰:\n"
        + ("\n".join(map(block, mixed)) or "- 없음")
        + "\n\n좋았어요 근거만 있는 리뷰:\n"
        + ("\n".join(map(block, liked)) or "- 없음")
    )
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]
    return messages, {v: k for k, v in ids.items()}


def _copied(text: str, reviews: str) -> bool:
    """리뷰를 20자 넘게 베꼈거나, 따옴표 안 구절이 리뷰에 그대로 있으면 True.

    짧은 인용도 추천 이유로 화면에 나가면 외부 리뷰 인용이다(PRD AC-25).
    """
    text = " ".join(text.split())  # 페르소나 쪽 줄바꿈·겹친 공백도 줄여서 대조한다
    if any(
        len(q.strip()) >= QUOTE_MIN and q.strip() in reviews
        for q in _QUOTED.findall(text)
    ):
        return True
    return any(
        text[i : i + COPY_LEN] in reviews for i in range(len(text) - COPY_LEN + 1)
    )


def parse_personas(resp: dict, ids: dict[str, str], bodies: list[str]) -> list[dict]:
    """개수가 틀리면 다시 요청한다. 없는 리뷰 번호나 리뷰를 베낀 문장이 있으면 그 페르소나만 버린다."""
    if not isinstance(resp, dict) or not isinstance(resp.get("personas"), list):
        raise TypeError("응답에 personas 목록이 없다")
    personas = resp["personas"]
    if not MIN_PERSONAS <= len(personas) <= MAX_PERSONAS:
        raise ValueError("페르소나 개수가 범위를 벗어났다")
    # 리뷰 안 줄바꿈 때문에 베낀 문장을 놓치지 않게 공백을 줄여서 대조한다
    reviews = "\n".join(" ".join(b.split()) for b in bodies)
    out = []
    for p in personas:
        if not isinstance(p, dict) or not isinstance(p.get("review_ids"), list):
            raise TypeError("페르소나 모양이 다르다")
        if not p["review_ids"] or any(r not in ids for r in p["review_ids"]):
            continue
        if any(_copied(p[f], reviews) for f in ("name", "description", "reason")):
            continue
        out.append(
            {
                "name": p["name"],
                "description": p["description"],
                "reason": p["reason"],
                "like": p["like"],
                "review_ids": list(dict.fromkeys(ids[r] for r in p["review_ids"])),
            }
        )
    return out


def generate(
    summary: str,
    evidence: list[Evidence],
    bodies: dict[str, str],
    feature_rows: list[dict] = (),
    *,
    call: Callable = gms.call_json,
) -> list[dict]:
    """근거가 될 리뷰가 없거나 두 번 실패하면 빈 목록. 그 장소는 요약만으로 색인한다."""
    messages, ids = build_messages(summary, evidence, feature_rows)
    if not ids:
        return []
    result = call(
        messages,
        lambda resp: parse_personas(resp, ids, list(bodies.values())),
        response_format=RESPONSE_FORMAT,
        timeout=TIMEOUT,
    )
    return [{"persona_id": f"p{i}", **p} for i, p in enumerate(result or [], 1)]


def persona_text(p: dict) -> str:
    """벡터로 바꿀 문장. Persona4Rec은 틀을 공개하지 않아 마침표로 이어 붙인다."""
    return f"{p['name']}. {p['description']}. {p['reason']}."
