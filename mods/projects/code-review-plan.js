// What a finished code review round leads to, and the messages its agent gets. No Herdr
// imports, so it can be checked on its own.
export const MAX_ROUNDS = 3;

export const IN_FLIGHT = new Set(["queued", "running"]);

export const PASSED_MESSAGE = "Code review passed. Merge your branch into main and push it, then run hb done again.";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function findingsText(findings) {
  return findings.map((f, i) => `${i + 1}. ${f.file}${f.line ? `:${f.line}` : ""}: ${f.problem}`).join("\n");
}

export function findingsMessage(findings, round) {
  return `Code review round ${round} of ${MAX_ROUNDS} found ${plural(findings.length, "issue")} on your branch:\n\n${findingsText(findings)}\n\nFix each one, commit, and run hb done again.`;
}

const askPerson = (open, report, findings = null) => ({ state: "failed", open, findings, report, status: "review" });

// result: what agent/code_review.py wrote. needsReview: the person reviews after the code
// review. hasAgent: the task's agent session is still open to take a message.
export function outcome({ result, round, needsReview, hasAgent }) {
  if (!result?.ok) return askPerson(null, `Code review couldn't run: ${result?.error ?? "no result"}`);
  const findings = result.findings ?? [];
  const open = findings.length;
  const text = open ? findingsText(findings) : null;
  if (!open && needsReview) return { state: "passed", open: 0, findings: null, status: "review" };
  if (!open && !hasAgent) return askPerson(0, "Code review passed, but the task's session is closed, so nobody merged it");
  if (!open) return { state: "passed", open: 0, findings: null, message: PASSED_MESSAGE };
  if (round >= MAX_ROUNDS) return askPerson(open, `Code review: ${open} open after ${plural(round, "round")}`, text);
  if (!hasAgent) return askPerson(open, `Code review: ${open} open, and the task's session is closed`, text);
  return { state: "fixing", open, findings: text, message: findingsMessage(findings, round) };
}

// The card's line for a task's code review, or null when it has none.
export function codeReviewText(task) {
  const { code_review_state: state, code_review_round: round, code_review_open: open } = task;
  if (state === "queued") return "Code review queued";
  if (state === "running") return `Code review running, round ${round} of ${MAX_ROUNDS}`;
  if (state === "fixing") return `Code review: ${open} open, agent fixing (round ${round} of ${MAX_ROUNDS})`;
  if (state === "passed") return "Code review passed";
  if (state === "failed" && open > 0) return `Code review: ${open} open after ${plural(round, "round")}`;
  if (state === "failed" && open === 0) return "Code review passed, not merged";
  if (state === "failed") return "Code review couldn't finish";
  return null;
}
