"""② 정렬. LLMRank로 후보 순서를 정하고 맞음 등급으로 핏 점수를 매긴다.

요청에 체크할 조건(카드 조건)이 있으면 등급은 코드가 체크표(확인·반대·모름)로
정하고, LLM은 같은 등급 안의 순서만 정한다. 체크할 조건이 없으면 LLM이 등급까지
매긴다. 점수는 등급 구간 안에서 순위대로 나눈다. 근처 검색이거나 LLM이 실패하면
등급(있으면)과 유사도 순서로 정렬한다(docs/comparison/spec.md 4.3).
"""

import json
import random
import time
from collections.abc import Sequence
from dataclasses import dataclass

from fit_ai import gms
from fit_ai.features import FEATURES
from fit_ai.match.candidates import Candidate
from fit_ai.match.conditions import CATEGORY_NAMES, CONDITIONS, Layer
from fit_ai.match.place import Place, Verdict
from fit_ai.match.taste import FreeText, TasteFeature

SIMILARITY_FLOOR = 0.2
"""핏 점수 0점에 대응하는 검색 유사도. 실제 분포를 보고 보정한다."""

SIMILARITY_CEIL = 0.8
"""핏 점수 100점에 대응하는 검색 유사도. 실제 분포를 보고 보정한다."""

LLM_TOP_K = 10
"""LLM이 고를 후보 수. gpt-4o-mini는 20곳을 다 쓰게 하면 10곳에서 멈추거나 3초를
넘기는 일이 잦았다(10-26 실제 GMS 확인)."""

STRENGTH = {1: "", 2: "(조금 강하게)", 3: "(강하게)"}
"""취향 가중치를 LLM 입력에 쓰는 말"""


@dataclass(frozen=True)
class Grade:
    """맞음 등급 하나와 그 등급의 점수 구간.

    Attributes:
        label: 등급 이름. LLM 입력과 출력에 쓴다.
        rule: 등급 기준. 코드가 체크표로 정할 때와 LLM 지시에 같은 기준을 쓴다.
        low: 구간의 가장 낮은 점수
        high: 구간의 가장 높은 점수. 등급의 1위가 받는다.
    """

    label: str
    rule: str
    low: int
    high: int


GRADES = (
    Grade("딱 맞음", "요청한 조건이 모두 확인된다", 85, 100),
    Grade("대체로", "반대인 조건이 없고 절반 이상이 확인된다", 65, 84),
    Grade("일부", "반대인 조건이 없고 확인된 조건이 절반이 안 된다", 40, 64),
    Grade("안 맞음", "반대인 조건이 하나라도 있다", 0, 39),
)
"""맞음 등급. 높은 등급부터다. 이름, 기준, 구간 모두 임시 값이다."""

_GRADE_RULES = "\n".join(f"- {grade.label}: {grade.rule}." for grade in GRADES)

ORDER_PROMPT = f"""\
너는 장소 추천 서비스의 정렬기다. 후보마다 요청 조건을 리뷰로 판정한 등급이 \
정해져 있다. 등급은 바꾸지 않는다. 같은 등급 안에서 누가 더 잘 맞는지 순서를 정해 \
잘 맞는 장소를 최대 {LLM_TOP_K}곳 고른다.
판단 방법:
- 등급이 높은 장소를 먼저 놓는다({" > ".join(grade.label for grade in GRADES)}).
- 같은 등급 안에서는 먼저 "요청 조건"에 없는 요청 내용(음식 종류, 메뉴 등)이 \
장소 설명과 "리뷰"에 맞는지 보고, 그다음 취향이 맞는지 본다. \
"리뷰"는 특징마다 그렇다는 리뷰 수/아니라는 리뷰 수다.
- 설명과 리뷰에 없는 내용은 짐작하지 않는다.
- 잘 맞는 곳이 없어 보여도 그중 나은 순서로 고른다. 한 장소는 한 번만 넣는다.
- 아래 형식의 JSON만 출력한다.
{{"ranking": [{{"id": 후보 번호}}]}}"""
"""체크할 조건이 있을 때의 LLMRank 시스템 지시. LLM은 순서만 정한다."""

