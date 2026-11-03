"""장소·취향 저장소의 Postgres 구현. 장소는 뷰 `ai_place_search`, 취향은
`user_preferences`를 읽는다.

장소는 거르기와 유사도 계산(pgvector `<=>`, 코사인 거리)을 SQL 한 번으로 한다. 장소가
300곳 남짓이라 인덱스 없이 전부 계산해도 빠르고 결과가 정확하다. 장소 뷰는 BE
마이그레이션 V12(`ai_place_search`)가 `places`와 `place_profiles`로 만들고 V17·V18이 검색
2차 컬럼을 뒤에 더한다. AI는 그 컬럼 중 `place_id`, `category_group`, `station`, `dong`,
`district`, `subways`(`place_subways`를 모은 `[{station, exit, walk_minutes}]`), `hours`
(`place_hours`를 모은 `[{day, open, close, closed, breaks}]`), `price`(가게 가격), `lat`, `lng`,
`facilities`, `food_type`, `analyzed_review_count`, `profile`, `summary_vector`에 의존한다. `price`는 장소 분석 적재가 채우기
전까지 모두 NULL(모름)이다(docs/comparison/spec.md 4.2). 로컬 개발 DB(`scripts/dev_db.py`)는
같은 컬럼의 뷰를 만든다. 취향 표 `user_preferences`의 `features`, `tastes`는 저장 설계
(docs/specs/profile-storage/spec.md, BE 마이그레이션 V2·V6)를 따른다.
"""

import json
import threading
import time
from collections.abc import Sequence
from typing import Any

import psycopg
from psycopg_pool import ConnectionPool, PoolTimeout

from fit_ai import embedding
from fit_ai.match.candidates import (
    Area,
    Candidate,
    Found,
    MapBounds,
    OpenHours,
    PlaceFilter,
    RegionArea,
    StationArea,
    StoreError,
    VectorCounts,
)
from fit_ai.match.interpretation.segments import DAYS
from fit_ai.match.place import Place, PlaceInfo, read_facilities
from fit_ai.match.taste_select import TasteProfile

