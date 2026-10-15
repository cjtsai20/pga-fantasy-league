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

/**
 * Scorecard table for one golfer: holes = course.holes, rounds = [[strokes per hole], ...] (shown up to
 * curRound), curHole = index of the hole being played (highlighted), or -1 when nothing is in play.
 */
export function scorecardHTML(holes, rounds, curRound, curHole = -1) {
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const cell = (s, par) => {
    if (s == null) return `<td></td>`;
    const d = s - par;
    const cls = d <= -2 ? "sc-eagle" : d === -1 ? "sc-birdie" : d === 1 ? "sc-bogey" : d >= 2 ? "sc-double" : "";
    return `<td><span class="sc ${cls}">${s}</span></td>`;
  };
  const nine = (from) => holes.slice(from, from + 9);
  const tot = (arr, from) => { const part = arr.slice(from, from + 9); return part.length ? sum(part) : ""; };
  const head = (h) => `<th class="${h.n === curHole + 1 ? "is-cur" : ""}">${h.n}</th>`;
  const rows = rounds.map((r, i) => (i > curRound ? "" : `
    <tr class="${i === curRound ? "is-cur" : ""}"><th>R${i + 1}</th>
      ${nine(0).map((h, j) => cell(r[j], h.par)).join("")}<td class="sc-sum">${tot(r, 0)}</td>
      ${nine(9).map((h, j) => cell(r[9 + j], h.par)).join("")}<td class="sc-sum">${tot(r, 9)}</td>
      <td class="sc-sum sc-tot">${r.length ? sum(r) : ""}</td></tr>`)).join("");
  const parOut = sum(nine(0).map((h) => h.par)), parIn = sum(nine(9).map((h) => h.par));
  return `<h3 class="gm-h4">Scorecard</h3>
    <div class="gm-scroll"><table class="gm-scorecard">
      <tr class="sc-hole"><th>Hole</th>${nine(0).map(head).join("")}<th>Out</th>${nine(9).map(head).join("")}<th>In</th><th>Tot</th></tr>
      <tr class="sc-par"><th>Par</th>${nine(0).map((h) => `<td>${h.par}</td>`).join("")}<td class="sc-sum">${parOut}</td>${nine(9).map((h) => `<td>${h.par}</td>`).join("")}<td class="sc-sum">${parIn}</td><td class="sc-sum">${parOut + parIn}</td></tr>
      ${rows}
    </table></div>`;
}
