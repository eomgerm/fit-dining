"""장소·취향 저장소의 Postgres 구현. 장소는 뷰 `ai_place_search`, 장소 페르소나는 뷰
`ai_place_personas`, 취향은 `user_preferences`를 읽는다.

장소는 거르기와 유사도 계산(pgvector `<=>`, 코사인 거리)을 SQL 한 번으로 한다. 장소가
300곳 남짓이라 인덱스 없이 전부 계산해도 빠르고 결과가 정확하다. 장소 뷰는 BE
마이그레이션 V12(`ai_place_search`)가 `places`와 `place_profiles`로 만들고 V17~V19가 검색
2차 컬럼을, V36이 시·도(`sido`, 주소 첫 낱말)를 뒤에 더한다. AI는 그 컬럼 중 `place_id`,
`category_group`, `station`, `name`, `category`(네이버 업종 이름), `sido`, `dong`, `district`,
`subways`(`place_subways`를 모은
`[{station, exit, walk_minutes}]`), `hours`(`place_hours`를 모은 `[{day, open, close, closed,
breaks}]`), `menus`(`place_menus`를 모은 `[{name, category, price, representative}]`),
`price`(가게 가격), `lat`, `lng`, `facilities`, `food_type`, `analyzed_review_count`,
`profile`, `summary_vector`에 의존한다. `price`는 장소 분석 적재가 채우기
전까지 모두 NULL(모름)이다(docs/comparison/spec.md 4.2). 로컬 개발 DB(`scripts/dev_db.py`)는
같은 컬럼의 뷰를 만든다. 페르소나 뷰는 BE 마이그레이션 V33가 `place_personas`에서 만족한 손님
페르소나만 골라 만들고, AI는 `place_id`, `category_group`, `vector`에 의존한다. 취향 표 `user_preferences`의 `features`, `tastes`는 저장 설계
(docs/specs/profile-storage/spec.md, BE 마이그레이션 V2·V6)를 따른다.
"""

import json
import math
import threading
import time
from collections.abc import Collection, Sequence
from typing import Any

import psycopg
from psycopg_pool import ConnectionPool, PoolTimeout

from fit_ai import embedding
from fit_ai.match.candidates import (
    EARTH_RADIUS_M,
    REFERENCE_PLACES,
    Area,
    Candidate,
    Found,
    MapBounds,
    OpenHours,
    PlaceDetails,
    PlaceFilter,
    RadiusArea,
    RegionArea,
    StationArea,
    StoreError,
    VectorCounts,
    persona_rank,
    read_details,
)
from fit_ai.match.interpretation.segments import DAYS
from fit_ai.match.place import Place, PlaceInfo, read_facilities
from fit_ai.match.taste_select import TasteProfile

_FIND_SELECT = """
SELECT place_id, category_group, station, facilities, food_type, analyzed_review_count,
       profile #- '{summary,vector}' AS profile,
       1 - (summary_vector <=> %(query)s::vector) AS similarity
"""

