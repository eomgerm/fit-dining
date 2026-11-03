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
from fit_ai.match.interpretation.segments import (
    FeatureText,
    Hours,
    Location,
    LocationKind,
    Menu,
    PlaceName,
    Price,
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
            # 1차 꼴(station)로 낸 역도 지역 조각으로 바꿔 둔다.
            locations=(Location("강남역", LocationKind.STATION, "강남역"),),
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


def segment_answer(**overrides: object) -> dict:
    """분류별 조각을 담은 2차 꼴의 LLM 출력"""
    data = {
        "text": None,
        "embedding_text": "선릉역 3만원 이하 초밥 콘센트",
        "category_group": "RESTAURANT",
        "avoid_categories": [],
        "locations": [
            {
                "text": "션릉역",
                "kind": "STATION",
                "value": "선릉역",
                "walk_minutes": None,
                "exit": None,
            }
        ],
        "codes": [],
        "avoid_foods": ["FOOD_SPICY"],
        # 메뉴에 음식 코드를 내도 읽지 않는다.
        "menus": [
            {
                "text": "스시",
                "value": "초밥",
                "spellings": [],
                "code": "FOOD_JAPANESE",
                "want": True,
            },
        ],
        "hours": [
            {
                "text": "새벽까지",
                "day": None,
                "open_until": "02:00",
                "open_from": None,
                "now": False,
            }
        ],
        "price": {
            "text": "3만원 이하",
            "min_won": None,
            "max_won": 30000,
            "cheap": False,
        },
        "place_name": None,
        "features": [{"text": "충전되는", "value": "콘센트", "want": True}],
        "change_summary": None,
    }
    data.update(overrides)
    return data


def empty_answer(**overrides: object) -> dict:
    """조각이 하나도 없는 2차 꼴의 LLM 출력. 코드 확인을 볼 때 바꿀 칸만 채운다."""
    return segment_answer(
        **{
            "embedding_text": "검색어",
            "category_group": None,
            "locations": [],
            "avoid_foods": [],
            "menus": [],
            "hours": [],
            "price": None,
            "features": [],
            **overrides,
        }
    )


class TestSegments:
    """LLM 해석의 분류별 조각"""

    def test_segments(self, fake_gms: FakeGms) -> None:
        """LLM해석_분류별조각을내면_조각으로읽고역코드를채우며메뉴에는음식코드를붙이지않는다"""
        fake_gms(lambda messages: segment_answer())

        conditions = interpret(
            "션릉역 새벽까지 3만원 이하 스시 충전되는 곳 매운 거 말고"
        ).conditions

        assert conditions.locations == (
            Location("션릉역", LocationKind.STATION, "선릉역"),
        )
        assert (conditions.station, conditions.nearby) == ("SEOLLEUNG", False)
        # 메뉴("스시")만으로는 음식 종류 코드가 생기지 않는다.
        assert conditions.codes == ()
        assert conditions.menus == (Menu("스시", "초밥"),)
        assert conditions.avoid_foods == ("FOOD_SPICY",)
        assert conditions.hours == (Hours("새벽까지", open_until="02:00"),)
        assert conditions.price == Price("3만원 이하", max_won=30000)
        assert conditions.features == (FeatureText("충전되는", "콘센트"),)
        assert conditions.corrections == (("션릉역", "선릉역"),)

    @pytest.mark.parametrize(
        ("locations", "station", "nearby"),
        [
            ([{"text": "근처", "kind": "HERE", "value": "강남역"}], None, True),
            (
                [{"text": "신논현역", "kind": "STATION", "value": "신논현역"}],
                None,
                False,
            ),
            ([{"text": "역삼동", "kind": "AREA", "value": "역삼동"}], "YEOKSAM", False),
            ([{"text": "코엑스", "kind": "AREA", "value": "코엑스"}], None, False),
            ([{"text": "강남역 근처", "kind": "STATION"}], "GANGNAM", False),
            (
                [
                    {"text": "신논현역", "kind": "STATION", "value": "신논현역"},
                    {"text": "선릉역", "kind": "STATION", "value": "선릉역"},
                ],
                "SEOLLEUNG",
                False,
            ),
        ],
    )
    def test_locations(
        self,
        fake_gms: FakeGms,
        locations: list[dict],
        station: str | None,
        nearby: bool,
    ) -> None:
        """LLM해석_지역종류에따라_처음나온서비스역과근처검색을정한다"""
        fake_gms(lambda messages: empty_answer(locations=locations))

        conditions = interpret("질의").conditions

        assert (conditions.station, conditions.nearby) == (station, nearby)

    def test_walk_and_exit(self, fake_gms: FakeGms) -> None:
        """LLM해석_도보거리와출구가있으면_지역조각에두고말이안되는값은버린다"""
        fake_gms(
            lambda messages: empty_answer(
                locations=[
                    {
                        "text": "역삼역 걸어서 5분",
                        "kind": "STATION",
                        "value": "역삼역",
                        "walk_minutes": 5,
                        "exit": "3",
                    },
                    {
                        "text": "선릉역",
                        "kind": "STATION",
                        "value": "선릉역",
                        "walk_minutes": 90,
                        "exit": True,
                    },
                ]
            )
        )

        assert interpret("질의").conditions.locations == (
            Location("역삼역 걸어서 5분", LocationKind.STATION, "역삼역", 5, "3"),
            Location("선릉역", LocationKind.STATION, "선릉역"),
        )

    def test_here_has_no_value(self, fake_gms: FakeGms) -> None:
        """LLM해석_지금보는곳이면_표준이름을두지않는다"""
        fake_gms(
            lambda messages: empty_answer(
                locations=[{"text": "근처", "kind": "HERE", "value": "강남역"}]
            )
        )

        assert interpret("근처 초밥").conditions.locations == (
            Location("근처", LocationKind.HERE),
        )

    @pytest.mark.parametrize(
        ("embedding_text", "expected"),
        [("코엑스 조용한 카페", "조용한 카페"), ("코엑스", "카페")],
    )
    def test_area_removed_from_embedding_text(
        self, fake_gms: FakeGms, embedding_text: str, expected: str
    ) -> None:
        """LLM해석_동네랜드마크면_벡터용문장에서지우고남는게없으면업종이름을쓴다"""
        fake_gms(
            lambda messages: empty_answer(
                locations=[{"text": "코엑스", "kind": "AREA", "value": "코엑스"}],
                embedding_text=embedding_text,
                category_group="CAFE",
            )
        )

        assert interpret("코엑스 조용한 카페").conditions.embedding_text == expected

    def test_bad_segments_are_dropped(self, fake_gms: FakeGms) -> None:
        """LLM해석_조각형식이틀리면_그조각만버리고규칙으로떨어지지않는다"""
        fake_gms(
            lambda messages: empty_answer(
                locations=[{"text": "역삼", "kind": "CITY"}, "강남역"],
                menus=[{"value": "초밥"}, "스시", {"text": "라멘", "code": "RAMEN"}],
                hours=[
                    {"text": "밤", "open_until": "25:00"},
                    {"text": "일요일", "day": "SUNDAY"},
                ],
                price={"text": "가격", "min_won": 50000, "max_won": 10000},
                features={"text": "콘센트"},
                codes=["QUIET"],
                category_group="RESTAURANT",
                avoid_categories=["RESTAURANT", "PUB"],
            )
        )

        result = interpret("질의")

        assert result.llm_error is None
        conditions = result.conditions
        assert conditions.locations == ()
        assert conditions.menus == (Menu("라멘", "라멘"),)
        assert (conditions.hours, conditions.price, conditions.features) == (
            (),
            None,
            (),
        )
        # 고른 업종과 같은 업종과 모르는 업종은 빼 달라는 업종이 아니다.
        assert conditions.avoid_categories == ()

    def test_follow_up_prompt_has_segments(self, fake_gms: FakeGms) -> None:
        """LLM해석_후속조건이면_이전조건을LLM이낼꼴과같게프롬프트에넣는다"""
        calls = fake_gms(
            lambda messages: segment_answer(
                text="선릉역 초밥 새벽까지", change_summary="시간을 더했어요"
            )
        )
        previous = Conditions(
            text="선릉역 초밥",
            embedding_text="초밥",
            station="SEOLLEUNG",
            locations=(Location("선릉역", LocationKind.STATION, "선릉역"),),
            menus=(Menu("스시", "초밥"),),
        )

        interpret("새벽까지 하는 데", previous)

        prompt = calls[0][1]["content"]
        assert '"locations": [{"text": "선릉역", "kind": "STATION"' in prompt
        assert '"menus": [{"text": "스시", "value": "초밥", "spellings": []' in prompt

    def test_legacy_previous_shown_as_locations(self, fake_gms: FakeGms) -> None:
        """LLM입력_1차꼴의이전조건이면_역을지역으로바꿔보여주고역과근처칸은빼다"""
        calls = fake_gms(lambda messages: answer(text="역삼역 모임하기 좋은 술집"))

        interpret("주차도 되면 좋겠어", PREVIOUS)

        prompt = calls[0][1]["content"]
        assert (
            '"locations": [{"text": "역삼역", "kind": "STATION", "value": "역삼역"'
            in prompt
        )
        assert '"station"' not in prompt
        assert '"nearby"' not in prompt


class TestChecks:
    """LLM 해석을 규칙으로 바로잡기"""

    @pytest.mark.parametrize(
        ("query", "want"), [("매운 거 먹고 싶다", True), ("매운 거 말고 국물", False)]
    )
    def test_avoid_needs_negation(
        self, fake_gms: FakeGms, query: str, want: bool
    ) -> None:
        """코드확인_피하는말이없으면_LLM이빼달라는음식으로둔코드를원하는코드로되돌린다"""
        fake_gms(lambda messages: empty_answer(avoid_foods=["FOOD_SPICY"]))

        conditions = interpret(query).conditions

        assert ("FOOD_SPICY" in conditions.codes) is want
        assert ("FOOD_SPICY" in conditions.avoid_foods) is not want

    def test_here_from_rules(self, fake_gms: FakeGms) -> None:
        """코드확인_LLM이근처를비우면_규칙이찾은근처를쓴다"""
        fake_gms(lambda messages: empty_answer(category_group="CAFE"))

        conditions = interpret("근처 카페").conditions

        assert conditions.locations == (Location("근처", LocationKind.HERE),)
        assert (conditions.station, conditions.nearby) == (None, True)

    def test_station_beats_here(self, fake_gms: FakeGms) -> None:
        """코드확인_LLM이근처만내도이번요청에역이있으면_역을기준으로찾는다"""
        fake_gms(
            lambda messages: empty_answer(
                locations=[{"text": "근처", "kind": "HERE"}],
                category_group="RESTAURANT",
            )
        )

        conditions = interpret("선릉역 근처 밥집").conditions

        assert (conditions.station, conditions.nearby) == ("SEOLLEUNG", False)

    def test_rule_avoid_food_fills(self, fake_gms: FakeGms) -> None:
        """코드확인_LLM이빼달라는음식을놓치면_규칙값으로더하고원하는코드에서뺀다"""
        fake_gms(lambda messages: empty_answer(codes=["FOOD_SPICY"]))

        conditions = interpret("매운 거 말고 담백한 국물 요리").conditions

        assert conditions.avoid_foods == ("FOOD_SPICY",)
        assert "FOOD_SPICY" not in conditions.codes

    @pytest.mark.parametrize(
        ("query", "codes"),
        [
            ("역삼역 초밥집", ()),
            ("역삼역 일식집", ("FOOD_JAPANESE",)),
            ("일본 가정식 먹을 곳", ("FOOD_JAPANESE",)),
        ],
    )
    def test_food_type_needs_food_type_word(
        self, fake_gms: FakeGms, query: str, codes: tuple[str, ...]
    ) -> None:
        """코드확인_음식종류나나라를말한낱말이없으면_LLM이메뉴로짐작한음식종류코드를뗀다"""
        fake_gms(lambda messages: empty_answer(codes=["FOOD_JAPANESE"]))

        assert interpret(query).conditions.codes == codes

    def test_follow_up_keeps_previous_food_type(self, fake_gms: FakeGms) -> None:
        """코드확인_후속에서이전조건의음식종류코드는_이번요청에낱말이없어도남긴다"""
        fake_gms(
            lambda messages: empty_answer(
                text="역삼역 일식 늦게까지", codes=["FOOD_JAPANESE"]
            )
        )
        previous = Conditions("역삼역 일식", "일식", ("FOOD_JAPANESE",), "RESTAURANT")

        conditions = interpret("늦게까지 하는 데", previous).conditions

        assert conditions.codes == ("FOOD_JAPANESE",)

    def test_rule_food_type_fills(self, fake_gms: FakeGms) -> None:
        """코드확인_LLM이음식종류코드를놓치면_규칙이찾은음식종류를더한다"""
        fake_gms(lambda messages: empty_answer(category_group="RESTAURANT"))

        assert interpret("역삼역 일식집").conditions.codes == ("FOOD_JAPANESE",)

    def test_spellings(self, fake_gms: FakeGms) -> None:
        """LLM해석_메뉴의다른표기는_문자열만같은말없이세개까지읽는다"""
        fake_gms(
            lambda messages: empty_answer(
                menus=[
                    {
                        "text": "돈까스",
                        "value": "돈가스",
                        "spellings": [
                            "돈까스",
                            "돈카츠",
                            3,
                            "",
                            "돈카츠",
                            "카츠",
                            "까스",
                        ],
                        "want": True,
                    }
                ]
            )
        )

        assert interpret("강남역 돈까스").conditions.menus == (
            Menu("돈까스", "돈가스", ("돈카츠", "카츠", "까스")),
        )

    def test_similar_place_is_not_name(self, fake_gms: FakeGms) -> None:
        """코드확인_○○같은곳이면_가게이름으로보지않는다"""
        fake_gms(
            lambda messages: empty_answer(
                place_name={"text": "바바인디아", "value": "바바인디아"}
            )
        )

        assert interpret("바바인디아 같은 인도 음식점").conditions.place_name is None

    def test_follow_up_inherits_location(self, fake_gms: FakeGms) -> None:
        """코드확인_후속에서LLM이지역을비우면_이전지역을잇는다"""
        fake_gms(lambda messages: empty_answer(text="역삼역 모임하기 좋은 술집 주차"))

        conditions = interpret("주차도 되면 좋겠어", PREVIOUS).conditions

        assert conditions.locations == (
            Location("역삼역", LocationKind.STATION, "역삼역"),
        )
        assert conditions.station == "YEOKSAM"

    def test_follow_up_here_replaces_carried_station(self, fake_gms: FakeGms) -> None:
        """코드확인_이번요청이근처만말하면_LLM이남긴이전역을버린다"""
        fake_gms(
            lambda messages: empty_answer(
                text="근처 모임하기 좋은 술집",
                locations=[{"text": "역삼역", "kind": "STATION", "value": "역삼역"}],
            )
        )

        conditions = interpret("근처로 찾아줘", PREVIOUS).conditions

        assert (conditions.station, conditions.nearby) == (None, True)

    def test_rules_fill_missed_menu(self, fake_gms: FakeGms) -> None:
        """코드확인_LLM이메뉴를놓치면_규칙이찾은메뉴를더한다"""
        fake_gms(lambda messages: empty_answer(category_group="BAR"))

        assert interpret("와인 종류 많은 바").conditions.menus == (
            Menu("와인", "와인"),
        )

    def test_rule_hours_preferred(self, fake_gms: FakeGms) -> None:
        """코드확인_규칙이시간을찾으면_LLM의시간대신쓴다"""
        fake_gms(
            lambda messages: empty_answer(
                hours=[{"text": "아침 7시 전에", "open_until": "07:00"}]
            )
        )

        assert interpret("아침 7시 전에 여는 카페").conditions.hours == (
            Hours("아침 7시 전에", open_from="07:00"),
        )

    @pytest.mark.parametrize(
        ("query", "codes"),
        [("저렴한 이자카야", ()), ("가성비 좋고 저렴한 술집", ("VALUE_FOR_MONEY",))],
    )
    def test_cheap_is_not_value_for_money(
        self, fake_gms: FakeGms, query: str, codes: tuple[str, ...]
    ) -> None:
        """코드확인_싼곳을찾는데가성비낱말이없으면_가성비코드를뗀다"""
        fake_gms(lambda messages: empty_answer(codes=["VALUE_FOR_MONEY"]))

        conditions = interpret(query).conditions

        assert conditions.codes == codes
        assert conditions.price is not None and conditions.price.cheap

    def test_category_from_rules(self, fake_gms: FakeGms) -> None:
        """코드확인_LLM이업종을비우면_규칙이찾은업종을쓴다"""
        fake_gms(lambda messages: empty_answer())

        assert interpret("매운 거 먹고 싶다").conditions.category_group == "RESTAURANT"

    @pytest.mark.parametrize(
        ("query", "llm", "avoid"),
        [
            (
                "강남역 일식 말고",
                {"avoid_categories": ["RESTAURANT"], "avoid_foods": ["FOOD_JAPANESE"]},
                (),
            ),
            (
                "파스타 싫어",
                {
                    "avoid_categories": ["RESTAURANT"],
                    "menus": [{"text": "파스타", "value": "파스타", "want": False}],
                },
                (),
            ),
            (
                "카페 싫고 매운 것도 싫어",
                {
                    "category_group": "RESTAURANT",
                    "avoid_categories": ["CAFE"],
                    "avoid_foods": ["FOOD_SPICY"],
                },
                ("CAFE",),
            ),
        ],
    )
    def test_food_avoid_keeps_category(
        self, fake_gms: FakeGms, query: str, llm: dict, avoid: tuple[str, ...]
    ) -> None:
        """코드확인_음식을빼는데요청에없는업종까지빼면_그업종은뗀다"""
        fake_gms(lambda messages: empty_answer(**llm))

        assert interpret(query).conditions.avoid_categories == avoid

    def test_follow_up_keeps_previous_codes(self, fake_gms: FakeGms) -> None:
        """코드확인_후속에서업종을바꾸며이전코드를버리면_빼지않은코드는남긴다"""
        fake_gms(
            lambda messages: empty_answer(
                text="역삼역 조용한 술집", category_group="BAR", codes=[]
            )
        )
        previous = Conditions(
            "역삼역 조용한 카페", "조용한 카페", ("QUIET",), "CAFE", "YEOKSAM"
        )

        conditions = interpret("카페 말고 술집으로", previous).conditions

        assert conditions.codes == ("QUIET",)
        assert conditions.category_group == "BAR"
        assert conditions.avoid_categories == ("CAFE",)

    def test_follow_up_drops_negated_code(self, fake_gms: FakeGms) -> None:
        """코드확인_후속에서말고로뺀이전코드는_남기지않는다"""
        fake_gms(
            lambda messages: empty_answer(text="역삼역 활기찬 카페", codes=["LIVELY"])
        )
        previous = Conditions(
            "역삼역 조용한 카페", "조용한 카페", ("QUIET",), "CAFE", "YEOKSAM"
        )

        conditions = interpret("조용한 거 말고 활기찬 곳으로", previous).conditions

        assert conditions.codes == ("LIVELY",)


class TestCorrections:
    """고친 말"""

    @pytest.mark.parametrize(
        ("conditions", "corrections"),
        [
            (Conditions("역삼 카페", "카페"), ()),
            (
                Conditions(
                    "역삼 카페",
                    "카페",
                    locations=(Location("역삼", LocationKind.STATION, "역삼역"),),
                ),
                (),
            ),
            (
                Conditions(
                    "스벅 강남",
                    "스타벅스",
                    place_name=PlaceName("스벅", "스타벅스"),
                ),
                (("스벅", "스타벅스"),),
            ),
        ],
    )
    def test_corrections(
        self, conditions: Conditions, corrections: tuple[tuple[str, str], ...]
    ) -> None:
        """고친말_한쪽이다른쪽에들어있지않을때만_고친것으로본다"""
        assert conditions.corrections == corrections


class TestRuleSegments:
    """규칙 해석의 분류별 조각"""

    @pytest.mark.parametrize(
        ("query", "hours"),
        [
            ("강남역 새벽까지 하는 술집", (Hours("새벽까지", open_until="02:00"),)),
            ("새벽 3시까지 하는 술집", (Hours("새벽 3시까지", open_until="03:00"),)),
            ("늦게까지 하는 카페", (Hours("늦게까지", open_until="23:00"),)),
            (
                "밤 10시 넘어서까지 하는 카페",
                (Hours("밤 10시 넘어서까지", open_until="22:00"),),
            ),
            ("아침 8시 전에 여는 카페", (Hours("아침 8시 전에", open_from="08:00"),)),
            ("일요일에 여는 식당", (Hours("일요일", day="SUN"),)),
            ("지금 열린 카페", (Hours("지금 열린", now=True),)),
            ("조용한 카페", ()),
        ],
    )
    def test_hours(self, query: str, hours: tuple[Hours, ...]) -> None:
        """규칙해석_시간말이있으면_요일과시각으로바꾼다"""
        assert interpret_by_rules(query).hours == hours

    @pytest.mark.parametrize(
        ("query", "price"),
        [
            ("1만5천원 이하 밥집", Price("1만5천원 이하", max_won=15000)),
            ("3만원 이하 오마카세", Price("3만원 이하", max_won=30000)),
            ("5천원 이하 카페", Price("5천원 이하", max_won=5000)),
            ("만원 이하 점심", Price("만원 이하", max_won=10000)),
            ("2만원대 파스타", Price("2만원대", min_won=20000, max_won=29999)),
            ("저렴한 술집", Price("저렴", cheap=True)),
            ("안 비싼 술집", Price("안 비싼", cheap=True)),
            ("비싼 데 말고 술집", Price("비싼 데 말고", cheap=True)),
            ("비싼 술집", None),
            ("가성비 좋은 술집", None),
        ],
    )
    def test_price(self, query: str, price: Price | None) -> None:
        """규칙해석_가격말이있으면_금액이나싼곳으로바꾸고가성비는가격으로보지않는다"""
        assert interpret_by_rules(query).price == price

    def test_cheap_is_not_value_for_money(self) -> None:
        """규칙해석_저렴은_가성비코드가아니다"""
        assert interpret_by_rules("저렴한 술집").codes == ()

    @pytest.mark.parametrize(
        ("query", "codes", "avoid_foods", "menus"),
        [
            (
                "매운 거 말고 담백한 국물 요리",
                (),
                ("FOOD_SPICY",),
                (Menu("국물", "국물 요리"),),
            ),
            ("매운 거 먹고 싶다", ("FOOD_SPICY",), (), ()),
            ("맵지 않은 중식", ("FOOD_CHINESE",), ("FOOD_SPICY",), ()),
            # 메뉴는 음식 종류 코드가 되지 않는다.
            ("역삼 스시 먹고 싶어", (), (), (Menu("스시", "초밥"),)),
            ("일식 말고 한식", ("FOOD_KOREAN",), ("FOOD_JAPANESE",), ()),
            ("파스타 말고 피자", (), (), (Menu("파스타", "파스타", want=False),)),
            ("북적이는 데 말고 카페", ("QUIET",), (), ()),
        ],
    )
    def test_menus_and_negation(
        self,
        query: str,
        codes: tuple[str, ...],
        avoid_foods: tuple[str, ...],
        menus: tuple[Menu, ...],
    ) -> None:
        """규칙해석_말고앞의음식종류는빼달라는음식으로메뉴는피하는메뉴로두고성향축은반대극을바란다"""
        conditions = interpret_by_rules(query)

        assert conditions.codes == codes
        assert conditions.avoid_foods == avoid_foods
        assert conditions.menus == menus

    @pytest.mark.parametrize(
        ("query", "features"),
        [
            ("충전되는 카페", (FeatureText("충전", "콘센트"),)),
            ("강아지랑 반려견 동반 카페", (FeatureText("반려견", "반려견"),)),
            ("애기랑 갈 식당", (FeatureText("애기랑", "아이 동반"),)),
            ("베이커리룸 카페", ()),
        ],
    )
    def test_features(self, query: str, features: tuple[FeatureText, ...]) -> None:
        """규칙해석_코드표에없는특징낱말이있으면_표준이름하나로둔다"""
        assert interpret_by_rules(query).features == features

    @pytest.mark.parametrize(
        ("query", "category", "avoid"),
        [
            ("카페 말고 다른 데", None, ("CAFE",)),
            ("카페 말고 술집으로", "BAR", ("CAFE",)),
            # 음식 종류나 가게 종류를 빼는 말은 업종 전체를 빼지 않는다.
            ("강남역 일식 말고", None, ()),
            ("이자카야 말고 카페", "CAFE", ()),
        ],
    )
    def test_avoid_categories(
        self, query: str, category: str | None, avoid: tuple[str, ...]
    ) -> None:
        """규칙해석_말고앞의업종은_빼달라는업종이다"""
        conditions = interpret_by_rules(query)

        assert (conditions.category_group, conditions.avoid_categories) == (
            category,
            avoid,
        )

    @pytest.mark.parametrize(
        ("query", "locations", "station", "nearby"),
        [
            ("근처 카페", (Location("근처", LocationKind.HERE),), None, True),
            (
                "역삼동 카페",
                (Location("역삼동", LocationKind.AREA, "역삼동"),),
                "YEOKSAM",
                False,
            ),
            (
                "강남역 근처 술집",
                (Location("강남역", LocationKind.STATION, "강남역"),),
                "GANGNAM",
                False,
            ),
            (
                "강남역이나 역삼역 술집",
                (
                    Location("강남역", LocationKind.STATION, "강남역"),
                    Location("역삼역", LocationKind.STATION, "역삼역"),
                ),
                "GANGNAM",
                False,
            ),
            (
                "선릉역 걸어서 5분 카페",
                (Location("선릉역", LocationKind.STATION, "선릉역", walk_minutes=5),),
                "SEOLLEUNG",
                False,
            ),
            (
                "강남역 11번 출구나 역삼역",
                (
                    Location("강남역", LocationKind.STATION, "강남역", exit="11"),
                    Location("역삼역", LocationKind.STATION, "역삼역"),
                ),
                "GANGNAM",
                False,
            ),
        ],
    )
    def test_locations(
        self,
        query: str,
        locations: tuple[Location, ...],
        station: str | None,
        nearby: bool,
    ) -> None:
        """규칙해석_역동근처를지역조각으로두고_도보거리는모든역에출구는앞의역에붙인다"""
        conditions = interpret_by_rules(query)

        assert conditions.locations == locations
        assert (conditions.station, conditions.nearby) == (station, nearby)

    def test_follow_up_merges_segments(self) -> None:
        """규칙해석_후속이면_조각을더하고가격은새로말할때만바꾼다"""
        previous = interpret_by_rules("선릉역 스시 2만원대")

        later = interpret_by_rules("새벽까지 하는 데로", previous)
        cheaper = interpret_by_rules("만원 이하로", previous)

        assert later.menus == previous.menus
        assert later.locations == previous.locations
        assert later.price == previous.price
        assert later.hours == (Hours("새벽까지", open_until="02:00"),)
        assert cheaper.price == Price("만원 이하", max_won=10000)


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
            locations=(Location("선릉", LocationKind.STATION, "선릉역"),),
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
            # 메뉴는 음식 종류 코드가 되지 않는다. 음식 종류를 말하면 코드다.
            ("파스타 맛있는 곳", "RESTAURANT", ()),
            ("양식 맛있는 곳", "RESTAURANT", ("FOOD_WESTERN",)),
            ("강남역 국밥", "RESTAURANT", ()),
            ("선릉역 케이크 맛집", "CAFE", ()),
            ("친구랑 수다 떨 카페", "CAFE", ("PURPOSE_TALK",)),
            ("단체석 있는 술집", "BAR", ("PURPOSE_GROUP", "GROUP")),
        ],
    )
    def test_food_and_seat_words(
        self, query: str, category_group: str, codes: tuple[str, ...]
    ) -> None:
        """규칙해석_음식낱말은식당이고디저트는카페이며_단체석은시설코드다"""
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
            # 새 요청에 지역이 없으면 이전 역을 지역 조각으로 잇는다.
            locations=(Location("역삼역", LocationKind.STATION, "역삼역"),),
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
