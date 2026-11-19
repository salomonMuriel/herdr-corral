// Dialogs and popups opened with props.view. Each keeps its own inputs on the View.
import { v_flex } from "gpui-base";
import { props } from "herdr";
import { close } from "./controls.js";
import * as taskDialog from "./dialog-task.js";
import * as projectDialog from "./dialog-project.js";
import * as runDialog from "./dialog-run.js";
import * as menus from "./menus.js";
import { cleanupList } from "./cleanup-list.js";
import { historyDialog } from "./dialog-history.js";
import { issuesDialog } from "./dialog-issues.js";
import { pickPopup } from "./dialog-pick.js";

const VIEWS = {
  task: taskDialog,
  project: projectDialog,
  run: runDialog,
  start: menus.start,
  session: menus.session,
  link: menus.link,
  assign: menus.assign,
  picker: menus.picker,
  cleanup: cleanupList,
  history: historyDialog,
  issues: issuesDialog,
  pick: pickPopup,
};

export const DIALOG_VIEWS = Object.keys(VIEWS);

export function initDialog(view, cx) {
  view.handle = cx.focus_handle();
  VIEWS[view.view].init?.(view, cx);
  if (!view.keepsFocus) view.handle.focus();
}

export function renderDialog(view, k) {
  const body = VIEWS[view.view].render(view, k);
  // A dialog has a fixed height for its body to scroll in. A popup sizes to its content and
  // collapses around a scrolling body, so a long popup scrolls inside its own view.
  const popup = Boolean(props().popup);
  return v_flex().id("dialog").track_focus(view.handle).w_full().min_h(0).when(!popup, (el) => el.size_full()).bg(k.bg).text_color(k.ink).font_family(k.font)
    .on_key_down((e, cx) => {
      if (e.key !== "escape") return;
      close();
      cx.stop_propagation();
    })
    .child(popup ? body : v_flex().id("dialog-body").size_full().min_h(0).overflow_y_scrollbar().child(body));
}
