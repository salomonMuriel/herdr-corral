// The Run popup: a chain from one task, or the tasks picked on the board, with the machine,
// agent and review mode the run starts them with.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, shared, setShared } from "herdr";
import { data } from "./store.js";
import { machineInfo, machineLabel, self } from "./machines.js";
import { agentsOn, loadAgents } from "./agents.js";
import { chainFrom } from "./runs.js";
import { requestRun } from "./run-actions.js";
import { DEFAULT_AGENT } from "./chain.js";
import { button, chip, fieldLabel, close, dialogHeader } from "./controls.js";
import { lastPermissionMode, rememberPermissionMode, modeChips } from "./permission-mode.js";
import { isClaudeCode } from "./trust.js";

const REVIEW_CHOICES = [[null, "Each task's own"], ["free", "None"], ["code", "Code review"], ["every", "Your review"], ["both", "Both"]];

function load(view, cx) {
  const machine = view.machine;
  cx.spawn(async (cx) => {
    try { await loadAgents(machine); } catch { /* the machine is away: the list says so */ }
    cx.notify();
  });
}

export function init(view, cx) {
  view.machine = shared("projects.lastMachine") ?? self();
  view.agent = DEFAULT_AGENT;
  view.reviewMode = null;
  view.permissionMode = lastPermissionMode();
  load(view, cx);
}

function chosenTasks() {
  const p = props();
  if (p.rootTaskId) return chainFrom(p.rootTaskId);
  const byId = new Map(data().tasks.map((t) => [t.id, t]));
  return (p.taskIds ?? []).map((id) => byId.get(id)).filter((t) => t && t.status !== "done");
}

function go(view, tasks, agent) {
  const p = props();
  const permissionMode = isClaudeCode(agent) ? view.permissionMode : null;
  setShared("projects.lastMachine", view.machine);
  if (permissionMode) rememberPermissionMode(permissionMode);
  requestRun({ projectId: p.projectId, rootTaskId: p.rootTaskId ?? null, taskIds: tasks.map((t) => t.id), machine: view.machine, agent: agent.key, reviewMode: view.reviewMode, permissionMode });
  close();
}

function taskList(k, tasks) {
  const shown = tasks.slice(0, 6);
  return v_flex().gap(2)
    .children(shown.map((t) => div().truncate().text_size(12.5).text_color(k.muted).child(t.title)))
    .when(tasks.length > shown.length, (el) => el.child(div().text_size(12).text_color(k.faint).child(`and ${tasks.length - shown.length} more`)));
}

export function render(view, k) {
  const p = props();
  const tasks = chosenTasks();
  const runnable = tasks.filter((t) => t.subproject_id);
  const skipped = tasks.length - runnable.length;
  const agents = agentsOn(view.machine);
  const agent = agents.find((a) => a.key === view.agent) ?? agents[0] ?? null;
  const agentKey = agent?.key ?? null;
  const pickMachine = (m) => (cx) => { view.machine = m; load(view, cx); cx.notify(); };
  const title = p.rootTaskId ? "Run this chain" : `Run ${runnable.length} selected`;
  return v_flex().id("run-dialog").p(20)
    .child(dialogHeader(k, title))
    .child(div().pt(12).child(taskList(k, runnable)))
    .when(skipped > 0, (el) => el.child(div().pt(6).text_size(12).text_color(k.faint).child(`${skipped} without a repo won't start`)))
    .child(fieldLabel(k, "Machine"))
    .child(h_flex().gap(6).flex_wrap()
      .children((machineInfo().names ?? []).map((m) => chip(k, `run-machine-${m}`, machineLabel(m), view.machine === m, pickMachine(m)))))
    .child(fieldLabel(k, "Agent"))
    .child(agents.length
      ? h_flex().gap(6).flex_wrap().children(agents.map((a) => chip(k, `run-agent-${a.key}`, a.name, agentKey === a.key, (cx) => { view.agent = a.key; cx.notify(); })))
      : div().text_size(12).text_color(k.faint).child("Checking installed agents"))
    .when(isClaudeCode(agent), (el) => el.child(fieldLabel(k, "Mode")).child(modeChips(k, "run-mode", view.permissionMode, (mode) => { view.permissionMode = mode; })))
    .child(fieldLabel(k, "Review"))
    .child(h_flex().gap(6).flex_wrap()
      .children(REVIEW_CHOICES.map(([mode, label]) => chip(k, `run-review-${mode ?? "own"}`, label, view.reviewMode === mode, (cx) => { view.reviewMode = mode; cx.notify(); }))))
    .child(h_flex().pt(24).gap(8).items_center()
      .child(div().flex_1())
      .child(button(k, "run-cancel", "Cancel", "quiet", () => close()))
      .when(runnable.length > 0 && Boolean(agentKey), (el) => el.child(button(k, "run-go", "Run", "primary", () => go(view, runnable, agent)))));
}
