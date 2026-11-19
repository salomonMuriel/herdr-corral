// A rail of project marks beside a tree. "All" shows every project's tree; a project's
// mark narrows the tree to that project and adds what's waiting for review and up next.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { setShared, shared } from "herdr";
import { showBoard } from "../../actions.js";
import { STATUS_LABEL, KINDS } from "../../store.js";
import { projectColor } from "../tokens.js";
import { icon } from "../../controls.js";
import { newTask, openTask } from "../../board-drag.js";
import { iconButton, openProject, openStart, openScratch, sectionLabel, projectMark } from "../parts.js";
import { tree, projectBody, sessionRow } from "./tree.js";
import { startCoordinator } from "../../coordinator.js";
import { hoverProject, dropOnProject, isDropTarget } from "../../session-drag.js";

const RAIL = 56;
const MARK = 34;

function badge(k, status) {
  if (status === "blocked" || status === "done") return div().absolute().top(-3).right(-3).size(11).rounded_full().bg(k.status[status]).border(2).border_color(k.raw.darkest);
  if (status === "working") return div().absolute().bottom(-4).right(-4).size(14).rounded_full().bg(k.raw.darkest).flex().items_center().justify_center()
    .child(svg("mods/workspace-chrome/spinner.svg").size(10).text_color(k.status.working).spin(900));
  return null;
}

const choose = (id) => {
  setShared("projects.focus", id);
  if (id !== "all" && id !== "loose") setShared("projects.board", id);
};

// The slot keeps every mark the same size and draws the selection as a ring outside it.
function slot(k, id, tooltip, selected, content, status, action = () => choose(id)) {
  const b = badge(k, status);
  return div().id(`rail-${id}`).relative().size(MARK + 6).flex_none().p(1).rounded(10).cursor_pointer()
    .border(2).border_color(selected ? k.ink : `${k.ink}00`)
    .hover((s) => s.bg(k.hover)).tooltip(tooltip)
    .on_click(() => action())
    .child(content)
    .when(Boolean(b), (el) => el.child(b));
}

function sessionCount(k, count) {
  return div().absolute().bottom(-4).left(-4).min_w(15).h(15).px(3).rounded_full().bg(k.raw.darkest)
    .flex().items_center().justify_center().text_size(10).font_weight(600).text_color(k.muted).child(String(count));
}

const sessionsTooltip = (g) => (g.sessions.length ? `${g.project.name} \u00b7 ${g.sessions.length} session${g.sessions.length === 1 ? "" : "s"}` : g.project.name);

function projectSlot(view, k, model, g, chosen) {
  const selected = chosen === g.project.id;
  return slot(k, g.project.id, sessionsTooltip(g), selected, projectMark(k, g.project, model.groups.indexOf(g), MARK, selected), g.status)
    .when(g.sessions.length > 0, (el) => el.child(sessionCount(k, g.sessions.length)))
    .on_mouse_down("right", () => openProject(g.project.id))
    .on_hover((on, cx) => hoverProject(view, g.project.id, on, cx))
    .on_mouse_up("left", () => dropOnProject(view, g.project.id))
    .when(isDropTarget(view, g.project.id), (el) => el.border_color(k.raw.purple));
}

// Companies, clients and side projects, each run of marks split by a short rule.
function projectSlots(view, k, model, chosen) {
  const runs = KINDS.map((kind) => model.groups.filter((g) => g.project.kind === kind)).filter((run) => run.length);
  return runs.flatMap((run, i) => [
    ...(i > 0 ? [div().w(14).h(1).flex_none().bg(k.line)] : []),
    ...run.map((g) => projectSlot(view, k, model, g, chosen)),
  ]);
}

function rail(view, k, model, chosen) {
  const allStatus = model.sessions.some((s) => s.status === "blocked") ? "blocked" : null;
  const looseStatus = model.unsorted.some((s) => s.status === "blocked") ? "blocked" : null;
  return v_flex().w(RAIL).h_full().flex_none().pt(8).pb(10).gap(8).items_center().bg(k.raw.darkest)
    .child(slot(k, "all", "All projects", chosen === "all",
      div().size(MARK).rounded(8).bg(chosen === "all" ? k.line : k.raw.darker).flex().items_center().justify_center().child(icon("layers", 15, k.ink)), allStatus))
    .child(div().w(24).h(1).bg(k.line))
    .children(projectSlots(view, k, model, chosen))
    .child(slot(k, "new", "New project", false,
      div().size(MARK).rounded(8).border_1().border_dashed().border_color(k.line).flex().items_center().justify_center().child(icon("plus", 14, k.dim)), null, () => openProject()))
    .child(div().flex_1())
    .child(slot(k, "loose", "Not in a project", chosen === "loose",
      div().size(MARK).rounded(8).bg(k.raw.darker).flex().items_center().justify_center().child(icon("terminal", 14, k.muted)), looseStatus));
}

