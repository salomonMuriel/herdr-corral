// Who checks a task before it counts as done (the person, a Claude code review, both or
// neither), and what its agent is told. Projects pick a mode; a task can override it, and a
// waiver in the person's own notes turns the person's review off.
import { data, update } from "./store.js";

export const REVIEW_MODES = ["every", "free", "per_task"];
export const REVIEW_MODE_LABEL = { every: "Review every task", free: "Free reign", per_task: "Choose per task" };

export const reviewModeOf = (project) => (REVIEW_MODES.includes(project?.review_mode) ? project.review_mode : "every");

const projectOf = (task) => data().projects.find((p) => p.id === task?.project_id) ?? null;

const modeDefault = (mode) => mode !== "free";

export function needsReview(task, project = projectOf(task)) {
  if (task?.review_waived) return false;
  if (typeof task?.needs_review === "boolean") return task.needs_review;
  return modeDefault(reviewModeOf(project));
}

// A choice that matches the project's mode is stored as no override, so it follows later mode changes.
export function overrideFor(on, project) {
  return on === modeDefault(reviewModeOf(project)) ? null : on;
}

export function codeReviewOn(task, project = projectOf(task)) {
  if (typeof task?.code_review === "boolean") return task.code_review;
  return project?.code_review === true;
}

export const codeOverrideFor = (on, project) => (on === (project?.code_review === true) ? null : on);

export const REVIEW_KINDS = ["none", "code", "person", "both"];
export const REVIEW_KIND_LABEL = { none: "None", code: "Code review", person: "Your review", both: "Both" };
export const kindOf = (person, code) => (person ? (code ? "both" : "person") : code ? "code" : "none");
export const kindParts = (kind) => ({ person: kind === "person" || kind === "both", code: kind === "code" || kind === "both" });

// A project's choice is one of the four kinds, or per_task, where each card picks.
export const projectKindOf = (project) => (reviewModeOf(project) === "per_task" ? "per_task" : kindOf(reviewModeOf(project) === "every", project?.code_review === true));

export function projectReviewFields(kind) {
  if (kind === "per_task") return { review_mode: "per_task", code_review: false };
  const { person, code } = kindParts(kind);
  return { review_mode: person ? "every" : "free", code_review: code };
}

export function setNeedsReview(task, on) {
  return update("tasks", task.id, { needs_review: overrideFor(on, projectOf(task)) });
}

const PERMISSION = /\b(just|go ahead and|feel free to|you can|you may|ok to|okay to|allowed to)\s+(\w+\s+){0,2}?(deploy|ship|release|push|merge)\b/i;
const IMPERATIVE = /^(and |then |also |please )*(deploy|ship it|release it|push (it |this )?to main|merge (it |this )?(in)?to main)\b/i;
const NO_REVIEW = /\bskip (the |my |a )?review\b|\bwithout (my|a) review\b|\bno review (needed|necessary)\b|\bno need (for me )?to review\b|\bdo(n'?t| not) need (my |a )?review\b/i;
const SPANISH = /^(y |luego |después )*(despliega|deploya|sube|publica)\b.*\b(prod|producci[oó]n|main)\b|\bsin (mi )?revisi[oó]n\b|\bno (hace falta|necesito|tengo) que revis/i;

const NEGATED = /\b(not|don'?t|do not|never|no|nunca)\b(\W+\w+){0,3}?\W+(deploy|push|ship|merge|release|despliegues|subas|publiques)\b/i;
const clauses = (sentence) => sentence.split(",").map((c) => c.trim()).filter(Boolean);
// Quoted text is an example or a mention, not an instruction.
const QUOTED = /"[^"]*"|“[^”]*”|‘[^’]*’|(^|[\s(])'.*?'(?=[\s).,:;!?]|$)/g;

function isWaiver(sentence) {
  const said = sentence.replace(QUOTED, "$1…");
  if (NO_REVIEW.test(said)) return true;
  if (NEGATED.test(said)) return false;
  return PERMISSION.test(said) || clauses(said).some((c) => IMPERATIVE.test(c) || SPANISH.test(c));
}

// The sentence in the person's instructions that waives review, if any, quoted as written.
export function findWaiver(text) {
  const sentences = String(text ?? "").split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  return sentences.find(isWaiver)?.replace(/[.;]$/, "") ?? null;
}

// An imported issue's text was written by whoever opened the issue, so it never waives review.
export function waiverFields(title, notes, issueUrl = null) {
  if (issueUrl) return { review_waived: false, waiver_quote: null };
  const quote = findWaiver(`${title}\n${notes}`);
  return { review_waived: Boolean(quote), waiver_quote: quote };
}

const GATED = "hb done moves the card to Review for me to check, so done means waiting for review, not deployed: don't deploy, push to main or run production migrations, and use hb ask if the task seems to need one of those.";
const FREE = "hb done moves the card straight to Done, so finish the whole job within this task: merge your branch into main and push it. Don't run a deploy unless I ask you to (working on deploy code is fine); I deploy from main.";
const CODE_FIRST = "hb done first starts a code review of your branch against main, so commit your work before it and don't merge yet. Findings come back to you here as a message: fix each one, commit, and run hb done again.";
const CODE_GATED = `${CODE_FIRST} Once the review passes the card moves to Review for me to check. Don't deploy, push to main or run production migrations, and use hb ask if the task seems to need one of those.`;
const CODE_FREE = `${CODE_FIRST} When the review passes you're told to merge: then merge your branch into main, push it, and run hb done once more, which moves the card to Done. Don't deploy unless I ask you to; I deploy from main.`;

function modeLine(task, project) {
  if (task.review_waived) return `Review: waived for this task ("${task.waiver_quote}").`;
  const mode = reviewModeOf(project);
  if (typeof task.needs_review === "boolean" || mode === "per_task") return `Review: ${needsReview(task, project) ? "I review this task" : "off for this task"}.`;
  return mode === "free" ? "Review: free reign on this project, no review from me." : "Review: I review every task on this project.";
}

function rule(task, project) {
  const person = needsReview(task, project);
  if (!codeReviewOn(task, project)) return person ? GATED : FREE;
  return person ? CODE_GATED : CODE_FREE;
}

// The first message's last lines: the mode, and what hb done means under it.
export function reviewNote(task, project = projectOf(task)) {
  const code = codeReviewOn(task, project) ? " Code review: on." : "";
  return `${modeLine(task, project)}${code} ${rule(task, project)} Stop after hb done.`;
}
