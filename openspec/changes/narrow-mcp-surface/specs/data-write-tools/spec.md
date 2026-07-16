# data-write-tools — delta

## ADDED Requirements

### Requirement: set_recipe_disposition writes the caller's recipe disposition to the D1 overlay

The system SHALL provide a `set_recipe_disposition(slug, disposition)` tool, `disposition ∈ "favorite" | "hide" | "none"`, that writes the caller's per-tenant overlay row for a recipe and returns without a `commit_sha`. `"favorite"` SHALL set the favorite flag and clear any reject; `"hide"` SHALL set the reject flag (excluding the recipe from the caller's `search_recipes` results, both modes — the existing hard gate) and clear any favorite; `"none"` SHALL clear both, deleting the overlay row when nothing else is set on it — the pair's mutual exclusivity is preserved by construction. It SHALL validate `slug` against the D1 `recipes` table (`not_found` when absent) and SHALL NOT write shared recipe content. For one deprecation window `toggle_favorite(slug, favorite)` and `toggle_reject(slug, reject)` SHALL remain registered as dispatch aliases onto this tool (identical results, no `warnings` injection); after the window they persist as app-plane-only registrations for the recipe-card widget (`mcp-tool-gating`).

#### Scenario: Favoriting clears a prior hide

- **WHEN** the caller had hidden a recipe and calls `set_recipe_disposition(slug, "favorite")`
- **THEN** the overlay row carries favorite and no reject, and the recipe returns to the caller's search results

#### Scenario: none returns the recipe to neutral

- **WHEN** `set_recipe_disposition(slug, "none")` is called on a row whose only field was the favorite flag
- **THEN** the overlay row is deleted and the recipe reads as neutral/available

#### Scenario: Unknown slug is rejected

- **WHEN** `set_recipe_disposition` is called with a slug not in `recipes`
- **THEN** a structured `not_found` is returned and nothing is written

#### Scenario: A stale toggle call dispatches

- **WHEN** a stale plugin calls `toggle_reject(slug, true)` during the deprecation window
- **THEN** the alias dispatches to `set_recipe_disposition(slug, "hide")` and returns the identical overlay result

## MODIFIED Requirements

### Requirement: Granular write tools, no batch commit

The system SHALL expose a granular write tool per category and SHALL NOT provide a batch `commit_changes` tool. The member-surface write categories and their homes are: recipe import (`import_recipe` — the fused parse/classify/persist path), recipe disposition (`set_recipe_disposition`), ready-to-eat (`add_draft_ready_to_eat` / `update_ready_to_eat`, pending the separate ready-to-eat removal change), config (`update_preferences` / `update_taste` / `update_diet_principles`), cooking events (`log_cooked`), pantry and kitchen (`update_pantry` operations — add/remove/verify/dispose plus the equipment ops), meal plan (`update_meal_plan`), grocery list (`update_grocery_list` operations), recipe notes (`add_recipe_note`), meal vibes (`add_meal_vibe`), and store capture (`add_store` / `add_store_note`). Objective recipe edits are the operator plane's `update_recipe` (merge review); staples, stockup, ingredient aliases, guidance content, discovery config, and store/note maintenance are written through the member web app or operator admin surfaces over the same shared operations, not through member MCP tools. A multi-write turn SHALL issue one granular call per write. No tool in this capability SHALL write a Kroger cart or call an external commerce service (cart placement is the separate `place_order` tool).

#### Scenario: There is no commit_changes tool

- **WHEN** the tool surface is enumerated
- **THEN** there is no `commit_changes` tool, and each write category is served by its own standalone tool

#### Scenario: A multi-write turn issues granular calls

- **WHEN** a turn needs to write a recipe favorite, a pantry change, and a grocery item
- **THEN** it calls `set_recipe_disposition`, `update_pantry`, and `update_grocery_list` separately, rather than batching them into one commit

### Requirement: Objective recipe content commits to GitHub

`update_recipe(slug, updates)` and the shared create operation (behind `import_recipe` and the discovery sweep) SHALL write only objective shared recipe **content** (frontmatter/body) to the shared corpus store, and SHALL surface failures as structured errors. `update_recipe` SHALL register on the **operator plane only** (`mcp-tool-gating`) — its remaining chat use is the agent-guided merge-review flow. It SHALL reject `favorite`, `reject`, or `status` keys with a structured `validation_failed` error directing the caller to `set_recipe_disposition`, and SHALL reject `last_cooked` (derived via the cooking log / `log_cooked`). It SHALL NOT write any per-tenant overlay or other domain data, and SHALL return `{ slug, updated_fields }`.