_FIND_WHERE = """WHERE summary_vector IS NOT NULL
  AND profile -> 'embedding' ->> 'model' = %(model)s
  AND profile -> 'embedding' ->> 'revision' = %(revision)s
  AND profile -> 'embedding' ->> 'prompt' = 'document'
  AND (%(category)s::text IS NULL OR category_group = %(category)s::text)
  AND NOT coalesce(category_group = ANY(%(excluded)s::text[]), false)
  AND NOT coalesce(food_type = ANY(%(excluded_foods)s::text[]), false)
  AND (
    jsonb_array_length(%(areas)s::jsonb) = 0
    OR EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(%(areas)s::jsonb) AS area(
        kind text, sido text, district text, dong text, exit text,
        station text, listed_as jsonb, walk_limit_minutes float8, straight_limit_m float8,
        points jsonb, south float8, north float8, west float8, east float8,
        sw_lat float8, sw_lng float8, ne_lat float8, ne_lng float8,
        lat float8, lng float8, radius_m float8)
      WHERE CASE area.kind
        WHEN 'STATION' THEN
          (area.sido IS NULL OR p.sido = area.sido)
          AND (area.district IS NULL OR p.district = area.district)
          AND CASE
            WHEN p.subways @> (area.listed_as -> 0) OR p.subways @> (area.listed_as -> 1) THEN (
              SELECT (area.exit IS NULL OR bool_or(near.exit = area.exit))
                AND coalesce(
                  min(near.walk_minutes) <= area.walk_limit_minutes,
                  p.lat BETWEEN area.south AND area.north
                    AND p.lng BETWEEN area.west AND area.east
                    AND EXISTS (
                      SELECT 1
                      FROM jsonb_to_recordset(area.points) AS pt(lat float8, lng float8)
                      WHERE 2 * 6371000 * asin(least(1.0, sqrt(
                        power(sin(radians(p.lat - pt.lat) / 2), 2)
                        + cos(radians(pt.lat)) * cos(radians(p.lat))
                          * power(sin(radians(p.lng - pt.lng) / 2), 2)
                      ))) <= area.straight_limit_m))
              FROM jsonb_to_recordset(p.subways)
                AS near(station text, exit text, walk_minutes int)
              WHERE near.station IN (area.station, area.station || '역'))
            ELSE
              area.exit IS NULL
              AND p.lat BETWEEN area.south AND area.north
              AND p.lng BETWEEN area.west AND area.east
              AND EXISTS (
                SELECT 1
                FROM jsonb_to_recordset(area.points) AS pt(lat float8, lng float8)
                WHERE 2 * 6371000 * asin(least(1.0, sqrt(
                  power(sin(radians(p.lat - pt.lat) / 2), 2)
                  + cos(radians(pt.lat)) * cos(radians(p.lat))
                    * power(sin(radians(p.lng - pt.lng) / 2), 2)
                ))) <= area.straight_limit_m)
          END
        WHEN 'REGION' THEN
          (area.sido IS NULL OR p.sido = area.sido)
          AND (area.district IS NULL OR p.district = area.district)
          AND (area.dong IS NULL OR p.dong = area.dong)
        WHEN 'BOUNDS' THEN
          (area.sw_lat IS NULL OR p.lat >= area.sw_lat)
          AND (area.sw_lng IS NULL OR p.lng >= area.sw_lng)
          AND (area.ne_lat IS NULL OR p.lat <= area.ne_lat)
          AND (area.ne_lng IS NULL OR p.lng <= area.ne_lng)
        WHEN 'RADIUS' THEN
          2 * 6371000 * asin(least(1.0, sqrt(
            power(sin(radians(p.lat - area.lat) / 2), 2)
            + cos(radians(area.lat)) * cos(radians(p.lat))
              * power(sin(radians(p.lng - area.lng) / 2), 2)
          ))) <= area.radius_m
        ELSE false
      END
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM unnest(%(facilities)s::text[]) AS requested(code)
    WHERE facilities -> requested.code = 'false'::jsonb
  )
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(%(menus)s::jsonb) AS requested(words)
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(requested.words) AS w(word)
      WHERE strpos(regexp_replace(lower(coalesce(p.name, '')), '[^0-9a-z가-힣]', '', 'g'),
                   w.word) > 0
         OR strpos(regexp_replace(lower(coalesce(p.category, '')), '[^0-9a-z가-힣]', '', 'g'),
                   w.word) > 0
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(coalesce(p.menus, '[]'::jsonb)) AS m(item)
           WHERE strpos(
             regexp_replace(lower(coalesce(m.item ->> 'name', '')), '[^0-9a-z가-힣]', '', 'g'),
             w.word) > 0)
    )
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
  AND (
    %(closed_day)s::text IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(coalesce(p.hours, '[]'::jsonb))
        AS h(day text, open time, close time, closed boolean)
      WHERE h.day = %(closed_day)s::text AND coalesce(h.closed, false)
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(coalesce(p.hours, '[]'::jsonb))
        AS h(day text, open time, close time, closed boolean)
      WHERE h.day = %(overnight_day)s::text
        AND NOT coalesce(h.closed, false)
        AND NOT coalesce(h.close > h.open, false)
    )
  )
"""
"""요약 경로와 페르소나 경로가 같이 쓰는 거르기 조건. 장소 뷰의 별칭은 `p`다."""

