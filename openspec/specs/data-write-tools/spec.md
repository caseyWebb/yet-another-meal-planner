# data-write-tools Specification

## Purpose

Defines the MCP write tools and where each persists. After the D1 migration there is **no batch `commit_changes` tool** — every write has a standalone home, and writes split by storage tier: objective recipe **content** is committed to the GitHub data repo via the atomic commit engine and returns a `commit_sha`; everything else — per-tenant overlay/profile/session state, the cooking log, ingredient aliases, and the shared corpus (stores, notes, registries, caches) — is a row-level D1 write that returns **without** a `commit_sha`. This capability defines those tools' contracts, routing, and validation.
## Requirements
### Requirement: Granular write tools, no batch commit

The system SHALL expose a granular write tool per category and SHALL NOT provide a batch `commit_changes` tool. Every field the former `commit_changes` carried now has a standalone home: objective recipe content (`update_recipe` / `create_recipe`), recipe disposition (`toggle_favorite` / `toggle_reject`), ready-to-eat (`add_draft_ready_to_eat` / `update_ready_to_eat`), config (`update_preferences` / `update_taste` / `update_diet_principles` / `update_aliases`), cooking events (`log_cooked`), pantry (`update_pantry` / `mark_pantry_verified`), meal plan (`update_meal_plan`), grocery list (`add_to_grocery_list` / `update_grocery_list` / `remove_from_grocery_list`), staples (`update_staples`), and stockup (`update_stockup`). A multi-write turn SHALL issue one granular call per write. No tool in this capability SHALL write a Kroger cart or call an external service (cart placement is the separate `place_order` tool).

#### Scenario: There is no commit_changes tool

- **WHEN** the tool surface is enumerated
- **THEN** there is no `commit_changes` tool, and each write category is served by its own standalone tool

#### Scenario: A multi-write turn issues granular calls

- **WHEN** a turn needs to write a recipe favorite, a pantry change, and a grocery item
- **THEN** it calls `toggle_favorite`, `update_pantry`, and `add_to_grocery_list` separately, rather than batching them into one commit

### Requirement: Objective recipe content commits to GitHub

`update_recipe(slug, updates)` and `create_recipe` SHALL write only objective shared recipe **content** (frontmatter/body) to the GitHub data repo (`recipes/`) through the atomic commit engine — create blobs/tree, create a commit whose parent is the read base, then update the ref — authenticating with a GitHub App installation token scoped to the data repository, and SHALL surface failures as structured errors. `update_recipe` SHALL reject `favorite`, `reject`, or `status` keys with a structured `validation_failed` error directing the caller to `toggle_favorite` / `toggle_reject`, and SHALL reject `last_cooked` (derived via the cooking log / `log_cooked`). It SHALL NOT write any per-tenant overlay or other domain data, and SHALL return `{ slug, updated_fields, commit_sha? }` (`commit_sha` omitted when nothing changed).

#### Scenario: update_recipe commits objective content

- **WHEN** `update_recipe("miso-salmon", { time_total: 30 })` is called with valid objective frontmatter
- **THEN** the shared recipe content is committed to GitHub and the tool returns `{ slug, updated_fields, commit_sha }`

#### Scenario: update_recipe rejects subjective keys

- **WHEN** `update_recipe("miso-salmon", { status: "active" })` is called
- **THEN** a structured `validation_failed` error is returned directing the caller to `toggle_favorite` / `toggle_reject`, and nothing is written

#### Scenario: Write failure is structured

- **WHEN** the Git Data API is unreachable or rejects the write after retries are exhausted
- **THEN** the tool returns a structured `upstream_unavailable` error and does not throw an unhandled exception

### Requirement: toggle_favorite writes the caller's favorite boolean to the D1 overlay

The system SHALL provide a `toggle_favorite(slug, favorite)` tool that sets or clears the caller's `favorite` boolean for a recipe as a row in the D1 `overlay` table (keyed by `(tenant, recipe)`), returning without a `commit_sha`. It SHALL validate `slug` against the D1 `recipes` table (`not_found` when absent) and SHALL NOT write shared recipe content. `favorite: false` SHALL clear the flag, deleting the overlay row when nothing else is set on it. `favorite` and `reject` are **mutually exclusive**: setting `favorite: true` SHALL clear any `reject` on the same row.

#### Scenario: Favoriting a recipe writes only the overlay

