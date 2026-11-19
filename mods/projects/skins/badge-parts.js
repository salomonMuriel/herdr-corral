// Badges on a session's second line. Grey unless the person has something to do.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { icon } from "../controls.js";
import { duration } from "../model.js";

const CONTEXT_HIGH = 70;
const CONTEXT_FULL = 85;
const BAR_WIDTH = 22;

function contextColor(k, percent) {
  if (percent > CONTEXT_FULL) return k.raw.red;
  if (percent > CONTEXT_HIGH) return k.raw.orange;
  return k.faint;
}

export function contextBadge(k, s, state) {
  const id = `ctx-${s.id}`;
  if (state.ctx === null) {
    if (state.tokens !== null) return div().id(id).flex_none().tooltip("Context tokens").child(`${Math.round(state.tokens / 1000)}k`);
    return div().id(id).flex_none().tooltip("Context unknown").child("–");
  }
  const percent = Math.max(0, Math.min(100, state.ctx));
  const color = contextColor(k, percent);
  return h_flex().id(id).flex_none().gap(4).items_center().tooltip(`Context ${state.ctx}%`)
    .child(div().w(BAR_WIDTH).h(4).flex_none().rounded(2).bg(k.line)
      .child(div().w(Math.round((BAR_WIDTH * percent) / 100)).h_full().rounded(2).bg(color === k.faint ? k.dim : color)))
    .child(div().flex_none().text_color(color).child(`${state.ctx}%`));
}

export function planBadge(k, s) {
  const approval = s.ask === "plan";
  return div().id(`plan-${s.id}`).flex_none().text_color(approval ? k.status.blocked : k.faint)
    .tooltip(approval ? "Plan needs approval" : "Plan mode").child("plan");
}

export const isImportant = (task) => task?.importance === "urgent" || task?.importance === "high";

export function importanceBadge(k, s) {
  return div().id(`imp-${s.id}`).flex_none().tooltip("Task importance").child(s.task.importance);
}

export function scheduledBadge(k, s, wakeAt, now) {
  const time = new Date(wakeAt);
  const at = `${time.getHours()}:${String(time.getMinutes()).padStart(2, "0")}`;
  return h_flex().id(`wake-${s.id}`).flex_none().gap(3).items_center().tooltip(`Wakes at ${at}`)
    .child(icon("clock", 10, k.dim))
    .child(div().child(duration(wakeAt - now)));
}

const CI_LABEL = { pass: "CI passing", fail: "CI failing", pending: "CI running" };

function pullColor(k, pr) {
  if (pr.ci === "fail") return k.raw.red;
  if (pr.conflicts || pr.changesRequested) return k.raw.orange;
  return k.faint;
}

function pullTooltip(pr) {
  const parts = [`PR #${pr.number}`];
  if (pr.draft) parts.push("draft");
  if (pr.ci) parts.push(CI_LABEL[pr.ci]);
  if (pr.changesRequested) parts.push("changes requested");
  if (pr.conflicts) parts.push("conflicts");
  return parts.join(" · ");
}

function ciMark(k, ci) {
  if (ci === "pass") return icon("check", 10, k.dim);
  if (ci === "fail") return icon("x", 10, k.raw.red);
  return div().size(6).mx(2).flex_none().rounded_full().border(1).border_color(k.dim);
}

export function pullBadge(k, s, pr) {
  return h_flex().id(`pr-${s.id}`).flex_none().gap(3).items_center().tooltip(pullTooltip(pr))
    .child(div().text_color(pullColor(k, pr)).child(`#${pr.number}`))
    .when(Boolean(pr.ci), (el) => el.child(ciMark(k, pr.ci)));
}
