// Commissioner tools: paste a leaderboard -> scored results, paste the field, score bonus picks.
// Results are FedEx-equivalent points by finishing position (js/points.js); the standings apply
// the event's points_multiplier (majors 1.25x) in the pick_scores view.
import { $, $$, emptyState, esc, eventName, fmtStamp, pts, toast } from "./ui.js";
import { loadPointsTables } from "./points.js";
import { buildNameIndex, newGolferId, normName, parseField, parseResults, scoreRows } from "./parse_results.js";

const STYLE = `
.ap-grid { display: grid; gap: 28px; }
.ap-paste { width: 100%; min-height: 170px; font: 13px/1.45 ui-monospace, Consolas, monospace; padding: 12px;
  border: 1px solid var(--rule, #d8d2c2); border-radius: 4px; background: #fff; resize: vertical; }
.ap-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 12px 0 4px; }
.ap-actions label { font-size: 14px; display: inline-flex; gap: 6px; align-items: center; }
.ap-status { font-size: 14px; color: var(--muted, #6b6b63); margin: 0 0 12px; }
.ap-status b { color: var(--green-800, #0b4a32); }
.ap-summary { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 14px; margin: 16px 0 8px; }
.ap-summary span b { font-variant-numeric: tabular-nums; }
.ap-warn { background: #fff7d6; border-left: 3px solid var(--gold, #e8b923); padding: 8px 12px; font-size: 14px; margin: 8px 0; }
.ap-scroll { max-height: 560px; overflow: auto; border: 1px solid var(--rule-soft, #ebe6d9); }
.ap-table td, .ap-table th { white-space: nowrap; font-size: 13.5px; }
.ap-table td.num, .ap-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
.ap-table thead th { position: sticky; top: 0; background: #fbf9f3; z-index: 1; }
.ap-table tr.is-picked td { background: #f1f7f2; }
.ap-table tr.is-picked td:first-child { box-shadow: inset 3px 0 0 var(--green-700, #006747); }
.ap-table tr.is-doubt td.golfer input { border-color: #c98a00; background: #fffaf0; }
.ap-table tr.is-none td.golfer input { border-color: #b00020; background: #fff5f6; }
.ap-table td.golfer input { width: 210px; max-width: none; padding: 4px 6px; border: 1px solid var(--rule, #d8d2c2); border-radius: 3px; font: inherit; }
.ap-conf { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; margin-left: 6px; color: #9a6b00; }
.ap-conf.none { color: #b00020; }
.ap-picked { font-size: 12.5px; color: var(--green-800, #0b4a32); }
.ap-mismatch { color: #b00020; font-weight: 600; }
.ap-est { color: var(--muted, #6b6b63); font-size: 11px; }
.ap-field-list { columns: 3 220px; font-size: 13.5px; margin: 10px 0 0; padding: 0; list-style: none; }
.ap-field-list li { padding: 2px 0; break-inside: avoid; }
.ap-subnav { display: flex; gap: 6px; margin: -8px 0 24px; border-bottom: 1px solid var(--rule-soft, #ebe6d9); }
.ap-subnav a { padding: 10px 16px; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; font-weight: 600;
  color: var(--muted, #6b6b63); text-decoration: none; border-bottom: 3px solid transparent; margin-bottom: -1px; }
.ap-subnav a:hover { color: var(--green-700, #006747); }
.ap-subnav a.is-on { color: var(--green-800, #0b4a32); border-bottom-color: var(--gold, #e8b923); }
`;

const injectStyle = () => {
  if (document.getElementById("admin-paste-style")) return;
  const el = document.createElement("style");
  el.id = "admin-paste-style";
  el.textContent = STYLE;
  document.head.appendChild(el);
};

