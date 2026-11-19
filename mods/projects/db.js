// The board's HTTP SQL endpoint (Neon's protocol: Neon itself, or herdr-sql on the Pi): one query,
// or several in one transaction.
import { readTextFile, home, exec, shared, setShared } from "herdr";

const WROTE_KEY = "projects.wrote";
const CONFIG_PATH = () => `${home()}/.config/herdr-board/config.json`;

let configPromise = null;

export function loadConfig() {
  configPromise ??= (async () => {
    const text = await readTextFile(CONFIG_PATH());
    if (!text) throw new Error(`Board config missing at ${CONFIG_PATH()}`);
    const config = JSON.parse(text);
    const host = (await exec("hostname", [])).stdout.trim();
    config.self = config.machines?.[host] ?? config.machines?.[host.split(".")[0]] ?? host.split(".")[0];
    return config;
  })();
  configPromise.catch(() => { configPromise = null; });
  return configPromise;
}

async function post(body, headers = {}) {
  const config = await loadConfig();
  const { board } = config;
  let response;
  try {
    response = await fetch(`https://${board.host}/sql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Neon-Connection-String": board.url, ...headers },
      body: JSON.stringify(body),
    });
  } catch (error) {
    // scripts/board-failover may have pointed the config at the standby.
    configPromise = null;
    throw error;
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message ?? `Database error ${response.status}`);
  return payload;
}

export async function sql(query, params = []) {
  const result = await post({ query, params: params.map(serialize) });
  return result.rows;
}

const ACTOR_QUERY = "select set_config('herdr.actor', $1, true), set_config('herdr.machine', $2, true)";

// `actor` says who writes, for task_events: "person", "run", "review", "herdr" (the window on its own).
export async function transaction(queries, actor = null) {
  const config = await loadConfig();
  const tagged = actor ? [[ACTOR_QUERY, [actor, config.self]], ...queries] : queries;
  const result = await post(
    { queries: tagged.map(([query, params = []]) => ({ query, params: params.map(serialize) })) },
    { "Neon-Batch-Isolation-Level": "ReadCommitted" },
  );
  const rows = result.results.map((r) => r.rows);
  if (actor) markWritten();
  return actor ? rows.slice(1) : rows;
}

// A write on this machine, by the window or (through `herdr-app do projects.wrote`) by hb and
// task-cleanup. The leader tells the other windows to pull.
export const markWritten = () => setShared(WROTE_KEY, Date.now());
export const wroteAt = () => shared(WROTE_KEY) ?? 0;


function serialize(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
