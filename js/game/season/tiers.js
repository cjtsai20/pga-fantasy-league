// Two tiers and yearly development for Race to the FedEx Cup careers (engine.js builds seasons with
// these). Tier 1 is the PGA TOUR (the 100-man Race to the FedEx Cup); tier 2 is the Korn Ferry Tour:
// 100 golfers, at first the next-best golfers in the data plus generated college standouts and
// journeymen. After each season the bottom RELEGATE of tier 1 and the top PROMOTE of tier 2 swap, the
// bottom TIER2_TURNOVER of tier 2 leave and as many newly generated golfers join. Every golfer's
// strokes gained moves a little each off-season, with the same odds for everyone (DEV below).
//
// No imports from engine.js (it imports this file).

import { makeRng, skillsFrom } from "../sim.js";
import { FIRST, LAST, COUNTRIES, PLACES, SUFFIX } from "./names.js";

export const TIER_SIZE = 100;
export const PROMOTE = 25;
export const RELEGATE = 25;
export const TIER2_TURNOVER = 25;
export const TIER2_START_DATASET = 50;     // a new career's tier 2: this many from the data...
export const TIER2_START_COLLEGE = 25;     // ...plus generated college standouts...
export const TIER2_START_JOURNEYMEN = 25;  // ...and journeymen
export const NEW_COLLEGE = 13;             // newcomers each year (TIER2_TURNOVER in all)
export const NEW_JOURNEYMEN = TIER2_TURNOVER - NEW_COLLEGE;

export const tierName = (t) => (t === 2 ? "Korn Ferry Tour" : "PGA TOUR");

// LPGA players in data/players.json: they appear only in the mixed-team Grant Thornton Invitational
// (event 551), so they're kept out of the PGA TOUR and Korn Ferry fields (the user may still pick one).
export const NOT_TOUR_MEMBERS = new Set(["40027", "50675", "57427", "61412", "64575", "64804", "64810", "64815", "64818",
  "64826", "64828", "64831", "64832", "64846", "64854", "64905", "64912", "64917", "64925", "66382", "66633"]);

// Yearly development, in SG per round, the same for every golfer: usually a small change, rarely a
// big one (about 3 in 200 way better, 3 in 200 way worse).
export const DEV = { SD: 0.10, BIG_P: 0.015, BIG_LO: 0.6, BIG_HI: 1.2 };
const SPLIT = { sg_ott: 0.25, sg_app: 0.35, sg_arg: 0.15, sg_putt: 0.25 };
const SK_KEY = { sg_ott: "ott", sg_app: "app", sg_arg: "arg", sg_putt: "putt" };
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** Strokes gained total of a stats object (pasted sg_total, else the four parts) - mirrors engine.sgTotal. */
export function sgOfStats(s = {}) {
  if (s.sg_total != null) return s.sg_total;
  const sk = skillsFrom(s);
  return (s.sg_ott ?? sk.ott) + (s.sg_app ?? sk.app) + (s.sg_arg ?? sk.arg) + (s.sg_putt ?? sk.putt);
}

/** This off-season's change for one golfer: {delta, big: 'up'|'down'|null}. Seeded per career/year/golfer. */
export function developmentDelta(seed, year, id) {
  const rng = makeRng(`${seed}|dev|${year}|${id}`);
  const u = rng.next();
  if (u < DEV.BIG_P) return { delta: round(DEV.BIG_LO + rng.next() * (DEV.BIG_HI - DEV.BIG_LO)), big: "up" };
  if (u < 2 * DEV.BIG_P) return { delta: -round(DEV.BIG_LO + rng.next() * (DEV.BIG_HI - DEV.BIG_LO)), big: "down" };
  return { delta: round(rng.normal() * DEV.SD), big: null };
}

/** Stats after a development change: the four SG areas move by their share (created from the sim's
 * defaults if missing) and sg_total, if pasted, by the whole change. */
