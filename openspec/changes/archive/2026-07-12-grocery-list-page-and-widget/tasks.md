## 1. Data model and versioned contracts

- [x] 1.1 Add a D1 migration for `grocery_list.checked_at`, `row_version`, `updated_at`, and decision ownership, `order_sends.placed_at`/placement claims, and tenant-scoped substitution and pantry-coverage decision tables with operation/ownership claims; add migration tests proving old rows read as unchecked and old sends remain unplaced.
- [x] 1.2 Extend grocery/session/send database shapes and `docs/SCHEMAS.md` with the new nullable/default fields, immutable send-history rule, decision records, and placement-vs-analytics terminology.
- [x] 1.3 Add independently versioned `GroceryListData` and `GroceryModelContext` contracts (including row/send/snapshot freshness and supported floor/ceiling helpers) to `@yamp/contract`, with parser/version-gate tests.

## 2. Shared grocery algebra and snapshot

- [x] 2.1 Refactor the shared to-buy operation to compute shopping, checked, and unchecked-to-buy partitions under `(active list UNION plan needs) MINUS pantry MINUS substitution suppressions`; cover virtual, both-origin, checked, in-flight, household, and plan-removal fixtures.
- [x] 2.2 Implement stable recipe attribution/order and presentation placement section/aisle sort keys for Department and Recipe grouping, including Household, Not mapped, and No recipe fallbacks; add pure selector tests.
- [x] 2.3 Move pantry freshness thresholds to one shared internal classifier used by to-buy and grocery snapshots while retaining `read_pantry(stale_only)` as structured unsupported; cover category tiers and verification convergence.
- [x] 2.4 Implement `readGrocerySnapshot` with grouped current sends, immutable persisted quote totals/savings, unlinked-in-cart degradation, header counts, underived data, canonical serialization, and opaque `snapshot_version`; test endpoint/tool parity and digest changes for every source class.

## 3. Checked, pantry, and substitution operations

- [x] 3.1 Implement the narrow canonical-key checked operation with row-version compare/merge, identical-state idempotence, conflict snapshots, and atomic virtual materialize-and-check; add D1/API/tool tests including duplicate offline delivery.
- [x] 3.2 Thread `checked_at` through `read_grocery_list`, `read_to_buy`, `update_grocery_list` documentation/shapes and every order/satellite consumer, and increment `row_version`/`updated_at` on every grocery-row mutation, so checked rows remain visible but cannot enter a cart and stale guards see all intervening edits.
- [x] 3.3 Implement persistent substitution accept/undo with attribution-signature invalidation, atomic creation ownership, and compare-and-swap Undo; retain taste-capture behavior and cover virtual/explicit, racing ordinary-add, edited-replacement, and stale-Undo cases.
- [x] 3.4 Implement Buy-anyway/Undo coverage decisions with atomic creation ownership and compare-and-swap Undo, bind Still good to pantry verification, return full post-write snapshots, and preserve ordinary or independently edited rows.
- [x] 3.5 Register checked, pantry-decision, substitution, and send-line-relist operations as class-(b) member mutations with plain JSON variables, serial optimistic offline replay, structured conflict replacement, and settled raw/snapshot query reconciliation.

## 4. Exact in-cart send lifecycle

- [x] 4.1 Implement nullable-linkage Back to list with row-version/linkage guards for exact current open-send `order_send_lines` membership and rows projected outside it (absent, dangling, placed, or open-send-without-line linkage), quantity retention, immutable snapshot retention, no-spend guarantees, and idempotent offline replay tests.
- [x] 4.2 Implement atomic `mark_grocery_send_placed` membership validation, exact batch `in_cart → ordered`, `placed_at`, and D16 writer invocation; cover mismatch all-or-nothing, cross-tenant/send rejection, failed claim, zero-line rejection, completed replay outcomes, and no re-pricing.
- [x] 4.3 Add member API and app-callable MCP adapters for relist and mark-placed, keep mark-placed out of the offline mutation allowlist, and retain documented compatibility for per-row `update_grocery_list` assertions.

## 5. Shared Grocery UI and member page

- [x] 5.1 Build the plumbing-agnostic Grocery controller/component and `GroceryHostAdapter` in `@yamp/ui`, including pending/conflict state, full-snapshot replacement, Department/Recipe selectors, confirmation/Undo state, and action capability gates.
- [x] 5.2 Implement the approved local layout: compact stats, active/checked list, household/underived states, grouped and aging in-cart sends between list and pantry, persisted quote/savings labels, pantry coverage, and substitution confirmations using existing shared UI primitives.
- [x] 5.3 Replace the `_app.grocery.tsx` monolith with the page shell plus member adapter; remove Category/Aisle and checkbox-to-`in_cart` behavior while preserving add/remove, recipe links, launcher, empty/error/loading, and accessibility states.
- [x] 5.4 Extend member component/browser coverage for deterministic grouping, virtual check, offline/reload replay, pantry actions, substitution/Undo, two send groups, independent cart/list/send/cache result honesty, exact mark-placed conflicts, linked and unlinked relist, aging, household, and unknown states; capture/review changed screenshots and run `aubr test:app`.

## 6. MCP Grocery widget

- [x] 6.1 Add `display_grocery_list` and app-callable boot/mutation tools over the shared operations, returning structured errors, widget metadata, versioned data, and equivalent plain text; update MCP/tool registration tests.
- [x] 6.2 Add the self-contained `ui://grocery/list` build/resource entry with the widget marker and CSP constraints, and verify it is served by `resources/read` without a Worker route or `run_worker_first` entry.
- [x] 6.3 Implement the MCP host adapter with frozen first paint, contract/capability gates, D19 boot re-hydration, server-tool writes, immediate full `ui/update-model-context` carrying each operation's actual outcome, mark-placed-only completion messaging with that same outcome, sendMessage delegation, and read-only degradation.
- [x] 6.4 Add fixture-driven MCP adapter/widget tests for every action classification and exact returned outcome, completed mark-placed replay messaging, conflict/`isError` silence, cached-payload rehydrate, unknown-newer version, capability ladder, no credentials, plain-text parity, and self-contained bundle output.

## 7. Tool, architecture, and persona lockstep

- [x] 7.1 Update `docs/TOOLS.md` for `read_grocery_list`, checked-aware `read_to_buy`, checked/decision/relist/mark-placed writes, `display_grocery_list`, D18/D19 behavior, and pre-send-vs-persisted quote wording.
- [x] 7.2 Update `docs/ARCHITECTURE.md` for the canonical grocery snapshot, shared controller/host adapters, D1 decision/send truth, aggregate digest, and MCP resource path.
- [x] 7.3 Update `AGENT_INSTRUCTIONS.md` and authored grocery persona/skill guidance so display requests use `display_grocery_list`, checked never means `in_cart`, send-wide placement prefers the batch assertion, and send quotes are never called final prices; rebuild rather than hand-edit generated plugin output.

## 8. Final verification

- [x] 8.1 Run targeted Worker, contract, shared-controller, member-adapter, offline replay, MCP widget/resource, and migration tests; fix all failures.
- [x] 8.2 Run `aubr typecheck`, `aubr test`, `aubr test:app`, and `aubr build:plugin --check`; document any credentialed/live suites not run.
- [x] 8.3 Validate `grocery-list-page-and-widget` with OpenSpec and verify the implementation changes only this grocery-first Band 3 scope, leaving order-review and store-walk follow-ups unimplemented.
