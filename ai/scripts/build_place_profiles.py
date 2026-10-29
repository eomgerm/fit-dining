"""정제 CSV(clean/)의 장소 전부를 분석해 장소 프로필 파일을 만든다(S15P31A302-113, place-profile spec).

    cd ai && uv run --env-file .env python scripts/build_place_profiles.py <clean 폴더>
    cd ai && uv run --env-file .env python scripts/build_place_profiles.py <clean 폴더> --reuse  # 페르소나만 새로

GMS는 장소마다 본문 추출 (리뷰 수 ÷ extract.BATCH_SIZE)번과 페르소나 1번을 부른다. GMS_ENABLED가
true가 아니면 부르지 않고 키워드·메뉴 근거만으로 만든다(페르소나 없음).
출력(~/fit-ai-data/place-profiles/, FIT_AI_DATA_DIR로 바꿈)에는 네이버 리뷰 원문 구절이 들어가므로
저장소 안에 두지 않는다. analysis.json은 본문 추출 결과, profiles.json은 적재할 결과, report.json은 확인용이다.
"""

import json
import logging
import os
import sys
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


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    gms.check_config()
    if os.environ.get("GMS_ENABLED") != "true":
        log.warning("GMS_ENABLED가 true가 아니라 키워드·메뉴 근거만으로 만든다")
    places = clean.places(Path(sys.argv[1]))
    OUT.mkdir(parents=True, exist_ok=True)
    if "--reuse" in sys.argv:
        # 저장해 둔 본문 추출 결과를 다시 쓴다. 페르소나는 새로 만든다(GMS 장소당 1번)
        by_id = {p["place_id"]: p for p in places}
        keep = ("merged", "failed", "dropped", "n_reviews", "evidence")
        results = [
            {k: r[k] for k in keep} | {"place": by_id[r["place_id"]]}
            for r in json.loads((OUT / "analysis.json").read_text(encoding="utf-8"))
        ]
    else:
        results = pipeline.analyze_all(places, call=counted)
        # 본문 추출 결과를 먼저 저장해 둔다. 뒤에서 실패해도 유료 호출 결과를 잃지 않는다
        write(
            "analysis.json",
            [
                {"place_id": r["place"]["place_id"]}
                | {k: v for k, v in r.items() if k != "place"}
                for r in results
            ],
        )

    profiles, _, _ = pipeline.build_profiles(results, call=counted)
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
                "reused_analysis": "--reuse" in sys.argv,
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