export function applyDevelopment(stats = {}, delta) {
  const out = { ...stats }, sk = skillsFrom(stats);
  for (const [k, share] of Object.entries(SPLIT)) out[k] = round((out[k] ?? sk[SK_KEY[k]]) + delta * share);
  if (out.sg_total != null) out.sg_total = round(out.sg_total + delta);
  return out;
}

const normal = (rng, mu, sd) => mu + rng.normal() * sd;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function country(rng) {
  const total = COUNTRIES.reduce((a, [, w]) => a + w, 0);
  let x = rng.next() * total;
  for (const [c, w] of COUNTRIES) { if ((x -= w) < 0) return c; }
  return COUNTRIES[0][0];
}

/**
 * Generated golfers for tier 2: college standouts (SG ~ N(+0.20, 0.35)) or journeymen (N(-0.15, 0.30)).
 * Ids "c-<year>-<n>" / "j-<year>-<n>"; names drawn so they don't repeat anyone in `takenNames`.
 */
export function generateGolfers(kind, n, { seed, year, takenNames = new Set() }) {
  const rng = makeRng(`${seed}|gen|${kind}|${year}`);
  const [mu, sd] = kind === "college" ? [0.20, 0.35] : [-0.15, 0.30];
  const out = [];
  for (let i = 0; i < n; i++) {
    let name;
    for (let t = 0; t < 50; t++) {
      name = `${FIRST[Math.floor(rng.next() * FIRST.length)]} ${LAST[Math.floor(rng.next() * LAST.length)]}`;
      if (!takenNames.has(name.toLowerCase())) break;
    }
    takenNames.add(name.toLowerCase());
    const total = round(normal(rng, mu, sd));
    const parts = Object.fromEntries(Object.entries(SPLIT).map(([k, share]) => [k, total * share + normal(rng, 0, 0.10)]));
    const fix = (total - Object.values(parts).reduce((a, b) => a + b, 0)) / 4;  // parts add up to the total
    const stats = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v + fix)]));
    Object.assign(stats, {
      sg_total: total,
      drive_dist: round(clamp(normal(rng, kind === "college" ? 304 : 298, 9), 275, 330), 1),
      drive_acc: round(clamp(normal(rng, 0.60, 0.05), 0.45, 0.75), 4),
      gir: round(clamp(normal(rng, 0.66 + total * 0.02, 0.025), 0.55, 0.76), 4),
      scrambling: round(clamp(normal(rng, 0.58 + total * 0.015, 0.035), 0.48, 0.70), 4),
      putts_per_round: round(clamp(normal(rng, 29.0 - total * 0.25, 0.4), 27.2, 30.6), 2),
    });
    const id = `${kind === "college" ? "c" : "j"}-${year}-${i + 1}`;
    out.push({ id, name, country: country(rng), stats, created: kind, born: year,
      src: kind === "college" ? "generated college standout" : "generated journeyman" });
  }
  return out;
}

/**
 * Tier 2's schedule: one event in each of tier 1's weeks (same start date), at a mapped course other
 * than that week's tier-1 courses where possible, named "<place> <Championship|Classic|...>".
 */
export function tier2Schedule(weeks, courses, seed, year) {
  const mapped = courses.filter((c) => c.layout_source === "osm" && c.holes?.length === 18).map((c) => c.id).sort();
  const rng = makeRng(`${seed}|kft|${year}`);
  const places = [...PLACES];
  for (let i = places.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [places[i], places[j]] = [places[j], places[i]]; }
  let last = null;
  return weeks.map((w, i) => {
    const busy = new Set(w.events.map((e) => e.courseId));
    let pool = mapped.filter((id) => !busy.has(id) && id !== last);
    if (!pool.length) pool = mapped;
    const courseId = pool[Math.floor(rng.next() * pool.length)];
    last = courseId;
    const name = `${places[i % places.length]} ${SUFFIX[Math.floor(rng.next() * SUFFIX.length)]}`;
    return { start: w.start, events: [{ id: `K-${year}-${i}`, name, type: "regular", start: w.start, end: w.events[0]?.end, courseId, tier: 2 }] };
  });
}
