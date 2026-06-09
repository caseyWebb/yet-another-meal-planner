// search.js — progressive metadata search for the index page.
//
// Filters recipe cards by their pre-baked `data-search` haystack (title, tags,
// ingredients_key, cuisine, protein) with no separate index. State syncs to the
// `?q=` URL param so a filtered view is shareable. Purely additive: with JS off
// there is no search box and CSS faceted filtering keeps working.
(() => {
  const list = document.querySelector('.recipes');
  const filters = document.querySelector('.filters');
  const empty = document.querySelector('.empty');
  if (!list || !filters) return;

  const cards = [...list.children]; // the <li> wrappers

  const search = document.createElement('div');
  search.className = 'search';
  search.innerHTML =
    '<label for="q">Search</label>' +
    '<input id="q" type="search" name="q" autocomplete="off" ' +
    'placeholder="title, ingredient, cuisine…" enterkeyhint="search">';
  filters.prepend(search);
  const input = search.querySelector('input');

  // Toggle the empty-filter message by counting cards the browser is actually
  // rendering — this accounts for the pure-CSS facet hiding too, so the message
  // is correct for any combination of search + facets (including a multi-axis
  // facet intersection that CSS alone can't detect).
  const updateEmpty = () => {
    if (!empty) return;
    const anyVisible = cards.some((li) => li.getClientRects().length > 0);
    empty.classList.toggle('visible', !anyVisible);
  };

  const apply = (q) => {
    const needle = q.trim().toLowerCase();
    for (const li of cards) {
      const hit = !needle || (li.dataset.search || '').includes(needle);
      li.classList.toggle('is-hidden', !hit);
    }
    updateEmpty();
  };

  const params = new URLSearchParams(location.search);
  if (params.get('q')) { input.value = params.get('q'); }
  apply(input.value);

  input.addEventListener('input', () => {
    const q = input.value;
    apply(q);
    const next = new URLSearchParams(location.search);
    if (q.trim()) next.set('q', q); else next.delete('q');
    const qs = next.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  });

  // Recompute the empty state when a facet changes (facets are pure CSS, but the
  // friendly empty message is ours to surface).
  filters.addEventListener('change', updateEmpty);
})();
