"""요청 해석을 확인한다.

LLM 출력 검사, 규칙 폴백, 후속 조건 합치기, 결과 없음 문구를 본다. LLM은 정해 둔
문자열로 답하는 가짜다.
"""

import json

import pytest

from fit_ai.match.interpretation import (
    DEFAULT_CHANGE_SUMMARY,
    MAX_TEXT_LENGTH,
    SYSTEM_PROMPT,
    Conditions,
    empty_reason,
    interpret,
    interpret_by_rules,
)
from fit_ai.match.llm import LlmError

PREVIOUS = Conditions(
    text="역삼역 모임하기 좋은 술집",
    embedding_text="역삼역 모임하기 좋은 술집",
    codes=("PURPOSE_GROUP",),
    category_group="BAR",
    station="YEOKSAM",
)


class FixedLlm:
    """정해 둔 문자열로 답하고 받은 입력을 남긴다."""

    def __init__(self, raw: str) -> None:
        self.raw = raw
        self.prompts: list[str] = []

    def complete_json(self, system: str, user: str) -> str:
        self.prompts.append(user)
        return self.raw


class BrokenLlm:
    def complete_json(self, system: str, user: str) -> str:
        raise LlmError("GMS 응답 시간 초과")


def answer(**overrides: object) -> str:
    data = {
        "text": None,
        "embedding_text": "조용한 카페",
        "codes": ["QUIET"],
        "category_group": "CAFE",
        "station": "GANGNAM",
        "nearby": False,
        "change_summary": None,
    }
    data.update(overrides)
    return json.dumps(data, ensure_ascii=False)


class TestLlm:
    """LLM 해석"""

    def test_new_search(self) -> None:
        """LLM해석_새검색이면_LLM의조건을쓰고text는요청문그대로다"""
        llm = FixedLlm(answer())

        result = interpret(llm, "강남역 시끄러운 곳 말고 카페")

        assert result.conditions == Conditions(
            text="강남역 시끄러운 곳 말고 카페",
            embedding_text="조용한 카페",
            codes=("QUIET",),
            category_group="CAFE",
            station="GANGNAM",
        )
        assert result.change_summary is None
        assert result.llm_error is None
        assert llm.prompts == ["요청: 강남역 시끄러운 곳 말고 카페"]

    def test_unknown_values_are_dropped(self) -> None:
        """LLM해석_모르는코드와업종역이면_코드는버리고업종역은거르지않는다"""
        raw = answer(
            codes=["QUIET", "NOISY", "QUIET", 3], category_group="PUB", station="X"
        )

        conditions = interpret(FixedLlm(raw), "조용한 펍").conditions

        assert conditions.codes == ("QUIET",)
        assert (conditions.category_group, conditions.station) == (None, None)

    def test_null_nearby_is_false(self) -> None:
        """LLM해석_nearby가null이면_근처검색이아닌것으로본다"""
        result = interpret(FixedLlm(answer(nearby=None)), "강남역 조용한 카페")

        assert result.llm_error is None
        assert result.conditions.nearby is False

    def test_station_means_not_nearby(self) -> None:
        """LLM해석_역과근처검색이함께오면_역을기준으로찾는다"""
        result = interpret(FixedLlm(answer(nearby=True)), "강남역 근처 카페")

        assert result.conditions.station == "GANGNAM"
        assert result.conditions.nearby is False

    def test_fenced_json(self) -> None:
        """LLM해석_코드펜스로감싸도_읽는다"""
        result = interpret(FixedLlm(f"```json\n{answer()}\n```"), "강남역 카페")

        assert result.llm_error is None

    @pytest.mark.parametrize(
        "raw",
        [
            "조용한 카페",
            "[]",
            answer(embedding_text=" "),
            answer(codes="QUIET"),
            answer(nearby="false"),
        ],
    )
    def test_bad_output_falls_back_to_rules(self, raw: str) -> None:
        """LLM해석_형식이틀리면_규칙으로해석하고이유를남긴다"""
        result = interpret(FixedLlm(raw), "강남역 조용한 카페")

        assert result.llm_error is not None
        assert result.conditions.codes == ("QUIET",)

    def test_llm_failure_falls_back_to_rules(self) -> None:
        """LLM해석_호출이실패하면_규칙으로해석한다"""
        result = interpret(BrokenLlm(), "강남역 조용한 카페")

        assert result.llm_error == "LLM 호출이 실패했다: GMS 응답 시간 초과"
        assert result.conditions.category_group == "CAFE"

    def test_follow_up(self) -> None:
        """LLM해석_후속조건이면_합친text와바뀐점을받고이전조건을입력에넣는다"""
        llm = FixedLlm(
            answer(
                text="역삼역 모임하기 좋고 조용한 술집",
                codes=["PURPOSE_GROUP", "QUIET"],
                category_group="BAR",
                station="YEOKSAM",
                change_summary="조용한 곳으로 좁혔어요",
            )
        )

        result = interpret(llm, "더 조용하게", PREVIOUS)

        assert result.conditions.text == "역삼역 모임하기 좋고 조용한 술집"
        assert result.conditions.codes == ("PURPOSE_GROUP", "QUIET")
        assert result.change_summary == "조용한 곳으로 좁혔어요"
        [prompt] = llm.prompts
        assert prompt.endswith("새 요청: 더 조용하게")
        assert '"codes": ["PURPOSE_GROUP"]' in prompt
        assert "embedding_text" not in prompt

    @pytest.mark.parametrize("summary", [None, "", "가" * 61])
    def test_follow_up_default_summary(self, summary: str | None) -> None:
        """LLM해석_후속인데바뀐점이없거나길면_기본문구를쓴다"""
        raw = answer(text="역삼역 조용한 술집", change_summary=summary)

        result = interpret(FixedLlm(raw), "더 조용하게", PREVIOUS)

        assert result.llm_error is None
        assert result.change_summary == DEFAULT_CHANGE_SUMMARY

    def test_follow_up_without_text_falls_back(self) -> None:
        """LLM해석_후속인데text가없으면_규칙으로합친다"""
        result = interpret(FixedLlm(answer()), "더 조용하게", PREVIOUS)

        assert result.llm_error is not None
        assert result.conditions.codes == ("PURPOSE_GROUP", "QUIET")
        assert result.change_summary == DEFAULT_CHANGE_SUMMARY


