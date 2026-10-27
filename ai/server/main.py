"""환경변수로 의존성을 만들어 띄우는 AI API 앱.

로컬에서는 `ai/`에서 `uv run --env-file .env uvicorn server.main:app`으로 띄운다.
배포 때도 이 `app`을 그대로 올린다. 환경변수는 `ai/.env.example`에 설명이 있다.
"""

import json
import logging
import os
import traceback
from collections.abc import Mapping

import httpx

from fit_ai import embedding, gms
from fit_ai.match.pg_store import PgPlaceStore
from server.app import Dependencies, create_app

logger = logging.getLogger("server")


def build_dependencies(env: Mapping[str, str]) -> Dependencies:
    """환경변수로 앱의 의존성을 만든다.

    GMS 접속 설정은 공유 모듈 `fit_ai.gms`가 환경변수에서 직접 읽는다. 설정이 틀리면
    장애로 가리지 않고 시작할 때 ValueError로 드러낸다(취향 spec 1단계). 인코더를
    올리지 못하거나 DB 접속 주소가 없으면 앱은 떠 있지만 `/healthz`와 검색은 503을
    돌려준다.

    Args:
        env: 환경변수

    Returns:
        앱의 의존성

    Raises:
        ValueError: `GMS_ENABLED=true`인데 GMS 접속 설정이 틀렸을 때
    """
    gms.check_config()
    dsn = env.get("DATABASE_URL")
    return Dependencies(
        embedding_ready=_warm_up_embedding(env),
        store=PgPlaceStore(dsn, int(env.get("DB_POOL_SIZE", "2"))) if dsn else None,
        gms_timeout=float(env.get("GMS_TIMEOUT_SECONDS", "5.0")),
        # 검색마다 GMS를 두 번 부르므로 연결을 다시 써서 TLS 연결 시간을 아낀다.
        gms_client=httpx.Client(),
        max_concurrent=int(env.get("MAX_CONCURRENT_REQUESTS", "8")),
    )


def _warm_up_embedding(env: Mapping[str, str]) -> bool:
    """`EMBEDDING_ENABLED`가 "true"면 요청문 인코더 모델을 미리 올린다.

    공유 모듈 `fit_ai.embedding`은 처음 부를 때 모델을 올린다(2GB 남짓 내려받기 포함).
    첫 검색이 이를 기다리지 않도록 시작할 때 한 번 인코딩한다.

    Returns:
        모델을 올렸으면 True
    """
    if env.get("EMBEDDING_ENABLED") != "true":
        return False
    try:
        embedding.encode_queries(["준비"])
    # 내려받기 오류, 깨진 모델 파일(safetensors), CUDA 오류 등 종류가 많다. 어떤 오류든
    # 앱은 떠 있고 503으로 알려야 재시작을 되풀이하지 않는다.
    except Exception as e:  # noqa: BLE001
        logger.error(
            json.dumps({"event": "embedding_failed", "error": type(e).__name__})
        )
        return False
    return True


class _JsonFormatter(logging.Formatter):
    """모든 로그를 JSON 한 줄로 쓴다(인프라 설계 12.2-5).

    앱 로그(`server`)는 이미 JSON이라 그대로 둔다. 라이브러리 로그와 예외에는 접속
    주소나 요청 값이 섞일 수 있어 예외는 종류와 위치만 남긴다.
    """

    def format(self, record: logging.LogRecord) -> str:
        if record.name == "server":
            return record.getMessage()
        entry = {
            "event": "library_log",
            "logger": record.name,
            "level": record.levelname,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[1] is not None:
            error = record.exc_info[1]
            frames = traceback.extract_tb(error.__traceback__)
            entry["error"] = type(error).__name__
            if frames:
                entry["at"] = (
                    f"{os.path.basename(frames[-1].filename)}:{frames[-1].lineno}"
                )
        return json.dumps(entry, ensure_ascii=False)


def _configure_logging() -> None:
    """로그를 JSON으로 통일하고 시끄러운 로그를 끈다."""
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    # uvicorn은 앱을 불러오기 전에 자기 로거를 설정하므로 형식을 여기서 바꾼다.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        for uvicorn_handler in logging.getLogger(name).handlers:
            uvicorn_handler.setFormatter(_JsonFormatter())
    quiet = {
        # 요청마다 JSON이 아닌 로그를 남긴다.
        "httpx": logging.WARNING,
        "uvicorn.access": logging.WARNING,
        # INFO면 인코딩마다 진행 막대를 그린다.
        "sentence_transformers": logging.WARNING,
        # 접속 실패 메시지에 DB 주소가 들어간다. 실패는 앱 로그 `store_failed`로 남는다.
        "psycopg.pool": logging.ERROR,
    }
    for name, level in quiet.items():
        logging.getLogger(name).setLevel(level)
    # 모델을 올릴 때 가중치 진행 막대를 그린다. transformers는 처음 불러올 때 이 값을
    # 읽으므로 인코더를 올리기 전에 정한다.
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")


_configure_logging()
app = create_app(build_dependencies(os.environ))
