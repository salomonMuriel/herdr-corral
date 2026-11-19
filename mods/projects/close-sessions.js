// Closes a Done task's session on this machine once its agent and every helper it started
// (hc run terminals whose parent chain leads to the tab) have been quiet for a while. The
// worktree is a separate step that waits for the merge. Sessions with no task are never touched.
import { panes, terminals, focused, window, run } from "herdr";
import { data } from "./store.js";
import { self } from "./machines.js";
import { sessions } from "./model.js";
import { partsOf, partKey } from "./task-repos.js";

const QUIET_MS = 15000;
const RETRY_MS = 60000;
const BUSY = new Set(["working", "blocked"]);

const closedAt = new Map();

export function liveSession(task, all = sessions()) {
  if (!task.tab) return null;
  return all.find((s) => s.id === task.tab && s.task?.id === task.id) ?? null;
}

function tabTerminals(session) {
  return panes().filter((p) => p.tab === session.tabId && p.terminal).map((p) => p.terminal);
}

// The tab's own terminals and their live descendants, by the parent each helper records.
function terminalTree(session, all) {
  const tree = new Set(tabTerminals(session));
  let grew = true;
  while (grew) {
    grew = false;
    for (const terminal of all) {
      if (tree.has(terminal.address) || !tree.has(terminal.parent)) continue;
      tree.add(terminal.address);
      grew = true;
    }
  }
  return all.filter((t) => tree.has(t.address));
}

const quiet = (terminal, now) => !BUSY.has(terminal.status) && now - (terminal.status_ms ?? 0) > QUIET_MS;

// The person may be reading the agent's last reply.
const inView = (session) => Boolean(window()?.active) && focused()?.tab === session.tabId;

function closable(session, tree, now) {
  if (BUSY.has(session.status) || inView(session)) return false;
  return tree.every((terminal) => quiet(terminal, now));
}

function close(session, tree) {
  const own = new Set(tabTerminals(session));
  for (const helper of tree.filter((t) => !own.has(t.address) && t.state !== "finished")) {
    run("terminal.kill", { terminal: helper.address });
  }
  run("tab.close", { id: session.tabId, confirmed: true });
}

export function closeFinishedSessions() {
  const machine = self();
  if (!machine) return;
  const now = Date.now();
  const all = terminals();
  let live = sessions();
  for (const task of data().tasks.filter((t) => t.status === "done").flatMap(partsOf)) {
    if (task.machine !== machine) continue;
    if (now - (closedAt.get(partKey(task)) ?? 0) < RETRY_MS) continue;
    const session = liveSession(task, live);
    if (!session || session.machine !== machine) continue;
    const tree = terminalTree(session, all);
    if (!closable(session, tree, now)) continue;
    close(session, tree);
    live = live.filter((s) => s !== session);
    closedAt.set(partKey(task), now);
  }
}
