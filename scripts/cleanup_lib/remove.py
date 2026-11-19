from cleanup_lib import neon
from cleanup_lib.machines import run_on
from cleanup_lib.models import Item, Worktree


def remove_checkout(worktree: Worktree) -> str | None:
    """Why the worktree is still there, or None once it is gone."""
    if worktree.locked:
        unlocked = run_on(worktree.machine, ["git", "-C", worktree.repo, "worktree", "unlock", worktree.path])
        if unlocked.returncode != 0:
            return f"failed to unlock: {unlocked.stderr.strip()}"
    # No --force: git refuses if the worktree picked up changes since the scan.
    removed = run_on(worktree.machine, ["git", "-C", worktree.repo, "worktree", "remove", worktree.path])
    return None if removed.returncode == 0 else f"failed: {removed.stderr.strip()}"


def owns_branch(worktree: Worktree) -> bool:
    default = (worktree.default_branch or "").removeprefix("origin/")
    return bool(worktree.branch) and worktree.branch != default


def delete_branch(worktree: Worktree) -> str | None:
    """Why the branch is still there, or None once it is gone.

    -d only knows the main checkout's HEAD, which may lag origin. The verdict already proved
    the branch's commits are in origin's default branch or a merged PR, so -D is safe after it.
    """
    for flag in ("-d", "-D"):
        deleted = run_on(worktree.machine, ["git", "-C", worktree.repo, "branch", flag, worktree.branch])
        if deleted.returncode == 0:
            return None
    return deleted.stderr.strip()


def remove_worktree(worktree: Worktree) -> str:
    failure = remove_checkout(worktree)
    if failure:
        return failure
    if not owns_branch(worktree):
        return "removed"
    kept = delete_branch(worktree)
    return f"removed; branch {worktree.branch} kept: {kept}" if kept else f"removed with branch {worktree.branch}"


def remove_neon_branch(item: Item) -> str:
    result = neon.delete_branch(item.neon)
    return "deleted" if result.returncode == 0 else f"failed: {result.stderr.strip()}"


def remove(item: Item) -> str:
    if item.kind == "worktree":
        return remove_worktree(item.worktree)
    return remove_neon_branch(item)
