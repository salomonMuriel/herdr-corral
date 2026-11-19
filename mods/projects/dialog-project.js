// Create or edit a project: name, kind, color, and its repos. Repos are picked from the
// folders in ~/git on every machine, so the same repo name works from both. Repos grouped
// one folder down are offered as "<group>/<repo>".
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, exec, shared, setShared } from "herdr";
import { iconText, isImageIcon, readProjectImage, saveProjectImage } from "./icons.js";
import { projectMark } from "./skins/parts.js";
import { data, update, createProject, createSubproject, removeRow, KINDS } from "./store.js";
import { machineInfo, execTarget, machineLabel, repoNameOf } from "./machines.js";
import { REPO_NAME, createRepo } from "./create-repo.js";
import { PROJECT_COLORS, projectColorSlot } from "./skins/tokens.js";
import { button, chip, fieldLabel, fieldFrame, close, dialogHeader, icon } from "./controls.js";
import { REVIEW_KINDS, REVIEW_KIND_LABEL, projectKindOf, projectReviewFields } from "./review.js";

const KIND_NAME = { company: "Company", client: "Client", side: "Side project" };
const REVIEW_CHOICES = [...REVIEW_KINDS.map((kind) => [kind, REVIEW_KIND_LABEL[kind]]), ["per_task", "Choose per task"]];
const REPOS_KEY = "projects.repos";
const LIST_REPOS = `cd "$1" || exit 1
for d in */; do [ -d "$d" ] && echo "\${d%/}"; done
for g in */*/.git; do [ -e "$g" ] && echo "\${g%/.git}"; done`;

async function loadRepoNames(view, cx) {
  const info = machineInfo();
  const found = { ...(shared(REPOS_KEY) ?? {}) };
  for (const machine of info.names ?? []) {
    const base = info.homes?.[machine];
    if (!base) continue;
    try {
      const result = await exec("sh", ["-c", LIST_REPOS, "sh", `${base}/git`], { on: execTarget(machine) });
      if (result.code === 0) found[machine] = result.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    } catch { /* that machine is away; keep what it listed last time */ }
  }
  setShared(REPOS_KEY, found);
  cx.notify();
}

export function init(view, cx) {
  const p = props();
  const project = data().projects.find((x) => x.id === p.projectId) ?? null;
  view.project = project;
  view.kind = project?.kind ?? "company";
  view.reviewKind = projectKindOf(project);
  view.color = project ? projectColorSlot(project) : data().projects.length % PROJECT_COLORS.length;
  view.repos = data().subprojects.filter((s) => s.project_id === project?.id).map((s) => ({ ...s }));
  view.removed = [];
  if (p.folder) {
    const repo = repoNameOf(p.folder, p.machine);
    view.repos.push({ name: repo.split("/").pop(), repo, paths: { [p.machine]: p.folder } });
  }
  view.name = InputState.new({ placeholder: "Company, client or side project", value: project?.name ?? "" });
  view.iconInput = InputState.new({ placeholder: "Emoji or two letters", value: iconText(project) ?? "" });
  view.keepImage = isImageIcon(project?.icon);
  view.pendingImage = null;
  view.query = InputState.new({ placeholder: "Add a repo from ~/git, or name a new one" });
  view.creating = null;
  view.createError = null;
  view.focus = "name";
  for (const [name, input] of [["name", view.name], ["query", view.query], ["icon", view.iconInput]]) {
    input.on("focus", (_e, cx) => { view.focus = name; cx.notify(); });
    input.on("change", (_e, cx) => cx.notify());
  }
  view.query.on("submit", (_e, cx) => {
    const first = suggestions(view)[0];
    if (first) return addRepo(view, first.name, cx);
    const created = newRepoName(view);
    if (created) startCreate(view, created, cx);
  });
  view.name.on("submit", () => save(view));
  view.keepsFocus = true;
  view.name.focus();
  cx.spawn(async (cx) => loadRepoNames(view, cx));
}

function suggestions(view) {
  const query = view.query.value().trim().toLowerCase();
  const byName = new Map();
  for (const [machine, names] of Object.entries(shared(REPOS_KEY) ?? {})) {
    for (const name of names) {
      if (query && !name.toLowerCase().includes(query)) continue;
      if (view.repos.some((r) => r.repo === name)) continue;
      byName.set(name, [...(byName.get(name) ?? []), machine]);
    }
  }
  return [...byName.entries()].map(([name, machines]) => ({ name, machines })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 6);
}

