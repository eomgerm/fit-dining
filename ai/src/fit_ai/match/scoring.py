"""② 점수. 요청 조각과 취향마다 조건 점수를 내고 핏 점수로 합쳐 순서를 정한다.

조건 점수는 장소가 조각 하나에 얼마나 맞는지(0~1)다. 조각마다 가장 직접적인 근거를 쓴다.

- 리뷰로 판정하는 코드("조용한"): 그렇다는 리뷰의 비율이 업종 범위 안에서 몇 번째인지
  (백분위)다. 범위 안 장소들은 비율을 업종 평균 쪽으로 당긴 값(보정 비율)으로 줄 세우고,
  장소 하나의 위치는 그 장소의 진짜 비율이 될 수 있는 값마다의 위치를 평균 낸다. 리뷰가
  많으면 보정 비율의 위치와 거의 같고, 적을수록 가운데(0.5)에 가까워진다.
- 시설("와이파이"): 장소 정보가 있음이면 1, 없음이면 0, 모르면 업종 범위에서 있는 곳의 비율이다.
- 음식 종류("양식"): 장소의 음식 종류가 같으면 1, 다르면 0, 모르면 업종 범위에서 그 종류의
  비율이다.

요청 점수는 요청 조건 점수의 기하평균(모두 원함), 취향 점수는 취향 세기로 낸 가중 평균이다.
싫어하는 취향은 1 − 조건 점수로 넣는다. 핏 점수는 요청 0.7, 취향 0.3으로 더한다. 점수를
먼저 내고 그 점수로 순서를 정한다. 비교 대상은 그 검색의 후보가 아니라 업종 범위 안의 장소
전체라서, 같은 장소와 같은 요청이면 늘 같은 점수다(docs/comparison/spec.md 4.3).
"""

import math
from collections.abc import Callable, Collection, Sequence
from dataclasses import dataclass

import numpy as np

from fit_ai.match.candidates import Candidate
from fit_ai.match.conditions import CATEGORY_NAMES, CONDITIONS, SCORE_LABELS, Layer
from fit_ai.match.interpretation import FOOD_TYPES
from fit_ai.match.place import Place
from fit_ai.match.taste_select import TasteFeature

REQUEST_WEIGHT = 0.7
"""핏 점수에서 요청 점수의 비중. 나머지는 취향 점수다. 요청이 취향보다 앞선다(PRD AC-28).
시작값이고 평가 세트로 다시 정한다(2026-11-03)."""

MIN_CONDITION_SCORE = 0.01
"""기하평균에 넣는 조건 점수의 하한. 0을 그대로 넣으면 다른 조건과 상관없이 요청 점수가 0이
되어, 안 맞는 곳끼리 순서를 가르지 못한다."""

PRIOR_REVIEWS_RANGE = (0.01, 10_000.0)
"""가상 리뷰 수를 찾는 범위. 장소끼리의 차이가 리뷰 수에 따른 흔들림보다 작으면 데이터에 가장
잘 맞는 값이 끝없이 커지므로 위를 막는다."""

UNKNOWN = 0.5
"""판단할 근거가 전혀 없을 때의 조건 점수(가운데)"""

GRID_POINTS = 2001
"""장소의 진짜 비율이 될 수 있는 값을 나눠 보는 점의 수. 계산 정밀도라 결과에는 거의 영향이
없다."""


@dataclass(frozen=True)
class ItemScore:
    """조각 하나의 조건 점수.

    Attributes:
        code: 조건 코드
        request: 요청 조각이면 True, 취향이면 False다.
        like: 좋아함이면 True, 싫어함이면 False다. 요청 조각은 True다.
        weight: 취향 세기(0보다 큰 수). 요청 조각은 1이다.
        value: 조건 점수(0~1). 싫어하는 취향도 뒤집기 전 값이다.
        evidence_count: 근거가 된 리뷰 수. 장소 정보로 판정했으면 0이다.
        from_reviews: 리뷰로 판정했으면 True, 장소 정보로 판정했으면 False다.
    """

    code: str
    request: bool
    like: bool
    weight: float
    value: float
    evidence_count: int
    from_reviews: bool


@dataclass(frozen=True)
class PlaceScore:
    """후보 하나의 핏 점수.

    Attributes:
        candidate: 후보
        score: 핏 점수(0~100 정수). 판정할 요청 조각도 취향도 없으면 None이다.
        items: 조건 점수. 요청 조각, 그다음 취향 순서다.
    """

    candidate: Candidate
    score: int | None
    items: tuple[ItemScore, ...]


