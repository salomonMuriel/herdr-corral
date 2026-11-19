// Dracula's palette (draculatheme.com/spec) mapped onto the roles the controls use.

const DRACULA = {
  background: "#282A36", darker: "#21222C", darkest: "#191A21", line: "#44475A", hover: "#343746",
  foreground: "#F8F8F2", comment: "#6272A4", muted: "#A4ACCB",
  // Comment is ~3.3:1 on the panels, too low for text; this lift clears 4.5:1 on bg and panel.
  commentText: "#8792C0",
  cyan: "#8BE9FD", green: "#50FA7B", orange: "#FFB86C", pink: "#FF79C6", purple: "#BD93F9", red: "#FF5555", yellow: "#F1FA8C",
};

export const PROJECT_COLORS = ["cyan", "green", "orange", "pink", "purple", "yellow"].map((k) => DRACULA[k]);

export const TOKENS = {
  font: "Geist", mono: "JetBrains Mono", radius: 6, controlRadius: 5,
  bg: DRACULA.background, panel: DRACULA.darker, field: DRACULA.darkest, line: DRACULA.line, hover: DRACULA.hover,
  ink: DRACULA.foreground, muted: DRACULA.muted, faint: DRACULA.commentText, dim: DRACULA.comment,
  primary: DRACULA.purple, primaryInk: DRACULA.darkest, danger: DRACULA.red, focus: DRACULA.purple,
  status: { working: DRACULA.purple, blocked: DRACULA.pink, done: DRACULA.green, idle: DRACULA.comment },
  columns: { todo: DRACULA.cyan, doing: DRACULA.purple, review: DRACULA.orange, done: DRACULA.green },
  importance: { urgent: DRACULA.red, high: DRACULA.orange, normal: DRACULA.comment, low: DRACULA.line },
  raw: DRACULA,
};

// A project without a stored color gets one from its id, so every view and the dialog agree.
export function projectColorSlot(project) {
  const size = PROJECT_COLORS.length;
  const stored = Number.parseInt(project?.color, 10);
  if (Number.isFinite(stored)) return stored % size;
  if (!project?.id) return null;
  return [...project.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % size;
}

export function projectColor(project, index = 0) {
  return PROJECT_COLORS[(projectColorSlot(project) ?? index) % PROJECT_COLORS.length];
}
