"""임베딩 앱을 서비스 시간(한국 09~21시)에만 상시 가동한다.

`server/embed.py`의 `Embedder`는 상시 가동 0으로 배포된다. 이 앱이 10분마다 깨어나 지금이 서비스 시간이면
`min_containers=1`, 아니면 0으로 오토스케일러를 고친다. Modal 문서의 "스케줄 함수로 워밍 풀 조절"과 같은 방식이다.
`embed.py`를 다시 배포하면 오토스케일러가 배포 설정(0)으로 돌아가지만 이 앱이 10분 안에 다시 맞춘다.

GPU가 켜져 있는 시간만큼 비용이 든다. 끝 날짜(`WARM_UNTIL`)를 지나면 낮에도 켜지 않으니, 더 쓰려면 값을 고쳐 다시 배포한다.
상시 가동을 켜 둘 환경에만 배포한다. ai/에서:

    uv run modal deploy --env fit-prod -m server.warm

멈추려면 `uv run modal app stop fit-embed-warm --env fit-prod`로 이 앱을 멈추고 `embed.py`를 다시 배포한다(0으로 돌아간다).
"""

from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta, timezone

import modal

KST = timezone(timedelta(hours=9))  # 한국은 서머타임이 없다
WARM_FROM_HOUR = 9
WARM_TO_HOUR = 21
"""한국 시각 [9시, 21시)에 켠다."""
WARM_UNTIL = date(2026, 11, 18)
"""이 날짜(한국 기준, 그날 포함)까지만 켠다. 운영 기간(11/06~11/18)이 끝나면 잊고 둬도 비용이 멈춘다."""


def warm_pool_size(now: datetime) -> int:
    """지금 상시 가동할 컨테이너 수(0 또는 1). `now`는 시간대가 있는 시각이다."""
    if now.tzinfo is None:
        raise ValueError("시간대가 있는 시각이 필요하다")
    local = now.astimezone(KST)
    on = local.date() <= WARM_UNTIL and WARM_FROM_HOUR <= local.hour < WARM_TO_HOUR
    return 1 if on else 0


def reconcile(now: datetime, update: Callable[[int], object]) -> int:
    """지금 시각에 맞는 수를 `update`로 적용하고 그 수를 돌려준다. 여러 번 불러도 같다."""
    size = warm_pool_size(now)
    update(size)
    return size


app = modal.App(
    "fit-embed-warm",
    image=modal.Image.debian_slim(python_version="3.12").add_local_python_source(
        "server"
    ),
)


# 크론은 UTC 기준이고 한국 시각은 위에서 계산한다
@app.function(schedule=modal.Cron("*/10 * * * *"))
def keep_warm() -> None:
    embedder = modal.Cls.from_name("fit-embed", "Embedder")
    reconcile(
        datetime.now(UTC),
        lambda size: embedder().ping.autoscaler.update(min_containers=size),
    )