function addRepo(view, name, cx) {
  view.repos.push({ name: name.split("/").pop(), repo: name, paths: {} });
  view.query.set_value("");
  cx.notify();
}

// A typed name that isn't a repo yet. Without a group it joins the one this project's
// repos share, so "crm" in a project of acme/* repos is acme/crm.
function newRepoName(view) {
  const typed = view.query.value().trim().replace(/^\/+|\/+$/g, "");
  if (!REPO_NAME.test(typed)) return null;
  const groups = new Set(view.repos.map((r) => (r.repo?.includes("/") ? r.repo.split("/")[0] : "")));
  const group = groups.size === 1 ? [...groups][0] : "";
  const name = !typed.includes("/") && group ? `${group}/${typed}` : typed;
  const known = Object.values(shared(REPOS_KEY) ?? {}).some((names) => names.includes(name));
  return known || view.repos.some((r) => r.repo === name) ? null : name;
}

function startCreate(view, name, cx) {
  if (view.creating) return;
  view.creating = name;
  view.createError = null;
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      await createRepo(name);
      addRepo(view, name, cx);
    } catch (error) {
      view.createError = error.message;
    }
    view.creating = null;
    cx.notify();
  });
}

function chosenIcon(view) {
  const text = [...view.iconInput.value().trim()].slice(0, 2).join("");
  if (text) return text;
  const current = data().projects.find((p) => p.id === view.project?.id)?.icon;
  return view.keepImage && isImageIcon(current) ? current : null;
}

// A dropped logo is read before anything is written, so the dialog can close right after.
async function save(view) {
  const name = view.name.value().trim();
  if (!name || view.saving) return;
  view.saving = true;
  const image = await view.pendingImage?.read;
  const fields = { name, kind: view.kind, color: String(view.color), icon: chosenIcon(view), ...projectReviewFields(view.reviewKind) };
  const project = view.project ? (update("projects", view.project.id, fields), view.project) : createProject(fields);
  for (const repo of view.repos) {
    if (!repo.id) createSubproject({ projectId: project.id, name: repo.name, repo: repo.repo, paths: repo.paths });
  }
  for (const id of view.removed) removeRow("subprojects", id);
  if (image) saveProjectImage(project.id, image);
  close();
}

function repoRow(view, k, repo, index) {
  const where = Object.entries(repo.paths ?? {}).map(([m]) => machineLabel(m)).join(", ");
  return h_flex().id(`repo-${index}`).h(32).px(10).gap(10).items_center().rounded(k.controlRadius).bg(k.panel)
    .child(icon("folder", 14, k.dim))
    .child(div().flex_1().min_w(0).truncate().text_size(13).child(repo.name))
    .when(Boolean(where), (el) => el.child(div().text_size(11.5).text_color(k.faint).child(`path set on ${where}`)))
    .child(div().id(`repo-remove-${index}`).p(4).rounded(4).cursor_pointer().text_color(k.faint).hover((s) => s.bg(k.hover).text_color(k.ink))
      .on_click((_e, cx) => {
        if (repo.id) view.removed.push(repo.id);
        view.repos.splice(index, 1);
        cx.notify();
      })
      .child(icon("x", 12, k.dim)));
}

