## MODIFIED Requirements

### Requirement: Pantry write upserts D1 rows

`update_pantry` SHALL persist to the caller's D1 `pantry` table (keyed by a **normalized name**). The normalized key SHALL be the canonical ingredient id resolved through the shared `IngredientContext` funnel (normalize **and** capture) — the pantry is kitchen inventory, food by construction, so every row funnels — so surface-form variants of the same item merge into one row and the pantry lines up with `sku_cache` / recipe ingredient sets / the grocery list on the SAME canonical id. An `add` operation SHALL be an **upsert** (`INSERT … ON CONFLICT DO UPDATE`): if a row with the same canonical id exists, the incoming fields are merged onto it (preserving the original `added_at`, refreshing `last_verified_at` to today, overlaying other supplied fields) rather than appending a duplicate, and the `AppliedOp` result includes `merged: true`; a fresh insert omits `merged` (or sets it `false`). `remove` and `verify` (via `mark_pantry_verified`) are row statements whose query name SHALL be resolved through the SAME funnel before matching, so a case/quantity/alias-varying operation hits its row. The case-insensitive guarantee is preserved (the canonical id is lowercased). This SHALL NOT add cross-base reachability — `chicken::thighs` and `chicken::whole` remain distinct rows (a satisfies relationship between them is the read-path `satisfiesAmong` consumer's concern, not pantry dedup). Writes are strongly consistent and row-level (no whole-array rewrite) and return without a `commit_sha`.

#### Scenario: Pantry add for a new item inserts it

- **WHEN** `update_pantry` is called with `{ op: "add", item: { name: "eggs", quantity: "12", category: "fridge" } }` and no item with that canonical id exists
- **THEN** a new `pantry` row is inserted and the result includes `{ op: "add", name: "eggs" }` without a `merged` flag

#### Scenario: Pantry add for an existing item merges, not duplicates

- **WHEN** `update_pantry` is called with `{ op: "add", item: { name: "olive oil", quantity: "low" } }` and a row with that canonical id already exists
- **THEN** the existing row's `quantity` is updated to "low", `last_verified_at` is refreshed to today, `added_at` is unchanged, no duplicate row is created, and the result includes `{ op: "add", name: "olive oil", merged: true }`

#### Scenario: Surface-form variants of a pantry item merge on the canonical id

- **WHEN** a pantry row exists for "scallions" and `update_pantry` adds "green onions" (or a row "ground beef" exists and "2 lb ground beef" is added)
- **THEN** both resolve to the same canonical id, so the add MERGES into the existing row and no surface-form-fragmented duplicate is created

#### Scenario: Pantry upsert is case-insensitive

- **WHEN** `update_pantry` is called with `{ op: "add", item: { name: "Olive Oil" } }` and a row named "olive oil" already exists
- **THEN** the existing row is updated (not duplicated) and `merged: true` is returned
