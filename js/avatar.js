// Comic-book golfer avatars, drawn as inline SVG. Not likenesses: every feature (cap, hair, beard,
// shades, shirt) is picked from a hash of the golfer's name, so the same golfer always gets the same
// drawing. Skin is one stylized tone for everyone: a random tone on a real, named person would
// misrepresent some of them. The panel uses his country's flag colors.
//
//   golferAvatar({id, name, country}, {size})  -> SVG (or <img>) markup string
//   golferAvatarEl(golfer, opts)                -> <span class="gav"> element
//
// Real artwork can replace any drawing: add the file to assets/golfers/ and list it in
// assets/golfers/manifest.json as {"46046": "46046.webp", "scottie-scheffler": "scottie.png"}
// (keyed by player id or by name slug).

const BASE = new URL("../", import.meta.url);
const INK = "#15130f";

async function fetchJson(path) {
  try { const r = await fetch(new URL(path, BASE), { cache: "no-cache" }); return r.ok ? await r.json() : null; }
  catch { return null; }
}
const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Loaded once at import (top-level await) so the first render already knows countries and overrides.
const [manifest, players, samplePlayers] = await Promise.all([
  fetchJson("assets/golfers/manifest.json"), fetchJson("data/players.json"), fetchJson("data/sample/game_players.json"),
]);
const countryBy = new Map();
for (const src of [samplePlayers, players]) {
  for (const [id, p] of Object.entries(src || {})) {
    if (!p?.country) continue;
    countryBy.set(String(id), p.country);
    countryBy.set(slug(p.name), p.country);
  }
}

// [panel, burst, accent]
const FLAGS = {
  USA: ["#b22234", "#f4f1e8", "#3c3b6e"], ENG: ["#f4f1e8", "#cf142b", "#cf142b"], SCO: ["#005eb8", "#f4f1e8", "#f4f1e8"],
  NIR: ["#f4f1e8", "#c8102e", "#c8102e"], IRL: ["#169b62", "#ff883e", "#f4f1e8"], NOR: ["#ba0c2f", "#f4f1e8", "#00205b"],
  SWE: ["#006aa7", "#fecc00", "#fecc00"], DEN: ["#c8102e", "#f4f1e8", "#f4f1e8"], ESP: ["#aa151b", "#f1bf00", "#f1bf00"],
  KOR: ["#f4f1e8", "#cd2e3a", "#0047a0"], JPN: ["#f4f1e8", "#bc002d", "#bc002d"], AUS: ["#00247d", "#e4002b", "#f4f1e8"],
  RSA: ["#007a4d", "#ffb612", "#de3831"], CAN: ["#d80621", "#f4f1e8", "#f4f1e8"], CHI: ["#0039a6", "#f4f1e8", "#d52b1e"],
  COL: ["#fcd116", "#003893", "#ce1126"], ARG: ["#74acdf", "#f4f1e8", "#f6b40e"], MEX: ["#006847", "#f4f1e8", "#ce1126"],
  FRA: ["#0055a4", "#f4f1e8", "#ef4135"], GER: ["#dd0000", "#ffce00", "#15130f"], BEL: ["#fdda24", "#ef3340", "#15130f"],
  AUT: ["#ed2939", "#f4f1e8", "#f4f1e8"], NZL: ["#00247d", "#cc142b", "#f4f1e8"], CHN: ["#de2910", "#ffde00", "#ffde00"],
  TPE: ["#000095", "#fe0000", "#f4f1e8"], PHI: ["#0038a8", "#fcd116", "#ce1126"], IND: ["#ff9933", "#f4f1e8", "#138808"],
  FIN: ["#f4f1e8", "#002f6c", "#002f6c"], ITA: ["#009246", "#f4f1e8", "#ce2b37"], VEN: ["#ffcc00", "#00247d", "#cf142b"],
  PUR: ["#ed0000", "#f4f1e8", "#0050f0"], POL: ["#dc143c", "#f4f1e8", "#dc143c"], WAL: ["#00b140", "#f4f1e8", "#c8102e"],
  NED: ["#21468b", "#f4f1e8", "#ae1c28"], THA: ["#2d2a4a", "#f4f1e8", "#a51931"], UAE: ["#00732f", "#f4f1e8", "#ff0000"],
  ZIM: ["#319208", "#ffd200", "#de2010"], PAR: ["#d52b1e", "#f4f1e8", "#0038a8"], SUI: ["#d52b1e", "#f4f1e8", "#d52b1e"],
  POR: ["#046a38", "#da291c", "#ffe900"], BRA: ["#009c3b", "#ffdf00", "#002776"],
};
const CLUB = ["#006747", "#ffd700", "#f4f1e8"];
const ALIAS = { US: "USA", "UNITED STATES": "USA", GBR: "ENG", ENGLAND: "ENG", SCOTLAND: "SCO", "NORTHERN IRELAND": "NIR",
  IRELAND: "IRL", NORWAY: "NOR", SWEDEN: "SWE", DENMARK: "DEN", SPAIN: "ESP", KOREA: "KOR", JAPAN: "JPN", AUSTRALIA: "AUS",
  "SOUTH AFRICA": "RSA", ZAF: "RSA", CANADA: "CAN", CHILE: "CHI", CHL: "CHI", COLOMBIA: "COL", ARGENTINA: "ARG", MEXICO: "MEX",
  FRANCE: "FRA", GERMANY: "GER", DEU: "GER", BELGIUM: "BEL", AUSTRIA: "AUT", "NEW ZEALAND": "NZL", CHINA: "CHN",
  TAIWAN: "TPE", "CHINESE TAIPEI": "TPE", PHILIPPINES: "PHI", INDIA: "IND", FINLAND: "FIN", ITALY: "ITA", VENEZUELA: "VEN",
  "PUERTO RICO": "PUR", PRI: "PUR", POLAND: "POL", WALES: "WAL", NETHERLANDS: "NED", NLD: "NED", THAILAND: "THA",
  "UNITED ARAB EMIRATES": "UAE", ARE: "UAE", ZIMBABWE: "ZIM", PARAGUAY: "PAR", PRY: "PAR", SWITZERLAND: "SUI", CHE: "SUI",
  PORTUGAL: "POR", PRT: "POR", BRAZIL: "BRA", "REPUBLIC OF KOREA": "KOR", "SOUTH KOREA": "KOR", "UNITED STATES OF AMERICA": "USA" };

