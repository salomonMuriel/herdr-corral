// The board's data lives in Postgres on the Pi; every mod copy reads the last pull from shared state,
// which also persists it, so the window starts with what it knew before.
import { shared, setShared, notify, props } from "herdr";
import { transaction, loadConfig } from "./db.js";

const DATA_KEY = "projects.db";
const SYNC_KEY = "projects.sync";
const PULL_REQUEST_KEY = "projects.pull";
const WRITE_QUEUE = "projects.writeQueue";

export const STATUSES = ["todo", "doing", "review", "done"];
export const STATUS_LABEL = { todo: "To do", doing: "In progress", review: "Review", done: "Done" };
export const IMPORTANCE = ["urgent", "high", "normal", "low"];
export const IMPORTANCE_LABEL = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
export const KINDS = ["company", "client", "side"];
export const KIND_LABEL = { company: "Companies", client: "Clients", side: "Side projects" };

// An archived project's repos, tasks and runs stay out, so its sessions read as unsorted.
const LIVE_PROJECT = "project_id in (select id from projects where not archived)";

const EMPTY = { projects: [], subprojects: [], tasks: [], deps: [], runs: [], taskRepos: [], picks: [], coordinators: [] };

export function data() {
  return shared(DATA_KEY) ?? EMPTY;
}

export function syncState() {
  return shared(SYNC_KEY) ?? { at: 0, error: null, busy: false };
}

export function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function requestPull() {
  setShared(PULL_REQUEST_KEY, Date.now());
}

export function pullRequestedAt() {
  return shared(PULL_REQUEST_KEY) ?? 0;
}

// A write that lands while a pull is under way can be overwritten by its older rows, so a
// pull requested after the fetch began fetches again.
export async function pull() {
  setShared(SYNC_KEY, { ...syncState(), busy: true });
  try {
    let startedAt;
    do {
      startedAt = Date.now();
      setShared(DATA_KEY, await fetchBoard());
    } while (pullRequestedAt() >= startedAt);
    setShared(SYNC_KEY, { at: Date.now(), error: null, busy: false });
  } catch (error) {
    setShared(SYNC_KEY, { ...syncState(), error: String(error.message ?? error), busy: false });
  }
}

async function fetchBoard() {
  const [projects, subprojects, tasks, deps, runs, taskRepos, picks, coordinators] = await transaction([
    ["select id, name, kind, color, icon, position, archived, review_mode, code_review from projects where not archived order by position, name"],
    [`select id, project_id, name, repo, paths, position from subprojects where ${LIVE_PROJECT} order by position, name`],
    [`select id, project_id, subproject_id, title, notes, status, importance, position, tab, machine, report, report_kind, needs_review, review_waived, waiver_quote, base, branch, cleanup, cleanup_kind, code_review, code_review_state, code_review_round, code_review_open, code_review_findings, issue_url, issue_commented_at is not null as issue_commented, extract(epoch from code_review_at) * 1000 as code_review_at, extract(epoch from reported_at) * 1000 as reported_at, extract(epoch from updated_at) * 1000 as updated, extract(epoch from done_at) * 1000 as done_at from tasks where ${LIVE_PROJECT} and (status <> 'done' or done_at > now() - interval '30 days') order by position`],
    ["select task_id, depends_on from task_deps"],
    [`select id, project_id, root_task_id, task_ids, machine, agent, review_mode, permission_mode, status, started_by, extract(epoch from started_at) * 1000 as started_at from runs where status = 'active' and ${LIVE_PROJECT} order by started_at`],
    [`select r.task_id, r.subproject_id, r.tab, r.machine, r.branch, r.cleanup, r.cleanup_kind, r.position from task_repos r join tasks t on t.id = r.task_id where t.${LIVE_PROJECT} and (t.status <> 'done' or t.done_at > now() - interval '30 days') order by r.position`],
    ["select day::text as day, task_id, position from today_picks where day > current_date - 3 order by day, position"],
    [`select project_id, machine, tab, note from coordinators where ${LIVE_PROJECT}`],
  ]);
  return { projects, subprojects, tasks: tasks.map(normalizeTask), deps, runs, taskRepos, picks, coordinators };
}

function normalizeTask(task) {
  return { ...task, updated: Number(task.updated), code_review_at: task.code_review_at ? Number(task.code_review_at) : null, code_review_round: Number(task.code_review_round ?? 0), code_review_open: task.code_review_open == null ? null : Number(task.code_review_open), done_at: task.done_at ? Number(task.done_at) : null, reported_at: task.reported_at ? Number(task.reported_at) : null, position: Number(task.position) };
}

export function patchLocal(table, id, patch) {
  const current = data();
  setShared(DATA_KEY, { ...current, [table]: current[table].map((row) => (row.id === id ? { ...row, ...patch } : row)) });
}

export function setLocal(key, rows) {
  setShared(DATA_KEY, { ...data(), [key]: rows });
}

function insertLocal(table, row) {
  const current = data();
  setShared(DATA_KEY, { ...current, [table]: [...current[table], row] });
}

function removeLocal(table, id) {
  const current = data();
  setShared(DATA_KEY, { ...current, [table]: current[table].filter((row) => row.id !== id) });
}

// A closed dialog or popup has its unfinished requests cancelled after 250 ms, so it hands
// its writes to the sidebar, which is always running.
export async function write(action, queries, actor = "person") {
  if (props()?.overlay) {
    setShared(WRITE_QUEUE, [...(shared(WRITE_QUEUE) ?? []), { action, queries, actor }]);
    return;
  }
  await send(action, queries, actor);
}

