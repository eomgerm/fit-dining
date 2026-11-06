"""persona.rules 검사. mlflow가 필요해 tests/ 밖에 둔다. 실행법은 ai/README.md "프롬프트 최적화"."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from persona import leaks, load, rules

ROW = {
    "reviews": [
        {
            "source": "naver_text",
            "items": [["대기·서비스", "SHORT_WAIT", -1, "줄", None]],
        },
        {
            "source": "naver_text",
            "items": [["대기·서비스", "SHORT_WAIT", -1, "줄", None]],
        },
        {
            "source": "naver_text",
            "items": [["방문 목적", "PURPOSE_SOLO", 1, "혼밥", None]],
        },
        {
            "source": "naver_text",
            "items": [["방문 목적", "PURPOSE_SOLO", 1, "혼밥", None]],
        },
    ]
}
TEXT = "첫 문장이다. 둘째 문장이다. 셋째 문장이다."


def p(name="점심 혼밥 직장인", like=True, ids=("r3", "r4")):
    return {
        "name": name,
        "description": TEXT,
        "reason": TEXT,
        "like": like,
        "review_ids": list(ids),
    }


def test_no_output_is_zero():
    assert rules(None, ROW)[0] == 0.0


def test_all_pass():
    out = {
        "personas": [p(), p("줄 서기 싫은 손님", False, ("r1", "r2"))],
        "dropped": [],
    }
    assert rules(out, ROW) == (1.0, "모두 통과")


def test_missing_negative_persona_lowers_coverage():
    score, why = rules({"personas": [p()], "dropped": []}, ROW)
    assert score == (1 + 1 + 0.5 + 1) / 4
    assert "빠짐: 웨이팅 적은 곳(아쉬웠어요, r1, r2)" in why


def test_like_must_match_cited_review_direction():
    out = {"personas": [p(), p("줄 서기 싫은 손님", True, ("r1", "r2"))], "dropped": []}
    score, why = rules(out, ROW)
    assert score == (1 + 0.5 + 0.5 + 1) / 4
    assert "방향: 줄 서기 싫은 손님" in why


def test_dropped_and_format():
    bad = p(name="혼밥") | {"reason": "한 문장이다."}
    out = {
        "personas": [bad, p("줄 서기 싫은 손님", False, ("r1", "r2"))],
        "dropped": ["x: 없는 리뷰 번호"],
    }
    score, why = rules(out, ROW)
    assert score == (2 / 3 + 1 + 1 + 0.5) / 4
    assert "name이 2~4단어가 아니다" in why and "reason가 1문장이다" in why


def test_leaks_finds_place_name_and_long_quote():
    row = load()[0]
    name = row["summary"].split(". ")[0]
    quote = next(
        it[3] for rv in row["reviews"] for it in rv["items"] if len(it[3]) >= 10
    )
    found = leaks(f"예: {name}에서 '{quote}'처럼 쓴다.")
    assert f"{row['id']}: {name}" in found and f"{row['id']}: {quote}" in found


def test_judge_retries_when_gms_hangs(monkeypatch):
    import threading
    from types import SimpleNamespace

    import persona

    calls, hang = [], threading.Event()

    def fake(inputs, outputs):
        calls.append(1)
        if len(calls) == 1:
            hang.wait(5)  # 첫 호출은 응답이 없다
        return SimpleNamespace(value=0.75, rationale="ok")

    monkeypatch.setattr(persona, "grounded", fake)
    monkeypatch.setattr(persona, "JUDGE_TIMEOUT", 0.2)
    out = {"personas": [p()], "dropped": []}
    assert persona._judge({}, out) == (0.75, "ok")
    assert len(calls) == 2
    hang.set()


def test_judge_gives_zero_after_all_tries_fail(monkeypatch):
    import persona

    def fake(inputs, outputs):
        raise RuntimeError("502")

    monkeypatch.setattr(persona, "grounded", fake)
    score, why = persona._judge({}, {"personas": [p()], "dropped": []})
    assert score == 0.0 and "502" in why


def test_search_ranks_own_phrases_above_distractors(monkeypatch):
    import numpy as np
    import persona

    # 글자 하나를 축 하나로 두는 가짜 임베딩. 같은 글자가 많을수록 가깝다
    def fake(texts, query):
        v = np.array([[t.count(c) for c in "가나다라마"] for t in texts], float) + 1e-9
        return v / np.linalg.norm(v, axis=1, keepdims=True)

    monkeypatch.setattr(persona, "_encode", fake)
    monkeypatch.setattr(persona, "_phrases", lambda row: ["가가"])
    monkeypatch.setattr(persona, "_distractors", lambda rid: ("나나", "다다", "가나"))
    row = {"id": "x"}
    good = {"personas": [p() | {"name": "가가 손님", "description": "", "reason": ""}]}
    bad = {"personas": [p() | {"name": "나나 손님", "description": "", "reason": ""}]}
    assert persona.search(good, row)[0] == 1.0
    score, why = persona.search(bad, row)
    assert score < 0.5 and "가가" in why
    assert persona.search({"personas": []}, row) == (0.0, "좋아할 손님 페르소나가 없다")


def test_every_place_builds_product_messages_with_standout_features():
    import persona

    for row in load():
        user = persona._messages(row)[0][1]["content"]
        if row["standout"]:
            assert "두드러진 특징(같은 업종 평균보다 많이 언급됨): 없음" not in user
