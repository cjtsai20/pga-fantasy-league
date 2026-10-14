// Race to the FedEx Cup: the season engine. No DOM; ui.js draws it, store.js saves it.
//
// A career is a run of seasons. Each season locks a 100-golfer field (top 100 by strokes gained,
// see buildField), plays the league's schedule as stroke-play events (FedEx Cup points from
// data/points_tables.json, ties split), then the top 16 play the FedEx Cup Playoffs, a match-play
// bracket, and the year ends with a cup: the Ryder Cup (USA v Europe) in odd years, the Presidents
// Cup (USA v International) in even years. Match play, the bracket and the cups live in match.js
// and cups.js; this file gives them the quick hole model (quickHole / fitFor) and picks venues.
//
// AI golfers use a quick per-hole model calibrated against sim.js (data/season_calib.json, built by
// calib_build.html): a tour-average golfer's score distribution on each hole, shifted by that hole's
// linear response to each of the six skills sim.js uses. Course fit therefore comes from the same
// shot model the user plays with. Weekly form adds N(0, 0.35) strokes per round, seeded per event.
// Golfer skills stay fixed across seasons (they come from the stats the commissioner pastes).

import { makeRng, skillsFrom } from "../sim.js";
import { pointsFor } from "../../points.js";

export { makeRng, skillsFrom };

export const FIELD_SIZE = 100;
export const PLAYOFF_SIZE = 16;
export const CUT_LINE = 65;
const FEATS = ["dist", "acc", "ott", "app", "arg", "putt"];
const BASE = skillsFrom({});
let STEP = { dist: 20, acc: 0.08, ott: 0.6, app: 0.6, arg: 0.4, putt: 0.5 };  // calibration steps (season_calib.json "step")
const FORM_SD = 0.35;            // strokes per round, per golfer per event
const NO_CUT = new Set(["signature"]);
export const OPPOSITE_SPLIT = 75; // opposite-field weeks: the top 75 in the standings play the main event

// ---------------------------------------------------------------- helpers
const sum = (a) => a.reduce((x, y) => x + y, 0);
export const hashId = (seed, id) => makeRng(`${seed}|tie|${id}`).next();

/** Strokes gained total used for ranking: pasted sg_total, else the four parts (filled stats, else the
 * tour-average fallback sim.js applies). */
export function sgTotal(p) {
  const s = p.stats || {};
  if (s.sg_total != null) return s.sg_total;
  const sk = skillsFrom(s);
  return (s.sg_ott ?? sk.ott) + (s.sg_app ?? sk.app) + (s.sg_arg ?? sk.arg) + (s.sg_putt ?? sk.putt);
}

/** Where a golfer's numbers come from, for the field list. */
export function statSource(p) {
  const src = Object.values(p.src || {});
  if (p.pasted) return src.includes("worst") ? "entered + worst-filled" : "entered";
  if (p.sample) return "sample";
  if (src.includes("season")) return "season data";
  if (src.includes("worst")) return "worst entered";
  return "tour average";
}

// ---------------------------------------------------------------- the field
/**
 * Top 100 by strokes gained. Golfers with stats of their own (pasted or season data) rank first,
 * then the sample golfers (only while fewer than 100 golfers have pasted stats), then everyone else
 * (all-worst or tour-average stats). Within a group: SG total, then a seeded hash of the id so ties
 * are stable within a career. The user's golfer always plays: outside the top 100 he replaces #100.
 * @param golfers {id: {name, country, stats, src, pasted, sample}}
 */
export function buildField(golfers, { userId, seed, pastedCount = 0 }) {
  const group = (p) => (p.pasted || Object.values(p.src || {}).includes("season") ? 0 : p.sample ? (pastedCount < FIELD_SIZE ? 1 : 3) : 2);
  const ranked = Object.entries(golfers)
    .filter(([, p]) => p?.name)
    .map(([id, p]) => ({ id, name: p.name, country: p.country || "", sg: sgTotal(p), src: statSource(p), g: group(p), h: hashId(seed, id) }))
    .filter((r) => r.g !== 3)
    .sort((a, b) => a.g - b.g || b.sg - a.sg || a.h - b.h);
  let field = ranked.slice(0, FIELD_SIZE);
  if (userId && !field.some((r) => r.id === userId)) {
    const me = ranked.find((r) => r.id === userId);
    if (me) field = [...field.slice(0, FIELD_SIZE - 1), me];
  }
  return field.map(({ g, h, ...r }) => r);
}

