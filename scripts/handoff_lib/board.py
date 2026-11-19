"""The task a tab works on, and pointing it at the moved session."""
import json
import urllib.error
import urllib.request
from dataclasses import dataclass

from handoff_lib.machines import HandoffError, board_config, self_name

from herdr_config import sql_endpoint


@dataclass
class Link:
    task_id: str
    title: str
    notes: str
    subproject_id: str | None
    part: bool
    report: str | None
    reported_at: str | None


def post(queries: list[dict]) -> list[list[dict]]:
    config = board_config()
    board = config["board"]
    request = urllib.request.Request(
        sql_endpoint(board['host']),
        data=json.dumps({"queries": queries}).encode(),
        headers={"Content-Type": "application/json", "Neon-Connection-String": board["url"],
                 "Neon-Batch-Isolation-Level": "ReadCommitted"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return [result["rows"] for result in json.load(response)["results"]]
    except urllib.error.URLError as error:
        raise HandoffError(f"the board refused: {error}") from error


def read(query: str, params: list) -> list[dict]:
    return post([{"query": query, "params": params}])[0]


# task_events (schema/0001_board.sql) records the person on this machine as the writer.
def write(query: str, params: list) -> None:
    actor = {"query": "select set_config('herdr.actor', 'person', true), set_config('herdr.machine', $1, true)",
             "params": [self_name()]}
    post([actor, {"query": query, "params": params}])


# Stored tabs carry a machine prefix ("laptop/tb12"); tab ids are unique on their own.
def find(tab: str) -> Link | None:
    bare = tab.split("/")[-1]
    rows = read("select id, title, notes, subproject_id, report, reported_at::text from tasks"
                " where tab = $1 or split_part(tab, '/', 2) = $2 order by updated_at desc limit 1", [tab, bare])
    if rows:
        row = rows[0]
        return Link(row["id"], row["title"], row["notes"] or "", row["subproject_id"], False, row["report"], row["reported_at"])
    parts = read("select t.id, t.title, t.notes, r.subproject_id, t.report, t.reported_at::text from task_repos r"
                 " join tasks t on t.id = r.task_id where r.tab = $1 or split_part(r.tab, '/', 2) = $2"
                 " order by r.updated_at desc limit 1", [tab, bare])
    if not parts:
        return None
    row = parts[0]
    return Link(row["id"], row["title"], row["notes"] or "", row["subproject_id"], True, row["report"], row["reported_at"])


def refresh(link: Link) -> Link:
    row = read("select report, reported_at::text from tasks where id = $1", [link.task_id])[0]
    return Link(link.task_id, link.title, link.notes, link.subproject_id, link.part, row["report"], row["reported_at"])


def relink(link: Link, tab: str, machine: str) -> None:
    if link.part:
        write("update task_repos set tab = $3, machine = $4, updated_at = now() where task_id = $1 and subproject_id = $2",
              [link.task_id, link.subproject_id, tab, machine])
        return
    write("update tasks set tab = $2, machine = $3, updated_at = now() where id = $1", [link.task_id, tab, machine])


def note(link: Link, text: str, kind: str = "note") -> None:
    write("update tasks set report = $2, report_kind = $3, reported_at = now(), updated_at = now() where id = $1",
          [link.task_id, text, kind])
