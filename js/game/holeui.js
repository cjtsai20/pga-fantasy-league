// The shot-by-shot pieces of the hole screen, shared by the single-tournament game (game.js) and
// Race to the FedEx Cup (season/ui.js): where the ball is, the shot choices, and the ball flight.

import { phase, shotOptions, autoChoice, distToPin, scoreName } from "./sim.js";
import { drawShot, placeBall, drawGreenInset } from "./hole_svg.js";

export const RISK = { low: "Safe", med: "Balanced", high: "Aggressive" };
export const LIE_NAME = { tee: "on the tee", fairway: "in the fairway", rough: "in the rough", fw_bunker: "in a fairway bunker",
  gs_bunker: "in a greenside bunker", trees: "in the trees", fringe: "on the fringe", green: "on the green", drop: "in the drop area" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Shot number, distance and lie for a ball in play. */
export function situationHTML(st, label = "") {
  const d = distToPin(st), ph = phase(st);
  const where = ph === "putt" ? `${(d * 3) < 3 ? (d * 3).toFixed(1) : Math.round(d * 3)} ft putt` : `${Math.round(d)} yds to the pin`;
  return `<p class="gm-shotno">Shot ${st.strokes + 1}${label ? ` · ${esc(label)}` : ""}</p><p class="gm-where">${where}</p><p class="gm-sub">${LIE_NAME[st.lie] || ""}</p>`;
}

/** Result line for a holed-out ball. */
export function holedHTML(st) {
  const h = st.hole, name = st.pickedUp ? `Picked up, ${st.strokes}` : scoreName(st.strokes, h.par), d = st.strokes - h.par;
  return `<p class="gm-result ${d < 0 ? "is-good" : d > 0 ? "is-bad" : ""}">${esc(name)}</p>
    <p class="gm-sub">${st.strokes} strokes on the par ${h.par}${st.putts ? ` · ${st.putts} putt${st.putts === 1 ? "" : "s"}` : ""}</p>`;
}

/** The shot choices as buttons (data-opt), with the caddie's pick marked. */
export function optionsHTML(st, sk) {
  const caddie = autoChoice(st, sk);
  return shotOptions(st, sk).map((o) => `
        <button class="gm-opt gm-risk-${o.risk}" data-opt="${o.id}">
          <span class="gm-opt-top"><span class="gm-opt-label">${esc(o.label)}</span>
          <span class="gm-chip">${RISK[o.risk]}</span>${o.id === caddie ? `<span class="gm-chip gm-chip--caddie">Caddie's pick</span>` : ""}</span>
          ${o.desc ? `<span class="gm-opt-desc">${esc(o.desc)}</span>` : ""}
        </button>`).join("");
}

/** Green close-up while putting (hidden otherwise). */
export function showInset(view, st) {
  drawGreenInset(view, st.hole, st.s, st.x, !st.holed && phase(st) === "putt");
}

/** Draw a shot that was just played (animated unless animate is false). */
export async function flyShot(view, st, shot, animate = true) {
  drawGreenInset(view, st.hole, 0, 0, false);
  if (shot.from.s === 0 && shot.to.s === 0 && shot.penalty) placeBall(view, 0, 0);
  else await drawShot(view, shot, animate ? (shot.phase === "putt" ? 550 : 900) : 0);
}
