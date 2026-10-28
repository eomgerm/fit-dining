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
MAX_METRIC_CALLS = 400
TEST_RUNS = 3  # temperature 0이어도 실행마다 점수가 흔들려 평균을 본다
DATA = Path(__file__).parent / "data" / "direct_input.jsonl"
KEYS = ("kind", "code", "like")


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
    if score < 1:
        why += _dropped(outputs["raw"], text)
        if expectations.get("note"):
            why.append(f"정답 설명: {expectations['note']}")
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
        {
            "inputs": {"text": r["text"]},
            "expectations": {"items": r["items"], "note": r.get("note")},
        }
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
        val=_records("val"),
        max_metric_calls=MAX_METRIC_CALLS,
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
