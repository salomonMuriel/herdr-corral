// Create or edit a task: title, notes, repo, importance, review, column, what it waits on and
// which branch a run starts it from; start an agent on it. Below, the card's history.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { props } from "herdr";
import { data, update, createTask, removeRow, moveTask, STATUSES, STATUS_LABEL, IMPORTANCE, IMPORTANCE_LABEL } from "./store.js";
import { initDeps, saveDeps, depsField } from "./dialog-deps.js";
import { startPopup } from "./start-guard.js";
import { button, chip, fieldLabel, fieldFrame, close, dialogHeader } from "./controls.js";
import { needsReview, overrideFor, waiverFields, codeReviewOn, codeOverrideFor, REVIEW_KINDS, REVIEW_KIND_LABEL, kindOf, kindParts } from "./review.js";
import { waiverLine } from "./skins/review-parts.js";
import { BASES, BASE_LABEL } from "./chain.js";
import { initTaskHistory, taskHistorySection } from "./dialog-history.js";
import { otherRepos, setOtherRepos } from "./task-repos.js";
import { issueNumber, openUrl } from "./issues.js";

const REPORT_LABEL = { done: "Agent's summary", ask: "Agent asks", note: "Agent's note" };

export function init(view, cx) {
  const p = props();
  const task = data().tasks.find((t) => t.id === p.taskId) ?? null;
  view.task = task;
  view.projectId = task?.project_id ?? p.projectId;
  view.subprojectId = task?.subproject_id ?? p.subprojectId ?? null;
  view.otherRepoIds = task ? otherRepos(task.id).map((r) => r.subproject_id) : [];
  view.status = task?.status ?? p.status ?? "todo";
  view.importance = task?.importance ?? "normal";
  view.needsReview = needsReview(task ?? { project_id: view.projectId });
  view.codeReview = codeReviewOn(task ?? { project_id: view.projectId });
  view.base = task?.base ?? "main";
  initDeps(view);
  initTaskHistory(view, cx, init);
  view.title = InputState.new({ placeholder: "What needs doing", value: task?.title ?? "" });
  view.notes = TextareaState.new({ placeholder: "Details the agent should know", value: task?.notes ?? "", rows: 5 });
  view.notes.set_auto_grow(4, 10);
  view.focus = "title";
  for (const [name, input] of [["title", view.title], ["notes", view.notes]]) {
    input.on("focus", (_e, cx) => { view.focus = name; cx.notify(); });
    input.on("change", (_e, cx) => cx.notify());
  }
  view.title.on("submit", () => save(view));
  view.keepsFocus = true;
  view.title.focus();
}

function save(view) {
  const title = view.title.value().trim();
  if (!title) return null;
  const notes = view.notes.value().trim();
  const project = projectOf(view);
  const review = { needs_review: overrideFor(view.needsReview, project), code_review: codeOverrideFor(view.codeReview, project), ...waiverFields(title, notes, view.task?.issue_url) };
  const fields = { title, notes, subproject_id: view.subprojectId, status: view.status, importance: view.importance, ...review, base: view.base };
  const saved = view.task
    ? saveChanges(view.task, fields)
    : createTask({ projectId: view.projectId, subprojectId: view.subprojectId, title, notes, status: view.status, importance: view.importance, review, base: view.base });
  saveDeps(view, saved.id);
  setOtherRepos(saved.id, view.subprojectId, view.subprojectId ? view.otherRepoIds : []);
  close();
  return saved;
}

// Only what the person changed: the agent may have moved the card while the dialog was open.
function saveChanges(task, fields) {
  const changes = Object.fromEntries(Object.entries(fields).filter(([key, value]) => task[key] !== value));
  if (Object.keys(changes).length > 0) update("tasks", task.id, changes);
  return data().tasks.find((t) => t.id === task.id) ?? { ...task, ...changes };
}

const projectOf = (view) => data().projects.find((p) => p.id === view.projectId) ?? null;

// A waiver in the notes rules out the person's review, so only the code review is left to pick.
function reviewField(view, k) {
  const { waiver_quote: quote } = waiverFields(view.title.value(), view.notes.value(), view.task?.issue_url);
  const kinds = quote ? ["none", "code"] : REVIEW_KINDS;
  const current = kindOf(view.needsReview && !quote, view.codeReview);
  const pick = (kind) => (cx) => {
    const parts = kindParts(kind);
    if (!quote) view.needsReview = parts.person;
    view.codeReview = parts.code;
    cx.notify();
  };
  return v_flex().gap(8)
    .when(Boolean(quote), (el) => el.child(waiverLine(k, quote)))
    .child(h_flex().gap(6).flex_wrap()
      .children(kinds.map((kind) => chip(k, `review-${kind}`, REVIEW_KIND_LABEL[kind], current === kind, pick(kind)))));
}

function findingsField(view, k) {
  return v_flex()
    .child(fieldLabel(k, "Code review findings"))
    .child(div().text_size(12.5).text_color(k.ink).child(view.task.code_review_findings));
}

function pickLead(view, id) {
  view.subprojectId = id;
  view.otherRepoIds = view.otherRepoIds.filter((other) => other !== id);
}

function repoField(view, k, repos) {
  return h_flex().gap(6).flex_wrap()
    .child(chip(k, "repo-none", "Whole project", !view.subprojectId, (cx) => { pickLead(view, null); cx.notify(); }))
    .children(repos.map((sp) => chip(k, `repo-${sp.id}`, sp.name, view.subprojectId === sp.id, (cx) => { pickLead(view, sp.id); cx.notify(); })));
}

