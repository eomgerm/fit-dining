"""환경변수로 앱 의존성을 만드는지 확인한다.

GMS 접속 설정은 공유 모듈 `fit_ai.gms`가 환경변수에서 직접 읽어서 monkeypatch로 넣는다.
원격 임베딩은 `EMBED_*` 값이 있는지만 보고 시작할 때 부르지 않는다.
"""

import json
import logging
from pathlib import Path

import httpx
import pytest

from fit_ai import embedding
from fit_ai.match.json_store import JsonPlaceStore
from fit_ai.match.pg_store import PgPlaceStore, PgTasteStore
from server.main import build_dependencies

MOCK_FILE = Path(__file__).resolve().parents[2] / "samples" / "place" / "mock.json"


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
    # GMS 연결을 검색마다 새로 맺지 않도록 클라이언트 하나를 만들어 둔다.
    assert isinstance(deps.gms_client, httpx.Client)
    deps.store.close()
    deps.gms_client.close()


def test_places_file_without_database(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_DB주소가없고장소파일이있으면_장소는파일저장소를만들고취향저장소는없다"""
    monkeypatch.setenv("GMS_ENABLED", "false")

    deps = build_dependencies({"PLACES_FILE": str(MOCK_FILE)})

    assert isinstance(deps.store, JsonPlaceStore)
    # 회원 취향은 DB에서만 읽는다.
    assert deps.taste_store is None
    deps.gms_client.close()


def test_database_wins_over_places_file(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_DB주소와장소파일이모두있으면_DB를쓴다"""
    monkeypatch.setenv("GMS_ENABLED", "false")

    deps = build_dependencies(
        {
            "DATABASE_URL": "postgresql://nobody@127.0.0.1:1/none",
            "PLACES_FILE": str(MOCK_FILE),
        }
    )

    assert isinstance(deps.store, PgPlaceStore)
    assert isinstance(deps.taste_store, PgTasteStore)
    deps.store.close()
    deps.taste_store.close()
    deps.gms_client.close()


def test_off_unless_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_DB주소와인코더설정이없으면_둘다준비되지않은것으로본다"""
    monkeypatch.setenv("GMS_ENABLED", "false")

    deps = build_dependencies({})

    assert deps.store is None
    assert deps.taste_store is None
    assert deps.embedding_ready is False


EMBED_ENV = {
    "EMBED_BASE_URL": "https://embed.example",
    "EMBED_KEY": "key-id",
    "EMBED_SECRET": "secret",
}


def test_ready_when_embed_settings_present(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_EMBED설정이모두있으면_Modal을부르지않고준비된것으로본다"""
    monkeypatch.setattr(
        embedding, "encode_queries", lambda texts: pytest.fail("시작할 때 불렀다")
    )
    monkeypatch.setenv("GMS_ENABLED", "false")

    assert build_dependencies(EMBED_ENV).embedding_ready is True


@pytest.mark.parametrize(
    "env",
    [
        {**EMBED_ENV, "EMBED_SECRET": ""},
        {**EMBED_ENV, "EMBED_BASE_URL": "embed.example"},
    ],
)
def test_bad_embed_settings_not_ready(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, env
) -> None:
    """의존성_EMBED설정이틀리면_죽지않고준비되지않은것으로보고embedding_failed를남긴다"""
    monkeypatch.setenv("GMS_ENABLED", "false")

    with caplog.at_level(logging.INFO, logger="server"):
        assert build_dependencies(env).embedding_ready is False

    [entry] = [json.loads(r.getMessage()) for r in caplog.records]
    assert entry["event"] == "embedding_failed"
    assert "EMBED_" in entry["error"]
    # 값(비밀)은 로그에 남기지 않는다
    assert "secret" not in caplog.text and "key-id" not in caplog.text


def test_bad_gms_config_fails_at_start(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_GMS를켰는데키가없으면_시작할때ValueError로드러낸다"""
    monkeypatch.setenv("GMS_ENABLED", "true")
    monkeypatch.setenv("GMS_BASE_URL", "https://gms.example/gmsapi/api.openai.com/v1")
    monkeypatch.delenv("GMS_API_KEY", raising=False)

    with pytest.raises(ValueError, match="GMS_API_KEY"):
        build_dependencies({})