GRADE_PROMPT = f"""\
너는 장소 추천 서비스의 정렬기다. 사용자의 요청과 취향을 보고 후보 중 \
잘 맞는 장소를 최대 {LLM_TOP_K}곳 골라 잘 맞는 순서로 놓고, 장소마다 맞음 등급을 매긴다.
요청한 조건마다 장소 설명과 "리뷰"로 확인되는지, 반대인지, 모르는지 보고 \
아래 기준으로 등급을 정한다.
{_GRADE_RULES}
판단 방법:
- "리뷰"는 특징마다 그렇다는 리뷰 수/아니라는 리뷰 수다. \
설명과 리뷰에 없으면 모름이다. 짐작하지 않는다.
- 취향은 등급에 넣지 않는다. 같은 등급 안에서 순서를 정할 때만 쓴다.
- 등급이 높은 장소를 먼저 놓는다. 한 장소는 한 번만 넣는다.
- 아래 형식의 JSON만 출력한다.
{{"ranking": [{{"id": 후보 번호, "fit": "{GRADES[0].label}"}}]}}"""
"""체크할 조건이 없을 때의 LLMRank 시스템 지시. LLM이 등급까지 매긴다."""


@dataclass(frozen=True)
class Ranked:
    """정렬된 후보 하나.

    Attributes:
        candidate: 후보
        score: 핏 점수. 0~100 정수다.
    """

    candidate: Candidate
    score: int


@dataclass(frozen=True)
class LlmRanking:
    """LLM 정렬 결과.

    Attributes:
        ranked: 모든 후보. 점수 내림차순이다.
        raw: 검사를 통과한 LLM 출력(JSON 문자열). 후보 번호와 등급뿐이라 로그에 남긴다.
        seconds: GMS 호출에 걸린 시간(초). 다시 부른 시간까지 들어간다.
    """

    ranked: list[Ranked]
    raw: str | None
    seconds: float | None


class RankingError(Exception):
    """LLM 정렬이 실패했다. 부르는 쪽은 `rank_by_similarity`로 넘어간다.

    Attributes:
        raw: 검사에 걸린 LLM 출력. 호출 자체가 실패했으면 None이다.
        seconds: GMS 호출에 걸린 시간(초)
    """

    def __init__(
        self, message: str, raw: str | None = None, seconds: float | None = None
    ) -> None:
        super().__init__(message)
        self.raw = raw
        self.seconds = seconds


def judged_codes(request_codes: Sequence[str]) -> list[str]:
    """요청 코드 중 체크표에 올릴 코드. 카드 조건 목록에 있는 코드만 한 번씩 남긴다.

    Args:
        request_codes: 요청 해석이 낸 조건 코드

    Returns:
        체크할 코드. 처음 나온 순서다.
    """
    return [code for code in dict.fromkeys(request_codes) if code in CONDITIONS]


def grade_by_rules(place: Place, codes: Sequence[str]) -> int:
    """체크표로 등급을 정한다. 기준은 `GRADES`의 `rule`과 같다.

    Args:
        place: 장소
        codes: 체크할 코드(`judged_codes`의 결과). 비어 있으면 안 된다.

    Returns:
        `GRADES`의 번호. 0이 딱 맞음이다.
    """
    verdicts = [place.judge(code) for code in codes]
    if Verdict.CONTRARY in verdicts:
        return 3
    confirmed = verdicts.count(Verdict.CONFIRMED)
    if confirmed == len(verdicts):
        return 0
    return 1 if confirmed * 2 >= len(verdicts) else 2


