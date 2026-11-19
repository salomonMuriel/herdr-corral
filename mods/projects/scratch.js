// Scratch sessions: an agent in a fresh folder under ~/git/scratch, outside every project,
// for one-off scripts. Under ~/git it inherits that folder's Claude Code trust.
import { exec } from "herdr";
import { machineInfo, machineLabel, execTarget } from "./machines.js";

export const SCRATCH_SPACE = "Scratch";

// Prints the folder it made: $1, or $1-2, $1-3… when that name is taken.
const MAKE_FOLDER = 'd="$1"; n=2; while [ -e "$d" ]; do d="$1-$n"; n=$((n+1)); done; mkdir -p "$d" && printf %s "$d"';

export function scratchRoot(machine) {
  const home = machineInfo().homes?.[machine];
  return home ? `${home}/git/scratch` : null;
}

export const isScratch = (cwd, machine) => {
  const root = scratchRoot(machine);
  return Boolean(root && cwd?.startsWith(`${root}/`));
};

const pad = (n) => String(n).padStart(2, "0");

function folderName(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export async function makeScratchFolder(machine) {
  const root = scratchRoot(machine);
  if (!root) throw new Error(`${machineLabel(machine)}'s home folder isn't known yet`);
  const result = await exec("sh", ["-c", MAKE_FOLDER, "sh", `${root}/${folderName(new Date())}`], { on: execTarget(machine) });
  if (result.code !== 0 || !result.stdout) throw new Error(result.stderr?.trim() || `Couldn't make a folder in ${root}`);
  return result.stdout;
}
