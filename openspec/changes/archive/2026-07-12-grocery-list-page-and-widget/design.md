## Context

The current member grocery route is a single component that joins `useGrocery()` and an enriched `useToBuy()`, implements Category/Aisle grouping and substitution staging locally, and treats the row checkbox as an `active → in_cart` write. That last behavior is the collision D28 closes: `in_cart` belongs only to a store cart, while in-store handling is a nullable `checked_at`. Plan-derived needs are virtual, so a check must also create the canonical row that owns the mark. D16 send tables and per-row purchase materialization already exist, but the page discards send grouping and loops single-row writes for “Mark order placed.”

The dual-use precedent is `contract → @yamp/ui controller/component → member adapter | MCP adapter`. D18 requires MCP interactions to write through the bridge, then immediately publish a full model-context snapshot; D19 treats spawning structured content as first paint only, requires boot re-hydration before writes, and requires stale-write protection. The local visual brief is product-specs design request #8: the in-cart section sits between the active list and pantry coverage, groups concurrent sends, and uses a completion-oriented batch action plus per-line relist. The user has approved drafting that layout locally for this change.

This design is grounded in page 05 §§1/4/5, story 06 §§2–3, D15/D16/D18/D19/D28, the landed spend snapshot schema, and the current shared grocery/read operations. “Department” below is store placement presentation, never D17’s analytics department.

## Goals / Non-Goals

**Goals:**

- Make check/uncheck an offline-safe, canonical-row operation for explicit and virtual lines without changing `status`.
- Give every host the same authoritative, versioned Grocery snapshot and the same component/controller behavior.
- Render deterministic Department/Recipe groupings, household items, pantry decisions, substitutions, and grouped online sends truthfully.
- Make one send-wide mark-placed operation atomic, idempotent, exact, and the sole page path to D16 purchase materialization.
- Satisfy D18/D19 with boot re-hydration, per-row merge guards, aggregate snapshot freshness, full model context, and contract-version degradation.
- Leave implementation sequenced grocery-first so Band 3 siblings can extend the shared contracts serially.

**Non-Goals:**

- The order-review redesign, brand decisions, broader/manual Kroger search, impulse-line capture, Instacart, offline-store adapter, and active store-walk session are separate Band 3 changes.
- This change does not implement manual-shop/walk completion; it only preserves checked rows for that future shared shop-commit operation.
- It does not guarantee checkout prices. Pre-send values are current quotes/hints and persisted send values are send-time quotes, not receipts.
- It does not introduce a Worker HTTP route for `ui://grocery/list`, a widget credential, a server walk session, or analytics derived from placement sections.

## Decisions

### 1. One canonical Grocery snapshot is the read contract

Add a shared `readGrocerySnapshot(env, tenant, { enrich: true })` operation used by `GET /api/grocery/view`, the `display_grocery_list` spawning tool, and the widget boot read. Its versioned `GroceryListData` contains:

- `contract_version`, `snapshot_version`, and `as_of`;
- `lines`, the union-minus-pantry shopping view including both unchecked and checked lines, with canonical `key`, `row_version`, `checked_at`, `origin`, kind/domain, quantity/note, stable recipe attribution, placement section/aisle, substitutions, and pantry-decision state;
- `to_buy`, derived as the keys in `lines` whose `checked_at` is null and which are not suppressed by a substitution decision;
- `pantry_covered`, with server-derived freshness tier and supported actions;
- `in_cart_groups`, grouped by `sent_in`, with store/location/fulfillment/send time, age state, persisted line snapshots and totals, current row membership, and mark-placed eligibility;
- `underived`, `location`, `flyer_as_of`, and header counts.

`read_to_buy` remains the lean shop-time contract and gains `checked` plus `snapshot_version`; its `to_buy` is the same unchecked set. `read_grocery_list` remains the raw stored-row read and gains row concurrency/check fields. This avoids forcing every non-UI consumer to ingest the widget shape while preserving one underlying algebra.

`snapshot_version` is an opaque SHA-256 digest of the canonical serialized authoritative snapshot inputs (row versions/checks, plan needs, pantry coverage/verification, substitution decisions, and send membership/metadata), not a client-meaningful counter. It detects staleness across all source tables without requiring every plan and pantry writer to increment a cross-feature counter. A mutation supplies the snapshot version it rendered; the Worker either applies a safe row merge or returns `conflict` with a fresh snapshot. Every successful mutation returns a freshly read full snapshot.

