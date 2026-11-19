// The popup that picks today's tasks from every open task across projects.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { data, STATUS_LABEL } from "./store.js";
import { pickCandidates } from "./today.js";
import { picks, isPicked, togglePick, MAX_PICKS } from "./today-picks.js";
import { menuHeading, icon, close } from "./controls.js";
import { projectSwatch } from "./skins/today-parts.js";

function candidateRow(k, task, full) {
  const picked = isPicked(task);
  const enabled = picked || !full;
  const project = data().projects.find((p) => p.id === task.project_id)?.name ?? "";
  return h_flex().id(`pick-task-${task.id}`).h(36).px(10).gap(10).flex_none().items_center().rounded(k.controlRadius)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(k.hover)).on_click(() => togglePick(task)))
    .child(projectSwatch(task.project_id))
    .child(v_flex().flex_1().min_w(0)
      .child(div().truncate().text_size(13).text_color(enabled ? k.ink : k.faint).child(task.title))
      .child(div().truncate().text_size(11).text_color(k.faint).child(`${project} · ${STATUS_LABEL[task.status]}`)))
    .when(picked, (el) => el.child(icon("circle-check", 13, k.raw.green)));
}

export const pickPopup = {
  render(view, k) {
    const count = picks().length;
    const full = count >= MAX_PICKS;
    return v_flex().p(6).w_full()
      .child(h_flex().items_center()
        .child(div().flex_1().child(menuHeading(k, `Today's ${MAX_PICKS} · ${count} picked`)))
        .child(div().id("pick-done").px(10).text_size(11.5).text_color(k.faint).cursor_pointer().hover((s) => s.text_color(k.ink)).on_click(() => close()).child("Done")))
      .child(v_flex().id("pick-list").max_h(400).overflow_y_scrollbar()
        .children(pickCandidates().map((task) => candidateRow(k, task, full))));
  },
};
