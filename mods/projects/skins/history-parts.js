// History rows: what happened, who and when, and an Undo while the change still stands.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { describe, detail, who, when, canUndo, undoLabel } from "../history.js";
import { tintedAction } from "../controls.js";

const KIND_COLOR = (k) => ({
  created: k.raw.cyan, restored: k.raw.cyan, moved: k.raw.purple, started: k.raw.green,
  report: k.raw.orange, edited: k.dim, deleted: k.raw.red,
});

const clip = (text, max = 240) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// onOpen, when given, makes the task's title a link (the project's history lists many tasks).
export function eventRow(k, event, { onUndo, onOpen = null, now = Date.now() }) {
  const text = detail(event);
  const color = KIND_COLOR(k)[event.kind] ?? k.dim;
  return h_flex().id(`ev-${event.id}`).px(10).py(6).gap(10).items_start().min_w(0).rounded(k.controlRadius).hover((s) => s.bg(k.hover))
    .child(div().mt(5).size(7).flex_none().rounded(2).bg(color))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .when(Boolean(onOpen), (el) => el.child(div().id(`ev-open-${event.id}`).truncate().text_size(12.5).font_weight(600).text_color(k.ink)
        .cursor_pointer().hover((s) => s.text_color(k.raw.purple)).on_click((_e, cx) => onOpen(event, cx)).child(event.title)))
      .child(div().truncate().text_size(12.5).text_color(onOpen ? k.muted : k.ink).child(describe(event)))
      .when(Boolean(text), (el) => el.child(div().text_size(12).text_color(k.muted).child(clip(text))))
      .child(div().text_size(11.5).text_color(k.faint).child(`${who(event)} · ${when(event, now)}`)))
    .when(canUndo(event), (el) => el.child(tintedAction(`ev-undo-${event.id}`, undoLabel(event), k.raw.purple, (cx) => onUndo(event, cx))));
}

export function historyList(k, events, options) {
  if (!events) return div().px(10).py(6).text_size(12).text_color(k.faint).child("Loading");
  if (events.error) return div().px(10).py(6).text_size(12).text_color(k.danger).child(events.error);
  if (!events.length) return div().px(10).py(6).text_size(12).text_color(k.faint).child("No history yet");
  const now = Date.now();
  return v_flex().gap(1).children(events.map((event) => eventRow(k, event, { ...options, now })));
}
