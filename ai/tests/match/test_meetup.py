"""모임 계산 한 번을 확인한다(docs/specs/meetup/spec.md AC-50 ~ AC-55, AC-57).

거르기(지역·업종 우선, 영업시간, 못 먹는 음식), 사람별 취향과 항목별 합치기(비율 무게,
다시 나누기, 메뉴 가격 상한), 모임 점수, 참여자 취향 점수, 후보 없음 원인을 본다. 요청문 인코딩, 장소
저장소, 메뉴 해석은 가짜다. 점수 기준은 가짜 저장소의 장소 전체로 만든다.
"""

from collections.abc import Callable, Sequence
from dataclasses import replace

import pytest

from fit_ai.match import meetup
from fit_ai.match.candidates import (
    Candidate,
    DayHours,
    Found,
    PlaceDetails,
    PlaceFilter,
    StationArea,
)
from fit_ai.match.conditions import Layer
from fit_ai.match.interpretation import Conditions
from fit_ai.match.interpretation.segments import Choice
from fit_ai.match.meetup import (
    MeetupMember,
    MeetupRequest,
    MeetupWhen,
    _merge,
    _people,
    is_open,
    meetup_search,
)
from fit_ai.match.meetup_menus import MenuReading, rule_menus
from fit_ai.match.place import ConditionEvidence, Place, PlaceInfo
from fit_ai.match.taste_select import TasteFeature, TasteProfile

SEOLLEUNG = StationArea("선릉역", "SEOLLEUNG")
DAILY = tuple(
    DayHours(d, "11:00", "22:00", False)
    for d in ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")
)


def place(
    place_id: int,
    food_type: str | None,
    evidence: dict[str, ConditionEvidence] | None = None,
) -> Place:
    """리뷰 100건을 읽은 선릉역 식당"""
    return Place(
        place_id=place_id,
        info=PlaceInfo(place_id, "RESTAURANT", "SEOLLEUNG", {}, food_type, 100),
        summary=f"설명 {place_id}",
        conditions=evidence or {},
    )


QUIET_KOREAN = place(
    1,
    "FOOD_KOREAN",
    {"QUIET": ConditionEvidence(pos=10), "LIVELY": ConditionEvidence(neg=10)},
)
"""조용하다는 근거가 있는 한식집. 곱창 메뉴가 있다. 소음 축은 장소 프로필처럼 두 극에 함께
근거가 있다(`place._conditions`)."""
LIVELY_SPICY = place(
    2,
    "FOOD_KOREAN",
    {
        "QUIET": ConditionEvidence(neg=8),
        "LIVELY": ConditionEvidence(pos=8),
        "FOOD_SPICY": ConditionEvidence(pos=6),
    },
)
"""활기차다는 근거와 맵다는 근거가 있는 한식집"""
QUIET_WESTERN = place(
    3,
    "FOOD_WESTERN",
    {"QUIET": ConditionEvidence(pos=3), "LIVELY": ConditionEvidence(neg=3)},
)
"""조용하다는 근거가 조금 있는 양식집. 메뉴판이 없다."""
NO_EVIDENCE = place(4, "FOOD_CHINESE")
"""근거가 하나도 없는 중식집. 마라탕 메뉴가 있고 일요일에 쉰다."""

PLACES = (QUIET_KOREAN, LIVELY_SPICY, QUIET_WESTERN, NO_EVIDENCE)
DETAILS = {
    1: PlaceDetails(DAILY, ("곱창전골", "소주"), "선릉 곱창", "곱창,막창"),
    2: PlaceDetails(DAILY, ("매운 갈비찜",), "매운집", "한식"),
    3: PlaceDetails(
        tuple(
            DayHours(h.day, h.open, h.close, h.closed, (("15:00", "17:00"),))
            for h in DAILY
        ),
        (),
        None,
        None,
    ),
    4: PlaceDetails(
        (*DAILY[:6], DayHours("SUN", None, None, True)),
        ("마라탕",),
        "마라 하우스",
        "중식",
    ),
}


