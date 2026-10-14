// One hole, shot by shot, for Race to the FedEx Cup: stroke-play events, playoff matches and cup
// matches all use it. Built from the same pieces as the single-tournament game (holeui.js).
//
//   const h = playHole(el, { course, holeIdx, golfer: { id, name, sk }, rng, onHoled: (strokes, st) => ... });
//
// The course must already have its geometry attached (game.js loadGeo) for a real layout.
// shooter(shotNo) -> 'user' | 'partner' lets foursomes alternate shots inside a hole (shotNo is
// 1-based); partner shots play themselves with the caddie's pick. When the ball is holed the panel
// shows the result and a Continue button, which calls onHoled(strokes, st).

import { newHole, playShot, autoChoice } from "../sim.js";
import { drawHole, drawShot, placeBall } from "../hole_svg.js";
import { situationHTML, holedHTML, optionsHTML, showInset, flyShot } from "../holeui.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PARTNER_DELAY = 650;

/**
 * @param el       container (cleared)
 * @param o.course course object with holes (geo attached for real layouts)
 * @param o.holeIdx 0-based hole index
 * @param o.golfer {id, name, sk} the user's golfer (sk = skillsFrom(stats))
 * @param o.rng    makeRng(...) object
 * @param o.label  optional title line, e.g. "Round 2" or "Round of 16 v Rory McIlroy"
 * @param o.extraHeader optional HTML above the shot panel (match status, leaderboard line...)
 * @param o.shooter optional (shotNo) => 'user' | 'partner'; default always 'user'
 * @param o.partner {id, name, sk} required when shooter can return 'partner'
 * @param o.actions optional [{label, onClick}] extra buttons beside the sim buttons (e.g. Concede)
 * @param o.sims   optional [{label, onClick}] buttons that leave the hole (e.g. "Sim rest of round");
 *                 the hole player only provides "Sim this hole" itself
 * @param o.continueLabel text of the button shown once holed (default "Continue")
 * @param o.onHoled (strokes, st) called when Continue is pressed after the ball is holed
 * @param o.onSimHole optional () called when the user presses Sim this hole (before it plays out)
 * @returns {{destroy(), simHole(), state}}
 */
export function playHole(el, o) {
  const hole = o.course.holes[o.holeIdx];
  const st = newHole(hole);
  const shooter = o.shooter || (() => "user");
  const log = [];
  let busy = false, dead = false, timer = null;

  el.innerHTML = `<div class="pg-game sp-holeplay">
    <div class="gm-topbar"><div class="gm-topbar-l">
      <span class="gm-eyebrow">${esc(o.course.name)}</span>
      <span class="gm-topbar-title">${o.label ? `${esc(o.label)} · ` : ""}Hole ${hole.n} · Par ${hole.par} · ${hole.yards} yds</span>
    </div></div>
    <div class="gm-main">
      <div class="gm-hole"><svg class="gm-svg" role="img" aria-label="Diagram of hole ${hole.n}"></svg></div>
      <div class="gm-panel">
        ${o.extraHeader ? `<div class="sp-extra">${o.extraHeader}</div>` : ""}
        <div class="gm-situation"></div>
        <div class="gm-options"></div>
        <div class="gm-sims">
          <button class="gm-btn gm-btn--ghost" data-hp="sim">Sim this hole</button>
          ${(o.sims || []).map((b, i) => `<button class="gm-btn gm-btn--ghost" data-hp-sim="${i}">${esc(b.label)}</button>`).join("")}
          ${(o.actions || []).map((b, i) => `<button class="gm-btn gm-btn--ghost" data-hp-act="${i}">${esc(b.label)}</button>`).join("")}
        </div>
        <ol class="gm-log"></ol>
      </div>
    </div></div>`;
  const view = drawHole(el.querySelector(".gm-svg"), hole);
  placeBall(view, 0, 0);
  el.querySelector('[data-hp="sim"]').onclick = () => { o.onSimHole?.(); simHole(); };
  el.querySelectorAll("[data-hp-sim]").forEach((b) => (b.onclick = () => { if (!busy) o.sims[+b.dataset.hpSim].onClick(); }));
  el.querySelectorAll("[data-hp-act]").forEach((b) => (b.onclick = () => { if (!busy) o.actions[+b.dataset.hpAct].onClick(st); }));

  const who = () => (shooter(st.strokes + 1) === "partner" ? o.partner : o.golfer);

  function render() {
    if (dead) return;
    const sit = el.querySelector(".gm-situation"), opts = el.querySelector(".gm-options");
    if (st.holed) {
      sit.innerHTML = holedHTML(st);
      opts.innerHTML = `<button class="gm-btn gm-btn--primary gm-next">${esc(o.continueLabel || "Continue")}</button>`;
      opts.querySelector(".gm-next").onclick = () => o.onHoled?.(st.strokes, st);
    } else if (shooter(st.strokes + 1) === "partner") {
      sit.innerHTML = situationHTML(st, `${o.partner?.name || "Partner"} to play`);
      opts.innerHTML = `<p class="gm-note">${esc(o.partner?.name || "Your partner")} is playing this shot...</p>`;
      timer = setTimeout(() => hit(autoChoice(st, o.partner.sk), true), PARTNER_DELAY);
    } else {
      sit.innerHTML = situationHTML(st, shooter === o.shooter && o.partner ? `${o.golfer.name} to play` : "");
      opts.innerHTML = optionsHTML(st, o.golfer.sk);
      opts.querySelectorAll("[data-opt]").forEach((b) => (b.onclick = () => hit(b.dataset.opt, true)));
    }
    showInset(view, st);
    const lg = el.querySelector(".gm-log");
    lg.innerHTML = log.map((t) => `<li>${esc(t)}</li>`).join("");
    lg.scrollTop = lg.scrollHeight;
    el.querySelectorAll(".gm-sims button").forEach((b) => (b.disabled = busy || (b.dataset.hp === "sim" && st.holed)));
  }

  async function hit(opt, animate) {
    if (busy || st.holed || dead) return;
    busy = true;
    el.querySelectorAll(".gm-opt, .gm-sims button").forEach((b) => (b.disabled = true));
    const g = who();
    const shot = playShot(st, opt, g.sk, o.rng);
    log.push(o.partner && shooter === o.shooter ? `${g.name}: ${shot.text}` : shot.text);
    await flyShot(view, st, shot, animate);
    busy = false;
    render();
  }

  /** Finish the hole with the caddie's picks (each shot by whoever's turn it is), no animation. */
  function simHole() {
    if (dead) return;
    clearTimeout(timer);
    while (!st.holed) {
      const g = who();
      const shot = playShot(st, autoChoice(st, g.sk), g.sk, o.rng);
      log.push(o.partner && shooter === o.shooter ? `${g.name}: ${shot.text}` : shot.text);
      drawShot(view, shot, 0);
    }
    busy = false;
    render();
  }

  render();
  return { destroy() { dead = true; clearTimeout(timer); el.innerHTML = ""; }, simHole, state: st };
}

/** Play a hole with no screen at all (AI or "sim" paths that still want the shot model). */
export function autoStrokes(course, holeIdx, sk, rng) {
  const st = newHole(course.holes[holeIdx]);
  while (!st.holed) playShot(st, autoChoice(st, sk), sk, rng);
  return st.strokes;
}
