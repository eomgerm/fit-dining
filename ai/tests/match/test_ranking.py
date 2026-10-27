"""② 정렬을 확인한다.

LLM 입력 만들기, 출력 검사, 체크표로 등급 정하기, 등급으로 점수 매기기, LLM이
고르지 않은 후보 붙이기, LLM 없는 점수를 본다. 체크할 조건이 있으면 등급은 코드가,
없으면 LLM이 정한다. GMS는 공유 모듈 `fit_ai.gms.call_json`을 가짜(`fake_gms`)로 바꿔
끼우고, 가짜는 입력의 후보 줄을 읽고 정해 둔 순서로 답한다.
"""

import json
import random
import re
from collections.abc import Callable, Sequence

import pytest

from fit_ai.match.candidates import Candidate
from fit_ai.match.conditions import Layer
from fit_ai.match.place import ConditionEvidence, Place, PlaceInfo
from fit_ai.match.ranking import (
    GRADE_PROMPT,
    GRADES,
    LLM_TOP_K,
    ORDER_PROMPT,
    Ranked,
    RankingError,
    grade_by_rules,
    judged_codes,
    rank_by_similarity,
    rank_with_llm,
    similarity_to_score,
)
from fit_ai.match.taste import FreeText, TasteFeature


def make_candidate(
    place_id: int,
    similarity: float = 0.5,
    conditions: dict[str, ConditionEvidence] | None = None,
    facilities: dict[str, bool | None] | None = None,
) -> Candidate:
    """장소 요약이 "설명 {place_id}"인 카페 후보. 근거는 기본으로 없다."""
    place = Place(
        place_id=place_id,
        info=PlaceInfo(place_id, "CAFE", "GANGNAM", facilities or {}),
        summary=f"설명 {place_id}",
        conditions=conditions or {},
    )
    return Candidate(place, similarity)


CANDIDATES = [make_candidate(place_id) for place_id in (101, 102, 103)]


FakeGms = Callable[[Callable[[list[dict]], object]], list[list[dict]]]


class FakeLlm:
    """입력의 후보 줄에서 장소 설명을 읽고 `picks` 순서와 등급으로 답한다.

    Attributes:
        picks: 원하는 (장소 id, 등급) 순서
        prompts: 받은 (지시, 입력) 기록
    """

    def __init__(self, picks: list[tuple[int, str]]) -> None:
        self.picks = picks
        self.prompts: list[tuple[str, str]] = []

    def __call__(self, messages: list[dict]) -> dict:
        system, user = messages[0]["content"], messages[1]["content"]
        self.prompts.append((system, user))
        number_of = {
            int(place_id): int(number)
            for number, place_id in re.findall(
                r"^\[(\d+)\] .* \| 설명 (\d+)(?: \| .*)?$", user, re.MULTILINE
            )
        }
        ranking = [
            {"id": number_of[place_id], "fit": fit} for place_id, fit in self.picks
        ]
        return {"ranking": ranking}


class FixedLlm:
    """정해 둔 응답 본문으로 답한다. JSON이 아니면 호출 실패로 본다.

    받은 입력은 `prompts`에 남긴다.
    """

    def __init__(self, raw: str) -> None:
        self.raw = raw
        self.prompts: list[str] = []

    def __call__(self, messages: list[dict]) -> object:
        self.prompts.append(messages[1]["content"])
        try:
            return json.loads(self.raw)
        except json.JSONDecodeError:
            return None


def broken(messages: list[dict]) -> None:
    """호출이 늘 실패한다(모델 응답 없음)."""


def rank(
    fake_gms: FakeGms,
    answer: Callable[[list[dict]], object],
    candidates: Sequence[Candidate] = CANDIDATES,
    features: Sequence[TasteFeature] = (),
    free_texts: Sequence[FreeText] = (),
    request_codes: Sequence[str] = (),
) -> list[Ranked]:
    """GMS 답을 바꿔 끼우고, 요청문과 난수기를 고정해 정렬한다."""
    fake_gms(answer)
    return rank_with_llm(
        "강남역 조용한 카페",
        request_codes,
        candidates,
        features,
        free_texts,
        random.Random(7),
    ).ranked


def scores(ranked: list[Ranked]) -> list[tuple[int, int]]:
    return [(r.candidate.place.place_id, r.score) for r in ranked]


