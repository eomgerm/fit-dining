"""요청 해석 평가. cases.json의 질의를 LLM 해석과 규칙 해석으로 돌려 기대 답과 비교한다.

    cd ai && uv run --env-file .env python experiments/interpretation/run.py --runs 2

화면에 요약을 찍고, 질의별 결과는 results/<--label>.json에 남긴다(기본은 날짜).
LLM 해석은 실제 GMS를 부른다. 같은 질의를 여러 번 돌려 답이 흔들리는지도 본다.
LLM이 낸 벡터용 문장은 코드가 고치기 전 값으로도 남긴다("..."처럼 글자 없는 문장).
"""

import argparse
import json
import os
import statistics
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from fit_ai import gms
from fit_ai.match.interpretation import (
    SYSTEM_PROMPT,
    Conditions,
    interpret,
    interpret_by_rules,
)

HERE = Path(__file__).resolve().parent

_outputs: list[object] = []
"""이번 해석에서 GMS가 낸 출력(JSON을 읽은 값)"""


def _record(call_json):
    """GMS 출력을 `_outputs`에 남기도록 공유 모듈 호출을 감싼다."""

    def wrapper(messages, parse, **kwargs):
        def keep(data):
            _outputs.append(data)
            return parse(data)

        return call_json(messages, keep, **kwargs)

    return wrapper


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=2, help="LLM 해석을 돌릴 횟수")
    parser.add_argument("--label", default=str(date.today()), help="결과 파일 이름")
    args = parser.parse_args()
    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))["cases"]
    timeout = float(os.environ.get("GMS_TIMEOUT_SECONDS", "5.0"))
    gms.call_json = _record(gms.call_json)

    rows = []
    for case in cases:
        previous = _previous(case.get("previous"))
        runs = []
        for _ in range(args.runs):
            _outputs.clear()
            result = interpret(case["query"], previous, timeout)
            output = _outputs[-1] if _outputs else None
            raw_text = (
                output.get("embedding_text") if isinstance(output, dict) else None
            )
            runs.append(
                {
                    **_check(case, result.conditions),
                    "llm_error": result.llm_error,
                    "seconds": result.llm_seconds,
                    "change_summary": result.change_summary,
                    "raw_embedding_text": raw_text,
                    "raw_embedding_empty": isinstance(raw_text, str)
                    and not any(ch.isalnum() for ch in raw_text),
                    # 평가 질의는 프롬프트 예시와 겹치지 않으므로 프롬프트에 있는
                    # 문장이 나오면 베낀 것이다.
                    "raw_embedding_copied": isinstance(raw_text, str)
                    and len(raw_text) > 3
                    and raw_text in SYSTEM_PROMPT,
                }
            )
        rule = _check(case, interpret_by_rules(case["query"], previous))
        rows.append(
            {
                "id": case["id"],
                "type": case["type"],
                "query": case["query"],
                "expect": case["expect"],
                "llm": runs,
                "rule": rule,
            }
        )
        print(
            case["id"], "OK" if runs[0]["all_ok"] else "XX", case["query"], flush=True
        )

    out = HERE / "results" / f"{args.label}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    _report(rows)
    print(f"\n질의별 결과: {out.relative_to(HERE.parents[1])}")


def _previous(data: dict | None) -> Conditions | None:
    if data is None:
        return None
    return Conditions(
        text=data["text"],
        embedding_text=data["embeddingText"],
        codes=tuple(data["codes"]),
        category_group=data["categoryGroup"],
        station=data["station"],
        nearby=data["nearby"],
    )


def _check(case: dict, conditions: Conditions) -> dict:
    """해석 결과 하나를 기대 답과 비교한다."""
    expect = case["expect"]
    must, optional = set(expect["codes"]), set(expect.get("optional", []))
    got = set(conditions.codes)
    uncovered = expect.get("uncovered", [])
    result = {
        "codes": list(conditions.codes),
        "category": conditions.category_group,
        "station": conditions.station,
        "nearby": conditions.nearby,
        "embedding_text": conditions.embedding_text,
        "extra": sorted(got - must - optional),
        "missing": sorted(must - got),
        "category_ok": _one_of(expect["category"], conditions.category_group),
        "station_ok": _one_of(expect["station"], conditions.station),
        "nearby_ok": expect["nearby"] == conditions.nearby,
        "uncovered_kept": [w for w in uncovered if w in conditions.embedding_text],
        "uncovered_total": len(uncovered),
        "hits": len(got & must),
        "allowed": len(got & (must | optional)),
        "got": len(got),
        "must": len(must),
    }
    result["codes_ok"] = not result["extra"] and not result["missing"]
    result["all_ok"] = all(
        result[k] for k in ("codes_ok", "category_ok", "station_ok", "nearby_ok")
    )
    return result


