// Task dependencies: "waits on" edges between tasks, kept acyclic.
import { setShared } from "herdr";
import { data, write } from "./store.js";

export const dependenciesOf = (taskId) => (data().deps ?? []).filter((d) => d.task_id === taskId).map((d) => d.depends_on);
export const dependentsOf = (taskId) => (data().deps ?? []).filter((d) => d.depends_on === taskId).map((d) => d.task_id);

// The unfinished tasks `taskId` still waits on.
export function waitingOn(taskId) {
  const byId = new Map(data().tasks.map((t) => [t.id, t]));
  return dependenciesOf(taskId).filter((id) => byId.get(id) && byId.get(id).status !== "done");
}

// True when `from` already reaches `to` through "waits on" edges.
function reaches(from, to, seen = new Set()) {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return dependenciesOf(from).some((next) => reaches(next, to, seen));
}

export const wouldCycle = (taskId, dependsOn) => reaches(dependsOn, taskId);

function setDeps(deps) {
  setShared("projects.db", { ...data(), deps });
}

export async function addDependency(taskId, dependsOn) {
  if (taskId === dependsOn || wouldCycle(taskId, dependsOn)) return false;
  if (dependenciesOf(taskId).includes(dependsOn)) return true;
  setDeps([...(data().deps ?? []), { task_id: taskId, depends_on: dependsOn }]);
  await write("save the dependency", [["insert into task_deps (task_id, depends_on) values ($1, $2) on conflict do nothing", [taskId, dependsOn]]]);
  return true;
}

export async function removeDependency(taskId, dependsOn) {
  setDeps((data().deps ?? []).filter((d) => !(d.task_id === taskId && d.depends_on === dependsOn)));
  await write("remove the dependency", [["delete from task_deps where task_id = $1 and depends_on = $2", [taskId, dependsOn]]]);
}
