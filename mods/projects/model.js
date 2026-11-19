// Turns Herdr's spaces and tabs plus the board's rows into projects > repos > sessions.
import { spaces, panes } from "herdr";
import { data } from "./store.js";
import { waitingOn } from "./deps.js";
import { canonical, machineOf, repoPath } from "./machines.js";
import { terminalsByAddress, waitingOnYou, askOf } from "./attention.js";
import { worktreeOf } from "./worktrees.js";
import { IN_FLIGHT } from "./code-review-plan.js";
import { repoIdsOf } from "./task-repos.js";
import { COORDINATOR_TITLE, ASK_LABEL, ASKED_LABEL } from "./coordinator-labels.js";
import { PROJECT_LABEL } from "./terminal-labels.js";
import { isClosing } from "./pending-closes.js";

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
export const urgent = (a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a);

const cleanTitle = (title) => (title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(allPanes) {
  const leads = new Map();
  for (const pane of allPanes) {
    if (!pane.terminal) continue;
    const current = leads.get(pane.tab);
    if (!current || (!current.program?.agent && pane.program?.agent)) leads.set(pane.tab, pane);
  }
  return leads;
}

function sessionTitle(tab, lead, task) {
  if (task) return task.title;
  if (tab.named) return tab.name;
  const live = cleanTitle(lead?.title);
  const telling = live && live !== lead?.program?.name && !/^[~/]/.test(live) && !live.includes("@");
  return telling ? live : lead?.program?.name ?? "Terminal";
}

const within = (cwd, root) => Boolean(cwd && root) && (cwd === root || cwd.startsWith(`${root}/`));

// The repo a folder belongs to: the longest matching checkout path, else a herdr
// worktree of a repo with that name.
function matchSubproject(cwd, machine, subprojects) {
  let best = null;
  for (const sp of subprojects) {
    const root = repoPath(sp, machine);
    if (within(cwd, root) && (!best || root.length > best.length)) best = { sp, length: root.length };
  }
  if (best) return best.sp;
  return subprojects.find((sp) => sp.repo && cwd?.includes(`/.herdr/worktrees/${sp.repo}/`)) ?? null;
}

// Only the target project's repos are searched, so a repo filed in two projects lands in the right one.
function filedSubproject(cwd, machine, db, labels) {
  const projectId = labels?.[PROJECT_LABEL];
  const project = projectId ? db.projects.find((p) => p.id === projectId && !p.archived) : null;
  if (!project) return null;
  const sp = matchSubproject(cwd, machine, db.subprojects.filter((s) => s.project_id === project.id));
  return { projectId: project.id, sp };
}

// Each stored tab's task and the repo it works in: the task's own, or one of its other repos.
function taskTabs(db) {
  const byId = new Map(db.tasks.map((t) => [t.id, t]));
  const links = new Map();
  for (const row of db.taskRepos ?? []) {
    const task = row.tab ? byId.get(row.task_id) : null;
    if (task) links.set(row.tab, { task, subprojectId: row.subproject_id });
  }
  for (const task of db.tasks.filter((t) => t.tab)) links.set(task.tab, { task, subprojectId: task.subproject_id });
  return links;
}

// A coordinator's row says what it passed on to the person, else what it's doing.
function coordinatorFields(coordinator, agentTerminal) {
  if (!coordinator) return { coordinator: null, coordinatorAsk: null, coordinatorAskedAt: null };
  const labels = agentTerminal?.labels ?? {};
  const ask = labels[ASK_LABEL] || null;
  return {
    coordinator: coordinator.project_id,
    coordinatorAsk: ask,
    coordinatorAskedAt: Number(labels[ASKED_LABEL]) || null,
    doing: ask ?? agentTerminal?.report?.msg ?? coordinator.note ?? null,
  };
}

// Workers a live coordinator started go to it first, not to the person.
function markCoordinated(all, db) {
  const live = new Set(all.filter((s) => s.coordinator).map((s) => s.coordinator));
  const started = new Set((db.runs ?? []).filter((r) => r.status === "active" && r.started_by === "coordinator").flatMap((r) => r.task_ids ?? []));
  for (const s of all) s.coordinated = Boolean(s.task) && live.has(s.task.project_id) && started.has(s.task.id);
  return all;
}

export function sessions() {
  const db = data();
  const coordinatorByTab = new Map((db.coordinators ?? []).map((c) => [c.tab, c]));
  const leads = leadPanes(panes());
  const agentTerminals = terminalsByAddress();
  const now = Date.now();
  const taskByTab = taskTabs(db);
  const out = [];
  for (const space of spaces()) {
    const machine = machineOf(space);
    for (const tab of space.tabs) {
      if (isClosing(tab.id)) continue;
      const lead = leads.get(tab.id);
      const id = canonical(tab.id);
      const coordinator = coordinatorByTab.get(id) ?? null;
      const link = coordinator ? null : taskByTab.get(id) ?? null;
      const task = link?.task ?? null;
      const cwd = lead?.cwd ?? space.folder;
      const agentTerminal = lead?.terminal ? agentTerminals.get(lead.terminal) : null;
      const home = coordinator || link?.subprojectId ? null : matchSubproject(cwd, machine, db.subprojects);
      const filed = coordinator || link ? null : filedSubproject(cwd, machine, db, agentTerminal?.labels);
      const sp = coordinator ? null : link?.subprojectId ? db.subprojects.find((s) => s.id === link.subprojectId) : filed ? filed.sp : home;
      out.push({
        id, tabId: tab.id, spaceId: space.id, machine, cwd, task,
        subprojectId: sp?.id ?? null,
        projectId: task?.project_id ?? coordinator?.project_id ?? filed?.projectId ?? sp?.project_id ?? null,
        homeProjectId: home?.project_id ?? null,
        title: coordinator ? COORDINATOR_TITLE : sessionTitle(tab, lead, task),
        program: lead?.program ?? null,
        pane: lead?.pane ?? null,
        terminal: lead?.terminal ?? null,
        status: tab.status,
        turn: agentTerminal?.turn ?? null,
        agentStatus: agentTerminal?.status ?? null,
        app: agentTerminal?.report?.app ?? null,
        doing: agentTerminal?.report?.msg ?? null,
        waiting: waitingOnYou(agentTerminal, now) && !IN_FLIGHT.has(task?.code_review_state),
        ask: askOf(agentTerminal),
        labels: agentTerminal?.labels ?? {},
        statusAt: agentTerminal?.status_ms ?? null,
        active: space.active && tab.active,
        since: tab.working_since ?? tab.changed_at ?? null,
        branch: lead?.branch ?? null,
        worktree: worktreeOf(cwd),
        ...coordinatorFields(coordinator, agentTerminal),
      });
    }
  }
  return markCoordinated(out, db);
}

export function portfolio() {
  const db = data();
  const all = sessions();
  const groups = db.projects.filter((p) => !p.archived).map((project) => {
    const mine = all.filter((s) => s.projectId === project.id);
    const subs = db.subprojects.filter((sp) => sp.project_id === project.id)
      .map((sp) => ({ sp, sessions: mine.filter((s) => s.subprojectId === sp.id) }));
    const loose = mine.filter((s) => !s.subprojectId && !s.coordinator);
    const tasks = db.tasks.filter((t) => t.project_id === project.id);
    return {
      project, subs, loose, sessions: mine, tasks,
      coordinator: mine.find((s) => s.coordinator) ?? null,
      status: mine.reduce((m, s) => urgent(m, s.status), null),
      open: tasks.filter((t) => t.status !== "done").length,
      active: mine.some((s) => s.active),
    };
  });
  return { groups, unsorted: all.filter((s) => !s.projectId), sessions: all };
}

export function tasksByStatus(tasks, filter) {
  const shown = filter ? tasks.filter((t) => repoIdsOf(t).includes(filter)) : tasks;
  const columns = { todo: [], doing: [], review: [], done: [] };
  for (const task of shown) (columns[task.status] ?? columns.todo).push(task);
  const waits = (t) => (t.status === "done" ? 0 : Math.min(1, waitingOn(t.id).length));
  for (const key of Object.keys(columns)) columns[key].sort((a, b) => waits(a) - waits(b) || a.position - b.position);
  columns.done.sort((a, b) => (b.done_at ?? 0) - (a.done_at ?? 0));
  return columns;
}

export function duration(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
