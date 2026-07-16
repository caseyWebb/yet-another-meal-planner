## MODIFIED Requirements

### Requirement: Granular write tools, no batch commit

The system SHALL expose a granular write tool per category and SHALL NOT provide a batch `commit_changes` tool. Every field the former `commit_changes` carried now has a standalone home: objective recipe content (`update_recipe` / `create_recipe`), recipe disposition (`toggle_favorite` / `toggle_reject`), config (`update_preferences` / `update_taste` / `update_diet_principles` / `update_aliases`), cooking events (`log_cooked`), pantry (`update_pantry` / `mark_pantry_verified`), meal plan (`update_meal_plan`), grocery list (`add_to_grocery_list` / `update_grocery_list` / `remove_from_grocery_list`), staples (`update_staples`), and stockup (`update_stockup`). The former `ready_to_eat_drafts` / `_updates` fields have no home — the ready-to-eat write surface is removed entirely (no `add_draft_ready_to_eat`, no `update_ready_to_eat`). A multi-write turn SHALL issue one granular call per write. No tool in this capability SHALL write a Kroger cart or call an external service (cart placement is the separate `place_order` tool).

#### Scenario: There is no commit_changes tool

- **WHEN** the tool surface is enumerated
- **THEN** there is no `commit_changes` tool, and each write category is served by its own standalone tool

#### Scenario: There are no ready-to-eat write tools

- **WHEN** the tool surface is enumerated
- **THEN** neither `add_draft_ready_to_eat` nor `update_ready_to_eat` exists — no alias, no stub — and a call to either fails as an unknown tool

#### Scenario: A multi-write turn issues granular calls

- **WHEN** a turn needs to write a recipe favorite, a pantry change, and a grocery item
- **THEN** it calls `toggle_favorite`, `update_pantry`, and `add_to_grocery_list` separately, rather than batching them into one commit

### Requirement: log_cooked appends a cooking event to D1

The system SHALL provide a `log_cooked` tool that appends one cooking event to the caller's `cooking_log` table in D1 and returns without a `commit_sha`. It SHALL validate the entry at write time (an ISO `date` defaulting to today; a `type` ∈ {`recipe`, `ad_hoc`}; a `recipe` entry's slug resolved against the `recipes` table; an `ad_hoc` entry requires `name`). For **one deprecation window**, a stale plugin's `type: "ready_to_eat"` SHALL be **accepted and converted** to `type: "ad_hoc"` — the `name`, `date`, `meal`, and inline dimensions carry over, the stored row is `ad_hoc`, and the success return carries `warnings: [{ key: "type", reason: "retired", superseded_by: "ad_hoc" }]`; after the window, `type: "ready_to_eat"` SHALL be rejected as `validation_failed` like any unknown type. An unresolved slug SHALL be a structured `not_found` error written nowhere; a missing required field SHALL be `validation_failed`. For a recipe entry it SHALL also remove that recipe from the caller's `meal_plan` in the **same D1 transaction** (the side effect previously performed by `commit_changes`). It SHALL NOT write a recipe's `last_cooked` (derived by query).

#### Scenario: Cooking event is appended without a commit

- **WHEN** `log_cooked` is called with a valid entry
- **THEN** a `cooking_log` row is inserted in D1, the tool returns `{ logged }` with no `commit_sha`, and (for a recipe entry) the recipe is removed from the meal plan in the same transaction

#### Scenario: A stale ready_to_eat write converts and steers during the window

- **WHEN** a stale plugin calls `log_cooked({ type: "ready_to_eat", name: "frozen lasagna" })` during the deprecation window
- **THEN** a `cooking_log` row is inserted with `type = 'ad_hoc'` and `name = 'frozen lasagna'`, the write succeeds, and the return carries a `warnings` entry with `reason: "retired"` and `superseded_by: "ad_hoc"`

#### Scenario: After the window the retired type is rejected

- **WHEN** `log_cooked({ type: "ready_to_eat", name: "frozen lasagna" })` is called after the deprecation window has closed
- **THEN** a structured `validation_failed` error is returned and nothing is written

#### Scenario: Unknown slug is rejected

- **WHEN** `log_cooked({ type: "recipe", recipe: "not-a-recipe" })` is called and no such slug exists
- **THEN** a structured `not_found` error is returned and nothing is written

### Requirement: Profile writes target D1

