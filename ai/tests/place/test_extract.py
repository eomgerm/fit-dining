import json

import pytest

from fit_ai.features import FEATURES
from fit_ai.place.extract import (
    SLOTS,
    build_messages,
    dedupe,
    extract,
    parse_batch,
    response_format,
)


def rv(review_id, body):
    return {"review_id": review_id, "body": body}


def it(slot, quote, code=None, direction=1, text=None, liked=None, kind="taste"):
    return {
        "slot": slot,
        "quote": quote,
        "code": code,
        "direction": direction,
        "liked": liked,
        "kind": kind,
        "text": text,
    }


def answer(*per_review):
    """리뷰 번호를 키로, 그 리뷰의 항목 목록을 값으로 둔 응답."""
    return {str(i): items for i, items in enumerate(per_review, 1)}


def test_dedupe_merges_near_copies_and_keeps_the_first():
    # 지어낸 문장이다. 실제 리뷰 원문은 테스트에 넣지 않는다(PRD AC-25)
    a = rv("r1", "평일 점심에 팀원들이랑 와서 김치찌개 먹고 갔어요 ㅎㅎ")
    b = rv("r2", "평일 점심에 팀원들이랑 와서 김치찌개 먹고 갔어요")
    c = rv("r3", "잔잔해서 이야기 나누기 편했어요")
    kept, merged = dedupe([a, b, c])
    assert [r["review_id"] for r in kept] == ["r1", "r3"]
    assert merged == 1


def test_dedupe_leaves_reviews_under_ten_chars_alone():
    kept, merged = dedupe([rv("r1", "정말 맛있어요!"), rv("r2", "정말 맛있어요!")])
    assert len(kept) == 2 and merged == 0


def test_dedupe_counts_length_after_collapsing_whitespace():
    body = "굿" + "\n" * 9 + "굿"
    kept, merged = dedupe([rv("r1", body), rv("r2", body)])
    assert len(kept) == 2 and merged == 0


def test_response_format_requires_exactly_one_key_per_review():
    # 배열로 받으면 모델이 리뷰를 빼먹거나 없는 번호를 더했다. 키를 모두 필수로 둔다
    schema = response_format(3)["json_schema"]
    assert schema["strict"] is True
    body = schema["schema"]
    assert body["required"] == ["1", "2", "3"]
    assert body["additionalProperties"] is False
    item_props = body["properties"]["2"]["items"]["properties"]
    assert item_props["slot"]["enum"] == list(SLOTS)
    assert {c for codes in SLOTS.values() for c in codes} <= set(FEATURES)


def test_messages_number_reviews_in_json_instead_of_sending_ids():
    system, user = build_messages(["조용해요", "1. 맛 2. 양"])
    assert json.loads(user["content"]) == [
        {"no": 1, "review": "조용해요"},
        {"no": 2, "review": "1. 맛 2. 양"},
    ]
    assert "LIVELY" in system["content"]


def test_parse_keeps_valid_items_and_drops_made_up_quotes_and_wrong_slot_codes():
    bodies = ["옆 테이블 소리가 커서 말소리가 묻혔어요", "된장찌개가 진해요"]
    resp = answer(
        [
            it("소음·분위기", "옆 테이블 소리가 커서", "LIVELY", -1),
            it("소음·분위기", "음악이 좋아요", "GOOD_MUSIC"),  # 원문에 없음
            it("공간", "말소리가 묻혔어요", "LIVELY", -1),  # 공간 칸의 코드가 아님
            it("소음·분위기", "  ", "QUIET"),  # 빈 구절
        ],
        [it("메뉴 평가", "된장찌개가 진해요", None, 1, "된장찌개가 진하다")],
    )
    out, dropped = parse_batch(resp, bodies)
    assert dropped == 3
    assert out[0] == [it("소음·분위기", "옆 테이블 소리가 커서", "LIVELY", -1)]
    assert out[1] == [
        it("메뉴 평가", "된장찌개가 진해요", None, 1, "된장찌개가 진하다")
    ]


def test_parse_keeps_quote_that_differs_from_review_only_in_whitespace():
    # 리뷰의 줄바꿈을 모델이 띄어쓰기로 옮겨 적는다
    body = "자리가 넓고\n\n대화하기 좋았어요"
    resp = answer([it("공간", "자리가 넓고 대화하기", "SPACIOUS_SEATING")])
    out, dropped = parse_batch(resp, [body])
    assert dropped == 0
    assert out[0][0]["quote"] == "자리가 넓고 대화하기"


