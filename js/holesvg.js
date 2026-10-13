// Draws a hole (tee at the bottom, green at the top). Holes with real layouts (hole.geo, from
// OpenStreetMap) are drawn from their polygons; the rest get a schematic from par, yards, shape and
// hazards in courses.json, which is an illustration, not a survey.
import { geoHoleMarkup, GEO_STYLE } from "./game/geo_svg.js";

const W = 120, H = 220, TEE_Y = 204;

function bez(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

/** Add the real-layout styles to the page once. */
export function ensureGeoStyle() {
  if (document.getElementById("geo-hole-style")) return;
  const st = document.createElement("style");
  st.id = "geo-hole-style";
  st.textContent = GEO_STYLE;
  document.head.appendChild(st);
}

export function holeSvg(hole, { idPrefix = "h" } = {}) {
  if (hole.geo) {
    const id = `${idPrefix}${hole.n}`;
    const { markup } = geoHoleMarkup(hole, { W, H, pad: 4, idPrefix: id, detail: false });
    return `<svg class="hole-svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}t">
    <title id="${id}t">Hole ${hole.n}, par ${hole.par}, ${hole.yards} yards</title>
    <clipPath id="${id}c"><rect width="${W}" height="${H}" rx="10"/></clipPath><g clip-path="url(#${id}c)">${markup}</g></svg>`;
  }
  const yards = Math.max(100, Math.min(hole.yards || 400, 680));
  const len = 40 + (yards / 680) * 150;                   // drawn length, to scale across holes
  const tee = [W / 2, TEE_Y];
  const bend = hole.shape === "dogleg_left" ? -30 : hole.shape === "dogleg_right" ? 30 : 0;
  const green = [W / 2 + bend * 0.9, TEE_Y - len];
  const ctrl = [W / 2 + bend * 0.1, TEE_Y - len * 0.85];  // runs straight, then turns toward the green
  const path = `M${tee[0]},${tee[1]} Q${ctrl[0]},${ctrl[1]} ${green[0]},${green[1]}`;
  const land = bez(tee, ctrl, green, hole.par === 3 ? 0.5 : 0.58);
  const hz = new Set(hole.hazards || []);
  const id = `${idPrefix}${hole.n}`;
  const parts = [];

  // trees first so everything else sits on top
  for (const side of ["left", "right"]) {
    if (!hz.has(`trees_${side}`)) continue;
    const s = side === "left" ? -1 : 1;
    for (let i = 0; i < 6; i++) {
      const [x, y] = bez(tee, ctrl, green, 0.15 + i * 0.14);
      const cx = Math.max(8, Math.min(W - 8, x + s * (24 + (i % 2) * 6)));
      parts.push(`<circle cx="${cx}" cy="${y}" r="${6 + (i % 3)}" class="hs-tree"/>`);
    }
  }
  for (const side of ["left", "right"]) {
    if (!hz.has(`water_${side}`)) continue;
    const s = side === "left" ? -1 : 1;
    const a = bez(tee, ctrl, green, 0.45), b = bez(tee, ctrl, green, 0.98);
    const x = Math.max(4, Math.min(W - 22, s < 0 ? Math.min(a[0], b[0]) - 36 : Math.max(a[0], b[0]) + 18));
    parts.push(`<rect x="${x}" y="${b[1] - 4}" width="18" height="${a[1] - b[1] + 8}" rx="9" class="hs-water"/>`);
  }
  if (hole.par !== 3) {
    parts.push(`<path d="${path}" class="hs-fairway" />`);
  } else {
    parts.push(`<path d="${path}" class="hs-carry" />`);
  }
  for (const side of ["left", "right"]) {
    if (!hz.has(`fairway_bunker_${side}`) || hole.par === 3) continue;
    const s = side === "left" ? -1 : 1;
    parts.push(`<ellipse cx="${land[0] + s * 13}" cy="${land[1]}" rx="5" ry="8" class="hs-sand"/>`);
  }
  parts.push(`<ellipse cx="${green[0]}" cy="${green[1]}" rx="13" ry="10" class="hs-green"/>`);
  if (hz.has("greenside_bunker")) {
    parts.push(`<ellipse cx="${green[0] - 15}" cy="${green[1] + 6}" rx="5" ry="4" class="hs-sand"/>`);
    parts.push(`<ellipse cx="${green[0] + 14}" cy="${green[1] - 5}" rx="4.5" ry="3.5" class="hs-sand"/>`);
  }
  parts.push(`<line x1="${green[0]}" y1="${green[1]}" x2="${green[0]}" y2="${green[1] - 16}" class="hs-pin"/>`);
  parts.push(`<path d="M${green[0]},${green[1] - 16} l9,3 l-9,3 z" class="hs-flag"/>`);
  parts.push(`<rect x="${tee[0] - 5}" y="${tee[1] - 3}" width="10" height="6" rx="1.5" class="hs-tee"/>`);

  return `<svg class="hole-svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}t">
    <title id="${id}t">Hole ${hole.n}, par ${hole.par}, ${hole.yards} yards${hole.shape && hole.shape !== "straight" ? ", " + hole.shape.replace("_", " ") : ""}</title>
    <rect width="${W}" height="${H}" rx="10" class="hs-rough"/>
    ${parts.join("")}
  </svg>`;
}
