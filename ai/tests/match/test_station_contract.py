"""역 코드가 DB 제약, BE enum, FE 타입, AI 코드에서 모두 같은지 확인한다(계약 테스트).

역을 더할 때 한 곳을 빠뜨리면 enum에 없는 코드가 DB에 들어가 BE가 주변 카드 전체를 읽지 못하고
(`Station.valueOf` 예외), AI는 그 코드가 든 요청을 거부한다(422). 그래서 네 곳의 목록과 순서를 같게 둔다.
새 역은 BE `PlaceSummary.Station`에 먼저 더하고 나머지를 이 테스트가 알려 주는 대로 맞춘다.
"""

import re
from pathlib import Path
from typing import get_args

from fit_ai.match.conditions import SERVED_STATIONS, STATION_NAMES
from server.schemas import Station as SchemaStation

ROOT = Path(__file__).resolve().parents[3]
BE_ENUM = ROOT / "be/src/main/java/kr/co/fitdining/api/place/dto/PlaceSummary.java"
MIGRATIONS = ROOT / "be/src/main/resources/db/migration"
FE_TYPES = ROOT / "fe/src/domains/place/model/place-types.ts"


def be_stations() -> list[tuple[str, str]]:
    """BE `PlaceSummary.Station`의 (코드, "역"을 뺀 이름)을 선언 순서대로."""
    body = re.search(
        r"public enum Station \{(.*?)\n\t\}",
        BE_ENUM.read_text(encoding="utf-8"),
        re.DOTALL,
    )
    assert body, "PlaceSummary.java에서 Station enum을 찾지 못했다"
    return re.findall(r'^\s*([A-Z][A-Z_]*)\("([^"]+)"\)', body.group(1), re.MULTILINE)


def db_stations() -> list[str]:
    """마지막으로 `ck_places_station`을 정한 마이그레이션의 허용 코드."""
    latest = None
    for path in sorted(
        MIGRATIONS.glob("V*.sql"),
        key=lambda p: int(re.match(r"V(\d+)__", p.name).group(1)),
    ):
        found = re.search(
            r"CONSTRAINT ck_places_station CHECK \(station IN \((.*?)\)\)",
            path.read_text(encoding="utf-8"),
            re.DOTALL,
        )
        if found:
            latest = re.findall(r"'([A-Z_]+)'", found.group(1))
    assert latest, "ck_places_station을 정한 마이그레이션을 찾지 못했다"
    return latest


def fe_stations() -> list[str]:
    """FE `place-types.ts`의 `Station` 유니온."""
    found = re.search(
        r"export type Station =(.*?);", FE_TYPES.read_text(encoding="utf-8"), re.DOTALL
    )
    assert found, "place-types.ts에서 Station 타입을 찾지 못했다"
    return re.findall(r'"([A-Z_]+)"', found.group(1))


def test_station_codes_are_the_same_in_every_layer() -> None:
    """역코드_BE와DB와FE와AI의목록이_코드와순서까지같다"""
    be = [code for code, _ in be_stations()]

    assert be, "BE enum에서 읽은 역이 없다"
    assert len(set(be)) == len(be), "BE enum에 겹치는 코드가 있다"
    assert db_stations() == be
    assert fe_stations() == be
    assert list(get_args(SchemaStation)) == be
    assert list(STATION_NAMES) == be


def test_station_names_are_be_short_names_plus_yeok() -> None:
    """역이름_AI의화면이름은BE의짧은이름에역을붙인것이다"""
    assert STATION_NAMES == {code: f"{short}역" for code, short in be_stations()}


def test_served_stations_are_known_station_codes() -> None:
    """역코드_서비스중인역은모두BE에있는코드다"""
    assert SERVED_STATIONS
    assert len(set(SERVED_STATIONS)) == len(SERVED_STATIONS)
    assert set(SERVED_STATIONS) <= set(STATION_NAMES)