- **WHEN** `toggle_favorite("miso-salmon", true)` is called for an existing recipe
- **THEN** the caller's `overlay` row for `miso-salmon` is upserted with `favorite = 1`, no shared recipe content changes, and the tool returns `{ slug, overlay }` with no `commit_sha`

#### Scenario: Favoriting clears a prior reject

- **WHEN** the caller had rejected a recipe and then calls `toggle_favorite(slug, true)`
- **THEN** the row now carries `favorite` and no `reject` (the two never coexist)

#### Scenario: Favoriting an unknown recipe is rejected

- **WHEN** `toggle_favorite` is called with a slug not in `recipes`
- **THEN** a structured `not_found` error is returned and nothing is written

### Requirement: toggle_reject hides a recipe for the caller via the D1 overlay

The system SHALL provide a `toggle_reject(slug, reject)` tool that sets or clears the caller's `reject` flag for a recipe as a row in the D1 `overlay` table, returning without a `commit_sha`. It SHALL validate `slug` against the D1 `recipes` table (`not_found` when absent) and SHALL NOT write shared recipe content. `reject: false` SHALL clear the flag, deleting the overlay row when nothing else is set on it. `reject` and `favorite` are mutually exclusive: setting `reject: true` SHALL clear any `favorite`. A rejected recipe SHALL be excluded from the caller's `search_recipes` results (a hard gate, both membership and ranked modes). This is **per-tenant** and distinct from the group-wide `reject_discovery` (which suppresses a discovery URL before import); `toggle_reject` acts on an existing corpus slug for one member only.

#### Scenario: Rejecting a recipe hides it for the caller only

- **WHEN** `toggle_reject("miso-salmon", true)` is called
- **THEN** the caller's `overlay` row is upserted with `reject`, the recipe no longer appears in that caller's `search_recipes` results, and no other member's view changes

#### Scenario: Un-rejecting restores default visibility

- **WHEN** `toggle_reject(slug, false)` is called on a row whose only field was `reject`
- **THEN** the overlay row is deleted and the recipe returns to neutral (available) for the caller

### Requirement: Ready-to-eat disposition is favorite and reject

The ready-to-eat catalog SHALL use the same disposition model as recipes: `add_draft_ready_to_eat` adds an item that is available by default (no `draft`/`active` state), and `update_ready_to_eat` sets a per-item `favorite` or `reject` (mutually exclusive), with no `status` lifecycle and no `rating`. A rejected ready-to-eat item SHALL not be suggested to the caller.

#### Scenario: Rejecting a ready-to-eat item stops suggesting it

- **WHEN** `update_ready_to_eat(slug, { reject: true })` is called
- **THEN** the item is no longer suggested to the caller, with no `status` or `rating` involved

#### Scenario: Added ready-to-eat items are available immediately

- **WHEN** `add_draft_ready_to_eat` adds an item
- **THEN** it is part of the caller's catalog and suggestible immediately, with no activation step

### Requirement: log_cooked appends a cooking event to D1

The system SHALL provide a `log_cooked` tool that appends one cooking event to the caller's `cooking_log` table in D1 and returns without a `commit_sha`. It SHALL validate the entry at write time (an ISO `date` defaulting to today; a `type` ∈ {`recipe`, `ready_to_eat`, `ad_hoc`}; a `recipe` entry's slug resolved against the `recipes` table; a non-recipe entry requires `name`). An unresolved slug SHALL be a structured `not_found` error written nowhere; a missing required field SHALL be `validation_failed`. For a recipe entry it SHALL also remove that recipe from the caller's `meal_plan` in the **same D1 transaction** (the side effect previously performed by `commit_changes`). It SHALL NOT write a recipe's `last_cooked` (derived by query).

#### Scenario: Cooking event is appended without a commit

- **WHEN** `log_cooked` is called with a valid entry
- **THEN** a `cooking_log` row is inserted in D1, the tool returns `{ logged }` with no `commit_sha`, and (for a recipe entry) the recipe is removed from the meal plan in the same transaction

#### Scenario: Unknown slug is rejected

- **WHEN** `log_cooked({ type: "recipe", recipe: "not-a-recipe" })` is called and no such slug exists
- **THEN** a structured `not_found` error is returned and nothing is written

### Requirement: Profile writes target D1

