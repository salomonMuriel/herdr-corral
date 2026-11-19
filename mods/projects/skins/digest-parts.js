// The Pi's last end-of-day digest in the Today view, with each agent's recap behind Recap.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { data } from "../store.js";
import { openTask } from "../board-drag.js";
import { localDay } from "../today-picks.js";
import { section, projectSwatch, quietLink } from "./today-parts.js";

const REPORT_LABEL = { done: "Done", ask: "Asked", note: "Note" };
const clip = (text, max = 220) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function dayLabel(day) {
  if (day === localDay()) return "Today";
  if (day === localDay(Date.now() - 86400000)) return "Yesterday";
  return day;
}

function openIfThere(taskId) {
  const task = data().tasks.find((t) => t.id === taskId);
  if (task) openTask(task);
}

function itemRow(k, sectionKey, item) {
  return h_flex().id(`dg-${sectionKey}-${item.task_id ?? item.title}`).px(6).py(3).gap(8).items_start().min_w(0).rounded(5)
    .cursor_pointer().hover((s) => s.bg(k.hover)).on_click(() => openIfThere(item.task_id))
    .child(div().pt(4).child(projectSwatch(item.project_id, 7)))
    .child(v_flex().flex_1().min_w(0)
      .child(div().truncate().text_size(12.5).text_color(k.ink).child(item.title))
      .when(Boolean(item.detail), (el) => el.child(div().truncate().text_size(11.5).text_color(k.faint).child(item.detail))));
}

function digestSection(k, part) {
  return v_flex().gap(1)
    .child(div().px(6).pt(6).pb(2).text_size(11.5).text_color(k.faint).child(`${part.title} · ${part.items.length}`))
    .children(part.items.map((item) => itemRow(k, part.key, item)));
}

function recapRow(k, recap) {
  return v_flex().id(`dg-recap-${recap.task_id}`).px(6).py(6).gap(3).rounded(5).cursor_pointer()
    .hover((s) => s.bg(k.hover)).on_click(() => openIfThere(recap.task_id))
    .child(h_flex().gap(8).items_center().min_w(0)
      .child(projectSwatch(recap.project_id, 7))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_weight(600).child(recap.title))
      .child(div().flex_none().text_size(11).text_color(k.faint).child(recap.agent ?? "")))
    .children(recap.reports.map((report, i) => h_flex().id(`dg-recap-${recap.task_id}-${i}`).gap(8).items_start().min_w(0)
      .child(div().w(42).flex_none().text_size(11).text_color(report.kind === "ask" ? k.status.blocked : k.faint).child(REPORT_LABEL[report.kind] ?? "Note"))
      .child(div().flex_1().min_w(0).text_size(12).text_color(k.muted).child(clip(report.text ?? "")))));
}

export function digestPanel(view, k, state) {
  const digest = state?.digest;
  if (!digest) return section(k, "today-digest", "Digest", k.raw.yellow, null, [], { empty: state?.at ? "The Pi writes one each evening" : "Loading" });
  const body = digest.body ?? {};
  const recaps = body.recaps ?? [];
  view.showRecaps ??= false;
  const toggle = recaps.length
    ? quietLink(k, "today-recap", view.showRecaps ? "Hide recap" : "Recap", "What each agent reported that day", (cx) => { view.showRecaps = !view.showRecaps; cx.notify(); })
    : null;
  const rows = [
    div().px(6).pb(2).text_size(12.5).text_color(k.muted).child(body.headline ?? ""),
    ...(body.sections ?? []).filter((part) => part.items?.length).map((part) => digestSection(k, part)),
    ...(view.showRecaps ? [div().px(6).pt(8).pb(2).text_size(11.5).text_color(k.faint).child("Recap"), ...recaps.map((recap) => recapRow(k, recap))] : []),
  ];
  return section(k, "today-digest", `Digest · ${dayLabel(digest.day)}`, k.raw.yellow, null, rows, { right: toggle });
}
