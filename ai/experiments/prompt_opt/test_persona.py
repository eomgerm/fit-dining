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
