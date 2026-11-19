import asyncio
import json
import logging
import time
from dataclasses import dataclass

from herdr_pi.remote import HcError, Remote

log = logging.getLogger(__name__)

PRESENCE_COMMAND = "~/.local/bin/herdr-presence"
CACHE_SECONDS = 5.0


@dataclass
class Presence:
    machine: str
    window: str
    idle_seconds: float | None = None
    error: str | None = None

    def is_here(self, idle_limit: float) -> bool:
        if self.window != "active":
            return False
        return self.idle_seconds is None or self.idle_seconds < idle_limit


async def read_presence(remote: Remote, machine: str) -> Presence:
    try:
        result = await remote.shell(machine, PRESENCE_COMMAND, timeout=15)
        if result.code != 0:
            return Presence(machine, "unknown", error=result.stderr.strip() or f"exit {result.code}")
        reading = json.loads(result.stdout)
        return Presence(machine, reading.get("window", "unknown"), reading.get("idle_seconds"))
    except (HcError, OSError, ValueError) as error:
        return Presence(machine, "unknown", error=str(error))


class PresenceCheck:
    """Whether the person is away from every Herdr window, asked of each machine over ssh."""

    def __init__(self, remote: Remote, machines: list[str], idle_limit: float):
        self.remote = remote
        self.machines = machines
        self.idle_limit = idle_limit
        self.readings: list[Presence] = []
        self.read_at = 0.0
        self.lock = asyncio.Lock()

    async def read(self) -> list[Presence]:
        async with self.lock:
            if time.monotonic() - self.read_at > CACHE_SECONDS:
                self.readings = list(await asyncio.gather(*(read_presence(self.remote, m) for m in self.machines)))
                self.read_at = time.monotonic()
                for reading in self.readings:
                    if reading.error:
                        log.info("%s: no presence: %s", reading.machine, reading.error)
            return self.readings

    async def away(self) -> bool:
        return not any(reading.is_here(self.idle_limit) for reading in await self.read())
