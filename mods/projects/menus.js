// Popups: start a session, a session's menu, link a session to a task, file a folder
// under a project, pick the board's project.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, run, exec, shared, setShared } from "herdr";
import { data, update, createTask, createSubproject } from "./store.js";
import { sessions } from "./model.js";
import { machineInfo, machineLabel, execTarget, self, repoNameOf } from "./machines.js";
import { requestStart, openDialog, showBoard } from "./actions.js";
import { projectColor } from "./skins/tokens.js";
import { agentsOn, loadAgents } from "./agents.js";
import { menuRow, menuHeading, chip, programIcon, icon, close, dialogHeader } from "./controls.js";
import { unstartedRepo, joinsAsOtherRepo, saveOtherRepo, releaseTab } from "./task-repos.js";
import { moveTargets, moveSession } from "./handoff.js";
import { canDrag, fileSession, wasMoved } from "./session-drag.js";
import { closeSession } from "./pending-closes.js";
import { openTask } from "./board-drag.js";
import { openProject, openLinkMenu, openAssign } from "./skins/parts.js";
import { PROJECT_DIALOG } from "./overlay-sizes.js";
import { lastPermissionMode, rememberPermissionMode, withPermissionMode, modeChips } from "./permission-mode.js";

const sessionFromProps = () => sessions().find((s) => s.id === props().sessionId) ?? null;
const homeName = (s) => data().projects.find((p) => p.id === s.homeProjectId)?.name ?? null;

export const start = {
  init(view, cx) {
    const p = props();
    const repos = data().subprojects.filter((s) => s.project_id === p.projectId);
    const task = data().tasks.find((t) => t.id === p.taskId);
    view.subprojectId = (task && unstartedRepo(task)) ?? p.subprojectId ?? repos[0]?.id ?? null;
    view.machine = shared("projects.lastMachine") ?? self();
    view.permissionMode = lastPermissionMode();
    start.loadAgents(view, cx);
  },
  loadAgents(view, cx) {
    cx.spawn(async (cx) => {
      try { await loadAgents(view.machine); } catch { /* the machine is away: the list says so */ }
      cx.notify();
    });
  },
  render(view, k) {
    const p = props();
    const task = data().tasks.find((t) => t.id === p.taskId);
    const repos = data().subprojects.filter((s) => s.project_id === p.projectId);
    const agents = agentsOn(view.machine);
    const go = (agent) => {
      setShared("projects.lastMachine", view.machine);
      rememberPermissionMode(view.permissionMode);
      requestStart({ subprojectId: view.subprojectId, machine: view.machine, agent: withPermissionMode(agent, view.permissionMode), taskId: task?.id ?? null, scratch: Boolean(p.scratch) });
      close();
    };
    return v_flex().p(6).w_full()
      .child(menuHeading(k, task ? `Start on: ${task.title}` : p.scratch ? "Scratch session" : "New session"))
      .when(repos.length > 1, (el) => el.child(h_flex().px(6).pb(6).gap(5).flex_wrap()
        .children(repos.map((sp) => chip(k, `start-repo-${sp.id}`, sp.name, view.subprojectId === sp.id, (cx) => { view.subprojectId = sp.id; cx.notify(); })))))
      .child(h_flex().px(6).pb(6).gap(5)
        .children((machineInfo().names ?? []).map((m) => chip(k, `start-machine-${m}`, machineLabel(m), view.machine === m, (cx) => {
          view.machine = m;
          start.loadAgents(view, cx);
          cx.notify();
        }))))
      .child(div().px(6).pb(6).child(modeChips(k, "start-mode", view.permissionMode, (mode) => { view.permissionMode = mode; })))
      .children(agents.map((a, i) => menuRow(k, `start-${a.key}`, a.name, () => go(a), { iconEl: programIcon(a, 14, k.ink), hint: i < 9 ? String(i + 1) : "" })))
      .when(agents.length === 0, (el) => el.child(div().px(10).py(6).text_size(12.5).text_color(k.faint).child("Checking installed agents")))
      .child(menuRow(k, "start-shell", "Terminal", () => go(null), { iconEl: svg("icons/shell.svg").size(14).text_color(k.ink) }));
  },
};

export const session = {
  render(view, k) {
    const s = sessionFromProps();
    if (!s) return div();
    const pick = (fn) => (cx) => { close(); fn(cx); };
    return v_flex().p(6).w_full()
      .child(menuHeading(k, s.title))
      .when(Boolean(s.projectId), (el) => el.child(menuRow(k, "sm-link", s.task ? "Change task" : "Link to a task", pick(() => openLinkMenu(s)), { iconEl: icon("square-pen", 14, k.muted) })))
      .when(Boolean(s.task), (el) => el.child(menuRow(k, "sm-open-task", "Open its task", pick(() => openTask(s.task)), { iconEl: icon("file-text", 14, k.muted) })))
      .when(Boolean(s.projectId), (el) => el.child(menuRow(k, "sm-board", "Show the board", pick(() => showBoard(s.projectId)), { iconEl: icon("layers", 14, k.muted) })))
      .when(!s.projectId || canDrag(s), (el) => el.child(menuRow(k, "sm-assign", s.projectId ? "Move to another project" : "Add to a project", pick(() => openAssign(s)), { iconEl: icon("folder-plus", 14, k.muted) })))
      .when(wasMoved(s), (el) => el.child(menuRow(k, "sm-unfile", homeName(s) ? `Back to ${homeName(s)}` : "Take out of the project", pick(() => fileSession(s, null)), { iconEl: icon("folder", 14, k.muted) })))
      .children(moveTargets(s).map((m) => menuRow(k, `sm-move-${m}`, `Move to ${machineLabel(m)}`, pick(() => moveSession(s, m)), { iconEl: icon("layers", 14, k.muted) })))
      .child(menuRow(k, "sm-rename", "Rename", pick(() => run("tab.rename", { id: s.tabId })), { iconEl: icon("square-pen", 14, k.muted) }))
      .child(menuRow(k, "sm-close", "Close session", pick(() => closeSession(s)), { iconEl: icon("x", 14, k.danger), tone: k.danger }));
  },
};

