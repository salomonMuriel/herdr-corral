import json
import os
import urllib.request
from pathlib import Path

from herdr_config import sql_endpoint

BOARD_CONFIG = Path(os.environ.get("HERDR_BOARD_CONFIG", Path.home() / ".config/herdr-board/config.json"))


def query(sql: str, params: list[str | None]) -> list[dict]:
    config = json.loads(BOARD_CONFIG.read_text())
    board = config["board"]
    request = urllib.request.Request(
        sql_endpoint(board['host']),
        data=json.dumps({"query": sql, "params": params}).encode(),
        headers={"Content-Type": "application/json", "Neon-Connection-String": board["url"]},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)["rows"]


def tasks() -> list[dict]:
    return query("select title, status, branch from tasks union all"
                 " select t.title, t.status, r.branch from task_repos r join tasks t on t.id = r.task_id"
                 " where r.branch is not null", [])


def latest_run() -> dict | None:
    rows = query("select review, neon from cleanup_runs order by id desc limit 1", [])
    return rows[0] if rows else None


def record_run(machine: str, removed: list[dict], review: list[dict], neon: list[dict],
               skipped: dict[str, str]) -> None:
    query("insert into cleanup_runs (machine, removed, review, neon, skipped)"
          " values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb)",
          [machine, *(json.dumps(value) for value in (removed, review, neon, skipped))])
    query("delete from cleanup_runs where ran_at < now() - interval '60 days'", [])


def record_cleanup(task_id: str, kind: str, text: str, subproject_id: str | None = None) -> None:
    """A second run finds the worktree already gone; it doesn't replace what the first one freed."""
    if subproject_id:
        query("update task_repos set cleanup = $3, cleanup_kind = $4, cleanup_at = now(), updated_at = now()"
              " where task_id = $1 and subproject_id = $2 and cleanup_kind is distinct from 'removed'",
              [task_id, subproject_id, text, kind])
        return
    query("update tasks set cleanup = $2, cleanup_kind = $3, cleanup_at = now()"
          " where id = $1 and cleanup_kind is distinct from 'removed'", [task_id, text, kind])
