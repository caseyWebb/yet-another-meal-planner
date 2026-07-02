/* app-propose-ui.js — the member-facing surface for the propose_meal_plan branch.
   Defines two views on top of the engine (window.PROPOSE):
     • Pages.propose      — the full-screen "plan your week" flow (weather strip,
                            shape+fill slot cards, nudges, lock / swap / exclude,
                            seeded re-roll, commit-to-plan).
     • ProposeUI.palette  — the night-vibe palette + reconciliation queue, mounted
                            inside Profile & preferences.
   Wires its own event delegation (distinct data-act names) and re-renders via
   window.APP_RENDER. Reads window.CB / window.APP / window.PROPOSE. */
(function () {
  const CB = window.CB, APP = window.APP, I = window.APP_ICONS;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cap = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
  // universes for the per-slot facet filters (distinct across the corpus)
  const PROTEINS = [...new Set((CB.RECIPES || []).map((r) => r.protein).filter(Boolean))].sort();
  const CUISINES = [...new Set((CB.RECIPES || []).map((r) => r.cuisine).filter(Boolean))].sort();
  const TIME_TIERS = [{ v: "", l: "Any time" }, { v: 20, l: "≤ 20 min" }, { v: 30, l: "≤ 30 min" }, { v: 45, l: "≤ 45 min" }, { v: 60, l: "≤ 60 min" }];
  const CARET = '<svg class="facet-caret" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  const rerender = () => window.APP_RENDER && window.APP_RENDER();

  // local icons the base set doesn't carry
  const LI = {
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
    dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/></svg>',
    wand: I.sparkle, close: I.x,
    thermo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0Z"/></svg>',
  };

  // ── palette + reconciliation (mounted in Profile) ─────────────────────────
  function statusOf(v) {
    const d = window.PROPOSE.debtOf(v);
    if (d >= 1.5) return { k: "overdue", label: "Overdue", d };
    if (d >= 1) return { k: "due", label: "Due now", d };
    if (d >= 0.6) return { k: "soon", label: "Due soon", d };
    return { k: "ok", label: v.last_satisfied ? "On track" : "New", d };
  }
  function facetChips(v) {
    const f = v.facets || {}, out = [];
    if (f.cuisine) out.push(`<span class="facet">${esc(f.cuisine)}</span>`);
    if (f.protein) out.push(`<span class="facet" data-kind="protein">${esc(f.protein)}</span>`);
    if (f.max_time) out.push(`<span class="facet">≤ ${f.max_time} min</span>`);
    if (v.season) out.push(`<span class="facet vibe-season">${esc(v.season)}</span>`);
    return out.join("");
  }
  function wxChips(v, live) {
    const aff = v.weather_affinity || ["any"];
    const all = ["any"].concat(APP.WEATHER_TAGS);
    return `<div class="vibe-wx-chips">` + all.map((t) => {
      const on = aff.indexOf(t) >= 0;
      return `<button class="wxchip${on ? " on" : ""}" data-act="vibe-wx" data-id="${v.id}" data-tag="${t}" aria-pressed="${on}">${esc(t)}</button>`;
    }).join("") + `</div>`;
  }

  function vibeEditForm(v) {
    const f = (v && v.facets) || {};
    const sel = (name, opts, cur) => `<select class="select" name="${name}">${opts.map((o) => `<option value="${o.v}" ${String(cur || "") === String(o.v) ? "selected" : ""}>${esc(o.l)}</option>`).join("")}</select>`;
    const cuisineOpts = [{ v: "", l: "any cuisine" }].concat(APP.CUISINES.map((c) => ({ v: c, l: cap(c) })));
    const proteinOpts = [{ v: "", l: "any protein" }].concat(APP.PROTEINS.map((p) => ({ v: p, l: p })));
    const timeOpts = [{ v: "", l: "any time" }, { v: 20, l: "≤ 20 min" }, { v: 30, l: "≤ 30 min" }, { v: 45, l: "≤ 45 min" }, { v: 75, l: "a project (75+)" }];
    const seasonOpts = [{ v: "", l: "any season" }, { v: "spring", l: "spring" }, { v: "summer", l: "summer" }, { v: "fall", l: "fall" }, { v: "winter", l: "winter" }];
    const cadOpts = [7, 10, 14, 21, 30, 45];
    return `<form class="vibe-edit" data-act="${v ? "vibe-save" : "vibe-create"}" ${v ? `data-id="${v.id}"` : ""}>
      <input class="input vibe-name-in" name="vibe" placeholder="Describe the night — “Sunday sauce”, “fast noodles”…" value="${v ? esc(v.vibe) : ""}" autocomplete="off" />
      <div class="vibe-edit-grid">
        <label class="vibe-edit-f"><span>Cuisine</span>${sel("cuisine", cuisineOpts, f.cuisine)}</label>
        <label class="vibe-edit-f"><span>Protein</span>${sel("protein", proteinOpts, f.protein)}</label>
        <label class="vibe-edit-f"><span>Max time</span>${sel("max_time", timeOpts, f.max_time)}</label>
        <label class="vibe-edit-f"><span>Season</span>${sel("season", seasonOpts, v ? v.season : "")}</label>
        <label class="vibe-edit-f"><span>Cadence</span><select class="select" name="cadence_days">${cadOpts.map((d) => `<option value="${d}" ${v && v.cadence_days === d ? "selected" : ""}>every ${d} days</option>`).join("")}</select></label>
      </div>
      <div class="vibe-edit-actions">
        ${v ? `<button type="button" class="btn" data-variant="ghost" data-size="sm" data-act="vibe-del" data-id="${v.id}">${I.trash} Delete</button>` : "<span></span>"}
        <span class="vibe-edit-btns">
          <button type="button" class="btn" data-variant="ghost" data-size="sm" data-act="vibe-cancel">Cancel</button>
          <button type="submit" class="btn" data-size="sm">${v ? "Save vibe" : "Add vibe"}</button>
        </span>
      </div>
    </form>`;
  }

  function vibeRow(v) {
    const editing = window.__vibeEdit === v.id;
    const st = statusOf(v);
    const meter = Math.min(st.d, 2) / 2 * 100;
    const last = v.last_satisfied ? `cooked ${APP.relAge(v.last_satisfied)}` : "never cooked from this";
    return `<div class="vibe-row" data-vibe="${v.id}">
      <div class="vibe-top">
        <div class="vibe-headline">
          <span class="vibe-name">${esc(v.vibe)}</span>
          <span class="vibe-status" data-k="${st.k}">${st.label}</span>
        </div>
        <div class="vibe-row-actions">
          <button class="icon-btn" data-act="vibe-edit" data-id="${v.id}" title="Edit vibe">${I.pencil}</button>
        </div>
      </div>
      <div class="vibe-meta">${facetChips(v)}<span class="vibe-cadence">${I.clock} every ${v.cadence_days} days</span><span class="vibe-last">${last}</span></div>
      <div class="vibe-debt" title="cadence debt — how overdue this vibe is"><span class="vibe-debt-fill" data-k="${st.k}" style="width:${meter}%"></span></div>
      <div class="vibe-wx"><span class="vibe-wx-label">${LI.thermo} Weather fit</span>${wxChips(v, true)}</div>
      ${editing ? vibeEditForm(v) : ""}
    </div>`;
  }

  function reconcilePanel(state) {
    const pending = state.pendingProposals || [];
    if (!pending.length) return "";
    const row = (p) => {
      let actions = "";
      if (p.type === "add") actions = `<button class="btn" data-size="sm" data-act="pending-apply" data-id="${p.id}">${I.plus} Add vibe</button>`;
      else if (p.type === "prune") actions = `<button class="btn" data-size="sm" data-act="pending-apply" data-id="${p.id}">${I.trash} Retire</button><button class="btn" data-variant="outline" data-size="sm" data-act="pending-stretch" data-id="${p.id}">Stretch to ${p.suggestCadence}d</button>`;
      else if (p.type === "adjust") actions = `<button class="btn" data-size="sm" data-act="pending-apply" data-id="${p.id}">Tighten to ${p.suggestCadence}d</button>`;
      return `<li class="rec-row">
        <div class="rec-main"><div class="rec-title">${esc(p.title)}</div><p class="rec-why">${esc(p.rationale)}</p></div>
        <div class="rec-actions">${actions}<button class="btn" data-variant="ghost" data-size="sm" data-act="pending-dismiss" data-id="${p.id}">Dismiss</button></div>
      </li>`;
    };
    return `<div class="rec-panel">
      <header class="rec-head"><h4>${I.sparkle} Suggestions from your cooking</h4><p>Where your palette (what you said) and your cooking log (what you did) have drifted apart. Confirm to update your palette.</p></header>
      <ul class="rec-list">${pending.map(row).join("")}</ul>
    </div>`;
  }

  function palette() {
    const state = APP.state();
    APP.actions.refreshPending(); // deterministic signal pass, always-fresh
    const vibes = state.nightVibes || [];
    const adding = window.__vibeAdd;
    return `<section class="palette-plain">
      <header class="palette-head">
        <div><h3>${I.sparkle} Night-vibe palette</h3><p>The <em>shapes</em> of your week — archetypes you repeat, not exact meals. Each is a saved search with a cadence; the planner samples them by weather and how overdue they are.</p></div>
        <button class="btn" data-variant="outline" data-size="sm" data-act="vibe-add-open">${I.plus} Add a vibe</button>
      </header>
      ${reconcilePanel(state)}
      ${adding ? `<div class="vibe-row adding">${vibeEditForm(null)}</div>` : ""}
      <div class="vibe-list">${vibes.length ? vibes.map(vibeRow).join("") : `<p class="muted-line">No night vibes yet. Add one to shape your weekly proposals.</p>`}</div>
      <div class="palette-foot">
        <a class="btn" href="#/propose">${I.sparkle} Plan a week from these</a>
      </div>
    </section>`;
  }

  // ── the propose flow (Pages.propose) ──────────────────────────────────────
  function nudgeBar(opts) {
    const wants = opts.proteinWants || [];
    return `<div class="nudges">
      <div class="nudge">
        <span class="nudge-label">How adventurous?</span>
        <div class="nudge-slider">
          <span class="muted small">stick to hits</span>
          <input type="range" class="input" min="0.2" max="1" step="0.1" value="${1.2 - opts.lambda}" data-act="nudge-lambda" />
          <span class="muted small">mix it up</span>
        </div>
      </div>
      <div class="nudge">
        <span class="nudge-label">Proteins you want this week <span class="muted">— optional</span></span>
        <div class="chip-toggle">${APP.PROTEINS.map((p) => `<button class="chip-tog${wants.indexOf(p) >= 0 ? " on" : ""}" data-act="protein-want" data-val="${p}" aria-pressed="${wants.indexOf(p) >= 0}">${esc(p)}</button>`).join("")}</div>
      </div>
      <div class="nudge nudge-wide">
        <span class="nudge-label">In your own words <span class="muted">— optional</span></span>
        <input class="input" type="text" value="${esc(opts.freeform || "")}" placeholder="e.g. more soup, lighter dinners, use up the salmon…" data-act="nudge-freeform" />
      </div>
    </div>`;
  }
  // time-budget options for a single night; include the current value if custom.
  function timeOptions(cur) {
    const base = [{ v: "", l: "Any time" }, { v: 20, l: "≤ 20 min" }, { v: 30, l: "≤ 30 min" }, { v: 45, l: "≤ 45 min" }, { v: 60, l: "≤ 60 min" }];
    if (cur != null && !base.some((o) => o.v === cur)) base.push({ v: cur, l: "≤ " + cur + " min" });
    return base.map((o) => `<option value="${o.v}" ${String(cur == null ? "" : cur) === String(o.v) ? "selected" : ""}>${o.l}</option>`).join("");
  }

  // One clickable facet chip. Clicking opens a filter popover; a pinned chip
  // shows a clear (×). `kind` ∈ protein | cuisine | time.
  function facetChip(s, kind, text, pinned) {
    const kAttr = kind === "protein" ? ' data-kind="protein"' : "";
    return `<button class="facet facet-btn${pinned ? " pinned" : ""}"${kAttr} data-act="facet-open" data-id="${s.slotId}" data-facet="${kind}" title="Filter this night by ${kind}">`
      + `<span class="facet-txt">${esc(text)}</span>`
      + (pinned
          ? `<span class="facet-x" data-act="facet-clear" data-id="${s.slotId}" data-facet="${kind}" role="button" aria-label="Clear ${kind} filter" title="Clear filter">${I.x}</span>`
          : CARET)
      + `</button>`;
  }
  // The popover of options for whichever facet is open on this slot.
  function facetPopover(s, kind, opts) {
    let rows, clearLabel, curVal, searchable = true;
    if (kind === "time") {
      const eff = s.maxTime == null ? "" : String(s.maxTime);
      searchable = false;
      rows = TIME_TIERS.filter((t) => t.v !== "").map((t) => optRow(s, kind, String(t.v), t.l, eff === String(t.v)));
      clearLabel = "Any time";
      curVal = eff;
    } else {
      const universe = kind === "protein" ? PROTEINS : CUISINES;
      curVal = kind === "protein" ? (opts.slotProtein || {})[s.slotId] : (opts.slotCuisine || {})[s.slotId];
      rows = universe.map((v) => optRow(s, kind, v, cap(v), curVal === v));
      clearLabel = kind === "protein" ? "Any protein" : "Any cuisine";
    }
    const clear = `<button class="facet-opt clear${(curVal == null || curVal === "") ? " on" : ""}" data-act="facet-pick" data-id="${s.slotId}" data-facet="${kind}" data-value="">${esc(clearLabel)}</button>`;
    const search = searchable ? `<input class="facet-pop-search" data-act="facet-filter" placeholder="Filter ${kind}…" autocomplete="off" spellcheck="false" aria-label="Filter ${kind}" />` : "";
    return `<div class="facet-pop" data-facet="${kind}">
      <div class="facet-pop-head">Filter by ${kind}</div>
      ${search}
      <div class="facet-pop-list">${rows.join("")}</div>
      <div class="facet-pop-sep"></div>
      ${clear}
    </div>`;
  }
  function optRow(s, kind, value, label, on) {
    return `<button class="facet-opt${on ? " on" : ""}" data-act="facet-pick" data-id="${s.slotId}" data-facet="${kind}" data-value="${esc(value)}"><span>${esc(label)}</span>${on ? I.check : ""}</button>`;
  }

  function slotCard(s) {
    // Each night's vibe is assigned by the planner; the member changes it from
    // the swap menu (a preset or a typed phrase), not inline.
    const vibeLabel = `<span class="slot-vibe${s.vibeEdited ? " edited" : ""}"${s.vibeEdited ? ` title="Changed from the assigned vibe"` : ""}>${esc(s.vibeLabel)}</span>`;
    const opts = APP.actions.proposeOpts() || {};
    const pinP = (opts.slotProtein || {})[s.slotId] || null;
    const pinC = (opts.slotCuisine || {})[s.slotId] || null;
    const timeExplicit = !!(opts.slotMaxTime && Object.prototype.hasOwnProperty.call(opts.slotMaxTime, s.slotId));
    const timePinVal = timeExplicit ? opts.slotMaxTime[s.slotId] : null;
    const facetPanel = window.__facetPop && window.__facetPop.indexOf(s.slotId + "|") === 0
      ? facetPopover(s, window.__facetPop.split("|")[1], opts) : "";
    if (s.empty) {
      // Show the pinned filters here too (each clearable) so an over-constrained
      // night can be relaxed in place instead of nuking the whole session.
      const pins = [
        pinP ? facetChip(s, "protein", pinP, true) : "",
        pinC ? facetChip(s, "cuisine", pinC, true) : "",
        (timeExplicit && timePinVal != null) ? facetChip(s, "time", "\u2264 " + timePinVal + " min", true) : "",
      ].join("");
      return `<article class="slot-card empty-slot">
        <div class="slot-head"><div class="slot-head-label">${vibeLabel}</div></div>
        <p class="slot-empty-reason">${I.alert} ${esc(s.reason)}</p>
        ${pins ? `<div class="slot-facets empty-facets"><span class="empty-facets-label">Filters on this night:</span>${pins}</div>${facetPanel}` : ""}
      </article>`;
    }
    const menuOpen = window.__swapMenu === s.slotId;
    const listOpen = window.__swapList === s.slotId;
    const m = s.main;
    const timePinned = timeExplicit && s.maxTime != null;
    const timeText = s.maxTime != null ? "≤ " + s.maxTime + " min" : m.time + " min";
    const why = s.why.map((w) => `<span class="why-chip">${esc(w)}</span>`).join("");
    const sides = s.sides.map((x) => `<span class="side-chip">${esc(x)}</span>`).join("");
    const flags = s.flags.map((f) => `<span class="slot-flag flag-${f.type}">${f.type === "waste" ? I.alert : (f.type === "meal-prep" ? I.check : "")}${esc(f.label)}</span>`).join("");
    const swapMenu = menuOpen ? `<div class="slot-menu" role="menu">
      <button class="slot-menu-item" data-act="slot-swap-similar" data-id="${s.slotId}" data-slug="${s.altSimilar ? esc(s.altSimilar.slug) : ""}" ${s.altSimilar ? "" : "disabled"}>
        <span>${I.swap} Something similar</span>${s.altSimilar ? `<span class="menu-sub">${esc(s.altSimilar.title)}</span>` : `<span class="menu-sub muted">nothing close left</span>`}
      </button>
      <button class="slot-menu-item" data-act="slot-swap-different" data-id="${s.slotId}" data-slug="${s.altDifferent ? esc(s.altDifferent.slug) : ""}" ${s.altDifferent ? "" : "disabled"}>
        <span>${I.sparkle} A different cuisine</span>${s.altDifferent ? `<span class="menu-sub">${esc(cap(s.altDifferent.cuisine))} · ${esc(s.altDifferent.title)}</span>` : `<span class="menu-sub muted">none available</span>`}
      </button>
      <button class="slot-menu-item" data-act="slot-pick-list" data-id="${s.slotId}"><span>${I.search} Pick a specific recipe…</span></button>
      <div class="slot-menu-sep"></div>
      <button class="slot-menu-item" data-act="slot-vibe-open" data-id="${s.slotId}"><span>${I.pencil} Change the vibe…</span>${s.vibeEdited ? `<span class="menu-sub">now “${esc(s.vibeLabel)}”</span>` : `<span class="menu-sub muted">reshape this night</span>`}</button>
    </div>` : "";
    const alts = listOpen ? `<div class="slot-alts">
      <div class="slot-alts-head">Pick a recipe for this vibe</div>
      ${s.alternates.length ? s.alternates.map((a) => `<button class="alt-row" data-act="slot-alt" data-id="${s.slotId}" data-slug="${esc(a.slug)}">
        <span class="alt-title">${esc(a.title)}</span><span class="alt-facets"><span class="facet" data-kind="protein">${esc(a.protein)}</span><span class="facet">${esc(a.cuisine)}</span></span>
      </button>`).join("") : `<p class="muted small">No other recipes fit this vibe under your current filters.</p>`}
    </div>` : "";
    // Change-the-vibe panel: type a phrase (Apply) or tap a palette vibe. Both
    // route through setSlotVibe, so the night re-fills with the new phrase.
    const vibeOpen = window.__vibePick === s.slotId;
    const paletteVibes = (APP.state().nightVibes || []);
    const vibePanel = vibeOpen ? `<div class="slot-vibes">
      <div class="slot-alts-head">Change this night’s vibe</div>
      <form class="slot-vibe-form" data-act="slot-vibe-form" data-id="${s.slotId}">
        <input class="input slot-vibe-in" name="vibe" value="${esc(s.vibeLabel)}" placeholder="Describe this night…" autocomplete="off" spellcheck="false" />
        <button type="submit" class="btn" data-size="sm">Apply</button>
      </form>
      <div class="slot-vibes-or">or pick one of your vibes</div>
      <div class="slot-vibe-presets">
        ${paletteVibes.map((v) => `<button class="vibe-preset${(String(s.vibeLabel).toLowerCase() === String(v.vibe).toLowerCase()) ? " on" : ""}" data-act="slot-vibe-pick" data-id="${s.slotId}" data-vibe="${esc(v.vibe)}">${esc(v.vibe)}</button>`).join("")}
      </div>
      ${s.vibeEdited ? `<button class="slot-vibe-reset" data-act="slot-vibe-reset" data-id="${s.slotId}">${I.back} Reset to the assigned vibe</button>` : ""}
    </div>` : "";
    return `<article class="slot-card${s.locked ? " locked" : ""}">
      <div class="slot-head">
        <div class="slot-head-label">${vibeLabel}</div>
        <div class="slot-actions">
          <button class="slot-btn${s.locked ? " on" : ""}" data-act="slot-lock" data-id="${s.slotId}" data-slug="${esc(m.slug)}" title="${s.locked ? "Unlock — let re-roll change it" : "Keep this one when I re-roll"}">${s.locked ? LI.lock : LI.unlock}</button>
          <button class="slot-btn${menuOpen ? " on" : ""}" data-act="slot-swap" data-id="${s.slotId}" title="Swap this pick">${I.swap}</button>
          <button class="slot-btn" data-act="slot-exclude" data-id="${s.slotId}" data-slug="${esc(m.slug)}" title="Not this one — remove and refill">${I.x}</button>
        </div>
      </div>
      <a class="slot-title" href="#/recipe/${esc(m.slug)}">${esc(m.title)}</a>
      ${m.description ? `<p class="slot-desc">${esc(m.description)}</p>` : ""}
      <div class="slot-facets">${facetChip(s, "protein", m.protein, !!pinP)}${facetChip(s, "cuisine", m.cuisine, !!pinC)}${facetChip(s, "time", timeText, timePinned)}</div>
      ${window.__facetPop && window.__facetPop.indexOf(s.slotId + "|") === 0 ? facetPanel : ""}
      <div class="slot-why">${why}</div>
      <div class="slot-footer">
        <div class="slot-sides">${sides || `<span class="muted small">no side</span>`}</div>
        <div class="slot-flags">${flags}</div>
      </div>
      ${swapMenu}
      ${alts}
      ${vibePanel}
    </article>`;
  }

  function varietyBar(prop) {
    const v = prop.variety;
    const hist = v.proteinHist.map(([p, n]) => `<span class="pv-chip${n > 1 ? " rep" : ""}">${esc(p)}${n > 1 ? ` ×${n}` : ""}</span>`).join("");
    return `<div class="variety-bar">
      <div class="variety-stats">
        <span class="vstat"><strong>${v.nights}</strong> nights</span>
        <span class="vstat"><strong>${v.cuisines}</strong> cuisines</span>
        <span class="vstat"><strong>${v.proteins}</strong> proteins</span>
        <div class="pv-hist">${hist}</div>
      </div>
      <button class="btn" data-act="propose-commit">${I.cal} Commit to meal plan</button>
    </div>`;
  }

  function proposePage() {
    const state = APP.state();
    const vibes = state.nightVibes || [];
    const back = window.APP_CRUMB([{ label: "Meal plan", href: "#/plan" }, { label: "Plan your week" }]);
    if (!vibes.length) {
      return `${back}${head("Plan your week", "Build a week from the moods you cook by — balanced across the week and tuned to the forecast.")}
        <div class="empty"><header><h2>Your palette is empty</h2><p>Planning starts from your night vibes — the kinds of dinners you cook. Add a few in your profile first.</p></header><a class="btn" href="#/profile">${I.sparkle} Set up your palette</a></div>`;
    }
    const opts = APP.actions.proposeOpts();
    // Display opts so the nudges (adventurousness, proteins, freeform) render BEFORE
    // the first roll too. Any nudge interaction auto-starts the session (startPropose)
    // and re-rolls live on change/blur/click — so there's no separate re-roll button.
    const dopts = opts || { nights: Math.min(5, Math.max(2, (state.profile.default_cooking_nights || 3))), proteinWants: [], lambda: 0.6, freeform: "" };
    const controls = `<section class="propose-controls">
      <div class="pc-row">
        <div class="nights-step">
          <span class="nudge-label">Nights</span>
          <button class="step-btn" data-act="propose-nights" data-dir="-1" ${dopts.nights <= 2 ? "disabled" : ""}>−</button>
          <span class="nights-n">${dopts.nights}</span>
          <button class="step-btn" data-act="propose-nights" data-dir="1" ${dopts.nights >= 6 ? "disabled" : ""}>+</button>
        </div>
        <div class="pc-actions">
          ${opts ? `<button class="btn" data-variant="outline" data-act="propose-reset">Start over</button>` : `<button class="btn" data-act="propose-start">${I.sparkle} Propose a week</button>`}
        </div>
      </div>
      ${nudgeBar(dopts)}
    </section>`;

    if (!opts) {
      return `${back}${head("Plan your week", "Build a week from the moods you cook by — balanced across the week and tuned to the forecast.")}
        ${controls}
        <div class="propose-intro"><p>${I.sparkle} Set the dials above, then propose a week — picked from the kinds of dinners you cook, spread out so it doesn’t feel samey, with the weather taken into account. Tweak any dial and the week updates live. Nothing’s added to your plan until you say so.</p></div>`;
    }
    const prop = window.PROPOSE.build(state, opts);
    return `${back}${head("Plan your week", "Build a week from the moods you cook by — balanced across the week and tuned to the forecast.")}
      ${controls}
      ${varietyBar(prop)}
      <div class="slot-list">${prop.slots.map(slotCard).join("")}</div>
      <p class="propose-note muted small">Adjust any dial above and the week updates live — same choices in, same week out. Everything suggested already fits what you eat; your dietary rules are never broken.</p>`;
  }
  function head(title, sub) { return `<header class="page-head"><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div></header>`; }

  // register the page
  window.Pages = window.Pages || {};
  window.Pages.propose = proposePage;
  window.ProposeUI = { palette };

  // ── event wiring (independent listeners; distinct data-act names) ─────────
  function readVibeForm(form) {
    const d = Object.fromEntries(new FormData(form).entries());
    const facets = {};
    if (d.cuisine) facets.cuisine = d.cuisine;
    if (d.protein) facets.protein = d.protein;
    if (d.max_time) facets.max_time = Number(d.max_time);
    return { vibe: (d.vibe || "").trim(), facets, season: d.season || null, cadence_days: Number(d.cadence_days) || 14 };
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.getAttribute("data-act");
    const id = el.getAttribute("data-id");
    const slug = el.getAttribute("data-slug");
    const A = APP.actions;
    switch (act) {
      // palette
      case "vibe-add-open": window.__vibeAdd = true; window.__vibeEdit = null; rerender(); return;
      case "vibe-edit": window.__vibeEdit = (window.__vibeEdit === id ? null : id); window.__vibeAdd = false; rerender(); return;
      case "vibe-cancel": window.__vibeEdit = null; window.__vibeAdd = false; rerender(); return;
      case "vibe-del": if (window.confirm("Remove this night vibe?")) { A.removeVibe(id); window.__vibeEdit = null; rerender(); } return;
      case "vibe-wx": A.toggleWeatherAffinity(id, el.getAttribute("data-tag")); rerender(); return;
      // reconciliation
      case "pending-apply": A.applyPending(id); rerender(); return;
      case "pending-stretch": A.stretchPending(id); rerender(); return;
      case "pending-dismiss": A.dismissPending(id); rerender(); return;
      // propose
      case "propose-start": A.startPropose(); rerender(); return;
      case "propose-reroll": A.reroll(); rerender(); return;
      case "propose-reset": A.resetPropose(); window.__swapMenu = null; window.__swapList = null; window.__vibePick = null; rerender(); return;
      case "propose-nights": { const o = A.startPropose(); A.setProposeField("nights", Math.max(2, Math.min(6, o.nights + Number(el.getAttribute("data-dir"))))); rerender(); return; }
      case "protein-want": A.toggleProteinWant(el.getAttribute("data-val")); rerender(); return;
      case "slot-lock": A.lockSlot(id, slug); rerender(); return;
      case "slot-swap": window.__swapMenu = (window.__swapMenu === id ? null : id); window.__swapList = null; window.__vibePick = null; window.__facetPop = null; rerender(); return;
      case "slot-swap-similar": if (slug) { A.overrideSlot(id, slug); } window.__swapMenu = null; rerender(); return;
      case "slot-swap-different": if (slug) { A.overrideSlot(id, slug); } window.__swapMenu = null; rerender(); return;
      case "slot-pick-list": window.__swapList = (window.__swapList === id ? null : id); window.__swapMenu = null; window.__vibePick = null; rerender(); return;
      case "slot-vibe-open": window.__vibePick = (window.__vibePick === id ? null : id); window.__swapMenu = null; window.__swapList = null; rerender(); return;
      case "slot-vibe-pick": A.setSlotVibe(id, el.getAttribute("data-vibe")); window.__vibePick = null; rerender(); return;
      case "slot-vibe-reset": A.setSlotVibe(id, ""); window.__vibePick = null; rerender(); return;
      case "slot-alt": A.overrideSlot(id, slug); window.__swapList = null; rerender(); return;
      case "facet-open": { const key = id + "|" + el.getAttribute("data-facet"); window.__facetPop = (window.__facetPop === key ? null : key); window.__swapMenu = null; window.__swapList = null; window.__vibePick = null; rerender(); return; }
      case "facet-clear": { e.stopPropagation(); const k = el.getAttribute("data-facet"); if (k === "time") A.setSlotMaxTime(id, ""); else A.setSlotFacet(id, k, ""); window.__facetPop = null; rerender(); return; }
      case "facet-pick": { const k = el.getAttribute("data-facet"); const v = el.getAttribute("data-value"); if (k === "time") A.setSlotMaxTime(id, v); else A.setSlotFacet(id, k, v); window.__facetPop = null; rerender(); return; }
      case "slot-exclude": A.excludeSlot(id, slug); rerender(); return;
      case "propose-commit": {
        const prop = window.PROPOSE.build(APP.state(), A.proposeOpts());
        const slots = prop.slots.filter((s) => !s.empty).map((s) => ({ slug: s.main.slug, title: s.main.title, sides: s.sides, from_vibe: s.vibeId }));
        const n = A.commitWeek(slots);
        window.__toast && window.__toast(n ? `Committed ${n} night${n === 1 ? "" : "s"} to your meal plan` : "Those are already in your plan");
        A.resetPropose();
        location.hash = "#/plan";
        return;
      }
    }
  });

  document.addEventListener("change", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.getAttribute("data-act");
    // slider shows stick-to-hits ↔ mix-it-up; stored λ is the inverse (high λ = on-target)
    if (act === "nudge-lambda") { APP.actions.setProposeField("lambda", Math.round((1.2 - Number(el.value)) * 10) / 10); rerender(); }
    else if (act === "slot-time") { APP.actions.setSlotMaxTime(el.getAttribute("data-id"), el.value); rerender(); }
  });
  document.addEventListener("submit", (e) => {
    const form = e.target.closest("form[data-act]");
    if (!form) return;
    const act = form.getAttribute("data-act");
    if (act === "slot-vibe-form") {
      e.preventDefault();
      const inp = form.querySelector('[name="vibe"]');
      APP.actions.setSlotVibe(form.getAttribute("data-id"), inp ? inp.value : "");
      window.__vibePick = null;
      rerender();
      return;
    }
    if (act !== "vibe-create" && act !== "vibe-save") return;
    e.preventDefault();
    const spec = readVibeForm(form);
    if (!spec.vibe) return;
    if (act === "vibe-create") { APP.actions.addVibe(spec); window.__vibeAdd = false; }
    else { APP.actions.updateVibe(form.getAttribute("data-id"), spec); window.__vibeEdit = null; }
    rerender();
  });

  // debounced freeform
  let ffTimer = null;
  document.addEventListener("input", (e) => {
    // live filter inside an open facet popover (protein/cuisine) — no rerender
    const fx = e.target.closest("[data-act='facet-filter']");
    if (fx) {
      const q = fx.value.trim().toLowerCase();
      fx.closest(".facet-pop").querySelectorAll(".facet-pop-list .facet-opt").forEach((b) => {
        b.style.display = b.textContent.toLowerCase().indexOf(q) >= 0 ? "" : "none";
      });
      return;
    }
    const el = e.target.closest("[data-act='nudge-freeform']");
    if (!el) return;
    if (ffTimer) clearTimeout(ffTimer);
    const val = el.value;
    ffTimer = setTimeout(() => { APP.actions.setProposeField("freeform", val); rerender(); }, 400);
  });
})();
