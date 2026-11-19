import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

from herdr_pi.config import AlertsConfig
from herdr_pi.coordination import coordinator_ask, handled_by_coordinator, is_coordinator, live_coordinators
from herdr_pi.ntfy import Push
from herdr_pi.store import AgentStore, Change, now_ms

log = logging.getLogger(__name__)

Record = dict[str, Any]
Kind = Literal["blocked", "finished"]
Key = tuple[str, str]

FINISHED = ("done", "idle")
# A finish found by a snapshot (after a reconnect or a restart) older than this is old news.
STALE_SNAPSHOT_MS = 10 * 60 * 1000
ASKS = {"plan": "Plan needs approval", "question": "Has a question", "permission": "Needs permission"}
TICK_SECONDS = 1.0


@dataclass
class Pending:
    kind: Kind
    due: float


def status_of(record: Record | None) -> str | None:
    if not record:
        return None
    status = record.get("status")
    if isinstance(status, dict):
        return status.get("state")
    return status


# A live coordinator hears from its workers first; it only alerts when blocked or asking.
def left_to_coordinator(kind: Kind, record: Record, records: list[Record]) -> bool:
    if handled_by_coordinator(record, live_coordinators(records)):
        return True
    return is_coordinator(record) and kind == "finished" and not coordinator_ask(record)


def push_for(kind: Kind, machine: str, address: str, record: Record, agent_url: str) -> Push:
    labels = record.get("labels") or {}
    title = labels.get("where") or record.get("title") or address
    click = agent_url.format(machine=machine, address=address)
    if kind == "finished" and coordinator_ask(record):
        return Push(title, f"Asks: {coordinator_ask(record)}", click, ["raising_hand"], priority=4)
    if kind == "blocked":
        asks = ASKS.get(labels.get("herdr.ask", ""), "Needs you")
        return Push(title, f"{asks} on {machine}", click, ["raising_hand"], priority=4)
    status = record.get("status")
    said = status.get("msg") if isinstance(status, dict) else None
    message = f"Finished on {machine}" + (f": {said}" if said else "")
    return Push(title, message, click, ["white_check_mark"])


class Alerts:
    """Phone pushes for agents blocked a while, or finished, while the person is away."""

    def __init__(
        self,
        store: AgentStore,
        config: AlertsConfig,
        away: Callable[[], Awaitable[bool]],
        send: Callable[[Push], Awaitable[None]],
        clock: Callable[[], float] = time.monotonic,
    ):
        self.store = store
        self.config = config
        self.away = away
        self.send = send
        self.clock = clock
        self.pending: dict[Key, Pending] = {}
        self.sent = 0
        self.skipped = 0
        self.last_push: Record | None = None
        self.last_error: str | None = None

    def on_change(self, change: Change) -> None:
        before, after = status_of(change.before), status_of(change.after)
        if before == after:
            return
        key = (change.machine, change.address)
        self.pending.pop(key, None)
        if after == "blocked":
            self.wait(key, "blocked", self.config.blocked_seconds)
        elif before == "working" and after in FINISHED and self.is_fresh(change):
            self.wait(key, "finished", self.config.finished_seconds)

    def wait(self, key: Key, kind: Kind, seconds: float) -> None:
        self.pending[key] = Pending(kind, self.clock() + seconds)

    def is_fresh(self, change: Change) -> bool:
        if change.kind != "snapshot" or not change.after:
            return True
        changed_ms = change.after.get("status_ms")
        return changed_ms is None or now_ms() - changed_ms < STALE_SNAPSHOT_MS

    async def run(self) -> None:
        while True:
            await asyncio.sleep(TICK_SECONDS)
            try:
                await self.tick()
            except Exception as error:
                log.exception("alerts tick failed")
                self.last_error = f"{type(error).__name__}: {error}"

    async def tick(self) -> None:
        now = self.clock()
        for key in [key for key, pending in self.pending.items() if pending.due <= now]:
            pending = self.pending.pop(key)
            await self.deliver(key, pending.kind)

    async def deliver(self, key: Key, kind: Kind) -> None:
        machine, address = key
        record = self.store.machines[machine].terminals.get(address)
        if record is None or left_to_coordinator(kind, record, self.store.terminals()):
            return
        if not await self.away():
            self.skipped += 1
            log.info("%s/%s %s, but you're at a window", machine, address, kind)
            return
        push = push_for(kind, machine, address, record, self.config.agent_url)
        await self.publish(push)

    async def publish(self, push: Push) -> None:
        try:
            await self.send(push)
        except OSError as error:
            self.last_error = f"ntfy: {error}"
            log.warning("push failed: %s", error)
            return
        self.sent += 1
        self.last_error = None
        self.last_push = {"at_ms": now_ms(), "title": push.title, "message": push.message, "click": push.click}

    def summary(self) -> Record:
        pending = [
            {"id": f"{machine}/{address}", "kind": item.kind, "in_seconds": round(item.due - self.clock(), 1)}
            for (machine, address), item in self.pending.items()
        ]
        return {
            "pending": pending,
            "sent": self.sent,
            "skipped_present": self.skipped,
            "last_push": self.last_push,
            "last_error": self.last_error,
        }