class FakeStore:
    """정해 둔 장소를 유사도 순서(1, 2, 3, 4번)로 돌려주고 받은 거르기 조건을 남긴다.

    빼는 음식 종류만 실제로 거른다. `matches`가 거짓인 조건에는 아무 곳도 주지 않는다.
    """

    def __init__(
        self,
        places: Sequence[Place] = PLACES,
        matches: Callable[[PlaceFilter], bool] = lambda f: True,
        details: dict[int, PlaceDetails] | None = None,
    ) -> None:
        self._places = tuple(places)
        self._details = DETAILS if details is None else details
        self.matches = matches
        self.filters: list[PlaceFilter] = []

    def find(self, place_filter: PlaceFilter, query: Sequence[float], k: int) -> Found:
        self.filters.append(place_filter)
        if not self.matches(place_filter):
            return Found(())
        kept = [
            p
            for p in self._places
            if p.info.food_type not in place_filter.excluded_food_types
        ]
        return Found(tuple(Candidate(p, 1.0 - i / 10) for i, p in enumerate(kept[:k])))

    def places(self) -> tuple[Place, ...]:
        return self._places

    def details(self, place_ids: Sequence[int]) -> dict[int, PlaceDetails]:
        return {i: self._details[i] for i in place_ids if i in self._details}

    def vector_counts(self):  # pragma: no cover - 모임 계산은 쓰지 않는다
        raise NotImplementedError


