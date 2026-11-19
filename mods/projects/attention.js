// Whether an agent sits at its prompt waiting for the person. Herdr's "done" only covers
// finishes nobody watched, so this reads the core's turn counter, which goes up every
// time the agent stops working.
import { terminals } from "herdr";

// A fresh agent sits idle briefly before its launch task starts it working.
const STARTUP_QUIET_MS = 15000;

export function terminalsByAddress() {
  return new Map(terminals().map((terminal) => [terminal.address, terminal]));
}

export function waitingOnYou(terminal, now = Date.now()) {
  if (!terminal) return false;
  if (terminal.status !== "idle" && terminal.status !== "done") return false;
  if (terminal.turn > 0) return true;
  return now - (terminal.status_ms ?? 0) > STARTUP_QUIET_MS;
}

// What a blocked agent waits on, from the herdr.ask label bin/herdr-ask sets. The label can
// outlive a denied prompt, so it only counts while the agent is blocked.
export function askOf(terminal) {
  if (terminal?.status !== "blocked") return null;
  return terminal.labels?.["herdr.ask"] || null;
}
