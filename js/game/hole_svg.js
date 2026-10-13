// SVG hole diagrams for the Play tab. Geometry is in yards along the hole (s) and across it (x),
// matching sim.js; drawHole() maps that onto the SVG and returns a toXY() for placing the ball.

import { geoHoleMarkup, GEO_STYLE } from "./geo_svg.js";

const NS = "http://www.w3.org/2000/svg";
const W = 360, H = 600, PAD = 18;
const BEND = 26 * Math.PI / 180;

/** Centerline: tee at (0,0) heading up the page; doglegs turn at ~60% of the hole. */
function centerline(hole) {
  const L = hole.yards;
  const turn = hole.shape === "dogleg_left" ? -BEND : hole.shape === "dogleg_right" ? BEND : 0;
  const b = turn ? L * (hole.par === 5 ? 0.62 : 0.6) : L;
  return (s) => {
    if (s <= b) return { x: 0, y: -s, phi: 0 };
    const t = s - b;
    return { x: Math.sin(turn) * t, y: -b - Math.cos(turn) * t, phi: turn };
  };
}

function makeMapper(hole) {
  const line = centerline(hole);
  const raw = (s, x) => {
    const c = line(s);
    return { x: c.x + Math.cos(c.phi) * x, y: c.y + Math.sin(c.phi) * x };
  };
  // fit the hole (plus a margin for hazards) into the viewBox
  const pts = [];
  for (let s = -10; s <= hole.yards + 25; s += 10) for (const x of [-58, 58]) pts.push(raw(s, x));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = Math.min((W - 2 * PAD) / (maxX - minX), (H - 2 * PAD - 26) / (maxY - minY));
  const ox = (W - (maxX - minX) * k) / 2 - minX * k, oy = PAD + 26 + (H - 2 * PAD - 26 - (maxY - minY) * k) / 2 - minY * k;
  const toXY = (s, x) => { const p = raw(s, x); return [ox + p.x * k, oy + p.y * k]; };
  return { toXY, k };
}

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [a, v] of Object.entries(attrs)) n.setAttribute(a, v);
  if (parent) parent.appendChild(n);
  return n;
};
const pathAlong = (toXY, s0, s1, x, step = 8) => {
  const p = [];
  for (let s = s0; s <= s1; s += step) p.push(toXY(s, x));
  p.push(toXY(s1, x));
  return p;
};
const d = (pts) => "M" + pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join("L");

