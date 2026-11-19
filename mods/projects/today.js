// What the Today view lists across projects. Tasks and sessions come from the last pull; when
// each project was last touched, the changes since the person left and the Pi's last digest
// are read when the view opens and again after each pull while it shows.
import { transaction } from "./db.js";
import { data, syncState, IMPORTANCE } from "./store.js";
import { leftAt } from "./away.js";

const EVENT_LIMIT = 300;
export const UNTOUCHED_DAYS = [3, 7, 14];
const DAY_MS = 86400000;

const EVENT_COLUMNS = "id, task_id, project_id, title, kind, actor, machine, before, after, extract(epoch from at) * 1000 as at";

async function load(since) {
  const [touched, events, digests] = await transaction([
    ["select p.id, extract(epoch from greatest((select max(updated_at) from tasks t where t.project_id = p.id), (select max(at) from task_events e where e.project_id = p.id))) * 1000 as at from projects p where not p.archived"],
    [`select ${EVENT_COLUMNS} from task_events where at > to_timestamp($1 / 1000.0) order by at desc, id desc limit ${EVENT_LIMIT}`, [since]],
    ["select day::text as day, body, extract(epoch from created_at) * 1000 as at from digests order by day desc limit 1"],
  ]);
  return {
    touched: new Map(touched.map((row) => [row.id, row.at == null ? null : Number(row.at)])),
    events: events.map((row) => ({ ...row, id: Number(row.id), at: Number(row.at) })),
    digest: digests[0] ? { ...digests[0], at: Number(digests[0].at) } : null,
    since,
    at: Date.now(),
  };
}

export function needsReload(view) {
  const state = view.today;
  if (state?.loading) return false;
  return !state?.at || state.at < syncState().at || state.since !== leftAt();
}

export function reloadToday(view, cx) {
  view.today = { ...(view.today ?? {}), loading: true };
  const since = leftAt();
  cx.spawn(async (cx) => {
    try {
      view.today = { ...(await load(since)), loading: false, error: null };
    } catch (error) {
      view.today = { ...view.today, loading: false, at: Date.now(), since, error: `Couldn't load Today: ${error.message ?? error}` };
    }
    cx.notify();
  });
}

const importanceRank = (task) => IMPORTANCE.indexOf(task.importance ?? "normal");

export const reviewTasks = () => data().tasks.filter((t) => t.status === "review").sort((a, b) => (a.reported_at ?? a.updated) - (b.reported_at ?? b.updated));

export const importantTasks = () => data().tasks
  .filter((t) => t.status !== "done" && t.status !== "review" && (t.importance === "urgent" || t.importance === "high"))
  .sort((a, b) => importanceRank(a) - importanceRank(b) || a.position - b.position);

// Open tasks to pick from: the important ones first, then what agents are on, then the rest.
export function pickCandidates() {
  const statusRank = { doing: 0, review: 1, todo: 2 };
  return data().tasks.filter((t) => t.status !== "done")
    .sort((a, b) => importanceRank(a) - importanceRank(b) || statusRank[a.status] - statusRank[b.status] || a.position - b.position);
}

// A project with a working session counts as touched now.
export function untouchedProjects(groups, touched, days, now = Date.now()) {
  if (!touched) return [];
  const limit = days * DAY_MS;
  return groups
    .filter((g) => !g.sessions.some((s) => s.status === "working"))
    .map((g) => ({ group: g, at: touched.get(g.project.id) ?? null }))
    .filter((row) => row.at == null || now - row.at >= limit)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

// The changes since the person left, one entry per task, newest first.
export function changesByTask(events) {
  const tasks = new Map();
  for (const event of events ?? []) {
    if (!tasks.has(event.task_id)) tasks.set(event.task_id, { taskId: event.task_id, projectId: event.project_id, title: event.title, latest: event, count: 0 });
    tasks.get(event.task_id).count += 1;
  }
  return [...tasks.values()];
}

export function untouchedDays() {
  const saved = Number(localStorage.getItem("untouchedDays"));
  return UNTOUCHED_DAYS.includes(saved) ? saved : 7;
}

export function cycleUntouchedDays() {
  const next = UNTOUCHED_DAYS[(UNTOUCHED_DAYS.indexOf(untouchedDays()) + 1) % UNTOUCHED_DAYS.length];
  localStorage.setItem("untouchedDays", String(next));
}
