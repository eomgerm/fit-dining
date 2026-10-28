"""직접 입력 해석 프롬프트를 GEPA로 최적화한다(S15P31A302-105, 107).

평가셋은 data/direct_input.jsonl이다. 실제 사용자 원문이 아닌 합성 입력이라 레포에 둔다.
정답은 parse_items 규칙을 거친 뒤 모양이다(반대 극 비선호 → 반대 극 선호).

    python direct_input.py            # 최적화
    python direct_input.py baseline 2 # 지금 프롬프트를 2번 돌려 split·slice별 점수와 틀린 것
"""

import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import mlflow
from common import optimize, setup
from mlflow.entities import Feedback
from mlflow.genai.scorers import scorer

from fit_ai import gms
from fit_ai.taste import direct_input as di

NAME = "taste-direct-input"
MAX_METRIC_CALLS = 1500  # val 101개라 한 번 전체 평가에 101번 든다
TEST_RUNS = 3  # temperature 0이어도 실행마다 점수가 흔들려 평균을 본다
DATA = Path(__file__).parent / "data" / "direct_input.jsonl"
KEYS = ("kind", "code", "like")
# 반성 한 번에 보는 사례 수. 기본 3개면 사례 하나에만 맞춘 규칙이 생기기 쉽다
REFLECTION_MINIBATCH = 6

# GEPA 기본 반성 지시는 "세부·도메인 정보를 빠짐없이 지시문에 넣어라"라서
# 학습 문장을 외우고 프롬프트가 6~7배 길어졌다. 일반 규칙·길이 상한·복사 금지로 바꾼다
REFLECTION_TEMPLATE = """너는 프롬프트 개선 담당이다. 아래 지시문을 받은 작은 모델(gpt-4o-mini)이
사용자가 쓴 음식점·카페·술집 취향 문장을 코드표 기준 JSON 항목으로 해석한다.

현재 지시문:
```
<curr_param>
```

이 지시문으로 처리한 입력, 모델 출력, 정답, 채점 피드백:
```
<side_info>
```

모델 출력 뒤에 붙는 코드 규칙(지시문으로 바꿀 수 없다):
- QUIET·LIVELY의 like false는 반대 극의 like true로 바뀐다.
- 중요 기준·방문 목적 코드의 like false는 코드가 떨어져 취향을 잃는다.
- taste가 아닌 항목은 code와 positive_text가 버려진다.
- quote가 원문의 부분 문자열이 아니면 그 항목이 버려진다.

할 일:
1. 틀린 사례의 원인을 일반적인 오류 유형으로 묶는다. 사례 하나에만 해당하는 원인으로 보지 않는다.
2. 그 오류 유형을 막는 일반 규칙을 지시문에 반영한다. 맞게 동작하는 기존 규칙은 유지하고
   필요한 부분만 고치거나 더한다.
3. 새 지시문 전체를 ``` 블록 하나에 담아 출력한다.

제약:
- 위 사례의 입력 문장을 지시문에 그대로, 또는 단어만 바꿔 넣지 않는다.
  예시가 필요하면 위 사례와 다른 새 문장으로 쓴다.
- 특정 입력의 정답을 고정하는 규칙("이 문장은 X다")을 쓰지 않는다.
  처음 보는 입력에도 통하는 원칙으로 쓴다.
- 같은 원칙을 코드마다 반복 나열하지 않는다. 원칙 하나에 서로 다른 예시 한두 개를 붙인다.
- 예시는 모두 합쳐 10개 이하로 둔다.
- 지시문은 코드표를 빼고 3,000자 이내로 쓴다. 작은 모델은 길고 복잡한 지시를 잘 따르지 못한다.
- {{codes}} 자리표시자를 그대로 한 번 남긴다. 실행할 때 코드표가 이 자리에 들어간다.
  코드를 새로 만들거나 코드표를 옮겨 적지 않는다.
- 응답의 JSON 스키마는 실행할 때 따로 강제되므로 출력 형식을 길게 설명하지 않는다."""


def _key(it: dict) -> tuple:
    return tuple(it[k] for k in KEYS)


def _check_gold(row: dict) -> None:
    """정답이 parse_items를 다시 거쳐도 그대로인지. 규칙에 어긋난 라벨을 걸러낸다."""
    text = row["text"]
    resp = {
        "items": [it | {"quote": text, "positive_text": "곳"} for it in row["items"]]
    }
    got = [_key(it) for it in di.parse_items(resp, text)]
    if got != [_key(it) for it in row["items"]]:
        raise ValueError(f"{row['id']}: 정답이 parse_items 규칙과 다르다 {got}")


def load(split: str | None = None) -> list[dict]:
    rows = [json.loads(line) for line in DATA.read_text(encoding="utf-8").splitlines()]
    for row in rows:
        _check_gold(row)
    return [r for r in rows if split is None or r["split"] == split]


