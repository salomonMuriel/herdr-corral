// Open pull requests and their CI per repo, asked of gh at most every 5 minutes.
import { exec } from "herdr";
import { data } from "./store.js";
import { execTarget, repoPath, self } from "./machines.js";

const FRESH_MS = 5 * 60 * 1000;
const FIELDS = "number,headRefName,isDraft,reviewDecision,mergeable,statusCheckRollup,url";
const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const PENDING = new Set(["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);

const byRepo = new Map();
const asking = new Set();

const branchOf = (s) => s.branch ?? s.task?.branch ?? null;

function checkState(check) {
  const value = check.conclusion || check.state || check.status || "";
  if (FAILED.has(value)) return "fail";
  if (PENDING.has(value) || (check.status && check.status !== "COMPLETED")) return "pending";
  return "pass";
}

export function ciOf(checks) {
  if (!checks?.length) return null;
  const states = checks.map(checkState);
  if (states.includes("fail")) return "fail";
  if (states.includes("pending")) return "pending";
  return "pass";
}

function summarize(pr) {
  return {
    number: pr.number, branch: pr.headRefName, draft: pr.isDraft, url: pr.url,
    ci: ciOf(pr.statusCheckRollup),
    changesRequested: pr.reviewDecision === "CHANGES_REQUESTED",
    conflicts: pr.mergeable === "CONFLICTING",
  };
}

const isCloned = async (folder) => (await exec("test", ["-d", folder])).code === 0;

// Asked on this machine when the repo is cloned here, else on the session's.
async function whereToAsk(sp, machine) {
  const local = repoPath(sp, self());
  if (local && (await isCloned(local))) return { repo: local, on: null };
  const remote = repoPath(sp, machine);
  return remote ? { repo: remote, on: execTarget(machine) } : null;
}

async function askGh(sp, machine) {
  const where = await whereToAsk(sp, machine);
  if (!where) return { pulls: [], error: "repo path unknown" };
  const result = await exec("gh", ["pr", "list", "--state", "open", "--limit", "100", "--json", FIELDS], { cwd: where.repo, on: where.on });
  if (result.code !== 0) return { pulls: [], error: result.stderr.trim() || "gh pr list failed" };
  return { pulls: JSON.parse(result.stdout).map(summarize), error: null };
}

const isDue = (id, now) => !asking.has(id) && now - (byRepo.get(id)?.at ?? 0) > FRESH_MS;

// Refreshes the repos of sessions on a branch; calls `changed` when an answer lands.
export function refreshPulls(sessions, cx, changed) {
  const now = Date.now();
  const repos = new Map();
  for (const s of sessions) if (s.subprojectId && branchOf(s)) repos.set(s.subprojectId, s.machine);
  for (const [id, machine] of repos) {
    if (!isDue(id, now)) continue;
    const sp = data().subprojects.find((row) => row.id === id);
    if (!sp) continue;
    asking.add(id);
    cx.spawn(async (cx) => {
      try {
        byRepo.set(id, { ...(await askGh(sp, machine)), at: Date.now() });
      } catch (error) {
        byRepo.set(id, { pulls: [], error: String(error.message ?? error), at: Date.now() });
      } finally {
        asking.delete(id);
      }
      changed(cx);
    });
  }
}

export function pullOf(s) {
  const branch = branchOf(s);
  if (!s.subprojectId || !branch) return null;
  return byRepo.get(s.subprojectId)?.pulls.find((pr) => pr.branch === branch) ?? null;
}

export function startPulls(cx, listSessions) {
  refreshPulls(listSessions(), cx, (cx) => cx.notify());
  cx.timer.every(30000, (cx) => refreshPulls(listSessions(), cx, (cx) => cx.notify()));
}
