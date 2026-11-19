// Pieces the sidebar, board and bar share.
import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run } from "herdr";
import { openDialog, openPopup } from "../actions.js";
import { syncState, requestPull, data } from "../store.js";
import { duration } from "../model.js";
import { projectColor } from "./tokens.js";
import { iconImagePath, iconText } from "../icons.js";
import { startPopup } from "../start-guard.js";
import { versionState, shortSha, retryCatchUp } from "../version.js";
import { machineLabel } from "../machines.js";
import { quotaLabel } from "./state-parts.js";
import { stop, pill } from "../controls.js";
import { PROJECT_DIALOG, START_POPUP, SESSION_POPUP, LINK_POPUP, ASSIGN_DIALOG } from "../overlay-sizes.js";

export function statusMark(k, status) {
  const c = k.status;
  if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(c.working).spin(900);
  if (status === "blocked") return needsYouPill(k, "needs you");
  if (status === "done") return div().size(7).mx(2.5).flex_none().rounded_full().bg(c.done);
  if (status === "idle") return div().size(7).mx(2.5).flex_none().rounded_full().border(1.5).border_color(c.idle);
  return div().size(12).flex_none();
}

const ASK_LABEL = { plan: "plan needs approval", question: "has a question", permission: "needs permission" };

// A session's mark: what its blocked agent asks for when the hook said, a coordinator's
// question for the person, else its status.
export function sessionMark(k, s) {
  const label = ASK_LABEL[s.ask] ?? (s.coordinatorAsk && s.agentStatus !== "blocked" ? "asks you" : null);
  return label ? needsYouPill(k, label) : statusMark(k, s.status);
}

export const needsYouPill = (k, label) => pill(k.status.blocked, label);

export function iconButton(k, id, name, tooltip, action) {
  return div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
    .text_color(k.dim).hover((s) => s.bg(k.line).text_color(k.ink)).tooltip(tooltip)
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
    .child(svg(`mods/workspace-chrome/${name}.svg`).size(13).flex_none());
}

export const age = (s, now) => (s.since ? duration(now - s.since) : "");

export const openProject = (projectId) => openDialog("project", projectId ? { projectId } : {}, PROJECT_DIALOG);
export function openStart(projectId, subprojectId = null, taskId = null) {
  const task = taskId ? data().tasks.find((t) => t.id === taskId) : null;
  if (task) return startPopup(task);
  openPopup("start", { projectId, subprojectId }, START_POPUP);
}
export const openScratch = () => openPopup("start", { scratch: true }, START_POPUP);
export const openSessionMenu = (s) => openPopup("session", { sessionId: s.id }, SESSION_POPUP);
export const openLinkMenu = (s) => openPopup("link", { sessionId: s.id }, LINK_POPUP);
export const openAssign = (s) => openDialog("assign", { sessionId: s.id }, ASSIGN_DIALOG);

export function syncLine(k) {
  const sync = syncState();
  const version = versionLabel(k);
  const quota = quotaLabel(k);
  const label = sync.error ? "Board offline" : sync.busy ? "Syncing" : sync.at ? `Synced ${duration(Date.now() - sync.at)} ago`.replace("now ago", "just now") : "Not synced yet";
  return h_flex().id("sync").h(32).flex_none().px(12).gap(8).items_center().border_t(1).border_color(k.line).text_size(11.5)
    .text_color(sync.error ? k.raw.red : k.faint).cursor_pointer().hover((s) => s.text_color(k.ink))
    .tooltip(sync.error ?? "Pull the board now").on_click(() => requestPull())
    .child(div().size(6).rounded_full().bg(sync.error ? k.raw.red : k.raw.green))
    .child(div().flex_1().min_w(0).truncate().child(label))
    .when(Boolean(quota), (el) => el.child(quota))
    .when(Boolean(version), (el) => el.child(version))
    .child(iconButton(k, "settings", "settings", "Settings", () => run("app.settings")));
}

function versionLabel(k) {
  const v = versionState();
  if (v.error) return null;
  const text = v.updating ? `Updating to ${shortSha(v.updating)}`
    : v.updated ? `Updated to ${shortSha(v.updated)}`
    : v.running ? `main ${shortSha(v.running.sha)}`
    : null;
  if (!text) return null;
  const when = v.running?.at ? new Date(v.running.at).toLocaleString() : null;
  return div().id("version").flex_none().text_color(v.updated && !v.updating ? k.raw.green : k.faint)
    .tooltip(when ? `Deployed ${when} from ${machineLabel(v.running.by)}` : "Deployed version").child(text);
}

// Shown instead of the version when this machine couldn't catch up; a click tries again.
export function behindLine(k) {
  const v = versionState();
  if (!v.error) return null;
  const running = v.running ? shortSha(v.running.sha) : "unknown";
  return h_flex().id("behind").h(26).flex_none().px(12).items_center().border_t(1).border_color(k.line)
    .text_size(11.5).text_color(k.raw.red).cursor_pointer().tooltip(v.error)
    .on_click(() => { retryCatchUp(); })
    .child(div().min_w(0).truncate().child(`Behind: running ${running}, latest ${shortSha(v.latest?.sha) || "unknown"}`));
}

export function sectionLabel(k, id, text, count = null) {
  return h_flex().id(id).px(12).pt(14).pb(5).gap(6).items_center().text_size(11.5).text_color(k.faint)
    .child(div().child(text))
    .when(count !== null, (el) => el.child(div().text_color(k.muted).child(String(count))));
}

export function emptyProjects(k) {
  return div().id("empty-new").mx(12).mt(12).h(28).px(10).flex().items_center().rounded(5).bg(k.raw.purple).text_color(k.raw.darkest)
    .text_size(12.5).font_weight(600).cursor_pointer().on_click(() => openProject()).child("New project");
}

// A project's mark: its image, else its emoji or letters, else its initial, on its color.
export function projectMark(k, project, index, size, selected = false) {
  const color = projectColor(project, index);
  const picture = iconImagePath(project);
  const text = iconText(project) ?? ([...(project?.name ?? "?")][0] ?? "?").toUpperCase();
  const radius = Math.round(size / 4.5);
  if (picture) return div().size(size).flex_none().rounded(radius).overflow_hidden().bg(k.raw.darkest).child(image(picture).w(size).h(size).rounded(radius));
  const emoji = Boolean(iconText(project)) && !/^[A-Za-z0-9]{1,2}$/.test(iconText(project));
  return div().size(size).flex_none().rounded(radius).flex().items_center().justify_center()
    .bg(emoji ? (selected ? `${color}55` : `${color}1f`) : selected ? color : `${color}24`)
    .text_size(emoji ? size * 0.56 : size * 0.42).font_weight(700).text_color(selected ? k.raw.darkest : color)
    .child(text);
}
