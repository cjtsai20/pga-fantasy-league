// Courses: a card per course on the schedule, and a detail page with photos, scorecard and
// schematic hole layouts.
import { holeSvg, ensureGeoStyle } from "./holesvg.js";
import { attachCourseGeo } from "./game/geo.js";
import { emptyState, esc, eventName, fmtDates } from "./ui.js";

const sum = (a) => a.reduce((x, y) => x + y, 0);

// `linked: false` inside a course card: the card is already an <a>, and a nested link splits it apart.
function photo(c, cls = "", { linked = true } = {}) {
  const img = c.images?.[0];
  if (!img) {  // no licensed photo yet: a quiet crest plate instead
    return `<div class="course-photo is-illustrated ${cls}"><div class="plate">
      <svg viewBox="0 0 64 76" aria-hidden="true"><use href="#crest"/></svg>
      <p class="plate-name">${esc(c.name)}</p><p class="plate-sub">Par ${esc(c.par)} · ${Number(c.yardage).toLocaleString()} yards</p></div></div>`;
  }
  return `<figure class="course-photo ${cls}"><img src="${esc(img.url)}" alt="${esc(c.name)}" loading="lazy">
    <figcaption>${credit(img, linked)}</figcaption></figure>`;
}
const credit = (img, linked = true) => `Photo: ${img.source && linked ? `<a href="${esc(img.source)}" target="_blank" rel="noopener">${esc(img.credit || "source")}</a>` : esc(img.credit || "")}${img.license ? ` · ${esc(img.license)}` : ""}`;

// Course data is public reference data (not league data), so the real files are used even in demo mode.
async function publicJson(path) {
  try { const r = await fetch(`data/${path}`, { cache: "no-cache" }); return r.ok ? await r.json() : null; } catch { return null; }
}

