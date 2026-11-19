// Whether this window is in front, for bin/herdr-presence, which the Pi asks before a phone
// alert. Written on every change and every 30 s, so a file older than that means the window
// is closed.
import { exec } from "herdr";

const HEARTBEAT_MS = 30000;
const WRITE_SCRIPT = `dir="$HOME/.cache/herdr-projects"
mkdir -p "$dir" && printf '%s' "$1" > "$dir/window.json.tmp" && mv "$dir/window.json.tmp" "$dir/window.json"`;

let written = { active: null, at: 0 };

export async function recordWindow(active) {
  const now = Date.now();
  if (active === written.active && now - written.at < HEARTBEAT_MS) return;
  written = { active, at: now };
  const result = await exec("sh", ["-c", WRITE_SCRIPT, "sh", JSON.stringify({ active, at_ms: now })]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `exit ${result.code}`);
}

// A failed write is retried on the next tick instead of waiting out the heartbeat.
export function forgetWindowWrite() {
  written = { active: null, at: 0 };
}