async function send(action, queries, actor) {
  try {
    await transaction(queries, actor);
    requestPull();
  } catch (error) {
    notify({ title: `Couldn't ${action}`, body: String(error.message ?? error), level: "error" });
    await pull();
  }
}

export async function runQueuedWrites() {
  const queue = shared(WRITE_QUEUE) ?? [];
  if (!queue.length) return;
  setShared(WRITE_QUEUE, []);
  for (const { action, queries, actor } of queue) await send(action, queries, actor);
}

const COLUMNS = {
  projects: ["name", "kind", "color", "icon", "position", "archived", "review_mode", "code_review"],
  subprojects: ["name", "repo", "paths", "position", "project_id"],
  tasks: ["title", "notes", "status", "importance", "position", "tab", "machine", "subproject_id", "project_id", "needs_review", "review_waived", "waiver_quote", "base", "branch", "cleanup", "cleanup_kind", "code_review", "code_review_state", "code_review_round", "code_review_open", "code_review_findings"],
};

function updateQuery(table, id, patch) {
  const keys = Object.keys(patch).filter((key) => COLUMNS[table].includes(key));
  const sets = keys.map((key, i) => `${key} = $${i + 2}${key === "paths" ? "::jsonb" : ""}`);
  if (table === "tasks" && "status" in patch) {
    const status = `$${keys.indexOf("status") + 2}`;
    sets.push(`done_at = case when ${status} = 'done' then coalesce(done_at, now()) else null end`);
    sets.push(`cleanup = case when ${status} = 'done' then cleanup end`, `cleanup_kind = case when ${status} = 'done' then cleanup_kind end`);
  }
  return [`update ${table} set ${[...sets, "updated_at = now()"].join(", ")} where id = $1`, [id, ...keys.map((key) => patch[key])]];
}

export function update(table, id, patch, actor = "person") {
  const local = { ...patch };
  if (table === "tasks" && patch.status) local.done_at = patch.status === "done" ? Date.now() : null;
  if (table === "tasks" && patch.status && patch.status !== "done") Object.assign(local, { cleanup: null, cleanup_kind: null });
  patchLocal(table, id, local);
  return write("save", [updateQuery(table, id, patch)], actor);
}

// The card's report line, as hb writes it; null clears it.
export function setReport(taskId, report, kind, actor = "person") {
  patchLocal("tasks", taskId, { report, report_kind: kind, reported_at: Date.now() });
  return write("save the card", [["update tasks set report = $2, report_kind = $3, reported_at = now(), updated_at = now() where id = $1", [taskId, report, kind]]], actor);
}

export function createProject({ name, kind = "company", color, icon = null, review_mode = "every", code_review = false }) {
  const row = { id: newId(), name, kind, color, icon, review_mode, code_review, position: data().projects.length, archived: false };
  insertLocal("projects", row);
  write("create the project", [["insert into projects (id, name, kind, color, icon, position, review_mode, code_review) values ($1, $2, $3, $4, $5, $6, $7, $8)", [row.id, name, kind, color, icon, row.position, review_mode, code_review]]]);
  return row;
}

export function createSubproject({ projectId, name, repo, paths = {} }) {
  const siblings = data().subprojects.filter((s) => s.project_id === projectId);
  const row = { id: newId(), project_id: projectId, name, repo, paths, position: siblings.length };
  insertLocal("subprojects", row);
  write("add the repo", [["insert into subprojects (id, project_id, name, repo, paths, position) values ($1, $2, $3, $4, $5::jsonb, $6)", [row.id, projectId, name, repo, paths, row.position]]]);
  return row;
}

export function removeRow(table, id) {
  removeLocal(table, id);
  return write("delete it", [[`delete from ${table} where id = $1`, [id]]]);
}

// An issue already imported into the project leaves the insert a no-op.
export function createTask({ projectId, subprojectId = null, title, notes = "", status = "todo", importance = "normal", tab = null, machine = null, review = {}, base = "main", issueUrl = null }) {
  const column = data().tasks.filter((t) => t.project_id === projectId && t.status === status);
  const position = column.length ? Math.min(...column.map((t) => t.position)) - 1 : 0;
  const { needs_review = null, review_waived = false, waiver_quote = null, code_review = null } = review;
  const row = { id: newId(), project_id: projectId, subproject_id: subprojectId, title, notes, status, importance, position, tab, machine, needs_review, review_waived, waiver_quote, code_review, code_review_state: null, code_review_round: 0, base, branch: null, issue_url: issueUrl, issue_commented: false, updated: Date.now(), done_at: null };
  insertLocal("tasks", row);
  write("create the task", [["insert into tasks (id, project_id, subproject_id, title, notes, status, importance, position, tab, machine, needs_review, review_waived, waiver_quote, base, code_review, issue_url) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) on conflict (project_id, issue_url) where issue_url is not null do nothing", [row.id, projectId, subprojectId, title, notes, status, importance, position, tab, machine, needs_review, review_waived, waiver_quote, base, code_review, issueUrl]]]);
  return row;
}

// Moves a task to a column, before `beforeId` or at its end.
export function moveTask(taskId, status, beforeId = null) {
  const column = data().tasks.filter((t) => t.status === status && t.id !== taskId).sort((a, b) => a.position - b.position);
  const task = data().tasks.find((t) => t.id === taskId);
  if (!task) return;
  const index = beforeId ? column.findIndex((t) => t.id === beforeId) : -1;
  let position;
  if (index === -1) position = column.length ? column.at(-1).position + 1 : 0;
  else if (index === 0) position = column[0].position - 1;
  else position = (column[index - 1].position + column[index].position) / 2;
  return update("tasks", taskId, { status, position });
}

export { loadConfig };
