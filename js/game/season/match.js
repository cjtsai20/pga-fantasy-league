// Match play for Race to the FedEx Cup: singles, four-ball and foursomes matches, the 16-man
// playoff bracket, and a hole-by-hole API for matches the user plays. No DOM; all state is plain
// JSON so it can be saved with the career.
//
// Hole scores come from the season engine's quick model (engine.js drawHole + courseFit), passed
// in as `deps` so matches score the same way as stroke-play events:
//   deps.quickHole(sk, holeIdx, rng, extraShift = 0) -> strokes for a golfer with sim.js skills sk
//   deps.fitFor(sk)                                  -> per-hole mean shift for those skills
//   deps.skillsFrom(stats)                           -> sim.js skills from a stats object
// Use engineDeps(course[, calib]) to build them for a course (calib defaults to engine calibFor).
//
// A side is an array of golfers {id, name, sk}: one golfer in singles, two otherwise.
//   singles   - one ball each
//   fourball  - both partners play their own ball; the side scores the better of the two
//   foursomes - one ball per side, played alternately: modeled as the partners' averaged skills,
//               plus a small penalty when the two are badly mismatched

import { skillsFrom } from "../sim.js";
import { calibFor, courseFit, drawHole } from "./engine.js";

const FEATS = ["dist", "acc", "ott", "app", "arg", "putt"];
const HOLES = 18;
const MISMATCH = 0.012;  // strokes per hole per stroke of SG gap between foursomes partners

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
const sgOf = (sk) => sk.ott + sk.app + sk.arg + sk.putt;

// ---------------------------------------------------------------- deps
/** quickHole/fitFor for one course from the engine's calibrated model (fits cached per skills object). */
export function engineDeps(course, calib = null) {
  calib = calib || calibFor(course);
  const cache = new WeakMap();
  const fitFor = (sk) => {
    let f = cache.get(sk);
    if (!f) { f = courseFit(calib, sk); cache.set(sk, f); }
    return f;
  };
  return {
    fitFor,
    skillsFrom,
    quickHole: (sk, i, rng, extraShift = 0) => drawHole(calib.holes[i], course.holes[i].par, fitFor(sk)[i] + extraShift, rng),
  };
}

/** One ball for a foursomes pair: averaged skills, and the mismatch penalty in strokes per hole. */
const pairCache = new WeakMap();
function foursomesBall(side) {
  const hit = pairCache.get(side);
  if (hit) return hit;
  const [x, y] = side;
  const sk = {};
  for (const f of FEATS) sk[f] = (x.sk[f] + y.sk[f]) / 2;
  const ball = { sk, penalty: MISMATCH * Math.abs(sgOf(x.sk) - sgOf(y.sk)) };
  pairCache.set(side, ball);
  return ball;
}

/** A side's strokes on a hole when nobody on it is the user. */
function sideStrokes(format, side, i, rng, deps, excludeId = null) {
  const players = excludeId ? side.filter((g) => g.id !== excludeId) : side;
  if (format === "foursomes") { const b = foursomesBall(side); return deps.quickHole(b.sk, i, rng, b.penalty); }
  if (format === "fourball") return Math.min(...players.map((g) => deps.quickHole(g.sk, i, rng)));
  return deps.quickHole(players[0].sk, i, rng);
}

// ---------------------------------------------------------------- status and results
/** "2 UP thru 7" / "2 DN thru 7" / "All square thru 9" from side `pov`'s point of view. diff > 0 = a up. */
export function statusText(diff, thru, pov = "a") {
  const d = pov === "a" ? diff : -diff;
  if (!thru) return "All square";
  if (d === 0) return `All square thru ${thru}`;
  return `${Math.abs(d)} ${d > 0 ? "UP" : "DN"} thru ${thru}`;
}

/** Is the match over? Regulation ends when the lead exceeds the holes left; extra holes are sudden death. */
function decided(diff, thru, extra) {
  if (thru < HOLES) return Math.abs(diff) > HOLES - thru;
  if (diff !== 0) return true;
  return !extra;  // all square after 18: halved, unless extra holes are played
}

/** Final result string: "3&2", "1 UP", "AS" (halved) or "Won on 19th". */
function resultText(diff, thru) {
  if (diff === 0) return "AS";
  if (thru > HOLES) return `Won on ${ordinal(thru)}`;
  const left = HOLES - thru;
  return left > 0 ? `${Math.abs(diff)}&${left}` : `${Math.abs(diff)} UP`;
}

function finish(st) {
  st.over = true;
  st.winner = st.diff > 0 ? "a" : st.diff < 0 ? "b" : null;
  st.result = resultText(st.diff, st.thru);
  return st;
}

// ---------------------------------------------------------------- matches
/** Fresh match state. a/b: arrays of {id, name, sk}. extra = sudden death after a tied 18 (bracket). */
export function startMatch({ format = "singles", a, b, course = null, extra = false }) {
  return { format, a, b, courseId: course?.id ?? null, extra, diff: 0, thru: 0, holes: [], over: false, winner: null, result: null };
}

/** Course hole index for the next hole of a match (extra holes start again from the 1st). */
export const nextHoleIdx = (st) => st.thru % HOLES;

