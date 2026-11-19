// Starting, stopping and ending runs. The Run popup queues its run here and the sidebar
// writes it, because a popup's own work ends when it closes.
import { shared, setShared, notify } from "herdr";
import { data, newId, pull, requestPull } from "./store.js";
import { transaction } from "./db.js";
import { activeRuns, isFinished } from "./runs.js";

const RUN_QUEUE = "projects.runQueue";

export function requestRun(run) {
  setShared(RUN_QUEUE, [...(shared(RUN_QUEUE) ?? []), run]);
}

export async function runQueuedRuns() {
  const queue = shared(RUN_QUEUE) ?? [];
  if (!queue.length) return;
  setShared(RUN_QUEUE, []);
  for (const request of queue) await createRun(request);
}

function setRuns(runs) {
  setShared("projects.db", { ...data(), runs });
}

// A run's review mode (free, code, every or both) is written onto its To do tasks, so hb done
// and the first message follow it; a waiver in the task's own notes still turns off the
// person's review.
async function createRun({ projectId, rootTaskId = null, taskIds, machine, agent, reviewMode = null, permissionMode = null }) {
  const run = { id: newId(), project_id: projectId, root_task_id: rootTaskId, task_ids: taskIds, machine, agent, review_mode: reviewMode, permission_mode: permissionMode, status: "active", started_at: Date.now() };
  setRuns([...(data().runs ?? []), run]);
  const queries = [["insert into runs (id, project_id, root_task_id, task_ids, machine, agent, review_mode, permission_mode) values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)",
    [run.id, projectId, rootTaskId, taskIds, machine, agent, reviewMode, permissionMode]]];
  if (reviewMode) queries.push([`update tasks set needs_review = case when review_waived then needs_review else $2::boolean end,
    code_review = $3::boolean, updated_at = now() where $1::jsonb ? id and status = 'todo'`,
  [taskIds, reviewMode === "every" || reviewMode === "both", reviewMode === "code" || reviewMode === "both"]]);
  try {
    await transaction(queries, "person");
  } catch (error) {
    notify({ title: "Couldn't start the run", body: String(error.message ?? error), level: "error" });
  }
  requestPull();
}

export async function stopRun(run) {
  setRuns((data().runs ?? []).filter((r) => r.id !== run.id));
  try {
    await transaction([["update runs set status = 'stopped', ended_at = now() where id = $1 and status = 'active'", [run.id]]], "person");
  } catch (error) {
    notify({ title: "Couldn't stop the run", body: String(error.message ?? error), level: "error" });
    await pull();
  }
}

// A run ends when its last task is Done; the database checks again in case this copy is behind.
export async function finishRuns() {
  const finished = activeRuns().filter(isFinished);
  if (!finished.length) return;
  await transaction(finished.map((run) => [`update runs set status = 'done', ended_at = now()
    where id = $1 and status = 'active'
      and not exists (select 1 from tasks t where runs.task_ids ? t.id and t.status <> 'done')`, [run.id]]), "run");
  const ended = new Set(finished.map((r) => r.id));
  setRuns((data().runs ?? []).filter((r) => !ended.has(r.id)));
}

// A task whose start failed leaves its runs, so they don't retry it every pass.
export const leaveRunsQuery = (taskId) => ["update runs set task_ids = task_ids - $1 where status = 'active' and task_ids ? $1", [taskId]];
