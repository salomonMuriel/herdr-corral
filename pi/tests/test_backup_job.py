from pathlib import Path

from herdr_pi.backup_job import copy_to_machines, prune
from herdr_pi.config import MachineConfig, Settings
from herdr_pi.remote import HcError, HcResult


class FakeRemote:
    def __init__(self, results: dict[str, HcResult | HcError]):
        self.results = results
        self.sent: dict[str, bytes] = {}

    async def send(self, machine_name: str, command: str, data: bytes, timeout: float = 60.0) -> HcResult:
        result = self.results[machine_name]
        if isinstance(result, HcError):
            raise result
        self.sent[machine_name] = data
        return result


def settings() -> Settings:
    machines = [MachineConfig(name="desk", ssh="b"), MachineConfig(name="laptop", ssh="m")]
    return Settings(machines=machines, data_dir=Path("/data"))


def test_prune_keeps_the_newest_dumps(tmp_path: Path) -> None:
    for day in range(1, 6):
        (tmp_path / f"board-2026-11-0{day}.dump").write_bytes(b"x")
    removed = prune(tmp_path, keep=3)
    assert [path.name for path in removed] == ["board-2026-11-01.dump", "board-2026-11-02.dump"]
    assert sorted(path.name for path in tmp_path.iterdir()) == [
        "board-2026-11-03.dump", "board-2026-11-04.dump", "board-2026-11-05.dump",
    ]


async def test_copy_reports_machines_it_missed() -> None:
    remote = FakeRemote({
        "desk": HcResult(0, "", ""),
        "laptop": HcResult(255, "", "ssh: connect to host laptop: timed out"),
    })
    copied, missed = await copy_to_machines(settings(), remote, b"dump")
    assert copied == ["desk"]
    assert missed == ["laptop (unreachable)"]
    assert remote.sent["desk"] == b"dump"


async def test_copy_moves_on_after_a_timeout() -> None:
    remote = FakeRemote({
        "desk": HcError("desk", "timeout", "took over 60 s"),
        "laptop": HcResult(0, "", ""),
    })
    copied, missed = await copy_to_machines(settings(), remote, b"dump")
    assert copied == ["laptop"]
    assert missed == ["desk (took over 60 s)"]


async def test_each_machine_gets_the_dump_in_its_own_folder() -> None:
    class RecordingRemote:
        def __init__(self) -> None:
            self.commands: dict[str, str] = {}

        async def send(self, machine_name: str, command: str, data: bytes, timeout: float = 60.0) -> HcResult:
            self.commands[machine_name] = command
            return HcResult(0, "", "")

    machines = [
        MachineConfig(name="desk", ssh="b", backup_dir="/srv/backups/herdr-board"),
        MachineConfig(name="laptop", ssh="m"),
    ]
    remote = RecordingRemote()
    await copy_to_machines(Settings(machines=machines, data_dir=Path("/data")), remote, b"dump")
    assert "cat > /srv/backups/herdr-board/board.dump.part" in remote.commands["desk"]
    assert "cat > ~/.local/share/herdr-board/board.dump.part" in remote.commands["laptop"]
