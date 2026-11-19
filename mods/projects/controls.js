// Small controls drawn in the Dracula tokens.
import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, closeOverlay } from "herdr";

const text = (value) => String(value ?? "");

export function programIcon(program, size, color) {
  if (!program?.icon) return null;
  return program.tint ? svg(program.icon).size(size).flex_none().text_color(color) : image(program.icon).w(size).h(size).flex_none();
}

export const icon = (name, size, color) => svg(`mods/workspace-chrome/${name}.svg`).size(size).flex_none().text_color(color);

export const stop = (_e, cx) => cx.stop_propagation();

// A tinted action on a card or row; its press and click stay off the row underneath.
export function tintedAction(id, label, color, action) {
  return div().id(id).px(7).h(20).flex().flex_none().items_center().rounded(4).bg(`${color}2e`)
    .text_size(11.5).font_weight(600).text_color(color).cursor_pointer().hover((s) => s.bg(`${color}55`))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
    .child(label);
}

export function pill(color, label, size = 10.5) {
  return div().flex_none().px(6).h(17).flex().items_center().rounded(4).bg(`${color}26`)
    .text_size(size).font_weight(600).text_color(color).child(label);
}

// kind: "primary" (one per dialog), "plain", "danger", "quiet".
export function button(k, id, label, kind, action) {
  const primary = kind === "primary";
  const fill = primary ? k.primary : kind === "quiet" ? null : k.panel;
  const ink = primary ? k.primaryInk : kind === "danger" ? k.danger : kind === "quiet" ? k.muted : k.ink;
  return h_flex().id(id).h(32).px(14).flex_none().items_center().justify_center().rounded(k.controlRadius)
    .when(Boolean(fill), (el) => el.bg(fill))
    .when(!primary && kind !== "quiet", (el) => el.border_1().border_color(k.line))
    .text_size(13).font_weight(primary ? 600 : 500).text_color(ink).cursor_pointer()
    .hover((s) => (primary ? s.opacity(0.88) : s.bg(k.hover)))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => action(cx))
    .child(text(label));
}

export function chip(k, id, label, on, action, swatch = null) {
  return h_flex().id(id).h(28).px(10).gap(7).flex_none().items_center().rounded(k.controlRadius)
    .border_1().border_color(on ? k.focus : k.line).bg(on ? k.hover : k.bg)
    .text_size(12.5).text_color(on ? k.ink : k.muted).cursor_pointer()
    .hover((s) => s.bg(k.hover))
    .on_click((_e, cx) => action(cx))
    .when(Boolean(swatch), (el) => el.child(div().size(8).rounded(4).bg(swatch)))
    .child(text(label));
}

export function fieldLabel(k, label) {
  return div().pt(16).pb(7).text_size(12).text_color(k.muted).child(text(label));
}

export function fieldFrame(k, element, focused) {
  return element.px(10).rounded(k.controlRadius).border_1().border_color(focused ? k.focus : k.line)
    .bg(k.field).text_size(13.5).text_color(k.ink);
}

export function menuRow(k, id, label, action, { iconEl = null, hint = "", enabled = true, tone = null } = {}) {
  return h_flex().id(id).h(32).px(10).gap(10).flex_none().items_center().rounded(k.controlRadius)
    .text_size(13).text_color(enabled ? tone ?? k.ink : k.faint)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(k.hover)).on_click((_e, cx) => action(cx)))
    .when(Boolean(iconEl), (el) => el.child(iconEl))
    .child(div().flex_1().min_w(0).truncate().child(text(label)))
    .when(Boolean(hint), (el) => el.child(div().flex_none().text_size(11.5).text_color(k.faint).child(text(hint))));
}

export function menuHeading(k, heading) {
  return div().px(10).pt(10).pb(5).text_size(11.5).text_color(k.faint).child(text(heading));
}

export const close = () => closeOverlay(props().overlay);

export function dialogHeader(k, title) {
  return h_flex().items_center().child(div().flex_1().text_size(16).font_weight(600).child(text(title)))
    .child(div().text_size(11.5).text_color(k.faint).child("Esc"));
}
