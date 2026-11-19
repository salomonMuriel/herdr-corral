// Reads what an agent's own footer and transcript say about its context and mode.

// Status lines pad with non-breaking spaces, which \s matches and a plain space doesn't.
const CTX = /ctx\s+\S+\s+(\d+)%/g;
const MODE = /(⏵⏵\s+auto|⏸\s+plan)\s+mode\s+on/g;
const QUOTA = { five: /5h\s+\S+\s+(\d+)%(?:\s+↻(\S+))?/g, week: /7d\s+\S+\s+(\d+)%(?:\s+↻(\S+))?/g };
// Only the bottom of the screen is the footer; the conversation above can quote anything.
const FOOTER_LINES = 6;

const lastMatch = (text, pattern) => [...text.matchAll(pattern)].at(-1) ?? null;

function footerText(screen) {
  return screen.split("\n").filter((line) => line.trim()).slice(-FOOTER_LINES).join("\n");
}

function quotaFrom(text) {
  const five = lastMatch(text, QUOTA.five);
  const week = lastMatch(text, QUOTA.week);
  if (!five && !week) return null;
  return {
    five: five ? Number(five[1]) : null, fiveReset: five?.[2] ?? null,
    week: week ? Number(week[1]) : null, weekReset: week?.[2] ?? null,
  };
}

export function parseFooter(screen) {
  const text = footerText(screen ?? "");
  const ctx = lastMatch(text, CTX);
  const mode = lastMatch(text, MODE);
  return {
    ctx: ctx ? Number(ctx[1]) : null,
    mode: mode ? (mode[1].endsWith("auto") ? "auto" : "plan") : null,
    quota: quotaFrom(text),
  };
}

// Tokens in the context at the last main-thread reply of a Claude Code transcript tail.
export function transcriptTokens(tail) {
  const lines = (tail ?? "").split("\n").reverse();
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const usage = entry?.message?.usage;
    if (entry.type !== "assistant" || entry.isSidechain || !usage) continue;
    return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  }
  return null;
}

// Claude Code clamps a wakeup's delay to this range.
const WAKE_MIN_S = 60;
const WAKE_MAX_S = 3600;

function* entriesNewestFirst(tail) {
  for (const line of (tail ?? "").split("\n").reverse()) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch { continue; }
  }
}

const isPrompt = (entry) => entry.type === "user" && !entry.isSidechain && !entry.isMeta
  && !(Array.isArray(entry.message?.content) && entry.message.content.some((part) => part.type === "tool_result"));

// When the session's last ScheduleWakeup fires, unless the person wrote since or it was stopped.
export function scheduledWake(tail) {
  for (const entry of entriesNewestFirst(tail)) {
    if (isPrompt(entry)) return null;
    if (entry.type !== "assistant" || entry.isSidechain) continue;
    const parts = Array.isArray(entry.message?.content) ? entry.message.content : [];
    const call = parts.filter((part) => part.type === "tool_use" && part.name === "ScheduleWakeup").at(-1);
    if (!call) continue;
    if (call.input?.stop || !Number.isFinite(call.input?.delaySeconds)) return null;
    const at = Date.parse(entry.timestamp);
    const delay = Math.min(WAKE_MAX_S, Math.max(WAKE_MIN_S, call.input.delaySeconds));
    return Number.isFinite(at) ? at + delay * 1000 : null;
  }
  return null;
}