@dataclass(frozen=True)
class _ReviewStats:
    """업종 범위 하나와 코드 하나의 리뷰 근거 기준.

    Attributes:
        prior_mentions: 가상 리뷰 중 그렇다는 리뷰 수(a)
        prior_reviews: 가상 리뷰 수(a + b)
        rates: 범위 안 장소들의 보정 비율. 오름차순이다.
    """

    prior_mentions: float
    prior_reviews: float
    rates: np.ndarray

    def rate(self, mentions: int, reviews: int) -> float:
        """보정 비율. 업종 평균대로 쓰인 가상 리뷰를 더한 언급 비율이다."""
        return (mentions + self.prior_mentions) / (reviews + self.prior_reviews)

    def position(self, mentions: int, reviews: int) -> float:
        """장소 하나가 범위 안에서 몇 번째인지(0~1).

        리뷰 `reviews`건 중 `mentions`건이 그렇다고 한 장소의 진짜 비율은 가상 리뷰를 더한
        베타 분포(사후분포)로 본다. 그 분포에서 진짜 비율이 범위 안 장소들의 보정 비율보다
        높을 확률을 장소마다 구해 평균 낸다. 리뷰가 많으면 분포가 좁아 보정 비율의 위치와
        거의 같고, 적으면 분포가 넓어 가운데 쪽으로 간다.
        """
        if not len(self.rates):
            return UNKNOWN
        alpha = self.prior_mentions + mentions
        beta = self.prior_reviews - self.prior_mentions + reviews - mentions
        return float(np.mean(1.0 - _beta_cdf(alpha, beta, self.rates)))


class Baseline:
    """업종 범위마다 조건 점수의 기준. 장소 저장소의 장소 전체로 만든다.

    범위와 코드마다 기준은 처음 쓸 때 한 번 계산해 둔다.
    """

    def __init__(self, places: Sequence[Place]) -> None:
        """기준을 만들 장소를 받아 둔다.

        Args:
            places: 장소 저장소의 장소 전체(`PlaceStore.places`)
        """
        self._places = tuple(places)
        self._reviews: dict[tuple[frozenset[str], str], _ReviewStats | None] = {}
        self._shares: dict[tuple[frozenset[str], str], float] = {}

    def value(self, place: Place, code: str, scope: frozenset[str]) -> float:
        """장소 하나의 조건 점수.

        Args:
            place: 장소
            code: 조건 코드. `SCORE_LABELS`에 있는 코드만 받는다.
            scope: 업종 범위(`scope_of`의 결과)

        Returns:
            조건 점수(0~1)
        """
        if code in FOOD_TYPES:
            if place.info.food_type is not None:
                return float(place.info.food_type == code)
            return self._share(scope, code, _food_type_share)
        if not from_reviews(code):
            known = place.info.facilities.get(code)
            if known is not None:
                return float(known)
            return self._share(scope, code, _facility_share)
        stats = self._review_stats(scope, code)
        if stats is None or not place.info.review_count:
            return UNKNOWN
        return stats.position(place.evidence(code).pos, place.info.review_count)

    def _review_stats(self, scope: frozenset[str], code: str) -> _ReviewStats | None:
        key = (scope, code)
        if key not in self._reviews:
            self._reviews[key] = _fit_reviews(
                [p for p in self._places if p.info.category_group in scope], code
            )
        return self._reviews[key]

    def _share(
        self,
        scope: frozenset[str],
        code: str,
        share: Callable[[Sequence[Place], str], float],
    ) -> float:
        key = (scope, code)
        if key not in self._shares:
            self._shares[key] = share(
                [p for p in self._places if p.info.category_group in scope], code
            )
        return self._shares[key]


_last_baseline: tuple[tuple[Place, ...], Baseline] | None = None
"""마지막으로 만든 기준과 그 장소 전체. 저장소가 같은 장소 전체를 다시 주면 다시 쓴다."""


def baseline_for(places: tuple[Place, ...]) -> Baseline:
    """장소 전체의 기준. 지난번과 같은 장소 전체(같은 객체)면 만들어 둔 기준을 다시 쓴다.

    가상 리뷰 수 찾기는 범위와 코드마다 장소 수에 비례해 시간이 든다. 저장소는 장소 데이터가
    바뀌기 전까지 같은 장소 전체를 주므로(`PlaceStore.places`) 검색마다 다시 계산하지 않는다.

    Args:
        places: 장소 저장소의 장소 전체

    Returns:
        기준
    """
    global _last_baseline
    last = _last_baseline
    if last is not None and last[0] is places:
        return last[1]
    baseline = Baseline(places)
    _last_baseline = (places, baseline)
    return baseline


