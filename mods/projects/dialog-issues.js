// The project's open GitHub issues, repo by repo. A click imports an issue into To do, opens
// the task it became, or goes to the agent working on it.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props } from "herdr";
import { data } from "./store.js";
import { sessions } from "./model.js";
import { openIssues, importIssue, taskForIssue } from "./issues.js";
import { liveSession } from "./close-sessions.js";
import { selectSession } from "./actions.js";
import { openTask } from "./board-drag.js";
import { menuRow, menuHeading, chip, close, dialogHeader } from "./controls.js";

const reposOf = (projectId) => data().subprojects.filter((sp) => sp.project_id === projectId && sp.repo);

function load(view, sp, cx) {
  view.lists[sp.id] = null;
  cx.spawn(async (cx) => {
    try {
      view.lists[sp.id] = { issues: await openIssues(sp) };
    } catch (error) {
      view.lists[sp.id] = { error: String(error.message ?? error) };
    }
    cx.notify();
  });
}

function hintFor(task, live) {
  if (!task) return "";
  if (liveSession(task, live)) return "has an agent";
  return task.status === "done" ? "done" : "on the board";
}

function pickIssue(sp, issue) {
  return (cx) => {
    const task = taskForIssue(sp.project_id, issue.url);
    const session = task ? liveSession(task) : null;
    if (session) {
      close();
      return selectSession(session);
    }
    if (task) {
      close();
      return openTask(task);
    }
    importIssue(sp, issue);
    cx.notify();
  };
}

function importAll(sp, issues) {
  return (cx) => {
    for (const issue of issues) importIssue(sp, issue);
    cx.notify();
  };
}

function repoSection(view, k, sp, live) {
  const list = view.lists[sp.id];
  const heading = menuHeading(k, sp.name);
  if (!list) return v_flex().child(heading).child(div().px(10).py(6).text_size(12.5).text_color(k.faint).child("Loading"));
  if (list.error) return v_flex().child(heading).child(div().px(10).py(6).text_size(12.5).text_color(k.danger).child(list.error));
  if (!list.issues.length) return v_flex().child(heading).child(div().px(10).py(6).text_size(12.5).text_color(k.faint).child("No open issues"));
  const fresh = list.issues.filter((issue) => !taskForIssue(sp.project_id, issue.url));
  return v_flex()
    .child(h_flex().items_center().pr(4)
      .child(div().flex_1().child(heading))
      .when(fresh.length > 0, (el) => el.child(chip(k, `issues-all-${sp.id}`, `Import ${fresh.length}`, false, importAll(sp, fresh)))))
    .children(list.issues.map((issue) => {
      const task = taskForIssue(sp.project_id, issue.url);
      return menuRow(k, `issue-${sp.id}-${issue.number}`, `#${issue.number} ${issue.title}`, pickIssue(sp, issue), { hint: hintFor(task, live) });
    }));
}

export const issuesDialog = {
  init(view, cx) {
    view.projectId = props().projectId;
    view.lists = {};
    for (const sp of reposOf(view.projectId)) load(view, sp, cx);
  },
  render(view, k) {
    const project = data().projects.find((p) => p.id === view.projectId);
    const repos = reposOf(view.projectId);
    const live = sessions();
    return v_flex().id("issues-dialog").p(20).gap(8)
      .child(dialogHeader(k, `Issues in ${project?.name ?? "the project"}`))
      .when(repos.length === 0, (el) => el.child(div().pt(8).text_size(13).text_color(k.muted).child("No repos in this project")))
      .children(repos.map((sp) => repoSection(view, k, sp, live)));
  },
};
