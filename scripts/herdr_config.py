"""Reads ~/.config/herdr-board/config.json for scripts, in Python or from bash.

  python3 herdr_config.py self              this machine's name
  python3 herdr_config.py machines          every machine's name, one per line
  python3 herdr_config.py ssh <machine>     its ssh destination
  python3 herdr_config.py platform <machine> linux or macos
  python3 herdr_config.py get <dotted.key> [default]
"""
from __future__ import annotations

import json
import os
import socket
import sys
from functools import cache
from pathlib import Path
from typing import Any

CONFIG_PATH = Path(os.environ.get("HERDR_BOARD_CONFIG", Path.home() / ".config/herdr-board/config.json"))


@cache
def load() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise SystemExit(f"No config at {CONFIG_PATH}; see INSTALL.md")
    return json.loads(CONFIG_PATH.read_text())


def self_name() -> str:
    host = socket.gethostname()
    names = load().get("machines") or {}
    return names.get(host) or names.get(host.split(".")[0]) or host.split(".")[0]


def hosts() -> dict[str, dict[str, Any]]:
    return load().get("hosts") or {}


def machine_names() -> list[str]:
    return list(hosts()) or [self_name()]


def ssh_target(machine: str) -> str:
    return hosts().get(machine, {}).get("ssh", machine)


def platform(machine: str) -> str:
    return hosts().get(machine, {}).get("platform", "linux")


def get(dotted: str, default: Any = None) -> Any:
    value: Any = load()
    for part in dotted.split("."):
        if not isinstance(value, dict) or part not in value:
            return default
        value = value[part]
    return value


def main(argv: list[str]) -> None:
    command, *rest = argv or ["self"]
    if command == "self":
        print(self_name())
    elif command == "machines":
        print("\n".join(machine_names()))
    elif command == "ssh" and rest:
        print(ssh_target(rest[0]))
    elif command == "platform" and rest:
        print(platform(rest[0]))
    elif command == "get" and rest:
        value = get(rest[0], rest[1] if len(rest) > 1 else None)
        if value is None:
            raise SystemExit(f"{rest[0]} isn't set in {CONFIG_PATH}")
        print(value)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
