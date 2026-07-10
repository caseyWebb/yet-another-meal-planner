# cookbook-unified-browse

## Why

The cookbook page is today three stacked browse sections ("New & trending", "Picked for
you", "All recipes") plus a separate `/favorites` route. The member-app redesign
(product-specs/pages/01-cookbook.md, mockup ground truth) replaces that with **one
unified, filterable list**: search bar → global filter bar → a promoted "Recommended for
you" panel → one flat organic list, with favorites folded in as an in-page view mode.
Everything the page needs already exists server-side — the index, keyword search,
new-for-me, the guarded trending read, and picked-for-you — so this is a restructure over
existing reads (the momentum-bank "zero/near-zero-backend" slice), not a new data surface.

## What Changes

- **One unified browse list.** The three browse sections are replaced by: search bar →
  filter bar → promoted panel → a flat, title-sorted organic list over the full index.
  Search keeps its debounce-against-API behavior (the mock's keystroke search is
  in-memory only — painted door, per D5).
- **New global filter bar** — cuisine select + protein select (corpus-derived options) +
  a time segmented control (Any / ≤20 / ≤30 / ≤45) + a Clear affordance and an
  "N of M match" count that appear only while a filter is active. One filter state
  applies to search results, the promoted panel (per-row), the organic list, and the
  favorites view. Recipes with no `time_total` fail any active time filter.
- **Promoted "Recommended for you" panel** — a new packaging of the three existing
  differentiator signals as per-row uppercase reason badges: "Just Added" (new-for-me),
  "Trending" (the group trending read, min-signal guard **verbatim**), "Picked for You"
  (favorites centroid). At most one row per signal; displayed promoted slugs dedupe out
  of the organic list; the panel hides in search mode, in the favorites view, and when
  zero promoted rows survive the filters. **"Popular with Friends" is NOT built here** —
  that reason waits for the friend lens (band 5, D11/D31); under today's deployment the
  trending signal keeps the existing member-app-differentiators guard and chip copy
  verbatim.
- **Favorites folds into the page as a view mode** (D8): `?view=favorites` replaces the
  organic list with the filtered favorites, hides the promoted panel, and swaps the empty
  copy (both specced empty states ship). The **toggle control itself is not rendered** —
  its visual form has no design (the mockup ships the view's logic/CSS/empty states but
  not the control; design-requests.md #1 is queued with the operator). The view mode is
  fully plumbed and URL-addressable; the designed control is a drop-in. The `/favorites`
  route does **not** retire yet — that retirement completes when the designed control
  lands (blocked task in tasks.md).
- **URL-param plumbing only**: all shareable state — query, cuisine, protein, time,
  view — lives in URL search params (validated, defaults stripped), per the repo's
  modeling standard (src/admin/CLAUDE.md; packages/app follows the same).
- **RecipeRow tweaks** (page 01 delta table): a "{n} min" time facet chip (the compact
  hit shape gains `time_total`), a promo-badge slot for the panel's reason badges, and
  the plan-toggle titles become 'Add to my "Want To Cook" list' / 'On your "Want To
  Cook" list — remove'. The trend-chip slot already ships (D31: chips render only from
  the guarded read; copy unchanged under today's deployment).
- **One additive read-shape change, no new endpoint**: the shared compact hit (`toHit`)
  gains `time_total`, so the index and search reads carry the facet the time filter and
  time chip need. New-for-me / trending / picked-for-you already return it. No new
  backend reads; all filtering is client-side over facets the contracts already return.

## Resolved open questions (pages/01 §4)

- **q1 — favorites control form: BLOCKED on design, deliberately unresolved.** Per
  CLAUDE.md the control's UI is not improvised here; design-requests.md #1 is the queued
  prompt (pill-in-filter-bar vs tab row). This change ships the view mode's full
  behavior and URL plumbing; the control mounts into a marked drop-in point when its
  design lands, and `/favorites` retires in that same follow-up.
- **q2 — promoted panel sourcing: at most one row per signal (≤3 rows), fixed precedence
  Just Added → Trending → Picked for You, deduped by slug (first reason wins), no
  dismissability, no rotation state.** Each signal contributes its own **top-ranked** row
  (the signals' reads are already deterministically ordered), so every badge is truthful
  and no single signal floods the panel; a top row failing the active filters is dropped
  — never replaced by a deeper-ranked candidate (the mock's per-row filtering semantics;
  the panel never misrepresents a signal's actual top recommendation). Partial panels
  are fine (an empty signal simply contributes nothing — no backfill across reasons,
  matching the differentiators' honest empty-set posture). Refresh cadence is the
  underlying reads' freshness (the app's short-staleTime + refetch-on-focus posture) —
  the panel is a pure per-render derivation with **no** new persistence, pinning, or
  dismiss state (the mock has none either).
- **q3 — trend chips: already decided (D31).** Ship, rendered only from the guarded
  trending read. Under today's deployment the existing guard (≥2 cooks OR ≥2 distinct
  cooking tenants) and the existing chip copy stand verbatim; the household-counted copy
  arrives with band 5's lens change, not here.
- **q4 — filter options: corpus-derived (the mock's behavior), not `src/vocab.js`.**
  Options are the distinct non-null cuisine/protein values of the loaded index, sorted,
  with capitalized labels. Rationale: the vocab enumerates every *possible* value; a
  filter offering options with zero matches is dead UI, and corpus-derived options hide
  empty options by construction. It also needs no new read — the index is already on the
  client. (Vocab remains the authoring control; this is a display concern.)
- **q5 — time filter vs missing `time_total`: recipes lacking `time_total` fail any
  active time filter** (the mock's behavior, kept). A "≤30 min" promise must be honest —
  an unknown-time recipe cannot be claimed under a time budget. Exact precedent: the
  agent-side `max_time_total` filter in `src/recipes.ts` already drops non-numeric
  `time_total` the same way.
- **q6 — URL state: all of it.** `q`, `cuisine`, `protein`, `time`, `view` are validated
  search params with defaults stripped (`stripSearchParams`), so every filter/search/
  favorites combination is shareable and deep-linkable and the browser back button walks
  view states. The search input debounces into the URL with `replace: true` so typing
  does not spam history. Transient client state (the un-debounced input text) stays
  local, per the modeling standard.
- **q7 — "N of M match" count label: in.** Rendered in the filter bar's end slot, only
  while a filter is active (browse and favorites view; search mode already has its own
  "N results" line). The mock computes the label and ships its `.fb-count` styling but
  never mounts it — treated as a listed mock artifact; the label complements the Clear
  affordance by making filter narrowing legible. The inactive-state variant ("M recipes")
  stays out: it duplicates what the list already shows and the mock never rendered it.
- **Trending's badge label (consequence of deferring "Popular with Friends"): the reason
  badge is "Trending".** The friends wording would be a lie under today's deployment
  (no friend lens exists; the read is deployment-wide). When band 5's lens lands, its
  change re-badges this reason from the lens-scoped read (already tracked as that band's
  member-app-differentiators delta).

## Capabilities

### Modified Capabilities

- `member-app-core`: the cookbook browse requirement is rewritten to the unified list
  (filter bar, promoted panel, flat organic list, URL search-param state); the favorites
  requirement gains the in-page view mode (the standalone route held until the designed
  control lands).
- `member-app-differentiators`: the "browse slots" layout requirement is replaced by the
  promoted-panel requirement (reason badges over the same three reads, guard verbatim,
  no "Popular with Friends"); the trending and picked-for-you requirements' rendering
  clauses are updated to the panel (endpoints unchanged).
- `cookbook-search`: the compact result-row shape carries `time_total` (additive; the
  ranker, ordering, and CSP posture are untouched).

## Impact

- **Worker (`packages/worker/src/`)**: `cookbook-search.ts` — `CookbookHit`/`toHit` gain
  `time_total` (shared by the member index/search reads and the public `/cookbook/search`
  JSON; additive). No new routes, no D1 change, no `run_worker_first` change, no
  wrangler/deploy-merge change.
- **Member app (`packages/app/`)**: `_app.index.tsx` rewritten (validated search params,
  filter bar, promoted panel, favorites view mode, marked control drop-in point);
  `lib/cookbook-filters.ts` (pure filter/option helpers); `lib/data.ts` `Hit` gains
  `time_total`; `components/recipe-list.tsx` (time chip, promo-badge slot, Want-To-Cook
  titles). `/favorites` route and nav untouched.
- **Shared UI (`packages/ui/`)**: `RecipeFacets` gains an optional time chip;
  `cookbook.css` gains the filter-bar/promoted-panel/reason-badge/filter-empty styles,
  translated from the design mockup (the design source — not improvised).
- **Tests**: vitest — `toHit` shape (`test/cookbook-search.test.ts`); app Playwright —
  cookbook page object + specs extended (filter bar, URL deep links, promoted panel and
  badges, favorites view + both empty states, honest time filter via a seeded
  no-`time_total` recipe), screenshots surfaced. Admin suite untouched.
- **Docs**: no `docs/` contract file pins the compact hit row shape or the member browse
  layout (`docs/TOOLS.md`/`SCHEMAS.md`/`ARCHITECTURE.md` unaffected — no tool, D1, or
  architectural change). Spec deltas carry the contract.
- **Not in scope**: the favorites toggle control's markup (design-requests #1), the
  `/favorites` retirement/redirect, "Popular with Friends", the friend lens, curated-set
  provenance/cold-start (band 5), sidebar counts (separate change), RecipeRow's lift to
  `packages/ui` (story 06, the dual-use widgets change).
