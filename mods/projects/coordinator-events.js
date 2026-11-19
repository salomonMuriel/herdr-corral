// What the board tells a coordinator about its project: a task's agent asked, a task reached
// Review or Done, a start failed, or one of its workers is blocked or stopped without
// reporting. Each moment has a key, so it is told once.
const BLOCKED_AFTER_MS = 60000;
const QUIET_AFTER_MS = 180000;
const REMEMBERED = 400;
const ASK_LABEL = { plan: "a plan approval", question: "a question", permission: "a permission prompt" };

const name = (task) => `${task.title} (${task.id})`;
const agentHint = (s) => (s?.terminal ? ` Agent ${s.terminal}.` : "");

function taskMoments(task, session) {
  const moments = [];
  const at = task.reported_at ?? 0;
  if (task.status === "review") moments.push([`review:${task.id}:${at}`, `${name(task)} is in Review and waits for the person.${task.report ? ` It reported: ${task.report}` : ""}`]);
  if (task.status === "done") moments.push([`done:${task.id}:${at}`, `${name(task)} is Done.${task.report ? ` ${task.report}` : ""}`]);
  if (task.report_kind === "ask" && task.status !== "done" && task.report) {
    moments.push([`ask:${task.id}:${at}`, `${name(task)} asks: ${task.report}${agentHint(session)}`]);
  }
  return moments;
}

function workerMoments(s, now) {
  const task = s.task;
  const since = s.statusAt ?? 0;
  if (s.agentStatus === "blocked" && now - since >= BLOCKED_AFTER_MS) {
    return [[`blocked:${s.terminal}:${since}`, `${name(task)} is blocked on ${ASK_LABEL[s.ask] ?? "a prompt"}. Read it with hc read ${s.terminal}.`]];
  }
  const quiet = s.waiting && task.status === "doing" && now - since >= QUIET_AFTER_MS && (task.reported_at ?? 0) < since;
  if (quiet) return [[`quiet:${s.terminal}:${s.turn ?? 0}`, `${name(task)} stopped at its prompt without hb done or hb ask. Read it with hc read ${s.terminal}.`]];
  return [];
}

// Every moment in the project now, as [key, line].
export function momentsOf(projectId, tasks, sessions, now = Date.now()) {
  const sessionOf = new Map(sessions.filter((s) => s.task).map((s) => [s.task.id, s]));
  const moments = tasks.filter((t) => t.project_id === projectId).flatMap((t) => taskMoments(t, sessionOf.get(t.id)));
  for (const s of sessions) {
    if (s.coordinated && s.task?.project_id === projectId && s.terminal) moments.push(...workerMoments(s, now));
  }
  return moments;
}

// The lines for moments not seen before, and the keys to remember. With nothing remembered
// yet, everything present counts as seen, so a new coordinator starts from a quiet board.
// Keys stay remembered after their moment passes, so a session that briefly drops out of
// the list isn't told twice.
export function newMoments(moments, seen) {
  const keys = moments.map(([key]) => key);
  if (!seen) return { lines: [], seen: keys };
  const known = new Set(seen);
  const present = new Set(keys);
  const passed = seen.filter((key) => !present.has(key)).slice(-REMEMBERED);
  return { lines: moments.filter(([key]) => !known.has(key)).map(([, line]) => line), seen: [...passed, ...keys] };
}
