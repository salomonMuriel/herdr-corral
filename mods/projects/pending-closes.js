// Herdr refuses tab commands while the tab's machine is offline, so a close picked then
// hides the session at once and runs when that machine answers again.
import { shared, setShared, machines, spaces, run } from "herdr";
import { self } from "./machines.js";

const KEY = "projects.pendingCloses";

const pendingCloses = () => shared(KEY) ?? [];

function reachable(machine) {
  if (machine === self()) return true;
  return machines().find((m) => m.name === machine)?.layout === "ready";
}

export const isClosing = (tabId) => pendingCloses().some((p) => p.tabId === tabId);

export function closeSession(session) {
  if (reachable(session.machine)) {
    run("tab.close", { id: session.tabId });
    return;
  }
  if (isClosing(session.tabId)) return;
  setShared(KEY, [...pendingCloses(), { tabId: session.tabId, machine: session.machine }]);
}

// The person already chose to close it, so Herdr's confirmation is skipped.
export function runPendingCloses() {
  const queued = pendingCloses();
  const due = queued.filter((p) => reachable(p.machine));
  if (due.length === 0) return;
  const liveTabs = new Set(spaces().flatMap((space) => space.tabs.map((tab) => tab.id)));
  const failed = [];
  for (const entry of due) {
    if (!liveTabs.has(entry.tabId)) continue;
    try {
      run("tab.close", { id: entry.tabId, confirmed: true });
    } catch {
      failed.push(entry);
    }
  }
  setShared(KEY, [...queued.filter((p) => !due.includes(p)), ...failed]);
}
