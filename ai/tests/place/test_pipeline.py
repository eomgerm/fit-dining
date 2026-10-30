from fit_ai.place import pipeline

PLACE = {
    "place_id": "1",
    "name": "카페 A",
    "group": "카페",
    "category": "카페",
    "categoryCodeList": [],
    "station": "강남",
    "conveniences": [],
    "subwayStations": [],
    "menu": {"items": []},
    "visitorReviews": [],
}
PERSONA = {"name": "이름", "description": "설명", "reason": "이유"}


def must_not_call(*a, **k):
    raise AssertionError("GMS를 부르면 안 된다")


def test_analyze_all_reports_each_place_as_it_finishes():
    broken = PLACE | {"place_id": "2", "visitorReviews": None}
    done = []

    results = pipeline.analyze_all(
        [PLACE, broken], call=must_not_call, on_done=done.append
    )

    # 예외로 빠진 장소는 알리지 않는다
    assert [r["place"]["place_id"] for r in done] == ["1"]
    assert done == results


def test_build_profiles_keeps_given_personas_and_reports_new_ones(monkeypatch):
    made = {"1": [], "2": [PERSONA]}
    monkeypatch.setattr(
        pipeline.persona,
        "generate",
        lambda summary, *a, **k: [dict(p) for p in made[summary.split(".")[0]]],
    )
    saved = PERSONA | {"name": "저장"}
    results = [
        {"place": PLACE | {"name": n, "place_id": n}, "n_reviews": 0, "evidence": []}
        for n in ("1", "2", "3")
    ]
    results[2]["personas"] = [saved]
    reported = []

    profiles, _, _ = pipeline.build_profiles(
        results,
        call=must_not_call,
        encode=lambda texts: [[0.0] for _ in texts],
        # 뒤에서 vector가 붙으므로 불린 때의 값을 남긴다
        on_personas=lambda r, ps: reported.append(
            (r["place"]["place_id"], [dict(p) for p in ps])
        ),
    )

    # 저장해 둔 페르소나(3)는 다시 만들지 않고, 빈 결과(1)는 알리지 않는다
    assert reported == [("2", [PERSONA])]
    assert [len(p["personas"]) for p in profiles] == [0, 1, 1]
    assert profiles[2]["personas"][0]["name"] == "저장"
