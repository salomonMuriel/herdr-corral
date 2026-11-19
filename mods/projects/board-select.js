// The board's picked cards (shift-click, or a column's header) and the Run popup they open.
import { openDialog } from "./actions.js";
import { RUN_DIALOG } from "./overlay-sizes.js";

export function selectedIds(view, projectId) {
  return view.selection?.projectId === projectId ? view.selection.ids : [];
}

export const isSelected = (view, task) => selectedIds(view, task.project_id).includes(task.id);

export function toggleSelected(view, task, cx) {
  const ids = selectedIds(view, task.project_id);
  const next = ids.includes(task.id) ? ids.filter((id) => id !== task.id) : [...ids, task.id];
  view.selection = { projectId: task.project_id, ids: next };
  cx.notify();
}

// A column whose open cards are all picked already is unpicked instead.
export function toggleColumn(view, projectId, tasks, cx) {
  const ids = selectedIds(view, projectId);
  const open = tasks.filter((t) => t.status !== "done").map((t) => t.id);
  const all = open.length > 0 && open.every((id) => ids.includes(id));
  const next = all ? ids.filter((id) => !open.includes(id)) : [...new Set([...ids, ...open])];
  view.selection = { projectId, ids: next };
  cx.notify();
}

export function clearSelection(view, cx) {
  view.selection = null;
  cx.notify();
}

export const runChain = (task) => openDialog("run", { projectId: task.project_id, rootTaskId: task.id }, RUN_DIALOG);

export function runSelected(view, projectId, cx) {
  openDialog("run", { projectId, taskIds: selectedIds(view, projectId) }, RUN_DIALOG);
  clearSelection(view, cx);
}
