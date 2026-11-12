"""상세 추천 이유의 대체 제목, 제목 검사, LLM 제목 쓰기를 확인한다."""

import pytest

from fit_ai.match.reasons import (
    NORMAL_FORMS,
    STRONG_SCORE,
    Persona,
    TitleInput,
    fallback_title,
    summary_ok,
    title_ok,
    write_titles,
)
from fit_ai.match.scoring import from_reviews

PERSONA = Persona(
    "조용한 독서가",
    "혼자 조용히 책을 읽으러 오는 손님입니다.",
    "창가 자리가 차분합니다.",
)


class TestFallbackTitle:
    """대체 제목"""

    def test_strong_and_normal_forms(self) -> None:
        """대체제목_점수가높으면업종중손꼽히게_아니면편이에요로쓴다"""
        assert (
            fallback_title("QUIET", STRONG_SCORE, "CAFE", True)
            == "카페 중 손꼽히게 조용해요"
        )
        assert fallback_title("QUIET", 0.8, "BAR", True) == "조용한 편이에요"

    def test_place_info_uses_label(self) -> None:
        """대체제목_장소정보로판정한항목은_점수와상관없이근거항목문구다"""
        assert fallback_title("PARKING", 1.0, "CAFE", False) == "주차할 수 있어요"
        assert fallback_title("FOOD_WESTERN", 1.0, "RESTAURANT", False) == "양식이에요"

    def test_every_review_code_has_normal_form(self) -> None:
        """대체제목_리뷰로판정하는모든코드에_약한형태가있다"""
        from fit_ai.match.conditions import SCORE_LABELS

        review_codes = {code for code in SCORE_LABELS if from_reviews(code)}

        assert review_codes == set(NORMAL_FORMS)


class TestChecks:
    """제목과 요약 검사"""

    @pytest.mark.parametrize(
        "title",
        [
            "찾으신 대로 조용해서 오래 머물기 좋아요",
            "창가 자리가 차분해서 책 읽기 좋아요.",
            '"커피가 진하다"는 말처럼 진한 커피를 즐길 수 있어요',
        ],
    )
    def test_ok(self, title: str) -> None:
        """제목검사_말투와길이가맞고인용이구절그대로면_통과한다"""
        assert title_ok(title, ["커피가  진하다"])

    @pytest.mark.parametrize(
        "title",
        [
            "",
            "조용한 카페입니다",  # "~요"로 끝나지 않는다
            "리뷰에서 조용하다는 말이 많아요",
            "조용하다는 언급이 많아요",
            "손님 3명 중 2명이 조용하다고 해요",
            '"아주 조용하다"는 곳이에요',  # 넘긴 구절에 없는 인용
            "가" * 50 + "요",  # 51자
        ],
    )
    def test_rejected(self, title: str) -> None:
        """제목검사_말투길이숫자근거가리킴지어낸인용이면_대체제목을쓴다"""
        assert not title_ok(title, ["커피가 진하다"])

    def test_summary(self) -> None:
        """요약검사_손님으로끝나는짧은한줄만_통과한다"""
        assert summary_ok("혼자 조용히 책 읽으러 오는 손님")
        assert not summary_ok("혼자 조용히 책 읽으러 와요")
        assert not summary_ok("주말마다 2번 오는 손님")


def fake_call(reasons):
    """GMS 대신 `reasons`를 돌려주고 받은 메시지를 남긴다. None이면 실패다."""
    seen = {}

    def call(messages, parse, **kw):
        seen.update(messages=messages, **kw)
        return None if reasons is None else parse({"reasons": reasons})

    return call, seen


class TestWriteTitles:
    """LLM 제목 쓰기"""

    def test_writes_and_checks_each(self) -> None:
        """제목쓰기_통과한제목은쓰고걸린제목만_대체제목으로바꾼다"""
        call, seen = fake_call(
            [
                {
                    "index": 0,
                    "title": "창가 자리가 차분해서 오래 머물기 좋아요",
                    "persona_related": True,
                    "persona_summary": "혼자 책 읽으러 오는 손님",
                },
                {
                    "index": 1,
                    "title": "리뷰에서 아늑하다는 말이 많아요",
                    "persona_related": False,
                    "persona_summary": None,
                },
            ]
        )
        items = [
            TitleInput(True, "QUIET", 0.95, True, persona=PERSONA),
            TitleInput(False, "COZY", 0.8, True, quotes=("아늑해요",)),
            TitleInput(True, "PARKING", 1.0, False),
            TitleInput(False, "PURPOSE_WORK", 0.75, True),  # 근거 없음
        ]

        result = write_titles("조용한 카페", "CAFE", items, call=call)

        assert [(t.title, t.persona_summary, t.written) for t in result.titles] == [
            (
                "창가 자리가 차분해서 오래 머물기 좋아요",
                "혼자 책 읽으러 오는 손님",
                True,
            ),
            ("아늑한 편이에요", None, False),
            ("주차할 수 있어요", None, False),
            ("작업하기 좋은 편이에요", None, False),
        ]
        assert result.llm_failed is False
        user = seen["messages"][1]["content"]
        # 근거가 있는 이유만 넘기고, 작성자 정보 없이 구절만 넣는다
        assert "이유 0 [요청] 조용해요" in user
        assert "이유 1 [내 취향] 아늑해요" in user
        assert "주차" not in user and "작업" not in user
        assert "- 앱 리뷰 구절: 아늑해요" in user

    @pytest.mark.parametrize(
        ("related", "summary", "shown"),
        [
            (False, "가성비를 따지는 손님", None),
            (True, "주말마다 2번 오는 손님", "조용한 독서가"),
        ],
    )
    def test_persona_summary_only_when_related(
        self, related: bool, summary: str, shown: str | None
    ) -> None:
        """제목쓰기_페르소나가특징과관계없으면_요약을보이지않고검사에걸리면이름이다"""
        call, _ = fake_call(
            [
                {
                    "index": 0,
                    "title": "조용해서 머물기 좋아요",
                    "persona_related": related,
                    "persona_summary": summary,
                }
            ]
        )

        result = write_titles(
            None,
            "CAFE",
            [TitleInput(True, "QUIET", 0.9, True, persona=PERSONA)],
            call=call,
        )

        assert result.titles[0].persona_summary == shown

    def test_llm_failure_falls_back(self) -> None:
        """제목쓰기_LLM이실패하면_모두대체제목이고관계를판단못해요약을보이지않는다"""
        call, _ = fake_call(None)

        result = write_titles(
            None,
            "BAR",
            [TitleInput(True, "QUIET", 0.8, True, persona=PERSONA)],
            call=call,
        )

        assert result.titles[0].title == "조용한 편이에요"
        assert result.titles[0].persona_summary is None
        assert result.llm_failed is True

    def test_no_evidence_skips_llm(self) -> None:
        """제목쓰기_근거있는이유가없으면_LLM을부르지않는다"""
        call, seen = fake_call([])

        result = write_titles(
            "주차되는 곳", "CAFE", [TitleInput(True, "PARKING", 1.0, False)], call=call
        )

        assert seen == {}
        assert result.titles[0].title == "주차할 수 있어요"
        assert result.llm_failed is False
