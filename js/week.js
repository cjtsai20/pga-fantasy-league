// This Week's Golfers: event card + lock countdown; before lock, pick two from the field (and the
// bonus pick where there is one); after lock, every member's golfers with live position and points.
import { SEASON } from "./config.js";
import { $, $$, esc, avatar, countdown, currentTournament, emptyState, eventBadge, eventName, fmtDates, fmtLock,
  pts, rank, toast } from "./ui.js";

export async function render(root, ctx, params) {
  const { api, user, tournaments } = ctx;
  if (!tournaments.length) {
    root.innerHTML = emptyState("The schedule is on its way", "Tournaments appear here once the daily refresh loads the season.");
    return;
  }
  const t = tournaments.find((x) => x.id === params[0]) || currentTournament(tournaments, api.now());
  const isLocked = () => api.now() >= new Date(t.lock_at);
  const [field, mine, results] = await Promise.all([api.field(t.id), api.myPicks(user.id), api.results(t.id)]);
  const locked = isLocked();
  const board = locked ? await api.pickScores({ tournament_id: t.id }) : [];

  const options = tournaments.map((x) => `<option value="${esc(x.id)}" ${x.id === t.id ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  root.innerHTML = `
    <div class="page-head">
      <div><p class="eyebrow">This Week's Golfers</p><h1 class="page-title">${eventName(t)}</h1></div>
      <label class="select-wrap"><span class="sr-only">Tournament</span><select id="t-select">${options}</select></label>
    </div>
    ${eventCard(t, locked)}
    <div id="week-body"></div>`;
  $("#t-select", root).addEventListener("change", (e) => { location.hash = `#/week/${e.target.value}`; });

  const tick = () => {
    const el = $("#lock-count", root);
    if (!el) return;
    const left = new Date(t.lock_at) - api.now();
    el.textContent = countdown(left);
    if (left <= 0 && !locked) { ctx.rerender(); }
  };
  tick();
  ctx.onCleanup(clearInterval.bind(null, setInterval(tick, 1000)));

  const body = $("#week-body", root);
  if (locked) renderBoard(body, ctx, t, board, field);
  else renderPicker(body, ctx, t, field, mine, results);
}

function eventCard(t, locked) {
  const status = t.status === "official" ? "Final results" : locked ? "Picks locked · Tournament underway" : "Picks close in";
  return `
    <article class="event-card">
      <div class="event-crest" aria-hidden="true"><svg viewBox="0 0 40 40"><use href="#flag-mark"/></svg></div>
      <div class="event-meta">
        ${eventBadge(t.event_type)}
        <p class="event-dates">${fmtDates(t.start_date, t.end_date)}</p>
        <p class="event-course">${esc(t.course_name || "")}${t.location ? ` · ${esc(t.location)}` : ""}</p>
      </div>
      <div class="event-lock ${locked ? "is-locked" : ""}">
        <p class="lock-label">${status}</p>
        ${locked ? `<p class="lock-time">Locked ${fmtLock(t.lock_at)}</p>`
                 : `<p class="lock-count" id="lock-count" aria-live="off"></p><p class="lock-time">${fmtLock(t.lock_at)}</p>`}
      </div>
    </article>`;
}

// ------------------------------------------------------------------------ before lock
function renderPicker(body, ctx, t, field, mine, results) {
  const { api } = ctx;
  const here = mine.filter((p) => p.tournament_id === t.id);
  const bySlot = Object.fromEntries(here.map((p) => [p.slot, p]));
  const usedElsewhere = new Map(mine.filter((p) => p.slot !== "bonus" && p.tournament_id !== t.id)
    .map((p) => [p.player_id, ctx.tournaments.find((x) => x.id === p.tournament_id)?.name || "earlier event"]));
  const pickedHere = new Set(here.filter((p) => p.slot !== "bonus").map((p) => p.player_id));
  const full = bySlot["1"] && bySlot["2"];
  const ams = field.filter((f) => f.is_amateur);

  const slotCard = (slot, label) => {
    const p = bySlot[slot];
    return `<div class="slot ${p ? "is-filled" : ""}">
      <p class="slot-label">${label}</p>
      ${p ? `${avatar(p.player_name, p.headshot_url, "lg")}
             <p class="slot-name">${esc(p.player_name)}</p>
             <button class="btn-link" data-remove="${p.id}">Remove</button>`
          : `<div class="slot-empty" aria-hidden="true">${avatar("", null, "lg")}</div><p class="slot-name muted">Choose from the field</p>`}
    </div>`;
  };

  const bonus = t.bonus_label ? `
    <div class="slot slot-bonus ${bySlot.bonus ? "is-filled" : ""}">
      <p class="slot-label">Bonus · ${esc(t.bonus_label)}</p>
      ${bySlot.bonus
        ? `${avatar(bySlot.bonus.player_name, bySlot.bonus.headshot_url, "lg")}<p class="slot-name">${esc(bySlot.bonus.player_name)}</p>
           <button class="btn-link" data-remove="${bySlot.bonus.id}">Remove</button>`
        : `<form id="bonus-form" class="bonus-form">
             <label class="sr-only" for="bonus-name">${esc(t.bonus_label)}</label>
             <input id="bonus-name" list="bonus-list" placeholder="Type a name" required maxlength="60" autocomplete="off">
             <datalist id="bonus-list">${ams.map((a) => `<option value="${esc(a.player_name)}">`).join("")}</datalist>
             <button class="btn btn-small" type="submit">Save</button>
           </form><p class="slot-hint">Scored by the commissioner after the event.</p>`}
    </div>` : "";

  // No field pasted yet: field is the whole master list (1,200+ golfers), so draw rows only for a search.
  const master = field.length > 0 && field[0].from_master;
  const rowHtml = (f) => {
    const used = usedElsewhere.get(f.player_id);
    const picked = pickedHere.has(f.player_id);
    const tags = [f.is_amateur ? `<span class="tag">Amateur</span>` : "",
      !f.fedex_eligible && !f.is_amateur ? `<span class="tag" title="Not a FedEx Cup member: earns the points their finishing position pays">Position points</span>` : ""].join("");
    let action;
    if (picked) action = `<span class="row-state is-picked">Selected</span>`;
    else if (used) action = `<span class="row-state">Already selected (${esc(used)})</span>`;
    else if (f.is_amateur) action = `<span class="row-state">Amateur · no FedEx points</span>`;
    else action = `<button class="btn btn-small" data-pick="${esc(f.player_id)}" ${full ? "disabled" : ""}>Select</button>`;
    return `<li class="field-row ${used || picked ? "is-used" : ""}" data-name="${esc(f.player_name.toLowerCase())}">
      ${avatar(f.player_name, f.headshot_url, "sm")}
      <span class="field-name">${esc(f.player_name)} ${tags}</span>
      <span class="field-action">${action}</span>
    </li>`;
  };
  const rows = master ? "" : field.map(rowHtml).join("");

  body.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Your Selections</h2><p class="muted">Two golfers. Each golfer can be used once all season.</p></div>
      <div class="slots">${slotCard("1", "First golfer")}${slotCard("2", "Second golfer")}${bonus}</div>
      <p class="form-error" id="pick-error" role="alert"></p>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>The Field</h2>
        <p class="muted">${master ? "The field isn't posted yet, so any tour golfer can be picked. Search by name." : field.length ? `${field.length} golfers` : "The field is announced the Friday before the event."}${full ? " · Remove a golfer to change your selections." : ""}</p>
      </div>
      ${field.length ? `<input type="search" id="field-search" class="search" placeholder="${master ? "Search every tour golfer" : "Search the field"}" aria-label="Search golfers">
        <ul class="field-list" id="field-list">${rows}</ul>`
        : emptyState("Field not yet available")}
    </section>`;

  const err = $("#pick-error", body);
  const run = async (fn) => {
    err.textContent = "";
    try { await fn(); ctx.rerender(); } catch (e) { err.textContent = e.message; toast(e.message, "error"); }
  };

  $("#field-list", body)?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    const f = field.find((x) => x.player_id === b.dataset.pick);
    const slot = bySlot["1"] ? "2" : "1";
    b.disabled = true;
    run(async () => {
      await api.addPick({ tournament_id: t.id, season: SEASON, slot, player_id: f.player_id,
        player_name: f.player_name, headshot_url: f.headshot_url });
      toast(`${f.player_name} selected for ${t.name}.`);
    }).finally(() => { b.disabled = false; });
  });
  $$("[data-remove]", body).forEach((b) => b.addEventListener("click", () =>
    run(() => api.removePick(Number(b.dataset.remove)))));
  $("#bonus-form", body)?.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#bonus-name", body).value.trim();
    if (!name) return;
    const am = ams.find((a) => a.player_name.toLowerCase() === name.toLowerCase());
    run(() => api.addPick({ tournament_id: t.id, season: SEASON, slot: "bonus",
      player_id: am ? am.player_id : `bonus:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      player_name: am ? am.player_name : name, headshot_url: am?.headshot_url ?? null }));
  });
  const search = $("#field-search", body);
  search?.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    if (master) {
      const hits = q.length < 2 ? [] : field.filter((f) => f.player_name.toLowerCase().includes(q)).slice(0, 40);
      $("#field-list", body).innerHTML = hits.map(rowHtml).join("");
      return;
    }
    $$(".field-row", body).forEach((li) => { li.hidden = q && !li.dataset.name.includes(q); });
  });
}

