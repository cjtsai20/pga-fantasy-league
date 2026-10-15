// Race to the FedEx Cup, after the regular season: the FedEx Cup Playoffs (16-man match play
// bracket) and the year's cup (Ryder Cup in odd years, Presidents Cup in even years).
//
//   mountPlayoffs(el, ctx) / mountCup(el, ctx) -> { destroy }
//   ctx = { career, save(), courses, loadGeo(course), user, avatar(golfer)?, onDone(summary) }
//
// The bracket and cup logic live in match.js and cups.js; this file is screens only. The user's own
// matches are played hole by hole with holeplay.js; everyone else's come from the quick model.
// Writes career.playoffs / career.playoffResult and career.cup / career.cupResult / career.cupHolders,
// plus career.userMatch for a match in progress, and saves after every hole and every sim step.

import * as M from "./match.js";
import * as C from "./cups.js";
import { skillsMap, standings, sgTotal, makeRng } from "./engine.js";
import { skillsFrom, distToPin } from "../sim.js";
import { golferAvatar } from "../../avatar.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const GIMME_YDS = 2 / 3;  // putts inside 2 ft are conceded
const TEAM = { USA: { name: "United States", cls: "usa" }, EUR: { name: "Europe", cls: "eur" }, INT: { name: "International", cls: "int" } };
const FORMAT = { singles: "Singles", fourball: "Four-ball", foursomes: "Foursomes" };

function injectCss() {
  if (document.getElementById("season-post-css")) return;
  const link = document.createElement("link");
  link.id = "season-post-css";
  link.rel = "stylesheet";
  link.href = new URL("../../../css/season_post.css", import.meta.url).href;
  document.head.appendChild(link);
}

async function holeplay() {
  try { return await import("./holeplay.js"); } catch { return null; }
}

/** Fresh rng per step, from the career seed and a saved counter, so a resumed career keeps going. */
function stepRng(career, tag, holder) {
  holder.step = (holder.step || 0) + 1;
  return makeRng(`${career.seed}|${career.year}|${tag}|${holder.step}`);
}

const pic = (ctx, g, cls = "") => `<span class="pp-av ${cls}">${ctx.avatar ? ctx.avatar(g) : golferAvatar({ id: g.id, name: g.name, country: g.country })}</span>`;
const names = (side) => side.map((g) => g.name).join(" & ");
/** "Won 3&2" / "Lost 1 UP" / "Halved"; extra-hole results already read "Won on 19th". */
const outcome = (won, result) => (won == null ? "Halved" : /^Won on/.test(result) ? (won ? result : result.replace("Won", "Lost")) : `${won ? "Won" : "Lost"} ${result}`);

async function venue(ctx, id) {
  const course = ctx.courses.find((c) => c.id === id) || ctx.courses.find((c) => c.layout_source === "osm") || ctx.courses[0];
  if (ctx.loadGeo) await ctx.loadGeo(course);
  return course;
}

// ================================================================ a match the user plays
/**
 * Hole-by-hole match for the user. `pending` = {kind, format, a, b, userSide, title, partner?} where
 * a/b are side arrays of {id, name, sk}. Resumes career.userMatch.state when it's the same match.
 * Calls onFinish(matchState) once the match is over.
 */
