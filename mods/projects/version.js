// Keeps this machine on the latest deploy: compares the mod's VERSION stamp with the newest
// row in deployments and, when behind, pulls this machine's clone and deploys it here only.
// The catch-up runs detached because the deploy replaces this mod's files, which reloads it.
import { readTextFile, appHome, home, exec, shared, setShared } from "herdr";
import { sql } from "./db.js";

const KEY = "projects.version";
const PENDING_KEY = "version.pending";
const UPDATED_KEY = "version.updated";
const PENDING_TIMEOUT = 180000;
const UPDATED_NOTICE = 15 * 60000;

const clonePath = () => `${home()}/git/herdr-projects`;
const logPath = () => `${home()}/.cache/herdr-projects/catch-up.log`;

const CATCH_UP = `
mkdir -p "$(dirname "$3")"
(
  cd "$1" || exit 1
  branch="$(git symbolic-ref --quiet --short HEAD)"
  [ "$branch" = main ] || { echo "$1 is on \${branch:-a detached HEAD}, not main"; exit 1; }
  git pull --ff-only --quiet origin main || exit 1
  head="$(git rev-parse HEAD)"
  [ "$head" = "$2" ] || { echo "$1 is at \${head%\${head#???????}} after pulling"; exit 1; }
  scripts/deploy --local
) > "$3" 2>&1
echo "exit $?" >> "$3"
`;

export const shortSha = (sha) => String(sha ?? "").slice(0, 7);

export function versionState() {
  return shared(KEY) ?? { running: null, latest: null, updating: null, updated: null, error: null };
}

const load = (key) => JSON.parse(localStorage.getItem(key) ?? "null");
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

async function readVersion() {
  const text = await readTextFile(`${appHome()}/mods/projects/VERSION`);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function latestDeploy() {
  const [row] = await sql("select sha, deployed_by, extract(epoch from deployed_at) * 1000 as at from deployments order by id desc limit 1");
  return row ? { sha: row.sha, by: row.deployed_by, at: Number(row.at) } : null;
}

// The outcome of the last detached catch-up: null while it runs, else its exit and last words.
async function catchUpResult() {
  const text = await readTextFile(logPath());
  const lines = (text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const exit = lines.at(-1)?.match(/^exit (\d+)$/);
  if (!exit) return null;
  return { ok: exit[1] === "0", message: lines.at(-2) ?? "Catch-up failed" };
}

async function startCatchUp(sha) {
  save(PENDING_KEY, { sha, at: Date.now() });
  await exec("sh", ["-c", "rm -f \"$3\"; nohup sh -c \"$4\" catch-up \"$1\" \"$2\" \"$3\" >/dev/null 2>&1 &", "sh", clonePath(), sha, logPath(), CATCH_UP]);
}

// What a running or finished catch-up means now: still running, done, or an error.
async function settlePending(running) {
  const pending = load(PENDING_KEY);
  if (!pending) return {};
  if (running?.sha === pending.sha) {
    localStorage.removeItem(PENDING_KEY);
    save(UPDATED_KEY, { sha: pending.sha, at: Date.now() });
    return {};
  }
  const result = await catchUpResult();
  if (result && !result.ok) {
    localStorage.removeItem(PENDING_KEY);
    return { error: result.message };
  }
  if (Date.now() - pending.at > PENDING_TIMEOUT) {
    localStorage.removeItem(PENDING_KEY);
    return { error: "Catch-up timed out" };
  }
  return { pending: pending.sha };
}

function recentUpdate(running) {
  const updated = load(UPDATED_KEY);
  if (!updated || updated.sha !== running?.sha || Date.now() - updated.at > UPDATED_NOTICE) return null;
  return updated.sha;
}

let checking = false;

export const isUpdating = () => Boolean(versionState().updating);

// Compares, starts a catch-up when behind and nothing is running, and publishes the state.
// Without the board there is nothing to compare against, so it only reports what's running.
export async function keepCurrent() {
  if (checking) return;
  checking = true;
  try {
    const running = await readVersion();
    let latest = null;
    try {
      latest = await latestDeploy();
    } catch {
      setShared(KEY, { ...versionState(), running, latest: null, updating: null, updated: recentUpdate(running) });
      return;
    }
    const settled = await settlePending(running);
    const behind = Boolean(latest) && latest.sha !== running?.sha;
    const previousError = versionState().error;
    const start = behind && !settled.pending && !settled.error && !previousError;
    if (start) await startCatchUp(latest.sha);
    const updating = settled.pending ?? (start ? latest.sha : null);
    const error = behind && !updating ? settled.error ?? previousError : null;
    setShared(KEY, { running, latest, updating, updated: recentUpdate(running), error });
  } catch (error) {
    setShared(KEY, { ...versionState(), updating: null, error: String(error.message ?? error) });
  } finally {
    checking = false;
  }
}

// A failed catch-up waits for this (the window coming forward, or a click) before trying again.
export function clearVersionError() {
  setShared(KEY, { ...versionState(), error: null });
}

export function retryCatchUp() {
  clearVersionError();
  return keepCurrent();
}