def _one_of(expected: object, value: object) -> bool:
    return value in (expected if isinstance(expected, list) else [expected])


def _report(rows: list[dict]) -> None:
    llm_runs = [run for row in rows for run in row["llm"]]
    print("\n=== 요약 ===")
    _summary("LLM 해석", llm_runs)
    _summary("규칙 해석", [row["rule"] for row in rows])

    failed = [run for run in llm_runs if run["llm_error"]]
    seconds = [run["seconds"] for run in llm_runs if run["seconds"] is not None]
    print(
        f"\nLLM 실패(규칙으로 떨어짐): {len(failed)}/{len(llm_runs)}",
        Counter(run["llm_error"][:30] for run in failed).most_common(3),
    )
    if seconds:
        seconds.sort()
        print(
            f"LLM 시간: 평균 {statistics.mean(seconds):.2f}초, "
            f"90% {seconds[int(len(seconds) * 0.9) - 1]:.2f}초, "
            f"최대 {seconds[-1]:.2f}초"
        )

    unstable = [
        row["id"] for row in rows if len({_signature(r) for r in row["llm"]}) > 1
    ]
    print(f"실행마다 답이 달라진 질의: {len(unstable)}/{len(rows)} {unstable}")

    print("\n=== 유형별 전부 맞음 (LLM 첫 실행 / 규칙) ===")
    by_type = defaultdict(list)
    for row in rows:
        by_type[row["type"]].append(row)
    for kind, items in by_type.items():
        llm_ok = sum(r["llm"][0]["all_ok"] for r in items)
        rule_ok = sum(r["rule"]["all_ok"] for r in items)
        print(f"{kind:10} {llm_ok}/{len(items)}  {rule_ok}/{len(items)}")

    print("\n=== LLM 첫 실행에서 틀린 질의 ===")
    for row in rows:
        run = row["llm"][0]
        if run["all_ok"]:
            continue
        wrong = []
        if run["extra"]:
            wrong.append(f"더 붙음 {run['extra']}")
        if run["missing"]:
            wrong.append(f"빠짐 {run['missing']}")
        if not run["category_ok"]:
            wrong.append(f"업종 {run['category']} (기대 {row['expect']['category']})")
        if not run["station_ok"]:
            wrong.append(f"역 {run['station']} (기대 {row['expect']['station']})")
        if not run["nearby_ok"]:
            wrong.append(f"근처 {run['nearby']}")
        print(f"{row['id']:3} {row['query']}  →  {'; '.join(wrong)}")

    kept = sum(len(r["llm"][0]["uncovered_kept"]) for r in rows)
    total = sum(r["llm"][0]["uncovered_total"] for r in rows)
    print(f"\n코드로 못 잡는 표현이 벡터용 문장에 남은 비율: {kept}/{total}")
    empty = [r["query"] for r in rows for run in r["llm"] if run["raw_embedding_empty"]]
    print(
        f"LLM이 글자 없는 벡터용 문장을 낸 횟수(코드가 요청문으로 대신함): "
        f"{len(empty)}/{len(llm_runs)} {sorted(set(empty))}"
    )
    copied = [
        r["query"] for r in rows for run in r["llm"] if run["raw_embedding_copied"]
    ]
    print(
        f"LLM이 프롬프트 문장을 벡터용 문장으로 베낀 횟수: "
        f"{len(copied)}/{len(llm_runs)} {sorted(set(copied))}"
    )


def _summary(name: str, runs: list[dict]) -> None:
    n = len(runs)
    got = sum(r["got"] for r in runs)
    must = sum(r["must"] for r in runs)
    precision = sum(r["allowed"] for r in runs) / got if got else 1.0
    recall = sum(r["hits"] for r in runs) / must if must else 1.0
    extras = Counter(code for r in runs for code in r["extra"])
    print(
        f"{name}: 전부 맞음 {sum(r['all_ok'] for r in runs)}/{n}, "
        f"코드 정확 {sum(r['codes_ok'] for r in runs)}/{n} "
        f"(정밀도 {precision:.0%}, 재현율 {recall:.0%}), "
        f"업종 {sum(r['category_ok'] for r in runs)}/{n}, "
        f"역 {sum(r['station_ok'] for r in runs)}/{n}, "
        f"근처 {sum(r['nearby_ok'] for r in runs)}/{n}"
    )
    if extras:
        print(f"  근거 없이 붙은 코드: {dict(extras.most_common())}")


def _signature(run: dict) -> tuple:
    return (tuple(sorted(run["codes"])), run["category"], run["station"], run["nearby"])


if __name__ == "__main__":
    main()
