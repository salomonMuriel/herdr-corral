// Tree: an editor's explorer. Projects are folders, repos subfolders, sessions the files.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { selectSession, showBoard } from "../../actions.js";
import { KIND_LABEL, KINDS } from "../../store.js";
import { machineLabel } from "../../machines.js";
import { icon, programIcon } from "../../controls.js";
import { markShown } from "../../state-line.js";
import { hasStateLine, stateLine } from "../state-parts.js";
import { statusMark, sessionMark, iconButton, age, openProject, openStart, openSessionMenu, openLinkMenu, openAssign, sectionLabel, projectMark } from "../parts.js";
import { startCoordinator } from "../../coordinator.js";
import { pressSession, hoverProject, dropOnProject, isDraggingSession, isDropTarget } from "../../session-drag.js";

const ROW = 28;
const ROW_TWO_LINES = 40;
// The state line starts under the title, past the program icon.
const ICON_COLUMN = 24;
const guides = (k, depth) => Array.from({ length: depth }, () => div().w(14).h_full().flex_none().ml(7).border_l(1).border_color(k.line));

function worktreeLabel(k, s) {
  return h_flex().id(`s-wt-${s.id}`).flex_none().max_w(120).gap(4).items_center().tooltip(`Worktree ${s.worktree}`)
    .child(icon("git-branch", 11, k.dim))
    .child(div().min_w(0).truncate().text_size(11).text_color(k.faint).child(s.worktree));
}

function sessionLine(view, k, s, now) {
  const hovered = view.hovered === s.id;
  const time = age(s, now);
  return h_flex().items_center().gap(8)
    .child(h_flex().w(16).flex_none().justify_center().child(programIcon(s.program, 13, k.muted) ?? icon("terminal", 13, k.dim)))
    .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(s.status === "idle" && !s.active ? k.muted : k.ink).child(s.title))
    .when(Boolean(s.coordinator), (el) => el.child(div().id(`s-pin-${s.id}`).flex_none().tooltip("Plans and starts this project's tasks").child(icon("pin", 11, k.dim))))
    .when(Boolean(s.worktree), (el) => el.child(worktreeLabel(k, s)))
    .when(!s.task && hovered && Boolean(s.projectId), (el) => el.child(iconButton(k, `s-link-${s.id}`, "square-pen", "Link to a task", () => openLinkMenu(s))))
    .when(!s.projectId && hovered, (el) => el.child(iconButton(k, `s-file-${s.id}`, "folder-plus", "Add to a project", () => openAssign(s))))
    .child(div().flex_none().text_size(11).text_color(k.faint).child(machineLabel(s.machine)))
    .when(Boolean(time) && s.status === "working", (el) => el.child(div().flex_none().w(26).text_right().text_size(11).text_color(k.faint).child(time)))
    .child(sessionMark(k, s));
}

function sessionRow(view, k, s, depth, now) {
  markShown(s.terminal);
  const twoLines = hasStateLine(s, now);
  return h_flex().id(`s-${s.id}`).h(twoLines ? ROW_TWO_LINES : ROW).flex_none().pl(8).pr(8).items_center().gap(8).cursor_pointer()
    .when(s.active, (el) => el.bg(k.line)).when(!s.active, (el) => el.hover((st) => st.bg(k.hover)))
    .when(isDraggingSession(view, s), (el) => el.opacity(0.4))
    .on_hover((on, cx) => view.hover(s.id, on, cx))
    .on_mouse_down("left", () => pressSession(view, s))
    .on_click(() => selectSession(s))
    .on_mouse_down("right", () => openSessionMenu(s))
    .children(guides(k, depth))
    .child(v_flex().flex_1().min_w(0).gap(1)
      .child(sessionLine(view, k, s, now))
      .when(twoLines, (el) => el.child(stateLine(k, s, ICON_COLUMN, now))));
}

function repoRow(view, k, group, sub, depth) {
  const id = `r-${sub.sp.id}`;
  return h_flex().id(id).h(ROW).flex_none().pl(8).pr(8).items_center().gap(7)
    .hover((st) => st.bg(k.hover))
    .on_hover((on, cx) => view.hover(id, on, cx))
    .children(guides(k, depth))
    .child(icon("folder", 13, k.raw.purple))
    .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(k.muted).child(sub.sp.name))
    .when(view.hovered === id, (el) => el.child(iconButton(k, `${id}-new`, "plus", "New session", () => openStart(group.project.id, sub.sp.id))));
}