FIND_SQL = (
    _FIND_SELECT
    + "FROM ai_place_search AS p\n"
    + _FIND_WHERE
    + """ORDER BY summary_vector <=> %(query)s::vector
LIMIT %(k)s
"""
)
"""거르기와 유사도 상위 k곳을 한 번에 뽑는다. 요약 벡터는 가져오지 않는다.

지역은 JSON 목록(`_area_json`)으로 받아 그중 하나에 들면 남긴다. 지역 종류마다 드는 규칙은
`candidates.StationArea`, `RegionArea`, `MapBounds`, `RadiusArea`에 있다. 반경과 역 좌표에서의
거리는 `candidates.distance_m`과 같은 식(하버사인 공식)으로 잰다. 역은 가까운 역 목록에 그 역의
도보 분이 있으면 그 값으로 보고, 없을 때만 역 좌표에서 잰 거리로 본다(`coalesce`). 목록은 같은
역을 "강남"과 "강남역"으로 섞어 써서 두 꼴을 다 본다. 장소마다 목록을 펼치고 거리를 재면 운영
장소 11,712곳에서 역 하나에 1.25초가 걸려서(2026-11-13), 목록에 그 역이 있는지는 jsonb 포함
(`@>`)으로 먼저 보고 거리는 원을 감싸는 위도·경도 범위(`_box`) 안 장소만 잰다. 종류를 모르는 지역에는 아무 장소도
들지 않는다. 목록이 비면 위치로 거르지 않는다. 영업시간은
JSON(`_hours_json`)으로 받아, 요청한 요일 중 쉬거나 시각이 못 미친다고 확인되지 않은 날이
하루라도 있으면 남긴다(`candidates.OpenHours`). 가격과 영업시간을 모르는 장소는 남긴다.
메뉴는 메뉴마다 찾을 말 목록(JSON)으로 받아, 모든 메뉴에 대해 그중 하나가 메뉴 이름, 업종
이름, 가게 이름에 들어 있는 장소만 남긴다(`candidates.PlaceFilter.menus`). 견주는 꼴은
`candidates.menu_key`와 같다. 빼는 음식 종류는 그 종류로 확인된 장소만 빼고 모르면 남긴다.
모임 요일(`closed_day`)이 있으면 그 요일에 쉰다고 확인된 장소만 빼고, 전날(`overnight_day`)
밤부터 이어질 수 있는 장소는 남긴다. 영업시간의 세부 규칙은 모임 계산(`meetup.is_open`)이
후보를 뽑은 뒤 본다."""

DETAILS_SQL = """
SELECT place_id, name, category, hours, menus, price
FROM ai_place_search
WHERE place_id = ANY(%(ids)s::bigint[])
"""
"""모임 계산이 후보마다 더 읽는 영업시간, 메뉴판, 가게 이름, 업종 이름"""

PERSONA_FIND_SQL = (
    _FIND_SELECT
    + """FROM ai_place_search AS p
CROSS JOIN LATERAL (
  SELECT min(pe.vector <=> %(phrase)s::vector) AS persona_distance
  FROM ai_place_personas AS pe
  WHERE pe.place_id = p.place_id
) AS persona
"""
    + _FIND_WHERE
    + """  AND persona.persona_distance IS NOT NULL
ORDER BY persona.persona_distance
LIMIT %(k)s
"""
)
"""페르소나 경로. `FIND_SQL`과 같이 거르고, 만족한 손님 페르소나와 문구의 거리 중 가장 가까운
값으로 줄 세운다. 페르소나가 없는 장소는 들지 않는다. 유사도는 요약 유사도를 그대로 낸다.

페르소나 거리는 거른 장소마다 `LATERAL`로 구한다. 페르소나 전체를 장소별로 먼저 모아 조인하면,
플래너가 거른 장소 수를 1로 잘못 짐작해(프로필 JSON 조건) 중첩 반복을 골라 로컬 DB(장소
4,300곳, 페르소나 17,298개)에서 1.2초가 넘게 걸렸다."""

