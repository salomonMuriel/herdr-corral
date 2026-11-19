// Claude Code stops at its folder trust prompt before the first turn in a folder it
// doesn't trust. It trusts a worktree when the repo's main checkout is trusted (the
// record is keyed by that path), so a task's worktree needs no record of its own.
import { exec, hc } from "herdr";
import { execTarget } from "./machines.js";

export const TRUST_WAIT = "Waiting for folder trust";

const TRUST_PROMPT = /trust this folder|Do you trust the files in this folder/;
// The prompt fills the bottom of the screen; higher up it could be text an agent printed.
const PROMPT_LINES = 12;
const CONFIG_SCRIPT = 'cat "${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json"';

export const isClaudeCommand = (command) => /(^|\/)claude$/.test(command ?? "");
export const isClaudeCode = (agent) => isClaudeCommand(agent?.run?.[0]);

async function mainCheckout(folder, machine) {
  const result = await exec("git", ["-C", folder, "rev-parse", "--path-format=absolute", "--git-common-dir"], { on: execTarget(machine) });
  if (result.code !== 0) return folder;
  return result.stdout.trim().replace(/\/\.git\/?$/, "");
}

// true or false as Claude Code would decide it on that machine, null when its config
// can't be read.
export async function repoTrusted(folder, machine) {
  const result = await exec("sh", ["-c", CONFIG_SCRIPT], { on: execTarget(machine) });
  if (result.code !== 0) return null;
  let config;
  try {
    config = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  const root = await mainCheckout(folder, machine);
  return config.projects?.[root]?.hasTrustDialogAccepted === true;
}

export async function showsTrustPrompt(terminal) {
  const result = await hc(["read", terminal, "--lines", "0"]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `hc read ${terminal} failed`);
  const bottom = result.stdout.split("\n").filter((line) => line.trim()).slice(-PROMPT_LINES);
  return bottom.some((line) => TRUST_PROMPT.test(line));
}