def rank_with_llm(
    request_text: str,
    request_codes: Sequence[str],
    candidates: Sequence[Candidate],
    features: Sequence[TasteFeature],
    free_texts: Sequence[FreeText],
    rng: random.Random | None = None,
    timeout: float = 5.0,
) -> LlmRanking:
    """LLM 한 번으로 후보 순서를 정하고 맞음 등급으로 핏 점수를 매긴다.

    체크할 조건이 있으면 등급은 코드가 정하고 LLM은 순서만 정한다. LLM이 고르지
    않은 후보도 등급을 받아, 같은 등급 안에서 고른 후보 뒤에 유사도 순서로 붙는다.
    체크할 조건이 없으면 LLM이 고른 후보에 등급을 매기고, 고르지 않은 후보는 그보다
    낮은 점수로 유사도 순서로 붙는다. 후보는 섞어서 1부터 번호를 붙여 넣는다.
    유사도 순서를 그대로 넣으면 LLM이 앞쪽을 위로 올리는 위치 편향이 있다. GMS는 공유
    모듈 `fit_ai.gms`로 부른다. 호출이 실패하거나 JSON이 아니면 공유 모듈이 한 번 더
    부르고, 출력이 형식에 맞지 않으면 다시 부르지 않는다.

    Args:
        request_text: 요청문. 후속 조건이면 이전 요청과 합친 문장이다.
        request_codes: 요청 조건 코드
        candidates: ① 후보 뽑기 결과. 유사도 내림차순이다.
        features: ⓪ 취향 고르기로 남은 취향
        free_texts: 취향 프로필의 취향 문장. 벡터가 있는 문장만 쓴다.
        rng: 후보를 섞는 난수기. 없으면 새로 만든다.
        timeout: GMS 한 번 부를 때 기다리는 시간(초)

    Returns:
        LLM 정렬 결과

    Raises:
        RankingError: GMS가 꺼져 있거나, 두 번 모두 호출이 실패하거나, 출력이 형식에 맞지
            않을 때
    """
    if not candidates:
        return LlmRanking([], None, None)
    order = list(range(len(candidates)))
    (rng or random.Random()).shuffle(order)
    shuffled = [candidates[i] for i in order]
    codes = judged_codes(request_codes)
    grades = [grade_by_rules(c.place, codes) for c in candidates] if codes else None
    user = _user_prompt(
        request_text,
        codes,
        shuffled,
        [grades[i] for i in order] if grades else None,
        features,
        free_texts,
    )
    start = time.perf_counter()
    data = gms.call_json(
        [
            # GMS 안내 예시처럼 지시는 developer 역할로 보낸다.
            {"role": "developer", "content": ORDER_PROMPT if grades else GRADE_PROMPT},
            {"role": "user", "content": user},
        ],
        # 출력 검사는 받은 뒤 한 번만 한다. 공유 모듈에 넘기면 검사에 걸릴 때도 다시 부른다.
        lambda data: data,
        timeout=timeout,
    )
    seconds = time.perf_counter() - start
    if data is None:
        raise RankingError("GMS가 꺼져 있거나 호출이 실패했다", seconds=seconds)
    raw = json.dumps(data, ensure_ascii=False)
    try:
        picked = _parse(data, len(shuffled), with_grades=grades is None)
    except (ValueError, TypeError) as e:
        raise RankingError(str(e), raw=raw, seconds=seconds) from e

    # 등급을 코드가 정했으면 LLM이 아무것도 고르지 않아도 등급과 유사도로 정렬한다.
    if grades:
        ranked = _by_grade(
            candidates, grades, [order[number - 1] for number, _ in picked]
        )
        return LlmRanking(ranked, raw, seconds)

    # 정렬은 안정 정렬이라 같은 등급 안에서는 LLM 순서가 남는다.
    picked.sort(key=lambda item: item[1])
    scores = _grade_scores([grade for _, grade in picked])
    ranked = [
        Ranked(candidates[order[number - 1]], score)
        for (number, _), score in zip(picked, scores, strict=True)
    ]
    chosen = {order[number - 1] for number, _ in picked}
    previous = ranked[-1].score
    for i, candidate in enumerate(candidates):
        if i in chosen:
            continue
        # LLM이 고르지 않은 후보는 고른 후보보다 낮게, 유사도 순서대로 붙인다.
        previous = max(0, min(similarity_to_score(candidate.similarity), previous - 1))
        ranked.append(Ranked(candidate, previous))
    return LlmRanking(ranked, raw, seconds)


