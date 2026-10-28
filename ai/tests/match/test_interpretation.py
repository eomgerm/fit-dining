"""요청 해석을 확인한다.

LLM 출력 검사, 규칙 폴백, 후속 조건 합치기를 본다. GMS는 공유 모듈
`fit_ai.gms.call_json`을 가짜(`fake_gms`)로 바꿔 끼운다.
"""

from collections.abc import Callable

import pytest

from fit_ai.match.interpretation import (
    DEFAULT_CHANGE_SUMMARY,
    MAX_TEXT_LENGTH,
    SYSTEM_PROMPT,
    Conditions,
    interpret,
    interpret_by_rules,
)

PREVIOUS = Conditions(
    text="역삼역 모임하기 좋은 술집",
    embedding_text="역삼역 모임하기 좋은 술집",
    codes=("PURPOSE_GROUP",),
    category_group="BAR",
    station="YEOKSAM",
)

FakeGms = Callable[[Callable[[list[dict]], object]], list[list[dict]]]


def answer(**overrides: object) -> dict:
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
    return data


class TestLlm:
    """LLM 해석"""

    def test_new_search(self, fake_gms: FakeGms) -> None:
        """LLM해석_새검색이면_LLM의조건을쓰고text는요청문그대로다"""
        calls = fake_gms(lambda messages: answer())

        result = interpret("강남역 시끄러운 곳 말고 카페")

        assert result.conditions == Conditions(
            text="강남역 시끄러운 곳 말고 카페",
            embedding_text="조용한 카페",
            codes=("QUIET",),
            category_group="CAFE",
            station="GANGNAM",
        )
        assert result.change_summary is None
        assert result.llm_error is None
        assert calls == [
            [
                {"role": "developer", "content": SYSTEM_PROMPT},
                {"role": "user", "content": "요청: 강남역 시끄러운 곳 말고 카페"},
            ]
        ]

    def test_unknown_values_are_dropped(self, fake_gms: FakeGms) -> None:
        """LLM해석_모르는코드와업종역이면_코드는버리고업종역은거르지않는다"""
        fake_gms(
            lambda messages: answer(
                codes=["QUIET", "NOISY", "QUIET", 3], category_group="PUB", station="X"
            )
        )

        conditions = interpret("조용한 펍").conditions

        assert conditions.codes == ("QUIET",)
        assert (conditions.category_group, conditions.station) == (None, None)

    def test_null_nearby_is_false(self, fake_gms: FakeGms) -> None:
        """LLM해석_nearby가null이면_근처검색이아닌것으로본다"""
        fake_gms(lambda messages: answer(nearby=None))

        result = interpret("강남역 조용한 카페")

        assert result.llm_error is None
        assert result.conditions.nearby is False

    def test_station_means_not_nearby(self, fake_gms: FakeGms) -> None:
        """LLM해석_역과근처검색이함께오면_역을기준으로찾는다"""
        fake_gms(lambda messages: answer(nearby=True))

        result = interpret("강남역 근처 카페")

        assert result.conditions.station == "GANGNAM"
        assert result.conditions.nearby is False

    @pytest.mark.parametrize(
        ("output", "reason"),
        [
            ("조용한 카페", "JSON 객체"),
            ([], "JSON 객체"),
            (answer(embedding_text=None), "embedding_text"),
            (answer(codes="QUIET"), "codes"),
            (answer(nearby="false"), "nearby"),
        ],
    )
    def test_bad_output_falls_back_to_rules(
        self, fake_gms: FakeGms, output: object, reason: str
    ) -> None:
        """LLM해석_형식이틀리면_다시부르지않고규칙으로해석하고검사에걸린이유를남긴다"""
        calls = fake_gms(lambda messages: output)

        result = interpret("강남역 조용한 카페")

        assert len(calls) == 1
        assert reason in result.llm_error
        assert result.conditions.codes == ("QUIET",)
        # 출력 검사에 걸린 것은 GMS 장애가 아니다.
        assert result.gms_failed is False

    def test_llm_failure_falls_back_to_rules(self, fake_gms: FakeGms) -> None:
        """LLM해석_호출이실패하거나꺼져있으면_규칙으로해석하고GMS장애로표시한다"""
        fake_gms(lambda messages: None)

        result = interpret("강남역 조용한 카페")

        assert result.llm_error == "GMS가 꺼져 있거나 호출이 실패했다"
        assert result.conditions.category_group == "CAFE"
        assert result.gms_failed is True

    @pytest.mark.parametrize("embedding_text", ["...", " ", "…", ""])
    def test_empty_embedding_text_uses_query(
        self, fake_gms: FakeGms, embedding_text: str
    ) -> None:
        """LLM해석_벡터용문장에글자가없으면_LLM결과는쓰고문장만위치를뺀요청문으로대신한다"""
        fake_gms(lambda messages: answer(embedding_text=embedding_text))

        result = interpret("강남역 카페")

        assert result.llm_error is None
        assert result.conditions.embedding_text == "카페"
        assert result.conditions.codes == ("QUIET",)

    def test_empty_embedding_text_in_follow_up_uses_text(
        self, fake_gms: FakeGms
    ) -> None:
        """LLM해석_후속에서벡터용문장에글자가없으면_합친요청문으로대신한다"""
        fake_gms(
            lambda messages: answer(text="역삼역 조용한 술집", embedding_text="...")
        )

        result = interpret("더 조용하게", PREVIOUS)

        assert result.conditions.embedding_text == "조용한 술집"

    def test_follow_up_unchanged_text_gets_query(self, fake_gms: FakeGms) -> None:
        """LLM해석_후속인데이전문장을그대로내면_새요청을뒤에붙인다"""
        fake_gms(
            lambda messages: answer(
                text=PREVIOUS.text,
                embedding_text=PREVIOUS.embedding_text,
                codes=["PURPOSE_GROUP", "SPACIOUS_SEATING"],
            )
        )

        conditions = interpret("넓은 곳이면 좋겠어", PREVIOUS).conditions

        assert conditions.text == "역삼역 모임하기 좋은 술집 넓은 곳이면 좋겠어"
        assert conditions.embedding_text == "모임하기 좋은 술집 넓은 곳이면 좋겠어"
        assert conditions.codes == ("PURPOSE_GROUP", "SPACIOUS_SEATING")

    def test_location_removed_from_embedding_text(self, fake_gms: FakeGms) -> None:
        """LLM해석_벡터용문장에역이름이있으면_지우고역은조건에만남긴다"""
        fake_gms(
            lambda messages: answer(
                embedding_text="강남역에서 넓고 조용한 카페", station="GANGNAM"
            )
        )

        conditions = interpret("강남역 넓고 조용한 카페").conditions

        assert conditions.embedding_text == "넓고 조용한 카페"
        assert conditions.station == "GANGNAM"

    def test_follow_up_repeat_with_location_gets_query(self, fake_gms: FakeGms) -> None:
        """LLM해석_후속에서이전벡터용문장에역만붙여내면_같은문장으로보고새요청을붙인다"""
        previous = Conditions(
            "역삼역 모임하기 좋은 술집", "모임하기 좋은 술집", ("PURPOSE_GROUP",), "BAR"
        )
        fake_gms(
            lambda messages: answer(
                text="역삼역 모임하기 좋은 넓은 술집",
                embedding_text="역삼역 모임하기 좋은 술집",
                codes=["PURPOSE_GROUP", "SPACIOUS_SEATING"],
                category_group="BAR",
                station="YEOKSAM",
            )
        )

        conditions = interpret("넓은 곳이면 좋겠어", previous).conditions

        assert conditions.embedding_text == "모임하기 좋은 술집 넓은 곳이면 좋겠어"

    def test_follow_up_to_nearby_drops_station(self, fake_gms: FakeGms) -> None:
        """LLM해석_역검색뒤근처로바꿨는데이전역을남기면_역을버리고근처검색으로본다"""
        fake_gms(
            lambda messages: answer(
                text="근처 모임하기 좋은 술집", station="YEOKSAM", nearby=True
            )
        )

        conditions = interpret("그냥 내 근처에서 찾아줘", PREVIOUS).conditions

        assert (conditions.station, conditions.nearby) == (None, True)

    def test_follow_up_new_station_wins(self, fake_gms: FakeGms) -> None:
        """LLM해석_후속에서새역과근처가함께오면_새역을기준으로찾는다"""
        fake_gms(
            lambda messages: answer(
                text="강남역 모임하기 좋은 술집", station="GANGNAM", nearby=True
            )
        )

        conditions = interpret("강남역으로 바꿔줘", PREVIOUS).conditions

        assert (conditions.station, conditions.nearby) == ("GANGNAM", False)

    def test_unknown_previous_codes_not_in_prompt(self, fake_gms: FakeGms) -> None:
        """LLM입력_이전조건의모르는코드는_프롬프트에넣지않는다"""
        calls = fake_gms(lambda messages: answer(text="역삼역 조용한 술집"))
        previous = Conditions(
            text="역삼역 술집",
            embedding_text="역삼역 술집",
            codes=("QUIET", "X" * 5000),
        )

        interpret("더 조용하게", previous)

        prompt = calls[0][1]["content"]
        assert '"codes": ["QUIET"]' in prompt
        assert "XXXX" not in prompt

    def test_follow_up(self, fake_gms: FakeGms) -> None:
        """LLM해석_후속조건이면_합친text와바뀐점을받고이전조건을입력에넣는다"""
        calls = fake_gms(
            lambda messages: answer(
                text="역삼역 모임하기 좋고 조용한 술집",
                codes=["PURPOSE_GROUP", "QUIET"],
                category_group="BAR",
                station="YEOKSAM",
                change_summary="조용한 곳으로 좁혔어요",
            )
        )

        result = interpret("더 조용하게", PREVIOUS)

        assert result.conditions.text == "역삼역 모임하기 좋고 조용한 술집"
        assert result.conditions.codes == ("PURPOSE_GROUP", "QUIET")
        assert result.change_summary == "조용한 곳으로 좁혔어요"
        prompt = calls[0][1]["content"]
        assert prompt.endswith("새 요청: 더 조용하게")
        assert '"codes": ["PURPOSE_GROUP"]' in prompt
        assert "embedding_text" not in prompt

    @pytest.mark.parametrize("summary", [None, "", "가" * 61])
    def test_follow_up_default_summary(
        self, fake_gms: FakeGms, summary: str | None
    ) -> None:
        """LLM해석_후속인데바뀐점이없거나길면_기본문구를쓴다"""
        fake_gms(
            lambda messages: answer(text="역삼역 조용한 술집", change_summary=summary)
        )

        result = interpret("더 조용하게", PREVIOUS)

        assert result.llm_error is None
        assert result.change_summary == DEFAULT_CHANGE_SUMMARY

    def test_follow_up_without_text_falls_back(self, fake_gms: FakeGms) -> None:
        """LLM해석_후속인데text가없으면_규칙으로합친다"""
        fake_gms(lambda messages: answer())

        result = interpret("더 조용하게", PREVIOUS)

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
            embedding_text="주차되는 가성비 이자카야 맛집",
            codes=("VALUE_FOR_MONEY", "PARKING"),
            category_group="BAR",
            station="SEOLLEUNG",
        )

    @pytest.mark.parametrize(
        ("query", "embedding_text"),
        [
            ("역삼역 근처 술집", "술집"),
            ("근처 조용한 카페", "조용한 카페"),
            ("선릉에서 전망이 좋은 카페", "전망이 좋은 카페"),
            ("역삼동 아늑한 카페", "아늑한 카페"),
            ("강남역 카페", "카페"),
            ("강남역", "강남역"),
        ],
    )
    def test_location_removed(self, query: str, embedding_text: str) -> None:
        """규칙해석_벡터용문장의위치말은_지우고남는게없으면업종이름이나요청문을쓴다"""
        assert interpret_by_rules(query).embedding_text == embedding_text

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
            embedding_text="모임하기 좋은 술집 조용한 식당으로",
            codes=("PURPOSE_GROUP", "QUIET"),
            category_group="RESTAURANT",
            station="YEOKSAM",
        )

    def test_follow_up_new_station_ends_nearby(self) -> None:
        """규칙해석_근처검색뒤역을말하면_근처검색을끄고그역으로찾는다"""
        previous = Conditions("근처 카페", "근처 카페", (), "CAFE", nearby=True)

        conditions = interpret_by_rules("강남역에서 찾아줘", previous)

        assert (conditions.station, conditions.nearby) == ("GANGNAM", False)

    def test_follow_up_nearby_drops_station(self) -> None:
        """규칙해석_역검색뒤근처를말하면_이전역을버린다"""
        conditions = interpret_by_rules("근처로 찾아줘", PREVIOUS)

        assert (conditions.station, conditions.nearby) == (None, True)

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
