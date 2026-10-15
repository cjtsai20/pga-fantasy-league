// Race to the FedEx Cup: the screens. game.js mounts this when the Play tab is switched to season
// mode (mountSeason). The rules live in engine.js; this file draws them:
//   start screen (pick a golfer) -> season hub (this week, standings, schedule, field, career)
//   -> an event played shot by shot (holeplay.js) or simmed -> ... -> FedEx Cup Playoffs and the
//   year's cup (ui_post.js) -> season complete -> next season.
// The career is saved to localStorage after every hole, event and sim step (store.js).

import {
  FIELD_SIZE, PLAYOFF_SIZE, newSeason, standings, weekEntrants, startEvent, userMakesCut, finishEvent,
  simEvent, simWeek, advanceWeek, skillsMap, setCalibration, cutAfter36, hasCut, makeRng, sgTotal, formOf, FORM,
} from "./engine.js";
import { loadCareer, saveCareer, clearCareer, cloudLoad, cloudClear, cloudSaver, furtherAlong, progressOf, otherLocalCareers } from "./store.js";
import { playHole, autoStrokes } from "./holeplay.js";
import { scorecardHTML } from "../holeui.js";
import { loadPointsTables } from "../../points.js";
import { loadGeo, esc, toPar, fetchJson } from "../game.js";

const DATA = (f) => new URL(`../../../data/${f}`, import.meta.url);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const tick = () => new Promise((r) => setTimeout(r, 0));
const TYPE_LABEL = { regular: "Regular event", signature: "Signature event", major: "Major", players: "THE PLAYERS",
  opposite: "Opposite-field event", team: "Team event (played as stroke play)" };
