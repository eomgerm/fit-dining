"""가입 때 벡터를 받지 못한 직접 입력 칩에 벡터를 채우는 SQL을 만든다(S15P31A302-166).

    cd ai && DATABASE_URL=<읽기 URL> uv run python scripts/backfill_taste_vectors.py --dry-run   # 대상 수만
    cd ai && DATABASE_URL=<읽기 URL> uv run python scripts/backfill_taste_vectors.py > <저장소 밖>/vectors.sql
    psql "<BE 앱 계정 URL>" -v ON_ERROR_STOP=1 -f <저장소 밖>/vectors.sql

대상은 `user_preferences.tastes`에서 `code` 키가 있고 값이 null이며, LIKE이고 `vector`가 없는
칩이다(profile-storage spec `tastes`). `code` 키가 없는 칩은 코드를 붙이기 전의 온보딩 원본이라
코드표에 있는 취향인지 알 수 없다. 건드리지 않고 수만 알린다. 읽기는 AI 계정으로 되고(`user_preferences`
SELECT), 쓰기는 BE 앱 계정이 한다. 인코딩은 `fit_ai.embedding.encode_queries`라 `EMBED_*`가 있으면
Modal을 부른다. 개수는 stderr로 낸다.

SQL은 칩 위치로 `vector`만 채운다. 그 사이 칩이 바뀌었으면 건너뛰도록 같은 위치의 극성·코드·벡터 없음과
라벨의 md5를 조건으로 건다. 라벨 원문은 SQL에 넣지 않는다. 출력에는 회원 id와 취향 문장의 벡터가 있어
저장소 밖에 쓰고 적용 뒤 지운다.
"""

import argparse
import hashlib
import math
import os
import sys
from collections.abc import Callable, Iterable
from typing import NamedTuple

BATCH = 64  # Modal `/embed` 요청당 텍스트 상한(design 12.3절)
DIM = 1024  # `tastes[].vector` 차원. BE `AiTasteClient`도 같은 값을 검사한다


class Target(NamedTuple):
    user_id: str
    index: int
    label: str


def scan(rows: Iterable[tuple[str, list[dict] | None]]) -> tuple[list[Target], int]:
    """채울 칩과 `code` 키가 없는 예전 칩의 수를 센다."""
    targets, legacy = [], 0
    for user_id, tastes in rows:
        for i, c in enumerate(tastes or []):
            if "code" not in c:
                legacy += 1
            elif (
                c["code"] is None
                and c["polarity"] == "LIKE"
                and c.get("vector") is None
            ):
                targets.append(Target(user_id, i, c["label"]))
    return targets, legacy


def embed(
    targets: list[Target], encode: Callable[[list[str]], list[list[float]]]
) -> list[list[float]]:
    vectors: list[list[float]] = []
    for start in range(0, len(targets), BATCH):
        vectors += encode([t.label for t in targets[start : start + BATCH]])
    if len(vectors) != len(targets) or any(
        len(v) != DIM or not all(map(math.isfinite, v)) for v in vectors
    ):
        raise ValueError("벡터 개수나 차원이 맞지 않는다")
    return vectors


def md5_hex(text: str) -> str:
    # Postgres md5()는 UTF-8 바이트를 해시한다
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def _literal(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def to_sql(targets: list[Target], vectors: list[list[float]]) -> str:
    lines = ["BEGIN;"]
    for t, vector in zip(targets, vectors, strict=True):
        v = "[" + ",".join(repr(float(x)) for x in vector) + "]"
        chip = f"tastes->{t.index}"
        lines.append(
            f"UPDATE user_preferences SET tastes = jsonb_set(tastes, '{{{t.index},vector}}', '{v}'::jsonb)"
            f" WHERE user_id = {_literal(t.user_id)}"
            f" AND {chip}->>'polarity' = 'LIKE' AND {chip}->'code' = 'null'::jsonb"
            f" AND coalesce({chip}->'vector', 'null'::jsonb) = 'null'::jsonb"
            f" AND md5({chip}->>'label') = '{md5_hex(t.label)}';"
        )
    lines.append("COMMIT;")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="대상 수만 센다")
    args = parser.parse_args()

    import psycopg

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        rows = conn.execute(
            "SELECT user_id, tastes FROM user_preferences WHERE tastes IS NOT NULL"
        ).fetchall()
    targets, legacy = scan(rows)
    users = len({t.user_id for t in targets})
    print(
        f"targets={len(targets)} users={users} legacy_without_code={legacy}",
        file=sys.stderr,
    )
    if args.dry_run or not targets:
        return

    from fit_ai import embedding

    sys.stdout.write(to_sql(targets, embed(targets, embedding.encode_queries)))


if __name__ == "__main__":
    main()