def scope_of(category_group: str | None, excluded: Collection[str]) -> frozenset[str]:
    """업종 범위. 요청한 업종이 있으면 그 업종, 없으면 빼 달라는 업종을 뺀 전체다.

    업종마다 언급 비율의 평균이 크게 달라서(작업 언급: 카페 6.8%, 식당 0.5%) 업종을
    말하지 않은 요청은 업종을 섞어 견준다. 업종별로만 견주면 "작업하기 좋은 곳"에서
    식당 1등이 카페 1등을 이긴다(2026-11-03 샘플 62곳).

    Args:
        category_group: 요청한 업종. 없으면 None이다.
        excluded: 빼 달라는 업종

    Returns:
        업종 코드 집합
    """
    if category_group is not None:
        return frozenset({category_group})
    return frozenset(CATEGORY_NAMES) - set(excluded)


def score_places(
    candidates: Sequence[Candidate],
    request_codes: Sequence[str],
    tastes: Sequence[TasteFeature],
    scope: frozenset[str],
    baseline: Baseline,
) -> list[PlaceScore]:
    """후보마다 핏 점수를 내고 점수 내림차순으로 놓는다.

    점수가 같거나 점수가 없으면 후보 순서(유사도 내림차순)를 그대로 둔다.

    Args:
        candidates: 후보. 유사도 내림차순이다.
        request_codes: 요청 조건 코드. `SCORE_LABELS`에 없는 코드는 판정하지 않는다.
        tastes: ⓪ 취향 고르기로 남은 취향. 좋아함과 싫어함 모두다. 요청과 같은 코드는
            뺀다.
        scope: 업종 범위
        baseline: 조건 점수 기준

    Returns:
        핏 점수. 점수 내림차순이다.
    """
    codes = [code for code in dict.fromkeys(request_codes) if code in SCORE_LABELS]
    # 요청과 같은 코드인 취향은 같은 근거를 두 번 세지 않게 뺀다. 카드도 요청으로 한 번만 보인다.
    tastes = [t for t in tastes if t.code in SCORE_LABELS and t.code not in codes]
    scored = []
    for candidate in candidates:
        place = candidate.place
        items = tuple(
            _item(place, code, True, True, 1, scope, baseline) for code in codes
        ) + tuple(
            _item(place, t.code, False, t.like, t.weight, scope, baseline)
            for t in tastes
        )
        fit = fit_score(items)
        scored.append(
            PlaceScore(candidate, None if fit is None else round(100 * fit), items)
        )
    # 정렬은 안정적이라 점수가 같으면 후보 순서다. 점수가 없는 후보는 뒤로 간다.
    return sorted(scored, key=lambda s: (s.score is None, -(s.score or 0)))


def fit_score(items: Sequence[ItemScore]) -> float | None:
    """조건 점수를 핏 점수(0~1)로 합친다.

    요청 점수는 요청 조건 점수의 기하평균이다. 요청은 모두 원하는 것이라, 하나가 확실히 안
    맞으면 크게 깎이고 근거가 약하면 조금 깎인다. 취향 점수는 취향 세기로 낸 가중 평균이고,
    싫어하는 취향은 1 − 조건 점수다. 둘 다 있으면 요청 `REQUEST_WEIGHT`, 취향 나머지로
    더하고, 한쪽만 있으면 그쪽만 쓴다.

    Args:
        items: 조건 점수

    Returns:
        핏 점수. 요청 조각도 취향도 없으면 None이다.
    """
    request = [max(i.value, MIN_CONDITION_SCORE) for i in items if i.request]
    taste = [
        (i.weight, i.value if i.like else 1 - i.value) for i in items if not i.request
    ]
    request_score = (
        math.exp(sum(map(math.log, request)) / len(request)) if request else None
    )
    taste_score = (
        sum(w * v for w, v in taste) / sum(w for w, _ in taste) if taste else None
    )
    if request_score is None:
        return taste_score
    if taste_score is None:
        return request_score
    return REQUEST_WEIGHT * request_score + (1 - REQUEST_WEIGHT) * taste_score


def from_reviews(code: str) -> bool:
    """리뷰로 판정하는 코드인지. 음식 종류와 시설은 장소 정보로 판정한다."""
    return code not in FOOD_TYPES and not (
        code in CONDITIONS and CONDITIONS[code].layer is Layer.FACILITY
    )


def _item(
    place: Place,
    code: str,
    request: bool,
    like: bool,
    weight: float,
    scope: frozenset[str],
    baseline: Baseline,
) -> ItemScore:
    reviews = from_reviews(code)
    return ItemScore(
        code=code,
        request=request,
        like=like,
        weight=weight,
        value=baseline.value(place, code, scope),
        evidence_count=place.evidence(code).pos if reviews else 0,
        from_reviews=reviews,
    )


