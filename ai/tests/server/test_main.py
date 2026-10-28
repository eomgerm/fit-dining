"""환경변수로 앱 의존성을 만드는지 확인한다.

GMS 접속 설정은 공유 모듈 `fit_ai.gms`가 환경변수에서 직접 읽어서 monkeypatch로 넣는다.
요청문 인코더 모델은 공유 모듈 `fit_ai.embedding`을 가짜로 바꿔 올린다.
"""

from pathlib import Path

import httpx
import pytest

from fit_ai import embedding
from fit_ai.match.json_store import JsonPlaceStore, JsonTasteStore
from fit_ai.match.pg_store import PgPlaceStore, PgTasteStore
from server.main import build_dependencies

MOCK_FILE = Path(__file__).resolve().parents[2] / "samples" / "place" / "mock.json"
TASTE_FILE = Path(__file__).resolve().parents[2] / "samples" / "taste" / "profiles.json"


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
    """의존성_DB주소가없고장소파일이있으면_파일저장소를만든다"""
    monkeypatch.setenv("GMS_ENABLED", "false")

    deps = build_dependencies(
        {"PLACES_FILE": str(MOCK_FILE), "TASTE_FILE": str(TASTE_FILE)}
    )

    assert isinstance(deps.store, JsonPlaceStore)
    assert isinstance(deps.taste_store, JsonTasteStore)
    deps.gms_client.close()


def test_database_wins_over_places_file(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_DB주소와장소파일이모두있으면_DB를쓴다"""
    monkeypatch.setenv("GMS_ENABLED", "false")

    deps = build_dependencies(
        {
            "DATABASE_URL": "postgresql://nobody@127.0.0.1:1/none",
            "PLACES_FILE": str(MOCK_FILE),
            "TASTE_FILE": str(TASTE_FILE),
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


def test_warms_up_embedding(monkeypatch: pytest.MonkeyPatch) -> None:
    """의존성_EMBEDDING_ENABLED가true면_시작할때인코더모델을한번올린다"""
    seen = []
    monkeypatch.setattr(embedding, "encode_queries", lambda texts: seen.append(texts))
    monkeypatch.setenv("GMS_ENABLED", "false")

    deps = build_dependencies({"EMBEDDING_ENABLED": "true"})

    assert deps.embedding_ready is True
    assert seen == [["준비"]]


class SafetensorError(Exception):
    """깨진 모델 파일에서 나는 오류처럼 흔한 예외 계열 밖의 오류"""


@pytest.mark.parametrize(
    "error", [OSError("모델 파일을 받지 못했다"), SafetensorError("파일이 깨졌다")]
)
def test_embedding_load_failure(
    monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    """의존성_인코더모델을올리다어떤오류가나도_서버는죽지않고준비되지않은것으로본다"""

    def encode_queries(texts: list[str]) -> list[list[float]]:
        raise error

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
