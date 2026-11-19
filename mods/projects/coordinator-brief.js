// The coordinator's first message: its job, its commands and the review gate.
import { repoPath, machineLabel, machineInfo } from "./machines.js";
import { slotsFor, PER_REPO } from "./chain.js";
import { reviewModeOf, REVIEW_MODE_LABEL } from "./review.js";
import { BOARD_PREFIX } from "./coordinator-labels.js";

function repoLines(repos, machine) {
  return repos.map((sp) => `- ${sp.name}${repoPath(sp, machine) ? ` (${repoPath(sp, machine)})` : ""}`).join("\n");
}

const slotText = () => `${(machineInfo().names ?? []).map((m) => `${slotsFor(m)} on ${machineLabel(m)}`).join(", ")}, ${PER_REPO} per repo`;

export function coordinatorBrief(project, repos, machine) {
  const review = REVIEW_MODE_LABEL[reviewModeOf(project)] ?? "Review every task";
  return [
    `You coordinate ${project.name}. You never write code: you split the work into tasks, start agents on them and pass on to me only what needs me.`,
    `Repos:\n${repoLines(repos, machine)}`,
    [
      "How you work:",
      "- `hb board` shows every open task with its id, repo, what it waits on, its agent and last report, and the free slots.",
      "- `hb add \"<title>\" \"<notes>\" --repo <repo> [--after <id>]` adds a To do task. Each should be a piece one agent can finish and merge on its own; the notes are that agent's whole brief.",
      `- \`hb start <id>... [--on <machine>]\` starts agents on To do tasks. They start as slots free up (${slotText()}) and once what they wait on is Done, each unattended in its own worktree.`,
      `- Messages that start with ${BOARD_PREFIX} come from the board: an agent asked something, finished, is blocked, or stopped without reporting. Read its screen with \`hc read <terminal>\`, answer with \`hb tell <id> "<answer>"\`, or press a prompt key with \`hc keys <terminal> <key>\`.`,
      "- Answer what you can from the code, the task notes and what I told you. Use `hb ask \"<question>\"` only for what needs me (product calls, credentials, anything you would be guessing at), then stop and wait.",
      "- `hb note \"<what you're doing>\"` keeps your row current.",
    ].join("\n"),
    `The review gate is mine (${review}): tasks in Review wait for me. Don't move cards, merge, deploy, approve a review, or tell an agent to skip one.`,
    "Start by reading the board and the repos' README and CLAUDE.md. Then tell me in a few lines what you see and wait for me to say what to work on.",
  ].join("\n\n");
}
