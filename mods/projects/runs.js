// Runs: what was started by clicking Run, which tasks belong to each, and how far it got.
// Only tasks in an active run ever start on their own.
import { data } from "./store.js";
import { dependentsOf } from "./deps.js";

export const activeRuns = () => (data().runs ?? []).filter((r) => r.status === "active");

export const runsOfProject = (projectId) => activeRuns().filter((r) => r.project_id === projectId);

// A task in two runs follows the one started first.
export const runOf = (taskId) => activeRuns().find((r) => (r.task_ids ?? []).includes(taskId)) ?? null;

export function runTasks(run) {
  const byId = new Map(data().tasks.map((t) => [t.id, t]));
  return (run.task_ids ?? []).map((id) => byId.get(id)).filter(Boolean);
}

export function runProgress(run) {
  const tasks = runTasks(run);
  return { done: tasks.filter((t) => t.status === "done").length, total: tasks.length };
}

export const isFinished = (run) => runTasks(run).every((t) => t.status === "done");

// The task and every open task downstream of it, nearest first.
export function chainFrom(taskId) {
  const byId = new Map(data().tasks.map((t) => [t.id, t]));
  const seen = new Set();
  const queue = [taskId];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    queue.push(...dependentsOf(id));
  }
  return [...seen].map((id) => byId.get(id)).filter((t) => t.status !== "done");
}

// Whether this machine still has run tasks to start or watch; its window keeps pulling
// until they are in Review or Done.
export const hasRunWorkOn = (machine) => activeRuns().some((run) => run.machine === machine
  && runTasks(run).some((t) => t.status === "todo" || t.status === "doing"));
