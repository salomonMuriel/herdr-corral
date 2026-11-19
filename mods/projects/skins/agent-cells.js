// A waiting agent's row in Today.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { data } from "../store.js";
import { duration } from "../model.js";
import { machineLabel, self } from "../machines.js";
import { programIcon, icon } from "../controls.js";
import { waitedSince } from "../needs-you.js";
import { sessionMark, statusMark } from "./parts.js";

export const repoName = (s) => data().subprojects.find((sp) => sp.id === s.subprojectId)?.name ?? null;

// `meta` goes after the label.
export function agentCells(k, s, now, label, meta = "") {
  const since = waitedSince(s);
  const asks = s.agentStatus === "blocked" || Boolean(s.coordinatorAsk);
  return [
    h_flex().w(16).flex_none().justify_center().child(programIcon(s.program, 13, k.muted) ?? icon("terminal", 13, k.faint)),
    div().flex_1().min_w(0).truncate().text_size(13).text_color(k.ink).child(label),
    meta ? div().flex_none().text_size(11.5).text_color(k.faint).child(meta) : null,
    s.machine !== self() ? div().flex_none().text_size(11).text_color(k.faint).child(machineLabel(s.machine)) : null,
    since ? div().flex_none().text_size(11).text_color(k.faint).child(duration(now - since)) : null,
    asks ? sessionMark(k, s) : statusMark(k, "done"),
  ].filter(Boolean);
}
