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
// shot model the user plays with. Weekly form (FORM below) carries week to week.
//
// From a career's second season there are two tiers (tiers.js): the PGA TOUR (career.field, the Race
// to the FedEx Cup) and the Korn Ferry Tour (career.tier2), each 100 golfers playing the same weeks.
// Between seasons the bottom 25 and top 25 swap, the bottom of tier 2 is replaced by generated
// golfers, and every golfer's strokes gained develops a little (rarely a lot). The career keeps its
// own copy of every golfer's stats in career.golfers. Careers without tiers play as before.

import { makeRng, skillsFrom } from "../sim.js";
import { pointsFor } from "../../points.js";
import {
  TIER_SIZE, PROMOTE, RELEGATE, TIER2_TURNOVER, TIER2_START_DATASET, TIER2_START_COLLEGE, TIER2_START_JOURNEYMEN,
  NEW_COLLEGE, NEW_JOURNEYMEN, tierName, developmentDelta, applyDevelopment, generateGolfers, tier2Schedule, DEV, NOT_TOUR_MEMBERS,
} from "./tiers.js";

export { makeRng, skillsFrom };
export { TIER_SIZE, PROMOTE, RELEGATE, TIER2_TURNOVER, tierName, DEV };

export const FIELD_SIZE = 100;
export const PLAYOFF_SIZE = 16;
export const CUT_LINE = 65;
const FEATS = ["dist", "acc", "ott", "app", "arg", "putt"];
const BASE = skillsFrom({});
let STEP = { dist: 20, acc: 0.08, ott: 0.6, app: 0.6, arg: 0.4, putt: 0.5 };  // calibration steps (season_calib.json "step")
// Form: a running strokes-gained-per-round offset per golfer, carried week to week (hot and cold
// streaks). Underneath is a standard-normal AR(1) state u (each week keeps RHO of last week plus a fresh
// draw, capped at +/- U_CAP); form = sd * T_k(u), where T_k is a standardized log-normal transform (mean
// 0, SD 1) with skew set by k.
//   * sd (typical swing) shrinks with skill: SD_WORST for the field's weakest golfer, SD_BEST for its best.
//   * k grows as skill drops: 0 for the best (a plain bell curve), K_MAX for the weakest. A right-skewed
//     curve puts most weeks slightly below the baseline (bad weeks are more likely) with a long, thin
//     tail of big weeks, so a weak golfer's rare peak can top the best players' peak.
// Mean form is 0 for everyone, so a golfer's baseline is still his season average.
export const FORM = { RHO: 0.7, SD_BEST: 0.30, SD_WORST: 0.75, K_MAX: 0.7, U_CAP: 2.6 };

/** Standardized log-normal transform: mean 0, SD 1, skewed right by k (k = 0 is the identity). */
function rawT(u, k) {
  if (k < 1e-3) return u;
  const m = Math.exp(k * k / 2), sd = Math.sqrt((Math.exp(k * k) - 1) * Math.exp(k * k));
  return (Math.exp(k * u) - m) / sd;
}
// Capping u at +/- U_CAP trims the long right tail, which would leave the mean a little below 0 for
// skewed curves; subtract the capped mean (numerically, per k) so form still averages 0.
const capMean = new Map();
function cappedMean(k) {
  const key = Math.round(k * 1000);
  if (!capMean.has(key)) {
    let acc = 0;
    const h = 0.01;
    for (let u = -8; u <= 8; u += h) acc += rawT(Math.max(-FORM.U_CAP, Math.min(FORM.U_CAP, u)), k) * Math.exp(-u * u / 2) * h;
    capMean.set(key, acc / Math.sqrt(2 * Math.PI));
  }
  return capMean.get(key);
}
export function skewT(u, k) {
  return rawT(u, k) - (k < 1e-3 ? 0 : cappedMean(k));
}
const FORM_SPLIT = { ott: 0.25, app: 0.35, arg: 0.15, putt: 0.25 };  // how a form swing spreads over the SG areas
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
/** Every eligible golfer in field order (see buildField): [{id, name, country, sg, src, g, h}]. */
export function rankGolfers(golfers, { seed, pastedCount = 0 }) {
  const group = (p) => (p.pasted || Object.values(p.src || {}).includes("season") ? 0 : p.sample ? (pastedCount < FIELD_SIZE ? 1 : 3) : 2);
  return Object.entries(golfers)
    .filter(([id, p]) => p?.name && !NOT_TOUR_MEMBERS.has(id))
    .map(([id, p]) => ({ id, name: p.name, country: p.country || "", sg: sgTotal(p), src: statSource(p), g: group(p), h: hashId(seed, id) }))
    .filter((r) => r.g !== 3)
    .sort((a, b) => a.g - b.g || b.sg - a.sg || a.h - b.h);
}

