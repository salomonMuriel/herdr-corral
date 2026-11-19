// Dracula's board (four columns in the editor area) and its top bar (a breadcrumb).
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { openPopup, openDialog, boardShown, showBoard, showWork, showToday, todayMode, togglePanel, panelShown } from "../actions.js";
import { STATUSES, STATUS_LABEL, IMPORTANCE_LABEL, data } from "../store.js";
import { machineLabel, self } from "../machines.js";
import { boardContext, setFilter } from "../board-context.js";
import { newTask, pressCard, dragOver, release, cancelDrag, isDragging, dropMarker } from "../board-drag.js";
import { projectColor } from "./tokens.js";
import { icon, programIcon, button, stop, tintedAction, pill } from "../controls.js";
import { sessionMark, needsYouPill, openProject, openStart } from "./parts.js";
import { LIST_DIALOG, PICKER_POPUP } from "../overlay-sizes.js";
import { startPopup } from "../start-guard.js";
import { waitingOn, dependenciesOf } from "../deps.js";
import { awaitingReview, waiverLine, reviewSwitch, showsReviewSwitch, codeReviewLine } from "./review-parts.js";
import { cleanupLine } from "./cleanup-parts.js";
import { codeReviewText } from "../code-review-plan.js";
import { runLine, runStrip } from "./run-parts.js";
import { runOf } from "../runs.js";
import { isSelected, toggleSelected, toggleColumn, runChain } from "../board-select.js";
import { otherRepos, canStartMore } from "../task-repos.js";
import { issueNumber } from "../issues.js";

const EMPTY = { todo: "Nothing to do yet", doing: "No agent is on a task", review: "Nothing waiting for review", done: "Nothing finished in 30 days" };

function tabButton(k, id, label, on, action) {
  return v_flex().id(id).h_full().px(10).justify_center().cursor_pointer().text_size(12.5)
    .text_color(on ? k.ink : k.faint).hover((s) => s.text_color(k.ink))
    .on_mouse_down("left", stop).on_click((_e, cx) => action(cx))
    .child(div().flex_1().flex().items_center().child(label))
    .child(div().h(2).w_full().rounded(1).bg(on ? k.raw.purple : `${k.raw.purple}00`));
}

function agentChip(k, task, session) {
  if (!session) return div().text_size(11).text_color(k.faint).child("Session closed");
  const waiting = task.status === "doing" && session.waiting && !session.coordinated;
  return h_flex().gap(6).items_center()
    .child(programIcon(session.program, 12, k.muted) ?? div())
    .child(div().text_size(11).text_color(k.faint).child(machineLabel(session.machine)))
    .child(waiting ? needsYouPill(k, "waiting on you") : sessionMark(k, session));
}

// An agent in one of the task's other repos: its program and status, the repo on hover.
function otherAgentChip(k, task, row, session) {
  const repo = data().subprojects.find((s) => s.id === row.subproject_id)?.name ?? "";
  const mark = !session ? div().text_size(11).text_color(k.faint).child("closed")
    : task.status === "doing" && session.waiting && !session.coordinated ? needsYouPill(k, "waiting") : sessionMark(k, session);
  return h_flex().id(`t-agent-${task.id}-${row.subproject_id}`).gap(4).items_center().tooltip(repo)
    .child(programIcon(session?.program, 12, k.muted) ?? div())
    .child(mark);
}

function otherCleanupLines(k, task) {
  return otherRepos(task.id).filter((r) => r.cleanup).map((r) => {
    const repo = data().subprojects.find((s) => s.id === r.subproject_id)?.name ?? "repo";
    return cleanupLine(k, { cleanup: `${repo}: ${r.cleanup}`, cleanup_kind: r.cleanup_kind });
  });
}

