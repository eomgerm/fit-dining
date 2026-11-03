"""장소 저장소의 JSON 파일 구현. 실제 장소 DB가 생기기 전에 배포와 개발에 쓰는 임시
구현이다.

장소 파일은 장소마다 `PgPlaceStore`가 읽는 행과 같은 값(장소 정보와 40 프로필)을 담은
객체 목록이다. 요약 벡터는 프로필의 `summary.vector`를 쓴다. 시작할 때 한 번 읽어
메모리에 두고, 거르기와 유사도 순서는 `pg_store.FIND_SQL`과 같은 규칙으로 매번 전부
계산한다. 예시 장소 수십 곳용이다. 예시 파일은 `scripts/dev_db.py --json`으로 만든다.
회원 취향은 파일로 읽지 않는다. 샘플 회원 id가 실제 회원 id와 겹칠 수 있어서다.
"""

import json
import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any, TypeGuard

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
    menu_key,
)
from fit_ai.match.interpretation.segments import DAYS
from fit_ai.match.place import Place, PlaceInfo, read_facilities


class JsonPlaceStore:
    """JSON 파일에서 후보를 뽑는다."""

    def __init__(self, path: Path) -> None:
        """장소 파일을 읽어 둔다.

        파일 모양이 틀리면 앱이 시작할 때 드러나도록 여기서 멈춘다. 장소 하나의 프로필이
        깨진 것은 `find`에서 그 장소만 뺀다(`PgPlaceStore`와 같다).

        Args:
            path: 장소 파일 경로

        Raises:
            OSError: 파일을 읽지 못했을 때
            ValueError: JSON이 아니거나, 객체 목록이 아니거나, 정수 `place_id`가 없는
                장소가 있을 때
        """
        rows = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
            raise ValueError("장소 파일이 객체 목록이 아니다")
        if not all(_is_int(row.get("place_id")) for row in rows):
            raise ValueError("place_id가 정수가 아닌 장소가 있다")
        self._rows: list[dict[str, Any]] = rows
        self._vectors = [_comparable_vector(row) for row in rows]
        self._places = tuple(p for p in map(_place, rows) if p is not None)

    def find(self, place_filter: PlaceFilter, query: Sequence[float], k: int) -> Found:
        """조건에 맞는 장소 중 요청문과 가까운 k곳을 뽑는다.

        Args:
            place_filter: 거르기 조건
            query: 요청문 벡터
            k: 뽑을 후보 수

        Returns:
            뽑은 후보. 프로필을 읽지 못한 장소는 빼고 id를 남긴다.

        Raises:
            StoreError: 장소 벡터와 요청문 벡터의 차원이 다를 때
        """
        scored = [
            (_cosine(vector, query), row)
            for row, vector in zip(self._rows, self._vectors, strict=True)
            if vector is not None and _matches(row, place_filter)
        ]
        # 정렬은 안정적이라 유사도가 같으면 파일 순서다.
        scored.sort(key=lambda item: -item[0])
        candidates: list[Candidate] = []
        invalid: list[int] = []
        # PgPlaceStore처럼 k곳을 자른 뒤에 프로필을 읽는다.
        for similarity, row in scored[:k]:
            place = _place(row)
            if place is None:
                invalid.append(row["place_id"])
                continue
            candidates.append(Candidate(place, similarity))
        return Found(tuple(candidates), tuple(invalid))

    def places(self) -> tuple[Place, ...]:
        """점수 기준을 만들 장소 전체. 시작할 때 읽어 둔 것이다.

        Returns:
            장소. 프로필을 읽지 못한 장소는 뺀다.
        """
        return self._places

    def vector_counts(self) -> VectorCounts:
        """비교할 수 있는 장소와 검색에서 빠지는 장소를 센다.

        Returns:
            장소 수. 빠지는 장소는 벡터가 없거나, 모델·버전이 공유 모듈과 다르거나,
            질의 쪽 벡터인 장소다.
        """
        comparable = sum(vector is not None for vector in self._vectors)
        return VectorCounts(comparable, len(self._vectors) - comparable)


