"""Points a machine at a board: python3 board_config.py <config path> <host> [url].

Writes the `board` block of ~/.config/herdr-board/config.json; without a url it keeps the
one already there.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def point(path: Path, host: str, url: str | None) -> None:
    config = json.loads(path.read_text())
    config["board"] = {"host": host, "url": url or config["board"]["url"]}
    part = path.with_name(path.name + ".part")
    part.write_text(json.dumps(config, indent=2) + "\n")
    part.chmod(0o600)
    part.replace(path)


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit("usage: board_config.py <config path> <host> [url]")
    point(Path(sys.argv[1]).expanduser(), sys.argv[2], sys.argv[3] if len(sys.argv) == 4 else None)
