// The window of a coordinator's machine keeps it informed: it labels the coordinator's and its
// workers' terminals (so the Pi leaves the workers to it), and sends it what changed in its
// project. Messages wait while the coordinator is blocked on a prompt.
import { hc, shared, setShared } from "herdr";
import { data } from "./store.js";
import { sessions } from "./model.js";
import { self } from "./machines.js";
import { momentsOf, newMoments } from "./coordinator-events.js";
import { COORDINATOR_LABEL, COORDINATED_LABEL, BOARD_PREFIX } from "./coordinator-labels.js";
import { setLabel } from "./terminal-labels.js";

const SEEN_KEY = "projects.coordinatorSeen";
const OUTBOX_KEY = "projects.coordinatorOutbox";
const HINT = "hb board shows the board, hb tell <id> answers an agent, hb ask passes a question on to the person.";

export async function watchCoordinators() {
  const machine = self();
  if (!machine) return;
  const all = sessions();
  for (const row of (data().coordinators ?? []).filter((c) => c.machine === machine)) {
    const coordinator = all.find((s) => s.coordinator === row.project_id);
    if (!coordinator?.terminal) continue;
    await labelTerminals(row.project_id, coordinator, all);
    queueMoments(row.project_id, all);
    await deliver(row.project_id, coordinator);
  }
}

async function setLabelOnce(s, key, value) {
  if ((s.labels?.[key] ?? "") !== value) await setLabel(s.terminal, key, value);
}

async function labelTerminals(projectId, coordinator, all) {
  await setLabelOnce(coordinator, COORDINATOR_LABEL, projectId);
  for (const s of all.filter((x) => x.terminal && x.task?.project_id === projectId)) {
    if (s.coordinated) await setLabelOnce(s, COORDINATED_LABEL, projectId);
    else if (s.labels?.[COORDINATED_LABEL]) await setLabelOnce(s, COORDINATED_LABEL, "");
  }
}

function queueMoments(projectId, all) {
  const seen = shared(SEEN_KEY) ?? {};
  const { lines, seen: keys } = newMoments(momentsOf(projectId, data().tasks, all), seen[projectId]);
  setShared(SEEN_KEY, { ...seen, [projectId]: keys });
  if (!lines.length) return;
  const outbox = shared(OUTBOX_KEY) ?? {};
  setShared(OUTBOX_KEY, { ...outbox, [projectId]: [...(outbox[projectId] ?? []), ...lines] });
}

async function deliver(projectId, coordinator) {
  const lines = (shared(OUTBOX_KEY) ?? {})[projectId] ?? [];
  if (!lines.length || coordinator.agentStatus === "blocked") return;
  const result = await hc(["send", coordinator.terminal, `${BOARD_PREFIX} ${lines.join("\n")}\n(${HINT})`]);
  if (result.code !== 0) return;
  const outbox = shared(OUTBOX_KEY) ?? {};
  setShared(OUTBOX_KEY, { ...outbox, [projectId]: (outbox[projectId] ?? []).slice(lines.length) });
}
