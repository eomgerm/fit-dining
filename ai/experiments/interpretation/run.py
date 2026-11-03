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
from dataclasses import asdict
from datetime import date
from pathlib import Path

from fit_ai import gms
from fit_ai.match.interpretation import (
    CODE_PHRASES,
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
    parser.add_argument("--model", help="해석 모델. 없으면 공유 모듈의 모델을 쓴다")
    args = parser.parse_args()
    if args.model:
        # 공유 모듈은 모델 하나로 고정이라 실험에서만 바꿔 끼운다.
        gms.MODEL = args.model
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
                    # 문장이 나오면 베낀 것이다. 코드표 문구는 요청을 바꿔 말한 것일
                    # 수 있어 세지 않는다.
                    "raw_embedding_copied": isinstance(raw_text, str)
                    and len(raw_text) > 3
                    and raw_text in SYSTEM_PROMPT
                    and raw_text not in CODE_PHRASES.values(),
                    # "~을 찾고 있습니다."처럼 검색어가 아니라 문장으로 끝낸 경우다.
                    "raw_embedding_sentence": isinstance(raw_text, str)
                    and raw_text.rstrip(" .").endswith(("다", "요")),
                    # 후속인데 합친 문장에 새 요청을 넣지 않은 경우다. 코드가 뒤에 붙인다.
                    "raw_text_unchanged": previous is not None
                    and isinstance(output, dict)
                    and output.get("text") == previous.text,
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
    result["segments"] = _segments(conditions)
    # 분류별 조각은 기대 답에 그 분류가 있을 때만 채점한다(1차 질의는 채점 방식이 그대로다).
    result["segment_ok"] = {
        key: check(expect[key], conditions)
        for key, check in SEGMENT_CHECKS.items()
        if key in expect
    }
    result["all_ok"] = all(
        result[k] for k in ("codes_ok", "category_ok", "station_ok", "nearby_ok")
    ) and all(result["segment_ok"].values())
    return result


def _segments(conditions: Conditions) -> dict:
    """결과 파일에 남길 분류별 조각"""
    data = asdict(conditions)
    data["avoid_menus"] = [m for m in data["menus"] if not m["want"]]
    return {key: data[key] for key in SEGMENT_CHECKS}


def _same(expected: str | None, value: str | None) -> bool:
    """표준 이름 비교. 띄어쓰기를 무시하고 한쪽이 다른 쪽에 들어 있으면 맞다("국물"과
    "국물 요리")."""
    if expected is None or value is None:
        return expected is value
    a, b = "".join(expected.split()), "".join(value.split())
    return a in b or b in a


def _check_locations(expected: list[dict], conditions: Conditions) -> bool:
    """기대한 지역이 모두 나왔는지 본다. 지역마다 적은 속성(kind, value, walk_minutes,
    exit)만 본다. 기대가 빈 목록이면 지역이 없어야 맞다."""
    if not expected:
        return not conditions.locations

    def matches(e: dict, got) -> bool:
        return all(
            _same(v, got.value) if k == "value" else getattr(got, k) == v
            for k, v in e.items()
        )

    return all(any(matches(e, got) for got in conditions.locations) for e in expected)


def _check_values(attr: str):
    """원하는 조각의 표준 이름이 기대한 것을 모두 담는지 본다. 더 붙은 조각은 틀리지 않다."""

    def check(expected: list[str], conditions: Conditions) -> bool:
        got = [s.value for s in getattr(conditions, attr) if s.want]
        return all(any(_same(e, g) for g in got) for e in expected)

    return check


def _check_hours(expected: list[dict], conditions: Conditions) -> bool:
    return all(
        any(all(getattr(h, k) == v for k, v in e.items()) for h in conditions.hours)
        for e in expected
    )


def _check_price(expected: dict | None, conditions: Conditions) -> bool:
    got = conditions.price
    if expected is None or got is None:
        return expected is None and got is None
    return all(getattr(got, k) == v for k, v in expected.items())


def _check_avoid_menus(expected: list[str], conditions: Conditions) -> bool:
    """피하는 메뉴가 기대한 것과 같은지 본다. 기대는 음식 코드나 표준 이름이다."""
    avoided = [m for m in conditions.menus if not m.want]
    found = all(
        any(e == m.code or _same(e, m.value) for m in avoided) for e in expected
    )
    return found and len(avoided) <= len(expected)


def _check_place_name(expected: str | None, conditions: Conditions) -> bool:
    got = conditions.place_name
    return _same(expected, got.value if got else None)


SEGMENT_CHECKS = {
    "locations": _check_locations,
    "menus": _check_values("menus"),
    "hours": _check_hours,
    "price": _check_price,
    "place_name": _check_place_name,
    "features": _check_values("features"),
    "avoid_menus": _check_avoid_menus,
    "avoid_categories": lambda e, c: set(e) == set(c.avoid_categories),
}
"""분류별 조각 채점. 기대 답(`expect`)의 키와 같은 이름이다."""


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
        for key, ok in run["segment_ok"].items():
            if not ok:
                wrong.append(
                    f"{key} {run['segments'][key]} (기대 {row['expect'][key]})"
                )
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
    sentences = sum(run["raw_embedding_sentence"] for run in llm_runs)
    print(f"벡터용 문장을 '~다', '~요'로 끝낸 횟수: {sentences}/{len(llm_runs)}")
    follow_ups = [run for row in rows for run in row["llm"] if row["type"] == "후속"]
    unchanged = sum(run["raw_text_unchanged"] for run in follow_ups)
    print(f"후속에서 LLM이 이전 문장을 그대로 낸 횟수: {unchanged}/{len(follow_ups)}")


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
    segments = defaultdict(list)
    for run in runs:
        for key, ok in run["segment_ok"].items():
            segments[key].append(ok)
    if segments:
        print(
            "  분류별 조각: "
            + ", ".join(f"{k} {sum(v)}/{len(v)}" for k, v in segments.items())
        )


def _signature(run: dict) -> tuple:
    return (
        tuple(sorted(run["codes"])),
        run["category"],
        run["station"],
        run["nearby"],
        json.dumps(run["segments"], ensure_ascii=False, sort_keys=True),
    )


if __name__ == "__main__":
    main()
