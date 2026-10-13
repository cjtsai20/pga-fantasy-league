// SVG markup for a hole with a real layout (hole.geo, yards in the tee->pin frame; see geo.js).
// Used by the Play tab (hole_svg.js) and the Courses tab (../holesvg.js). The tee sits at the
// bottom and the pin at the top; the view is fitted to the hole's centerline plus a margin.

const f1 = (v) => (Math.round(v * 10) / 10).toString();

/**
 * @returns {{markup: string, toXY: (s:number, x:number) => [number, number], k: number}}
 * k = SVG units per yard.
 */
export function geoHoleMarkup(hole, { W, H, pad = 14, top = 0, idPrefix = "g", detail = true } = {}) {
  const g = hole.geo, P = g.pin[0];
  const line = g.line?.length ? g.line : [[0, 0], [P, 0]];
  const ss = [...line.map((p) => p[0]), 0, P], xs = [...line.map((p) => p[1]), 0];
  const marginX = 42, marginS = 18;
  const minS = Math.min(...ss) - marginS, maxS = Math.max(...ss) + marginS + 8;
  const minX = Math.min(...xs) - marginX, maxX = Math.max(...xs) + marginX;
  const k = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad - top) / (maxS - minS));
  const ox = (W - (maxX - minX) * k) / 2 - minX * k;
  const oy = pad + top + (H - 2 * pad - top - (maxS - minS) * k) / 2 + maxS * k;
  const toXY = (s, x) => [ox + x * k, oy - s * k];
  const path = (r, close = true) => "M" + r.map(([s, x]) => toXY(s, x).map(f1).join(",")).join("L") + (close ? "Z" : "");
  const polys = (list, cls, extra = "") => (list || []).map((r) => `<path d="${path(r)}" class="${cls}" ${extra}/>`).join("");
  const id = `${idPrefix}-${hole.n}`;
  const parts = [];

  // outside the course boundary reads as out of bounds; inside is rough
  if (g.boundary?.length) {
    parts.push(`<rect width="${W}" height="${H}" class="gs-oob"/>`);
    parts.push(polys(g.boundary, "gs-rough"));
  } else {
    parts.push(`<rect width="${W}" height="${H}" class="gs-rough"/>`);
  }
  parts.push(polys(g.trees, "gs-woods"));
  parts.push(polys(g.water, "gs-water"));
  if (detail) {
    parts.push(`<defs><pattern id="${id}-mow" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <rect width="12" height="12" class="gs-fw-a"/><rect width="6" height="12" class="gs-fw-b"/></pattern></defs>`);
    parts.push(polys(g.fairway, "gs-fairway", `fill="url(#${id}-mow)"`));
  } else {
    parts.push(polys(g.fairway, "gs-fairway"));
  }
  parts.push(polys(g.tee, "gs-tee"));
  parts.push(polys(g.green, "gs-green"));
  parts.push(polys(g.bunker, "gs-sand"));
  for (const row of g.tree_row || []) parts.push(`<path d="${path(row, false)}" class="gs-treerow" stroke-width="${f1(Math.max(2, 6 * k))}"/>`);
  const tr = Math.max(1.6, 4.5 * k);
  for (const [s, x] of g.trees_pts || []) {
    const [cx, cy] = toXY(s, x);
    parts.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(tr)}" class="gs-tree"/>`);
  }
  // centerline (faint) for orientation
  parts.push(`<path d="${path(line, false)}" class="gs-line"/>`);
  // tee marker at the frame origin, pin + flag
  const [tx, ty] = toXY(0, 0);
  parts.push(`<circle cx="${f1(tx)}" cy="${f1(ty)}" r="${f1(Math.min(3.2, Math.max(2, 2.6 * k)))}" class="gs-teemark"/>`);
  const [px, py] = toXY(P, 0), fh = Math.max(12, Math.min(22, H * 0.04));
  parts.push(`<line x1="${f1(px)}" y1="${f1(py)}" x2="${f1(px)}" y2="${f1(py - fh)}" class="gs-pin"/>`);
  parts.push(`<path d="M${f1(px)},${f1(py - fh)} l${f1(fh * 0.55)},${f1(fh * 0.18)} l${f1(-fh * 0.55)},${f1(fh * 0.18)} Z" class="gs-flag"/>`);
  parts.push(`<circle cx="${f1(px)}" cy="${f1(py)}" r="1.4" class="gs-cup"/>`);
  return { markup: parts.join(""), toXY, k };
}

/** Inline styles shared by both tabs (kept here so the two stylesheets don't drift). */
export const GEO_STYLE = `
.gs-oob{fill:#a3a68c}.gs-rough{fill:#6f9b55}.gs-woods{fill:#2f5a35;opacity:.92}
.gs-water{fill:#3f7fb5;stroke:#336c9c;stroke-width:.8}.gs-fairway{fill:#8cc56f;stroke:#7bb35f;stroke-width:.6}
.gs-fw-a{fill:#8cc56f}.gs-fw-b{fill:#83bc66}.gs-tee{fill:#9fd283;stroke:#79a964;stroke-width:.6}
.gs-green{fill:#a9dc8c;stroke:#79b25e;stroke-width:1.4}.gs-sand{fill:#ead9a6;stroke:#cdb87e;stroke-width:.7}
.gs-tree{fill:#2c5634;stroke:#22452a;stroke-width:.5}.gs-treerow{fill:none;stroke:#2c5634;stroke-linecap:round;opacity:.9}
.gs-line{fill:none;stroke:#f5f1e6;stroke-width:.8;stroke-dasharray:3 4;opacity:.45}
.gs-teemark{fill:#f5f1e6;stroke:#1b1b1b;stroke-width:.6}.gs-pin{stroke:#f5f1e6;stroke-width:1.4}
.gs-flag{fill:#FFD700;stroke:#b89a00;stroke-width:.5}.gs-cup{fill:#1b1b1b}`;
