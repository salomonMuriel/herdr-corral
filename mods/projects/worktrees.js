// Each task's agent works in its own git worktree, so agents on one repo never share a
// checkout. Same place and branch naming as Claude Code's own EnterWorktree.
import { exec } from "herdr";
import { data } from "./store.js";
import { execTarget, repoPath } from "./machines.js";
import { issueNumber } from "./issues.js";

export function slugFor(text) {
  const slug = String(text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return slug || "task";
}

async function git(repo, args, machine) {
  return exec("git", ["-C", repo, ...args], { on: execTarget(machine) });
}

// Where new work starts: origin's default branch, fetched just now so it is never stale.
// A repo without origin starts from its local main or master. Never the main checkout's
// current branch: another task may have it checked out.
export async function baseRef(repo, machine) {
  const origin = await git(repo, ["remote", "get-url", "origin"], machine);
  if (origin.code !== 0) return localBase(repo, machine);
  const fetched = await git(repo, ["fetch", "--quiet", "origin"], machine);
  if (fetched.code !== 0) throw new Error(`Couldn't fetch origin in ${repo}: ${fetched.stderr.trim()}`);
  const head = await git(repo, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], machine);
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim();
  for (const name of ["origin/main", "origin/master"]) {
    const remote = await git(repo, ["rev-parse", "--verify", "--quiet", `refs/remotes/${name}`], machine);
    if (remote.code === 0) return name;
  }
  throw new Error(`origin has no main or master branch in ${repo}`);
}

async function localBase(repo, machine) {
  for (const name of ["main", "master"]) {
    const local = await git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], machine);
    if (local.code === 0) return name;
  }
  throw new Error(`No main or master branch in ${repo}`);
}

// A task from a GitHub issue is named after the issue, which is unique within its repo.
function worktreeName(task) {
  const issue = issueNumber(task.issue_url);
  return issue ? `issue-${issue}-${slugFor(task.title)}` : `${slugFor(task.title)}-${task.id.slice(-4)}`;
}

// The branch an agent worked on: recorded when it started, else what taskWorktree names it.
export const branchOf = (task) => task.branch ?? `worktree-${worktreeName(task)}`;

// Where a started task's worktree is on its machine, or null when it has no repo or branch.
export function taskPlace(task) {
  const sp = data().subprojects.find((s) => s.id === task.subproject_id);
  const repo = sp ? repoPath(sp, task.machine) : null;
  if (!repo || !task.branch) return null;
  return { repo, branch: task.branch, path: `${repo}/.claude/worktrees/${task.branch.replace(/^worktree-/, "")}` };
}

// Returns { path, branch } for the task's worktree, making it on first use. `from` is a
// branch to stack on instead of the default branch.
export async function taskWorktree(repo, task, machine, from = null) {
  const name = worktreeName(task);
  const path = `${repo}/.claude/worktrees/${name}`;
  const branch = `worktree-${name}`;
  const there = await exec("test", ["-d", path], { on: execTarget(machine) });
  if (there.code === 0) return { path, branch };
  const known = await git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], machine);
  const args = known.code === 0
    ? ["worktree", "add", path, branch]
    : ["worktree", "add", "--no-track", "-b", branch, path, from ?? await baseRef(repo, machine)];
  const made = await git(repo, args, machine);
  if (made.code !== 0) throw new Error(made.stderr.trim() || "git worktree add failed");
  return { path, branch };
}

export function worktreeNote({ path, branch }) {
  return `You are in this task's own git worktree (${path}, branch ${branch}). Work and commit only here: don't create another worktree and don't switch branches in the main checkout. Other agents are working in the same repo at the same time.`;
}

// The worktree a session works in, read from its folder (`.claude/worktrees/<name>`).
export function worktreeOf(cwd) {
  return /\/\.claude\/worktrees\/([^/]+)/.exec(cwd ?? "")?.[1] ?? null;
}
