import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from herdr_pi.events import apply_event

log = logging.getLogger(__name__)

Record = dict[str, Any]


@dataclass
class Change:
    machine: str
    address: str
    kind: str
    before: Record | None
    after: Record | None


@dataclass
class MachineState:
    connected: bool = False
    since_ms: int | None = None
    last_message_ms: int | None = None
    error: str | None = None
    hc_version: str | None = None
    terminals: dict[str, Record] = field(default_factory=dict)


Listener = Callable[[Change], None]


def now_ms() -> int:
    return int(time.time() * 1000)


class AgentStore:
    """Every terminal on every machine, as the latest hc events left it."""

    def __init__(self, machine_names: list[str]):
        self.machines = {name: MachineState() for name in machine_names}
        self.listeners: list[Listener] = []

    def subscribe(self, listener: Listener) -> None:
        self.listeners.append(listener)

    def emit(self, change: Change) -> None:
        for listener in self.listeners:
            try:
                listener(change)
            except Exception:
                log.exception("listener failed on %s %s/%s", change.kind, change.machine, change.address)

    def replace(self, machine: str, records: list[Record]) -> None:
        state = self.machines[machine]
        before = state.terminals
        after = {record["address"]: record for record in records}
        state.terminals = after
        self.mark_connected(machine)
        for address in before.keys() | after.keys():
            if before.get(address) != after.get(address):
                self.emit(Change(machine, address, "snapshot", before.get(address), after.get(address)))

    def apply(self, machine: str, kind: str, address: str, data: Record) -> None:
        state = self.machines[machine]
        state.last_message_ms = now_ms()
        before = state.terminals.get(address)
        after = apply_event(before, kind, address, data)
        if after is None:
            state.terminals.pop(address, None)
        else:
            state.terminals[address] = after
        self.emit(Change(machine, address, kind, before, after))

    def touch(self, machine: str) -> None:
        self.machines[machine].last_message_ms = now_ms()

    def mark_connected(self, machine: str) -> None:
        state = self.machines[machine]
        if not state.connected:
            state.since_ms = now_ms()
        state.connected = True
        state.error = None
        state.last_message_ms = now_ms()

    def mark_disconnected(self, machine: str, error: str) -> None:
        state = self.machines[machine]
        if state.connected:
            state.since_ms = now_ms()
        state.connected = False
        state.error = error

    def terminals(self, machine: str | None = None) -> list[Record]:
        names = [machine] if machine else list(self.machines)
        records = [
            {**record, "machine": name, "id": f"{name}/{address}"}
            for name in names
            for address, record in self.machines[name].terminals.items()
        ]
        return sorted(records, key=lambda record: (record["machine"], record.get("created_ms") or 0))

    def agents(self, machine: str | None = None) -> list[Record]:
        return [record for record in self.terminals(machine) if record.get("status")]

    def machine_summary(self) -> dict[str, Record]:
        return {
            name: {
                "connected": state.connected,
                "since_ms": state.since_ms,
                "last_message_ms": state.last_message_ms,
                "error": state.error,
                "hc_version": state.hc_version,
                "terminals": len(state.terminals),
            }
            for name, state in self.machines.items()
        }

    def dump(self) -> Record:
        return {name: {"terminals": state.terminals} for name, state in self.machines.items()}

    def load(self, saved: Record) -> None:
        for name, entry in saved.items():
            if name in self.machines:
                self.machines[name].terminals = dict(entry.get("terminals", {}))