// A session works on one task at a time, so linking it unlinks it everywhere else.
function unlinkSession(s, keepTaskId = null) {
  for (const other of data().tasks.filter((t) => t.tab === s.id && t.id !== keepTaskId)) update("tasks", other.id, { tab: null });
  releaseTab(s.id, keepTaskId);
}

export const link = {
  render(view, k) {
    const s = sessionFromProps();
    if (!s) return div();
    const open = data().tasks.filter((t) => t.project_id === s.projectId && t.status !== "done");
    const attach = (task) => (cx) => {
      close();
      unlinkSession(s, task.id);
      const status = task.status === "todo" ? "doing" : task.status;
      if (!joinsAsOtherRepo(task, s.subprojectId)) return update("tasks", task.id, { tab: s.id, machine: s.machine, status, subproject_id: task.subproject_id ?? s.subprojectId });
      saveOtherRepo(task.id, s.subprojectId, { tab: s.id, machine: s.machine });
      if (status !== task.status) update("tasks", task.id, { status });
    };
    return v_flex().p(6).w_full()
      .child(menuHeading(k, "Link to a task"))
      .child(menuRow(k, "link-new", "New task from this session", (cx) => {
        close();
        unlinkSession(s);
        createTask({ projectId: s.projectId, subprojectId: s.subprojectId, title: s.title, status: "doing", tab: s.id, machine: s.machine });
      }, { iconEl: icon("plus", 14, k.muted) }))
      .child(v_flex().id("link-list").max_h(280).overflow_y_scrollbar()
        .children(open.map((t) => menuRow(k, `link-${t.id}`, t.title, attach(t), { hint: t.tab ? "has a session" : "" }))));
  },
};

export const picker = {
  render(view, k) {
    return v_flex().p(6).w_full()
      .child(menuHeading(k, "Board for"))
      .child(v_flex().id("pick-list").max_h(280).overflow_y_scrollbar()
        .children(data().projects.filter((p) => !p.archived).map((p, i) => menuRow(k, `pick-${p.id}`, p.name, () => { close(); setShared("projects.board", p.id); },
          { iconEl: div().size(10).rounded(3).bg(projectColor(p, i)) }))))
      .child(menuRow(k, "pick-new", "New project", () => { close(); openProject(); }, { iconEl: icon("plus", 14, k.muted) }));
  },
};

// The repo root of a folder (a worktree counts as its main checkout).
async function repoRoot(cwd, machine) {
  try {
    const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on: execTarget(machine) });
    const dir = r.stdout.trim();
    if (r.code === 0 && dir.endsWith("/.git")) return dir.slice(0, -5);
  } catch { /* not a repo, or the machine is away */ }
  return cwd;
}

// A session already in a project moves by its project label, the way a drag files it.
function moveDialog(s, k) {
  const rows = data().projects.filter((p) => !p.archived).flatMap((p, i) => p.id === s.projectId ? []
    : [menuRow(k, `move-${p.id}`, p.name, () => { close(); fileSession(s, p.id); }, { iconEl: div().size(10).rounded(3).bg(projectColor(p, i)) })]);
  return v_flex().p(20)
    .child(dialogHeader(k, "Move to another project"))
    .child(div().pt(10).pb(14).text_size(13).text_color(k.muted).child(s.title))
    .when(rows.length === 0, (el) => el.child(div().text_color(k.muted).child("No other projects")))
    .children(rows);
}

export const assign = {
  init(view, cx) {
    const s = sessionFromProps();
    view.root = s?.cwd ?? null;
    if (s?.cwd) cx.spawn(async (cx) => { view.root = await repoRoot(s.cwd, s.machine); cx.notify(); });
  },
  render(view, k) {
    const s = sessionFromProps();
    if (s?.projectId) return moveDialog(s, k);
    if (!s || !view.root) return v_flex().p(20).child(dialogHeader(k, "Add to a project")).child(div().pt(12).text_color(k.muted).child("This session has no folder to file."));
    const repo = repoNameOf(view.root, s.machine);
    const name = repo.split("/").pop();
    const file = (project) => () => {
      close();
      const existing = data().subprojects.find((sp) => sp.project_id === project.id && sp.repo === repo);
      if (existing) update("subprojects", existing.id, { paths: { ...(existing.paths ?? {}), [s.machine]: view.root } });
      else createSubproject({ projectId: project.id, name, repo, paths: { [s.machine]: view.root } });
    };
    return v_flex().p(20)
      .child(dialogHeader(k, "Add to a project"))
      .child(div().pt(10).pb(14).text_size(13).text_color(k.muted).child(`${name} on ${machineLabel(s.machine)}`))
      .children(data().projects.filter((p) => !p.archived).map((p, i) => menuRow(k, `assign-${p.id}`, p.name, file(p), { iconEl: div().size(10).rounded(3).bg(projectColor(p, i)) })))
      .child(menuRow(k, "assign-new", "New project with this repo", () => { close(); openDialog("project", { folder: view.root, machine: s.machine }, PROJECT_DIALOG); }, { iconEl: icon("plus", 14, k.muted) }));
  },
};
