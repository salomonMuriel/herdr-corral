// The popup behind the sidebar's cleanup line: what the last nightly run left to review,
// the machines it couldn't reach and each Neon project's branch count.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { menuHeading } from "./controls.js";
import { machineLabel } from "./machines.js";
import { duration } from "./model.js";
import { cleanupRun, humanSize, worktreeBytes, NEON_INCLUDED_BRANCHES } from "./cleanup-runs.js";
import { neonColor } from "./skins/cleanup-parts.js";

const MAX_HEIGHT = 470;

const sourceLabel = (name) => (name === "neon" ? "Neon" : machineLabel(name));

function summary(k, run) {
  const freed = worktreeBytes(run.removed);
  const text = run.removed.length ? `Removed ${run.removed.length}${freed ? `, ${humanSize(freed)} freed` : ""}` : "Removed nothing";
  return div().px(10).pb(6).text_size(12.5).text_color(k.muted).child(text);
}

function skippedRow(k, [name, why]) {
  return div().id(`cleanup-skipped-${name}`).px(10).pb(4).text_size(12).text_color(k.raw.orange).truncate().tooltip(why)
    .child(`${sourceLabel(name)} not reached; its items are from an earlier run`);
}

function reviewRow(k, entry, index) {
  const details = [sourceLabel(entry.machine), entry.size_bytes ? humanSize(entry.size_bytes) : null, entry.note].filter(Boolean).join(" · ");
  return v_flex().id(`cleanup-review-${index}`).px(10).py(5).gap(1).min_w(0).tooltip(entry.note)
    .child(div().truncate().text_size(12.5).text_color(k.ink).child(entry.label))
    .child(div().truncate().text_size(11.5).text_color(k.faint).child(details));
}

function neonRow(k, count) {
  return h_flex().px(10).py(3).gap(8).text_size(12.5)
    .child(div().flex_1().min_w(0).truncate().text_color(k.ink).child(count.project))
    .child(div().flex_none().text_color(neonColor(k, count.branches) ?? k.faint).child(`${count.branches}/${NEON_INCLUDED_BRANCHES}`));
}

export const cleanupList = {
  render(view, k) {
    const run = cleanupRun();
    if (!run) return v_flex().p(6).w_full().child(menuHeading(k, "No cleanup yet"));
    return v_flex().id("cleanup-list").p(6).w_full().max_h(MAX_HEIGHT).overflow_y_scrollbar()
      .child(menuHeading(k, `Cleanup ${duration(Date.now() - run.at)} ago on ${machineLabel(run.machine)}`.replace("now ago", "just now")))
      .child(summary(k, run))
      .children(Object.entries(run.skipped).map((pair) => skippedRow(k, pair)))
      .when(run.review.length > 0, (el) => el.child(menuHeading(k, `To review: ${run.review.length}`)))
      .children(run.review.map((entry, index) => reviewRow(k, entry, index)))
      .when(run.neon.length > 0, (el) => el.child(menuHeading(k, "Neon branches")))
      .children(run.neon.map((count) => neonRow(k, count)));
  },
};
