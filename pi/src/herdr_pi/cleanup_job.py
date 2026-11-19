import logging

from herdr_pi.config import Settings
from herdr_pi.jobs import Job
from herdr_pi.remote import Remote

log = logging.getLogger(__name__)

# The run fetches every repo and sizes every worktree on both machines.
CLEANUP_TIMEOUT = 45 * 60
SSH_FAILED = 255
# The machine's clone has no scripts/nightly-cleanup yet.
NOT_FOUND = 127


def last_line(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines[-1] if lines else ""


def cleanup_job(settings: Settings, remote: Remote) -> Job:
    """scripts/nightly-cleanup scans both machines from wherever it runs, so one machine is enough."""

    async def cleanup() -> str:
        skipped = []
        for machine in settings.machines:
            result = await remote.shell(machine.name, settings.cleanup_command, timeout=CLEANUP_TIMEOUT)
            if result.code in (SSH_FAILED, NOT_FOUND):
                skipped.append(f"{machine.name} ({'unreachable' if result.code == SSH_FAILED else 'no cleanup script'})")
                continue
            for line in result.stderr.splitlines():
                log.info("cleanup on %s: %s", machine.name, line)
            if result.code != 0:
                raise RuntimeError(f"{machine.name}: {last_line(result.stderr) or f'exit {result.code}'}")
            return f"{machine.name}: {last_line(result.stdout)}"
        raise RuntimeError(f"no machine could run it: {', '.join(skipped)}")

    return Job("cleanup", cleanup, daily_at=settings.cleanup_at)
