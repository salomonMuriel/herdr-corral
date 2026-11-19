import json
import subprocess
import time
from dataclasses import dataclass

from handoff_lib.machines import HandoffError, run, self_name, tool

# Flags of claude (and codex, where they don't clash) that take a value, so the value isn't
# taken for the first message.
VALUE_FLAGS = {
    "--settings", "--model", "-m", "--permission-mode", "--add-dir", "--append-system-prompt",
    "--system-prompt", "--mcp-config", "--allowedTools", "--allowed-tools", "--disallowedTools",
    "--disallowed-tools", "--agent", "--agents", "--fallback-model", "--plugin-dir", "--effort",
    "--config", "-s", "--sandbox", "-a", "--ask-for-approval", "--profile", "-C", "--cd",
}
RESUME_FLAGS = {"--resume", "-r", "--session-id", "--name", "-n"}
BARE_RESUME_FLAGS = {"--continue", "-c", "--fork-session"}
IDLE_WAIT_S = 45 * 60
EXIT_WAIT_S = 60


@dataclass
class Terminal:
    address: str
    machine: str
    tab: str
    space: str
    status: str
    app: str | None
    argv: list[str]
    pid: int | None
    cwd: str

    @property
    def canonical_tab(self) -> str:
        return self.tab if "/" in self.tab else f"{self.machine}/{self.tab}"

    @property
    def window_tab(self) -> str:
        """The tab's id as this machine's window names it."""
        return self.tab if self.machine == self_name() else f"{self.machine}/{self.tab}"

    @property
    def is_claude(self) -> bool:
        return self.app == "claude-code" or (bool(self.argv) and self.argv[0].endswith("claude"))


def hc(*args: str, timeout: int = 60) -> dict:
    result = subprocess.run([tool("hc"), *args, "--json"], capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise HandoffError(f"hc {args[0]} failed: {(result.stderr or result.stdout).strip()[:300]}")
    return json.loads(result.stdout or "{}")


def load(address: str) -> Terminal:
    info = hc("get", address)
    labels = info.get("labels") or {}
    if not labels.get("herdr.tab"):
        raise HandoffError(f"{address} isn't in a Herdr tab")
    foreground = info.get("foreground") or {}
    machine = address.split("/", 1)[0] if "/" in address else self_name()
    return Terminal(
        address=address, machine=machine, tab=labels["herdr.tab"], space=labels.get("herdr.space", ""),
        status=(info.get("status") or {}).get("state") or "", app=(info.get("status") or {}).get("app"),
        argv=foreground.get("argv") or [], pid=foreground.get("pid"), cwd=foreground.get("cwd") or info["cwd"],
    )


def wait_idle(terminal: Terminal) -> str:
    """Waits for the agent's turn to end and returns its status then."""
    deadline = time.monotonic() + IDLE_WAIT_S
    while time.monotonic() < deadline:
        waited = hc("wait", terminal.address, timeout=240)
        if waited.get("reason") != "timeout":
            return waited.get("status") or ""
    raise HandoffError(f"{terminal.address} was still working after {IDLE_WAIT_S // 60} minutes")


def send(terminal: Terminal, text: str) -> None:
    hc("send", terminal.address, text)


# Typed key by key: hc send wraps text from an agent in <hc> tags, so a slash command wouldn't run.
def exit_claude(terminal: Terminal) -> None:
    hc("keys", terminal.address, "ctrl+u")
    hc("keys", terminal.address, *"/exit")
    time.sleep(0.5)
    hc("keys", terminal.address, "enter")
    wait_exit(terminal)


def wait_exit(terminal: Terminal) -> None:
    deadline = time.monotonic() + EXIT_WAIT_S
    while time.monotonic() < deadline:
        if run(terminal.machine, ["kill", "-0", str(terminal.pid)]).returncode != 0:
            return
        time.sleep(1)
    raise HandoffError(f"the agent in {terminal.address} didn't exit")


def was_resumed(argv: list[str]) -> bool:
    return any(arg in RESUME_FLAGS or arg in BARE_RESUME_FLAGS for arg in argv[1:])


def split_argv(argv: list[str]) -> tuple[list[str], list[str]]:
    """The program with its flags, and the positional arguments (the first message)."""
    flags, positional = argv[:1], []
    rest = iter(argv[1:])
    for arg in rest:
        if arg in BARE_RESUME_FLAGS:
            continue
        if arg in RESUME_FLAGS:
            next(rest, None)
            continue
        if arg in VALUE_FLAGS:
            flags += [arg, next(rest, "")]
        elif arg.startswith("-"):
            flags.append(arg)
        else:
            positional.append(arg)
    return flags, positional
