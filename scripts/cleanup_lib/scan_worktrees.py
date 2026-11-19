"""Collects facts about every agent worktree on this machine and prints them as JSON.

Stdlib only: the cleanup script pipes this file to `python3 -` on the other machine.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

GIT_ROOT_DEPTHS = ("*", "*/*", "*/*/*")
WORKERS = 8
LOCK_PID = re.compile(r"\(pid (\d+)")
# A fetch that needs credentials fails instead of prompting; stale refs only make verdicts stricter.
NO_PROMPT_ENV = {
    **os.environ,
    "GIT_TERMINAL_PROMPT": "0",
    "GIT_ASKPASS": "true",
    "SSH_ASKPASS": "true",
    "GIT_SSH_COMMAND": "ssh -o BatchMode=yes",
}


def git(cwd: str, *args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=timeout)


def git_out(cwd: str, *args: str) -> str:
    result = git(cwd, *args)
    return result.stdout.strip() if result.returncode == 0 else ""


def find_worktrees(home: Path) -> list[Path]:
    found: dict[str, Path] = {}
    patterns = [f"git/{depth}/.claude/worktrees/*" for depth in GIT_ROOT_DEPTHS]
    patterns.append(".herdr/worktrees/*/*")
    for pattern in patterns:
        for path in home.glob(pattern):
            if path.is_dir() and (path / ".git").exists():
                found[str(path.resolve())] = path.resolve()
    return sorted(found.values())


def main_checkout(worktree: Path) -> str | None:
    common = git_out(str(worktree), "rev-parse", "--path-format=absolute", "--git-common-dir")
    if not common:
        return None
    common_path = Path(common)
    return str(common_path.parent if common_path.name == ".git" else common_path)


def default_branch(repo: str) -> str | None:
    head = git_out(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    if head:
        return head
    for candidate in ("origin/main", "origin/master"):
        if git(repo, "rev-parse", "--verify", "--quiet", candidate).returncode == 0:
            return candidate
    return None


def worktree_flags(repo: str) -> dict[str, dict[str, str]]:
    """Locked and prunable worktrees of a repo, each with git's stated reason."""
    flags: dict[str, dict[str, str]] = {"locked": {}, "prunable": {}}
    current = None
    for line in git_out(repo, "worktree", "list", "--porcelain").splitlines():
        flag, _, reason = line.partition(" ")
        if flag == "worktree":
            current = str(Path(reason).resolve())
        elif current and flag in flags:
            flags[flag][current] = reason or "no reason given"
    return flags


def fetch(repo: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", repo, "fetch", "--prune", "--quiet", "origin"],
            capture_output=True, text=True, timeout=90, stdin=subprocess.DEVNULL, env=NO_PROMPT_ENV,
        )
    except subprocess.TimeoutExpired:
        return "fetch timed out"
    return None if result.returncode == 0 else f"fetch failed: {result.stderr.strip()[:120]}"


def lock_is_stale(reason: str | None) -> bool:
    """A Claude session lock names its pid; once that process is gone the lock means nothing."""
    match = LOCK_PID.search(reason or "")
    if not match:
        return False
    try:
        os.kill(int(match.group(1)), 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    return False


def process_cwds() -> set[str]:
    if Path("/proc").is_dir():
        cwds = set()
        for entry in Path("/proc").iterdir():
            try:
                cwds.add(os.readlink(entry / "cwd"))
            except OSError:
                continue
        return cwds
    result = subprocess.run(["lsof", "-a", "-d", "cwd", "-F", "n"], capture_output=True, text=True)
    return {line[1:] for line in result.stdout.splitlines() if line.startswith("n/")}


def size_kb(path: Path) -> int:
    result = subprocess.run(["du", "-sk", str(path)], capture_output=True, text=True)
    first = result.stdout.split("\t", 1)[0]
    return int(first) if first.isdigit() else 0


def repo_facts(repo: str, fetch_error: str | None) -> dict:
    return {
        "origin": git_out(repo, "remote", "get-url", "origin") or None,
        "default": default_branch(repo),
        "flags": worktree_flags(repo),
        "fetch_error": fetch_error,
    }


def describe(path: Path, repo: str | None, repo_info: dict, cwds: set[str]) -> dict:
    wt = str(path)
    record: dict = {"path": wt, "repo": repo, "size_kb": size_kb(path)}
    record["in_use"] = any(cwd == wt or cwd.startswith(wt + "/") for cwd in cwds)
    if not repo:
        record["error"] = "not a git worktree"
        return record
    info = repo_info[repo]
    record.update(
        origin=info["origin"],
        default_branch=info["default"],
        fetch_error=info["fetch_error"],
        locked=info["flags"]["locked"].get(wt),
        lock_stale=lock_is_stale(info["flags"]["locked"].get(wt)),
        prunable=wt in info["flags"]["prunable"],
        branch=git_out(wt, "symbolic-ref", "--short", "-q", "HEAD") or None,
        head=git_out(wt, "rev-parse", "HEAD") or None,
        head_time=int(git_out(wt, "log", "-1", "--format=%ct") or 0),
    )
    status = git(wt, "status", "--porcelain")
    record["dirty_files"] = len(status.stdout.splitlines()) if status.returncode == 0 else -1
    record["in_default"] = bool(
        info["default"] and record["head"]
        and git(wt, "merge-base", "--is-ancestor", "HEAD", info["default"]).returncode == 0
    )
    return record


def scan(should_fetch: bool) -> list[dict]:
    paths = find_worktrees(Path.home())
    with ThreadPoolExecutor(WORKERS) as pool:
        repos = dict(zip(paths, pool.map(main_checkout, paths)))
        unique_repos = sorted({repo for repo in repos.values() if repo})
        fetch_errors = list(pool.map(fetch, unique_repos)) if should_fetch else [None] * len(unique_repos)
        repo_info = {repo: repo_facts(repo, error) for repo, error in zip(unique_repos, fetch_errors)}
        cwds = process_cwds()
        return list(pool.map(lambda path: describe(path, repos[path], repo_info, cwds), paths))


def scan_one(path: Path, should_fetch: bool) -> dict:
    repo = main_checkout(path)
    if not repo:
        return describe(path, None, {}, process_cwds())
    error = fetch(repo) if should_fetch else None
    return describe(path, repo, {repo: repo_facts(repo, error)}, process_cwds())


if __name__ == "__main__":
    json.dump(scan(should_fetch="--no-fetch" not in sys.argv), sys.stdout)
