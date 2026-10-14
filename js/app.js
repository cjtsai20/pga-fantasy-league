// Boot, auth state, hash router and page shell.
import { LEAGUE_NAME, LEAGUE_TAGLINE, SEASON, SUPABASE_KEY, SUPABASE_URL } from "./config.js";
import { createApi } from "./api.js";
import { $, $$, esc, fmtStamp } from "./ui.js";
import * as auth from "./auth.js";
import * as week from "./week.js";
import * as standings from "./standings.js";
import * as courses from "./courses.js";
import * as admin from "./admin.js";

const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const PUBLIC = new Set(["signin", "signup", "forgot", "reset"]);
const TABS = [
  ["week", "This Week"], ["leaderboard", "Season"], ["monthly", "Monthly"], ["history", "History"],
  ["winners", "Winners"], ["courses", "Courses"], ["play", "Play"],
];

// Read the URL before Supabase consumes it: a password-reset link lands with #...type=recovery.
const landingHash = location.hash;
const recovering = /type=recovery/.test(landingHash);
const linkError = new URLSearchParams(landingHash.replace(/^#/, "")).get("error_description");
const demoMode = new URLSearchParams(location.search).has("demo");

const ctx = {
  api: null, season: SEASON, user: null, profile: null, profiles: [], tournaments: [], flash: null,
  cleanups: [],
  onCleanup(fn) { this.cleanups.push(fn); },
  rerender: () => route(),
  refresh: async () => { await loadState(); renderNav(); await route(); },
};

async function loadState() {
  const session = await ctx.api.session();
  ctx.user = session?.user ?? null;
  ctx.profile = ctx.user ? await ctx.api.profile(ctx.user.id) : null;
  if (ctx.user && !ctx.profile) {  // confirmed their email, saved code from sign-up: finish joining quietly
    const p = auth.pendingJoin();
    if (p?.code) {
      try { await ctx.api.joinLeague(p.code, p.name); auth.clearPendingJoin(); ctx.profile = await ctx.api.profile(ctx.user.id); }
      catch (e) { ctx.flash = e.message; }
    }
  }
  if (ctx.profile) {
    [ctx.tournaments, ctx.profiles] = await Promise.all([ctx.api.tournaments(), ctx.api.profiles()]);
  }
}

function renderNav() {
  const nav = $("#nav"), acct = $("#account");
  if (!ctx.profile) { nav.innerHTML = ""; acct.innerHTML = ""; return; }
  const tabs = ctx.profile.is_admin ? [...TABS, ["admin", "Admin"]] : TABS;
  nav.innerHTML = tabs.map(([id, label]) => `<a href="#/${id}" data-tab="${id}">${label}</a>`).join("");
  acct.innerHTML = `<span class="acct-name">${esc(ctx.profile.display_name)}</span>
    <button class="btn-link" id="sign-out">${ctx.api.demo ? "Demo" : "Sign out"}</button>`;
  $("#sign-out").addEventListener("click", async () => { await ctx.api.signOut(); if (!ctx.api.demo) await ctx.refresh(); });
}

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || "week", params: parts.slice(1) };
}

