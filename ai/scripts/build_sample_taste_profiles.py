"""샘플 사용자 7명의 취향 프로필과 코드 문구 벡터를 만든다(spec 6단계 샘플 사용자).

    cd ai && uv run --env-file .env python scripts/build_sample_taste_profiles.py

GMS가 꺼져 있으면 직접 입력은 해석에 실패해 태그 근거만 남는다.
"""

import json
import logging
import os
from pathlib import Path

from fit_ai import gms
from fit_ai.embedding import MODEL_ID, REVISION, encode_queries
from fit_ai.features import FEATURES
from fit_ai.taste.direct_input import interpret
from fit_ai.taste.profile import build_profile, onboarding_rows

OUT = Path(__file__).resolve().parents[1] / "samples" / "taste"
T0 = "2026-10-22T10:00:00+09:00"

log = logging.getLogger(__name__)


def review(code: str, place: str, day: int) -> dict:
    return {
        "user_id": "u1",
        "code": code,
        "direction": 1,
        "source": "review",
        "place_id": place,
        "review_id": f"r-{place}-{day}",
        "category": "카페",
        "created_at": f"2026-10-{day}T12:00:00+09:00",
    }


# (번호, 사용자, 온보딩 태그, 직접 입력, 리뷰 행)
SAMPLES = [
    (1, "u1", ["QUIET", "PURPOSE_WORK"], None, []),
    (2, "u2", ["PURPOSE_TALK", "VALUE_FOR_MONEY"], None, []),
    (3, "u3", ["PURPOSE_DATE"], "시끄럽지 않은 데가 좋아요", []),
    (4, "u4", ["PURPOSE_SOLO"], "점심엔 담백한 국물 요리가 좋아요", []),
    (5, "u5", ["PURPOSE_GROUP"], "너무 매운 건 못 먹어요", []),
    (6, "u6", ["LIVELY"], "프로젝트 끝나고 시끌벅적하게 한잔하는 곳", []),
    # 1번 교육생 + 카페 4곳 "조용해서 좋았어요"(cafe-a는 두 번) + "대기가 길었어요" 1건
    (
        7,
        "u1",
        ["QUIET", "PURPOSE_WORK"],
        None,
        [review("QUIET", p, 23) for p in ("cafe-a", "cafe-b", "cafe-c", "cafe-d")]
        + [review("QUIET", "cafe-a", 24), review("SHORT_WAIT", "cafe-e", 24)],
    ),
]


def fail(messages, parse, **_):
    """6번: GMS를 실제로 실패시키지 않고 해석 실패(None)를 재현한다."""


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    gms.check_config()
    if os.environ.get("GMS_ENABLED") != "true":
        log.warning("GMS_ENABLED가 true가 아니라 직접 입력은 해석하지 않는다")

    profiles = {}
    for no, user_id, tags, text, reviews in SAMPLES:
        rows = onboarding_rows(user_id, tags, T0) + reviews
        if text:
            parsed = interpret(
                text, user_id, T0, call=fail if no == 6 else gms.call_json
            )
            rows += parsed or []
        profiles[str(no)] = build_profile(user_id, rows, original_text=text)

    phrases = [f.phrase for f in FEATURES.values()]
    code_vectors = {
        "model": MODEL_ID,
        "revision": REVISION,
        "prompt": "query",
        "vectors": dict(zip(FEATURES, encode_queries(phrases), strict=True)),
    }

    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in (
        ("profiles.json", profiles),
        ("code_vectors.json", code_vectors),
    ):
        # Windows에서도 LF로 쓴다. 저장소는 CRLF를 막는다
        (OUT / name).write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )

    for no, p in profiles.items():
        features = [
            f"{f['code']}:{'+' if f['like'] else '-'}{f['weight']}"
            for f in p["features"]
        ]
        texts = [
            (t["text"], t["like"], t["vector"] is not None) for t in p["free_texts"]
        ]
        print(no, features, texts)


if __name__ == "__main__":
    main()