def test_parse_drops_empty_string_code():
    out, dropped = parse_batch(answer([it("공간", "넓어요", "")]), ["넓어요"])
    assert out == [[]] and dropped == 1


def test_parse_drops_text_when_a_code_is_given():
    resp = answer([it("공간", "넓어요", "SPACIOUS_SEATING", 1, "넓다")])
    out, _ = parse_batch(resp, ["넓어요"])
    assert out[0][0]["text"] is None


def test_parse_keeps_liked_only_on_flavor_codes_and_marks_coded_items_taste():
    bodies = ["달지 않아서 좋았고 자리가 넓어요", "크림 파스타 소스가 진했어요"]
    resp = answer(
        [
            it("맛 성향", "달지 않아서 좋았고", "FOOD_SWEET", -1, liked=1),
            # 맛 코드가 아니면 liked를 버리고, 코드가 있으면 kind는 taste다
            it("공간", "자리가 넓어요", "SPACIOUS_SEATING", liked=1, kind="facility"),
        ],
        # 메뉴 평가 칸에도 맛 코드를 붙인다
        [it("메뉴 평가", "크림 파스타 소스가 진했어요", "FOOD_RICH", liked=None)],
    )
    out, dropped = parse_batch(resp, bodies)
    assert dropped == 0
    assert out[0] == [
        it("맛 성향", "달지 않아서 좋았고", "FOOD_SWEET", -1, liked=1),
        it("공간", "자리가 넓어요", "SPACIOUS_SEATING"),
    ]
    assert out[1] == [it("메뉴 평가", "크림 파스타 소스가 진했어요", "FOOD_RICH")]


def test_parse_keeps_kind_of_items_without_a_code():
    resp = answer(
        [it("방문 맥락", "콘센트가 많아서", None, 1, "콘센트가 많다", kind="facility")]
    )
    out, _ = parse_batch(resp, ["콘센트가 많아서 좋아요"])
    assert out[0][0]["kind"] == "facility"


def test_parse_asks_again_when_a_review_is_missing_or_shape_is_wrong():
    with pytest.raises(ValueError):  # 리뷰가 빠짐
        parse_batch(answer([]), ["가", "나"])
    with pytest.raises(ValueError):  # 없는 번호가 더해짐
        parse_batch(answer([], []), ["가"])
    with pytest.raises(TypeError):
        parse_batch(answer([it("없는 칸", "가")]), ["가"])
    with pytest.raises(TypeError):
        parse_batch(answer([it("공간", "가", direction=0)]), ["가"])
    with pytest.raises(TypeError):
        parse_batch(answer([it("맛 성향", "가", "FOOD_SWEET", liked=0)]), ["가"])
    with pytest.raises(TypeError):
        parse_batch(answer([it("공간", "가", kind="없는 종류")]), ["가"])
    with pytest.raises(TypeError):
        parse_batch({"1": "목록이 아님"}, ["가"])


def test_extract_batches_reviews_and_counts_failed_ones():
    reviews = [rv(f"r{i}", f"리뷰 {i} 넓어요") for i in range(3)] + [rv("empty", "  ")]
    calls, sent = [], []

    def call(messages, parse, **kw):
        calls.append(kw)
        n = len(json.loads(messages[1]["content"]))
        sent.append(n)
        if len(calls) == 2:
            return None  # 두 번째 묶음은 실패
        items = [
            it("공간", "넓어요", "SPACIOUS_SEATING"),
            it("공간", "없는 구절", "PRETTY_SPACE"),
        ]
        return parse(answer(*[items] * n))

    rows, failed, dropped = extract(reviews, call=call, batch_size=2)
    assert sent == [2, 1]  # 빈 본문은 보내지 않는다
    assert calls[0]["response_format"] == response_format(2)
    assert calls[1]["response_format"] == response_format(1)
    assert [r["review_id"] for r in rows] == ["r0", "r1"]
    assert rows[0] == {
        "review_id": "r0",
        "source": "naver_text",
        "code": "SPACIOUS_SEATING",
        "direction": 1,
        "slot": "공간",
        "quote": "넓어요",
        "text": None,
        "liked": None,
        "kind": "taste",
    }
    assert failed == 1
    assert dropped == 2


def test_extract_uses_luna_without_reasoning_or_temperature():
    seen = {}

    def call(messages, parse, **kw):
        seen.update(kw)
        return parse(answer([]))

    extract([rv("r0", "넓어요")], call=call)
    assert (seen["model"], seen["temperature"], seen["reasoning_effort"]) == (
        "gpt-6-luna",
        None,
        "none",
    )