async function playMatch(el, ctx, course, pending, onFinish) {
  const career = ctx.career, me = career.userGolferId;
  const deps = M.engineDeps(course);
  const hp = await holeplay();
  const um = career.userMatch;
  const st = um && um.kind === pending.kind && um.key === pending.key ? um.state
    : M.startMatch({ format: pending.format, a: pending.a, b: pending.b, course, extra: pending.kind === "playoffs" });
  career.userMatch = { kind: pending.kind, key: pending.key, state: st };
  ctx.save();

  const us = pending.userSide, them = us === "a" ? "b" : "a";
  const meG = st[us].find((g) => g.id === me) || st[us][0];
  const partner = st[us].find((g) => g.id !== me) || null;
  let hole = null, dead = false;

  const statusLine = () => `<div class="pp-status">
      <span class="pp-status-who">${esc(names(st[us]))} <i>v</i> ${esc(names(st[them]))}</span>
      <b>${esc(st.over ? outcome(st.winner ? st.winner === us : null, st.result) : M.statusText(st.diff, st.thru, us))}</b>
      <span class="pp-status-fmt">${esc(FORMAT[st.format])}${st.thru >= 18 && !st.over ? " · extra holes" : ""}</span>
    </div>
    <div class="pp-strip">${st.holes.map((h) => `<span class="pp-dot is-${h.res === "h" ? "h" : h.res === us ? "w" : "l"}" title="Hole ${h.n}: ${h[us]} v ${h[them]}">${h.n}</span>`).join("")}</div>`;

  // Match scorecard: par, both sides' strokes, and the running match status after each hole (extra
  // holes, numbered 19+, are added as they're played). Hole winners are shaded.
  const matchCard = (curIdx = -1) => {
    const n = Math.max(18, st.holes.length);
    const holeN = Array.from({ length: n }, (_, i) => i + 1);
    const played = Object.fromEntries(st.holes.map((h) => [h.n, h]));
    let run = 0;
    const status = {};
    for (const h of st.holes) { run += h.res === "h" ? 0 : h.res === us ? 1 : -1; status[h.n] = run === 0 ? "AS" : `${Math.abs(run)} ${run > 0 ? "UP" : "DN"}`; }
    const par = (k) => course.holes[(k - 1) % 18].par;
    const cell = (k, side) => {
      const h = played[k];
      if (!h) return "<td></td>";
      const won = h.res === side, cls = h.res === "h" ? "pc-h" : won ? "pc-w" : "";
      return `<td class="${cls}">${h[side]}</td>`;
    };
    const th = (k) => `<th class="${k === curIdx + 1 ? "is-cur" : ""}">${k}</th>`;
    return `<div class="gm-card-wrap pp-matchcard"><h3 class="gm-h4">Match scorecard</h3>
      <div class="gm-scroll"><table class="gm-scorecard pp-mc">
        <tr class="sc-hole"><th>Hole</th>${holeN.map(th).join("")}</tr>
        <tr class="sc-par"><th>Par</th>${holeN.map((k) => `<td>${par(k)}</td>`).join("")}</tr>
        <tr class="pp-mc-us"><th>${esc(names(st[us]))}</th>${holeN.map((k) => cell(k, us)).join("")}</tr>
        <tr class="pp-mc-them"><th>${esc(names(st[them]))}</th>${holeN.map((k) => cell(k, them)).join("")}</tr>
        <tr class="pp-mc-status"><th>Match</th>${holeN.map((k) => `<td>${status[k] || ""}</td>`).join("")}</tr>
      </table></div></div>`;
  };

  // strokes for both sides on this hole, given the user's own ball (or the foursomes team ball)
  function sideScores(i, userStrokes, rng) {
    let mine = userStrokes;
    if (st.format === "fourball" && partner) mine = Math.min(userStrokes, M.aiStrokes(st, us, i, rng, deps, { excludeId: me }));
    const theirs = M.aiStrokes(st, them, i, rng, deps);
    return us === "a" ? [mine, theirs] : [theirs, mine];
  }

  function record(i, a, b) {
    M.playHoleResult(st, a, b);
    career.userMatch.state = st;
    ctx.save();
    reveal(i, a, b);
  }

  function reveal(i, a, b) {
    hole?.destroy?.();
    const mine = us === "a" ? a : b, theirs = us === "a" ? b : a;
    const msg = mine < theirs ? "You win the hole" : mine > theirs ? `${names(st[them])} win${st[them].length > 1 ? "" : "s"} the hole` : "Hole halved";
    el.innerHTML = `<section class="pp-card">${statusLine()}
      <div class="pp-reveal"><p class="pp-reveal-h">Hole ${st.holes[st.holes.length - 1].n}</p>
        <p><b>${esc(names(st[us]))}</b> ${mine} · <b>${esc(names(st[them]))}</b> ${theirs}</p><p class="pp-reveal-msg">${esc(msg)}</p></div>
      <div class="pp-actions"><button class="gm-btn gm-btn--primary" data-pp="next">${st.over ? "Match result" : "Next hole"}</button></div></section>${matchCard()}`;
    el.querySelector('[data-pp="next"]').onclick = () => (st.over ? done() : nextHole());
  }

  function simRest() {
    hole?.destroy?.();
    const rng = stepRng(career, `${pending.kind}-sim`, career.userMatch);
    M.simMatch({ state: st, rng, deps });
    career.userMatch.state = st;
    ctx.save();
    done();
  }

  function done() {
    hole?.destroy?.();
    el.innerHTML = `<section class="pp-card pp-final">${statusLine()}
      <div class="pp-actions"><button class="gm-btn gm-btn--primary" data-pp="fin">Continue</button></div></section>${matchCard()}`;
    el.querySelector('[data-pp="fin"]').onclick = () => { career.userMatch = null; ctx.save(); onFinish(st); };
  }

  function nextHole() {
    if (dead) return;
    if (st.over) return done();
    const i = M.nextHoleIdx(st);
    const rng = stepRng(career, `${pending.kind}-hole`, career.userMatch);
    const finishHole = (strokes) => { const [a, b] = sideScores(i, strokes, rng); record(i, a, b); };
    const opts = {
      course, holeIdx: i, golfer: meG, rng,
      label: pending.title, extraHeader: statusLine(), continueLabel: "See the hole result",
      onHoled: (strokes) => finishHole(strokes),
      actions: [
        { label: "Concede hole", onClick: () => { const opp = M.aiStrokes(st, them, i, rng, deps); record(i, ...(us === "a" ? [opp + 1, opp] : [opp, opp + 1])); } },
        { label: "Take the gimme", onClick: (hst) => {
          if (!hst.holed && hst.lie === "green" && distToPin(hst) <= GIMME_YDS) finishHole(hst.strokes + 1);
          else flash(el, "Only putts inside 2 ft are conceded.");
        } },
      ],
      sims: [{ label: "Sim rest of match", onClick: simRest }],
    };
    if (st.format === "foursomes" && partner) {
      // alternate shot: the user tees off on odd holes, his partner on even ones, then they alternate
      const userFirst = (i + 1) % 2 === 1;
      opts.partner = partner;
      opts.shooter = (shot) => ((shot % 2 === 1) === userFirst ? "user" : "partner");
    }
    el.innerHTML = `<div class="pp-holebox"></div>${matchCard(i)}`;
    const box = el.querySelector(".pp-holebox");
    if (hp?.playHole) hole = hp.playHole(box, opts);
    else hole = stubHole(box, opts, deps);  // holeplay.js missing: one-click holes from the quick model
  }

  nextHole();
  return { destroy() { dead = true; hole?.destroy?.(); } };
}

