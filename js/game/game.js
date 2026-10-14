// Play tab: pick a course and a golfer, then play a 72-hole fake tournament shot by shot against
// a simulated field. Model lives in sim.js; drawing in hole_svg.js.
//
//   import { mountGame } from "./js/game/game.js";
//   mountGame(document.getElementById("play"), { supabase, user });   // both may be null
//
// URL params for testing: ?autoplay=<n shots> plays n shots on autopilot; ?autoplay=final sims the
// whole tournament; ?seed=abc fixes the seed; ?course=<id> and ?golfer=<player id> preselect;
// ?hole=n (with autoplay) sims ahead to hole n first.

import { makeRng, skillsFrom, newHole, phase, shotOptions, playShot, autoChoice, autoRound, distToPin, scoreName } from "./sim.js";
import { drawHole, drawShot, placeBall, drawGreenInset } from "./hole_svg.js";
import { attachCourseGeo } from "./geo.js";
import { golferAvatar } from "../avatar.js";

const ROUNDS = 4, FIELD_SIZE = 30;
const DATA = (f) => new URL(`../../data/${f}`, import.meta.url);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toPar = (v) => (v === 0 ? "E" : v > 0 ? `+${v}` : `${v}`);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const sgTotal = (p) => { const s = p.stats || {}; return (s.sg_ott ?? 0) + (s.sg_app ?? 0) + (s.sg_arg ?? 0) + (s.sg_putt ?? 0); };

async function fetchJson(url) {
  try { const r = await fetch(url, { cache: "no-cache" }); return r.ok ? await r.json() : null; } catch { return null; }
}

/**
 * Courses from data/courses.json (real OSM layouts load per course, see loadGeo); golfers are the
 * ones in data/players.json that have stats, topped up from the sample fixtures when there are fewer
 * than 30 (real stats win for a golfer in both). Falls back to the sample courses if needed.
 */
async function loadData() {
  let courses = await fetchJson(DATA("courses.json"));
  courses = Array.isArray(courses) ? courses.filter((c) => Array.isArray(c.holes) && c.holes.length === 18) : [];
  const sample = { courses: false, players: false };
  if (!courses.length) { courses = (await fetchJson(DATA("sample/game_courses.json"))) || []; sample.courses = true; }
  const all = (await fetchJson(DATA("players.json"))) || {};
  let players = Object.fromEntries(Object.entries(all).filter(([, p]) => p && p.stats && Object.keys(p.stats).length));
  if (Object.keys(players).length < FIELD_SIZE) {
    const extra = (await fetchJson(DATA("sample/game_players.json"))) || {};
    const real = new Set(Object.values(players).map((p) => p.name.toLowerCase()));
    for (const [id, p] of Object.entries(extra)) if (!players[id] && !real.has(p.name.toLowerCase())) players[id] = p;
    sample.players = true;
  }
  return { courses, players, sample };
}

/** Attach real hole geometry (data/courses/{id}.json) to a course's holes, once. */
async function loadGeo(course) {
  if (!course.geo_file || course._geoLoaded) return;
  attachCourseGeo(course, await fetchJson(DATA(course.geo_file)));
  course._geoLoaded = true;
}

function seededShuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const RISK = { low: "Safe", med: "Balanced", high: "Aggressive" };

