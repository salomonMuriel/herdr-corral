// Card dragging on the board. A press that never moves onto another target is a click
// and opens the task.
import { moveTask, data } from "./store.js";
import { openDialog } from "./actions.js";
import { PROJECT_DIALOG, TASK_DIALOG } from "./overlay-sizes.js";

export function newTask(projectId, status = "todo", subprojectId = null) {
  if (!projectId) return openDialog("project", {}, PROJECT_DIALOG);
  return openDialog("task", { projectId, status, subprojectId }, TASK_DIALOG);
}

export const openTask = (task) => openDialog("task", { taskId: task.id }, TASK_DIALOG);

export function pressCard(view, task) {
  view.drag = { id: task.id, from: { status: task.status, before: task.id }, over: null, moved: false };
}

// `before`: the card the dragged one would land in front of; null for the column's end.
export function dragOver(view, status, before, cx) {
  const drag = view.drag;
  if (!drag) return;
  const same = drag.over?.status === status && drag.over?.before === before;
  if (same) return;
  const isOrigin = drag.from.status === status && drag.from.before === before;
  drag.over = { status, before };
  if (!isOrigin) drag.moved = true;
  cx.notify();
}

export function release(view, cx) {
  const drag = view.drag;
  view.drag = null;
  if (!drag) return;
  if (drag.moved && drag.over && drag.over.before !== drag.id) moveTask(drag.id, drag.over.status, drag.over.before);
  else if (!drag.moved) openTaskById(drag.id);
  cx.notify();
}

// Leaving the board cancels a drag: its mouse-up would land elsewhere and never reach release().
export function cancelDrag(view, cx) {
  if (!view.drag) return;
  view.drag = null;
  cx.notify();
}

export function openTaskById(id) {
  const task = data().tasks.find((t) => t.id === id);
  if (task) openTask(task);
}

export const isDragging = (view, task) => view.drag?.id === task.id && view.drag.moved;
export const dropMarker = (view, status, before) => Boolean(view.drag?.moved) && view.drag.over?.status === status && view.drag.over?.before === before;
