"""조건 하나를 장소가 채우는지 판정한다.

카드의 근거 항목(③)과 LLM 정렬의 등급 기준(②)이 같은 판정을 쓴다. 그래야 화면의
근거 항목과 핏 점수가 같은 근거를 말한다(docs/comparison/spec.md 4.3).
"""

from enum import StrEnum

from fit_ai.match.conditions import CONDITIONS, Layer
from fit_ai.match.place import ConditionEvidence, Place


class Verdict(StrEnum):
    """조건 하나의 판정. 값은 LLM 입력에 쓰는 말이다."""

    CONFIRMED = "확인"
    """근거가 충분하거나 장소 정보에 있다고 나온다."""
    CONTRARY = "반대"
    """아니라는 리뷰가 더 많거나 장소 정보에 없다고 나온다."""
    UNKNOWN = "모름"
    """리뷰가 없거나 적어서 판단할 수 없다."""


def is_supported(evidence: ConditionEvidence) -> bool:
    """근거가 충분한지 판정한다.

    Args:
        evidence: 조건 하나에 대한 근거

    Returns:
        긍정 리뷰가 2개 이상이고 부정 리뷰의 2배 이상이면 True
    """
    return evidence.pos >= 2 and evidence.pos >= 2 * evidence.neg


def judge(place: Place, condition_id: str) -> Verdict:
    """장소가 조건을 채우는지 판정한다. 시설은 장소 정보를 먼저 보고 모르면 리뷰로 본다.

    Args:
        place: 장소
        condition_id: 조건 id. `CONDITIONS`에 있는 id만 받는다.

    Returns:
        판정
    """
    if CONDITIONS[condition_id].layer is Layer.FACILITY:
        known = place.info.facilities.get(condition_id)
        if known is not None:
            return Verdict.CONFIRMED if known else Verdict.CONTRARY
    evidence = place.evidence(condition_id)
    if is_supported(evidence):
        return Verdict.CONFIRMED
    if evidence.neg > evidence.pos:
        return Verdict.CONTRARY
    return Verdict.UNKNOWN
