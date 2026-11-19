// Review pieces of a board card: the waiting-for-review line, the code review line, the
// per-task switch and a waiver's quote.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { moveTask } from "../store.js";
import { needsReview, reviewModeOf, setNeedsReview } from "../review.js";
import { icon, stop, tintedAction, pill } from "../controls.js";
import { codeReviewText } from "../code-review-plan.js";

export function waiverLine(k, quote) {
  return h_flex().gap(6).items_start().min_w(0)
    .child(div().flex_none().pt(1).child(icon("check", 11, k.raw.orange)))
    .child(div().flex_1().min_w(0).text_size(11.5).text_color(k.muted)
      .child(`Review waived: “${quote}”`));
}

export function awaitingReview(k, task) {
  return h_flex().gap(8).items_center()
    .child(pill(k.columns.review, task.code_review_state === "failed" ? "Waiting for you" : "Done, waiting for your review"))
    .child(div().flex_1())
    .child(tintedAction(`t-approve-${task.id}`, "Approve", k.raw.green, () => moveTask(task.id, "done")));
}

const CODE_REVIEW_ICON = { queued: "clock", running: "clock", fixing: "clock", passed: "circle-check", failed: "x" };

export function codeReviewLine(k, task) {
  const text = codeReviewText(task);
  if (!text) return null;
  const state = task.code_review_state;
  const color = state === "passed" ? k.raw.green : state === "failed" ? k.raw.red : state === "fixing" ? k.raw.orange : k.raw.cyan;
  return h_flex().gap(5).items_center().min_w(0)
    .child(icon(CODE_REVIEW_ICON[state], 11, color))
    .child(div().truncate().text_size(11.5).text_color(color).child(text));
}

function switchTrack(k, on) {
  return div().w(24).h(14).flex_none().rounded_full().p(2).flex().items_center()
    .when(on, (el) => el.justify_end())
    .bg(on ? k.raw.purple : k.line)
    .child(div().size(10).rounded_full().bg(on ? k.raw.darkest : k.muted));
}

export function reviewSwitch(k, task) {
  const on = needsReview(task);
  return h_flex().id(`t-review-${task.id}`).gap(6).items_center().cursor_pointer()
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); setNeedsReview(task, !on); })
    .child(switchTrack(k, on))
    .child(div().text_size(11.5).text_color(on ? k.ink : k.faint).child("Needs my review"));
}

export const showsReviewSwitch = (task, project) => reviewModeOf(project) === "per_task" && !task.review_waived && task.status !== "done";
