// Dracula: the sidebar (a rail of projects beside a tree), its head, the board and the bar.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, window } from "herdr";
import { board, bar } from "./dracula-board.js";
import { today } from "./today-view.js";
import { iconButton, syncLine, behindLine, openProject, openScratch, emptyProjects } from "./parts.js";
import { focus } from "./sidebars/focus.js";
import { beginShown } from "../state-line.js";
import { cleanupRunLine } from "./cleanup-parts.js";
import { pressSidebar, endSessionDrag } from "../session-drag.js";

export { board, bar, today };

export function head(view, k) {
  const mac = window()?.platform === "macos" && !window()?.fullscreen;
  return h_flex().size_full().bg(k.raw.darker).pl(mac ? 84 : 12).pr(8).gap(4).items_center().font_family(k.font)
    .child(div().flex_1().text_size(12).font_weight(600).text_color(k.muted).child("Projects"))
    .child(iconButton(k, "head-search", "search", "Find", () => run("mod.open", { name: "picker" })))
    .child(iconButton(k, "head-scratch", "terminal", "Scratch session", () => openScratch()))
    .child(iconButton(k, "head-new", "folder-plus", "New project", () => openProject()));
}

export function sidebar(view, model, k) {
  const empty = model.groups.length === 0;
  const cleanupRun = cleanupRunLine(k);
  const behind = behindLine(k);
  beginShown();
  return v_flex().id("sidebar").size_full().min_h(0).bg(k.raw.darker).font_family(k.font).text_color(k.ink)
    .on_mouse_down("left", () => pressSidebar(view))
    .on_mouse_up("left", (_e, cx) => endSessionDrag(view, cx))
    .on_hover((on, cx) => { if (!on) endSessionDrag(view, cx); })
    .when(empty, (el) => el.child(div().px(12).pt(12).text_size(13).child("No projects yet")).child(emptyProjects(k)))
    .child(focus(view, model, k))
    .when(Boolean(cleanupRun), (el) => el.child(cleanupRun))
    .when(Boolean(behind), (el) => el.child(behind))
    .child(syncLine(k));
}
