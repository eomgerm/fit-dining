"""로컬 개발용 Postgres(pgvector)를 띄우고 예시 장소를 채운다.

pgserver(개발 의존성)로 Docker 없이 띄운다. BE Mock 장소 30곳
(`be/src/main/resources/mock/places.json`)을 40 장소 프로필 모양으로 바꾸고, 요약
문장을 공유 모듈 `fit_ai.embedding`의 문서 쪽 함수로 인코딩해 넣는다. 리뷰 수와 시설은 Mock 카드의 라벨과
태그로 만든 예시 값이라 실제 데이터와 다르다.

AI가 읽는 것은 뷰 `ai_place_search` 하나다(docs/comparison/api.md 부록 A). 여기서는 BE
장소 테이블과 40 프로필 테이블을 조인한 뷰로 만들어, 실제 테이블 모양과 상관없이
뷰만 맞추면 된다는 걸 보인다.

    uv run python scripts/dev_db.py          # 띄우고 채운다
    uv run python scripts/dev_db.py --stop   # 멈춘다

마지막 줄에 찍히는 `DATABASE_URL`을 `.env`에 넣고 앱을 띄운다.
"""

import argparse
import json
import random
from pathlib import Path

import pgserver
import psycopg

from fit_ai import embedding
from fit_ai.features import FEATURES
from fit_ai.match.conditions import CATEGORY_NAMES, CONDITIONS, STATION_NAMES

DEFAULT_DATA = Path.home() / ".cache" / "fitdining-ai" / "devdb"
REPO = Path(__file__).resolve().parents[2]
MOCK_PLACES = REPO / "be/src/main/resources/mock/places.json"

SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;
DROP VIEW IF EXISTS ai_place_search;
DROP TABLE IF EXISTS place_profile;
DROP TABLE IF EXISTS place;
CREATE TABLE place (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  category_group text NOT NULL,
  station text NOT NULL,
  lat double precision,
  lng double precision,
  facilities jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE place_profile (
  place_id bigint PRIMARY KEY REFERENCES place (id),
  profile jsonb NOT NULL,
  summary_vector vector(1024)
);
CREATE VIEW ai_place_search AS
SELECT p.id AS place_id, p.category_group, p.station, p.lat, p.lng, p.facilities,
       pp.profile, pp.summary_vector
FROM place p JOIN place_profile pp ON pp.place_id = p.id;
"""

LABEL_CODES = {
    **{condition.label: condition.id for condition in CONDITIONS.values()},
    "조용한 곳": "QUIET",
    "조용한": "QUIET",
    "혼술하기 좋아요": "PURPOSE_SOLO",
    "음식이 빨리 나와요": "FAST_SERVING",
    "음악이 좋아요": "GOOD_MUSIC",
    "오래 머물기 좋아요": "PURPOSE_WORK",
    "콘센트 많음": "PURPOSE_WORK",
    "단체로 가기 좋아요": "PURPOSE_GROUP",
    "단체석": "PURPOSE_GROUP",
    "자리가 넓어요": "SPACIOUS_SEATING",
    "넓은 좌석": "SPACIOUS_SEATING",
    "가성비": "VALUE_FOR_MONEY",
    "분위기가 좋아요": "PRETTY_SPACE",
    "채광이 좋아요": "VIEW_OUTDOOR",
    "데이트": "PURPOSE_DATE",
}
"""Mock 카드 라벨과 태그를 코드로 바꾸는 표. 없는 말은 버린다."""

FACILITIES = ("PARKING", "WIFI", "GROUP", "RESERVATION")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="데이터 폴더")
    parser.add_argument("--stop", action="store_true", help="띄운 DB를 멈춘다")
    args = parser.parse_args()
    if args.stop:
        pgserver.pg_ctl(["-D", str(args.data), "stop"])
        print("멈췄다:", args.data)
        return

    args.data.mkdir(parents=True, exist_ok=True)
    # 스크립트가 끝나도 DB는 떠 있게 둔다. 멈출 때는 --stop을 쓴다.
    uri = pgserver.get_server(args.data, cleanup_mode=None).get_uri()
    places = json.loads(MOCK_PLACES.read_text(encoding="utf-8"))["places"]
    summaries = [_summary(place) for place in places]
    vectors = embedding.encode_documents(summaries)
    with psycopg.connect(uri) as conn:
        conn.execute(SCHEMA_SQL)
        for place, summary, vector in zip(places, summaries, vectors, strict=True):
            _insert(conn, place, summary, vector)
    print(f"장소 {len(places)}곳을 넣었다.")
    print(f"DATABASE_URL={uri}")


def _summary(place: dict) -> str:
    """40 요약처럼 장소 정보로만 틀 문장을 만든다. 리뷰 내용은 넣지 않는다."""
    info = place["card"]["place"]
    menus = list(dict.fromkeys(menu["category"] for menu in place["detail"]["menus"]))
    return (
        f"{CATEGORY_NAMES[info['categoryGroup']]}, {info['name']}. "
        f"{', '.join(menus[:3])}. {STATION_NAMES[info['station']]} 근처."
    )


def _features(place: dict, rng: random.Random) -> list[dict]:
    """Mock 카드 라벨·근거 항목·태그로 조건별 리뷰 수를 지어낸다(예시 값)."""
    card, detail = place["card"], place["detail"]
    counts: dict[str, tuple[int, int]] = {}

    def add(code: str | None, like: int, dislike: int) -> None:
        if code is None:
            return
        old_like, old_dislike = counts.get(code, (0, 0))
        counts[code] = (max(old_like, like), max(old_dislike, dislike))

    for label in card["labels"]:
        add(LABEL_CODES.get(label), rng.randint(10, 20), rng.randint(0, 2))
    for item in card["scoreItems"]:
        if item["matched"]:
            add(LABEL_CODES.get(item["label"]), 3 * item["evidenceCount"] + 2, 0)
        else:
            add(LABEL_CODES.get(item["label"]), rng.randint(0, 1), rng.randint(1, 4))
    for tag in detail["tags"]:
        add(LABEL_CODES.get(tag), rng.randint(4, 12), rng.randint(0, 3))
    return [
        {
            "code": code,
            "layer": FEATURES[code].layer,
            "like_count": like,
            "dislike_count": dislike,
            "label": True,
        }
        for code, (like, dislike) in counts.items()
        if code in FEATURES
    ]


def _insert(
    conn: psycopg.Connection,
    place: dict,
    summary: str,
    vector: list[float],
) -> None:
    info = place["card"]["place"]
    present = set(place["detail"]["facilities"])
    # Mock은 있는 시설만 적는다. 예시라서 적히지 않은 시설은 없음으로 둔다.
    facilities = {code: code in present for code in FACILITIES}
    profile = {
        "schema": "place-profile/v0",
        "place_id": f"mock-{info['id']}",
        "food_type": None,
        "summary": {"text": summary, "vector": list(vector)},
        "embedding": {
            "model": embedding.MODEL_ID,
            "revision": embedding.REVISION,
            "prompt": "document",
        },
        "features": _features(place, random.Random(info["id"])),
        "personas": [],
        "evidence": [],
    }
    conn.execute(
        "INSERT INTO place VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            info["id"],
            info["name"],
            info["categoryGroup"],
            info["station"],
            info["lat"],
            info["lng"],
            json.dumps(facilities),
        ),
    )
    conn.execute(
        "INSERT INTO place_profile VALUES (%s, %s, %s::vector)",
        (
            info["id"],
            json.dumps(profile, ensure_ascii=False),
            "[" + ",".join(repr(value) for value in vector) + "]",
        ),
    )


if __name__ == "__main__":
    main()
