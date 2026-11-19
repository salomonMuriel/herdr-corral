// The grey line under a session's row (what its agent is doing, then its badges) and the
// account quota in the sidebar footer.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { stateOf, latestQuota } from "../state-line.js";
import { pullOf } from "../pulls.js";
import { contextBadge, planBadge, isImportant, importanceBadge, scheduledBadge, pullBadge } from "./badge-parts.js";

const QUOTA_HIGH = 80;

const wakeOf = (state, now) => (state?.wakeAt && state.wakeAt > now ? state.wakeAt : null);

export function hasStateLine(s, now = Date.now()) {
  const state = stateOf(s.terminal);
  if (s.app && (s.doing || state)) return true;
  return isImportant(s.task) || Boolean(pullOf(s)) || Boolean(wakeOf(state, now));
}

export function stateLine(k, s, indent, now = Date.now()) {
  const state = stateOf(s.terminal);
  const pr = pullOf(s);
  const wakeAt = wakeOf(state, now);
  return h_flex().pl(indent).gap(8).items_center().text_size(11.5).text_color(k.faint)
    .child(div().flex_1().min_w(0).truncate().child(s.doing ?? ""))
    .when(isImportant(s.task), (el) => el.child(importanceBadge(k, s)))
    .when(Boolean(wakeAt), (el) => el.child(scheduledBadge(k, s, wakeAt, now)))
    .when(Boolean(pr), (el) => el.child(pullBadge(k, s, pr)))
    .when(state?.mode === "plan", (el) => el.child(planBadge(k, s)))
    .when(Boolean(state) && Boolean(s.app), (el) => el.child(contextBadge(k, s, state)));
}

export function quotaLabel(k) {
  const quota = latestQuota();
  if (!quota) return null;
  const parts = [["5h", quota.five, quota.fiveReset], ["7d", quota.week, quota.weekReset]].filter(([, percent]) => percent !== null);
  const text = parts.map(([label, percent]) => `${label} ${percent}%`).join(" · ");
  const tooltip = parts.map(([label, percent, reset]) => `${label} ${percent}%${reset ? `, resets ${reset}` : ""}`).join(" · ");
  const high = Math.max(...parts.map(([, percent]) => percent)) >= QUOTA_HIGH;
  return div().id("quota").flex_none().text_color(high ? k.raw.orange : k.faint).tooltip(tooltip).child(text);
}
