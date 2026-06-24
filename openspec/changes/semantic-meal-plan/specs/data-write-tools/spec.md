## ADDED Requirements

### Requirement: toggle_favorite writes the caller's favorite boolean to the D1 overlay

The system SHALL provide a `toggle_favorite(slug, favorite)` tool that sets or clears the caller's `favorite` boolean for a recipe as a row in the D1 `overlay` table (keyed by `(tenant, recipe)`), returning without a `commit_sha`. It SHALL validate `slug` against the D1 `recipes` table (`not_found` when absent) and SHALL NOT write shared recipe content. This is the only recipe-disposition write in the favorite model.

#### Scenario: Favoriting a recipe writes only the overlay

- **WHEN** `toggle_favorite("miso-salmon", true)` is called for an existing recipe
- **THEN** the caller's `overlay` row for `miso-salmon` is upserted with `favorite = 1`, no shared recipe content changes, and the tool returns `{ slug, overlay }` with no `commit_sha`

#### Scenario: Favoriting an unknown recipe is rejected

- **WHEN** `toggle_favorite` is called with a slug not in `recipes`
- **THEN** a structured `not_found` error is returned and nothing is written

## REMOVED Requirements

### Requirement: rate_recipe writes the caller's subjective overlay to D1

**Reason**: The 1–5 star `rating` is replaced by a `favorite` boolean (see design): a crisp k-NN anchor set, lower disposition friction, and a simpler group signal (`COUNT(favorite)` vs `AVG(rating)`). Lost granularity is recovered from revealed preference (cook frequency in `cooking_log`). The `status`/`draft` half of the tool is retired by the disposition-collapse (import is the positive disposition; see `experimental-meal-planning`).

**Migration**: A D1 migration adds `overlay.favorite` and backfills it from the shipped `overlay.rating` (e.g. `rating >= 4 ⇒ favorite = 1`), then drops `rating` once consumers (group signal, any rating-weighting) move to `favorite`. `rate_recipe` is removed in favor of `toggle_favorite`; the `status` column is left in place until the `draft`-state retirement lands corpus-wide.

## MODIFIED Requirements

### Requirement: Writes are routed by storage tier and data category

The system SHALL route each write to the storage tier that owns the data category:

- **GitHub (atomic commit engine)** — objective recipe **content** (`recipes/`) and the shared `aliases.toml`. These return a `commit_sha`.
- **D1 (row-level, `src/db.ts`)** — per-tenant overlay (the `favorite` boolean, plus `status` until its retirement), profile (preferences, taste, diet_principles, kitchen, staples, stockup, ready_to_eat), session state (pantry, meal_plan, grocery_list), the cooking log, attributed notes (`recipe_notes`), and the rest of the shared corpus (stores, store_notes, registries, SKU cache, the recipe-index `embedding`/`description`/`side_search_terms` projection). These return **without** a `commit_sha`.

A subjective-field change to a shared recipe SHALL NOT modify shared content. `last_cooked` is not written as overlay — it is realized by appending to the caller's `cooking_log` (via `log_cooked`) and derived by query.

#### Scenario: Content edit commits to GitHub

- **WHEN** an objective edit to a shared recipe's content is persisted
- **THEN** it is committed to `recipes/` in the GitHub data repo and returns a `commit_sha`

#### Scenario: Per-tenant and corpus writes target D1

- **WHEN** a tenant's favorite toggle, note, pantry change, or preference edit is persisted
- **THEN** it is written as rows to the corresponding D1 table for the caller, returns no `commit_sha`, and never modifies shared recipe content or another member's data
