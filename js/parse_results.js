// Turn leaderboard text the commissioner pastes (from a spreadsheet, pgatour.com, ESPN, a group text...)
// into scored rows. No network: names are matched against data/players.json.
//
//   const idx = buildNameIndex(players);              // players.json object
//   const parsed = parseResults(text, idx, { team: event_type === "team", field });
//   scoreRows(parsed.rows, event_type, { usePasted: true });  // fills .points
//
// Each row: { position, pos_num, tied, name, raw, team, is_amateur, points_pasted, matched_player_id,
//             matched_name, confidence, candidates, points_table, points, estimated, mismatch }
import { pointsFor, positionNumber, isEstimated } from "./points.js";

const POS_RE = /^(T?\d{1,3}|CUT|MC|WD|W\/D|DQ|DNS|DNF|MDF|-|–|—)$/i;
const NUM_RE = /^[+-]?\d{1,3}(,\d{3})*(\.\d+)?$/;
const COUNTRY_CODES = new Set(("USA ENG SCO NIR IRL WAL AUS NZL RSA ZIM JPN KOR CHN TPE THA IND PHI MAS SIN CAN MEX " +
  "COL VEN ARG CHI BRA PAR PUR ESP POR FRA ITA GER AUT SUI BEL NED DEN NOR SWE FIN POL CZE SVK FIJ GBR").split(" "));
const NOISE = /^(pos|position|player|players|name|golfer|team|score|to par|par|thru|today|tot|total|r[1-4]|rd|round|earnings|money|fedex.*|pts|points|proj.*|projected cut|cut line|leaderboard|tee times?|f|e)$/i;
const SUFFIX = /\b(jr|sr|ii|iii|iv)\b/g;

