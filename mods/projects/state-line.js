// Context %, mode and account quota per agent, read from the footer its own status line
// draws, and a pending wakeup from its transcript. Read again when its status or turn
// changes, and every 20 s while it works on screen.
import { hc, exec } from "herdr";
import { execTarget } from "./machines.js";
import { parseFooter, transcriptTokens, scheduledWake } from "./footer.js";

const WORKING_EVERY_MS = 20000;
const CHECK_EVERY_MS = 2000;
const TOKENS_TAIL_BYTES = 300000;
// Enough for the last turn, where a ScheduleWakeup call sits.
const WAKE_TAIL_BYTES = 60000;
// A folder with more than one live transcript can't tell which session is which.
const TRANSCRIPT_SCRIPT = `cd "$HOME/.claude/projects/$1" 2>/dev/null || exit 0
recent=$(find . -maxdepth 1 -name '*.jsonl' -mmin -60)
[ "$(printf '%s\\n' "$recent" | grep -c .)" -eq 1 ] || exit 0
tail -c "$2" "$recent"`;

const readings = new Map();
const reading = new Set();
let shownNow = new Set();
let quota = null;

export const stateOf = (address) => readings.get(address) ?? null;
export const latestQuota = () => quota;

export function beginShown() {
  shownNow = new Set();
}

export function markShown(address) {
  if (address) shownNow.add(address);
}

const changeKey = (session) => `${session.agentStatus}:${session.turn}`;

function isDue(session, now) {
  const last = readings.get(session.terminal);
  if (!last) return true;
  if (last.key !== changeKey(session)) return true;
  return session.agentStatus === "working" && shownNow.has(session.terminal) && now - last.at > WORKING_EVERY_MS;
}

const slugOf = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, "-");

async function readTranscript(session, bytes) {
  const result = await exec("sh", ["-c", TRANSCRIPT_SCRIPT, "sh", slugOf(session.cwd), String(bytes)], { on: execTarget(session.machine) });
  if (result.code !== 0) throw new Error(result.stderr.trim() || "reading the transcript failed");
  return result.stdout;
}

// Tokens only when the footer has no context figure; a wakeup only matters while idle.
async function readFromTranscript(session, footer) {
  const needsTokens = footer.ctx === null;
  const needsWake = session.agentStatus !== "working";
  if (session.app !== "claude-code" || !session.cwd || (!needsTokens && !needsWake)) return { tokens: null, wakeAt: null };
  const tail = await readTranscript(session, needsTokens ? TOKENS_TAIL_BYTES : WAKE_TAIL_BYTES);
  return { tokens: needsTokens ? transcriptTokens(tail) : null, wakeAt: needsWake ? scheduledWake(tail) : null };
}

async function readFooter(session) {
  const result = await hc(["read", session.terminal, "--lines", "0"]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `hc read ${session.terminal} failed`);
  return parseFooter(result.stdout);
}

async function readOne(session) {
  const key = changeKey(session);
  const footer = await readFooter(session);
  const fresh = { ctx: footer.ctx, tokens: null, wakeAt: null, mode: footer.mode, key, at: Date.now() };
  try {
    Object.assign(fresh, await readFromTranscript(session, footer));
  } catch (error) {
    fresh.error = String(error.message ?? error);
  }
  readings.set(session.terminal, fresh);
  if (footer.quota) quota = { ...footer.quota, machine: session.machine, at: Date.now() };
}

// Reads every agent session that is due; calls `changed` after each reading lands.
export function refreshStateLines(sessions, cx, changed) {
  const now = Date.now();
  const live = new Set(sessions.map((s) => s.terminal));
  for (const address of readings.keys()) if (!live.has(address)) readings.delete(address);
  for (const session of sessions) {
    if (!session.terminal || !session.app || reading.has(session.terminal) || !isDue(session, now)) continue;
    reading.add(session.terminal);
    cx.spawn(async (cx) => {
      try {
        await readOne(session);
      } catch (error) {
        readings.set(session.terminal, { ctx: null, tokens: null, wakeAt: null, mode: null, key: changeKey(session), at: Date.now(), error: String(error.message ?? error) });
      } finally {
        reading.delete(session.terminal);
      }
      changed(cx);
    });
  }
}

export function startStateLines(cx, listSessions) {
  cx.timer.every(CHECK_EVERY_MS, (cx) => refreshStateLines(listSessions(), cx, (cx) => cx.notify()));
}
