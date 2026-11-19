import json
import shlex
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import herdr_config  # noqa: E402

from cleanup_lib import scan_worktrees
from cleanup_lib.models import Worktree

SCANNER = Path(scan_worktrees.__file__)


def current_machine() -> str:
    return herdr_config.self_name()


def machines() -> list[str]:
    return herdr_config.machine_names()


def run_on(machine: str, command: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    if machine == current_machine():
        return subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    remote = shlex.join(command)
    return subprocess.run(
        ["ssh", "-o", "ConnectTimeout=8", herdr_config.ssh_target(machine), remote],
        capture_output=True, text=True, timeout=timeout,
    )


def head_is_ancestor(worktree: Worktree, oid: str) -> bool:
    """False too when the commit isn't on that machine: nothing proves the work landed."""
    result = run_on(worktree.machine, ["git", "-C", worktree.path, "merge-base", "--is-ancestor", "HEAD", oid])
    return result.returncode == 0


def scan_machine(machine: str, should_fetch: bool) -> list[Worktree]:
    if machine == current_machine():
        records = scan_worktrees.scan(should_fetch)
    else:
        args = "" if should_fetch else " --no-fetch"
        result = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=8", herdr_config.ssh_target(machine), f"python3 -{args}"],
            input=SCANNER.read_text(), capture_output=True, text=True, timeout=900,
        )
        if result.returncode != 0:
            raise RuntimeError(f"scan on {machine} failed: {result.stderr.strip()[:300]}")
        records = json.loads(result.stdout)
    return [Worktree.model_validate({**record, "machine": machine}) for record in records]
