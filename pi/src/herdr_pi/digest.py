"""The end-of-day digest, built from the board's rows. The Today view draws `body`; `text` goes to the phone."""

from typing import Any, Literal

from pydantic import BaseModel

STATUS_LABEL = {"todo": "To do", "doing": "In progress", "review": "Review", "done": "Done"}
MAX_RECAPS = 20
REPORTS_PER_RECAP = 5
REPORT_CHARS = 400
TEXT_ITEMS = 4


class TaskRow(BaseModel):
    id: str
    project_id: str
    project: str
    repo: str | None = None
    title: str
    status: str
    machine: str | None = None
    report: str | None = None
    report_kind: str | None = None


class EventRow(BaseModel):
    task_id: str
    project_id: str
    title: str
    kind: str
    actor: str
    after: dict[str, Any] | None = None
    at: float


class Item(BaseModel):
    task_id: str
    project_id: str
    title: str
    detail: str | None = None


class Section(BaseModel):
    key: Literal["picks", "done", "review", "asks", "doing"]
    title: str
    items: list[Item]


class Report(BaseModel):
    kind: str
    text: str
    at: float


class Recap(BaseModel):
    task_id: str
    project_id: str
    title: str
    agent: str | None
    reports: list[Report]


class Digest(BaseModel):
    day: str
    headline: str
    active: bool
    sections: list[Section]
    recaps: list[Recap] | None = None


def first_line(text: str | None) -> str | None:
    line = (text or "").strip().split("\n")[0].strip()
    return line or None


def clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def item(task: TaskRow, detail: str | None) -> Item:
    return Item(task_id=task.id, project_id=task.project_id, title=task.title, detail=detail)


def where(task: TaskRow) -> str:
    return " · ".join(part for part in (task.project, task.repo) if part)


def done_today(tasks: dict[str, TaskRow], events: list[EventRow]) -> list[TaskRow]:
    finished = [e.task_id for e in events if e.kind == "moved" and (e.after or {}).get("status") == "done"]
    seen = dict.fromkeys(finished)
    return [tasks[task_id] for task_id in seen if task_id in tasks and tasks[task_id].status == "done"]


def sections(tasks: dict[str, TaskRow], events: list[EventRow], picks: list[str]) -> list[Section]:
    open_tasks = [t for t in tasks.values() if t.status != "done"]
    picked = [tasks[task_id] for task_id in picks if task_id in tasks]
    return [
        Section(key="picks", title="Today's 3", items=[item(t, STATUS_LABEL.get(t.status, t.status)) for t in picked]),
        Section(key="done", title="Done", items=[item(t, first_line(t.report) or where(t)) for t in done_today(tasks, events)]),
        Section(key="review", title="Waiting for your review", items=[item(t, first_line(t.report) or where(t)) for t in open_tasks if t.status == "review"]),
        Section(key="asks", title="Agents asking", items=[item(t, first_line(t.report)) for t in open_tasks if t.report_kind == "ask"]),
        Section(key="doing", title="Still in progress", items=[item(t, first_line(t.report) or where(t)) for t in open_tasks if t.status == "doing"]),
    ]


def recaps(tasks: dict[str, TaskRow], events: list[EventRow]) -> list[Recap]:
    """Each agent's own reports of the day, the busiest task last reported first."""
    by_task: dict[str, list[EventRow]] = {}
    for event in events:
        if event.kind == "report" and event.task_id in tasks:
            by_task.setdefault(event.task_id, []).append(event)
    ordered = sorted(by_task.items(), key=lambda pair: pair[1][-1].at, reverse=True)[:MAX_RECAPS]
    return [
        Recap(
            task_id=task_id,
            project_id=tasks[task_id].project_id,
            title=tasks[task_id].title,
            agent=tasks[task_id].machine,
            reports=[
                Report(kind=str((e.after or {}).get("kind") or "note"), text=clip(str((e.after or {}).get("text") or ""), REPORT_CHARS), at=e.at)
                for e in reports[-REPORTS_PER_RECAP:]
            ],
        )
        for task_id, reports in ordered
    ]


def headline(parts: list[Section], picks: list[str], tasks: dict[str, TaskRow]) -> str:
    count = {part.key: len(part.items) for part in parts}
    words = [f"{count['done']} done", f"{count['review']} to review"]
    if count["asks"]:
        words.append(f"{count['asks']} asking")
    words.append(f"{count['doing']} in progress")
    picked = [tasks[task_id] for task_id in picks if task_id in tasks]
    if picked:
        words.append(f"{sum(t.status == 'done' for t in picked)} of {len(picked)} picks done")
    return " · ".join(words)


def build_digest(day: str, task_rows: list[dict[str, Any]], event_rows: list[dict[str, Any]], picks: list[str], with_recaps: bool) -> Digest:
    tasks = {row["id"]: TaskRow.model_validate(row) for row in task_rows}
    events = sorted((EventRow.model_validate(row) for row in event_rows), key=lambda e: e.at)
    parts = sections(tasks, events, picks)
    return Digest(
        day=day,
        headline=headline(parts, picks, tasks),
        active=bool(events),
        sections=parts,
        recaps=recaps(tasks, events) if with_recaps else None,
    )


def digest_text(digest: Digest) -> str:
    lines = [digest.headline]
    for part in digest.sections:
        if part.key == "doing" or not part.items:
            continue
        names = ", ".join(i.title for i in part.items[:TEXT_ITEMS])
        more = f" and {len(part.items) - TEXT_ITEMS} more" if len(part.items) > TEXT_ITEMS else ""
        lines.append(f"{part.title}: {names}{more}")
    return "\n".join(lines)
