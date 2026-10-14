// Parse pasted golfer stats (a pgatour.com stat page, a spreadsheet, anything tabular) into
// { name, id, confidence, candidates, stats } rows for Admin -> Golfer Stats. Names match the same
// way results do (parse_results.js). Two modes:
//   * one stat: the paste is a single stat page; the first number after each name is the value
//   * auto: a header row names the columns ("Player  SG: OTT  SG: APP  Driving Distance ...")
import { matchName } from "./parse_results.js";

// key -> label, header pattern, valid range (rates are stored as 0-1 fractions)
export const STAT_FIELDS = [
  ["sg_total", "SG: Total", /total|^sg$/, [-4, 4]],
  ["sg_ott", "SG: Off-the-Tee", /off.?the.?tee|\bott\b/, [-3, 3]],
  ["sg_app", "SG: Approach", /approach|\bapp\b/, [-3, 3]],
  ["sg_arg", "SG: Around-the-Green", /around|\barg\b/, [-3, 3]],
  ["sg_putt", "SG: Putting", /sg.?:? ?putt|strokes gained.?:? ?putt|^putt(ing)?$/, [-3, 3]],
  ["drive_dist", "Driving Distance (yds)", /dist/, [230, 370]],
  ["drive_acc", "Driving Accuracy %", /accura|fairway/, [0.2, 0.95]],
  ["gir", "Greens in Regulation %", /\bgir\b|greens/, [0.3, 0.95]],
  ["scrambling", "Scrambling %", /scrambl/, [0.2, 0.95]],
  ["putts_per_round", "Putts per Round", /putts per round|putting average|putts\/round/, [24, 34]],
];
const RATE = new Set(["drive_acc", "gir", "scrambling"]);
const byKey = Object.fromEntries(STAT_FIELDS.map((f) => [f[0], f]));

const splitLine = (line) => (line.includes("\t") ? line.split("\t") : line.split(/\s{2,}/)).map((c) => c.trim());
const isNum = (c) => /^[+-]?\d+(\.\d+)?%?$/.test(c.replace(/,/g, ""));
const isRank = (c) => /^(T?\d+|-|–|—|[▲▼↑↓]?\s*\d*)$/i.test(c);

function headerKey(cell) {
  const h = cell.toLowerCase();
  if (/putts per round|putting average|putts\/round/.test(h)) return "putts_per_round";
  for (const [k, , re] of STAT_FIELDS) if (k !== "putts_per_round" && re.test(h)) return k;
  return null;
}

/** Value as stored: rates to 0-1, null when out of range for the stat. */
export function cleanValue(key, raw) {
  let v = Number(String(raw).replace(/[,%+]/g, ""));
  if (!Number.isFinite(v)) return null;
  if (RATE.has(key) && v > 1) v /= 100;
  const [lo, hi] = byKey[key][3];
  return v >= lo && v <= hi ? Math.round(v * 10000) / 10000 : null;
}

const looksLikeName = (c) => /[a-z]{2,}/i.test(c) && !isNum(c) && !headerKey(c) && !/^(player|name|golfer|rank|movement|avg|total|rounds|measured)/i.test(c);

/**
 * @param text  pasted text
 * @param idx   buildNameIndex(players)
 * @param mode  "auto" or a stat key (single-stat page)
 */
export function parseStats(text, idx, mode = "auto") {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/ /g, " ").trimEnd()).filter((l) => l.trim());
  // header (auto mode): the first line naming 1+ stat columns, or a run of stacked header lines
  let headers = [];
  if (mode === "auto") {
    for (let i = 0; i < Math.min(lines.length, 40); i++) {
      const cells = splitLine(lines[i]);
      if (cells.length > 1 && cells.some(headerKey)) {
        const pcol = cells.findIndex((c) => /player|name|golfer/i.test(c));
        headers = cells.slice(pcol + 1).map(headerKey);
        break;
      }
      if (cells.length === 1 && headerKey(cells[0])) headers.push(headerKey(cells[0]));  // stacked header
      else if (headers.length && cells.length === 1 && /^(avg|total|rounds|measured|events)/i.test(cells[0])) headers.push(null);
    }
    if (!headers.some(Boolean)) return { rows: [], error: "No stat columns found in a header row. Pick the stat you pasted from the list instead." };
  }

  // rows: a line with a name cell and numbers after it, or a stacked name line followed by numbers
  const rows = [];
  let cur = null;
  const flush = () => { if (cur) rows.push(cur); cur = null; };
  for (const line of lines) {
    const cells = splitLine(line).filter((c, i, a) => c || a.length > 1);
    const ni = cells.findIndex(looksLikeName);
    if (ni >= 0 && cells.slice(0, ni).every((c) => !c || isRank(c) || /^[A-Z]{3}$/.test(c))) {
      const m = matchName(cells[ni], idx);
      if (m.id || cells.length > 1) {  // a known golfer, or a full table row with an unknown name
        flush();
        cur = { name: cells[ni], ...m, nums: [] };
        cells.slice(ni + 1).forEach((c) => cur.nums.push(isNum(c) ? c : null));
        if (cells.length > 1) flush();
        continue;
      }
    }
    if (cur && cells.length === 1 && isNum(cells[0])) cur.nums.push(cells[0]);
  }
  flush();

  for (const r of rows) {
    r.stats = {};
    if (mode === "auto") {
      const vals = r.nums.length === headers.length ? r.nums : r.nums.filter((v) => v != null);  // positional for tables
      headers.forEach((k, i) => { if (k && vals[i] != null) { const v = cleanValue(k, vals[i]); if (v != null) r.stats[k] = v; } });
    } else {
      const first = r.nums.find((v) => v != null);
      const v = first == null ? null : cleanValue(mode, first);
      if (v != null) r.stats[mode] = v;
    }
    delete r.nums;
  }
  return { rows: rows.filter((r) => Object.keys(r.stats).length), skipped: rows.filter((r) => !Object.keys(r.stats).length).length };
}