function flash(el, msg) {
  let t = el.querySelector(".pp-flash");
  if (!t) { t = document.createElement("p"); t.className = "pp-flash"; el.prepend(t); }
  t.textContent = msg;
}

/** Fallback when holeplay.js isn't available: the user's hole from the quick model, one click. */
function stubHole(el, o, deps) {
  const h = o.course.holes[o.holeIdx];
  el.innerHTML = `<section class="pp-card">${o.extraHeader}<p class="pp-reveal-h">${esc(o.label || "")} · Hole ${h.n} · Par ${h.par} · ${h.yards} yds</p>
    <div class="pp-actions"><button class="gm-btn gm-btn--primary" data-hp="sim">Play the hole</button>
    ${o.sims.map((s, i) => `<button class="gm-btn gm-btn--ghost" data-st="${i}">${esc(s.label)}</button>`).join("")}</div></section>`;
  const simHole = () => o.onHoled(deps.quickHole(o.golfer.sk, o.holeIdx, o.rng));
  el.querySelector('[data-hp="sim"]').onclick = simHole;
  el.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => o.sims[+b.dataset.st].onClick()));
  return { destroy() {}, simHole };
}

// ================================================================ playoffs
export async function mountPlayoffs(el, ctx) {
  injectCss();
  const career = ctx.career, me = career.userGolferId;
  const course = await venue(ctx, career.venues?.playoffs);
  const deps = M.engineDeps(course);
  const sk = skillsMap(career);
  if (!career.playoffs) {
    const top = standings(career).slice(0, 16).map((r) => ({ id: r.id, name: r.name, points: r.points, sk: sk[r.id] }));
    career.playoffs = M.bracket.create(top);
    career.playoffs.courseId = course.id;
    ctx.save();
  }
  const B = career.playoffs;
  let sub = null;

  const golfer = (id) => B.golfers[id];
  const winnerOf = (m) => (m.res ? (m.res.winner === "a" ? m.a : m.b) : null);

  function bracketHTML() {
    return `<div class="pp-bracket">${M.ROUND_NAMES.map((rn, r) => `<div class="pp-round"><p class="pp-round-h">${rn}</p><div class="pp-round-body">
      ${(B.rounds[r].length ? B.rounds[r] : Array.from({ length: 8 >> r }, () => null)).map((m) => !m ? `<div class="pp-m is-tbd"><span>TBD</span><span>TBD</span></div>` : `
        <div class="pp-m ${m.a === me || m.b === me ? "is-me" : ""}">
          ${["a", "b"].map((s) => { const g = golfer(m[s]); const won = winnerOf(m) === m[s];
            return `<span class="${won ? "is-win" : m.res ? "is-out" : ""}"><i>${g.seed}</i>${esc(g.name)}${won ? ` <b>${esc(m.res.result)}</b>` : ""}</span>`; }).join("")}
        </div>`).join("")}</div></div>`).join("")}</div>`;
  }

  function finish() {
    const champ = B.champion;
    const out = (() => {
      if (!B.golfers[me]) return null;
      if (champ === me) return "Champion";
      for (let r = 0; r < 4; r++) for (const m of B.rounds[r]) if ((m.a === me || m.b === me) && m.res && winnerOf(m) !== me) return M.ROUND_NAMES[r];
      return null;
    })();
    const lastUser = [...B.rounds.flat()].reverse().find((m) => m && (m.a === me || m.b === me) && m.res);
    career.playoffResult = {
      champion: champ, championName: golfer(champ)?.name, course: course.name,
      userSeed: B.golfers[me]?.seed ?? null, userOut: out, userLastResult: lastUser ? outcome(winnerOf(lastUser) === me, lastUser.res.result) : null,
    };
    ctx.save();
    return career.playoffResult;
  }

  function render() {
    sub?.destroy?.(); sub = null;
    const um = M.bracket.nextUserMatch(B, me);
    const inField = !!B.golfers[me];
    let action;
    if (B.champion) {
      const r = finish(), c = golfer(B.champion);
      action = `<div class="pp-champ">${pic(ctx, c, "pp-av--xl")}<div><p class="pp-eyebrow">FedEx Cup Champion</p><h3>${esc(c.name)}</h3>
        <p class="muted">${esc(r.userOut === "Champion" ? "That's you. What a finish." : inField ? `You went out in the ${r.userOut} (${r.userLastResult}).` : "You didn't make the top 16 this year.")}</p></div></div>
        <div class="pp-actions"><button class="gm-btn gm-btn--primary" data-pp="done">Continue to the ${esc(C.CUPS[C.cupKind(career.year)].name)}</button></div>`;
    } else if (um) {
      const opp = um.userSide === "a" ? um.b : um.a;
      action = `<div class="pp-next"><p class="pp-eyebrow">${esc(M.ROUND_NAMES[um.round])}</p>
        <p class="pp-vs">${pic(ctx, golfer(me))}<b>(${golfer(me).seed}) ${esc(golfer(me).name)}</b><i>v</i><b>(${opp.seed}) ${esc(opp.name)}</b>${pic(ctx, opp)}</p></div>
        <div class="pp-actions"><button class="gm-btn gm-btn--primary" data-pp="play">Play your match</button>
          <button class="gm-btn gm-btn--ghost" data-pp="simme">Sim your match</button></div>`;
    } else {
      action = `<p class="muted">${inField ? "You're out of the bracket. The rest is simulated." : "You didn't finish in the top 16, so you're watching from home."}</p>
        <div class="pp-actions"><button class="gm-btn gm-btn--primary" data-pp="round">Sim the ${esc(M.ROUND_NAMES[B.round])}</button>
          <button class="gm-btn gm-btn--ghost" data-pp="all">Sim to the champion</button></div>`;
    }
    el.innerHTML = `<section class="pp-wrap pg-game">
      <header class="pp-head"><p class="pp-eyebrow">Race to the FedEx Cup · ${career.year}</p>
        <h2>FedEx Cup Playoffs at ${esc(course.name)}</h2>
        <p class="muted">The top 16 in points, seeded, 18-hole matches. Ties go to sudden death from the 1st.</p></header>
      <section class="pp-card">${action}</section>
      <section class="pp-card">${bracketHTML()}</section></section>`;

    const on = (k, f) => { const b = el.querySelector(`[data-pp="${k}"]`); if (b) b.onclick = f; };
    on("done", () => ctx.onDone?.(career.playoffResult));
    on("round", () => { M.bracket.simRound(B, course, deps, stepRng(career, "playoffs", B)); ctx.save(); render(); });
    on("all", () => { let g = 0; while (!B.champion && g++ < 8) M.bracket.simRound(B, course, deps, stepRng(career, "playoffs", B)); ctx.save(); render(); });
    on("simme", () => {
      const rng = stepRng(career, "playoffs", B);
      M.bracket.simRound(B, course, deps, rng, { skipIds: [me] });
      const st = M.simMatch({ format: "singles", a: [um.a], b: [um.b], course, rng, deps, extra: true });
      M.bracket.recordMatch(B, um.idx, st);
      ctx.save(); render();
    });
    on("play", async () => {
      const box = el.querySelector(".pp-wrap");
      box.innerHTML = `<div class="pp-play"></div>`;
      const opp = um.userSide === "a" ? um.b : um.a;
      sub = await playMatch(box.firstElementChild, ctx, course,
        { kind: "playoffs", key: `${um.round}:${um.idx}`, format: "singles", a: [um.a], b: [um.b], userSide: um.userSide,
          title: `${M.ROUND_NAMES[um.round]} v ${opp.name}` },
        (st) => {
          M.bracket.simRound(B, course, deps, stepRng(career, "playoffs", B), { skipIds: [me] });
          M.bracket.recordMatch(B, um.idx, st);
          ctx.save(); render();
        });
    });
  }

  // a match left half-played resumes straight into the hole screen
  render();
  if (career.userMatch?.kind === "playoffs" && M.bracket.nextUserMatch(B, me)) el.querySelector('[data-pp="play"]')?.click();
  return { destroy() { sub?.destroy?.(); el.innerHTML = ""; } };
}

