// The task dialog's "Waits on" field. Edits stay on the view until Save, then apply as
// added and removed edges; a pick that would make a cycle isn't offered.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { data, STATUS_LABEL } from "./store.js";
import { dependenciesOf, wouldCycle, addDependency, removeDependency } from "./deps.js";
import { icon } from "./controls.js";

export function initDeps(view) {
  view.deps = view.task ? dependenciesOf(view.task.id) : [];
  view.addingDep = false;
}

export async function saveDeps(view, taskId) {
  const before = new Set(dependenciesOf(taskId));
  const after = new Set(view.deps);
  for (const id of before) if (!after.has(id)) await removeDependency(taskId, id);
  for (const id of after) if (!before.has(id)) await addDependency(taskId, id);
}

function candidates(view) {
  const self = view.task?.id;
  return data().tasks
    .filter((t) => t.project_id === view.projectId && t.status !== "done" && t.id !== self && !view.deps.includes(t.id))
    .filter((t) => !self || !wouldCycle(self, t.id))
    .sort((a, b) => a.position - b.position);
}

function depRow(view, k, task) {
  return h_flex().id(`dep-${task.id}`).h(30).px(10).gap(8).items_center().rounded(k.controlRadius).bg(k.panel)
    .child(div().size(7).flex_none().rounded(2).bg(k.columns[task.status]))
    .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(task.status === "done" ? k.muted : k.ink).child(task.title))
    .child(div().flex_none().text_size(11.5).text_color(k.faint).child(STATUS_LABEL[task.status]))
    .child(div().id(`dep-remove-${task.id}`).p(4).rounded(4).cursor_pointer().hover((s) => s.bg(k.hover))
      .on_click((_e, cx) => { view.deps = view.deps.filter((id) => id !== task.id); cx.notify(); })
      .child(icon("x", 12, k.dim)));
}

export function depsField(view, k) {
  const byId = new Map(data().tasks.map((t) => [t.id, t]));
  const current = view.deps.map((id) => byId.get(id)).filter(Boolean);
  const options = view.addingDep ? candidates(view) : [];
  return v_flex().gap(4)
    .children(current.map((t) => depRow(view, k, t)))
    .child(h_flex().id("dep-add").h(28).px(2).gap(7).items_center().cursor_pointer().text_size(12.5).text_color(k.muted).hover((s) => s.text_color(k.ink))
      .on_click((_e, cx) => { view.addingDep = !view.addingDep; cx.notify(); })
      .child(icon(view.addingDep ? "chevron-down" : "plus", 12, k.dim))
      .child(current.length ? "Add another" : "Add a task this waits on"))
    .when(view.addingDep, (el) => el.child(v_flex().id("dep-options").max_h(180).overflow_y_scrollbar()
      .when(options.length === 0, (el) => el.child(div().px(10).py(6).text_size(12).text_color(k.faint).child("No other open tasks in this project")))
      .children(options.map((t) => h_flex().id(`dep-pick-${t.id}`).h(28).px(10).gap(8).items_center().rounded(k.controlRadius).cursor_pointer()
        .hover((s) => s.bg(k.hover))
        .on_click((_e, cx) => { view.deps = [...view.deps, t.id]; view.addingDep = false; cx.notify(); })
        .child(div().size(7).flex_none().rounded(2).bg(k.columns[t.status]))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(t.title))))));
}
