// Race to the FedEx Cup careers: saved in this browser's localStorage (one per signed-in member, or
// "guest") after every round, match and session, and, for signed-in members, also to their account
// (Supabase season_careers) so the career follows them to any device. When the two copies differ, the
// one further along wins (progressOf), not the most recently saved.

const VERSION = 1;
const key = (userId) => `pg-season:${userId || "guest"}`;
const PHASE = { regular: 0, playoffs: 1, cup: 2, done: 3 };

export function loadCareer(userId) {
  try {
    const c = JSON.parse(localStorage.getItem(key(userId)) || "null");
    return c && c.v === VERSION ? c : null;
  } catch { return null; }
}

export function saveCareer(userId, career) {
  career.v = VERSION;
  career.savedAt = new Date().toISOString();
  try { localStorage.setItem(key(userId), JSON.stringify(career)); return true; }
  catch { return false; }  // storage full or blocked: the career keeps going for this visit
}

export function clearCareer(userId) { localStorage.removeItem(key(userId)); }

/**
 * Other careers saved in this browser under a different slot (played as a guest, in the preview, or
 * before signing in), so a member can bring one into their account: [{slot, career}].
 */
export function otherLocalCareers(userId) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith("pg-season:") || k === key(userId)) continue;
      const c = JSON.parse(localStorage.getItem(k) || "null");
      if (c && c.v === VERSION) out.push({ slot: k, career: c });
    }
  } catch { /* storage blocked */ }
  return out;
}

/**
 * How far along a career is, as one sortable number: season, then phase (regular season, playoffs,
 * cup, done), then week, then holes played in the live event or matches finished in the playoffs/cup
 * (plus holes into the user's own match).
 */
export function progressOf(c) {
  if (!c) return -1;
  const matchHoles = c.userMatch?.state?.holes?.length || 0;
  let sub = 0;
  if (c.phase === "regular") {
    const live = Object.values(c.events || {}).find((e) => e.status === "live");
    sub = live?.user ? live.user.reduce((n, r) => n + r.length, 0) : 0;
    sub += Object.values(c.events || {}).filter((e) => e.status === "done").length * 100;  // opposite-field weeks
  } else if (c.phase === "playoffs") {
    sub = (c.playoffs?.rounds || []).flat().filter((m) => m?.res).length * 100 + matchHoles;
  } else if (c.phase === "cup") {
    sub = (c.cup?.sessions || []).flatMap((s) => s.matches || []).filter((m) => m?.res).length * 100 + matchHoles;
  }
  return (c.year - 2000) * 1e8 + (PHASE[c.phase] ?? 0) * 1e7 + (c.weekIdx || 0) * 1e5 + Math.min(sub, 99999);
}

/** The further-along of two copies (ties: the later save). */
export function furtherAlong(a, b) {
  const pa = progressOf(a), pb = progressOf(b);
  if (pa !== pb) return pa > pb ? a : b;
  return (a?.savedAt || "") >= (b?.savedAt || "") ? a : b;
}

// ---------------------------------------------------------------- account copy (Supabase)
const strip = (c) => { const { _sk, _skWeek, _shape, ...rest } = c; return rest; };

/** The career saved to this member's account, or null (also null if the table isn't set up yet). */
export async function cloudLoad(supabase) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from("season_careers").select("career").maybeSingle();
    if (error) return null;
    return data?.career && data.career.v === VERSION ? data.career : null;
  } catch { return null; }
}

export async function cloudSave(supabase, career) {
  if (!supabase || !career) return false;
  try {
    const { error } = await supabase.from("season_careers")
      .upsert({ career: strip(career), progress: progressOf(career) }, { onConflict: "user_id" });
    return !error;
  } catch { return false; }
}

export async function cloudClear(supabase) {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getUser();
    if (data?.user) await supabase.from("season_careers").delete().eq("user_id", data.user.id);
  } catch { /* offline: the row is replaced by the next career's first save only if further along */ }
}

/**
 * Saves to the account a moment after the last change (careers save after every hole), and right
 * away when the tab is hidden or closed.
 */
export function cloudSaver(supabase, getCareer, onStatus = () => {}) {
  if (!supabase) return { schedule() {}, flush: async () => false };
  let timer = null;
  const flush = async () => {
    clearTimeout(timer); timer = null;
    const c = getCareer();
    if (!c) return false;
    const ok = await cloudSave(supabase, c);
    onStatus(ok ? "saved" : "error");
    return ok;
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && timer) flush(); });
  return { schedule() { clearTimeout(timer); timer = setTimeout(flush, 1500); onStatus("pending"); }, flush };
}
