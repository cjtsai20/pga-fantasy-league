// Race to the FedEx Cup careers: each member (or "guest") has SLOTS career slots, saved in this
// browser's localStorage after every round, match and session and, for signed-in members, also to
// their account (Supabase season_careers, one row per slot) so careers follow them to any device. When
// the two copies of a slot differ, the one further along wins (progressOf), not the most recent save.

const VERSION = 1;
export const SLOTS = [1, 2];
const legacyKey = (userId) => `pg-season:${userId || "guest"}`;  // before slots: becomes slot 1
const key = (userId, slot) => `${legacyKey(userId)}:${slot}`;
const activeKey = (userId) => `pg-season-active:${userId || "guest"}`;
const PHASE = { regular: 0, playoffs: 1, cup: 2, done: 3 };

const read = (k) => { try { const c = JSON.parse(localStorage.getItem(k) || "null"); return c && c.v === VERSION ? c : null; } catch { return null; } };

export function loadCareer(userId, slot = 1) {
  const c = read(key(userId, slot));
  if (c || slot !== 1) return c;
  const old = read(legacyKey(userId));  // a career saved before slots existed moves into slot 1
  if (old) {
    try { localStorage.setItem(key(userId, 1), JSON.stringify(old)); localStorage.removeItem(legacyKey(userId)); } catch { /* keep reading it */ }
  }
  return old;
}

export function saveCareer(userId, career, slot = 1) {
  career.v = VERSION;
  career.savedAt = new Date().toISOString();
  try { localStorage.setItem(key(userId, slot), JSON.stringify(career)); return true; }
  catch { return false; }  // storage full or blocked: the career keeps going for this visit
}

export function clearCareer(userId, slot = 1) {
  localStorage.removeItem(key(userId, slot));
  if (slot === 1) localStorage.removeItem(legacyKey(userId));
}

/** The slot last played on this browser (null if none). */
export function activeSlot(userId) {
  const v = Number(localStorage.getItem(activeKey(userId)));
  return SLOTS.includes(v) ? v : null;
}
export function setActiveSlot(userId, slot) {
  try { slot ? localStorage.setItem(activeKey(userId), String(slot)) : localStorage.removeItem(activeKey(userId)); } catch { /* ignore */ }
}

/**
 * Other careers saved in this browser under a different slot (played as a guest, in the preview, or
 * before signing in), so a member can bring one into their account: [{slot, career}].
 */
export function otherLocalCareers(userId) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith("pg-season:") || k === legacyKey(userId) || SLOTS.some((s) => k === key(userId, s))) continue;
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

/** Every career saved to this member's account: {slot: career} (empty if the table isn't set up). */
export async function cloudLoadAll(supabase) {
  if (!supabase) return {};
  try {
    const { data, error } = await supabase.from("season_careers").select("slot, career");
    if (error) return {};
    return Object.fromEntries((data || []).filter((r) => r.career?.v === VERSION).map((r) => [r.slot ?? 1, r.career]));
  } catch { return {}; }
}

export async function cloudSave(supabase, career, slot = 1) {
  if (!supabase || !career) return false;
  try {
    const { error } = await supabase.from("season_careers")
      .upsert({ slot, career: strip(career), progress: progressOf(career) }, { onConflict: "user_id,slot" });
    return !error;
  } catch { return false; }
}

export async function cloudClear(supabase, slot = 1) {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getUser();
    if (data?.user) await supabase.from("season_careers").delete().eq("user_id", data.user.id).eq("slot", slot);
  } catch { /* offline: the row is replaced by the next career's first save only if further along */ }
}

/**
 * Saves to the account a moment after the last change (careers save after every hole), and right
 * away when the tab is hidden or closed.
 */
export function cloudSaver(supabase, getCareer, getSlot, onStatus = () => {}) {
  if (!supabase) return { schedule() {}, flush: async () => false };
  let timer = null;
  const flush = async () => {
    clearTimeout(timer); timer = null;
    const c = getCareer(), slot = getSlot();
    if (!c || !slot) return false;
    const ok = await cloudSave(supabase, c, slot);
    onStatus(ok ? "saved" : "error");
    return ok;
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && timer) flush(); });
  return { schedule() { clearTimeout(timer); timer = setTimeout(flush, 1500); onStatus("pending"); }, flush };
}
