# satellite-order-cart-fill Specification

## Purpose
TBD - created by archiving change satellite-order-cart-fill. Update Purpose after archive.
## Requirements
### Requirement: Order-fill is a direct, tenant-scoped request/response, not a pull-channel task

Satellite cart-fill SHALL be served by **two direct endpoints** under `/satellite/*` — a pull-list route (`POST /satellite/order/list`) and a receipt route (`POST /satellite/order/receipt`) — added alongside the existing claim/results routes, outside the `/admin*` Access gate, and authenticated by the **same ingest-key bearer** mechanism. It SHALL NOT be modeled as a pull-channel task: ordering is **human-directed** (a person drives the local UI), and a store cart write is a **non-idempotent side effect**, so there is no claim, lease, or `satellite_tasks` row for order-fill, and the pull channel SHALL remain sale-scan-only. Both order-fill endpoints SHALL require a **tenant-bound** ingest key; an operator-global (unbound) key SHALL be rejected, because an order-list is per-tenant working state and there is no operator-scope order-fill.

#### Scenario: Cart-fill is served by direct endpoints, not a claimed task

- **WHEN** a satellite fills a tenant's store cart
- **THEN** it requests the pull-list and posts the receipt over the two direct `/satellite/order/*` endpoints, and no `order-fill` task is ever enqueued on or claimed from the pull channel

#### Scenario: An operator-global key is rejected on both order endpoints

- **WHEN** an unbound (operator-global) ingest key calls `POST /satellite/order/list` or `POST /satellite/order/receipt`
- **THEN** the Worker rejects it, because order-fill is tenant-scope only

### Requirement: The pull-list returns the tenant's resolved to-buy list keyed by canonical ingredient id

`POST /satellite/order/list` SHALL return the caller-tenant's freshly-resolved to-buy list — the shared set algebra over the current `active` grocery list **∪ the meal plan's server-derived ingredient needs** minus pantry on-hand (the same derivation the to-buy read and `place_order` use, so every flush surface sees the same set) — with each item carrying its **canonical ingredient id** (`item_id`, equal to the `grocery_list` `normalized_name` key a derived line would materialize under), its display `name`, `quantity`, `for_recipes`, and `assumed_quantity`, together with the tenant's **primary store slug and location id** and an issued **`order_list_id`**. Planned recipes whose ingredient list is not yet derived SHALL be reported alongside so the human at the helper knows the list may be incomplete. It SHALL be served **only** when the tenant's primary store is satellite-fulfilled; a Kroger/Worker-native primary SHALL receive a structured error directing to `place_order`. The list SHALL NOT be resolved against store product availability — product matching is the satellite's browser job.

#### Scenario: The pull-list carries canonical ids and the primary store

- **WHEN** a satellite-fulfilled tenant's helper calls the pull-list
- **THEN** it receives `{ order_list_id, store, location_id, items: [{ item_id, name, quantity, for_recipes, assumed_quantity }], partials }`, with `item_id` the canonical ingredient id and `store`/`location_id` the tenant's primary

#### Scenario: Plan-derived needs ride the pull-list without materialized rows

