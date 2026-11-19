// Once a Done task's branch is on main and close-sessions.js has closed its session, the
// window of the task's machine runs scripts/task-cleanup, which removes the worktree, branch
// and Neon branch when scripts/cleanup's rules call them safe and writes the outcome to the
// card. The script runs detached: Neon and GitHub lookups outlast exec's 30 s.
import { exec, home } from "herdr";
import { data, update } from "./store.js";
import { self } from "./machines.js";
import { isMerged } from "./merges.js";
import { taskPlace } from "./worktrees.js";
import { closeFinishedSessions, liveSession } from "./close-sessions.js";
import { partsOf, partKey, recordPartCleanup } from "./task-repos.js";

const RUN_TIMEOUT_MS = 5 * 60000;
const DAY_MS = 24 * 3600000;

const scriptPath = () => `${home()}/git/herdr-projects/scripts/task-cleanup`;
const logPath = () => `${home()}/.cache/herdr-projects/task-cleanup.log`;

const LAUNCH = 'log="$1"; shift; mkdir -p "$(dirname "$log")"; echo "== $(date) $3" >> "$log"; nohup "$@" >> "$log" 2>&1 &';

let running = null;
const checkedAt = new Map();

// A fresh Done task is asked about every pass; one whose branch stays off main less often.
const recheckAfter = (task) => (Date.now() - (task.done_at ?? 0) < DAY_MS ? 90000 : 15 * 60000);

// A Done task's worktree in each of its repos, as parts that read like tasks.
const doneParts = () => data().tasks.filter((t) => t.status === "done").flatMap(partsOf);

// Only parts with a recorded branch: older tasks ran in the main checkout and left nothing here.
function candidates(machine) {
  return doneParts().filter((t) => t.machine === machine && t.subproject_id
    && t.branch && (!t.cleanup_kind || t.cleanup_kind === "waiting"));
}

function record(part, cleanup, cleanup_kind) {
  if (part.partOf) return recordPartCleanup(part, cleanup, cleanup_kind);
  return update("tasks", part.id, { cleanup, cleanup_kind }, "herdr");
}

// True while a launched run hasn't written its outcome; one that never does is called kept.
function stillRunning() {
  if (!running) return false;
  const part = doneParts().find((t) => partKey(t) === running.key);
  if (!part || (part.cleanup_kind && part.cleanup_kind !== "waiting")) {
    running = null;
    return false;
  }
  if (Date.now() - running.at < RUN_TIMEOUT_MS) return true;
  record(part, `Worktree kept: cleanup didn't finish (log in ${logPath()})`, "kept");
  running = null;
  return false;
}

async function mergedNow(task) {
  const last = checkedAt.get(partKey(task)) ?? 0;
  if (task.cleanup_kind === "waiting" && Date.now() - last < recheckAfter(task)) return false;
  checkedAt.set(partKey(task), Date.now());
  try {
    return await isMerged(task);
  } catch {
    return false;
  }
}

function markWaiting(task, branch) {
  if (task.cleanup_kind === "waiting") return;
  record(task, `Worktree kept: ${branch} isn't on main`, "waiting");
}

async function launch(task, place) {
  const part = task.partOf ? ["--subproject", task.subproject_id] : [];
  const args = [scriptPath(), "--task", task.id, ...part, "--repo", place.repo, "--path", place.path, "--branch", place.branch];
  const result = await exec("sh", ["-c", LAUNCH, "sh", logPath(), ...args]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "couldn't start task-cleanup");
  running = { key: partKey(task), at: Date.now() };
}

// Returns true when it started a run, so a pass handles one task at a time.
async function cleanTask(task) {
  const place = taskPlace(task);
  if (!place) return false;
  if (!(await mergedNow(task))) {
    markWaiting(task, place.branch);
    return false;
  }
  if (liveSession(task)) return false;
  try {
    await launch(task, place);
  } catch (error) {
    record(task, `Worktree kept: ${error.message ?? error}`, "kept");
  }
  return true;
}

export async function runCleanup() {
  closeFinishedSessions();
  const machine = self();
  if (!machine || stillRunning()) return;
  for (const task of candidates(machine)) {
    if (await cleanTask(task)) return;
  }
}
