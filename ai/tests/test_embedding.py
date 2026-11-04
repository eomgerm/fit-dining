import json
import math

import httpx
import numpy as np
import pytest

from fit_ai import embedding


class FakeModel:
    def __init__(self):
        self.seen: list[str] = []

    def encode(self, texts, **_):
        self.seen += texts
        return np.array([[3.0, 4.0, 1 / 3]] * len(texts))


@pytest.fixture
def model(monkeypatch):
    fake = FakeModel()
    monkeypatch.setattr(embedding, "_model", lambda: fake)
    return fake


def test_queries_get_query_prefix_and_documents_do_not(model):
    embedding.encode_queries(["조용한 곳"])
    embedding.encode_documents(["조용한 곳"])
    assert model.seen == ["query: 조용한 곳", "조용한 곳"]


def test_empty_input_skips_model(model):
    assert embedding.encode_queries([]) == []
    assert model.seen == []


def test_vectors_are_unit_length_and_rounded(model):
    [vec] = embedding.encode_queries(["조용한 곳"])
    assert math.isclose(math.hypot(*vec), 1.0, abs_tol=1e-5)
    assert all(round(x, 6) == x for x in vec)
    assert isinstance(vec[0], float)


# --- 원격 질의 인코딩(Modal `POST /embed`) ---


def embed_reply(vectors, model: str = embedding.MODEL_VERSION) -> httpx.Response:
    return httpx.Response(
        200, json={"model": model, "dim": len(vectors[0]), "vectors": vectors}
    )


@pytest.fixture
def modal(monkeypatch):
    """`EMBED_*`를 채우고 Modal 응답을 차례로 돌려주는 클라이언트를 끼운다.

    받은 요청 목록과, 돌려줄 응답(예외면 던진다)을 쌓을 목록을 돌려준다.
    """
    monkeypatch.setenv("EMBED_BASE_URL", "https://embed.example/")
    monkeypatch.setenv("EMBED_KEY", "key-id")
    monkeypatch.setenv("EMBED_SECRET", "secret")
    seen: list[httpx.Request] = []
    replies: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    client = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(embedding, "_client", lambda: client)
    return seen, replies


def test_remote_query_sends_raw_text_with_modal_headers(modal):
    seen, replies = modal
    replies.append(embed_reply([[1.0, 0.0]]))

    assert embedding.encode_queries(["조용한 곳"]) == [[1.0, 0.0]]

    [request] = seen
    assert str(request.url) == "https://embed.example/embed"
    # `query: ` 접두사는 Modal 쪽 인코더가 붙인다
    assert json.loads(request.content) == {"texts": ["조용한 곳"], "kind": "query"}
    assert request.headers["Modal-Key"] == "key-id"
    assert request.headers["Modal-Secret"] == "secret"


@pytest.mark.parametrize("given, expected", [({}, 3.0), ({"timeout": 1.0}, 1.0)])
def test_remote_query_timeout(modal, given, expected):
    seen, replies = modal
    replies.append(embed_reply([[1.0]]))

    embedding.encode_queries(["a"], **given)

    assert seen[0].extensions["timeout"]["read"] == expected


def test_documents_stay_local_even_with_remote_set(modal, model):
    # 문서 배치를 Modal로 보내면 비용이 든다(design 12.3절). 로컬 모델만 쓴다
    seen, _ = modal
    embedding.encode_documents(["조용한 곳"])
    assert model.seen == ["조용한 곳"]
    assert seen == []


def test_remote_without_retry_fails_on_first_error(modal):
    seen, replies = modal
    replies += [httpx.ConnectError("끊김"), embed_reply([[1.0]])]

    with pytest.raises(embedding.EmbeddingUnavailable):
        embedding.encode_queries(["a"], attempts=1)
    assert len(seen) == 1


def test_remote_retries_once_then_succeeds(modal):
    seen, replies = modal
    replies += [httpx.ConnectError("끊김"), embed_reply([[1.0]])]

    assert embedding.encode_queries(["a"]) == [[1.0]]
    assert len(seen) == 2


@pytest.mark.parametrize(
    "timeout",
    [
        httpx.ConnectTimeout("느림"),
        httpx.ReadTimeout("느림"),
        httpx.WriteTimeout("느림"),
        httpx.PoolTimeout("느림"),
    ],
    ids=lambda e: type(e).__name__,
)
def test_remote_timeout_is_not_retried(modal, timeout):
    # 콜드 스타트 타임아웃은 3초 뒤에도 같다. 다시 부르면 Modal이 컨테이너를 하나 더 띄울 뿐이다
    seen, replies = modal
    replies += [timeout, embed_reply([[1.0]])]

    with pytest.raises(embedding.EmbeddingUnavailable, match=type(timeout).__name__):
        embedding.encode_queries(["a"])
    assert len(seen) == 1


@pytest.mark.parametrize(
    "bad",
    [
        httpx.Response(401),
        httpx.Response(303, headers={"Location": "https://embed.example/result"}),
        httpx.Response(500),
        httpx.ConnectError("끊김"),
        httpx.Response(200, text="not json"),
        embed_reply([[1.0]], model="other-model@1"),
        embed_reply([[1.0], [2.0]]),
    ],
    ids=["401", "303", "500", "connect-error", "not-json", "other-model", "count"],
)
def test_remote_two_failures_raise_unavailable(modal, bad):
    seen, replies = modal
    replies += [bad, bad]

    with pytest.raises(embedding.EmbeddingUnavailable) as e:
        embedding.encode_queries(["비밀 요청문"])
    assert len(seen) == 2
    assert str(e.value)  # RB-14 진단에 쓸 실패 종류가 있다
    assert "비밀 요청문" not in str(e.value)
    # 검색(`match/search.py`)이 503으로 바꾸는 예외 계열이다
    assert isinstance(e.value, RuntimeError)


@pytest.mark.parametrize(
    ("bad", "kind"),
    [
        (embed_reply([[1.0]], model="other-model@1"), "모델"),
        (embed_reply([[1.0], [2.0]]), "벡터 수"),
        (httpx.Response(401), "HTTP 401"),
    ],
)
def test_remote_failure_kind_tells_cause(modal, bad, kind):
    _, replies = modal
    replies += [bad, bad]

    with pytest.raises(embedding.EmbeddingUnavailable, match=kind):
        embedding.encode_queries(["a"])


def test_remote_empty_input_sends_nothing(modal):
    seen, _ = modal
    assert embedding.encode_queries([]) == []
    assert seen == []


FULL = {"EMBED_BASE_URL": "https://e.example", "EMBED_KEY": "k", "EMBED_SECRET": "s"}


@pytest.mark.parametrize(
    ("env", "problem"),
    [
        (FULL, None),
        ({**FULL, "EMBED_SECRET": ""}, "EMBED_SECRET"),
        ({k: v for k, v in FULL.items() if k != "EMBED_KEY"}, "EMBED_KEY"),
        ({**FULL, "EMBED_BASE_URL": "e.example"}, "EMBED_BASE_URL"),
        ({**FULL, "EMBED_BASE_URL": "https://[bad"}, "EMBED_BASE_URL"),
        ({**FULL, "EMBED_BASE_URL": "https://e.example:abc"}, "EMBED_BASE_URL"),
        ({}, "EMBED_BASE_URL"),
    ],
)
def test_remote_config_problem(env, problem):
    found = embedding.remote_config_problem(env)
    assert (found is None) if problem is None else (problem in found)
