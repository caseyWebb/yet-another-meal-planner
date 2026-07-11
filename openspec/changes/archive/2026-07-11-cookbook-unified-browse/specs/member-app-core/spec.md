## MODIFIED Requirements

### Requirement: Cookbook browse and keyword search

The app SHALL serve a cookbook index endpoint (the shared recipe index projected to the
compact hit shape — including `time_total` — title-sorted), a keyword search endpoint
reusing the cookbook's field-weighted keyword ranking, and a new-for-me endpoint reusing
the per-member discovery read with its last-planned watermark. Search SHALL be
keyword-only — no request-time embedding — and SHALL keep the debounced-against-API
behavior (the mock's in-memory keystroke search is a painted door, not a contract).

The browse page SHALL be **one unified, filterable list**: search bar → global filter
bar → the promoted "Recommended for you" panel (see `member-app-differentiators`) → a
single flat, title-sorted organic list over the full index. The page SHALL NOT render
sectioned browse lists ("New & trending" / "Picked for you" / "All recipes").

**Filter bar.** A cuisine select and a protein select — options derived from the loaded
corpus (distinct non-null values, sorted, "All cuisines"/"All proteins" defaults), never
from the authoring vocabulary — and a time segmented control (Any / ≤20 / ≤30 / ≤45).
One global filter state SHALL apply to search results, the promoted panel (per-row), the
organic list, and the favorites view. A recipe with no numeric `time_total` SHALL fail
any active time filter — an unknown-time recipe is never claimed under a time budget. A
"Clear" affordance and an "N of M match" count label SHALL render only while at least
one filter is active; the filtered-empty states ("No recipes match these filters." /
"None of your favorites match these filters.") SHALL repeat an inline "Clear filters"
link.

**Search mode.** A non-empty query SHALL replace browse mode (the promoted panel
hidden): a result-count line over the filtered results, the "No matches" empty state
("Nothing matches "{q}". Try a protein, a cuisine, or an ingredient."), and a clear
button. Active filters SHALL remain visible and AND onto the search results.

**URL state.** All shareable page state — the query, the cuisine/protein/time filters,
and the favorites view toggle — SHALL live in validated URL search params with default
values stripped from the URL, so every combination is shareable and deep-linkable;
loading such a URL SHALL reproduce the state. Transient input (the un-debounced search
text) stays client-local.

#### Scenario: Search parity with the public cookbook

- **WHEN** a member searches the cookbook in the app
- **THEN** the results come from the same pure keyword ranker the public `/cookbook`
  search serves, over the same index, returning the same hit shape

#### Scenario: One flat organic list replaces the browse sections

- **WHEN** the browse page renders with no query, no filters, and the default view
- **THEN** below the promoted panel there is exactly one flat, title-sorted recipe list
  over the full index (minus rows displayed in the panel), with no section headings

#### Scenario: Filters narrow every surface with an honest time gate

- **WHEN** the member selects cuisine "italian" and time "≤30"
- **THEN** the organic list, the promoted panel's rows, the favorites view, and any
  search results show only italian recipes with a numeric `time_total` ≤ 30 — a recipe
  lacking `time_total` is excluded — and the "N of M match" count and Clear affordance
  render

#### Scenario: Clearing filters restores the full list

- **WHEN** filters exclude every recipe and the member follows the inline "Clear
  filters" link
- **THEN** the filter state resets, the filtered-empty state disappears, and the full
  organic list (and promoted panel, outside search/favorites modes) renders again

#### Scenario: Filter and view state is shareable by URL

- **WHEN** a member loads a URL carrying query/filter/view search params (e.g.
  `/?cuisine=italian&time=30`)
- **THEN** the page renders with exactly that state applied, and interacting with the
  controls updates the URL params (defaults stripped) without a full reload

### Requirement: Favorites are an explicit idempotent set

The app SHALL list the member's favorites from the per-tenant overlay joined to the
cookbook index, and SHALL write favorite state as an **explicit set**
(`{ slug, favorite: boolean }`) keyed by the recipe slug — never a toggle — so an
offline-replayed mutation converges to the intended state.

Favorites SHALL render as a **cookbook view mode** (`?view=favorites`, a validated URL
search param): the organic list is replaced by the member's favorites with the global
filter state applied, the promoted panel is hidden, and the empty copy swaps — zero
favorites overall renders "No favorites yet / Tap the heart on any recipe to save it
here."; favorites that are all excluded by active filters render "None of your favorites
match these filters." with the inline "Clear filters" link. The view mode is URL-only:
the cookbook page renders no view-mode toggle control, and the standalone `/favorites`
page SHALL remain reachable unchanged. Scope boundary: the visible toggle control (its
designed form) and the `/favorites` retirement (redirect into the view mode) belong to
the follow-up change `cookbook-favorites-toggle` (blocked on design-requests #1) — the
page SHALL NOT improvise the control's markup ahead of that design.

#### Scenario: Replaying a favorite write converges

- **WHEN** the same favorite-set mutation is applied twice (e.g. an offline replay after
  a successful first delivery)
- **THEN** the overlay ends in the same state as after one application

#### Scenario: The favorites view mode filters favorites and hides the panel

- **WHEN** a member with favorites opens `/?view=favorites` with an active filter
- **THEN** only favorites passing the filter render, the promoted panel is absent, and
  clearing the filter shows all favorites

#### Scenario: Both favorites empty states render the specced copy

- **WHEN** the favorites view is open with zero favorites overall, or with favorites
  that all fail the active filters
- **THEN** the page renders "No favorites yet / Tap the heart on any recipe to save it
  here." in the first case and "None of your favorites match these filters." with an
  inline "Clear filters" link in the second