// ------------------------------------------------------------------------ after lock
function renderBoard(body, ctx, t, board, field) {
  const shots = Object.fromEntries(field.map((f) => [f.player_id, f.headshot_url]));
  const byUser = new Map(ctx.profiles.map((p) => [p.id, { name: p.display_name, id: p.id, picks: [], total: 0 }]));
  for (const s of board) {
    const m = byUser.get(s.user_id) || { name: s.display_name, id: s.user_id, picks: [], total: 0 };
    m.picks.push(s);
    m.total += Number(s.points || 0);
    byUser.set(s.user_id, m);
  }
  const members = rank([...byUser.values()]);
  const projected = board.some((s) => s.is_projected);

  const golfer = (s) => s ? `
    <div class="golfer ${s.position === "1" ? "is-winner" : ""}">
      ${avatar(s.player_name, s.headshot_url || shots[s.player_id], "lg")}
      <p class="golfer-name">${esc(s.player_name)}</p>
      <p class="golfer-line"><span class="pos">${esc(s.position || "–")}</span><span class="golfer-pts">${pts(s.points)}${s.is_projected ? `<abbr title="Projected">*</abbr>` : ""}</span></p>
    </div>` : `<div class="golfer is-none">${avatar("N A", null, "lg")}<p class="golfer-name muted">No pick</p><p class="golfer-line"><span class="golfer-pts">0</span></p></div>`;

  body.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Members' Selections</h2>
        <p class="muted">${projected ? "* Projected FedEx Cup points, updated daily while the tournament is played." : "Official FedEx Cup points."}</p></div>
      <div class="member-grid">
        ${members.map((m) => {
          const one = m.picks.find((p) => p.slot === "1"), two = m.picks.find((p) => p.slot === "2"), bonus = m.picks.find((p) => p.slot === "bonus");
          return `<article class="member-card ${m.id === ctx.user.id ? "is-me" : ""}">
            <header><span class="member-rank">${m.rankLabel}</span><h3>${esc(m.name)}</h3><span class="member-total">${pts(m.total)}</span></header>
            <div class="golfers">${golfer(one)}${golfer(two)}</div>
            ${bonus ? `<p class="member-bonus">${esc(t.bonus_label || "Bonus")}: <b>${esc(bonus.player_name)}</b> · ${bonus.points || t.status === "official" ? pts(bonus.points) : "awaiting score"}</p>` : ""}
          </article>`;
        }).join("")}
      </div>
    </section>`;
}