def rank_by_similarity(
    candidates: Sequence[Candidate], request_codes: Sequence[str] = ()
) -> list[Ranked]:
    """LLM 없이 정렬한다. 근처 검색과 LLM이 실패했을 때 쓴다.

    체크할 조건이 있으면 코드가 정한 등급 순서로 놓고, 같은 등급 안에서는 유사도
    순서로 점수 구간을 나눈다. LLM이 있을 때와 같은 장소는 같은 등급을 받는다.
    체크할 조건이 없으면 유사도를 점수로 바꾼다.

    Args:
        candidates: ① 후보 뽑기 결과. 유사도 내림차순이다.
        request_codes: 요청 조건 코드

    Returns:
        정렬 결과. 점수 내림차순이다.
    """
    codes = judged_codes(request_codes)
    if codes:
        return _by_grade(
            candidates, [grade_by_rules(c.place, codes) for c in candidates], []
        )
    return [
        Ranked(candidate, similarity_to_score(candidate.similarity))
        for candidate in candidates
    ]


def similarity_to_score(
    similarity: float,
    floor: float = SIMILARITY_FLOOR,
    ceil: float = SIMILARITY_CEIL,
) -> int:
    """검색 유사도를 핏 점수로 바꾼다.

    Args:
        similarity: 요청과 장소 요약의 유사도
        floor: 0점에 대응하는 유사도. 이보다 낮으면 0점이다.
        ceil: 100점에 대응하는 유사도. 이보다 높으면 100점이다.

    Returns:
        0~100 정수 점수
    """
    ratio = (similarity - floor) / (ceil - floor)
    return round(min(max(ratio, 0.0), 1.0) * 100)


def _by_grade(
    candidates: Sequence[Candidate], grades: Sequence[int], preferred: Sequence[int]
) -> list[Ranked]:
    """등급 순서로 놓고, 같은 등급 안에서는 LLM이 고른 순서, 그다음 유사도 순서다.

    Args:
        candidates: 후보. 유사도 내림차순이다.
        grades: 후보마다의 등급 번호
        preferred: LLM이 고른 후보의 번호(`candidates` 기준). 고른 순서다.

    Returns:
        정렬 결과
    """
    position = {index: rank for rank, index in enumerate(preferred)}
    indices = sorted(
        range(len(candidates)),
        key=lambda i: (grades[i], position.get(i, len(preferred)), i),
    )
    scores = _grade_scores([grades[i] for i in indices])
    return [
        Ranked(candidates[i], score) for i, score in zip(indices, scores, strict=True)
    ]


def _grade_scores(grades: Sequence[int]) -> list[int]:
    """등급마다 구간 안에서 순위대로 점수를 나눈다. 등급의 1위가 구간 최고점이다.

    Args:
        grades: 정렬된 후보의 등급 번호. 높은 등급부터다.

    Returns:
        후보마다의 점수. `grades`와 순서가 같다.
    """
    scores = []
    for i, grade in enumerate(grades):
        band = GRADES[grade]
        step = (band.high - band.low) / grades.count(grade)
        scores.append(band.high - round((i - grades.index(grade)) * step))
    return scores


def _user_prompt(
    request_text: str,
    request_codes: Sequence[str],
    candidates: Sequence[Candidate],
    grades: Sequence[int] | None,
    features: Sequence[TasteFeature],
    free_texts: Sequence[FreeText],
) -> str:
    tastes = [
        f"- {_like_word(f.like)}: {FEATURES[f.code].phrase}{STRENGTH.get(f.weight, '')}"
        for f in features
        # 코드표에 없는 코드는 취향 spec이 버리기로 한 것이다.
        if f.code in FEATURES
    ] + [
        f"- {_like_word(t.like)}: {t.text}"
        for t in free_texts
        if t.usable and t.like is not None
    ]
    places = [
        f"[{number}] {CATEGORY_NAMES.get(c.place.info.category_group, '')} | "
        f"{c.place.summary}"
        f"{f' | 등급: {GRADES[grades[number - 1]].label}' if grades else ''}"
        f"{_request_text(c.place, request_codes)}"
        f"{_evidence_text(c.place, request_codes)}"
        for number, c in enumerate(candidates, start=1)
    ]
    return "\n".join(
        [
            f"요청: {request_text}",
            "",
            "취향:",
            *(tastes or ["- 없음"]),
            "",
            "후보:",
            *places,
        ]
    )