// ================================================================ cups
export async function mountCup(el, ctx) {
  injectCss();
  const career = ctx.career, me = career.userGolferId;
  const kind = C.cupKind(career.year), def = C.CUPS[kind];
  const course = await venue(ctx, career.venues?.cup);
  const deps = M.engineDeps(course);
  if (!career.cup || career.cup.year !== career.year) {
    const sk = skillsMap(career);
    const field = career.field.map((g) => ({ id: g.id, name: g.name, country: g.country, sk: sk[g.id], sg: g.sg }));
    const inField = new Set(field.map((g) => g.id));
    const extra = Object.entries(ctx.golfers || {}).filter(([id, p]) => p?.name && !inField.has(id))
      .map(([id, p]) => ({ id, name: p.name, country: p.country || "", sk: skillsFrom(p.stats || {}), sg: sgTotal(p) }));
    career.cup = C.create({ year: career.year, field, extra, standings: standings(career), holder: career.cupHolders?.[kind] ?? null,
      rng: makeRng(`${career.seed}|${career.year}|cup-teams`) });
    career.cup.courseId = course.id;
    ctx.save();
  }
  const S = career.cup;
  const mySide = C.userSide(S, me);
  let sub = null;

  const g = (id) => S.golfers[id];
  const sideCls = (side) => TEAM[side]?.cls || "int";

  function board() {
    const sc = C.score(S), [A, Bs] = S.sides;
    return `<div class="pp-board">
      <div class="pp-board-team is-${sideCls(A)}"><span>${esc(S.teamNames[A])}</span><b>${fmtPts(sc.usa)}</b></div>
      <div class="pp-board-mid"><p>${esc(def.name)} ${S.year}</p><p class="muted">${sc.toWin} to win${S.holder ? ` · ${esc(S.teamNames[S.holder])} hold the Cup` : ""}</p>
        ${sc.text ? `<p class="pp-board-text">${esc(sc.text)}</p>` : ""}</div>
      <div class="pp-board-team is-${sideCls(Bs)}"><span>${esc(S.teamNames[Bs])}</span><b>${fmtPts(sc.other)}</b></div></div>`;
  }

  function teamsHTML() {
    return `<div class="pp-teams">${S.sides.map((side) => `<div class="pp-team is-${sideCls(side)}"><p class="pp-team-h">${esc(S.teamNames[side])}</p>
      <ol>${S.teams[side].map((id) => { const r = C.recordFor(S, id);
        return `<li class="${id === me ? "is-me" : ""}">${pic(ctx, g(id), "pp-av--sm")}<span>${esc(g(id).name)}</span><small>${esc(C.countryCode(g(id).country))}</small>
          ${r.played ? `<em>${r.w}-${r.l}-${r.h}</em>` : ""}</li>`; }).join("")}</ol></div>`).join("")}</div>
      ${S.notes?.length ? `<p class="muted pp-note">${S.notes.map(esc).join(" ")}</p>` : ""}`;
  }

  function sessionsHTML() {
    return `<div class="pp-sessions">${S.sessions.map((ses, si) => `<div class="pp-ses ${si === S.current ? "is-now" : ""}">
      <p class="pp-ses-h">${esc(ses.name)} <span class="muted">${ses.matches ? sessionPts(ses) : `${ses.n} matches`}</span></p>
      ${ses.matches ? `<ul>${ses.matches.map((m) => { const w = m.res?.winner;
        return `<li class="${[...m.a, ...m.b].includes(me) ? "is-me" : ""}">
          <span class="is-${sideCls(S.sides[0])} ${w === "a" ? "is-win" : ""}">${esc(m.a.map((id) => g(id).name).join(" & "))}</span>
          <b>${m.res ? esc(m.res.result) : "v"}</b>
          <span class="is-${sideCls(S.sides[1])} ${w === "b" ? "is-win" : ""}">${esc(m.b.map((id) => g(id).name).join(" & "))}</span></li>`; }).join("")}</ul>` : ""}
    </div>`).join("")}</div>`;
  }

  function sessionPts(ses) {
    let a = 0, b = 0;
    for (const m of ses.matches) if (m.res) { if (m.res.winner === "a") a++; else if (m.res.winner === "b") b++; else { a += 0.5; b += 0.5; } }
    return `${fmtPts(a)}–${fmtPts(b)}`;
  }

  function finish() {
    const sc = C.score(S);
    const before = career.cupHolders?.[kind] ?? null;
    if (sc.winner) career.cupHolders = { ...(career.cupHolders || {}), [kind]: sc.winner };  // shared: holder unchanged
    career.cupResult = {
      kind, name: def.name, year: S.year, course: course.name, usa: sc.usa, other: sc.other, otherSide: S.sides[1],
      text: sc.text, winner: sc.winner, retained: sc.retained, holderBefore: before, holder: career.cupHolders?.[kind] ?? before,
      userSide: mySide, picked: !!mySide, record: mySide ? C.recordFor(S, me) : null,
    };
    ctx.save();
    return career.cupResult;
  }

  // sim the current session (the user's match stays pending); returns true if anything moved
  function simCurrent() {
    const before = S.current;
    C.simSession(S, course, deps, stepRng(career, "cup", S), { userId: mySide ? me : null });
    ctx.save();
    return S.current !== before;
  }

  function simUserMatchAuto() {
    const u = C.userMatch(S, me);
    if (!u) return;
    const st = M.simMatch({ format: u.format, a: u.a, b: u.b, course, rng: stepRng(career, "cup", S), deps });
    C.recordUserMatch(S, st, u);
    if (S.current === u.sessionIdx) C.simSession(S, course, deps, stepRng(career, "cup", S), { userId: me });
    ctx.save();
  }

  function render() {
    sub?.destroy?.(); sub = null;
    const done = S.current >= S.sessions.length;
    const ses = S.sessions[S.current];
    let action;
    if (done) {
      const r = finish();
      action = `<div class="pp-next"><p class="pp-eyebrow">Final</p><h3>${esc(r.text || `${S.teamNames.USA} ${fmtPts(r.usa)}, ${S.teamNames[S.sides[1]]} ${fmtPts(r.other)}`)}</h3>
        <p class="muted">${r.picked ? `Your record: ${r.record.w}-${r.record.l}-${r.record.h} (won-lost-halved).` : "You weren't on either team this time."}</p></div>
        <div class="pp-actions"><button class="gm-btn gm-btn--primary" data-pp="done">Finish the season</button></div>`;
    } else {
      const u = C.userMatch(S, me);
      const prepared = !!ses.matches;
      action = `<div class="pp-next"><p class="pp-eyebrow">Now: ${esc(ses.name)}</p>
          ${!mySide ? `<p class="muted">You weren't selected for ${esc(S.teamNames.USA)} or ${esc(S.teamNames[S.sides[1]])}. Follow along session by session.</p>` : ""}
          ${u ? `<p class="pp-vs"><b>${esc(names(u[u.userSide]))}</b><i>v</i><b>${esc(names(u[u.userSide === "a" ? "b" : "a"]))}</b></p><p class="muted">${esc(FORMAT[u.format])}: your match is ready.</p>` : ""}
        </div>
        <div class="pp-actions">
          ${!prepared ? `<button class="gm-btn gm-btn--primary" data-pp="pairings">Announce the pairings</button>` : ""}
          ${prepared && u ? `<button class="gm-btn gm-btn--primary" data-pp="play">Play your match</button><button class="gm-btn gm-btn--ghost" data-pp="simme">Sim your match</button>` : ""}
          ${prepared ? `<button class="gm-btn ${u ? "gm-btn--ghost" : "gm-btn--primary"}" data-pp="session">Sim the session</button>` : ""}
          <button class="gm-btn gm-btn--ghost" data-pp="all">Sim to the end</button></div>`;
    }
    el.innerHTML = `<section class="pp-wrap pg-game pp-cup is-${kind}">
      <header class="pp-head"><p class="pp-eyebrow">Race to the FedEx Cup · ${career.year}</p>
        <h2>The ${esc(def.name)} at ${esc(course.name)}</h2>
        <p class="muted">${esc(S.teamNames.USA)} v ${esc(S.teamNames[S.sides[1]])}: the top 12 of each side by season points. ${def.total} points, ${def.toWin} to win.</p></header>
      ${board()}
      <section class="pp-card">${action}</section>
      <section class="pp-card"><h3 class="pp-h3">Sessions</h3>${sessionsHTML()}</section>
      <section class="pp-card"><h3 class="pp-h3">The teams</h3>${teamsHTML()}</section></section>`;

    const on = (k, f) => { const b = el.querySelector(`[data-pp="${k}"]`); if (b) b.onclick = f; };
    on("done", () => ctx.onDone?.(career.cupResult));
    on("pairings", () => { C.prepareSession(S, stepRng(career, "cup", S)); ctx.save(); render(); });
    on("session", () => { simCurrent(); render(); });
    on("simme", () => { simUserMatchAuto(); render(); });
    on("all", () => {
      let guard = 0;
      while (S.current < S.sessions.length && guard++ < 50) { simCurrent(); simUserMatchAuto(); }
      render();
    });
    on("play", async () => {
      const u = C.userMatch(S, me);
      const box = el.querySelector(".pp-wrap");
      box.innerHTML = `<div class="pp-play"></div>`;
      sub = await playMatch(box.firstElementChild, ctx, course,
        { kind: "cup", key: `${u.sessionIdx}:${u.matchIdx}`, format: u.format, a: u.a, b: u.b, userSide: u.userSide,
          title: `${u.session} · ${FORMAT[u.format]}` },
        (st) => {
          C.recordUserMatch(S, st, u);
          // the rest of the session may not have been played yet (item 4: sim again to finish it)
          if (S.current === u.sessionIdx) C.simSession(S, course, deps, stepRng(career, "cup", S), { userId: me });
          ctx.save(); render();
        });
    });
  }

  render();
  if (career.userMatch?.kind === "cup" && C.userMatch(S, me)) el.querySelector('[data-pp="play"]')?.click();
  return { destroy() { sub?.destroy?.(); el.innerHTML = ""; } };
}

const fmtPts = (v) => (v % 1 ? `${Math.floor(v)}½` : String(v));
