from typing import Literal

from pydantic import BaseModel


class Worktree(BaseModel):
    machine: str = ""
    path: str
    repo: str | None = None
    size_kb: int = 0
    in_use: bool = False
    error: str | None = None
    origin: str | None = None
    default_branch: str | None = None
    fetch_error: str | None = None
    locked: str | None = None
    lock_stale: bool = False
    prunable: bool = False
    branch: str | None = None
    head: str | None = None
    head_time: int = 0
    dirty_files: int = 0
    in_default: bool = False


class PullRequest(BaseModel):
    number: int
    head_ref: str
    head_oid: str


class RepoHistory(BaseModel):
    merged: list[PullRequest] = []
    closed_unmerged_heads: set[str] = set()
    live_branches: set[str] = set()


class NeonBranch(BaseModel):
    project_id: str
    project_name: str
    branch_id: str
    name: str
    is_default: bool
    has_children: bool
    created_at: str
    size_bytes: int


class Item(BaseModel):
    kind: Literal["worktree", "neon"]
    label: str
    machine: str
    size_bytes: int
    age_seconds: int
    safe: bool
    reason: str
    # Kept, and nothing on the board or running explains why: someone has to decide.
    review: bool = False
    worktree: Worktree | None = None
    neon: NeonBranch | None = None
