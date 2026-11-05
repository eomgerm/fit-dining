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


def test_config_check_skipped_when_disabled(monkeypatch):
    monkeypatch.setenv("GMS_ENABLED", "false")
    monkeypatch.delenv("GMS_BASE_URL")
    monkeypatch.delenv("GMS_API_KEY")
    gms.check_config()


def test_valid_config_passes():
    gms.check_config()


@pytest.mark.parametrize("name", ["GMS_BASE_URL", "GMS_API_KEY"])
@pytest.mark.parametrize("value", [None, ""])
def test_missing_setting_names_the_variable(monkeypatch, name, value):
    if value is None:
        monkeypatch.delenv(name)
    else:
        monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=name):
        gms.check_config()


@pytest.mark.parametrize("url", ["gms.example/v1", "ftp://gms.example/v1", "https://"])
def test_bad_url_is_config_error(monkeypatch, url):
    monkeypatch.setenv("GMS_BASE_URL", url)
    with pytest.raises(ValueError, match="GMS_BASE_URL"):
        gms.check_config()


def test_call_raises_config_error_without_sending(monkeypatch):
    # 설정 실수는 장애처럼 재시도·원문 보관으로 가려지지 않고 드러나야 한다
    monkeypatch.setenv("GMS_BASE_URL", "gms.example/v1")
    client, seen = client_with()
    with pytest.raises(ValueError):
        gms.call_json(MESSAGES, lambda d: d, client=client)
    assert seen == []


def test_config_error_does_not_leak_key(monkeypatch):
    monkeypatch.setenv("GMS_API_KEY", "secret-key")
    monkeypatch.setenv("GMS_BASE_URL", "nope")
    with pytest.raises(ValueError) as e:
        gms.check_config()
    assert "secret-key" not in str(e.value)


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
    assert "reasoning_effort" not in body
    assert body["response_format"] == {"type": "json_object"}
    assert body["messages"] == MESSAGES


def test_sends_given_model_without_temperature():
    client, seen = client_with(completion('{"ok": 1}'))
    gms.call_json(
        MESSAGES,
        lambda d: d,
        client=client,
        model="gpt-6-luna",
        temperature=None,
        reasoning_effort="none",
    )
    body = json.loads(seen[0].content)
    assert body["model"] == "gpt-6-luna"
    assert "temperature" not in body
    assert body["reasoning_effort"] == "none"


def test_timeout_not_retried_when_asked():
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        raise httpx.ReadTimeout("느림", request=request)

    seen: list[httpx.Request] = []
    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert (
        gms.call_json(MESSAGES, lambda d: d, client=client, retry_on_timeout=False)
        is None
    )
    assert len(seen) == 1


def test_sends_given_response_format():
    fmt = {"type": "json_schema", "json_schema": {"name": "x", "strict": True}}
    client, seen = client_with(completion('{"ok": 1}'))
    gms.call_json(MESSAGES, lambda d: d, response_format=fmt, client=client)
    assert json.loads(seen[0].content)["response_format"] == fmt


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