FIND_SQL = """
SELECT place_id, category_group, station, facilities, food_type, analyzed_review_count,
       profile #- '{summary,vector}' AS profile,
       1 - (summary_vector <=> %(query)s::vector) AS similarity
FROM ai_place_search AS p
WHERE summary_vector IS NOT NULL
  AND profile -> 'embedding' ->> 'model' = %(model)s
  AND profile -> 'embedding' ->> 'revision' = %(revision)s
  AND profile -> 'embedding' ->> 'prompt' = 'document'
  AND (%(category)s::text IS NULL OR category_group = %(category)s::text)
  AND NOT coalesce(category_group = ANY(%(excluded)s::text[]), false)
  AND (
    jsonb_array_length(%(areas)s::jsonb) = 0
    OR EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(%(areas)s::jsonb) AS area(
        kind text, name text, code text, walk_minutes int, exit text,
        sw_lat float8, sw_lng float8, ne_lat float8, ne_lng float8)
      WHERE CASE area.kind
        WHEN 'STATION' THEN
          (area.walk_minutes IS NULL AND area.exit IS NULL AND p.station = area.code)
          OR EXISTS (
            SELECT 1
            FROM jsonb_to_recordset(coalesce(p.subways, '[]'::jsonb))
              AS near(station text, exit text, walk_minutes int)
            WHERE near.station = area.name
              AND (area.walk_minutes IS NULL OR near.walk_minutes <= area.walk_minutes)
              AND (area.exit IS NULL OR near.exit = area.exit))
        WHEN 'REGION' THEN
          p.dong = area.name OR p.district = area.name
          OR (p.dong IS NULL AND p.station = area.code)
        ELSE
          (area.sw_lat IS NULL OR p.lat >= area.sw_lat)
          AND (area.sw_lng IS NULL OR p.lng >= area.sw_lng)
          AND (area.ne_lat IS NULL OR p.lat <= area.ne_lat)
          AND (area.ne_lng IS NULL OR p.lng <= area.ne_lng)
      END
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM unnest(%(facilities)s::text[]) AS requested(code)
    WHERE facilities -> requested.code = 'false'::jsonb
  )
  AND (%(min_price)s::int IS NULL OR p.price IS NULL OR p.price >= %(min_price)s::int)
  AND (%(max_price)s::int IS NULL OR p.price IS NULL OR p.price <= %(max_price)s::int)
  AND (
    %(hours)s::jsonb IS NULL
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(%(hours)s::jsonb -> 'days') AS requested(day)
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(coalesce(p.hours, '[]'::jsonb))
          AS h(day text, open time, close time, closed boolean)
        CROSS JOIN LATERAL (
          SELECT extract(epoch FROM h.open) / 60 AS open_at,
                 extract(epoch FROM h.close) / 60
                   + CASE WHEN h.close <= h.open THEN 1440 ELSE 0 END AS close_at
        ) AS t
        WHERE h.day = requested.day
          AND (
            coalesce(h.closed, false)
            OR (h.open <> h.close AND (
              coalesce(t.close_at < (%(hours)s::jsonb ->> 'until')::int, false)
              OR coalesce(t.open_at > (%(hours)s::jsonb ->> 'since')::int, false)))
          )
      )
    )
  )
ORDER BY summary_vector <=> %(query)s::vector
LIMIT %(k)s
"""
"""거르기와 유사도 상위 k곳을 한 번에 뽑는다. 요약 벡터는 가져오지 않는다.

지역은 JSON 목록(`_area_json`)으로 받아 그중 하나에 들면 남긴다. 역과 동에 드는 규칙은
`candidates.StationArea`, `RegionArea`에 있다. 목록이 비면 위치로 거르지 않는다. 영업시간은
JSON(`_hours_json`)으로 받아, 요청한 요일 중 쉬거나 시각이 못 미친다고 확인되지 않은 날이
하루라도 있으면 남긴다(`candidates.OpenHours`). 가격과 영업시간을 모르는 장소는 남긴다."""

PLACES_SQL = """
SELECT place_id, category_group, station, facilities, food_type, analyzed_review_count,
       profile #- '{summary,vector}' AS profile
FROM ai_place_search
"""
"""점수 기준을 만들 장소 전체. 요약 벡터는 가져오지 않는다."""

PLACES_TTL_SECONDS = 300.0
"""장소 전체를 다시 읽기 전에 저장해 두는 시간(초). 장소 데이터는 적재 때만 바뀌어서, 검색마다
읽지 않고 잠시 다시 쓴다."""

COUNT_SQL = """
SELECT count(*) FILTER (WHERE comparable), count(*) FILTER (WHERE NOT comparable)
FROM (
  SELECT coalesce(
           summary_vector IS NOT NULL
           AND profile -> 'embedding' ->> 'model' = %(model)s
           AND profile -> 'embedding' ->> 'revision' = %(revision)s
           AND profile -> 'embedding' ->> 'prompt' = 'document',
           false) AS comparable
  FROM ai_place_search
) AS checked
"""
"""비교할 수 있는 장소와 검색에서 빠지는 장소(벡터 없음, 모델·버전 다름, 질의 쪽
벡터)를 센다."""

TASTE_SQL = """
SELECT features, tastes FROM user_preferences WHERE user_id = %(user_id)s
"""
"""회원 한 명의 취향 계산 결과(`features`)와 온보딩 칩(`tastes`)을 읽는다."""

SESSION_OPTIONS = "-c statement_timeout=2000 -c default_transaction_read_only=on"
"""접속마다 거는 설정. 쿼리는 2초를 넘기면 끊고, 읽기만 한다."""