// Who signed up, who finished joining, and who still owes picks for the selected event.
async function renderMembers(el, api, t) {
  let rows;
  try { rows = await api.adminMembers(t.id); } catch (e) {
    el.innerHTML = `<div class="panel-head"><h2>Roster</h2></div><p class="ap-warn">${/admin_members/.test(e.message)
      ? "Run <code>supabase/admin_members.sql</code> in the Supabase SQL Editor to turn on this list."
      : esc(e.message)}</p>`;
    return;
  }
  const joined = rows.filter((r) => r.display_name), pending = rows.filter((r) => !r.display_name);
  const owe = joined.filter((r) => r.picks_this_event < 2);
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "-");
  el.innerHTML = `
    <div class="panel-head"><h2>Roster</h2>
      <p class="muted">${joined.length} in the league${pending.length ? ` · ${pending.length} signed up without the league code` : ""}
        · ${owe.length ? `${owe.length} still need picks for ${esc(t.name)}` : `everyone has picked for ${esc(t.name)}`}</p></div>
    <div class="ap-scroll" style="max-height:420px"><table class="table ap-table" style="width:100%">
      <thead><tr><th>Member</th><th>Email</th><th>Joined</th><th>Last sign-in</th><th class="num">${esc(t.name)}</th><th class="num">Golfers used</th></tr></thead>
      <tbody>${joined.map((r) => `<tr class="${r.picks_this_event >= 2 ? "is-picked" : ""}">
        <td>${esc(r.display_name)}${r.is_admin ? ` <span class="ap-conf">admin</span>` : ""}</td>
        <td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
        <td>${day(r.joined)}</td><td>${day(r.last_sign_in)}</td>
        <td class="num">${r.picks_this_event >= 2 ? "Picked" : `<span class="ap-mismatch">${r.picks_this_event}/2</span>`}</td>
        <td class="num">${r.picks_season}</td></tr>`).join("")}
      ${pending.map((r) => `<tr><td class="muted">Not joined yet</td><td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
        <td>signed up ${day(r.signed_up)}</td><td>${day(r.last_sign_in)}</td><td class="num">-</td><td class="num">-</td></tr>`).join("")}
      </tbody></table></div>
    ${owe.length ? `<p class="ap-actions"><a class="btn btn-small" href="mailto:?bcc=${owe.map((r) => encodeURIComponent(r.email)).join(",")}&subject=${encodeURIComponent(`Picks for ${t.name}`)}">Email the ${owe.length} without picks</a></p>` : ""}`;
}

