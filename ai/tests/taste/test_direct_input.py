import pytest

from fit_ai.features import FEATURES
from fit_ai.taste.direct_input import (
    RESPONSE_FORMAT,
    build_messages,
    interpret,
    parse_items,
    to_chips,
)

T0 = "2026-10-22T10:00:00+09:00"


def item(quote, like=True, code=None, positive_text=None, kind="taste"):
    return {
        "quote": quote,
        "kind": kind,
        "like": like,
        "code": code,
        "positive_text": positive_text,
    }


def answering(*items):
    """GMS 대신 parse에 고정 응답을 넣는다."""
    return lambda messages, parse, **_: parse({"items": list(items)})


def test_prompt_describes_every_code_and_passes_text_as_user_message():
    system, user = build_messages("조용한 곳")
    for f in FEATURES.values():
        assert f.code in system["content"]
        assert f.phrase in system["content"]
    assert user == {"role": "user", "content": "조용한 곳"}


def test_interpret_requests_strict_schema_limited_to_code_table():
    seen = {}

    def call(messages, parse, **kw):
        seen.update(kw)
        return parse({"items": []})

    interpret("조용한 곳", "u1", T0, call=call)
    assert seen["response_format"] is RESPONSE_FORMAT
    schema = RESPONSE_FORMAT["json_schema"]
    assert schema["strict"] is True
    item_props = schema["schema"]["properties"]["items"]["items"]["properties"]
    assert item_props["code"]["enum"] == [*FEATURES, None]
    assert item_props["kind"]["enum"] == ["taste", "facility", "quality", "budget"]


@pytest.mark.parametrize(
    ("kind", "like", "kept"),
    [
        ("taste", True, "주차 되는 곳"),
        ("facility", True, None),
        ("quality", True, None),
        ("budget", True, None),
        ("taste", False, None),
    ],
)
def test_positive_text_kept_only_for_liked_taste(kind, like, kept):
    text = "주차 되는 곳이면 좋겠어요"
    resp = {"items": [item(text, like, positive_text="주차 되는 곳", kind=kind)]}
    assert parse_items(resp, text)[0]["positive_text"] == kept


@pytest.mark.parametrize("kind", ["facility", "quality", "budget"])
def test_code_kept_only_for_taste(kind):
    text = "주차 되는 조용한 곳"
    resp = {"items": [item(text, code="QUIET", kind=kind)]}
    assert parse_items(resp, text) == [item(text, kind=kind)]


@pytest.mark.parametrize("positive_text", [None, "", " "])
def test_liked_taste_without_code_or_sentence_is_output_check_failure(positive_text):
    # 비교에 쓸 문장 없이 취향을 조용히 잃지 않게 재요청한다
    text = "마라탕 좋아해요"
    with pytest.raises(ValueError):
        parse_items({"items": [item(text, positive_text=positive_text)]}, text)


def test_drops_quote_not_in_text_and_unknown_code():
    text = "조용한 곳 좋아요"
    liked = item("좋아요", positive_text="좋은 곳")
    resp = {
        "items": [
            item("넓은 곳", code="SPACIOUS_SEATING"),
            item("조용한 곳", code="NOPE"),
            liked,
        ]
    }
    assert parse_items(resp, text) == [liked]


@pytest.mark.parametrize("quote", ["", " "])
def test_drops_blank_quote(quote):
    text = "시끄럽지 않은 데가 좋아요"
    resp = {"items": [item(quote, code="FOOD_SPICY"), item(text, code="QUIET")]}
    assert parse_items(resp, text) == [item(text, code="QUIET")]


def test_all_items_dropped_is_output_check_failure():
    # 모델 형식 실수로 취향을 잃지 않게 재요청하고, 그래도 안 되면 해석 실패다
    text = "시끄럽지 않은 데가 좋아요"
    with pytest.raises(ValueError):
        parse_items({"items": [item(text + ".", code="QUIET")]}, text)


def test_empty_items_is_valid_result():
    assert parse_items({"items": []}, "안녕하세요") == []


def test_disliked_pole_becomes_liked_opposite_pole():
    text = "활기찬 데 싫어요"
    assert parse_items({"items": [item(text, False, "LIVELY")]}, text) == [
        item(text, True, "QUIET")
    ]