PERSONA_ITEMS_SQL = """
WITH phrase AS MATERIALIZED (
  SELECT ord, v::vector AS v
  FROM unnest(%(phrases)s::text[]) WITH ORDINALITY AS t(v, ord)
),
reference AS (
  SELECT place_id
  FROM (
    SELECT DISTINCT place_id
    FROM ai_place_personas
    WHERE category_group = ANY(%(scope)s::text[])
  ) AS scoped
  ORDER BY md5(place_id::text)
  LIMIT %(reference)s
),
target AS (
  SELECT place_id, true AS is_reference FROM reference
  UNION ALL
  SELECT place_id, false FROM unnest(%(place_ids)s::bigint[]) AS c(place_id)
)
SELECT t.is_reference, t.place_id, ph.ord, max(1 - (pe.vector <=> ph.v)) AS best
FROM target AS t
JOIN ai_place_personas AS pe ON pe.place_id = t.place_id
CROSS JOIN phrase AS ph
GROUP BY t.is_reference, t.place_id, ph.ord
"""
"""문구마다 기준 장소와 후보의 "가장 비슷한 페르소나 유사도"를 낸다. 기준 장소는 업종 범위
안에서 페르소나가 있는 장소를 장소 id의 md5 순서로 `REFERENCE_PLACES`곳 고른다. 요청과
상관없이 고정이고 저장할 필요가 없다. 문구 벡터는 글자로 받아 한 번만 벡터로 바꾼다
(`MATERIALIZED`). 그러지 않으면 행마다 다시 바꿔 500곳 기준 400ms가 넘게 걸렸다."""

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
        return self._found(
            self._fetch(FIND_SQL, _filter_params(place_filter, query, k))
        )

    def find_by_personas(
        self,
        place_filter: PlaceFilter,
        query: Sequence[float],
        phrase: Sequence[float],
        k: int,
    ) -> Found:
        """조건에 맞는 장소 중 만족한 손님 페르소나가 문구와 가장 가까운 k곳을 뽑는다.

        Args:
            place_filter: 거르기 조건
            query: 요청문 벡터(요약 유사도용)
            phrase: 코드 없는 조건 문구를 이어 붙인 질의의 벡터
            k: 뽑을 후보 수

        Returns:
            뽑은 후보. 요약 유사도 내림차순이다.

        Raises:
            StoreError: 저장소를 읽지 못했을 때
        """
        params = _filter_params(place_filter, query, k)
        found = self._found(
            self._fetch(PERSONA_FIND_SQL, {**params, "phrase": _vector_text(phrase)})
        )
        return Found(
            tuple(sorted(found.candidates, key=lambda c: c.similarity, reverse=True)),
            found.invalid,
        )

    def persona_items(
        self,
        phrases: Sequence[Sequence[float]],
        place_ids: Sequence[int],
        scope: Collection[str],
    ) -> list[dict[int, float]]:
        """문구마다 장소의 페르소나 항목(0~1)을 낸다.

        Args:
            phrases: 문구 벡터
            place_ids: 값을 낼 장소
            scope: 업종 범위

        Returns:
            문구마다 장소 id → 페르소나 항목. 페르소나가 없는 장소는 없다.

        Raises:
            StoreError: 저장소를 읽지 못했을 때
        """
        if not phrases or not place_ids:
            return [{} for _ in phrases]
        rows = self._fetch(
            PERSONA_ITEMS_SQL,
            {
                "phrases": [_vector_text(v) for v in phrases],
                "scope": sorted(scope),
                "reference": REFERENCE_PLACES,
                "place_ids": list(place_ids),
            },
        )
        reference: list[list[float]] = [[] for _ in phrases]
        best: list[dict[int, float]] = [{} for _ in phrases]
        for is_reference, place_id, ord_, value in rows:
            if is_reference:
                reference[ord_ - 1].append(float(value))
            else:
                best[ord_ - 1][place_id] = float(value)
        return [
            {pid: persona_rank(sorted(ref), v) for pid, v in values.items()}
            for ref, values in zip(reference, best, strict=True)
        ]

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

    def details(self, place_ids: Sequence[int]) -> dict[int, PlaceDetails]:
        """장소마다 영업시간, 메뉴판, 가게 이름, 업종 이름, 가게 가격을 읽는다.

        Args:
            place_ids: 장소 id

        Returns:
            장소 id별 정보. 뷰에 없는 id는 빠진다.

        Raises:
            StoreError: 저장소를 읽지 못했을 때
        """
        if not place_ids:
            return {}
        rows = self._fetch(DETAILS_SQL, {"ids": list(place_ids)})
        return {
            place_id: read_details(
                {
                    "name": name,
                    "category": category,
                    "hours": hours,
                    "menus": menus,
                    "price": price,
                }
            )
            for place_id, name, category, hours, menus, price in rows
        }

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

    @staticmethod
    def _found(rows: list[tuple[Any, ...]]) -> Found:
        """후보 행을 읽는다. 프로필을 읽지 못한 장소는 빼고 id를 남긴다."""
        candidates: list[Candidate] = []
        invalid: list[int] = []
        for *row, similarity in rows:
            place = _place(row)
            if place is None:
                invalid.append(row[0])
                continue
            candidates.append(Candidate(place, float(similarity)))
        return Found(tuple(candidates), tuple(invalid))


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


