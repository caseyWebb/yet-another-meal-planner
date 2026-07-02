/* Cookbook web app — page renderers. Pure functions returning HTML strings.
   Interactivity is wired in app-main.js via data-act delegation. Reads window.CB
   (corpus) + window.APP (member state). */
(function () {
  const CB = window.CB, APP = window.APP;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cap = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

  const I = {
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>',
    heartFill: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5v14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 2-1.58l1.65-7.42H5.12"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/></svg>',
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  };
  window.APP_ICONS = I;

  // Perishable pantry categories + freshness helper for “needs verification”.
  const DAYMS = 86400000;
  const daysSince = (iso) => Math.floor((Date.now() - Date.parse(iso + "T00:00:00")) / DAYMS);
  const PERISHABLE = new Set(["produce", "dairy", "seafood", "meat"]);
  const STALE_DAYS = 7;

  // Curated substitution suggestions (stands in for the agent's SKU-matching swap logic).
  const SUBS = {
    "lacinato kale": { to: "curly kale", why: "out of stock" },
    "cannellini bean": { to: "great northern beans", why: "out of stock" },
    "yellow onion": { to: "sweet onion", why: "cheaper" },
    "large shrimp": { to: "frozen shrimp", why: "cheaper" },
    "egg": { to: "pasture-raised eggs", why: "in stock now" },
    "carrot": { to: "rainbow carrots", why: "on sale" },
    "olive oil": { to: "store-brand olive oil", why: "cheaper" },
    "canned chickpeas": { to: "dried chickpeas", why: "cheaper" },
    "coconut milk": { to: "light coconut milk", why: "lower fat" },
    "heirloom tomato": { to: "vine tomatoes", why: "out of stock" },
    "persian cucumber": { to: "english cucumber", why: "out of stock" },
    "gruy\u00e8re": { to: "swiss cheese", why: "cheaper" },
    "san marzano tomato": { to: "whole peeled tomatoes", why: "out of stock" },
  };
  window.APP_SUBS = SUBS;

  // Store / shopping-mode model. The store being shopped determines how the list is
  // ordered — mirrors the backend: Kroger uses live aisle data, a mapped store uses a
  // manual aisle map, an unmapped store falls back to department, and with no store the
  // list is grouped by category (grocery / household / other).
  const STORES = [
    { id: "kroger", name: "Kroger \u2014 Hyde Park #412", mode: "aisle", hint: "Sorted by aisle \u00b7 live Kroger aisle data" },
    { id: "mapped", name: "Trader Joe's", mode: "aisle", hint: "Sorted by aisle \u00b7 manual store mapping" },
    { id: "unmapped", name: "H Mart", mode: "department", hint: "Sorted by department \u00b7 store not mapped" },
    { id: "category", name: "No store \u2014 by category", mode: "category", hint: "Grouped by category" },
  ];
  const DEPTS = ["Produce", "Dairy & eggs", "Meat & protein", "Pantry", "Grocery", "Household"];
  const KROGER_AISLE = { "Produce": 3, "Dairy & eggs": 7, "Meat & protein": 11, "Pantry": 12, "Grocery": 9, "Household": 16 };
  const MAPPED_AISLE = { "Produce": 1, "Dairy & eggs": 4, "Meat & protein": 6, "Pantry": 8, "Grocery": 5, "Household": 10 };
  function deptOf(g) {
    const n = g.name;
    if (g.kind === "household") return "Household";
    if (/(kale|onion|carrot|lemon|lime|cucumber|tomato|scallion|garlic|ginger|\bpea|potato|herb|basil|spinach|leek|avocado|apple|eggplant|asparagus|daikon|cilantro|mint)/.test(n)) return "Produce";
    if (/(egg|milk|butter|yogurt|cheese|cream|parmesan|feta|mozzarella|gruy)/.test(n)) return "Dairy & eggs";
    if (/(chicken|beef|pork|lamb|shrimp|salmon|fish|tofu|bean|lentil|chickpea)/.test(n)) return "Meat & protein";
    if (/(rice|pasta|flour|oil|miso|soy|coconut|stock|sugar|spice|curry|gochujang|mirin|vinegar|\bcan|chili|sesame)/.test(n)) return "Pantry";
    return "Grocery";
  }
  function groupGrocery(list, mode) {
    const groups = {};
    list.forEach((g) => {
      let key, label, order;
      if (mode === "category") {
        const k = g.kind === "household" ? "Home goods" : (g.kind === "other" ? "Other" : "Groceries");
        key = k; label = "Category: " + k; order = { "Groceries": 0, "Home goods": 1, "Other": 2 }[k];
      } else {
        const dept = deptOf(g);
        if (mode === "unmapped" || mode === "department") { key = dept; label = dept; order = DEPTS.indexOf(dept); }
        else { const map = mode === "kroger" ? KROGER_AISLE : MAPPED_AISLE; const a = map[dept] || 99; key = "a" + a; label = "Aisle " + a + " \u00b7 " + dept; order = a; }
      }
      (groups[key] = groups[key] || { label, order, items: [] }).items.push(g);
    });
    return Object.values(groups).sort((a, b) => a.order - b.order);
  }

  // ---- shared bits ---------------------------------------------------------
  function facets(r) {
    return [
      r.protein ? `<span class="facet" data-kind="protein">${esc(r.protein)}</span>` : "",
      r.cuisine ? `<span class="facet">${esc(r.cuisine)}</span>` : "",
    ].join("");
  }

  function recipeRow(r) {
    const fav = APP.actions.isFavorite(r.slug);
    const planned = APP.actions.inPlan(r.slug);
    const desc = r.description ? `<span class="rdesc">${esc(r.description)}</span>` : "";
    return `<li class="rrow">
      <a class="rrow-link" href="#/recipe/${esc(r.slug)}">
        <span class="rtitle">${esc(r.title)}</span>
        ${desc}
        <span class="rfacets">${facets(r)}</span>
      </a>
      <div class="rrow-actions">
        <button class="plan-btn${planned ? " on" : ""}" data-act="plan-toggle" data-slug="${esc(r.slug)}" aria-pressed="${planned}" title="${planned ? "In meal plan \u2014 remove" : "Add to meal plan"}">${I.cal}</button>
        <button class="fav-btn${fav ? " on" : ""}" data-act="fav" data-slug="${esc(r.slug)}" aria-pressed="${fav}" title="${fav ? "Unfavorite" : "Favorite"}">${fav ? I.heartFill : I.heart}</button>
      </div>
    </li>`;
  }
  const recipeList = (rows) => `<ul class="recipes">${rows.map(recipeRow).join("")}</ul>`;

  function pageHead(title, sub, actions) {
    return `<header class="page-head">
      <div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ""}</div>
      ${actions ? `<div class="page-head-actions">${actions}</div>` : ""}
    </header>`;
  }

  function emptyBlock(title, sub, opts) {
    // Design-system empty state: centered dashed card with an accent figure/icon,
    // muted copy, and an optional action.
    opts = opts || {};
    const icon = opts.icon || I.search;
    const action = opts.action ? `<div class="empty-action">${opts.action}</div>` : "";
    return `<div class="empty"><header><figure data-accentfig>${icon}</figure><h2>${esc(title)}</h2><p>${esc(sub)}</p></header>${action}</div>`;
  }

  // A Basecoat breadcrumb trail. items: [{ label, href? }]; the last is the
  // current page (rendered as plain text, no link).
  function crumb(items) {
    const parts = [];
    items.forEach((it, i) => {
      if (i) parts.push(`<li aria-hidden="true">${I.chevron}</li>`);
      const last = i === items.length - 1;
      parts.push(`<li>${last || !it.href ? `<span aria-current="page">${esc(it.label)}</span>` : `<a href="${esc(it.href)}">${esc(it.label)}</a>`}</li>`);
    });
    return `<nav class="breadcrumb crumbs" aria-label="Breadcrumb"><ol>${parts.join("")}</ol></nav>`;
  }
  window.APP_CRUMB = crumb;

  // ---- Cookbook (browse / search) ------------------------------------------
  // New & trending — a curated, ordered set (new adds first, then group-trending
  // and seasonal). Shown 4 at a time with a See-more expander.
  const NEW_TRENDING = [
    "miso-glazed-eggplant-donburi", "mapo-tofu", "herby-spring-grain-bowl", "kimchi-fried-rice",
    "brown-butter-chocolate-chip-cookies", "green-shakshuka", "red-wine-braised-short-ribs", "summer-tomato-galette",
  ];
  function newTrending() {
    const all = NEW_TRENDING.map((s) => CB.bySlug(s)).filter(Boolean);
    const expanded = !!window.__ntExpanded;
    return { shown: expanded ? all : all.slice(0, 4), hasMore: all.length > 4, expanded };
  }

  // Picked for you — recipes similar to your favorites, filtered by dietary
  // preferences (avoid list). Stands in for the profile-aware recommender.
  function pickedForYou() {
    const favs = APP.state().favorites;
    const avoid = (APP.state().profile.dietary && APP.state().profile.dietary.avoid) || [];
    const score = {};
    favs.forEach((f) => CB.similar(f).forEach((r) => { if (!favs.includes(r.slug)) score[r.slug] = (score[r.slug] || 0) + 1; }));
    let picks = Object.keys(score).sort((a, b) => score[b] - score[a]).map((s) => CB.bySlug(s)).filter(Boolean);
    picks = picks.filter((r) => !avoid.includes(r.protein));
    if (picks.length < 4) {
      CB.sortedIndex().forEach((r) => { if (!favs.includes(r.slug) && !picks.find((p) => p.slug === r.slug) && !avoid.includes(r.protein)) picks.push(r); });
    }
    return picks.slice(0, 6);
  }

  // Search results markup (also called by the in-place search in app-main).
  function searchResultsHtml(q) {
    const recipes = CB.rank(q);
    if (!recipes.length) return emptyBlock("No matches", `Nothing matches \u201c${q}\u201d. Try a protein, a cuisine, or an ingredient.`);
    return `<p class="resultmeta">${recipes.length} result${recipes.length === 1 ? "" : "s"} for \u201c<strong>${esc(q)}</strong>\u201d</p>${recipeList(recipes)}`;
  }
  window.__searchResults = searchResultsHtml;

  function cookbook(q) {
    const nt = newTrending();
    const picked = pickedForYou();
    const browse = `<div id="browse"${q ? " hidden" : ""}>
      <section class="browse-section">
        <div class="section-head"><h2>New &amp; trending</h2></div>
        ${recipeList(nt.shown)}
        ${nt.hasMore ? `<button class="see-more" data-act="nt-more">${nt.expanded ? "See less" : "See more"} ${I.chevron}</button>` : ""}
      </section>
      <section class="browse-section">
        <div class="section-head"><h2>Picked for you</h2><p>From your favorites and what fits your preferences.</p></div>
        ${picked.length ? recipeList(picked) : `<p class="muted-line">Favorite a few recipes and tailored picks show up here.</p>`}
      </section>
    </div>`;
    return `${pageHead("Cookbook", "Search the cookbook, or see what's new and picked for you.")}
      <div class="searchbar" id="searchbar" data-has-text="${q ? "true" : "false"}">
        ${I.search}
        <input class="input" id="q" type="search" autocomplete="off" spellcheck="false" placeholder="Search recipes\u2026" aria-label="Search recipes" value="${esc(q)}" />
        <button class="search-clear" id="qClear" aria-label="Clear search">${I.x}</button>
      </div>
      ${browse}
      <div id="results"${q ? "" : " hidden"}>${q ? searchResultsHtml(q) : ""}</div>`;
  }

  // ---- Recipe detail -------------------------------------------------------
  function recipe(slug) {
    const r = CB.bySlug(slug);
    if (!r) return `${crumb([{ label: "Cookbook", href: "#/" }, { label: "Not found" }])}${emptyBlock("Recipe not found", "It may have been renamed or removed.", { icon: I.search, action: `<a class="btn" href="#/">${I.back} Browse the cookbook</a>` })}`;
    const fav = APP.actions.isFavorite(slug);
    const planned = APP.actions.inPlan(slug);
    const time = r.time ? `<span class="detail-time">${I.clock} ${r.time} min</span>` : "";
    const source = r.source ? `<p class="detail-source">Source: <a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.source)}</a></p>` : "";

    const sims = CB.similar(slug);
    const similar = sims.length ? `<section class="similar"><h2>Similar recipes</h2>${recipeList(sims)}</section>` : "";

    // Community notes (other members) + the member's own editable notes.
    const community = (r.notes || []).filter((n) => n.author !== APP.state().user);
    const mine = APP.state().userNotes[slug] || [];

    return `
      ${crumb([{ label: "Cookbook", href: "#/" }, { label: r.title }])}
      <article class="detail">
        <div class="detail-titlerow">
          <h1>${esc(r.title)}</h1>
          <button class="fav-btn lg${fav ? " on" : ""}" data-act="fav" data-slug="${esc(slug)}" aria-pressed="${fav}" title="${fav ? "Unfavorite" : "Favorite"}">${fav ? I.heartFill : I.heart}</button>
        </div>
        <div class="detail-meta">${facets(r)}${time}</div>
        ${source}
        <div class="action-row">
          <a class="btn" href="https://claude.ai/new?q=${encodeURIComponent('/cook ' + slug)}" target="_blank" rel="noopener">${I.sparkles} Cook with Claude</a>
          <button class="btn" data-variant="outline" data-act="plan-add" data-slug="${esc(slug)}" ${planned ? "disabled" : ""}>${I.cal} ${planned ? "In meal plan" : "Add to meal plan"}</button>
          <button class="btn" data-variant="ghost" data-act="log-recipe" data-slug="${esc(slug)}">${I.check} Log as cooked</button>
        </div>
        <div class="prose">${CB.body(r)}</div>

        <section class="notes">
          <h2>Your notes</h2>
          <form class="note-form" data-act="note-add" data-slug="${esc(slug)}">
            <textarea class="textarea" name="body" rows="2" placeholder="Add a note for next time\u2026"></textarea>
            <div class="note-form-row">
              <input class="input note-tag-input" name="tag" placeholder="tag (optional)" autocomplete="off" />
              <label class="note-priv"><input type="checkbox" name="private" class="input" /> Private</label>
              <button class="btn" data-size="sm" type="submit">${I.plus} Add note</button>
            </div>
          </form>
          ${mine.length ? `<ul class="notelist mine">${mine.map((n) => myNote(slug, n)).join("")}</ul>` : `<p class="muted-line">No notes yet — jot down a tweak after you cook it.</p>`}
          ${community.length ? `<h2 class="community-h">From other members</h2><ul class="notelist">${community.map(communityNote).join("")}</ul>` : ""}
        </section>

        ${similar}
      </article>`;
  }

  function myNote(slug, n) {
    const tag = n.tag ? `<span class="note-tag">${esc(n.tag)}</span>` : "";
    const priv = n.private ? `<span class="note-priv-badge">private</span>` : "";
    return `<li class="note" data-note="${n.id}">
      <span class="note-avatar you" aria-hidden="true">${esc((APP.state().user || "?").charAt(0).toUpperCase())}</span>
      <div class="note-main">
        <div class="note-head">
          <span class="note-author">you</span>${tag}${priv}
          <span class="note-time">${esc(APP.relAge(n.at))}</span>
          <span class="note-actions">
            <button class="icon-btn" data-act="note-edit" data-slug="${esc(slug)}" data-id="${n.id}" title="Edit">${I.edit}</button>
            <button class="icon-btn" data-act="note-del" data-slug="${esc(slug)}" data-id="${n.id}" title="Delete">${I.trash}</button>
          </span>
        </div>
        <p class="note-body">${esc(n.body)}</p>
      </div>
    </li>`;
  }

  function communityNote(n) {
    const tag = n.tag ? `<span class="note-tag">${esc(n.tag)}</span>` : "";
    return `<li class="note">
      <span class="note-avatar" aria-hidden="true">${esc(n.author.charAt(0).toUpperCase())}</span>
      <div class="note-main">
        <div class="note-head"><span class="note-author">${esc(n.author)}</span>${tag}<span class="note-time">${esc(APP.relAge(Date.now() - (n.days || 1) * 86400000))}</span></div>
        <p class="note-body">${esc(n.body)}</p>
      </div>
    </li>`;
  }

  // ---- Favorites -----------------------------------------------------------
  function favorites() {
    const slugs = APP.state().favorites;
    const recipes = slugs.map((s) => CB.bySlug(s)).filter(Boolean);
    return `${pageHead("Favorites", `${recipes.length} saved recipe${recipes.length === 1 ? "" : "s"}.`)}
      ${recipes.length ? recipeList(recipes) : emptyBlock("No favorites yet", "Tap the heart on any recipe to save it here.", { icon: I.heart })}`;
  }

  // ---- Meal plan -----------------------------------------------------------
  function plan() {
    const items = APP.state().mealPlan.slice();
    const scheduled = items.filter((p) => p.planned_for).sort((a, b) => a.planned_for.localeCompare(b.planned_for));
    const unscheduled = items.filter((p) => !p.planned_for);
    const rowHtml = (p) => {
      const sides = p.sides.map((s) => `<span class="side-chip">${esc(s)}<button class="side-x" data-act="side-remove" data-id="${p.id}" data-side="${esc(s)}" title="Remove side">${I.x}</button></span>`).join("");
      return `<div class="plan-row" data-plan="${p.id}">
        <div class="plan-when">
          <input type="date" class="input plan-date" value="${p.planned_for || ""}" data-act="plan-date" data-id="${p.id}" aria-label="Planned date" />
        </div>
        <div class="plan-main">
          <a class="plan-title" href="#/recipe/${esc(p.recipe)}">${esc(p.title)}</a>
          <div class="plan-sides">
            ${sides}
            <button class="side-add" data-act="side-add" data-id="${p.id}" title="Add a side">${I.plus} side</button>
          </div>
        </div>
        <button class="icon-btn" data-act="plan-remove" data-id="${p.id}" title="Remove from plan">${I.trash}</button>
      </div>`;
    };
    const addBtn = `
      <a class="btn" data-size="sm" href="#/propose" title="Shape a week from your night-vibe palette">${I.sparkle} Plan my week</a>
      <div class="field-inline plan-add-inline">
        <div class="cb-mount" data-combobox="plan-add"></div>
      </div>`;
    return `${pageHead("Meal plan", "What you're cooking next. Schedule a night, add sides, or pull a recipe in.", addBtn)}
      ${items.length === 0 ? emptyBlock("Nothing planned", "Add a recipe from here or hit \u201cAdd to meal plan\u201d on any recipe.", { icon: I.cal }) : `
        ${scheduled.length ? `<div class="plan-group"><h2 class="group-h">Scheduled</h2>${scheduled.map(rowHtml).join("")}</div>` : ""}
        ${unscheduled.length ? `<div class="plan-group"><h2 class="group-h">Unscheduled</h2>${unscheduled.map(rowHtml).join("")}</div>` : ""}`}`;
  }

  // ---- Grocery list --------------------------------------------------------
  function grocery() {
    const items = APP.state().grocery;
    const active = items.filter((g) => g.status !== "in_cart");
    const inCart = items.filter((g) => g.status === "in_cart");
    const itemHtml = (g) => {
      const forR = g.for_recipes.length ? `<span class="g-for">for ${g.for_recipes.map((s) => `<a href="#/recipe/${esc(s)}">${esc(s)}</a>`).join(", ")}</span>` : "";
      const note = g.note ? `<span class="g-note">· ${esc(g.note)}</span>` : "";
      return `<li class="g-item${g.status === "in_cart" ? " in-cart" : ""}">
        <button class="g-check" data-act="cart-toggle" data-id="${g.id}" aria-pressed="${g.status === "in_cart"}" title="${g.status === "in_cart" ? "Move back to list" : "Mark in cart"}">${g.status === "in_cart" ? I.check : ""}</button>
        <div class="g-main">
          <div class="g-top"><span class="g-name">${esc(g.name)}</span><span class="g-qty">${esc(g.quantity)}</span></div>
          <div class="g-sub"><span class="facet g-src">${esc(g.source.replace("_", "-"))}</span>${forR}${note}</div>
        </div>
        <button class="icon-btn" data-act="grocery-remove" data-id="${g.id}" title="Remove">${I.trash}</button>
      </li>`;
    };

    // Keyboard-driven add row, rendered at the BOTTOM of the list.
    const addRow = `<form class="g-add-row" data-act="grocery-add">
      <span class="g-add-plus" aria-hidden="true">${I.plus}</span>
      <input id="gAddName" class="input" name="name" placeholder="Add an item — press Enter" autocomplete="off" aria-label="Item name" />
      <input class="input g-qty-in" name="quantity" placeholder="qty" autocomplete="off" aria-label="Quantity" />
    </form>`;

    // Store / shopping mode — determines how the list is ordered.
    const mode = APP.state().store || (APP.meta().kroger === "linked" ? "kroger" : "category");
    const store = STORES.find((s) => s.id === mode) || STORES[0];
    const toolbar = `<div class="g-toolbar">
      <div class="store-picker">
        <label class="store-label" for="storeSel">Store</label>
        <select class="select" id="storeSel" data-act="set-store" aria-label="Store being shopped">
          ${STORES.map((s) => `<option value="${s.id}" ${s.id === mode ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
        </select>
      </div>
      <div class="g-toolbar-actions">
        <button class="btn" data-variant="outline" data-size="sm" data-act="propose-subs">${I.swap} Propose substitutions</button>
        ${mode === "kroger" && active.length ? `<button class="btn" data-size="sm" data-act="cart-all">${I.cart} Add all to Kroger cart</button>` : ""}
      </div>
    </div>`;

    // Substitution suggestions panel (toggled), grounded in the active list.
    const dismissed = window.__subsDismissed || (window.__subsDismissed = new Set());
    const suggestions = active
      .map((g) => ({ g, s: SUBS[g.name] }))
      .filter((x) => x.s && !dismissed.has(x.g.id));
    const subsPanel = window.__subsOpen ? `<section class="subs-panel">
      <header class="subs-head">
        <div><h2>${I.swap} Proposed substitutions</h2><p>Swaps the agent found for what's on your list \u2014 out of stock, on sale, or a better fit.</p></div>
        <button class="icon-btn" data-act="subs-close" title="Dismiss all">${I.x}</button>
      </header>
      ${suggestions.length ? `<ul class="subs-list">${suggestions.map(({ g, s }) => `<li class="subs-row">
        <div class="subs-swap"><span class="subs-from">${esc(g.name)}</span>${I.chevron}<span class="subs-to">${esc(s.to)}</span><span class="subs-why">${esc(s.why)}</span></div>
        <div class="subs-actions">
          <button class="btn" data-size="sm" data-act="subs-accept" data-id="${g.id}" data-to="${esc(encodeURIComponent(s.to))}">Swap</button>
          <button class="btn" data-variant="ghost" data-size="sm" data-act="subs-dismiss" data-id="${g.id}">Keep</button>
        </div>
      </li>`).join("")}</ul>` : `<p class="subs-empty">No substitutions to suggest right now \u2014 your list looks good.</p>`}
    </section>` : "";

    // ── "Already in your pantry" — planned-recipe ingredients you already have ──
    // Cross-references the meal plan's recipe ingredients against the pantry so you
    // don't re-buy what's on hand; flags perishables + not-recently-verified items
    // to give a quick "check this is still good" nudge.
    const sing = (w) => w.replace(/s$/, "");
    const wordsOf = (s) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3).map(sing);
    const pantryList = APP.state().pantry;
    const matchPantry = (ingredient) => {
      const it = wordsOf(ingredient);
      return pantryList.find((p) => { const pw = wordsOf(p.name); const head = pw[pw.length - 1]; return head && it.includes(head); });
    };
    const plannedRecipes = APP.state().mealPlan.map((p) => CB.bySlug(p.recipe)).filter(Boolean);
    const haveMap = new Map();
    plannedRecipes.forEach((r) => {
      r.ingredients.forEach((ing) => {
        const p = matchPantry(ing);
        if (!p) return;
        const e = haveMap.get(p.id) || { item: p, recipes: new Set() };
        e.recipes.add(r.title);
        haveMap.set(p.id, e);
      });
    });
    const rank = (e) => { const s = PERISHABLE.has(e.item.category) && daysSince(e.item.last_verified_at) >= STALE_DAYS; return s ? 0 : (PERISHABLE.has(e.item.category) ? 1 : 2); };
    const haveList = [...haveMap.values()].sort((a, b) => rank(a) - rank(b) || a.item.name.localeCompare(b.item.name));
    const haveItem = (e) => {
      const p = e.item;
      const perish = PERISHABLE.has(p.category);
      const days = daysSince(p.last_verified_at);
      const stale = perish && days >= STALE_DAYS;
      const forR = [...e.recipes].map((t) => esc(t)).join(", ");
      const flag = stale
        ? `<span class="ph-flag warn">${I.alert} ${days}d unchecked — verify</span>`
        : (perish ? `<span class="ph-flag">perishable</span>` : "");
      const actions = stale
        ? `<div class="ph-actions"><button class="btn" data-size="sm" data-variant="outline" data-act="pantry-verify" data-id="${p.id}">${I.check} Verify</button><button class="btn" data-size="sm" data-variant="ghost" data-act="ph-buy" data-name="${esc(p.name)}">Buy fresh</button></div>`
        : "";
      return `<li class="ph-item${stale ? " stale" : ""}">
        <span class="ph-have" aria-hidden="true">${I.check}</span>
        <div class="ph-main">
          <div class="ph-top"><span class="ph-name">${esc(p.name)}</span><span class="ph-qty">${esc(p.quantity)} on hand</span></div>
          <div class="ph-sub">needed for ${forR}${flag ? ` <span class="ph-sep">·</span> ${flag}` : ""}</div>
        </div>
        ${actions}
      </li>`;
    };
    const pantryHave = haveList.length ? `<section class="pantry-have">
      <header class="ph-head"><div><h2>${I.check} Already in your pantry</h2><p>Your planned recipes need these, but you already have them — no need to buy. Give the flagged perishables a quick check.</p></div></header>
      <ul class="ph-list">${haveList.map(haveItem).join("")}</ul>
    </section>` : "";

    const groups = groupGrocery(active, mode);
    const groupsHtml = groups.map((grp) => `<div class="g-group">
      <h2 class="group-h">${esc(grp.label)}</h2>
      <ul class="g-list">${grp.items.map(itemHtml).join("")}</ul>
    </div>`).join("");

    return `${pageHead("Grocery list", `${active.length} to buy${inCart.length ? ` · ${inCart.length} in cart` : ""}.`)}
      ${toolbar}
      ${subsPanel}
      ${pantryHave}
      ${items.length === 0 ? emptyBlock("List is empty", "Add items, or plan a meal to pull ingredients in.") : `
        ${groupsHtml}
        ${addRow}
        ${inCart.length ? `<div class="g-cart-group"><div class="group-h-row"><h2 class="group-h">In cart</h2><button class="btn" data-variant="ghost" data-size="sm" data-act="cart-clear">Clear purchased</button></div><ul class="g-list dim">${inCart.map(itemHtml).join("")}</ul></div>` : ""}`}
      ${items.length === 0 ? addRow : ""}`;
  }

  // ---- Pantry --------------------------------------------------------------
  function pantry() {
    const items = APP.state().pantry;
    const stale = items.filter((p) => PERISHABLE.has(p.category) && daysSince(p.last_verified_at) >= STALE_DAYS)
      .sort((a, b) => daysSince(b.last_verified_at) - daysSince(a.last_verified_at));
    const staleIds = new Set(stale.map((p) => p.id));
    const rest = items.filter((p) => !staleIds.has(p.id));
    const cats = {};
    rest.forEach((p) => { (cats[p.category] = cats[p.category] || []).push(p); });
    const order = Object.keys(cats).sort();
    const itemHtml = (p) => `<div class="pantry-item" data-pantry="${p.id}">
      <div class="pantry-main">
        <span class="pantry-name">${esc(p.name)}</span>
        ${p.prepared_from ? `<span class="pantry-prep">from ${esc(p.prepared_from)}</span>` : ""}
        <span class="pantry-verified">verified ${esc(p.last_verified_at)}</span>
      </div>
      <input class="input pantry-qty" value="${esc(p.quantity)}" data-act="pantry-qty" data-id="${p.id}" aria-label="Quantity" />
      <button class="icon-btn" data-act="pantry-verify" data-id="${p.id}" title="Mark verified today">${I.check}</button>
      <button class="icon-btn" data-act="pantry-remove" data-id="${p.id}" title="Remove">${I.trash}</button>
    </div>`;
    const staleHtml = (p) => `<div class="pantry-item stale" data-pantry="${p.id}">
      <div class="pantry-main">
        <span class="pantry-name">${esc(p.name)}</span>
        <span class="pantry-stale">${daysSince(p.last_verified_at)}d unchecked</span>
      </div>
      <input class="input pantry-qty" value="${esc(p.quantity)}" data-act="pantry-qty" data-id="${p.id}" aria-label="Quantity" />
      <button class="btn" data-size="sm" data-variant="outline" data-act="pantry-verify" data-id="${p.id}">${I.check} Verify</button>
      <button class="icon-btn" data-act="pantry-remove" data-id="${p.id}" title="Remove">${I.trash}</button>
    </div>`;
    const head = `<form class="field-inline pantry-add" data-act="pantry-add">
      <input class="input" name="name" placeholder="Add to pantry\u2026" autocomplete="off" aria-label="Item" />
      <input class="input p-cat" name="category" placeholder="category" autocomplete="off" aria-label="Category" />
      <input class="input p-qty" name="quantity" placeholder="qty" autocomplete="off" aria-label="Quantity" />
      <button class="btn" data-size="sm" type="submit">${I.plus} Add</button>
    </form>`;
    const verifySection = stale.length ? `<section class="verify-section">
      <header class="verify-head"><h2>${I.alert} Needs verification</h2><p>Perishables you haven't checked in a while \u2014 they may be spoiled or used up. Verify to keep, or remove.</p></header>
      ${stale.map(staleHtml).join("")}
    </section>` : "";
    return `${pageHead("Pantry", `${items.length} item${items.length === 1 ? "" : "s"} on hand${stale.length ? ` · ${stale.length} to verify` : ""}.`, head)}
      ${items.length === 0 ? emptyBlock("Pantry is empty", "Add what you keep on hand so the agent can plan around it.") : `
        ${verifySection}
        ${order.map((c) => `<div class="pantry-group"><h2 class="group-h">${esc(c)}</h2>${cats[c].map(itemHtml).join("")}</div>`).join("")}`}`;
  }

  // ---- Cooking log ---------------------------------------------------------
  function log() {
    const items = APP.state().cookingLog;
    const rowHtml = (c) => `<div class="log-row">
      <span class="log-date">${esc(APP.fmtDay(c.at))}</span>
      <div class="log-main">
        ${c.recipe ? `<a class="log-title" href="#/recipe/${esc(c.recipe)}">${esc(c.title)}</a>` : `<span class="log-title plain">${esc(c.title)}</span>`}
        <div class="log-facets">
          ${c.protein ? `<span class="facet" data-kind="protein">${esc(c.protein)}</span>` : ""}
          ${c.cuisine ? `<span class="facet">${esc(c.cuisine)}</span>` : ""}
          ${c.type && c.type !== "cooked" ? `<span class="log-type log-type-${esc(c.type)}">${esc(c.type)}</span>` : ""}
        </div>
      </div>
      <button class="icon-btn" data-act="log-remove" data-id="${c.id}" title="Remove">${I.trash}</button>
    </div>`;
    const head = `<form class="field-inline log-add" data-act="log-add">
      <select class="select" name="recipe" aria-label="Recipe cooked">
        <option value="">Log a cook\u2026</option>
        ${CB.sortedIndex().map((r) => `<option value="${esc(r.slug)}">${esc(r.title)}</option>`).join("")}
      </select>
      <button class="btn" data-size="sm" type="submit">${I.plus} Log</button>
    </form>`;
    return `${pageHead("Cooking log", `${items.length} recent meal${items.length === 1 ? "" : "s"} \u2014 cooked and out.`, head)}
      ${items.length === 0 ? emptyBlock("No history yet", "Log a cook and it shows up here.") : `<div class="log-list">${items.map(rowHtml).join("")}</div>`}`;
  }

  // ---- Profile / preferences -----------------------------------------------
  function seg(act, key, value, opts) {
    return `<div class="seg" data-seg="${key}">${opts.map((o) => `<button data-act="${act}" data-key="${key}" data-val="${o}" aria-pressed="${o === value}">${esc(o)}</button>`).join("")}</div>`;
  }
  function chips(field, selected, all) {
    // Selected values render as removable tokens; a combobox adds more — from the
    // known list or a typed-in custom restriction (add-your-own).
    const toks = selected.map((v) => `<span class="token"><span class="token-label">${esc(v)}</span><button class="token-x" data-act="diet-toggle" data-field="${field}" data-val="${esc(v)}" aria-label="Remove ${esc(v)}" title="Remove">${I.x}</button></span>`).join("");
    return `<div class="token-field">${toks}<div class="cb-mount token-add" data-combobox="diet-${field}"></div></div>`;
  }

  function multiChips(act, selected, all) {
    return `<div class="chip-toggle">${all.map((v) => `<button class="chip-tog${selected.includes(v) ? " on" : ""}" data-act="${act}" data-val="${esc(v)}" aria-pressed="${selected.includes(v)}">${esc(v)}</button>`).join("")}</div>`;
  }

  // Minimal markdown → HTML for the free-form profile prose: paragraphs, bullet
  // lists, **bold**, *italic*. Input is escaped first, so it's safe.
  function mdToHtml(src) {
    const inline = (s) => s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    const blocks = String(src == null ? "" : src).trim().split(/\n{2,}/).filter(Boolean);
    if (!blocks.length) return `<p class="muted">Nothing yet.</p>`;
    return blocks.map((b) => {
      const lines = b.split("\n");
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(esc(l.replace(/^\s*[-*]\s+/, "")))}</li>`).join("")}</ul>`;
      }
      return `<p>${inline(esc(b)).replace(/\n/g, "<br>")}</p>`;
    }).join("");
  }

  // A view/edit block for one free-form (markdown) profile field.
  function mdField(key, label, hint) {
    const p = APP.state().profile;
    return `<div class="prof-md-field" data-field="${key}">
      <div class="prof-md-head">
        <label>${esc(label)}${hint ? ` <span class="muted">\u2014 ${esc(hint)}</span>` : ""}</label>
        <button class="btn" data-variant="ghost" data-size="xs" data-act="edit-profile-note" data-key="${key}">${I.pencil} Edit</button>
      </div>
      <div class="prof-md md">${mdToHtml(p[key])}</div>
    </div>`;
  }

  // The agent's *derived* read on the member — grounded in cooking log + favorites.
  function tasteRead() {
    const s = APP.state();
    const p = s.profile;
    const tally = (arr, key) => {
      const m = {};
      arr.forEach((x) => { const v = x[key]; if (v) m[v] = (m[v] || 0) + 1; });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    const cuisines = tally(s.cookingLog, "cuisine");
    const proteins = tally(s.cookingLog, "protein");
    const favRecipes = s.favorites.map((slug) => CB.bySlug(slug)).filter(Boolean);
    const list = (arr) => arr.length <= 1 ? (arr[0] || "") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;

    const sentences = [];
    if (cuisines.length) {
      const top = cuisines.slice(0, 2).map(([c]) => cap(c));
      const pr = proteins.length ? proteins.slice(0, 2).map(([c]) => c) : [];
      sentences.push(`Across your last ${s.cookingLog.length} cooks you lean <strong>${list(top)}</strong>${pr.length ? `, usually built around <strong>${list(pr)}</strong>` : ""}.`);
    }
    if (favRecipes.length) {
      sentences.push(`You keep coming back to ${list(favRecipes.slice(0, 3).map((r) => `<strong>${esc(r.title)}</strong>`))}.`);
    }
    const guards = [];
    if (p.dietary.avoid.length) guards.push(`keep ${list(p.dietary.avoid.map(esc))} off the table`);
    if (p.dietary.limit.length) guards.push(`go easy on ${list(p.dietary.limit.map(esc))}`);
    if (guards.length) { const g = list(guards); sentences.push("You " + g + "."); }
    const lunchMap = { buy: "buy lunch out", cook: "cook lunch", leftovers: "lean on leftovers for lunch", mixed: "mix it up for lunch" };
    const lunchArr = Array.isArray(p.lunch_strategy) ? p.lunch_strategy : (p.lunch_strategy ? [p.lunch_strategy] : []);
    const lunchPhrases = lunchArr.map((v) => lunchMap[v]).filter(Boolean);
    sentences.push(`You cook about <strong>${p.default_cooking_nights} nights</strong> a week${lunchPhrases.length ? ` and ${list(lunchPhrases)}` : ""}.`);

    const facet = (label, entries, fmt) => entries.length ? `<div class="taste-facet">
      <span class="taste-facet-label">${label}</span>
      <div class="taste-chips">${entries.map(fmt).join("")}</div>
    </div>` : "";

    return `<div class="taste-prose"><p>${sentences.join(" ")}</p></div>
      <div class="taste-facets">
        ${facet("Cuisines you cook", cuisines.slice(0, 5), ([c, n]) => `<span class="taste-chip">${esc(cap(c))} <span class="taste-count">${n}</span></span>`)}
        ${facet("Proteins you reach for", proteins.slice(0, 5), ([c, n]) => `<span class="taste-chip">${esc(c)} <span class="taste-count">${n}</span></span>`)}
        ${facet("Go-to recipes", favRecipes.slice(0, 4).map((r) => [r]), ([r]) => `<a class="taste-chip link" href="#/recipe/${esc(r.slug)}">${esc(r.title)}</a>`)}
      </div>`;
  }

  function profile() {
    const p = APP.state().profile;
    const m = APP.meta();
    const brands = Object.entries(p.brands || {}).map(([cat, vals]) => {
      const items = (vals && vals.length) ? vals : [null];
      const ranked = items.length > 1;
      const chips = items.map((b, i) => `<li class="brand-chip">
          ${ranked ? `<span class="brand-rank-n">${i + 1}</span>` : ""}
          <span class="brand-val">${b ? esc(b) : "<span class=\"muted\">any</span>"}</span>
          <span class="brand-ctrls">
            ${ranked ? `<button class="brand-ctrl" data-act="brand-move" data-cat="${esc(cat)}" data-brand="${esc(b)}" data-dir="up" title="More preferred" aria-label="Rank up"${i === 0 ? " disabled" : ""}>${I.up}</button>
            <button class="brand-ctrl" data-act="brand-move" data-cat="${esc(cat)}" data-brand="${esc(b)}" data-dir="down" title="Less preferred" aria-label="Rank down"${i === items.length - 1 ? " disabled" : ""}>${I.down}</button>` : ""}
            <button class="brand-x" data-act="brand-remove" data-cat="${esc(cat)}" data-brand="${esc(b || "")}" title="Remove">${I.x}</button>
          </span>
        </li>`).join("");
      return `<div class="brand-row"><span class="brand-cat">${esc(cat)}</span><ol class="brand-rank">${chips}</ol></div>`;
    }).join("");
    const tab = window.__profileTab || "taste";
    APP.actions.refreshPending();
    const pendingN = (APP.state().pendingProposals || []).length;
    const tabNav = `<nav class="prof-tabs" role="tablist">${[["taste", "Taste profile"], ["prefs", "Preferences"], ["vibes", "Night vibes"]].map(([k, label]) => `<button class="prof-tab${tab === k ? " on" : ""}" role="tab" aria-selected="${tab === k}" data-act="prof-tab" data-tab="${k}">${label}${k === "vibes" && pendingN ? `<span class="prof-tab-badge">${pendingN}</span>` : ""}</button>`).join("")}</nav>`;
    return `${pageHead("Profile & preferences", "How the agent plans for you. Editable here, used everywhere.")}
      ${tabNav}
      <div class="prof-tabpanel" role="tabpanel">
      ${tab === "taste" ? `<section class="card prof-taste">
        <header><h3>${I.sparkle} Taste profile</h3><p>What the agent has learned about how you eat \u2014 and what you've told it in your own words.</p></header>
        <div class="taste-cols">
          <div class="taste-read">${tasteRead()}</div>
          <div class="taste-notes">
            ${mdField("taste_note", "In your words", "guidance the agent reads")}
            ${mdField("kitchen_note", "Kitchen \u0026 household", "")}
          </div>
        </div>
      </section>` : ""}
      ${tab === "prefs" ? `<div class="prof-grid">
        <section class="card prof-card">
          <header><h3>Planning</h3></header>
          <section class="prof-fields">
            <div class="prof-field"><label>Cooking nights per week</label>${seg("profile-num", "default_cooking_nights", String(p.default_cooking_nights), ["2", "3", "4", "5"])}</div>
            <div class="prof-field"><label>Lunch strategy <span class="muted">— pick any that apply</span></label>${multiChips("lunch-toggle", Array.isArray(p.lunch_strategy) ? p.lunch_strategy : [], ["buy", "cook", "leftovers"])}</div>
            <div class="prof-field"><label>Ready-to-eat items</label>${seg("profile", "ready_to_eat_default_action", p.ready_to_eat_default_action, ["opt-in", "auto-add"])}</div>
            <div class="prof-field"><label>Resurface recipes after</label>
              <select class="select" data-act="profile-rot" data-key="resurface_after_days">
                ${[21, 30, 45].map((d) => `<option value="${d}" ${p.rotation.resurface_after_days === d ? "selected" : ""}>${d} days</option>`).join("")}
              </select>
            </div>
            <div class="prof-field"><label>Novelty boost <span class="muted">(${p.rotation.novelty_boost})</span></label>
              <input type="range" class="input" min="0.1" max="0.5" step="0.05" value="${p.rotation.novelty_boost}" data-act="profile-rot" data-key="novelty_boost" />
            </div>
          </section>
        </section>

        <section class="card prof-card">
          <header><h3>Dietary</h3><p>Filters every plan and grocery run.</p></header>
          <section class="prof-fields">
            <div class="prof-field"><label>Avoid entirely</label>${chips("avoid", p.dietary.avoid, APP.AVOID)}</div>
            <div class="prof-field"><label>Limit</label>${chips("limit", p.dietary.limit, APP.LIMIT)}</div>
          </section>
        </section>

        <section class="card prof-card prof-card-wide">
          <header><h3>Store</h3></header>
          <section class="prof-fields">
            <div class="prof-fields-row">
              <div class="prof-field"><label>Preferred store</label><div class="prof-static">${p.stores.preferred_location ? esc(p.stores.preferred_location) : (p.stores.primary ? cap(p.stores.primary) + " <span class=\"muted\">— no location set</span>" : "<span class=\"muted\">none linked</span>")}</div></div>
              <div class="prof-field"><label>ZIP</label><input class="input p-zip" value="${esc(p.stores.location_zip)}" data-act="profile-store" data-key="location_zip" aria-label="ZIP" /></div>
            </div>
            <div class="prof-field prof-field-full"><label>Preferred brands <span class="muted">— ranked; the agent tries #1 first</span></label>
              <div class="brand-list">${brands}
                <form class="brand-add" data-act="brand-add">
                  <input class="input brand-in-cat" name="category" placeholder="category" autocomplete="off" aria-label="Brand category" />
                  <input class="input brand-in-name" name="brand" placeholder="brand" autocomplete="off" aria-label="Brand" />
                  <button class="btn" data-size="icon-xs" type="submit" title="Add brand" aria-label="Add brand">${I.plus}</button>
                </form>
              </div>
            </div>
          </section>
        </section>
      </div>` : ""}
      ${tab === "vibes" && window.ProposeUI ? window.ProposeUI.palette() : ""}
      </div>`;
  }

  window.Pages = Object.assign(window.Pages || {}, { cookbook, recipe, favorites, plan, grocery, pantry, log, profile });
})();
