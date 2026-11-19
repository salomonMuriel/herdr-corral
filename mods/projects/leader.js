// The sidebar copy keeps the shared data fresh. It pulls on start, when the window comes to
// the front, when another copy asks, and after any write made on this machine. Nothing pulls
// on a timer.
// After a write here (the window's own, or hb's and task-cleanup's through `projects.wrote`)
// it tells the other windows to pull.
// On start and when the window comes forward it also brings this machine to the latest deploy.
// While an active run has work on this machine it tries every minute to start what is Ready,
// reading merges from git and touching the board only to claim a task.
// Every 10 seconds it also cleans up after this machine's Done tasks, comments on the GitHub
// issues they came from, moves its code reviews along, and passes on to a coordinator what
// changed in its project, all from the last pull.
// Each pull also reads the Pi's last nightly cleanup for the sidebar.
// It records whether the window is in front, so the Pi only sends phone alerts when it isn't.
// Both windows run this, so each writes only for sessions on its own machine; jobs that
// belong to no machine run on the Pi service.
import { window, notify } from "herdr";
import { pull, pullRequestedAt, runQueuedWrites } from "./store.js";
import { wroteAt } from "./db.js";
import { refreshMachines, self } from "./machines.js";
import { nudgeOthers } from "./nudge.js";
import { ensureIcons } from "./icons.js";
import { runQueuedStarts } from "./actions.js";
import { keepCurrent, clearVersionError, isUpdating } from "./version.js";
import { runAutoStart } from "./autostart.js";
import { runCleanup } from "./cleanup.js";
import { commentOnDoneIssues } from "./issue-comments.js";
import { runCodeReviews } from "./code-review.js";
import { hasRunWorkOn } from "./runs.js";
import { runQueuedRuns } from "./run-actions.js";
import { refreshCleanupRun } from "./cleanup-runs.js";
import { recordWindow, forgetWindowWrite } from "./presence.js";
import { notePresence } from "./away.js";
import { watchCoordinators } from "./coordinator-watch.js";
import { runPendingCloses } from "./pending-closes.js";

const AUTO_START_INTERVAL = 60000;
const CLEANUP_INTERVAL = 10000;

export function startLeader(cx) {
  const state = { lastPull: 0, toldAt: wroteAt(), wasActive: false, pulling: false, autoStartError: null, codeReviewError: null, coordinatorError: null, watching: false };
  const run = (cx) => {
    if (state.pulling) return;
    state.pulling = true;
    cx.spawn(async (cx) => {
      await pull();
      state.lastPull = Date.now();
      await refreshCleanupRun();
      try { await ensureIcons(); } catch { /* the image arrives on a later pull */ }
      await autoStart(state);
      state.pulling = false;
      cx.notify();
    });
  };
  const catchUp = (cx, fresh) => {
    if (fresh) clearVersionError();
    cx.spawn(async (cx) => {
      await keepCurrent();
      cx.notify();
    });
  };
  cx.spawn(async (cx) => {
    try { await refreshMachines(); } catch { /* config missing: the sidebar says so */ }
    run(cx);
    catchUp(cx, true);
  });
  cx.timer.every(2000, (cx) => {
    const active = Boolean(window()?.active);
    notePresence(active);
    runPendingCloses();
    cx.spawn(async () => {
      try { await recordWindow(active); } catch { forgetWindowWrite(); }
    });
    const cameForward = active && !state.wasActive;
    state.wasActive = active;
    const wrote = wroteAt();
    if (wrote > state.toldAt) {
      state.toldAt = wrote;
      cx.spawn(nudgeOthers);
    }
    if (cameForward || pullRequestedAt() > state.lastPull || wrote > state.lastPull) run(cx);
    if (cameForward || isUpdating()) catchUp(cx, cameForward);
  });
  // Waiting tasks start without a pull: merges are read from git, and a claim checks the board.
  cx.timer.every(AUTO_START_INTERVAL, (cx) => {
    if (state.pulling || !hasRunWorkOn(self())) return;
    cx.spawn(async (cx) => {
      await autoStart(state);
      cx.notify();
    });
  });
  let cleaning = false;
  cx.timer.every(CLEANUP_INTERVAL, (cx) => {
    cx.spawn(async () => codeReviews(state));
    cx.spawn(async () => coordinators(state));
    if (cleaning) return;
    cleaning = true;
    cx.spawn(async () => {
      try {
        await runCleanup();
        await commentOnDoneIssues();
      } finally { cleaning = false; }
    });
  });
  let writing = false;
  cx.timer.every(400, (cx) => {
    if (writing) return;
    writing = true;
    cx.spawn(async () => {
      try { await runQueuedWrites(); } finally { writing = false; }
    });
  });
  let starting = false;
  cx.timer.every(400, (cx) => {
    if (starting) return;
    starting = true;
    cx.spawn(async () => {
      try {
        await runQueuedRuns();
        await runQueuedStarts();
      } finally { starting = false; }
    });
  });
  cx.timer.every(300000, (cx) => cx.spawn(refreshMachinesLogged));
}

// The sidebar already shows a missing config, so a failed periodic refresh only goes to the log.
async function refreshMachinesLogged() {
  try {
    await refreshMachines();
  } catch (error) {
    console.error("Couldn't refresh machines:", error);
  }
}

// Says once when starting run tasks breaks, not on every pass that hits the same error.
async function autoStart(state) {
  try {
    await runAutoStart();
    state.autoStartError = null;
  } catch (error) {
    const message = String(error.message ?? error);
    if (message !== state.autoStartError) notify({ title: "Runs can't start tasks", body: message, level: "error" });
    state.autoStartError = message;
  }
}

async function coordinators(state) {
  if (state.watching) return;
  state.watching = true;
  try {
    await watchCoordinators();
    state.coordinatorError = null;
  } catch (error) {
    const message = String(error.message ?? error);
    if (message !== state.coordinatorError) notify({ title: "Couldn't update the coordinator", body: message, level: "error" });
    state.coordinatorError = message;
  } finally {
    state.watching = false;
  }
}

async function codeReviews(state) {
  try {
    await runCodeReviews();
    state.codeReviewError = null;
  } catch (error) {
    const message = String(error.message ?? error);
    if (message !== state.codeReviewError) notify({ title: "Code reviews can't run", body: message, level: "error" });
    state.codeReviewError = message;
  }
}
