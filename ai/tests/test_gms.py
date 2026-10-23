import json
import logging

import httpx
import pytest

from fit_ai import gms

MESSAGES = [{"role": "user", "content": "비밀 원문"}]


def completion(content: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def client_with(*responses: httpx.Response) -> tuple[httpx.Client, list[httpx.Request]]:
    seen: list[httpx.Request] = []
    queue = list(responses)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return queue.pop(0)

    return httpx.Client(transport=httpx.MockTransport(handler)), seen


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("GMS_ENABLED", "true")
    monkeypatch.setenv("GMS_BASE_URL", "https://gms.example/v1")
    monkeypatch.setenv("GMS_API_KEY", "key")


def test_disabled_sends_nothing(monkeypatch):
    monkeypatch.setenv("GMS_ENABLED", "false")
    client, seen = client_with()
    assert gms.call_json(MESSAGES, lambda d: d, client=client) is None
    assert seen == []


@pytest.mark.parametrize(
    "base", ["https://gms.example/v1", "https://gms.example/v1/chat/completions/"]
)
def test_base_url_and_full_endpoint_reach_same_url(monkeypatch, base):
    monkeypatch.setenv("GMS_BASE_URL", base)
    client, seen = client_with(completion('{"ok": 1}'))
    assert gms.call_json(MESSAGES, lambda d: d["ok"], client=client) == 1
    [req] = seen
    assert str(req.url) == "https://gms.example/v1/chat/completions"
    assert req.headers["Authorization"] == "Bearer key"
    body = json.loads(req.content)
    assert body["model"] == "gpt-4o-mini"
    assert body["temperature"] == 0
    assert body["response_format"] == {"type": "json_object"}
    assert body["messages"] == MESSAGES


def test_retries_once_after_http_error():
    client, seen = client_with(httpx.Response(500), completion('{"ok": 1}'))
    assert gms.call_json(MESSAGES, lambda d: d["ok"], client=client) == 1
    assert len(seen) == 2


def test_retries_once_after_parse_failure():
    client, seen = client_with(completion('{"bad": 1}'), completion('{"ok": 2}'))
    assert gms.call_json(MESSAGES, lambda d: d["ok"], client=client) == 2
    assert len(seen) == 2


def test_two_failures_return_none_and_log_only_failure_kind(caplog):
    client, seen = client_with(completion("응답 본문"), httpx.Response(503))
    with caplog.at_level(logging.WARNING):
        assert gms.call_json(MESSAGES, lambda d: d, client=client) is None
    assert len(seen) == 2
    assert "JSONDecodeError" in caplog.text
    assert "503" in caplog.text
    assert "비밀 원문" not in caplog.text
    assert "응답 본문" not in caplog.text
