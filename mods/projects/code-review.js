// Runs the code reviews that task agents ask for with hb done, each on its task's own
// machine: claims it on the board, starts agent/code_review.py detached (a review outlasts exec's
// 30 s), and when its verdict lands sends the findings to the agent or moves the task on.
import { exec, home, hc } from "herdr";
import { data, patchLocal, requestPull } from "./store.js";
import { transaction } from "./db.js";
import { self } from "./machines.js";
import { sessions } from "./model.js";
import { baseRef, taskPlace } from "./worktrees.js";
import { needsReview } from "./review.js";
import { outcome } from "./code-review-plan.js";

const STALE_MS = 45 * 60000;
const LAUNCH = 'log="$1"; shift; mkdir -p "$(dirname "$log")"; echo "== $(date)" >> "$log"; nohup "$@" >> "$log" 2>&1 < /dev/null &';

const scriptPath = () => `${home()}/.config/herdr-app/mods/projects/agent/code_review.py`;
const logPath = () => `${home()}/.cache/herdr-corral/code-review.log`;
const resultPath = (taskId, round) => `${home()}/.cache/herdr-corral/code-review/${taskId}-${round}.json`;

async function claim(task) {
  const [rows] = await transaction([[`update tasks set code_review_state = 'running', code_review_round = code_review_round + 1,
      code_review_open = null, code_review_at = now(), updated_at = now()
    where id = $1 and machine = $2 and code_review_state = 'queued' returning code_review_round`, [task.id, task.machine]]], "review");
  if (!rows.length) return null;
  const round = Number(rows[0].code_review_round);
  patchLocal("tasks", task.id, { code_review_state: "running", code_review_round: round, code_review_open: null, code_review_at: Date.now() });
  return round;
}

async function launch(task, round) {
  const place = taskPlace(task);
  if (!place) throw new Error("the task has no worktree");
  const base = await baseRef(place.repo, task.machine);
  const args = ["python3", scriptPath(), "--worktree", place.path, "--base", base, "--branch", place.branch,
    "--round", String(round), "--out", resultPath(task.id, round), `--title=${task.title}`, `--notes=${task.notes ?? ""}`];
  const result = await exec("sh", ["-c", LAUNCH, "sh", logPath(), ...args]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "couldn't start the review");
}

async function start(task) {
  const round = await claim(task);
  if (round === null) return;
  try {
    await launch(task, round);
  } catch (error) {
    await settle({ ...task, code_review_state: "running" }, round, { ok: false, error: String(error.message ?? error) });
  }
}

function parseResult(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: "the review wrote an unreadable verdict" };
  }
}

async function check(task) {
  const round = task.code_review_round;
  const read = await exec("cat", [resultPath(task.id, round)]);
  if (read.code === 0) return settle(task, round, parseResult(read.stdout));
  if (Date.now() - (task.code_review_at ?? Date.now()) < STALE_MS) return;
  await settle(task, round, { ok: false, error: `no verdict after ${STALE_MS / 60000} minutes (log in ${logPath()})` });
}

// Writes the round's outcome only if the task is still where this pass saw it, so a verdict
// is acted on once.
async function record(task, round, next) {
  const [rows] = await transaction([[`update tasks set code_review_state = $4, code_review_open = $5, code_review_findings = $6,
      code_review_at = now(), updated_at = now(),
      position = case when $7::text = 'review' and status <> 'review'
        then (select coalesce(max(r.position), -1) + 1 from tasks r where r.project_id = tasks.project_id and r.status = 'review')
        else position end,
      status = coalesce($7::text, status),
      report = coalesce($8::text, report),
      report_kind = case when $8::text is null then report_kind else 'ask' end,
      reported_at = case when $8::text is null then reported_at else now() end
    where id = $1 and code_review_round = $2 and code_review_state = $3 returning id`,
  [task.id, round, task.code_review_state, next.state, next.open, next.findings, next.status ?? null, next.report ?? null]]], "review");
  if (!rows.length) return false;
  const local = { code_review_state: next.state, code_review_open: next.open, code_review_findings: next.findings, code_review_at: Date.now() };
  if (next.status) local.status = next.status;
  if (next.report) Object.assign(local, { report: next.report, report_kind: "ask", reported_at: Date.now() });
  patchLocal("tasks", task.id, local);
  requestPull();
  return true;
}

async function settle(task, round, result) {
  const session = task.tab ? sessions().find((s) => s.id === task.tab) : null;
  const next = outcome({ result, round, needsReview: needsReview(task), hasAgent: Boolean(session?.terminal) });
  if (!(await record(task, round, next)) || !next.message) return;
  const sent = await hc(["send", session.terminal, next.message]);
  if (sent.code === 0) return;
  const reason = sent.stderr.trim() || `hc send exited with ${sent.code}`;
  await record({ ...task, code_review_state: next.state }, round,
    { state: "failed", open: next.open, findings: next.findings, status: "review", report: `Code review: couldn't tell the agent (${reason})` });
}

let busy = false;

// One pass over this machine's reviews. A task that fails doesn't hold up the others;
// the first error is thrown after the pass so the leader can say so.
export async function runCodeReviews() {
  const machine = self();
  if (!machine || busy) return;
  busy = true;
  let firstError = null;
  try {
    for (const task of data().tasks.filter((t) => t.machine === machine)) {
      try {
        if (task.code_review_state === "queued") await start(task);
        if (task.code_review_state === "running") await check(task);
      } catch (error) {
        firstError ??= error;
      }
    }
  } finally {
    busy = false;
  }
  if (firstError) throw firstError;
}
