/* Cookbook web app — shell: login gate, app frame (sidebar + topbar), hash
   router, and event delegation wiring every page's actions to window.APP. */
(function () {
  const APP = window.APP, Pages = window.Pages, CB = window.CB;
  const I = window.APP_ICONS;
  const root = document.getElementById("app-root");

  const NAV = [
    { key: "cookbook", href: "#/", label: "Cookbook", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>' },
    { key: "favorites", href: "#/favorites", label: "Favorites", icon: I.heart, count: (s) => s.favorites.length },
    { key: "plan", href: "#/plan", label: "Meal plan", icon: I.cal, count: (s) => s.mealPlan.length },
    { key: "grocery", href: "#/grocery", label: "Grocery list", icon: I.cart, count: (s) => s.grocery.filter((g) => g.status !== "in_cart").length },
    { key: "pantry", href: "#/pantry", label: "Pantry", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14a2 2 0 0 1 2 2v3H3V5a2 2 0 0 1 2-2Z"/><path d="M3 8v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>' },
    { key: "log", href: "#/log", label: "Cooking log", icon: I.clock },
  ];

  // ---- theme ----------------------------------------------------------------
  function applyTheme(mode) {
    document.documentElement.classList.toggle("dark", mode === "dark");
    try { localStorage.setItem("cookbook:theme", mode); } catch (e) {}
    const btn = document.getElementById("themeBtn");
    if (btn) {
      btn.querySelector('[data-icon="sun"]').style.display = mode === "dark" ? "none" : "";
      btn.querySelector('[data-icon="moon"]').style.display = mode === "dark" ? "" : "none";
    }
  }
  function initTheme() { let t = "light"; try { t = localStorage.getItem("cookbook:theme") || "light"; } catch (e) {} applyTheme(t); }

  // ---- toast ----------------------------------------------------------------
  function toast(msg) {
    let host = document.getElementById("toaster");
    if (!host) { host = document.createElement("div"); host.id = "toaster"; host.className = "toaster"; document.body.appendChild(host); }
    const el = document.createElement("div");
    el.className = "toast-content";
    el.innerHTML = `<span>${msg}</span>`;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));
    setTimeout(() => { el.classList.remove("in"); setTimeout(() => el.remove(), 200); }, 2200);
  }

  // ---- login ----------------------------------------------------------------
  function renderLogin() {
    root.innerHTML = `
      <div class="login-wrap">
        <button class="btn theme-fab" data-variant="ghost" data-size="icon" id="themeBtn" aria-label="Toggle dark mode">
          <svg data-icon="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
          <svg data-icon="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
        </button>
        <div class="login-card">
          <div class="login-brand">
            <span class="brand-mark">${navIcon()}</span>
            <div><div class="brand-name">Cookbook</div><div class="brand-tag">your kitchen, with the agent</div></div>
          </div>
          <form class="login-form" id="loginForm">
            <div class="field"><label class="label" for="lu">Username</label><input class="input" id="lu" name="user" placeholder="username" autocomplete="username" value="casey" /></div>
            <div class="field"><label class="label" for="lp">Password</label><input class="input" id="lp" name="pass" type="password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" autocomplete="current-password" value="hunter2" /></div>
            <button class="btn login-submit" type="submit">Sign in</button>
          </form>
          <div class="login-sep"><span>or continue as</span></div>
          <div class="login-quick">
            ${APP.MEMBERS.slice(0, 6).map((m) => `<button class="quick-user" data-act="quick-login" data-user="${m.user}"><span class="quick-avatar">${m.user.charAt(0).toUpperCase()}</span>@${m.user}${m.owner ? ' <span class="badge-sm">owner</span>' : ""}</button>`).join("")}
          </div>
          <p class="login-note">A hypothetical member surface for the grocery agent. No real auth — pick anyone.</p>
        </div>
      </div>`;
    initTheme();
  }
  function navIcon() { return NAV[0].icon; }

  // ---- account menu (sidebar bottom-left) -----------------------------------
  function toggleAccountMenu() {
    const menu = document.getElementById("sbMenu");
    const btn = document.querySelector('.sb-user[data-act="account-menu"]');
    if (!menu) return;
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    if (btn) btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
  }
  function closeAccountMenu() {
    const menu = document.getElementById("sbMenu");
    const btn = document.querySelector('.sb-user[data-act="account-menu"]');
    if (menu && !menu.hidden) { menu.hidden = true; if (btn) btn.setAttribute("aria-expanded", "false"); }
  }

  function doLogin(user) {
    if (!user) return;
    APP.setUser(user.trim().toLowerCase());
    if (!location.hash || location.hash === "#/login") location.hash = "#/";
    renderFrame();
    render();
  }

  // ---- frame ----------------------------------------------------------------
  function renderFrame() {
    const s = APP.state();
    const m = APP.meta();
    root.innerHTML = `
      <div class="app-shell">
        <aside class="app-sidebar">
          <div class="sb-brand"><span class="brand-mark sm">${navIcon()}</span><span class="brand-name">Cookbook</span></div>
          <nav class="sb-nav">
            ${NAV.map((n) => {
              const c = n.count ? n.count(s) : null;
              return `<a class="sb-link" data-nav-key="${n.key}" href="${n.href}"><span class="sb-ico">${n.icon}</span><span class="sb-label">${n.label}</span>${c ? `<span class="sb-count">${c}</span>` : ""}</a>`;
            }).join("")}
          </nav>
          <div class="sb-foot">
            <div class="sb-account">
              <button class="sb-user" data-act="account-menu" aria-haspopup="menu" aria-expanded="false">
                <span class="sb-avatar">${m.user.charAt(0).toUpperCase()}</span>
                <span class="sb-uname">@${m.user}</span>
                <svg class="sb-user-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <div class="sb-menu" id="sbMenu" role="menu" hidden>
                <div class="sb-menu-head">
                  <span class="prof-avatar">${m.user.charAt(0).toUpperCase()}</span>
                  <div>
                    <div class="prof-user">@${m.user} ${m.owner ? `<span class="badge-sm">owner</span>` : ""} ${m.kroger === "linked" ? `<span class="badge-sm linked">kroger</span>` : `<span class="badge-sm">kroger unlinked</span>`}</div>
                    <div class="muted small">${m.cooked} cooked · ${m.favorites} favorites · joined ${APP.relAge(Date.now() - m.joined * 86400000)}</div>
                  </div>
                </div>
                <div class="sb-menu-sep"></div>
                <a class="sb-menu-item" href="#/profile" role="menuitem" data-act="account-close">Profile &amp; preferences</a>
                <button class="sb-menu-item" role="menuitem" data-act="logout">Sign out</button>
                <div class="sb-menu-sep"></div>
                <button class="sb-menu-item subtle" role="menuitem" data-act="reset-data">Reset sample data</button>
                <p class="sb-menu-note">Your edits are saved locally in this browser.</p>
              </div>
            </div>
            <button class="btn theme-fab" data-variant="ghost" data-size="icon-sm" id="themeBtn" aria-label="Toggle dark mode">
              <svg data-icon="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              <svg data-icon="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
            </button>
          </div>
        </aside>
        <main class="app-content" id="app-content"></main>
      </div>`;
    initTheme();
  }

  // ---- router ---------------------------------------------------------------
  function parse() {
    const h = location.hash.replace(/^#\/?/, "");
    if (h === "") return { page: "cookbook", q: "" };
    if (h.startsWith("search/")) return { page: "cookbook", q: decodeURIComponent(h.slice(7)) };
    if (h.startsWith("recipe/")) return { page: "recipe", slug: decodeURIComponent(h.slice(7).replace(/\/$/, "")) };
    if (["favorites", "plan", "grocery", "pantry", "log", "profile", "propose"].includes(h)) return { page: h };
    return { page: "cookbook", q: "" };
  }
  const NAVKEY = { cookbook: "cookbook", recipe: "cookbook", favorites: "favorites", plan: "plan", propose: "plan", grocery: "grocery", pantry: "pantry", log: "log", profile: "profile" };

  function render() {
    if (!APP.state()) { renderLogin(); return; }
    const content = document.getElementById("app-content");
    if (!content) { renderFrame(); return render(); }
    const r = parse();
    let html = "";
    if (r.page === "cookbook") html = Pages.cookbook(r.q || "");
    else if (r.page === "recipe") html = Pages.recipe(r.slug);
    else html = Pages[r.page] ? Pages[r.page]() : Pages.cookbook("");
    content.innerHTML = html;
    // active nav + sidebar counts
    const key = NAVKEY[r.page] || "cookbook";
    document.querySelectorAll(".sb-link").forEach((l) => l.toggleAttribute("data-active", l.getAttribute("data-nav-key") === key));
    refreshCounts();
    if (r.page === "cookbook") setupSearch(r.q || "");
    mountComboboxes(content);
    content.scrollTo ? content.scrollTo(0, 0) : (content.scrollTop = 0);
  }
  window.APP_RENDER = render;
  window.__toast = toast;

  function refreshCounts() {
    const s = APP.state();
    NAV.forEach((n) => {
      if (!n.count) return;
      const link = document.querySelector(`.sb-link[data-nav-key="${n.key}"]`);
      if (!link) return;
      let badge = link.querySelector(".sb-count");
      const c = n.count(s);
      if (c) { if (!badge) { badge = document.createElement("span"); badge.className = "sb-count"; link.appendChild(badge); } badge.textContent = c; }
      else if (badge) badge.remove();
    });
  }

  // ---- in-place search ------------------------------------------------------
  let searchTimer = null;
  function setupSearch(initialQ) {
    const input = document.getElementById("q");
    if (!input) return;
    if (initialQ) { input.focus(); const v = input.value; input.value = ""; input.value = v; }
  }
  function runSearch(q) {
    const bar = document.getElementById("searchbar");
    if (bar) bar.setAttribute("data-has-text", q ? "true" : "false");
    history.replaceState(null, "", q ? "#/search/" + encodeURIComponent(q) : "#/");
    const browse = document.getElementById("browse");
    const results = document.getElementById("results");
    if (!results) return;
    if (q) {
      if (browse) browse.hidden = true;
      results.hidden = false;
      results.innerHTML = window.__searchResults ? window.__searchResults(q) : "";
    } else {
      if (browse) browse.hidden = false;
      results.hidden = true;
      results.innerHTML = "";
    }
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function rowHtml(r) {
    const fav = APP.actions.isFavorite(r.slug);
    const planned = APP.actions.inPlan(r.slug);
    const desc = r.description ? `<span class="rdesc">${esc(r.description)}</span>` : "";
    const facets = [r.protein ? `<span class="facet" data-kind="protein">${esc(r.protein)}</span>` : "", r.cuisine ? `<span class="facet">${esc(r.cuisine)}</span>` : ""].join("");
    return `<li class="rrow"><a class="rrow-link" href="#/recipe/${esc(r.slug)}"><span class="rtitle">${esc(r.title)}</span>${desc}<span class="rfacets">${facets}</span></a>
      <div class="rrow-actions">
        <button class="plan-btn${planned ? " on" : ""}" data-act="plan-toggle" data-slug="${esc(r.slug)}" aria-pressed="${planned}" title="${planned ? "In meal plan \u2014 remove" : "Add to meal plan"}">${I.cal}</button>
        <button class="fav-btn${fav ? " on" : ""}" data-act="fav" data-slug="${esc(r.slug)}" aria-pressed="${fav}" title="${fav ? "Unfavorite" : "Favorite"}">${fav ? I.heartFill : I.heart}</button>
      </div></li>`;
  }

  // ---- inline add-a-side (meal plan) — combobox over saved side names --------
  function addSideInline(btn, id) {
    const plan = APP.state().mealPlan.find((p) => p.id === id);
    const have = new Set((plan && plan.sides) || []);
    const wrap = document.createElement("span");
    wrap.className = "side-input-wrap side-combo";
    btn.replaceWith(wrap);
    const cb = window.Combobox.mount(wrap, {
      options: () => APP.SIDE_NAMES.filter((s) => !have.has(s)).map((s) => ({ value: s, label: s })),
      placeholder: "add a side\u2026",
      ariaLabel: "Add a side",
      allowCustom: true,
      emptyText: "Type a side and press Enter",
      onSelect: (value) => { const v = String(value).trim().toLowerCase(); if (v) APP.actions.addSide(id, v); render(); },
      onCancel: () => render(),
    });
    cb.focus();
  }

  // ---- inline edit of a free-form (markdown) profile note -------------------
  function editProfileNote(key) {
    const field = document.querySelector(`.prof-md-field[data-field="${key}"]`);
    if (!field || field.querySelector(".prof-md-edit")) return;
    const view = field.querySelector(".prof-md");
    const head = field.querySelector(".prof-md-head");
    const raw = (APP.state().profile[key] || "");
    const edit = document.createElement("div");
    edit.className = "prof-md-edit";
    edit.innerHTML = `<textarea class="textarea" rows="6" aria-label="${key}"></textarea>
      <div class="prof-md-actions">
        <span class="muted small">Markdown \u2014 **bold**, *italic*, - lists</span>
        <span class="prof-md-btns">
          <button class="btn" data-variant="ghost" data-size="sm" data-act="cancel-profile-note">Cancel</button>
          <button class="btn" data-size="sm" data-act="save-profile-note" data-key="${key}">Save</button>
        </span>
      </div>`;
    edit.querySelector("textarea").value = raw;
    if (head) head.querySelector("[data-act='edit-profile-note']").style.visibility = "hidden";
    view.style.display = "none";
    view.after(edit);
    const ta = edit.querySelector("textarea");
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function mountComboboxes(scope) {
    scope.querySelectorAll(".cb-mount[data-combobox]").forEach((el) => {
      const key = el.getAttribute("data-combobox");
      if (key === "plan-add") {
        window.Combobox.mount(el, {
          options: () => CB.sortedIndex().filter((r) => !APP.actions.inPlan(r.slug)).map((r) => ({ value: r.slug, label: r.title, sub: [r.protein, r.cuisine].filter(Boolean).join(" \u00b7 ") })),
          placeholder: "Add a recipe\u2026",
          ariaLabel: "Add a recipe to the plan",
          emptyText: "No recipes match",
          onSelect: (slug) => { APP.actions.addToPlan(slug); toast("Added to meal plan"); render(); },
        });
      } else if (key === "diet-avoid" || key === "diet-limit") {
        const field = key === "diet-avoid" ? "avoid" : "limit";
        const base = field === "avoid" ? APP.AVOID : APP.LIMIT;
        window.Combobox.mount(el, {
          options: () => { const sel = APP.state().profile.dietary[field]; return base.filter((v) => !sel.includes(v)).map((v) => ({ value: v, label: v })); },
          placeholder: field === "avoid" ? "Avoid\u2026" : "Limit\u2026",
          ariaLabel: field === "avoid" ? "Add something to avoid" : "Add something to limit",
          allowCustom: true,
          emptyText: "Type to add your own",
          onSelect: (val) => { const arr = APP.state().profile.dietary[field]; const v = String(val).trim().toLowerCase(); if (v && !arr.includes(v)) arr.push(v); APP.persist(); render(); },
        });
      }
    });
  }

  // ---- note inline edit -----------------------------------------------------
  function editNoteInline(li, slug, id) {
    const note = (APP.state().userNotes[slug] || []).find((n) => n.id === id);
    if (!note) return;
    const body = li.querySelector(".note-body");
    if (!body || li.querySelector(".note-edit")) return;
    const edit = document.createElement("div");
    edit.className = "note-edit";
    edit.innerHTML = `<textarea class="textarea">${note.body.replace(/</g, "&lt;")}</textarea>
      <div class="note-edit-actions"><button class="btn" data-size="sm" data-act="note-save" data-slug="${slug}" data-id="${id}">Save</button><button class="btn" data-variant="ghost" data-size="sm" data-act="note-cancel">Cancel</button></div>`;
    body.style.display = "none";
    body.after(edit);
    edit.querySelector("textarea").focus();
  }

  // ---- event delegation -----------------------------------------------------
  document.addEventListener("click", (e) => {
    const navEl = e.target.closest("[data-nav]");
    if (navEl) { e.preventDefault(); location.hash = navEl.getAttribute("data-nav"); return; }

    const acctBtn = e.target.closest('[data-act="account-menu"]');
    if (acctBtn) { e.preventDefault(); toggleAccountMenu(); return; }
    if (!e.target.closest(".sb-account")) closeAccountMenu();

    const themeBtn = e.target.closest("#themeBtn");
    if (themeBtn) { applyTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"); return; }

    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.getAttribute("data-act");
    const slug = el.getAttribute("data-slug");
    const id = el.getAttribute("data-id");
    const A = APP.actions;

    switch (act) {
      case "quick-login": doLogin(el.getAttribute("data-user")); return;
      case "logout": APP.logout(); location.hash = "#/"; renderLogin(); return;
      case "account-close": closeAccountMenu(); return;
      case "brand-remove": A.removeBrand(el.getAttribute("data-cat"), el.getAttribute("data-brand") || null); render(); return;
      case "brand-move": A.moveBrand(el.getAttribute("data-cat"), el.getAttribute("data-brand"), el.getAttribute("data-dir")); render(); return;
      case "reset-data": if (window.confirm("Reset this account to the sample data? Your local edits will be discarded.")) { APP.actions.resetState(); closeAccountMenu(); toast("Sample data restored"); render(); } return;      case "fav": A.toggleFavorite(slug); render(); return;
      case "nt-more": window.__ntExpanded = !window.__ntExpanded; render(); return;
      case "plan-toggle": { const added = A.togglePlan(slug); toast(added ? "Added to meal plan" : "Removed from meal plan"); render(); return; }
      case "plan-add": A.addToPlan(slug); toast("Added to meal plan"); render(); return;
      case "propose-plan": { const res = A.proposePlan(); toast(res.full ? "Your week\u2019s already planned" : (res.scheduled ? `Proposed ${res.scheduled} night${res.scheduled === 1 ? "" : "s"}` : "No new recipes to propose")); render(); return; }
      case "plan-remove": A.removeFromPlan(id); render(); return;
      case "side-add": addSideInline(el, id); return;
      case "side-remove": A.removeSide(id, el.getAttribute("data-side")); render(); return;
      case "grocery-recipe": { const n = A.addGroceryForRecipe(slug); toast(n ? `${n} item${n === 1 ? "" : "s"} added to grocery list` : "Already on your list"); render(); return; }
      case "cart-toggle": A.toggleInCart(id); render(); return;
      case "grocery-remove": A.removeGrocery(id); render(); return;
      case "cart-clear": A.clearInCart(); toast("Purchased items cleared"); render(); return;
      case "cart-all": { const n = A.sendAllToCart(); toast(n ? `Sent ${n} item${n === 1 ? "" : "s"} to your Kroger cart` : "Cart is up to date"); render(); return; }
      case "propose-subs": window.__subsOpen = !window.__subsOpen; render(); return;
      case "ph-buy": { A.addGroceryItem(el.getAttribute("data-name"), "1"); toast("Added a fresh one to your list"); render(); return; }
      case "subs-close": window.__subsOpen = false; render(); return;
      case "subs-accept": { A.substituteGrocery(id, decodeURIComponent(el.getAttribute("data-to"))); toast("Swapped"); render(); return; }
      case "subs-dismiss": { (window.__subsDismissed || (window.__subsDismissed = new Set())).add(id); render(); return; }
      case "pantry-verify": A.verifyPantry(id); render(); return;
      case "pantry-remove": A.removePantry(id); render(); return;
      case "log-recipe": A.logCook(slug); toast("Logged as cooked"); render(); return;
      case "log-remove": A.removeLog(id); render(); return;
      case "note-del": A.removeNote(slug, id); render(); return;
      case "note-edit": editNoteInline(el.closest(".note"), slug, id); return;
      case "edit-profile-note": editProfileNote(el.getAttribute("data-key")); return;
      case "cancel-profile-note": render(); return;
      case "save-profile-note": {
        const ta = el.closest(".prof-md-field").querySelector("textarea");
        A.updateProfile({ [el.getAttribute("data-key")]: ta.value.trim() });
        toast("Saved"); render(); return;
      }
      case "note-cancel": render(); return;
      case "note-save": {
        const ta = el.closest(".note-edit").querySelector("textarea");
        A.editNote(slug, id, { body: ta.value.trim() }); render(); return;
      }
      case "diet-toggle": {
        const field = el.getAttribute("data-field"), val = el.getAttribute("data-val");
        const arr = APP.state().profile.dietary[field];
        const i = arr.indexOf(val);
        if (i >= 0) arr.splice(i, 1); else arr.push(val);
        APP.persist(); render(); return;
      }
      case "lunch-toggle": {
        const val = el.getAttribute("data-val");
        const arr = APP.state().profile.lunch_strategy || (APP.state().profile.lunch_strategy = []);
        const i = arr.indexOf(val);
        if (i >= 0) arr.splice(i, 1); else arr.push(val);
        APP.persist(); render(); return;
      }
      case "profile": A.updateProfile({ [el.getAttribute("data-key")]: el.getAttribute("data-val") }); render(); return;
      case "profile-num": A.updateProfile({ [el.getAttribute("data-key")]: Number(el.getAttribute("data-val")) }); render(); return;
      case "prof-tab": window.__profileTab = el.getAttribute("data-tab"); render(); return;
    }
  });

  document.addEventListener("change", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.getAttribute("data-act");
    const id = el.getAttribute("data-id");
    const A = APP.actions;
    if (act === "plan-date") { A.schedulePlan(id, el.value || null); render(); }
    else if (act === "set-store") { A.setStore(el.value); render(); }
    else if (act === "pantry-qty") { A.editPantry(id, { quantity: el.value }); APP.persist(); }
    else if (act === "profile-store") { const p = APP.state().profile; p.stores[el.getAttribute("data-key")] = el.value; APP.persist(); }
    else if (act === "profile-rot") {
      const key = el.getAttribute("data-key");
      const p = APP.state().profile;
      p.rotation[key] = key === "novelty_boost" ? Number(el.value) : Number(el.value);
      APP.persist(); render();
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "q") {
      const q = e.target.value.trim();
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(q), 180);
    }
    if (e.target.id === "qClear") {}
  });

  document.addEventListener("submit", (e) => {
    const form = e.target.closest("form[data-act]");
    if (form) {
      e.preventDefault();
      const act = form.getAttribute("data-act");
      const A = APP.actions;
      const data = Object.fromEntries(new FormData(form).entries());
      if (act === "note-add") {
        if (data.body && data.body.trim()) { A.addNote(form.getAttribute("data-slug"), data.body.trim(), (data.tag || "").trim() || null, !!data.private); render(); }
      } else if (act === "grocery-add") { if (data.name && data.name.trim()) { A.addGroceryItem(data.name.trim(), (data.quantity || "").trim()); render(); } const inp = document.getElementById("gAddName"); if (inp) inp.focus(); }
      else if (act === "pantry-add") { if (data.name && data.name.trim()) { A.addPantry(data.name.trim(), (data.category || "").trim().toLowerCase() || "other", (data.quantity || "").trim()); render(); } }
      else if (act === "log-add") { if (data.recipe) { A.logCook(data.recipe); toast("Logged as cooked"); render(); } }
      else if (act === "brand-add") { if ((data.category || "").trim()) { A.addBrand(data.category, data.brand); render(); const c = document.querySelector(".brand-in-cat"); if (c) c.focus(); } }
      return;
    }
    if (e.target.id === "loginForm") { e.preventDefault(); doLogin(document.getElementById("lu").value); return; }
  });

  // search clear button
  document.addEventListener("click", (e) => {
    if (e.target.closest("#qClear")) {
      const input = document.getElementById("q");
      if (input) { input.value = ""; }
      runSearch("");
      if (input) input.focus();
    }
  });

  window.addEventListener("hashchange", () => { if (APP.state()) render(); });

  // ---- boot -----------------------------------------------------------------
  const saved = APP.getUser();
  if (saved && APP.MEMBERS.some((m) => m.user === saved)) { APP.setUser(saved); renderFrame(); render(); }
  else { renderLogin(); }
})();
