"""Adds a row to the board's deployments table: python3 record_deploy.py <sha> <machine>."""

import json
import sys
import urllib.request
from pathlib import Path

CONFIG_PATH = Path.home() / ".config/herdr-board/config.json"


def record(sha: str, machine: str) -> None:
    config = json.loads(CONFIG_PATH.read_text())
    board = config["board"]
    body = json.dumps({
        "query": "insert into deployments (sha, deployed_by) values ($1, $2)",
        "params": [sha, machine],
    }).encode()
    request = urllib.request.Request(
        f"https://{board['host']}/sql",
        data=body,
        headers={"Content-Type": "application/json", "Neon-Connection-String": board["url"]},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        response.read()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: record_deploy.py <sha> <machine>")
    record(sys.argv[1], sys.argv[2])
