// The agents installed on each machine, remembered in shared state for every popup and dialog.
import { knownAgents, shared, setShared } from "herdr";
import { execTarget } from "./machines.js";

const AGENTS_KEY = "projects.agents";

export const agentsOn = (machine) => shared(AGENTS_KEY)?.[machine] ?? [];

export async function loadAgents(machine) {
  const list = (await knownAgents({ on: execTarget(machine) })).filter((a) => a.installed);
  setShared(AGENTS_KEY, { ...(shared(AGENTS_KEY) ?? {}), [machine]: list });
  return list;
}
