"""The working tree: a commit of everything in the source worktree (untracked files too) on
handoff/<name>, carried to the target in a git bundle and checked out there as the same branch,
with the changes back to uncommitted."""
import posixpath
from dataclasses import dataclass

from handoff_lib.machines import HandoffError, output, run, shell

REGENERABLE = {
    "node_modules", ".venv", "venv", "__pycache__", ".next", ".turbo", "dist", "build", "target",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", "coverage", ".cache", ".DS_Store", ".vercel",
}

SNAPSHOT = """set -e
cd "$1"
dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
export GIT_INDEX_FILE="$dir/index"
git read-tree HEAD
git add -A
tree=$(git write-tree)
commit=$(git commit-tree "$tree" -p HEAD -m "$2")
git update-ref "refs/heads/$3" "$commit"
echo "$commit"
"""

BUNDLE = """set -e
cd "$1"
dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
if [ "$2" = thin ] && [ -n "$(git for-each-ref --count=1 refs/remotes)" ]; then
  git bundle create -q "$dir/b" "refs/heads/$3" --not --remotes
else
  git bundle create -q "$dir/b" "refs/heads/$3"
fi
cat "$dir/b"
"""

# Reads the bundle from stdin into refs/heads/<ref> of the target repo.
RECEIVE = """set -e
cd "$1"
dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
cat > "$dir/b"
git remote get-url origin >/dev/null 2>&1 && git fetch -q origin 2>/dev/null || true
git fetch -q "$dir/b" "+refs/heads/$2:refs/heads/$2"
"""


@dataclass
class Place:
    machine: str
    root: str
    main: str
    relative: str
    branch: str | None
    head: str

    @property
    def is_worktree(self) -> bool:
        return self.root != self.main

    @property
    def name(self) -> str:
        return posixpath.basename(self.root)

    @property
    def handoff_ref(self) -> str:
        return f"handoff/{self.name}"


def git(machine: str, repo: str, *args: str, what: str = "") -> str:
    return output(machine, ["git", "-C", repo, *args], what=what or f"git {args[0]}")


def inspect(machine: str, cwd: str) -> Place:
    root = git(machine, cwd, "rev-parse", "--show-toplevel", what="finding the repo")
    common = git(machine, cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")
    main = common[:-5] if common.endswith("/.git") else root
    symbolic = run(machine, ["git", "-C", root, "symbolic-ref", "--quiet", "--short", "HEAD"])
    branch = symbolic.stdout.decode().strip() if symbolic.returncode == 0 else ""
    relative = posixpath.relpath(cwd, root)
    return Place(machine=machine, root=root, main=main, relative="" if relative == "." else relative,
                 branch=branch or None, head=git(machine, root, "rev-parse", "HEAD"))


def is_clean(place: Place) -> bool:
    return git(place.machine, place.root, "status", "--porcelain") == ""


def snapshot(place: Place, target: str) -> str:
    message = f"Handoff to {target}: work in progress of {place.branch or place.head[:12]}"
    return shell(place.machine, SNAPSHOT, place.root, message, place.handoff_ref, what="committing the work in progress")


def carry(source: Place, target_main: str, target_machine: str) -> None:
    """Fetches handoff/<name> into the target repo, sending only what origin lacks when it can."""
    for kind in ("thin", "full"):
        bundle = run(source.machine, ["sh", "-c", BUNDLE, "sh", source.root, kind, source.handoff_ref])
        if bundle.returncode != 0:
            raise HandoffError(f"git bundle failed on {source.machine}: {bundle.stderr.decode().strip()[:300]}")
        received = run(target_machine, ["sh", "-c", RECEIVE, "sh", target_main, source.handoff_ref], stdin=bundle.stdout)
        if received.returncode == 0:
            return
        failure = received.stderr.decode(errors="replace").strip()
    raise HandoffError(f"couldn't fetch the work on {target_machine}: {failure[:300]}")


def check_target(source: Place, target_main: str, target_root: str, target_machine: str) -> None:
    """Never over another task's worktree."""
    if run(target_machine, ["test", "-d", target_main]).returncode != 0:
        raise HandoffError(f"{target_main} isn't checked out on {target_machine}")
    if source.is_worktree and run(target_machine, ["test", "-e", target_root]).returncode == 0:
        raise HandoffError(f"{target_root} already exists on {target_machine}")


def check_branch(source: Place, target_main: str, target_machine: str) -> None:
    if not source.branch:
        return
    there = run(target_machine, ["git", "-C", target_main, "rev-parse", "--verify", "--quiet", f"refs/heads/{source.branch}"])
    if there.returncode != 0:
        return
    behind = run(target_machine, ["git", "-C", target_main, "merge-base", "--is-ancestor", source.branch, source.head])
    if behind.returncode != 0:
        raise HandoffError(f"{source.branch} on {target_machine} has commits the source doesn't")


def check_out(source: Place, target_main: str, target_root: str, target_machine: str) -> None:
    """The target worktree on the source's branch at its HEAD, with the work in progress uncommitted."""
    check_branch(source, target_main, target_machine)
    branch = ["-B", source.branch] if source.branch else ["--detach"]
    git(target_machine, target_main, "worktree", "add", "-q", *branch, target_root, source.handoff_ref, what="git worktree add")
    git(target_machine, target_root, "reset", "-q", source.head, what="git reset")


def kept_files(place: Place) -> list[str]:
    """Ignored files a commit can't carry, leaving out what a build or install makes again."""
    listed = git(place.machine, place.root, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory")
    entries = [line.rstrip("/") for line in listed.splitlines() if line]
    return [e for e in entries if not set(e.split("/")) & REGENERABLE]


def remove_source(place: Place) -> str:
    """Removes the source worktree when the handoff commit holds everything in it."""
    leftovers = kept_files(place)
    if leftovers:
        shown = ", ".join(leftovers[:5]) + (" …" if len(leftovers) > 5 else "")
        return f"kept {place.root} on {place.machine}: it has ignored files the move didn't carry ({shown})"
    git(place.machine, place.main, "worktree", "remove", "--force", place.root, what="git worktree remove")
    return f"removed {place.root} on {place.machine}; its work stays on {place.handoff_ref} there"