// ------------------------------------------------------------------ names
export function normName(s) {
  return String(s ?? "")
    .replace(/[øØ]/g, "o").replace(/[æÆ]/g, "ae").replace(/ß/g, "ss").replace(/[łŁ]/g, "l").replace(/[đĐ]/g, "d")
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[.'’`"]/g, "")       // J.T. -> jt, O'Hair -> ohair
    .replace(/[-_/]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(SUFFIX, " ")
    .replace(/\s+/g, " ").trim();
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Lookup tables over players.json ({id: {name, aliases}}). */
export function buildNameIndex(players) {
  const full = new Map(), alias = new Map(), initialLast = new Map(), last = new Map(), names = {};
  const push = (m, k, id) => { if (!k) return; const a = m.get(k) || []; if (!a.includes(id)) a.push(id); m.set(k, a); };
  for (const [id, p] of Object.entries(players)) {
    names[id] = p.name;
    const n = normName(p.name);
    push(full, n, id);
    for (const a of p.aliases || []) push(alias, normName(a), id);
    const t = n.split(" ");
    if (t.length >= 2) {
      push(alias, [...t.slice(1), t[0]].join(" "), id);       // "li haotong"
      for (let k = 1; k < t.length; k++) {
        push(last, t.slice(k).join(" "), id);                  // "day", "de chassart", "chassart"
        push(initialLast, `${t[0][0]} ${t.slice(k).join(" ")}`, id);
      }
    }
  }
  return { full, alias, initialLast, last, names, keys: [...full.keys()], players };
}

/** Resolve one golfer name. `prefer` = Set of player ids in this week's field (optional). */
export function matchName(name, idx, prefer) {
  const n = normName(name);
  const pick = (ids, conf) => {
    if (!ids?.length) return null;
    let c = ids;
    if (c.length > 1 && prefer?.size) { const inField = c.filter((id) => prefer.has(id)); if (inField.length) c = inField; }
    return { id: c[0], confidence: c.length === 1 ? conf : conf * 0.5, candidates: ids };
  };
  if (!n) return { id: null, confidence: 0, candidates: [] };
  const t = n.split(" ");
  const hit = pick(idx.full.get(n), 1) || pick(idx.alias.get(n), 0.95)
    || (t.length >= 2 && t[0].length <= 2 && pick(idx.initialLast.get(`${t[0][0]} ${t.slice(1).join(" ")}`), 0.75))
    || (t.length >= 2 && pick(idx.initialLast.get(`${t[0][0]} ${t.slice(1).join(" ")}`)?.filter((id) => normName(idx.names[id]).split(" ")[0].startsWith(t[0].slice(0, 3))), 0.7));
  if (hit) return hit;
  if (idx.last.get(n)) return pick(idx.last.get(n), t.length === 1 ? 0.8 : 0.85);   // surname only ("Neergaard-Petersen")
  // misspellings: closest full name within 2 edits (names of 7+ letters only)
  if (n.length >= 7) {
    let best = null, bestD = 3, tie = false;
    for (const k of [...idx.keys, ...idx.alias.keys()]) {
      const d = lev(n, k);
      if (d < bestD) { best = k; bestD = d; tie = false; } else if (d === bestD && best !== k) tie = true;
    }
    if (best && bestD <= 2) {
      const ids = idx.full.get(best) || idx.alias.get(best);
      const r = pick(ids, tie ? 0.4 : 0.6);
      if (r) return r;
    }
  }
  return { id: null, confidence: 0, candidates: [] };
}

// ------------------------------------------------------------------ cells
const splitLine = (line) => {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  if ((line.match(/,/g) || []).length >= 2) return line.split(",").map((c) => c.trim());
  return line.split(/\s{2,}/).map((c) => c.trim());
};

/** Strip markers off a name cell. Returns null when the cell isn't a golfer name. */
function cleanName(cell, countries) {
  let s = String(cell).replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}☀-➿]/gu, " ").trim();
  let amateur = false;
  if (/\((a|am)\)/i.test(s) || /\s\(?a\)?$/.test(s)) { amateur = true; s = s.replace(/\((a|am)\)/ig, " ").replace(/\s\(?a\)?$/, " "); }
  s = s.replace(/\(([A-Z]{3})\)/g, " ").replace(/[*#†]+/g, " ").replace(/\s+/g, " ").trim();
  let words = s.split(" ");
  while (words.length > 1 && COUNTRY_CODES.has(words[0])) words.shift();
  while (words.length > 1 && COUNTRY_CODES.has(words[words.length - 1])) words.pop();
  s = words.join(" ");
  if (!/\p{L}.*\p{L}/u.test(s) || /\d/.test(s) || NOISE.test(s) || countries.has(s.toLowerCase())) return null;
  const team = /\s*(\/|&|\+)\s*/.test(s) ? s.split(/\s*(?:\/|&|\+)\s*/).filter(Boolean) : null;
  if (!team && (!/[\s,]/.test(s) || POS_RE.test(s))) return null;   // a golfer has first + last name
  if (!team && s.includes(",")) { const [a, b] = s.split(",").map((x) => x.trim()); if (a && b) s = `${b} ${a}`; }
  return { name: s, amateur, team };
}

/** "T2 Jason Day -21 66 67 183.750" (single-space row) -> ["T2", "Jason Day", "-21", "66", "67", "183.750"] */
function explode(cell) {
  const m = cell.match(/^(T?\d{1,3}|CUT|MC|WD|DQ|MDF)\s+(\S.*)$/i);
  if (!m) return [cell];
  const out = [m[1].toUpperCase()];
  let name = [];
  for (const w of m[2].split(" ")) {
    const nameish = /^[\p{L}][\p{L}.'’\-\/&]*$/u.test(w) && !(w.length === 1 && /[EF]/.test(w)) || /^\((a|am)\)$/i.test(w) || w === "/" || w === "&";
    if (nameish && out.length === 1) name.push(w);
    else { if (name.length) { out.push(name.join(" ")); name = []; } out.push(w); }
  }
  if (name.length) out.push(name.join(" "));
  return out;
}

const parsePts = (c) => {
  if (c == null) return null;
  const s = String(c).trim();
  if (!NUM_RE.test(s) || s.startsWith("+") || s.startsWith("-")) return null;
  return Number(s.replace(/,/g, ""));
};

// ------------------------------------------------------------------ main
export function parseResults(text, idx, opts = {}) {
  const countries = new Set(Object.values(idx.players || {}).map((p) => (p.country || "").toLowerCase()).filter(Boolean));
  ["united states", "united states of america", "england", "scotland", "korea", "south africa"].forEach((c) => countries.add(c));
  const prefer = opts.field ? new Set(opts.field.map((f) => f.player_id)) : null;
  const lines = String(text || "").replace(/\r/g, "").replace(/ /g, " ").split("\n").map((l) => l.trim()).filter(Boolean);
  const warnings = [];

  // header row (tab/CSV/multi-space): remember where the points column sits, counted from the right
  let header = null, start = 0;
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const cells = splitLine(lines[i]);
    const low = cells.map((c) => c.toLowerCase());
    if (cells.length >= 2 && low.some((c) => /^(pos|position|place|fin|rank)$/.test(c)) && low.some((c) => /player|golfer|name|team/.test(c))) {
      let p = -1;
      low.forEach((c, j) => { if (/fedex|pts|points/.test(c) && !/rank/.test(c)) p = j; });
      header = { cells, fromRight: p >= 0 ? cells.length - p : null };
      start = i + 1;
      break;
    }
  }

  // flatten into a token stream; a row starts at a position token followed by a golfer name
  const toks = [];
  for (const line of lines.slice(start)) {
    const cells = splitLine(line).filter((c, j, arr) => c !== "" || (header && arr.length > 1));
    const lineToks = [];
    for (const c of cells) for (const x of explode(c)) lineToks.push(x);
    toks.push({ line: lineToks, raw: line });
  }
  const stream = [];
  toks.forEach((t, li) => t.line.forEach((c, ci) => stream.push({ c, li, ci, n: t.line.length })));

  const rows = [];
  for (let i = 0; i < stream.length; i++) {
    const pos = stream[i].c.trim();
    if (!POS_RE.test(pos)) continue;
    let j = i + 1;
    while (j < stream.length && stream[j].c === "") j++;           // blank flag cells
    const nm = j < stream.length ? cleanName(stream[j].c, countries) : null;
    if (!nm) continue;
    // rest of the row: until the next position+name pair
    let k = j + 1;
    const rest = [];
    for (; k < stream.length; k++) {
      const c = stream[k].c.trim();
      if (POS_RE.test(c)) {
        let m = k + 1; while (m < stream.length && stream[m].c === "") m++;
        if (m < stream.length && cleanName(stream[m].c, countries)) break;
      }
      rest.push(stream[k]);
    }
    let pasted = null;
    if (header?.fromRight && stream[j].ci != null) {
      const line = toks[stream[j].li].line;
      const sameLine = stream[i].li === stream[j].li;
      if (sameLine) pasted = parsePts(line[line.length - header.fromRight]);
    }
    if (pasted == null) {  // no header: the last decimal number in the row ("183.750"), never money
      const dec = rest.map((r) => r.c.trim()).filter((c) => /^\d{1,3}(,\d{3})*\.\d{1,3}$/.test(c));
      if (dec.length) pasted = parsePts(dec[dec.length - 1]);
    }
    rows.push({ position: pos.toUpperCase().replace("W/D", "WD").replace(/[–—]/, "-"), name: nm.name, team: nm.team,
      is_amateur: nm.amateur, points_pasted: pasted, raw: toks[stream[i].li].raw });
    i = k - 1;
  }
  if (!rows.length) warnings.push("No rows found. Each golfer needs a finishing position (1, T2, CUT...) next to the name.");

  // ties: rows (teams count once) sharing a numeric position
  const counts = {};
  rows.forEach((r) => { r.pos_num = positionNumber(r.position); if (r.pos_num != null) counts[r.pos_num] = (counts[r.pos_num] || 0) + 1; });
  rows.forEach((r) => { r.tied = r.pos_num != null ? counts[r.pos_num] : 1; });

  // match names; team rows become one row per partner
  const out = [];
  for (const r of rows) {
    if (r.team && (opts.team || r.team.length === 2)) {
      const label = r.team.join(" / ");
      const parts = r.team.map((p) => matchName(p, idx, prefer));
      // brothers / shared surname ("Fitzpatrick/Fitzpatrick"): give each partner a different golfer
      if (parts.length === 2 && parts[0].id && parts[0].id === parts[1].id) {
        const other = parts[1].candidates.find((id) => id !== parts[0].id);
        if (other) parts[1] = { ...parts[1], id: other };
        else parts[1] = { ...parts[1], confidence: 0.3 };
      }
      r.team.forEach((p, n) => out.push({ ...r, name: p, team: label, matched_player_id: parts[n].id,
        matched_name: parts[n].id ? idx.names[parts[n].id] : null, confidence: parts[n].confidence, candidates: parts[n].candidates }));
      if (!opts.team) warnings.push(`"${label}" looks like a team; split it into two golfers.`);
    } else {
      const m = matchName(r.name, idx, prefer);
      out.push({ ...r, team: null, matched_player_id: m.id, matched_name: m.id ? idx.names[m.id] : null,
        confidence: m.confidence, candidates: m.candidates });
    }
  }
  const unmatched = out.filter((r) => !r.matched_player_id).length;
  if (unmatched) warnings.push(`${unmatched} name${unmatched > 1 ? "s" : ""} didn't match a known golfer; pick them from the list or keep them as new golfers.`);
  return { rows: out, warnings, header: !!header };
}

/** Fill points. Pasted points win when > 0 (and usePasted), else the position's table value. */
export function scoreRows(rows, eventType, { usePasted = true } = {}) {
  for (const r of rows) {
    r.points_table = pointsFor(eventType, r.position, r.tied);
    r.estimated = isEstimated(eventType, r.position);
    const pasted = usePasted && r.points_pasted > 0 ? r.points_pasted : null;
    r.points = pasted ?? r.points_table;
    r.mismatch = r.points_pasted > 0 && Math.abs(r.points_pasted - r.points_table) > Math.max(0.05, r.points_table * 0.01);
  }
  return rows;
}

/** Field list: one golfer per line (or cell), "(a)" marks amateurs. Ignores rank/OWGR numbers. */
export function parseField(text, idx) {
  const countries = new Set(Object.values(idx.players || {}).map((p) => (p.country || "").toLowerCase()).filter(Boolean));
  const seen = new Set(), out = [];
  for (const line of String(text || "").replace(/\r/g, "").split("\n")) {
    for (const cell of splitLine(line.trim())) {
      const nm = cleanName(cell.replace(/^T?\d{1,3}\.?\s+/, ""), countries);
      if (!nm || nm.team) continue;
      const m = matchName(nm.name, idx);
      const key = m.id || normName(nm.name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: nm.name, is_amateur: nm.amateur, matched_player_id: m.id,
        matched_name: m.id ? idx.names[m.id] : null, confidence: m.confidence, candidates: m.candidates });
      break;  // first golfer name on the line
    }
  }
  return out;
}

/** Stable id for a golfer who isn't in players.json yet (a rookie or amateur). */
export const newGolferId = (name) => "x-" + normName(name).replace(/ /g, "-");