/**
 * Record one hole: side strokes for a and b (for the user's side, the UI passes its own score; in
 * four-ball the better of the user's and his partner's, see aiStrokes with excludeId).
 */
export function playHoleResult(st, strokesA, strokesB) {
  if (st.over) return st;
  const res = strokesA < strokesB ? "a" : strokesA > strokesB ? "b" : "h";
  st.holes.push({ n: nextHoleIdx(st) + 1, a: strokesA, b: strokesB, res });
  st.diff += res === "a" ? 1 : res === "b" ? -1 : 0;
  st.thru++;
  if (decided(st.diff, st.thru, st.extra)) finish(st);
  return st;
}

/**
 * Strokes for an AI-played side on a hole. For the user's own side in four-ball pass
 * { excludeId: userId } to get just his partner's ball, then best-ball it with the user's score.
 */
export function aiStrokes(st, side, holeIdx, rng, deps, { excludeId = null } = {}) {
  return sideStrokes(st.format, st[side], holeIdx, rng, deps, excludeId);
}

/** Simulate a whole match (or the rest of one passed as `state`). */
export function simMatch({ format = "singles", a, b, course = null, rng, deps, extra = false, state = null }) {
  const st = state || startMatch({ format, a, b, course, extra });
  let guard = 0;
  while (!st.over && guard++ < 200) {
    const i = nextHoleIdx(st);
    playHoleResult(st, sideStrokes(st.format, st.a, i, rng, deps), sideStrokes(st.format, st.b, i, rng, deps));
  }
  if (!st.over) finish(st);  // a 200-hole tie can't happen in practice; never loop forever
  return st;
}

/** Small summary kept in saved state (the hole list is dropped for AI matches). */
export const summarize = (st, keepHoles = false) => ({
  winner: st.winner, result: st.result, thru: st.thru, extra: st.thru > HOLES,
  ...(keepHoles ? { holes: st.holes } : {}),
});

// ---------------------------------------------------------------- playoff bracket
const SEED_ORDER = [[1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15]];
export const ROUND_NAMES = ["Round of 16", "Quarterfinals", "Semifinals", "Final"];

export const bracket = {
  /** top16: [{id, name, points, sk}] in standings order (seed 1 first). */
  create(top16) {
    if (top16.length < 16) throw new Error(`The bracket needs 16 golfers (got ${top16.length}).`);
    const golfers = {};
    top16.slice(0, 16).forEach((g, i) => { golfers[g.id] = { id: g.id, name: g.name, points: g.points ?? 0, sk: g.sk, seed: i + 1 }; });
    const bySeed = (s) => top16[s - 1].id;
    return {
      golfers,
      rounds: [SEED_ORDER.map(([x, y]) => ({ a: bySeed(x), b: bySeed(y), res: null })), [], [], []],
      round: 0,
      champion: null,
    };
  },

  /** Sim every unplayed match in the current round except those with skipIds; advance when complete. */
  simRound(state, course, deps, rng, { skipIds = [] } = {}) {
    if (state.champion) return state;
    const skip = new Set(skipIds);
    for (const m of state.rounds[state.round]) {
      if (m.res || skip.has(m.a) || skip.has(m.b)) continue;
      const st = simMatch({ format: "singles", a: [state.golfers[m.a]], b: [state.golfers[m.b]], course, rng, deps, extra: true });
      m.res = summarize(st);
    }
    bracket.advance(state);
    return state;
  },

  /** Store a match the user played (matchIdx within the current round). */
  recordMatch(state, matchIdx, matchState) {
    state.rounds[state.round][matchIdx].res = summarize(matchState, true);
    bracket.advance(state);
    return state;
  },

  /** When the current round is complete, pair winners into the next one (or crown the champion). */
  advance(state) {
    const cur = state.rounds[state.round];
    if (state.champion || cur.some((m) => !m.res)) return false;
    const winners = cur.map((m) => (m.res.winner === "a" ? m.a : m.b));
    if (state.round === ROUND_NAMES.length - 1) { state.champion = winners[0]; return true; }
    state.round++;
    state.rounds[state.round] = [];
    for (let i = 0; i < winners.length; i += 2) state.rounds[state.round].push({ a: winners[i], b: winners[i + 1], res: null });
    return true;
  },

  /** The user's unplayed match in the current round: {round, idx, a, b} (a/b golfer objects), or null. */
  nextUserMatch(state, userId) {
    if (state.champion) return null;
    const idx = state.rounds[state.round].findIndex((m) => !m.res && (m.a === userId || m.b === userId));
    if (idx < 0) return null;
    const m = state.rounds[state.round][idx];
    return { round: state.round, idx, a: state.golfers[m.a], b: state.golfers[m.b], userSide: m.a === userId ? "a" : "b" };
  },

  /** Is the user still alive in the bracket? */
  alive(state, userId) {
    return state.rounds[state.round].some((m) => (m.a === userId || m.b === userId) && (!m.res || (m.res.winner === "a" ? m.a : m.b) === userId))
      || state.champion === userId;
  },

  champion: (state) => state.champion,
};
