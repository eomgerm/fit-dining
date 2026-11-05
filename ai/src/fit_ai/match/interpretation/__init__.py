"""요청 해석. 요청문을 장소 저장소가 장소를 거를 값과 정렬에 넘길 조건으로 바꾼다.

공유 모듈 `fit_ai.gms`로 GMS를 한 번 부른다. 모델은 공유 모듈의 기본 모델이 아니라 `MODEL`이다. 호출이 실패하거나 JSON이 아니면 공유 모듈이
한 번 더 부른다. 그래도 실패하거나 출력이 형식에 맞지 않으면 다시 부르지 않고 낱말
규칙으로 해석한다(인프라 설계 11.2). 후속 조건이면 LLM은 이전 조건에 새 요청을
반영한 조건 전체를 내고(2026-11-05), 규칙 해석은 이번 요청만 해석해 이전 조건과 분류별 규칙으로
합친다(검색 spec D-50, docs/comparison/conditions-v3.md 4장).
정리는 docs/comparison/spec.md 4.1에 있다.

모듈은 하는 일별로 나눴다.

- `segments`: 분류별 조각 타입
- `codes`: 분류별 조건과 공유 코드표 잇기(점수용 코드)
- `request`: 조건(`Conditions`)과 해석 결과, 여러 모듈이 같이 쓰는 값과 함수
- `merge`: 이전 조건과 이번 요청 합치기
- `rules`: 규칙 해석(LLM이 실패했을 때)
- `llm`: 프롬프트와 LLM 출력 읽기

의존은 segments ← codes ← request ← merge ← rules ← llm ← 이 파일 한 방향이다. 밖에서는 이 파일이
내보내는 이름(`__all__`)을 쓴다.
"""

import time

import httpx

from fit_ai import gms
from fit_ai.match.interpretation.codes import FOOD_CODES, FOOD_TYPES, GROUP_SIZE
from fit_ai.match.interpretation.llm import (
    DEFAULT_CHANGE_SUMMARY,
    MAX_CHANGE_SUMMARY_LENGTH,
    SYSTEM_PROMPT,
    _parse,
    _user_prompt,
)
from fit_ai.match.interpretation.request import (
    CODE_PHRASES,
    MAX_CODES,
    MAX_TEXT_LENGTH,
    MAX_WALK_MINUTES,
    Conditions,
    Interpretation,
    station_code,
)
from fit_ai.match.interpretation.rules import interpret_by_rules, rule_turn

MODEL = "gpt-6-luna"
"""해석 모델. gpt-4o-mini보다 지시를 잘 따라 규칙 보정 없이 해석한다(2026-11-05 평가 질의 80개와
새 질의 21개를 4번씩: 평가 317/320, 새 질의 84/84. gpt-4o-mini는 규칙 없이 평가 125/160)."""

REASONING_EFFORT = "none"
"""새 검색의 추론 강도. 추론하지 않으면 응답 중앙값 1.7초로 gpt-4o-mini(1.55초)와 비슷하고
정확도는 추론 `low`(2.4초)와 비슷했다(2026-11-05). 이 모델은 temperature 0을 받지 않아
temperature는 보내지 않는다."""

FOLLOW_UP_REASONING_EFFORT = "low"
"""후속의 추론 강도. 후속은 이전 조건에 새 요청을 반영해야 해서 맥락 판단이 많다. 후속 시험
(단일 30개, 연쇄 5개 21턴, 4번씩)에서 `none`은 단일 114/120·연쇄 턴 77/84였고 음식 종류를
바꿀 때 이전 메뉴를 남겼다. `low`는 모두 맞았고 응답 중앙값이 2.1초에서 2.9초가 됐다
(2026-11-05)."""

FOLLOW_UP_TIMEOUT_SECONDS = 7.0
"""후속에서 GMS 한 번을 기다리는 최소 시간(초). 추론 `low`는 최대 5.01초가 나와 새 검색의
대기 시간(기본 5초)보다 길게 둔다. 시간 초과면 다시 부르지 않고 규칙으로 해석한다. 다시
부르면 BE가 AI를 기다리는 12초(place-ai-search spec)를 넘는다."""

__all__ = [
    "CODE_PHRASES",
    "DEFAULT_CHANGE_SUMMARY",
    "FOLLOW_UP_REASONING_EFFORT",
    "FOLLOW_UP_TIMEOUT_SECONDS",
    "FOOD_CODES",
    "FOOD_TYPES",
    "GROUP_SIZE",
    "MAX_CHANGE_SUMMARY_LENGTH",
    "MAX_CODES",
    "MAX_TEXT_LENGTH",
    "MAX_WALK_MINUTES",
    "MODEL",
    "REASONING_EFFORT",
    "SYSTEM_PROMPT",
    "Conditions",
    "Interpretation",
    "interpret",
    "interpret_by_rules",
    "station_code",
]


def interpret(
    query: str,
    previous: Conditions | None = None,
    timeout: float = 5.0,
    client: httpx.Client | None = None,
) -> Interpretation:
    """요청문을 조건으로 바꾼다. LLM이 실패하면 규칙으로 해석한다.

    Args:
        query: 사용자가 이번에 입력한 요청문
        previous: 후속 조건이면 기준 요청의 조건. 새 검색이면 None이다.
        timeout: GMS 한 번 부를 때 기다리는 시간(초). 후속이면
            `FOLLOW_UP_TIMEOUT_SECONDS`보다 짧지 않게 기다리고 시간 초과면 다시 부르지 않는다.
        client: GMS 연결을 다시 쓰는 HTTP 클라이언트. 없으면 부를 때마다 만든다.

    Returns:
        해석 결과
    """
    follow_up = previous is not None
    start = time.perf_counter()
    data = gms.call_json(
        [
            # GMS 안내 예시처럼 지시는 developer 역할로 보낸다.
            {"role": "developer", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _user_prompt(query, previous)},
        ],
        # 출력 검사는 받은 뒤 한 번만 한다. 공유 모듈에 넘기면 검사에 걸릴 때도 다시 부른다.
        lambda data: data,
        timeout=max(timeout, FOLLOW_UP_TIMEOUT_SECONDS) if follow_up else timeout,
        client=client,
        model=MODEL,
        temperature=None,
        reasoning_effort=FOLLOW_UP_REASONING_EFFORT if follow_up else REASONING_EFFORT,
        retry_on_timeout=not follow_up,
    )
    seconds = time.perf_counter() - start
    if data is None:
        return _by_rules(
            query,
            previous,
            "GMS가 꺼져 있거나 호출이 실패했다",
            seconds,
            gms_failed=True,
        )
    try:
        turn, conditions, summary = _parse(data, query, previous)
    except (ValueError, TypeError) as e:
        return _by_rules(query, previous, str(e), seconds)
    return Interpretation(conditions, summary, llm_seconds=seconds, turn=turn)


def _by_rules(
    query: str,
    previous: Conditions | None,
    error: str,
    seconds: float | None,
    gms_failed: bool = False,
) -> Interpretation:
    return Interpretation(
        conditions=interpret_by_rules(query, previous),
        change_summary=None if previous is None else DEFAULT_CHANGE_SUMMARY,
        llm_error=error,
        llm_seconds=seconds,
        gms_failed=gms_failed,
        turn=rule_turn(query),
    )