class TestPrompt:
    """LLM 입력"""

    def test_prompts(self) -> None:
        """LLM지시_등급을매길때는기준을_순서만정할때는등급을바꾸지말라고담는다"""
        assert f"최대 {LLM_TOP_K}곳" in GRADE_PROMPT
        for grade in GRADES:
            assert f"- {grade.label}: {grade.rule}." in GRADE_PROMPT
        assert "등급은 바꾸지 않는다" in ORDER_PROMPT
        assert '"fit"' not in ORDER_PROMPT

    def test_tastes_as_phrases(self, fake_gms: FakeGms) -> None:
        """LLM입력_취향이있으면_좋아함싫어함과강도를spec문구로쓴다"""
        llm = FakeLlm([(101, "딱 맞음")])
        features = [
            TasteFeature("QUIET", Layer.AXIS, True, 3),
            TasteFeature("LIVELY", Layer.AXIS, False, 1),
        ]
        free_texts = [
            FreeText("점심엔 담백한 국물 요리가 좋아요", True, (0.6, 0.8)),
            FreeText("주차되는 곳", True, None),
        ]

        rank(fake_gms, llm, features=features, free_texts=free_texts)

        user = llm.prompts[0][1]
        assert "요청: 강남역 조용한 카페" in user
        assert "- 좋아함: 조용하고 차분한 곳(강하게)" in user
        assert "- 싫어함: 활기찬 곳\n" in user
        assert "- 좋아함: 점심엔 담백한 국물 요리가 좋아요" in user
        # 벡터가 없는 문장은 spec이 보관만 하기로 했다.
        assert "주차되는 곳" not in user

    def test_no_tastes(self, fake_gms: FakeGms) -> None:
        """LLM입력_취향이없으면_없음이라고쓴다"""
        llm = FakeLlm([(101, "딱 맞음")])

        rank(fake_gms, llm)

        assert "취향:\n- 없음\n" in llm.prompts[0][1]

    def test_candidates_shuffled(self, fake_gms: FakeGms) -> None:
        """LLM입력_후보는_섞어서번호를붙이고업종과설명을쓴다"""
        ids = list(range(1, 11))
        llm = FakeLlm([(1, "딱 맞음")])

        rank(fake_gms, llm, [make_candidate(place_id) for place_id in ids])

        lines = re.findall(
            r"^\[\d+\] 카페 \| 설명 (\d+)$", llm.prompts[0][1], re.MULTILINE
        )
        assert sorted(map(int, lines)) == ids
        assert list(map(int, lines)) != ids

    def test_review_evidence(self, fake_gms: FakeGms) -> None:
        """LLM입력_근거가있으면_그렇다는리뷰가많은특징부터수를붙인다"""
        candidate = make_candidate(
            101,
            conditions={
                "QUIET": ConditionEvidence(pos=8, neg=2),
                "PURPOSE_GROUP": ConditionEvidence(pos=20, neg=1),
                "SPACIOUS_SEATING": ConditionEvidence(pos=0, neg=5),
                "COZY": ConditionEvidence(),
                "UNKNOWN_CODE": ConditionEvidence(pos=9),
            },
        )
        llm = FixedLlm('{"ranking": [{"id": 1, "fit": "딱 맞음"}]}')

        rank(fake_gms, llm, [candidate])

        assert (
            "[1] 카페 | 설명 101 | 리뷰: 단체 모임 하기 좋은 곳 20/1, "
            "조용하고 차분한 곳 8/2, 매장이 넓고 좌석이 편한 곳 0/5\n"
        ) in llm.prompts[0] + "\n"

    def test_request_verdicts(self, fake_gms: FakeGms) -> None:
        """LLM입력_요청조건이있으면_조건마다확인반대모름을붙이고리뷰에서는뺀다"""
        candidate = make_candidate(
            101,
            conditions={
                "QUIET": ConditionEvidence(pos=8, neg=2),
                "LIVELY": ConditionEvidence(pos=3, neg=1),
            },
            facilities={"PARKING": False},
        )
        llm = FixedLlm('{"ranking": [{"id": 1, "fit": "일부"}]}')

        # 음식 종류는 카드 조건이 아니라서 판정하지 않고 LLM이 설명으로 본다.
        rank(
            fake_gms,
            llm,
            [candidate],
            request_codes=["QUIET", "PARKING", "PURPOSE_GROUP", "FOOD_KOREAN", "QUIET"],
        )

        assert (
            "[1] 카페 | 설명 101 | 등급: 안 맞음 | 요청 조건: 조용해요 확인(8/2), "
            "주차할 수 있어요 반대(장소 정보), 모임하기 좋아요 모름 | "
            "리뷰: 활기찬 곳 3/1\n"
        ) in llm.prompts[0] + "\n"


