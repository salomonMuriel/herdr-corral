// The latest nightly cleanup the Pi ran: what it removed, what is left to review and how
// many branches each Neon project has. Read after each pull; a board without the table
// just shows no cleanup line.
import { shared, setShared } from "herdr";
import { sql } from "./db.js";

const KEY = "projects.cleanupRun";

export const NEON_INCLUDED_BRANCHES = 10;
// Runs nightly, so a day and a half without one means it stopped.
export const STALE_AFTER_MS = 36 * 3600000;

export const cleanupRun = () => shared(KEY) ?? null;

export async function refreshCleanupRun() {
  try {
    const [row] = await sql("select id, machine, extract(epoch from ran_at) * 1000 as at, removed, review, neon, skipped from cleanup_runs order by id desc limit 1");
    setShared(KEY, row ? { ...row, at: Number(row.at) } : null);
  } catch {
    // Keeps the last run it read.
  }
}

export function humanSize(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return unit < 2 ? `${Math.round(size)} ${units[unit]}` : `${size.toFixed(1)} ${units[unit]}`;
}

export const worktreeBytes = (entries) => entries.filter((e) => e.kind === "worktree").reduce((sum, e) => sum + e.size_bytes, 0);

export const isStale = (run) => Date.now() - run.at > STALE_AFTER_MS;