// ---------------------------------------------------------------- quick model
/** Expected strokes offset vs the base golfer on one calibrated hole. */
function holeShift(ch, sk) {
  let d = 0, t = 0;
  for (let i = 0; i < FEATS.length; i++) {
    const off = sk[FEATS[i]] - BASE[FEATS[i]];
    d += ch.b[i] * off;
    t += off / STEP[FEATS[i]];
  }
  if (ch.a != null || ch.q != null) {  // version 2 calibration: correction along the all-skills diagonal
    t /= FEATS.length;
    d += (ch.a || 0) * t + (ch.q || 0) * t * t;
  }
  return d;
}

/** Precompute a golfer's per-hole mean shift on a course (fast path for whole events). */
export function courseFit(calibCourse, sk) {
  return calibCourse.holes.map((ch) => holeShift(ch, sk));
}

/** One hole score: draw from the base distribution, then shift by `shift` strokes (exact in mean). */
export function drawHole(ch, par, shift, rng) {
  shift += ch.adj || 0;  // recentre the pooled calibration distribution on the base golfer
  let u = rng.next(), k = 0;
  const p = ch.p;
  while (k < p.length - 1 && u > p[k]) { u -= p[k]; k++; }
  let d = ch.lo + k;
  const whole = Math.floor(shift), frac = shift - whole;
  d += whole + (rng.next() < frac ? 1 : 0);
  return Math.max(1, par + d);
}

/** A full round for an AI golfer: 18 hole scores. */
export function quickRound(course, calibCourse, fit, formPerHole, rng) {
  return course.holes.map((h, i) => drawHole(calibCourse.holes[i], h.par, fit[i] + formPerHole, rng));
}

/** Fallback calibration (no data/season_calib.json entry): par-relative distribution and an even
 * split of the SG effect across holes. Only used if a course wasn't calibrated. */
export function genericCalib(course) {
  return {
    holes: course.holes.map((h) => ({
      lo: -2, p: h.par === 3 ? [0.001, 0.13, 0.66, 0.18, 0.025, 0.004] : h.par === 5 ? [0.02, 0.42, 0.45, 0.09, 0.015, 0.005] : [0.002, 0.18, 0.62, 0.17, 0.023, 0.005],
      b: [-0.0011, -0.15, -0.055, -0.055, -0.055, -0.055],
    })),
  };
}

// ---------------------------------------------------------------- calibration registry
let CALIB = {};
/** Load data/season_calib.json once (ui.js does this at start). */
export function setCalibration(json) {
  CALIB = json?.courses || {};
  if (json?.step) STEP = { ...STEP, ...json.step };
}
/** Calibrated per-hole model for a course ({holes: [{lo, p, b}]}), or the generic fallback. */
export function calibFor(course) {
  const c = CALIB[course.id];
  return c && c.holes?.length === course.holes.length ? c : (course._genericCalib ||= genericCalib(course));
}
/** Contract for match.js / cups.js: a golfer's fit to a course, and one hole from it. */
export function fitFor(course, sk) {
  const cal = calibFor(course);
  return { courseId: course.id, cal, shift: courseFit(cal, sk) };
}
/** One hole for a golfer from his fit (fitFor); sk is accepted for the agreed signature. */
export function quickHole(hole, sk, rng, fit) {
  const i = hole.n - 1;
  return drawHole(fit.cal.holes[i], hole.par, fit.shift[i], rng);
}

// ---------------------------------------------------------------- venues
/**
 * The FedEx Cup Playoffs bracket and the year's cup are each played on a course picked at random
 * (career seed + year) from the mapped (OpenStreetMap) courses, never the same course for both in a
 * season, and avoiding last season's two venues when there are enough courses.
 */
export function pickVenues(courses, seed, year, prev = []) {
  const mapped = courses.filter((c) => c.layout_source === "osm" && c.holes?.length === 18).map((c) => c.id).sort();
  const rng = makeRng(`${seed}|venues|${year}`);
  const take = (avoid) => {
    let pool = mapped.filter((id) => !avoid.includes(id));
    if (!pool.length) pool = mapped.filter((id) => id !== avoid[avoid.length - 1]);
    return pool[Math.floor(rng.next() * pool.length)];
  };
  const playoffs = take(prev);
  const cup = take([...prev, playoffs]);
  return { playoffs, cup };
}

