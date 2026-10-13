// Shot-by-shot golf model for the Play tab. No DOM here, so sim_test.html can run it headless.
//
// A ball is tracked as (s, x) in yards: s = distance along the hole's centerline from the tee,
// x = lateral offset (+ right). The pin sits at (pinS(hole), 0). Every shot draws its outcome
// from the golfer's stats; strategy choices trade expected result against variance and hazards.
//
// Holes with real layouts (hole.geo, from OpenStreetMap; see geo.js) use the same frame, with s
// along the tee->pin line. There, shots fly at an aim point with stat-driven dispersion and the lie
// is whatever polygon the ball lands in. Holes without geo keep the probabilistic hazard rolls.

import { classify, aimAlong, layupPoint, dryBack } from "./geo.js";

// ---------------------------------------------------------------- seeded RNG
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function makeRng(seed) {
  let a = xmur3(String(seed))();
  const next = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    normal() {
      const u = Math.max(next(), 1e-12), v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    chance(p) { return next() < p; },
    // 2D miss distance with the given mean (Rayleigh distribution)
    rayleigh(mean) { return (mean / 1.2533) * Math.sqrt(-2 * Math.log(Math.max(next(), 1e-12))); },
  };
}

// ---------------------------------------------------------------- skills
const TOUR = { drive_dist: 299, drive_acc: 0.6, gir: 0.66, scrambling: 0.59, putts_per_round: 29.0 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Turn a players.json `stats` object into model inputs; missing stats fall back to tour average. */
export function skillsFrom(stats = {}) {
  const s = { ...TOUR, ...stats };
  return {
    dist: s.drive_dist,
    acc: s.drive_acc,
    ott: stats.sg_ott ?? (s.drive_dist - 299) / 25 + (s.drive_acc - 0.6) * 3,
    app: stats.sg_app ?? (s.gir - 0.66) * 7,
    arg: stats.sg_arg ?? (s.scrambling - 0.59) * 3,
    putt: stats.sg_putt ?? (29.0 - s.putts_per_round) * 0.5,
  };
}

// ---------------------------------------------------------------- tables
// Tour-average approach proximity (ft) from the fairway by distance (yds)
const PROX = [[30, 10], [50, 13], [75, 16], [100, 18], [125, 21], [150, 25], [175, 30], [200, 36],
  [225, 44], [250, 54], [275, 66], [300, 80]];
// Tour make % by putt length (ft)
const MAKE = [[1, 0.995], [2, 0.985], [3, 0.94], [4, 0.86], [5, 0.76], [6, 0.66], [7, 0.58], [8, 0.51],
  [9, 0.45], [10, 0.40], [12, 0.32], [15, 0.23], [20, 0.15], [25, 0.10], [30, 0.07], [40, 0.045],
  [50, 0.03], [60, 0.02], [90, 0.01]];

function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

const LIE_PROX = { tee: 0.95, fairway: 1, drop: 1.05, fringe: 1, rough: 1.45, fw_bunker: 1.65, trees: 2.4 };
const LIE_NAME = {
  tee: "the tee", fairway: "the fairway", rough: "the rough", fw_bunker: "a fairway bunker",
  gs_bunker: "a greenside bunker", trees: "the trees", fringe: "the fringe", green: "the green",
  drop: "the drop area",
};
const GREEN_R = 25;   // ft from pin to the edge of the green, on average
const SHORT_GAME = 35; // yds; inside this off the green you chip/pitch instead of hitting an approach

const has = (hole, h) => (hole.hazards || []).includes(h);
const sideName = (x) => (x < 0 ? "left" : "right");
const fmtFt = (ft) => (ft < 3 ? `${ft.toFixed(1)} ft` : `${Math.round(ft)} ft`);

function clubFor(yds, dist) {
  const y = (yds * 300) / dist; // scale to a 300-yd driver
  if (y >= 262) return "Driver";
  if (y >= 238) return "3-wood";
  if (y >= 222) return "5-wood";
  if (y >= 208) return "Hybrid";
  if (y >= 197) return "4-iron";
  if (y >= 186) return "5-iron";
  if (y >= 174) return "6-iron";
  if (y >= 162) return "7-iron";
  if (y >= 150) return "8-iron";
  if (y >= 138) return "9-iron";
  if (y >= 124) return "Pitching wedge";
  if (y >= 108) return "Gap wedge";
  if (y >= 88) return "Sand wedge";
  return "Lob wedge";
}

// ---------------------------------------------------------------- hole state
export function newHole(hole) {
  return { hole, s: 0, x: 0, lie: "tee", strokes: 0, holed: false, putts: 0, shots: [] };
}

/** s of the pin: the geo pin when there's a real layout, else the hole length. */
export const pinS = (hole) => (hole.geo ? hole.geo.pin[0] : hole.yards);

export function distToPin(st) {
  return Math.hypot(pinS(st.hole) - st.s, st.x);
}
const maxCarry = (lie, sk) => sk.dist * ({ fairway: 0.92, drop: 0.9, rough: 0.8, fw_bunker: 0.72, trees: 0.5 }[lie] ?? 0.92);

/** Which kind of shot the golfer faces: tee | approach | short | putt | done */
export function phase(st) {
  if (st.holed) return "done";
  if (st.lie === "green") return "putt";
  if (st.lie === "tee" && st.hole.par > 3) return "tee";
  if (st.lie !== "tee" && distToPin(st) <= SHORT_GAME) return "short";
  return "approach";
}

// ---------------------------------------------------------------- options
/** The choices on offer for the current shot: [{id, label, desc, risk: 'low'|'med'|'high'}] */
export function shotOptions(st, sk) {
  const d = distToPin(st), hole = st.hole;
  switch (phase(st)) {
    case "tee": {
      const opts = [
        { id: "driver_aggr", label: "Driver, swing hard", desc: `About ${Math.round(sk.dist + 8)} yds. Longest, widest misses${hole.shape !== "straight" ? ", cuts the corner" : ""}.`, risk: "high" },
        { id: "driver", label: "Driver, controlled", desc: `About ${Math.round(sk.dist - 3)} yds. Your stock tee shot.`, risk: "med" },
        { id: "wood3", label: "3-wood", desc: `About ${Math.round(sk.dist * 0.91)} yds. Finds more fairways.`, risk: "low" },
        { id: "iron", label: "Long iron layup", desc: `About ${Math.round(sk.dist * 0.76)} yds. Short of trouble, longer approach.`, risk: "low" },
      ];
      return opts;
    }
    case "approach": {
      if (st.lie === "trees") {
        return [
          { id: "punch", label: "Punch out to the fairway", desc: "Take your medicine and get back in play.", risk: "low" },
          { id: "hero", label: "Hero shot through the gap", desc: `Go at the green from ${Math.round(d)} yds. Could hit a branch.`, risk: "high" },
        ];
      }
      const reach = maxCarry(st.lie, sk);
      if (d > reach + 5) {
        return [
          { id: "layup", label: "Lay up to wedge distance", desc: "Leave a full wedge into the green.", risk: "low" },
          { id: "advance", label: "Advance it as far as you can", desc: `Leaves about ${Math.max(20, Math.round(d - reach))} yds, but a tougher lie is more likely.`, risk: "med" },
        ];
      }
      const club = clubFor(d, sk.dist);
      const nearWater = has(hole, "water_green") || has(hole, "water_front") || has(hole, "water_left") || has(hole, "water_right");
      const opts = [
        { id: "attack", label: "Attack the pin", desc: `${club} at the flag. Closer, but short-siding and hazards are more likely.`, risk: "high" },
        { id: "center", label: "Center of the green", desc: `${club} to the fat part. More greens, longer putts.`, risk: "low" },
      ];
      if (st.lie !== "tee" && d > 110 && (nearWater || d > 200)) {
        opts.push({ id: "layup", label: "Lay up short", desc: "Leave a wedge in and take the hazard out of play.", risk: "low" });
      }
      return opts;
    }
    case "short": {
      if (st.lie === "gs_bunker") {
        return [
          { id: "splash", label: "Splash out safely", desc: "Get it on the green.", risk: "low" },
          { id: "bunker_attack", label: "Attack the pin from the sand", desc: "Thinner contact, closer when it comes off.", risk: "high" },
        ];
      }
      const opts = [
        { id: "chip", label: "Bump-and-run chip", desc: "Low and predictable.", risk: "low" },
        { id: "flop", label: "High flop at the pin", desc: "Stops fast near the hole; a bladed or chunked one is possible.", risk: "high" },
      ];
      if ((st.lie === "fringe" || st.lie === "fairway") && d <= 20) {
        opts.unshift({ id: "texas", label: "Putt it from off the green", desc: "Hard to make a big mistake.", risk: "low" });
      }
      return opts;
    }
    case "putt": {
      const ft = d * 3;
      if (ft < 1.5) return [{ id: "tap", label: "Tap in", desc: "", risk: "low" }];
      return [
        { id: "lag", label: ft > 12 ? "Lag it close" : "Die it in the hole", desc: "Soft pace, a tap-in if it misses.", risk: "low" },
        { id: "charge", label: "Give it a run", desc: "Firm pace, more go in, longer comebacks.", risk: "high" },
      ];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------- shot outcomes
function place(st, s, x, lie) {
  st.s = s; st.x = x; st.lie = lie;
}

/** Put the ball r ft from the pin in a random direction, on the green or around it. */
function nearPin(st, rFt, rng, lie) {
  const a = rng.next() * 2 * Math.PI;
  place(st, pinS(st.hole) + (rFt / 3) * Math.cos(a), (rFt / 3) * Math.sin(a), lie);
}

function teeShot(st, opt, sk, rng) {
  const hole = st.hole, L = hole.yards;
  const cfg = {
    driver_aggr: { mean: sk.dist + 8, sd: 13, acc: -0.1, wide: 1.3, water: 0.42, label: "Driver" },
    driver: { mean: sk.dist - 3, sd: 10, acc: 0, wide: 1, water: 0.32, label: "Driver" },
    wood3: { mean: sk.dist * 0.91, sd: 9, acc: 0.09, wide: 0.85, water: 0.24, label: "3-wood" },
    iron: { mean: sk.dist * 0.76, sd: 8, acc: 0.18, wide: 0.7, water: 0.15, label: clubFor(sk.dist * 0.76, sk.dist) },
  }[opt];
  const trouble = ["water_left", "water_right", "trees_left", "trees_right", "ob_left", "ob_right"].some((h) => has(hole, h));
  let pFair = cfg.acc + sk.acc + 0.04 * sk.ott - 0.15 * (hole.difficulty || 0) - (trouble ? 0.03 : 0);
  let len = cfg.mean + cfg.sd * rng.normal();
  if (opt === "driver_aggr" && hole.shape !== "straight") len += 10; // over the corner
  len = Math.min(len, L + 15);
  const fair = rng.chance(clamp(pFair, 0.15, 0.95));
  const out = { club: cfg.label, carry: Math.round(len), penalty: 0 };

  if (fair) {
    place(st, len, rng.normal() * 6, "fairway");
    if (distToPin(st) * 3 < GREEN_R) { st.lie = "green"; out.text = `${cfg.label}, ${out.carry} yds, drives the green!`; }
    else out.text = `${cfg.label}, ${out.carry} yds, splits the fairway.`;
    return out;
  }
  const side = rng.chance(0.5) ? -1 : 1, sn = side < 0 ? "left" : "right";
  const x = side * (16 + Math.abs(rng.normal()) * 11 * cfg.wide);
  if (has(hole, `water_${sn}`) && rng.chance(cfg.water)) {
    st.strokes += 1; out.penalty = 1;
    place(st, Math.min(len * 0.92, L - 40), side * 16, "rough");
    out.text = `${cfg.label} pulls into the water ${sn}. Penalty drop.`;
    return out;
  }
  if (has(hole, `ob_${sn}`) && rng.chance(0.16 * cfg.wide)) {
    st.strokes += 1; out.penalty = 1;
    place(st, 0, 0, "tee");
    out.text = `${cfg.label} sails out of bounds ${sn}. Stroke and distance; re-tee.`;
    return out;
  }
  if (has(hole, `fairway_bunker_${sn}`) && rng.chance(0.45)) {
    place(st, len, side * 17, "fw_bunker");
    out.text = `${cfg.label}, ${out.carry} yds, finds the ${sn} fairway bunker.`;
    return out;
  }
  if (rng.chance(has(hole, `trees_${sn}`) ? 0.4 : 0.08 * cfg.wide)) {
    place(st, len - 5, x + side * 8, "trees");
    out.text = `${cfg.label}, ${out.carry} yds, blocked out in the trees ${sn}.`;
    return out;
  }
  place(st, len, x, "rough");
  out.text = `${cfg.label}, ${out.carry} yds, misses ${sn} into the rough.`;
  return out;
}

function layup(st, sk, rng, aggressive) {
  const d = distToPin(st), reach = maxCarry(st.lie, sk);
  let target = aggressive ? Math.max(20, d - reach) : Math.max(d > 150 ? 95 : 50, d - reach);
  target = Math.min(target, d - 30);
  const len = d - target + rng.normal() * (aggressive ? 12 : 7);
  const fair = rng.chance(clamp((aggressive ? 0.62 : 0.86) + 0.03 * sk.app, 0.3, 0.97));
  const s = st.s + (st.hole.yards - st.s) * (len / d);
  let lie = fair ? "fairway" : "rough";
  if (!fair && has(st.hole, "water_front") && target < 60 && rng.chance(0.25)) {
    st.strokes += 1;
    place(st, st.hole.yards - 70, 0, "drop");
    return { club: clubFor(len, sk.dist), carry: Math.round(len), penalty: 1, text: `Runs through into the water. Penalty drop, 70 yds out.` };
  }
  place(st, s, fair ? rng.normal() * 5 : (rng.chance(0.5) ? -1 : 1) * (15 + rng.next() * 8), lie);
  const club = clubFor(len, sk.dist);
  return { club, carry: Math.round(len), penalty: 0, text: `${club} lays up to ${Math.round(distToPin(st))} yds, in ${LIE_NAME[lie]}.` };
}

function approach(st, opt, sk, rng) {
  const hole = st.hole, d = distToPin(st);
  if (opt === "layup" || opt === "advance") return layup(st, sk, rng, opt === "advance");
  if (opt === "punch") {
    const len = Math.min(d - 40, 120 + rng.normal() * 15);
    const s = st.s + (hole.yards - st.s) * (len / d);
    const fair = rng.chance(0.82);
    place(st, s, fair ? rng.normal() * 5 : (st.x < 0 ? -18 : 18), fair ? "fairway" : "rough");
    return { club: "Punch 7-iron", carry: Math.round(len), penalty: 0, text: `Punches out to ${Math.round(distToPin(st))} yds, in ${LIE_NAME[st.lie]}.` };
  }
  let lie = st.lie;
  if (opt === "hero" && rng.chance(0.24)) {
    const len = 25 + Math.abs(rng.normal()) * 25;
    place(st, st.s + len, st.x * 0.7, "rough");
    return { club: clubFor(d, sk.dist), carry: Math.round(len), penalty: 0, text: `Clips a branch. The ball drops ${Math.round(len)} yds ahead in the rough.` };
  }
  if (lie === "fw_bunker" && rng.chance(0.08)) {
    const len = d * 0.3;
    place(st, st.s + len, st.x, "rough");
    return { club: clubFor(d, sk.dist), carry: Math.round(len), penalty: 0, text: `Catches the lip of the bunker and goes only ${Math.round(len)} yds.` };
  }

  const club = clubFor(d, sk.dist);
  let m = interp(PROX, d) * (LIE_PROX[lie] ?? 1) * Math.exp(-0.11 * sk.app) * (1.04 + 0.6 * (hole.difficulty || 0));
  const attack = opt === "attack" || opt === "hero";
  m *= attack ? 0.86 : 1.12;
  const r = rng.rayleigh(m);
  const rEff = attack ? r : r * 0.78;
  const out = { club, carry: Math.round(d), penalty: 0 };
  const from = `${club} from ${Math.round(d)} yds`;

  if (r < 1.0) { st.holed = true; place(st, hole.yards, 0, "green"); out.text = `${from}... it goes in! Holed out!`; return out; }
  if (rEff < GREEN_R) {
    nearPin(st, r, rng, "green");
    out.text = `${from} to ${fmtFt(r)}.`;
    return out;
  }

  // missed the green: hazards first
  const side = rng.chance(0.5) ? -1 : 1, sn = side < 0 ? "left" : "right";
  const short = rng.chance(0.45);
  let wet = false;
  if (has(hole, "water_green")) wet = rng.chance(attack ? 0.85 : 0.7);
  else if (has(hole, "water_front") && short) wet = rng.chance(attack ? 0.55 : 0.35);
  else if (has(hole, `water_${sn}`) && d > 90) wet = rng.chance(attack ? 0.32 : 0.16);
  if (wet) {
    st.strokes += 1; out.penalty = 1;
    const back = has(hole, "water_green") ? 70 : Math.max(25, Math.min(60, r / 3));
    place(st, hole.yards - back, has(hole, "water_green") ? 0 : side * 6, has(hole, "water_green") ? "drop" : "rough");
    out.text = `${from} finds the water${has(hole, "water_green") ? "" : ` ${short ? "short" : sn}`}. Penalty drop, ${Math.round(back)} yds out.`;
    return out;
  }
  const yds = Math.max(4, r / 3);
  let missLie = "rough";
  if (yds <= 30 && has(hole, "greenside_bunker") && rng.chance(attack ? 0.5 : 0.4)) missLie = "gs_bunker";
  else if (rEff < GREEN_R + 10) missLie = "fringe";
  place(st, hole.yards + (short ? -1 : 0.4) * yds * 0.8, side * yds * 0.6, missLie);
  out.text = `${from} misses the green ${short ? "short" : sn}, ${Math.round(distToPin(st))} yds away in ${LIE_NAME[missLie]}.`;
  return out;
}

function shortGame(st, opt, sk, rng) {
  const hole = st.hole, d = distToPin(st), dFt = d * 3;
  const lieMult = { fringe: 0.8, fairway: 0.9, drop: 0.95, rough: 1.15, gs_bunker: 1.35 }[st.lie] ?? 1;
  let m = (3 + 0.12 * dFt) * lieMult * Math.exp(-0.3 * sk.arg) * (1 + 0.4 * (hole.difficulty || 0));
  if (st.lie === "gs_bunker") m += 2;
  const cfg = {
    chip: { k: 1, mis: st.lie === "rough" ? 0.04 : 0.025, name: "Chip" },
    flop: { k: 0.78, mis: 0.09, name: "Flop shot" },
    texas: { k: 1.08, mis: 0, name: "Putt from the fringe" },
    splash: { k: 1, mis: 0.04, name: "Bunker shot" },
    bunker_attack: { k: 0.8, mis: 0.11, name: "Bunker shot" },
  }[opt];
  if (rng.chance(cfg.mis)) {
    if (st.lie === "gs_bunker" && rng.chance(0.6)) {
      return { club: cfg.name, carry: 0, penalty: 0, text: `${cfg.name} catches the lip and stays in the bunker.` };
    }
    if (rng.chance(0.5)) {
      const left = dFt * (0.5 + rng.next() * 0.3);
      nearPin(st, left, rng, left < GREEN_R ? "green" : "rough");
      return { club: cfg.name, carry: Math.round(d * 0.4), penalty: 0, text: `${cfg.name} is chunked and comes up ${fmtFt(left)} short.` };
    }
    const over = 25 + rng.next() * 25;
    nearPin(st, over, rng, over < GREEN_R ? "green" : "fringe");
    return { club: cfg.name, carry: Math.round(d + over / 3), penalty: 0, text: `${cfg.name} comes out hot and races ${fmtFt(over)} past.` };
  }
  const r = rng.rayleigh(m * cfg.k);
  if (r < 1.3) { st.holed = true; place(st, pinS(hole), 0, "green"); return { club: cfg.name, carry: Math.round(d), penalty: 0, text: `${cfg.name} from ${Math.round(d)} yds... in the hole!` }; }
  nearPin(st, r, rng, "green");
  return { club: cfg.name, carry: Math.round(d), penalty: 0, text: `${cfg.name} from ${Math.round(d)} yds to ${fmtFt(r)}.` };
}

// ---------------------------------------------------------------- real layouts (hole.geo)
// Shots fly at an aim point; the ball's lie is the polygon it lands in.
const GEO_SPREAD = 1.08; // approach miss scale vs the tour proximity table (tuned in sim_test.html?real=1)
const FW_HALF = 14;       // yds; lateral miss a tour-average fairway hit stays within

// inverse standard normal CDF (Acklam), for turning a hit rate into a dispersion
function probit(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }
  if (q > 1 - 0.02425) return -probit(1 - q);
  const r = q - 0.5, t = r * r;
  return (((((a[0] * t + a[1]) * t + a[2]) * t + a[3]) * t + a[4]) * t + a[5]) * r / (((((b[0] * t + b[1]) * t + b[2]) * t + b[3]) * t + b[4]) * t + 1);
}

/** Fly from (s, x) toward `aim` for `len` yds with `lat` yds of sideways miss (+ = right of the line). */
function flight(s, x, aim, len, lat) {
  const ds = aim[0] - s, dx = aim[1] - x, L = Math.hypot(ds, dx) || 1;
  const us = ds / L, ux = dx / L;
  return [s + us * len - ux * lat, x + ux * len + us * lat];
}

const GEO_LIE_TEXT = {
  fairway: "finds the fairway", rough: "in the rough", trees: "into the trees", fw_bunker: "into a fairway bunker",
  gs_bunker: "into a greenside bunker", fringe: "on the fringe", green: "on the green",
};

/** Settle the ball at a landing point; water and out-of-bounds cost a stroke and a drop. */
function landGeo(st, from, p, out, label) {
  const geo = st.hole.geo;
  let lie = classify(geo, p[0], p[1]);
  if (lie === "water" || lie === "ob") {
    st.strokes += 1; out.penalty = 1;
    const [ds, dx] = dryBack(geo, from[0], from[1], p[0], p[1]);
    let dropLie = classify(geo, ds, dx);
    if (dropLie === "water" || dropLie === "ob" || dropLie === "green") dropLie = "drop";
    place(st, ds, dx, dropLie === "fairway" ? "drop" : dropLie);
    out.text = `${label} ${lie === "water" ? "splashes into the water" : "goes out of bounds"}. Penalty drop, ${Math.round(distToPin(st))} yds out.`;
    return out;
  }
  place(st, p[0], p[1], lie);
  return null;
}

function teeShotGeo(st, opt, sk, rng) {
  const hole = st.hole, geo = hole.geo;
  const cfg = {
    driver_aggr: { mean: sk.dist + 8, sd: 13, acc: -0.1, label: "Driver", cut: 45 },
    driver: { mean: sk.dist - 3, sd: 10, acc: 0, label: "Driver", cut: 0 },
    wood3: { mean: sk.dist * 0.91, sd: 9, acc: 0.09, label: "3-wood", cut: 0 },
    iron: { mean: sk.dist * 0.76, sd: 8, acc: 0.18, label: clubFor(sk.dist * 0.76, sk.dist), cut: 0 },
  }[opt];
  const pAcc = clamp(cfg.acc + sk.acc + 0.04 * sk.ott - 0.15 * (hole.difficulty || 0), 0.15, 0.95);
  const sdLat = FW_HALF / probit((1 + pAcc) / 2);
  const len = Math.min(cfg.mean + cfg.sd * rng.normal(), pinS(hole) + 15);
  const aim = aimAlong(geo, len + cfg.cut);  // swinging hard aims further down the line: cuts doglegs
  const lat = sdLat * rng.normal();
  const p = flight(0, 0, aim, len, lat);
  const out = { club: cfg.label, carry: Math.round(len), penalty: 0 };
  const label = `${cfg.label}, ${out.carry} yds,`;
  if (landGeo(st, [0, 0], p, out, `${cfg.label}, ${out.carry} yds,`)) return out;
  const sn = lat < 0 ? "left" : "right";
  out.text = st.lie === "green" ? `${label} drives the green!`
    : st.lie === "fairway" ? `${label} splits the fairway.`
    : `${label} ${st.lie === "rough" ? `misses ${sn} into the rough` : `misses ${sn}, ${GEO_LIE_TEXT[st.lie]}`}.`;
  return out;
}

function approachGeo(st, opt, sk, rng) {
  const hole = st.hole, geo = hole.geo, d = distToPin(st), from = [st.s, st.x];
  const pin = [pinS(hole), 0], gc = geo.green_c || pin;

  if (opt === "layup" || opt === "advance" || opt === "punch") {
    const reach = opt === "punch" ? 120 : maxCarry(st.lie, sk);
    const leave = opt === "punch" ? Math.max(40, d - 115) : opt === "advance" ? Math.max(20, d - reach) : Math.max(d > 150 ? 95 : 50, d - reach);
    const target = layupPoint(geo, st.s, st.x, Math.min(leave, d - 25), reach);
    const want = Math.hypot(target[0] - st.s, target[1] - st.x);
    const len = Math.max(10, want + rng.normal() * (opt === "advance" ? 12 : 6));
    const p = flight(st.s, st.x, target, len, rng.normal() * (opt === "advance" ? 11 : opt === "punch" ? 7 : 6));
    const club = opt === "punch" ? "Punch 7-iron" : clubFor(len, sk.dist);
    const out = { club, carry: Math.round(len), penalty: 0 };
    if (landGeo(st, from, p, out, club)) return out;
    out.text = `${club} ${opt === "punch" ? "punches out" : "lays up"} to ${Math.round(distToPin(st))} yds, ${GEO_LIE_TEXT[st.lie] ?? "in " + LIE_NAME[st.lie]}.`;
    return out;
  }
  if (opt === "hero" && rng.chance(0.24)) {
    const len = 25 + Math.abs(rng.normal()) * 25;
    const p = flight(st.s, st.x, pin, len, rng.normal() * 8);
    const out = { club: clubFor(d, sk.dist), carry: Math.round(len), penalty: 0 };
    if (landGeo(st, from, p, out, "Clips a branch and")) return out;
    if (st.lie === "trees") st.lie = "rough";
    out.text = `Clips a branch. The ball drops ${Math.round(len)} yds ahead, ${GEO_LIE_TEXT[st.lie]}.`;
    return out;
  }
  if (st.lie === "fw_bunker" && rng.chance(0.08)) {
    const len = d * 0.3;
    const p = flight(st.s, st.x, pin, len, 0);
    const out = { club: clubFor(d, sk.dist), carry: Math.round(len), penalty: 0 };
    if (landGeo(st, from, p, out, "Catches the lip and")) return out;
    out.text = `Catches the lip of the bunker and goes only ${Math.round(len)} yds.`;
    return out;
  }

  const club = clubFor(d, sk.dist);
  const attack = opt === "attack" || opt === "hero";
  const target = attack ? pin : gc;
  let m = interp(PROX, d) * (LIE_PROX[st.lie] ?? 1) * Math.exp(-0.11 * sk.app) * (1.04 + 0.6 * (hole.difficulty || 0));
  m *= GEO_SPREAD * (attack ? 0.95 : 1);
  const r = rng.rayleigh(m) / 3, a = rng.next() * 2 * Math.PI;
  // misses run long/short more than sideways
  const along = r * Math.cos(a) * 1.25, side = r * Math.sin(a) * 0.8;
  const ds = target[0] - st.s, dx = target[1] - st.x, L = Math.hypot(ds, dx) || 1;
  const us = ds / L, ux = dx / L;
  const p = [target[0] + us * along - ux * side, target[1] + ux * along + us * side];
  const from_ = `${club} from ${Math.round(d)} yds`;
  const out = { club, carry: Math.round(d), penalty: 0 };
  const toPin = Math.hypot(pin[0] - p[0], p[1]);
  if (attack && toPin < 0.3) { st.holed = true; place(st, pin[0], 0, "green"); out.text = `${from_}... it goes in! Holed out!`; return out; }
  if (landGeo(st, from, p, out, from_)) return out;
  if (st.lie === "green") { out.text = `${from_} to ${fmtFt(toPin * 3)}.`; return out; }
  const longShort = (p[0] - pin[0]) * us + (p[1] - pin[1]) * ux;
  const where = Math.abs(longShort) > Math.abs(side) ? (longShort < 0 ? "short" : "long") : (side < 0 ? "left" : "right");
  out.text = `${from_} misses the green ${where}, ${Math.round(distToPin(st))} yds away, ${GEO_LIE_TEXT[st.lie] ?? "in " + LIE_NAME[st.lie]}.`;
  return out;
}

const logit = (p) => Math.log(p / (1 - p));
const unlogit = (z) => 1 / (1 + Math.exp(-z));

/** Probability a putt of `ft` drops for this golfer with this pace. */
export function makeProb(ft, sk, opt = "lag") {
  if (ft < 1.5) return 0.998;
  const base = clamp(interp(MAKE, ft), 0.004, 0.996);
  const z = logit(base) + 0.25 * sk.putt + (opt === "charge" ? 0.35 : -0.08);
  return unlogit(z);
}

function putt(st, opt, sk, rng) {
  const ft = distToPin(st) * 3;
  st.putts += 1;
  const p = makeProb(ft, sk, opt);
  if (rng.chance(p)) {
    st.holed = true; place(st, pinS(st.hole), 0, "green");
    return { club: "Putter", carry: 0, penalty: 0, text: ft < 1.5 ? "Taps in." : `Rolls in the ${Math.round(ft)}-footer!` };
  }
  const leave = Math.max(0.4, rng.rayleigh(opt === "charge" ? 0.075 * ft + 1.4 : 0.03 * ft + 0.8));
  nearPin(st, leave, rng, "green");
  const how = opt === "charge" ? "runs it by" : rng.chance(0.55) ? "leaves it short" : "slides it past";
  return { club: "Putter", carry: 0, penalty: 0, text: `${Math.round(ft)}-ft putt ${how}, ${fmtFt(leave)} left.` };
}

const MAX_OVER_PAR = 5; // pick up at par + 5 so a disaster hole ends

/** Hit one shot. Mutates `st` and returns the shot record (with from/to positions for drawing). */
export function playShot(st, opt, sk, rng) {
  const from = { s: st.s, x: st.x }, ph = phase(st), fromLie = st.lie;
  st.strokes += 1;
  const geo = !!st.hole.geo;
  const rec = ph === "tee" ? (geo ? teeShotGeo : teeShot)(st, opt, sk, rng)
    : ph === "approach" ? (geo ? approachGeo : approach)(st, opt, sk, rng)
    : ph === "short" ? shortGame(st, opt, sk, rng)
    : putt(st, opt, sk, rng);
  Object.assign(rec, { phase: ph, opt, from, to: { s: st.s, x: st.x }, fromLie, lie: st.lie, strokes: st.strokes });
  if (!st.holed && st.strokes >= st.hole.par + MAX_OVER_PAR) {
    st.holed = true; st.pickedUp = true;
    rec.text += ` Picks up for a ${st.strokes}.`;
  }
  st.shots.push(rec);
  return rec;
}

// ---------------------------------------------------------------- auto play (AI and "sim" buttons)
export function autoChoice(st, sk) {
  const hole = st.hole, d = distToPin(st);
  const opts = shotOptions(st, sk).map((o) => o.id);
  const pick = (...ids) => ids.find((id) => opts.includes(id)) ?? opts[0];
  switch (phase(st)) {
    case "tee": {
      const L = hole.yards;
      if (L < 350 && !has(hole, "water_front") && L - sk.dist < 30) return "driver_aggr";
      const tight = ["water_left", "water_right", "ob_left", "ob_right"].some((h) => has(hole, h));
      if (tight && (hole.difficulty || 0) > 0.15 && sk.acc < 0.6) return "wood3";
      return "driver";
    }
    case "approach": {
      if (st.lie === "trees") return d < 150 && sk.app > 0.6 ? "hero" : "punch";
      if (opts.includes("advance")) return "layup";
      if (opts.includes("layup") && (has(hole, "water_front") || has(hole, "water_green")) && d > 215) return "layup";
      if (d <= 150 && (st.lie === "fairway" || st.lie === "tee") && !has(hole, "water_green")) return "attack";
      return "center";
    }
    case "short":
      if (st.lie === "gs_bunker") return "splash";
      return pick("texas", "chip");
    case "putt":
      return pick("tap", d * 3 > 18 ? "lag" : "charge");
    default:
      return null;
  }
}

/** Play a whole hole on autopilot; returns the hole state (strokes, shots). */
export function autoHole(hole, sk, rng, st = newHole(hole)) {
  while (!st.holed) playShot(st, autoChoice(st, sk), sk, rng);
  return st;
}

/** Strokes for each hole of a round on autopilot. */
export function autoRound(course, sk, rng) {
  return course.holes.map((h) => autoHole(h, sk, rng).strokes);
}

export function scoreName(strokes, par) {
  const d = strokes - par;
  if (strokes === 1) return "Hole in one";
  return { [-3]: "Albatross", [-2]: "Eagle", [-1]: "Birdie", 0: "Par", 1: "Bogey", 2: "Double bogey", 3: "Triple bogey" }[d]
    ?? (d < 0 ? "Albatross" : `+${d}`);
}
