import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from herdr_pi.approvals import Approvals
from herdr_pi.board import Board
from herdr_pi.config import MachineConfig, Settings
from herdr_pi.service import Service, build_service
from herdr_pi.store import Change
from herdr_pi.web import create_web_app

ME = {"Tailscale-User-Login": "me@example.com"}
REQUEST = {
    "machine": "desk",
    "address": "t1",
    "tool": "Bash",
    "summary": "Push the branch",
    "detail": "git push",
    "cwd": "/home/me/git/repo",
    "always_label": "Bash(git push:*)",
    "wait_seconds": 900,
}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def open_one(approvals: Approvals, wait: float = 60) -> str:
    return approvals.open("m", "t1", "Bash", "", "ls", "/", None, wait).id


def blocked_change(before: str, after: str | None) -> Change:
    record = (lambda state: {"address": "t1", "status": {"state": state}})
    return Change("m", "t1", "status", record(before), record(after) if after else None)


@pytest.fixture
def service(tmp_path: Path) -> Service:
    settings = Settings(
        machines=[MachineConfig(name="desk", ssh="x"), MachineConfig(name="laptop", ssh="y")],
        data_dir=tmp_path,
        web_logins=["me@example.com"],
    )
    built = build_service(settings, "test")
    built.store.replace("desk", [
        {"address": "t1", "state": "live", "turn": 2, "status": {"state": "blocked"}, "labels": {"herdr.seen": "blocked:0"}},
    ])
    built.store.replace("laptop", [{"address": "tb4", "state": "live", "turn": 1, "status": {"state": "working"}}])
    return built


@pytest.fixture
def client(service: Service) -> TestClient:
    return TestClient(create_web_app(service, Board(service.settings.board_config)))


def test_an_answer_reaches_the_waiting_hook(client: TestClient) -> None:
    opened = client.post("/api/approvals", headers=ME, json=REQUEST).json()
    assert opened["state"] == "pending"
    answered = client.post(f"/api/approvals/{opened['id']}/answer", headers=ME, json={"decision": "deny", "message": " no "})
    assert answered.json()["state"] == "deny"
    read = client.get(f"/api/approvals/{opened['id']}", headers=ME, params={"wait": 20}).json()
    assert (read["state"], read["message"]) == ("deny", "no")
    again = client.post(f"/api/approvals/{opened['id']}/answer", headers=ME, json={"decision": "allow"})
    assert again.status_code == 409


def test_a_pending_request_puts_its_agent_on_the_page(client: TestClient) -> None:
    before = client.get("/api/agents", headers=ME).json()["agents"]
    assert [agent["need"] for agent in before if agent["address"] == "t1"] == [None]
    opened = client.post("/api/approvals", headers=ME, json=REQUEST).json()
    agent = next(a for a in client.get("/api/agents", headers=ME).json()["agents"] if a["address"] == "t1")
    assert agent["need"] == "blocked"
    assert agent["approval"]["id"] == opened["id"]
    client.post(f"/api/approvals/{opened['id']}/withdraw", headers=ME, json={})
    agent = next(a for a in client.get("/api/agents", headers=ME).json()["agents"] if a["address"] == "t1")
    assert agent["approval"] is None


def test_a_wrong_machine_name_is_fixed_by_the_terminal_id(client: TestClient) -> None:
    opened = client.post("/api/approvals", headers=ME, json={**REQUEST, "machine": "Someones-Air", "address": "tb4"}).json()
    assert opened["machine"] == "laptop"


def test_only_the_owner_can_open_or_answer(client: TestClient) -> None:
    assert client.post("/api/approvals", json=REQUEST).status_code == 403
    opened = client.post("/api/approvals", headers=ME, json=REQUEST).json()
    cross_site = {**ME, "Origin": "https://evil.example"}
    assert client.post(f"/api/approvals/{opened['id']}/answer", headers=cross_site, json={"decision": "allow"}).status_code == 403
    assert client.get("/api/approvals/nope", headers=ME).status_code == 404


async def test_wait_returns_when_answered() -> None:
    approvals = Approvals()
    approval = approvals.get(open_one(approvals))
    assert approval is not None
    waiting = asyncio.create_task(approvals.wait(approval, 5))
    await asyncio.sleep(0.01)
    approvals.answer(approval.id, "allow", None)
    assert (await asyncio.wait_for(waiting, 1)).state == "allow"


def test_requests_expire_and_are_forgotten() -> None:
    clock = Clock()
    approvals = Approvals(clock)
    approval_id = open_one(approvals, wait=60)
    clock.now += 61
    approval = approvals.get(approval_id)
    assert approval is not None and approval.state == "expired"
    clock.now += 600
    assert approvals.get(approval_id) is None


def test_answering_in_the_terminal_withdraws_the_request() -> None:
    clock = Clock()
    approvals = Approvals(clock)
    approval_id = open_one(approvals)
    approvals.on_change(blocked_change("working", "blocked"))
    clock.now += 1
    # The next prompt can come up just as the last one is answered.
    approvals.on_change(blocked_change("blocked", "working"))
    assert approvals.items[approval_id].state == "pending"
    clock.now += 10
    approvals.on_change(blocked_change("blocked", "working"))
    assert approvals.items[approval_id].state == "withdrawn"


def test_a_closed_terminal_withdraws_its_request() -> None:
    clock = Clock()
    approvals = Approvals(clock)
    approval_id = open_one(approvals)
    clock.now += 10
    approvals.on_change(blocked_change("working", None))
    assert approvals.items[approval_id].state == "withdrawn"
