import asyncio
import json
import logging
from pathlib import Path

from herdr_pi.jobs import Job
from herdr_pi.remote import HcError, Remote
from herdr_pi.store import AgentStore

log = logging.getLogger(__name__)


def state_path(data_dir: Path) -> Path:
    return data_dir / "agents.json"


def load_state(store: AgentStore, data_dir: Path) -> None:
    path = state_path(data_dir)
    if not path.exists():
        return
    try:
        store.load(json.loads(path.read_text()))
    except (OSError, ValueError) as error:
        log.warning("can't read %s, starting empty: %s", path, error)


def save_state_job(store: AgentStore, data_dir: Path) -> Job:
    async def save_state() -> str:
        path = state_path(data_dir)
        partial = path.with_suffix(".json.partial")
        partial.write_text(json.dumps(store.dump()))
        partial.replace(path)
        return f"{len(store.terminals())} terminals"

    return Job("save-state", save_state, every=60)


def check_machines_job(store: AgentStore, remote: Remote) -> Job:
    async def check_one(name: str) -> str:
        try:
            version = (await remote.hc(name, "--version", timeout=20)).strip()
        except HcError as error:
            return f"{name}: {error.kind}"
        store.machines[name].hc_version = version
        return f"{name}: {version}"

    async def check_machines() -> str:
        results = await asyncio.gather(*(check_one(name) for name in store.machines))
        return ", ".join(results)

    return Job("check-machines", check_machines, every=600, run_at_start=True)
