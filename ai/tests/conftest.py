"""여러 테스트가 같이 쓰는 가짜 공유 모듈."""

from collections.abc import Callable

import pytest

from fit_ai import gms

Answer = Callable[[list[dict]], object]
"""GMS에 보낸 메시지를 받아 모델이 낼 JSON(읽은 값)을 돌려준다. None이면 호출 실패다."""


@pytest.fixture
def fake_gms(monkeypatch: pytest.MonkeyPatch) -> Callable[[Answer], list[list[dict]]]:
    """`fit_ai.gms.call_json`을 가짜로 바꿔 끼운다.

    실제 공유 모듈처럼 호출이 실패하거나 `parse`가 예외를 내면 한 번 더 부르고, 그래도
    안 되면 None을 돌려준다. 바꿔 끼운 뒤 받은 메시지 목록을 돌려준다.
    """

    def install(answer: Answer) -> list[list[dict]]:
        calls: list[list[dict]] = []

        def call_json(
            messages, parse, *, response_format=None, timeout=10.0, client=None
        ):
            for _ in range(2):
                calls.append(messages)
                data = answer(messages)
                if data is None:
                    continue
                try:
                    return parse(data)
                except (KeyError, IndexError, TypeError, ValueError):
                    continue
            return None

        monkeypatch.setattr(gms, "call_json", call_json)
        return calls

    return install


@pytest.fixture(autouse=True)
def _no_remote_embedding(monkeypatch: pytest.MonkeyPatch) -> None:
    """셸에 `EMBED_*`가 있어도 테스트가 Modal을 부르지 않게 지운다."""
    for name in ("EMBED_BASE_URL", "EMBED_KEY", "EMBED_SECRET"):
        monkeypatch.delenv(name, raising=False)
