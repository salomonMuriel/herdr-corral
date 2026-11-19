from pathlib import Path

import pytest

from herdr_pi.cleanup_job import cleanup_job
from herdr_pi.config import MachineConfig, Settings
from herdr_pi.remote import HcResult


class FakeRemote:
    def __init__(self, results: dict[str, HcResult]):
        self.results = results
        self.calls: list[str] = []

    async def shell(self, machine_name: str, command: str, timeout: float = 30.0) -> HcResult:
        self.calls.append(machine_name)
        return self.results[machine_name]


def settings() -> Settings:
    machines = [MachineConfig(name="desk", ssh="b"), MachineConfig(name="laptop", ssh="m")]
    return Settings(machines=machines, data_dir=Path("/data"))


async def test_cleanup_moves_on_when_a_machine_is_unreachable() -> None:
    remote = FakeRemote({
        "desk": HcResult(255, "", "ssh: connect to host desk: timed out"),
        "laptop": HcResult(0, "Scanning...\nremoved 2 (1.0G), 3 to review\n", "warning: desk skipped"),
    })
    job = cleanup_job(settings(), remote)
    assert await job.run() == "laptop: removed 2 (1.0G), 3 to review"
    assert remote.calls == ["desk", "laptop"]


async def test_cleanup_moves_on_when_a_machine_has_no_script() -> None:
    remote = FakeRemote({
        "desk": HcResult(127, "", "sh: ~/git/herdr-projects/scripts/nightly-cleanup: not found"),
        "laptop": HcResult(0, "removed 0, 1 to review\n", ""),
    })
    job = cleanup_job(settings(), remote)
    assert await job.run() == "laptop: removed 0, 1 to review"
    assert remote.calls == ["desk", "laptop"]


async def test_cleanup_stops_at_the_first_machine_that_fails() -> None:
    remote = FakeRemote({"desk": HcResult(1, "", "board tasks unavailable: timed out\n")})
    job = cleanup_job(settings(), remote)
    with pytest.raises(RuntimeError, match="desk: board tasks unavailable"):
        await job.run()
    assert remote.calls == ["desk"]


async def test_cleanup_fails_when_no_machine_answers() -> None:
    down = HcResult(255, "", "")
    job = cleanup_job(settings(), FakeRemote({"desk": down, "laptop": down}))
    with pytest.raises(RuntimeError, match=r"no machine could run it: desk \(unreachable\), laptop \(unreachable\)"):
        await job.run()
