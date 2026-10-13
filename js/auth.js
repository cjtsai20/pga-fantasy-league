// Sign in, sign up (with league code), finish joining, forgot password, set a new password.
import { LEAGUE_NAME } from "./config.js";
import { $, esc } from "./ui.js";

const PENDING = "pfl.pendingJoin";  // name + code saved across an email confirmation, if Supabase requires one

export function pendingJoin() {
  try { return JSON.parse(localStorage.getItem(PENDING) || "null"); } catch { return null; }
}
export const clearPendingJoin = () => localStorage.removeItem(PENDING);

function shell(root, title, sub, form, foot = "") {
  root.innerHTML = `
    <div class="auth">
      <div class="auth-card">
        <svg class="auth-crest" viewBox="0 0 64 76" aria-hidden="true"><use href="#crest"/></svg>
        <p class="eyebrow">${esc(LEAGUE_NAME)}</p>
        <h1>${title}</h1>
        ${sub ? `<p class="auth-sub">${sub}</p>` : ""}
        <form class="auth-form" novalidate>${form}
          <p class="form-error" role="alert"></p>
          <p class="form-ok" role="status"></p>
        </form>
        ${foot ? `<div class="auth-foot">${foot}</div>` : ""}
      </div>
    </div>`;
  const f = $("form", root);
  return { form: f, error: (m) => { $(".form-error", f).textContent = m; }, ok: (m) => { $(".form-ok", f).textContent = m; } };
}

const field = (id, label, type = "text", attrs = "") =>
  `<label class="fld"><span>${label}</span><input id="${id}" name="${id}" type="${type}" ${attrs}></label>`;

async function submitting(form, fn) {
  const btn = $("button[type=submit]", form);
  btn.disabled = true;
  try { await fn(); } finally { btn.disabled = false; }
}

export function renderSignIn(root, ctx, notice = "") {
  const v = shell(root, "Members' Sign In", notice ? esc(notice) : "Welcome back to the clubhouse.",
    `${field("email", "Email", "email", 'autocomplete="email" required')}
     ${field("password", "Password", "password", 'autocomplete="current-password" required')}
     <button class="btn btn-block" type="submit">Sign In</button>`,
    `<a href="#/forgot">Forgot your password?</a><span class="dot">·</span><a href="#/signup">New member? Join the league</a>`);
  v.form.addEventListener("submit", (e) => {
    e.preventDefault();
    v.error("");
    submitting(v.form, async () => {
      try {
        await ctx.api.signIn($("#email", root).value.trim(), $("#password", root).value);
        await ctx.refresh();
      } catch (err) { v.error(err.message === "Invalid login credentials" ? "That email and password don't match." : err.message); }
    });
  });
}

export function renderSignUp(root, ctx) {
  const v = shell(root, "Join the League", "You'll need the league code from the commissioner.",
    `${field("name", "Display name", "text", 'autocomplete="nickname" maxlength="40" required placeholder="As it appears on the leaderboard"')}
     ${field("email", "Email", "email", 'autocomplete="email" required')}
     ${field("password", "Password", "password", 'autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"')}
     ${field("code", "League code", "text", 'autocomplete="off" required')}
     <button class="btn btn-block" type="submit">Create Account</button>`,
    `<a href="#/signin">Already a member? Sign in</a>`);
  v.form.addEventListener("submit", (e) => {
    e.preventDefault();
    v.error("");
    const name = $("#name", root).value.trim(), email = $("#email", root).value.trim(),
      password = $("#password", root).value, code = $("#code", root).value.trim();
    if (name.length < 2) return v.error("Please enter a display name.");
    if (!email || !password || !code) return v.error("Please fill in every field.");
    if (password.length < 8) return v.error("Passwords need at least 8 characters.");
    submitting(v.form, async () => {
      try {
        const session = await ctx.api.signUp(email, password);
        if (!session) {
          localStorage.setItem(PENDING, JSON.stringify({ name, code }));
          v.ok("Check your inbox to confirm your email, then sign in to finish joining.");
          return;
        }
        try { await ctx.api.joinLeague(code, name); }
        catch (err) {  // account exists but the code was wrong: the join page lets them retry
          localStorage.setItem(PENDING, JSON.stringify({ name, code: "" }));
          ctx.flash = err.message;
          location.hash = "#/join";
          await ctx.refresh();
          return;
        }
        await ctx.refresh();
        location.hash = "#/week";
      } catch (err) { v.error(err.message); }
    });
  });
}

// Signed in, but no profile yet (wrong code at sign-up, or confirmed their email first).
export function renderJoin(root, ctx) {
  const p = pendingJoin() || {};
  const v = shell(root, "Finish Joining", "Enter the league code and the name you'd like on the leaderboard.",
    `${field("name", "Display name", "text", `maxlength="40" required value="${esc(p.name || "")}"`)}
     ${field("code", "League code", "text", 'autocomplete="off" required')}
     <button class="btn btn-block" type="submit">Join</button>`,
    `<a href="#" id="join-out">Sign out</a>`);
  if (ctx.flash) { v.error(ctx.flash); ctx.flash = null; }
  $("#join-out", root).addEventListener("click", async (e) => { e.preventDefault(); await ctx.api.signOut(); await ctx.refresh(); });
  v.form.addEventListener("submit", (e) => {
    e.preventDefault();
    v.error("");
    submitting(v.form, async () => {
      try {
        await ctx.api.joinLeague($("#code", root).value.trim(), $("#name", root).value.trim());
        clearPendingJoin();
        await ctx.refresh();
        location.hash = "#/week";
      } catch (err) { v.error(err.message); }
    });
  });
}

export function renderForgot(root, ctx) {
  const v = shell(root, "Reset Your Password", "We'll email you a link to choose a new one.",
    `${field("email", "Email", "email", 'autocomplete="email" required')}
     <button class="btn btn-block" type="submit">Send Reset Link</button>`,
    `<a href="#/signin">Back to sign in</a>`);
  v.form.addEventListener("submit", (e) => {
    e.preventDefault();
    v.error("");
    submitting(v.form, async () => {
      try {
        await ctx.api.sendReset($("#email", root).value.trim());
        v.ok("If that email belongs to a member, a reset link is on its way.");
      } catch (err) { v.error(err.message); }
    });
  });
}

export function renderReset(root, ctx) {
  const v = shell(root, "Choose a New Password", "",
    `${field("password", "New password", "password", 'autocomplete="new-password" minlength="8" required')}
     ${field("confirm", "Confirm password", "password", 'autocomplete="new-password" required')}
     <button class="btn btn-block" type="submit">Save Password</button>`);
  v.form.addEventListener("submit", (e) => {
    e.preventDefault();
    v.error("");
    const pw = $("#password", root).value;
    if (pw.length < 8) return v.error("Passwords need at least 8 characters.");
    if (pw !== $("#confirm", root).value) return v.error("Those passwords don't match.");
    submitting(v.form, async () => {
      try {
        await ctx.api.updatePassword(pw);
        await ctx.refresh();
        location.hash = "#/week";
      } catch (err) { v.error(err.message); }
    });
  });
}
