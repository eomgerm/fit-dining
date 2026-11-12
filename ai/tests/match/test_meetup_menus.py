"""모임 참여자들의 먹고 싶은 메뉴 해석을 확인한다(spec AC-53). GMS 호출은 가짜다."""

from fit_ai.match.meetup_menus import read_menus, rule_menus


def answer(data):
    """받은 메시지를 남기고 정해 둔 응답을 주는 가짜 GMS 호출"""
    calls: list[list[dict]] = []

    def call(messages, parse, **_):
        calls.append(messages)
        return None if data is None else parse(data)

    return call, calls


def test_one_call_for_all_texts() -> None:
    """메뉴해석_글을모두모아한번만부르고_글만보낸다"""
    call, calls = answer(
        {
            "items": [
                {"index": 0, "menus": [{"value": "곱창", "spellings": ["소곱창"]}]},
                {"index": 1, "menus": [{"value": "마라탕"}, {"value": "훠궈"}]},
            ]
        }
    )

    reading = read_menus(["곱창 먹고 싶어요", "얼큰한 마라탕이나 훠궈"], call=call)

    assert len(calls) == 1
    assert calls[0][1]["content"] == "0. 곱창 먹고 싶어요\n1. 얼큰한 마라탕이나 훠궈"
    assert [[m.value for m in menus] for menus in reading.menus] == [
        ["곱창"],
        ["마라탕", "훠궈"],
    ]
    assert reading.menus[0][0].spellings == ("소곱창",)
    assert not reading.llm_failed


def test_missing_index_is_empty() -> None:
    """메뉴해석_답에없는글은_메뉴가없다"""
    call, _ = answer({"items": [{"index": 1, "menus": [{"value": "피자"}]}]})

    reading = read_menus(["강남에서", "피자"], call=call)

    assert [len(m) for m in reading.menus] == [0, 1]


def test_no_texts_no_call() -> None:
    """메뉴해석_적은사람이없으면_부르지않는다"""
    call, calls = answer({"items": []})

    assert read_menus([], call=call).menus == ()
    assert calls == []


def test_llm_failure_falls_back_to_rules() -> None:
    """메뉴해석_LLM이실패하면_규칙으로대신하고실패를알린다"""
    call, _ = answer(None)

    reading = read_menus(["곱창, 마라탕"], call=call)

    assert reading.llm_failed
    assert [m.value for m in reading.menus[0]] == ["곱창", "마라탕"]


def test_unreadable_answer_falls_back() -> None:
    """메뉴해석_모양이틀린답이면_규칙으로대신한다"""
    call, _ = answer({"items": [{"index": 5, "menus": []}]})

    reading = read_menus(["라멘"], call=call)

    assert reading.llm_failed
    assert [m.value for m in reading.menus[0]] == ["라멘"]


def test_rule_menus_keep_order_and_limit() -> None:
    """규칙해석_적은순서를지키고_세개까지쓴다"""
    assert [m.value for m in rule_menus("곱창/족발, 보쌈 순대")] == [
        "곱창",
        "족발",
        "보쌈",
    ]