#### Scenario: update_recipe commits objective content

- **WHEN** the operator calls `update_recipe("miso-salmon", { time_total: 30 })` with valid objective frontmatter
- **THEN** the shared recipe content is written and the tool returns `{ slug, updated_fields }`

#### Scenario: update_recipe rejects subjective keys

- **WHEN** `update_recipe("miso-salmon", { status: "active" })` is called
- **THEN** a structured `validation_failed` error is returned directing the caller to `set_recipe_disposition`, and nothing is written

#### Scenario: Write failure is structured

- **WHEN** the corpus store is unreachable or rejects the write after retries are exhausted
- **THEN** the tool returns a structured `upstream_unavailable` error and does not throw an unhandled exception

### Requirement: Profile writes target D1

The per-tenant profile write tools — `update_taste`, `update_diet_principles`, `add_draft_ready_to_eat`, `update_ready_to_eat`, and `set_recipe_disposition` — SHALL persist to the D1 profile tables (`profile`, `ready_to_eat`, `overlay`) as typed rows, not as TOML strings in a KV bundle or `users/<username>/*.toml` files. They SHALL return without a `commit_sha` and SHALL NOT serialize TOML. Multi-row writes SHALL use a D1 transaction.

Ready-to-eat is **per-tenant personal state**: `add_draft_ready_to_eat` and `update_ready_to_eat` SHALL write the caller's `ready_to_eat` rows. Each item SHALL be keyed by a generated `slug` (derived from its `name`, unique within the caller's set); `update_ready_to_eat` SHALL address items by `slug`. Items have no `status` or `rating` — disposition is via `favorite`/`reject` only.

The staples list and bulk-buy watchlist remain per-tenant D1 state (`staples`, `stockup`) with their existing shared write operations — add-only-with-dedup stockup, add/remove staples deduped by normalized `name` — but those operations are surfaced by the member web app, not by member MCP tools. Kitchen equipment writes ride `update_pantry`'s equipment operations (the pantry requirement below).

#### Scenario: Structured profile write updates D1 rows

- **WHEN** `update_ready_to_eat` or `set_recipe_disposition` is applied
- **THEN** the corresponding D1 table rows are upserted/deleted for the caller, with no TOML serialization, no KV bundle write, and no `commit_sha`

#### Scenario: Ready-to-eat write targets the caller's D1 rows

- **WHEN** `add_draft_ready_to_eat` or `update_ready_to_eat` is called
- **THEN** the change is written to the caller's `ready_to_eat` rows, keyed by the item's generated `slug`, and no shared catalog is touched

#### Scenario: Staples and stockup are member-app writes over the same ops

- **WHEN** a member curates staples or stockup items
- **THEN** the member app writes through the existing shared operations (dedup by normalized name preserved), and no `update_staples`/`update_stockup` tool appears on the MCP surface

#### Scenario: Unknown ready-to-eat target is structured, not thrown

- **WHEN** `update_ready_to_eat` is called with a `slug` that no item in the caller's rows resolves to
- **THEN** the tool returns a structured error rather than throwing

### Requirement: User-curated narrative writes are content-faithful

The user-curated narrative `update_*` tools — `update_taste` and `update_diet_principles` (D1 `profile` row) — SHALL write exactly the markdown supplied by the caller and SHALL NOT infer or merge additional changes, returning `{ updated }` with no `commit_sha`. `update_taste` SHALL additionally accept a `mode` of `"replace"` (default — the existing whole-field write) or `"append"` — appending the supplied content to the existing narrative with a blank-line separator (a NULL narrative stores the content as-is) — so an ambient taste capture can never clobber the member's curated text. `update_diet_principles` remains replace-only (dietary gates are edited deliberately, never appended ambiently). There is no `update_substitutions` tool. Ingredient alias and display-name curation (the human-precedence writes into the shared identity graph) is an operator admin surface over the same shared write operation — there is no member `update_aliases` tool. The discipline of *when* these may be called (only on explicit user direction for `replace`; silent capture uses `append`) is documented in `AGENT_INSTRUCTIONS.md`.

#### Scenario: Narrative write persists provided content verbatim

- **WHEN** `update_taste(content)` is called with a directed edit and no `mode`
- **THEN** the tool replaces the caller's taste narrative with the provided markdown and returns `{ updated }` with no `commit_sha`, without adding inferred changes

#### Scenario: An appended capture preserves the existing narrative

- **WHEN** `update_taste(content, mode: "append")` is called while a narrative exists
- **THEN** the stored narrative is the prior text plus a blank-line separator plus the new content — nothing is dropped or rewritten