class TestGradeByRules:
    """체크표로 등급 정하기"""

    @pytest.mark.parametrize(
        ("conditions", "codes", "grade"),
        [
            ({"QUIET": (5, 0), "PURPOSE_TALK": (5, 0)}, ["QUIET", "PURPOSE_TALK"], 0),
            ({"QUIET": (5, 0)}, ["QUIET", "PURPOSE_TALK"], 1),
            ({"QUIET": (5, 0)}, ["QUIET", "PURPOSE_TALK", "COZY"], 2),
            ({}, ["QUIET", "PURPOSE_TALK"], 2),
            ({"QUIET": (5, 0), "PURPOSE_TALK": (1, 4)}, ["QUIET", "PURPOSE_TALK"], 3),
        ],
    )
    def test_rules(
        self, conditions: dict[str, tuple[int, int]], codes: list[str], grade: int
    ) -> None:
        """등급_반대가있으면안맞음_모두확인이면딱맞음_절반이상이면대체로_나머지는일부"""
        candidate = make_candidate(
            1,
            conditions={
                c: ConditionEvidence(pos, neg) for c, (pos, neg) in conditions.items()
            },
        )

        assert grade_by_rules(candidate.place, codes) == grade

    def test_judged_codes(self) -> None:
        """체크할코드_카드조건목록에있는코드만_한번씩남긴다"""
        codes = ["QUIET", "FOOD_KOREAN", "QUIET", "PARKING"]

        assert judged_codes(codes) == ["QUIET", "PARKING"]


QUIET = {"QUIET": ConditionEvidence(pos=5)}


class TestOrderWithinCodeGrade:
    """체크할 조건이 있을 때: 등급은 코드, 순서는 LLM"""

    def test_llm_orders_within_grade(self, fake_gms: FakeGms) -> None:
        """코드등급_LLM이낮은등급을앞에놓아도_등급순서를따르고같은등급안은LLM순서다"""
        candidates = [
            make_candidate(101, conditions=QUIET),
            make_candidate(102),
            make_candidate(103, conditions=QUIET),
        ]
        llm = FakeLlm([(102, "딱 맞음"), (103, "일부"), (101, "일부")])

        ranked = rank(fake_gms, llm, candidates, request_codes=["QUIET"])

        assert scores(ranked) == [(103, 100), (101, 92), (102, 64)]
        system, user = llm.prompts[0]
        assert system == ORDER_PROMPT
        assert "| 설명 101 | 등급: 딱 맞음 |" in user

    def test_unpicked_keep_grade(self, fake_gms: FakeGms) -> None:
        """코드등급_LLM이고르지않은후보도_자기등급안에서고른후보뒤에유사도순서로온다"""
        candidates = [
            make_candidate(1, 0.9),
            make_candidate(2, 0.8, QUIET),
            make_candidate(3, 0.7, QUIET),
            make_candidate(4, 0.6),
        ]

        ranked = rank(
            fake_gms, FakeLlm([(4, "딱 맞음")]), candidates, request_codes=["QUIET"]
        )

        assert scores(ranked) == [(2, 100), (3, 92), (4, 64), (1, 52)]

    def test_fit_not_read(self, fake_gms: FakeGms) -> None:
        """코드등급_LLM출력에등급이없어도_읽는다"""
        raw = '{"ranking": [{"id": 1}]}'

        ranked = rank(
            fake_gms,
            FixedLlm(raw),
            [make_candidate(1, conditions=QUIET)],
            request_codes=["QUIET"],
        )

        assert scores(ranked) == [(1, 100)]

    def test_empty_pick_keeps_grade_order(self, fake_gms: FakeGms) -> None:
        """코드등급_LLM이아무것도고르지않으면_등급과유사도순서로정렬한다"""
        candidates = [make_candidate(1, 0.9), make_candidate(2, 0.8, QUIET)]

        ranked = rank(
            fake_gms, FixedLlm('{"ranking": []}'), candidates, request_codes=["QUIET"]
        )

        assert scores(ranked) == [(2, 100), (1, 64)]

    @pytest.mark.parametrize("raw", ['{"ranking": [{"id": 9}]}', "순서"])
    def test_reject_bad_output(self, fake_gms: FakeGms, raw: str) -> None:
        """코드등급_번호가틀리거나JSON이아니면_실패한다"""
        with pytest.raises(RankingError):
            rank(fake_gms, FixedLlm(raw), request_codes=["QUIET"])