class PgPlaceStore:
    """뷰 `ai_place_search`에서 후보를 뽑는다. 접속은 풀로 돌려 쓴다."""

    def __init__(self, dsn: str, pool_size: int = 2) -> None:
        """접속 풀을 연다. 접속은 처음 쓸 때 맺는다.

        Args:
            dsn: Postgres 접속 주소(`DATABASE_URL`)
            pool_size: 컨테이너 하나가 여는 접속 수 상한. Postgres 접속 수 상한(60)을
                컨테이너 수로 나눠 정한다.
        """
        self._pool = _open_pool(dsn, pool_size)
        self._places: tuple[Place, ...] = ()
        self._places_read_at: float | None = None
        self._places_lock = threading.Lock()

    def find(self, place_filter: PlaceFilter, query: Sequence[float], k: int) -> Found:
        """조건에 맞는 장소 중 요청문과 가까운 k곳을 뽑는다.

        Args:
            place_filter: 거르기 조건
            query: 요청문 벡터
            k: 뽑을 후보 수

        Returns:
            뽑은 후보. 프로필을 읽지 못한 장소는 빼고 id를 남긴다.

        Raises:
            StoreError: 저장소를 읽지 못했을 때
        """
        rows = self._fetch(
            FIND_SQL,
            {
                "query": _vector_text(query),
                "model": embedding.MODEL_ID,
                "revision": embedding.REVISION,
                "category": place_filter.category_group,
                "excluded": list(place_filter.excluded_categories),
                "areas": json.dumps([_area_json(a) for a in place_filter.areas]),
                "facilities": list(place_filter.facilities),
                "min_price": place_filter.min_price,
                "max_price": place_filter.max_price,
                "hours": _hours_json(place_filter.hours),
                "k": k,
            },
        )
        candidates: list[Candidate] = []
        invalid: list[int] = []
        for *row, similarity in rows:
            place = _place(row)
            if place is None:
                invalid.append(row[0])
                continue
            candidates.append(Candidate(place, float(similarity)))
        return Found(tuple(candidates), tuple(invalid))

    def places(self) -> tuple[Place, ...]:
        """점수 기준을 만들 장소 전체. 읽은 뒤 `PLACES_TTL_SECONDS` 동안 다시 쓴다.

        Returns:
            장소. 프로필을 읽지 못한 장소는 뺀다.

        Raises:
            StoreError: 저장소를 읽지 못했을 때
        """
        with self._places_lock:
            now = time.monotonic()
            if (
                self._places_read_at is None
                or now - self._places_read_at > PLACES_TTL_SECONDS
            ):
                rows = self._fetch(PLACES_SQL, {})
                self._places = tuple(p for p in map(_place, rows) if p is not None)
                self._places_read_at = now
            return self._places

    def vector_counts(self) -> VectorCounts:
        """비교할 수 있는 장소와 검색에서 빠지는 장소를 센다.

        Returns:
            장소 수. 빠지는 장소는 벡터가 없거나, 모델·버전이 공유 모듈과 다르거나,
            질의 쪽 벡터인 장소다.

        Raises:
            StoreError: 저장소를 읽지 못했을 때
        """
        rows = self._fetch(
            COUNT_SQL, {"model": embedding.MODEL_ID, "revision": embedding.REVISION}
        )
        comparable, mismatched = rows[0]
        return VectorCounts(int(comparable), int(mismatched))

    def close(self) -> None:
        """접속 풀을 닫는다."""
        self._pool.close()

    def _fetch(self, sql: str, params: dict[str, Any]) -> list[tuple[Any, ...]]:
        return _fetch(self._pool, sql, params, "장소")