#### Scenario: Alias curation has no member tool

- **WHEN** the member MCP tool surface is enumerated
- **THEN** there is no `update_aliases` tool; human alias/display-name overrides are written from the operator admin surface with `source='human'` precedence intact

### Requirement: Pantry write upserts D1 rows

`update_pantry` SHALL persist to the caller's D1 `pantry` table (keyed by a **normalized name**). The normalized key SHALL be the canonical ingredient id resolved through the shared `IngredientContext` funnel (normalize **and** capture) — the pantry is kitchen inventory, food by construction, so every row funnels — so surface-form variants of the same item merge into one row and the pantry lines up with `sku_cache` / recipe ingredient sets / the grocery list on the SAME canonical id. Each row SHALL also carry a `display_name` (nullable, the human-facing label) stored independently of both the resolver-input `name` and the canonical key; a surface a human reads SHALL render `display_name ?? name`, never the raw canonical id. An `add` operation SHALL be an **upsert** (`INSERT … ON CONFLICT DO UPDATE`): if a row with the same canonical id exists, the incoming fields are merged onto it (preserving the original `added_at` and the surviving row's existing display — `name`/`display_name` are kept, NOT overwritten by the incoming surface form — refreshing `last_verified_at` to today, overlaying other supplied fields) rather than appending a duplicate, and the `AppliedOp` result includes `merged: true`; a fresh insert omits `merged` (or sets it `false`). `remove` and the `verify` operation (the sole verification surface — there is no standalone `mark_pantry_verified` tool) are row statements whose query name SHALL be resolved through the SAME funnel before matching, so a case/quantity/alias-varying operation hits its row. `update_pantry` SHALL additionally carry the kitchen-equipment operations — `{ op: "equip" | "unequip", slug }` against the caller's `owned` equipment list and `{ op: "set_kitchen_note", key, value }` against `profile.kitchen_notes` — delegating to the same kitchen apply path the retired `update_kitchen` used: an `equip` of an off-`EQUIPMENT_VOCAB` slug is a per-op **conflict** (never a silent write), an `equip` of an already-owned slug is idempotent, an `unequip` of an absent slug is a conflict, and `set_kitchen_note` fields inform the cook flow only and never gate a recipe. The case-insensitive guarantee is preserved (the canonical id is lowercased). This SHALL NOT add cross-base reachability — `chicken::thighs` and `chicken::whole` remain distinct rows (a satisfies relationship between them is the read-path `satisfiesAmong` consumer's concern, not pantry dedup). Writes are strongly consistent and row-level (no whole-array rewrite) and return without a `commit_sha`.

#### Scenario: Pantry add for a new item inserts it

- **WHEN** `update_pantry` is called with `{ op: "add", item: { name: "eggs", quantity: "12", category: "fridge" } }` and no item with that canonical id exists
- **THEN** a new `pantry` row is inserted and the result includes `{ op: "add", name: "eggs" }` without a `merged` flag

#### Scenario: Pantry add for an existing item merges, not duplicates

- **WHEN** `update_pantry` is called with `{ op: "add", item: { name: "olive oil", quantity: "low" } }` and a row with that canonical id already exists
- **THEN** the existing row's `quantity` is updated to "low", `last_verified_at` is refreshed to today, `added_at` is unchanged, no duplicate row is created, and the result includes `{ op: "add", name: "olive oil", merged: true }`

#### Scenario: A pantry merge keeps the surviving row's display

- **WHEN** a pantry row exists as "scallions" and `update_pantry` adds "green onions" for the same canonical id
- **THEN** the merge keeps the surviving row's display ("scallions" / its `display_name`) rather than overwriting it with the incoming surface form, so the rendered label is stable across merges

#### Scenario: Verification rides the verify op

- **WHEN** `update_pantry` applies `{ op: "verify", name: "Olive Oil" }` for an existing "olive oil" row
- **THEN** the row's `last_verified_at` is reset (funnel-resolved, case-insensitive) with no standalone verification tool involved

#### Scenario: Equipment operations ride update_pantry

- **WHEN** `update_pantry` applies `{ op: "equip", slug: "pressure-cooker" }` for a caller with no prior inventory
- **THEN** the caller's D1 kitchen inventory `owned` contains `pressure-cooker` and a later `read_user_profile().kitchen` reflects it

#### Scenario: Off-vocabulary equipment is a conflict

- **WHEN** `update_pantry` applies an `equip` whose slug is not in `EQUIPMENT_VOCAB`
- **THEN** that operation is reported as a structured conflict identifying the unknown slug and `owned` is not written