const SKIN = ["#e6b88f", "#c99670"];
const HAIR = ["#1d1712", "#3b2716", "#6b4423", "#c9a15a", "#b5582a", "#9a958c", "#2a2a2a"];
const CAPS = ["#f4f1e8", "#1f2a44", "#15130f", "#006747", "#b22234", "#c8b98a", "#2f6db5", "#f4f1e8"];
const SHIRTS = ["#f4f1e8", "#1f2a44", "#006747", "#7a1f2b", "#3b7dd8", "#e9e0c8", "#4b4b4b", "#d64545", "#2f8f6f", "#f2c94c"];

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Independent picks from one hash: each call reshuffles the bits.
function picker(seed) {
  let x = seed || 1;
  return (n) => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
}
const initials = (name) => String(name || "?").replace(/["“”].*?["“”]/g, " ").split(/\s+/).filter(Boolean)
  .map((w) => w[0]).filter((c) => /\p{L}/u.test(c)).slice(0, 2).join("").toUpperCase() || "?";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

function flagFor(code) {
  const k = String(code || "").trim().toUpperCase();
  return FLAGS[ALIAS[k] || k] || CLUB;
}

function burst(cx, cy, r1, r2, n) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2, r = i % 2 ? r2 : r1;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function draw(g) {
  // Keyed by name so a golfer looks the same on pages that know his id and pages that don't.
  const key = slug(g.name) || String(g.id ?? "?");
  const pick = picker(hash(key));
  const [panel, burstFill, accent] = flagFor(g.country || countryBy.get(String(g.id)) || countryBy.get(slug(g.name)));
  const [skin, skinShade] = SKIN;
  pick(6);                              // the old skin draw; kept so every other feature stays put
  const hair = HAIR[pick(HAIR.length)];
  const hat = pick(10);                 // 0-5 cap, 6-7 visor, 8 flat cap, 9 bucket
  let cap = CAPS[pick(CAPS.length)];
  const shirt = SHIRTS[pick(SHIRTS.length)];
  const beard = pick(8);                // 0-3 none, 4 stubble, 5 full, 6 goatee, 7 mustache
  const shades = pick(4) === 0;
  const brows = pick(3);
  const mouth = pick(4);
  const burns = pick(3);
  const stripe = pick(2) === 0;
  if (Math.abs(lum(cap) - lum(burstFill)) < 0.12) cap = lum(burstFill) > 0.5 ? "#1f2a44" : "#f4f1e8";
  const dot = lum(panel) > 0.6 ? "rgba(21,19,15,.16)" : "rgba(255,255,255,.22)";
  const id = `g${hash(key).toString(36)}`;
  const s = `stroke="${INK}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;
  const tag = lum(accent) > 0.7 ? "#ffd700" : accent;
  const tagInk = lum(tag) > 0.55 ? INK : "#fffaf0";
  const ini = initials(g.name);

  // Hats. Each sits on a head spanning x 32-68, top of skull ~y 26.
  const hatSvg = [
    () => `<path d="M31.5 41 C31 25.5 69 25.5 68.5 41 Z" fill="${cap}" ${s}/>
      <path d="M50 27 V41" stroke="${INK}" stroke-width="1.1" opacity=".6" fill="none"/>
      <circle cx="50" cy="27" r="1.7" fill="${cap}" ${s} stroke-width="1.4"/>
      <rect x="45.5" y="32.5" width="9" height="5.5" rx="1.2" fill="${tag}" ${s} stroke-width="1.3"/>
      <path d="M30 40 C40 44 60 44 70 40 C72.5 42.5 71 46 65 46.6 C56 47.6 44 47.6 35 46.6 C29 46 27.5 42.5 30 40 Z" fill="${cap}" ${s}/>
      ${stripe ? `<path d="M32 44.6 C42 46.6 58 46.6 68 44.6" stroke="${accent}" stroke-width="1.8" fill="none"/>` : ""}`,
    () => `<path d="M31 35 C31 22 69 22 69 35 Z" fill="${hair}" ${s}/>
      <path d="M31 34 H69 V40 H31 Z" fill="${cap}" ${s}/>
      <rect x="46.5" y="35.2" width="7" height="3.6" rx="1" fill="${tag}" ${s} stroke-width="1.1"/>
      <path d="M30 39.5 C40 43.5 60 43.5 70 39.5 C72.5 42 71 45.5 65 46.1 C56 47.1 44 47.1 35 46.1 C29 45.5 27.5 42 30 39.5 Z" fill="${cap}" ${s}/>`,
    () => `<path d="M31 41 C29 27 71 25 71 37 C71 40 70 41.5 69 41.5 Z" fill="${cap}" ${s}/>
      <path d="M30 41 C42 44.5 60 44.5 71 39.5 C73.5 42 72 45.5 66 46.2 C55 47.6 42 47.6 33 45.5 Z" fill="${cap}" ${s}/>
      <path d="M36 32 C46 28.5 58 28.5 66 32" stroke="${INK}" stroke-width="1" fill="none" stroke-dasharray="2 2"/>`,
    () => `<path d="M33.5 41 C33 26 67 26 66.5 41 Z" fill="${cap}" ${s}/>
      <path d="M33.5 35.5 C44 33 56 33 66.5 35.5" stroke="${accent}" stroke-width="3" fill="none"/>
      <path d="M23 43.5 C31 37.5 69 37.5 77 43.5 C69 49 31 49 23 43.5 Z" fill="${cap}" ${s}/>`,
  ][hat < 6 ? 0 : hat < 8 ? 1 : hat === 8 ? 2 : 3]();

  const sideburns = burns === 0 ? "" :
    `<path d="M32.5 41 L33 ${burns === 1 ? 50 : 56} L36 ${burns === 1 ? 49 : 55} L36 42 Z M67.5 41 L67 ${burns === 1 ? 50 : 56} L64 ${burns === 1 ? 49 : 55} L64 42 Z" fill="${hair}"/>`;
  const jaw = "M33 55 C35 68 43 74 50 74 C57 74 65 68 67 55 C63 62 58 66 50 66 C42 66 37 62 33 55 Z";
  const beardSvg = [
    "", "", "", "",
    `<path d="${jaw}" fill="${hair}" opacity=".32"/>`,
    `<path d="${jaw}" fill="${hair}" ${s} stroke-width="1.8"/><path d="M44 62.5 Q50 60 56 62.5" stroke="${hair}" stroke-width="3.2" fill="none"/>`,
    `<path d="M45 65 Q50 75.5 55 65 Q50 67.5 45 65 Z" fill="${hair}" ${s} stroke-width="1.5"/><path d="M44.5 61.5 Q50 59.5 55.5 61.5" stroke="${hair}" stroke-width="2.6" fill="none"/>`,
    `<path d="M43.5 62 Q50 58.5 56.5 62 Q50 61 43.5 62 Z" fill="${hair}" ${s} stroke-width="1.6"/>`,
  ][beard];
  const browY = 47.6;
  const browSvg = [
    `M38 ${browY} L46 ${browY - 1.4} M54 ${browY - 1.4} L62 ${browY}`,
    `M38 ${browY - 1.8} L46 ${browY} M54 ${browY} L62 ${browY - 1.8}`,
    `M38 ${browY - 0.5} Q42 ${browY - 2.6} 46 ${browY - 0.6} M54 ${browY - 0.6} Q58 ${browY - 2.6} 62 ${browY - 0.5}`,
  ][brows];
  const eyes = shades
    ? `<path d="M36 48.5 H48 C48 54.5 46.5 56 42 56 C37.5 56 36 54.5 36 48.5 Z M52 48.5 H64 C64 54.5 62.5 56 58 56 C53.5 56 52 54.5 52 48.5 Z" fill="${INK}" ${s} stroke-width="1.6"/>
       <path d="M48 49.5 Q50 48.3 52 49.5" stroke="${INK}" stroke-width="1.8" fill="none"/>
       <path d="M38.5 50.5 L41.5 50.5 M54.5 50.5 L57.5 50.5" stroke="#fff" stroke-width="1.4" opacity=".85"/>`
    : `<path d="${browSvg}" stroke="${beard === 5 ? hair : INK}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
       <ellipse cx="42" cy="52.2" rx="2.3" ry="2.8" fill="${INK}"/><ellipse cx="58" cy="52.2" rx="2.3" ry="2.8" fill="${INK}"/>
       <circle cx="42.9" cy="51.2" r=".75" fill="#fff"/><circle cx="58.9" cy="51.2" r=".75" fill="#fff"/>`;
  const mouthSvg = beard === 5 ? `<path d="M45.5 66 Q50 68.5 54.5 66" stroke="${INK}" stroke-width="1.8" fill="none"/>` : [
    `<path d="M44 64 Q50 68.5 56 64" stroke="${INK}" stroke-width="2" fill="none"/>`,
    `<path d="M43.5 63 Q50 64.5 56.5 63 Q55 69.5 50 69.5 Q45 69.5 43.5 63 Z" fill="#fff" ${s} stroke-width="1.7"/>`,
    `<path d="M45 65 Q51 66.5 56 62.8" stroke="${INK}" stroke-width="2" fill="none"/>`,
    `<path d="M45 65 H55" stroke="${INK}" stroke-width="2" fill="none"/>`,
  ][mouth];
  const collar = lum(shirt) > 0.8 ? "#d9d2bf" : "#f4f1e8";

  return `<svg class="gav-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(g.name)}">
  <defs>
    <clipPath id="${id}c"><circle cx="50" cy="50" r="47"/></clipPath>
    <pattern id="${id}h" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="2.5" cy="2.5" r="1.35" fill="${dot}"/></pattern>
  </defs>
  <g clip-path="url(#${id}c)">
    <rect width="100" height="100" fill="${panel}"/>
    <rect width="100" height="100" fill="url(#${id}h)"/>
    <polygon points="${burst(50, 47, 45, 35, 13)}" fill="${burstFill}" ${s} stroke-width="2"/>
    <path d="M8 104 C9 86 26 77 50 77 C74 77 91 86 92 104 Z" fill="${shirt}" ${s}/>
    <path d="M37 80 C41 90 46 94 50 95 C54 94 59 90 63 80" fill="none" stroke="${INK}" stroke-width="1.4" opacity=".55"/>
    <path d="M43 64 V79 Q50 84 57 79 V64 Z" fill="${skinShade}" ${s}/>
    <path d="M38 77 L50 87 L43 92 L34 81 Z M62 77 L50 87 L57 92 L66 81 Z" fill="${collar}" ${s} stroke-width="1.8"/>
    <ellipse cx="31.5" cy="51" rx="4" ry="5.8" fill="${skin}" ${s}/><ellipse cx="68.5" cy="51" rx="4" ry="5.8" fill="${skin}" ${s}/>
    <path d="M32 42 C31 28 69 28 68 42 L67.5 55 C66 67 58 74 50 74 C42 74 34 67 32.5 55 Z" fill="${skin}" ${s}/>
    <path d="M60 70 C65 66 67.2 60 67.5 53 L67.8 46 C66 56 63 64 56 71 Z" fill="${skinShade}" opacity=".75"/>
    <ellipse cx="38" cy="59" rx="3.2" ry="1.8" fill="#e8746a" opacity=".35"/><ellipse cx="62" cy="59" rx="3.2" ry="1.8" fill="#e8746a" opacity=".35"/>
    ${sideburns}${beardSvg}
    <path d="M50 54 C48.4 57 47.8 58.6 48.3 59.8 Q50 60.6 52 59.6" stroke="${INK}" stroke-width="1.6" fill="none"/>
    ${eyes}${mouthSvg}<path d="M34 45 C44 49.5 56 49.5 66 45 L66 47.5 C56 51.5 44 51.5 34 47.5 Z" fill="${INK}" opacity=".16"/>${hatSvg}
    <path d="M30 12 L22 7 M72 10 L79 4 M84 26 L92 22" stroke="${INK}" stroke-width="2" opacity=".7"/>
  </g>
  <circle cx="50" cy="50" r="47" fill="none" stroke="${INK}" stroke-width="3.4"/>
  <g class="gav-tag" transform="translate(50 88) rotate(-6)">
    <rect x="-17" y="-8.5" width="34" height="16" rx="2.5" fill="${tag}" ${s} stroke-width="2.2"/>
    <text text-anchor="middle" y="5.4" font-family="Bangers, Impact, 'Arial Black', sans-serif" font-size="15.5" letter-spacing=".6" fill="${INK}" opacity=".9" transform="translate(1.1 1.1)">${esc(ini)}</text>
    <text text-anchor="middle" y="5.4" font-family="Bangers, Impact, 'Arial Black', sans-serif" font-size="15.5" letter-spacing=".6" fill="${tagInk === INK ? "#fffaf0" : tagInk}" stroke="${INK}" stroke-width=".9" paint-order="stroke">${esc(ini)}</text>
  </g>
</svg>`;
}

// One-time styles + font, so callers only need the markup.
if (typeof document !== "undefined" && !document.getElementById("gav-style")) {
  const font = document.createElement("link");
  font.rel = "stylesheet";
  font.href = "https://fonts.googleapis.com/css2?family=Bangers&display=swap";
  const st = document.createElement("style");
  st.id = "gav-style";
  st.textContent = `.gav{display:inline-block;line-height:0;flex:none}.gav-svg,.gav-img{width:100%;height:100%;display:block}
.gav-img{border-radius:50%;object-fit:cover;border:2px solid ${INK}}
.avatar.avatar-comic{background:none;border:0;overflow:visible}
.avatar.avatar-comic>.gav{width:100%;height:100%}
.gm-avatar.gm-avatar--comic{display:inline-block;border:0;background:none;line-height:0;border-radius:50%}
.gm-avatar--comic>.gav{width:100%;height:100%}`;
  document.head.append(font, st);
}

const cache = new Map();
/** Markup for one golfer. `size` (px) is optional; without it the SVG fills its container. */
export function golferAvatar(g, { size } = {}) {
  const k = `${g.id ?? ""}|${g.name ?? ""}|${g.country ?? ""}|${size ?? ""}`;
  if (cache.has(k)) return cache.get(k);
  const file = manifest && (manifest[String(g.id)] || manifest[slug(g.name)]);
  const dim = size ? ` style="width:${size}px;height:${size}px"` : "";
  const html = file
    ? `<span class="gav"${dim}><img class="gav-img" src="${esc(new URL(`assets/golfers/${file}`, BASE).href)}" alt="${esc(g.name)}" loading="lazy"></span>`
    : `<span class="gav"${dim}>${draw(g)}</span>`;
  cache.set(k, html);
  return html;
}

export function golferAvatarEl(g, opts) {
  const t = document.createElement("template");
  t.innerHTML = golferAvatar(g, opts).trim();
  return t.content.firstElementChild;
}

export const golferCountry = (g) => g.country || countryBy.get(String(g.id)) || countryBy.get(slug(g.name)) || "";