export async function render(root, ctx, params) {
  if (!ctx.profile?.is_admin) {
    root.innerHTML = emptyState("Commissioners only");
    return;
  }
  injectStyle();
  const api = ctx.api;
  const now = api.now();
  const all = ctx.tournaments;
  const started = all.filter((t) => now >= new Date(t.lock_at));
  const sub = params[0] === "members" ? "members" : "results";
  const tid = params[0] === "members" || params[0] === "results" ? params[1] : params[0];
  const t = all.find((x) => x.id === tid) || started[started.length - 1] || all[0];
  if (!t) { root.innerHTML = emptyState("No tournaments on the schedule yet"); return; }
  const head = (title) => `
    <div class="page-head">
      <div><p class="eyebrow">Commissioner</p><h1 class="page-title">${title}</h1></div>
      <label class="select-wrap"><span class="sr-only">Tournament</span><select id="a-select">
        ${all.map((x) => `<option value="${esc(x.id)}" ${x.id === t.id ? "selected" : ""}>${esc(x.name)}${x.status === "official" ? " ✓" : ""}</option>`).join("")}
      </select></label>
    </div>
    <nav class="ap-subnav" aria-label="Admin sections">
      <a href="#/admin/results/${esc(t.id)}" class="${sub === "results" ? "is-on" : ""}">Results &amp; Scoring</a>
      <a href="#/admin/members/${esc(t.id)}" class="${sub === "members" ? "is-on" : ""}">Members</a>
    </nav>`;
  const wireSelect = () => $("#a-select", root).addEventListener("change", (e) => { location.hash = `#/admin/${sub}/${e.target.value}`; });

  if (sub === "members") {
    root.innerHTML = `${head("Members")}<section class="panel" id="a-members"><p class="muted">Loading members...</p></section>`;
    wireSelect();
    await renderMembers($("#a-members", root), api, t);
    return;
  }

  const [players, , results, picks, field] = await Promise.all([
    api.players(), loadPointsTables(), api.results(t.id), api.pickScores({ tournament_id: t.id }),
    api.field(t.id, { raw: true }),
  ]);
  const realField = field.filter((f) => !f.from_master);
  const idx = buildNameIndex(players);
  const golferPicks = picks.filter((p) => p.slot !== "bonus");
  // members' golfers, by id and by name (a pick made before the field was pasted may carry another id)
  const byId = {}, byNm = {};
  golferPicks.forEach((p) => { (byId[p.player_id] ||= []).push(p.display_name); (byNm[normName(p.player_name)] ||= []).push(p.display_name); });
  const pickedFor = (r) => byId[r.matched_player_id] || byNm[normName(r.matched_name || r.name)] || null;
  const mult = Number(t.points_multiplier ?? 1);
  const lastUpd = results.reduce((m, r) => (r.updated_at && r.updated_at > m ? r.updated_at : m), "");

  root.innerHTML = `${head("Results &amp; Scoring")}
    <div class="ap-grid">
      <section class="panel">
        <div class="panel-head"><h2>${eventName(t)} · Results</h2>
          <p class="muted">Copy the leaderboard from anywhere (pgatour.com, ESPN, a spreadsheet) and paste it below.
          Points come from each golfer's finishing position, ties split, so golfers who can't earn FedEx Cup points
          (LIV players, amateurs) score what their position pays.${mult !== 1 ? ` Standings count this event at <b>${mult}×</b>.` : ""}</p></div>
        <p class="ap-status">Status: <b>${esc(t.status)}</b> · ${results.length ? `${results.length} results saved${lastUpd ? `, last updated ${fmtStamp(lastUpd)}` : ""}` : "no results saved yet"}
          · ${golferPicks.length} golfer picks by members${api.demo ? " · <b>demo: nothing is saved</b>" : ""}</p>
        <textarea id="r-paste" class="ap-paste" spellcheck="false" placeholder="POS   PLAYER   TO PAR   ...   FEDEXCUP PTS&#10;1     Scottie Scheffler   -12   ...&#10;T2    Rory McIlroy   -10   ..."></textarea>
        <div class="ap-actions">
          <button class="btn btn-small" id="r-preview">Preview</button>
          <label><input type="checkbox" id="r-use-pasted" checked> Use pasted FedEx points when shown</label>
          ${t.status === "official" ? `<button class="btn btn-small" id="r-reopen" style="margin-left:auto">Reopen (mark projected)</button>` : ""}
        </div>
        <div id="r-out"></div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Field</h2>
          <p class="muted">Optional. Once a field is saved, members can only pick golfers in it; until then any golfer is allowed.
          Paste one golfer per line; mark amateurs with “(a)”.</p></div>
        <p class="ap-status">${realField.length ? `<b>${realField.length}</b> golfers saved for this event` : "No field saved: members can pick any golfer."}</p>
        <textarea id="f-paste" class="ap-paste" spellcheck="false" placeholder="Scheffler, Scottie&#10;McIlroy, Rory&#10;Fang, Ethan (a)"></textarea>
        <div class="ap-actions"><button class="btn btn-small" id="f-preview">Preview</button>
          ${realField.length ? `<button class="btn btn-small" id="f-clear">Clear saved field</button>` : ""}</div>
        <div id="f-out"></div>
      </section>

      ${t.bonus_label ? `<section class="panel" id="bonus-panel"></section>` : ""}
    </div>
    <datalist id="ap-golfers">${Object.values(players).map((p) => `<option value="${esc(p.name)}">`).join("")}</datalist>`;

  wireSelect();
  const byName = new Map(Object.entries(players).map(([id, p]) => [normName(p.name), id]));

  // ------------------------------------------------------------ results
  let rows = [];
  const resolveInput = (val) => {
    const id = byName.get(normName(val));
    return id ? { id, name: players[id].name } : (val.trim() ? { id: newGolferId(val), name: val.trim() } : { id: null, name: "" });
  };
  const drawResults = () => {
    const out = $("#r-out", root);
    if (!rows.length) { out.innerHTML = ""; return; }
    const isNew = (r) => !r.matched_player_id || r.matched_player_id.startsWith("x-");
    const matched = rows.filter((r) => !isNew(r)).length;
    const doubt = rows.filter((r) => !isNew(r) && r.confidence < 0.7).length;
    const mism = rows.filter((r) => r.mismatch).length;
    const inPaste = new Set(rows.flatMap((r) => [r.matched_player_id, normName(r.matched_name || r.name)]));
    const missing = golferPicks.filter((p) => !inPaste.has(p.player_id) && !inPaste.has(normName(p.player_name)));
    const dupIds = rows.map((r) => r.matched_player_id).filter((id, i, a) => id && a.indexOf(id) !== i);
    out.innerHTML = `
      <div class="ap-summary">
        <span><b>${rows.length}</b> golfers</span><span><b>${matched}</b> matched</span>
        <span><b>${doubt}</b> to check</span><span><b>${rows.length - matched}</b> unmatched (saved as new golfers)</span>
        <span><b>${rows.filter(pickedFor).length}</b> picked by members</span>
      </div>
      ${parsed.warnings.map((w) => `<p class="ap-warn">${esc(w)}</p>`).join("")}
      ${missing.length ? `<p class="ap-warn">Picked but not in this paste (they'll score 0): ${missing.map((p) => `<b>${esc(p.player_name)}</b> (${esc(p.display_name)})`).join(", ")}</p>` : ""}
      ${mism ? `<p class="ap-warn">${mism} pasted point value${mism > 1 ? "s" : ""} differ from what the position pays (red). If the pasted column isn't per-event FedEx Cup points, untick “Use pasted FedEx points”.</p>` : ""}
      ${dupIds.length ? `<p class="ap-warn">The same golfer is matched twice: ${[...new Set(dupIds)].map((id) => esc(players[id]?.name || id)).join(", ")}. Fix one of the rows.</p>` : ""}
      <div class="ap-scroll"><table class="admin-table ap-table">
        <thead><tr><th>Pos</th><th>Pasted name</th><th>Golfer</th><th class="num">Tied</th><th class="num">Pasted pts</th>
          <th class="num">Position pays</th><th class="num">Points</th><th>Picked by</th></tr></thead>
        <tbody>${rows.map((r, i) => {
          const cls = [pickedFor(r) ? "is-picked" : "", isNew(r) ? "is-none" : r.confidence < 0.7 ? "is-doubt" : ""].join(" ");
          const conf = isNew(r) ? `<span class="ap-conf none">new golfer</span>`
            : r.confidence < 0.7 ? `<span class="ap-conf">check</span>` : "";
          return `<tr class="${cls}">
            <td>${esc(r.position)}</td>
            <td>${esc(r.team ? `${r.name} (${r.team})` : r.name)}${r.is_amateur ? ' <span class="tag">a</span>' : ""}</td>
            <td class="golfer"><input list="${r.candidates?.length > 1 ? `ap-c${i}` : "ap-golfers"}" data-row="${i}" value="${esc(isNew(r) ? "" : r.matched_name || "")}" placeholder="${esc(r.name)}" aria-label="Golfer for ${esc(r.name)}">
              ${r.candidates?.length > 1 ? `<datalist id="ap-c${i}">${r.candidates.map((id) => `<option value="${esc(players[id]?.name)}">`).join("")}</datalist>` : ""}${conf}</td>
            <td class="num">${r.pos_num != null && r.tied > 1 ? r.tied : ""}</td>
            <td class="num ${r.mismatch ? "ap-mismatch" : ""}">${r.points_pasted != null ? pts(r.points_pasted) : ""}</td>
            <td class="num">${pts(r.points_table)}${r.estimated ? ' <span class="ap-est" title="Interpolated: this position was never seen in 2024-26 results">est.</span>' : ""}</td>
            <td class="num"><b>${pts(r.points)}</b></td>
            <td class="ap-picked">${esc((pickedFor(r) || []).join(", "))}</td></tr>`;
        }).join("")}</tbody></table></div>
      <div class="ap-actions">
        <button class="btn btn-small" id="r-save">Save as projected</button>
        <button class="btn btn-small" id="r-final">Save &amp; finalize</button>
        <span class="muted" style="font-size:13px">Finalize when the event is over: it marks the results official and, once every event in the month is official, records the month's winner.</span>
      </div>`;
    $$(".golfer input", out).forEach((inp) => inp.addEventListener("change", () => {
      const r = rows[Number(inp.dataset.row)];
      const g = resolveInput(inp.value);
      r.matched_player_id = g.id; r.matched_name = g.name; r.confidence = g.id ? 1 : 0;
      drawResults();
    }));
    $("#r-save", out).addEventListener("click", () => save(false));
    $("#r-final", out).addEventListener("click", () => save(true));
  };

  let parsed = { warnings: [] };
  $("#r-preview", root).addEventListener("click", () => {
    parsed = parseResults($("#r-paste", root).value, idx, { team: t.event_type === "team", field: realField });
    rows = scoreRows(parsed.rows, t.event_type, { usePasted: $("#r-use-pasted", root).checked });
    rows.forEach((r) => { if (!r.matched_player_id) { r.matched_player_id = newGolferId(r.name); r.matched_name = r.name; r.confidence = 0; } });
    drawResults();
  });
  $("#r-use-pasted", root).addEventListener("change", (e) => { if (rows.length) { scoreRows(rows, t.event_type, { usePasted: e.target.checked }); drawResults(); } });

  const save = async (final) => {
    const seen = new Set();
    const payload = [];
    for (const r of rows) {
      if (!r.matched_player_id || seen.has(r.matched_player_id)) continue;
      seen.add(r.matched_player_id);
      payload.push({ player_id: r.matched_player_id, player_name: r.matched_name || r.name, position: r.position, points: r.points });
    }
    if (final && !confirm(`Finalize ${t.name} with ${payload.length} results? Standings will treat them as official.`)) return;
    try {
      await api.saveResults(t.id, payload, { final, wasOfficial: t.status === "official" });
      toast(final ? "Saved and finalized." : "Saved as projected.");
      await ctx.refresh();
    } catch (e) { toast(e.message, "error"); }
  };
  $("#r-reopen", root)?.addEventListener("click", async () => {
    try { await api.reopen(t.id); toast("Reopened: results are projected again."); await ctx.refresh(); }
    catch (e) { toast(e.message, "error"); }
  });

  // ------------------------------------------------------------ field
  let fieldRows = [];
  const drawField = () => {
    const out = $("#f-out", root);
    const unmatched = fieldRows.filter((r) => !r.matched_player_id).length;
    out.innerHTML = fieldRows.length ? `
      <div class="ap-summary"><span><b>${fieldRows.length}</b> golfers</span><span><b>${fieldRows.filter((r) => r.is_amateur).length}</b> amateurs</span>
        <span><b>${unmatched}</b> new to the list</span></div>
      <ul class="ap-field-list">${fieldRows.map((r) => `<li>${esc(r.matched_name || r.name)}${r.is_amateur ? ' <span class="tag">a</span>' : ""}${!r.matched_player_id ? ' <span class="ap-conf none">new</span>' : r.confidence < 0.7 ? ' <span class="ap-conf">check</span>' : ""}</li>`).join("")}</ul>
      <div class="ap-actions"><button class="btn btn-small" id="f-save">Save field (${fieldRows.length})</button></div>` : `<p class="ap-warn">No golfer names found.</p>`;
    $("#f-save", out)?.addEventListener("click", async () => {
      const seen = new Set();
      const payload = fieldRows.map((r) => ({ player_id: r.matched_player_id || newGolferId(r.name), player_name: r.matched_name || r.name,
        is_amateur: r.is_amateur, fedex_eligible: !r.is_amateur }))
        .filter((r) => !seen.has(r.player_id) && seen.add(r.player_id));
      try { await api.saveField(t.id, payload); toast(`Field saved: ${payload.length} golfers.`); await ctx.refresh(); }
      catch (e) { toast(e.message, "error"); }
    });
  };
  $("#f-preview", root).addEventListener("click", () => { fieldRows = parseField($("#f-paste", root).value, idx); drawField(); });
  $("#f-clear", root)?.addEventListener("click", async () => {
    if (!confirm("Clear the saved field? Members will be able to pick any golfer.")) return;
    try { await api.saveField(t.id, []); toast("Field cleared."); await ctx.refresh(); } catch (e) { toast(e.message, "error"); }
  });

  // ------------------------------------------------------------ bonus picks
  if (t.bonus_label) renderBonus($("#bonus-panel", root), ctx, t, picks.filter((p) => p.slot === "bonus"), now);
}

function renderBonus(el, ctx, t, bonus, now) {
  bonus.sort((a, b) => a.display_name.localeCompare(b.display_name));
  el.innerHTML = `
    <div class="panel-head"><h2>${esc(t.bonus_label)}</h2>
      <p class="muted">${now < new Date(t.lock_at) ? "Members' bonus picks appear here once the event locks." : "Enter the points each bonus pick earned (the 2026 sheet used 50 for a correct pick)."}</p></div>
    ${bonus.length ? `<table class="admin-table"><thead><tr><th>Member</th><th>Bonus pick</th><th>Points</th><th></th></tr></thead>
      <tbody>${bonus.map((p) => `<tr>
        <td>${esc(p.display_name)}</td><td>${esc(p.player_name)}</td>
        <td><input type="number" step="0.01" min="0" class="pts-input" value="${p.bonus_points ?? p.points ?? 0}" data-id="${p.pick_id}" aria-label="Points for ${esc(p.display_name)}"></td>
        <td><button class="btn btn-small" data-save="${p.pick_id}">Save</button></td></tr>`).join("")}</tbody></table>`
      : emptyState("No bonus picks to score")}`;
  $$("[data-save]", el).forEach((b) => b.addEventListener("click", async () => {
    const input = $(`.pts-input[data-id="${b.dataset.save}"]`, el);
    try {
      await ctx.api.setBonusPoints(Number(b.dataset.save), input.value === "" ? null : Number(input.value));
      toast("Saved.");
    } catch (e) { toast(e.message, "error"); }
  }));
}
