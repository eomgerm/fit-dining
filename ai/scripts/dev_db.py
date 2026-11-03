"""로컬 개발용 Postgres(pgvector)를 띄우고 예시 장소를 채운다.

pgserver(개발 의존성)로 Docker 없이 띄운다. BE Mock 장소
(`be/src/main/resources/mock/places.json`)를 40 장소 프로필 모양으로 바꾸고, 요약
문장을 공유 모듈 `fit_ai.embedding`의 문서 쪽 함수로 인코딩해 넣는다. 리뷰 수는 Mock 카드의 라벨과
태그로 만든 예시 값이라 실제 데이터와 다르다. Mock에는 지번 주소가 없어 동은 비워 둔다. 가게
가격은 Mock에 리뷰 메뉴가 없어 메뉴판으로만 계산한다(`fit_ai.match.price`).

AI가 읽는 장소는 뷰 `ai_place_search` 하나다(`fit_ai.match.pg_store`). 여기서는 BE
장소 테이블과 40 프로필 테이블을 조인한 뷰로 만들어, 실제 테이블 모양과 상관없이
뷰만 맞추면 된다는 걸 보인다. 회원 취향 예시(샘플 사용자 7명)도 저장 설계와 같은
`user_preferences`에 넣는다.

    uv run --extra encoder python scripts/dev_db.py   # 띄우고 채운다
    uv run python scripts/dev_db.py --stop            # 멈춘다
    uv run --extra encoder python scripts/dev_db.py --json samples/place/mock.json  # DB 없이 파일로 쓴다

요약 문장을 인코딩하므로 `encoder` extra가 필요하다. `--stop`은 인코딩하지 않는다.

마지막 줄에 찍히는 `DATABASE_URL`을 `.env`에 넣고 앱을 띄운다. `--json`이면 같은 장소를
뷰의 행 모양(요약 벡터는 프로필 안)으로 파일에 쓴다. 실제 장소 DB가 생기기 전에
`PLACES_FILE`로 읽는 예시 파일이다(`fit_ai.match.json_store`).
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
from fit_ai.match.price import MenuPrice, store_price

DEFAULT_DATA = Path.home() / ".cache" / "fitdining-ai" / "devdb"
REPO = Path(__file__).resolve().parents[2]
MOCK_PLACES = REPO / "be/src/main/resources/mock/places.json"

SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;
DROP VIEW IF EXISTS ai_place_search;
DROP TABLE IF EXISTS place_profile;
DROP TABLE IF EXISTS place_subway;
DROP TABLE IF EXISTS place_hour;
DROP TABLE IF EXISTS place_menu;
DROP TABLE IF EXISTS place;
CREATE TABLE place (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  category_group text NOT NULL,
  category text,
  food_type text,
  station text NOT NULL,
  dong text,
  district text,
  lat double precision,
  lng double precision,
  facilities jsonb NOT NULL DEFAULT '{}',
  pet_allowed boolean,
  parking_free boolean,
  corkage_allowed boolean
);
CREATE TABLE place_subway (
  place_id bigint NOT NULL REFERENCES place (id),
  station text NOT NULL,
  exit text,
  walk_minutes integer
);
CREATE TABLE place_hour (
  place_id bigint NOT NULL REFERENCES place (id),
  day_of_week text NOT NULL,
  open_time time,
  close_time time,
  closed boolean NOT NULL,
  breaks jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE place_menu (
  place_id bigint NOT NULL REFERENCES place (id),
  sort_order integer NOT NULL,
  category text,
  name text NOT NULL,
  price integer,
  representative boolean NOT NULL
);
CREATE TABLE place_profile (
  place_id bigint PRIMARY KEY REFERENCES place (id),
  profile jsonb NOT NULL,
  summary_vector vector(1024),
  price integer,
  analyzed_review_count integer NOT NULL
);
CREATE VIEW ai_place_search AS
SELECT p.id AS place_id, p.category_group, p.station, p.lat, p.lng, p.facilities,
       pp.profile, pp.summary_vector, p.name, p.food_type, p.dong, p.district,
       coalesce((
         SELECT jsonb_agg(jsonb_build_object(
                  'station', s.station, 'exit', s.exit, 'walk_minutes', s.walk_minutes))
         FROM place_subway s WHERE s.place_id = p.id), '[]') AS subways,
       coalesce((
         SELECT jsonb_agg(jsonb_build_object(
                  'day', h.day_of_week, 'open', to_char(h.open_time, 'HH24:MI'),
                  'close', to_char(h.close_time, 'HH24:MI'), 'closed', h.closed,
                  'breaks', h.breaks))
         FROM place_hour h WHERE h.place_id = p.id), '[]') AS hours,
       coalesce((
         SELECT jsonb_agg(jsonb_build_object(
                  'name', m.name, 'category', m.category, 'price', m.price,
                  'representative', m.representative) ORDER BY m.sort_order)
         FROM place_menu m WHERE m.place_id = p.id), '[]') AS menus,
       p.pet_allowed, p.parking_free, p.corkage_allowed, pp.price,
       pp.analyzed_review_count, p.category
FROM place p JOIN place_profile pp ON pp.place_id = p.id;
DROP TABLE IF EXISTS user_preferences;
CREATE TABLE user_preferences (
  user_id text PRIMARY KEY,
  mood text,
  priorities text[] NOT NULL DEFAULT '{}',
  purposes text[] NOT NULL DEFAULT '{}',
  tastes jsonb,
  features jsonb NOT NULL DEFAULT '[]'
);
"""
"""개발 DB 스키마. 뷰는 BE 마이그레이션 V12·V17~V19의 `ai_place_search`와 같은 컬럼이다. 가까운
역(`place_subway`), 영업시간(`place_hour`), 메뉴(`place_menu`)는 BE `place_subways`,
`place_hours`, `place_menus`(V7)처럼 따로 두고 뷰에서 모은다. 가게 가격(`place_profile.price`)은
장소 분석 적재가 프로필 쪽에 넣는다고 가정한 자리다. `user_preferences`는 BE 마이그레이션 V2·V6의 컬럼 중 AI가 읽는 것과 온보딩 원본만
둔다(docs/specs/profile-storage/spec.md)."""

