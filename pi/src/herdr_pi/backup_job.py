import asyncio
import os
from collections.abc import Awaitable, Callable
from datetime import date
from pathlib import Path
from typing import Protocol

import psycopg
from psycopg.conninfo import make_conninfo

from herdr_pi.config import Settings
from herdr_pi.jobs import Job
from herdr_pi.ntfy import Push
from herdr_pi.remote import HcError, HcResult

KEEP = 14
DUMP_TIMEOUT = 10 * 60
SSH_FAILED = 255


def copy_command(folder: str) -> str:
    target = f"{folder}/board.dump"
    return f"mkdir -p {folder} && cat > {target}.part && mv {target}.part {target}"


class Sender(Protocol):
    async def send(self, machine_name: str, command: str, data: bytes, timeout: float = 60.0) -> HcResult: ...


def database_conninfo(settings: Settings) -> str:
    return make_conninfo(
        host="127.0.0.1", port=str(settings.db_port), user="herdr", dbname="herdr",
        password=os.environ.get("POSTGRES_PASSWORD", ""),
    )


def prune(folder: Path, keep: int = KEEP) -> list[Path]:
    dumps = sorted(folder.glob("board-*.dump"))
    removed = dumps[:-keep] if len(dumps) > keep else []
    for path in removed:
        path.unlink()
    return removed


async def dump(settings: Settings, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    process = await asyncio.create_subprocess_exec(
        "pg_dump", "-Fc", "-h", "127.0.0.1", "-p", str(settings.db_port), "-U", "herdr", "-d", "herdr",
        "-f", str(target),
        # In the environment, so the password stays out of the box's process list.
        env={**os.environ, "PGPASSWORD": os.environ.get("POSTGRES_PASSWORD", "")},
        stdin=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await asyncio.wait_for(process.communicate(), DUMP_TIMEOUT)
    if process.returncode != 0:
        target.unlink(missing_ok=True)
        raise RuntimeError(f"pg_dump: {stderr.decode(errors='replace').strip()}")


async def streaming_standbys(settings: Settings) -> list[str]:
    async with await psycopg.AsyncConnection.connect(database_conninfo(settings)) as connection:
        cursor = await connection.execute(
            "select application_name from pg_stat_replication where state = 'streaming'"
        )
        return [row[0] for row in await cursor.fetchall()]


async def copy_to_machines(settings: Settings, remote: Sender, data: bytes) -> tuple[list[str], list[str]]:
    copied, missed = [], []
    for machine in settings.machines:
        try:
            result = await remote.send(machine.name, copy_command(machine.backup_dir), data)
        except HcError as error:
            missed.append(f"{machine.name} ({error.message})")
            continue
        if result.code == 0:
            copied.append(machine.name)
        else:
            reason = "unreachable" if result.code == SSH_FAILED else result.stderr.strip() or f"exit {result.code}"
            missed.append(f"{machine.name} ({reason})")
    return copied, missed


def backup_job(settings: Settings, remote: Sender, send: Callable[[Push], Awaitable[None]]) -> Job:
    """Dumps the board, keeps two weeks on the Pi and the latest on each machine, and checks the standby."""
    folder = settings.data_dir / "backups"

    async def warn(message: str) -> None:
        await send(Push("Board backup", message, settings.digest.url, ["warning"], priority=4))

    async def backup() -> str:
        target = folder / f"board-{date.today().isoformat()}.dump"
        try:
            await dump(settings, target)
        except (RuntimeError, OSError, TimeoutError) as error:
            await warn(f"The dump failed: {error}")
            raise
        prune(folder)
        copied, missed = await copy_to_machines(settings, remote, target.read_bytes())
        standbys = await streaming_standbys(settings)
        problems = [f"not copied to {', '.join(missed)}"] if missed else []
        if not standbys:
            problems.append("no standby is streaming")
        if problems:
            await warn("; ".join(problems).capitalize() + ".")
        size_kb = target.stat().st_size // 1024
        return f"{size_kb} KB, copied to {', '.join(copied) or 'no machine'}, standby: {', '.join(standbys) or 'none'}"

    return Job("board-backup", backup, daily_at=settings.backup_at)
