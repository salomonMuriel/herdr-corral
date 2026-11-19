// When a task imported from an issue reaches Done, its machine's window (either window when it
// never ran) posts the agent's summary on the issue. The claim on the board makes it post once.
import { exec, notify } from "herdr";
import { data, patchLocal } from "./store.js";
import { transaction } from "./db.js";
import { self } from "./machines.js";

const RETRY_MS = 10 * 60000;

const failedAt = new Map();

function due(task, machine, now) {
  if (task.status !== "done" || !task.issue_url || task.issue_commented) return false;
  if (task.machine && task.machine !== machine) return false;
  return now - (failedAt.get(task.id) ?? 0) > RETRY_MS;
}

async function claim(task) {
  const [rows] = await transaction([["update tasks set issue_commented_at = now() where id = $1 and status = 'done' and issue_commented_at is null returning report, report_kind, branch", [task.id]]], "herdr");
  return rows[0] ?? null;
}

const release = (task) => transaction([["update tasks set issue_commented_at = null where id = $1", [task.id]]], "herdr");

function commentBody({ report, report_kind: kind, branch }) {
  const summary = kind === "done" && report ? `Done: ${report}` : "Done.";
  return branch ? `${summary}\n\nBranch \`${branch}\`` : summary;
}

async function comment(task) {
  const claimed = await claim(task);
  patchLocal("tasks", task.id, { issue_commented: true });
  if (!claimed) return;
  const result = await exec("gh", ["issue", "comment", task.issue_url, "--body", commentBody(claimed)])
    .catch((error) => ({ code: 1, stderr: String(error.message ?? error) }));
  if (result.code === 0) return;
  failedAt.set(task.id, Date.now());
  await release(task);
  patchLocal("tasks", task.id, { issue_commented: false });
  notify({ title: `Couldn't comment on ${task.issue_url}`, body: result.stderr.trim() || "gh issue comment failed", level: "error" });
}

export async function commentOnDoneIssues() {
  const machine = self();
  if (!machine) return;
  const now = Date.now();
  for (const task of data().tasks.filter((t) => due(t, machine, now))) {
    try {
      await comment(task);
    } catch (error) {
      failedAt.set(task.id, Date.now());
      notify({ title: `Couldn't comment on ${task.issue_url}`, body: String(error.message ?? error), level: "error" });
    }
  }
}
