// Tells the other windows to pull. Windows only pull on their own when they come forward, so
// every write made on this machine is announced to the others this way.
import { exec } from "herdr";
import { machineInfo, self } from "./machines.js";

export async function nudgeMachine(machine) {
  const home = machineInfo().homes?.[machine];
  if (!home) return;
  try {
    await exec(`${home}/.local/bin/herdr-app`, ["do", "projects.pull"], { on: machine });
  } catch (error) {
    console.error(`Couldn't tell ${machine} to pull:`, error);
  }
}

export async function nudgeOthers() {
  const others = (machineInfo().names ?? []).filter((name) => name && name !== self());
  await Promise.all(others.map(nudgeMachine));
}