class TestRules:
    """규칙 해석"""

    def test_words(self) -> None:
        """규칙해석_역업종조건낱말이있으면_코드로바꾼다"""
        conditions = interpret_by_rules("선릉 주차되는 가성비 이자카야 맛집")

        assert conditions == Conditions(
            text="선릉 주차되는 가성비 이자카야 맛집",
            embedding_text="선릉 주차되는 가성비 이자카야 맛집",
            codes=("VALUE_FOR_MONEY", "PARKING"),
            category_group="BAR",
            station="SEOLLEUNG",
        )

    @pytest.mark.parametrize(
        ("query", "codes"),
        [
            ("1명 식당", ("PURPOSE_SOLO",)),
            ("2명 식당", ()),
            ("6인 식당", ("PURPOSE_GROUP",)),
            ("회식 10명", ("PURPOSE_GROUP",)),
        ],
    )
    def test_people(self, query: str, codes: tuple[str, ...]) -> None:
        """규칙해석_인원이있으면_1명은혼밥4명이상은모임이다"""
        assert interpret_by_rules(query).codes == codes

    @pytest.mark.parametrize(
        ("query", "nearby"), [("근처 카페", True), ("강남역 근처 카페", False)]
    )
    def test_nearby(self, query: str, nearby: bool) -> None:
        """규칙해석_근처낱말이있어도_역이있으면근처검색이아니다"""
        assert interpret_by_rules(query).nearby is nearby

    @pytest.mark.parametrize(
        ("query", "category_group", "codes"),
        [
            ("파스타 맛있는 곳", "RESTAURANT", ("FOOD_WESTERN",)),
            ("강남역 국밥", "RESTAURANT", ()),
            ("친구랑 수다 떨 카페", "CAFE", ("PURPOSE_TALK",)),
            ("단체석 있는 술집", "BAR", ("PURPOSE_GROUP", "GROUP")),
        ],
    )
    def test_food_and_seat_words(
        self, query: str, category_group: str, codes: tuple[str, ...]
    ) -> None:
        """규칙해석_음식낱말은식당이고_단체석은시설코드다"""
        conditions = interpret_by_rules(query)

        assert (conditions.category_group, conditions.codes) == (category_group, codes)

    def test_negated_place_is_not_chosen(self) -> None:
        """규칙해석_말고앞의업종과역은_고르지않는다"""
        assert (
            interpret_by_rules("카페 말고 술집으로", PREVIOUS).category_group == "BAR"
        )
        assert interpret_by_rules("역삼역 말고 선릉역에서", PREVIOUS).station == (
            "SEOLLEUNG"
        )

    def test_short_words_do_not_match(self) -> None:
        """규칙해석_리뷰와비싼처럼다른말에섞인짧은낱말은_코드로보지않는다"""
        assert interpret_by_rules("리뷰 많은 비싼 식당").codes == ()

    def test_follow_up(self) -> None:
        """규칙해석_후속이면_코드를더하고새업종만바꾸고문장을잇는다"""
        conditions = interpret_by_rules("조용한 식당으로", PREVIOUS)

        assert conditions == Conditions(
            text="역삼역 모임하기 좋은 술집 조용한 식당으로",
            embedding_text="역삼역 모임하기 좋은 술집 조용한 식당으로",
            codes=("PURPOSE_GROUP", "QUIET"),
            category_group="RESTAURANT",
            station="YEOKSAM",
        )

    def test_follow_up_too_long(self) -> None:
        """규칙해석_합친문장이너무길면_새요청만남긴다"""
        previous = Conditions(text="가" * MAX_TEXT_LENGTH, embedding_text="카페")

        assert interpret_by_rules("조용하게", previous).text == "조용하게"


