// Today, in the board's place: today's picks, agents waiting, review and important work on the
// left; what changed since the person left, quiet projects and the Pi's digest on the right.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { openPopup } from "../actions.js";
import { PICK_POPUP } from "../overlay-sizes.js";
import { needsYou } from "../needs-you.js";
import { when } from "../history.js";
import { button } from "../controls.js";
import { picks, MAX_PICKS } from "../today-picks.js";
import { reviewTasks, importantTasks, untouchedProjects, changesByTask, untouchedDays, cycleUntouchedDays } from "../today.js";
import { leftAt } from "../away.js";
import { section, taskRow, reportLine, agentRow, changeRow, quietProjectRow, quietLink } from "./today-parts.js";
import { digestPanel } from "./digest-parts.js";

const CHANGES_SHOWN = 40;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function dateLabel(now) {
  const day = new Date(now);
  return `${WEEKDAYS[day.getDay()]}, ${MONTHS[day.getMonth()]} ${day.getDate()}`;
}

const openPicker = () => openPopup("pick", {}, PICK_POPUP);

function picksSection(view, k, now) {
  const picked = picks();
  const rows = picked.map((t) => taskRow(view, k, t, "pick", { line: reportLine(t), now }));
  const right = picked.length < MAX_PICKS ? quietLink(k, "today-pick-open", "Pick", "Choose from every open task", () => openPicker()) : null;
  const done = picked.filter((t) => t.status === "done").length;
  return section(k, "today-picks", "Today's 3", k.raw.purple, picked.length ? `${done} of ${picked.length} done` : null, rows,
    { empty: "Pick up to three tasks to finish today", right });
}

function needsYouSection(k, model, now) {
  const queue = needsYou(model.sessions, now);
  return section(k, "today-needs", "Needs you", k.status.blocked, queue.length, queue.map((s) => agentRow(k, s, now)), { empty: "Nothing needs you" });
}

function reviewSection(view, k, now) {
  const tasks = reviewTasks();
  return section(k, "today-review", "Review", k.columns.review, tasks.length,
    tasks.map((t) => taskRow(view, k, t, "review", { line: reportLine(t), now })), { empty: "Nothing waiting for review" });
}

function importantSection(view, k, now) {
  const tasks = importantTasks();
  return section(k, "today-important", "Urgent and high", k.importance.urgent, tasks.length,
    tasks.map((t) => taskRow(view, k, t, "important", { now })), { empty: "No urgent or high tasks open" });
}

function changesSection(k, state, now) {
  const changes = changesByTask(state?.events);
  const shown = changes.slice(0, CHANGES_SHOWN);
  const since = leftAt();
  const empty = state?.error ?? (state?.at ? "No changes" : "Loading");
  return section(k, "today-since", `Since you left · ${when({ at: since }, now)}`, k.raw.cyan, changes.length,
    shown.map((change) => changeRow(k, change, now)), { empty });
}

function untouchedSection(k, model, state, now) {
  const days = untouchedDays();
  const quiet = untouchedProjects(model.groups, state?.touched, days, now);
  const toggle = quietLink(k, "today-days", `${days}+ days`, "Show 3, 7 or 14 days", (cx) => { cycleUntouchedDays(); cx.notify(); });
  return section(k, "today-quiet", "Untouched", k.dim, state?.touched ? quiet.length : null,
    quiet.map((row) => quietProjectRow(k, row, now)), { empty: state?.touched ? `Every project moved in the last ${days} days` : "Loading", right: toggle });
}

const column = (id, children) => v_flex().id(id).flex_1().min_w(0).h_full().gap(12).overflow_y_scrollbar().children(children);

export function today(view, model, k) {
  const now = Date.now();
  const state = view.today;
  return v_flex().size_full().min_h(0).p(16).gap(12).bg(k.raw.background).font_family(k.font).text_color(k.ink)
    .child(h_flex().h(40).flex_none().gap(14).items_center()
      .child(div().px(6).text_size(18).font_weight(600).child("Today"))
      .child(div().text_size(12.5).text_color(k.faint).child(dateLabel(now)))
      .child(div().flex_1())
      .when(picks().length < MAX_PICKS, (el) => el.child(button(k, "today-pick", "Pick today's 3", "plain", () => openPicker()))))
    .child(h_flex().flex_1().min_h(0).gap(12).items_start()
      .child(column("today-left", [picksSection(view, k, now), needsYouSection(k, model, now), reviewSection(view, k, now), importantSection(view, k, now)]))
      .child(column("today-right", [changesSection(k, state, now), untouchedSection(k, model, state, now), digestPanel(view, k, state)])));
}
