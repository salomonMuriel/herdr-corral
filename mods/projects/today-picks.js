// Today's picks: up to three tasks the person means to finish today, by this machine's local date.
import { notify } from "herdr";
import { data, setLocal, write } from "./store.js";

export const MAX_PICKS = 3;

const pad = (n) => String(n).padStart(2, "0");

export function localDay(now = Date.now()) {
  const day = new Date(now);
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

const todayRows = () => (data().picks ?? []).filter((p) => p.day === localDay()).sort((a, b) => a.position - b.position);

export function picks() {
  const tasks = new Map(data().tasks.map((t) => [t.id, t]));
  return todayRows().map((p) => tasks.get(p.task_id)).filter(Boolean);
}

export const isPicked = (task) => todayRows().some((p) => p.task_id === task.id);
export const canPick = (task) => task.status !== "done" && !isPicked(task) && picks().length < MAX_PICKS;

export function pick(task) {
  if (isPicked(task)) return;
  if (picks().length >= MAX_PICKS) return notify({ title: `Today already has ${MAX_PICKS}`, body: "Drop one first.", timeout: 3000 });
  const day = localDay();
  const position = Math.max(-1, ...todayRows().map((p) => p.position)) + 1;
  setLocal("picks", [...(data().picks ?? []), { day, task_id: task.id, position }]);
  return write("pick the task", [["insert into today_picks (day, task_id, position) values ($1::date, $2, $3) on conflict do nothing", [day, task.id, position]]]);
}

export function unpick(task) {
  const day = localDay();
  setLocal("picks", (data().picks ?? []).filter((p) => !(p.day === day && p.task_id === task.id)));
  return write("drop the pick", [["delete from today_picks where day = $1::date and task_id = $2", [day, task.id]]]);
}

export const togglePick = (task) => (isPicked(task) ? unpick(task) : pick(task));
