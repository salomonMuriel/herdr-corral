"""Adds a row to the board's deployments table: python3 record_deploy.py <sha> <machine>."""

import json
import sys
import urllib.error
import urllib.request

import herdr_config


def record(sha: str, machine: str) -> None:
    board = herdr_config.load()["board"]
    body = json.dumps({
        "query": "insert into deployments (sha, deployed_by) values ($1, $2)",
        "params": [sha, machine],
    }).encode()
    request = urllib.request.Request(
        herdr_config.sql_endpoint(board["host"]),
        data=body,
        headers={"Content-Type": "application/json", "Neon-Connection-String": board["url"]},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        response.read()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: record_deploy.py <sha> <machine>")
    try:
        record(sys.argv[1], sys.argv[2])
    except (OSError, KeyError, ValueError) as error:
        sys.exit(f"couldn't record the deploy on the board: {error}")