/** Draw `hole` into `svg` (cleared first). Returns {toXY, k, layer} where layer holds ball marks. */
export function drawHole(svg, hole) {
  svg.innerHTML = "";
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  if (hole.geo) return drawGeoHole(svg, hole);
  const { toXY, k } = makeMapper(hole);
  const L = hole.yards, hz = new Set(hole.hazards || []);
  const yd = (v) => v * k;

  const defs = el("defs", {}, svg);
  const stripes = el("pattern", { id: `gm-stripe-${hole.n}`, width: 14, height: 14, patternUnits: "userSpaceOnUse", patternTransform: "rotate(35)" }, defs);
  el("rect", { width: 14, height: 14, fill: "#86bf6a" }, stripes);
  el("rect", { width: 7, height: 14, fill: "#7db560" }, stripes);

  el("rect", { x: 0, y: 0, width: W, height: H, fill: "#5d8c4a", class: "gm-rough" }, svg);

  // trees and out-of-bounds along the sides
  for (const side of [-1, 1]) {
    const sn = side < 0 ? "left" : "right";
    if (hz.has(`trees_${sn}`)) {
      for (let s = 40; s < L - 10; s += 22) {
        const off = side * (34 + ((s * 7) % 11));
        const [cx, cy] = toXY(s, off);
        el("circle", { cx, cy, r: Math.max(5, yd(9)), fill: "#2c5634" }, svg);
        el("circle", { cx: cx - 1.5, cy: cy - 1.5, r: Math.max(3, yd(5)), fill: "#3a6e43" }, svg);
      }
    }
    if (hz.has(`ob_${sn}`)) {
      for (let s = 20; s < L; s += 24) {
        const [cx, cy] = toXY(s, side * 50);
        el("rect", { x: cx - 1.5, y: cy - 5, width: 3, height: 10, fill: "#fff", stroke: "#999", "stroke-width": 0.5 }, svg);
      }
    }
    if (hz.has(`water_${sn}`)) {
      const inner = pathAlong(toXY, L * 0.3, L + 15, side * 27), outer = pathAlong(toXY, L * 0.3, L + 15, side * 62).reverse();
      el("path", { d: d(inner.concat(outer)) + "Z", fill: "#3f7fb5", class: "gm-water" }, svg);
    }
  }

  // fairway (par 3s get a short apron)
  const fwStart = hole.par === 3 ? Math.max(0, L - 45) : Math.min(160, L * 0.4);
  const fw = d(pathAlong(toXY, fwStart, L - 8, 0));
  el("path", { d: fw, stroke: "#4f7e3e", "stroke-width": yd(36), "stroke-linecap": "round", fill: "none" }, svg);
  el("path", { d: fw, stroke: `url(#gm-stripe-${hole.n})`, "stroke-width": yd(32), "stroke-linecap": "round", fill: "none" }, svg);

  // fairway bunkers at driving distance
  const fbS = Math.min(Math.max(255, L * 0.55), L - 110);
  for (const side of [-1, 1]) {
    if (hz.has(`fairway_bunker_${side < 0 ? "left" : "right"}`)) {
      const [cx, cy] = toXY(fbS, side * 19);
      el("ellipse", { cx, cy, rx: yd(9), ry: yd(16), fill: "#e8d6a2", stroke: "#cdb87e", "stroke-width": 1 }, svg);
    }
  }

  // water around / in front of the green
  const [gx, gy] = toXY(L, 0);
  if (hz.has("water_green")) el("circle", { cx: gx, cy: gy, r: yd(34), fill: "#3f7fb5", class: "gm-water" }, svg);
  if (hz.has("water_front")) {
    const [wx, wy] = toXY(L - 34, 0);
    el("ellipse", { cx: wx, cy: wy, rx: yd(30), ry: yd(11), fill: "#3f7fb5", class: "gm-water" }, svg);
  }

  // green, fringe, greenside bunkers, flag
  el("circle", { cx: gx, cy: gy, r: Math.max(9, yd(15)), fill: "#78b25c" }, svg);
  el("circle", { cx: gx, cy: gy, r: Math.max(7.5, yd(12.5)), fill: "#a6d98a" }, svg);
  if (hz.has("greenside_bunker")) {
    for (const [ds, dx] of [[-9, -17], [5, 17]]) {
      const [bx, by] = toXY(L + ds, dx);
      el("ellipse", { cx: bx, cy: by, rx: yd(6), ry: yd(9), fill: "#e8d6a2", stroke: "#cdb87e", "stroke-width": 1 }, svg);
    }
  }
  el("line", { x1: gx, y1: gy, x2: gx, y2: gy - 22, stroke: "#f5f1e6", "stroke-width": 1.6 }, svg);
  el("path", { d: `M${gx},${gy - 22} l12,4 l-12,4 Z`, fill: "#FFD700", stroke: "#b89a00", "stroke-width": 0.6 }, svg);
  el("circle", { cx: gx, cy: gy, r: 1.6, fill: "#1b1b1b" }, svg);

  // tee box
  const [tx, ty] = toXY(0, 0);
  el("rect", { x: tx - yd(8), y: ty - yd(4), width: yd(16), height: yd(8), rx: 2, fill: "#97cc7c", stroke: "#6f9f58" }, svg);

  // header text
  const hdr = el("text", { x: 14, y: 26, class: "gm-svg-title" }, svg);
  hdr.textContent = `Hole ${hole.n}`;
  const sub = el("text", { x: 14, y: 42, class: "gm-svg-sub" }, svg);
  sub.textContent = `Par ${hole.par} · ${hole.yards} yds`;

  const layer = el("g", { class: "gm-balls" }, svg);
  return { toXY, k, layer, svg };
}

