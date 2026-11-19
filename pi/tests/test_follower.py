from pathlib import Path

from herdr_pi.config import MachineConfig, Settings
from herdr_pi.follower import Follower
from herdr_pi.remote import Remote
from herdr_pi.store import AgentStore, Change


def make_follower() -> tuple[Follower, AgentStore, list[Change]]:
    settings = Settings(machines=[MachineConfig(name="desk", ssh="me@desk")], data_dir=Path("/tmp"))
    store = AgentStore(["desk"])
    changes: list[Change] = []
    store.subscribe(changes.append)
    return Follower("desk", Remote(settings), store, 45), store, changes


def terminal(address: str, **extra: object) -> dict[str, object]:
    return {"address": address, "state": "live", "status": None, "turn": 0, "labels": {}, **extra}


def event(seq: int, address: str, kind: str, data: dict[str, object]) -> dict[str, object]:
    return {"jsonrpc": "2.0", "method": "event", "params": {"seq": seq, "terminal": address, "type": kind, "data": data}}


def test_snapshot_keeps_only_own_terminals() -> None:
    follower, store, _ = make_follower()
    follower.handle({"channel": None, "seq": 10, "terminals": [terminal("t1"), terminal("laptop/t1")]})
    assert [record["id"] for record in store.terminals()] == ["desk/t1"]
    assert store.machines["desk"].connected


def test_events_update_and_remove_terminals() -> None:
    follower, store, changes = make_follower()
    follower.handle({"seq": 10, "terminals": [terminal("t1")]})
    status = {"app": "claude-code", "msg": "Reading", "state": "working"}
    follower.handle(event(11, "t1", "status", {"records": {}, "reported": True, "status": status}))
    follower.handle(event(12, "t1", "turn", {"state": "done", "turn": 4}))
    follower.handle(event(13, "t1", "labels", {"labels": {"herdr.tab": "tb1"}}))
    record = store.terminals()[0]
    assert record["status"] == status
    assert record["turn"] == 4
    assert record["turn_state"] == "done"
    assert record["state"] == "live"
    assert record["labels"] == {"herdr.tab": "tb1"}
    assert store.agents()[0]["id"] == "desk/t1"
    follower.handle(event(14, "t1", "finished", {"exit_code": 3, "reason": "exited", "signal": None}))
    assert store.terminals()[0]["state"] == "finished"
    follower.handle(event(15, "t1", "removed", {}))
    assert store.terminals() == []
    assert [change.kind for change in changes][-2:] == ["finished", "removed"]


def test_created_event_carries_the_full_record() -> None:
    follower, store, _ = make_follower()
    follower.handle({"seq": 1, "terminals": []})
    follower.handle(event(2, "t9", "created", terminal("t9", name="evtest")))
    assert store.terminals()[0]["name"] == "evtest"


def test_old_and_relayed_events_are_ignored() -> None:
    follower, store, changes = make_follower()
    follower.handle({"seq": 10, "terminals": [terminal("t1")]})
    changes.clear()
    follower.handle(event(9, "t1", "title", {"title": "stale"}))
    follower.handle(event(11, "laptop/t1", "title", {"title": "elsewhere"}))
    follower.handle({"jsonrpc": "2.0", "method": "heartbeat", "params": {"seq": 11}})
    assert changes == []
    assert store.terminals()[0].get("title") is None


def test_fresh_snapshot_reports_what_changed_while_away() -> None:
    follower, store, changes = make_follower()
    follower.handle({"seq": 10, "terminals": [terminal("t1"), terminal("t2")]})
    changes.clear()
    follower.handle({"seq": 3, "terminals": [terminal("t1", status={"state": "blocked"})]})
    assert {(change.address, change.after is None) for change in changes} == {("t1", False), ("t2", True)}
    follower.handle(event(4, "t1", "title", {"title": "after restart"}))
    assert store.terminals()[0]["title"] == "after restart"
