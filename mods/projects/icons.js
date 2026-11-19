// Project marks: an emoji or letters stored on the project, or an image stored on the board and
// cached per machine in the mod folder, where Herdr redraws images as they change.
import { appHome, exec, notify } from "herdr";
import { data, patchLocal, write } from "./store.js";
import { sql } from "./db.js";

const CACHE = "mods/projects/cache";
const IMAGE_TYPES = ["png", "jpg", "jpeg", "svg", "webp", "gif"];
const MAX_BYTES = 300000;

const parseImage = (icon) => {
  const [, version, ext] = String(icon ?? "").split(":");
  return version && ext ? { version, ext } : null;
};

export const isImageIcon = (icon) => String(icon ?? "").startsWith("image:");

export function iconImagePath(project) {
  if (!isImageIcon(project?.icon)) return null;
  const parsed = parseImage(project.icon);
  return parsed ? `${CACHE}/${project.id}-${parsed.version}.${parsed.ext}` : null;
}

export function iconText(project) {
  const icon = project?.icon;
  return icon && !isImageIcon(icon) ? icon : null;
}

async function exists(relative) {
  const result = await exec("test", ["-f", `${appHome()}/${relative}`]);
  return result.code === 0;
}

const cached = new Set();

// Writes any project image this machine hasn't cached yet.
export async function ensureIcons() {
  for (const project of data().projects) {
    const relative = iconImagePath(project);
    if (!relative || cached.has(relative)) continue;
    if (await exists(relative)) { cached.add(relative); continue; }
    const rows = await sql("select data from project_icons where project_id = $1", [project.id]);
    if (!rows[0]) continue;
    await exec("mkdir", ["-p", `${appHome()}/${CACHE}`]);
    const written = await exec("sh", ["-c", 'printf %s "$1" | base64 -d > "$2"', "sh", rows[0].data, `${appHome()}/${relative}`]);
    if (written.code === 0) cached.add(relative);
  }
}

// A dropped image file, checked and base64-encoded, or null after telling the person why.
export async function readProjectImage(path) {
  const ext = path.split(".").pop().toLowerCase();
  if (!IMAGE_TYPES.includes(ext)) {
    notify({ title: "Use a PNG, JPG, SVG, WebP or GIF", level: "warning" });
    return null;
  }
  try {
    const size = Number((await exec("wc", ["-c", path])).stdout.trim().split(/\s+/)[0]);
    if (size > MAX_BYTES) {
      notify({ title: "That image is too large", body: "Keep logos under 300 KB.", level: "warning" });
      return null;
    }
    const encoded = await exec("sh", ["-c", 'base64 < "$1" | tr -d "\\n"', "sh", path]);
    if (encoded.code !== 0) throw new Error(encoded.stderr);
    return { kind: ext === "jpeg" ? "jpg" : ext, data: encoded.stdout };
  } catch (error) {
    notify({ title: "Couldn't read that image", body: String(error.message ?? error), level: "error" });
    return null;
  }
}

// Goes through the write queue behind the project's own insert; ensureIcons caches the file
// after the next pull.
export function saveProjectImage(projectId, image) {
  const icon = `image:${Date.now().toString(36)}:${image.kind}`;
  patchLocal("projects", projectId, { icon });
  return write("save the logo", [
    ["insert into project_icons (project_id, ext, data) values ($1, $2, $3) on conflict (project_id) do update set ext = excluded.ext, data = excluded.data, updated_at = now()", [projectId, image.kind, image.data]],
    ["update projects set icon = $2, updated_at = now() where id = $1", [projectId, icon]],
  ]);
}
