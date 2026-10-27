"""환경변수로 앱 의존성을 만드는지 확인한다.

GMS 접속 설정은 공유 모듈 `fit_ai.gms`가 환경변수에서 직접 읽어서 monkeypatch로 넣는다.
요청문 인코더 모델은 공유 모듈 `fit_ai.embedding`을 가짜로 바꿔 올린다.
"""

import pytest

from fit_ai import embedding
from fit_ai.match.pg_store import PgPlaceStore
from server.main import build_dependencies


def test_builds_store_and_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_DB주소와설정이있으면_저장소를만들고설정값을읽는다"""
    monkeypatch.setenv("GMS_ENABLED", "false")

    deps = build_dependencies(
        {
            "MAX_CONCURRENT_REQUESTS": "4",
            "GMS_TIMEOUT_SECONDS": "3.5",
            "DATABASE_URL": "postgresql://nobody@127.0.0.1:1/none",
        }
    )

    assert deps.max_concurrent == 4
    assert deps.gms_timeout == 3.5
    assert isinstance(deps.store, PgPlaceStore)
    deps.store.close()


def test_off_unless_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_DB주소와인코더설정이없으면_둘다준비되지않은것으로본다"""
    monkeypatch.setenv("GMS_ENABLED", "false")

    deps = build_dependencies({})

    assert deps.store is None
    assert deps.embedding_ready is False


def test_warms_up_embedding(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_EMBEDDING_ENABLED가true면_시작할때인코더모델을한번올린다"""
    seen = []
    monkeypatch.setattr(embedding, "encode_queries", lambda texts: seen.append(texts))
    monkeypatch.setenv("GMS_ENABLED", "false")

    deps = build_dependencies({"EMBEDDING_ENABLED": "true"})

    assert deps.embedding_ready is True
    assert seen == [["준비"]]


def test_embedding_load_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_인코더모델을올리지못하면_준비되지않은것으로본다"""

    def encode_queries(texts: list[str]) -> list[list[float]]:
        raise OSError("모델 파일을 받지 못했다")

    monkeypatch.setattr(embedding, "encode_queries", encode_queries)
    monkeypatch.setenv("GMS_ENABLED", "false")

    assert build_dependencies({"EMBEDDING_ENABLED": "true"}).embedding_ready is False


def test_bad_gms_config_fails_at_start(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_GMS를켰는데키가없으면_시작할때ValueError로드러낸다"""
    monkeypatch.setenv("GMS_ENABLED", "true")
    monkeypatch.setenv("GMS_BASE_URL", "https://gms.example/gmsapi/api.openai.com/v1")
    monkeypatch.delenv("GMS_API_KEY", raising=False)

    with pytest.raises(ValueError, match="GMS_API_KEY"):
        build_dependencies({})
