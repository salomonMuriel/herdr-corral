import { api, showResult } from "./api.js";
import { setupForms, updateTargets } from "./forms.js";
import { fillApproval, setupApproval } from "./approval.js";

const POLL_MS = 4000;
const SCREEN_MS = 15000;
const ASK_LABEL = { plan: "Plan needs approval", question: "Has a question", permission: "Needs permission" };

const cards = new Map();
const focusId = focusedAgent();

function focusedAgent() {
  const match = location.pathname.match(/^\/agents\/([^/]+)\/([^/]+)$/);
  return match ? `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}` : null;
}

function badgeText(agent) {
  if (agent.approval) return "Needs permission";
  if (agent.need === "blocked") return ASK_LABEL[agent.ask] || "Needs you";
  if (agent.need === "waiting") return "Waiting on you";
  return agent.state || "No status";
}

function screenKey(agent) {
  return `${agent.state}|${agent.status_ms}|${agent.turn}|${agent.ask}|${agent.approval?.id}`;
}

async function loadScreen(card) {
  const { agent } = card;
  card.screen.classList.add("stale");
  try {
    const { lines } = await api(`/api/screen/${encodeURIComponent(agent.machine)}/${encodeURIComponent(agent.address)}`);
    const atBottom = card.screen.scrollHeight - card.screen.scrollTop - card.screen.clientHeight < 8;
    card.screen.textContent = lines.join("\n");
    if (atBottom || !card.loaded) card.screen.scrollTop = card.screen.scrollHeight;
    card.loaded = true;
  } catch (error) {
    card.screen.textContent = error.message;
  }
  card.screen.classList.remove("stale");
  card.screenAt = Date.now();
}

function refreshSoon(card) {
  setTimeout(() => loadScreen(card), 700);
}

async function sendReply(card, force) {
  const text = card.textarea.value.trim();
  if (!text) return;
  card.force.hidden = true;
  try {
    await api("/api/send", { machine: card.agent.machine, address: card.agent.address, text, force });
    card.textarea.value = "";
    showResult(card.result, "Sent");
    refreshSoon(card);
  } catch (error) {
    showResult(card.result, error.message, true);
    card.force.hidden = force || card.agent.state !== "blocked";
  }
}

async function pressKeys(card, keys) {
  try {
    await api("/api/keys", { machine: card.agent.machine, address: card.agent.address, keys: [keys] });
    showResult(card.result, `Pressed ${keys}`);
    refreshSoon(card);
  } catch (error) {
    showResult(card.result, error.message, true);
  }
}

function makeCard(agent) {
  const element = document.getElementById("card-template").content.firstElementChild.cloneNode(true);
  const card = {
    element,
    agent,
    screen: element.querySelector(".screen"),
    textarea: element.querySelector(".reply textarea"),
    result: element.querySelector(".card-foot .result"),
    force: element.querySelector(".force"),
    key: null,
  };
  element.querySelectorAll("[data-keys]").forEach((button) => {
    button.addEventListener("click", () => pressKeys(card, button.dataset.keys));
  });
  element.querySelector(".reply").addEventListener("submit", (event) => {
    event.preventDefault();
    sendReply(card, false);
  });
  card.textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) sendReply(card, false);
  });
  card.force.addEventListener("click", () => sendReply(card, true));
  element.querySelector(".refresh").addEventListener("click", () => loadScreen(card));
  setupApproval(card);
  return card;
}

function fillCard(card, agent) {
  card.agent = agent;
  const { element } = card;
  element.classList.toggle("blocked", agent.need === "blocked");
  element.classList.toggle("focused", agent.id === focusId);
  element.querySelector(".badge").textContent = badgeText(agent);
  element.querySelector(".title").textContent = agent.title;
  element.querySelector(".where").textContent = `${agent.machine}/${agent.address}${agent.where ? ` · ${agent.where}` : ""}`;
  element.querySelector(".msg").textContent = agent.msg || "";
  fillApproval(card, agent.approval);
  const key = screenKey(agent);
  if (key !== card.key || Date.now() - (card.screenAt || 0) > SCREEN_MS) {
    card.key = key;
    loadScreen(card);
  }
}

// A card someone is typing into stays until the reply is sent, even if the agent moved on.
function keepsCard(card) {
  return card.textarea.value.trim() !== "" || card.element.contains(document.activeElement);
}

function renderNeeds(agents) {
  const container = document.getElementById("needs");
  const shown = agents.filter((agent) => agent.need || agent.id === focusId);
  const ids = new Set(shown.map((agent) => agent.id));
  for (const [id, card] of cards) {
    if (ids.has(id) || keepsCard(card)) continue;
    card.element.remove();
    cards.delete(id);
  }
  shown.sort((a, b) => (b.id === focusId) - (a.id === focusId));
  shown.forEach((agent, index) => {
    let card = cards.get(agent.id);
    const fresh = !card;
    if (fresh) cards.set(agent.id, (card = makeCard(agent)));
    fillCard(card, agent);
    // Moving a node drops focus from its textarea, so only move cards that are out of place.
    const current = container.children[index];
    if (current !== card.element) container.insertBefore(card.element, current || null);
    if (fresh && agent.id === focusId) card.element.scrollIntoView({ block: "start" });
  });
  const waiting = agents.filter((agent) => agent.need).length;
  document.getElementById("need-count").textContent = waiting ? String(waiting) : "";
  document.getElementById("needs-empty").hidden = cards.size > 0;
  document.title = waiting ? `(${waiting}) Herdr` : "Herdr";
}

function renderMachines(machines) {
  const container = document.getElementById("machines");
  container.replaceChildren(
    ...Object.entries(machines).map(([name, machine]) => {
      const span = document.createElement("span");
      span.className = machine.connected ? "up" : "down";
      span.title = machine.error || "connected";
      span.innerHTML = '<i class="dot"></i>';
      span.append(name);
      return span;
    }),
  );
}

async function poll() {
  try {
    const { agents, machines } = await api("/api/agents");
    renderMachines(machines);
    renderNeeds(agents);
    updateTargets(agents);
  } catch (error) {
    document.getElementById("machines").textContent = error.message;
  }
}

setupForms();
poll();
setInterval(() => {
  if (document.visibilityState === "visible") poll();
}, POLL_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") poll();
});
