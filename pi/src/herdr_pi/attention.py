from typing import Any

from herdr_pi.coordination import asked_at, coordinator_ask, handled_by_coordinator, is_coordinator, live_coordinators
from herdr_pi.store import now_ms

Record = dict[str, Any]

# Mirrors mods/projects/attention.js: a fresh agent sits idle briefly before its first task.
STARTUP_QUIET_MS = 15_000
SCREEN_LINES = 30
SEEN_LABEL = "herdr.seen"
SNOOZE_LABEL = "herdr.snooze"


def status_word(record: Record) -> str | None:
    status = record.get("status")
    return status.get("state") if isinstance(status, dict) else None


def raw_need(record: Record, now: int, live: frozenset[str] = frozenset()) -> str | None:
    if record.get("state") == "finished" or handled_by_coordinator(record, set(live)):
        return None
    word = status_word(record)
    if word == "blocked":
        return "blocked"
    if is_coordinator(record):
        return "waiting" if coordinator_ask(record) else None
    if word not in ("idle", "done"):
        return None
    if (record.get("turn") or 0) > 0:
        return "waiting"
    quiet = now - (record.get("status_ms") or 0)
    return "waiting" if quiet > STARTUP_QUIET_MS else None


def state_key(record: Record, need: str) -> str:
    """Mirrors stateKey in mods/projects/needs-you.js."""
    if need == "blocked":
        return f"blocked:{record.get('status_ms') or 0}"
    if is_coordinator(record):
        return f"ask:{asked_at(record)}"
    return f"waiting:{record.get('turn') or 0}"


def put_aside(record: Record, need: str, now: int) -> bool:
    labels = record.get("labels") or {}
    if labels.get(SEEN_LABEL) == state_key(record, need):
        return True
    try:
        return int(labels.get(SNOOZE_LABEL) or 0) > now
    except ValueError:
        return False


def need_of(record: Record, now: int | None = None, live: frozenset[str] = frozenset()) -> str | None:
    """'blocked' when a prompt waits on the person, 'waiting' when the agent sits at its prompt,
    unless the person marked it seen in this state or snoozed it. `live` holds the projects with
    a live coordinator, whose workers go to it instead."""
    moment = now or now_ms()
    need = raw_need(record, moment, live)
    if need is None or put_aside(record, need, moment):
        return None
    return need


def ask_of(record: Record) -> str | None:
    if status_word(record) != "blocked":
        return None
    return (record.get("labels") or {}).get("herdr.ask")


def agent_view(
    record: Record, now: int | None = None, approval: Record | None = None, live: frozenset[str] = frozenset()
) -> Record:
    status = record.get("status") or {}
    labels = record.get("labels") or {}
    foreground = record.get("foreground") or {}
    return {
        "id": record["id"],
        "machine": record["machine"],
        "address": record["address"],
        "title": record.get("name") or record.get("title") or labels.get("where") or record["address"],
        "where": labels.get("where"),
        "cwd": foreground.get("cwd") or record.get("cwd"),
        "app": status.get("app"),
        "state": status.get("state"),
        "msg": coordinator_ask(record) or status.get("msg"),
        "ask": ask_of(record),
        # A request the page can answer shows even when the agent was marked seen or snoozed.
        "need": "blocked" if approval else need_of(record, now, live),
        "approval": approval,
        "turn": record.get("turn") or 0,
        "status_ms": record.get("status_ms"),
    }


def agents_view(records: list[Record], now: int | None = None, approvals: dict[str, Record] | None = None) -> list[Record]:
    order = {"blocked": 0, "waiting": 1, None: 2}
    pending = approvals or {}
    live = frozenset(live_coordinators(records))
    views = [
        agent_view(record, now, pending.get(record["id"]), live)
        for record in records
        if record.get("state") != "finished"
    ]
    return sorted(views, key=lambda view: (order[view["need"]], -(view["status_ms"] or 0)))


def screen_tail(text: str, lines: int = SCREEN_LINES) -> list[str]:
    rows = [row.rstrip() for row in text.replace("\xa0", " ").split("\n")]
    while rows and not rows[-1]:
        rows.pop()
    return rows[-lines:]