// Repos with an agent of this task in them stay on: the agent is tied to the task there.
function otherReposField(view, k, repos) {
  const started = new Set(view.task ? otherRepos(view.task.id).filter((r) => r.tab).map((r) => r.subproject_id) : []);
  const toggle = (id) => (cx) => {
    if (started.has(id)) return;
    view.otherRepoIds = view.otherRepoIds.includes(id) ? view.otherRepoIds.filter((x) => x !== id) : [...view.otherRepoIds, id];
    cx.notify();
  };
  return h_flex().gap(6).flex_wrap()
    .children(repos.filter((sp) => sp.id !== view.subprojectId)
      .map((sp) => chip(k, `also-${sp.id}`, sp.name, view.otherRepoIds.includes(sp.id), toggle(sp.id))));
}

function issueField(view, k) {
  const url = view.task.issue_url;
  return v_flex()
    .child(fieldLabel(k, `Issue #${issueNumber(url)}`))
    .child(h_flex().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(k.muted).child(url))
      .child(button(k, "task-issue-open", "Open", "plain", () => openUrl(url))));
}

function baseField(view, k) {
  const pick = (base) => (cx) => { view.base = base; cx.notify(); };
  return h_flex().gap(6).flex_wrap()
    .children(BASES.map((base) => chip(k, `base-${base}`, BASE_LABEL[base], view.base === base, pick(base))));
}

function hasUnstartedRepo(view) {
  if (!view.task?.tab) return true;
  const started = new Set(otherRepos(view.task.id).filter((r) => r.tab).map((r) => r.subproject_id));
  return view.otherRepoIds.some((id) => !started.has(id));
}

function startAgent(view) {
  const saved = save(view);
  if (saved) startPopup({ ...saved, project_id: view.projectId });
}

export function render(view, k) {
  const db = data();
  const project = db.projects.find((p) => p.id === view.projectId);
  const repos = db.subprojects.filter((s) => s.project_id === view.projectId);
  const canStart = hasUnstartedRepo(view) && view.status !== "done" && repos.length > 0;
  const hasTitle = view.title.value().trim().length > 0;
  return v_flex().id("task-dialog").p(20).gap(0)
    .child(dialogHeader(k, view.task ? "Task" : `New task in ${project?.name ?? "project"}`))
    .child(fieldLabel(k, "Title"))
    .child(fieldFrame(k, Input.new(view.title).h(36), view.focus === "title"))
    .when(Boolean(view.task?.report), (el) => el
      .child(fieldLabel(k, REPORT_LABEL[view.task.report_kind] ?? "Agent's note"))
      .child(div().p(12).rounded(k.radius).bg(k.panel).text_size(13).text_color(k.ink).child(TextView.markdown(`report-${view.task.id}`, view.task.report))))
    .when(Boolean(view.task?.issue_url), (el) => el.child(issueField(view, k)))
    .when(Boolean(view.task?.code_review_findings), (el) => el.child(findingsField(view, k)))
    .child(fieldLabel(k, "Notes"))
    .child(fieldFrame(k, Textarea.new(view.notes).py(8), view.focus === "notes"))
    .when(repos.length > 0, (el) => el
      .child(fieldLabel(k, "Repo"))
      .child(repoField(view, k, repos)))
    .when(repos.length > 1 && Boolean(view.subprojectId), (el) => el
      .child(fieldLabel(k, "Also in"))
      .child(otherReposField(view, k, repos)))
    .child(fieldLabel(k, "Importance"))
    .child(h_flex().gap(6).flex_wrap()
      .children(IMPORTANCE.map((level) => chip(k, `importance-${level}`, IMPORTANCE_LABEL[level], view.importance === level, (cx) => { view.importance = level; cx.notify(); }, k.importance[level]))))
    .child(fieldLabel(k, "Review"))
    .child(reviewField(view, k))
    .child(fieldLabel(k, "Waits on"))
    .child(depsField(view, k))
    .when(repos.length > 0 && view.status === "todo" && view.deps.length > 0, (el) => el
      .child(fieldLabel(k, "Starts from"))
      .child(baseField(view, k)))
    .child(fieldLabel(k, "Column"))
    .child(h_flex().gap(6).flex_wrap()
      .children(STATUSES.map((s) => chip(k, `status-${s}`, STATUS_LABEL[s], view.status === s, (cx) => { view.status = s; cx.notify(); }, k.columns[s]))))
    .child(h_flex().pt(24).gap(8).items_center()
      .when(Boolean(view.task), (el) => el.child(button(k, "task-delete", "Delete", "danger", () => { removeRow("tasks", view.task.id); close(); })))
      .child(div().flex_1())
      .child(button(k, "task-cancel", "Cancel", "quiet", () => close()))
      .when(view.task?.status === "review", (el) => el.child(button(k, "task-approve", "Approve", "plain", () => { moveTask(view.task.id, "done"); close(); })))
      .when(canStart && hasTitle, (el) => el.child(button(k, "task-start", "Save and start agent", "plain", () => startAgent(view))))
      .child(button(k, "task-save", "Save", "primary", () => save(view))))
    .when(Boolean(view.task), (el) => el.child(taskHistorySection(view, k)));
}