Alternative rejected: a tenant grocery revision table incremented by triggers across grocery, plan, pantry, and send tables. It is fast but couples unrelated migrations and is easy to miss when another writer changes a source table. The digest is bounded by the already-materialized grocery read and cannot drift from its contents.

### 2. Checked is a row field; virtual check is an atomic materialize-and-set

Migrate `grocery_list` with `checked_at TEXT NULL`, `row_version INTEGER NOT NULL DEFAULT 1`, and `updated_at TEXT`. Add a shared `setGroceryChecked({ key, checked, expected_row_version, snapshot_version, occurred_at })` operation. It addresses a canonical key, not a display name.

For an explicit/both line, the operation conditionally updates only `checked_at`, `row_version`, and `updated_at`. Every other grocery-row mutation also increments `row_version` and `updated_at`, so a check guard observes intervening quantity/note/status edits. For an origin-plan virtual line, `checked=true` atomically upserts a `source:'menu'` row under the canonical key with its display, derived `for_recipes`, kind/domain and quantity provenance, then stamps `checked_at`. `checked=false` on a virtual line with no row is an idempotent no-op. Repeated delivery of the same desired boolean succeeds; a stale request that already matches current checked state merges as success, while a stale request that would reverse a newer value returns `conflict` and does not overwrite it. Other row fields are never replaced by this narrow operation.

The set algebra becomes:

`shopping = (active stored rows UNION server-derived plan needs) MINUS pantry-covered MINUS active substitution suppressions`

`to_buy = shopping WHERE checked_at IS NULL`

`checked = shopping WHERE checked_at IS NOT NULL`

The Grocery component renders `shopping`, so a checked row stays visible with strike-through and contributes to “N of M checked”; order preview/readers use `to_buy`, so it cannot be carted. Uncheck returns it immediately. `place_order` and satellite flushes continue to advance only `to_buy`; they neither clear nor consume unrelated checked rows. Only the future manual-shop/walk shop-commit sweep receives/removes checked rows.

Alternative rejected: keep virtual check state only in IndexedDB. It would diverge across members/devices and violate D18/D19 re-hydration. Treating checked as `in_cart` is rejected by D28.

### 3. Persistent substitution decisions keep boot re-hydration honest

The current route’s staged exclude is host-local and cannot survive D19 boot. Add `grocery_substitution_decisions` keyed by `(tenant, original_key)` with `replacement_key`, the original recipe-attribution signature, `created_at`, `updated_at`, and `row_version`. The shared accept operation atomically upserts/materializes the replacement row and the decision; it removes an explicit original row only when appropriate, while the decision suppresses a virtual original from the shopping algebra. Undo removes the decision and removes the replacement only when that operation created it and it has not since been independently edited; otherwise it leaves the explicit row and reports that outcome.

“Keep original” and popover collapse are pure view state and intentionally produce neither a backend write nor model context. “Swap in” and Undo are persistent mutations and follow the full D18 path. This is preferable to overloading `checked_at` (which would falsely count the original as purchased) or changing the existing taste-capture-only meaning of `add_to_grocery_list.substitutes_for`.

### 4. Department and Recipe are deterministic projections

The shared controller offers exactly `Department | Recipe`; Category/Aisle is removed. Both modes consume server-provided sort keys so member and widget hosts cannot drift.

- **Department:** food lines group by `placement.section` (the existing placement `department` is renamed/aliased additively in contracts to avoid D17 confusion). Groups sort by minimum parseable numeric aisle, then normalized section label, then stable key. Lines sort by aisle number/side, display label, key. Household/non-grocery lines group under `Household`; missing placement sorts last under `Not mapped`. No analytics department is consulted.
- **Recipe:** `for_recipes` is ordered by planned meal date, meal-plan row id, then slug. A line appears once under its first attribution; remaining recipes render as `+N`. Lines with no attribution group under `No recipe`; groups sort by the same stable plan order and `No recipe` last. Group counts count unique lines.

The default is Department because route order is the primary shopping use. The member host may remember the toggle locally; it is pure view state and is neither model context nor server state.

### 5. The local layout contract follows approved design request #8

The page shell owns only the title/launcher. The shared Grocery component renders, in order: compact header stats; Department/Recipe control; active/checked groups; add row; underived notice; collapsible **In your {store} cart** groups; **Pantry covers these — still good?**; and inline pantry-look-alike confirmations. When two sends coexist, each is its own nested group ordered oldest first.