MOCK_REVIEW_COUNT = 100
"""Mock 장소의 분석 리뷰 수(예시 값). 지어낸 조건별 리뷰 수가 최대 수십 건이라 그보다 넉넉히
둔다. 실제 장소는 장소 분석이 읽은 리뷰 수(`place_profiles.analyzed_review_count`)다."""

SAMPLE_TASTES = REPO / "ai/samples/taste/profiles.json"
"""회원 취향 예시. 취향 분석의 샘플 사용자 7명이고 회원 id는 파일의 키("1"~"7")다."""

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

FACILITY_CODES = {
    "주차": "PARKING",
    "무선 인터넷": "WIFI",
    "단체 이용 가능": "GROUP",
    "예약": "RESERVATION",
}
"""Mock 편의시설 이름을 시설 코드로 바꾸는 표. 없는 말은 버린다."""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="데이터 폴더")
    parser.add_argument("--stop", action="store_true", help="띄운 DB를 멈춘다")
    parser.add_argument("--json", type=Path, help="DB 대신 이 파일에 장소를 쓴다")
    args = parser.parse_args()
    if args.stop:
        pgserver.pg_ctl(["stop"], pgdata=args.data)
        print("멈췄다:", args.data)
        return

    places = json.loads(MOCK_PLACES.read_text(encoding="utf-8"))["places"]
    summaries = [_summary(place) for place in places]
    vectors = embedding.encode_documents(summaries)
    rows = [
        _row(place, summary, vector)
        for place, summary, vector in zip(places, summaries, vectors, strict=True)
    ]
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        # 벡터가 길어 장소 하나를 한 줄로 쓴다.
        lines = ",\n".join(json.dumps(row, ensure_ascii=False) for row in rows)
        args.json.write_text(f"[\n{lines}\n]\n", encoding="utf-8")
        print(f"장소 {len(rows)}곳을 썼다: {args.json}")
        return

    args.data.mkdir(parents=True, exist_ok=True)
    # 스크립트가 끝나도 DB는 떠 있게 둔다. 멈출 때는 --stop을 쓴다.
    uri = pgserver.get_server(args.data, cleanup_mode=None).get_uri()
    with psycopg.connect(uri) as conn:
        conn.execute(SCHEMA_SQL)
        for row in rows:
            _insert(conn, row)
        tastes = json.loads(SAMPLE_TASTES.read_text(encoding="utf-8"))
        for user_id, profile in tastes.items():
            _insert_taste(conn, user_id, profile)
    print(f"장소 {len(places)}곳, 회원 취향 {len(tastes)}명을 넣었다.")
    print(f"DATABASE_URL={uri}")


def _summary(place: dict) -> str:
    """40 요약처럼 장소 정보로만 틀 문장을 만든다. 리뷰 내용은 넣지 않는다."""
    info = place["card"]["place"]
    # 메뉴 분류가 없으면 메뉴 이름을 쓴다. 메뉴가 없는 장소도 있다.
    menus = list(
        dict.fromkeys(
            menu.get("category") or menu["name"] for menu in place["detail"]["menus"]
        )
    )
    parts = [
        f"{CATEGORY_NAMES[info['categoryGroup']]}, {info['name']}.",
        f"{', '.join(menus[:3])}." if menus else "",
        f"{STATION_NAMES[info['station']]} 근처.",
    ]
    return " ".join(part for part in parts if part)


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