// The agent's latest report takes the notes line; a question stands out until the agent works again.
function summaryLine(k, task, session) {
  const firstLine = (text) => text.split("\n")[0];
  if (!task.report) return div().truncate().text_size(12).text_color(k.faint).child(firstLine(task.notes));
  if (task.report_kind === "ask" && session?.status !== "working") {
    return h_flex().gap(6).items_center().min_w(0).child(needsYouPill(k, "asks"))
      .child(div().truncate().text_size(12).text_color(k.ink).child(firstLine(task.report)));
  }
  return div().truncate().text_size(12).text_color(k.muted).child(firstLine(task.report));
}

function card(view, k, ctx, task) {
  const session = task.tab ? ctx.sessionByTab.get(task.tab) : null;
  const others = otherRepos(task.id);
  const repoNames = [task.subproject_id, ...others.map((r) => r.subproject_id)]
    .map((id) => data().subprojects.find((s) => s.id === id)?.name).filter(Boolean).join(" · ");
  const done = task.status === "done";
  const hovered = view.hovered === `t-${task.id}`;
  const canStart = canStartMore(task) && !done && ctx.repos.length > 0;
  const urgent = task.importance === "urgent" || task.importance === "high";
  const hasDeps = dependenciesOf(task.id).length > 0;
  const waits = hasDeps ? waitingOn(task.id).length : 0;
  const run = task.status === "todo" && !task.tab ? runOf(task.id) : null;
  const selected = isSelected(view, task);
  return v_flex().id(`t-${task.id}`).flex_none().p(10).gap(6).rounded(6).bg(selected ? `${k.raw.purple}1a` : k.raw.background).border_1()
    .border_color(selected ? k.raw.purple : hovered ? k.raw.comment : k.line).cursor_pointer()
    .when(isDragging(view, task), (el) => el.opacity(0.4))
    .on_hover((on, cx) => view.hover(`t-${task.id}`, on, cx))
    .on_mouse_down("left", (e, cx) => (e.modifiers?.shift ? toggleSelected(view, task, cx) : pressCard(view, task)))
    .on_mouse_move((_e, cx) => dragOver(view, task.status, task.id, cx))
    .child(div().text_size(13).text_color(done ? k.muted : k.ink).when(done, (el) => el.line_through()).child(task.title))
    .when(Boolean(task.report || task.notes), (el) => el.child(summaryLine(k, task, session)))
    .when(Boolean(codeReviewText(task)), (el) => el.child(codeReviewLine(k, task)))
    .when(task.status === "review", (el) => el.child(awaitingReview(k, task)))
    .when(Boolean(task.review_waived && task.waiver_quote), (el) => el.child(waiverLine(k, task.waiver_quote)))
    .when(showsReviewSwitch(task, ctx.group.project), (el) => el.child(reviewSwitch(k, task)))
    .when(Boolean(run), (el) => el.child(runLine(k, task, run)))
    .when(done && Boolean(task.cleanup), (el) => el.child(cleanupLine(k, task)))
    .when(done, (el) => el.children(otherCleanupLines(k, task)))
    .when(!done && (urgent || hasDeps), (el) => el.child(h_flex().gap(8).items_center()
      .when(urgent, (el) => el.child(pill(k.importance[task.importance], IMPORTANCE_LABEL[task.importance], 11)))
      .when(hasDeps && waits > 0, (el) => el.child(h_flex().gap(5).items_center().child(icon("clock", 11, k.dim)).child(div().text_size(11.5).text_color(k.faint).child(`Waits on ${waits}`))))
      .when(hasDeps && waits === 0, (el) => el.child(h_flex().gap(5).items_center().child(icon("circle-check", 11, k.raw.green)).child(div().text_size(11.5).text_color(k.raw.green).child("Ready"))))))
    .child(h_flex().gap(8).items_center()
      .when(Boolean(repoNames), (el) => el.child(h_flex().gap(5).items_center().min_w(0).child(icon("folder", 11, k.raw.purple)).child(div().truncate().text_size(11.5).text_color(k.muted).child(repoNames))))
      .when(Boolean(task.issue_url), (el) => el.child(div().id(`t-issue-${task.id}`).flex_none().text_size(11.5).text_color(k.raw.cyan).tooltip(task.issue_url).child(`#${issueNumber(task.issue_url)}`)))
      .child(div().flex_1())
      .when(Boolean(task.tab), (el) => el.child(agentChip(k, task, session)))
      .children(others.filter((r) => r.tab).map((r) => otherAgentChip(k, task, r, ctx.sessionByTab.get(r.tab))))
      .when(task.status === "todo" && ctx.repos.length > 0 && hovered, (el) => el.child(tintedAction(`t-run-${task.id}`, "Run this chain", k.raw.purple, () => runChain(task))))
      .when(canStart && hovered, (el) => el.child(tintedAction(`t-start-${task.id}`, "Start agent", k.raw.purple, () => startPopup(task)))));
}

