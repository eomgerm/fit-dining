"""직접 입력 해석 프롬프트로 최적화 1회전을 돌려 환경을 확인한다(S15P31A302-105).

샘플은 확인용 5개다. 평가셋과 정답 지표는 S15P31A302-107에서 만든다.
"""

import mlflow
from common import optimize, setup
from mlflow.entities import Feedback
from mlflow.genai.scorers import scorer

from fit_ai import gms
from fit_ai.taste import direct_input as di

NAME = "taste-direct-input"
MAX_METRIC_CALLS = 30


def item(kind: str, code: str | None, like: bool) -> dict:
    return {"kind": kind, "code": code, "like": like}


# 정답은 parse_items 규칙을 거친 뒤 모양이다(반대 극 비선호 → 반대 극 선호)
TRAIN = [
    {"inputs": {"text": text}, "expectations": {"items": items}}
    for text, items in [
        ("북적이는 분위기는 피하고 싶어요", [item("taste", "QUIET", True)]),
        ("일식 좋아해요", [item("taste", "FOOD_JAPANESE", True)]),
        ("혼자 가기 편한 곳이요", [item("taste", "PURPOSE_SOLO", True)]),
        ("주차 되는 곳이면 좋겠어요", [item("facility", None, True)]),
        ("웨이팅 긴 건 질색이에요", [item("taste", "SHORT_WAIT", True)]),
    ]
]


def predict(text: str) -> list[dict] | None:
    # 코드표는 GEPA가 고치지 못하게 템플릿 변수로 뺐다
    system = mlflow.genai.load_prompt(f"prompts:/{NAME}@latest").format(codes=di._CODES)
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": text},
    ]
    return gms.call_json(
        messages,
        lambda resp: di.parse_items(resp, text),
        response_format=di.RESPONSE_FORMAT,
        timeout=30.0,
    )


@scorer
def items_match(outputs, expectations) -> Feedback:
    """(kind, code, like) 집합의 자카드 유사도. 이유에는 빠진 것과 더한 것을 적어 GEPA 반성에 쓴다."""
    if outputs is None:
        return Feedback(value=0.0, rationale="응답이 출력 검사를 통과하지 못했다")
    keys = ("kind", "code", "like")
    got = {tuple(it[k] for k in keys) for it in outputs}
    want = {tuple(it[k] for k in keys) for it in expectations["items"]}
    score = len(got & want) / len(got | want) if got | want else 1.0
    return Feedback(
        value=score,
        rationale=f"빠짐: {sorted(want - got, key=str)}, 더함: {sorted(got - want, key=str)}",
    )


if __name__ == "__main__":
    setup("prompt-opt")
    result = optimize(
        NAME,
        di._SYSTEM.replace(di._CODES, "{{codes}}"),
        predict,
        TRAIN,
        [items_match],
        max_metric_calls=MAX_METRIC_CALLS,
    )
    print(f"점수 {result.initial_eval_score} → {result.final_eval_score}")
    print(result.optimized_prompts[0].uri)