@pytest.mark.parametrize("code", ["SHORT_WAIT", "PURPOSE_GROUP"])
def test_disliked_importance_or_purpose_keeps_sentence_only(code):
    text = "그런 데 싫어요"
    assert parse_items({"items": [item(text, False, code)]}, text) == [
        item(text, False)
    ]


@pytest.mark.parametrize(
    "resp",
    [
        {},
        {"items": "x"},
        {"items": [{"quote": "a"}]},
        {"items": [item("a", like="yes")]},
    ],
)
def test_malformed_response_raises_for_retry(resp):
    with pytest.raises(TypeError):
        parse_items(resp, "a")


def test_rows_from_codes_sentences_and_food_dislike():
    text = "시끄럽지 않은 데가 좋아요. 담백한 국물 좋아요. 너무 매운 건 못 먹어요"
    call = answering(
        item("시끄럽지 않은 데가 좋아요", code="QUIET"),
        item("담백한 국물 좋아요", positive_text="담백한 국물 요리가 좋아요"),
        item("너무 매운 건 못 먹어요", False, "FOOD_SPICY"),
    )
    base = {"user_id": "u3", "source": "free_text", "created_at": T0}
    assert interpret(text, "u3", T0, call=call) == [
        base | {"code": "QUIET", "direction": 1, "quote": "시끄럽지 않은 데가 좋아요"},
        base
        | {
            "code": None,
            "direction": 1,
            "quote": "담백한 국물 좋아요",
            "positive_text": "담백한 국물 요리가 좋아요",
        },
        base
        | {"code": "FOOD_SPICY", "direction": -1, "quote": "너무 매운 건 못 먹어요"},
    ]


def test_same_code_is_recorded_once_per_input():
    text = "조용하고 시끄럽지 않은 곳"
    call = answering(
        item("조용하고", code="QUIET"), item("시끄럽지 않은 곳", code="QUIET")
    )
    assert [r["code"] for r in interpret(text, "u1", T0, call=call)] == ["QUIET"]


def test_failed_interpretation_returns_none():
    assert (
        interpret("한잔하는 곳", "u6", T0, call=lambda messages, parse, **_: None)
        is None
    )


def test_rejects_text_over_100_chars():
    with pytest.raises(ValueError):
        interpret("가" * 101, "u1", T0, call=answering())


def row(code=None, direction=1, positive_text=None, quote="원문"):
    r = {
        "user_id": None,
        "code": code,
        "direction": direction,
        "source": "free_text",
        "quote": quote,
        "created_at": T0,
    }
    if positive_text is not None:
        r["positive_text"] = positive_text
    return r


def test_chips_from_codes_sentences_and_food_dislike():
    rows = [
        row("QUIET"),
        row(positive_text="담백한 국물 요리를 먹을 수 있는 곳"),
        row("FOOD_SPICY", -1),
    ]
    assert to_chips(rows) == [
        {"polarity": "LIKE", "label": FEATURES["QUIET"].label, "code": "QUIET"},
        {
            "polarity": "LIKE",
            "label": "담백한 국물 요리를 먹을 수 있는 곳",
            "code": None,
        },
        {
            "polarity": "DISLIKE",
            "label": FEATURES["FOOD_SPICY"].label,
            "code": "FOOD_SPICY",
        },
    ]


def test_kept_only_rows_are_not_chips():
    # 시설·품질·예산, 코드 없는 비선호는 반영되지 않으므로 칩으로 보여 주지 않는다
    assert to_chips([row(), row(direction=-1)]) == []


def test_every_code_label_fits_chip_limit():
    assert all(1 <= len(f.label) <= 20 for f in FEATURES.values())


@pytest.mark.parametrize(
    ("text", "label"),
    [
        (
            "비 오는 날 따뜻한 국수를 먹을 수 있는 곳",
            "비 오는 날 따뜻한 국수를 먹을 수",
        ),
        ("가" * 19 + " 나", "가" * 19),  # 자른 끝 공백은 지운다
        ("가" * 19 + "😀", "가" * 19),  # BE는 UTF-16 단위로 센다
        ("줄\n바꿈  있는\t곳", "줄 바꿈 있는 곳"),  # BE는 제어 문자를 거부한다
    ],
)
def test_sentence_label_is_cut_to_20_without_controls(text, label):
    assert to_chips([row(positive_text=text)])[0]["label"] == label


def test_at_most_10_chips():
    rows = [row(positive_text=f"{i}번째 곳") for i in range(12)]
    assert len(to_chips(rows)) == 10