The per-tenant profile write tools — `update_taste`, `update_diet_principles`, `update_kitchen`, `update_staples`, `update_stockup`, `add_draft_ready_to_eat`, `update_ready_to_eat`, `toggle_favorite`, and `toggle_reject` — SHALL persist to the D1 profile tables (`profile`, `kitchen_equipment`, `staples`, `stockup`, `ready_to_eat`, `overlay`) as typed rows, not as TOML strings in a KV bundle or `users/<username>/*.toml` files. They SHALL return without a `commit_sha` and SHALL NOT serialize TOML. Multi-row writes SHALL use a D1 transaction.

Ready-to-eat is **per-tenant personal state**: `add_draft_ready_to_eat` and `update_ready_to_eat` SHALL write the caller's `ready_to_eat` rows. Each item SHALL be keyed by a generated `slug` (derived from its `name`, unique within the caller's set); `update_ready_to_eat` SHALL address items by `slug`. Items have no `status` or `rating` — disposition is via `favorite`/`reject` only.

The bulk-buy watchlist is likewise per-tenant: `update_stockup` SHALL add items to the caller's `stockup` rows. It SHALL be **add-only with dedup by normalized item `name`** (re-adding an existing name is a no-op). It SHALL accept per item a required `name` and optional `unit`, `typical_purchase`, and `notes`, plus an optional top-level `freezer_capacity_estimate` (stored on the `profile` row). The price-threshold fields (`baseline_price`, `buy_at_or_below`) SHALL be **optional** and advisory. `update_stockup` SHALL return `{ added }` (a count), no `commit_sha`, and add nothing when nothing is new.

The staples list is per-tenant: `update_staples` SHALL write the caller's `staples` rows, accepting `add` (array of `{ name, perishable? }`) and `remove` (array of name strings). Adds SHALL be deduped by normalized `name` (re-adding is a no-op); removes SHALL match by normalized `name` and silently succeed when absent. It SHALL return `{ added, removed }` (counts), no `commit_sha`.

#### Scenario: Structured profile write updates D1 rows

- **WHEN** `update_staples`, `update_stockup`, `update_kitchen`, `update_ready_to_eat`, `toggle_favorite`, or `toggle_reject` is applied
- **THEN** the corresponding D1 table rows are upserted/deleted for the caller, with no TOML serialization, no KV bundle write, and no `commit_sha`

#### Scenario: Ready-to-eat write targets the caller's D1 rows

- **WHEN** `add_draft_ready_to_eat` or `update_ready_to_eat` is called
- **THEN** the change is written to the caller's `ready_to_eat` rows, keyed by the item's generated `slug`, and no shared catalog is touched

#### Scenario: Staples add is deduped

- **WHEN** `update_staples({ add: [{ name: "olive oil" }] })` is called and olive oil is already in the caller's staples
- **THEN** no duplicate row is written and `{ added: 0, removed: 0 }` is returned

#### Scenario: Staples remove of absent name is silent

- **WHEN** `update_staples({ remove: ["fish sauce"] })` is called and fish sauce is not in the caller's staples
- **THEN** no error is returned and `{ added: 0, removed: 0 }` is returned

#### Scenario: Unknown ready-to-eat target is structured, not thrown

- **WHEN** `update_ready_to_eat` is called with a `slug` that no item in the caller's rows resolves to
- **THEN** the tool returns a structured error rather than throwing

### Requirement: Preferences are edited by merge-patch over structured D1 storage

