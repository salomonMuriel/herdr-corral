import asyncio
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from herdr_pi.alerts import status_of
from herdr_pi.store import Change, now_ms

Decision = Literal["allow", "always", "deny"]
State = Literal["pending", "allow", "always", "deny", "withdrawn", "expired"]
Record = dict[str, Any]

# Claude Code can raise the next prompt right as the last one is answered in the terminal,
# so a terminal leaving blocked only withdraws requests that were already up a moment.
WITHDRAW_GRACE_SECONDS = 3.0
# Answered or withdrawn requests stay this long so the hook and the page can read the outcome.
KEEP_SECONDS = 120.0
MAX_WAIT_SECONDS = 3600.0


@dataclass
class Approval:
    id: str
    machine: str
    address: str
    tool: str
    summary: str
    detail: str
    cwd: str
    always_label: str | None
    created: float
    deadline: float
    created_ms: int = field(default_factory=now_ms)
    state: State = "pending"
    message: str | None = None
    closed: float | None = None
    changed: asyncio.Event = field(default_factory=asyncio.Event)

    def view(self) -> Record:
        return {
            "id": self.id,
            "machine": self.machine,
            "address": self.address,
            "tool": self.tool,
            "summary": self.summary,
            "detail": self.detail,
            "cwd": self.cwd,
            "always_label": self.always_label,
            "created_ms": self.created_ms,
            "state": self.state,
            "message": self.message,
        }


class Approvals:
    """Permission requests from Claude Code hooks, waiting on an answer from the page."""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self.clock = clock
        self.items: dict[str, Approval] = {}

    def open(
        self,
        machine: str,
        address: str,
        tool: str,
        summary: str,
        detail: str,
        cwd: str,
        always_label: str | None,
        wait_seconds: float,
    ) -> Approval:
        self.sweep()
        now = self.clock()
        approval = Approval(
            id=uuid.uuid4().hex,
            machine=machine,
            address=address,
            tool=tool,
            summary=summary,
            detail=detail,
            cwd=cwd,
            always_label=always_label,
            created=now,
            deadline=now + min(wait_seconds, MAX_WAIT_SECONDS),
        )
        self.items[approval.id] = approval
        return approval

    def get(self, approval_id: str) -> Approval | None:
        self.sweep()
        return self.items.get(approval_id)

    def close(self, approval: Approval, state: State, message: str | None = None) -> bool:
        if approval.state != "pending":
            return False
        approval.state = state
        approval.message = message
        approval.closed = self.clock()
        approval.changed.set()
        return True

    def answer(self, approval_id: str, decision: Decision, message: str | None) -> Approval | None:
        approval = self.get(approval_id)
        if approval is None:
            return None
        self.close(approval, decision, message)
        return approval

    def withdraw(self, approval_id: str) -> Approval | None:
        approval = self.get(approval_id)
        if approval is not None:
            self.close(approval, "withdrawn")
        return approval

    async def wait(self, approval: Approval, seconds: float) -> Approval:
        if approval.state == "pending":
            try:
                await asyncio.wait_for(approval.changed.wait(), max(0.0, seconds))
            except TimeoutError:
                pass
        self.sweep()
        return approval

    def sweep(self) -> None:
        now = self.clock()
        for approval in list(self.items.values()):
            if approval.state == "pending" and approval.deadline <= now:
                self.close(approval, "expired")
            if approval.closed is not None and now - approval.closed > KEEP_SECONDS:
                del self.items[approval.id]

    def pending(self) -> list[Approval]:
        self.sweep()
        return sorted((a for a in self.items.values() if a.state == "pending"), key=lambda a: a.created)

    def pending_for(self) -> dict[str, Record]:
        """The oldest pending request per terminal, keyed like agent ids: machine/address."""
        found: dict[str, Record] = {}
        for approval in self.pending():
            found.setdefault(f"{approval.machine}/{approval.address}", approval.view())
        return found

    def on_change(self, change: Change) -> None:
        """Someone answered in the terminal: the agent left its prompt, or the terminal is gone."""
        before, after = status_of(change.before), status_of(change.after)
        gone = change.after is None
        if not gone and (before != "blocked" or after == "blocked"):
            return
        now = self.clock()
        for approval in self.pending():
            same = approval.machine == change.machine and approval.address == change.address
            if same and now - approval.created >= WITHDRAW_GRACE_SECONDS:
                self.close(approval, "withdrawn")
