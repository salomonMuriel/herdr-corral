// Commands the views share: moving around, starting agents, opening dialogs.
import { run, exec, home, shared, setShared, notify, openOverlay, layout } from "herdr";
import { data, update, setReport } from "./store.js";
import { sessions, portfolio } from "./model.js";
import { canonical, machineArg, machineLabel, repoPath } from "./machines.js";
import { ensureCheckout } from "./checkout.js";
import { taskWorktree, worktreeNote, branchOf } from "./worktrees.js";
import { chainNote } from "./chain.js";
import { REPORTING_NOTE } from "./reporting.js";
import { reviewNote } from "./review.js";
import { TRUST_WAIT, isClaudeCode, repoTrusted } from "./trust.js";
import { joinsAsOtherRepo, saveOtherRepo, reposNote } from "./task-repos.js";
import { issueNote } from "./issues.js";
import { makeScratchFolder, isScratch, SCRATCH_SPACE } from "./scratch.js";

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export const boardShown = () => findNode(layout(), "view")?.active === "board";

// The board block draws either a project's board or Today.
const BOARD_MODE = "projects.boardMode";
export const todayMode = () => shared(BOARD_MODE) === "today";

export function showBoard(projectId) {
  if (projectId) setShared("projects.board", projectId);
  setShared(BOARD_MODE, "project");
  run("layout.select", { stack: "view", child: "board" });
}

export function showToday() {
  setShared(BOARD_MODE, "today");
  run("layout.select", { stack: "view", child: "board" });
}

export function toggleToday() {
  if (boardShown() && todayMode()) showWork();
  else showToday();
}

export function showWork() {
  run("layout.select", { stack: "view", child: "work" });
}

export function toggleBoard(projectId) {
  if (boardShown() && !todayMode()) showWork();
  else showBoard(projectId);
}

export function selectSession(session) {
  if (session.projectId) setShared("projects.board", session.projectId);
  if (session.pane) run("pane.focus", { pane: session.pane });
  else {
    run("space.select", { id: session.spaceId });
    run("tab.select", { id: session.tabId });
  }
  showWork();
}

export function openDialog(view, props = {}, size = {}) {
  return openOverlay({ mod: "projects", kind: "dialog", width: size.width ?? 520, height: size.height ?? 0.7, props: { view, ...props } });
}

export function openPopup(view, props = {}, size = {}) {
  return openOverlay({ mod: "projects", kind: "popup", width: size.width ?? 260, height: size.height ?? 360, props: { view, popup: true, ...props } });
}

const herdrApp = () => `${home()}/.local/bin/herdr-app`;

// Null when herdr-app printed something other than JSON, such as a plain error.
function parsePayload(stdout) {
  try {
    return JSON.parse(stdout || "{}");
  } catch {
    return null;
  }
}

export async function herdrDo(args) {
  const result = await exec(herdrApp(), ["do", ...args]);
  const payload = parsePayload(result.stdout);
  if (result.code === 0 && payload && !payload.error) return payload;
  throw new Error(payload?.error || result.stderr?.trim() || result.stdout?.trim() || `herdr-app exited with code ${result.code}`);
}

// A new agent on a task starts its code review over.
const FRESH_CODE_REVIEW = { code_review_state: null, code_review_round: 0, code_review_open: null, code_review_findings: null };

function tieSession(task, sp, place, actor) {
  if (joinsAsOtherRepo(task, sp.id)) {
    saveOtherRepo(task.id, sp.id, { ...place, cleanup: null, cleanup_kind: null }, actor);
    if (task.status === "todo") update("tasks", task.id, { status: "doing" }, actor);
    return;
  }
  update("tasks", task.id, { ...place, status: "doing", subproject_id: sp.id, ...FRESH_CODE_REVIEW }, actor);
}

