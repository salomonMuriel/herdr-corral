"""Points a machine at a board: python3 board_config.py <config path> <host> [url].

Writes the `board` block of ~/.config/herdr-board/config.json; without a url it keeps the
one already there, and a url of - is read from stdin so it stays out of the process list.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def point(path: Path, host: str, url: str | None) -> None:
    config = json.loads(path.read_text())
    config["board"] = {"host": host, "url": url or config["board"]["url"]}
    part = path.with_name(path.name + ".part")
    part.unlink(missing_ok=True)
    # Private from the first byte: the file holds the board's password.
    with os.fdopen(os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as file:
        file.write(json.dumps(config, indent=2) + "\n")
    part.replace(path)


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit("usage: board_config.py <config path> <host> [url]")
    url = sys.argv[3] if len(sys.argv) == 4 else None
    point(Path(sys.argv[1]).expanduser(), sys.argv[2], sys.stdin.read().strip() if url == "-" else url)