`update_preferences` SHALL accept a `patch` object and apply it to the caller's preferences with JSON Merge Patch semantics (RFC 7396): present keys set, `null` deletes, nested objects merge to arbitrary depth, arrays replace wholesale. The defined top-level surface is `default_cooking_nights`, `lunch_strategy`, `ready_to_eat_default_action`, `stores`, `brands`, `dietary`, and `custom`; a patch top-level key outside that set SHALL be rejected with a structured error directing it under `custom`. After merging, the result's types SHALL be validated (enums, `brands` map of term→string[], `stores`/`dietary` shapes, `custom` object) and a type-invalid result rejected with `malformed_data`, storing nothing. The application SHALL be atomic (one D1 transaction): scalar/JSON fields update the `profile` row; `brands` entries map to `brand_prefs` rows — a list value UPSERTs, `null` DELETEs (the tri-state: absent row = ambiguous, `[]` = don't-care, non-empty = ranked). It returns without a `commit_sha`.

#### Scenario: Partial patch merges without clobbering siblings

- **WHEN** `update_preferences({ patch: { stores: { preferred_location: "Kroger - 76137" } } })` is called and `stores.primary` is already `"kroger"`
- **THEN** `stores.preferred_location` updates, `stores.primary` is preserved, and nothing else changes

#### Scenario: Brands tri-state via UPSERT/DELETE

- **WHEN** `update_preferences({ patch: { brands: { olive_oil: ["Cobram"], yellow_onion: [], canola_oil: null } } })` is called
- **THEN** `brand_prefs` gets `olive_oil` ranked `["Cobram"]`, `yellow_onion` as don't-care `[]`, and any `canola_oil` row deleted (back to ambiguous)

#### Scenario: Unknown top-level key rejected toward custom

- **WHEN** `update_preferences({ patch: { spice_tolerance: "high" } })` is called
- **THEN** a structured error names the key and directs it under `custom`, and nothing is stored

#### Scenario: Type-invalid merged result is rejected

- **WHEN** `update_preferences({ patch: { lunch_strategy: "sometimes" } })` is called and `sometimes` is not in the enum
- **THEN** a `malformed_data` error is returned and the stored preferences are unchanged

### Requirement: User-curated narrative writes are content-faithful

The user-curated narrative `update_*` tools — `update_taste` and `update_diet_principles` (D1 `profile` row) — SHALL write exactly the markdown supplied by the caller and SHALL NOT infer or merge additional changes, returning `{ updated }` with no `commit_sha`. There is no `update_substitutions` tool. `update_aliases` writes the shared ingredient-alias corpus: it SHALL **upsert** each supplied `variant → canonical` mapping by variant into the **D1 `aliases` table** (the same table the matcher reads), returning `{ updated }` with no `commit_sha`; it does not remove mappings and does not write GitHub (the matcher no longer reads `aliases.toml`). The discipline of *when* these may be called (only on explicit user direction) is documented in `AGENT_INSTRUCTIONS.md`.

#### Scenario: Narrative write persists provided content verbatim

- **WHEN** `update_taste(content)` is called with a directed edit
- **THEN** the tool writes the provided markdown to the caller's D1 `profile` row and returns `{ updated }` with no `commit_sha`, without adding inferred changes

#### Scenario: Aliases write upserts the shared D1 table

- **WHEN** `update_aliases({ aliases: { "EVOO": "olive oil" } })` is called
- **THEN** each mapping is upserted by variant into the D1 `aliases` table and the tool returns `{ updated }` with no `commit_sha` (no GitHub commit)

### Requirement: Pantry write upserts D1 rows

`update_pantry` SHALL persist to the caller's D1 `pantry` table (keyed by normalized name). An `add` operation SHALL be an **upsert** (`INSERT … ON CONFLICT DO UPDATE`): if a row with the same normalized name exists, the incoming fields are merged onto it (preserving the original `added_at`, refreshing `last_verified_at` to today, overlaying other supplied fields) rather than appending a duplicate, and the `AppliedOp` result includes `merged: true`; a fresh insert omits `merged` (or sets it `false`). `remove` and `verify` (via `mark_pantry_verified`) are row statements. Writes are strongly consistent and row-level (no whole-array rewrite) and return without a `commit_sha`.

#### Scenario: Pantry add for a new item inserts it

- **WHEN** `update_pantry` is called with `{ op: "add", item: { name: "eggs", quantity: "12", category: "fridge" } }` and no item named "eggs" exists
- **THEN** a new `pantry` row is inserted and the result includes `{ op: "add", name: "eggs" }` without a `merged` flag

#### Scenario: Pantry add for an existing item merges, not duplicates

- **WHEN** `update_pantry` is called with `{ op: "add", item: { name: "olive oil", quantity: "low" } }` and a row named "olive oil" already exists
- **THEN** the existing row's `quantity` is updated to "low", `last_verified_at` is refreshed to today, `added_at` is unchanged, no duplicate row is created, and the result includes `{ op: "add", name: "olive oil", merged: true }`

#### Scenario: Pantry upsert is case-insensitive

- **WHEN** `update_pantry` is called with `{ op: "add", item: { name: "Olive Oil" } }` and a row named "olive oil" already exists
- **THEN** the existing row is updated (not duplicated) and `merged: true` is returned

### Requirement: meal_plan upsert carries open-world sides

`update_meal_plan` SHALL upsert and delete rows in the caller's D1 `meal_plan` table. An `add` operation SHALL accept an optional `sides` array of free-text open-world side names, persisted onto the upserted row alongside `recipe` and `planned_for`. An `add` for a recipe already on the plan SHALL merge `sides` onto the existing row (consistent with upsert-by-slug semantics). The `sides` value SHALL be written verbatim (free text, not slug-resolved); a `remove` op SHALL delete the row and its `sides` together. It returns without a `commit_sha`. No other domain or external service is touched.

#### Scenario: Add op persists open-world sides on the planned row

- **WHEN** `update_meal_plan` adds `{ recipe: "miso-salmon", planned_for: "2026-06-14", sides: ["roasted broccoli"] }`
- **THEN** the upserted `meal_plan` row carries `recipe = "miso-salmon"`, `planned_for = "2026-06-14"`, and `sides = ["roasted broccoli"]`

#### Scenario: Re-add merges sides onto the existing row

- **WHEN** a `meal_plan` row for `miso-salmon` already exists and a later `add` supplies `sides`
- **THEN** the `sides` are merged onto that existing row rather than creating a duplicate row

### Requirement: Recipe write tools enforce controlled vocabularies

The recipe write tools — `create_recipe` and `update_recipe` — SHALL reject a write whose
recipe frontmatter carries a `protein`, `cuisine`, or `requires_equipment` value outside
its controlled vocabulary, returning a structured `validation_failed` error (naming the
offending field and value) and making **no commit**. Enforcement SHALL occur at the commit
engine's `validateFile` step so every recipe write path is covered uniformly. `protein`
and `cuisine` SHALL each be present as an in-vocabulary value **or the explicit literal
`null`** — the write path SHALL NOT normalize a no-focus dish to an absent field and SHALL
NOT accept the literal string `none` (a `none`/`""` value is rejected as non-compliant,
prompting `null`). The `create_recipe` and `update_recipe` tool descriptions SHALL
enumerate the `protein` and `cuisine` controlled sets and SHALL state that a dish with no
protein focus is written as `protein: null` — never omitted, never `none`.

#### Scenario: Off-vocabulary protein is rejected before commit

- **WHEN** `create_recipe` is called with frontmatter `protein: shrimp` (the bucket is `shellfish`)
- **THEN** the tool returns a structured `validation_failed` error naming `protein` and `shrimp`, and no recipe file is committed

#### Scenario: No-protein dish requires explicit null

- **WHEN** `create_recipe` is called for a vegetable side with `protein: none` (or an empty string)
- **THEN** the tool returns a structured `validation_failed` error directing `protein: null`, and the recipe is committed only once `protein` is the explicit `null`

#### Scenario: Off-vocabulary equipment is rejected before commit

- **WHEN** `update_recipe` is called with `requires_equipment: ["air-fryer"]` and `air-fryer` is not in the equipment vocabulary
- **THEN** the tool returns a structured `validation_failed` error naming the offending slug, and no change is committed

#### Scenario: In-vocabulary recipe write succeeds

- **WHEN** `create_recipe` is called with `protein: shellfish`, `cuisine: thai`, and `requires_equipment: []`, all legal
- **THEN** the recipe is committed normally and the tool returns the slug and commit sha

#### Scenario: Tool descriptions surface the controlled sets

- **WHEN** the `create_recipe` / `update_recipe` tool schemas are presented to the agent
- **THEN** their descriptions list the allowed `protein` and `cuisine` values and the "write `protein: null` when there is no protein focus — never omit, never `none`" rule

### Requirement: Structural pre-commit validation for GitHub-backed recipe writes

The system SHALL validate every GitHub-bound recipe change structurally before committing — YAML/frontmatter parses cleanly and enumerated fields (e.g. `protein`, `cuisine`, `requires_equipment`) hold legal values — using a Workers-runtime-safe (`workerd`) implementation, since the Node build validator cannot run in the Worker. A change that fails structural validation SHALL be rejected with a structured error and SHALL NOT be committed. Cross-reference validation remains the responsibility of the post-push build. D1-backed writes are validated at write time by the corresponding tool's structured validators rather than this commit-engine step.

#### Scenario: Malformed recipe write is rejected before commit

- **WHEN** a recipe write is asked to persist content that would not parse as valid frontmatter or sets an out-of-enum value
- **THEN** the tool returns a structured `validation_failed` error describing the problem and makes no commit

#### Scenario: Valid write passes through

- **WHEN** a staged recipe change parses cleanly and all enumerated fields are legal
- **THEN** validation passes and the change proceeds to the atomic commit

### Requirement: Writes are routed by storage tier and data category

The system SHALL route each write to the storage tier that owns the data category:

- **GitHub (atomic commit engine)** — objective recipe **content** (`recipes/`, including the authored `description` and `side_search_terms` frontmatter). These return a `commit_sha`.
- **D1 (row-level, `src/db.ts`)** — per-tenant overlay (`favorite` and `reject` booleans), profile (preferences, taste, diet_principles, kitchen, staples, stockup, ready_to_eat), session state (pantry, meal_plan, grocery_list), the cooking log, attributed notes (`recipe_notes`), the shared corpus (stores, store_notes, ingredient aliases, registries, SKU cache, discovery feeds/inbox/rejections), the recipe-index projection (`recipes`, carrying the `description`/`side_search_terms` columns), and the sibling `recipe_embeddings` table (reconciled Worker-side on the cron). These return **without** a `commit_sha`.

A subjective-field change to a shared recipe SHALL NOT modify shared content. `last_cooked` is not written as overlay — it is realized by appending to the caller's `cooking_log` (via `log_cooked`) and derived by query.

#### Scenario: Content edit commits to GitHub

- **WHEN** an objective edit to a shared recipe's content is persisted
- **THEN** it is committed to `recipes/` in the GitHub data repo and returns a `commit_sha`

#### Scenario: Per-tenant and corpus writes target D1

- **WHEN** a tenant's favorite toggle, reject toggle, note, pantry change, or preference edit is persisted
- **THEN** it is written as rows to the corresponding D1 table for the caller, returns no `commit_sha`, and never modifies shared recipe content or another member's data

### Requirement: Note write tool

The system SHALL provide a tool (`add_recipe_note`) to add a recipe note as a row in the D1 `recipe_notes` table, accepting the recipe slug, body text, optional tags, and an optional `private` flag, and recording the `author` (the authenticated caller, not a spoofable input) and a `created_at` timestamp. Adding a note SHALL be append-style and SHALL NOT modify shared recipe content or overwrite the caller's prior notes on that recipe. It returns without a `commit_sha`.

#### Scenario: Note added to D1

- **WHEN** `add_recipe_note` is called with a slug and body
- **THEN** a new `recipe_notes` row is written with the caller as `author` and a `created_at`, leaving shared content and the caller's earlier notes intact, returning `{ slug, author, created_at }`

#### Scenario: Private flag honored at write

- **WHEN** the note tool is called with `private: true`
- **THEN** the stored row is marked private so later reads surface it only to its author

### Requirement: Recipe write tools enforce the required-field contract

`create_recipe` and `update_recipe` SHALL enforce the full required-field contract (the
`recipe-metadata-contract` capability), rejecting with a structured `validation_failed`
error (no commit) any write whose resulting recipe is missing a required field or carries
an off-contract empty (an empty `title`/`description`/`ingredients_key`/`course`, an
omitted explicit-`null` scalar, or a main lacking `side_search_terms`). For
`update_recipe`, the contract SHALL be checked against the **merged result** (existing
frontmatter overlaid with the patch), not the patch alone — so a single-field edit on an
already-compliant recipe succeeds, while an edit that would strip or empty a required
field is rejected. `create_recipe`'s tool description SHALL enumerate the complete
required-field set, including `ingredients_key` and the explicit-empty forms.

#### Scenario: create_recipe rejects a missing required field

- **WHEN** `create_recipe` is called with frontmatter that omits `ingredients_key`
- **THEN** the tool returns a structured `validation_failed` error naming the missing field and makes no commit

#### Scenario: update_recipe validates the merged result, not the patch

- **WHEN** `update_recipe` patches only `time_total` on a recipe that already carries every other required field
- **THEN** the merged recipe is contract-compliant and the edit commits — the patch need not resend the full field set

#### Scenario: update_recipe rejects an edit that empties a required field

- **WHEN** `update_recipe` patches `description: ""` (or `ingredients_key: []`) onto an existing recipe
- **THEN** the merged result violates the non-empty rule and the tool returns `validation_failed`, making no commit

#### Scenario: create_recipe description enumerates the required set

- **WHEN** the `create_recipe` tool schema is presented to the agent
- **THEN** its description lists every required field (including `ingredients_key`) and the explicit empty form for each

