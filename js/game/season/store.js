// Race to the FedEx Cup careers live in this browser's localStorage, one per signed-in member (or
// "guest"). The whole career is saved after every round, match and session, so a refresh resumes.

const VERSION = 1;
const key = (userId) => `pg-season:${userId || "guest"}`;

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
