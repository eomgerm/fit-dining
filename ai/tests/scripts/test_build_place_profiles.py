import importlib.util
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "build_place_profiles",
    Path(__file__).resolve().parents[2] / "scripts" / "build_place_profiles.py",
)
build_place_profiles = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_place_profiles)


def test_main_runs_both_gms_stages_with_16_workers(monkeypatch, tmp_path):
    # 장소 7천여 곳을 4개씩 돌리면 6시간이 넘게 걸려서 이 스크립트만 16개로 돌린다
    # (공용 기본값 pipeline.WORKERS는 샘플 빌더 같은 다른 스크립트도 쓰므로 그대로 둔다)
    seen = {}

    def analyze_all(todo, **kw):
        seen["analyze_all"] = kw.get("workers")
        return []

    def build_profiles(results, **kw):
        seen["build_profiles"] = kw.get("workers")
        return [], {}, {}

    monkeypatch.setattr(build_place_profiles, "OUT", tmp_path / "out")
    monkeypatch.setattr(
        build_place_profiles.clean,
        "places",
        lambda path: [{"place_id": "1", "name": "A"}],
    )
    monkeypatch.setattr(build_place_profiles.pipeline, "analyze_all", analyze_all)
    monkeypatch.setattr(build_place_profiles.pipeline, "build_profiles", build_profiles)
    monkeypatch.delenv("GMS_ENABLED", raising=False)
    monkeypatch.setattr(sys, "argv", ["build_place_profiles.py", str(tmp_path)])

    build_place_profiles.main()

    assert seen == {"analyze_all": 16, "build_profiles": 16}