let routing = 0;
async function route() {
  const ticket = ++routing;
  ctx.cleanups.splice(0).forEach((fn) => { try { fn(); } catch { /* view already gone */ } });
  let { name, params } = parseHash();
  if (!ctx.user && !PUBLIC.has(name)) name = "signin";
  else if (ctx.user && !ctx.profile && name !== "reset") name = "join";
  else if (ctx.profile && (name === "signin" || name === "signup" || name === "join")) name = "week";

  const view = $("#view");
  $$("#nav a").forEach((a) => a.setAttribute("aria-current", a.dataset.tab === name ? "page" : "false"));
  document.body.dataset.route = name;
  view.innerHTML = `<div class="loading" aria-live="polite"><span class="spinner"></span></div>`;
  const root = document.createElement("div");
  root.className = "view-inner";
  try {
    switch (name) {
      case "signin": auth.renderSignIn(root, ctx, linkError || ""); break;
      case "signup": auth.renderSignUp(root, ctx); break;
      case "join": auth.renderJoin(root, ctx); break;
      case "forgot": auth.renderForgot(root, ctx); break;
      case "reset": auth.renderReset(root, ctx); break;
      case "week": await week.render(root, ctx, params); break;
      case "leaderboard": await standings.renderSeason(root, ctx); break;
      case "monthly": await standings.renderMonthly(root, ctx, params); break;
      case "history": await standings.renderHistory(root, ctx); break;
      case "winners": await standings.renderWinners(root, ctx); break;
      case "courses": await courses.render(root, ctx, params); break;
      case "play": await renderPlay(root, params); break;
      case "admin": await admin.render(root, ctx, params); break;
      default: location.hash = "#/week"; return;
    }
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="empty"><div class="empty-rule"></div><h3>Something went wrong</h3><p>${esc(e.message)}</p>
      <p><button class="btn btn-small" onclick="location.reload()">Reload</button></p></div>`;
  }
  if (ticket !== routing) return;  // a newer navigation finished first
  view.replaceChildren(root);
  if (name !== "week" || !params.length) window.scrollTo({ top: 0 });
}

async function renderPlay(root, params = []) {
  root.innerHTML = `<div class="page-head"><div><p class="eyebrow">The Practice Tee</p><h1 class="page-title">Play</h1></div></div>
    <section id="game-root"></section>`;
  const el = $("#game-root", root);
  try {
    const mod = await import("./game/game.js");
    // mount once the section is in the document so the game can measure itself
    queueMicrotask(async () => {
      const cleanup = await mod.mountGame(el, { supabase: ctx.api.supabase, user: ctx.user, profile: ctx.profile,
        api: ctx.api, tournaments: ctx.tournaments, courseId: params[0] });
      if (typeof cleanup === "function") ctx.onCleanup(cleanup);
    });
  } catch (e) {
    console.warn("game module not available", e);
    el.innerHTML = `<div class="empty"><div class="empty-rule"></div><h3>The course is being prepared</h3>
      <p>Simulated rounds with your favorite golfers are coming soon.</p></div>`;
  }
}

async function footer() {
  // Results are pasted by the commissioner, so "last refreshed" is the newest saved result.
  const at = await ctx.api.lastResultsUpdate().catch(() => null);
  $("#refreshed").textContent = at ? `Results last updated ${fmtStamp(at)}` : "";
}

async function boot() {
  $("#brand-name").textContent = LEAGUE_NAME;
  $("#brand-tag").textContent = LEAGUE_TAGLINE;
  $("#footer-name").textContent = `${LEAGUE_NAME} · ${SEASON} Season`;
  $("#footer-name-top").textContent = `${SEASON} Members' Season`;
  document.title = LEAGUE_NAME;
  if (demoMode) {
    const { createDemoApi } = await import("./demo.js");
    ctx.api = await createDemoApi();
    document.body.classList.add("is-demo");
  } else {
    const { createClient } = await import(SUPABASE_CDN);
    ctx.api = createApi(createClient(SUPABASE_URL, SUPABASE_KEY));
  }
  await loadState();
  ctx.api.onAuth((event) => {
    if (event === "PASSWORD_RECOVERY") location.hash = "#/reset";
    if (event === "SIGNED_OUT") ctx.refresh();
  });
  renderNav();
  footer();
  if (recovering) location.hash = "#/reset";
  else if (linkError || /access_token=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search + "#/signin");
  window.addEventListener("hashchange", route);
  await route();
}

boot().catch((e) => {
  console.error(e);
  $("#view").innerHTML = `<div class="empty"><h3>The clubhouse is closed</h3><p>${esc(e.message)}</p></div>`;
});
