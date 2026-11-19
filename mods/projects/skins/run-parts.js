// Run pieces of the board: each active run's progress with Stop run, the picked cards'
// Run selected, and a To do card's line saying where its run starts it or why it waits.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { runsOfProject, runProgress } from "../runs.js";
import { stopRun } from "../run-actions.js";
import { autoStartWait } from "../autostart-waits.js";
import { machineLabel } from "../machines.js";
import { data } from "../store.js";
import { selectedIds, runSelected, clearSelection } from "../board-select.js";
import { icon, button, stop } from "../controls.js";

function link(k, id, label, color, action) {
  return div().id(id).px(6).h(22).flex().items_center().rounded(4).cursor_pointer()
    .text_size(12).font_weight(600).text_color(color).hover((s) => s.bg(k.hover))
    .on_mouse_down("left", stop).on_click((_e, cx) => action(cx))
    .child(label);
}

function runPill(k, run) {
  const { done, total } = runProgress(run);
  const root = run.root_task_id ? data().tasks.find((t) => t.id === run.root_task_id) : null;
  return h_flex().id(`run-${run.id}`).h(30).pl(10).pr(4).gap(8).items_center().rounded(6).bg(`${k.raw.purple}1f`)
    .tooltip(root ? `Chain from ${root.title}` : "Selected tasks")
    .child(icon("layers", 12, k.raw.purple))
    .child(div().text_size(12.5).text_color(k.ink).child(`Run: ${done} of ${total} done`))
    .child(div().text_size(11.5).text_color(k.faint).child(machineLabel(run.machine)))
    .child(link(k, `run-stop-${run.id}`, "Stop run", k.raw.red, () => stopRun(run)));
}

function selectionBar(view, k, projectId, count) {
  return h_flex().h(30).gap(8).items_center()
    .child(div().text_size(12.5).text_color(k.muted).child(`${count} selected`))
    .child(button(k, "run-selected", "Run selected", "primary", (cx) => runSelected(view, projectId, cx)))
    .child(link(k, "selection-clear", "Clear", k.muted, (cx) => clearSelection(view, cx)));
}

export function runStrip(view, k, projectId) {
  const runs = runsOfProject(projectId);
  const count = selectedIds(view, projectId).length;
  if (!runs.length && !count) return null;
  return h_flex().flex_none().gap(10).flex_wrap().items_center()
    .children(runs.map((run) => runPill(k, run)))
    .when(count > 0, (el) => el.child(div().flex_1()).child(selectionBar(view, k, projectId, count)));
}

export function runLine(k, task, run) {
  const wait = autoStartWait(task, run);
  const where = machineLabel(run.machine);
  const text = wait ?? (task.subproject_id ? `Run starts it on ${where}` : "Needs a repo to start");
  const color = wait ? k.faint : task.subproject_id ? k.raw.purple : k.raw.red;
  return h_flex().gap(5).items_center().min_w(0)
    .child(icon(wait ? "clock" : "git-branch", 11, color))
    .child(div().truncate().text_size(11.5).text_color(color).child(text));
}
