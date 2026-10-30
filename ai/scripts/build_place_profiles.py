"""정제 CSV(clean/)의 장소 전부를 분석해 장소 프로필 파일을 만든다(S15P31A302-113, place-profile spec).

    cd ai && uv run --env-file .env python scripts/build_place_profiles.py <clean 폴더>

GMS는 장소마다 본문 추출 (리뷰 수 ÷ extract.BATCH_SIZE)번과 페르소나 1번을 부른다. GMS_ENABLED가
true가 아니면 부르지 않고 키워드·메뉴 근거만으로 만든다(페르소나 없음).
출력(~/fit-ai-data/place-profiles/, FIT_AI_DATA_DIR로 바꿈)에는 네이버 리뷰 원문 구절이 들어가므로
저장소 안에 두지 않는다. profiles.json은 적재할 결과, report.json은 확인용이다.

GMS 결과는 장소 하나가 끝날 때마다 중간 파일에 한 줄씩 붙인다. analysis.jsonl은 본문 추출 결과,
personas.jsonl은 페르소나다. 다시 돌리면 저장된 장소는 GMS를 부르지 않고 다시 쓰고, 빠졌거나 GMS가
실패한 장소만 새로 한다. 프롬프트를 바꿨으면 해당 파일을 지우고 돌린다(페르소나만 다시 만들려면
personas.jsonl만 지운다).
"""

import json
import logging
import os
import sys
import threading
from pathlib import Path

from fit_ai import gms
from fit_ai.place import clean, pipeline, profile

DATA = Path(os.environ.get("FIT_AI_DATA_DIR") or Path.home() / "fit-ai-data")
OUT = DATA / "place-profiles"

log = logging.getLogger(__name__)
calls: list[bool] = []  # GMS 호출마다 성공 여부


def counted(messages, parse, **kw):
    result = gms.call_json(messages, parse, **kw)
    calls.append(result is not None)
    return result


def write(name: str, data) -> None:
    (OUT / name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


lock = threading.Lock()


def append(name: str, row: dict) -> None:
    with lock, open(OUT / name, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def saved(name: str) -> dict[str, dict]:
    """장소 ID → 저장된 줄. 쓰다 끊긴 마지막 줄은 버린다(그 장소는 다시 한다)."""
    rows = {}
    path = OUT / name
    for line in path.read_text(encoding="utf-8").splitlines() if path.exists() else []:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        rows[row["place_id"]] = row
    return rows


def keep_analysis(r: dict) -> None:
    # GMS가 실패한 리뷰가 있으면 저장하지 않아 다음 실행에서 다시 한다
    if not r["failed"]:
        append(
            "analysis.jsonl",
            {"place_id": r["place"]["place_id"]}
            | {k: v for k, v in r.items() if k != "place"},
        )


def keep_personas(r: dict, personas: list[dict]) -> None:
    if not r["failed"]:
        append(
            "personas.jsonl", {"place_id": r["place"]["place_id"], "personas": personas}
        )


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    gms.check_config()
    if os.environ.get("GMS_ENABLED") != "true":
        log.warning("GMS_ENABLED가 true가 아니라 키워드·메뉴 근거만으로 만든다")
    places = clean.places(Path(sys.argv[1]))
    OUT.mkdir(parents=True, exist_ok=True)
    analyses, personas = saved("analysis.jsonl"), saved("personas.jsonl")
    todo = [p for p in places if p["place_id"] not in analyses]
    reused = {
        "analysis": len(places) - len(todo),
        # 본문 추출을 다시 한 장소의 페르소나는 그 결과로 새로 만든다
        "personas": sum(
            1 for p in places if p["place_id"] in analyses.keys() & personas.keys()
        ),
    }
    log.info(
        "저장된 결과를 다시 쓴다: 본문 추출 %(analysis)d곳, 페르소나 %(personas)d곳",
        reused,
    )
    new = {
        r["place"]["place_id"]: r
        for r in pipeline.analyze_all(todo, call=counted, on_done=keep_analysis)
    }
    results = []
    for p in places:
        pid = p["place_id"]
        if pid in analyses:
            r = {k: v for k, v in analyses[pid].items() if k != "place_id"}
            r["place"] = p
            if pid in personas:
                r["personas"] = personas[pid]["personas"]
        elif pid in new:
            r = new[pid]
        else:
            continue
        results.append(r)

    profiles, _, _ = pipeline.build_profiles(
        results, call=counted, on_personas=keep_personas
    )
    write("profiles.json", profiles)
    done = {r["place"]["place_id"] for r in results}
    write(
        "report.json",
        {
            "places": len(places),
            "profiles": len(profiles),
            # 예외로 빠진 장소는 프로필이 없어 추천에서 빠진다. 다시 돌려 채운다
            "failed_places": [
                p["place_id"] for p in places if p["place_id"] not in done
            ],
            "reviews_dropped_by_gms_failure": sum(r["failed"] for r in results),
            "items_dropped_by_check": sum(r["dropped"] for r in results),
            # 근거 3개 이상인 페르소나만 적재하므로 이 장소들은 페르소나 없이 적재된다
            "places_without_scored_personas": sum(
                1
                for pr in profiles
                if not any(
                    len(x["review_ids"]) >= profile.MIN_EVIDENCE for x in pr["personas"]
                )
            ),
            "gms": {
                "enabled": os.environ.get("GMS_ENABLED") == "true",
                "reused_places": reused,
                "calls": len(calls),
                "failed": calls.count(False),
            },
        },
    )
    log.info(
        "%s에 %d곳을 썼다. GMS 호출 %d번, 실패 %d번",
        OUT,
        len(profiles),
        len(calls),
        calls.count(False),
    )


if __name__ == "__main__":
    main()