def _call(system: str, text: str) -> dict | None:
    """검사를 거친 items와, 반성에 보여줄 모델 원래 응답(raw)."""
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": text},
    ]
    return gms.call_json(
        messages,
        lambda resp: {"items": di.parse_items(resp, text), "raw": resp["items"]},
        response_format=di.RESPONSE_FORMAT,
        timeout=30.0,
    )


def predict(text: str) -> dict | None:
    # 코드표는 GEPA가 고치지 못하게 템플릿 변수로 뺐다
    system = mlflow.genai.load_prompt(f"prompts:/{NAME}@latest").format(codes=di._CODES)
    return _call(system, text)


def _dropped(raw: list[dict], text: str) -> list[str]:
    """parse_items가 버리거나 코드를 뗀 원래 응답 항목. 점수에는 '빠짐'으로만 보인다."""
    out = []
    for it in raw:
        feature = di.FEATURES.get(it["code"] or "")
        if not it["quote"].strip() or it["quote"] not in text:
            out.append(f"'{it['quote']}': quote가 원문 그대로가 아니라 버려졌다")
        elif (
            it["kind"] == "taste"
            and not it["like"]
            and feature
            and feature.layer in ("importance", "purpose")
        ):
            out.append(
                f"'{it['quote']}': {feature.code}에 like false를 줘서 코드가 떨어졌다."
                " 이 층은 싫어하는 방향이 없다. 반대 상황에 대한 불만이면"
                " 그 기준을 원하는 것이라 like true다"
            )
    return out


def match(outputs: dict | None, expectations: dict, text: str) -> tuple[float, str]:
    """(kind, code, like) 집합의 자카드 유사도와, 반성에 쓸 이유."""
    if outputs is None:
        return 0.0, "응답이 출력 검사를 통과하지 못했다"
    got = {_key(it) for it in outputs["items"]}
    want = {_key(it) for it in expectations["items"]}
    score = len(got & want) / len(got | want) if got | want else 1.0
    why = [f"빠짐: {sorted(want - got, key=str)}, 더함: {sorted(got - want, key=str)}"]
    # 정답 설명(note)은 넣지 않는다. 반성 모델이 그 문장의 정답을 규칙으로 고정했다
    if score < 1:
        why += _dropped(outputs["raw"], text)
    return score, "\n".join(why)


@scorer
def items_match(inputs, outputs, expectations) -> Feedback:
    score, why = match(outputs, expectations, inputs["text"])
    return Feedback(value=score, rationale=why)


def evaluate(system: str, rows: list[dict], runs: int) -> None:
    """split·slice별 점수와 틀린 것을 출력한다."""
    by = defaultdict(list)  # (run, split 또는 slice) → 점수
    wrong = defaultdict(list)  # id → 틀린 실행의 이유
    with ThreadPoolExecutor(8) as pool:
        for run in range(runs):
            outs = pool.map(lambda r: _call(system, r["text"]), rows)
            for row, out in zip(rows, outs, strict=True):
                score, why = match(out, row, row["text"])
                for group in ("all", row["split"], row["slice"]):
                    by[(run, group)].append(score)
                if score < 1:
                    wrong[row["id"]].append(f"run{run}: {why.splitlines()[0]}")
    groups = dict.fromkeys(g for _, g in by)
    print("group           " + "  ".join(f"run{r} 평균/완전일치" for r in range(runs)))
    for g in groups:
        cells = []
        for r in range(runs):
            s = by[(r, g)]
            cells.append(f"{sum(s) / len(s):.3f} / {sum(x == 1 for x in s)}/{len(s)}")
        print(f"{g:<16}" + "  ".join(cells))
    print()
    for row in rows:
        if row["id"] in wrong:
            print(f"[{row['split']}] {row['id']} {row['text']}")
            for w in wrong[row["id"]]:
                print(f"    {w}")


def _records(split: str) -> list[dict]:
    return [
        {"inputs": {"text": r["text"]}, "expectations": {"items": r["items"]}}
        for r in load(split)
    ]


if __name__ == "__main__":
    setup("prompt-opt")
    if sys.argv[1:2] == ["baseline"]:
        evaluate(di._SYSTEM, load(), int(sys.argv[2]) if len(sys.argv) > 2 else 1)
        sys.exit()
    result = optimize(
        NAME,
        di._SYSTEM.replace(di._CODES, "{{codes}}"),
        predict,
        _records("train"),
        [items_match],
        max_metric_calls=MAX_METRIC_CALLS,
        valset=_records("val"),
        reflection_prompt_template=REFLECTION_TEMPLATE,
        reflection_minibatch_size=REFLECTION_MINIBATCH,
    )
    print(f"val 점수 {result.initial_eval_score} → {result.final_eval_score}")
    optimized = result.optimized_prompts[0]
    print(optimized.uri)
    for label, system in [
        ("before", di._SYSTEM),
        ("after", optimized.format(codes=di._CODES)),
    ]:
        print(f"\n== test {label} ==")
        evaluate(system, load("test"), TEST_RUNS)
