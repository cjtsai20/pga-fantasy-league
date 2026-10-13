// Geometry lookups for holes with real layouts (hole.geo, from OpenStreetMap). All coordinates are
// yards in the hole frame: tee at (0, 0), pin at (geo.pin[0], 0), s forward, x to the right.
// Points are [s, x] pairs; polygons are arrays of points.

function bbox(r) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [s, x] of r) { if (s < a) a = s; if (x < b) b = x; if (s > c) c = s; if (x > d) d = x; }
  return [a, b, c, d];
}

function inside(s, x, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [si, xi] = r[i], [sj, xj] = r[j];
    if ((xi > x) !== (xj > x) && s < ((sj - si) * (x - xi)) / (xj - xi + 1e-12) + si) c = !c;
  }
  return c;
}

function segDist(ps, px, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((ps - a[0]) * dx + (px - a[1]) * dy) / L)) : 0;
  return Math.hypot(ps - a[0] - t * dx, px - a[1] - t * dy);
}

function edgeDist(s, x, r) {
  let m = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) m = Math.min(m, segDist(s, x, r[j], r[i]));
  return m;
}

/**
 * A course file (data/courses/{id}.json) stores features once in course-local yards plus each
 * hole's tee, pin, green center and centerline. Cut out one hole's window in the hole frame.
 */
export function buildHoleGeo(courseGeo, h) {
  const [tx, ty] = h.tee, fx0 = h.pin[0] - tx, fy0 = h.pin[1] - ty, L = Math.hypot(fx0, fy0) || 1;
  const fx = fx0 / L, fy = fy0 / L, rx = fy, ry = -fx;  // right of forward on a north-up map
  const to = ([x, y]) => [Math.round(((x - tx) * fx + (y - ty) * fy) * 10) / 10, Math.round(((x - tx) * rx + (y - ty) * ry) * 10) / 10];
  const line = h.line.map(to);
  const s0 = -45, s1 = L + 70, W = Math.max(120, Math.max(...line.map((p) => Math.abs(p[1]))) + 70);
  const inWin = (r) => {
    const [a, b, c, d] = bbox(r);
    return c >= s0 && a <= s1 && d >= -W && b <= W;
  };
  const geo = { pin: [Math.round(L * 10) / 10, 0], green_c: to(h.gc), line };
  const F = courseGeo.features || {};
  for (const k of ["fairway", "green", "tee", "bunker", "water", "trees", "boundary"]) {
    const rs = (F[k] || []).map((r) => r.map(to)).filter((r) => k === "boundary" || inWin(r));
    if (rs.length) geo[k] = rs;
  }
  const rows = (F.tree_row || []).map((r) => r.map(to)).filter(inWin);
  if (rows.length) geo.tree_row = rows;
  const pts = (F.trees_pts || []).map(to).filter(([s, x]) => s >= s0 && s <= s1 && Math.abs(x) <= W);
  if (pts.length) geo.trees_pts = pts.slice(0, 260);
  return geo;
}

/** Attach geometry to every hole of a course that has a course file. */
export function attachCourseGeo(course, courseGeo) {
  for (const h of courseGeo?.holes || []) {
    const hole = course.holes.find((x) => x.n === h.n);
    if (hole) hole.geo = buildHoleGeo(courseGeo, h);
  }
}

/** Per-hole cache of polygons with bounding boxes. */
const cache = new WeakMap();
function index(geo) {
  let ix = cache.get(geo);
  if (ix) return ix;
  const wrap = (rs) => (rs || []).map((r) => ({ r, b: bbox(r) }));
  ix = {
    green: wrap(geo.green), bunker: wrap(geo.bunker), water: wrap(geo.water), fairway: wrap(geo.fairway),
    tee: wrap(geo.tee), trees: wrap(geo.trees), boundary: wrap(geo.boundary),
    treePts: geo.trees_pts || [], rows: geo.tree_row || [],
  };
  cache.set(geo, ix);
  return ix;
}
const hit = (list, s, x, pad = 0) =>
  list.some(({ r, b }) => s >= b[0] - pad && s <= b[2] + pad && x >= b[1] - pad && x <= b[3] + pad && inside(s, x, r));
const near = (list, s, x, d) =>
  list.some(({ r, b }) => s >= b[0] - d && s <= b[2] + d && x >= b[1] - d && x <= b[3] + d && (inside(s, x, r) || edgeDist(s, x, r) <= d));

/**
 * Lie at (s, x): green | gs_bunker | fw_bunker | water | ob | fairway | trees | fringe | rough.
 * "ob" = outside the course boundary (treated as a penalty area by the sim).
 */
export function classify(geo, s, x) {
  const ix = index(geo);
  if (hit(ix.green, s, x)) return "green";
  if (hit(ix.bunker, s, x)) return Math.hypot(geo.pin[0] - s, x) < 45 ? "gs_bunker" : "fw_bunker";
  if (hit(ix.water, s, x)) return "water";
  if (ix.boundary.length && !hit(ix.boundary, s, x)) return "ob";
  if (hit(ix.fairway, s, x) || hit(ix.tee, s, x)) return "fairway";
  if (hit(ix.trees, s, x)) return "trees";
  for (const [ts, tx] of ix.treePts) if (Math.abs(ts - s) < 5 && Math.abs(tx - x) < 5 && Math.hypot(ts - s, tx - x) < 4.5) return "trees";
  for (const row of ix.rows) for (let i = 1; i < row.length; i++) if (segDist(s, x, row[i - 1], row[i]) < 4) return "trees";
  if (near(ix.green, s, x, 3.5)) return "fringe";
  return "rough";
}

/** Point on the hole's centerline `len` yards (arc length) from the tee. */
export function aimAlong(geo, len) {
  const L = geo.line;
  if (!L || L.length < 2) return [len, 0];
  let acc = 0;
  for (let i = 1; i < L.length; i++) {
    const a = L[i - 1], b = L[i], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + seg >= len) {
      const t = (len - acc) / seg;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
    acc += seg;
  }
  const last = L[L.length - 1];
  return [last[0], last[1]];
}

/**
 * Lay-up target: the centerline point that leaves about `leave` yards to the pin and is at most
 * `reach` yards from the ball. Falls back to the farthest reachable centerline point.
 */
export function layupPoint(geo, s, x, leave, reach) {
  const pin = geo.pin, L = geo.line || [[0, 0], pin];
  let best = null;
  for (let i = 1; i < L.length; i++) {
    const a = L[i - 1], b = L[i];
    for (let t = 0; t <= 1; t += 0.05) {
      const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      const toPin = Math.hypot(pin[0] - p[0], p[1]), fromBall = Math.hypot(p[0] - s, p[1] - x);
      if (fromBall > reach || p[0] < s - 5) continue;
      const score = Math.abs(toPin - leave) + (classify(geo, p[0], p[1]) === "fairway" ? 0 : 25);
      if (!best || score < best.score) best = { p, score };
    }
  }
  return best ? best.p : [s + Math.min(reach, Math.max(0, pin[0] - s - leave)), x * 0.5];
}

/** Walk back from (s, x) toward (s0, x0) until the ball is out of the water / back in bounds. */
export function dryBack(geo, s0, x0, s, x) {
  const dx = s0 - s, dy = x0 - x, L = Math.hypot(dx, dy) || 1;
  for (let d = 2; d <= L + 2; d += 2) {
    const ps = s + (dx / L) * d, px = x + (dy / L) * d, lie = classify(geo, ps, px);
    if (lie !== "water" && lie !== "ob") return [ps + (dx / L) * 2, px + (dy / L) * 2];
  }
  return [s0, x0];
}
