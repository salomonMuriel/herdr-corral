// Terminal labels live in herdr-core, so every window and the Pi read the same values.
import { hc } from "herdr";

// The project a session was dragged to, when it isn't the one its folder belongs to.
export const PROJECT_LABEL = "herdr.project";

export async function setLabel(terminal, key, value) {
  const result = await hc(["label", terminal, `${key}=${value}`]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `hc label ${terminal} failed`);
}
