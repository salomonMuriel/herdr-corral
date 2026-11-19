import re
import time
import unicodedata
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from cleanup_lib.github import github_slug
from cleanup_lib.models import Item, NeonBranch, RepoHistory, Worktree

AncestorCheck = Callable[[Worktree, str], bool]

LONG_LIVED = {"main", "master", "dev", "develop", "staging", "test", "prod", "production", "preview"}
OPEN_STATUS = {"todo": "to do", "doing": "in progress", "review": "in review"}


def slugify(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def name_keys(name: str) -> set[str]:
    """Agent branches are named worktree-<task>; a Neon branch for the same task may drop the prefix."""
    last = name.rsplit("/", 1)[-1]
    return {slugify(name), slugify(last), slugify(last.removeprefix("worktree-"))} - {""}


def worktree_label(worktree: Worktree) -> str:
    repo = worktree.repo or str(Path(worktree.path).parent)
    repo_name = repo.split("/git/", 1)[-1]
    return f"{repo_name}:{Path(worktree.path).name}"


def worktree_verdict(
    worktree: Worktree, history: RepoHistory | str | None, is_ancestor: AncestorCheck,
) -> tuple[bool, str]:
    if worktree.error:
        return False, worktree.error
    if worktree.locked and not worktree.lock_stale:
        return False, f"locked: {worktree.locked}"
    if worktree.prunable:
        return False, "git marks it prunable; check by hand"
    if worktree.in_use:
        return False, "a running process is inside it"
    if worktree.dirty_files < 0:
        return False, "git status failed"
    if worktree.dirty_files:
        return False, f"dirty: {worktree.dirty_files} changed files"
    if worktree.in_default:
        return True, f"in {worktree.default_branch}"
    if not worktree.branch:
        return False, "detached HEAD not in the default branch"
    if history is None:
        return False, "not merged; no GitHub origin"
    if isinstance(history, str):
        return False, history
    pulls = [pull for pull in history.merged if pull.head_ref == worktree.branch]
    for pull in pulls:
        if worktree.head == pull.head_oid or is_ancestor(worktree, pull.head_oid):
            return True, f"PR #{pull.number} merged"
    if pulls:
        return False, f"commits after merged PR #{pulls[0].number}"
    return False, f"{worktree.branch} not merged"


def is_busy(worktree: Worktree) -> bool:
    return worktree.in_use or bool(worktree.locked and not worktree.lock_stale)


def worktree_item(
    worktree: Worktree, histories: dict[str, RepoHistory | str], is_ancestor: AncestorCheck,
    held: dict[str, str] | None = None,
) -> Item:
    history = histories.get(github_slug(worktree.origin) or "")
    safe, reason = worktree_verdict(worktree, history, is_ancestor)
    hold = held_by(worktree.branch, held or {})
    if hold:
        safe, reason = False, hold
    if worktree.lock_stale:
        reason += " (stale session lock)"
    return Item(
        kind="worktree",
        label=worktree_label(worktree),
        machine=worktree.machine,
        size_bytes=worktree.size_kb * 1024,
        age_seconds=int(time.time()) - worktree.head_time if worktree.head_time else 0,
        safe=safe,
        reason=reason,
        review=not safe and not hold and not is_busy(worktree),
        worktree=worktree,
    )


def finished_git_names(histories: dict[str, RepoHistory | str]) -> dict[str, str]:
    """Normalized branch name -> why that git branch counts as finished."""
    finished: dict[str, str] = {}
    for history in histories.values():
        if isinstance(history, str):
            continue
        for head in history.closed_unmerged_heads - history.live_branches:
            for key in name_keys(head):
                finished[key] = f"git branch {head} deleted"
        for pull in history.merged:
            for key in name_keys(pull.head_ref):
                finished[key] = f"git branch {pull.head_ref} merged (PR #{pull.number})"
    return finished


def done_task_names(tasks: list[dict]) -> dict[str, str]:
    titles = [task["title"] for task in tasks if task["status"] == "done"]
    return {slugify(title): f"task \"{title}\" done" for title in titles if slugify(title)}


def open_task_names(tasks: list[dict]) -> dict[str, str]:
    """Branch and title of every task that isn't Done -> why its worktree and Neon branch stay."""
    held: dict[str, str] = {}
    for task in tasks:
        if task["status"] == "done":
            continue
        why = f"task \"{task['title']}\" is {OPEN_STATUS.get(task['status'], task['status'])}"
        for name in (task.get("branch"), task["title"]):
            for key in name_keys(name or ""):
                held[key] = why
    return held


def held_by(name: str | None, held: dict[str, str]) -> str | None:
    return next((held[key] for key in name_keys(name or "") if key in held), None)


def neon_verdict(branch: NeonBranch, finished: dict[str, str], done: dict[str, str]) -> tuple[bool, str]:
    if branch.is_default:
        return False, "default branch"
    if branch.has_children:
        return False, "has child branches"
    if branch.name.lower() in LONG_LIVED:
        return False, "long-lived branch"
    for key in name_keys(branch.name):
        if key in finished:
            return True, finished[key]
        if key in done:
            return True, done[key]
    return False, "no merged branch or done task with this name"


def neon_item(
    branch: NeonBranch, finished: dict[str, str], done: dict[str, str], held: dict[str, str] | None = None,
) -> Item:
    safe, reason = neon_verdict(branch, finished, done)
    hold = held_by(branch.name, held or {})
    if hold:
        safe, reason = False, hold
    protected = branch.is_default or branch.has_children or branch.name.lower() in LONG_LIVED
    created = datetime.fromisoformat(branch.created_at.replace("Z", "+00:00")).timestamp()
    return Item(
        kind="neon",
        label=f"{branch.project_name}:{branch.name}",
        machine="neon",
        size_bytes=branch.size_bytes,
        age_seconds=int(time.time() - created),
        safe=safe,
        reason=reason,
        review=not safe and not hold and not protected,
        neon=branch,
    )