const marker = (k) => div().h(2).mx(2).flex_none().rounded(1).bg(k.raw.purple);

function column(view, k, ctx, status) {
  const tasks = ctx.columns[status];
  const shown = status === "done" ? tasks.slice(0, 20) : tasks;
  return v_flex().flex_1().min_w(0).h_full().p(8).gap(8).rounded(8).bg(k.raw.darker)
    .child(h_flex().h(28).px(4).gap(8).items_center().flex_none()
      .child(h_flex().id(`select-${status}`).gap(8).items_center()
        .when(status !== "done", (el) => el.cursor_pointer().tooltip("Select the column").on_click((_e, cx) => toggleColumn(view, ctx.group.project.id, tasks, cx)))
        .child(div().size(8).rounded(2).bg(k.columns[status]))
        .child(div().text_size(13).font_weight(600).child(STATUS_LABEL[status])))
      .child(div().text_size(12).text_color(k.faint).child(String(tasks.length)))
      .child(div().flex_1())
      .child(div().id(`add-${status}`).size(22).flex().items_center().justify_center().rounded(4).cursor_pointer().hover((s) => s.bg(k.line))
        .on_click(() => newTask(ctx.group.project.id, status, ctx.filter)).child(icon("plus", 13, k.dim))))
    .child(v_flex().id(`col-${status}`).flex_1().min_h(0).gap(8).overflow_y_scrollbar()
      .when(tasks.length === 0, (el) => el.child(div().h(38).flex_none().flex().items_center().px(10).rounded(6).border_1().border_dashed().border_color(k.line)
        .text_size(12).text_color(k.faint).on_mouse_move((_e, cx) => dragOver(view, status, null, cx)).child(EMPTY[status])))
      .children(shown.flatMap((t) => [...(dropMarker(view, status, t.id) ? [marker(k)] : []), card(view, k, ctx, t)]))
      .when(dropMarker(view, status, null), (el) => el.child(marker(k)))
      .child(div().id(`col-end-${status}`).flex_1().min_h(40).on_mouse_move((_e, cx) => dragOver(view, status, null, cx))));
}