def _fit_reviews(places: Sequence[Place], code: str) -> _ReviewStats | None:
    """범위 안 장소들의 리뷰 근거로 가상 리뷰 수를 정하고 보정 비율을 줄 세운다.

    장소마다 진짜 언급 비율이 베타 분포를 따른다고 보고(베타-이항 모형), 평균은 범위 전체의
    언급 비율로 두고 가상 리뷰 수는 데이터에 가장 잘 맞는 값(최대우도)으로 정한다. 장소끼리
    차이가 작을수록 가상 리뷰가 많아져 평균 쪽으로 세게 당긴다(경험적 베이즈).

    Returns:
        기준. 범위 안 어느 장소도 그 코드를 말하지 않았으면 판단할 수 없어 None이다.
    """
    counts = [
        (p.evidence(code).pos, p.info.review_count)
        for p in places
        if p.info.review_count
    ]
    reviews = sum(n for _, n in counts)
    mean = sum(k for k, _ in counts) / reviews if reviews else 0.0
    if not 0 < mean < 1:
        return None
    prior_reviews = _most_likely_prior(counts, mean)
    stats = _ReviewStats(mean * prior_reviews, prior_reviews, np.empty(0))
    rates = np.sort([stats.rate(k, n) for k, n in counts])
    return _ReviewStats(stats.prior_mentions, stats.prior_reviews, rates)


def _most_likely_prior(counts: Sequence[tuple[int, int]], mean: float) -> float:
    """언급 수가 가장 잘 나오는 가상 리뷰 수. `PRIOR_REVIEWS_RANGE` 안에서 찾는다.

    가상 리뷰 수의 로그를 고르게 나눠 가장 나은 칸을 찾고, 그 이웃 사이를 황금분할로 좁힌다.
    """

    def likelihood(log_total: float) -> float:
        total = math.exp(log_total)
        a, b = mean * total, (1 - mean) * total
        per_place = math.lgamma(total) - math.lgamma(a) - math.lgamma(b)
        return (
            sum(
                math.lgamma(k + a) + math.lgamma(n - k + b) - math.lgamma(n + total)
                for k, n in counts
            )
            + len(counts) * per_place
        )

    low, high = map(math.log, PRIOR_REVIEWS_RANGE)
    steps = np.linspace(low, high, 41)
    best = int(np.argmax([likelihood(x) for x in steps]))
    left, right = steps[max(best - 1, 0)], steps[min(best + 1, len(steps) - 1)]
    ratio = (math.sqrt(5) - 1) / 2
    for _ in range(40):
        inner_left = right - ratio * (right - left)
        inner_right = left + ratio * (right - left)
        if likelihood(inner_left) < likelihood(inner_right):
            left = inner_left
        else:
            right = inner_right
    return math.exp((left + right) / 2)


def _beta_cdf(alpha: float, beta: float, points: np.ndarray) -> np.ndarray:
    """베타 분포에서 값이 각 점 이하일 확률.

    서버 이미지에 scipy가 없어 확률 밀도를 로그 눈금으로 나눠 직접 더한다. 언급이 드문
    코드는 분포가 0 근처에 몰려서, 고른 눈금으로는 0 근처의 확률을 제대로 못 센다. 로그
    눈금은 평균보다 아래로 확률이 무시할 만큼 작아지는 곳(e^-40)까지 본다.
    """
    mean = alpha / (alpha + beta)
    sd = math.sqrt(alpha * beta / ((alpha + beta) ** 2 * (alpha + beta + 1)))
    high = math.log(min(mean + 10 * sd, 1 - 1e-12))
    low = max(math.log(mean) - 40 / min(alpha, 1.0) - 1, -700.0)
    if mean - 10 * sd > 0:
        low = max(low, math.log(mean - 10 * sd))
    grid = np.linspace(low, high, GRID_POINTS)
    # 값 x = e^u로 바꾸면 밀도는 x^alpha (1 - x)^(beta - 1)에 비례하고 0 근처에서도 유한하다.
    log_density = alpha * grid + (beta - 1) * np.log1p(-np.exp(grid))
    density = np.exp(log_density - log_density.max())
    steps = (density[1:] + density[:-1]) / 2 * np.diff(grid)
    cdf = np.concatenate(([0.0], np.cumsum(steps)))
    with np.errstate(divide="ignore"):
        log_points = np.log(points)
    return np.interp(log_points, grid, cdf / cdf[-1], left=0.0, right=1.0)


def _facility_share(places: Sequence[Place], code: str) -> float:
    """범위 안에서 시설이 있다고 확인된 장소의 비율. 장소가 없으면 가운데다."""
    if not places:
        return UNKNOWN
    return sum(p.info.facilities.get(code) is True for p in places) / len(places)


def _food_type_share(places: Sequence[Place], code: str) -> float:
    """범위 안에서 음식 종류를 아는 장소 중 그 종류의 비율. 아는 곳이 없으면 가운데다."""
    known = [p.info.food_type for p in places if p.info.food_type is not None]
    if not known:
        return UNKNOWN
    return known.count(code) / len(known)
