"""환경변수로 의존성을 만들어 띄우는 AI API 앱.

로컬에서는 `ai/`에서 `uv run --env-file .env uvicorn server.main:app`으로 띄운다.
배포 때도 이 `app`을 그대로 올린다. 환경변수는 docs/comparison/api.md 7장에 있다.
"""

import json
import logging
import os
from collections.abc import Mapping

import httpx

from fit_ai import gms
from fit_ai.match.embedder import EmbeddingError, QueryEmbedder, SharedEmbedder
from fit_ai.match.llm import GmsLlm
from fit_ai.match.pg_store import PgPlaceStore
from server.app import Dependencies, create_app

logger = logging.getLogger("server")


def build_dependencies(env: Mapping[str, str]) -> Dependencies:
    """환경변수로 앱의 의존성을 만든다.

    GMS 접속 설정은 공유 모듈 `fit_ai.gms`가 환경변수에서 직접 읽는다. 설정이 틀리면
    장애로 가리지 않고 시작할 때 ValueError로 드러낸다(취향 spec 1단계). 인코더를
    불러오지 못하거나 DB 접속 주소가 없으면 그 의존성은 None이다. 앱은 떠 있지만
    `/healthz`와 검색은 503을 돌려준다.

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
        embedder=_embedder(env),
        # 연결을 다시 쓰도록 클라이언트를 하나 만들어 넘긴다.
        llm=GmsLlm(
            timeout_seconds=float(env.get("GMS_TIMEOUT_SECONDS", "5.0")),
            client=httpx.Client(),
        ),
        llm_model=gms.MODEL,
        store=PgPlaceStore(dsn, int(env.get("DB_POOL_SIZE", "2"))) if dsn else None,
        max_concurrent=int(env.get("MAX_CONCURRENT_REQUESTS", "8")),
    )


def _embedder(env: Mapping[str, str]) -> QueryEmbedder | None:
    """`EMBEDDING_ENABLED`가 "true"일 때만 인코더를 불러온다. 실패하면 None이다."""
    if env.get("EMBEDDING_ENABLED") != "true":
        return None
    try:
        return SharedEmbedder()
    except EmbeddingError as e:
        logger.error(json.dumps({"event": "embedder_failed", "error": str(e)}))
        return None


logging.basicConfig(level=logging.INFO, format="%(message)s")
# httpx는 요청마다 JSON이 아닌 로그를 남긴다. 로그는 JSON만 남긴다(인프라 설계 12.2-5).
logging.getLogger("httpx").setLevel(logging.WARNING)
app = create_app(build_dependencies(os.environ))
