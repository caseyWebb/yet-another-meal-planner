## 1. Worker — the compact hit shape

- [x] 1.1 `packages/worker/src/cookbook-search.ts`: `CookbookHit`/`toHit` gain
  `time_total: number | null` (numeric frontmatter value as-is, else null). Update the
  `toHit` unit tests (`test/cookbook-search.test.ts`) to pin the field, including the
  null case.

## 2. Member app — unified cookbook page (packages/app)

- [x] 2.1 `src/lib/data.ts`: `Hit` gains `time_total: number | null`.
- [x] 2.2 New `src/lib/cookbook-filters.ts`: the pure filter model —
  `CookbookFilterState { cuisine, protein, time }`, `filterHits()` (exact facet match;
  active time cap admits only numeric `time_total <=` the cap), `facetOptions()`
  (distinct non-null values, sorted, capitalized labels), `filtersActive()`.
- [x] 2.3 Rewrite `src/routes/_app.index.tsx`: validated search params (`q`, `cuisine`,
  `protein`, `time` ∈ {20, 30, 45} as a bare number — the default stringifier would
  JSON-quote a numeric-looking string — and `view` ∈ {"all", "favorites"}) with
  `stripSearchParams` defaults; debounced search input navigating with
  `replace: true`; the filter bar (corpus-derived selects + `SegmentedControl` +
  Clear + "N of M match" count, active-only); search mode (filtered results, count
  line, no-matches empty state, panel hidden); the promoted panel (≤1 row per signal,
  precedence Just Added → Trending → Picked for You, slug-dedup, per-row filters,
  hidden in search/favorites/zero-row cases, reason badges, honest trend chips on
  trending rows in panel and organic list); the flat organic list (index minus
  displayed promoted slugs, filtered); the favorites view mode (filtered favorites,
  panel hidden, both specced empty states); a clearly-marked drop-in comment where the
  designed favorites control mounts (design-requests #1) — no improvised control
  markup.
- [x] 2.4 `src/components/recipe-list.tsx`: rows render the "{n} min" time chip via
  `RecipeFacets`, an optional `promoBadge` slot (`.rpromo`, uppercase, before the
  title), and the plan-toggle titles 'Add to my "Want To Cook" list' / 'On your "Want
  To Cook" list — remove'.
- [x] 2.5 `packages/ui`: `RecipeFacets` gains `timeTotal?: number | null` (a
  `data-kind="time"` chip); `cookbook.css` gains `.filterbar`/`.fb-group`/`.fb-label`/
  `.fb-end`/`.fb-count`, `.promo-panel`/`.promo-cap`, `.rpromo`, and `.filter-empty`
  translated from the design mockup's stylesheet.
- [x] 2.6 Leave `/favorites` (route, nav item, page object, smoke registry entry)
  untouched.

## 3. Playwright coverage (app/visual)

- [x] 3.1 Seed (`packages/worker/admin/visual/seed.mjs`): one recipe with NULL
  `time_total` (`course: ["side"]` so no suggestion surface picks it up) — the honest
  time-filter fixture.
- [x] 3.2 `app/visual/pages/cookbook.page.ts`: locators/helpers for the filter bar
  (selects, time segment, clear, count label), the promoted panel (rows, reason
  badges), the organic list, the filtered-empty states, and the favorites view
  (`goto` with search params).
- [x] 3.3 `app/visual/specs/cookbook.spec.ts`: rewrite the browse specs to the unified
  page — promoted panel badges ride real seeded signals (Trending + Picked for You;
  no Just Added; never "Popular with Friends") with dedup out of the organic list;
  sparse-history empty trending (no badge/chip fabricated); filters narrow the organic
  list with the "N of M match" count and honest no-`time_total` exclusion; Clear and
  the inline "Clear filters" link; URL deep-link reproduces filter state; search ANDs
  with filters; favorites view mode (filtered favorites, hidden panel, both empty
  states). Capture review screenshots per area.
- [x] 3.4 Run `aubr test:app` (web: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`),
  `aubr typecheck`, `aubr test`; surface the screenshots.

## 4. Blocked — the favorites toggle control (design-requests #1)

- [ ] 4.1 **BLOCKED on design-requests.md #1** (the operator is running the Claude
  Design prompt): mount the designed favorites view-mode control (pill vs tab row per
  the returned bundle) at the marked drop-in point in `_app.index.tsx` — it only needs
  to read `view` from `Route.useSearch()` and navigate with `view: "favorites" | "all"`
  (defaults stripped). In the same follow-up: retire `/favorites` (redirect to
  `/?view=favorites`), drop its nav item/page object/registry entry, and update the
  favorites specs to enter through the control.
