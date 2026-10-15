// Road to the TOUR: a career as a golfer you create, straight out of college. It is a Race to the
// FedEx Cup career (engine.js: both tiers, promotion and relegation, playoffs, cups, yearly
// development) with two differences:
//   * You start as a new golfer: a star college player starts on the PGA TOUR near the bottom of the
//     field (ROOKIE_START), a good one in the middle of the Korn Ferry Tour.
//   * You earn training points from every event you play (TP) and spend them to raise your strokes
//     gained in one of the four areas. Each session in an area costs a little more than the last, and
//     what it gains is a little random (sessionGain): your golfer's talent, how quickly you pick up
//     that area, how good you already are at it (weak areas improve faster) and the session's luck.
//   * Every created golfer has a ceiling (POTENTIAL), fixed when the career starts and kept hidden:
//     somewhere among the PGA TOUR's top 15, rarely above its best. Training slows as you near it and
//     as you age (AGE), and nothing (not even a big off-season jump) takes you past it.
// No DOM; ui.js draws it. Everything lives on the career (career.mode, career.rookie), so slots,
// saving and account sync work as for any career.

import { newSeason, sgTotal, skillsFrom, makeRng } from "./engine.js";
import { COUNTRIES } from "./names.js";

export const MODE = "rookie";
export const isRookie = (career) => career?.mode === MODE;

// Where a new golfer starts: tier and the field rank whose strokes gained he's given.
export const ROOKIE_START = {
  star: { tier: 1, rank: 80, label: "Star college player", note: "Turns pro straight onto the PGA TOUR, near the bottom of the field. Train fast or drop to the Korn Ferry Tour." },
  good: { tier: 2, rank: 40, label: "Good college player", note: "Starts mid-pack on the Korn Ferry Tour. Finish in its top 25 to earn a PGA TOUR card." },
};

export const AREAS = [["sg_ott", "Off the tee"], ["sg_app", "Approach"], ["sg_arg", "Around the green"], ["sg_putt", "Putting"]];
const SPLIT = { sg_ott: 0.25, sg_app: 0.35, sg_arg: 0.15, sg_putt: 0.25 };

// Playing styles: the same total strokes gained, shifted between the areas (offsets add up to 0).
// Driving distance and accuracy drive the shot model too, so they lean the same way.
export const STYLES = {
  balanced: { label: "All-rounder", note: "No weak spot", off: { sg_ott: 0, sg_app: 0, sg_arg: 0, sg_putt: 0 }, dist: 299, acc: 0.60 },
  bomber: { label: "Bomber", note: "Long and a little wild", off: { sg_ott: 0.25, sg_app: -0.05, sg_arg: -0.10, sg_putt: -0.10 }, dist: 309, acc: 0.50 },
  irons: { label: "Iron player", note: "Lives on the flagstick", off: { sg_ott: -0.10, sg_app: 0.25, sg_arg: -0.05, sg_putt: -0.10 }, dist: 296, acc: 0.64 },
  touch: { label: "Short-game wizard", note: "Gets up and down, holes putts", off: { sg_ott: -0.15, sg_app: -0.10, sg_arg: 0.10, sg_putt: 0.15 }, dist: 295, acc: 0.63 },
};

// Training points per event by finish (x PGA on the PGA TOUR), plus SEASON each off-season.
// A session adds about STEP x 1.3 strokes gained a round to one area (sessionGain, below) and costs
// COST + RISE x sessions already done in that area, at most CAP. What really slows you is age and your
// ceiling (below): most golfers get close to it in their mid to late 20s.
export const TRAIN = { STEP: 0.01, COST: 8, RISE: 1, CAP: 20, SEASON: 20, PGA: 1.5 };
// What a session gains: STEP x talent x aptitude[area] x ease(area) x luck.
//   talent ~ N(1, 0.18) per golfer, 0.6..1.5; aptitude ~ N(1, 0.12) per area, 0.75..1.3, +APT_STYLE in
//   the style's strong areas; ease = EASE.HI - EASE.SLOPE x the area's SG, 0.6..1.4 (a weak area is
//   easier to improve); luck: BREAK_P a breakthrough (x2.5), DUD_P a session that doesn't click (0),
//   otherwise U(0.6, 1.4). Seeded per career, area and session, so reloading can't re-roll a session.
export const LEARN = { TALENT_SD: 0.18, APT_SD: 0.12, APT_STYLE: 0.15, EASE_HI: 1.2, EASE_SLOPE: 0.6, BREAK_P: 0.10, BREAK_X: 2.5, DUD_P: 0.05 };
const STRONG = { balanced: [], bomber: ["sg_ott"], irons: ["sg_app"], touch: ["sg_arg", "sg_putt"] };
// Ceiling, by rank among the PGA TOUR as it is when the career starts: ABOVE_P above its best golfer
// (by U(ABOVE_LO, ABOVE_HI)), NEXT_P between the best and the second best, otherwise anywhere from the
// 2nd to the TOP-th best (evenly by rank, between neighbours' SG). By rank rather than SG because the
// best golfer can stand far clear of the rest. Gains taper over the last TAPER strokes below it.
export const POTENTIAL = { TOP: 15, ABOVE_P: 0.04, ABOVE_LO: 0.05, ABOVE_HI: 0.35, NEXT_P: 0.03, TAPER: 0.5, MIN_ROOM: 0.3 };
// Age: you turn pro at START; training works fully through PEAK, then FADE less each year, never below MIN.
export const AGE = { START: 22, PEAK: 25, FADE: 0.12, MIN: 0.15 };
export const TP = [[1, 25], [5, 16], [10, 12], [25, 8], [Infinity, 5]];  // [best finish up to, points]; MC = 2
const TP_MC = 2;

