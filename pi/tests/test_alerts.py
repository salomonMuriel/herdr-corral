from herdr_pi.alerts import Alerts
from herdr_pi.config import AlertsConfig
from herdr_pi.ntfy import Push
from herdr_pi.presence import Presence
from herdr_pi.store import AgentStore, now_ms


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class Harness:
    def __init__(self, away: bool = True) -> None:
        self.store = AgentStore(["desk"])
        self.clock = Clock()
        self.is_away = away
        self.pushes: list[Push] = []
        self.alerts = Alerts(self.store, AlertsConfig(), self.away, self.send, self.clock)
        self.store.subscribe(self.alerts.on_change)
        self.store.replace("desk", [agent("t1", "idle")])

    async def away(self) -> bool:
        return self.is_away

    async def send(self, push: Push) -> None:
        self.pushes.append(push)

    def status(self, state: str, msg: str | None = None) -> None:
        status = {"app": "claude-code", "state": state, **({"msg": msg} if msg else {})}
        self.store.apply("desk", "status", "t1", {"status": status})

    async def after(self, seconds: float) -> None:
        self.clock.now += seconds
        await self.alerts.tick()


def agent(address: str, state: str, **extra: object) -> dict[str, object]:
    labels = {"where": "herdr-projects / Phone alerts", "herdr.ask": "plan"}
    return {"address": address, "state": "live", "status": {"state": state}, "labels": labels, **extra}


async def test_finish_waits_out_the_debounce() -> None:
    harness = Harness()
    harness.status("working")
    harness.status("idle", "Merged and pushed")
    await harness.after(4)
    assert harness.pushes == []
    await harness.after(2)
    [push] = harness.pushes
    assert push.title == "herdr-projects / Phone alerts"
    assert push.message == "Finished on desk: Merged and pushed"
    assert push.click == "https://pi.example.ts.net:8096/agents/desk/t1"


async def test_a_finish_that_goes_back_to_work_is_dropped() -> None:
    harness = Harness()
    harness.status("working")
    harness.status("done")
    await harness.after(2)
    harness.status("working")
    await harness.after(10)
    assert harness.pushes == []


async def test_blocked_pushes_after_two_minutes_once() -> None:
    harness = Harness()
    harness.status("blocked")
    await harness.after(119)
    assert harness.pushes == []
    await harness.after(2)
    await harness.after(300)
    [push] = harness.pushes
    assert push.message == "Plan needs approval on desk"
    assert push.priority == 4


async def test_answered_in_time_sends_nothing() -> None:
    harness = Harness()
    harness.status("blocked")
    await harness.after(60)
    harness.status("working")
    await harness.after(120)
    assert harness.pushes == []


async def test_nothing_while_at_a_window() -> None:
    harness = Harness(away=False)
    harness.status("working")
    harness.status("done")
    await harness.after(6)
    assert harness.pushes == []
    assert harness.alerts.skipped == 1


async def test_idle_to_done_is_not_a_finish() -> None:
    harness = Harness()
    harness.status("done")
    await harness.after(6)
    assert harness.pushes == []


async def test_old_finishes_in_a_snapshot_are_ignored() -> None:
    harness = Harness()
    harness.store.replace("desk", [agent("t1", "working")])
    old = now_ms() - 3600_000
    harness.store.replace("desk", [agent("t1", "done", status_ms=old)])
    await harness.after(6)
    assert harness.pushes == []
    harness.store.replace("desk", [agent("t1", "working")])
    harness.store.replace("desk", [agent("t1", "done", status_ms=now_ms())])
    await harness.after(6)
    assert len(harness.pushes) == 1


def test_presence_needs_an_active_window_and_recent_input() -> None:
    assert Presence("laptop", "active", 30).is_here(120)
    assert not Presence("laptop", "active", 600).is_here(120)
    assert not Presence("laptop", "inactive", 1).is_here(120)
    assert not Presence("laptop", "closed").is_here(120)
    assert Presence("laptop", "active", None).is_here(120)
