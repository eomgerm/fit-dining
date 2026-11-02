"""장소·취향 저장소의 Postgres 구현. 장소는 뷰 `ai_place_search`, 취향은
`user_preferences`를 읽는다.

장소는 거르기와 유사도 계산(pgvector `<=>`, 코사인 거리)을 SQL 한 번으로 한다. 장소가
300곳 남짓이라 인덱스 없이 전부 계산해도 빠르고 결과가 정확하다. 장소 뷰는 BE
마이그레이션 V12(`ai_place_search`)가 `places`와 `place_profiles`로 만든다. AI는 그 컬럼
`place_id`, `category_group`, `station`, `lat`, `lng`, `facilities`, `profile`,
`summary_vector`에만 의존한다. 로컬 개발 DB(`scripts/dev_db.py`)는 같은 컬럼의 뷰를
만든다. 취향 표 `user_preferences`의 `features`, `tastes`는 저장 설계
(docs/specs/profile-storage/spec.md, BE 마이그레이션 V2·V6)를 따른다.
"""

from collections.abc import Sequence
from typing import Any

import psycopg
from psycopg_pool import ConnectionPool, PoolTimeout

from fit_ai import embedding
from fit_ai.match.candidates import (
    Candidate,
    Found,
    PlaceFilter,
    StoreError,
    VectorCounts,
)
from fit_ai.match.place import Place, PlaceInfo, read_facilities
from fit_ai.match.taste_select import TasteProfile

FIND_SQL = """
SELECT place_id, category_group, station, facilities,
       profile #- '{summary,vector}' AS profile,
       1 - (summary_vector <=> %(query)s::vector) AS similarity
FROM ai_place_search
WHERE summary_vector IS NOT NULL
  AND profile -> 'embedding' ->> 'model' = %(model)s
  AND profile -> 'embedding' ->> 'revision' = %(revision)s
  AND profile -> 'embedding' ->> 'prompt' = 'document'
  AND (%(category)s::text IS NULL OR category_group = %(category)s::text)
  AND (%(station)s::text IS NULL OR station = %(station)s::text)
  AND (%(sw_lat)s::float8 IS NULL OR lat >= %(sw_lat)s::float8)
  AND (%(sw_lng)s::float8 IS NULL OR lng >= %(sw_lng)s::float8)
  AND (%(ne_lat)s::float8 IS NULL OR lat <= %(ne_lat)s::float8)
  AND (%(ne_lng)s::float8 IS NULL OR lng <= %(ne_lng)s::float8)
  AND NOT EXISTS (
    SELECT 1 FROM unnest(%(facilities)s::text[]) AS requested(code)
    WHERE facilities -> requested.code = 'false'::jsonb
  )
ORDER BY summary_vector <=> %(query)s::vector
LIMIT %(k)s
"""
"""거르기와 유사도 상위 k곳을 한 번에 뽑는다. 요약 벡터는 가져오지 않는다."""

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
        bounds = place_filter.bounds
        rows = self._fetch(
            FIND_SQL,
            {
                "query": _vector_text(query),
                "model": embedding.MODEL_ID,
                "revision": embedding.REVISION,
                "category": place_filter.category_group,
                "station": place_filter.station,
                "sw_lat": bounds.sw_lat if bounds else None,
                "sw_lng": bounds.sw_lng if bounds else None,
                "ne_lat": bounds.ne_lat if bounds else None,
                "ne_lng": bounds.ne_lng if bounds else None,
                "facilities": list(place_filter.facilities),
                "k": k,
            },
        )
        candidates: list[Candidate] = []
        invalid: list[int] = []
        for place_id, category_group, station, facilities, profile, similarity in rows:
            try:
                info = PlaceInfo(
                    place_id, category_group, station, read_facilities(facilities)
                )
                place = Place.from_dict(profile, info)
            except (ValueError, KeyError, TypeError, AttributeError):
                invalid.append(place_id)
                continue
            candidates.append(Candidate(place, float(similarity)))
        return Found(tuple(candidates), tuple(invalid))

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


def _vector_text(vector: Sequence[float]) -> str:
    """pgvector 입력 형식(`[0.1,0.2]`)으로 바꾼다."""
    return "[" + ",".join(repr(float(value)) for value in vector) + "]"
