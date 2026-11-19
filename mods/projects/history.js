// Task history from task_events (schema/0001_board.sql): who moved, started, reported on or edited a
// task and when, and putting a change back. A change can be undone while the task still
// holds what it set; a deleted task comes back with its dependencies.
import { sql } from "./db.js";
import { data, update, setLocal, write, STATUS_LABEL } from "./store.js";
import { waiverFields } from "./review.js";
import { machineLabel } from "./machines.js";
import { duration } from "./model.js";

const COLUMNS = "id, task_id, project_id, title, kind, actor, machine, before, after, extract(epoch from at) * 1000 as at";

const normalize = (row) => ({ ...row, id: Number(row.id), at: Number(row.at) });

export async function taskHistory(taskId, limit = 50) {
  const rows = await sql(`select ${COLUMNS} from task_events where task_id = $1 order by at desc, id desc limit $2`, [taskId, limit]);
  return rows.map(normalize);
}

export async function projectHistory(projectId, limit = 100) {
  const rows = await sql(`select ${COLUMNS} from task_events where project_id = $1 order by at desc, id desc limit $2`, [projectId, limit]);
  return rows.map(normalize);
}

// Everything since a moment, oldest first, across projects unless one is named.
export async function eventsSince(since, projectId = null) {
  const rows = await sql(`select ${COLUMNS} from task_events where at > to_timestamp($1 / 1000.0) and ($2::text is null or project_id = $2) order by at, id`, [since, projectId]);
  return rows.map(normalize);
}

const ACTOR_LABEL = { person: "You", agent: "Agent", run: "Run", review: "Code review", herdr: "Herdr", schedule: "Schedule", coordinator: "Coordinator" };
const FIELD_LABEL = { title: "title", notes: "notes", importance: "importance", subproject_id: "repo", needs_review: "review", code_review: "code review", base: "start branch" };
const REPORT_LABEL = { done: "Reported done", ask: "Asked", note: "Note" };

export function who(event) {
  const actor = ACTOR_LABEL[event.actor] ?? "Someone";
  return event.machine ? `${actor} on ${machineLabel(event.machine)}` : actor;
}

export function when(event, now = Date.now()) {
  const ago = duration(now - event.at);
  return ago === "now" ? "just now" : `${ago} ago`;
}

const joinWords = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

export function describe(event) {
  const { before, after } = event;
  if (event.kind === "created") return `Created in ${STATUS_LABEL[after?.status] ?? "To do"}`;
  if (event.kind === "restored") return "Restored";
  if (event.kind === "moved") return `Moved from ${STATUS_LABEL[before.status]} to ${STATUS_LABEL[after.status]}`;
  if (event.kind === "started") return `Agent started on ${machineLabel(after.machine)}`;
  if (event.kind === "report") return REPORT_LABEL[after.kind] ?? "Note";
  if (event.kind === "edited") return `Changed ${joinWords(Object.keys(after).map((key) => FIELD_LABEL[key] ?? key))}`;
  if (event.kind === "deleted") return "Deleted";
  return event.kind;
}

// The report's text, or what a title change replaced.
export function detail(event) {
  if (event.kind === "report") return event.after.text;
  if (event.kind === "edited" && "title" in event.before) return `Was “${event.before.title}”`;
  return null;
}

const taskOf = (event) => data().tasks.find((t) => t.id === event.task_id) ?? null;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function canUndo(event) {
  const task = taskOf(event);
  if (event.kind === "deleted") return !task;
  if (!task) return false;
  if (event.kind === "moved") return task.status === event.after.status;
  if (event.kind === "edited") return Object.keys(event.after).every((key) => same(task[key], event.after[key]));
  return false;
}

export const undoLabel = (event) => (event.kind === "deleted" ? "Restore" : "Undo");

export async function undo(event) {
  if (!canUndo(event)) return;
  if (event.kind === "deleted") return restore(event);
  if (event.kind === "moved") return update("tasks", event.task_id, { status: event.before.status, position: event.before.position });
  const task = taskOf(event);
  const patch = { ...event.before };
  if ("title" in patch || "notes" in patch) Object.assign(patch, waiverFields(patch.title ?? task.title, patch.notes ?? task.notes, task.issue_url));
  return update("tasks", event.task_id, patch);
}

const timestamp = (value) => (value ? Date.parse(value) : null);

// The stored row in the shape a pull gives, so the board shows it before the queued write runs.
function restoredTask(row) {
  const tabTaken = data().tasks.some((t) => t.tab && t.tab === row.tab);
  return { ...row, tab: tabTaken ? null : row.tab, position: Number(row.position), updated: Date.now(), done_at: timestamp(row.done_at), reported_at: timestamp(row.reported_at), code_review_at: timestamp(row.code_review_at), issue_commented: Boolean(row.issue_commented_at) };
}

// The old session link stays only when no other task took that tab since.
function restore(event) {
  const { row, waits_on: waitsOn = [], blocks = [] } = event.before;
  setLocal("tasks", [...data().tasks, restoredTask(row)]);
  return write("restore the task", [
    ["select set_config('herdr.restoring', $1, true)", [row.id]],
    ["insert into tasks select * from jsonb_populate_record(null::tasks, $1::jsonb) on conflict (id) do nothing", [row]],
    ["update tasks set tab = null where id = $1 and exists (select 1 from tasks o where o.tab = tasks.tab and o.id <> tasks.id)", [row.id]],
    ["insert into task_deps (task_id, depends_on) select $1, d from jsonb_array_elements_text($2::jsonb) d where exists (select 1 from tasks where id = d) on conflict do nothing", [row.id, waitsOn]],
    ["insert into task_deps (task_id, depends_on) select b, $1 from jsonb_array_elements_text($2::jsonb) b where exists (select 1 from tasks where id = b) on conflict do nothing", [row.id, blocks]],
  ]);
}
