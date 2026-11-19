// Rows of the Today view: sections, tasks, agents, changes and quiet projects.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { data, STATUS_LABEL, IMPORTANCE_LABEL } from "../store.js";
import { selectSession, showBoard } from "../actions.js";
import { openTask } from "../board-drag.js";
import { duration } from "../model.js";
import { describe, who, when } from "../history.js";
import { isPicked, canPick, togglePick } from "../today-picks.js";
import { icon, stop, tintedAction } from "../controls.js";
import { projectColor } from "./tokens.js";
import { agentCells, repoName } from "./agent-cells.js";

const firstLine = (text) => (text ?? "").split("\n")[0];
const ago = (at, now) => (at ? duration(now - at) : "");

function projectOf(projectId) {
  const projects = data().projects;
  const index = projects.findIndex((p) => p.id === projectId);
  return index < 0 ? null : { project: projects[index], index };
}

export function projectSwatch(projectId, size = 8) {
  const found = projectOf(projectId);
  return div().size(size).flex_none().rounded(2).bg(found ? projectColor(found.project, found.index) : "#44475A");
}

const projectName = (projectId) => projectOf(projectId)?.project.name ?? "";

export function section(k, id, title, color, count, rows, { empty, right = null } = {}) {
  return v_flex().id(id).flex_none().p(8).gap(2).rounded(8).bg(k.raw.darker)
    .child(h_flex().h(26).px(4).gap(8).items_center()
      .child(div().size(8).flex_none().rounded(2).bg(color))
      .child(div().text_size(13).font_weight(600).child(title))
      .when(count != null, (el) => el.child(div().text_size(12).text_color(k.faint).child(String(count))))
      .child(div().flex_1())
      .when(Boolean(right), (el) => el.child(right)))
    .when(rows.length === 0, (el) => el.child(div().px(4).py(4).text_size(12).text_color(k.faint).child(empty ?? "")))
    .children(rows);
}

export function quietLink(k, id, label, tooltip, action) {
  return div().id(id).text_size(11.5).text_color(k.faint).cursor_pointer().hover((s) => s.text_color(k.ink))
    .tooltip(tooltip).on_click((_e, cx) => action(cx)).child(label);
}

function pickControl(view, k, task, hovered) {
  if (isPicked(task)) {
    return h_flex().id(`today-picked-${task.id}`).gap(4).items_center().flex_none().cursor_pointer().tooltip("Drop from today")
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); togglePick(task); })
      .child(icon(hovered ? "x" : "circle-check", 12, hovered ? k.muted : k.raw.green))
      .child(div().text_size(11).text_color(k.raw.green).child("Today"));
  }
  if (!hovered || !canPick(task)) return null;
  return tintedAction(`today-pick-${task.id}`, "Pick for today", k.raw.purple, () => togglePick(task));
}

function taskMeta(task) {
  const repo = data().subprojects.find((s) => s.id === task.subproject_id)?.name;
  return [projectName(task.project_id), repo].filter(Boolean).join(" · ");
}

// `kind` keeps ids apart when one task shows in two sections.
export function taskRow(view, k, task, kind, { line = null, now = Date.now() } = {}) {
  const id = `today-${kind}-${task.id}`;
  const hovered = view.hovered === id;
  const important = task.importance === "urgent" || task.importance === "high";
  const done = task.status === "done";
  const pickEl = pickControl(view, k, task, hovered);
  return h_flex().id(id).px(6).py(6).gap(10).items_start().min_w(0).rounded(6).cursor_pointer()
    .when(hovered, (el) => el.bg(k.hover))
    .on_hover((on, cx) => view.hover(id, on, cx))
    .on_click(() => openTask(task))
    .child(div().pt(4).child(projectSwatch(task.project_id)))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().truncate().text_size(13).text_color(done ? k.muted : k.ink).when(done, (el) => el.line_through()).child(task.title))
      .when(Boolean(line), (el) => el.child(div().truncate().text_size(12).text_color(k.muted).child(line)))
      .child(h_flex().gap(8).items_center().min_w(0)
        .child(div().size(6).flex_none().rounded(2).bg(k.columns[task.status]))
        .child(div().flex_none().text_size(11.5).text_color(k.faint).child(STATUS_LABEL[task.status]))
        .when(important, (el) => el.child(div().flex_none().text_size(11.5).font_weight(600).text_color(k.importance[task.importance]).child(IMPORTANCE_LABEL[task.importance])))
        .child(div().truncate().text_size(11.5).text_color(k.faint).child(taskMeta(task)))
        .when(Boolean(task.reported_at), (el) => el.child(div().flex_none().text_size(11.5).text_color(k.faint).child(ago(task.reported_at, now))))))
    .when(Boolean(pickEl), (el) => el.child(pickEl));
}

export const reportLine = (task) => firstLine(task.report || task.notes) || null;

// A task's sessions share its title, so each names its repo.
export function agentRow(k, s, now) {
  const meta = [projectName(s.projectId), s.task ? repoName(s) : null].filter(Boolean).join(" · ");
  return h_flex().id(`today-ny-${s.id}`).h(32).px(6).gap(10).items_center().min_w(0).rounded(6).cursor_pointer()
    .hover((st) => st.bg(k.hover))
    .on_click(() => selectSession(s))
    .children(agentCells(k, s, now, s.title, meta));
}

export function changeRow(k, change, now) {
  const task = data().tasks.find((t) => t.id === change.taskId);
  const { latest } = change;
  const more = change.count > 1 ? ` · ${change.count} changes` : "";
  return h_flex().id(`today-ch-${change.taskId}`).px(6).py(6).gap(10).items_start().min_w(0).rounded(6)
    .when(Boolean(task), (el) => el.cursor_pointer().hover((s) => s.bg(k.hover)).on_click(() => openTask(task)))
    .child(div().pt(4).child(projectSwatch(change.projectId)))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().truncate().text_size(13).text_color(task ? k.ink : k.muted).child(change.title))
      .child(div().truncate().text_size(12).text_color(k.muted).child(describe(latest)))
      .when(latest.kind === "report", (el) => el.child(div().truncate().text_size(12).text_color(k.faint).child(firstLine(latest.after?.text))))
      .child(div().truncate().text_size(11.5).text_color(k.faint).child(`${who(latest)} · ${when(latest, now)}${more}`)));
}

export function quietProjectRow(k, row, now) {
  const { group, at } = row;
  return h_flex().id(`today-quiet-${group.project.id}`).h(30).px(6).gap(10).items_center().rounded(6).cursor_pointer()
    .hover((s) => s.bg(k.hover))
    .on_click(() => showBoard(group.project.id))
    .child(projectSwatch(group.project.id))
    .child(div().flex_1().min_w(0).truncate().text_size(13).child(group.project.name))
    .child(div().flex_none().text_size(11.5).text_color(k.faint).child(`${group.open} open`))
    .child(div().flex_none().w(64).text_size(11.5).text_color(k.faint).child(at ? when({ at }, now) : "No activity"));
}