- **WHEN** a satellite-fulfilled tenant has a planned recipe whose derived ingredients are not on the grocery list and not in the pantry
- **THEN** the pull-list includes those ingredients as items (canonical `item_id`, the recipe's slug in `for_recipes`), and a carted disposition for one advances it via the existing insert-on-missing in-cart keying

#### Scenario: A Kroger primary is refused the pull-list

- **WHEN** a tenant whose primary is Kroger calls the pull-list
- **THEN** the Worker returns a structured error directing to `place_order`, and mints no order-list

### Requirement: The receipt posts per-item cart-fill dispositions keyed to the issued canonical ids

`POST /satellite/order/receipt` SHALL accept `{ order_list_id, observations, mark_placed? }`, where each observation is an `order` member of the shared observation union carrying a canonical `item_id`, a `disposition` (`carted` | `substituted` | `unavailable`), and — for a carted or substituted line — the matched or substitute store `product` as a raw observation. The receipt SHALL carry only raw outcome facts; the Worker SHALL re-derive the `grocery_list` state itself, never trusting a state from the wire. The receipt route SHALL return the per-item intake results and the order-list's resulting status.

#### Scenario: A receipt carries raw dispositions, not derived state

- **WHEN** the local helper finishes filling a cart
- **THEN** it posts `{ order_list_id, observations: [{ kind: "order", item_id, disposition, product? }, ...] }`, and the Worker derives each line's `grocery_list` transition rather than accepting a status from the receipt

### Requirement: The receipt's write identity is the issued order-list, never the observation

The receipt intake SHALL take its authoritative identity from the **issued `order_lists` record** (Worker-created at pull-list time), never from the observation. The Worker SHALL record, per issued pull-list, the exact set of canonical ids it handed the tenant, and on receipt SHALL enforce, all together: an `order` observation is valid **only** with an order-list context (an `order` item on the push path or the pull-results path SHALL be rejected); a per-item `item_id` **not** in the issued set SHALL be rejected per-item; and the order-list SHALL belong to the caller's tenant or the whole receipt SHALL be masked as `404`. A receipt SHALL therefore be unable to invent an item, graft in another list's id, or redirect another tenant's list.

#### Scenario: An unissued item id is rejected, never advanced

- **WHEN** a receipt reports an `order` observation whose `item_id` is not in the referenced order-list's issued set
- **THEN** that item is rejected per-item and no grocery-list line is advanced for it

#### Scenario: A cross-tenant order-list reference is masked

- **WHEN** a tenant-bound key posts a receipt referencing an `order_list_id` owned by another tenant (or an unknown id)
- **THEN** the Worker returns `404` and advances nothing, never revealing that the order-list exists

#### Scenario: An order observation off the receipt endpoint is rejected

- **WHEN** an `order` observation arrives on `/admin/api/ingest` or `/satellite/results` (no order-list context)
- **THEN** the Worker rejects it, because order observations are valid only against an issued order-list on the receipt endpoint

### Requirement: Cart-fill advances carted lines to in_cart; mark-placed optionally advances to ordered

The receipt intake SHALL advance `carted` and `substituted` lines to **`in_cart`** using the same advancement the Kroger `place_order` flush uses (keyed by canonical id — the only auto-transition), and SHALL leave an `unavailable` line `active` to retry on the next order. On its **first landing** the intake SHALL persist the send-record snapshot alongside that advance (see `spend-telemetry`): one `order_sends` row whose id **equals the order-list id** (`store`/`location_id` from the issued order-list, `fulfillment: "satellite"`) and one line per carted/substituted observation carrying the observed product (`productId` as the pick, `size`, the single observed `product.price` as the effective `unit_price`; `regular`/`promo`/`on_sale`/`savings` NULL-unknown, `estimated: 0`), the `department` stamp via the shared `src/department.ts` grocery-line derivation (`household` overrides immediate, memoized categories, NULL while pending — see `spend-telemetry`), and `provenance: "planned"` (the pull-list is list ∪ plan by construction) — and SHALL stamp each advanced row's send linkage. Because the send id is deterministic and the writes are insert-or-ignore, a replayed receipt converges without double-recording. Snapshot persistence SHALL be honest-best-effort: its failure never rejects the receipt or blocks the advance. It SHALL NOT advance any line past `in_cart` automatically. An optional **mark-placed** signal — the local helper re-posting with `mark_placed: true` and no new observations, or the user's separate "I placed the order" assertion via `update_grocery_list` — SHALL advance the issued `in_cart` lines to `ordered` **through the shared purchase-assertion path, materializing each advanced line's snapshot as spend events** (verbatim, idempotent on `(send_id, line_key)`); unused, a line SHALL remain at `in_cart` and its snapshot never materializes. Re-applying a receipt or mark-placed SHALL converge (idempotent), never double-advance and never double-count spend.

#### Scenario: Carted lines advance to in_cart, unavailable stays active

- **WHEN** a receipt reports some lines `carted`/`substituted` and others `unavailable`
- **THEN** the carted and substituted lines advance to `in_cart` (same keying as `place_order`) with the order-list's send record persisted and their linkage stamped, and the unavailable lines remain `active` with no snapshot line

#### Scenario: Mark-placed advances the issued in_cart lines to ordered

- **WHEN** the helper posts `mark_placed: true` for a received order-list (or the user asserts "I placed the order")
- **THEN** the issued `in_cart` lines advance to `ordered` and their snapshot lines materialize as spend events; absent the signal they stay `in_cart` — awaiting mark-placed, never auto-counted — identical to an unconfirmed Kroger cart

#### Scenario: A replayed receipt neither double-advances nor double-records

- **WHEN** the satellite retries a receipt (or mark-placed) the Worker already landed
- **THEN** the advance converges, the deterministic send id makes the snapshot insert-or-ignore, and at most one spend event exists per `(send_id, line_key)`

#### Scenario: A snapshot failure never blocks the receipt

- **WHEN** persisting the send record fails during a receipt landing
- **THEN** the intake still advances the carted lines and responds normally — those lines simply carry no send linkage and will produce no spend events

### Requirement: The satellite fills the cart and stops at review; checkout stays with the human

The satellite SHALL fill the store cart and drive to the store's own **review page and stop** — it SHALL NEVER complete checkout. The human SHALL complete the purchase on the store's own page. Consequently the satellite SHALL never be the sole witness to a purchase, and a double-fill SHALL be human-visible and human-fixable at review, never a double-purchase. The Worker's receipt intake SHALL correspondingly advance only to the `in_cart` preparation state, never committing an order on the satellite's report alone.

#### Scenario: The satellite never checks out

- **WHEN** the satellite has filled the store cart
- **THEN** it drives to the store's review page and stops, leaving checkout for the human to complete in the store's own UI

#### Scenario: A double-fill is human-visible, never a double-purchase

- **WHEN** a cart is filled twice (a retry or a stale refresh)
- **THEN** the human sees the doubled cart at review and corrects it before checkout, and nothing has been purchased

### Requirement: The local helper UI is a localhost-bound inbound surface with standard local-app security

The interactive cart-fill surface SHALL be a small web UI on the satellite — the satellite's **first inbound listener**. It SHALL bind to loopback by default, MAY bind to the LAN only on an explicit opt-in, and SHALL NEVER be remote-reachable. It SHALL require a session token (printed at start, distinct from the tenant ingest key it holds) and SHALL protect state-changing requests against CSRF. It SHALL hold the store `storageState` session to drive the browser and SHALL NOT expose it. This inbound listener SHALL NOT weaken the Worker-facing outbound-only invariant: the Worker SHALL still never dial in to the satellite.

#### Scenario: The helper binds to loopback and requires a token

- **WHEN** the operator starts the local helper without an explicit LAN opt-in
- **THEN** it binds to loopback only, prints a session token the UI must present, and rejects an unauthenticated or cross-site state-changing request

#### Scenario: The Worker still never dials in

- **WHEN** the local helper is running
- **THEN** it calls the Worker outbound for the pull-list and the receipt, and the Worker opens no connection toward the satellite

### Requirement: The order-fill adapter is operator-authored, browser-only, with preview and a human checkpoint

Cart-fill SHALL be performed by an **operator/user-authored** `OrderAdapter` loaded from the mounted `adapters_dir` — there SHALL be **no built-in** order adapter (cart-fill is ToS-hostile, so the driver is the tenant's own). The adapter SHALL be **browser-only** (it drives a live authenticated store session) and SHALL emit only per-item `order` observations, validated locally before the receipt is posted. Reliability SHALL be re-established on the browser side: the adapter SHALL support a **preview** before carting and SHALL **checkpoint on ambiguity**, surfacing the decision to the human in the local UI.

#### Scenario: No built-in order adapter

- **WHEN** a satellite runs order-fill for a store
- **THEN** it loads the operator-authored adapter from the mounted `adapters_dir`; there is no shipped built-in

#### Scenario: Ambiguity is checkpointed to the human

- **WHEN** the adapter cannot unambiguously match a line to a store product
- **THEN** it surfaces the choice to the human in the local UI and proceeds only on their resolution, rather than guessing

### Requirement: The resolver is human-in-the-local-UI, the only backend

Product matching and substitution decisions SHALL be resolved by the **human in the local UI**, which SHALL be the **only** resolver backend in this capability. No LLM, prompt, or model SHALL be invoked on the cart-fill path — the capability SHALL be fully deterministic. A future capability MAY add an alternate resolver backend (a Worker-AI endpoint or a local model), but this capability SHALL NOT introduce one.

#### Scenario: Cart-fill invokes no model

- **WHEN** the satellite fills a cart and resolves substitutions
- **THEN** every decision is made by the human in the local UI, and no model is invoked on either the Worker or the satellite side

### Requirement: The satellite declares order-fill via config and provisions from existing surfaces

A satellite that runs order-fill SHALL declare it in config (an `[[order_stores]]` block mapping a store slug to its operator-authored adapter, parallel to `[[scan_stores]]`), and SHALL capture the store session out-of-band with the existing `login` verb (a headful browser producing the `storageState` keyed by store slug, reused unchanged — no per-tenant session keying, because the satellite belongs to one tenant). Provisioning SHALL require no new operator-admin surface: the satellite's auth SHALL be a **tenant-scoped ingest key** minted through the existing admin Mint dialog's tenant selector, and the store SHALL be registered in the existing shared store registry.

#### Scenario: A store is declared and its session captured

- **WHEN** the member configures `[[order_stores]]` for a store and runs `login <store>`
- **THEN** the satellite loads that store's adapter from `adapters_dir` and drives the store with the captured `storageState` session

#### Scenario: Provisioning reuses the tenant-scoped ingest key mint

- **WHEN** the operator provisions a member's cart-fill satellite
- **THEN** they mint a tenant-scoped ingest key from the existing admin Mint dialog and register the store, with no new admin surface required

