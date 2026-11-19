// Claude Code starts a task in auto mode or in plan mode, picked where the task starts.
import { h_flex } from "gpui-base";
import { shared, setShared } from "herdr";
import { isClaudeCode } from "./trust.js";
import { chip } from "./controls.js";

const MODES = [["auto", "Auto"], ["plan", "Plan"]];
const LAST_MODE = "projects.lastPermissionMode";

export const PLAN_NOTE = "You start in plan mode. When the plan is ready, present it with ExitPlanMode and wait: the person approves it before you change anything. After that, carry on unattended as below.";

export const lastPermissionMode = () => shared(LAST_MODE) ?? "auto";
export const rememberPermissionMode = (mode) => setShared(LAST_MODE, mode);

export function withPermissionMode(agent, mode) {
  if (!mode || !isClaudeCode(agent)) return agent;
  return { ...agent, run: [...agent.run, "--permission-mode", mode] };
}

export function modeChips(k, idPrefix, selected, pick) {
  return h_flex().gap(5).flex_wrap()
    .children(MODES.map(([mode, label]) => chip(k, `${idPrefix}-${mode}`, label, selected === mode, (cx) => { pick(mode); cx.notify(); })));
}
