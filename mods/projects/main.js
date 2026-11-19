// Projects: sessions grouped by project and repo, and a shared task board per project.
// One mod draws every part (props.view), so all parts share the same data and state.
import { View, div } from "gpui-kit";
import { props, nextCommand, setAgentOrder } from "herdr";
import { startLeader } from "./leader.js";
import { portfolio, sessions } from "./model.js";
import { startStateLines } from "./state-line.js";
import { startPulls } from "./pulls.js";
import { startTrustWatch } from "./trust-watch.js";
import { needsYou, jumpToNext } from "./needs-you.js";
import { toggleBoard, toggleToday, todayMode, boardShown, currentProjectId, showBoard } from "./actions.js";
import { needsReload, reloadToday } from "./today.js";
import { requestPull, KINDS } from "./store.js";
import { markWritten } from "./db.js";
import { TOKENS } from "./skins/tokens.js";
import { newTask, openTaskById } from "./board-drag.js";
import { startFromCommand } from "./start-guard.js";
import { openScratch } from "./skins/parts.js";
import { initDialog, renderDialog, DIALOG_VIEWS } from "./dialogs.js";
import * as design from "./skins/dracula.js";

// The tree's order: kind sections, then each project's coordinator, repos and loose sessions.
function sidebarOrder(model) {
  const inKind = (kind) => model.groups.filter((g) => g.project.kind === kind);
  const groupOrder = (g) => [g.coordinator, ...g.subs.flatMap((sub) => sub.sessions), ...g.loose].filter(Boolean);
  return KINDS.flatMap((kind) => inKind(kind).flatMap(groupOrder)).concat(model.unsorted);
}

// agent.next walks the needs-you queue first, then the sidebar's order.
function agentOrder(model) {
  const listed = sidebarOrder(model);
  const addresses = needsYou(model.sessions).concat(listed).map((s) => s.terminal).filter(Boolean);
  return [...new Set(addresses)];
}

export default class Projects extends View {
  init(_props, cx) {
    this.view = props()?.view ?? "sidebar";
    this.folds = JSON.parse(localStorage.getItem("folds") ?? "{}");
    this.hovered = null;
    this.drag = null;
    this.sessionDrag = null;
    if (DIALOG_VIEWS.includes(this.view)) return initDialog(this, cx);
    if (this.view === "sidebar") {
      startLeader(cx);
      startStateLines(cx, sessions);
      startPulls(cx, sessions);
      startTrustWatch(cx, sessions);
      cx.timer.every(30000, (cx) => cx.notify());
    }
    if (this.view === "bar") this.listenForKeys(cx);
    // The head pads for the traffic lights only outside fullscreen, read from window().
    if (this.view === "head") cx.timer.every(30000, (cx) => cx.notify());
    if (this.view === "board") this.keepTodayFresh(cx);
  }

  listenForKeys(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "board") toggleBoard(currentProjectId());
        if (command === "today") toggleToday();
        if (command === "new-task") newTask(currentProjectId());
        if (command === "scratch") openScratch();
        if (command === "pull") requestPull();
        if (command === "wrote") markWritten();
        if (command === "next-needs-you") jumpToNext(sessions());
        if (command.startsWith("start-")) startFromCommand(command);
        if (command.startsWith("task-")) openTaskById(command.slice("task-".length));
        if (command.startsWith("board-")) showBoard(command.slice("board-".length));
        cx.notify();
      }
    });
  }

  keepTodayFresh(cx) {
    cx.timer.every(2000, (cx) => {
      if (boardShown() && todayMode() && needsReload(this)) reloadToday(this, cx);
    });
  }

  isFolded(id, fallback = false) {
    return this.folds[id] ?? fallback;
  }

  toggleFold(id, fallback, cx) {
    this.folds[id] = !this.isFolded(id, fallback);
    localStorage.setItem("folds", JSON.stringify(this.folds));
    cx.notify();
  }

  hover(id, on, cx) {
    if (on) this.hovered = id;
    else if (this.hovered === id) this.hovered = null;
    cx.notify();
  }

  render(cx) {
    const k = TOKENS;
    if (DIALOG_VIEWS.includes(this.view)) return renderDialog(this, k);
    if (this.view === "head") return design.head(this, k, cx);
    const model = portfolio();
    if (this.view === "sidebar") {
      setAgentOrder(agentOrder(model));
      return design.sidebar(this, model, k, cx);
    }
    if (this.view === "board" && todayMode()) return design.today(this, model, k, cx);
    if (this.view === "board") return design.board(this, model, k, currentProjectId(model), cx);
    if (this.view === "bar") return design.bar(this, model, k, cx);
    return div();
  }
}
