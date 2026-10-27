"""환경변수로 앱 의존성을 만드는지 확인한다.

GMS 접속 설정은 공유 모듈 `fit_ai.gms`가 환경변수에서 직접 읽어서 monkeypatch로 넣는다.
"""

import pytest

from fit_ai.match.pg_store import PgPlaceStore
from server.main import build_dependencies


def test_enables_gms_and_store(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_GMS가켜져있고DB주소가있으면_GMS를켜고저장소를만든다"""
    monkeypatch.setenv("GMS_ENABLED", "true")
    monkeypatch.setenv("GMS_BASE_URL", "https://gms.example/gmsapi/api.openai.com/v1")
    monkeypatch.setenv("GMS_API_KEY", "key")

    deps = build_dependencies(
        {
            "MAX_CONCURRENT_REQUESTS": "4",
            "DATABASE_URL": "postgresql://nobody@127.0.0.1:1/none",
        }
    )

    assert deps.llm.enabled is True
    assert deps.llm_model == "gpt-4o-mini"
    assert deps.max_concurrent == 4
    assert isinstance(deps.store, PgPlaceStore)
    deps.store.close()


def test_off_unless_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_GMS_ENABLED가true가아니고DB와인코더설정이없으면_모두끈다"""
    monkeypatch.setenv("GMS_ENABLED", "1")

    deps = build_dependencies({})

    assert deps.llm.enabled is False
    assert deps.store is None
    assert deps.embedder is None


def test_bad_gms_config_fails_at_start(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_GMS를켰는데키가없으면_시작할때ValueError로드러낸다"""
    monkeypatch.setenv("GMS_ENABLED", "true")
    monkeypatch.setenv("GMS_BASE_URL", "https://gms.example/gmsapi/api.openai.com/v1")
    monkeypatch.delenv("GMS_API_KEY", raising=False)

    with pytest.raises(ValueError, match="GMS_API_KEY"):
        build_dependencies({})
