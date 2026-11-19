"""hb for a project's coordinator: the session whose tab is in the coordinators table.

hb calls this module with the helpers it shares (Board); it never imports hb back.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

# Mirrors slotsFor and PER_REPO in mods/projects/chain.js.
DEFAULT_SLOTS = 4
PER_REPO = 3
IMPORTANCE = ("urgent", "high", "normal", "low")
ASK_LABEL = "herdr.coordinator.ask"
ASKED_LABEL = "herdr.coordinator.asked"
# bin/herdr-ask clears the question when the person answers in the terminal.
ASK_MARKERS = Path.home() / ".cache/herdr-corral/coordinator-ask"
DONE_SHOWN = 8
REPORT_CHARS = 240
SECTIONS = (("doing", "In progress"), ("review", "Review (waits for the person)"), ("todo", "To do"), ("done", "Done lately"))
USAGE = """A coordinator's session:

  hb board                                the project's tasks, their agents and the free slots
  hb add "<title>" [notes] [--repo R] [--after ID]... [--importance I]
                                          a new To do task; --after makes it wait on ID
  hb start ID... [--on MACHINE]           start agents on To do tasks as slots free up
  hb tell ID "<message>"                  send a task's agent a message
  hb ask "<question>"                     pass a question on to the person, then wait
  hb note "<text>"                        what you're doing, for your row
  hb show                                 which project you coordinate"""
OPTIONS = {"--repo": "repo", "--after": "after", "--importance": "importance", "--on": "on"}


@dataclass
class Board:
    sql: Callable[[str, list[Any]], list[dict[str, Any]]]
    write: Callable[..., list[dict[str, Any]]]
    fail: Callable[[str], None]
    tool: Callable[[str], Any]
    machine: str
    new_id: Callable[[], str]
    nudge: Callable[[], None]
    hosts: dict[str, dict[str, Any]]

    def slots(self) -> dict[str, int]:
        names = list(self.hosts) or [self.machine]
        return {name: int(self.hosts.get(name, {}).get("slots", DEFAULT_SLOTS)) for name in names}


def find(board: Board, tab: str) -> dict[str, Any] | None:
    rows = board.sql(
        "select c.project_id, c.machine, c.tab, p.name as project from coordinators c join projects p on p.id = c.project_id"
        " where split_part(c.tab, '/', 2) = $1 or c.tab = $1 limit 1",
        [tab],
    )
    return rows[0] if rows else None


def parse(args: list[str]) -> tuple[list[str], dict[str, Any]]:
    positional: list[str] = []
    options: dict[str, Any] = {"after": []}
    index = 0
    while index < len(args):
        name = OPTIONS.get(args[index])
        if name and index + 1 < len(args):
            value = args[index + 1]
            if name == "after":
                options["after"].append(value)
            else:
                options[name] = value
            index += 2
            continue
        positional.append(args[index])
        index += 1
    return positional, options


def hc(board: Board, args: list[str], timeout: int = 20) -> subprocess.CompletedProcess[str]:
    path = board.tool("hc")
    if not path:
        board.fail("hc not found")
    return subprocess.run([path, *args], capture_output=True, text=True, timeout=timeout)


# Task tabs are stored as "machine/tab"; each agent terminal carries its own tab in herdr.tab.
def agent_terminals(board: Board) -> dict[str, dict[str, Any]]:
    listing = hc(board, ["ls", "--json"])
    if listing.returncode != 0:
        return {}
    found: dict[str, dict[str, Any]] = {}
    for terminal in json.loads(listing.stdout or "{}").get("terminals", []):
        if not terminal.get("status"):
            continue
        info = hc(board, ["get", terminal["address"], "--json"])
        if info.returncode != 0:
            continue
        tab = (json.loads(info.stdout).get("labels") or {}).get("herdr.tab")
        if tab:
            found[tab] = {"address": terminal["address"], "status": terminal["status"]}
    return found


def tab_key(tab: str | None) -> str:
    return (tab or "").split("/")[-1]


def project_tasks(board: Board, project_id: str) -> list[dict[str, Any]]:
    return board.sql(
        "select t.id, t.title, t.status, t.importance, t.machine, t.tab, t.report, t.report_kind, s.name as repo,"
        " (select string_agg(d.depends_on, ' ') from task_deps d join tasks u on u.id = d.depends_on"
        "   where d.task_id = t.id and u.status <> 'done') as waits_on,"
        " exists (select 1 from runs r where r.status = 'active' and r.task_ids ? t.id) as in_run"
        " from tasks t left join subprojects s on s.id = t.subproject_id"
        " where t.project_id = $1 and (t.status <> 'done' or t.done_at > now() - interval '2 days')"
        " order by t.done_at desc nulls first, t.position",
        [project_id],
    )


def slot_line(board: Board, project_id: str) -> str:
    machines = board.sql("select machine, count(*)::int as busy from tasks where status = 'doing' and machine is not null group by machine", [])
    repos = board.sql(
        "select s.name, count(t.id)::int as busy from subprojects s left join tasks t on t.subproject_id = s.id and t.status = 'doing'"
        " where s.project_id = $1 group by s.name, s.position order by s.position",
        [project_id],
    )
    busy = {row["machine"]: row["busy"] for row in machines}
    parts = [f"{name} {busy.get(name, 0)}/{limit}" for name, limit in board.slots().items()]
    repo_parts = [f"{row['name']} {row['busy']}/{PER_REPO}" for row in repos]
    return f"Slots: {' · '.join(parts)}. Per repo: {' · '.join(repo_parts) or 'no repos'}"


def task_line(task: dict[str, Any], agents: dict[str, dict[str, Any]]) -> str:
    bits = [f"  {task['id']}  {task['title']}"]
    if task.get("repo"):
        bits.append(f"[{task['repo']}]")
    if task.get("importance") not in (None, "normal"):
        bits.append(task["importance"])
    if task.get("waits_on") and task["status"] != "done":
        bits.append(f"waits on {task['waits_on']}")
    agent = agents.get(tab_key(task.get("tab"))) if task.get("tab") else None
    if agent:
        bits.append(f"agent {agent['address']} {agent['status']}")
    elif task.get("tab") and task["status"] != "done":
        bits.append(f"on {task.get('machine') or '?'}, no live agent")
    if task["status"] == "todo" and task.get("in_run"):
        bits.append("queued to start")
    line = "  ".join(bits)
    report = task.get("report") or ""
    if report:
        short = report if len(report) <= REPORT_CHARS else f"{report[:REPORT_CHARS]}…"
        line += f"\n        {task.get('report_kind') or 'note'}: {short}"
    return line


def show_board(board: Board, coordinator: dict[str, Any]) -> None:
    tasks = project_tasks(board, coordinator["project_id"])
    agents = agent_terminals(board)
    print(f"{coordinator['project']}: you coordinate it from {coordinator['machine']}")
    print(slot_line(board, coordinator["project_id"]))
    for status, label in SECTIONS:
        shown = [t for t in tasks if t["status"] == status][: DONE_SHOWN if status == "done" else None]
        if not shown:
            continue
        print(f"\n{label}")
        for task in shown:
            print(task_line(task, agents))


def repo_id(board: Board, project_id: str, name: str | None) -> str:
    repos = board.sql("select id, name from subprojects where project_id = $1 order by position, name", [project_id])
    if not repos:
        board.fail("the project has no repo")
    if not name:
        if len(repos) > 1:
            board.fail(f"pick a repo with --repo: {', '.join(r['name'] for r in repos)}")
        return repos[0]["id"]
    match = next((r for r in repos if r["name"] == name or r["id"] == name), None)
    if not match:
        board.fail(f"no repo {name}; the project has {', '.join(r['name'] for r in repos)}")
    return match["id"]


def add_task(board: Board, coordinator: dict[str, Any], args: list[str]) -> None:
    positional, options = parse(args)
    if not positional or not positional[0].strip():
        board.fail('usage: hb add "<title>" [notes] [--repo R] [--after ID]... [--importance I]')
    importance = options.get("importance", "normal")
    if importance not in IMPORTANCE:
        board.fail(f"importance is one of {', '.join(IMPORTANCE)}")
    project_id = coordinator["project_id"]
    subproject_id = repo_id(board, project_id, options.get("repo"))
    task_id = board.new_id()
    title, notes = positional[0].strip(), " ".join(positional[1:]).strip()
    queries = [(
        "insert into tasks (id, project_id, subproject_id, title, notes, status, importance, position)"
        " values ($1, $2, $3, $4, $5, 'todo', $6,"
        "   (select coalesce(min(position), 1) - 1 from tasks where project_id = $2 and status = 'todo'))",
        [task_id, project_id, subproject_id, title, notes, importance],
    )]
    for upstream in options["after"]:
        queries.append((
            "insert into task_deps (task_id, depends_on) select $1, id from tasks where id = $2 and project_id = $3 on conflict do nothing",
            [task_id, upstream, project_id],
        ))
    board.write(queries, actor="coordinator")
    waits = f", waits on {' '.join(options['after'])}" if options["after"] else ""
    print(f"Added {title} ({task_id}) to To do{waits}")
    board.nudge()


def pick_machine(board: Board, coordinator: dict[str, Any], wanted: str | None) -> str:
    machine = wanted or coordinator["machine"]
    if machine not in board.slots():
        board.fail(f"no machine {machine}; use one of {', '.join(board.slots())}")
    return machine


def startable(board: Board, project_id: str, ids: list[str]) -> list[dict[str, Any]]:
    rows = board.sql(
        "select id, title, status, subproject_id, tab from tasks where project_id = $1 and $2::jsonb ? id",
        [project_id, json.dumps(ids)],
    )
    by_id = {row["id"]: row for row in rows}
    for task_id in ids:
        task = by_id.get(task_id)
        if not task:
            board.fail(f"{task_id} isn't a task of this project")
        if task["status"] != "todo" or task.get("tab"):
            board.fail(f"{task['title']} ({task_id}) isn't in To do without an agent")
        if not task.get("subproject_id"):
            board.fail(f"{task['title']} ({task_id}) has no repo; set one with the person or add the task again")
    return [by_id[task_id] for task_id in ids]


# The window of that machine starts each task once a slot is free and what it waits on is Done.
def start_tasks(board: Board, coordinator: dict[str, Any], args: list[str]) -> None:
    ids, options = parse(args)
    if not ids:
        board.fail("usage: hb start ID... [--on MACHINE]")
    machine = pick_machine(board, coordinator, options.get("on"))
    tasks = startable(board, coordinator["project_id"], ids)
    board.write([(
        "insert into runs (id, project_id, task_ids, machine, agent, started_by) values ($1, $2, $3::jsonb, $4, 'claude', 'coordinator')",
        [board.new_id(), coordinator["project_id"], json.dumps(ids), machine],
    )], actor="coordinator")
    wake(board, machine)
    print(f"Starting on {machine}: {', '.join(t['title'] for t in tasks)}")
    print(slot_line(board, coordinator["project_id"]))


def wake(board: Board, machine: str) -> None:
    if machine == board.machine:
        board.nudge()
        return
    try:
        hc(board, ["exec", "--on", machine, "sh", "-c", '"$HOME/.local/bin/herdr-app" do projects.pull'], timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        print(f"{machine} didn't answer; its window starts the tasks when it next pulls")


def tell(board: Board, coordinator: dict[str, Any], args: list[str]) -> None:
    if len(args) < 2:
        board.fail('usage: hb tell ID "<message>"')
    task_id, message = args[0], " ".join(args[1:]).strip()
    rows = board.sql("select title, tab from tasks where id = $1 and project_id = $2", [task_id, coordinator["project_id"]])
    if not rows or not rows[0].get("tab"):
        board.fail(f"{task_id} has no agent in this project")
    agent = agent_terminals(board).get(tab_key(rows[0]["tab"]))
    if not agent:
        board.fail(f"{rows[0]['title']} has no live agent")
    sent = hc(board, ["send", agent["address"], message], timeout=60)
    if sent.returncode != 0:
        board.fail(f"hc send {agent['address']} failed: {sent.stderr.strip()} (a blocked agent takes hc keys)")
    print(f"Sent to {rows[0]['title']} ({agent['address']})")


def ask(board: Board, terminal: str, text: str) -> None:
    asked = hc(board, ["label", terminal, f"{ASK_LABEL}={text}", f"{ASKED_LABEL}={int(time.time() * 1000)}"])
    if asked.returncode != 0:
        board.fail(f"hc label {terminal} failed: {asked.stderr.strip()}")
    own = os.environ.get("HC_TERMINAL_ID")
    if own:
        ASK_MARKERS.mkdir(parents=True, exist_ok=True)
        (ASK_MARKERS / own).write_text(terminal)
    print("Passed on to the person. Stop here; the answer comes to you as a message.")


def note(board: Board, coordinator: dict[str, Any], text: str) -> None:
    board.write([("update coordinators set note = $2, noted_at = now() where project_id = $1", [coordinator["project_id"], text])], actor="coordinator")
    print("Note saved")


def run(board: Board, coordinator: dict[str, Any], terminal: str, command: str, args: list[str]) -> None:
    text = " ".join(args).strip()
    if command == "show":
        print(f"Coordinator of {coordinator['project']} on {coordinator['machine']}")
    elif command == "board":
        show_board(board, coordinator)
    elif command == "add":
        add_task(board, coordinator, args)
    elif command == "start":
        start_tasks(board, coordinator, args)
    elif command == "tell":
        tell(board, coordinator, args)
    elif command in ("ask", "note") and not text:
        board.fail(f'usage: hb {command} "<text>"')
    elif command == "ask":
        ask(board, terminal, text)
    elif command == "note":
        note(board, coordinator, text)
    elif command == "done":
        board.fail("a coordinator doesn't finish; hb note what you did and wait for the next message")
    else:
        board.fail(f"unknown command {command}; hb --help lists them")
