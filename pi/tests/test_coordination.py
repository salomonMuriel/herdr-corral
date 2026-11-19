from herdr_pi.alerts import Alerts
from herdr_pi.attention import agents_view
from herdr_pi.config import AlertsConfig
from herdr_pi.ntfy import Push
from herdr_pi.store import AgentStore

COORDINATOR = {"herdr.coordinator": "herdr"}
WORKER = {"herdr.coordinated": "herdr"}


def terminal(address: str, state: str, labels: dict[str, str], turn: int = 3) -> dict[str, object]:
    return {"address": address, "state": "live", "status": {"state": state}, "labels": labels, "turn": turn}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class Harness:
    def __init__(self, records: list[dict[str, object]]) -> None:
        self.store = AgentStore(["desk"])
        self.clock = Clock()
        self.pushes: list[Push] = []
        self.alerts = Alerts(self.store, AlertsConfig(), self.away, self.send, self.clock)
        self.store.subscribe(self.alerts.on_change)
        self.store.replace("desk", records)

    async def away(self) -> bool:
        return True

    async def send(self, push: Push) -> None:
        self.pushes.append(push)

    def status(self, address: str, state: str) -> None:
        self.store.apply("desk", "status", address, {"status": {"app": "claude-code", "state": state}})

    def label(self, address: str, labels: dict[str, str]) -> None:
        self.store.machines["desk"].terminals[address]["labels"] = labels

    async def after(self, seconds: float) -> None:
        self.clock.now += seconds
        await self.alerts.tick()


async def test_a_coordinated_worker_finishing_pushes_nothing() -> None:
    harness = Harness([terminal("t1", "idle", COORDINATOR), terminal("t2", "idle", WORKER)])
    harness.status("t2", "working")
    harness.status("t2", "idle")
    await harness.after(10)
    assert harness.pushes == []


async def test_a_worker_alerts_again_once_its_coordinator_is_gone() -> None:
    harness = Harness([terminal("t2", "idle", WORKER)])
    harness.status("t2", "working")
    harness.status("t2", "idle")
    await harness.after(10)
    assert len(harness.pushes) == 1


async def test_a_coordinator_finishing_a_turn_pushes_only_with_a_question() -> None:
    harness = Harness([terminal("t1", "idle", COORDINATOR)])
    harness.status("t1", "working")
    harness.status("t1", "idle")
    await harness.after(10)
    assert harness.pushes == []
    harness.status("t1", "working")
    harness.label("t1", {**COORDINATOR, "herdr.coordinator.ask": "Which plan?", "herdr.coordinator.asked": "5"})
    harness.status("t1", "idle")
    await harness.after(10)
    [push] = harness.pushes
    assert push.message == "Asks: Which plan?"


def test_the_page_leaves_coordinated_workers_out() -> None:
    records = [
        {**terminal("t1", "idle", COORDINATOR), "machine": "desk", "id": "desk/t1"},
        {**terminal("t2", "idle", WORKER), "machine": "desk", "id": "desk/t2"},
        {**terminal("t3", "idle", {}), "machine": "desk", "id": "desk/t3"},
    ]
    needs = {view["address"]: view["need"] for view in agents_view(records, now=10**13)}
    assert needs == {"t1": None, "t2": None, "t3": "waiting"}


def test_the_page_shows_a_coordinator_question_until_seen() -> None:
    asking = {**COORDINATOR, "herdr.coordinator.ask": "Ship it?", "herdr.coordinator.asked": "7"}
    record = {**terminal("t1", "idle", asking), "machine": "desk", "id": "desk/t1"}
    [view] = agents_view([record], now=10**13)
    assert (view["need"], view["msg"]) == ("waiting", "Ship it?")
    record["labels"] = {**asking, "herdr.seen": "ask:7"}
    [view] = agents_view([record], now=10**13)
    assert view["need"] is None
