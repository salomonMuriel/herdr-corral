// A task's other repos (task_repos): one row per repo beside the task's own, with the session,
// machine and branch an agent took there. Each part reads like a task, so worktree, merge and
// cleanup helpers work on either.
import { data, setLocal, write } from "./store.js";

const KEY = "taskRepos";

export const otherRepos = (taskId) => (data().taskRepos ?? []).filter((r) => r.task_id === taskId);

export const repoIdsOf = (task) => [task.subproject_id, ...otherRepos(task.id).map((r) => r.subproject_id)].filter(Boolean);

// The task's first repo no agent was started in: its own, then the others in order.
export function unstartedRepo(task) {
  if (!task.tab) return task.subproject_id ?? null;
  return otherRepos(task.id).find((r) => !r.tab)?.subproject_id ?? null;
}

export const canStartMore = (task) => !task.tab || otherRepos(task.id).some((r) => !r.tab);

// The task as seen from one of its other repos: its title, status and review, that repo's place.
export function asPart(task, row) {
  return { ...task, subproject_id: row.subproject_id, tab: row.tab, machine: row.machine, branch: row.branch,
    cleanup: row.cleanup, cleanup_kind: row.cleanup_kind, partOf: task.id, partKey: `${task.id}:${row.subproject_id}` };
}

// The lead part first, then one per other repo.
export function partsOf(task) {
  return [task, ...otherRepos(task.id).map((row) => asPart(task, row))];
}

export const partKey = (part) => part.partKey ?? part.id;

function patchLocal(taskId, subprojectId, patch) {
  const rows = data().taskRepos ?? [];
  const at = rows.findIndex((r) => r.task_id === taskId && r.subproject_id === subprojectId);
  if (at < 0) return setLocal(KEY, [...rows, { task_id: taskId, subproject_id: subprojectId, tab: null, machine: null, branch: null, cleanup: null, cleanup_kind: null, position: otherRepos(taskId).length, ...patch }]);
  setLocal(KEY, rows.map((r, i) => (i === at ? { ...r, ...patch } : r)));
}

const COLUMNS = ["tab", "machine", "branch", "cleanup", "cleanup_kind"];

// Adds the repo to the task when it isn't there, then writes the patch.
export function saveOtherRepo(taskId, subprojectId, patch = {}, actor = "person") {
  const keys = Object.keys(patch).filter((key) => COLUMNS.includes(key));
  const position = otherRepos(taskId).length;
  patchLocal(taskId, subprojectId, Object.fromEntries(keys.map((key) => [key, patch[key]])));
  const cleanupAt = keys.includes("cleanup") ? ", cleanup_at = now()" : "";
  const sets = keys.map((key, i) => `${key} = $${i + 4}`);
  const query = `insert into task_repos (task_id, subproject_id, position${keys.map((key) => `, ${key}`).join("")})`
    + ` values ($1, $2, $3${keys.map((_key, i) => `, $${i + 4}`).join("")})`
    + ` on conflict (task_id, subproject_id) do update set ${[...sets, `updated_at = now()${cleanupAt}`].join(", ")}`;
  return write("save the task's repo", [[query, [taskId, subprojectId, position, ...keys.map((key) => patch[key])]]], actor);
}

function removeOtherRepo(taskId, subprojectId) {
  setLocal(KEY, (data().taskRepos ?? []).filter((r) => !(r.task_id === taskId && r.subproject_id === subprojectId)));
  return write("remove the task's repo", [["delete from task_repos where task_id = $1 and subproject_id = $2", [taskId, subprojectId]]]);
}

// Makes the task's other repos the given ones. A repo with a session stays: its agent is tied to it.
export function setOtherRepos(taskId, leadId, subprojectIds) {
  const wanted = new Set(subprojectIds.filter((id) => id && id !== leadId));
  for (const row of otherRepos(taskId)) {
    const keep = wanted.has(row.subproject_id) || (row.tab && row.subproject_id !== leadId);
    if (!keep) removeOtherRepo(taskId, row.subproject_id);
    wanted.delete(row.subproject_id);
  }
  for (const id of wanted) saveOtherRepo(taskId, id);
}

// A task's own repo takes its first session. Another repo becomes one of the task's other
// repos once the task has a session or spans several; a single-repo task with no session moves.
export function joinsAsOtherRepo(task, subprojectId) {
  if (!task?.subproject_id || !subprojectId || task.subproject_id === subprojectId) return false;
  return Boolean(task.tab) || otherRepos(task.id).length > 0;
}

// A session belongs to one task: tying it to one drops it from any other repo row.
export function releaseTab(tab, exceptTaskId = null) {
  for (const row of (data().taskRepos ?? []).filter((r) => r.tab === tab && r.task_id !== exceptTaskId)) {
    saveOtherRepo(row.task_id, row.subproject_id, { tab: null });
  }
}

// Where a task's other repo is cleaned or kept, written to its own row.
export const recordPartCleanup = (part, cleanup, cleanup_kind) => saveOtherRepo(part.partOf, part.subproject_id, { cleanup, cleanup_kind }, "herdr");

const repoName = (id) => data().subprojects.find((s) => s.id === id)?.name ?? "another repo";

// Tells each agent of a task that spans repos which part is its own and who moves the card.
export function reposNote(task, subprojectId) {
  const others = repoIdsOf(task).filter((id) => id !== subprojectId);
  if (!others.length) return "";
  const here = repoName(subprojectId);
  const elsewhere = others.map(repoName).join(", ");
  if (subprojectId === task.subproject_id) {
    return `This task also spans ${elsewhere}; agents there work on those parts in their own sessions. You work on the ${here} part, and your hb done finishes the task.`;
  }
  const lead = repoName(task.subproject_id);
  return `This task spans several repos. You work on the ${here} part; ${elsewhere} have their own sessions. Your hb done saves your summary on the card, and the card moves when the ${lead} agent finishes (or with yours when no agent works in ${lead}).`;
}
