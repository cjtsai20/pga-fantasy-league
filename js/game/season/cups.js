// The Ryder Cup (odd years, USA v Europe) and Presidents Cup (even years, USA v International)
// for Race to the FedEx Cup. Teams, AI captains' lineups, session sims, the user's own matches and
// the score. No DOM; state is plain JSON for the saved career. Matches use match.js.
//
// Ryder Cup: Friday and Saturday each have a foursomes and a four-ball session of 4 matches (the
// host captain sets the order, normally the same both days), then 12 singles on Sunday. 28 points,
// 14½ wins, and the holder keeps the Cup on a 14-14 tie.
// Presidents Cup: Thursday 5 four-balls, Friday 5 foursomes, Saturday 4 four-balls and 4 foursomes,
// Sunday 12 singles. 30 points, 15½ wins; a tie is a tie.

import { simMatch, summarize } from "./match.js";

const EUROPE = new Set(["ENG", "SCO", "WAL", "NIR", "IRL", "ESP", "SWE", "NOR", "DEN", "FIN", "GER", "AUT", "BEL", "FRA", "ITA",
  "NED", "SUI", "POL", "CZE", "POR", "ISL", "SVK", "SLO", "HUN", "GRE", "CRO", "LUX"]);
const USA = new Set(["USA"]);
const NAME_TO_CODE = {
  "united states": "USA", "united states of america": "USA", "us": "USA", "usa": "USA", "america": "USA",
  england: "ENG", scotland: "SCO", wales: "WAL", "northern ireland": "NIR", ireland: "IRL", "republic of ireland": "IRL",
  spain: "ESP", sweden: "SWE", norway: "NOR", denmark: "DEN", finland: "FIN", germany: "GER", austria: "AUT",
  belgium: "BEL", france: "FRA", italy: "ITA", netherlands: "NED", "the netherlands": "NED", holland: "NED",
  switzerland: "SUI", poland: "POL", czechia: "CZE", "czech republic": "CZE", portugal: "POR", iceland: "ISL",
  slovakia: "SVK", slovenia: "SLO", hungary: "HUN", greece: "GRE", croatia: "CRO", luxembourg: "LUX",
};

/** Country string ("England", "ENG", "United States", "Korea"...) to a 3-letter code, or the cleaned name. */
export function countryCode(country) {
  const c = String(country || "").trim();
  if (!c) return "";
  if (/^[A-Z]{3}$/.test(c)) return c;
  return NAME_TO_CODE[c.toLowerCase()] || c;
}

export const cupKind = (year) => (year % 2 ? "ryder" : "presidents");

/** Team side for a golfer's country: "USA", "EUR" (Ryder) or "INT" (Presidents), or null (not eligible). */
export function sideOf(country, kind) {
  const code = countryCode(country);
  if (!code || /neutral/i.test(code)) return null;
  if (USA.has(code)) return "USA";
  if (kind === "ryder") return EUROPE.has(code) ? "EUR" : null;
  return EUROPE.has(code) ? null : "INT";
}

export const CUPS = {
  ryder: {
    name: "Ryder Cup", other: "EUR", teams: { USA: "United States", EUR: "Europe" }, total: 28, toWin: 14.5,
    days: [["Friday", "pairs"], ["Saturday", "pairs"], ["Sunday", [["singles", 12]]]],
  },
  presidents: {
    name: "Presidents Cup", other: "INT", teams: { USA: "United States", INT: "International" }, total: 30, toWin: 15.5,
    days: [["Thursday", [["fourball", 5]]], ["Friday", [["foursomes", 5]]], ["Saturday", [["fourball", 4], ["foursomes", 4]]], ["Sunday", [["singles", 12]]]],
  },
};
const FORMAT_NAME = { foursomes: "Foursomes", fourball: "Four-balls", singles: "Singles" };

function sessionDefs(kind, rng) {
  const def = CUPS[kind];
  // Ryder: the host captain's order for each day's two pair sessions, kept for both days
  const pairOrder = rng.next() < 0.6 ? [["foursomes", 4], ["fourball", 4]] : [["fourball", 4], ["foursomes", 4]];
  const out = [];
  for (const [day, list] of def.days) {
    for (const [format, n] of list === "pairs" ? pairOrder : list) {
      out.push({ day, format, n, name: `${day} ${FORMAT_NAME[format]}`, matches: null });
    }
  }
  return out;
}

const shuffle = (arr, rng) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// ---------------------------------------------------------------- create
/**
 * @param year      cup year (odd = Ryder, even = Presidents)
 * @param field     [{id, name, country, sk, sg}] the season field
 * @param extra     same shape: wider pool to fill a short side (best by SG first)
 * @param standings [{id, points}] season FedEx points
 * @param holder    side holding the Cup ("USA" | "EUR" | "INT"); Ryder ties go to the holder
 * @param rng       makeRng(...) from sim.js
 */
