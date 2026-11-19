from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from herdr_pi.approvals import Approval, Approvals
from herdr_pi.store import AgentStore

# A long poll shorter than any proxy timeout between the hook and this listener.
MAX_POLL_SECONDS = 25.0


class ApprovalRequest(BaseModel):
    machine: str = Field(min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=100)
    tool: str = Field(min_length=1, max_length=200)
    summary: str = Field(default="", max_length=2_000)
    detail: str = Field(default="", max_length=20_000)
    cwd: str = Field(default="", max_length=1_000)
    always_label: str | None = Field(default=None, max_length=500)
    wait_seconds: float = Field(gt=0, le=3600)


class AnswerBody(BaseModel):
    decision: Literal["allow", "always", "deny"]
    message: str | None = Field(default=None, max_length=2_000)


class Empty(BaseModel):
    pass


def resolve_machine(store: AgentStore, machine: str, address: str) -> str:
    """The hook names its machine from the hostname; when that doesn't match, the terminal id may."""
    state = store.machines.get(machine)
    if state is not None and address in state.terminals:
        return machine
    holders = [name for name, state in store.machines.items() if address in state.terminals]
    return holders[0] if len(holders) == 1 else machine


def add_approval_routes(app: FastAPI, approvals: Approvals, store: AgentStore) -> None:
    # Every route is async: sync routes run in worker threads, and asyncio events aren't thread-safe.
    def find(approval_id: str) -> Approval:
        approval = approvals.get(approval_id)
        if approval is None:
            raise HTTPException(404, "no such request")
        return approval

    @app.post("/api/approvals")
    async def open_approval(body: ApprovalRequest) -> dict[str, Any]:
        machine = resolve_machine(store, body.machine, body.address)
        approval = approvals.open(
            machine,
            body.address,
            body.tool,
            body.summary,
            body.detail,
            body.cwd,
            body.always_label,
            body.wait_seconds,
        )
        return approval.view()

    @app.get("/api/approvals/{approval_id}")
    async def read_approval(approval_id: str, wait: float = 0) -> dict[str, Any]:
        approval = await approvals.wait(find(approval_id), min(max(wait, 0), MAX_POLL_SECONDS))
        return approval.view()

    @app.post("/api/approvals/{approval_id}/answer")
    async def answer_approval(approval_id: str, body: AnswerBody) -> dict[str, Any]:
        approval = find(approval_id)
        if approval.state != "pending":
            raise HTTPException(409, f"already {approval.state}")
        message = (body.message or "").strip() or None
        approvals.answer(approval_id, body.decision, message)
        return approval.view()

    @app.post("/api/approvals/{approval_id}/withdraw")
    async def withdraw_approval(approval_id: str, body: Empty) -> dict[str, Any]:
        approval = find(approval_id)
        approvals.withdraw(approval_id)
        return approval.view()