// ---------------------------------------------------------------- schedule
/**
 * Weeks of the season from the league's tournaments: each week has a main event and, in
 * opposite-field weeks, a second one. Events without a course in courses.json are skipped.
 */
export function buildWeeks(tournaments, courses) {
  const byTid = new Map();
  for (const c of courses) for (const t of c.tournament_ids || []) byTid.set(t, c.id);
  const evs = tournaments
    .map((t) => ({ id: t.id, name: t.name, type: t.event_type, start: t.start_date, end: t.end_date, courseId: byTid.get(t.id) }))
    .filter((e) => e.courseId)
    .sort((a, b) => a.start.localeCompare(b.start) || (a.type === "opposite") - (b.type === "opposite"));
  const weeks = [];
  for (const e of evs) {
    const w = weeks.find((x) => x.start === e.start);
    if (w) w.events.push(e); else weeks.push({ start: e.start, events: [e] });
  }
  return weeks;
}

// ---------------------------------------------------------------- stroke-play events
/**
 * Rank a finished event. `rows`: [{id, rounds: [[18],[18],...], cut}] (rounds 3-4 empty for MC).
 * Returns rows with pos ("1", "T5", "MC"), toPar, total and FedEx points (ties split; MC 0).
 * A tie for the lead goes to a sudden-death playoff (`playoff(ids) -> winnerId`).
 */
export function rankEvent(rows, coursePar, eventType, playoff) {
  const made = rows.filter((r) => !r.cut), mc = rows.filter((r) => r.cut);
  for (const r of rows) { r.total = sum(r.rounds.map(sum)); r.toPar = r.total - coursePar * r.rounds.filter((x) => x.length).length; }
  made.sort((a, b) => a.total - b.total);
  const leaders = made.filter((r) => r.total === made[0].total);
  if (leaders.length > 1) {
    const w = playoff(leaders.map((r) => r.id));
    made.sort((a, b) => a.total - b.total || (b.id === w) - (a.id === w));
    made[0].playoff = true;
  }
  let i = 0;
  while (i < made.length) {
    let j = i;
    // a playoff winner stands alone; the golfers he beat tie for second with anyone level with them
    if (!(i === 0 && leaders.length > 1)) while (j + 1 < made.length && made[j + 1].total === made[i].total) j++;
    const n = j - i + 1;
    for (let k = i; k <= j; k++) {
      made[k].pos = `${n > 1 ? "T" : ""}${i + 1}`;
      made[k].points = pointsFor(eventType, made[k].pos, n);
    }
    i = j + 1;
  }
  for (const r of mc) { r.pos = "MC"; r.points = 0; }
  mc.sort((a, b) => a.total - b.total);
  return [...made, ...mc];
}

/** Indices of golfers who make the cut after 36 holes (top 65 and ties). */
export function cutAfter36(rows) {
  const t = rows.map((r) => sum(r.rounds[0]) + sum(r.rounds[1]));
  const sorted = [...t].sort((a, b) => a - b);
  const line = sorted[Math.min(CUT_LINE, sorted.length) - 1];
  return t.map((v) => v <= line);
}
export const hasCut = (type) => !NO_CUT.has(type);

/**
 * Simulate an event's AI golfers: rounds 1-2 for everyone, then rounds 3-4 for those who make the
 * cut (the cut is decided once the user's own 36 holes are in, so `userRounds2` may be passed).
 */
export function simAiRounds(entrants, course, calib, skills, seed, rounds = [0, 1, 2, 3]) {
  const out = {};
  for (const id of entrants) {
    const rng = makeRng(`${seed}|${id}`);
    const form = rng.normal() * FORM_SD / 18;
    const fit = courseFit(calib, skills[id]);
    out[id] = [0, 1, 2, 3].map((r) => (rounds.includes(r) ? quickRound(course, calib, fit, form, rng) : []));
  }
  return out;
}