/** Real layout (OpenStreetMap polygons). Same return shape as drawHole. */
function drawGeoHole(svg, hole) {
  const { markup, toXY, k } = geoHoleMarkup(hole, { W, H, pad: PAD, top: 26, idPrefix: "gm" });
  svg.innerHTML = `<style>${GEO_STYLE}</style>${markup}`;
  const veil = el("rect", { x: 0, y: 0, width: W, height: 52, fill: "#0b3d2c", opacity: 0.55 }, svg);
  void veil;
  const hdr = el("text", { x: 14, y: 26, class: "gm-svg-title" }, svg);
  hdr.textContent = `Hole ${hole.n}`;
  const sub = el("text", { x: 14, y: 42, class: "gm-svg-sub" }, svg);
  sub.textContent = `Par ${hole.par} · ${hole.yards} yds`;
  const credit = el("text", { x: W - 6, y: H - 6, "text-anchor": "end", class: "gm-svg-credit" }, svg);
  credit.textContent = "© OpenStreetMap contributors";
  const layer = el("g", { class: "gm-balls" }, svg);
  return { toXY, k, layer, svg };
}

/** Arc from a to b (screen coords), higher for longer shots; putts roll straight. */
function arcPoint(a, b, t, lift) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - lift;
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * mx + t * t * b[0], u * u * a[1] + 2 * u * t * my + t * t * b[1]];
}

/** Draw a finished shot's trail plus the ball at its end; animates when ms > 0. */
export function drawShot(view, shot, ms = 0) {
  const a = view.toXY(shot.from.s, shot.from.x), b = view.toXY(shot.to.s, shot.to.x);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const lift = shot.phase === "putt" ? 0 : Math.min(60, len * 0.28);
  const pts = [];
  for (let i = 0; i <= 20; i++) pts.push(arcPoint(a, b, i / 20, lift));
  const trail = el("path", { d: d(pts), class: shot.phase === "putt" ? "gm-trail gm-trail-putt" : "gm-trail", fill: "none" }, view.layer);
  view.layer.querySelectorAll(".gm-ball").forEach((n) => n.remove());
  const ball = el("circle", { cx: a[0], cy: a[1], r: 4, class: "gm-ball" }, view.layer);
  if (!ms) {
    ball.setAttribute("cx", b[0]); ball.setAttribute("cy", b[1]);
    return Promise.resolve();
  }
  const total = trail.getTotalLength();
  trail.style.strokeDasharray = `${total}`;
  trail.style.strokeDashoffset = `${total}`;
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms), e = 1 - (1 - t) ** 2;
      const p = arcPoint(a, b, e, lift);
      ball.setAttribute("cx", p[0]); ball.setAttribute("cy", p[1]);
      trail.style.strokeDashoffset = `${total * (1 - e)}`;
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Place the ball without a trail (start of a hole, or after re-teeing). */
export function placeBall(view, s, x) {
  view.layer.querySelectorAll(".gm-ball").forEach((n) => n.remove());
  const [cx, cy] = view.toXY(s, x);
  el("circle", { cx, cy, r: 4, class: "gm-ball" }, view.layer);
}

/** Magnified green inset for putts: ball offset from the pin in feet. */
export function drawGreenInset(view, hole, s, x, show) {
  view.svg.querySelectorAll(".gm-inset").forEach((n) => n.remove());
  if (!show) return;
  const g = el("g", { class: "gm-inset" }, view.svg);
  const cx = W - 70, cy = H - 92, R = 54, scale = R / 45; // bottom-right, clear of the green; 45 ft radius shown
  el("rect", { x: cx - 64, y: cy - 66, width: 128, height: 140, rx: 8, class: "gm-inset-bg" }, g);
  el("circle", { cx, cy, r: R, fill: "#a6d98a", stroke: "#78b25c", "stroke-width": 3 }, g);
  el("circle", { cx, cy, r: 2.6, fill: "#1b1b1b" }, g);
  el("line", { x1: cx, y1: cy, x2: cx, y2: cy - 18, stroke: "#f5f1e6", "stroke-width": 1.2 }, g);
  el("path", { d: `M${cx},${cy - 18} l9,3 l-9,3 Z`, fill: "#FFD700" }, g);
  const pin = hole.geo ? hole.geo.pin[0] : hole.yards;
  const fx = x * 3, fy = (s - pin) * 3; // ft right, ft past the pin
  const r = Math.hypot(fx, fy), f = r > 44 ? 44 / r : 1;
  el("circle", { cx: cx + fx * f * scale, cy: cy - fy * f * scale, r: 3.6, class: "gm-ball" }, g);
  const t = el("text", { x: cx, y: cy + R + 14, "text-anchor": "middle", class: "gm-inset-text" }, g);
  t.textContent = `${r < 3 ? r.toFixed(1) : Math.round(r)} ft to the hole`;
}
