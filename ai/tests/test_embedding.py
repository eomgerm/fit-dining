import math

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
