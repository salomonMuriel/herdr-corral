import json
from datetime import datetime, time
from typing import Any

from herdr_pi.config import DigestConfig
from herdr_pi.digest import build_digest, digest_text
from herdr_pi.digest_job import digest_job
from herdr_pi.ntfy import Push


def task(task_id: str, status: str, **extra: Any) -> dict[str, Any]:
    return {"id": task_id, "project_id": "p1", "project": "Acme", "repo": "web", "title": f"Task {task_id}", "status": status, "machine": "laptop", **extra}


def event(task_id: str, kind: str, after: dict[str, Any], at: float) -> dict[str, Any]:
    return {"task_id": task_id, "project_id": "p1", "title": f"Task {task_id}", "kind": kind, "actor": "agent", "after": after, "at": str(at)}


TASKS = [
    task("a", "done", report="Merged and pushed"),
    task("b", "review", report="Ready for you"),
    task("c", "doing", report="Which provider?", report_kind="ask"),
    task("d", "done"),
]
EVENTS = [
    event("c", "report", {"kind": "note", "text": "Started on the schema"}, 1000),
    event("a", "moved", {"status": "done", "position": 0}, 2000),
    event("c", "report", {"kind": "ask", "text": "Which provider?"}, 3000),
]


def sections_of(digest: Any) -> dict[str, list[str]]:
    return {part.key: [item.task_id for item in part.items] for part in digest.sections}


def test_digest_lists_what_finished_and_what_waits() -> None:
    digest = build_digest("2026-11-05", TASKS, EVENTS, ["a", "c"], with_recaps=False)
    assert sections_of(digest) == {"picks": ["a", "c"], "done": ["a"], "review": ["b"], "asks": ["c"], "doing": ["c"]}
    assert digest.headline == "1 done · 1 to review · 1 asking · 1 in progress · 1 of 2 picks done"
    assert digest.recaps is None
    assert digest.active


def test_a_task_done_before_today_is_not_done_today() -> None:
    digest = build_digest("2026-11-05", TASKS, [], [], with_recaps=False)
    assert sections_of(digest)["done"] == []
    assert not digest.active


def test_recaps_keep_each_agents_reports_in_order() -> None:
    digest = build_digest("2026-11-05", TASKS, EVENTS, [], with_recaps=True)
    assert digest.recaps is not None
    [recap] = digest.recaps
    assert recap.task_id == "c" and recap.agent == "laptop"
    assert [(r.kind, r.text) for r in recap.reports] == [("note", "Started on the schema"), ("ask", "Which provider?")]


def test_text_names_tasks_and_skips_empty_sections() -> None:
    digest = build_digest("2026-11-05", TASKS, EVENTS, [], with_recaps=False)
    assert digest_text(digest).split("\n") == [
        "1 done · 1 to review · 1 asking · 1 in progress",
        "Done: Task a",
        "Waiting for your review: Task b",
        "Agents asking: Task c",
    ]


class FakeBoard:
    def __init__(self, events: list[dict[str, Any]]) -> None:
        self.events = events
        self.saved: list[list[Any]] = []

    async def query(self, query: str, params: list[Any], actor: tuple[str, str] | None = None) -> list[dict[str, Any]]:
        if query.startswith("insert into digests"):
            self.saved.append(params)
            return []
        if "from task_events" in query:
            return self.events
        if "from today_picks" in query:
            return [{"task_id": "a"}]
        return TASKS


async def test_job_saves_the_digest_and_pushes_it() -> None:
    board = FakeBoard(EVENTS)
    pushes: list[Push] = []

    async def send(push: Push) -> None:
        pushes.append(push)

    job = digest_job(board, DigestConfig(at=time(19, 0)), send)
    result = await job.run()
    assert result is not None and "1 done" in result
    [[day, body, text]] = board.saved
    assert day == datetime.now().date().isoformat()
    assert json.loads(body)["recaps"][0]["task_id"] == "c"
    assert pushes[0].title.startswith("Today: 1 done") and pushes[0].message == text


async def test_quiet_day_saves_without_a_push() -> None:
    board = FakeBoard([])
    pushes: list[Push] = []

    async def send(push: Push) -> None:
        pushes.append(push)

    result = await digest_job(board, DigestConfig(), send).run()
    assert result is not None and "quiet day" in result
    assert len(board.saved) == 1 and pushes == []