export function buildField(golfers, { userId, seed, pastedCount = 0 }) {
  const ranked = rankGolfers(golfers, { seed, pastedCount });
  let field = ranked.slice(0, FIELD_SIZE);
  if (userId && !field.some((r) => r.id === userId)) {
    const p = golfers[userId];
    const me = ranked.find((r) => r.id === userId)
      || (p?.name && { id: userId, name: p.name, country: p.country || "", sg: sgTotal(p), src: statSource(p) });  // e.g. a non-member he picked
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
    const fit = courseFit(calib, skills[id]);  // skills already carry this week's form (skillsMap)
    out[id] = [0, 1, 2, 3].map((r) => (rounds.includes(r) ? quickRound(course, calib, fit, 0, rng) : []));
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
// ---------------------------------------------------------------- tiers: who is where
/** Both tiers' field items (tier 1 first). Careers without tiers: just the field. */
export const allField = (career) => (career.tier2?.field ? [...career.field, ...career.tier2.field] : career.field);
/** 1 or 2 for a golfer in this season's tiers, else null. */
export function tierOf(career, id) {
  if (career.field.some((g) => g.id === id)) return 1;
  return career.tier2?.field?.some((g) => g.id === id) ? 2 : null;
}
export const userTier = (career) => career.userTier || tierOf(career, career.userGolferId) || 1;
const isTier2Id = (id) => typeof id === "string" && id.startsWith("K-");
/** The event map an event id lives in (tier 2 ids start "K-"). */
const storeFor = (career, id) => (isTier2Id(id) && career.tier2 ? career.tier2.events : career.events);
export const eventById = (career, id) => storeFor(career, id)[id] || null;
/** The user's tier: its schedule, this week of it, and its event map. */
export const userSchedule = (career) => (userTier(career) === 2 && career.tier2 ? career.tier2.schedule : career.schedule);
export const userWeek = (career) => userSchedule(career)[career.weekIdx] || null;
export const userEvents = (career) => (userTier(career) === 2 && career.tier2 ? career.tier2.events : career.events);
export function golferName(career, id) {
  return career.golfers?.[id]?.name || allField(career).find((g) => g.id === id)?.name || id;
}

/** Standings for a tier from its finished events (tier 1 = the FedEx Cup): points, wins, starts, top 10s. */
export function standings(career, tier = 1) {
  const field = tier === 2 ? career.tier2?.field || [] : career.field;
  const events = tier === 2 ? career.tier2?.events || {} : career.events;
  const row = Object.fromEntries(field.map((g) => [g.id, { ...g, points: 0, wins: 0, starts: 0, top10: 0 }]));
  for (const ev of Object.values(events)) {
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
/** Each golfer's form curve from his base-SG percentile in the field: {sd, k} (see FORM). */
export function formShape(career) {
  if (career._shape) return career._shape;
  const ranked = [...allField(career)].sort((a, b) => a.sg - b.sg), n = ranked.length;
  return (career._shape = Object.fromEntries(ranked.map((g, i) => {
    const p = n > 1 ? i / (n - 1) : 1;  // 0 = weakest, 1 = best
    return [g.id, { sd: FORM.SD_WORST - (FORM.SD_WORST - FORM.SD_BEST) * p, k: FORM.K_MAX * (1 - p) }];
  })));
}
/** Typical form swing (SG per round) for each golfer. */
export function formSd(career) {
  return Object.fromEntries(Object.entries(formShape(career)).map(([id, s]) => [id, s.sd]));
}
/** A golfer's form floor and ceiling (at the latent cap). */
export function formRange(shape) {
  return { lo: shape.sd * skewT(-FORM.U_CAP, shape.k), hi: shape.sd * skewT(FORM.U_CAP, shape.k) };
}

/**
 * Bring every golfer's form up to the current week (seeded, so a career replays the same way).
 * Week 0 of a season starts from last season's form when there is one, else a fresh draw. History is
 * kept per golfer for the form charts. During the playoffs and cups form stays at its final value.
 */
export function ensureForm(career) {
  const target = Math.min(career.weekIdx, career.schedule.length - 1);
  if (career.formWeek != null && career.formWeek >= target) return false;
  const shape = formShape(career), { RHO, U_CAP } = FORM, keep = Math.sqrt(1 - RHO * RHO);
  career.form ||= {};
  career.formHist ||= {};
  career.formU ||= {};
  // careers saved before the latent state existed (or carried-over form without it): start from form / sd
  const everyone = allField(career);
  for (const g of everyone) {
    if (career.formU[g.id] == null && career.form[g.id] != null) career.formU[g.id] = Math.max(-U_CAP, Math.min(U_CAP, career.form[g.id] / shape[g.id].sd));
  }
  let w = career.formWeek ?? -1;
  while (w < target) {
    w++;
    const rng = makeRng(`${career.seed}|${career.year}|form|${w}`);
    for (const g of everyone) {
      const z = rng.normal(), prev = career.formU[g.id];
      let u = w === 0 && prev == null ? z : RHO * (prev ?? 0) + keep * z;
      u = Math.max(-U_CAP, Math.min(U_CAP, u));
      career.formU[g.id] = Math.round(u * 10000) / 10000;
      const { sd, k } = shape[g.id];
      career.form[g.id] = Math.round(sd * skewT(u, k) * 1000) / 1000;
      (career.formHist[g.id] ||= [])[w] = career.form[g.id];
    }
  }
  career.formWeek = target;
  return true;
}

/** A golfer's base SG, current form and the two combined, for display. */
export function formOf(career, id) {
  ensureForm(career);
  const g = allField(career).find((x) => x.id === id);
  const f = career.form?.[id] ?? 0, shape = formShape(career)[id] || { sd: FORM.SD_WORST, k: FORM.K_MAX }, sd = shape.sd;
  return { base: g?.sg ?? 0, form: f, now: (g?.sg ?? 0) + f, sd, k: shape.k, range: formRange(shape), hist: (career.formHist?.[id] || []).slice(),
    label: f >= sd ? "Hot" : f >= sd / 3 ? "Warm" : f <= -sd ? "Cold" : f <= -sd / 3 ? "Cool" : "Steady" };
}

/** Skills for every golfer in the locked field, with this week's form applied (not saved; rebuilt). */
export function skillsMap(career) {
  if (ensureForm(career) || career._skWeek !== career.formWeek) { delete career._sk; career._skWeek = career.formWeek; }
  return (career._sk ||= Object.fromEntries(allField(career).map((g) => {
    const sk = skillsFrom(g.stats || {}), f = career.form?.[g.id] || 0;
    for (const [k, share] of Object.entries(FORM_SPLIT)) sk[k] += f * share;
    return [g.id, sk];
  })));
}

const fieldItem = (g) => ({ id: g.id, name: g.name, country: g.country || "", sg: sgTotal(g), src: g.src || "", stats: g.stats || {},
  ...(g.created ? { created: g.created } : {}) });
const byStrength = (a, b) => b.sg - a.sg || a.name.localeCompare(b.name);
const golferRecord = (r, golfers) => ({ id: r.id, name: r.name, country: r.country || "", stats: { ...(golfers[r.id]?.stats || r.stats || {}) },
  src: r.src || "" });

/**
 * A new career (or the next season of one): locks both tiers' fields and schedules for `year`.
 * - New career: tier 1 = top 100 by strokes gained (buildField); tier 2 = the next 50 in the data plus
 *   25 generated college standouts and 25 generated journeymen.
 * - Next season of a two-tier career: bottom RELEGATE of tier 1 down, top PROMOTE of tier 2 up, bottom
 *   TIER2_TURNOVER of tier 2 out (never the user's golfer: the next one up goes instead) and as many
 *   generated golfers in; then every returning golfer develops (developmentDelta).
 * - Next season of a career started before tiers: tier 1 is last season's field (bottom 25 down), tier 2
 *   is built fresh as for a new career and its 25 strongest go up.
 * The changes are recorded in career.offseason.
 */
export function newSeason({ golfers, pastedCount, userId, seed, tournaments, courses, year, prev = null }) {
  const weeks = buildWeeks(tournaments, courses);
  const rec = {};          // id -> {id, name, country, stats, src, created?, born?}: the career's own copy
  let t1 = [], t2 = [], offseason = null;
  const taken = new Set(Object.values(golfers).map((g) => (g?.name || "").toLowerCase()));
  const freshTier2 = (excludeIds) => {  // the data's next best, then generated golfers
    const ranked = rankGolfers(golfers, { seed: `${seed}|${year}`, pastedCount }).filter((r) => !excludeIds.has(r.id) && r.id !== userId);
    const fromData = ranked.slice(0, TIER2_START_DATASET).map((r) => golferRecord(r, golfers));
    const gen = [...generateGolfers("college", TIER2_START_COLLEGE, { seed, year, takenNames: taken }),
                 ...generateGolfers("journeyman", TIER2_START_JOURNEYMEN, { seed, year, takenNames: taken })];
    return [...fromData, ...gen];
  };

  if (!prev) {
    t1 = buildField(golfers, { userId, seed: `${seed}|${year}`, pastedCount }).map((r) => golferRecord(r, golfers));
    t2 = freshTier2(new Set(t1.map((g) => g.id)));
  } else {
    for (const g of [...prev.field, ...(prev.tier2?.field || [])]) rec[g.id] = prev.golfers?.[g.id] ? { ...prev.golfers[g.id] } : golferRecord(g, {});
    for (const [id, g] of Object.entries(prev.golfers || {})) rec[id] ||= { ...g };
    const st1 = standings(prev, 1).map((r) => r.id);
    const relegated = st1.slice(-RELEGATE);
    let promoted, departed, joined, pool2;
    if (prev.tier2?.field) {
      const st2 = standings(prev, 2).map((r) => r.id);
      promoted = st2.slice(0, PROMOTE);
      const rest = st2.slice(PROMOTE);
      const bottom = rest.filter((id) => id !== prev.userGolferId);  // the user's golfer keeps his card
      departed = bottom.slice(-TIER2_TURNOVER);
      const newcomers = [...generateGolfers("college", NEW_COLLEGE, { seed, year, takenNames: taken }),
                         ...generateGolfers("journeyman", NEW_JOURNEYMEN, { seed, year, takenNames: taken })];
      newcomers.forEach((g) => (rec[g.id] = g));
      joined = newcomers.map((g) => g.id);
      pool2 = [...rest.filter((id) => !departed.includes(id)), ...relegated, ...joined];
    } else {
      const fresh = freshTier2(new Set(st1));
      fresh.forEach((g) => (rec[g.id] = g));
      const freshRanked = fresh.map((g) => ({ id: g.id, sg: sgTotal(g), name: g.name })).sort(byStrength);
      promoted = freshRanked.slice(0, PROMOTE).map((g) => g.id);
      departed = [];
      joined = fresh.map((g) => g.id);
      pool2 = [...freshRanked.slice(PROMOTE).map((g) => g.id), ...relegated];
    }
    const pool1 = [...st1.filter((id) => !relegated.includes(id)), ...promoted];
    // development: everyone returning this season (golfers generated this year start fresh)
    const development = [];
    for (const id of [...pool1, ...pool2]) {
      const g = rec[id];
      if (!g || g.born === year) continue;
      const before = sgTotal(g), { delta, big } = developmentDelta(seed, year, id);
      g.stats = applyDevelopment(g.stats, delta);
      development.push({ id, name: g.name, before: Math.round(before * 1000) / 1000, after: Math.round(sgTotal(g) * 1000) / 1000, delta, big });
    }
    t1 = pool1.map((id) => rec[id]);
    t2 = pool2.map((id) => rec[id]);
    offseason = { year, development: development.sort((a, b) => b.delta - a.delta), relegated, promoted, departed, joined };
  }
  for (const g of [...t1, ...t2]) rec[g.id] = g;

  const field = t1.map(fieldItem).sort(byStrength), field2 = t2.map(fieldItem).sort(byStrength);
  const both = [...field, ...field2];
  const career = {
    v: 1, seed, userGolferId: userId, userName: rec[userId]?.name || golfers[userId]?.name || "You", year, phase: "regular",
    field, schedule: weeks, weekIdx: 0, events: {},
    tier2: { field: field2, schedule: tier2Schedule(weeks, courses, seed, year), events: {} },
    golfers: rec, offseason,
    venues: pickVenues(courses, seed, year, prev ? [prev.venues?.playoffs, prev.venues?.cup].filter(Boolean) : []),
    playoffs: null, cup: null, userMatch: null,
    // form carries into the new season for golfers still in either tier (ensureForm steps it from here)
    formU: prev?.formU ? Object.fromEntries(both.filter((g) => prev.formU[g.id] != null).map((g) => [g.id, prev.formU[g.id]])) : {},
    form: {}, formHist: {}, formWeek: null,
    cupHolders: prev?.cupHolders || { ryder: "EUR", presidents: "USA" },
    history: prev?.history || [],
  };
  career.userTier = tierOf(career, userId) || 1;
  return career;
}

/**
 * Who plays where this week. One event: the whole field. Opposite-field week: the top 75 in the
 * standings play the main event and the rest the opposite event; the user plays the one he picked
 * (taking the place of the last golfer in that group if he'd otherwise be in the other).
 */
export function weekEntrants(career, week, userEventId) {
  const out = {};
  const t2week = career.tier2?.schedule?.[career.weekIdx];
  if (t2week) for (const ev of t2week.events) out[ev.id] = career.tier2.field.map((g) => g.id);  // every tier-2 golfer
  const w1 = week?.events?.some((e) => e.tier === 2) ? career.schedule[career.weekIdx] : week;  // a tier-2 week was passed
  if (!w1) return out;
  const ids = standings(career).map((r) => r.id);
  if (w1.events.length === 1) return { ...out, [w1.events[0].id]: ids };
  const [main, opp] = w1.events[0].type === "opposite" ? [w1.events[1], w1.events[0]] : w1.events;
  let a = ids.slice(0, OPPOSITE_SPLIT), b = ids.slice(OPPOSITE_SPLIT);
  const u = career.userGolferId;
  if (userTier(career) === 1) {
    const want = userEventId && !isTier2Id(userEventId) ? userEventId : main.id;
    if (want === main.id && !a.includes(u)) { b = [...b.filter((x) => x !== u), a[a.length - 1]]; a = [...a.slice(0, -1), u]; }
    if (want === opp.id && !b.includes(u)) { a = [...a.filter((x) => x !== u), b[b.length - 1]]; b = [...b.slice(0, -1), u]; }
  }
  return { ...out, [main.id]: a, [opp.id]: b };
}

/**
 * Start an event: every AI golfer's four rounds are drawn now (seeded), the user's are filled in as
 * he plays (or drawn the same way when he sims). The cut is applied when the event finishes.
 */
export function startEvent(career, ev, entrants, course, userPlays) {
  const sk = skillsMap(career), cal = calibFor(course), seed = `${career.seed}|${career.year}|${ev.id}`;
  const u = career.userGolferId;
  const ai = simAiRounds(entrants.filter((id) => !userPlays || id !== u), course, cal, sk, seed);
  const store = ev.tier === 2 && career.tier2 ? career.tier2.events : storeFor(career, ev.id);
  store[ev.id] = { status: "live", id: ev.id, name: ev.name, type: ev.type, courseId: ev.courseId, start: ev.start, ...(ev.tier === 2 ? { tier: 2 } : {}),
    entrants, ai, user: userPlays && entrants.includes(u) ? [[], [], [], []] : null, round: 0, par: course.holes.reduce((a, h) => a + h.par, 0) };
  return store[ev.id];
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
  const store = storeFor(career, evId), live = store[evId], u = career.userGolferId;
  const rows = Object.entries(live.ai).map(([id, rounds]) => ({ id, rounds: rounds.map((r) => r.slice()) }));
  if (live.user) rows.push({ id: u, rounds: live.user.map((r) => r.slice()) });
  if (hasCut(live.type)) {
    const made = cutAfter36(rows);
    rows.forEach((r, i) => { r.cut = !made[i]; if (r.cut) { r.rounds[2] = []; r.rounds[3] = []; } });
  }
  const sk = skillsMap(career), cal = calibFor(course);
  const ranked = rankEvent(rows, live.par, live.type, (ids) => playoffWinner(ids, course, cal, sk, `${career.seed}|${career.year}|${evId}`));
  const name = Object.fromEntries(allField(career).map((g) => [g.id, g.name]));
  const me = ranked.find((r) => r.id === u);
  store[evId] = {
    status: "done", id: evId, name: live.name, type: live.type, courseId: live.courseId, start: live.start, par: live.par, ...(live.tier === 2 ? { tier: 2 } : {}),
    results: ranked.map((r) => ({ id: r.id, pos: r.pos, total: r.total, toPar: r.toPar, points: r.points,
      rounds: r.id === u || ranked.indexOf(r) < 10 ? r.rounds.map((x) => x.reduce((a, b) => a + b, 0) || null) : undefined })),
    winner: { id: ranked[0].id, name: name[ranked[0].id], toPar: ranked[0].toPar, playoff: !!ranked[0].playoff },
    userPos: me ? me.pos : null, userPoints: me ? me.points : 0, userPlayed: !!live.user,
  };
  return store[evId];
}

/** Sim a whole event (the user's rounds too) and finish it. */
export function simEvent(career, ev, entrants, course) {
  startEvent(career, ev, entrants, course, false);
  return finishEvent(career, ev.id, course);
}

/** Sim the rest of this week in both tiers (tier 1's opposite-field event too) and move on. */
export function simWeek(career, courses, userEventId) {
  const week = career.schedule[career.weekIdx];
  const ent = weekEntrants(career, week, userEventId);
  const all = [...week.events, ...(career.tier2?.schedule?.[career.weekIdx]?.events || [])];
  for (const ev of all) {
    const cur = eventById(career, ev.id);
    if (cur?.status === "done") continue;
    const course = courses.find((c) => c.id === ev.courseId);
    if (cur?.status === "live") {
      const live = cur;
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
