from datetime import UTC, datetime, timedelta, timezone

import pytest

from server import warm

KST = timezone(timedelta(hours=9))


@pytest.mark.parametrize(
    ("local", "size"),
    [
        (datetime(2026, 11, 6, 8, 59, tzinfo=KST), 0),
        (datetime(2026, 11, 6, 9, 0, tzinfo=KST), 1),
        (datetime(2026, 11, 6, 20, 59, tzinfo=KST), 1),
        (datetime(2026, 11, 6, 21, 0, tzinfo=KST), 0),
        (datetime(2026, 11, 6, 22, 30, tzinfo=KST), 0),
        (datetime(2026, 11, 6, 3, 0, tzinfo=KST), 0),
        # 끝 날짜는 그날 밤 9시 전까지 켜고, 다음 날부터는 낮에도 끈다(잊고 둬도 비용이 멈춘다)
        (datetime(2026, 11, 18, 20, 59, tzinfo=KST), 1),
        (datetime(2026, 11, 19, 12, 0, tzinfo=KST), 0),
    ],
)
def test_warm_pool_size_follows_service_hours_in_korea(local, size):
    # 서버 시계는 UTC라서, UTC로 바꿔 넣어도 한국 시각으로 판단하는지 본다
    assert warm.warm_pool_size(local.astimezone(UTC)) == size


def test_warm_pool_size_rejects_a_naive_time():
    # 시간대 없는 시각은 서버의 지역 시간대로 잘못 읽히기 쉽다
    with pytest.raises(ValueError):
        warm.warm_pool_size(datetime(2026, 11, 6, 12, 0))


def test_reconcile_sets_the_pool_for_the_current_time():
    calls: list[int] = []

    day = datetime(2026, 11, 6, 3, 0, tzinfo=UTC)  # 한국 12:00
    night = datetime(2026, 11, 6, 12, 30, tzinfo=UTC)  # 한국 21:30
    assert warm.reconcile(day, calls.append) == 1
    assert warm.reconcile(night, calls.append) == 0
    assert calls == [1, 0]