export async function render(root, ctx, params) {
  const courses = (await publicJson("courses.json")) || (await ctx.api.staticJson("courses.json")) || [];
  const c = courses.find((x) => x.id === params[0]);
  if (c) {
    if (c.geo_file) {  // real hole layouts live in a per-course file
      attachCourseGeo(c, await publicJson(c.geo_file));
      ensureGeoStyle();
    }
    renderCourse(root, ctx, c);
    if (params[1]) wireEnlarge.open?.(+params[1]);  // #/courses/<id>/<hole> opens that hole
    return;
  }
  root.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">The Venues</p><h1 class="page-title">Courses</h1></div></div>
    ${courses.length ? `<div class="course-grid">${courses.map((x) => {
      const events = ctx.tournaments.filter((t) => (x.tournament_ids || []).includes(t.id) || t.course_id === x.id);
      return `<a class="course-card" href="#/courses/${esc(x.id)}">
        ${photo(x, "", { linked: false })}
        <div class="course-card-body">
          <h2>${esc(x.name)}</h2>
          <p class="muted">${esc(x.location || "")}</p>
          <p class="course-facts"><span>Par ${esc(x.par)}</span><span>${Number(x.yardage).toLocaleString()} yds</span></p>
          ${events.length ? `<p class="course-events">${events.map(eventName).join(" · ")}</p>` : ""}
        </div></a>`;
    }).join("")}</div>`
      : emptyState("Course guide coming soon")}`;
}

function scorecard(holes) {
  const half = (a, b) => holes.slice(a, b);
  const front = half(0, 9), back = half(9, 18);
  const cells = (hs, f) => hs.map((h) => `<td>${f(h)}</td>`).join("");
  const diff = (h) => h.difficulty == null ? "–"
    : `<span class="${h.difficulty > 0 ? "over" : "under"}">${h.difficulty > 0 ? "+" : ""}${h.difficulty.toFixed(2)}</span>`;
  const row = (label, f, tot) => `<tr><th scope="row">${label}</th>${cells(front, f)}<td class="sub">${tot(front)}</td>
    ${back.length ? `${cells(back, f)}<td class="sub">${tot(back)}</td>` : ""}<td class="sub tot">${tot(holes)}</td></tr>`;
  return `<div class="scorecard-wrap"><table class="scorecard">
    <thead><tr><th scope="col">Hole</th>${front.map((h) => `<th>${h.n}</th>`).join("")}<th class="sub">Out</th>
      ${back.length ? `${back.map((h) => `<th>${h.n}</th>`).join("")}<th class="sub">In</th>` : ""}<th class="sub tot">Tot</th></tr></thead>
    <tbody>
      ${row("Yards", (h) => h.yards, (hs) => sum(hs.map((h) => h.yards)).toLocaleString())}
      ${row("Par", (h) => h.par, (hs) => sum(hs.map((h) => h.par)))}
      ${holes.some((h) => h.difficulty != null) ? row("vs Par", diff, () => "") : ""}
    </tbody></table></div>`;
}

function renderCourse(root, ctx, c) {
  const events = ctx.tournaments.filter((t) => (c.tournament_ids || []).includes(t.id) || t.course_id === c.id);
  const holes = c.holes || [];
  root.innerHTML = `
    <p class="crumb"><a href="#/courses">← All courses</a>
      ${c.holes?.length === 18 ? `<a class="btn btn-small" style="float:right" href="#/play/${esc(c.id)}">Play this course</a>` : ""}</p>
    <div class="page-head"><div><p class="eyebrow">${esc(c.location || "")}</p><h1 class="page-title">${esc(c.name)}</h1></div></div>
    <div class="course-hero">
      ${photo(c, "is-hero")}
      <div class="course-summary">
        <dl class="facts">
          <div><dt>Par</dt><dd>${esc(c.par)}</dd></div>
          <div><dt>Yardage</dt><dd>${Number(c.yardage).toLocaleString()}</dd></div>
          <div><dt>Holes</dt><dd>${holes.length || 18}</dd></div>
        </dl>
        ${c.description ? `<p class="course-desc">${esc(c.description)}</p>` : ""}
        ${events.map((t) => `<p class="course-event">${eventName(t)}<br><span class="muted">${fmtDates(t.start_date, t.end_date)}</span></p>`).join("")}
      </div>
    </div>
    ${c.images?.length > 1 ? `<div class="gallery">${c.images.slice(1).map((img) => `
      <figure><img src="${esc(img.url)}" alt="${esc(c.name)}" loading="lazy"><figcaption>${credit(img)}</figcaption></figure>`).join("")}</div>` : ""}
    ${holes.length ? `
      <section class="panel"><div class="panel-head"><h2>Scorecard</h2>
        ${holes.some((h) => h.difficulty != null) ? `<p class="muted">vs Par = tour scoring average relative to par.</p>` : ""}</div>
        ${scorecard(holes)}</section>
      <section class="panel"><div class="panel-head"><h2>Hole by Hole</h2><p class="muted">${c.layout_source === "osm"
        ? "Layouts from OpenStreetMap survey data, © OpenStreetMap contributors (ODbL). Tap a hole to enlarge."
        : "Illustrated layouts drawn from each hole's length and par; no public survey of this course is available."}</p></div>
        <div class="hole-grid">${holes.map((h) => `
          <figure class="hole" data-hole="${h.n}" tabindex="0" role="button" aria-label="Enlarge hole ${h.n}">${holeSvg(h, { idPrefix: `${c.id}-` })}
            <figcaption><span class="hole-n">${h.n}</span><span>Par ${h.par}</span><span>${h.yards} yds</span></figcaption></figure>`).join("")}</div>
      </section>` : ""}`;
  wireEnlarge(root, c);
}

/** Click/tap a hole thumbnail to see it large. */
function wireEnlarge(root, c) {
  const open = (n) => {
    const h = c.holes.find((x) => x.n === n);
    if (!h) return;
    let dlg = document.getElementById("hole-dialog");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "hole-dialog";
      dlg.className = "hole-dialog";
      dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `<div class="hole-dialog-body">
      <button class="hole-dialog-close" data-close aria-label="Close">×</button>
      <p class="eyebrow">${esc(c.name)}</p>
      <h2>Hole ${h.n} <span class="muted">· Par ${h.par} · ${h.yards} yds</span></h2>
      ${holeSvg(h, { idPrefix: `${c.id}-big-` })}
      ${c.layout_source === "osm" ? `<p class="muted hole-dialog-credit">© OpenStreetMap contributors (ODbL)</p>` : ""}</div>`;
    dlg.showModal();
  };
  wireEnlarge.open = open;
  root.querySelectorAll("[data-hole]").forEach((f) => {
    f.addEventListener("click", () => open(+f.dataset.hole));
    f.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(+f.dataset.hole); } });
  });
}
