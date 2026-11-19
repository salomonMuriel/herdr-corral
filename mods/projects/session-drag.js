// Dragging a session row onto a project in the sidebar files it there. A drop only counts
// on a project's own row or rail mark; letting go anywhere else cancels.
import { notify } from "herdr";
import { PROJECT_LABEL, setLabel } from "./terminal-labels.js";

// A task or coordinator session belongs to its task's or coordinator's project.
export const canDrag = (s) => Boolean(s.terminal) && !s.task && !s.coordinator;

// `fresh` lets the sidebar's own mouse-down, which follows the row's, tell this press from
// one whose release never reached the sidebar.
export function pressSession(view, s) {
  if (canDrag(s)) view.sessionDrag = { session: s, over: null, fresh: true };
}

export function pressSidebar(view) {
  const drag = view.sessionDrag;
  if (drag?.fresh) drag.fresh = false;
  else view.sessionDrag = null;
}

export function hoverProject(view, projectId, on, cx) {
  const drag = view.sessionDrag;
  if (!drag) return;
  if (on) drag.over = projectId;
  else if (drag.over === projectId) drag.over = null;
  cx.notify();
}

export function dropOnProject(view, projectId) {
  const drag = view.sessionDrag;
  if (!drag || projectId === drag.session.projectId) return;
  fileSession(drag.session, projectId);
}

// Runs after a target's mouse-up, so it ends every drag, dropped or not.
export function endSessionDrag(view, cx) {
  if (!view.sessionDrag) return;
  view.sessionDrag = null;
  cx.notify();
}

const movesTo = (view, projectId) => Boolean(view.sessionDrag) && Boolean(projectId) && view.sessionDrag.over === projectId && view.sessionDrag.session.projectId !== projectId;
export const isDraggingSession = (view, s) => view.sessionDrag?.session.id === s.id && movesTo(view, view.sessionDrag.over);
export const isDropTarget = movesTo;

// An empty label sends the session back to the project its folder belongs to.
export function fileSession(s, projectId) {
  const value = projectId && projectId !== s.homeProjectId ? projectId : "";
  setLabel(s.terminal, PROJECT_LABEL, value)
    .catch((error) => notify({ title: "Couldn't move the session", body: error.message, level: "error" }));
}

export const wasMoved = (s) => Boolean(s.labels?.[PROJECT_LABEL]);