Each send header shows store, send date, item count, persisted estimated total, and persisted flyer savings only when positive. A send older than 72 hours uses the quiet “Awaiting confirmation” nudge from the brief; it never escalates or auto-materializes spend. Lines are read-only name/quantity with per-line **Back to list**. The group’s primary **Mark order placed** is completion-weighted. Unlinked manual `in_cart` rows render in an “In cart — no send record” group with relist only and no price/savings or batch assertion.

Header tiles are `To buy`, `Checked`, and `In carts`; persisted total/savings appear only for actual unplaced send groups and are labeled “sent estimate.” Before a send, optional flyer hints remain line-level and the UI never manufactures an “estimated total” from them. This distinguishes a live pre-send quote from D16’s persisted send snapshot and still states that send prices are quotes, not final fulfillment prices.

Household rows remain first-class, grouped Household and excluded from recipe attribution/pantry actions. The header’s recipe count counts distinct attributed recipes; underived recipes are called out separately.

### 6. Pantry freshness and decisions are server-derived

Move the category staleness/“worth a look” thresholds out of the route constants into one pure Worker/shared table used by `read_to_buy`, pantry reads, and the Grocery snapshot. `read_pantry(stale_only)` keeps its public stance but delegates classification to the same helper. Each covered line carries `freshness: covered | worth_a_look` and the reason/date.

**Still good** calls `mark_pantry_verified`, re-reads, and mirrors the full snapshot. **Buy anyway** atomically materializes the canonical row as `source:'pantry_low'` with a note that it overrode coverage and records a buy-anyway decision so that pantry subtraction does not immediately hide it; Undo removes that decision/materialization under the same edited-row safety rule as substitution. Pure section collapse is local-only.

### 7. Mark placed is one exact send operation; relist remains per line

Add `mark_grocery_send_placed(send_id, expected_line_keys, snapshot_version)`. In one D1 transaction/batch it verifies the send belongs to the tenant, is not already placed, and that the sorted expected keys equal all rows currently `in_cart` with `sent_in=send_id`. A mismatch returns `conflict` plus a fresh snapshot and performs no partial advance. On success it advances exactly that set to `ordered`, stamps `ordered_at`, invokes the existing D16 writer for every linked line, and stamps `order_sends.placed_at`. Replaying a completed send returns its stored completed result without advancing rows again. A send with zero current rows is not newly assertable.

Add `relist_grocery_send_line(send_id, line_key, expected_row_version)`. It conditionally performs `in_cart → active`, clears `sent_in`, writes no spend, and leaves the historical send snapshot immutable. It cannot operate across a different send. Relisting an already ordered line is not exposed from this section; the existing shared ordered-row relist/void behavior remains available elsewhere.

The existing `update_grocery_list(status:'ordered')` stays compatible for agents and satellites, but `AGENT_INSTRUCTIONS.md` changes the whole-order choreography to prefer the exact batch operation when a send id is available. `docs/TOOLS.md` distinguishes the batch assertion from per-row transition compatibility.

Alternative rejected: loop `update_grocery_list` from the UI. A mid-loop failure yields partial purchase assertions and makes grouped-send metadata dishonest.

### 8. One component/controller, two thin host adapters

`@yamp/ui` gains a plumbing-agnostic `GroceryList`, reducer/controller, group selectors, and a `GroceryHostAdapter` interface. The controller owns optimistic pending state, conflict replacement, confirmation/Undo state, pure grouping, and action availability; it receives data and returns intentions, never imports TanStack Query, Hono, or ext-apps.

- The member adapter maps reads to TanStack Query. Checked/add/remove, pantry verification/Buy anyway, substitution accept/undo, and send-line relist are idempotent canonical-keyed class-(b) operations with registered offline replay; **Mark order placed** is the non-queueable purchase assertion and stays online-only. The route is a page shell around the shared component.
- The MCP adapter freezes the spawning `initialResult` for first paint, checks `contract_version`, probes host capabilities, calls the app-callable snapshot read at boot, and enables controls only after successful re-hydration. Every successful persistent action uses `App.callServerTool`, consumes the returned authoritative snapshot, and immediately sends that entire `GroceryModelContext` through `ui/update-model-context`; check/add/remove/pantry/swap/relist produce no model turn, while **Mark order placed** additionally sends one `ui/message`. No client debounce or event delta is used.
- Capability degradation is `serverTools + updateModelContext` → interactive; `sendMessage` only → explicit delegation message for the requested action; neither, failed boot read, or unknown-newer contract → read-only first-paint/text fallback. No data payload contains credentials.