// Starts `agent` (a knownAgents() entry, or null for a shell) in a repo on a machine,
// in that repo's space there when one is open, and ties it to `task`. `stackOn` is a
// finished task whose branch the new worktree starts from. Throws when it can't.
export async function launchSession({ subprojectId, machine, agent, task, stackOn = null, focus = true, note = "", actor = "person" }) {
  const sp = data().subprojects.find((s) => s.id === subprojectId);
  if (!subprojectId) throw new Error("The project has no repo to start in");
  if (!sp) throw new Error(task ? "The task's repo is gone" : "The repo is gone");
  const folder = repoPath(sp, machine);
  if (!folder) throw new Error(`No folder for ${sp.name} on ${machineLabel(machine)}`);
  await ensureCheckout(sp, machine, folder);
  const existing = sessions().find((s) => s.subprojectId === sp.id && s.machine === machine);
  const stackBranch = stackOn ? branchOf(stackOn) : null;
  const worktree = task ? await taskWorktree(folder, task, machine, stackBranch) : null;
  const untrusted = Boolean(task) && isClaudeCode(agent) && (await repoTrusted(folder, machine)) === false;
  const where = worktree?.path ?? folder;
  const chain = task ? chainNote(task, stackOn && { branch: stackBranch, title: stackOn.title }) : "";
  const repos = task ? reposNote(joinsAsOtherRepo(task, sp.id) ? task : { ...task, subproject_id: sp.id }, sp.id) : "";
  const firstMessage = task ? [task.title, task.notes ?? "", issueNote(task), worktreeNote(worktree), repos, chain, REPORTING_NOTE, reviewNote(task), note].filter(Boolean).join("\n\n") : null;
  const shared = [...(agent ? ["--argv", JSON.stringify(agent.run)] : []), ...(firstMessage ? ["--task", firstMessage] : [])];
  const made = existing
    ? await herdrDo(["tab.new", "--space", existing.spaceId, "--folder", where, ...shared])
    : await herdrDo(["space.new", "--machine", machineArg(machine), "--folder", where, "--name", sp.name, ...shared]);
  const name = task?.title ?? agent?.name;
  if (name) run("tab.rename", { id: made.tab, name });
  if (task) tieSession(task, sp, { tab: canonical(made.tab), machine, branch: worktree.branch }, actor);
  if (untrusted) setReport(task.id, TRUST_WAIT, "ask", "herdr");
  if (!focus) return;
  if (made.space) run("space.select", { id: made.space });
  if (made.tab) run("tab.select", { id: made.tab });
  showWork();
}

// A scratch session joins the Scratch space already open on that machine.
async function launchScratch({ machine, agent }) {
  const folder = await makeScratchFolder(machine);
  const existing = sessions().find((s) => s.machine === machine && isScratch(s.cwd, machine));
  const argv = agent ? ["--argv", JSON.stringify(agent.run)] : [];
  const made = existing
    ? await herdrDo(["tab.new", "--space", existing.spaceId, "--folder", folder, ...argv])
    : await herdrDo(["space.new", "--machine", machineArg(machine), "--folder", folder, "--name", SCRATCH_SPACE, ...argv]);
  run("tab.rename", { id: made.tab, name: folder.split("/").pop() });
  if (made.space) run("space.select", { id: made.space });
  if (made.tab) run("tab.select", { id: made.tab });
  showWork();
}

export async function startSession(options) {
  try {
    if (options.scratch) await launchScratch(options);
    else await launchSession(options);
  } catch (error) {
    notify({ title: "Couldn't start the session", body: String(error.message ?? error), level: "error" });
  }
}

// The board shows the project picked for it, else the one being worked in.
export function currentProjectId(model = portfolio()) {
  const picked = shared("projects.board");
  if (picked && data().projects.some((p) => p.id === picked)) return picked;
  return model.sessions.find((s) => s.active)?.projectId ?? data().projects[0]?.id ?? null;
}

export function panelShown(id) {
  const panel = findNode(layout(), "panel");
  return Boolean(panel && !panel.hidden && findNode(layout(), "panel-body")?.active === id);
}

export function togglePanel(id) {
  if (panelShown(id)) return run("layout.hide", { id: "panel" });
  run("layout.select", { stack: "panel-body", child: id });
  run("layout.show", { id: "panel" });
}

// Popups end their own tasks when they close, so they queue a start here and the sidebar
// (always running) carries it out.
const START_QUEUE = "projects.startQueue";

export function requestStart({ subprojectId, machine, agent, taskId, scratch = false }) {
  const request = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, subprojectId, machine, taskId, scratch,
    agent: agent ? { name: agent.name, run: agent.run } : null };
  setShared(START_QUEUE, [...(shared(START_QUEUE) ?? []), request]);
}

export async function runQueuedStarts() {
  const queue = shared(START_QUEUE) ?? [];
  if (!queue.length) return;
  setShared(START_QUEUE, []);
  for (const request of queue) {
    const task = request.taskId ? data().tasks.find((t) => t.id === request.taskId) : null;
    await startSession({ subprojectId: request.subprojectId, machine: request.machine, agent: request.agent, task, scratch: request.scratch });
  }
}
