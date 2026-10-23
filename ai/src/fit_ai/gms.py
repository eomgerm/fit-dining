"""GMS(SSAFY LLM API) JSON 호출. 입력 원문과 응답 본문은 로그에 남기지 않는다(spec 1단계)."""

import json
import logging
import os
from collections.abc import Callable
from contextlib import nullcontext

import httpx

MODEL = "gpt-4o-mini"
_PATH = "/chat/completions"
_ATTEMPTS = 2  # 호출 실패나 출력 검사 실패면 한 번 다시 요청한다
# 네트워크·HTTP 오류, 응답 모양 오류. `parse`는 출력 검사 실패를 ValueError 등으로 알린다
_FAILURES = (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError)

log = logging.getLogger(__name__)


def _endpoint(base: str) -> str:
    base = base.rstrip("/")
    return base if base.endswith(_PATH) else base + _PATH


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
) -> T | None:
    """응답 JSON을 `parse`로 검사해 돌려준다. 꺼져 있거나 두 번 실패하면 None.

    `response_format`을 주지 않으면 JSON 모드(스키마 보장 없음)로 부른다.
    """
    if os.environ.get("GMS_ENABLED") != "true":
        return None
    url = _endpoint(os.environ["GMS_BASE_URL"])
    headers = {"Authorization": f"Bearer {os.environ['GMS_API_KEY']}"}
    body = {
        "model": MODEL,
        "temperature": 0,
        "response_format": response_format or {"type": "json_object"},
        "messages": messages,
    }
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
    return None
