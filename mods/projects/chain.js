// Which run tasks start next on a machine, and from which branch.
import { data } from "./store.js";
import { waitingOn, dependenciesOf, dependentsOf } from "./deps.js";
import { needsReview, codeReviewOn } from "./review.js";
import { activeRuns, runTasks } from "./runs.js";
import { machineInfo } from "./machines.js";

const DEFAULT_SLOTS = 4;
export const PER_REPO = 3;
export const DEFAULT_AGENT = "claude";
export const BASES = ["main", "stack"];
export const BASE_LABEL = { main: "Main, once merged", stack: "The branch it waits on" };

const RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

// hosts.<machine>.slots in the board config.
export const slots = () => machineInfo().slots ?? {};
export const slotsFor = (machine) => slots()[machine] ?? DEFAULT_SLOTS;

// To do tasks of this machine's runs that wait on nothing open, most important first.
export function readyFor(machine) {
  if (!machine) return [];
  const seen = new Set();
  const ready = [];
  for (const run of activeRuns()) {
    for (const task of runTasks(run)) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      const startable = task.status === "todo" && !task.tab && task.subproject_id && waitingOn(task.id).length === 0;
      if (run.machine === machine && startable) ready.push({ task, run });
    }
  }
  return ready.sort((a, b) => (RANK[a.task.importance] ?? 2) - (RANK[b.task.importance] ?? 2) || a.task.position - b.task.position);
}

// Finished tasks this one waits on whose branch may still need to reach main. A task
// nobody started an agent on has no branch.
export function upstreamBranches(task) {
  const byId = new Map(data().tasks.map((t) => [t.id, t]));
  return dependenciesOf(task.id).map((id) => byId.get(id))
    .filter((dep) => dep && dep.subproject_id && dep.machine && (dep.branch || dep.tab));
}

export const busy = (filter) => data().tasks.filter((t) => t.status === "doing" && filter(t)).length;

function dependents(task) {
  const byId = new Map(data().tasks.map((t) => [t.id, t]));
  return dependentsOf(task.id).map((id) => byId.get(id)).filter(Boolean);
}

// The first message's chain lines: the branch it stacks on, and when nobody reviews it,
// that the tasks after it start from main. With a code review, the review note says when to merge.
export function chainNote(task, stackedOn = null) {
  const lines = [];
  if (stackedOn) lines.push(`This branch starts from ${stackedOn.branch} (${stackedOn.title}), which isn't merged into main yet.`);
  const fromMain = dependents(task).some((t) => t.status === "todo" && (t.base ?? "main") === "main");
  if (fromMain && !needsReview(task) && !codeReviewOn(task)) lines.push("Tasks that wait on this one start from main, so merge your branch into main (and push main when the repo has a remote) before hb done.");
  return lines.join(" ");
}
