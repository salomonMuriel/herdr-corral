// Machine names as every window agrees on them ("laptop", "desk"), not as each
// window addresses them (null for itself, a prefix on ids from elsewhere).
import { shared, setShared, machines, home, exec } from "herdr";
import { loadConfig } from "./db.js";

const KEY = "projects.machines";

export function machineInfo() {
  return shared(KEY) ?? { self: null, labels: {}, homes: {}, names: [], slots: {} };
}

export async function refreshMachines() {
  const config = await loadConfig();
  const remotes = machines().map((m) => m.name).filter(Boolean);
  const homes = { ...(machineInfo().homes ?? {}), [config.self]: home() };
  for (const name of remotes) {
    if (homes[name]) continue;
    try {
      const result = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: name });
      if (result.code === 0) homes[name] = result.stdout.trim();
    } catch {
      // Unreachable right now: its default repo paths stay unknown until it answers.
    }
  }
  const slots = Object.fromEntries(Object.entries(config.hosts ?? {}).filter(([, h]) => h?.slots).map(([n, h]) => [n, h.slots]));
  setShared(KEY, { self: config.self, labels: config.labels ?? {}, homes, names: [config.self, ...remotes], slots });
}

export const self = () => machineInfo().self;

// "desk/tb12" stays; "tb12" (this window's own) becomes "laptop/tb12".
export function canonical(id) {
  if (!id) return id;
  return id.includes("/") ? id : `${self()}/${id}`;
}

export const machineOf = (space) => space.machine ?? self();
// What herdr's own `machine` / `on` arguments want for a machine name.
export const machineArg = (name) => (name === self() ? "" : name);
export const execTarget = (name) => (name === self() ? null : name);
export const machineLabel = (name) => machineInfo().labels?.[name] ?? name ?? "";

// "~/git/acme/frontend" is the repo "acme/frontend"; a folder outside ~/git
// goes by its last segment.
export function repoNameOf(folder, machine) {
  const base = machineInfo().homes?.[machine];
  const prefix = base ? `${base}/git/` : null;
  if (prefix && folder.startsWith(prefix)) return folder.slice(prefix.length).replace(/\/+$/, "");
  return folder.split("/").filter(Boolean).pop();
}

export function repoPath(subproject, machine) {
  const explicit = subproject.paths?.[machine];
  if (explicit) return explicit;
  const base = machineInfo().homes?.[machine];
  return base && subproject.repo ? `${base}/git/${subproject.repo}` : null;
}
