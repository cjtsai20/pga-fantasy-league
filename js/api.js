// Data access for the live site. js/demo.js implements the same interface from fixtures, so views
// never talk to Supabase directly.
import { SEASON } from "./config.js";

let playersCache = null;
/** data/players.json (master golfer list), shared by both APIs. */
export async function loadPlayers(base = "data/") {
  if (!playersCache) {
    const r = await fetch(`${base}players.json`, { cache: "no-cache" });
    playersCache = r.ok ? await r.json() : {};
  }
  return playersCache;
}
/** Until the commissioner pastes a field, members can pick any golfer on the master list. */
export const masterField = (tid, players) => Object.entries(players)
  .map(([id, p]) => ({ tournament_id: tid, player_id: id, player_name: p.name, is_amateur: false,
    fedex_eligible: true, headshot_url: null, from_master: true }));

const fail = (error) => { if (error) throw new Error(error.message); };

export function createApi(sb) {
  return {
    demo: false,
    supabase: sb,
    now: () => new Date(),

    // ---- auth
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    onAuth(cb) { sb.auth.onAuthStateChange((event, session) => cb(event, session)); },
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password });
      fail(error);
      return data.session;  // null when Supabase still requires email confirmation
    },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      fail(error);
      return data.session;
    },
    async signOut() { fail((await sb.auth.signOut()).error); },
    async sendReset(email) {
      const redirectTo = location.origin + location.pathname;
      fail((await sb.auth.resetPasswordForEmail(email, { redirectTo })).error);
    },
    async updatePassword(password) { fail((await sb.auth.updateUser({ password })).error); },
    async joinLeague(code, name) { fail((await sb.rpc("join_league", { p_code: code, p_display_name: name })).error); },

    // ---- members
    async profile(uid) {
      const { data, error } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
      fail(error);
      return data;
    },
    async profiles() {
      const { data, error } = await sb.from("profiles").select("id, display_name, is_admin").order("display_name");
      fail(error);
      return data;
    },

    // ---- reference data
    async tournaments() {
      const { data, error } = await sb.from("tournaments").select("*").eq("season", SEASON).order("start_date");
      fail(error);
      return data;
    },
    async field(tid, { raw = false } = {}) {
      const { data, error } = await sb.from("field").select("*").eq("tournament_id", tid).order("player_name");
      fail(error);
      if (data.length || raw) return data;
      return masterField(tid, await loadPlayers());
    },
    async results(tid) {
      const { data, error } = await sb.from("results").select("*").eq("tournament_id", tid);
      fail(error);
      return data;
    },

    // ---- picks
    async myPicks(uid) {
      const { data, error } = await sb.from("picks").select("*").eq("user_id", uid).eq("season", SEASON);
      fail(error);
      return data;
    },
    async pickScores(filter = {}) {
      let q = sb.from("pick_scores").select("*").eq("season", SEASON);
      if (filter.tournament_id) q = q.eq("tournament_id", filter.tournament_id);
      if (filter.month) q = q.eq("month", filter.month);
      const { data, error } = await q;
      fail(error);
      return data;
    },
    async addPick(pick) {
      const { data, error } = await sb.from("picks").insert(pick).select().single();
      fail(error);
      return data;
    },
    async removePick(id) { fail((await sb.from("picks").delete().eq("id", id)).error); },
    async setBonusPoints(id, points) {
      fail((await sb.from("picks").update({ bonus_points: points }).eq("id", id)).error);
    },

    // ---- commissioner: pasted results and fields (RLS: admins only)
    players: () => loadPlayers(),
    async saveResults(tid, rows, { final = false, wasOfficial = false } = {}) {
      fail((await sb.from("results").delete().eq("tournament_id", tid)).error);
      if (rows.length) {
        const stamp = new Date().toISOString();
        fail((await sb.from("results").insert(rows.map((r) => ({ ...r, tournament_id: tid, is_projected: !final, updated_at: stamp })))).error);
      }
      if (final) fail((await sb.rpc("finalize_tournament", { p_tournament_id: tid })).error);
      else if (wasOfficial) fail((await sb.rpc("reopen_tournament", { p_tournament_id: tid })).error);
    },
    async finalize(tid) { fail((await sb.rpc("finalize_tournament", { p_tournament_id: tid })).error); },
    async reopen(tid) { fail((await sb.rpc("reopen_tournament", { p_tournament_id: tid })).error); },
    async saveField(tid, rows) {
      fail((await sb.from("field").delete().eq("tournament_id", tid)).error);
      if (rows.length) fail((await sb.from("field").insert(rows.map((r) => ({ ...r, tournament_id: tid })))).error);
    },
    async lastResultsUpdate() {
      const { data, error } = await sb.from("results").select("updated_at").order("updated_at", { ascending: false }).limit(1);
      fail(error);
      return data[0]?.updated_at ?? null;
    },

    async monthlyWinners() {
      const { data, error } = await sb.from("monthly_winners").select("*").eq("season", SEASON).order("month");
      fail(error);
      return data;
    },

    // ---- static JSON written by the daily Action
    async staticJson(name) {
      const r = await fetch(`data/${name}`, { cache: "no-cache" });
      if (!r.ok) return null;
      return r.json();
    },
  };
}
