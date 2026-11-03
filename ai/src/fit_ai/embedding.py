"""arctic-ko 임베딩. 질의와 문서는 인코딩이 달라서 함수를 나눈다(spec 5단계).

질의는 `EMBED_BASE_URL`이 있으면 Modal 임베딩 앱(`POST /embed`, design.md 12.3절)을
부르고, 없으면 로컬 모델을 쓴다. 서버 A의 AI API는 torch 없이 원격으로, Modal 앱
(`server/embed.py`)은 로컬 모델로 돈다. 문서는 늘 로컬 모델을 쓴다. 장소 배치를 Modal로
보내면 비용이 들기 때문이다. 로컬 모델은 `encoder` extra가 있어야 한다.
"""

import logging
import os
from collections.abc import Mapping
from functools import cache
from urllib.parse import urlsplit

import httpx
import numpy as np

MODEL_ID = "dragonkue/snowflake-arctic-embed-l-v2.0-ko"
REVISION = "55ec6e9358a56d56af759bc8372e970caf8c305f"
MODEL_VERSION = f"{MODEL_ID}@{REVISION}"
"""Modal 응답의 `model`. 저장된 벡터의 모델과 같아야 비교할 수 있다."""
QUERY_PREFIX = "query: "

REMOTE_TIMEOUT_SECONDS = 3.0
"""Modal 한 번 부를 때 단계(연결·쓰기·읽기)마다 기다리는 시간. 따뜻한 질의 1건은 0.25~0.4초다.
콜드 스타트(17~85초)는 기다리지 않고 실패로 본다. 그동안 BE는 키워드 검색으로 대체한다.
시간 초과는 다시 부르지 않는다: 3초 뒤에도 같고, 다시 부르면 Modal이 부팅 중인 컨테이너를 두고 하나 더 띄운다.
검색 한 번의 시간 상한은 따로 없어서, 해석이 늦고 Modal도 시간을 채우면 BE
타임아웃을 넘길 수 있다. 그때도 BE는 키워드 검색으로 대체한다."""
# 시간 초과가 아닌 실패(연결 끊김, HTTP 오류, 응답 모양 오류)는 한 번 더 부른다
_ATTEMPTS = 2
# 네트워크·HTTP 오류(303 포함), 응답 모양 오류, 모델 불일치
_FAILURES = (httpx.HTTPError, KeyError, TypeError, ValueError)

log = logging.getLogger(__name__)


class EmbeddingUnavailable(RuntimeError):
    """원격 임베딩을 받지 못했다(시간 초과는 한 번, 그 밖의 실패는 두 번 시도했다). 메시지에는 실패 종류만 있다."""


class _BadReply(ValueError):
    """Modal 응답이 계약과 다르다. 메시지는 고정 문구라 로그에 그대로 남긴다."""


@cache
def _model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(MODEL_ID, revision=REVISION)


@cache
def _client() -> httpx.Client:
    # 연결을 다시 써서 검색마다 TLS 연결 시간(미국 동부 왕복)을 아낀다.
    return httpx.Client()


def _encode(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    vecs = np.asarray(_model().encode(texts), dtype=np.float64)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    return np.round(vecs, 6).tolist()


def remote_config_problem(env: Mapping[str, str] = os.environ) -> str | None:
    """원격 임베딩 설정이 틀린 곳을 알려 준다. 맞으면 None.

    메시지에는 변수 이름만 넣고 값은 넣지 않는다.
    """
    for name in ("EMBED_BASE_URL", "EMBED_KEY", "EMBED_SECRET"):
        if not env.get(name):
            return f"{name}이 비어 있다"
    raw = env["EMBED_BASE_URL"]
    try:
        # httpx는 깨진 IPv6 괄호를 받아들이고, urlsplit은 틀린 포트를 받아들여서 둘 다 본다
        ok = urlsplit(raw).hostname is not None
        url = httpx.URL(raw)
    except (httpx.InvalidURL, ValueError):
        ok = False
    if not ok or url.scheme not in ("http", "https"):
        return "EMBED_BASE_URL은 http:// 또는 https://로 시작하는 주소여야 한다"
    return None


def _failure_kind(e: Exception) -> str:
    if isinstance(e, httpx.HTTPStatusError):
        return f"HTTP {e.response.status_code}"
    if isinstance(e, _BadReply):
        return str(e)
    return type(e).__name__


def _remote_queries(texts: list[str]) -> list[list[float]]:
    url = os.environ["EMBED_BASE_URL"].rstrip("/") + "/embed"
    headers = {
        "Modal-Key": os.environ.get("EMBED_KEY", ""),
        "Modal-Secret": os.environ.get("EMBED_SECRET", ""),
    }
    body = {"texts": texts, "kind": "query"}
    kind = ""
    for attempt in range(1, _ATTEMPTS + 1):
        try:
            resp = _client().post(
                url, json=body, headers=headers, timeout=REMOTE_TIMEOUT_SECONDS
            )
            resp.raise_for_status()
            data = resp.json()
            if data["model"] != MODEL_VERSION:
                raise _BadReply("모델이 다르다")
            vectors = data["vectors"]
            if len(vectors) != len(texts):
                raise _BadReply("벡터 수가 다르다")
            return vectors
        except _FAILURES as e:  # 실패 종류만 남긴다. 메시지에 요청문이 섞일 수 있다
            kind = _failure_kind(e)
            log.warning("임베딩 호출 실패(%d/%d): %s", attempt, _ATTEMPTS, kind)
            if isinstance(e, httpx.TimeoutException):
                break
    raise EmbeddingUnavailable(kind)


def encode_queries(texts: list[str]) -> list[list[float]]:
    """검색하는 쪽 문장(요청문, 취향 문구). 앞에 `query: `를 붙인다.

    `EMBED_BASE_URL`이 있으면 Modal을 부르고 접두사는 Modal 쪽이 붙인다. 원격 호출이
    두 번 실패하면 `EmbeddingUnavailable`을 낸다.
    """
    if not texts:
        return []
    if os.environ.get("EMBED_BASE_URL"):
        return _remote_queries(texts)
    return encode_queries_locally(texts)


def encode_queries_locally(texts: list[str]) -> list[list[float]]:
    """`encode_queries`와 같지만 늘 로컬 모델을 쓴다. Modal 앱이 자기 자신을 부르지 않게 쓴다."""
    return _encode([QUERY_PREFIX + t for t in texts])


def encode_documents(texts: list[str]) -> list[list[float]]:
    """검색 대상 글(장소 요약, 페르소나). 아무것도 붙이지 않는다. 늘 로컬 모델이다."""
    return _encode(texts)