def test_facilities() -> None:
    """조건_시설코드만_facilities로고른다"""
    conditions = Conditions("t", "t", codes=("QUIET", "PARKING", "WIFI"))

    assert conditions.facilities == ("PARKING", "WIFI")


def test_prompt_lists_codes() -> None:
    """지시_코드표에는_취향코드와시설코드가있다"""
    assert "QUIET: 조용하고 차분한 곳" in SYSTEM_PROMPT
    assert "PARKING: 주차할 수 있어요" in SYSTEM_PROMPT


class TestEmptyReason:
    """결과 없음 문구"""

    def test_one_facility(self) -> None:
        """결과없음_시설하나면_그시설을빼보라고한다"""
        conditions = Conditions("t", "t", ("PARKING",), "BAR", "YEOKSAM")

        reason = empty_reason(conditions, in_map_bounds=False)

        assert reason.cause == "역삼역 술집 중 주차할 수 있는 곳이 없어요"
        assert reason.suggestion == "주차 조건을 빼고 다시 찾아 보세요"

    def test_many_facilities(self) -> None:
        """결과없음_시설이여럿이면_시설조건을줄이라고한다"""
        conditions = Conditions("t", "t", ("PARKING", "WIFI"), "CAFE")

        reason = empty_reason(conditions, in_map_bounds=False)

        assert reason.cause == "카페 중 요청한 시설을 모두 갖춘 곳이 없어요"

    def test_map_bounds(self) -> None:
        """결과없음_지도영역으로걸렀으면_역대신이지역이라하고지도를옮기라고한다"""
        conditions = Conditions("t", "t", (), "CAFE", "GANGNAM")

        reason = empty_reason(conditions, in_map_bounds=True)

        assert reason.cause == "이 지역 카페 중 조건에 맞는 곳이 없어요"
        assert reason.suggestion == "지도를 옮기거나 넓혀서 다시 찾아 보세요"

    def test_nearby_without_category(self) -> None:
        """결과없음_근처검색에업종이없으면_역없이가게라고한다"""
        conditions = Conditions("t", "t", station="GANGNAM", nearby=True)

        assert empty_reason(conditions, in_map_bounds=False).cause == (
            "가게 중 조건에 맞는 곳이 없어요"
        )
