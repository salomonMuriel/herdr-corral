// Starts the Ready tasks of this machine's active runs. Each is claimed on the board before it
// starts, so a task both windows or two passes see starts once. Why a task still waits goes
// to shared state for the board.
import { notify } from "herdr";
import { update, pull } from "./store.js";
import { transaction } from "./db.js";
import { self, machineLabel } from "./machines.js";
import { readyFor, upstreamBranches, slotsFor, PER_REPO } from "./chain.js";
import { isMerged } from "./merges.js";
import { launchSession } from "./actions.js";
import { unattendedAgent, UNATTENDED_NOTE } from "./unattended.js";
import { withPermissionMode, PLAN_NOTE } from "./permission-mode.js";
import { agentsOn, loadAgents } from "./agents.js";
import { setAutoStartWaits, slotWait } from "./autostart-waits.js";
import { finishRuns, leaveRunsQuery } from "./run-actions.js";

export async function runAutoStart() {
  const machine = self();
  if (!machine) return;
  await finishRuns();
  const waits = {};
  for (const { task, run } of readyFor(machine)) {
    const wait = slotWait(task, machine) ?? (await startOrWait(task, run, machine));
    if (wait) waits[task.id] = wait;
  }
  setAutoStartWaits(waits);
}

async function startOrWait(task, run, machine) {
  const plan = await basePlan(task, machine);
  if (plan.wait) return plan.wait;
  if (!(await claim(task, run, machine))) return null;
  try {
    const agent = unattendedAgent(withPermissionMode(await findAgent(run.agent, machine), run.permission_mode), machine);
    await launchSession({ subprojectId: task.subproject_id, machine, agent, task, stackOn: plan.stackOn, focus: false, note: run.permission_mode === "plan" ? `${PLAN_NOTE}\n\n${UNATTENDED_NOTE}` : UNATTENDED_NOTE, actor: "run" });
  } catch (error) {
    await release(task, String(error.message ?? error));
  }
  return null;
}

// Every finished task it waits on must be merged into main, except that a task set to
// stack starts from the one unmerged branch in its repo on this machine.
async function basePlan(task, machine) {
  const open = [];
  for (const dep of upstreamBranches(task)) {
    if (!(await mergedOrUnknown(dep))) open.push(dep);
  }
  if (!open.length) return {};
  const [only] = open;
  const stacks = task.base === "stack" && open.length === 1 && only.subproject_id === task.subproject_id && only.machine === machine;
  if (stacks) return { stackOn: only };
  return { wait: open.length === 1 ? `Waits for ${only.title} to merge` : `Waits for ${open.length} branches to merge` };
}

// A machine that can't be asked counts as not merged yet; the next pass asks again.
async function mergedOrUnknown(dep) {
  try {
    return await isMerged(dep);
  } catch {
    return false;
  }
}

// One claim at a time across both windows (the advisory lock), and only while the task is
// still To do, its run is still active, it waits on nothing open, and a slot is free.
async function claim(task, run, machine) {
  const [, rows] = await transaction([
    ["select 1 from (select pg_advisory_xact_lock(hashtext('projects.autostart'))) as l"],
    [`update tasks set status = 'doing', machine = $2, updated_at = now()
      where id = $1 and status = 'todo' and tab is null
        and exists (select 1 from runs r where r.id = $5 and r.status = 'active' and r.task_ids ? tasks.id)
        and not exists (select 1 from task_deps d join tasks u on u.id = d.depends_on where d.task_id = tasks.id and u.status <> 'done')
        and (select count(*) from tasks o where o.status = 'doing' and o.machine = $2) < $3
        and (select count(*) from tasks o where o.status = 'doing' and o.subproject_id = tasks.subproject_id) < $4
      returning id`, [task.id, machine, slotsFor(machine), PER_REPO, run.id]],
  ], "run");
  if (!rows.length) return false;
  update("tasks", task.id, { status: "doing", machine }, "run");
  return true;
}

async function findAgent(key, machine) {
  const installed = agentsOn(machine).length ? agentsOn(machine) : await loadAgents(machine);
  const agent = installed.find((a) => a.key === key);
  if (!agent) throw new Error(`${key} isn't installed on ${machineLabel(machine)}`);
  return { name: agent.name, run: agent.run };
}

// A start that fails goes back to To do and out of its runs, so it doesn't retry every pass.
async function release(task, reason) {
  notify({ title: `Couldn't start ${task.title}`, body: reason, level: "error" });
  await transaction([
    [`update tasks set status = 'todo', report = $2, report_kind = 'ask',
      reported_at = now(), updated_at = now() where id = $1`, [task.id, `Couldn't start in the run: ${reason}`]],
    leaveRunsQuery(task.id),
  ], "run");
  await pull();
}
