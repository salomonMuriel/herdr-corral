import asyncio
import json
import shlex
from dataclasses import dataclass
from typing import Any

from herdr_pi.config import MachineConfig, Settings

SSH_OPTIONS = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "LogLevel=ERROR",
]


class HcError(Exception):
    def __init__(self, machine: str, kind: str, message: str):
        super().__init__(f"{machine}: {kind}: {message}")
        self.machine = machine
        self.kind = kind
        self.message = message


@dataclass
class HcResult:
    code: int
    stdout: str
    stderr: str


def parse_error(machine: str, result: HcResult) -> HcError:
    try:
        error = json.loads(result.stderr)["error"]
        return HcError(machine, error.get("kind", "error"), error.get("message", ""))
    except (ValueError, KeyError, TypeError):
        detail = result.stderr.strip() or f"exit {result.code}"
        # ssh itself exits 255 when it can't connect.
        return HcError(machine, "unreachable" if result.code == 255 else "failed", detail)


def hc_command(machine: MachineConfig, args: list[str]) -> str:
    return " ".join([machine.hc, *(shlex.quote(arg) for arg in args)])


class Remote:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.known_hosts = settings.data_dir / "known_hosts"

    def ssh_argv(self, machine: MachineConfig, command: str) -> list[str]:
        return ["ssh", *SSH_OPTIONS, "-o", f"UserKnownHostsFile={self.known_hosts}", machine.ssh, command]

    def argv(self, machine: MachineConfig, args: list[str]) -> list[str]:
        return self.ssh_argv(machine, hc_command(machine, args))

    async def shell(self, machine_name: str, command: str, timeout: float = 30.0) -> HcResult:
        """Runs a shell command on the machine; ssh's own failures come back as exit 255."""
        process = await asyncio.create_subprocess_exec(
            *self.ssh_argv(self.settings.machine(machine_name), command),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
        except TimeoutError:
            process.kill()
            await process.wait()
            raise HcError(machine_name, "timeout", f"{command} took over {timeout:.0f} s")
        return HcResult(process.returncode or 0, stdout.decode(errors="replace"), stderr.decode(errors="replace"))

    async def send(self, machine_name: str, command: str, data: bytes, timeout: float = 60.0) -> HcResult:
        """Runs a shell command on the machine with `data` on its stdin."""
        process = await asyncio.create_subprocess_exec(
            *self.ssh_argv(self.settings.machine(machine_name), command),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(data), timeout)
        except TimeoutError:
            process.kill()
            await process.wait()
            raise HcError(machine_name, "timeout", f"{command} took over {timeout:.0f} s")
        return HcResult(process.returncode or 0, stdout.decode(errors="replace"), stderr.decode(errors="replace"))

    async def run(self, machine_name: str, args: list[str], timeout: float = 30.0) -> HcResult:
        return await self.shell(machine_name, hc_command(self.settings.machine(machine_name), args), timeout)

    async def hc(self, machine_name: str, *args: str, timeout: float = 30.0) -> str:
        result = await self.run(machine_name, list(args), timeout)
        if result.code != 0:
            raise parse_error(machine_name, result)
        return result.stdout

    async def hc_json(self, machine_name: str, *args: str, timeout: float = 30.0) -> Any:
        return json.loads(await self.hc(machine_name, *args, "--json", timeout=timeout))