/** Sudden death on the 18th, then 18 again, between AI golfers (and the user, simulated). */
export function playoffWinner(ids, course, calib, skills, seed) {
  const rng = makeRng(`${seed}|playoff`);
  const h = course.holes.length - 1;
  let alive = ids.slice();
  for (let n = 0; n < 50 && alive.length > 1; n++) {
    const sc = alive.map((id) => drawHole(calib.holes[h], course.holes[h].par, courseFit({ holes: [calib.holes[h]] }, skills[id])[0], rng));
    const best = Math.min(...sc);
    alive = alive.filter((_, i) => sc[i] === best);
  }
  return alive[0];
}

// ---------------------------------------------------------------- standings
/** FedEx Cup standings from the career's finished events: points, wins, starts, top 10s. */
export function standings(career) {
  const row = Object.fromEntries(career.field.map((g) => [g.id, { ...g, points: 0, wins: 0, starts: 0, top10: 0 }]));
  for (const ev of Object.values(career.events)) {
    if (ev.status !== "done") continue;
    for (const r of ev.results) {
      const x = row[r.id];
      if (!x) continue;
      x.points += r.points; x.starts++;
      if (r.pos === "1") x.wins++;
      const n = Number(String(r.pos).replace("T", ""));
      if (n && n <= 10) x.top10++;
    }
  }
  const rows = Object.values(row).map((r) => ({ ...r, points: Math.round(r.points * 1000) / 1000 }))
    .sort((a, b) => b.points - a.points || b.wins - a.wins || b.sg - a.sg || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// ---------------------------------------------------------------- career flow
/** Skills for every golfer in the locked field (not saved; rebuilt from the field's stats). */
export function skillsMap(career) {
  return (career._sk ||= Object.fromEntries(career.field.map((g) => [g.id, skillsFrom(g.stats || {})])));
}

/** A new career (or the next season of one): locks the field and the schedule for `year`. */
export function newSeason({ golfers, pastedCount, userId, seed, tournaments, courses, year, prev = null }) {
  const field = buildField(golfers, { userId, seed: `${seed}|${year}`, pastedCount })
    .map((r) => ({ ...r, stats: golfers[r.id]?.stats || {} }));
  const weeks = buildWeeks(tournaments, courses);
  return {
    v: 1, seed, userGolferId: userId, userName: golfers[userId]?.name || "You", year, phase: "regular",
    field, schedule: weeks, weekIdx: 0, events: {},
    venues: pickVenues(courses, seed, year, prev ? [prev.venues?.playoffs, prev.venues?.cup].filter(Boolean) : []),
    playoffs: null, cup: null, userMatch: null,
    cupHolders: prev?.cupHolders || { ryder: "EUR", presidents: "USA" },
    history: prev?.history || [],
  };
}

/**
 * Who plays where this week. One event: the whole field. Opposite-field week: the top 75 in the
 * standings play the main event and the rest the opposite event; the user plays the one he picked
 * (taking the place of the last golfer in that group if he'd otherwise be in the other).
 */
export function weekEntrants(career, week, userEventId) {
  const ids = standings(career).map((r) => r.id);
  if (week.events.length === 1) return { [week.events[0].id]: ids };
  const [main, opp] = week.events[0].type === "opposite" ? [week.events[1], week.events[0]] : week.events;
  let a = ids.slice(0, OPPOSITE_SPLIT), b = ids.slice(OPPOSITE_SPLIT);
  const u = career.userGolferId, want = userEventId || main.id;
  if (want === main.id && !a.includes(u)) { b = [...b.filter((x) => x !== u), a[a.length - 1]]; a = [...a.slice(0, -1), u]; }
  if (want === opp.id && !b.includes(u)) { a = [...a.filter((x) => x !== u), b[b.length - 1]]; b = [...b.slice(0, -1), u]; }
  return { [main.id]: a, [opp.id]: b };
}

/**
 * Start an event: every AI golfer's four rounds are drawn now (seeded), the user's are filled in as
 * he plays (or drawn the same way when he sims). The cut is applied when the event finishes.
 */
export function startEvent(career, ev, entrants, course, userPlays) {
  const sk = skillsMap(career), cal = calibFor(course), seed = `${career.seed}|${career.year}|${ev.id}`;
  const u = career.userGolferId;
  const ai = simAiRounds(entrants.filter((id) => !userPlays || id !== u), course, cal, sk, seed);
  career.events[ev.id] = { status: "live", id: ev.id, name: ev.name, type: ev.type, courseId: ev.courseId, start: ev.start,
    entrants, ai, user: userPlays && entrants.includes(u) ? [[], [], [], []] : null, round: 0, par: course.holes.reduce((a, h) => a + h.par, 0) };
  return career.events[ev.id];
}

/** Does the user make the cut, given his first 36 holes? (true for no-cut events) */
export function userMakesCut(live) {
  if (!hasCut(live.type) || !live.user) return true;
  const ids = Object.keys(live.ai), u = "__user";
  const rows = [...ids.map((id) => ({ id, rounds: live.ai[id] })), { id: u, rounds: live.user }];
  const made = cutAfter36(rows);
  return made[rows.length - 1];
}

/** Finish an event: apply the cut, rank, award FedEx points, store compact results. */
export function finishEvent(career, evId, course) {
  const live = career.events[evId], u = career.userGolferId;
  const rows = Object.entries(live.ai).map(([id, rounds]) => ({ id, rounds: rounds.map((r) => r.slice()) }));
  if (live.user) rows.push({ id: u, rounds: live.user.map((r) => r.slice()) });
  if (hasCut(live.type)) {
    const made = cutAfter36(rows);
    rows.forEach((r, i) => { r.cut = !made[i]; if (r.cut) { r.rounds[2] = []; r.rounds[3] = []; } });
  }
  const sk = skillsMap(career), cal = calibFor(course);
  const ranked = rankEvent(rows, live.par, live.type, (ids) => playoffWinner(ids, course, cal, sk, `${career.seed}|${career.year}|${evId}`));
  const name = Object.fromEntries(career.field.map((g) => [g.id, g.name]));
  const me = ranked.find((r) => r.id === u);
  career.events[evId] = {
    status: "done", id: evId, name: live.name, type: live.type, courseId: live.courseId, start: live.start, par: live.par,
    results: ranked.map((r) => ({ id: r.id, pos: r.pos, total: r.total, toPar: r.toPar, points: r.points,
      rounds: r.id === u || ranked.indexOf(r) < 10 ? r.rounds.map((x) => x.reduce((a, b) => a + b, 0) || null) : undefined })),
    winner: { id: ranked[0].id, name: name[ranked[0].id], toPar: ranked[0].toPar, playoff: !!ranked[0].playoff },
    userPos: me ? me.pos : null, userPoints: me ? me.points : 0, userPlayed: !!live.user,
  };
  return career.events[evId];
}

/** Sim a whole event (the user's rounds too) and finish it. */
export function simEvent(career, ev, entrants, course) {
  startEvent(career, ev, entrants, course, false);
  return finishEvent(career, ev.id, course);
}

/** Sim the rest of this week (both events if it's an opposite-field week) and move on. */
export function simWeek(career, courses, userEventId) {
  const week = career.schedule[career.weekIdx];
  const ent = weekEntrants(career, week, userEventId);
  for (const ev of week.events) {
    if (career.events[ev.id]?.status === "done") continue;
    const course = courses.find((c) => c.id === ev.courseId);
    if (career.events[ev.id]?.status === "live") {
      const live = career.events[ev.id];
      if (live.user) live.user = autoUserRounds(career, live, course);
      finishEvent(career, ev.id, course);
    } else simEvent(career, ev, ent[ev.id], course);
  }
  advanceWeek(career);
}

/** Finish the user's unplayed rounds/holes with the quick model (for "sim rest of event"). */
export function autoUserRounds(career, live, course) {
  const sk = skillsMap(career)[career.userGolferId], cal = calibFor(course), fit = courseFit(cal, sk);
  const rng = makeRng(`${career.seed}|${career.year}|${live.id}|user-sim|${live.user.map((r) => r.length).join(",")}`);
  return live.user.map((r) => (r.length === 18 ? r : [...r, ...course.holes.slice(r.length).map((h, i) => drawHole(cal.holes[r.length + i], h.par, fit[r.length + i], rng))]));
}

export function advanceWeek(career) {
  career.weekIdx++;
  if (career.weekIdx >= career.schedule.length) career.phase = "playoffs";
}