export async function mountGame(root, { supabase = null, user = null } = {}) {
  void supabase; void user; // nothing is saved server-side; personal bests stay in localStorage
  root.innerHTML = `<div class="pg-game"><p class="gm-loading">Loading the course guide...</p></div>`;
  const wrap = root.firstElementChild;
  const { courses, players, sample } = await loadData();
  if (!courses.length || !Object.keys(players).length) {
    wrap.innerHTML = `<p class="gm-loading">Course data isn't available yet. Check back after the next refresh.</p>`;
    return;
  }
  const params = new URLSearchParams(location.search);
  const ui = { courseId: courses.some((c) => c.id === params.get("course")) ? params.get("course") : courses[0].id, playerId: null, seed: params.get("seed") || randomSeed(), query: "", fullBoard: false, busy: false };
  const sortedPlayers = Object.entries(players)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => sgTotal(b) - sgTotal(a) || a.name.localeCompare(b.name));
  ui.playerId = players[params.get("golfer")] ? params.get("golfer") : sortedPlayers[0].id;
  let game = null;

  // ------------------------------------------------------------ setup screen
  function renderSetup() {
    const q = ui.query.trim().toLowerCase();
    const list = sortedPlayers.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 60);
    wrap.innerHTML = `
      <header class="gm-head">
        <p class="gm-eyebrow">The Clubhouse Challenge</p>
        <h2 class="gm-title">Play the Course</h2>
        <p class="gm-lede">Take a tour pro around a championship layout. You choose every shot and the result comes from that golfer's real tendencies, over 72 holes against a simulated field.</p>
        ${sample.courses || sample.players ? `<p class="gm-note">${sample.courses ? "Using sample courses and golfer stats" : "Golfer stats are sample figures for now"} until the season's data loads.</p>` : ""}
      </header>
      <section class="gm-step">
        <h3 class="gm-h3"><span class="gm-num">I</span> Choose your course</h3>
        <div class="gm-courses">
          ${courses.map((c) => `
            <button class="gm-course ${c.id === ui.courseId ? "is-on" : ""}" data-course="${esc(c.id)}">
              ${c.images?.[0]?.url ? `<span class="gm-course-img" style="background-image:url('${esc(c.images[0].url)}')"></span>` : `<span class="gm-course-img gm-course-img--blank"></span>`}
              <span class="gm-course-name">${esc(c.name)}</span>
              <span class="gm-course-meta">${esc(c.location || "")}</span>
              <span class="gm-course-meta">Par ${c.par} · ${Number(c.yardage).toLocaleString()} yds</span>
              ${c.layout_source === "osm" ? `<span class="gm-course-tag">Mapped layout</span>` : ""}
              ${bestFor(c.id) != null ? `<span class="gm-course-best">Your best: ${toPar(bestFor(c.id))}</span>` : ""}
            </button>`).join("")}
        </div>
      </section>
      <section class="gm-step">
        <h3 class="gm-h3"><span class="gm-num">II</span> Choose your golfer</h3>
        <input class="gm-search" type="search" placeholder="Search golfers" value="${esc(ui.query)}" aria-label="Search golfers">
        <div class="gm-golfers" role="listbox">
          ${list.map((p) => golferRow(p, p.id === ui.playerId)).join("") || `<p class="gm-note">No golfers match.</p>`}
        </div>
      </section>
      <section class="gm-step gm-start">
        <p class="gm-pick">${esc(courses.find((c) => c.id === ui.courseId)?.name)}<span>with ${esc(players[ui.playerId]?.name)}</span></p>
        <label class="gm-seed">Tournament seed <input value="${esc(ui.seed)}" maxlength="24" aria-label="Seed"></label>
        <button class="gm-btn gm-btn--ghost" data-act="reseed">New seed</button>
        <button class="gm-btn gm-btn--primary" data-act="start">Tee off</button>
      </section>`;
    wrap.querySelectorAll("[data-course]").forEach((b) => b.onclick = () => { ui.courseId = b.dataset.course; renderSetup(); });
    wrap.querySelectorAll("[data-player]").forEach((b) => b.onclick = () => { ui.playerId = b.dataset.player; renderSetup(); });
    const search = wrap.querySelector(".gm-search");
    search.oninput = () => { ui.query = search.value; const pos = search.selectionStart; renderSetup(); const s2 = wrap.querySelector(".gm-search"); s2.focus(); s2.setSelectionRange(pos, pos); };
    wrap.querySelector(".gm-seed input").onchange = (e) => { ui.seed = e.target.value.trim() || randomSeed(); };
    wrap.querySelector('[data-act="reseed"]').onclick = () => { ui.seed = randomSeed(); renderSetup(); };
    wrap.querySelector('[data-act="start"]').onclick = () => { ui.seed = wrap.querySelector(".gm-seed input").value.trim() || ui.seed; startGame(); };
  }

  function golferRow(p, on) {
    const s = p.stats || {};
    const stat = (v, f) => (v == null ? "-" : f(v));
    return `<button class="gm-golfer ${on ? "is-on" : ""}" data-player="${esc(p.id)}" role="option" aria-selected="${on}">
      ${avatar(p)}
      <span class="gm-golfer-name">${esc(p.name)}<small>${esc(p.country || "")}</small></span>
      <span class="gm-golfer-stats">
        <span><b>${stat(s.drive_dist, (v) => Math.round(v))}</b> yds</span>
        <span><b>${stat(s.gir, (v) => Math.round(v * 100) + "%")}</b> GIR</span>
        <span><b>${stat(s.sg_putt, (v) => (v > 0 ? "+" : "") + v.toFixed(2))}</b> SG putt</span>
      </span>
    </button>`;
  }
  const avatar = (p, cls = "") =>
    `<span class="gm-avatar gm-avatar--comic ${cls}">${golferAvatar({ id: p.id, name: p.name, country: p.country })}</span>`;

  // ------------------------------------------------------------ tournament state
  async function startGame() {
    const course = courses.find((c) => c.id === ui.courseId);
    await loadGeo(course);
    const me = players[ui.playerId];
    const fieldRng = makeRng(`${ui.seed}|field|${course.id}`);
    const pool = seededShuffle(sortedPlayers.filter((p) => p.id !== ui.playerId).slice(0, 80), fieldRng).slice(0, FIELD_SIZE - 1);
    const field = pool.map((p) => {
      const sk = skillsFrom(p.stats), rng = makeRng(`${ui.seed}|${course.id}|${p.id}`);
      return { id: p.id, name: p.name, p, rounds: Array.from({ length: ROUNDS }, () => autoRound(course, sk, rng)) };
    });
    game = {
      course, me: { id: ui.playerId, ...me }, sk: skillsFrom(me.stats), rng: makeRng(`${ui.seed}|${course.id}|you|${ui.playerId}`),
      field, round: 0, holeIdx: 0, rounds: Array.from({ length: ROUNDS }, () => []), hole: null, log: [], done: false,
    };
    beginHole();
  }

  function beginHole() {
    const h = game.course.holes[game.holeIdx];
    game.hole = newHole(h);
    game.log = [];
    renderPlay();
  }

  function standings() {
    const thru = game.rounds[game.round].length, r = game.round, pars = game.course.holes.map((h) => h.par);
    const coursePar = sum(pars);
    const row = (name, rounds, isMe, p) => {
      let total = 0;
      for (let i = 0; i < r; i++) total += sum(rounds[i]) - coursePar;
      const today = sum(rounds[r].slice(0, thru)) - sum(pars.slice(0, thru));
      total += today;
      return { name, total, today, thru, isMe, p, rounds };
    };
    const rows = [
      row(`${game.me.name}`, game.rounds, true, game.me),
      ...game.field.map((f) => row(f.name, f.rounds, false, f.p)),
    ].sort((a, b) => a.total - b.total || (a.isMe ? -1 : b.isMe ? 1 : 0) || a.name.localeCompare(b.name));
    rows.forEach((x, i) => {
      const tied = rows.filter((y) => y.total === x.total).length > 1;
      const first = rows.findIndex((y) => y.total === x.total);
      x.pos = `${tied ? "T" : ""}${first + 1}`;
      x.idx = i;
    });
    return rows;
  }

  // ------------------------------------------------------------ play screen
  let view = null;
  function renderPlay() {
    const h = game.hole.hole, st = game.hole, board = standings(), me = board.find((x) => x.isMe);
    wrap.innerHTML = `
      <div class="gm-topbar">
        <div class="gm-topbar-l">
          <span class="gm-eyebrow">${esc(game.course.name)}</span>
          <span class="gm-topbar-title">Round ${game.round + 1} · Hole ${h.n} · Par ${h.par} · ${h.yards} yds</span>
        </div>
        <div class="gm-topbar-r">
          ${avatar(game.me, "gm-avatar--sm")}
          <span><span class="gm-topbar-name">${esc(game.me.name)}</span>
          <span class="gm-score ${me.total < 0 ? "is-under" : me.total > 0 ? "is-over" : ""}">${toPar(me.total)}</span>
          <span class="gm-pos">${me.pos}</span></span>
        </div>
      </div>
      <div class="gm-main">
        <div class="gm-hole"><svg class="gm-svg" role="img" aria-label="Diagram of hole ${h.n}"></svg></div>
        <div class="gm-panel">
          <div class="gm-situation"></div>
          <div class="gm-options"></div>
          <div class="gm-sims">
            <button class="gm-btn gm-btn--ghost" data-sim="hole">Sim this hole</button>
            <button class="gm-btn gm-btn--ghost" data-sim="round">Sim rest of round</button>
            <button class="gm-btn gm-btn--ghost" data-sim="all">Sim to the finish</button>
          </div>
          <ol class="gm-log"></ol>
        </div>
      </div>
      <div class="gm-lower">
        <div class="gm-card-wrap">${scorecard()}</div>
        <div class="gm-board-wrap">${leaderboard(board)}</div>
      </div>`;
    view = drawHole(wrap.querySelector(".gm-svg"), h);
    placeBall(view, st.s, st.x);
    wrap.querySelectorAll("[data-sim]").forEach((b) => b.onclick = () => simulate(b.dataset.sim));
    wireBoard();
    renderShotPanel();
  }

  function renderShotPanel() {
    const st = game.hole, h = st.hole;
    const sit = wrap.querySelector(".gm-situation"), opts = wrap.querySelector(".gm-options");
    const lieName = { tee: "on the tee", fairway: "in the fairway", rough: "in the rough", fw_bunker: "in a fairway bunker", gs_bunker: "in a greenside bunker", trees: "in the trees", fringe: "on the fringe", green: "on the green", drop: "in the drop area" };
    if (st.holed) {
      const name = st.pickedUp ? `Picked up, ${st.strokes}` : scoreName(st.strokes, h.par);
      const d = st.strokes - h.par;
      const last = game.holeIdx === 17;
      const tourneyOver = last && game.round === ROUNDS - 1;
      sit.innerHTML = `<p class="gm-result ${d < 0 ? "is-good" : d > 0 ? "is-bad" : ""}">${esc(name)}</p>
        <p class="gm-sub">${st.strokes} strokes on the par ${h.par}${st.putts ? ` · ${st.putts} putt${st.putts === 1 ? "" : "s"}` : ""}</p>`;
      opts.innerHTML = `<button class="gm-btn gm-btn--primary gm-next">${tourneyOver ? "See the final leaderboard" : last ? `Start round ${game.round + 2}` : `On to hole ${h.n + 1}`}</button>`;
      opts.querySelector(".gm-next").onclick = () => nextHole();
      drawGreenInset(view, h, st.s, st.x, false);
    } else {
      const d = distToPin(st), ph = phase(st);
      const where = ph === "putt" ? `${(d * 3) < 3 ? (d * 3).toFixed(1) : Math.round(d * 3)} ft putt` : `${Math.round(d)} yds to the pin`;
      sit.innerHTML = `<p class="gm-shotno">Shot ${st.strokes + 1}</p><p class="gm-where">${where}</p><p class="gm-sub">${lieName[st.lie] || ""}</p>`;
      const caddie = autoChoice(st, game.sk);
      opts.innerHTML = shotOptions(st, game.sk).map((o) => `
        <button class="gm-opt gm-risk-${o.risk}" data-opt="${o.id}">
          <span class="gm-opt-top"><span class="gm-opt-label">${esc(o.label)}</span>
          <span class="gm-chip">${RISK[o.risk]}</span>${o.id === caddie ? `<span class="gm-chip gm-chip--caddie">Caddie's pick</span>` : ""}</span>
          ${o.desc ? `<span class="gm-opt-desc">${esc(o.desc)}</span>` : ""}
        </button>`).join("");
      opts.querySelectorAll("[data-opt]").forEach((b) => b.onclick = () => hit(b.dataset.opt));
      drawGreenInset(view, h, st.s, st.x, ph === "putt");
    }
    const log = wrap.querySelector(".gm-log");
    log.innerHTML = game.log.map((t) => `<li>${esc(t)}</li>`).join("");
    log.scrollTop = log.scrollHeight;
    wrap.querySelectorAll("[data-sim]").forEach((b) => (b.disabled = ui.busy || (b.dataset.sim === "hole" && st.holed)));
  }

  async function hit(opt, animate = true) {
    if (ui.busy || game.hole.holed) return;
    ui.busy = true;
    wrap.querySelectorAll(".gm-opt, [data-sim]").forEach((b) => (b.disabled = true));
    const shot = playShot(game.hole, opt, game.sk, game.rng);
    game.log.push(shot.text);
    drawGreenInset(view, game.hole.hole, 0, 0, false);
    if (shot.from.s === 0 && shot.to.s === 0 && shot.penalty) placeBall(view, 0, 0);
    else await drawShot(view, shot, animate ? (shot.phase === "putt" ? 550 : 900) : 0);
    ui.busy = false;
    if (game.hole.holed) finishHole();
    renderShotPanel();
  }

  function finishHole() {
    game.rounds[game.round].push(game.hole.strokes);
    const board = standings();
    wrap.querySelector(".gm-card-wrap").innerHTML = scorecard();
    wrap.querySelector(".gm-board-wrap").innerHTML = leaderboard(board);
    wireBoard();
    const me = board.find((x) => x.isMe);
    const sc = wrap.querySelector(".gm-score");
    sc.textContent = toPar(me.total);
    sc.className = `gm-score ${me.total < 0 ? "is-under" : me.total > 0 ? "is-over" : ""}`;
    wrap.querySelector(".gm-pos").textContent = me.pos;
  }

  function nextHole() {
    if (game.holeIdx < 17) { game.holeIdx++; beginHole(); return; }
    if (game.round < ROUNDS - 1) { game.round++; game.holeIdx = 0; beginHole(); return; }
    game.done = true;
    saveBest();
    renderFinal();
  }

  /** Autopilot: finish this hole, the round, or the whole tournament using the caddie's picks. */
  function simulate(scope) {
    if (ui.busy) return;
    for (;;) {
      if (!game.hole.holed) {
        while (!game.hole.holed) {
          const shot = playShot(game.hole, autoChoice(game.hole, game.sk), game.sk, game.rng);
          game.log.push(shot.text);
        }
        game.rounds[game.round].push(game.hole.strokes);
      }
      if (scope === "hole") break;
      const lastHole = game.holeIdx === 17;
      if (lastHole && (scope === "round" || game.round === ROUNDS - 1)) break;
      if (lastHole) { game.round++; game.holeIdx = 0; } else game.holeIdx++;
      game.hole = newHole(game.course.holes[game.holeIdx]);
      game.log = [];
    }
    renderPlay();
    for (const shot of game.hole.shots) drawShot(view, shot, 0);
    if (!game.hole.shots.length) placeBall(view, 0, 0);
  }

  // ------------------------------------------------------------ scorecard & leaderboard
  function scorecard() {
    const holes = game.course.holes;
    const cell = (s, par) => {
      if (s == null) return `<td></td>`;
      const d = s - par;
      const cls = d <= -2 ? "sc-eagle" : d === -1 ? "sc-birdie" : d === 1 ? "sc-bogey" : d >= 2 ? "sc-double" : "";
      return `<td><span class="sc ${cls}">${s}</span></td>`;
    };
    const nine = (from) => holes.slice(from, from + 9);
    const tot = (arr, from) => { const part = arr.slice(from, from + 9); return part.length === 9 ? sum(part) : part.length ? sum(part) : ""; };
    const rows = game.rounds.map((r, i) => (i > game.round ? "" : `
      <tr class="${i === game.round ? "is-cur" : ""}"><th>R${i + 1}</th>
        ${nine(0).map((h, j) => cell(r[j], h.par)).join("")}<td class="sc-sum">${tot(r, 0)}</td>
        ${nine(9).map((h, j) => cell(r[9 + j], h.par)).join("")}<td class="sc-sum">${tot(r, 9)}</td>
        <td class="sc-sum sc-tot">${r.length ? sum(r) : ""}</td></tr>`)).join("");
    const parOut = sum(nine(0).map((h) => h.par)), parIn = sum(nine(9).map((h) => h.par));
    return `<h3 class="gm-h4">Scorecard</h3>
      <div class="gm-scroll"><table class="gm-scorecard">
        <tr class="sc-hole"><th>Hole</th>${nine(0).map((h) => `<th class="${!game.done && h.n === game.holeIdx + 1 ? "is-cur" : ""}">${h.n}</th>`).join("")}<th>Out</th>${nine(9).map((h) => `<th class="${!game.done && h.n === game.holeIdx + 1 ? "is-cur" : ""}">${h.n}</th>`).join("")}<th>In</th><th>Tot</th></tr>
        <tr class="sc-par"><th>Par</th>${nine(0).map((h) => `<td>${h.par}</td>`).join("")}<td class="sc-sum">${parOut}</td>${nine(9).map((h) => `<td>${h.par}</td>`).join("")}<td class="sc-sum">${parIn}</td><td class="sc-sum">${parOut + parIn}</td></tr>
        ${rows}
      </table></div>`;
  }

  function leaderboard(board, final = false) {
    let rows = board;
    if (!ui.fullBoard && !final) {
      rows = board.slice(0, 10);
      const me = board.find((x) => x.isMe);
      if (me.idx >= 10) rows = [...rows, me];
    }
    const thruTxt = (x) => (final || x.thru === 18 ? "F" : x.thru === 0 ? "-" : x.thru);
    return `<h3 class="gm-h4">Leaderboard${final ? "" : ` · Round ${game.round + 1}`}</h3>
      <table class="gm-board">
        <tr><th>Pos</th><th class="gm-board-name">Player</th><th>To par</th>${final ? game.rounds.map((_, i) => `<th>R${i + 1}</th>`).join("") + "<th>Total</th>" : "<th>Today</th><th>Thru</th>"}</tr>
        ${rows.map((x) => `<tr class="${x.isMe ? "is-me" : ""}">
          <td>${x.pos}</td><td class="gm-board-name">${x.isMe ? `<b>${esc(x.name)}</b> <span class="gm-you">You</span>` : esc(x.name)}</td>
          <td class="${x.total < 0 ? "is-under" : ""}">${toPar(x.total)}</td>
          ${final ? x.rounds.map((r) => `<td>${sum(r)}</td>`).join("") + `<td>${sum(x.rounds.map(sum))}</td>`
            : `<td>${x.thru ? toPar(x.today) : "-"}</td><td>${thruTxt(x)}</td>`}
        </tr>`).join("")}
      </table>
      ${final ? "" : `<button class="gm-link" data-act="board">${ui.fullBoard ? "Show top 10" : "Full leaderboard"}</button>`}`;
  }
  function wireBoard() {
    const b = wrap.querySelector('[data-act="board"]');
    if (b) b.onclick = () => { ui.fullBoard = !ui.fullBoard; wrap.querySelector(".gm-board-wrap").innerHTML = leaderboard(standings()); wireBoard(); };
  }

  // ------------------------------------------------------------ final
  function renderFinal() {
    const board = standings(), me = board.find((x) => x.isMe);
    const winner = board[0];
    const won = me.pos === "1";
    wrap.innerHTML = `
      <header class="gm-head gm-final">
        <p class="gm-eyebrow">${esc(game.course.name)} · Final</p>
        <h2 class="gm-title">${won ? "Champion" : `Finished ${me.pos}`}</h2>
        <p class="gm-lede">${esc(game.me.name)} shot ${game.rounds.map(sum).join("-")} for <b>${toPar(me.total)}</b>.
          ${won ? "Your name goes on the trophy." : `${esc(winner.name)} won at ${toPar(winner.total)}.`}</p>
        <div class="gm-final-actions">
          <button class="gm-btn gm-btn--primary" data-act="again">Play again</button>
          <button class="gm-btn gm-btn--ghost" data-act="replay">Replay this seed (${esc(ui.seed)})</button>
          <button class="gm-btn gm-btn--ghost" data-act="setup">Change course or golfer</button>
        </div>
      </header>
      <div class="gm-lower gm-lower--final">
        <div class="gm-card-wrap">${scorecard()}</div>
        <div class="gm-board-wrap">${leaderboard(board, true)}</div>
      </div>`;
    wrap.querySelector('[data-act="again"]').onclick = () => { ui.seed = randomSeed(); startGame(); };
    wrap.querySelector('[data-act="replay"]').onclick = () => startGame();
    wrap.querySelector('[data-act="setup"]').onclick = () => { game = null; renderSetup(); };
  }

  // ------------------------------------------------------------ personal bests (this browser only)
  function bestFor(courseId) {
    const v = localStorage.getItem(`pg-game-best:${courseId}`);
    return v == null ? null : +v;
  }
  function saveBest() {
    const total = sum(game.rounds.map(sum)) - ROUNDS * game.course.par;
    const prev = bestFor(game.course.id);
    if (prev == null || total < prev) localStorage.setItem(`pg-game-best:${game.course.id}`, String(total));
  }

  // ------------------------------------------------------------ go
  renderSetup();
  const auto = params.get("autoplay");
  if (auto) {
    await startGame();
    const startHole = Math.min(18, +(params.get("hole") || 1));
    while (game.holeIdx < startHole - 1) { simulate("hole"); nextHole(); }
    if (auto === "final") { simulate("all"); nextHole(); }
    else for (let i = 0; i < +auto && !game.hole.holed; i++) await hit(autoChoice(game.hole, game.sk), false);
  }
}

function randomSeed() {
  return Math.random().toString(36).slice(2, 8);
}
