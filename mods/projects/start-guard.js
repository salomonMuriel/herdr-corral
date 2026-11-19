// Starting an agent on a task that still waits on unfinished tasks asks once first.
import { openOverlay } from "herdr";
import { data } from "./store.js";
import { waitingOn } from "./deps.js";
import { openPopup } from "./actions.js";
import { START_POPUP, CONFIRM_DIALOG } from "./overlay-sizes.js";

export function openStartNow(task) {
  openPopup("start", { projectId: task.project_id, subprojectId: task.subproject_id, taskId: task.id }, START_POPUP);
}

export function startPopup(task) {
  const open = waitingOn(task.id).length;
  if (!open) return openStartNow(task);
  openOverlay({
    mod: "confirm", kind: "dialog", ...CONFIRM_DIALOG,
    props: {
      title: "Start anyway?",
      detail: `This waits on ${open} unfinished ${open === 1 ? "task" : "tasks"}.`,
      command: { name: `projects.start-${task.id}` },
    },
  });
}

export function startFromCommand(command) {
  const task = data().tasks.find((t) => t.id === command.slice("start-".length));
  if (task) openStartNow(task);
}
