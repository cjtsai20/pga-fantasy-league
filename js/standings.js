// Season leaderboard, monthly leaderboard, season history (monthly winners) and winners selected.
// All built from pick_scores, which only shows other members' picks once a tournament locks.
import { $, avatar, emptyState, esc, eventName, monthName, monthShort, pts, rank, todayET } from "./ui.js";

const shortName = (n) => n.replace(/^the\s+/i, "").replace(/ (Championship|Tournament|Invitational|Classic|Open)$/i, "")
  .split(/\s+/).slice(0, 2).join(" ");

function totals(ctx, scores, keyFn) {
  const m = new Map(ctx.profiles.map((p) => [p.id, { id: p.id, name: p.display_name, total: 0, by: {}, wins: 0 }]));
  for (const s of scores) {
    if (!m.has(s.user_id)) m.set(s.user_id, { id: s.user_id, name: s.display_name, total: 0, by: {}, wins: 0 });
    const r = m.get(s.user_id), k = keyFn(s), v = Number(s.points || 0);
    r.total += v;
    r.by[k] = (r.by[k] || 0) + v;
    if (s.slot !== "bonus" && s.position === "1" && !s.is_projected) r.wins += 1;
  }
  return rank([...m.values()]);
}

const projectedNote = (scores) => scores.some((s) => s.is_projected)
  ? `<p class="board-note">Includes projected points from tournaments still in progress.</p>` : "";

// ------------------------------------------------------------------------ season
export async function renderSeason(root, ctx) {
  const scores = await ctx.api.pickScores();
  const months = [...new Set(ctx.tournaments.map((t) => t.month))].filter((m) => scores.some((s) => s.month === m));
  const rows = totals(ctx, scores, (s) => s.month);
  root.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">${ctx.season} Season</p><h1 class="page-title">Season Leaderboard</h1></div></div>
    ${scores.length ? `
    <div class="board-wrap">
      <table class="board">
        <caption class="sr-only">Season standings</caption>
        <thead><tr><th class="c-pos">Pos</th><th class="c-name">Member</th>
          ${months.map((m) => `<th class="c-num c-month">${monthShort(m)}</th>`).join("")}
          <th class="c-num" title="Tournament winners selected">Wins</th><th class="c-num c-total">Total</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr class="${r.id === ctx.user.id ? "is-me" : ""} ${r.rank === 1 ? "is-leader" : ""}">
            <td class="c-pos"><span class="tile">${r.rankLabel}</span></td>
            <td class="c-name">${esc(r.name)}</td>
            ${months.map((m) => `<td class="c-num c-month">${pts(r.by[m] || 0)}</td>`).join("")}
            <td class="c-num">${r.wins || "–"}</td>
            <td class="c-num c-total"><span class="tile tile-wide">${pts(r.total)}</span></td>
          </tr>`).join("")}</tbody>
      </table>
    </div>${projectedNote(scores)}` : emptyState("No points yet", "The leaderboard fills in once the first tournament locks.")}`;
}

