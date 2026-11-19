// When the person last left: the start of the latest stretch of at least 30 minutes with this
// window in the background or closed. The Today view lists what changed since then.
import { shared, setShared } from "herdr";

const SEEN_KEY = "projects.lastSeen";
const LEFT_KEY = "projects.leftAt";
const AWAY_MS = 30 * 60000;
const WRITE_EVERY_MS = 30000;

export function notePresence(active, now = Date.now()) {
  if (!active) return;
  const lastSeen = shared(SEEN_KEY) ?? 0;
  if (lastSeen && now - lastSeen >= AWAY_MS) setShared(LEFT_KEY, lastSeen);
  if (now - lastSeen >= WRITE_EVERY_MS) setShared(SEEN_KEY, now);
}

function startOfToday(now = Date.now()) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export const leftAt = () => shared(LEFT_KEY) ?? startOfToday();