const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
export const countries = () => COUNTRIES.map(([c]) => c);

/** Training points for one finish ("1", "T7", "MC") in tier 1 or 2. */
export function eventTp(pos, tier = 1) {
  if (!pos) return 0;
  const n = Number(String(pos).replace("T", ""));
  const base = !n ? TP_MC : TP.find(([upTo]) => n <= upTo)[1];
  return Math.round(base * (tier === 2 ? 1 : TRAIN.PGA));
}

/** Points earned this season so far: every finished event the user played in either tier. */
export function earnedThisSeason(career) {
  let n = 0;
  for (const [events, tier] of [[career.events || {}, 1], [career.tier2?.events || {}, 2]]) {
    for (const ev of Object.values(events)) if (ev.status === "done" && ev.userPos) n += eventTp(ev.userPos, tier);
  }
  return n;
}

/** Points available to spend now. */
export const bank = (career) => (career.rookie?.carried || 0) + earnedThisSeason(career) - (career.rookie?.spent || 0);
export const sessionCost = (career, area) => Math.round(Math.min(TRAIN.CAP ?? Infinity, TRAIN.COST + TRAIN.RISE * (career.rookie?.levels?.[area] || 0)));

/** No training while one of the user's events is under way (its rounds are already being played),
 * nor once you're at your ceiling. */
export function canTrain(career) {
  if (!isRookie(career) || career.phase === "playoffs" || career.phase === "cup") return false;
  if (roomLeft(career) <= 0) return false;
  return ![...Object.values(career.events || {}), ...Object.values(career.tier2?.events || {})].some((e) => e.status === "live");
}