def _request_text(place: Place, request_codes: Sequence[str]) -> str:
    """후보 줄에 붙일 체크표(요청 조건 판정). 판정은 카드의 근거 항목과 같다.

    요청 조건이 없으면 빈 문자열이다.
    """
    if not request_codes:
        return ""
    return " | 요청 조건: " + ", ".join(
        f"{CONDITIONS[code].label} {_verdict_text(place, code)}"
        for code in request_codes
    )


def _verdict_text(place: Place, code: str) -> str:
    verdict = place.judge(code)
    if (
        CONDITIONS[code].layer is Layer.FACILITY
        and place.info.facilities.get(code) is not None
    ):
        return f"{verdict}(장소 정보)"
    evidence = place.evidence(code)
    if evidence.pos or evidence.neg:
        return f"{verdict}({evidence.pos}/{evidence.neg})"
    return str(verdict)


def _evidence_text(place: Place, request_codes: Sequence[str]) -> str:
    """후보 줄 끝에 붙일 리뷰 근거. 그렇다는 리뷰가 많은 특징부터 쓴다.

    40 요약 문장에는 리뷰 내용이 없어서 이 근거가 없으면 LLM이 장소의 분위기나
    목적을 알 수 없다(docs/comparison/spec.md 4.3). 문구는 취향과 같은 `phrase`라
    LLM이 취향과 근거를 맞춰 보기 쉽다. 요청 조건으로 이미 넣은 특징은 빼고, 남는
    근거가 없으면 빈 문자열이다.
    """
    items = sorted(
        (
            (code, evidence)
            for code, evidence in place.conditions.items()
            if code in FEATURES
            and code not in request_codes
            and (evidence.pos or evidence.neg)
        ),
        key=lambda item: -item[1].pos,
    )
    if not items:
        return ""
    return " | 리뷰: " + ", ".join(
        f"{FEATURES[code].phrase} {evidence.pos}/{evidence.neg}"
        for code, evidence in items
    )


def _like_word(like: bool) -> str:
    return "좋아함" if like else "싫어함"


def _parse(data: object, size: int, with_grades: bool) -> list[tuple[int, int | None]]:
    """LLM 출력(JSON을 읽은 값)을 (후보 번호, 등급 번호) 목록으로 바꾼다.

    하나라도 어긋나면 ValueError나 TypeError다. `with_grades`면 등급(`fit`)을 읽고,
    점수를 매길 수 없으니 1곳 이상 골라야 한다. 아니면 등급은 None으로 두고 빈 목록도
    받는다.
    """
    items = data.get("ranking") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise TypeError("ranking 목록이 없다")
    if not items and with_grades:
        raise ValueError("고른 후보가 없다")

    labels = {grade.label.replace(" ", ""): i for i, grade in enumerate(GRADES)}
    result: list[tuple[int, int | None]] = []
    for item in items:
        number = item.get("id") if isinstance(item, dict) else None
        if not _is_int(number) or not 1 <= number <= size:
            raise ValueError(f"후보 밖 번호다: {number}")
        grade = None
        if with_grades:
            fit = item.get("fit")
            grade = labels.get(fit.replace(" ", "")) if isinstance(fit, str) else None
            if grade is None:
                raise ValueError(f"모르는 등급이다: {fit}")
        result.append((number, grade))

    numbers = [number for number, _ in result]
    if len(set(numbers)) != len(numbers):
        raise ValueError("같은 후보가 두 번 나왔다")
    return result


def _is_int(value: object) -> bool:
    # bool은 int의 하위 타입이라 따로 막는다.
    return isinstance(value, int) and not isinstance(value, bool)
