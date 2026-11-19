"""Cleanup after one Done task on this machine: its worktree, its branch and a Neon branch
named after it, judged by the same rules as scripts/cleanup."""
import json
import subprocess
import time
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from cleanup_lib import neon, rules, scan_worktrees
from cleanup_lib.github import github_slug, repo_history
from cleanup_lib.machines import current_machine, head_is_ancestor
from cleanup_lib.models import RepoHistory, Worktree
from cleanup_lib.remove import delete_branch, owns_branch, remove_checkout
from cleanup_lib.report import human_size

QUIET_TIMEOUT_SECONDS = 30


class Outcome(BaseModel):
    kind: Literal["removed", "kept"]
    text: str


class Verdict(BaseModel):
    worktree: Worktree
    safe: bool
    reason: str


def in_use(path: str) -> bool:
    return any(cwd == path or cwd.startswith(path + "/") for cwd in scan_worktrees.process_cwds())


def wait_until_unused(path: str) -> None:
    """The board closes the session just before this runs; its shell and agent take a moment to exit."""
    deadline = time.monotonic() + QUIET_TIMEOUT_SECONDS
    while in_use(path) and time.monotonic() < deadline:
        time.sleep(1)


def history_for(worktree: Worktree) -> RepoHistory | str | None:
    if worktree.in_default:
        return None
    slug = github_slug(worktree.origin)
    return repo_history(slug) if slug else None


def judge_worktree(path: str) -> Verdict:
    record = scan_worktrees.scan_one(Path(path), should_fetch=True)
    worktree = Worktree.model_validate({**record, "machine": current_machine()})
    safe, reason = rules.worktree_verdict(worktree, history_for(worktree), head_is_ancestor)
    return Verdict(worktree=worktree, safe=safe, reason=reason)


def judge_branch(repo: str, branch: str) -> Verdict | None:
    """The branch alone, judged as a clean worktree at its tip; None when it doesn't exist."""
    head = scan_worktrees.git_out(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}")
    if not head:
        return None
    facts = scan_worktrees.repo_facts(repo, scan_worktrees.fetch(repo))
    in_default = bool(facts["default"]) and scan_worktrees.git(
        repo, "merge-base", "--is-ancestor", head, facts["default"]).returncode == 0
    worktree = Worktree(machine=current_machine(), path=repo, repo=repo, origin=facts["origin"],
                        default_branch=facts["default"], branch=branch, head=head, in_default=in_default)

    def tip_is_ancestor(_worktree: Worktree, oid: str) -> bool:
        return scan_worktrees.git(repo, "merge-base", "--is-ancestor", head, oid).returncode == 0

    safe, reason = rules.worktree_verdict(worktree, history_for(worktree), tip_is_ancestor)
    return Verdict(worktree=worktree, safe=safe, reason=reason)


def judge(repo: str, path: str, branch: str) -> Verdict | None:
    if Path(path).is_dir():
        return judge_worktree(str(Path(path).resolve()))
    return judge_branch(repo, branch)


def neon_cleanup(branch: str) -> list[str]:
    if not neon.available():
        return [f"Neon not checked: {neon.UNCONFIGURED}"]
    try:
        branches = neon.all_branches()
    except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        return [f"Neon not checked: {error}"]
    finished = {key: f"git branch {branch} merged" for key in rules.name_keys(branch)}
    notes = []
    for candidate in branches:
        safe, _ = rules.neon_verdict(candidate, finished, {})
        if not safe:
            continue
        result = neon.delete_branch(candidate)
        failure = result.stderr.strip()[:120]
        notes.append(f"Neon branch {candidate.name} deleted" if result.returncode == 0
                     else f"Neon branch {candidate.name} kept: {failure}")
    return notes


def clean_worktree(verdict: Verdict, branch: str) -> Outcome:
    worktree = verdict.worktree
    if not verdict.safe:
        return Outcome(kind="kept", text=f"Worktree kept: {verdict.reason}")
    failure = remove_checkout(worktree)
    if failure:
        return Outcome(kind="kept", text=f"Worktree kept: {failure}")
    notes = [f"Worktree removed, {human_size(worktree.size_kb * 1024)} freed"]
    if owns_branch(worktree) and (kept := delete_branch(worktree)):
        notes.append(f"branch {worktree.branch} kept: {kept}")
    return Outcome(kind="removed", text=". ".join(notes + neon_cleanup(branch)))


def clean_branch(verdict: Verdict, branch: str) -> Outcome:
    if not verdict.safe:
        return Outcome(kind="kept", text=f"Worktree already gone. Branch {branch} kept: {verdict.reason}")
    kept = delete_branch(verdict.worktree)
    if kept:
        return Outcome(kind="kept", text=f"Worktree already gone. Branch {branch} kept: {kept}")
    return Outcome(kind="removed", text=". ".join([f"Worktree already gone, branch {branch} deleted",
                                                   *neon_cleanup(branch)]))


def clean(repo: str, path: str, branch: str) -> Outcome:
    if Path(path).is_dir():
        wait_until_unused(str(Path(path).resolve()))
    verdict = judge(repo, path, branch)
    if verdict is None:
        return Outcome(kind="removed", text="Worktree already gone")
    if Path(path).is_dir():
        return clean_worktree(verdict, branch)
    return clean_branch(verdict, branch)