The per-tenant profile write tools — `update_taste`, `update_diet_principles`, `update_kitchen`, `update_staples`, `update_stockup`, `toggle_favorite`, and `toggle_reject` — SHALL persist to the D1 profile tables (`profile`, `kitchen_equipment`, `staples`, `stockup`, `overlay`) as typed rows, not as TOML strings in a KV bundle or `users/<username>/*.toml` files. They SHALL return without a `commit_sha` and SHALL NOT serialize TOML. Multi-row writes SHALL use a D1 transaction. No profile write tool SHALL write the retained D1 `ready_to_eat` table — the ready-to-eat write surface is removed; the table and its historical rows stay in place, untouched, pending a future rethink (per-tenant hygiene paths such as household purge/move continue to clear or relocate its rows).

The bulk-buy watchlist is per-tenant: `update_stockup` SHALL add items to the caller's `stockup` rows. It SHALL be **add-only with dedup by normalized item `name`** (re-adding an existing name is a no-op). It SHALL accept per item a required `name` and optional `unit`, `typical_purchase`, and `notes`, plus an optional top-level `freezer_capacity_estimate` (stored on the `profile` row). The price-threshold fields (`baseline_price`, `buy_at_or_below`) SHALL be **optional** and advisory. `update_stockup` SHALL return `{ added }` (a count), no `commit_sha`, and add nothing when nothing is new.

The staples list is per-tenant: `update_staples` SHALL write the caller's `staples` rows, accepting `add` (array of `{ name, perishable? }`) and `remove` (array of name strings). Adds SHALL be deduped by normalized `name` (re-adding is a no-op); removes SHALL match by normalized `name` and silently succeed when absent. It SHALL return `{ added, removed }` (counts), no `commit_sha`.

#### Scenario: Structured profile write updates D1 rows

- **WHEN** `update_staples`, `update_stockup`, `update_kitchen`, `toggle_favorite`, or `toggle_reject` is applied
- **THEN** the corresponding D1 table rows are upserted/deleted for the caller, with no TOML serialization, no KV bundle write, and no `commit_sha`

#### Scenario: The retained ready_to_eat table is never written by a tool

- **WHEN** any MCP write tool runs for a caller with historical `ready_to_eat` rows
- **THEN** those rows are untouched — no tool inserts, updates, or deletes them

#### Scenario: Staples add is deduped

- **WHEN** `update_staples({ add: [{ name: "olive oil" }] })` is called and olive oil is already in the caller's staples
- **THEN** no duplicate row is written and `{ added: 0, removed: 0 }` is returned

#### Scenario: Staples remove of absent name is silent

- **WHEN** `update_staples({ remove: ["fish sauce"] })` is called and fish sauce is not in the caller's staples
- **THEN** no error is returned and `{ added: 0, removed: 0 }` is returned

### Requirement: Writes are routed by storage tier and data category

The system SHALL route each write to the storage tier that owns the data category:

- **GitHub (atomic commit engine)** — objective recipe **content** (`recipes/`, including the authored `description` and `side_search_terms` frontmatter). These return a `commit_sha`.
- **D1 (row-level, `src/db.ts`)** — per-tenant overlay (`favorite` and `reject` booleans), profile (preferences, taste, diet_principles, kitchen, staples, stockup), session state (pantry, meal_plan, grocery_list), the cooking log, attributed notes (`recipe_notes`), the shared corpus (stores, store_notes, ingredient aliases, registries, SKU cache, discovery feeds/inbox/rejections), the recipe-index projection (`recipes`, carrying the `description`/`side_search_terms` columns), and the sibling `recipe_embeddings` table (reconciled Worker-side on the cron). These return **without** a `commit_sha`. The retained `ready_to_eat` table has no write route — no tool targets it.

A subjective-field change to a shared recipe SHALL NOT modify shared content. `last_cooked` is not written as overlay — it is realized by appending to the caller's `cooking_log` (via `log_cooked`) and derived by query.

#### Scenario: Content edit commits to GitHub

- **WHEN** an objective edit to a shared recipe's content is persisted
- **THEN** it is committed to `recipes/` in the GitHub data repo and returns a `commit_sha`

#### Scenario: Per-tenant and corpus writes target D1

- **WHEN** a tenant's favorite toggle, reject toggle, note, pantry change, or preference edit is persisted
- **THEN** it is written as rows to the corresponding D1 table for the caller, returns no `commit_sha`, and never modifies shared recipe content or another member's data

## REMOVED Requirements

### Requirement: Ready-to-eat disposition is favorite and reject

**Reason**: The ready-to-eat surface is removed wholesale ("ready to eat infra can probably be ripped entirely, it needs to be rethought"). With `add_draft_ready_to_eat` and `update_ready_to_eat` gone, there is no catalog write to carry a disposition model.
**Migration**: None for callers — the concept leaves the surface; a rejected/favorited state on historical `ready_to_eat` rows persists inertly in the retained D1 table, which no tool reads or writes. A future rethink starts from a fresh proposal.
