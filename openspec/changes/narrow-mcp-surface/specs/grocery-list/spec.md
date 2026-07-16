# grocery-list — delta

## MODIFIED Requirements

### Requirement: Grocery list is stored in and served from D1

The grocery list SHALL be stored as rows in the per-tenant D1 `grocery_list` table (keyed by `(tenant, normalized_name)`), not as a `grocery_list.toml` file or a `state:<username>:grocery_list` JSON array in KV. There is no raw stored-rows read tool: the model-facing reads are the derived [`read_to_buy`](#) view and the `display_grocery_list` widget, and the app plane's `read_grocery_snapshot` is the widget boot read. All list mutations — `update_grocery_list`'s operations and the order/cart status transitions — SHALL be row-level upsert/update/delete (dedup by normalized name), not whole-array rewrites. Writes are strongly consistent (read-after-write).

#### Scenario: Adding an item inserts/updates one row

- **WHEN** an `add` operation adds an item
- **THEN** a single `grocery_list` row is upserted for the caller, leaving other items untouched, and an immediately following read sees it

#### Scenario: One list read per plane

- **WHEN** the model-visible tool surface is enumerated
- **THEN** there is no `read_grocery_list`; `read_to_buy` is the reasoning read, `display_grocery_list` the member-facing verb, and `read_grocery_snapshot` the app-plane boot read

### Requirement: Grocery list CRUD tools

The system SHALL provide one operations-form write tool, `update_grocery_list(operations)`, where each operation is `{ op: "add" | "update" | "remove", … }` — the `update_pantry` operations idiom — applied row-level against D1 with per-op `applied`/`conflicts` reporting and no `commit_sha`. The **`add`** operation SHALL carry the full former `add_to_grocery_list` contract: keyed by a **normalized name** that MERGEs a re-added name into the existing row (union `for_recipes`, reconcile `quantity`) via upsert rather than creating a duplicate. The normalized key SHALL be resolved through the shared `IngredientContext` funnel (the canonical ingredient id — normalize **and** capture) for a **food** row, and through `normalizeName` (lowercase + whitespace-collapse) for a **non-food** row, where a row is food iff its `kind` is `grocery` and its `domain` is grocery (or absent). An `add` MAY additionally accept an explicit canonical `id`: when supplied, it SHALL be validated as an already-canonical id that is a **live survivor** in the identity registry (NOT re-resolved through the funnel), stored as the row's canonical key with the human display kept separately; an `id` that is malformed or not a live survivor SHALL fall back to the `name` path when a name is present, else be rejected with `validation_failed` — an unresolvable key is NEVER stored. A non-food row SHALL NOT be resolved or captured. When a re-add or an add-by-id merges into an existing row, the surviving row SHALL keep its existing `name`/`display_name` rather than adopt the incoming surface form, so a merge never fragments or corrupts the rendered label. A surface SHALL render a row's human label as its explicit `display_name` override when set; else, for an **id-named** row (its stored `name` equals its canonical key), the identity node's label (`display_name`, else the `base (detail)` synthesis); else the stored `name` — the node label resolved at read converges as the reconcile backfills the node's `display_name`, so a legacy id-named row heals with no row edit. The `add` operation's optional `substitutes_for` capture signal is unchanged. New items SHALL be created with `status: active`. The **`remove`** operation SHALL resolve its query through the same funnel so a case/quantity/alias-varying removal hits its row; a removal never writes spend. The **`update`** operation SHALL carry the former patch contract, including the `status` lifecycle guard enforced in the shared update operation (so every caller — the tool, the app plane, and any HTTP surface — gets the identical guarantee): transitions between `active` and `in_cart` freely writable in both directions (including re-listing an `ordered` row back to `active`); a write of `status: "ordered"` accepted **only** when the row's current status is `in_cart` (the user-asserted "I placed the order" advance), stamping `ordered_at`; any other write of `ordered` rejected with a structured `validation_failed` carrying the attempted transition, leaving the row unchanged; the spend-materialization/void guarantees riding those transitions unchanged. The order-flow advance operations (`place_order`'s in-cart advance and the satellite receipt flush's ordered advance) are distinct code paths and SHALL be unaffected by the guard. For one deprecation window, `add_to_grocery_list` and `remove_from_grocery_list` SHALL remain registered as dispatch aliases onto the corresponding operation, and the old single-patch `update_grocery_list(name, …patch)` call form SHALL be detected by shape and converted to a one-op call — identical results, no `warnings` injection; after the window the old names and form fall to the generic unknown-tool/`malformed_data` rejection. Because each write is a single-row D1 upsert/update/delete (no whole-file read-modify-write), several mutations in one turn are one operations array — there is no batch/commit tool and no full-file replay to drop concurrent updates.

#### Scenario: Re-adding an existing item merges

- **WHEN** an `add` operation names an item already present on the list
- **THEN** the existing row is upserted (merged `for_recipes`, reconciled `quantity`) and no duplicate row is created

#### Scenario: Adding by canonical id keys exactly and renders a clean display

- **WHEN** an `add` op carries an explicit `id` of `cabbage::color-red` and a `name` of "Red cabbage" (e.g. the app materializing an accepted sibling swap)
- **THEN** the row stores `cabbage::color-red` as its key and "Red cabbage" as its `name` (validated as a live survivor, not re-resolved), it dedups/advances against any existing `cabbage::color-red` row, and every surface renders "Red cabbage" — never the raw id

#### Scenario: A multi-item capture is one operations call

- **WHEN** a menu capture adds several to-buy items at once
- **THEN** one `update_grocery_list` call carries one `add` op per item, each applied as its own row write with per-op reporting

#### Scenario: Cart moves are freely writable

- **WHEN** an `update` op sets an `active` item to `in_cart`, or an `in_cart` item back to `active`
- **THEN** the write is applied unconditionally, in either direction

#### Scenario: Ordered cannot be minted from active

- **WHEN** an `update` op attempts to set an `active` item directly to `ordered`
- **THEN** the operation is rejected with a structured `validation_failed` carrying the attempted transition, and the row is unchanged

#### Scenario: A stale plugin's add still lands

- **WHEN** a stale plugin calls `add_to_grocery_list(item)` during the deprecation window
- **THEN** the alias dispatches to an `add` operation and returns the identical result with no warning injected

#### Scenario: The old single-patch form converts for one window

- **WHEN** a stale caller invokes `update_grocery_list` with the old `(name, …patch)` shape
- **THEN** the call is converted to a single `update` operation and behaves identically
