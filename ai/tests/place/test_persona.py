import pytest

from fit_ai.place.persona import (
    RESPONSE_FORMAT,
    build_messages,
    generate,
    parse_personas,
    persona_text,
)

BODIES = {
    "aaa": "퇴근하고 팀 회식으로 왔는데 단체석이 넉넉해서 좋았어요",
    "bbb": "시끄러워서 대화가 힘들었어요",
    "ccc": "양이 많아요",
}
EVIDENCE = [
    {
        "review_id": "aaa",
        "source": "naver_keyword",
        "code": "PURPOSE_GROUP",
        "direction": 1,
        "slot": None,
        "quote": "단체모임 하기 좋아요",
        "text": None,
    },
    {
        "review_id": "bbb",
        "source": "naver_text",
        "code": "LIVELY",
        "direction": -1,
        "slot": "소음·분위기",
        "quote": "시끄러워서",
        "text": None,
    },
    {
        "review_id": "ccc",
        "source": "naver_text",
        "code": None,
        "direction": 1,
        "slot": "메뉴 평가",
        "quote": "양이 많아요",
        "text": "양이 많다",
    },
    {
        "review_id": None,
        "source": "menu",
        "code": "FOOD_SPICY",
        "direction": 1,
        "slot": None,
        "quote": "매운 갈비찜",
        "text": None,
    },
]


def persona(
    name="회식 손님",
    like=True,
    ids=("r1",),
    description="여럿이 오는 손님",
    reason="단체석이 넉넉하다",
):
    return {
        "name": name,
        "description": description,
        "reason": reason,
        "like": like,
        "review_ids": list(ids),
    }


def test_messages_group_text_evidence_by_review_and_count_keywords():
    # Persona4Rec처럼 리뷰 단위로 묶는다. 키워드 투표는 줄마다 넣으면 근거가 흐려져 개수로 센다
    messages, ids = build_messages("요약 문장", EVIDENCE)
    user = messages[1]["content"]
    assert "요약 문장" in user
    assert set(ids.values()) == {
        "bbb",
        "ccc",
    }  # 키워드만 있는 리뷰와 메뉴 근거는 번호가 없다
    assert "aaa" not in user and "bbb" not in user
    assert "네이버 키워드 투표: 단체모임 하기 좋아요 1건" in user
    dislikes, likes = user.split("아쉬웠어요 근거가 있는 리뷰")[1].split(
        "좋았어요 근거만 있는 리뷰"
    )
    assert "활기찬 곳" in dislikes and "활기찬 곳" not in likes
    assert "소음·분위기 / LIVELY" in dislikes  # 칸과 코드를 함께 넣는다
    assert "양이 많다" in likes


def test_messages_never_carry_raw_review_quotes():
    # 리뷰 구절을 넣었더니 모델이 따옴표로 옮겨 적었다. 코드 이름과 정리 문장만 넣는다
    messages, _ = build_messages("요약", EVIDENCE)
    assert "시끄러워서" not in messages[1]["content"]


def test_parse_catches_copied_text_across_line_breaks_in_reviews():
    body = "회식으로 왔는데\n단체석이 넉넉해서 좋았어요"
    copied = persona(reason="회식으로 왔는데 단체석이 넉넉해서 좋았어요")
    resp = {"personas": [copied, persona(name="다른 손님")]}
    out = parse_personas(resp, {"r1": "aaa"}, [body])
    assert [p["name"] for p in out] == ["다른 손님"]


def test_parse_drops_persona_that_quotes_review_text_even_briefly():
    # 20자 미만이어도 따옴표로 리뷰 구절을 옮기면 화면에 외부 리뷰가 인용된다(PRD AC-25)
    body = "값도 착하고 그릇도 커서 다음에 또 들를래요"
    quoting = persona(reason="리뷰에서 '값도 착하고 그릇도'라는 말이 많았다")
    own_words = persona(name="다른 손님", reason="'든든한 한 끼'를 찾는 손님이다")
    resp = {"personas": [quoting, own_words]}
    out = parse_personas(resp, {"r1": "aaa"}, [body])
    assert [p["name"] for p in out] == ["다른 손님"]


def test_prompt_forbids_quoting_reviews():
    messages, _ = build_messages("요약", EVIDENCE)
    assert "따옴표로 인용하지 않는다" in messages[0]["content"]


