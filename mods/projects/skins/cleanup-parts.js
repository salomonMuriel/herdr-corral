// A Done card's worktree line (removed with the space freed, kept and why, or waiting for
// main) and the sidebar's line for the last nightly cleanup.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { icon } from "../controls.js";
import { openPopup } from "../actions.js";
import { CLEANUP_POPUP } from "../overlay-sizes.js";
import { when } from "../history.js";
import { cleanupRun, humanSize, worktreeBytes, isStale, NEON_INCLUDED_BRANCHES } from "../cleanup-runs.js";

const ICON = { removed: "archive", kept: "folder", waiting: "clock" };

export function cleanupLine(k, task) {
  const color = task.cleanup_kind === "removed" ? k.raw.green : task.cleanup_kind === "kept" ? k.raw.orange : k.faint;
  return h_flex().gap(5).items_center().min_w(0)
    .child(icon(ICON[task.cleanup_kind] ?? "folder", 11, color))
    .child(div().truncate().text_size(11.5).text_color(color).child(task.cleanup));
}

export function neonColor(k, branches) {
  if (branches > NEON_INCLUDED_BRANCHES) return k.raw.red;
  if (branches >= NEON_INCLUDED_BRANCHES - 1) return k.raw.orange;
  return null;
}

function reviewText(run) {
  if (!run.review.length) return "nothing to review";
  const bytes = worktreeBytes(run.review);
  return bytes ? `${run.review.length} to review · ${humanSize(bytes)}` : `${run.review.length} to review`;
}

export function cleanupRunLine(k) {
  const run = cleanupRun();
  if (!run) return null;
  const stale = isStale(run);
  const fullest = run.neon[0];
  const color = stale ? k.raw.orange : k.faint;
  const tooltip = stale ? `No cleanup since ${when(run)}` : "Show the cleanup list";
  return h_flex().id("cleanup-run").h(26).flex_none().px(12).gap(4).items_center().border_t(1).border_color(k.line)
    .text_size(11.5).text_color(color).cursor_pointer().hover((s) => s.text_color(k.ink)).tooltip(tooltip)
    .on_click(() => openPopup("cleanup", {}, CLEANUP_POPUP))
    .child(div().min_w(0).truncate().child(`Cleanup: ${reviewText(run)}`))
    .when(Boolean(fullest), (el) => el.child(div().flex_none().text_color(neonColor(k, fullest.branches) ?? color)
      .child(`· Neon ${fullest.branches}/${NEON_INCLUDED_BRANCHES} on ${fullest.project}`)));
}
