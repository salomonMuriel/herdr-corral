import asyncio
from dataclasses import dataclass, field

from herdr_pi.alerts import Alerts
from herdr_pi.approvals import Approvals
from herdr_pi.backup_job import backup_job
from herdr_pi.board import Board
from herdr_pi.builtin_jobs import check_machines_job, load_state, save_state_job
from herdr_pi.cleanup_job import cleanup_job
from herdr_pi.config import Settings
from herdr_pi.digest_job import digest_job
from herdr_pi.follower import Follower
from herdr_pi.jobs import JobRunner
from herdr_pi.ntfy import Ntfy
from herdr_pi.presence import PresenceCheck
from herdr_pi.remote import Remote
from herdr_pi.store import AgentStore


@dataclass
class Service:
    settings: Settings
    version: str
    store: AgentStore
    remote: Remote
    runner: JobRunner
    followers: list[Follower]
    alerts: Alerts
    approvals: Approvals
    board: Board
    tasks: list[asyncio.Task[None]] = field(default_factory=list)

    def start(self) -> None:
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        load_state(self.store, self.settings.data_dir)
        self.tasks = [asyncio.create_task(f.run(), name=f"events:{f.machine}") for f in self.followers]
        self.tasks += self.runner.start()
        self.tasks.append(asyncio.create_task(self.alerts.run(), name="alerts"))

    async def stop(self) -> None:
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        await self.runner.execute(self.runner.jobs["save-state"])


def build_service(settings: Settings, version: str) -> Service:
    store = AgentStore([machine.name for machine in settings.machines])
    remote = Remote(settings)
    followers = [Follower(machine.name, remote, store, settings.stall_seconds) for machine in settings.machines]
    board = Board(settings.board_config)
    ntfy = Ntfy(settings.alerts.ntfy_url, settings.alerts.topic)
    names = [machine.name for machine in settings.machines]
    presence = PresenceCheck(remote, names, settings.alerts.idle_seconds)
    alerts = Alerts(store, settings.alerts, presence.away, ntfy.send)
    runner = JobRunner([
        save_state_job(store, settings.data_dir),
        check_machines_job(store, remote),
        cleanup_job(settings, remote),
        digest_job(board, settings.digest, alerts.publish),
        backup_job(settings, remote, alerts.publish),
    ])
    store.subscribe(alerts.on_change)
    approvals = Approvals()
    store.subscribe(approvals.on_change)
    return Service(settings, version, store, remote, runner, followers, alerts, approvals, board)
