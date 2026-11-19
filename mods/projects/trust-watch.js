// Catches a task agent stuck at Claude Code's folder trust prompt: still on turn 0 a few
// minutes after it appeared, not working, with the prompt on screen. Its card says so
// until the prompt is gone. Each window watches only its own machine's agents.
import { self } from "./machines.js";
import { setReport } from "./store.js";
import { TRUST_WAIT, showsTrustPrompt } from "./trust.js";

const CHECK_EVERY_MS = 30000;
const STUCK_AFTER_MS = 120000;
// A card flagged at start waits this long before a screen without the prompt clears it.
const DRAWN_AFTER_MS = 20000;

const firstSeen = new Map();
const pastStartup = new Set();
let checking = false;

function forget(liveTerminals) {
  for (const terminal of firstSeen.keys()) {
    if (liveTerminals.has(terminal)) continue;
    firstSeen.delete(terminal);
    pastStartup.delete(terminal);
  }
}

function due(session, age) {
  if (session.task.report === TRUST_WAIT) return age >= DRAWN_AFTER_MS;
  if (session.task.status !== "doing" || pastStartup.has(session.terminal)) return false;
  if (session.turn || session.agentStatus === "working") return false;
  return age >= STUCK_AFTER_MS;
}

async function checkOne(session) {
  const flagged = session.task.report === TRUST_WAIT;
  const prompt = await showsTrustPrompt(session.terminal);
  if (!prompt) pastStartup.add(session.terminal);
  if (prompt && !flagged) await setReport(session.task.id, TRUST_WAIT, "ask", "herdr");
  if (!prompt && flagged) await setReport(session.task.id, null, null, "herdr");
}

export async function checkTrust(sessions) {
  const now = Date.now();
  const mine = sessions.filter((s) => s.task && s.terminal && s.machine === self());
  forget(new Set(mine.map((s) => s.terminal)));
  for (const session of mine) {
    if (!firstSeen.has(session.terminal)) firstSeen.set(session.terminal, now);
    if (!due(session, now - firstSeen.get(session.terminal))) continue;
    try {
      await checkOne(session);
    } catch {
      // The terminal closed between listing and reading; the next pass forgets it.
    }
  }
}

export function startTrustWatch(cx, listSessions) {
  cx.timer.every(CHECK_EVERY_MS, (cx) => {
    if (checking) return;
    checking = true;
    cx.spawn(async (cx) => {
      try {
        await checkTrust(listSessions());
      } finally {
        checking = false;
      }
      cx.notify();
    });
  });
}
