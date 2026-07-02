/* Cookbook redesign — client app. Vanilla, framework-free (faithful to the
   server-rendered, near-no-script production surface). Renders the index,
   in-place keyword search, recipe pages, similar recipes, and the empty / 404
   states. Routing via location.hash so states are shareable and Back works.
   Theme + accent persist to localStorage under cookbook:* keys. */
(function () {
  const CB = window.CB;
  const app = document.getElementById("app");

  // ---- icons ---------------------------------------------------------------
  const I = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></svg>',
  };

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- recipe list item ----------------------------------------------------
  function recipeRow(r) {
    const facets = [
      r.protein ? `<span class="facet" data-kind="protein">${esc(r.protein)}</span>` : "",
      r.cuisine ? `<span class="facet">${esc(r.cuisine)}</span>` : "",
    ].join("");
    const desc = r.description ? `<div class="rdesc">${esc(r.description)}</div>` : "";
    return `<li>
      <a class="rrow" href="#/${esc(r.slug)}" role="link">
        <span class="rtitle">${esc(r.title)}</span>
        <span class="rchev" aria-hidden="true">${I.chevron}</span>
        ${desc}
        <span class="rfacets">${facets}</span>
      </a>
    </li>`;
  }

  function recipeList(rows) {
    return `<ul class="recipes">${rows.map(recipeRow).join("")}</ul>`;
  }

  // ---- search bar ----------------------------------------------------------
  function searchBar(q) {
    return `<div class="searchbar" id="searchbar" data-has-text="${q ? "true" : "false"}">
      ${I.search}
      <input class="input" id="q" type="search" autocomplete="off" spellcheck="false"
             placeholder="Search recipes\u2026" aria-label="Search recipes" value="${esc(q)}" />
      <button class="search-clear" id="qClear" aria-label="Clear search">${I.x}</button>
    </div>`;
  }

  // ---- views ---------------------------------------------------------------
  function viewIndex(q) {
    const recipes = q ? CB.rank(q) : CB.sortedIndex();
    let meta, list;
    if (q) {
      meta = recipes.length
        ? `${recipes.length} result${recipes.length === 1 ? "" : "s"} for \u201c<strong>${esc(q)}</strong>\u201d`
        : "";
      list = recipes.length
        ? recipeList(recipes)
        : emptyBlock(I.search, "No matches", `Nothing in the cookbook matches \u201c${esc(q)}\u201d. Try a protein, a cuisine, or an ingredient.`);
    } else {
      meta = `<strong>${recipes.length}</strong> recipe${recipes.length === 1 ? "" : "s"} in the cookbook`;
      list = recipeList(recipes);
    }

    app.innerHTML = `
      <section class="lead">
        <h1>Cookbook</h1>
        <p>Every recipe the agent can cook from \u2014 search or browse them all.</p>
      </section>
      ${searchBar(q)}
      <div id="results">
        ${meta ? `<p class="resultmeta">${meta}</p>` : ""}
        ${list}
      </div>
      ${footer()}`;
    wireSearch(q);
  }

  function viewRecipe(slug) {
    const r = CB.bySlug(slug);
    if (!r) return view404();
    const facets = [
      r.protein ? `<span class="facet" data-kind="protein">${esc(r.protein)}</span>` : "",
      r.cuisine ? `<span class="facet">${esc(r.cuisine)}</span>` : "",
    ].join("");
    const time = r.time ? `<span class="detail-time">${I.clock} ${r.time} min</span>` : "";
    const source = r.source
      ? `<p class="detail-source">Source: <a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.source)}</a></p>`
      : "";
    const sims = CB.similar(slug);
    const similar = sims.length
      ? `<section class="similar"><h2>Similar recipes</h2>${recipeList(sims)}</section>`
      : "";

    app.innerHTML = `
      <article class="detail">
        <button class="backlink" id="back">${I.back} All recipes</button>
        <h1>${esc(r.title)}</h1>
        <div class="detail-meta">${facets}${time}</div>
        ${source}
        <a class="btn cook-cta" href="https://claude.ai/new?q=${encodeURIComponent('/cook ' + r.slug)}" target="_blank" rel="noopener">${I.sparkles} Cook with Claude</a>
        <div class="prose">${CB.body(r)}</div>
        ${notesSection(r)}
        ${similar}
      </article>
      ${footer()}`;
    document.getElementById("back").addEventListener("click", () => { location.hash = "#/"; });
    window.scrollTo(0, 0);
  }

  // Member notes: attributed, lightly-tagged cooking notes surfaced under a recipe.
  function notesSection(r) {
    const notes = Array.isArray(r.notes) ? r.notes : [];
    if (!notes.length) return "";
    const items = notes.map((n) => {
      const tag = n.tag ? `<span class="note-tag">${esc(n.tag)}</span>` : "";
      return `<li class="note">
        <span class="note-avatar" aria-hidden="true">${esc(n.author.charAt(0).toUpperCase())}</span>
        <div class="note-main">
          <div class="note-head">
            <span class="note-author">${esc(n.author)}</span>
            ${tag}
            <span class="note-time">${esc(CB.relTime(n.days))}</span>
          </div>
          <p class="note-body">${esc(n.body)}</p>
        </div>
      </li>`;
    }).join("");
    return `<section class="notes">
      <h2>Notes <span class="note-count">${notes.length}</span></h2>
      <p class="notes-sub">From members who\u2019ve cooked this.</p>
      <ul class="notelist">${items}</ul>
    </section>`;
  }

  function emptyBlock(icon, title, sub) {
    return `<div class="empty">
      <header>
        <figure data-accentfig>${icon}</figure>
        <h2>${esc(title)}</h2>
        <p>${sub}</p>
      </header>
    </div>`;
  }

  function viewEmpty() {
    app.innerHTML = `
      <section class="lead">
        <h1>Cookbook</h1>
        <p>Every recipe the agent can cook from \u2014 search or browse them all.</p>
      </section>
      ${searchBar("")}
      <div class="state">
        ${emptyBlock(I.book, "No recipes yet", "There\u2019s nothing here yet. Once the agent adds its first recipe, it shows up here.")}
      </div>
      ${footer()}`;
    // search is inert with an empty corpus, but keep the field wired for parity
    wireSearch("");
  }

  function view404() {
    app.innerHTML = `
      <article class="detail">
        <button class="backlink" id="back">${I.back} All recipes</button>
        <div class="state">
          ${emptyBlock(I.ghost, "Recipe not found", "We couldn\u2019t find that recipe. It may have been renamed or removed from the cookbook.")}
          <div style="text-align:center;margin-top:1.25rem">
            <a class="btn" data-variant="outline" href="#/">${I.back} Back to the cookbook</a>
          </div>
        </div>
      </article>
      ${footer()}`;
    document.getElementById("back").addEventListener("click", () => { location.hash = "#/"; });
    window.scrollTo(0, 0);
  }

  function footer() {
    return `<footer class="foot">
      <span>Cookbook</span><span class="dot">\u00b7</span>
      <span>${CB.RECIPES.length} recipes</span><span class="dot">\u00b7</span>
      <span>Shared &amp; read-only</span>
    </footer>`;
  }

  // ---- search wiring (debounced, in-place — mirrors /cookbook/search.js) ----
  let searchTimer = null;
  function wireSearch(initialQ) {
    const bar = document.getElementById("searchbar");
    const input = document.getElementById("q");
    const clear = document.getElementById("qClear");
    if (!input) return;

    // keep focus + caret at the end when re-rendering mid-type
    if (initialQ) {
      input.focus();
      const v = input.value; input.value = ""; input.value = v;
    }

    input.addEventListener("input", () => {
      const q = input.value.trim();
      bar.setAttribute("data-has-text", input.value ? "true" : "false");
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const target = q ? "#/search/" + encodeURIComponent(q) : "#/";
        // replace (not push) so each keystroke doesn't stack history
        history.replaceState(null, "", target);
        renderRoute(true);
      }, 200);
    });

    input.form && input.form.addEventListener("submit", (e) => e.preventDefault());

    clear.addEventListener("click", () => {
      input.value = "";
      bar.setAttribute("data-has-text", "false");
      location.hash = "#/";
      input.focus();
    });
  }

  // ---- router --------------------------------------------------------------
  function parseRoute() {
    const h = location.hash.replace(/^#\/?/, "");
    if (h === "" ) return { view: "index", q: "" };
    if (h === "empty") return { view: "empty" };
    if (h.startsWith("search/")) return { view: "index", q: decodeURIComponent(h.slice(7)) };
    return { view: "recipe", slug: decodeURIComponent(h.replace(/\/$/, "")) };
  }

  function renderRoute(fromSearch) {
    const r = parseRoute();
    if (r.view === "index") viewIndex(r.q);
    else if (r.view === "empty") viewEmpty();
    else if (r.view === "recipe") viewRecipe(r.slug);
    else view404();
    if (!fromSearch) window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", () => renderRoute(false));

  // ---- theme + accent ------------------------------------------------------
  const root = document.documentElement;
  const themeBtn = document.getElementById("themeBtn");
  const segTheme = document.getElementById("segTheme");
  const segAccent = document.getElementById("segAccent");

  function applyTheme(mode) {
    root.classList.toggle("dark", mode === "dark");
    themeBtn.querySelector('[data-icon="sun"]').style.display = mode === "dark" ? "none" : "";
    themeBtn.querySelector('[data-icon="moon"]').style.display = mode === "dark" ? "" : "none";
    segTheme.querySelectorAll("button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.val === mode)));
    try { localStorage.setItem("cookbook:theme", mode); } catch (e) {}
  }
  function applyAccent(accent) {
    root.setAttribute("data-accent", accent);
    segAccent.querySelectorAll("button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.val === accent)));
    try { localStorage.setItem("cookbook:accent", accent); } catch (e) {}
  }

  themeBtn.addEventListener("click", () =>
    applyTheme(root.classList.contains("dark") ? "light" : "dark"));
  segTheme.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => applyTheme(b.dataset.val)));
  segAccent.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => applyAccent(b.dataset.val)));

  // ---- preview panel -------------------------------------------------------
  const preview = document.getElementById("preview");
  document.getElementById("previewToggle").addEventListener("click", () => {
    preview.classList.add("open");
  });
  document.getElementById("previewClose").addEventListener("click", () => {
    preview.classList.remove("open");
  });
  preview.querySelectorAll(".preview-jump button").forEach((b) =>
    b.addEventListener("click", () => { location.hash = b.dataset.go; }));

  // ---- boot ----------------------------------------------------------------
  let storedTheme = "light", storedAccent = "warm";
  try {
    storedTheme = localStorage.getItem("cookbook:theme") || "light";
    storedAccent = localStorage.getItem("cookbook:accent") || "warm";
  } catch (e) {}
  applyAccent(storedAccent);
  applyTheme(storedTheme);
  if (!location.hash) location.hash = "#/";
  else renderRoute(false);
})();
