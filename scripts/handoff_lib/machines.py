import json
import shutil
import subprocess
from pathlib import Path

import herdr_config

LOCAL_BIN = Path.home() / ".local/bin"


class HandoffError(Exception):
    pass


def tool(name: str) -> str:
    found = shutil.which(name) or (str(LOCAL_BIN / name) if (LOCAL_BIN / name).exists() else None)
    if not found:
        raise HandoffError(f"{name} isn't installed here")
    return found


def board_config() -> dict:
    return herdr_config.load()


def self_name() -> str:
    return herdr_config.self_name()


def known_machines() -> list[str]:
    listed = subprocess.run([tool("hc"), "machine", "ls", "--json"], capture_output=True, text=True, timeout=20)
    if listed.returncode != 0:
        raise HandoffError(f"hc machine ls failed: {listed.stderr.strip()}")
    return [self_name(), *(m["name"] for m in json.loads(listed.stdout)["machines"])]


def label(machine: str) -> str:
    return (board_config().get("labels") or {}).get(machine, machine)


def run(machine: str, argv: list[str], stdin: bytes | None = None, timeout: int = 300) -> subprocess.CompletedProcess[bytes]:
    """Runs argv on a machine: here directly, elsewhere through hc exec, bytes in and out."""
    if machine == self_name():
        command = argv
    else:
        command = [tool("hc"), "exec", "--on", machine, *(["-i"] if stdin is not None else []), "--", *argv]
    return subprocess.run(command, input=stdin, capture_output=True, timeout=timeout)


def output(machine: str, argv: list[str], stdin: bytes | None = None, what: str = "") -> str:
    result = run(machine, argv, stdin)
    if result.returncode != 0:
        detail = result.stderr.decode(errors="replace").strip() or result.stdout.decode(errors="replace").strip()
        raise HandoffError(f"{what or argv[0]} failed on {machine}: {detail[:400]}")
    return result.stdout.decode(errors="replace").strip()


def shell(machine: str, script: str, *args: str, stdin: bytes | None = None, what: str = "") -> str:
    return output(machine, ["sh", "-c", script, "sh", *args], stdin, what)


def home(machine: str) -> str:
    return shell(machine, 'printf %s "$HOME"', what="reading $HOME")


def move_home(path: str, from_home: str, to_home: str) -> str:
    if path == from_home or path.startswith(f"{from_home}/"):
        return to_home + path[len(from_home):]
    return path