class PgTasteStore:
    """`user_preferences`에서 회원 취향을 꺼낸다. 접속은 풀로 돌려 쓴다.

    취향 분석이 온보딩 때와 04:00 배치에서 계산해 둔 결과만 읽는다. 온보딩 원본
    (`mood`, `priorities`, `purposes`)은 읽지 않는다.
    """

    def __init__(self, dsn: str, pool_size: int = 1) -> None:
        """접속 풀을 연다. 접속은 처음 쓸 때 맺는다.

        Args:
            dsn: Postgres 접속 주소(`DATABASE_URL`)
            pool_size: 접속 수 상한. 검색마다 한 행을 읽는 짧은 쿼리라 하나로 둔다.
        """
        self._pool = _open_pool(dsn, pool_size)

    def find(self, user_id: str) -> TasteProfile | None:
        """회원 한 명의 취향 프로필을 꺼낸다.

        Args:
            user_id: 회원 id

        Returns:
            취향 프로필. `user_preferences`에 그 회원의 행이 없으면 None이다.

        Raises:
            StoreError: 저장소를 읽지 못했을 때
            ValueError: 저장된 취향의 값이 범위를 벗어났거나 `polarity`가 다를 때
            KeyError: 저장된 취향에 필수 필드가 없을 때
            TypeError: 저장된 취향의 타입이 다를 때
        """
        rows = _fetch(self._pool, TASTE_SQL, {"user_id": user_id}, "취향")
        if not rows:
            return None
        features, tastes = rows[0]
        return TasteProfile.from_stored(user_id, features, tastes)

    def close(self) -> None:
        """접속 풀을 닫는다."""
        self._pool.close()


def _open_pool(dsn: str, size: int) -> ConnectionPool:
    return ConnectionPool(
        dsn,
        min_size=0,
        max_size=size,
        timeout=3,
        kwargs={"connect_timeout": 3, "options": SESSION_OPTIONS},
        open=True,
    )


def _fetch(
    pool: ConnectionPool, sql: str, params: dict[str, Any], name: str
) -> list[tuple[Any, ...]]:
    """쿼리 결과를 모두 읽는다. 실패하면 `name` 저장소를 읽지 못한 StoreError다."""
    try:
        with pool.connection() as conn:
            return conn.execute(sql, params).fetchall()
    except (psycopg.Error, PoolTimeout) as e:
        # 메시지에 접속 주소나 값이 섞일 수 있어 종류만 남긴다.
        raise StoreError(f"{name} 저장소를 읽지 못했다: {type(e).__name__}") from e


def _place(row: Sequence[Any]) -> Place | None:
    """뷰 한 행(`PLACES_SQL`의 컬럼 순서)을 장소로 읽는다. 프로필을 읽지 못하면 None이다."""
    place_id, category_group, station, facilities, food_type, review_count, profile = (
        row
    )
    try:
        info = PlaceInfo(
            place_id,
            category_group,
            station,
            read_facilities(facilities),
            food_type,
            review_count,
        )
        return Place.from_dict(profile, info)
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


def _area_json(area: Area) -> dict[str, Any]:
    """FIND_SQL의 `area` 행 모양으로 바꾼다. 종류(`kind`)에 따라 쓰는 키가 다르다."""
    match area:
        case StationArea():
            return {
                "kind": "STATION",
                "name": area.name,
                "code": area.code,
                "walk_minutes": area.walk_minutes,
                "exit": area.exit,
            }
        case RegionArea():
            return {"kind": "REGION", "name": area.name, "code": area.code}
        case MapBounds():
            return {
                "kind": "BOUNDS",
                "sw_lat": area.sw_lat,
                "sw_lng": area.sw_lng,
                "ne_lat": area.ne_lat,
                "ne_lng": area.ne_lng,
            }


def _hours_json(hours: OpenHours | None) -> str | None:
    """FIND_SQL의 영업시간 조건 모양으로 바꾼다. 요일이 없으면 모든 요일이다."""
    if hours is None:
        return None
    return json.dumps(
        {"days": list(hours.days or DAYS), "until": hours.until, "since": hours.since}
    )


def _vector_text(vector: Sequence[float]) -> str:
    """pgvector 입력 형식(`[0.1,0.2]`)으로 바꾼다."""
    return "[" + ",".join(repr(float(value)) for value in vector) + "]"
