// ?demo=1: the whole site rendered from data/sample/ fixtures, no Supabase. Same interface as
// createApi() in api.js. Picks you make live in memory and vanish on reload. Override the demo
// clock with ?now=2027-04-05T12:00:00-04:00 to see the pre-lock picking screen.
import { loadPlayers } from "./api.js";

const load = (name) => fetch(`data/sample/${name}`, { cache: "no-cache" }).then((r) => r.json());

export async function createDemoApi() {
  const [profiles, tournaments, field, results, scores, monthly, meta] = await Promise.all(
    ["profiles", "tournaments", "field", "results", "pick_scores", "monthly_winners", "meta"].map((n) => load(`${n}.json`)));
  const params = new URLSearchParams(location.search);
  const clock = new Date(params.get("now") || "2027-04-10T15:00:00-04:00");
  const started = Date.now();
  const now = () => new Date(clock.getTime() + (Date.now() - started));
  const me = profiles.find((p) => p.id === meta.demo_user);
  const session = { user: { id: me.id, email: "demo@example.com" } };
  const tById = Object.fromEntries(tournaments.map((t) => [t.id, t]));
  let nextId = 100000;
  const locked = (tid) => now() >= new Date(tById[tid].lock_at);
  const resultFor = (tid, pid) => results.find((r) => r.tournament_id === tid && r.player_id === pid);

  return {
    demo: true,
    supabase: null,
    now,
    async session() { return session; },
    onAuth() {},
    async signUp() { return session; },
    async signIn() { return session; },
    async signOut() { alert("Demo mode: sign-out is disabled."); },
    async sendReset() {},
    async updatePassword() {},
    async joinLeague() {},
    async profile(uid) { return profiles.find((p) => p.id === uid) || null; },
    async profiles() { return profiles; },
    async tournaments() { return tournaments; },
    async field(tid) { return field.filter((f) => f.tournament_id === tid); },
    async results(tid) { return results.filter((r) => r.tournament_id === tid); },
    async myPicks(uid) {
      return scores.filter((s) => s.user_id === uid).map((s) => ({ ...s, id: s.pick_id }));
    },
    async pickScores(filter = {}) {
      return scores.filter((s) => (s.user_id === me.id || locked(s.tournament_id))
        && (!filter.tournament_id || s.tournament_id === filter.tournament_id)
        && (!filter.month || s.month === filter.month))
        .map((s) => ({ ...s, points: s.slot === "bonus" ? (s.bonus_points ?? 0) : s.points }));
    },
    async addPick(p) {  // mirrors picks_guard() in schema.sql, including its messages
      const t = tById[p.tournament_id];
      if (locked(t.id)) throw new Error(`Picks for ${t.name} are locked.`);
      if (scores.some((s) => s.user_id === me.id && s.tournament_id === t.id && s.slot === p.slot))
        throw new Error('duplicate key value violates unique constraint "picks_user_id_tournament_id_slot_key"');
      if (p.slot !== "bonus") {
        if (!field.some((f) => f.tournament_id === t.id && f.player_id === p.player_id))
          throw new Error(`${p.player_name} is not in the field for ${t.name}.`);
        const dup = scores.find((s) => s.user_id === me.id && s.player_id === p.player_id && s.slot !== "bonus");
        if (dup) throw new Error(`You have already selected ${p.player_name} this season (${dup.tournament_name}).`);
      }
      const r = resultFor(t.id, p.player_id) || {};
      const row = { ...p, pick_id: nextId++, user_id: me.id, display_name: me.display_name, tournament_name: t.name,
        month: t.month, season: t.season, event_type: t.event_type, status: t.status, position: r.position ?? null,
        points: r.points ?? 0, is_projected: r.is_projected ?? true, bonus_points: null };
      scores.push(row);
      return { ...row, id: row.pick_id };
    },
    async removePick(id) {
      const i = scores.findIndex((s) => s.pick_id === id);
      if (i < 0) return;
      if (locked(scores[i].tournament_id)) throw new Error(`Picks for ${scores[i].tournament_name} are locked.`);
      scores.splice(i, 1);
    },
    async setBonusPoints(id, points) {
      const s = scores.find((x) => x.pick_id === id);
      if (s) s.bonus_points = points;
    },
    // commissioner tools preview only: nothing is written in the demo
    players: () => loadPlayers(),
    async saveResults() { throw new Error("Demo mode: results are previewed, not saved."); },
    async finalize() { throw new Error("Demo mode: nothing is saved."); },
    async reopen() { throw new Error("Demo mode: nothing is saved."); },
    async saveField() { throw new Error("Demo mode: the field is previewed, not saved."); },
    async lastResultsUpdate() { return null; },
    async monthlyWinners() { return monthly; },
    async staticJson(name) {
      const r = await fetch(`data/sample/${name}`, { cache: "no-cache" });
      return r.ok ? r.json() : null;
    },
  };
}
