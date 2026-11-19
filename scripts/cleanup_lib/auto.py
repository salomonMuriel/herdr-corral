"""The nightly run: removes every safe item and records on the board what is left to review."""
from collections import Counter

from pydantic import BaseModel

from cleanup_lib import board
from cleanup_lib.models import Item, NeonBranch
from cleanup_lib.remove import remove
from cleanup_lib.report import human_size


class Entry(BaseModel):
    kind: str
    label: str
    machine: str
    size_bytes: int
    age_seconds: int
    note: str


class NeonCount(BaseModel):
    project: str
    branches: int


class Run(BaseModel):
    machine: str
    removed: list[Entry] = []
    review: list[Entry] = []
    neon: list[NeonCount] = []
    # Machine name, or "neon", -> why it wasn't checked this run.
    skipped: dict[str, str] = {}


def entry(item: Item, note: str) -> Entry:
    return Entry(kind=item.kind, label=item.label, machine=item.machine, size_bytes=item.size_bytes,
                 age_seconds=item.age_seconds, note=note)


def remove_safe(items: list[Item]) -> tuple[list[Entry], list[Entry], set[str]]:
    """What was removed, what failed to go, and the ids of deleted Neon branches."""
    removed: list[Entry] = []
    failed: list[Entry] = []
    deleted: set[str] = set()
    for item in items:
        if not item.safe:
            continue
        result = remove(item)
        if result.startswith("failed"):
            failed.append(entry(item, f"removal {result}"))
            continue
        removed.append(entry(item, result))
        if item.neon:
            deleted.add(item.neon.branch_id)
    return removed, failed, deleted


def neon_counts(branches: list[NeonBranch], deleted: set[str]) -> list[NeonCount]:
    counts = Counter(branch.project_name for branch in branches if branch.branch_id not in deleted)
    return [NeonCount(project=project, branches=count) for project, count in counts.most_common()]


def carry_forward(run: Run, previous: dict | None) -> None:
    """A machine the run couldn't reach keeps what the last run found there."""
    if not previous:
        return
    run.review += [Entry.model_validate(row) for row in previous["review"] if row["machine"] in run.skipped]
    if "neon" in run.skipped:
        run.neon = [NeonCount.model_validate(row) for row in previous["neon"]]


def run_auto(machine: str, items: list[Item], branches: list[NeonBranch], skipped: dict[str, str]) -> Run:
    removed, failed, deleted = remove_safe(items)
    review = failed + [entry(item, item.reason) for item in items if item.review]
    run = Run(machine=machine, removed=removed, review=review, neon=neon_counts(branches, deleted), skipped=skipped)
    carry_forward(run, board.latest_run())
    dumped = run.model_dump()
    board.record_run(machine, dumped["removed"], dumped["review"], dumped["neon"], run.skipped)
    return run


def summary(run: Run) -> str:
    freed = human_size(sum(entry.size_bytes for entry in run.removed if entry.kind == "worktree"))
    parts = [f"removed {len(run.removed)} ({freed})", f"{len(run.review)} to review"]
    parts += [f"{name} skipped" for name in sorted(run.skipped)]
    return ", ".join(parts)