/** The user's current strokes gained in each area: {sg_ott, sg_app, sg_arg, sg_putt}. */
export function areaSg(career) {
  const st = career.golfers?.[career.userGolferId]?.stats || {}, sk = skillsFrom(st);
  const key = { sg_ott: "ott", sg_app: "app", sg_arg: "arg", sg_putt: "putt" };
  return Object.fromEntries(AREAS.map(([k]) => [k, st[k] ?? sk[key[k]]]));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** A new golfer's learning: {talent, aptitude: {area: x}} (see LEARN). */
export function drawLearning(seed, style) {
  const rng = makeRng(`${seed}|learning`);
  const talent = round(clamp(1 + rng.normal() * LEARN.TALENT_SD, 0.6, 1.5), 3);
  const aptitude = Object.fromEntries(AREAS.map(([k]) => [k,
    round(clamp(1 + rng.normal() * LEARN.APT_SD, 0.75, 1.3) + ((STRONG[style] || []).includes(k) ? LEARN.APT_STYLE : 0), 3)]));
  return { talent, aptitude };
}
const learning = (career) => (career.rookie.learn ||= drawLearning(career.seed, career.rookie.style));

/** How easily an area improves at its current SG (weak areas faster). */
export const easeOf = (areaValue) => clamp(LEARN.EASE_HI - LEARN.EASE_SLOPE * areaValue, 0.6, 1.4);

/** How much training still takes at an age: 1 through AGE.PEAK, then FADE less a year (min AGE.MIN). */
export const ageFactor = (age) => clamp(1 - Math.max(0, age - AGE.PEAK) * AGE.FADE, AGE.MIN, 1);
export const ageOf = (career) => career.rookie.age ?? AGE.START + (career.history?.length || 0);

/**
 * A golfer's ceiling from a PGA TOUR field (strongest first, without him): {ceiling, rank, band}. rank is
 * where the ceiling would sit in that field (1 = above everyone), band the scouts' word for it.
 */
export function drawPotential(seed, field, startSg) {
  const rng = makeRng(`${seed}|potential`);
  const sgAt = (i) => field[Math.min(i, field.length - 1)]?.sg ?? 0;  // 0-based rank
  const u = rng.next(), v = rng.next();
  let ceiling;
  if (u < POTENTIAL.ABOVE_P) ceiling = sgAt(0) + POTENTIAL.ABOVE_LO + v * (POTENTIAL.ABOVE_HI - POTENTIAL.ABOVE_LO);
  else if (u < POTENTIAL.ABOVE_P + POTENTIAL.NEXT_P) ceiling = sgAt(1) + v * (sgAt(0) - sgAt(1));
  else {
    const x = 1 + v * (POTENTIAL.TOP - 1), i = Math.floor(x);  // 1..TOP-1: from the 2nd best to the TOP-th
    ceiling = sgAt(i) + (x - i) * (sgAt(i + 1) - sgAt(i));
  }
  ceiling = round(Math.max(ceiling, startSg + POTENTIAL.MIN_ROOM));
  const rank = field.filter((g) => g.sg > ceiling).length + 1;
  const band = rank === 1 ? "generational: could become the best in the world" : rank <= 3 ? "elite: a future world top 3"
    : rank <= 8 ? "a star: a future top 10" : "a tour star: a future top 15";
  return { ceiling, rank, band };
}
const others = (career) => [...career.field].filter((g) => g.id !== career.userGolferId).sort((a, b) => b.sg - a.sg);
export const potentialOf = (career) => (career.rookie.potential ||= drawPotential(career.seed, others(career), sgTotal(career.golfers[career.userGolferId])));
/** Strokes gained a round left before the ceiling. */
export const roomLeft = (career) => round(potentialOf(career).ceiling - sgTotal(career.golfers[career.userGolferId]));

/** A typical (luck x1) session's gain in `area` right now. */
export function expectedGain(career, area) {
  const L = learning(career), room = roomLeft(career);
  if (room <= 0) return 0;
  const taper = clamp(room / POTENTIAL.TAPER, 0.1, 1);
  return round(Math.min(room, TRAIN.STEP * L.talent * (L.aptitude[area] ?? 1) * easeOf(areaSg(career)[area]) * ageFactor(ageOf(career)) * taper), 4);
}

/** This session's gain in `area`: {gain, luck: 'breakthrough'|'dud'|'capped'|null}. Seeded, so it replays the same. */
export function sessionGain(career, area) {
  const rng = makeRng(`${career.seed}|train|${area}|${career.rookie.levels?.[area] || 0}`);
  const u = rng.next(), base = expectedGain(career, area), room = roomLeft(career);
  if (room <= 0) return { gain: 0, luck: "capped" };
  if (u < LEARN.DUD_P) return { gain: 0, luck: "dud" };
  const big = u < LEARN.DUD_P + LEARN.BREAK_P;
  const g = big ? base * LEARN.BREAK_X : base * (0.6 + 0.8 * rng.next());
  return { gain: round(Math.min(g, room)), luck: big ? "breakthrough" : null };
}

/** Quick / steady / slow, from a learning multiplier (talent or an area's aptitude). */
export const learnLabel = (x) => (x >= 1.12 ? "quick" : x <= 0.88 ? "slow" : "steady");
export const talentOf = (career) => learning(career).talent;

/**
 * One training session in `area`, paid from the bank: adds sessionGain's strokes gained there. Updates
 * the career's copy of the golfer (next season starts from it) and this season's field entry (what the
 * events use). Returns {gain, luck, cost}, or false if it can't be afforded or now isn't the time.
 */
export function train(career, area) {
  if (!canTrain(career) || !SPLIT[area]) return false;
  const cost = sessionCost(career, area);
  if (bank(career) < cost) return false;
  const id = career.userGolferId, rec = career.golfers[id];
  const now = areaSg(career)[area];
  let { gain, luck } = sessionGain(career, area);
  rec.stats = { ...rec.stats, [area]: round(now + gain) };
  if (rec.stats.sg_total != null) rec.stats.sg_total = round(rec.stats.sg_total + gain);
  const over = round(sgTotal(rec) - potentialOf(career).ceiling);
  if (over > 0) {
    rec.stats[area] = round(rec.stats[area] - over);
    if (rec.stats.sg_total != null) rec.stats.sg_total = round(rec.stats.sg_total - over);
    gain = round(gain - over);
  }
  for (const g of [...career.field, ...(career.tier2?.field || [])]) {
    if (g.id === id) { g.stats = { ...rec.stats }; g.sg = round(sgTotal(g)); }
  }
  delete career._sk; delete career._shape;  // skills and form curves are rebuilt from the new numbers
  const r = career.rookie;
  r.levels[area] = (r.levels[area] || 0) + 1;
  r.spent += cost;
  r.gained = { ...(r.gained || {}), [area]: round((r.gained?.[area] || 0) + gain) };
  (r.log ||= []).push({ year: career.year, week: career.weekIdx, area, cost, gain, luck });
  return { gain, luck, cost };
}

/** A new golfer's stats for a total strokes gained and a style. */
export function rookieStats(total, styleKey) {
  const style = STYLES[styleKey] || STYLES.balanced;
  const parts = Object.fromEntries(Object.entries(SPLIT).map(([k, share]) => [k, round(total * share + style.off[k])]));
  return {
    ...parts,
    drive_dist: style.dist, drive_acc: style.acc,
    gir: round(0.66 + parts.sg_app / 7, 4), scrambling: round(0.59 + parts.sg_arg / 3, 4),
    putts_per_round: round(29.0 - parts.sg_putt * 2, 2),
  };
}

/**
 * A new Road to the TOUR career. The season is built as for any career without a user golfer, then
 * the new golfer takes the place of the weakest in his tier (on the PGA TOUR that golfer drops to the
 * Korn Ferry Tour, whose weakest leaves). His strokes gained is the ROOKIE_START rank's in that tier.
 * @param rookie {name, country, level: 'star'|'good', style}
 */
export function newRookieCareer({ golfers, pastedCount, seed, tournaments, courses, year, rookie }) {
  const career = newSeason({ golfers, pastedCount, userId: null, seed, tournaments, courses, year });
  const start = ROOKIE_START[rookie.level] || ROOKIE_START.good;
  const t1 = career.field, t2 = career.tier2.field;
  const mine = start.tier === 1 ? t1 : t2;
  const total = round(mine[Math.min(start.rank, mine.length) - 1]?.sg ?? 0);
  const potential = drawPotential(seed, t1, total);  // before you join, so it reads the tour as it is
  const id = `me-${seed}`;
  const stats = rookieStats(total, rookie.style);
  const drop = (arr) => { const g = arr.pop(); delete career.golfers[g.id]; return g; };  // fields are sorted strongest first
  if (start.tier === 1) {
    const down = t1.pop();
    drop(t2);
    t2.push(down);
  } else drop(t2);
  const name = String(rookie.name || "").trim().slice(0, 30) || "You";
  const country = rookie.country || "United States";
  career.golfers[id] = { id, name, country, stats, src: "your golfer", born: year };
  mine.push({ id, name, country, sg: round(sgTotal({ stats })), src: "your golfer", stats: { ...stats } });
  for (const f of [t1, t2]) f.sort((a, b) => b.sg - a.sg || a.name.localeCompare(b.name));
  Object.assign(career, {
    mode: MODE, userGolferId: id, userName: name, userTier: start.tier,
    rookie: { level: rookie.level, style: rookie.style, levels: { sg_ott: 0, sg_app: 0, sg_arg: 0, sg_putt: 0 },
      gained: { sg_ott: 0, sg_app: 0, sg_arg: 0, sg_putt: 0 }, learn: drawLearning(seed, rookie.style), potential, age: AGE.START,
      carried: 0, spent: 0, log: [], sgHist: [] },
  });
  return career;
}

/** Carry the rookie state into the next season (call after newSeason({prev})): unspent points plus
 * the off-season bonus, the sessions done per area (costs keep rising), a year older, and the year's
 * closing SG. An off-season jump past the ceiling is cut back to it. */
export function carryRookie(prev, next) {
  if (!isRookie(prev)) return next;
  const left = bank(prev), potential = potentialOf(prev);
  next.mode = MODE;
  next.rookie = {
    ...prev.rookie, carried: left + TRAIN.SEASON, spent: 0, log: [], potential, age: ageOf(prev) + 1,
    sgHist: [...(prev.rookie.sgHist || []), { year: prev.year, sg: round(sgTotal(prev.golfers[prev.userGolferId])) }],
  };
  const id = next.userGolferId, rec = next.golfers[id], over = round(sgTotal(rec) - potential.ceiling);
  let capped = false;
  if (over > 0) {
    const st = { ...rec.stats }, now = areaSg(next);
    for (const [k, share] of Object.entries(SPLIT)) st[k] = round(now[k] - over * share);
    if (st.sg_total != null) st.sg_total = round(st.sg_total - over);
    const left = round(sgTotal({ stats: st }) - potential.ceiling);  // rounding leftovers
    if (left > 0) { st.sg_app = round(st.sg_app - left); if (st.sg_total != null) st.sg_total = round(st.sg_total - left); }
    rec.stats = st;
    for (const g of [...next.field, ...(next.tier2?.field || [])]) if (g.id === id) { g.stats = { ...st }; g.sg = round(sgTotal(g)); }
    const d = next.offseason?.development?.find((x) => x.id === id);
    if (d) { d.after = round(sgTotal(rec)); d.delta = round(d.after - d.before); d.capped = true; }
    delete next._sk; delete next._shape;
    capped = true;
  }
  if (next.offseason) next.offseason.training = { left, bonus: TRAIN.SEASON, age: next.rookie.age, capped };
  return next;
}

