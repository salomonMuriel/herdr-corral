// A card's history in its task dialog, and the project's history dialog from the board, where
// deleted tasks can be restored.
import { v_flex } from "gpui-base";
import { props } from "herdr";
import { data } from "./store.js";
import { taskHistory, projectHistory, undo } from "./history.js";
import { historyList } from "./skins/history-parts.js";
import { fieldLabel, dialogHeader, close, chip } from "./controls.js";
import { openTask } from "./board-drag.js";

const SHORT = 6;

function load(view, loader, cx) {
  cx.spawn(async (cx) => {
    try {
      view.history = await loader();
    } catch (error) {
      view.history = { error: `Couldn't load the history: ${error.message ?? error}` };
    }
    cx.notify();
  });
}

// After an undo the dialog starts over from the task as it now is.
function undoThen(reload) {
  return (event, cx) => cx.spawn(async (cx) => {
    await undo(event);
    reload(cx);
    cx.notify();
  });
}

export function initTaskHistory(view, cx, reinit) {
  view.history = null;
  view.historyAll = false;
  if (view.task) load(view, () => taskHistory(view.task.id), cx);
  view.undoInTask = undoThen((cx) => reinit(view, cx));
}

export function taskHistorySection(view, k) {
  const events = view.history;
  const long = Array.isArray(events) && events.length > SHORT;
  const shown = long && !view.historyAll ? events.slice(0, SHORT) : events;
  return v_flex()
    .child(fieldLabel(k, "History"))
    .child(historyList(k, shown, { onUndo: view.undoInTask }))
    .when(long, (el) => el.child(v_flex().pt(6).items_start()
      .child(chip(k, "history-all", view.historyAll ? "Show less" : `Show all ${events.length}`, false, (cx) => { view.historyAll = !view.historyAll; cx.notify(); }))));
}

const openFromHistory = (event) => {
  const task = data().tasks.find((t) => t.id === event.task_id);
  if (!task) return;
  close();
  openTask(task);
};

export const historyDialog = {
  init(view, cx) {
    view.projectId = props().projectId;
    view.history = null;
    const reload = (cx) => load(view, () => projectHistory(view.projectId), cx);
    view.undoInProject = undoThen(reload);
    reload(cx);
  },
  render(view, k) {
    const project = data().projects.find((p) => p.id === view.projectId);
    return v_flex().id("history-dialog").p(20).gap(8)
      .child(dialogHeader(k, `History of ${project?.name ?? "the project"}`))
      .child(historyList(k, view.history, { onUndo: view.undoInProject, onOpen: openFromHistory }));
  },
};
