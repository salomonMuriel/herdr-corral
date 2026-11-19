import asyncio
import json
import random
import string
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

Row = dict[str, Any]

# Tells task_events (schema/0013) who wrote it and from where.
ACTOR_QUERY = "select set_config('herdr.actor', $1, true), set_config('herdr.machine', $2, true)"
WEB_ACTOR = ("person", "web")
Actor = tuple[str, str]


class BoardError(Exception):
    pass


def new_task_id() -> str:
    """Same shape as bin/hb and the mod: base-36 milliseconds, then six random characters."""
    digits = string.digits + string.ascii_lowercase
    millis = int(time.time() * 1000)
    stamp = ""
    while millis:
        millis, rest = divmod(millis, 36)
        stamp = digits[rest] + stamp
    return stamp + "".join(random.choice(digits) for _ in range(6))


class Board:
    """The Herdr board over its HTTP SQL endpoint (herdr-sql), with ~/.config/herdr-board/config.json's credentials."""

    def __init__(self, config_path: Path):
        self.config_path = config_path

    def credentials(self) -> tuple[str, str]:
        try:
            config = json.loads(self.config_path.read_text())
            board = config["board"]
            return board["host"], board["url"]
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise BoardError(f"no board config at {self.config_path}: {error}") from error

    def query_now(self, query: str, params: list[Any], actor: Actor | None = None) -> list[Row]:
        if actor is None:
            return self.post({"query": query, "params": params})["rows"]
        return self.transaction_now([(query, params)], actor)[-1]

    def transaction_now(self, statements: list[tuple[str, list[Any]]], actor: Actor) -> list[list[Row]]:
        """Runs the statements in one transaction, tagged for task_events; returns each one's rows."""
        queries = [{"query": ACTOR_QUERY, "params": list(actor)}]
        queries += [{"query": query, "params": params} for query, params in statements]
        results = self.post({"queries": queries})["results"]
        return [result["rows"] for result in results[1:]]

    def post(self, body: dict[str, Any]) -> Any:
        host, url = self.credentials()
        request = urllib.request.Request(
            f"https://{host}/sql",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "Neon-Connection-String": url},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            try:
                detail = json.loads(detail).get("message", detail)
            except ValueError:
                pass
            raise BoardError(f"the board refused: {detail}") from error
        except urllib.error.URLError as error:
            raise BoardError(f"can't reach the board: {error.reason}") from error

    async def query(self, query: str, params: list[Any], actor: Actor | None = None) -> list[Row]:
        return await asyncio.to_thread(self.query_now, query, params, actor)

    async def transaction(self, statements: list[tuple[str, list[Any]]], actor: Actor) -> list[list[Row]]:
        return await asyncio.to_thread(self.transaction_now, statements, actor)

    async def projects(self) -> list[Row]:
        projects = await self.query(
            "select id, name from projects where not archived order by position, name", []
        )
        subprojects = await self.query(
            "select s.id, s.project_id, s.name from subprojects s join projects p on p.id = s.project_id"
            " where not p.archived order by s.position, s.name",
            [],
        )
        for project in projects:
            project["subprojects"] = [
                {"id": sub["id"], "name": sub["name"]} for sub in subprojects if sub["project_id"] == project["id"]
            ]
        return projects

    async def add_task(self, project_id: str, subproject_id: str | None, title: str, notes: str) -> Row:
        task_id = new_task_id()
        rows = await self.query(
            "insert into tasks (id, project_id, subproject_id, title, notes, status, position)"
            " values ($1, $2, $3, $4, $5, 'todo',"
            "   (select coalesce(min(position), 1) - 1 from tasks where project_id = $2 and status = 'todo'))"
            " returning id, title",
            [task_id, project_id, subproject_id, title, notes],
            actor=WEB_ACTOR,
        )
        return rows[0]