// ------------------------------------------------------------------------ monthly
export async function renderMonthly(root, ctx, params) {
  const today = todayET(ctx.api.now());
  const months = [...new Set(ctx.tournaments.filter((t) => t.start_date <= today).map((t) => t.month))];
  if (!months.length) {
    root.innerHTML = `<div class="page-head"><div><p class="eyebrow">Monthly</p><h1 class="page-title">Monthly Leaderboard</h1></div></div>
      ${emptyState("The season hasn't started", "Monthly standings begin with the first tournament.")}`;
    return;
  }
  const month = months.includes(params[0]) ? params[0] : months[months.length - 1];
  const [scores, winners] = await Promise.all([ctx.api.pickScores({ month }), ctx.api.monthlyWinners()]);
  const events = ctx.tournaments.filter((t) => t.month === month);
  const rows = totals(ctx, scores, (s) => s.tournament_id);
  const champs = winners.filter((w) => w.month === month);
  root.innerHTML = `
    <div class="page-head">
      <div><p class="eyebrow">Monthly</p><h1 class="page-title">${monthName(month)}</h1></div>
      <label class="select-wrap"><span class="sr-only">Month</span>
        <select id="m-select">${months.map((m) => `<option value="${m}" ${m === month ? "selected" : ""}>${monthName(m)}</option>`).join("")}</select></label>
    </div>
    ${champs.length ? `<div class="champ-banner"><span class="champ-label">${champs.length > 1 ? "Co-winners" : "Month winner"}</span>
        <span class="champ-name">${champs.map((c) => esc(c.display_name)).join(" & ")}</span><span class="champ-pts">${pts(champs[0].points)} pts</span></div>` : ""}
    ${scores.length ? `
    <div class="board-wrap">
      <table class="board">
        <caption class="sr-only">${monthName(month)} standings</caption>
        <thead><tr><th class="c-pos">Pos</th><th class="c-name">Member</th>
          ${events.map((t) => `<th class="c-num c-event" title="${esc(t.name)}">${eventName({ ...t, name: shortName(t.name) })}</th>`).join("")}
          <th class="c-num c-total">Total</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr class="${r.id === ctx.user.id ? "is-me" : ""} ${r.rank === 1 ? "is-leader" : ""}">
            <td class="c-pos"><span class="tile">${r.rankLabel}</span></td>
            <td class="c-name">${esc(r.name)}</td>
            ${events.map((t) => `<td class="c-num c-event">${t.id in r.by ? pts(r.by[t.id]) : `<span class="muted">${t.start_date > today ? "" : "N/A"}</span>`}</td>`).join("")}
            <td class="c-num c-total"><span class="tile tile-wide">${pts(r.total)}</span></td>
          </tr>`).join("")}</tbody>
      </table>
    </div>${projectedNote(scores)}` : emptyState("No points this month yet")}`;
  $("#m-select", root).addEventListener("change", (e) => { location.hash = `#/monthly/${e.target.value}`; });
}

// ------------------------------------------------------------------------ history
export async function renderHistory(root, ctx) {
  const winners = await ctx.api.monthlyWinners();
  const byMonth = new Map();
  for (const w of winners) byMonth.set(w.month, [...(byMonth.get(w.month) || []), w]);
  const done = ctx.tournaments.length && ctx.tournaments.every((t) => t.status === "official");
  let champion = "";
  if (done) {
    const rows = totals(ctx, await ctx.api.pickScores(), () => "all").filter((r) => r.rank === 1);
    champion = `<div class="season-champ"><p class="eyebrow">${ctx.season} Season Champion</p>
      <h2>${rows.map((r) => esc(r.name)).join(" & ")}</h2><p class="muted">${pts(rows[0]?.total)} points</p></div>`;
  }
  root.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">${ctx.season} Season</p><h1 class="page-title">Season History</h1></div></div>
    ${champion}
    ${byMonth.size ? `<ol class="history">${[...byMonth.entries()].map(([m, ws]) => `
      <li class="history-item">
        <div class="history-month">${monthName(m)}</div>
        <div class="history-trophy" aria-hidden="true"><svg viewBox="0 0 40 40"><use href="#trophy-mark"/></svg></div>
        <div class="history-winner"><p class="history-name">${ws.map((w) => esc(w.display_name)).join(" & ")}</p>
          <p class="muted">${ws.length > 1 ? "Tied · " : ""}${pts(ws[0].points)} points</p></div>
      </li>`).join("")}</ol>`
      : emptyState("No months complete yet", "Each month's winner is recorded here the morning after its last tournament is official.")}`;
}

// ------------------------------------------------------------------------ winners selected
export async function renderWinners(root, ctx) {
  const scores = await ctx.api.pickScores();
  const wins = scores.filter((s) => s.slot !== "bonus" && s.position === "1" && !s.is_projected);
  const order = Object.fromEntries(ctx.tournaments.map((t, i) => [t.id, i]));
  wins.sort((a, b) => order[b.tournament_id] - order[a.tournament_id]);
  root.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">Hall of Champions</p><h1 class="page-title">Winners Selected</h1></div></div>
    ${wins.length ? `<div class="winner-grid">${wins.map((w) => {
      const t = ctx.tournaments.find((x) => x.id === w.tournament_id) || { name: w.tournament_name, event_type: w.event_type };
      return `<article class="winner-card">
        ${avatar(w.player_name, w.headshot_url, "xl")}
        <p class="winner-golfer">${esc(w.player_name)}</p>
        <p class="winner-event">${eventName(t)}</p>
        <div class="winner-rule"></div>
        <p class="winner-member">Selected by <b>${esc(w.display_name)}</b></p>
        <p class="winner-pts">${pts(w.points)} pts</p>
      </article>`;
    }).join("")}</div>`
      : emptyState("No winners selected yet", "When a member picks the champion, they're honored here.")}`;
}