const evName = (e) => (e.type === "major" ? `<b>${esc(e.name)}</b>` : e.type === "signature" ? `<i>${esc(e.name)}</i>` : esc(e.name));
const fmtPts = (v) => (Math.round((v || 0) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function injectCss() {
  if (document.getElementById("season-css")) return;
  const l = document.createElement("link");
  l.id = "season-css"; l.rel = "stylesheet"; l.href = new URL("../../../css/season.css", import.meta.url).href;
  document.head.appendChild(l);
}

/** Every playable golfer: game.js's pool (worst-entered fill applied), plus the sample golfers while
 * fewer than 100 golfers have pasted stats (buildField ranks them after golfers with real stats). */
async function golferPool(deps) {
  const pool = {};
  for (const [id, p] of Object.entries(deps.golfers || {})) {
    pool[id] = Object.values(p.src || {}).includes("sample") ? { ...p, sample: true } : p;
  }
  if ((deps.pastedCount || 0) < FIELD_SIZE) {
    const extra = (await fetchJson(DATA("sample/game_players.json"))) || {};
    const names = new Set(Object.values(pool).map((p) => p.name?.toLowerCase()));
    for (const [id, p] of Object.entries(extra)) {
      if (pool[id] || names.has(p.name.toLowerCase())) continue;
      pool[id] = { ...p, sample: true, src: Object.fromEntries(Object.keys(p.stats || {}).map((k) => [k, "sample"])) };
    }
  }
  return pool;
}

export async function mountSeason(root, deps) {
  injectCss();
  root.innerHTML = `<p class="gm-loading">Loading the season...</p>`;
  await loadPointsTables(DATA("points_tables.json").href);
  setCalibration(await fetchJson(DATA("season_calib.json")));
  const tournaments = deps.tournaments?.length ? deps.tournaments : (await fetchJson(DATA("season_schedule.json"))) || [];
  const courses = deps.courses || [];
  const pool = await golferPool(deps);
  const uid = deps.user?.id || null;
  const avatar = (g, cls = "") => (deps.avatar ? deps.avatar(g, cls) : "");
  let career = loadCareer(uid);
  const S = { tab: "standings", busy: false, hp: null, post: null, hubWhileLive: false, lastEvent: null, query: "", pick: null, cloud: null };

  // Signed-in members also keep the career on their account; whichever copy is further along wins.
  const sb = deps.supabase && uid ? deps.supabase : null;
  const SYNC = { pending: "Saving to your account...", saved: "Saved to your account", error: "Couldn't reach your account; saved on this device" };
  const syncText = () => (!sb ? "Saved on this device only" : SYNC[S.cloud] || "Saved to your account");
  const saver = cloudSaver(sb, () => career, (st) => {
    S.cloud = st;
    const el = root.querySelector(".sp-sync");
    if (el) el.textContent = syncText();
  });
  if (sb) {
    const cloud = await cloudLoad(sb);
    const best = furtherAlong(career, cloud);
    if (best && best !== career) { career = best; saveCareer(uid, career); }       // the account copy is ahead
    else if (career && progressOf(career) > progressOf(cloud)) saver.flush();    // this device is ahead
  }

  const save = () => {  // the skills cache is rebuilt from the field, so it isn't stored
    const sk = career._sk, shape = career._shape; delete career._sk; delete career._shape;
    saveCareer(uid, career);
    if (sk) career._sk = sk;
    if (shape) career._shape = shape;
    saver.schedule();
  };
  const courseOf = (id) => courses.find((c) => c.id === id);
  const week = () => career.schedule[career.weekIdx];
  const liveEvent = () => Object.values(career.events).find((e) => e.status === "live");
  const me = () => standings(career).find((r) => r.id === career.userGolferId);
  const userPick = () => {
    const w = week(); if (!w) return null;
    return (career.picks ||= {})[career.weekIdx] || (w.events.find((e) => e.type !== "opposite") || w.events[0]).id;
  };

  function cleanup() {
    S.hp?.destroy(); S.hp = null;
    S.post?.destroy?.(); S.post = null;
  }

  function render() {
    cleanup();
    if (!career) return renderStart();
    if (career.phase === "regular") {
      const live = liveEvent();
      if (live && !S.hubWhileLive) return renderEvent(live);
      return renderHub();
    }
    if (career.phase === "playoffs" || career.phase === "cup") return renderPost();
    return renderHub();
  }

  // ------------------------------------------------------------ start screen
  function renderStart() {
    const q = S.query.trim().toLowerCase();
    const list = Object.entries(pool).map(([id, p]) => ({ id, ...p, sg: sgTotal(p) }))
      .filter((p) => p.name && (!q || p.name.toLowerCase().includes(q)))
      .sort((a, b) => b.sg - a.sg || a.name.localeCompare(b.name)).slice(0, 40);
    S.pick ||= list[0]?.id;
    const picked = pool[S.pick];
    root.innerHTML = `
      ${otherCareersCard()}
      <section class="sp-start">
        <p class="gm-eyebrow">Career mode</p>
        <h2 class="gm-title">Race to the FedEx Cup</h2>
        <p class="gm-lede">Play a full season as one golfer against the top ${FIELD_SIZE} on tour by strokes gained: the
          ${tournaments.length ? "league's" : ""} schedule with real FedEx Cup points and cuts, then the top ${PLAYOFF_SIZE} meet in
          a match-play bracket for the FedEx Cup, and the year ends with the Ryder Cup (odd years) or the Presidents Cup
          (even years). Your career carries on season after season, saved in this browser.</p>
        <h3 class="gm-h3"><span class="gm-num">I</span> Choose your golfer</h3>
        <input class="gm-search sp-search" type="search" placeholder="Search any tour golfer by name" value="${esc(S.query)}" aria-label="Search golfers">
        <div class="sp-golfers">${list.map((p) => `
          <button class="sp-golfer ${p.id === S.pick ? "is-on" : ""}" data-g="${esc(p.id)}">
            ${avatar({ id: p.id, name: p.name, country: p.country }, "gm-avatar--sm")}
            <span class="sp-golfer-name">${esc(p.name)}<small>${esc(p.country || "")}</small></span>
            <span class="sp-golfer-sg">${p.sg >= 0 ? "+" : ""}${p.sg.toFixed(2)} SG</span>
          </button>`).join("") || `<p class="gm-note">No golfers match.</p>`}</div>
      </section>
      <div class="sp-bar">
        <p class="sp-bar-txt">${picked ? `<b>${esc(picked.name)}</b><span>${sgTotal(picked).toFixed(2)} strokes gained per round</span>` : "Pick a golfer"}</p>
        <button class="gm-btn gm-btn--primary" data-act="begin" ${picked ? "" : "disabled"}>Start career</button>
      </div>`;
    root.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => { S.pick = b.dataset.g; renderStart(); }));
    wireOthers();
    const s = root.querySelector(".sp-search");
    s.oninput = () => { S.query = s.value; const pos = s.selectionStart; renderStart(); const s2 = root.querySelector(".sp-search"); s2.focus(); s2.setSelectionRange(pos, pos); };
    root.querySelector('[data-act="begin"]').onclick = () => {
      career = newSeason({ golfers: pool, pastedCount: deps.pastedCount || 0, userId: S.pick,
        seed: Math.random().toString(36).slice(2, 8), tournaments, courses, year: 2027 });
      save(); render();
    };
  }

  // ------------------------------------------------------------ hub
  function renderHub() {
    const st = standings(career), mine = st.find((r) => r.id === career.userGolferId);
    const w = week(), live = liveEvent(), done = career.phase === "done";
    const last = !done && career.phase === "regular" && S.lastEvent && career.events[S.lastEvent];
    root.innerHTML = `
      <header class="sp-head">
        <div class="sp-head-me">${avatar({ id: career.userGolferId, name: career.userName, country: career.field.find((g) => g.id === career.userGolferId)?.country }, "gm-avatar--lg")}
          <div><p class="gm-eyebrow">Race to the FedEx Cup · ${career.year} season</p>
            <h2 class="sp-name">${esc(career.userName)}</h2>
            <p class="sp-meta">FedEx Cup rank <b>${mine?.rank ?? "-"}</b> of ${st.length} · ${fmtPts(mine?.points)} pts · ${mine?.wins || 0} win${mine?.wins === 1 ? "" : "s"} · ${mine?.top10 || 0} top 10s</p></div></div>
        <div class="sp-head-links"><button class="gm-btn gm-btn--ghost gm-btn--sm" data-act="abandon">Abandon career</button>
          <span class="sp-sync">${esc(syncText())}</span></div>
      </header>
      ${otherCareersCard()}
      ${formCard()}
      ${last ? resultCard(last) : ""}
      ${done ? seasonDoneCard(mine) : w ? weekCard(w, live) : ""}
      <nav class="sp-tabs" role="tablist">${[["standings", "FedEx Cup standings"], ["schedule", "Schedule"], ["field", "The field"], ["career", "Career"]]
        .map(([k, l]) => `<button role="tab" class="${S.tab === k ? "is-on" : ""}" data-tab="${k}">${l}</button>`).join("")}</nav>
      <section class="sp-tabpanel">${{ standings: standingsTab, schedule: scheduleTab, field: fieldTab, career: careerTab }[S.tab](st)}</section>
      <div class="sp-bar">${done
        ? `<p class="sp-bar-txt"><b>${career.year} season complete</b><span>Your career continues next year</span></p>
           <button class="gm-btn gm-btn--primary" data-act="next">Start ${career.year + 1} season</button>`
        : live
          ? `<p class="sp-bar-txt"><b>${esc(live.name)}</b><span>In progress</span></p>
             <button class="gm-btn gm-btn--ghost" data-act="simlive">Sim rest of event</button>
             <button class="gm-btn gm-btn--primary" data-act="resume">Resume event</button>`
          : `<p class="sp-bar-txt"><b>Week ${career.weekIdx + 1} of ${career.schedule.length}</b><span>${esc(w.events.find((e) => e.id === userPick())?.name || "")}</span></p>
             <button class="gm-btn gm-btn--ghost" data-act="simall" ${S.busy ? "disabled" : ""}>Sim to end of regular season</button>
             <button class="gm-btn gm-btn--ghost" data-act="simweek" ${S.busy ? "disabled" : ""}>Sim event</button>
             <button class="gm-btn gm-btn--primary" data-act="play" ${S.busy ? "disabled" : ""}>Play event</button>`}</div>`;
    wireHub();
  }

  const sg = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

  // Careers this browser holds under another slot (guest/preview/before sign-in) that are further
  // along than the current one: offer to make one the account's career.
  const where = (c) => `${c.userName} · ${c.year} ${c.phase === "regular" ? `week ${Math.min(c.weekIdx + 1, c.schedule.length)}` : c.phase === "done" ? "season complete" : c.phase}`;
  const others = () => otherLocalCareers(uid).filter((o) => progressOf(o.career) > progressOf(career));
  function wireOthers() {
    root.querySelectorAll("[data-other]").forEach((b) => (b.onclick = () => {
      const o = others()[+b.dataset.other];
      if (!o) return;
      if (career && !confirm(`Replace ${where(career)} with ${where(o.career)}? This becomes your career on every device.`)) return;
      career = o.career; S.lastEvent = null;
      save();
      render();
    }));
  }
  function otherCareersCard() {
    const list = others();
    if (!list.length) return "";
    return `<section class="sp-week sp-other"><p class="gm-eyebrow">Another career on this browser</p>
      ${list.map((o, i) => `<p>${esc(where(o.career))}${career ? ` is further along than this one (${esc(where(career))})` : " is saved on this browser"}.
        <button class="gm-btn gm-btn--primary gm-btn--sm" data-other="${i}">Use ${esc(o.career.userName)}'s career</button></p>`).join("")}
    </section>`;
  }

  /** Your golfer's strokes gained right now: base (season stats) + form, with the season's form line. */
  function formCard() {
    const f = formOf(career, career.userGolferId), cap = Math.max(f.range.hi, -f.range.lo);
    const pts = f.hist.map((v, i) => [i, v]).filter(([, v]) => v != null);
    const W = 560, H = 90, n = Math.max(career.schedule.length - 1, 1);
    const x = (i) => 8 + (i / n) * (W - 16), y = (v) => H / 2 - (v / cap) * (H / 2 - 8);
    const line = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const chart = pts.length ? `<svg class="sp-form-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Form by week this season">
        <rect x="8" y="${y(f.sd).toFixed(1)}" width="${W - 16}" height="${(y(-f.sd) - y(f.sd)).toFixed(1)}" class="sp-form-band"/>
        <line x1="8" x2="${W - 8}" y1="${H / 2}" y2="${H / 2}" class="sp-form-zero"/>
        <path d="${line}" class="sp-form-line"/>
        <text x="8" y="${H - 1}" class="sp-form-lbl">Week 1</text><text x="${W - 8}" y="${H - 1}" text-anchor="end" class="sp-form-lbl">Week ${n + 1}</text>
        <text x="${W - 8}" y="10" text-anchor="end" class="sp-form-lbl">hot</text><text x="${W - 8}" y="${H - 12}" text-anchor="end" class="sp-form-lbl">cold</text>
        ${pts.length ? `<circle cx="${x(pts[pts.length - 1][0]).toFixed(1)}" cy="${y(pts[pts.length - 1][1]).toFixed(1)}" r="4" class="sp-form-dot"/>` : ""}
      </svg>` : "";
    return `<section class="sp-form">
      <div class="sp-form-nums">
        <div><span>Season baseline</span><b>${sg(f.base)}</b></div>
        <div><span>Form</span><b class="sp-form-${f.label.toLowerCase()}">${sg(f.form)} · ${f.label}</b></div>
        <div><span>Strokes gained right now</span><b>${sg(f.now)}</b></div>
      </div>
      ${chart}
      <p class="gm-note">Form swings week to week and carries over, so streaks last a few events. Your typical swing is
        &plusmn;${f.sd.toFixed(2)} a round, and your strokes gained can run from ${sg(f.base + f.range.lo)} to ${sg(f.base + f.range.hi)}.
        ${f.k < 0.1 ? "Your weeks follow a plain bell curve around your baseline." : "Your curve leans: most weeks land a little under your baseline, with rare big weeks that can reach well above it."}
        The shaded band is one typical swing either side.</p>
    </section>`;
  }

  function weekCard(w, live) {
    const pick = userPick();
    return `<section class="sp-week">
      <p class="gm-eyebrow">This week${w.events.length > 1 ? " · choose your event" : ""}</p>
      ${w.events.map((e) => {
        const c = courseOf(e.courseId);
        return `<label class="sp-ev ${e.id === pick ? "is-on" : ""}">
          ${w.events.length > 1 ? `<input type="radio" name="sp-ev" value="${esc(e.id)}" ${e.id === pick ? "checked" : ""} ${live ? "disabled" : ""}>` : ""}
          <span class="sp-ev-body"><span class="sp-ev-name">${evName(e)}</span>
            <span class="sp-ev-meta">${esc(TYPE_LABEL[e.type] || e.type)} · ${esc(c?.name || "")} · ${fmtDate(e.start)}${hasCut(e.type) ? " · cut after 36 holes" : " · no cut"}</span>
            ${w.events.length > 1 ? `<span class="sp-ev-meta">${e.type === "opposite" ? "The rest of the field plays here" : "The top 75 in the standings play here"}</span>` : ""}
          </span></label>`;
      }).join("")}
    </section>`;
  }

  function resultCard(ev) {
    const top = ev.results.slice(0, 5);
    return `<section class="sp-result">
      <p class="gm-eyebrow">Final · ${esc(ev.name)}</p>
      <p class="sp-result-win">${esc(ev.winner.name)} wins at ${toPar(ev.winner.toPar)}${ev.winner.playoff ? " in a playoff" : ""}.
        ${ev.userPos ? `You finished <b>${esc(ev.userPos)}</b>${ev.userPoints ? `, +${fmtPts(ev.userPoints)} FedEx Cup points` : ""}.` : ""}</p>
      <ol class="sp-result-top">${top.map((r) => `<li class="${r.id === career.userGolferId ? "is-me" : ""}"><span>${esc(r.pos)}</span> ${esc(nameOf(r.id))} <span>${toPar(r.toPar)}</span> <span>${fmtPts(r.points)} pts</span></li>`).join("")}</ol>
      <button class="gm-btn gm-btn--ghost gm-btn--sm" data-act="dismiss">Dismiss</button>
    </section>`;
  }

  function seasonDoneCard(mine) {
    const h = career.history[career.history.length - 1];
    return `<section class="sp-week sp-done">
      <p class="gm-eyebrow">${career.year} season complete</p>
      <p>You finished <b>${mine?.rank ?? "-"}</b> in the FedEx Cup standings with ${fmtPts(mine?.points)} points.</p>
      ${h?.playoffs ? `<p>FedEx Cup Playoffs: ${esc(h.playoffs.championName || "")} won the FedEx Cup${h.playoffs.userOut ? `; you: ${esc(h.playoffs.userOut)}` : " (you didn't qualify)"}.</p>` : ""}
      ${h?.cup ? `<p>${esc(h.cup.name || "")}: ${esc(h.cup.text || "")}${h.cup.picked ? ` · your record ${h.cup.record.w}-${h.cup.record.l}-${h.cup.record.h}` : ""}</p>` : ""}
    </section>`;
  }

  const nameOf = (id) => career.field.find((g) => g.id === id)?.name || id;

  function standingsTab(st) {
    return `<div class="sp-scroll"><table class="sp-table">
      <thead><tr><th>Rank</th><th>Golfer</th><th class="num">Points</th><th class="num">Wins</th><th class="num">Top 10</th><th class="num">Starts</th></tr></thead>
      <tbody>${st.map((r) => `<tr class="${r.id === career.userGolferId ? "is-me" : ""} ${r.rank === PLAYOFF_SIZE ? "sp-line" : ""}">
        <td>${r.rank}</td><td>${esc(r.name)}${r.id === career.userGolferId ? ` <span class="sp-you">You</span>` : ""}</td>
        <td class="num">${fmtPts(r.points)}</td><td class="num">${r.wins}</td><td class="num">${r.top10}</td><td class="num">${r.starts}</td></tr>`).join("")}</tbody>
    </table></div><p class="gm-note">The top ${PLAYOFF_SIZE} after the regular season play the FedEx Cup Playoffs.</p>`;
  }

  function scheduleTab() {
    return `<div class="sp-scroll"><table class="sp-table">
      <thead><tr><th>Week</th><th>Event</th><th>Course</th><th>Winner</th><th>You</th></tr></thead>
      <tbody>${career.schedule.map((w, i) => w.events.map((e, j) => {
        const r = career.events[e.id], c = courseOf(e.courseId);
        return `<tr class="${i === career.weekIdx && career.phase === "regular" ? "is-now" : ""}">
          <td>${j ? "" : `${i + 1} · ${fmtDate(e.start)}`}</td><td>${evName(e)}<small class="sp-type">${esc(TYPE_LABEL[e.type] || "")}</small></td>
          <td>${esc(c?.name || "")}</td>
          <td>${r?.status === "done" ? `${esc(r.winner.name)} (${toPar(r.winner.toPar)})` : r?.status === "live" ? "In progress" : i === career.weekIdx ? "This week" : ""}</td>
          <td>${r?.status === "done" ? (r.userPos ? `${esc(r.userPos)}${r.userPoints ? ` · ${fmtPts(r.userPoints)}` : ""}` : "-") : ""}</td></tr>`;
      }).join("")).join("")}
      ${["Playoffs", "Cup"].map((k, i) => `<tr><td>${i ? "Year end" : "Postseason"}</td><td>${i ? (career.year % 2 ? "Ryder Cup" : "Presidents Cup") : "FedEx Cup Playoffs (match play)"}</td>
        <td>${esc(courseOf(i ? career.venues?.cup : career.venues?.playoffs)?.name || "")}</td><td></td><td></td></tr>`).join("")}</tbody>
    </table></div>`;
  }

  function fieldTab() {
    const f = career.field.slice().sort((a, b) => b.sg - a.sg);
    return `<p class="gm-note">The ${career.year} field: the top ${FIELD_SIZE} golfers by strokes gained when the season began. Missing stats use the worst value entered. Form is this week's swing; SG now = baseline + form.</p>
      <div class="sp-scroll"><table class="sp-table">
      <thead><tr><th>#</th><th>Golfer</th><th>Country</th><th class="num">SG baseline</th><th class="num">Form</th><th class="num">SG now</th><th>Stats</th></tr></thead>
      <tbody>${f.map((g, i) => { const fo = formOf(career, g.id); return `<tr class="${g.id === career.userGolferId ? "is-me" : ""}"><td>${i + 1}</td><td>${esc(g.name)}</td><td>${esc(g.country || "")}</td>
        <td class="num">${sg(g.sg)}</td><td class="num sp-form-${fo.label.toLowerCase()}">${sg(fo.form)}</td><td class="num"><b>${sg(fo.now)}</b></td><td class="sp-src">${esc(g.src || "")}</td></tr>`; }).join("")}</tbody>
    </table></div>`;
  }

  function careerTab() {
    const h = career.history;
    const tot = { wins: sum(h.map((x) => x.wins || 0)), titles: h.filter((x) => x.playoffs?.userOut === "Champion").length,
      cups: h.filter((x) => x.cup?.picked).length };
    return `<div class="sp-totals"><span><b>${h.length}</b> season${h.length === 1 ? "" : "s"} completed</span><span><b>${tot.wins}</b> wins</span>
        <span><b>${tot.titles}</b> FedEx Cup title${tot.titles === 1 ? "" : "s"}</span><span><b>${tot.cups}</b> cup appearance${tot.cups === 1 ? "" : "s"}</span></div>
      ${h.length ? `<div class="sp-scroll"><table class="sp-table">
        <thead><tr><th>Year</th><th class="num">FedEx rank</th><th class="num">Points</th><th class="num">Wins</th><th class="num">Top 10</th><th>Playoffs</th><th>Cup</th></tr></thead>
        <tbody>${h.map((x) => `<tr><td>${x.year}</td><td class="num">${x.rank ?? "-"}</td><td class="num">${fmtPts(x.points)}</td><td class="num">${x.wins || 0}</td><td class="num">${x.top10 || 0}</td>
          <td>${esc(x.playoffs?.userOut || "Didn't qualify")}</td>
          <td>${x.cup ? `${esc(x.cup.name || "")}: ${esc(x.cup.text || "")}${x.cup.picked ? ` (${x.cup.record.w}-${x.cup.record.l}-${x.cup.record.h})` : " (not picked)"}` : ""}</td></tr>`).join("")}</tbody>
      </table></div>` : `<p class="gm-note">Finished seasons appear here.</p>`}`;
  }

  function wireHub() {
    const on = (act, fn) => root.querySelector(`[data-act="${act}"]`)?.addEventListener("click", fn);
    root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; renderHub(); }));
    root.querySelectorAll('input[name="sp-ev"]').forEach((r) => (r.onchange = () => { (career.picks ||= {})[career.weekIdx] = r.value; save(); renderHub(); }));
    on("abandon", async () => {
      if (!confirm("Abandon this career? It can't be undone.")) return;
      clearCareer(uid); career = null; S.lastEvent = null;
      await cloudClear(sb);  // or the account copy, being further along, would come back next visit
      render();
    });
    on("dismiss", () => { S.lastEvent = null; renderHub(); });
    wireOthers();
    on("next", () => {
      career = newSeason({ golfers: pool, pastedCount: deps.pastedCount || 0, userId: career.userGolferId, seed: career.seed,
        tournaments, courses, year: career.year + 1, prev: career });
      S.lastEvent = null; save(); render();
    });
    on("play", () => playEvent());
    on("resume", () => { S.hubWhileLive = false; render(); });
    on("simweek", () => { const ev = userPick(); simWeek(career, courses, ev); S.lastEvent = ev; save(); render(); });
    on("simlive", () => { const live = liveEvent(); simWeek(career, courses, live.id); S.lastEvent = live.id; S.hubWhileLive = false; save(); render(); });
    on("simall", async () => {
      S.busy = true; renderHub();
      const bar = root.querySelector(".sp-bar-txt");
      while (career.phase === "regular") {
        const ev = userPick();
        simWeek(career, courses, ev);
        S.lastEvent = ev;
        if (bar) bar.innerHTML = `<b>Simulating...</b><span>Week ${Math.min(career.weekIdx + 1, career.schedule.length)} of ${career.schedule.length}</span>`;
        await tick();
      }
      S.busy = false; save(); render();
    });
  }

  // ------------------------------------------------------------ an event, shot by shot
  async function playEvent() {
    const w = week(), pick = userPick();
    const ent = weekEntrants(career, w, pick);
    for (const ev of w.events) {
      if (ev.id === pick || career.events[ev.id]?.status === "done") continue;
      simEvent(career, ev, ent[ev.id], courseOf(ev.courseId));  // the other event this week
    }
    const ev = w.events.find((e) => e.id === pick), course = courseOf(ev.courseId);
    await loadGeo(course);
    startEvent(career, ev, ent[ev.id], course, true);
    S.hubWhileLive = false;
    save(); render();
  }

  /** Where the user is: {r, h} = round and hole index of the next hole, r = 4 when done. */
  function progress(live) {
    const r = live.user.findIndex((x) => x.length < 18);
    return r < 0 ? { r: 4, h: 0 } : { r, h: live.user[r].length };
  }

  /** Cut status once 36 holes are in: true = made / no cut, false = missed, null = not yet. */
  function cutState(live) {
    if (!hasCut(live.type)) return true;
    if (live.user[1].length < 18) return null;
    if (live.madeCut == null) live.madeCut = userMakesCut(live);
    return live.madeCut;
  }

  /** Live leaderboard: every golfer through the same number of holes as the user. */
  function liveBoard(live, course) {
    const pars = course.holes.map((h) => h.par), parTot = sum(pars);
    const { r, h } = progress(live);
    const R = Math.min(r, 3), H = r >= 4 ? 18 : h;
    const thru = (rounds) => {
      let s = 0, n = 0;
      for (let i = 0; i < R; i++) { s += sum(rounds[i]); n += parTot; }
      if (r < 4) { s += sum(rounds[R].slice(0, H)); n += sum(pars.slice(0, H)); }
      else { s += sum(rounds[3]); n += parTot; }
      return s - n;
    };
    let ids = Object.keys(live.ai);
    if (hasCut(live.type) && R >= 2) {  // after 36: only those who made it
      const rows = [...ids.map((id) => ({ id, rounds: live.ai[id] })), { id: career.userGolferId, rounds: live.user }];
      const made = cutAfter36(rows);
      ids = ids.filter((_, i) => made[i]);
    }
    const rows = ids.map((id) => ({ id, name: nameOf(id), tp: thru(live.ai[id]) }));
    if (cutState(live) !== false) rows.push({ id: career.userGolferId, name: career.userName, tp: thru(live.user), me: true });
    rows.sort((a, b) => a.tp - b.tp || (b.me ? 1 : 0) - (a.me ? 1 : 0));
    rows.forEach((x, i) => { const first = rows.findIndex((y) => y.tp === x.tp); x.pos = `${rows.filter((y) => y.tp === x.tp).length > 1 ? "T" : ""}${first + 1}`; });
    const label = r >= 4 ? "Final round complete" : H === 0 ? (R === 0 ? "Before round 1" : `After round ${R}`) : `Round ${R + 1}, thru ${H}`;
    return { rows, label };
  }

  function boardHTML(board, full) {
    const meRow = board.rows.find((x) => x.me);
    const top = full ? board.rows : board.rows.slice(0, 10);
    const rows = meRow && !top.includes(meRow) ? [...top, meRow] : top;
    return `<div class="sp-board"><div class="sp-board-head"><b>Leaderboard</b><span>${esc(board.label)}</span>
        <button class="gm-btn gm-btn--ghost gm-btn--sm" data-act="board">${full ? "Top 10" : "Full leaderboard"}</button></div>
      <table class="sp-table sp-table--tight"><tbody>${rows.map((x) => `<tr class="${x.me ? "is-me" : ""}"><td>${x.pos}</td><td>${esc(x.name)}</td><td class="num">${toPar(x.tp)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderEvent(live, full = false) {
    cleanup();
    const course = courseOf(live.courseId);
    // A resumed event (after a reload or Resume from the hub) still needs the course's real layout;
    // without it the hole falls back to the plain tee/fairway/green drawing.
    if (course?.geo_file && !course._geoLoaded) {
      root.innerHTML = `<p class="gm-loading">Loading ${esc(course.name)}...</p>`;
      loadGeo(course).then(() => renderEvent(live, full));
      return;
    }
    const { r, h } = progress(live), cut = cutState(live);
    const board = liveBoard(live, course), meRow = board.rows.find((x) => x.me);
    const head = `<div class="sp-evhead"><div><p class="gm-eyebrow">${esc(TYPE_LABEL[live.type] || "")} · ${career.year}</p>
        <h3 class="sp-evname">${evName(live)}</h3></div>
        <button class="gm-btn gm-btn--ghost gm-btn--sm" data-act="hub">Season hub</button></div>`;
    if (r >= 4 || cut === false) {
      root.innerHTML = `${head}<section class="sp-week">
        <p class="sp-big">${cut === false ? "You missed the cut." : `You finish at ${toPar(meRow?.tp ?? 0)}.`}</p>
        <p class="gm-note">${cut === false ? "The cut fell after 36 holes (top 65 and ties). The weekend plays on without you." : "Everyone's final round is in."}</p>
        <button class="gm-btn gm-btn--primary" data-act="finish">See the final results</button></section>
        <div class="gm-card-wrap sp-scorecard">${scorecardHTML(course.holes, live.user, Math.min(r, 3))}</div>${boardHTML(board, full)}`;
      root.querySelector('[data-act="finish"]').onclick = () => finishLive(live, course);
    } else {
      root.innerHTML = `${head}<div class="sp-holewrap"></div>
        <div class="gm-card-wrap sp-scorecard">${scorecardHTML(course.holes, live.user, r, h)}</div>${boardHTML(board, full)}`;
      const sk = skillsMap(career)[career.userGolferId];
      const lastHole = h === 17, lastRound = r === 3;
      S.hp = playHole(root.querySelector(".sp-holewrap"), {
        course, holeIdx: h, golfer: { id: career.userGolferId, name: career.userName, sk },
        rng: makeRng(`${career.seed}|${career.year}|${live.id}|me|${r}|${h}`),
        label: `Round ${r + 1}`,
        extraHeader: `<p class="sp-pos">${meRow ? `<b>${meRow.pos}</b> at ${toPar(meRow.tp)}` : ""} · ${esc(board.label)} · ${(() => { const f = formOf(career, career.userGolferId); return `SG now ${sg(f.now)} (${f.label.toLowerCase()})`; })()}</p>`,
        continueLabel: lastHole ? (lastRound ? "Finish the tournament" : `Start round ${r + 2}`) : `On to hole ${h + 2}`,
        sims: [{ label: "Sim rest of round", onClick: () => simUser(live, course, "round") },
               { label: "Sim rest of event", onClick: () => simUser(live, course, "event") }],
        onHoled: (strokes) => { live.user[r].push(strokes); save(); renderEvent(live, full); },
      });
    }
    root.querySelector('[data-act="hub"]').onclick = () => { S.hubWhileLive = true; render(); };
    root.querySelector('[data-act="board"]').onclick = () => renderEvent(live, !full);
  }

  /** Finish the user's holes with the shot model (caddie's picks): the rest of this round or the
   * rest of the event, stopping at the cut if he misses it. */
  function simUser(live, course, scope) {
    const sk = skillsMap(career)[career.userGolferId];
    const start = progress(live).r;
    for (let r = start; r < 4; r++) {
      if (scope === "round" && r > start) break;
      if (r === 2 && cutState(live) === false) break;
      while (live.user[r].length < 18) {
        const h = live.user[r].length;
        live.user[r].push(autoStrokes(course, h, sk, makeRng(`${career.seed}|${career.year}|${live.id}|me|${r}|${h}`)));
      }
    }
    save(); renderEvent(live);
  }

  function finishLive(live, course) {
    finishEvent(career, live.id, course);
    const w = week();
    if (w && w.events.every((e) => career.events[e.id]?.status === "done")) advanceWeek(career);
    S.lastEvent = live.id; S.hubWhileLive = false;
    save(); render();
  }

  // ------------------------------------------------------------ playoffs and the cup (ui_post.js)
  async function renderPost() {
    const st = standings(career), mine = st.find((r) => r.id === career.userGolferId);
    root.innerHTML = `<header class="sp-head sp-head--slim"><div><p class="gm-eyebrow">Race to the FedEx Cup · ${career.year} season</p>
        <p class="sp-meta">${esc(career.userName)} · regular season rank <b>${mine?.rank ?? "-"}</b> · ${fmtPts(mine?.points)} pts</p></div>
        <div class="sp-head-links"><button class="gm-btn gm-btn--ghost gm-btn--sm" data-act="standings">Final standings</button></div></header>
      <div class="sp-post"><p class="gm-loading">Loading...</p></div>`;
    root.querySelector('[data-act="standings"]').onclick = () => {
      const box = root.querySelector(".sp-post");
      box.innerHTML = `${standingsTab(st)}<button class="gm-btn gm-btn--primary" data-act="back">Back</button>`;
      box.querySelector('[data-act="back"]').onclick = () => render();
    };
    const el = root.querySelector(".sp-post");
    let mod;
    try { mod = await import("./ui_post.js"); } catch (e) {
      console.warn("ui_post.js unavailable", e);
      el.innerHTML = `<p class="gm-loading">The ${career.phase === "playoffs" ? "FedEx Cup Playoffs are" : "cup is"} coming soon.</p>`;
      return;
    }
    const ctx = {
      career, save, courses, loadGeo, user: deps.user || null, avatar, golfers: pool,
      onDone: () => {
        if (career.phase === "playoffs") career.phase = "cup";
        else { pushHistory(); career.phase = "done"; }
        save(); render();
      },
    };
    S.post = await (career.phase === "playoffs" ? mod.mountPlayoffs(el, ctx) : mod.mountCup(el, ctx));
  }

  function pushHistory() {
    if (career.history.some((x) => x.year === career.year && x.seed === career.seed)) return;
    const mine = me();
    career.history.push({ year: career.year, seed: career.seed, rank: mine?.rank ?? null, points: mine?.points ?? 0,
      wins: mine?.wins || 0, top10: mine?.top10 || 0, starts: mine?.starts || 0,
      fedexLeader: standings(career)[0]?.name || "", playoffs: career.playoffResult || null, cup: career.cupResult || null });
  }

  render();
  return { destroy: cleanup };
}
