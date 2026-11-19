from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from herdr_pi.attention import agents_view, need_of, screen_tail
from herdr_pi.board import Board
from herdr_pi.config import MachineConfig, Settings
from herdr_pi.remote import HcError
from herdr_pi.service import build_service
from herdr_pi.web import create_web_app

ME = {"Tailscale-User-Login": "me@example.com"}


class FakeRemote:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[str, ...]]] = []
        self.fail: HcError | None = None

    async def hc_json(self, machine: str, *args: str, timeout: float = 30.0) -> Any:
        self.calls.append((machine, args))
        if self.fail:
            raise self.fail
        if args[0] == "read":
            return {"text": "line one\nline two\n\n\n"}
        return {"status": "idle", "turn": 3}


@pytest.fixture
def setup(tmp_path: Path) -> tuple[TestClient, FakeRemote]:
    settings = Settings(
        machines=[MachineConfig(name="desk", ssh="me@desk")],
        data_dir=tmp_path,
        web_logins=["me@example.com"],
    )
    service = build_service(settings, "test")
    remote = FakeRemote()
    service.remote = remote  # type: ignore[assignment]
    service.store.replace("desk", [
        {"address": "t1", "state": "live", "turn": 2, "status": {"state": "blocked"}, "labels": {"herdr.ask": "permission"}},
        {"address": "t2", "state": "live", "turn": 1, "status": {"state": "working"}, "labels": {}},
    ])
    return TestClient(create_web_app(service, Board(settings.board_config))), remote


def test_only_listed_logins_get_in(setup: tuple[TestClient, FakeRemote]) -> None:
    client, _ = setup
    assert client.get("/").status_code == 403
    assert client.get("/", headers={"Tailscale-User-Login": "someone@example.com"}).status_code == 403
    page = client.get("/agents/desk/t1", headers=ME)
    assert page.status_code == 200
    assert "<title>Herdr</title>" in page.text
    assert client.get("/static/page.js", headers=ME).status_code == 200
    assert client.get("/static/..%2Fweb.py", headers=ME).status_code == 404


def test_agents_put_blocked_first_with_what_they_ask(setup: tuple[TestClient, FakeRemote]) -> None:
    client, _ = setup
    agents = client.get("/api/agents", headers=ME).json()["agents"]
    assert [(agent["address"], agent["need"], agent["ask"]) for agent in agents] == [
        ("t1", "blocked", "permission"),
        ("t2", None, None),
    ]


def test_screen_returns_the_tail(setup: tuple[TestClient, FakeRemote]) -> None:
    client, remote = setup
    assert client.get("/api/screen/desk/t1", headers=ME).json() == {"lines": ["line one", "line two"]}
    assert remote.calls == [("desk", ("read", "t1", "--lines", "0"))]


def test_send_and_keys_reach_hc(setup: tuple[TestClient, FakeRemote]) -> None:
    client, remote = setup
    sent = client.post("/api/send", headers=ME, json={"machine": "desk", "address": "t1", "text": "yes", "force": True})
    assert sent.status_code == 200
    pressed = client.post("/api/keys", headers=ME, json={"machine": "desk", "address": "t1", "keys": ["2"]})
    assert pressed.status_code == 200
    assert remote.calls == [
        ("desk", ("send", "t1", "yes", "--force")),
        ("desk", ("keys", "t1", "2")),
    ]


def test_writes_are_checked(setup: tuple[TestClient, FakeRemote]) -> None:
    client, remote = setup
    target = {"machine": "desk", "address": "t1"}
    assert client.post("/api/keys", headers=ME, json={**target, "keys": ["f5"]}).status_code == 400
    assert client.post("/api/send", headers=ME, json={**target, "address": "t9", "text": "x"}).status_code == 404
    cross_site = {**ME, "Origin": "https://evil.example"}
    assert client.post("/api/send", headers=cross_site, json={**target, "text": "x"}).status_code == 403
    form = client.post("/api/send", headers=ME, content=b"text=x", params={})
    assert form.status_code == 403
    assert remote.calls == []


def test_hc_errors_come_back_readable(setup: tuple[TestClient, FakeRemote]) -> None:
    client, remote = setup
    remote.fail = HcError("desk", "blocked", "t1 is waiting on a dialog")
    response = client.post("/api/send", headers=ME, json={"machine": "desk", "address": "t1", "text": "x"})
    assert response.status_code == 502
    assert response.json()["error"] == "t1 is waiting on a dialog"


def test_waiting_matches_the_mod() -> None:
    idle = {"state": "live", "status": {"state": "idle"}, "turn": 0, "status_ms": 1_000}
    assert need_of(idle, now=10_000) is None
    assert need_of(idle, now=20_000) == "waiting"
    assert need_of({**idle, "turn": 1}, now=1_000) == "waiting"
    assert need_of({**idle, "state": "finished", "turn": 1}) is None
    finished = {**idle, "id": "m/t1", "machine": "m", "address": "t1", "state": "finished"}
    assert agents_view([finished]) == []


def test_screen_tail_drops_blank_bottom_lines() -> None:
    text = "\n".join(f"row {n}" for n in range(40)) + "\n  \n"
    assert screen_tail(text) == [f"row {n}" for n in range(10, 40)]


def test_seen_and_snoozed_agents_drop_out_like_the_mod() -> None:
    waiting = {"state": "live", "status": {"state": "idle"}, "turn": 3, "status_ms": 1_000, "labels": {"herdr.seen": "waiting:3"}}
    assert need_of(waiting, now=5_000) is None
    assert need_of({**waiting, "turn": 4}, now=5_000) == "waiting"
    blocked = {**waiting, "status": {"state": "blocked"}, "labels": {"herdr.seen": "blocked:1000"}}
    assert need_of(blocked, now=5_000) is None
    assert need_of({**blocked, "status_ms": 2_000}, now=5_000) == "blocked"
    snoozed = {**waiting, "labels": {"herdr.snooze": "9000"}}
    assert need_of(snoozed, now=5_000) is None
    assert need_of(snoozed, now=10_000) == "waiting"