def _filter_params(
    place_filter: PlaceFilter, query: Sequence[float], k: int
) -> dict[str, Any]:
    """`FIND_SQL`과 `PERSONA_FIND_SQL`의 거르기 인자"""
    return {
        "query": _vector_text(query),
        "model": embedding.MODEL_ID,
        "revision": embedding.REVISION,
        "category": place_filter.category_group,
        "excluded": list(place_filter.excluded_categories),
        "excluded_foods": list(place_filter.excluded_food_types),
        "closed_day": place_filter.closed_day,
        "overnight_day": place_filter.overnight_day,
        "areas": json.dumps([_area_json(a) for a in place_filter.areas]),
        "facilities": list(place_filter.facilities),
        "min_price": place_filter.min_price,
        "max_price": place_filter.max_price,
        "hours": _hours_json(place_filter.hours),
        "menus": json.dumps(
            [list(words) for words in place_filter.menus], ensure_ascii=False
        ),
        "k": k,
    }


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
                "sido": area.sido,
                "district": area.district,
                "station": area.station,
                # 가까운 역 목록에 그 역이 있는지 jsonb 포함(@>)으로 본다. 목록은 같은 역을
                # "강남"과 "강남역"으로 섞어 써서 두 꼴을 다 본다.
                "listed_as": [
                    [{"station": area.station}],
                    [{"station": f"{area.station}역"}],
                ],
                "exit": area.exit,
                "walk_limit_minutes": area.walk_limit_minutes,
                "straight_limit_m": area.straight_limit_m,
                "points": [{"lat": lat, "lng": lng} for lat, lng in area.points],
                **_box(area.points, area.straight_limit_m),
            }
        case RegionArea():
            return {
                "kind": "REGION",
                "sido": area.sido,
                "district": area.district,
                "dong": area.dong,
            }
        case MapBounds():
            return {
                "kind": "BOUNDS",
                "sw_lat": area.sw_lat,
                "sw_lng": area.sw_lng,
                "ne_lat": area.ne_lat,
                "ne_lng": area.ne_lng,
            }
        case RadiusArea():
            return {
                "kind": "RADIUS",
                "lat": area.lat,
                "lng": area.lng,
                "radius_m": area.radius_m,
            }


def _box(points: Sequence[tuple[float, float]], radius_m: float) -> dict[str, float]:
    """역 좌표마다 반경 원을 모두 감싸는 위도·경도 범위. 반경 거리를 장소마다 계산하기 전에
    이 범위 밖 장소를 싸게 걸러 낸다. 원보다 넓기만 하고 좁지 않아 결과는 같다. 경도 폭은 구
    위에서 원이 가장 넓게 퍼지는 폭(asin(sin r / cos 위도))이다. 좌표가 없으면 빈 사전이라
    SQL에서 NULL이 되어 좌표로는 아무 장소도 들지 않는다."""
    if not points:
        return {}
    angle = radius_m / EARTH_RADIUS_M
    d_lat = math.degrees(angle)
    souths, norths, wests, easts = [], [], [], []
    for lat, lng in points:
        d_lng = math.degrees(
            math.asin(min(1.0, math.sin(angle) / math.cos(math.radians(lat))))
        )
        souths.append(lat - d_lat)
        norths.append(lat + d_lat)
        wests.append(lng - d_lng)
        easts.append(lng + d_lng)
    return {
        "south": min(souths),
        "north": max(norths),
        "west": min(wests),
        "east": max(easts),
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
