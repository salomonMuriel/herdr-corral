import { api, showResult } from "./api.js";

const ANSWERED = { allow: "Allowed", always: "Allowed from now on", deny: "Denied" };

async function answer(card, decision) {
  const { approval } = card;
  if (!approval) return;
  const message = decision === "deny" ? card.approvalParts.reason.value.trim() : "";
  setButtons(card, true);
  try {
    await api(`/api/approvals/${encodeURIComponent(approval.id)}/answer`, { decision, message: message || null });
    showResult(card.result, ANSWERED[decision]);
    card.approvalParts.box.hidden = true;
    card.approval = null;
    card.answeredId = approval.id;
  } catch (error) {
    showResult(card.result, error.message, true);
    setButtons(card, false);
  }
}

function setButtons(card, disabled) {
  card.approvalParts.box.querySelectorAll("button").forEach((button) => (button.disabled = disabled));
}

export function setupApproval(card) {
  const box = card.element.querySelector(".approval");
  card.approvalParts = {
    box,
    summary: box.querySelector(".approval-summary"),
    detail: box.querySelector(".approval-detail"),
    reason: box.querySelector(".approval-reason"),
    always: box.querySelector(".always"),
  };
  box.querySelector(".allow").addEventListener("click", () => answer(card, "allow"));
  card.approvalParts.always.addEventListener("click", () => answer(card, "always"));
  box.querySelector(".deny").addEventListener("click", () => answer(card, "deny"));
}

// Filled once per request, so a reason being typed survives the next poll.
export function fillApproval(card, approval) {
  const parts = card.approvalParts;
  const showing = approval && approval.id !== card.answeredId ? approval : null;
  if (showing?.id === card.approval?.id) return;
  card.approval = showing;
  parts.box.hidden = !showing;
  if (!showing) return;
  parts.summary.textContent = showing.summary ? `${showing.tool}: ${showing.summary}` : showing.tool;
  parts.detail.textContent = showing.detail || "";
  parts.reason.value = "";
  parts.always.hidden = !showing.always_label;
  parts.always.textContent = showing.always_label ? `Always allow ${showing.always_label}` : "";
  setButtons(card, false);
}
