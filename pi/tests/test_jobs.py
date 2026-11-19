import asyncio
from datetime import datetime, time, timezone

import pytest

from herdr_pi.jobs import Job, JobBusy, JobRunner


async def nothing() -> None:
    return None


def test_daily_job_runs_today_or_tomorrow() -> None:
    job = Job("nightly", nothing, daily_at=time(3, 0))
    before = datetime(2026, 11, 5, 2, 0, tzinfo=timezone.utc)
    after = datetime(2026, 11, 5, 4, 0, tzinfo=timezone.utc)
    assert job.next_after(before) == datetime(2026, 11, 5, 3, 0, tzinfo=timezone.utc)
    assert job.next_after(after) == datetime(2026, 11, 6, 3, 0, tzinfo=timezone.utc)


def test_job_needs_one_schedule() -> None:
    with pytest.raises(ValueError):
        Job("both", nothing, every=60, daily_at=time(3, 0))


async def test_a_job_never_runs_twice_at_once() -> None:
    release = asyncio.Event()

    async def slow() -> str:
        await release.wait()
        return "finished"

    runner = JobRunner([Job("slow", slow, every=60)])
    first = asyncio.create_task(runner.run_now("slow"))
    await asyncio.sleep(0)
    with pytest.raises(JobBusy):
        await runner.run_now("slow")
    release.set()
    await first
    assert runner.summary()[0]["result"] == "finished"


async def test_a_failing_job_records_the_error() -> None:
    async def broken() -> None:
        raise RuntimeError("board unreachable")

    runner = JobRunner([Job("broken", broken, every=60)])
    await runner.run_now("broken")
    summary = runner.summary()[0]
    assert summary["ok"] is False
    assert summary["result"] == "RuntimeError: board unreachable"
