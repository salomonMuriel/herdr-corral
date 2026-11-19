// Why a Ready run task hasn't started. The leader of the run's machine writes every reason to
// shared state, which only that machine sees; elsewhere the slot reasons come from the board.
import { shared, setShared } from "herdr";
import { busy, slotsFor, PER_REPO } from "./chain.js";
import { waitingOn } from "./deps.js";
import { machineLabel, self } from "./machines.js";

const WAITS_KEY = "projects.autostart";

export function slotWait(task, machine) {
  if (busy((t) => t.machine === machine) >= slotsFor(machine)) return `Queued: ${machineLabel(machine)} is full`;
  if (busy((t) => t.subproject_id === task.subproject_id) >= PER_REPO) return "Queued: repo is full";
  return null;
}

const isReady = (task) => Boolean(task.subproject_id) && waitingOn(task.id).length === 0;

export function autoStartWait(task, run) {
  if (run.machine === self()) return shared(WAITS_KEY)?.[task.id] ?? null;
  return isReady(task) ? slotWait(task, run.machine) : null;
}

export const setAutoStartWaits = (waits) => setShared(WAITS_KEY, waits);