def _place(row: dict[str, Any]) -> Place | None:
    """장소 한 행을 장소로 읽는다. `PgPlaceStore`와 같은 값을 읽고, 못 읽으면 None이다."""
    try:
        info = PlaceInfo(
            row["place_id"],
            row["category_group"],
            row["station"],
            read_facilities(row.get("facilities")),
            row.get("food_type"),
            row.get("analyzed_review_count"),
        )
        return Place.from_dict(row["profile"], info)
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


def _comparable_vector(row: dict[str, Any]) -> list[float] | None:
    """요청문과 비교할 수 있는 요약 벡터. FIND_SQL의 모델 확인 조건과 같다.

    벡터가 없거나, 모델·리비전이 공유 모듈과 다르거나, 문서 쪽(`document`) 벡터가
    아니면 None이다.
    """
    profile = row.get("profile")
    if not isinstance(profile, dict):
        return None
    meta, summary = profile.get("embedding"), profile.get("summary")
    if not isinstance(meta, dict) or not isinstance(summary, dict):
        return None
    if (meta.get("model"), meta.get("revision"), meta.get("prompt")) != (
        embedding.MODEL_ID,
        embedding.REVISION,
        "document",
    ):
        return None
    vector = summary.get("vector")
    if not isinstance(vector, list) or not all(_is_number(v) for v in vector):
        return None
    return vector


def _matches(row: dict[str, Any], place_filter: PlaceFilter) -> bool:
    """FIND_SQL의 거르기 조건과 같다. 조건 값이 None이면 그 조건으로 거르지 않는다."""
    if (
        place_filter.category_group is not None
        and row.get("category_group") != place_filter.category_group
    ):
        return False
    if row.get("category_group") in place_filter.excluded_categories:
        return False
    if place_filter.areas and not any(_in_area(row, a) for a in place_filter.areas):
        return False
    if not _in_price(row.get("price"), place_filter):
        return False
    if place_filter.hours is not None and not _open(row, place_filter.hours):
        return False
    if not all(_sells(row, words) for words in place_filter.menus):
        return False
    facilities = row.get("facilities")
    # 없다고 확인된(false) 시설만 뺀다. 키가 없거나 null이면 모름이라 남긴다.
    return not (
        isinstance(facilities, dict)
        and any(facilities.get(code) is False for code in place_filter.facilities)
    )


def _in_area(row: dict[str, Any], area: Area) -> bool:
    """장소가 지역 하나에 드는지. FIND_SQL의 `area` 조건과 같다."""
    match area:
        case StationArea():
            collected = (
                area.walk_minutes is None
                and area.exit is None
                and area.code is not None
                and row.get("station") == area.code
            )
            return collected or any(_near(subway, area) for subway in _subways(row))
        case RegionArea():
            dong = row.get("dong")
            if area.name in (dong, row.get("district")):
                return True
            return (
                dong is None
                and area.code is not None
                and row.get("station") == area.code
            )
        case MapBounds():
            return _inside(row.get("lat"), row.get("lng"), area)


def _subways(row: dict[str, Any]) -> list[dict[str, Any]]:
    """가까운 역 목록. 없거나 모양이 틀리면 빈 목록이다."""
    subways = row.get("subways")
    if not isinstance(subways, list):
        return []
    return [subway for subway in subways if isinstance(subway, dict)]


def _near(subway: dict[str, Any], area: StationArea) -> bool:
    """가까운 역 하나가 역 지역의 이름, 도보 거리, 출구에 맞는지.

    도보 거리를 모르는 역은 도보 거리 조건에 맞지 않는 것으로 본다(SQL의 NULL 비교).
    """
    if subway.get("station") != area.name:
        return False
    walk = subway.get("walk_minutes")
    if area.walk_minutes is not None and not (
        _is_number(walk) and walk <= area.walk_minutes
    ):
        return False
    return area.exit is None or subway.get("exit") == area.exit


