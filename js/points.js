// FedEx Cup points by finishing position (data/points_tables.json, rebuilt from 2024-26 results).
// Every pick scores the points its finishing position pays, which also covers golfers who can't keep
// FedEx Cup points (LIV players at majors, amateurs, non-members).

let tables = null;

export async function loadPointsTables(url = "data/points_tables.json") {
  if (!tables) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Could not load ${url}`);
    tables = await r.json();
  }
  return tables;
}
export const setPointsTables = (t) => { tables = t; };

/** Position text -> number: "1" -> 1, "T12" -> 12. CUT / WD / DQ / "-" -> null. */
export function positionNumber(pos) {
  const m = String(pos ?? "").trim().toUpperCase().match(/^T?(\d{1,3})$/);
  return m ? Number(m[1]) : null;
}

export function tableFor(eventType) {
  if (!tables) throw new Error("Points tables not loaded");
  const key = tables._meta.event_types[eventType] || tables._meta.event_types.regular;
  return tables[key];
}

/**
 * Points for one golfer: the positions a tie covers are summed and split evenly
 * (tiedCount golfers sharing `position`). Zurich (event_type 'team') is per player by team position.
 */
export function pointsFor(eventType, position, tiedCount = 1) {
  const p = positionNumber(position);
  if (p == null) return 0;
  const pts = tableFor(eventType).points;
  const n = Math.max(1, tiedCount | 0);
  let sum = 0;
  for (let i = p; i < p + n; i++) sum += pts[i - 1] ?? 0;
  return Math.round((sum / n) * 1000) / 1000;
}

/** True when a position's value was interpolated rather than seen in real results. */
export function isEstimated(eventType, position) {
  const p = positionNumber(position);
  return p != null && (tableFor(eventType).estimated || []).includes(p);
}
