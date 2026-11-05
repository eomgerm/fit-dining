"""요청 해석을 확인한다.

LLM 출력 검사, 규칙 폴백, 후속 조건 합치기를 본다. GMS는 공유 모듈
`fit_ai.gms.call_json`을 가짜(`fake_gms`)로 바꿔 끼운다.
"""

from collections.abc import Callable

import pytest

from fit_ai import gms
from fit_ai.match.interpretation import (
    DEFAULT_CHANGE_SUMMARY,
    MAX_TEXT_LENGTH,
    SYSTEM_PROMPT,
    Conditions,
    interpret,
    interpret_by_rules,
)
from fit_ai.match.interpretation.segments import (
    Choice,
    Feature,
    Hours,
    Location,
    LocationKind,
    Menu,
    PlaceName,
    Price,
)

PREVIOUS = Conditions.from_codes(
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

        assert result.conditions == Conditions.from_codes(
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
        """LLM해석_후속에서벡터용문장에글자가없으면_이번요청문으로대신한다"""
        fake_gms(lambda messages: answer(embedding_text="..."))

        result = interpret("더 조용하게", PREVIOUS)

        assert result.conditions.embedding_text == "더 조용하게"

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
        previous = Conditions.from_codes(
            text="역삼역 술집",
            embedding_text="역삼역 술집",
            codes=("QUIET", "X" * 5000),
        )

        interpret("더 조용하게", previous)

        prompt = calls[0][1]["content"]
        assert '"code": "QUIET"' in prompt
        assert "XXXX" not in prompt

    def test_follow_up(self, fake_gms: FakeGms) -> None:
        """LLM해석_후속조건이면_이전조건을입력에넣고바뀐점을받아이전조건과합친다"""
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

        # 합친 문장은 LLM이 쓴 문장이 아니라 이전 요청문 뒤에 이번 요청을 붙인 것이다.
        assert result.conditions.text == "역삼역 모임하기 좋은 술집 더 조용하게"
        assert result.conditions.codes == ("PURPOSE_GROUP", "QUIET")
        assert result.change_summary == "조용한 곳으로 좁혔어요"
        prompt = calls[0][1]["content"]
        assert prompt.endswith("새 요청: 더 조용하게")
        assert '"code": "PURPOSE_GROUP"' in prompt
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

    def test_follow_up_without_text_uses_llm(self, fake_gms: FakeGms) -> None:
        """LLM해석_후속인데합친text가없어도_LLM이낸조건전체를쓰고요청문은이어붙인다"""
        fake_gms(lambda messages: answer())

        result = interpret("더 조용하게", PREVIOUS)

        assert result.llm_error is None
        assert result.conditions.text == "역삼역 모임하기 좋은 술집 더 조용하게"
        assert result.conditions.codes == ("QUIET",)
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
        assert conditions.features == (Feature("충전되는", "콘센트"),)
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
        # 요청에 없는 근처 말로 낸 근처는 버리므로 지역 원문을 요청에 넣는다.
        query = " ".join([*(loc["text"] for loc in locations), "카페"])

        conditions = interpret(query).conditions

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
        # 코드가 붙은 특징(QUIET)만 남고 꼴이 틀린 특징 조각은 버린다.
        assert (conditions.hours, conditions.price) == ((), None)
        assert [f.code for f in conditions.features] == ["QUIET"]
        # 고른 업종과 같은 업종과 모르는 업종은 빼 달라는 업종이 아니다.
        assert conditions.avoid_categories == ()

    def test_follow_up_prompt_has_segments(self, fake_gms: FakeGms) -> None:
        """LLM해석_후속조건이면_이전조건을LLM이낼꼴과같게프롬프트에넣는다"""
        calls = fake_gms(
            lambda messages: segment_answer(
                text="선릉역 초밥 새벽까지", change_summary="시간을 더했어요"
            )
        )
        previous = Conditions.from_codes(
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


def turn_answer(**overrides: object) -> dict:
    """3차 꼴(이번 요청의 분류별 조각)의 LLM 출력"""
    return {
        "embedding_text": "검색어",
        "categories": [],
        "locations": [],
        "features": [],
        "facilities": [],
        "party_size": None,
        "food_types": [],
        "flavors": [],
        "menus": [],
        "hours": [],
        "price": None,
        "place_name": None,
        "change_summary": None,
        **overrides,
    }


class TestTurn:
    """3차 꼴 LLM 출력(이번 요청만)"""

    def test_classified_output(self, fake_gms: FakeGms) -> None:
        """LLM해석_분류별칸으로내면_항목마다원함·피함과코드특징의원문을읽는다"""
        fake_gms(
            lambda messages: turn_answer(
                categories=[
                    {"code": "RESTAURANT", "want": True},
                    {"code": "CAFE", "want": False},
                ],
                features=[
                    {"text": "북적이는 데 말고", "value": "조용한 곳", "code": "QUIET"},
                    {"text": "충전", "value": "콘센트", "code": None},
                    {"text": "x", "value": "x", "code": "FOOD_KOREAN"},
                ],
                facilities=["WIFI", "SAUNA"],
                party_size=5,
                food_types=[{"code": "FOOD_KOREAN", "want": True}],
                flavors=[{"code": "SPICY", "want": False}],
            )
        )

        conditions = interpret(
            "북적이는 데 말고 충전되는 한식당 카페 말고 매운 거 빼고 5명 와이파이"
        ).conditions

        assert conditions.categories == (
            Choice("RESTAURANT"),
            Choice("CAFE", want=False),
        )
        assert conditions.food_types == (Choice("FOOD_KOREAN"),)
        assert conditions.flavors == (Choice("SPICY", want=False),)
        assert conditions.facilities == ("WIFI",)
        assert conditions.party_size == 5
        # 특징 코드표에 없는 코드는 코드 없는 특징이다.
        assert conditions.features == (
            Feature("북적이는 데 말고", "조용한 곳", "QUIET"),
            Feature("충전", "콘센트"),
            Feature("x", "x"),
        )
        assert conditions.codes == ("QUIET", "FOOD_KOREAN", "WIFI", "PURPOSE_GROUP")

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


class TestLlmFollowUp:
    """LLM 해석의 후속. LLM이 이전 조건에 새 요청을 반영한 조건 전체를 내고 코드는 합치지 않는다."""

    def test_full_state_used_as_is(self, fake_gms: FakeGms) -> None:
        """LLM후속_LLM이낸조건전체를_합친조건으로쓰고요청문만이전요청뒤에붙인다"""
        fake_gms(
            lambda messages: answer(
                embedding_text="모임하기 좋은 넓은 술집",
                codes=["PURPOSE_GROUP", "SPACIOUS_SEATING"],
                category_group="BAR",
                station="YEOKSAM",
                location_said=False,
            )
        )

        result = interpret("넓은 곳이면 좋겠어", PREVIOUS)

        conditions = result.conditions
        assert conditions.text == "역삼역 모임하기 좋은 술집 넓은 곳이면 좋겠어"
        assert conditions.embedding_text == "모임하기 좋은 넓은 술집"
        assert conditions.codes == ("PURPOSE_GROUP", "SPACIOUS_SEATING")
        assert conditions.station == "YEOKSAM"
        # 이번 요청에 지역을 말하지 않았으니 지역 고르기에는 지역이 없다.
        assert result.turn is not None and result.turn.locations == ()

    def test_released_condition_not_restored(self, fake_gms: FakeGms) -> None:
        """LLM후속_LLM이이전조건을뺐으면_코드가되살리지않는다"""
        previous = Conditions.from_codes(
            "강남역 주차되는 카페 2만원 이하",
            "주차 가능한 카페",
            ("PARKING",),
            "CAFE",
            "GANGNAM",
            price=Price("2만원 이하", max_won=20000),
        )
        fake_gms(
            lambda messages: answer(
                embedding_text="주차 가능한 카페",
                codes=["PARKING"],
                location_said=False,
            )
        )

        conditions = interpret("가격은 상관없어", previous).conditions

        assert conditions.price is None
        assert conditions.codes == ("PARKING",)

    def test_follow_up_call(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """LLM후속_후속이면_추론low로7초를기다리고시간초과면다시부르지않는다"""
        seen: list[dict] = []

        def call_json(messages, parse, **kwargs):
            seen.append(kwargs)
            return parse(answer(category_group="BAR", station="YEOKSAM"))

        monkeypatch.setattr(gms, "call_json", call_json)

        interpret("조용한 데로", PREVIOUS, timeout=5.0)
        interpret("조용한 술집", timeout=5.0)

        follow_up, new = seen
        assert (follow_up["timeout"], follow_up["reasoning_effort"]) == (7.0, "low")
        assert follow_up["retry_on_timeout"] is False
        assert (new["timeout"], new["reasoning_effort"]) == (5.0, "none")
        assert new["retry_on_timeout"] is True

    def test_unlisted_slot_restored(self, fake_gms: FakeGms) -> None:
        """LLM후속_바꾼칸목록에없는칸을LLM이빠뜨리면_이전값으로되살린다"""
        previous = Conditions.from_codes(
            "강남역 주차되는 카페 2만원 이하",
            "주차 가능한 카페",
            ("PARKING",),
            "CAFE",
            "GANGNAM",
            price=Price("2만원 이하", max_won=20000),
        )
        # 조용함을 더하며 가격을 빠뜨렸지만 바꾼 칸은 특징뿐이라고 했다.
        fake_gms(
            lambda messages: answer(
                embedding_text="조용하고 주차 가능한 카페",
                codes=["PARKING", "QUIET"],
                location_said=False,
                changed=["features"],
            )
        )

        conditions = interpret("조용한 데로", previous).conditions

        assert conditions.price == Price("2만원 이하", max_won=20000)
        assert conditions.codes == ("QUIET", "PARKING")

    def test_listed_slot_released(self, fake_gms: FakeGms) -> None:
        """LLM후속_바꾼칸목록에있는칸은_LLM값으로바꾸고풀었으면뺀다"""
        previous = Conditions.from_codes(
            "강남역 주차되는 카페 2만원 이하",
            "주차 가능한 카페",
            ("PARKING",),
            "CAFE",
            "GANGNAM",
            price=Price("2만원 이하", max_won=20000),
        )
        fake_gms(
            lambda messages: answer(
                embedding_text="주차 가능한 카페",
                codes=["PARKING"],
                location_said=False,
                changed=["price"],
            )
        )

        conditions = interpret("가격은 상관없어", previous).conditions

        assert conditions.price is None
        assert conditions.codes == ("PARKING",)

    def test_empty_changed_keeps_previous(self, fake_gms: FakeGms) -> None:
        """LLM후속_바꾼칸이없다고하면_이전조건을그대로쓴다"""
        fake_gms(
            lambda messages: answer(
                embedding_text="모임하기 좋은 술집", codes=[], changed=[]
            )
        )

        conditions = interpret("다른 데도 보여줘", PREVIOUS).conditions

        assert conditions.codes == PREVIOUS.codes
        assert conditions.categories == PREVIOUS.categories
        assert conditions.locations == PREVIOUS.locations

    def test_said_location_kept_in_turn(self, fake_gms: FakeGms) -> None:
        """LLM후속_이번요청에지역을말했으면_이번요청의조건에지역을남긴다"""
        fake_gms(
            lambda messages: answer(
                category_group="BAR", station="YEOKSAM", location_said=True
            )
        )

        result = interpret("역삼역 그대로 두고 조용한 데로", PREVIOUS)

        assert result.turn is not None
        assert result.turn.locations == result.conditions.locations
        assert result.turn.station == "YEOKSAM"

    @pytest.mark.parametrize(
        ("station", "said"), [("YEOKSAM", False), ("GANGNAM", True)]
    )
    def test_location_said_missing(
        self, fake_gms: FakeGms, station: str, said: bool
    ) -> None:
        """LLM후속_지역을말했는지표시가없으면_이전지역과다를때말한것으로본다"""
        fake_gms(lambda messages: answer(category_group="BAR", station=station))

        result = interpret("조용한 데로", PREVIOUS)

        assert result.turn is not None
        assert bool(result.turn.locations) is said


class TestRuleFollowUp:
    """규칙 해석의 후속 합치기(LLM이 실패했을 때). 이번 요청이 뺀 이전 코드 고르기
    (`rules._kept_codes`)를 포함한다."""

    def test_follow_up_keeps_previous_food_type(self) -> None:
        """규칙후속_이번요청에음식종류가없으면_이전조건의음식종류코드를남긴다"""
        previous = Conditions.from_codes(
            "역삼역 일식", "일식", ("FOOD_JAPANESE",), "RESTAURANT"
        )

        conditions = interpret_by_rules("늦게까지 하는 데", previous)

        assert conditions.codes == ("FOOD_JAPANESE",)

    def test_follow_up_inherits_location(self) -> None:
        """규칙후속_이번요청에지역이없으면_이전지역을잇는다"""
        conditions = interpret_by_rules("주차도 되면 좋겠어", PREVIOUS)

        assert conditions.locations == (
            Location("역삼역", LocationKind.STATION, "역삼역"),
        )
        assert conditions.station == "YEOKSAM"

    def test_follow_up_keeps_previous_codes(self) -> None:
        """규칙후속_업종을바꾸면_빼지않은이전코드는남긴다"""
        previous = Conditions.from_codes(
            "역삼역 조용한 카페", "조용한 카페", ("QUIET",), "CAFE", "YEOKSAM"
        )

        conditions = interpret_by_rules("카페 말고 술집으로", previous)

        assert conditions.codes == ("QUIET",)
        assert conditions.category_group == "BAR"
        assert conditions.avoid_categories == ("CAFE",)

    def test_follow_up_drops_negated_code(self) -> None:
        """규칙후속_이번요청이말고로뺀이전코드는_남기지않는다"""
        previous = Conditions.from_codes(
            "역삼역 조용한 카페", "조용한 카페", ("QUIET",), "CAFE", "YEOKSAM"
        )

        conditions = interpret_by_rules("조용한 거 말고 활기찬 곳으로", previous)

        assert conditions.codes == ("LIVELY",)


class TestCorrections:
    """고친 말"""

    @pytest.mark.parametrize(
        ("conditions", "corrections"),
        [
            (Conditions.from_codes("역삼 카페", "카페"), ()),
            (
                Conditions.from_codes(
                    "역삼 카페",
                    "카페",
                    locations=(Location("역삼", LocationKind.STATION, "역삼역"),),
                ),
                (),
            ),
            (
                Conditions.from_codes(
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
            ("충전되는 카페", (Feature("충전", "콘센트"),)),
            ("강아지랑 반려견 동반 카페", (Feature("반려견", "반려견"),)),
            ("애기랑 갈 식당", (Feature("애기랑", "아이 동반"),)),
            ("베이커리룸 카페", ()),
        ],
    )
    def test_features(self, query: str, features: tuple[Feature, ...]) -> None:
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

        assert conditions == Conditions.from_codes(
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
        ("query", "codes", "avoid_foods", "menus"),
        [
            ("강남역 매운 건 싫어", (), ("FOOD_SPICY",), ()),
            (
                "매운 짬뽕 말고 짜장",
                (),
                ("FOOD_SPICY",),
                (("짜장면", True), ("짬뽕", False)),
            ),
            ("강남역 고기 없는 식당", (), (), (("고기", False),)),
            ("고기없는 식당", (), (), (("고기", False),)),
            (
                "일식이나 중식 말고 한식",
                ("FOOD_KOREAN",),
                ("FOOD_JAPANESE", "FOOD_CHINESE"),
                (),
            ),
            ("매운 거 먹고 싶다", ("FOOD_SPICY",), (), ()),
            # 묻는 말은 부정이 아니다.
            ("강남역 조용한 카페 없을까?", ("QUIET",), (), ()),
            # 업종을 빼는 말 앞의 낱말은 부정하지 않는다.
            ("강남역 조용한 카페 말고 술집", ("QUIET",), (), ()),
            # 반대 극이 없는 코드를 부정하면 버린다. 웨이팅은 부정하면 짧은 대기다.
            ("데이트 말고 혼밥", ("PURPOSE_SOLO",), (), ()),
            ("주차 말고 예약 되는 곳", ("RESERVATION",), (), ()),
            ("웨이팅 없이 바로", ("SHORT_WAIT",), (), ()),
            ("시끄러운 곳 말고 데이트하기 좋은 데", ("QUIET", "PURPOSE_DATE"), (), ()),
        ],
    )
    def test_negation(
        self,
        query: str,
        codes: tuple[str, ...],
        avoid_foods: tuple[str, ...],
        menus: tuple[tuple[str, bool], ...],
    ) -> None:
        """규칙해석_싫어·없는·않은·말고로부정하면_그낱말만피함이나반대쪽으로읽는다"""
        conditions = interpret_by_rules(query)

        assert conditions.codes == codes
        assert conditions.avoid_foods == avoid_foods
        assert tuple((m.value, m.want) for m in conditions.menus) == menus

    @pytest.mark.parametrize(
        ("query", "categories"),
        [
            ("카페 싫고 매운 것도 싫어", (("RESTAURANT", True), ("CAFE", False))),
            ("강남역 매운 건 싫어", (("RESTAURANT", True),)),
            ("역삼역 카페 말고 술집", (("BAR", True), ("CAFE", False))),
        ],
    )
    def test_negated_categories(
        self, query: str, categories: tuple[tuple[str, bool], ...]
    ) -> None:
        """규칙해석_싫어로업종을빼면_빼달라는업종이고음식낱말은업종으로남는다"""
        conditions = interpret_by_rules(query)

        assert tuple((c.code, c.want) for c in conditions.categories) == categories

    @pytest.mark.parametrize(
        ("query", "embedding_text"),
        [
            ("시끄러운 데 말고 조용한 카페", "조용한 카페"),
            ("매운 거 말고 담백한 국물 요리", "담백한 국물 요리"),
            ("강남역 조용한 카페 말고 술집", "조용한 술집"),
            # 다 지우면 업종 이름이다.
            ("강남역 매운 건 싫어", "식당"),
        ],
    )
    def test_negated_removed(self, query: str, embedding_text: str) -> None:
        """규칙해석_벡터용문장의부정한말은_지운다"""
        assert interpret_by_rules(query).embedding_text == embedding_text

    def test_follow_up_overrides_menu(self) -> None:
        """규칙해석_후속에서이전메뉴를빼면_그메뉴는피함이고나머지조건은잇는다"""
        previous = interpret_by_rules("역삼역 조용한 파스타 식당 새벽까지")

        conditions = interpret_by_rules("파스타 말고 일요일", previous)

        assert [(m.value, m.want) for m in conditions.menus] == [("파스타", False)]
        assert conditions.codes == ("QUIET",)
        assert [(h.open_until, h.day) for h in conditions.hours] == [
            ("02:00", None),
            (None, "SUN"),
        ]
        assert conditions.station == "YEOKSAM"

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

        assert conditions == Conditions.from_codes(
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
        previous = Conditions.from_codes(
            "근처 카페", "근처 카페", (), "CAFE", nearby=True
        )

        conditions = interpret_by_rules("강남역에서 찾아줘", previous)

        assert (conditions.station, conditions.nearby) == ("GANGNAM", False)

    def test_follow_up_nearby_drops_station(self) -> None:
        """규칙해석_역검색뒤근처를말하면_이전역을버린다"""
        conditions = interpret_by_rules("근처로 찾아줘", PREVIOUS)

        assert (conditions.station, conditions.nearby) == (None, True)

    def test_follow_up_too_long(self) -> None:
        """규칙해석_합친문장이너무길면_새요청만남긴다"""
        previous = Conditions.from_codes(
            text="가" * MAX_TEXT_LENGTH, embedding_text="카페"
        )

        assert interpret_by_rules("조용하게", previous).text == "조용하게"


def test_facilities() -> None:
    """조건_시설코드만_facilities로고른다"""
    conditions = Conditions.from_codes("t", "t", codes=("QUIET", "PARKING", "WIFI"))

    assert conditions.facilities == ("PARKING", "WIFI")


def test_prompt_lists_codes() -> None:
    """지시_특징코드표에는특징코드만있고_시설·음식종류는각칸에있다"""
    assert "QUIET: 조용하고 차분한 곳" in SYSTEM_PROMPT
    assert "FOOD_KOREAN: " not in SYSTEM_PROMPT
    assert "PARKING(주차)" in SYSTEM_PROMPT
    assert "FOOD_KOREAN(한식)" in SYSTEM_PROMPT
