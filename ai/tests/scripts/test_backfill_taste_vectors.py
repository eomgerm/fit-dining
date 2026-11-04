import importlib.util
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "backfill_taste_vectors",
    Path(__file__).resolve().parents[2] / "scripts" / "backfill_taste_vectors.py",
)
backfill = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(backfill)


def chip(polarity, label, **extra):
    return {"polarity": polarity, "label": label, **extra}


ROWS = [
    (
        "u1",
        [
            chip("LIKE", "국물", code=None, vector=None),
            chip("LIKE", "조용한", code="QUIET", vector=None),
            chip("DISLIKE", "매운", code=None, vector=None),
            chip("LIKE", "창가", code=None, vector=[0.1]),
            chip("LIKE", "골목", code=None),
        ],
    ),
    ("u2", [chip("LIKE", "옛날 칩")]),
    ("u3", None),
]


def test_targets_are_uncoded_like_chips_without_vector():
    targets, legacy = backfill.scan(ROWS)
    assert targets == [
        backfill.Target("u1", 0, "국물"),
        backfill.Target("u1", 4, "골목"),
    ]
    assert legacy == 1


def test_sql_sets_vector_by_index_and_guards_without_label():
    targets, _ = backfill.scan(ROWS)
    sql = backfill.to_sql(targets, [[0.5, -0.25], [1.0, 0.0]])
    assert sql.startswith("BEGIN;\n") and sql.endswith("COMMIT;\n")
    assert "'{0,vector}', '[0.5,-0.25]'::jsonb" in sql
    assert "'{4,vector}', '[1.0,0.0]'::jsonb" in sql
    assert "user_id = 'u1'" in sql
    assert backfill.md5_hex("국물") in sql
    assert "국물" not in sql and "골목" not in sql


def test_embeds_in_batches_within_modal_limit():
    calls = []

    def encode(texts):
        calls.append(len(texts))
        return [[0.0] * 1024 for _ in texts]

    targets = [backfill.Target("u", i, f"t{i}") for i in range(130)]
    assert len(backfill.embed(targets, encode)) == 130
    assert calls == [64, 64, 2]


@pytest.mark.parametrize(
    "vectors",
    [[], [[0.0] * 1023], [[float("nan")] * 1024]],
    ids=["count", "dim", "nan"],
)
def test_embed_rejects_bad_vectors(vectors):
    with pytest.raises(ValueError):
        backfill.embed([backfill.Target("u", 0, "t")], lambda _: vectors)
