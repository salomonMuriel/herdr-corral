import json
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any, Protocol

from herdr_pi.config import DigestConfig
from herdr_pi.digest import Digest, build_digest, digest_text
from herdr_pi.jobs import Job
from herdr_pi.ntfy import Push

log = logging.getLogger(__name__)

TASKS_QUERY = (
    "select t.id, t.project_id, p.name as project, s.name as repo, t.title, t.status, t.machine, t.report, t.report_kind"
    " from tasks t join projects p on p.id = t.project_id left join subprojects s on s.id = t.subproject_id"
    " where not p.archived and (t.status <> 'done' or t.done_at >= to_timestamp($1))"
    " order by p.position, t.position"
)
EVENTS_QUERY = (
    "select task_id, project_id, title, kind, actor, after, extract(epoch from at) * 1000 as at"
    " from task_events where at >= to_timestamp($1) order by at, id"
)
PICKS_QUERY = "select task_id from today_picks where day = $1::date order by position"
SAVE_QUERY = (
    "insert into digests (day, body, text) values ($1::date, $2::jsonb, $3)"
    " on conflict (day) do update set body = excluded.body, text = excluded.text, created_at = now()"
)


class BoardQuery(Protocol):
    async def query(self, query: str, params: list[Any], actor: tuple[str, str] | None = None) -> list[dict[str, Any]]: ...


def start_of_day(moment: datetime) -> datetime:
    return moment.replace(hour=0, minute=0, second=0, microsecond=0)


async def write_digest(board: BoardQuery, settings: DigestConfig, moment: datetime) -> Digest:
    day = moment.date().isoformat()
    since = start_of_day(moment).timestamp()
    tasks = await board.query(TASKS_QUERY, [since])
    events = await board.query(EVENTS_QUERY, [since])
    picks = [row["task_id"] for row in await board.query(PICKS_QUERY, [day])]
    digest = build_digest(day, tasks, events, picks, settings.recaps)
    await board.query(SAVE_QUERY, [day, json.dumps(digest.model_dump(exclude_none=True)), digest_text(digest)])
    return digest


def digest_job(board: BoardQuery, settings: DigestConfig, send: Callable[[Push], Awaitable[None]]) -> Job:
    """Writes the day's digest for the Today view and pushes it, unless nothing moved all day."""

    async def digest() -> str:
        result = await write_digest(board, settings, datetime.now().astimezone())
        if not result.active:
            return f"{result.day}: quiet day, no push"
        await send(Push(f"Today: {result.headline}", digest_text(result), settings.url, ["memo"]))
        return f"{result.day}: {result.headline}"

    return Job("digest", digest, daily_at=settings.at)