@pytest.fixture
def encoded(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """요청문 인코딩을 가짜로 바꾸고 인코딩한 문장을 남긴다."""
    texts: list[str] = []

    def encode(batch: list[str]) -> list[list[float]]:
        # search._encode와 같은 모양이다. 문장 하나를 그대로 넘기면 여기서 걸린다
        assert isinstance(batch, list)
        texts.extend(batch)
        return [[1.0, 0.0] for _ in batch]

    monkeypatch.setattr(meetup, "_encode", encode)
    return texts


def no_menus(texts: Sequence[str]) -> MenuReading:
    raise AssertionError("메뉴 글이 없으면 부르지 않는다")


def menus_by_rule(texts: Sequence[str]) -> MenuReading:
    return MenuReading(tuple(rule_menus(t) for t in texts))


def request(*members: MeetupMember, **values) -> MeetupRequest:
    fields = {
        "conditions": None,
        "area": SEOLLEUNG,
        "category": "RESTAURANT",
        "when": None,
        "members": members,
    }
    return MeetupRequest(**(fields | values))


def scores(result) -> dict[int, int | None]:
    return {item.card.place_id: item.score for item in result.items}


def member_scores(result, key: str) -> dict[int, object]:
    return {
        item.card.place_id: next(s for s in item.member_scores if s.key == key)
        for item in result.items
    }


class TestOpen:
    """모임 날짜·시각의 영업시간 거르기(AC-51)"""

    def test_date_only(self) -> None:
        """영업시간_날짜만있으면_그요일에쉬는곳만뺀다"""
        hours = DETAILS[4].hours
        assert not is_open(hours, MeetupWhen("SUN"))
        assert is_open(hours, MeetupWhen("MON"))
        assert is_open((), MeetupWhen("SUN"))

    def test_open_and_closing(self) -> None:
        """영업시간_그시각에열면남기고_1시간안에닫거나아직열기전이면뺀다"""
        assert is_open(DAILY, MeetupWhen("MON", 19 * 60))
        assert not is_open(DAILY, MeetupWhen("MON", 21 * 60 + 30))
        assert not is_open(DAILY, MeetupWhen("MON", 10 * 60))

    def test_breaks(self) -> None:
        """영업시간_브레이크타임이거나1시간안에시작하면뺀다"""
        hours = DETAILS[3].hours
        assert not is_open(hours, MeetupWhen("TUE", 15 * 60 + 30))
        assert not is_open(hours, MeetupWhen("TUE", 14 * 60 + 30))
        assert is_open(hours, MeetupWhen("TUE", 13 * 60))

    def test_overnight_from_previous_day(self) -> None:
        """영업시간_전날밤부터이어지는영업은영업중이다"""
        hours = (
            DayHours("SUN", "18:00", "02:00", False),
            DayHours("MON", None, None, True),
        )
        assert is_open(hours, MeetupWhen("MON", 30))
        assert not is_open(hours, MeetupWhen("MON", 90))
        assert not is_open(hours, MeetupWhen("MON", 19 * 60))

    def test_unknown_kept(self) -> None:
        """영업시간_모르는요일이나읽지못한시각은남긴다"""
        assert is_open((), MeetupWhen("MON", 3 * 60))
        assert is_open((DayHours("MON", None, None, False),), MeetupWhen("MON", 3 * 60))
        assert is_open(
            (DayHours("MON", "열시", "22:00", False),), MeetupWhen("MON", 60)
        )

    def test_all_day_runs_together(self) -> None:
        """영업시간_24시간영업이이어지면_자정전에도마감임박으로보지않는다"""
        hours = tuple(DayHours(h.day, "00:00", "00:00", False) for h in DAILY)
        assert is_open(hours, MeetupWhen("MON", 23 * 60 + 30))


class TestFilter:
    """거르기 조건(AC-50, AC-52, AC-57)"""

    def test_request_values_win(self, encoded: list[str]) -> None:
        """거르기_지역과업종은요청값이설명보다앞서고_메뉴가격상한으로는거르지않는다"""
        store = FakeStore()
        conditions = Conditions(
            "강남 카페 주차",
            "주차되는 카페",
            categories=(Choice("CAFE", True),),
            facilities=("PARKING",),
        )
        meetup_search(
            request(
                MeetupMember("1", avoid_foods=("FOOD_CHINESE",), price_cap=20000),
                MeetupMember("2", price_cap=15000),
                conditions=conditions,
            ),
            store,
            no_menus,
        )

        used = store.filters[0]
        assert used.category_group == "RESTAURANT"
        assert used.areas == (SEOLLEUNG,)
        assert used.facilities == ("PARKING",)
        assert used.excluded_food_types == ("FOOD_CHINESE",)
        assert used.max_price is None
        assert encoded == ["주차되는 카페"]

    @pytest.mark.parametrize(
        ("category", "text"), [("RESTAURANT", "식당"), (None, "맛집")]
    )
    def test_without_description(
        self, encoded: list[str], category: str | None, text: str
    ) -> None:
        """거르기_설명이없으면_업종이름으로후보를뽑고업종이없으면업종으로거르지않는다"""
        store = FakeStore()
        meetup_search(request(category=category), store, no_menus)

        assert encoded == [text]
        assert store.filters[0].category_group == category

    def test_when_excludes_closed(self, encoded: list[str]) -> None:
        """거르기_모임날짜에쉬는곳은빠진다"""
        result = meetup_search(request(when=MeetupWhen("SUN")), FakeStore(), no_menus)

        assert [i.card.place_id for i in result.items] == [1, 2, 3]

    def test_closed_day_to_store(self, encoded: list[str]) -> None:
        """거르기_모임요일은저장소에넘기고_시각이있으면전날도넘긴다"""
        date_store, time_store = FakeStore(), FakeStore()
        meetup_search(request(when=MeetupWhen("MON")), date_store, no_menus)
        meetup_search(request(when=MeetupWhen("MON", 19 * 60)), time_store, no_menus)

        date_only, with_time = date_store.filters[0], time_store.filters[0]
        assert (date_only.closed_day, date_only.overnight_day) == ("MON", None)
        assert (with_time.closed_day, with_time.overnight_day) == ("MON", "SUN")


class TestMerge:
    """사람별 취향과 항목별 합치기(PRD FR-22, D-42)"""

    def test_mood_weights_renormalized(self, encoded: list[str]) -> None:
        """분위기_고른비율이무게이고_그렇다는리뷰가없는쪽은빼고다시나눈다"""
        quiet_majority = meetup_search(
            request(
                MeetupMember("1", mood="QUIET"),
                MeetupMember("2", mood="QUIET"),
                MeetupMember("3", mood="LIVELY"),
            ),
            FakeStore(),
            no_menus,
        )
        lively_only = meetup_search(
            request(MeetupMember("1", mood="LIVELY")), FakeStore(), no_menus
        )

        # 조용한 한식집은 조용함 쪽(무게 2/3)만 남아 그 쪽 조건 점수만으로 낸다.
        assert scores(quiet_majority)[1] is not None
        # 활기찬 한식집은 활기 쪽(1/3)만 남아 분위기를 비교에서 뺀다. 감점하지 않는다.
        assert scores(quiet_majority)[2] is None
        assert scores(quiet_majority)[4] is None
        assert scores(lively_only)[1] is None
        assert scores(lively_only)[2] is not None

    def test_mood_dropped_when_only_minority_known(self, encoded: list[str]) -> None:
        """분위기_근거있는쪽의무게가0점5보다작으면_분위기를뺀다"""
        only_quiet_known = place(9, None, {"QUIET": ConditionEvidence(pos=10)})
        store = FakeStore((only_quiet_known, *PLACES))
        result = meetup_search(
            request(
                MeetupMember("1", mood="QUIET"),
                MeetupMember("2", mood="LIVELY"),
                MeetupMember("3", mood="LIVELY"),
            ),
            store,
            no_menus,
        )

        # 조용함 쪽에만 근거가 있고 그 무게가 1/3이라 분위기를 판정하지 않는다.
        assert scores(result)[9] is None
        # 활기 쪽(2/3)에 근거가 있는 곳은 판정한다.
        assert scores(result)[2] is not None

    def test_foods_weighted_by_largest(self, encoded: list[str]) -> None:
        """선호음식_그장소의종류무게를가장큰무게로나눈다"""
        result = meetup_search(
            request(
                MeetupMember("1", like_foods=("FOOD_KOREAN",)),
                MeetupMember("2", like_foods=("FOOD_KOREAN",)),
                MeetupMember("3", like_foods=("FOOD_KOREAN", "FOOD_WESTERN")),
                MeetupMember("4", like_foods=("FOOD_WESTERN",)),
            ),
            FakeStore(),
            no_menus,
        )

        assert scores(result) == {1: 100, 2: 100, 3: 67, 4: 0}
        assert result.applied.like_foods == ("FOOD_KOREAN", "FOOD_WESTERN")

    def test_split_foods_lowered(self) -> None:
        """선호음식_모두다른종류로갈리면_음식비중을낮춘다"""
        people, _ = _people(
            request(
                MeetupMember("1", like_foods=("FOOD_KOREAN",)),
                MeetupMember("2", like_foods=("FOOD_WESTERN",)),
                MeetupMember("3", like_foods=("FOOD_CHINESE",)),
            ),
            {},
            None,
        )
        assert _merge(people, None).food_weight == meetup.SPLIT_FOOD_WEIGHT

    def test_spicy_lowers_score(self, encoded: list[str]) -> None:
        """매운음식_못먹는사람이있으면_맵다는근거가있는곳의점수가낮다"""
        base = meetup_search(
            request(MeetupMember("1", like_foods=("FOOD_KOREAN",))),
            FakeStore(),
            no_menus,
        )
        averse = meetup_search(
            request(
                MeetupMember("1", like_foods=("FOOD_KOREAN",)),
                MeetupMember("2", no_spicy=True),
            ),
            FakeStore(),
            no_menus,
        )

        assert scores(averse)[2] < scores(base)[2]
        # 맵다는 근거가 없는 곳은 감점하지 않는다.
        assert scores(averse)[1] == scores(base)[1]
        assert [i.card.place_id for i in averse.items] == [1, 2, 3, 4]

    def test_price_caps_weighted(self, encoded: list[str]) -> None:
        """메뉴가격_거르지않고_가게가격이상한의110퍼센트안인사람비율로센다"""
        priced = {
            i: replace(DETAILS[i], price=price)
            for i, price in ((1, 22000), (2, 25000), (3, None), (4, 40000))
        }
        result = meetup_search(
            request(
                MeetupMember("1", price_cap=30000),
                MeetupMember("2", price_cap=20000),
                MeetupMember("3"),
            ),
            FakeStore(details=priced),
            no_menus,
        )

        # 상한의 110%까지는 맞고, 가격을 모르는 곳은 감점하지 않고 비교에서 뺀다.
        assert scores(result) == {1: 100, 2: 50, 4: 0, 3: None}
        assert result.applied.price_cap == 20000
        low = member_scores(result, "2")
        assert [low[i].score for i in (1, 2, 4)] == [100, 0, 0]
        assert low[3].score is None and low[3].unverified
        assert member_scores(result, "1")[2].score == 100

    def test_menus_read_once_and_weighted(self, encoded: list[str]) -> None:
        """메뉴_글을한번에해석하고_적은사람수로파는곳을올린다"""
        calls: list[list[str]] = []

        def read(texts: Sequence[str]) -> MenuReading:
            calls.append(list(texts))
            return menus_by_rule(texts)

        result = meetup_search(
            request(
                MeetupMember("1", want_menu="곱창"),
                MeetupMember("2", want_menu="곱창, 마라탕"),
                MeetupMember("3"),
            ),
            FakeStore(),
            read,
        )

        assert calls == [["곱창", "곱창, 마라탕"]]
        assert scores(result) == {1: 100, 4: 50, 2: 0, 3: None}
        assert result.applied.want_menus == ("곱창", "마라탕")

    def test_usual_taste(self) -> None:
        """평소취향_이번답이앞서고_나머지는가진회원비율×0점5무게다"""
        profile = TasteProfile(
            "u1",
            (
                TasteFeature("LIVELY", Layer.AXIS, True, 3),
                TasteFeature("SHORT_WAIT", Layer.IMPORTANCE, True, 2),
                TasteFeature("PURPOSE_DATE", Layer.PURPOSE, True, 2),
                TasteFeature("FOOD_JAPANESE", Layer.FOOD, True, 2),
            ),
            (),
        )
        people, invalid = _people(
            request(
                MeetupMember("1", user_id="u1", mood="QUIET"),
                MeetupMember("2", user_id="u2"),
                MeetupMember("3"),
            ),
            {},
            lambda user_id: profile if user_id == "u1" else None,
        )
        merged = _merge(people, None)

        assert not invalid
        assert people[0].mood == "QUIET"
        assert people[0].foods == ("FOOD_JAPANESE",)
        assert merged.usual == {"SHORT_WAIT": (True, 0.25)}
        assert merged.moods == {"QUIET": 1.0}

    def test_description_mood_wins(self) -> None:
        """분위기_모임설명에분위기가있으면_참여자분위기는합치지않는다"""
        people, _ = _people(request(MeetupMember("1", mood="LIVELY")), {}, None)
        conditions = Conditions("조용한 곳", "조용한 곳", features=())
        assert _merge(people, conditions).moods == {"LIVELY": 1.0}
        described = Conditions(
            "조용한 곳",
            "조용한 곳",
            features=(meetup_feature("QUIET"),),
        )
        assert _merge(people, described).moods == {}


def meetup_feature(code: str):
    from fit_ai.match.interpretation.segments import Feature

    return Feature(code, code, code)


class TestMemberScore:
    """참여자 취향 점수(AC-54)"""

    def test_own_taste_with_evidence(self, encoded: list[str]) -> None:
        """참여자점수_그사람취향만근거있는항목으로낸다"""
        result = meetup_search(
            request(MeetupMember("1", mood="QUIET", like_foods=("FOOD_KOREAN",))),
            FakeStore(),
            no_menus,
        )
        mine = member_scores(result, "1")

        assert mine[1].score == 100
        assert not mine[1].unverified
        # 조용하다는 리뷰가 조금 있지만 맞음 기준에 못 미치는 양식집은 분위기가 아님(0)이다.
        assert mine[3].score == 0
        assert not mine[3].unverified
        # 조용하다는 리뷰가 없는 곳은 분위기를 모름으로 빼고 음식만으로 낸다.
        assert mine[2].score == 100
        assert mine[2].unverified
        assert mine[4].score == 0
        assert mine[4].unverified

    def test_opposite_reviews_are_unknown_for_minority(
        self, encoded: list[str]
    ) -> None:
        """참여자점수_반대극리뷰만있는곳은_그쪽을고른사람에게모름이라덜맞는사람이아니다"""
        result = meetup_search(
            request(
                MeetupMember("1", mood="QUIET"),
                MeetupMember("2", mood="QUIET"),
                MeetupMember("3", mood="LIVELY"),
            ),
            FakeStore(),
            no_menus,
        )
        lively = member_scores(result, "3")

        # 조용한 한식집에서 활기를 고른 사람은 판정할 항목이 없다(2026-11-12 실험).
        assert lively[1].score is None
        assert lively[1].unverified
        assert lively[2].score == 100

    def test_missed_menu(self, encoded: list[str]) -> None:
        """참여자점수_원한메뉴가메뉴판에없으면_그메뉴를준다"""
        result = meetup_search(
            request(MeetupMember("1", want_menu="곱창")), FakeStore(), menus_by_rule
        )
        mine = member_scores(result, "1")

        assert mine[1].missed_menu is None
        assert mine[4].missed_menu == "곱창"
        # 메뉴판이 없는 양식집은 판정하지 않는다.
        assert mine[3].score is None and mine[3].unverified

    def test_guest_without_answers(self, encoded: list[str]) -> None:
        """참여자점수_답하지않은비회원은_점수가없다"""
        result = meetup_search(
            request(MeetupMember("1", mood="QUIET"), MeetupMember("2")),
            FakeStore(),
            no_menus,
        )
        guest = member_scores(result, "2")
        assert all(s.score is None and not s.unverified for s in guest.values())


class TestEmpty:
    """후보 없음 원인(AC-55)"""

    def test_area_has_nothing(self, encoded: list[str]) -> None:
        """후보없음_지역과업종에장소가없으면_지역이원인이다"""
        result = meetup_search(request(), FakeStore(matches=lambda f: False), no_menus)

        assert result.items == ()
        assert result.empty is not None
        assert result.empty.cause == "선릉역 식당 중 아직 찾을 수 있는 곳이 없어요"
        assert result.empty.member_keys == ()

    def test_meeting_time(self, encoded: list[str]) -> None:
        """후보없음_모임요일에모두쉬면_쉬는날거르기까지빼보고모임시간을원인으로준다"""
        result = meetup_search(
            request(when=MeetupWhen("SUN", 19 * 60)),
            FakeStore(matches=lambda f: f.closed_day is None),
            no_menus,
        )

        assert result.empty is not None
        assert "모임 시간" in result.empty.cause

    def test_avoided_foods(self, encoded: list[str]) -> None:
        """후보없음_못먹는음식때문이면_그사람번호를붙인다"""
        korean = (QUIET_KOREAN, LIVELY_SPICY)
        result = meetup_search(
            request(
                MeetupMember("1", mood="QUIET"),
                MeetupMember("2", avoid_foods=("FOOD_KOREAN",)),
            ),
            FakeStore(korean),
            no_menus,
        )

        assert result.empty is not None
        assert "못 먹는 음식" in result.empty.cause
        assert result.empty.member_keys == ("2",)
