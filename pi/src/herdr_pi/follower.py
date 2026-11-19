import asyncio
import json
import logging
from typing import Any

from herdr_pi.events import is_own
from herdr_pi.remote import HcResult, Remote, parse_error
from herdr_pi.store import AgentStore

log = logging.getLogger(__name__)

MAX_LINE = 32 * 1024 * 1024
FIRST_RETRY = 2.0
MAX_RETRY = 60.0


class StreamStalled(Exception):
    pass


class Follower:
    """Keeps one `ssh <machine> hc events` open and feeds every line into the store."""

    def __init__(self, machine: str, remote: Remote, store: AgentStore, stall_seconds: float):
        self.machine = machine
        self.remote = remote
        self.store = store
        self.stall_seconds = stall_seconds
        self.seq = 0
        self.got_snapshot = False

    async def run(self) -> None:
        retry = FIRST_RETRY
        while True:
            self.got_snapshot = False
            try:
                error = await self.follow_once()
            except StreamStalled:
                error = f"no events for {self.stall_seconds:.0f} s"
            except (OSError, ValueError) as exception:
                error = str(exception)
            except Exception as exception:
                log.exception("%s: follower crashed", self.machine)
                error = f"{type(exception).__name__}: {exception}"
            self.store.mark_disconnected(self.machine, error)
            log.warning("%s: events stream ended: %s", self.machine, error)
            retry = FIRST_RETRY if self.got_snapshot else min(retry * 2, MAX_RETRY)
            await asyncio.sleep(retry)

    async def follow_once(self) -> str:
        machine = self.remote.settings.machine(self.machine)
        process = await asyncio.create_subprocess_exec(
            *self.remote.argv(machine, ["events", "--json"]),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=MAX_LINE,
        )
        assert process.stdout and process.stderr
        try:
            while True:
                try:
                    line = await asyncio.wait_for(process.stdout.readline(), self.stall_seconds)
                except TimeoutError as timeout:
                    raise StreamStalled from timeout
                if not line:
                    break
                self.handle(json.loads(line))
        finally:
            if process.returncode is None:
                process.kill()
            code = await process.wait()
        stderr = (await process.stderr.read()).decode(errors="replace")
        if code == 0 and not stderr.strip():
            return "the stream closed"
        return str(parse_error(self.machine, HcResult(code, "", stderr)))

    def handle(self, message: dict[str, Any]) -> None:
        if "terminals" in message:
            self.snapshot(message)
            return
        method = message.get("method")
        params = message.get("params") or {}
        if "terminals" in params:
            self.snapshot(params)
            return
        if method == "heartbeat":
            self.store.touch(self.machine)
            return
        if method != "event":
            log.info("%s: unhandled %s", self.machine, method)
            return
        seq = params.get("seq", 0)
        if seq <= self.seq:
            return
        self.seq = seq
        address = params.get("terminal", "")
        if not is_own(address):
            return
        self.store.apply(self.machine, params.get("type", ""), address, params.get("data") or {})

    def snapshot(self, message: dict[str, Any]) -> None:
        self.seq = message.get("seq", 0)
        own = [record for record in message["terminals"] if is_own(record.get("address", "/"))]
        self.store.replace(self.machine, own)
        if not self.got_snapshot:
            log.info("%s: following %d terminals", self.machine, len(own))
        self.got_snapshot = True
