/* app-combobox.js — a small, accessible combobox (WAI-ARIA "editable combobox
   with list autocomplete"). Turns a mount element into a text input backed by a
   filterable listbox popover. Used by the meal-plan "add a recipe" and
   "add a side" controls in place of native <select>/<datalist>.

   window.Combobox.mount(host, cfg) → { focus, destroy, input }
     cfg.options     : [{ value, label, sub? }]  (or a function returning that)
     cfg.value       : preselected value (optional)
     cfg.placeholder : input placeholder
     cfg.allowCustom : if true, free text that matches no option can be committed
     cfg.emptyText   : message shown when nothing matches
     cfg.onSelect    : (value, label) => void   — fires on commit
     cfg.onCancel    : () => void               — fires on Escape / outside close
*/
(function () {
  let uid = 0;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CHECK = '<svg class="cb-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const CHEV = '<svg class="cb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  function mount(host, cfg) {
    cfg = cfg || {};
    const id = "cb" + ++uid;
    const getOptions = typeof cfg.options === "function" ? cfg.options : () => cfg.options || [];
    const allowCustom = !!cfg.allowCustom;
    let open = false, active = -1, filtered = [], committed = false;

    host.classList.add("combobox");
    host.innerHTML = `
      <div class="cb-field">
        <input class="input cb-input" type="text" role="combobox" autocomplete="off" spellcheck="false"
               aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list"
               ${cfg.placeholder ? `placeholder="${esc(cfg.placeholder)}"` : ""}
               ${cfg.ariaLabel ? `aria-label="${esc(cfg.ariaLabel)}"` : ""} />
        ${CHEV}
      </div>
      <ul class="cb-list" id="${id}-list" role="listbox" hidden></ul>`;
    const input = host.querySelector(".cb-input");
    const list = host.querySelector(".cb-list");
    if (cfg.value != null) input.value = cfg.value;

    function currentQuery() { return input.value.trim().toLowerCase(); }

    function compute() {
      const q = currentQuery();
      const all = getOptions();
      filtered = q ? all.filter((o) => (o.label || "").toLowerCase().includes(q) || (o.value || "").toLowerCase().includes(q)) : all.slice();
    }

    function paint() {
      if (!filtered.length) {
        const custom = allowCustom && currentQuery();
        list.innerHTML = custom
          ? `<li class="cb-empty">Press Enter to add “${esc(input.value.trim())}”</li>`
          : `<li class="cb-empty">${esc(cfg.emptyText || "No matches")}</li>`;
        return;
      }
      list.innerHTML = filtered.map((o, i) => `
        <li class="cb-option" role="option" id="${id}-opt-${i}" data-i="${i}"
            aria-selected="${i === active}">
          <span class="cb-opt-main"><span class="cb-opt-label">${esc(o.label)}</span>${o.sub ? `<span class="cb-opt-sub">${esc(o.sub)}</span>` : ""}</span>
          ${cfg.value != null && o.value === cfg.value ? CHECK : ""}
        </li>`).join("");
    }

    function openList() {
      compute();
      active = filtered.length ? 0 : -1;
      paint();
      list.hidden = false;
      open = true;
      input.setAttribute("aria-expanded", "true");
      syncActive();
    }
    function closeList() {
      list.hidden = true;
      open = false;
      active = -1;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }

    function syncActive() {
      list.querySelectorAll(".cb-option").forEach((li) => {
        const on = Number(li.getAttribute("data-i")) === active;
        li.setAttribute("aria-selected", on ? "true" : "false");
        if (on) { input.setAttribute("aria-activedescendant", li.id); li.scrollIntoViewIfNeeded ? li.scrollIntoViewIfNeeded(false) : scrollIntoView(li); }
      });
    }
    function scrollIntoView(li) {
      const lt = li.offsetTop, lb = lt + li.offsetHeight;
      if (lt < list.scrollTop) list.scrollTop = lt;
      else if (lb > list.scrollTop + list.clientHeight) list.scrollTop = lb - list.clientHeight;
    }

    function move(delta) {
      if (!open) { openList(); return; }
      if (!filtered.length) return;
      active = (active + delta + filtered.length) % filtered.length;
      syncActive();
    }

    function commit(opt) {
      if (committed) return;
      let value, label;
      if (opt) { value = opt.value; label = opt.label; }
      else if (active >= 0 && filtered[active]) { value = filtered[active].value; label = filtered[active].label; }
      else if (allowCustom && currentQuery()) { value = input.value.trim(); label = value; }
      else return;
      committed = true;
      closeList();
      cfg.onSelect && cfg.onSelect(value, label);
    }

    function cancel() {
      if (committed) return;
      committed = true;
      closeList();
      cfg.onCancel && cfg.onCancel();
    }

    input.addEventListener("focus", () => { if (!open) openList(); });
    input.addEventListener("input", () => { compute(); active = filtered.length ? 0 : -1; if (!open) { list.hidden = false; open = true; input.setAttribute("aria-expanded", "true"); } paint(); syncActive(); });
    input.addEventListener("keydown", (e) => {
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); move(1); break;
        case "ArrowUp": e.preventDefault(); move(-1); break;
        case "Enter": e.preventDefault(); commit(); break;
        case "Escape": e.preventDefault(); if (open && (currentQuery() || filtered.length)) { closeList(); } else { cancel(); } break;
        case "Tab": if (open && active >= 0 && !allowCustom) { /* leave value as typed */ } break;
      }
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest(".cb-option");
      if (!li) return;
      e.preventDefault();
      commit(filtered[Number(li.getAttribute("data-i"))]);
    });
    list.addEventListener("mousemove", (e) => {
      const li = e.target.closest(".cb-option");
      if (!li) return;
      const i = Number(li.getAttribute("data-i"));
      if (i !== active) { active = i; syncActive(); }
    });

    // Outside interaction closes / cancels.
    function onDocDown(e) { if (!host.contains(e.target)) { if (cfg.onCancel) cancel(); else closeList(); } }
    document.addEventListener("mousedown", onDocDown, true);
    input.addEventListener("blur", () => { setTimeout(() => { if (document.activeElement !== input && !committed && cfg.onCancel) cancel(); else if (document.activeElement !== input) closeList(); }, 120); });

    const api = {
      input,
      focus() { input.focus(); },
      destroy() { document.removeEventListener("mousedown", onDocDown, true); },
    };
    return api;
  }

  window.Combobox = { mount };
})();