def test_parse_catches_copied_text_when_the_persona_adds_line_breaks():
    body = "퇴근하고 팀 회식으로 왔는데 단체석이 넉넉해서 좋았어요"
    copied = persona(reason="퇴근하고 팀 회식으로\n왔는데  단체석이 넉넉해서")
    resp = {"personas": [copied, persona(name="다른 손님")]}
    out = parse_personas(resp, {"r1": "aaa"}, [body])
    assert [p["name"] for p in out] == ["다른 손님"]


def test_messages_point_out_standout_features_without_dropping_the_others():
    # 가성비처럼 온보딩 취향인 특징도 페르소나가 있어야 사용자와 맞댈 수 있다.
    # 빼지 않고, 같은 특징이라도 이 장소의 메뉴·상황으로 구별되게 쓰게 한다
    feature_rows = [
        {"code": "GOOD_MUSIC", "like_count": 30, "dislike_count": 0, "is_label": True},
        {
            "code": "VALUE_FOR_MONEY",
            "like_count": 9,
            "dislike_count": 0,
            "is_label": False,
        },
    ]
    messages, _ = build_messages("요약", EVIDENCE, feature_rows)
    system, user = messages[0]["content"], messages[1]["content"]
    standout = user.split("이 장소에서 두드러진 특징")[1].split("\n")[0]
    assert "음악이 좋은 곳" in standout and "가성비" not in standout
    assert "흔한 특징" not in user + system
    assert "빠짐없이" in system and "구별되게" in system
    # Persona4Rec: 설명·이유는 3문장, 이유는 구체적 근거 인용, 거의 같은 페르소나 금지
    assert "3문장" in system and "거의 같은 페르소나" in system


def test_parse_drops_unknown_review_ids_and_copied_review_text():
    ids = {"r1": "aaa", "r2": "bbb"}
    resp = {
        "personas": [
            persona(ids=("r1",)),
            persona(name="없는 리뷰", ids=("r1", "r9")),
            persona(
                name="베낀 손님",
                reason="회식으로 왔는데 단체석이 넉넉해서 좋았어요",
                ids=("r1",),
            ),
            persona(name="조용히 대화하려던 손님", like=False, ids=("r2",)),
        ]
    }
    out = parse_personas(resp, ids, list(BODIES.values()))
    assert [p["name"] for p in out] == ["회식 손님", "조용히 대화하려던 손님"]
    assert out[0]["review_ids"] == ["aaa"]


def test_schema_limits_persona_count():
    # 근거가 많은 장소에서 모델이 8개를 만들었다. 다시 요청해도 같아서 스키마로 막는다
    personas = RESPONSE_FORMAT["json_schema"]["schema"]["properties"]["personas"]
    assert (personas["minItems"], personas["maxItems"]) == (2, 7)


def test_parse_asks_again_when_count_is_out_of_range():
    with pytest.raises(ValueError):
        parse_personas({"personas": [persona()]}, {"r1": "aaa"}, [])
    with pytest.raises(ValueError):
        parse_personas({"personas": [persona()] * 8}, {"r1": "aaa"}, [])


def test_generate_numbers_personas_and_skips_places_without_reviews():
    def call(messages, parse, **kw):
        assert kw["response_format"] is RESPONSE_FORMAT
        return parse(
            {"personas": [persona(ids=("r1",)), persona(name="b", ids=("r2",))]}
        )

    out = generate("요약", EVIDENCE, BODIES, call=call)
    assert [p["persona_id"] for p in out] == ["p1", "p2"]

    def must_not_call(*a, **k):
        raise AssertionError("리뷰 근거가 없으면 GMS를 부르지 않는다")

    assert generate("요약", [EVIDENCE[3]], BODIES, call=must_not_call) == []
    assert generate("요약", EVIDENCE, BODIES, call=lambda *a, **k: None) == []


def test_persona_text_joins_fields_with_periods():
    assert persona_text(persona()) == "회식 손님. 여럿이 오는 손님. 단체석이 넉넉하다."


def test_generate_uses_luna_without_reasoning_or_temperature():
    seen = {}

    def call(messages, parse, **kw):
        seen.update(kw)  # 응답이 없으면 generate는 빈 목록을 돌려준다

    generate("요약", EVIDENCE, BODIES, call=call)
    assert (seen["model"], seen["temperature"], seen["reasoning_effort"]) == (
        "gpt-6-luna",
        None,
        "none",
    )


def test_prompt_keeps_data_handling_talk_off_the_screen():
    messages, _ = build_messages("요약", EVIDENCE)
    assert "판단한 과정은 쓰지 않는다" in messages[0]["content"]
