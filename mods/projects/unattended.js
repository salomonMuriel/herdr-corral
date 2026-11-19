// Agents a run starts can't wait for answers: Claude Code gets the run guard as a
// PreToolUse hook, which settles every permission question itself, and the first message
// tells the agent to decide instead of asking.
import { machineInfo } from "./machines.js";
import { isClaudeCode } from "./trust.js";

const GUARD = ".config/herdr-app/mods/projects/agent/run_guard.py";

function guarded(agent, machine, mode) {
  const home = machineInfo().homes?.[machine];
  if (!agent || !home || !isClaudeCode(agent)) return agent;
  const command = `python3 ${home}/${GUARD}${mode ? ` ${mode}` : ""}`;
  const settings = { hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command }] }] } };
  return { ...agent, run: [...agent.run, "--settings", JSON.stringify(settings)] };
}

export const unattendedAgent = (agent, machine) => guarded(agent, machine, "");

// A coordinator never writes code: the guard's --coordinator mode refuses edits and git writes.
export const coordinatorAgent = (agent, machine) => guarded(agent, machine, "--coordinator");

export const UNATTENDED_NOTE = "This is an unattended run: nobody is watching to answer questions or prompts. Don't stop to ask. Make the reasonable call, record it with hb note, and list the assumptions you made in your hb done summary. Use hb ask only when you truly can't continue (a missing credential or access), and keep going on anything else you can. A guard refuses running a deploy (editing or testing deploy code is fine), force pushes, deletes outside your worktree and changes to shared config; when it refuses something, take another route or leave it for the person and say so in hb done.";