export function render(view, k) {
  const options = view.focus === "query" || view.query.value() ? suggestions(view) : [];
  return v_flex().id("project-dialog").p(20)
    .child(dialogHeader(k, view.project ? "Project" : "New project"))
    .child(fieldLabel(k, "Name"))
    .child(fieldFrame(k, Input.new(view.name).h(36), view.focus === "name"))
    .child(fieldLabel(k, "Kind"))
    .child(h_flex().gap(6).children(KINDS.map((kind) => chip(k, `kind-${kind}`, KIND_NAME[kind], view.kind === kind, (cx) => { view.kind = kind; cx.notify(); }))))
    .child(fieldLabel(k, "Review"))
    .child(h_flex().gap(6).flex_wrap().children(REVIEW_CHOICES.map(([kind, label]) => chip(k, `review-${kind}`, label, view.reviewKind === kind, (cx) => { view.reviewKind = kind; cx.notify(); }))))
    .child(fieldLabel(k, "Mark"))
    .child(iconField(view, k))
    .child(fieldLabel(k, "Color"))
    .child(h_flex().gap(8).children(PROJECT_COLORS.map((color, i) => div().id(`color-${i}`).size(24).rounded(6).bg(color).cursor_pointer()
      .border(2).border_color(view.color === i ? k.focus : k.bg)
      .on_click((_e, cx) => { view.color = i; cx.notify(); }))))
    .child(fieldLabel(k, "Repos"))
    .child(v_flex().gap(4).children(view.repos.map((repo, i) => repoRow(view, k, repo, i))))
    .child(div().pt(view.repos.length ? 6 : 0).child(fieldFrame(k, Input.new(view.query).h(34), view.focus === "query")))
    .when(options.length > 0, (el) => el.child(v_flex().pt(4).gap(2).children(options.map((o) => h_flex().id(`suggest-${o.name}`).h(30).px(10).gap(10).items_center()
      .rounded(k.controlRadius).cursor_pointer().hover((s) => s.bg(k.hover))
      .on_click((_e, cx) => addRepo(view, o.name, cx))
      .child(icon("plus", 12, k.dim))
      .child(div().flex_1().truncate().text_size(13).child(o.name))
      .child(div().text_size(11.5).text_color(k.faint).child(o.machines.map(machineLabel).join(" · ")))))))
    .child(createRepoRow(view, k))
    .child(h_flex().pt(24).gap(8).items_center()
      .when(Boolean(view.project), (el) => el.child(button(k, "project-archive", "Archive", "danger", () => { update("projects", view.project.id, { archived: true }); close(); })))
      .child(div().flex_1())
      .child(button(k, "project-cancel", "Cancel", "quiet", () => close()))
      .child(button(k, "project-save", view.project ? "Save" : "Create project", "primary", () => save(view))));
}

function createRepoRow(view, k) {
  const name = view.creating ? null : newRepoName(view);
  return v_flex().pt(2).gap(2)
    .when(Boolean(view.creating), (el) => el.child(h_flex().h(30).px(10).items_center().text_size(13).text_color(k.muted)
      .child(`Creating ${view.creating}…`)))
    .when(Boolean(name), (el) => el.child(h_flex().id("create-repo").h(30).px(10).gap(10).items_center()
      .rounded(k.controlRadius).cursor_pointer().hover((s) => s.bg(k.hover))
      .on_click((_e, cx) => startCreate(view, name, cx))
      .child(icon("plus", 12, k.dim))
      .child(div().flex_1().truncate().text_size(13).child(`Create ${name}`))
      .child(div().text_size(11.5).text_color(k.faint).child("private on GitHub"))))
    .when(Boolean(view.createError), (el) => el.child(div().px(10).text_size(12).text_color(k.danger).child(view.createError)));
}

async function dropOnProject(view, path) {
  const image = await readProjectImage(path);
  if (!image) return;
  saveProjectImage(view.project.id, image);
  view.keepImage = true;
}

// The mark: type an emoji or letters, or drop an image file on the well.
function iconField(view, k) {
  const preview = { ...(view.project ?? {}), id: view.project?.id ?? "new", name: view.name.value() || "?", color: String(view.color), icon: chosenIcon(view) };
  const dropped = view.pendingImage?.path.split("/").pop();
  return h_flex().gap(12).items_center()
    .child(div().id("icon-well").p(4).rounded(10).border_1().border_dashed().border_color(k.line)
      .on_drop((event, cx) => {
        const path = event.paths?.[0];
        if (!path) return;
        view.iconInput.set_value("");
        if (view.project) cx.spawn(async (cx) => { await dropOnProject(view, path); cx.notify(); });
        else view.pendingImage = { path, read: readProjectImage(path) };
        cx.notify();
      })
      .child(projectMark(k, preview, view.color, 44)))
    .child(v_flex().flex_1().gap(6)
      .child(fieldFrame(k, Input.new(view.iconInput).h(32), view.focus === "icon"))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(11.5).text_color(k.faint).child(dropped ? `${dropped} will be used` : "Drop a logo on the mark to use an image"))
        .when(view.keepImage || Boolean(view.pendingImage) || Boolean(view.iconInput.value()), (el) => el.child(div().id("icon-clear").text_size(11.5).text_color(k.muted).cursor_pointer().hover((s) => s.text_color(k.ink))
          .on_click((_e, cx) => { view.keepImage = false; view.pendingImage = null; view.iconInput.set_value(""); cx.notify(); }).child("Clear")))));
}
