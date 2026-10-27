"""공유 모듈 `fit_ai.gms`를 LLM 인터페이스로 감싼 어댑터를 확인한다."""

import json

import pytest

from fit_ai import gms
from fit_ai.match.llm import GmsLlm, LlmError


def test_sends_developer_and_user(monkeypatch: pytest.MonkeyPatch) -> None:
    """GMS어댑터_지시는developer입력은user로보내고_응답을JSON문자열로돌려준다"""
    seen = {}

    def call_json(messages, parse, *, response_format=None, timeout=10.0, client=None):
        seen.update(messages=messages, timeout=timeout)
        return parse({"ranking": [{"id": 1}]})

    monkeypatch.setattr(gms, "call_json", call_json)

    raw = GmsLlm(timeout_seconds=3.0).complete_json("지시", "입력")

    assert json.loads(raw) == {"ranking": [{"id": 1}]}
    assert seen["messages"] == [
        {"role": "developer", "content": "지시"},
        {"role": "user", "content": "입력"},
    ]
    assert seen["timeout"] == 3.0


def test_none_is_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """GMS어댑터_공유모듈이None을주면_LlmError다"""
    monkeypatch.setattr(gms, "call_json", lambda *args, **kwargs: None)

    with pytest.raises(LlmError):
        GmsLlm().complete_json("지시", "입력")


@pytest.mark.parametrize(("value", "enabled"), [("true", True), ("false", False)])
def test_enabled_follows_kill_switch(
    monkeypatch: pytest.MonkeyPatch, value: str, enabled: bool
) -> None:
    """GMS어댑터_켜짐여부는_GMS_ENABLED를따른다"""
    monkeypatch.setenv("GMS_ENABLED", value)

    assert GmsLlm().enabled is enabled
