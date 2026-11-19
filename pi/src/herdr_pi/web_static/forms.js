import { api, showResult } from "./api.js";

let projects = [];

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

export function updateTargets(agents) {
  const select = document.getElementById("instruct-target");
  const chosen = select.value;
  const sorted = [...agents].sort((a, b) => a.machine.localeCompare(b.machine) || a.title.localeCompare(b.title));
  const groups = new Map();
  for (const agent of sorted) {
    if (!groups.has(agent.machine)) {
      const group = document.createElement("optgroup");
      group.label = agent.machine;
      groups.set(agent.machine, group);
    }
    const state = agent.need === "blocked" ? "blocked" : agent.state;
    groups.get(agent.machine).append(option(agent.id, `${agent.title} (${agent.address}, ${state})`));
  }
  select.replaceChildren(option("", "Session"), ...groups.values());
  select.firstElementChild.disabled = true;
  select.value = sorted.some((agent) => agent.id === chosen) ? chosen : "";
}

function fillSubprojects() {
  const project = projects.find((entry) => entry.id === document.getElementById("task-project").value);
  const select = document.getElementById("task-subproject");
  const subprojects = project?.subprojects || [];
  select.replaceChildren(option("", "No subproject"), ...subprojects.map((sub) => option(sub.id, sub.name)));
  select.hidden = subprojects.length === 0;
}

async function loadProjects() {
  const select = document.getElementById("task-project");
  try {
    projects = await api("/api/projects");
    select.replaceChildren(option("", "Project"), ...projects.map((project) => option(project.id, project.name)));
    select.firstElementChild.disabled = true;
    select.value = "";
  } catch (error) {
    select.replaceChildren(option("", error.message));
  }
  fillSubprojects();
}

async function submitInstruct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const result = form.querySelector(".result");
  const target = document.getElementById("instruct-target").value;
  const textarea = document.getElementById("instruct-text");
  const slash = target.indexOf("/");
  try {
    await api("/api/send", { machine: target.slice(0, slash), address: target.slice(slash + 1), text: textarea.value.trim() });
    textarea.value = "";
    showResult(result, "Sent");
  } catch (error) {
    showResult(result, error.message, true);
  }
}

async function submitTask(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const result = form.querySelector(".result");
  const title = document.getElementById("task-title");
  const notes = document.getElementById("task-notes");
  try {
    const task = await api("/api/tasks", {
      project_id: document.getElementById("task-project").value,
      subproject_id: document.getElementById("task-subproject").value || null,
      title: title.value.trim(),
      notes: notes.value.trim(),
    });
    title.value = "";
    notes.value = "";
    showResult(result, `Added ${task.title}`);
  } catch (error) {
    showResult(result, error.message, true);
  }
}

export function setupForms() {
  document.getElementById("instruct").addEventListener("submit", submitInstruct);
  document.getElementById("add-task").addEventListener("submit", submitTask);
  document.getElementById("task-project").addEventListener("change", fillSubprojects);
  loadProjects();
}
