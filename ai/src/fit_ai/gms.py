"""GMS(SSAFY LLM API) JSON 호출. 입력 원문과 응답 본문은 로그에 남기지 않는다(spec 1단계)."""

import json
import logging
import os
from collections.abc import Callable
from contextlib import nullcontext
from urllib.parse import urlsplit

import httpx

MODEL = "gpt-4o-mini"
"""기본 모델. 요청 해석은 자기 모델을 넘긴다(`fit_ai.match.interpretation.MODEL`)."""
_PATH = "/chat/completions"
_ATTEMPTS = 2  # 호출 실패나 출력 검사 실패면 한 번 다시 요청한다
# 네트워크·HTTP 오류, 응답 모양 오류. `parse`는 출력 검사 실패를 ValueError 등으로 알린다
_FAILURES = (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError)

log = logging.getLogger(__name__)


def _endpoint(base: str) -> str:
    base = base.rstrip("/")
    return base if base.endswith(_PATH) else base + _PATH


def _enabled() -> bool:
    return os.environ.get("GMS_ENABLED") == "true"


def check_config() -> None:
    """켜져 있으면 접속 설정을 검사한다. 틀리면 ValueError. 실행을 시작할 때 부른다.

    설정 실수는 장애가 아니므로 재시도나 원문 보관으로 가리지 않고 드러낸다.
    메시지에는 변수 이름만 넣고 값은 넣지 않는다.
    """
    if not _enabled():
        return
    for name in ("GMS_BASE_URL", "GMS_API_KEY"):
        if not os.environ.get(name):
            raise ValueError(f"GMS_ENABLED=true인데 {name}이 비어 있다")
    url = urlsplit(os.environ["GMS_BASE_URL"])
    if url.scheme not in ("http", "https") or not url.netloc:
        raise ValueError(
            "GMS_BASE_URL은 http:// 또는 https://로 시작하는 주소여야 한다"
        )


def _failure_kind(e: Exception) -> str:
    if isinstance(e, httpx.HTTPStatusError):
        return f"HTTP {e.response.status_code}"
    return type(e).__name__


def call_json[T](
    messages: list[dict],
    parse: Callable[[dict], T],
    *,
    response_format: dict | None = None,
    timeout: float = 10.0,
    client: httpx.Client | None = None,
    model: str = MODEL,
    temperature: float | None = 0,
    reasoning_effort: str | None = None,
    retry_on_timeout: bool = True,
) -> T | None:
    """응답 JSON을 `parse`로 검사해 돌려준다. 꺼져 있거나 두 번 실패하면 None.

    설정이 틀리면 None이 아니라 `check_config`의 ValueError가 난다.

    `response_format`을 주지 않으면 JSON 모드(스키마 보장 없음)로 부른다. `model`을 주지
    않으면 `MODEL`로 부른다. `temperature`가 None이면 보내지 않는다(기본값만 받는 모델이
    있다). `reasoning_effort`는 추론 모델의 추론 강도이고 None이면 보내지 않는다.
    `retry_on_timeout`이 거짓이면 시간 초과일 때 다시 부르지 않는다(기다린 만큼 다시 기다리면
    부른 쪽의 시간 예산을 넘을 때).
    """
    if not _enabled():
        return None
    check_config()
    url = _endpoint(os.environ["GMS_BASE_URL"])
    headers = {"Authorization": f"Bearer {os.environ['GMS_API_KEY']}"}
    body: dict = {
        "model": model,
        "response_format": response_format or {"type": "json_object"},
        "messages": messages,
    }
    if temperature is not None:
        body["temperature"] = temperature
    if reasoning_effort is not None:
        body["reasoning_effort"] = reasoning_effort
    with nullcontext(client) if client else httpx.Client() as c:
        for attempt in range(1, _ATTEMPTS + 1):
            try:
                resp = c.post(url, json=body, headers=headers, timeout=timeout)
                resp.raise_for_status()
                content = resp.json()["choices"][0]["message"]["content"]
                return parse(json.loads(content))
            except _FAILURES as e:  # 실패 종류만 남기고 다시 요청한다
                log.warning(
                    "GMS 호출 실패(%d/%d): %s", attempt, _ATTEMPTS, _failure_kind(e)
                )
                if not retry_on_timeout and isinstance(e, httpx.TimeoutException):
                    break
    return None