export function create({ year, field, extra = [], standings = [], holder = null, rng }) {
  const kind = cupKind(year), def = CUPS[kind];
  const points = new Map(standings.map((r) => [r.id, r.points ?? 0]));
  const golfers = {}, teams = {}, notes = [];
  const keep = (g) => { golfers[g.id] = { id: g.id, name: g.name, country: g.country || "", sk: g.sk, sg: g.sg ?? 0 }; return g.id; };
  for (const side of ["USA", def.other]) {
    const team = field.filter((g) => sideOf(g.country, kind) === side)
      .sort((x, y) => (points.get(y.id) ?? 0) - (points.get(x.id) ?? 0) || (y.sg ?? 0) - (x.sg ?? 0))
      .slice(0, 12).map(keep);
    if (team.length < 12) {
      const have = new Set(team);
      const fill = [...field, ...extra].filter((g) => !have.has(g.id) && sideOf(g.country, kind) === side)
        .filter((g, i, a) => a.findIndex((h) => h.id === g.id) === i)
        .sort((x, y) => (y.sg ?? 0) - (x.sg ?? 0)).slice(0, 12 - team.length);
      if (fill.length) notes.push(`${def.teams[side]}: ${fill.length} golfer${fill.length > 1 ? "s" : ""} added from outside the season field to make 12.`);
      team.push(...fill.map(keep));
    }
    if (team.length < 12) notes.push(`${def.teams[side]} could only field ${team.length} golfers.`);
    teams[side] = team;
  }
  return {
    year, kind, name: def.name, sides: ["USA", def.other], teamNames: def.teams, holder: holder || null,
    golfers, teams, notes, sessions: sessionDefs(kind, rng), current: 0, played: {},
  };
}

export const sessions = (state) => state.sessions;

// ---------------------------------------------------------------- captains
const rating = (state, id) => state.golfers[id]?.sg ?? 0;

/** One captain's lineup for a session: arrays of ids per match, in match order. */
function lineup(state, side, ses, rng) {
  const team = state.teams[side];
  if (ses.format === "singles") {
    // strong and weak mixed: the top half and bottom half alternate, each half in a seeded order
    const byRating = [...team].sort((a, b) => rating(state, b) - rating(state, a));
    const top = shuffle(byRating.slice(0, 6), rng), bottom = shuffle(byRating.slice(6), rng);
    const out = [];
    for (let i = 0; i < Math.max(top.length, bottom.length); i++) {
      if (rng.next() < 0.5) { if (top[i]) out.push([top[i]]); if (bottom[i]) out.push([bottom[i]]); }
      else { if (bottom[i]) out.push([bottom[i]]); if (top[i]) out.push([top[i]]); }
    }
    return out.slice(0, ses.n);
  }
  // pairs: the best few play every session; the rest rotate by matches played, with some variety
  const need = ses.n * 2;
  const order = [...team].sort((a, b) => rating(state, b) - rating(state, a));
  const rank = new Map(order.map((id, i) => [id, i]));
  const keen = (id) => (rank.get(id) < 3 ? 100 : 0) - (state.played[id] || 0) * 1.5 - rank.get(id) * 0.25 + rng.next() * 1.2;
  const picked = [...team].sort((a, b) => keen(b) - keen(a)).slice(0, need)
    .sort((a, b) => rating(state, b) - rating(state, a));
  // pair neighbors in rating (with a seeded swap now and then), then send the pairs out in a seeded order
  for (let i = 0; i + 3 < picked.length; i += 2) if (rng.next() < 0.3) [picked[i + 1], picked[i + 2]] = [picked[i + 2], picked[i + 1]];
  const pairs = [];
  for (let i = 0; i + 1 < picked.length; i += 2) pairs.push([picked[i], picked[i + 1]]);
  return shuffle(pairs, rng);
}

function setLineups(state, rng) {
  const ses = state.sessions[state.current];
  if (ses.matches) return ses;
  const [A, B] = state.sides;
  const la = lineup(state, A, ses, rng), lb = lineup(state, B, ses, rng);
  const n = Math.min(la.length, lb.length, ses.n);
  ses.matches = Array.from({ length: n }, (_, i) => ({ format: ses.format, a: la[i], b: lb[i], res: null }));
  for (const m of ses.matches) for (const id of [...m.a, ...m.b]) state.played[id] = (state.played[id] || 0) + 1;
  return ses;
}

