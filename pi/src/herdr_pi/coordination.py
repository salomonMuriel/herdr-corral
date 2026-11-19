"""Project coordinators, as their terminal labels tell (mods/projects/coordinator-labels.js).

A coordinator's terminal carries herdr.coordinator=<project>; each worker it started carries
herdr.coordinated=<project>. A worker whose coordinator is live goes to the coordinator, not
to the person. The coordinator needs the person only while blocked or while it has a question
it passed on with hb ask.
"""

from typing import Any

Record = dict[str, Any]

COORDINATOR = "herdr.coordinator"
COORDINATED = "herdr.coordinated"
ASK = "herdr.coordinator.ask"
ASKED = "herdr.coordinator.asked"


def labels_of(record: Record | None) -> dict[str, str]:
    return (record or {}).get("labels") or {}


def live_coordinators(records: list[Record]) -> set[str]:
    return {
        labels_of(record)[COORDINATOR]
        for record in records
        if labels_of(record).get(COORDINATOR) and record.get("state") != "finished"
    }


def is_coordinator(record: Record | None) -> bool:
    return bool(labels_of(record).get(COORDINATOR))


def handled_by_coordinator(record: Record | None, live: set[str]) -> bool:
    project = labels_of(record).get(COORDINATED)
    return bool(project) and project in live


def coordinator_ask(record: Record | None) -> str | None:
    return labels_of(record).get(ASK) or None


def asked_at(record: Record | None) -> int:
    try:
        return int(labels_of(record).get(ASKED) or 0)
    except ValueError:
        return 0