The context includes all active/checked lines, pantry-covered decisions, grouped sends and placed/relisted outcome, underived recipes, `snapshot_version`, and an action summary, so the model never receives a lossy row delta.

### 9. Contract and serving details

Add independently versioned `KNOWN_GROCERY_CONTRACT_VERSION = 1` and `GroceryListData`/`GroceryModelContext` in `@yamp/contract`; unknown-newer payloads are read-only, absent/older supported versions follow an explicit floor. Additive fields stay within v1; semantic removals/renames bump the contract.

`display_grocery_list()` returns `_meta.ui.resourceUri: 'ui://grocery/list'`, `structuredContent: GroceryListData`, and equivalent plain text. The MCP resource is served through `resources/read`, asserts the widget marker, and uses the self-contained bundle/CSP pattern; it requires no `run_worker_first` entry. The app-callable read and mutation tools return structured errors rather than throwing; resolved `isError` never triggers a context update or completion message.

### 10. Documentation, persona, and tests are part of the change

Update `docs/SCHEMAS.md` for `checked_at`, row/snapshot versions, decision/send fields, and `GroceryListData`; `docs/TOOLS.md` for `read_to_buy`, `read_grocery_list`, `update_grocery_list`, batch/relist tools, and `display_grocery_list`; `docs/ARCHITECTURE.md` for the shared component/host bridge and truth sources. Update `AGENT_INSTRUCTIONS.md` and its authored grocery skill/persona source so “show the list” chooses `display_grocery_list`, checked is never described as `in_cart`, whole-send placement prefers the batch assertion, and send estimates are never called final prices. Rebuild generated plugin output only through its build script; do not hand-edit it.

Tests cover algebra and conflict cases at the pure/Worker layer; migration and D1 send assertions; endpoint/tool parity; shared controller/group snapshots once; thin member-adapter/offline replay and MCP bridge/rehydration/version gates; app Playwright screenshots/interaction; and self-contained widget serving. Because this changes the member app, run `aubr test:app`, plus targeted Worker/widget/contract tests, typecheck, and plugin build.

## Risks / Trade-offs

- **[Digest cost on every mutation]** → Hash only the bounded canonical snapshot already loaded for response; measure and keep the widget read pageless because household grocery lists are small.
- **[Offline uncheck conflicts with another member’s later check]** → Merge identical desired state, reject opposing stale state with the current snapshot, surface the conflict, and never silently overwrite.
- **[Virtual materialization changes provenance]** → Preserve `source:'menu'`, stable canonical key, recipe attribution, and assumed quantity in the atomic operation; tests cover plan removal and re-add.
- **[Decision rows can outlive a changed plan]** → Key suppression to the canonical original plus recipe-attribution signature; an attribution change invalidates the decision and exposes the line again.
- **[Historical send lines differ from current row membership]** → Keep snapshots immutable, derive group membership from current `sent_in`, and require exact expected keys for mark-placed.
- **[Adjacent Band 3 changes touch the same grocery contracts]** → Land this grocery-first foundation before order review/walk; siblings extend rather than fork the snapshot/controller and implement serially on shared files.
- **[Local design lacks external design-project review]** → Treat design request #8 as the approved brief, encode the layout as tests/screenshots, and keep styling within existing shared UI primitives.

## Migration Plan

1. Add D1 columns/tables/indexes (`checked_at`, row version/timestamps, substitution/buy-anyway decisions, `order_sends.placed_at`) with null/default-compatible reads. Deploy Worker support before any new client bundle.
2. Land pure algebra, versioned snapshot, checked/swap/pantry/batch operations, and compatibility adapters; old clients continue to see unchecked rows and use per-row status writes.
3. Land `@yamp/contract`, shared controller/component, member adapter/page shell, and tests. Register only checked writes for offline replay.
4. Land MCP tool/resource/widget adapter, persona/docs, build artifacts, and contract harness.
5. Verify existing rows read as unchecked, existing sends group correctly, raw/unlinked `in_cart` rows degrade honestly, and no spend event appears before an assertion.

Rollback disables new UI/tool exposure first. The added nullable/default fields and decision tables can remain inert; old code ignores them. Do not drop them in the rollback deployment, because queued checked writes may still replay. A later cleanup migration may remove them only after the client/plugin deprecation window.

## Open Questions

None. Grouping defaults, virtual check lifecycle, substitution persistence, snapshot honesty, in-cart placement, conflict behavior, and host protocols are decided above so implementation does not need to invent product semantics.