function panelHead(k, title, color, actions = []) {
  return h_flex().h(42).flex_none().pl(12).pr(6).gap(4).items_center().border_b(1).border_color(k.line)
    .child(div().flex_1().min_w(0).truncate().text_size(14).font_weight(600).text_color(color).child(title))
    .children(actions);
}

function taskLine(k, task, group) {
  const repo = group.subs.find((sub) => sub.sp.id === task.subproject_id)?.sp;
  return h_flex().id(`ft-${task.id}`).h(28).flex_none().px(12).gap(8).items_center().cursor_pointer().hover((st) => st.bg(k.hover))
    .on_click(() => openTask(task))
    .child(div().size(7).flex_none().rounded(2).bg(k.columns[task.status]))
    .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(k.ink).child(task.title))
    .when(Boolean(repo), (el) => el.child(div().flex_none().max_w(90).truncate().text_size(11).text_color(k.faint).child(repo.name)))
    .when(!task.tab && task.status === "todo" && group.subs.length > 0, (el) => el.child(iconButton(k, `ft-start-${task.id}`, "plus", "Start agent", () => openStart(task.project_id, task.subproject_id, task.id))));
}

function projectPanel(view, k, model, group, now) {
  const p = group.project;
  const index = model.groups.indexOf(group);
  const todo = group.tasks.filter((t) => t.status === "todo").sort((a, b) => a.position - b.position);
  const review = group.tasks.filter((t) => t.status === "review");
  return v_flex().flex_1().min_w(0).h_full()
    .child(panelHead(k, p.name, projectColor(p, index), [
      iconButton(k, "f-board", "layers", "Board", () => showBoard(p.id)),
      ...(group.coordinator || group.subs.length === 0 ? [] : [iconButton(k, "f-coordinator", "pin", "Start coordinator", () => startCoordinator(p.id))]),
      ...(group.subs.length === 0 ? [] : [iconButton(k, "f-new", "plus", "New session", () => openStart(p.id))]),
      iconButton(k, "f-edit", "settings", "Edit project", () => openProject(p.id)),
    ]))
    .child(v_flex().id("focus-body").flex_1().min_h(0).pt(4).pb(10).overflow_y_scrollbar()
      .children(projectBody(view, k, group, 0, now))
      .when(review.length > 0, (el) => el.child(sectionLabel(k, "f-review", STATUS_LABEL.review, review.length)).children(review.map((t) => taskLine(k, t, group))))
      .child(sectionLabel(k, "f-next", "Up next", todo.length))
      .children(todo.slice(0, 5).map((t) => taskLine(k, t, group)))
      .child(h_flex().id("f-add").h(28).px(12).gap(7).items_center().cursor_pointer().text_size(12).text_color(k.faint).hover((s) => s.text_color(k.ink))
        .on_click(() => newTask(p.id)).child(icon("plus", 12, k.dim)).child("Add a task")));
}

function loosePanel(view, model, k, now) {
  return v_flex().flex_1().min_w(0).h_full()
    .child(panelHead(k, "Not in a project", k.ink, [iconButton(k, "f-scratch", "plus", "Scratch session", () => openScratch())]))
    .child(v_flex().id("focus-body").flex_1().min_h(0).pt(4).overflow_y_scrollbar()
      .children(model.unsorted.map((s) => sessionRow(view, k, s, 0, now)))
      .when(model.unsorted.length === 0, (el) => el.child(h_flex().id("f-scratch-empty").h(28).px(12).gap(7).items_center().cursor_pointer()
        .text_size(12).text_color(k.faint).hover((s) => s.text_color(k.ink))
        .on_click(() => openScratch()).child(icon("plus", 12, k.dim)).child("Scratch session"))));
}

export function focus(view, model, k) {
  const now = Date.now();
  const stored = shared("projects.focus") ?? "all";
  const group = model.groups.find((g) => g.project.id === stored);
  const chosen = group || stored === "loose" ? stored : "all";
  const panel = group ? projectPanel(view, k, model, group, now)
    : chosen === "loose" ? loosePanel(view, model, k, now)
    : v_flex().flex_1().min_w(0).h_full().child(panelHead(k, "All projects", k.ink)).child(tree(view, model, k));
  return h_flex().flex_1().min_h(0).child(rail(view, k, model, chosen)).child(panel);
}
