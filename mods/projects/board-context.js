// What a board shows: the project's group, its repos, the repo filter and the columns.
import { tasksByStatus } from "./model.js";

export function boardContext(view, model, projectId) {
  const group = model.groups.find((g) => g.project.id === projectId) ?? null;
  view.filters ??= {};
  const filter = group ? view.filters[group.project.id] ?? null : null;
  const columns = tasksByStatus(group?.tasks ?? [], filter);
  const sessionByTab = new Map(model.sessions.map((s) => [s.id, s]));
  return { group, filter, columns, repos: group?.subs.map((s) => s.sp) ?? [], sessionByTab };
}

export function setFilter(view, projectId, subprojectId, cx) {
  view.filters[projectId] = subprojectId;
  cx.notify();
}
