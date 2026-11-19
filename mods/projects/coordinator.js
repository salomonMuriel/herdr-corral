// A project's coordinator: one Claude Code session that plans the project's tasks, starts
// agents on them through runs and passes on what needs the person. Its tab is in coordinators.
import { exec, notify, run } from "herdr";
import { data, setLocal } from "./store.js";
import { transaction } from "./db.js";
import { sessions } from "./model.js";
import { canonical, execTarget, machineArg, machineLabel, repoPath, self } from "./machines.js";
import { herdrDo, selectSession, showWork } from "./actions.js";
import { agentsOn, loadAgents } from "./agents.js";
import { coordinatorAgent } from "./unattended.js";
import { coordinatorBrief } from "./coordinator-brief.js";
import { COORDINATOR_TITLE } from "./coordinator-labels.js";

export const liveCoordinator = (projectId, all = sessions()) => all.find((s) => s.coordinator === projectId) ?? null;

export async function startCoordinator(projectId) {
  const live = liveCoordinator(projectId);
  if (live) return selectSession(live);
  try {
    await launch(projectId, self());
  } catch (error) {
    notify({ title: "Couldn't start the coordinator", body: String(error.message ?? error), level: "error" });
  }
}

async function checkedOutRepo(repos, machine) {
  for (const sp of repos) {
    const folder = repoPath(sp, machine);
    if (!folder) continue;
    const check = await exec("test", ["-d", folder], { on: execTarget(machine) });
    if (check.code === 0) return { sp, folder };
  }
  return null;
}

async function claudeOn(machine) {
  const installed = agentsOn(machine).length ? agentsOn(machine) : await loadAgents(machine);
  const claude = installed.find((a) => a.key === "claude");
  if (!claude) throw new Error(`Claude Code isn't installed on ${machineLabel(machine)}`);
  return coordinatorAgent({ name: claude.name, run: claude.run }, machine);
}

// It reads from the main checkout of the first repo this machine has; the guard keeps it from writing there.
async function launch(projectId, machine) {
  const project = data().projects.find((p) => p.id === projectId);
  const repos = data().subprojects.filter((s) => s.project_id === projectId);
  if (!project) throw new Error("The project is gone");
  if (!repos.length) throw new Error("Add a repo to the project first");
  const checkout = await checkedOutRepo(repos, machine);
  if (!checkout) throw new Error(`None of ${project.name}'s repos is checked out on ${machineLabel(machine)}`);
  const agent = await claudeOn(machine);
  const launchArgs = ["--folder", checkout.folder, "--argv", JSON.stringify(agent.run), "--task", coordinatorBrief(project, repos, machine)];
  const space = sessions().find((s) => s.subprojectId === checkout.sp.id && s.machine === machine);
  const made = space
    ? await herdrDo(["tab.new", "--space", space.spaceId, ...launchArgs])
    : await herdrDo(["space.new", "--machine", machineArg(machine), "--name", checkout.sp.name, ...launchArgs]);
  run("tab.rename", { id: made.tab, name: COORDINATOR_TITLE });
  await save(projectId, machine, canonical(made.tab));
  if (made.space) run("space.select", { id: made.space });
  if (made.tab) run("tab.select", { id: made.tab });
  showWork();
}

async function save(projectId, machine, tab) {
  const others = (data().coordinators ?? []).filter((c) => c.project_id !== projectId);
  setLocal("coordinators", [...others, { project_id: projectId, machine, tab, note: null }]);
  await transaction([[`insert into coordinators (project_id, machine, tab) values ($1, $2, $3)
    on conflict (project_id) do update set machine = excluded.machine, tab = excluded.tab, note = null, noted_at = null, started_at = now()`,
  [projectId, machine, tab]]], "person");
}
