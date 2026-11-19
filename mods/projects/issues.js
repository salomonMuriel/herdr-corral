// GitHub issues as tasks: each repo's open issues from gh, imported into To do and linked by
// issue_url.
import { exec } from "herdr";
import { data, createTask } from "./store.js";
import { machineInfo, execTarget, repoPath } from "./machines.js";
import { waiverFields } from "./review.js";

const FIELDS = "number,title,body,url";
const MAX_NOTES = 4000;

export const issueNumber = (url) => /\/issues\/(\d+)/.exec(url ?? "")?.[1] ?? null;

export const taskForIssue = (projectId, url) => data().tasks.find((t) => t.project_id === projectId && t.issue_url === url) ?? null;

// The first machine, this one first, where the repo is checked out.
async function repoFolder(sp) {
  for (const machine of machineInfo().names ?? []) {
    const folder = repoPath(sp, machine);
    if (!folder) continue;
    try {
      const there = await exec("test", ["-d", folder], { on: execTarget(machine) });
      if (there.code === 0) return { folder, on: execTarget(machine) };
    } catch {
      // That machine is away; try the next one.
    }
  }
  return null;
}

export async function openIssues(sp) {
  const place = await repoFolder(sp);
  if (!place) throw new Error(`${sp.name} isn't checked out on any machine`);
  const result = await exec("gh", ["issue", "list", "--state", "open", "--limit", "100", "--json", FIELDS], { cwd: place.folder, on: place.on });
  if (result.code !== 0) throw new Error(result.stderr.trim() || "gh issue list failed");
  return JSON.parse(result.stdout).sort((a, b) => a.number - b.number);
}

export function importIssue(sp, issue) {
  const existing = taskForIssue(sp.project_id, issue.url);
  if (existing) return existing;
  const title = issue.title.trim();
  const notes = String(issue.body ?? "").trim().slice(0, MAX_NOTES);
  return createTask({ projectId: sp.project_id, subprojectId: sp.id, title, notes, review: waiverFields(title, notes, issue.url), issueUrl: issue.url });
}

export function openUrl(url) {
  return exec("sh", ["-c", 'if command -v xdg-open >/dev/null; then xdg-open "$1"; else open "$1"; fi', "sh", url]);
}

// A line of the agent's first message for a task imported from an issue.
export function issueNote(task) {
  if (!task.issue_url) return "";
  return `This task comes from GitHub issue ${task.issue_url}. Once the task is Done, your hb done summary is posted on the issue as a comment.`;
}