def _row(place: dict, summary: str, vector: list[float]) -> dict:
    """Mock 장소 하나를 뷰 `ai_place_search`의 행 모양으로 만든다. 요약 벡터는 프로필 안에 둔다."""
    info, detail = place["card"]["place"], place["detail"]
    present = {FACILITY_CODES.get(name) for name in detail["facilities"]}
    # 편의시설에 주차가 없어도 주차 안내가 있으면 주차할 수 있다고 본다.
    if detail.get("parking"):
        present.add("PARKING")
    menus = [
        {
            "name": menu["name"],
            "category": menu.get("category"),
            "price": menu.get("price"),
            "representative": menu["representative"],
        }
        for menu in detail["menus"]
    ]
    return {
        "place_id": info["id"],
        "category_group": info["categoryGroup"],
        "station": info["station"],
        "name": info["name"],
        # BE Mock에는 네이버 업종 이름이 없다.
        "category": None,
        "food_type": None,
        "dong": None,
        "district": _district(detail["address"]),
        "subways": [
            {
                "station": subway["station"],
                "exit": subway.get("exit"),
                "walk_minutes": subway.get("walkMinutes"),
            }
            for subway in detail.get("subways") or []
        ],
        "hours": [
            {
                "day": hours["dayOfWeek"],
                "open": hours.get("open"),
                "close": hours.get("close"),
                "closed": hours["closed"],
                "breaks": hours["breaks"],
            }
            for hours in detail["hours"]
        ],
        "menus": menus,
        "pet_allowed": (detail.get("pet") or {}).get("allowed"),
        "parking_free": (detail.get("parking") or {}).get("free"),
        "corkage_allowed": None,
        "price": store_price(
            [MenuPrice(m["name"], m["price"], m["representative"]) for m in menus]
        ),
        "lat": info["lat"],
        "lng": info["lng"],
        # Mock의 조건별 리뷰 수는 지어낸 값이라, 그 수가 나올 만한 분석 리뷰 수도 정해 둔다.
        "analyzed_review_count": MOCK_REVIEW_COUNT,
        # Mock은 있는 시설만 적는다. 예시라서 적히지 않은 시설은 없음으로 둔다.
        "facilities": {code: code in present for code in FACILITY_CODES.values()},
        "profile": {
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
        },
    }


def _district(address: str | None) -> str | None:
    """주소("서울 강남구 선릉로68길 7")의 구. 없으면 None이다."""
    return next((part for part in (address or "").split() if part.endswith("구")), None)


def _insert(conn: psycopg.Connection, row: dict) -> None:
    conn.execute(
        "INSERT INTO place VALUES "
        "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            row["place_id"],
            row["name"],
            row["category_group"],
            row["category"],
            row["food_type"],
            row["station"],
            row["dong"],
            row["district"],
            row["lat"],
            row["lng"],
            json.dumps(row["facilities"]),
            row["pet_allowed"],
            row["parking_free"],
            row["corkage_allowed"],
        ),
    )
    for subway in row["subways"]:
        conn.execute(
            "INSERT INTO place_subway VALUES (%s, %s, %s, %s)",
            (
                row["place_id"],
                subway["station"],
                subway["exit"],
                subway["walk_minutes"],
            ),
        )
    for hours in row["hours"]:
        conn.execute(
            "INSERT INTO place_hour VALUES (%s, %s, %s, %s, %s, %s)",
            (
                row["place_id"],
                hours["day"],
                hours["open"],
                hours["close"],
                hours["closed"],
                json.dumps(hours["breaks"]),
            ),
        )
    for order, menu in enumerate(row["menus"]):
        conn.execute(
            "INSERT INTO place_menu VALUES (%s, %s, %s, %s, %s, %s)",
            (
                row["place_id"],
                order,
                menu["category"],
                menu["name"],
                menu["price"],
                menu["representative"],
            ),
        )
    vector = row["profile"]["summary"]["vector"]
    conn.execute(
        "INSERT INTO place_profile VALUES (%s, %s, %s::vector, %s, %s)",
        (
            row["place_id"],
            json.dumps(row["profile"], ensure_ascii=False),
            "[" + ",".join(repr(value) for value in vector) + "]",
            row["price"],
            row["analyzed_review_count"],
        ),
    )


def _insert_taste(conn: psycopg.Connection, user_id: str, profile: dict) -> None:
    """취향 프로필 하나를 저장 설계(V6)의 `user_preferences` 행 모양으로 넣는다.

    회원 id는 샘플 파일의 키("1"~"7")다. 7번은 1번 사용자가 리뷰를 쓴 뒤라 프로필의
    `user_id`가 1번과 같다. `features`는 그대로 넣고, 취향 문장은 코드 없는
    칩(`code: null`)으로 바꾼다. 해석 대기 문장(`like: null`)은 저장 설계에 없어 넣지
    않는다.
    """
    chips = [
        {
            "polarity": "LIKE" if text["like"] else "DISLIKE",
            "label": text["text"],
            "code": None,
            "vector": text["vector"],
        }
        for text in profile["free_texts"]
        if text["like"] is not None
    ]
    conn.execute(
        "INSERT INTO user_preferences (user_id, tastes, features) VALUES (%s, %s, %s)",
        (
            user_id,
            json.dumps(chips, ensure_ascii=False),
            json.dumps(profile["features"], ensure_ascii=False),
        ),
    )


if __name__ == "__main__":
    main()
