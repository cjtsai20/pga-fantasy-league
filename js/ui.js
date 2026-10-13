// Small shared helpers: escaping, formatting, avatars, event styling, ranking.
import { TIMEZONE } from "./config.js";
import { golferAvatar } from "./avatar.js";

// Escape anything user-entered (display names, bonus picks) before it goes into innerHTML.
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function todayET(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const d = (iso) => new Date(`${iso}T12:00:00`);
export function fmtDates(start, end) {
  const s = d(start), e = d(end);
  const mo = (x) => x.toLocaleString("en-US", { month: "short" });
  return s.getMonth() === e.getMonth()
    ? `${mo(s)} ${s.getDate()} – ${e.getDate()}, ${e.getFullYear()}`
    : `${mo(s)} ${s.getDate()} – ${mo(e)} ${e.getDate()}, ${e.getFullYear()}`;
}
export const monthName = (ym) => d(`${ym}-01`).toLocaleString("en-US", { month: "long", year: "numeric" });
export const monthShort = (ym) => d(`${ym}-01`).toLocaleString("en-US", { month: "short" });

export function fmtLock(iso) {
  return new Date(iso).toLocaleString("en-US", { timeZone: TIMEZONE, weekday: "long", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit" }) + " ET";
}
export function fmtStamp(iso) {
  return new Date(iso).toLocaleString("en-US", { timeZone: TIMEZONE, month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit" }) + " ET";
}
export function countdown(ms) {
  if (ms <= 0) return "Locked";
  const s = Math.floor(ms / 1000), dd = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600),
    mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return dd > 0 ? `${dd}d ${hh}h ${mm}m` : `${hh}h ${String(mm).padStart(2, "0")}m ${String(ss).padStart(2, "0")}s`;
}

export const pts = (v) => {
  const n = Number(v || 0);
  return n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

const EVENT_LABEL = { major: "Major", signature: "Signature Event", players: "The Players", regular: "", opposite: "Additional Event", team: "Team Event" };
export const eventLabel = (type) => EVENT_LABEL[type] ?? "";
// The old sheet: majors bold, signature events italic. THE PLAYERS is treated like a signature event.
export function eventName(t) {
  const cls = t.event_type === "major" ? "ev-major" : (t.event_type === "signature" || t.event_type === "players") ? "ev-signature" : "";
  return `<span class="ev-name ${cls}">${esc(t.name)}</span>`;
}
export function eventBadge(type) {
  const label = eventLabel(type);
  return label ? `<span class="badge badge-${esc(type)}">${esc(label)}</span>` : "";
}

// Comic-style drawn avatar (see avatar.js). Tour headshot URLs are ignored on purpose: those photos
// are licensed for personal use only. `extra` may carry {id, country} for a steadier drawing.
export function avatar(name, _url, size = "md", extra = {}) {
  return `<span class="avatar avatar-${size} avatar-comic" aria-hidden="true">${golferAvatar({ name, ...extra })}</span>`;
}

// Standard competition ranking with ties shown as T2, T2, 4.
export function rank(rows, key = "total") {
  const sorted = [...rows].sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name));
  sorted.forEach((r, i) => {
    const first = sorted.findIndex((x) => x[key] === r[key]);
    const tied = sorted.filter((x) => x[key] === r[key]).length > 1;
    r.rank = first + 1;
    r.rankLabel = (tied ? "T" : "") + (first + 1);
  });
  return sorted;
}

export function emptyState(title, body = "") {
  return `<div class="empty"><div class="empty-rule"></div><h3>${esc(title)}</h3>${body ? `<p>${body}</p>` : ""}</div>`;
}

export function toast(msg, kind = "info") {
  let box = $("#toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.append(box); }
  const t = document.createElement("div");
  t.className = `toast toast-${kind}`;
  t.setAttribute("role", kind === "error" ? "alert" : "status");
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.classList.add("out"), 4200);
  setTimeout(() => t.remove(), 4800);
}

export function currentTournament(tournaments, now = new Date()) {
  const today = todayET(now);
  return tournaments.find((t) => t.end_date >= today) || tournaments[tournaments.length - 1] || null;
}
