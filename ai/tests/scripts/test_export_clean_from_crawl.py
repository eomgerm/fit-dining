import gzip
import importlib.util
import json
import sqlite3
from pathlib import Path

from fit_ai.place import clean

_spec = importlib.util.spec_from_file_location(
    "export_clean_from_crawl",
    Path(__file__).resolve().parents[2] / "scripts" / "export_clean_from_crawl.py",
)
export_clean_from_crawl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(export_clean_from_crawl)

BBOX = (127.0, 37.0, 128.0, 38.0)
SNAPSHOT = "naver-20261103"


def write_gz(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def detail_state(place_id: str) -> dict:
    return {
        "PlaceDetailBase:1": {
            "name": "슬로우커피",
            "category": "카페",
            "categoryCode": "221275",
            "categoryCodeList": ["220036", "220052"],
            "coordinate": {"x": "127.03", "y": "37.5"},
            "conveniences": ["포장"],
        },
        "ROOT_QUERY": {
            f'placeDetail({{"id":"{place_id}"}})': {
                "base": {"__ref": "PlaceDetailBase:1"}
            }
        },
    }


def make_crawl(tmp_path: Path, place_ids: list[str]) -> tuple[Path, Path]:
    """수집기 data 폴더 모양: state.db(places)와 raw/<스냅샷>/detail/<끝 두 자리>/<id>.json.gz."""
    data = tmp_path / "crawl"
    data.mkdir()
    con = sqlite3.connect(data / "state.db")
    con.execute(
        "CREATE TABLE places (place_id TEXT PRIMARY KEY, common_address TEXT, in_scope INTEGER,"
        " detail_status TEXT, x REAL, y REAL)"
    )
    for pid in place_ids:
        con.execute(
            "INSERT INTO places VALUES (?, '서울 강남구 역삼동', 1, 'done', 127.03, 37.5)",
            (pid,),
        )
    con.commit()
    con.close()
    raw = data / "raw" / SNAPSHOT
    for pid in place_ids:
        write_gz(
            raw / "detail" / pid[-2:] / f"{pid}.json.gz", {"apollo": detail_state(pid)}
        )
    return data, raw


def test_exported_folder_is_readable_by_clean_places_with_reviews_and_conveniences(
    tmp_path,
):
    # build_place_profiles.py가 읽는 clean.places()가 내보낸 폴더를 그대로 읽어야 한다
    data, raw = make_crawl(tmp_path, ["1001", "1002"])
    items = [
        {
            "reviewId": "r1",
            "body": "좋아요",
            "votedKeywords": [{"name": "대화하기 좋아요"}],
        },
        {"reviewId": "r2", "body": "", "votedKeywords": []},
    ]
    write_gz(raw / "reviews" / "01" / "1001.json.gz", {"visitor": {"items": items}})
    write_gz(raw / "reviews" / "02" / "1002.json.gz", {"visitor": {"items": []}})
    out = tmp_path / "clean"

    export_clean_from_crawl.export(data, out, BBOX, 2026)

    places = {p["place_id"]: p for p in clean.places(out)}
    assert places["1001"]["conveniences"] == ["포장"]
    assert places["1001"]["visitorReviews"] == [
        {"review_id": "r1", "body": "좋아요", "voted_keywords": ["대화하기 좋아요"]},
        {"review_id": "r2", "body": None, "voted_keywords": []},
    ]
    assert places["1002"]["visitorReviews"] == []


def test_a_place_without_a_reviews_file_is_kept_and_reported(tmp_path):
    # 리뷰 수집이 실패한 장소다. 리뷰가 없을 뿐 장소는 그대로 내보내고, 빠졌다는 사실은 보고서에 남긴다
    data, _ = make_crawl(tmp_path, ["1001"])

    report = export_clean_from_crawl.export(data, tmp_path / "clean", BBOX, 2026)

    assert report["places_written"] == 1
    assert report["places_without_reviews"] == ["1001"]
    assert report["skipped"] == []


def test_stations_without_a_code_are_counted_in_the_report_and_left_null(tmp_path):
    # 가장 가까운 역이 코드 없는 역이면 places.station은 NULL이다. 어느 역이 몇 곳인지 보고서에 남겨서
    # 새 지역을 적재할 때 코드를 더할 역을 알 수 있게 한다
    data, raw = make_crawl(tmp_path, ["1001", "1002", "1003", "1004"])
    stations = {
        "1001": {
            "id": 999999,
            "name": "판교",
            "displayName": "판교역",
            "walkingDistance": 100,
        },
        "1002": {
            "id": 999999,
            "name": "판교",
            "displayName": "판교역",
            "walkingDistance": 300,
        },
        "1003": {
            "id": 222,
            "name": "강남",
            "displayName": "강남역",
            "walkingDistance": 100,
        },
    }
    for pid, station in stations.items():
        state = detail_state(pid)
        state["SubwayStationInfo:1"] = station
        detail = state["ROOT_QUERY"][f'placeDetail({{"id":"{pid}"}})']
        detail["subwayStations"] = [
            {"name": "2", "station": {"__ref": "SubwayStationInfo:1"}}
        ]
        write_gz(raw / "detail" / pid[-2:] / f"{pid}.json.gz", {"apollo": state})
    out = tmp_path / "clean"

    report = export_clean_from_crawl.export(data, out, BBOX, 2026)

    rows = {r["naver_place_id"]: r for r in clean.read(out, "places.csv")}
    assert [rows[p]["station_code"] for p in ("1001", "1002", "1003", "1004")] == [
        None,
        None,
        "GANGNAM",
        # 1004는 지하철 항목이 아예 없다. 좌표(127.03, 37.5)에서 3km 안의 가장 가까운 역(강남역 0.31km)으로 채운다(D-19)
        "GANGNAM",
    ]
    # 1004는 지하철 항목이 아예 없어서 코드 없는 역으로 센 곳이 없다
    assert report["stations_without_code"] == {"판교역": 2}


def test_a_zip_file_next_to_the_snapshot_folder_is_not_taken_for_the_snapshot(tmp_path):
    # 구미 수집 폴더에는 raw/naver-20261103(폴더)와 raw/naver-20261103.zip(압축 백업)이 같이 있었다.
    # 이름순으로 마지막이 .zip이라 폴더가 아닌 파일을 골라 6,336곳이 전부 건너뛰어졌다
    data, raw = make_crawl(tmp_path, ["1001"])
    (raw.parent / f"{raw.name}.zip").write_bytes(b"backup")

    report = export_clean_from_crawl.export(data, tmp_path / "clean", BBOX, 2026)

    assert report["places_written"] == 1
    assert report["skipped"] == []


def test_a_broken_reviews_file_skips_the_place_and_reports_the_error(tmp_path):
    data, raw = make_crawl(tmp_path, ["1001"])
    broken = raw / "reviews" / "01" / "1001.json.gz"
    broken.parent.mkdir(parents=True)
    broken.write_bytes(b"not a gzip file")

    report = export_clean_from_crawl.export(data, tmp_path / "clean", BBOX, 2026)

    assert report["places_written"] == 0
    assert [s["place_id"] for s in report["skipped"]] == ["1001"]
