# grocery-list Specification

## Purpose
TBD - created by archiving change git-write-tools. Update Purpose after archive.
## Requirements
### Requirement: Grocery list is stored in and served from D1

The grocery list SHALL be stored as rows in the per-tenant D1 `grocery_list` table (keyed by `(tenant, normalized_name)`), not as a `grocery_list.toml` file or a `state:<username>:grocery_list` JSON array in KV. `read_grocery_list` SHALL query rows (a status filter applied as a `WHERE` clause); `add_to_grocery_list` / `update_grocery_list` / `remove_from_grocery_list` and the order/cart status transitions SHALL be row-level upsert/update/delete (dedup by normalized name), not whole-array rewrites. Writes are strongly consistent (read-after-write).

#### Scenario: Adding an item inserts/updates one row

- **WHEN** `add_to_grocery_list` adds an item
- **THEN** a single `grocery_list` row is upserted for the caller, leaving other items untouched, and an immediately following read sees it

#### Scenario: Status filter is a query

- **WHEN** `read_grocery_list` is called filtered to `active`
- **THEN** the result comes from `WHERE tenant=? AND status='active'`, not by loading and filtering the whole list

### Requirement: Grocery list schema

The grocery list SHALL be an ingredient-level, **SKU-free** buy list of committed buy-intent that accumulates across a week. Each item SHALL carry: `name` (required, the member's surface form and the order-time search-term input), `display_name` (nullable, the human-facing label rendered to the member; when null the rendered label falls back to `name`), `quantity` (loose buy amount, same looseness as pantry), `kind` (`grocery` | `household` | `other`, default `grocery`), `domain` (free string identifying the kind of store it's bought at — common values `grocery` | `home-improvement` | `garden` | `pharmacy`; default `grocery`), `status` (`active` | `in_cart` | `ordered`, required), `source` (`ad_hoc` | `menu` | `pantry_low` | `stockup`), `for_recipes` (recipe slugs; may be empty), `note` (freeform or null), `added_at` (ISO date, required), `ordered_at` (ISO date or null), and `sent_in` (nullable — the internal send-record linkage: the `order_sends` id whose flush advanced this row's current in-flight cart state; see `spend-telemetry` and the `order-placement` lifecycle). `sent_in` SHALL be stamped only by the order-flush advances (never by a manual status write, never accepted as a caller-writable field on any tool or HTTP surface) and cleared when the row leaves its in-flight send without a purchase assertion. The `name` and the dedup key (`normalized_name`, the canonical id for a food row) are stored separately, and `display_name` is stored independently of both — a surface a human reads SHALL render `display_name ?? name`, never the raw `normalized_name`/id. **`received` SHALL NOT be a stored status value**: receiving is the terminal receive *action* — the row is removed from the list and, for `grocery`-kind items only, the pantry is restocked — identical across every fulfillment mode (Kroger pickup, satellite checkout, in-store walk). The schema SHALL be documented in `docs/SCHEMAS.md`, and the list SHALL be agent-writable side-effect state (not user-curated config). Items SHALL NOT store a resolved Kroger SKU — resolution is deferred to order time. `domain` is orthogonal to `kind`: `kind` governs pantry reconcile on receive, `domain` governs which store-type a walk includes the item in.

#### Scenario: Item conforms to schema

- **WHEN** an item is written to the `grocery_list` table
- **THEN** it carries a `name`, a `status` from the legal set (`active` | `in_cart` | `ordered`), an `added_at` date, and no resolved SKU, and it passes write-time validation

#### Scenario: Display name is stored independently of the key

- **WHEN** a row is materialized by canonical id (e.g. accepting a graph-sibling swap) so its `normalized_name` is `cabbage::color-red`
- **THEN** its `display_name` holds the curated label ("Red cabbage"), the row still dedups/joins on the id, and the rendered label is "Red cabbage" — never the raw id

#### Scenario: Receiving removes the row rather than storing a terminal status

- **WHEN** the user asserts groceries were picked up / received
- **THEN** each received item's row is removed (and `grocery`-kind items restock the pantry) — no row is ever written with a `status: "received"`

#### Scenario: Non-food item is representable

- **WHEN** a household item such as "paper towels" is added
- **THEN** it is stored with `kind = "household"` and is not tied to any recipe or pantry entry

#### Scenario: Domain defaults to grocery

- **WHEN** an item is added with no `domain` supplied
- **THEN** it is stored with `domain = "grocery"` and validates unchanged (rows without a `domain` are read as `grocery`)

#### Scenario: Non-grocery item carries its domain

- **WHEN** a "2x4 lumber" item is added with `domain = "home-improvement"`
- **THEN** it is stored with that domain, included in an in-store walk for a `home-improvement` store, and excluded from a `grocery` walk

#### Scenario: The send linkage is not caller-writable

- **WHEN** any tool or HTTP write supplies a `sent_in` value
- **THEN** it is not accepted as an input field — `sent_in` is stamped and cleared only by the shared order-flush and status-transition operations

### Requirement: Grocery list CRUD tools

The system SHALL provide `read_grocery_list`, `add_to_grocery_list`, `update_grocery_list`, and `remove_from_grocery_list` for single-item live edits, each a row-level D1 operation that returns without a `commit_sha`. `add_to_grocery_list` SHALL be keyed by a **normalized name** and MERGE a re-added name into the existing row (union `for_recipes`, reconcile `quantity`) via upsert rather than creating a duplicate. The normalized key SHALL be resolved through the shared `IngredientContext` funnel (the canonical ingredient id — normalize **and** capture) for a **food** row, and through `normalizeName` (lowercase + whitespace-collapse) for a **non-food** row, where a row is food iff its `kind` is `grocery` and its `domain` is grocery (or absent). `add_to_grocery_list` MAY additionally accept an explicit canonical `id`: when supplied, it SHALL be validated as an already-canonical id that is a **live survivor** in the identity registry (NOT re-resolved through the funnel). The row SHALL store that id as its canonical key (`normalized_name`) and a human **display** as its `name` — the posted `name` when present, else the identity node's label — the two stored separately; the stored key SHALL be threaded through dedup and the set-algebra so the row keys, dedups, matches, and advances on the id while rendering its display `name`. An `id` that is malformed or not a live survivor SHALL fall back to the `name` path when a name is present, else be rejected with `validation_failed` — an unresolvable key is NEVER stored. A non-food row SHALL NOT be resolved or captured, so the ingredient identity graph only ever ingests real food vocabulary. When a re-add or an add-by-id merges into an existing row, the surviving row SHALL keep its existing `name`/`display_name` rather than adopt the incoming surface form, so a merge never fragments or corrupts the rendered label. A surface SHALL render a row's human label as its explicit `display_name` override when set; else, for an **id-named** row (its stored `name` equals its canonical key — a legacy row from before this capability, or a plan-derived virtual line), the identity node's label (`display_name`, else the `base (detail)` synthesis); else the stored `name` (a typed add's member phrasing, or an add-by-id row's stored display). The node label resolved at read converges as the reconcile backfills the node's `display_name`, so a legacy id-named row heals with no row edit. `remove_from_grocery_list` SHALL resolve its query through the same funnel so a case/quantity/alias-varying removal hits its row. New items SHALL be created with `status: active`. `update_grocery_list` SHALL guard the `status` lifecycle in the shared update operation (so every caller — the tool and any HTTP surface — gets the identical guarantee): transitions between `active` and `in_cart` SHALL be freely writable in both directions (including re-listing an `ordered` row back to `active`); a write of `status: "ordered"` SHALL be accepted **only** when the row's current status is `in_cart` (the user-asserted "I placed the order" advance) and SHALL stamp `ordered_at`; any other write of `ordered` SHALL be rejected with a structured `validation_failed` error carrying the attempted transition, leaving the row unchanged. The order-flow advance operations (`place_order`'s in-cart advance and the satellite receipt flush's ordered advance) are distinct code paths and SHALL be unaffected by the guard. The tool description SHALL state this guarantee. Because each write is a single-row D1 upsert/update/delete (no whole-file read-modify-write), several mutations in one turn are simply a sequence of row-level writes — there is no batch/commit tool and no full-file replay to drop concurrent updates.

#### Scenario: Re-adding an existing item merges

- **WHEN** `add_to_grocery_list` is called with a name already present on the list
- **THEN** the existing row is upserted (merged `for_recipes`, reconciled `quantity`) and no duplicate row is created

#### Scenario: Surface-form variants of a food item merge to one row

- **WHEN** a food item is on the list as "scallions" and `add_to_grocery_list` is called with "green onions" (or "2 lb chicken breast" when "chicken breast" is present)
- **THEN** both resolve to the same canonical id, so the add MERGES into the existing row rather than creating a second, surface-form-fragmented row

#### Scenario: Adding by canonical id keys exactly and renders a clean display

- **WHEN** `add_to_grocery_list` is called with an explicit `id` of `cabbage::color-red` and a `name` of "Red cabbage" (e.g. the app materializing an accepted sibling swap)
- **THEN** the row stores `cabbage::color-red` as its key (`normalized_name`) and "Red cabbage" as its `name` (validated as a live survivor, not re-resolved), it dedups/advances against any existing `cabbage::color-red` row via the threaded key, and every surface renders "Red cabbage" — never the raw id

#### Scenario: An id-named row heals as the node label is curated

- **WHEN** a stored row's `name` equals its canonical key (an add-by-id row, or a legacy row created before this capability) and the identity node's `display_name` is later backfilled or curated
- **THEN** the row's rendered label converges to the node's `display_name` at the next read, with no edit to the row

#### Scenario: A merge keeps the surviving row's display

- **WHEN** a row already exists (as "scallions") and an add for the same canonical id arrives carrying a different surface form or display
- **THEN** the merged row keeps its existing display ("scallions" / its `display_name`), so the rendered label is stable and never shows the incoming or a corrupted form

#### Scenario: A non-food item is not routed through the ingredient graph

- **WHEN** `add_to_grocery_list` is called with a `household`/`other` item or a non-grocery `domain` (e.g. "AA batteries", "potting soil")
- **THEN** the row is keyed by `normalizeName` and the name is NOT resolved or enqueued to the novel-term queue

#### Scenario: New item starts active

- **WHEN** a not-yet-present item is added
- **THEN** a `grocery_list` row is created with `status: "active"` and an `added_at` date, with no `commit_sha`

#### Scenario: Read returns the current list

- **WHEN** `read_grocery_list` is called
- **THEN** it returns the current rows with their fields, including `status` and `source`, each row's rendered label being `display_name ?? name`

#### Scenario: A multi-item capture is a sequence of row writes

- **WHEN** a menu capture adds several to-buy items at once
- **THEN** each item is upserted as its own `grocery_list` row (no batch commit tool, no per-item git commit)

#### Scenario: Cart moves are freely writable

- **WHEN** `update_grocery_list` sets an `active` item to `in_cart`, or an `in_cart` item back to `active`
- **THEN** the write is applied unconditionally, in either direction

#### Scenario: The user-asserted order-placed advance stamps ordered_at

- **WHEN** `update_grocery_list` sets an `in_cart` item to `ordered` (the user asserting the order was placed)
- **THEN** the row advances to `ordered` and `ordered_at` is stamped with today's date

#### Scenario: Ordered cannot be minted from active

- **WHEN** `update_grocery_list` attempts to set an `active` item directly to `ordered`
- **THEN** the write is rejected with a structured `validation_failed` error carrying the attempted transition, and the row is unchanged

### Requirement: Prompted promotion from pantry

When a pantry item is low or out, the system SHALL treat adding it to the grocery list as a prompted, user-confirmed decision and SHALL NOT auto-add it. An item promoted from pantry SHALL be recorded with `source: "pantry_low"`. Observation (pantry quantity) and intent (the buy list) are kept as distinct facts.

#### Scenario: Low pantry item is offered, not auto-added

- **WHEN** the user reports an item is low or out and the agent considers it for the buy list
- **THEN** the item is added to the `grocery_list` table only after the user confirms, recorded with `source: "pantry_low"`

### Requirement: Provenance supports order-time dedup and aggregation

The list's `source` and `for_recipes` fields SHALL carry enough provenance for order-time reconciliation without storing portion math. The order-time to-buy set SHALL be `grocery_list(active) ∪ menu-needs − pantry-has`, where **menu needs are derived server-side from the meal plan's recipes' derived full ingredient lists** (see the derived to-buy read requirement) rather than materialized into rows at plan time; `for_recipes` SHALL let the agent aggregate how much the menu needs of an ingredient from the recipes' stated amounts. Explicit `source: "menu"` rows remain legal and meaningful: they are **materializations** — a derived need pinned or edited into an explicit row (or an open-world side's world-knowledge ingredients, which have no recipe to derive from) — and they merge with the derived need under the same canonical id. Lifecycle transitions past `active` (`in_cart`, `ordered`, and the terminal receive action) are driven by the order-placement flow and the user-asserted transitions.

#### Scenario: Menu-derived item records its recipes

- **WHEN** an ingredient reaches the list as an explicit menu row (a materialization or an open-world side ingredient)
- **THEN** it is recorded with `source: "menu"` and any contributing recipe slugs in `for_recipes`

#### Scenario: A materialized row and its derived need do not double-count

- **WHEN** the order-time to-buy set is computed while an ingredient exists both as a derived plan need and as an explicit `source: "menu"` row
- **THEN** the two merge on the canonical id into a single to-buy line with unioned `for_recipes`

### Requirement: The to-buy set is a derived, first-class read

The system SHALL expose the order-time to-buy set as a read — computed at read time from the `active` grocery list, the meal plan's derived ingredient needs, and the pantry, joined on canonical ingredient ids by the same shared set-algebra operation `place_order` uses — via the MCP `read_to_buy` tool and the member app's grocery read surface, both calling one shared operation. Derived lines SHALL carry `source:"menu"`-shaped provenance (`origin: "plan"`, `for_recipes`) and SHALL exist only in the read: no reconcile, cron, or write path SHALL materialize plan needs into `grocery_list` rows automatically — materialization SHALL happen only through an explicit edit/pin (the standard add upsert). Pantry-covered needs SHALL be returned as a distinct section (never silently dropped), and planned recipes with no derived ingredient list SHALL be reported by slug.

#### Scenario: The plan is the source of truth for derived lines

- **WHEN** the meal plan changes (a recipe added, removed, or swapped)
- **THEN** the next to-buy read reflects the change with no intervening write to `grocery_list`

#### Scenario: No automatic materialization

- **WHEN** the to-buy read computes derived lines
- **THEN** it writes nothing: repeated reads with unchanged inputs return the same lines and leave `grocery_list` untouched

### Requirement: Checked state is orthogonal, versioned, and canonical-keyed

Each `grocery_list` row SHALL add nullable ISO `checked_at`, integer `row_version`, and `updated_at`. Every operation that changes any field on a grocery row SHALL advance its `row_version` and `updated_at`. `checked_at` SHALL be orthogonal to `status`; checking or unchecking SHALL NOT write `in_cart`, `ordered`, `ordered_at`, or `sent_in`. The shared checked operation SHALL address the canonical row key, accept the desired boolean plus the rendered `expected_row_version` and aggregate `snapshot_version`, and update only check/concurrency fields on an existing row.

#### Scenario: Checking does not change cart status
- **WHEN** an active row is checked
- **THEN** `checked_at` is stamped and its row version advances while `status` remains `active` and `sent_in` remains unchanged

#### Scenario: Repeated desired state is idempotent
- **WHEN** the same checked=true request is delivered more than once
- **THEN** the row remains checked and every delivery reports success without creating another row or cart transition

#### Scenario: A note edit invalidates an older check guard
- **WHEN** a row's note changes after the caller rendered its row version
- **THEN** the note write advances the version and an opposing stale checked-state write cannot overwrite it silently

#### Scenario: Opposing stale state conflicts
- **WHEN** a stale uncheck targets a row that another member changed after the caller's `expected_row_version`
- **THEN** the Worker does not overwrite the newer value and returns `conflict` with a fresh snapshot

### Requirement: Checking a virtual plan line atomically materializes it

When checked=true targets an origin-plan line with no stored row, the checked operation SHALL atomically materialize a `source:"menu"` row under that exact canonical key with its human display, kind/domain, derived recipe attribution and quantity provenance, and stamp `checked_at`. Unchecking a virtual line with no row SHALL be an idempotent no-op. A materialized checked row SHALL remain after its originating recipe leaves the plan until unchecked, swept by shop completion, or explicitly removed.

#### Scenario: Virtual line is durable across devices
- **WHEN** a member checks a virtual plan need
- **THEN** one canonical stored row exists with `source:"menu"` and `checked_at`, and another member's next read sees the same checked line

#### Scenario: Atomic write cannot strand an unchecked pin
- **WHEN** virtual materialization/check fails
- **THEN** neither the new row nor the check is committed

### Requirement: Derived to-buy algebra subtracts checked rows

The shared algebra SHALL compute `shopping = (active stored rows UNION plan needs) MINUS pantry coverage MINUS active substitution suppressions`, then partition it into `to_buy` where `checked_at` is null and `checked` where it is non-null. The Grocery snapshot SHALL render both partitions as one shopping list; `read_to_buy`, order preview, `place_order`, and sidebar count SHALL use only `to_buy`. Check marks SHALL be swept only by the future manual-shop/walk shop-commit operation, never by an online order flush or satellite advance.

#### Scenario: Checked plan need cannot be ordered
- **WHEN** a plan-derived line is checked and the to-buy view and order preview are read
- **THEN** it appears under checked/shopping state but not in `to_buy` or the order preview

#### Scenario: Uncheck restores buy intent
- **WHEN** that row is unchecked while still active and not pantry-covered
- **THEN** the next derived view includes it in `to_buy`

#### Scenario: Online sends leave other checks alone
- **WHEN** `place_order` advances unchecked to-buy lines to `in_cart`
- **THEN** unrelated checked rows remain active and checked

### Requirement: Grocery snapshots expose row and aggregate freshness

Raw stored-row reads SHALL return `checked_at`, `row_version`, and `updated_at`. The shared grocery snapshot and `read_to_buy` SHALL return an opaque `snapshot_version` derived from the canonical state they render. Every shared grocery mutation SHALL return the authoritative post-write snapshot; a request whose aggregate version is stale SHALL either perform only the explicitly specified safe row merge or return a structured conflict without a partial write.

#### Scenario: Mutation returns post-write truth
- **WHEN** a checked, pantry, substitution, relist, or mark-placed mutation succeeds
- **THEN** its response includes the complete current snapshot and its new `snapshot_version`

### Requirement: Accepted grocery substitutions persist independently of host state

The system SHALL persist an accepted cross-ingredient substitution keyed by tenant and original canonical key, carrying the replacement key, the original stable recipe-attribution signature, concurrency metadata, and whether the operation created the replacement row. Accept SHALL atomically materialize/upsert the replacement and suppress the original from shopping/to-buy; Undo SHALL remove suppression and SHALL remove the replacement only if it was created by that decision and has not since been independently edited. A changed recipe-attribution signature SHALL invalidate suppression. Keep original and section collapse SHALL remain pure view state.

#### Scenario: Virtual substitution survives widget reopen
- **WHEN** a member swaps a replacement for a virtual plan line and later reopens the widget
- **THEN** boot re-hydration shows the replacement and continues to suppress the original from to-buy

#### Scenario: Undo preserves independently edited replacement
- **WHEN** a replacement created by a substitution is subsequently edited and the member undoes the substitution
- **THEN** the original returns but the edited replacement is not deleted

### Requirement: Pantry buy-anyway overrides coverage explicitly

The pantry freshness classifier SHALL use one shared category threshold table consumed by `read_to_buy`, the Grocery snapshot, and `read_pantry` stale filtering. A covered line SHALL carry `covered` or `worth_a_look`. Still good SHALL use the shared pantry-verify write. Buy anyway SHALL atomically materialize the canonical line as `source:"pantry_low"` and persist a coverage override so pantry subtraction does not immediately hide it; Undo SHALL clear the override and safely remove only an untouched row created by the decision.

#### Scenario: Still good refreshes all consumers
- **WHEN** a worth-a-look pantry line is marked Still good
- **THEN** its verification date updates and the shared classifier removes the stale nudge from grocery and pantry reads

#### Scenario: Buy anyway appears in to-buy
- **WHEN** a covered ingredient is promoted with Buy anyway
- **THEN** it appears in `to_buy` as a pantry-low explicit row despite the pantry entry