class TestRankWithLlm:
    """LLM 정렬"""

    def test_scores_from_grade_and_rank(self, fake_gms: FakeGms) -> None:
        """LLM정렬_등급구간안에서순위대로점수를매기고_등급1위가구간최고점이다"""
        ranked = rank(
            fake_gms, FakeLlm([(103, "딱 맞음"), (101, "딱 맞음"), (102, "대체로")])
        )

        assert scores(ranked) == [(103, 100), (101, 92), (102, 84)]

    def test_grade_wins_over_order(self, fake_gms: FakeGms) -> None:
        """LLM정렬_순서와등급이어긋나면_등급을따르고같은등급안에서는LLM순서다"""
        ranked = rank(
            fake_gms, FakeLlm([(101, "일부"), (102, "딱 맞음"), (103, "일부")])
        )

        assert scores(ranked) == [(102, 100), (101, 64), (103, 52)]

    def test_unpicked_follow_by_similarity(self, fake_gms: FakeGms) -> None:
        """LLM정렬_고르지않은후보는_유사도순서로고른후보보다낮은점수로붙인다"""
        candidates = [
            make_candidate(place_id, similarity)
            for place_id, similarity in [
                (1, 0.8),
                (2, 0.7),
                (3, 0.6),
                (4, 0.5),
                (5, 0.4),
            ]
        ]

        ranked = rank(fake_gms, FakeLlm([(4, "딱 맞음"), (2, "대체로")]), candidates)

        assert scores(ranked) == [(4, 100), (2, 84), (1, 83), (3, 67), (5, 33)]

    def test_fit_label_ignores_spaces(self, fake_gms: FakeGms) -> None:
        """LLM정렬_등급이름의띄어쓰기가달라도_읽는다"""
        raw = '{"ranking": [{"id": 1, "fit": "딱맞음"}]}'

        ranked = rank(fake_gms, FixedLlm(raw), CANDIDATES[:1])

        assert ranked[0].score == 100

    @pytest.mark.parametrize(
        ("raw", "reason"),
        [
            ('{"order": []}', "ranking"),
            ('{"ranking": []}', "고른 후보가 없다"),
            (
                '{"ranking": [{"id": 1, "fit": "일부"}, {"id": 1, "fit": "일부"}]}',
                "두 번",
            ),
            ('{"ranking": [{"id": 4, "fit": "일부"}]}', "후보 밖"),
            ('{"ranking": [{"id": "1", "fit": "일부"}]}', "후보 밖"),
            ('{"ranking": [{"id": 1, "fit": "최고"}]}', "모르는 등급"),
            ('{"ranking": [{"id": 1, "fit": 3}]}', "모르는 등급"),
            ('{"ranking": [{"id": 1, "score": 90}]}', "모르는 등급"),
        ],
    )
    def test_reject_bad_output(self, fake_gms: FakeGms, raw: str, reason: str) -> None:
        """LLM정렬_출력이형식에맞지않으면_다시부르지않고이유와원본을남기고실패한다"""
        llm = FixedLlm(raw)

        with pytest.raises(RankingError, match=reason) as error:
            rank(fake_gms, llm)

        assert len(llm.prompts) == 1
        assert json.loads(error.value.raw) == json.loads(raw)
        assert error.value.seconds is not None

    @pytest.mark.parametrize("answer", [broken, FixedLlm("순위는 이렇다")])
    def test_llm_call_failed(self, fake_gms: FakeGms, answer) -> None:
        """LLM정렬_호출이실패하거나JSON이아니면_원본없이실패한다"""
        with pytest.raises(RankingError, match="호출이 실패") as error:
            rank(fake_gms, answer)

        assert error.value.raw is None

    def test_no_candidates(self, fake_gms: FakeGms) -> None:
        """LLM정렬_후보가없으면_LLM을부르지않는다"""
        llm = FakeLlm([])

        assert rank(fake_gms, llm, []) == []
        assert llm.prompts == []


class TestRankBySimilarity:
    """LLM 없는 정렬"""

    def test_keep_order_and_convert(self) -> None:
        """유사도정렬_후보가있으면_순서는그대로두고유사도를점수로바꾼다"""
        candidates = [make_candidate(1, 0.8), make_candidate(2, 0.5)]

        ranked = rank_by_similarity(candidates)

        assert scores(ranked) == [(1, 100), (2, 50)]

    def test_code_grade_then_similarity(self) -> None:
        """유사도정렬_체크할조건이있으면_코드등급순서로놓고같은등급안은유사도순서다"""
        candidates = [make_candidate(1, 0.8), make_candidate(2, 0.5, QUIET)]

        ranked = rank_by_similarity(candidates, ["QUIET"])

        assert scores(ranked) == [(2, 100), (1, 64)]

    @pytest.mark.parametrize(
        ("similarity", "expected"),
        [(0.2, 0), (0.5, 50), (0.8, 100), (-1.0, 0), (1.0, 100)],
    )
    def test_linear_and_clipped(self, similarity: float, expected: int) -> None:
        """점수변환_범위안은비례하고_범위밖은0이나100으로자른다"""
        assert similarity_to_score(similarity) == expected
