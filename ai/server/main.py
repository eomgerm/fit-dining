"""환경변수로 의존성을 만들어 띄우는 AI API 앱.

로컬에서는 `ai/`에서 `uv run --env-file .env uvicorn server.main:app`으로 띄운다.
배포 때도 이 `app`을 그대로 올린다. 환경변수는 docs/comparison/api.md 7장에 있다.
"""

import json
import logging
import os
from collections.abc import Mapping

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
    except (RuntimeError, OSError, ValueError) as e:
        logger.error(
            json.dumps({"event": "embedding_failed", "error": type(e).__name__})
        )
        return False
    return True


logging.basicConfig(level=logging.INFO, format="%(message)s")
# httpx는 요청마다 JSON이 아닌 로그를 남긴다. 로그는 JSON만 남긴다(인프라 설계 12.2-5).
logging.getLogger("httpx").setLevel(logging.WARNING)
app = create_app(build_dependencies(os.environ))
