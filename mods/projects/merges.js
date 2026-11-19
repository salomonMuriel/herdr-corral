// Whether a finished task's branch has reached main, asked on the machine the branch lives on.
// A yes is kept; a no is asked again after a while, since each ask fetches origin.
import { exec } from "herdr";
import { data } from "./store.js";
import { execTarget, repoPath } from "./machines.js";
import { baseRef, branchOf } from "./worktrees.js";
import { partKey } from "./task-repos.js";

const RECHECK_MS = 90000;
const answers = new Map();

export async function isMerged(task) {
  const known = answers.get(partKey(task));
  if (known && (known.merged || Date.now() - known.at < RECHECK_MS)) return known.merged;
  const merged = await askGit(task);
  answers.set(partKey(task), { merged, at: Date.now() });
  return merged;
}

async function askGit(task) {
  const sp = data().subprojects.find((s) => s.id === task.subproject_id);
  const repo = sp ? repoPath(sp, task.machine) : null;
  if (!repo) return false;
  const on = execTarget(task.machine);
  const branch = branchOf(task);
  const git = (args) => exec("git", ["-C", repo, ...args], { on });
  // Merged branches get deleted; one that is gone has nothing left to wait for.
  const exists = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (exists.code !== 0) return true;
  const ancestor = await git(["merge-base", "--is-ancestor", branch, await baseRef(repo, task.machine)]);
  if (ancestor.code === 0) return true;
  return mergedPullRequest(repo, branch, on);
}

// Squash merges leave the branch outside main's history; GitHub still knows.
async function mergedPullRequest(repo, branch, on) {
  try {
    const result = await exec("gh", ["pr", "list", "--head", branch, "--state", "merged", "--json", "number", "--jq", "length"], { cwd: repo, on });
    return result.code === 0 && Number(result.stdout.trim()) > 0;
  } catch {
    return false;
  }
}