function projectRow(view, k, group, index, folded) {
  const p = group.project;
  const id = `p-${p.id}`;
  const hovered = view.hovered === id;
  return h_flex().id(id).h(30).flex_none().px(8).items_center().gap(7).cursor_pointer()
    .hover((st) => st.bg(k.hover))
    .when(isDropTarget(view, p.id), (el) => el.bg(k.line))
    .on_hover((on, cx) => { view.hover(id, on, cx); hoverProject(view, p.id, on, cx); })
    .on_mouse_up("left", () => dropOnProject(view, p.id))
    .on_click((_e, cx) => view.toggleFold(p.id, group.sessions.length === 0, cx))
    .on_mouse_down("right", () => openProject(p.id))
    .child(icon(folded ? "chevron-right" : "chevron-down", 12, k.dim))
    .child(projectMark(k, p, index, 18))
    .child(div().flex_1().min_w(0).truncate().text_size(13).font_weight(600).text_color(k.ink).child(p.name))
    .when(hovered, (el) => el
      .child(iconButton(k, `${id}-board`, "layers", "Board", () => showBoard(p.id)))
      .when(!group.coordinator && group.subs.length > 0, (el) => el.child(iconButton(k, `${id}-coordinator`, "pin", "Start coordinator", () => startCoordinator(p.id))))
      .when(group.subs.length > 0, (el) => el.child(iconButton(k, `${id}-new`, "plus", "New session", () => openStart(p.id)))))
    .when(!hovered && group.sessions.length > 0, (el) => el.child(h_flex().flex_none().gap(3).items_center()
      .child(icon("terminal", 11, k.faint)).child(div().text_size(11.5).text_color(k.faint).child(String(group.sessions.length)))))
    .when(!hovered && group.open > 0, (el) => el.child(div().flex_none().text_size(11.5).text_color(k.faint).child(`${group.open} open`)))
    .when(folded && (group.status === "working" || group.status === "done"), (el) => el.child(statusMark(k, group.status)));
}

// One project's repos and sessions, `depth` levels in, its coordinator pinned on top.
export function projectBody(view, k, group, depth, now) {
  const rows = group.coordinator ? [sessionRow(view, k, group.coordinator, depth, now)] : [];
  const flat = group.subs.length <= 1;
  for (const sub of group.subs) {
    if (!flat) rows.push(repoRow(view, k, group, sub, depth));
    rows.push(...sub.sessions.map((s) => sessionRow(view, k, s, flat ? depth : depth + 1, now)));
  }
  rows.push(...group.loose.map((s) => sessionRow(view, k, s, depth, now)));
  if (group.subs.length === 0) rows.push(h_flex().id(`p-empty-${group.project.id}`).h(ROW).pl(8).pr(8).items_center().gap(7).cursor_pointer()
    .hover((st) => st.bg(k.hover)).children(guides(k, depth))
    .on_click(() => openProject(group.project.id))
    .child(div().text_size(12.5).text_color(k.faint).child("Add a repo")));
  return rows;
}

function groupRows(view, k, group, index, now) {
  const folded = view.isFolded(group.project.id, group.sessions.length === 0);
  const head = projectRow(view, k, group, index, folded);
  if (folded) return [head, ...group.sessions.filter((s) => s.status === "blocked").map((s) => sessionRow(view, k, s, 1, now))];
  return [head, ...projectBody(view, k, group, 1, now)];
}

export function tree(view, model, k) {
  const now = Date.now();
  const kinds = KINDS.filter((kind) => model.groups.some((g) => g.project.kind === kind));
  const rows = [];
  for (const kind of kinds) {
    if (kinds.length > 1) rows.push(sectionLabel(k, `kind-${kind}`, KIND_LABEL[kind]));
    model.groups.filter((g) => g.project.kind === kind).forEach((g) => rows.push(...groupRows(view, k, g, model.groups.indexOf(g), now)));
  }
  if (model.unsorted.length) {
    rows.push(sectionLabel(k, "kind-unsorted", "Not in a project"));
    rows.push(...model.unsorted.map((s) => sessionRow(view, k, s, 0, now)));
  }
  return v_flex().id("tree").flex_1().min_h(0).pb(10).overflow_y_scrollbar().children(rows);
}

export { sessionRow };
