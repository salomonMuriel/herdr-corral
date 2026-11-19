// Move to <machine> in the session menu runs scripts/handoff detached: it waits for the
// agent's turn to end and copies work between machines, which outlasts exec's 30 s. It
// writes the outcome to the card and to its log.
import { exec, home, notify } from "herdr";
import { machineInfo, machineLabel } from "./machines.js";
import { isClaudeCommand } from "./trust.js";

const scriptPath = () => `${home()}/git/herdr-projects/scripts/handoff`;
const logPath = () => `${home()}/.cache/herdr-projects/handoff.log`;

const LAUNCH = 'log="$1"; shift; mkdir -p "$(dirname "$log")"; echo "== $(date) $2 to $3" >> "$log"; nohup "$@" >> "$log" 2>&1 &';

const isClaude = (s) => s.app === "claude-code" || isClaudeCommand(s.program?.name);

// Claude Code moves with its conversation; another agent needs a task to leave its summary on.
export function moveTargets(s) {
  if (!s.terminal || !(s.program?.agent || s.app)) return [];
  if (!isClaude(s) && !s.task) return [];
  return (machineInfo().names ?? []).filter((m) => m && m !== s.machine);
}

export async function moveSession(s, machine) {
  const result = await exec("sh", ["-c", LAUNCH, "sh", logPath(), scriptPath(), s.terminal, machine]);
  if (result.code !== 0) {
    notify({ title: "Couldn't move the session", body: result.stderr.trim() || "scripts/handoff didn't start", level: "error" });
    return;
  }
  notify({ title: `Moving to ${machineLabel(machine)}`, body: `${s.title} moves once its turn ends.` });
}