const sideGolfers = (state, ids) => ids.map((id) => state.golfers[id]);

// ---------------------------------------------------------------- play
/**
 * Sim the current session (setting lineups first if needed). A match with userId is left for the
 * user (see userMatch / recordUserMatch). Moves to the next session once every match has a result.
 */
export function simSession(state, course, deps, rng, { userId = null } = {}) {
  if (state.current >= state.sessions.length) return state;
  const ses = setLineups(state, rng);
  for (const m of ses.matches) {
    if (m.res || (userId && [...m.a, ...m.b].includes(userId))) continue;
    const st = simMatch({ format: m.format, a: sideGolfers(state, m.a), b: sideGolfers(state, m.b), course, rng, deps, extra: false });
    m.res = summarize(st);
  }
  advance(state);
  return state;
}

/** Set the current session's lineups without playing (so the UI can show who plays whom first). */
export function prepareSession(state, rng) {
  if (state.current < state.sessions.length) setLineups(state, rng);
  return state;
}

function advance(state) {
  while (state.current < state.sessions.length && state.sessions[state.current].matches?.every((m) => m.res)) state.current++;
}

/** The user's unplayed match in the current session, or null. a/b are golfer objects. */
export function userMatch(state, userId) {
  const ses = state.sessions[state.current];
  if (!ses?.matches) return null;
  const matchIdx = ses.matches.findIndex((m) => !m.res && [...m.a, ...m.b].includes(userId));
  if (matchIdx < 0) return null;
  const m = ses.matches[matchIdx];
  return { sessionIdx: state.current, matchIdx, format: m.format, a: sideGolfers(state, m.a), b: sideGolfers(state, m.b),
    userSide: m.a.includes(userId) ? "a" : "b", session: ses.name };
}

/** Store the user's finished match (a match.js state); `which` defaults to the user's current match. */
export function recordUserMatch(state, matchState, which = null) {
  const ses = state.sessions[which?.sessionIdx ?? state.current];
  const idx = which?.matchIdx ?? ses.matches.findIndex((m) => !m.res && m.format === matchState.format
    && m.a.every((id) => matchState.a.some((g) => g.id === id)) && m.b.every((id) => matchState.b.some((g) => g.id === id)));
  if (idx < 0) throw new Error("No pending match matches that result.");
  ses.matches[idx].res = summarize(matchState, true);
  advance(state);
  return state;
}

/** A golfer's record in this cup so far: {w, l, h, played}. */
export function recordFor(state, id) {
  const r = { w: 0, l: 0, h: 0, played: 0 };
  for (const ses of state.sessions) for (const m of ses.matches || []) {
    if (!m.res) continue;
    const side = m.a.includes(id) ? "a" : m.b.includes(id) ? "b" : null;
    if (!side) continue;
    r.played++;
    if (m.res.winner === side) r.w++; else if (m.res.winner) r.l++; else r.h++;
  }
  return r;
}

/** Is the user on a team at all? Returns his side or null. */
export const userSide = (state, userId) => state.sides.find((s) => state.teams[s].includes(userId)) || null;

// ---------------------------------------------------------------- score
/** {usa, other, toWin, total, decided, winner, retained, done, played, text}. */
export function score(state) {
  const def = CUPS[state.kind];
  let usa = 0, other = 0, played = 0;
  for (const ses of state.sessions) for (const m of ses.matches || []) {
    if (!m.res) continue;
    played++;
    if (m.res.winner === "a") usa += 1; else if (m.res.winner === "b") other += 1; else { usa += 0.5; other += 0.5; }
  }
  const done = played === state.sessions.reduce((n, s) => n + s.n, 0) && state.sessions.every((s) => s.matches?.every((m) => m.res));
  const O = def.other, names = def.teams;
  let winner = null, retained = false, decided = false, text = "";
  if (usa >= def.toWin) { winner = "USA"; decided = true; text = `${names.USA} win ${usa}–${other}`; }
  else if (other >= def.toWin) { winner = O; decided = true; text = `${names[O]} win ${other}–${usa}`; }
  else if (state.kind === "ryder" && state.holder && (state.holder === "USA" ? usa : other) >= def.total / 2) {
    // the holder has 14: the Cup can't be lost any more; it's retained (or won outright later)
    retained = true; decided = true; winner = state.holder;
    text = done ? `Tied ${usa}–${other}: ${names[state.holder]} retain the Cup` : `${names[state.holder]} have retained the Cup`;
  } else if (done && usa === other) {
    decided = true; text = `Tied ${usa}–${other}: the Cup is shared`;
  }
  return { usa, other, toWin: def.toWin, total: def.total, decided, winner, retained, done, played, text };
}