export function board(view, model, k, projectId) {
  const ctx = boardContext(view, model, projectId);
  const root = v_flex().size_full().min_h(0).bg(k.raw.background).font_family(k.font).text_color(k.ink);
  if (!ctx.group) {
    return root.items_center().justify_center().gap(12)
      .child(div().text_size(15).child("No projects yet"))
      .child(button(k, "board-first", "New project", "primary", () => openProject()));
  }
  const p = ctx.group.project;
  const index = model.groups.indexOf(ctx.group);
  const strip = runStrip(view, k, p.id);
  const filterTab = (id, label, value) => tabButton(k, id, label, ctx.filter === value, (cx) => setFilter(view, p.id, value, cx));
  return root.id("board").p(16).gap(12)
    .on_mouse_up("left", (_e, cx) => release(view, cx))
    .on_hover((on, cx) => { if (!on) cancelDrag(view, cx); })
    .child(h_flex().h(40).flex_none().gap(14).items_center()
      .child(h_flex().id("board-project").gap(8).items_center().cursor_pointer().px(6).h(32).rounded(6).hover((s) => s.bg(k.hover))
        .on_click(() => openPopup("picker", {}, PICKER_POPUP))
        .child(div().size(10).rounded(2).bg(projectColor(p, index)))
        .child(div().text_size(18).font_weight(600).child(p.name))
        .child(icon("chevron-down", 13, k.dim)))
      .when(ctx.repos.length > 1, (el) => el.child(h_flex().h(32).items_center()
        .child(filterTab("filter-all", "All repos", null))
        .children(ctx.repos.map((sp) => filterTab(`filter-${sp.id}`, sp.name, sp.id)))))
      .child(div().flex_1())
      .child(div().text_size(12).text_color(k.faint).child(`${ctx.group.open} open`))
      .when(ctx.repos.length > 0, (el) => el.child(button(k, "board-issues", "Issues", "plain", () => openDialog("issues", { projectId: p.id }, LIST_DIALOG))))
      .child(button(k, "board-history", "History", "plain", () => openDialog("history", { projectId: p.id }, LIST_DIALOG)))
      .child(button(k, "board-new", "New task", "primary", () => newTask(p.id, "todo", ctx.filter))))
    .when(Boolean(strip), (el) => el.child(strip))
    .child(h_flex().flex_1().min_h(0).gap(12).children(STATUSES.map((status) => column(view, k, ctx, status))));
}

export function bar(view, model, k) {
  const s = model.sessions.find((x) => x.active);
  const group = model.groups.find((g) => g.project.id === s?.projectId);
  const repo = group?.subs.find((x) => x.sp.id === s?.subprojectId)?.sp;
  const onBoard = boardShown() && !todayMode();
  const onToday = boardShown() && todayMode();
  const sep = () => icon("chevron-right", 11, k.dim);
  return h_flex().size_full().bg(k.raw.darker).border_b(1).border_color(k.line).pl(12).pr(8).gap(8).items_center().font_family(k.font).text_size(12.5)
    .when(Boolean(group), (el) => el.child(div().size(8).rounded(2).bg(projectColor(group.project, model.groups.indexOf(group)))).child(div().text_color(k.muted).child(group.project.name)).child(sep()))
    .when(Boolean(repo), (el) => el.child(div().text_color(k.muted).child(repo.name)).child(sep()))
    .child(div().min_w(0).truncate().font_weight(600).text_color(k.ink).child(s?.title ?? "No session"))
    .when(Boolean(s), (el) => el.child(h_flex().gap(5).items_center().child(icon(s.machine === self() ? "monitor" : "server", 12, k.dim)).child(div().text_color(k.faint).child(machineLabel(s.machine)))))
    .when(Boolean(s?.branch) && !["main", "master"].includes(s?.branch), (el) => el.child(h_flex().gap(5).items_center().child(icon("git-branch", 12, k.dim)).child(div().text_color(k.raw.cyan).child(s.branch))))
    .child(div().flex_1().h_full().min_w(8))
    .child(h_flex().h_full()
      .child(tabButton(k, "view-work", "Sessions", !onBoard && !onToday, () => showWork()))
      .child(tabButton(k, "view-today", "Today", onToday, () => showToday()))
      .child(tabButton(k, "view-board", "Board", onBoard, () => showBoard(group?.project.id))))
    .child(div().w(1).h(16).bg(k.line))
    .child(barIcon(k, "files", "files", "Files", panelShown("files"), () => togglePanel("files")))
    .child(barIcon(k, "changes", "git-compare", "Changes", panelShown("changes"), () => togglePanel("changes")))
    .child(barIcon(k, "new-session", "plus", "New session", false, () => openStart(group?.project.id ?? data().projects[0]?.id, repo?.id)));
}

function barIcon(k, id, name, tooltip, on, action) {
  return div().id(`bar-${id}`).size(26).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
    .when(on, (el) => el.bg(k.line)).hover((s) => s.bg(k.hover)).tooltip(tooltip)
    .on_mouse_down("left", stop).on_click(() => action())
    .child(icon(name, 14, on ? k.ink : k.muted));
}
