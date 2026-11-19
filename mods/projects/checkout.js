// A repo missing on the machine a session starts on is cloned there, from the origin of a
// machine that has it checked out.
import { exec, hc, notify } from "herdr";
import { machineInfo, repoPath, execTarget, machineLabel } from "./machines.js";

const CLONE_LIMIT_MS = 10 * 60 * 1000;
// A clone outlasts exec's 30 s, and exec ends whatever it started, so the clone runs as its
// own hc terminal and leaves its exit code beside its log.
const CLONE = `mkdir -p "$(dirname "$2")" "$(dirname "$3")"; GIT_TERMINAL_PROMPT=0 git clone "$1" "$2" > "$3" 2>&1; echo $? > "$3.exit"`;
// Prints the exit code and the log's last line once the clone ends, waiting at most 25 s.
const WAIT = `for i in $(seq 1 25); do if [ -f "$1.exit" ]; then cat "$1.exit"; tail -n 1 "$1"; exit 0; fi; sleep 1; done`;

async function isFolder(folder, machine) {
  const result = await exec("test", ["-d", folder], { on: execTarget(machine) });
  return result.code === 0;
}

async function originUrl(subproject, machine) {
  for (const other of machineInfo().names ?? []) {
    const folder = other === machine ? null : repoPath(subproject, other);
    if (!folder) continue;
    try {
      const result = await exec("git", ["-C", folder, "remote", "get-url", "origin"], { on: execTarget(other) });
      if (result.code === 0 && result.stdout.trim()) return result.stdout.trim();
    } catch {
      // That machine is away: the next one may have it.
    }
  }
  return null;
}

async function startClone(url, folder, log, machine) {
  const on = execTarget(machine);
  const home = machineInfo().homes?.[machine];
  const where = [...(on ? ["--on", on] : []), ...(home ? ["--cwd", home] : [])];
  await exec("rm", ["-f", `${log}.exit`], { on });
  const result = await hc(["run", "--bg", "--no-parent", "--rm", ...where, "--", "sh", "-c", CLONE, "sh", url, folder, log]);
  if (result.code !== 0) throw new Error(`Couldn't start cloning ${url}: ${result.stderr.trim() || `hc exited with ${result.code}`}`);
}

async function cloneOn(url, folder, machine) {
  const home = machineInfo().homes?.[machine];
  if (!home) throw new Error(`${machineLabel(machine)}'s home folder isn't known yet`);
  const log = `${home}/.cache/herdr-projects/clone-${folder.split("/").filter(Boolean).pop()}.log`;
  await startClone(url, folder, log, machine);
  const started = Date.now();
  while (Date.now() - started < CLONE_LIMIT_MS) {
    const result = await exec("sh", ["-c", WAIT, "sh", log], { on: execTarget(machine) });
    const [code, message] = result.stdout.trim().split("\n");
    if (code === "0") return;
    if (code) throw new Error(`Couldn't clone ${url}: ${message ?? `git exited with ${code}`}`);
  }
  throw new Error(`Cloning ${url} took over 10 minutes`);
}

export async function ensureCheckout(subproject, machine, folder) {
  if (await isFolder(folder, machine)) return;
  const url = await originUrl(subproject, machine);
  if (!url) throw new Error(`${subproject.name} isn't on ${machineLabel(machine)}, and no other machine has a remote to clone it from`);
  notify({ title: `Cloning ${subproject.name} on ${machineLabel(machine)}`, level: "info" });
  await cloneOn(url, folder, machine);
}
