// Agents that need the person: blocked on a prompt, or at their prompt after a turn. The
// herdr.seen and herdr.snooze terminal labels leave one out, here and on the Pi's page.
import { notify } from "herdr";
import { selectSession } from "./actions.js";

export const SEEN_LABEL = "herdr.seen";
export const SNOOZE_LABEL = "herdr.snooze";

// Done turns idle once someone looks, so both are one wait, told apart by turn. A blocked
// agent's status time tells one prompt from the next within a turn. A coordinator waits on
// the person only for the question it passed on, told apart by when it asked.
export function stateKey(s) {
  if (s.agentStatus === "blocked") return `blocked:${s.statusAt ?? 0}`;
  if (s.coordinator) return `ask:${s.coordinatorAskedAt ?? 0}`;
  return `waiting:${s.turn ?? 0}`;
}

// A live coordinator's workers go to it; it needs the person when blocked or when it asks.
function needs(s) {
  if (!s.terminal || s.coordinated) return false;
  if (s.coordinator) return s.agentStatus === "blocked" || Boolean(s.coordinatorAsk);
  return s.agentStatus === "blocked" || s.waiting;
}
const isSeen = (s) => s.labels?.[SEEN_LABEL] === stateKey(s);
const isSnoozed = (s, now) => (Number(s.labels?.[SNOOZE_LABEL]) || 0) > now;

export function waitedSince(s) {
  if (s.coordinatorAskedAt && s.agentStatus !== "blocked") return s.coordinatorAskedAt;
  return s.statusAt ?? s.since ?? null;
}

function compare(a, b) {
  const blocked = Number(b.agentStatus === "blocked") - Number(a.agentStatus === "blocked");
  return blocked || (waitedSince(a) ?? Infinity) - (waitedSince(b) ?? Infinity);
}

export function needsYou(sessions, now = Date.now()) {
  return sessions.filter((s) => needs(s) && !isSeen(s) && !isSnoozed(s, now)).sort(compare);
}

export function jumpToNext(sessions) {
  const queue = needsYou(sessions);
  if (!queue.length) return notify({ title: "Nothing needs you", timeout: 2000 });
  const at = queue.findIndex((s) => s.active);
  selectSession(queue[(at + 1) % queue.length]);
}
