from typing import Any

Record = dict[str, Any]

FULL_RECORD_KINDS = ("created", "restarted")


def apply_event(record: Record | None, kind: str, address: str, data: Record) -> Record | None:
    """The terminal record after one hc event; None once the terminal is removed."""
    if kind == "removed":
        return None
    if kind in FULL_RECORD_KINDS and "address" in data:
        return dict(data)
    updated: Record = dict(record) if record else {"address": address}
    if kind == "foreground":
        updated["foreground"] = data
    elif kind == "turn":
        # The turn event's "state" is the agent's word (done, idle), not the terminal's live/finished.
        updated["turn"] = data.get("turn", updated.get("turn"))
        if "state" in data:
            updated["turn_state"] = data["state"]
    elif kind == "finished":
        updated.update(data)
        updated["state"] = "finished"
    else:
        updated.update(data)
    return updated


def is_own(address: str) -> bool:
    """hc events also relays the terminals of machines this one is connected to, as machine/t7."""
    return "/" not in address
