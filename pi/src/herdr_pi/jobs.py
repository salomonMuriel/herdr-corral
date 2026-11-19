import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from datetime import time as clock_time
from typing import Any

log = logging.getLogger(__name__)

JobFunction = Callable[[], Awaitable[str | None]]


@dataclass
class Job:
    """A job runs every `every` seconds or daily at `daily_at` (Pi local time), never twice at once."""

    name: str
    run: JobFunction
    every: float | None = None
    daily_at: clock_time | None = None
    run_at_start: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)
    started_at: float | None = None
    finished_at: float | None = None
    ok: bool | None = None
    result: str | None = None
    next_at: float | None = None

    def __post_init__(self) -> None:
        if (self.every is None) == (self.daily_at is None):
            raise ValueError(f"job {self.name} needs exactly one of every or daily_at")

    def next_after(self, moment: datetime) -> datetime:
        if self.every is not None:
            return moment + timedelta(seconds=self.every)
        assert self.daily_at is not None
        today = datetime.combine(moment.date(), self.daily_at, moment.tzinfo)
        return today if today > moment else today + timedelta(days=1)

    def summary(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "every": self.every,
            "daily_at": self.daily_at.isoformat() if self.daily_at else None,
            "running": self.lock.locked(),
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "ok": self.ok,
            "result": self.result,
            "next_at": self.next_at,
        }


class JobBusy(Exception):
    pass


class JobRunner:
    def __init__(self, jobs: list[Job]):
        self.jobs = {job.name: job for job in jobs}

    async def run_now(self, name: str) -> None:
        job = self.jobs[name]
        if job.lock.locked():
            raise JobBusy(name)
        await self.execute(job)

    async def execute(self, job: Job) -> None:
        async with job.lock:
            job.started_at = time.time()
            try:
                job.result = await job.run()
                job.ok = True
            except Exception as error:
                log.exception("job %s failed", job.name)
                job.result = f"{type(error).__name__}: {error}"
                job.ok = False
            job.finished_at = time.time()

    async def schedule(self, job: Job) -> None:
        if job.run_at_start:
            await self.execute(job)
        while True:
            now = datetime.now().astimezone()
            due = job.next_after(now)
            job.next_at = due.timestamp()
            await asyncio.sleep((due - now).total_seconds())
            if job.lock.locked():
                log.info("job %s still running, skipping this turn", job.name)
                continue
            await self.execute(job)

    def start(self) -> list[asyncio.Task[None]]:
        return [asyncio.create_task(self.schedule(job), name=f"job:{job.name}") for job in self.jobs.values()]

    def summary(self) -> list[dict[str, Any]]:
        return [job.summary() for job in self.jobs.values()]