### Requirement: Recipe write tools enforce controlled vocabularies

The recipe write paths — the shared create operation (behind `import_recipe` and the discovery sweep) and the operator-plane `update_recipe` — SHALL reject a write whose recipe frontmatter carries a `protein`, `cuisine`, or `requires_equipment` value outside its controlled vocabulary, returning a structured `validation_failed` error (naming the offending field and value) and writing **nothing**. Enforcement SHALL occur at the shared `validateFile` step so every recipe write path is covered uniformly. `protein` and `cuisine` SHALL each be present as an in-vocabulary value **or the explicit literal `null`** — the write path SHALL NOT normalize a no-focus dish to an absent field and SHALL NOT accept the literal string `none` (a `none`/`""` value is rejected as non-compliant, prompting `null`). The `update_recipe` tool description SHALL enumerate the `protein` and `cuisine` controlled sets and SHALL state that a dish with no protein focus is written as `protein: null` — never omitted, never `none`; `import_recipe` classifies these fields internally, so its description carries no authoring vocabulary.

#### Scenario: Off-vocabulary protein is rejected before the write

- **WHEN** the create operation is invoked with frontmatter `protein: shrimp` (the bucket is `shellfish`)
- **THEN** it returns a structured `validation_failed` error naming `protein` and `shrimp`, and no recipe is written

#### Scenario: No-protein dish requires explicit null

- **WHEN** the create operation is invoked for a vegetable side with `protein: none` (or an empty string)
- **THEN** it returns a structured `validation_failed` error directing `protein: null`, and the recipe is written only once `protein` is the explicit `null`

#### Scenario: Off-vocabulary equipment is rejected before the write

- **WHEN** `update_recipe` is called with `requires_equipment: ["air-fryer"]` and `air-fryer` is not in the equipment vocabulary
- **THEN** the tool returns a structured `validation_failed` error naming the offending slug, and no change is written

#### Scenario: In-vocabulary recipe write succeeds

- **WHEN** the create operation is invoked with `protein: shellfish`, `cuisine: thai`, and `requires_equipment: []`, all legal
- **THEN** the recipe is written normally and the caller receives the slug

### Requirement: Recipe write tools enforce the required-field contract

The shared create operation (behind `import_recipe` and the discovery sweep) and the operator-plane `update_recipe` SHALL enforce the full required-field contract (the `recipe-metadata-contract` capability), rejecting with a structured `validation_failed` error (no write) any change whose resulting recipe is missing a required field or carries an off-contract empty. For `update_recipe`, the contract SHALL be checked against the **merged result** (existing frontmatter overlaid with the patch), not the patch alone — so a single-field edit on an already-compliant recipe succeeds, while an edit that would strip or empty a required field is rejected. `import_recipe` SHALL populate the required authored fields itself (parse plus classification), so a member import can never produce a silently un-indexed recipe.

#### Scenario: The create path rejects a missing required field

- **WHEN** the create operation is invoked with frontmatter that omits a required authored field
- **THEN** it returns a structured `validation_failed` error naming the missing field and writes nothing

#### Scenario: update_recipe validates the merged result, not the patch

- **WHEN** `update_recipe` patches only `time_total` on a recipe that already carries every other required field
- **THEN** the merged recipe is contract-compliant and the edit lands — the patch need not resend the full field set

#### Scenario: update_recipe rejects an edit that empties a required field

- **WHEN** `update_recipe` patches `ingredients_key: []` onto an existing recipe
- **THEN** the merged result violates the non-empty rule and the tool returns `validation_failed`, writing nothing

## REMOVED Requirements

### Requirement: toggle_favorite writes the caller's favorite boolean to the D1 overlay

**Reason**: Fused into `set_recipe_disposition` — one disposition verb removes the two-tool mutual-exclusivity trap from the model's hands. The overlay write, slug validation, exclusivity, and row-cleanup semantics carry over unchanged.
**Migration**: `set_recipe_disposition(slug, "favorite" | "none")`. `toggle_favorite` remains a one-window dispatch alias, then an app-plane-only registration for the recipe-card widget.

### Requirement: toggle_reject hides a recipe for the caller via the D1 overlay

**Reason**: Fused into `set_recipe_disposition` (`"hide"`). The search hard gate, per-tenant scope, and the contrast with group-wide discovery-source suppression are unchanged.
**Migration**: `set_recipe_disposition(slug, "hide" | "none")`. `toggle_reject` remains a one-window dispatch alias, then an app-plane-only registration.