def _sells(row: dict[str, Any], words: Sequence[str]) -> bool:
    """찾을 말 중 하나가 메뉴 이름, 업종 이름, 가게 이름에 들어 있는지. FIND_SQL의 메뉴
    조건과 같다. 모양이 틀린 메뉴는 건너뛴다."""
    menus = row.get("menus")
    texts = [
        menu.get("name")
        for menu in (menus if isinstance(menus, list) else [])
        if isinstance(menu, dict)
    ]
    keys = [
        menu_key(text)
        for text in (*texts, row.get("category"), row.get("name"))
        if isinstance(text, str)
    ]
    return any(word in key for word in words for key in keys)


def _in_price(price: object, place_filter: PlaceFilter) -> bool:
    """가게 가격이 범위 안인지. 가격을 모르면 남긴다(SQL의 NULL 처리와 같다)."""
    if not _is_number(price):
        return True
    low, high = place_filter.min_price, place_filter.max_price
    return (low is None or price >= low) and (high is None or price <= high)


def _open(row: dict[str, Any], hours: OpenHours) -> bool:
    """요청한 요일 중 안 맞는다고 확인되지 않은 날이 하루라도 있는지. FIND_SQL의 영업시간
    조건과 같다."""
    days = {
        day.get("day"): day
        for day in row.get("hours") or []
        if isinstance(day, dict) and isinstance(day.get("day"), str)
    }
    return any(not _closed_for(days.get(day), hours) for day in hours.days or DAYS)


def _closed_for(day: dict[str, Any] | None, hours: OpenHours) -> bool:
    """그 요일에 쉬거나 시각이 조건에 못 미친다고 확인됐는지. 모르면 거짓이다."""
    if day is None:
        return False
    if day.get("closed") is True:
        return True
    open_at, close_at = _minutes(day.get("open")), _minutes(day.get("close"))
    if open_at is None or close_at is None or open_at == close_at:
        return False
    if close_at < open_at:
        close_at += 24 * 60
    return (hours.until is not None and close_at < hours.until) or (
        hours.since is not None and open_at > hours.since
    )


def _minutes(clock: object) -> int | None:
    """시각("HH:MM")을 0시부터 센 분으로 바꾼다. 모양이 틀리면 None이다."""
    if not isinstance(clock, str):
        return None
    hour, _, minute = clock.partition(":")
    if not (hour.isdigit() and minute.isdigit()):
        return None
    return int(hour) * 60 + int(minute)


def _inside(lat: object, lng: object, bounds: MapBounds) -> bool:
    """좌표가 지도 영역 안인지. 빠진 경계는 제한하지 않는다.

    경계가 있는데 좌표가 없으면 SQL처럼 영역 밖으로 본다.
    """
    for low, value, high in (
        (bounds.sw_lat, lat, bounds.ne_lat),
        (bounds.sw_lng, lng, bounds.ne_lng),
    ):
        if low is None and high is None:
            continue
        if not _is_number(value):
            return False
        if (low is not None and value < low) or (high is not None and value > high):
            return False
    return True


def _cosine(vector: Sequence[float], query: Sequence[float]) -> float:
    """코사인 유사도. pgvector의 `1 - (a <=> b)`와 같다."""
    if len(vector) != len(query):
        # pgvector도 차원이 다르면 SQL 오류를 낸다.
        raise StoreError("장소 벡터와 요청문 벡터의 차원이 다르다")
    dot = math.fsum(a * b for a, b in zip(vector, query, strict=True))
    norm = math.sqrt(math.fsum(a * a for a in vector)) * math.sqrt(
        math.fsum(b * b for b in query)
    )
    return dot / norm if norm else 0.0


def _is_number(value: object) -> TypeGuard[int | float]:
    # bool은 int의 하위 타입이라 따로 막는다.
    return isinstance(value, int | float) and not isinstance(value, bool)


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)
