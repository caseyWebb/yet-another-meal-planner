# Design — satellite-order-cart-fill

## Context

The satellite is the off-cloud arm for stores the Worker has no API for. Recipe-scrape (change 1) **pushes** observations; sale-scan (change 3) **claims** operator-scope work over the pull channel (change 2) and reports `sale` observations. Both are Worker-directed, autonomous, and idempotent — a task can run twice and converge (recipe URL dedup, sale rollup REPLACE). Cart-fill is none of those: it is **human-directed** (a person sits at the local UI and drives it), and its effect (a store cart write) is a **non-idempotent side effect**. So it does not fit the pull channel's fire-and-forget, at-least-once, lease-expirable queue — it needs a direct request/response shape, and it needs a human as the commit gate.

The store-agnostic half of ordering already exists. `computeToBuy` (`packages/worker/src/order.ts`) is pure set algebra over `grocery_list ∪ menu-needs − pantry-has`, keyed by the canonical ingredient id (`resolve(name)` → the `grocery_list` PK `normalized_name`); it references nothing Kroger. `place_order`'s only Kroger-specific steps are the SKU match (`match_ingredient_to_kroger_sku`) and the cart write (`PUT /v1/cart/add`). For an API-less store there is no Worker-side SKU match — the *satellite* does product matching in the browser, human-resolved. So the division is clean: **the Worker resolves *what to buy* (set algebra); the satellite resolves *which product* (browser + human)**.

**Production spike (read-only, via the Cloudflare D1 query API; `CLOUDFLARE_API_TOKEN` present):**
- `SELECT COUNT(*) FROM stores` → **0** — no store registered; the Kroger path is the only live fulfillment.
- `SELECT ... FROM ingest_keys` → **0 rows** — no satellite key minted (bound or unbound), so no tenant satellite exists yet.
- `SELECT ... FROM satellite_tasks` → **0 rows** — the pull channel has never carried a task.
- `SELECT status, COUNT(*) FROM grocery_list GROUP BY status` → **20 rows, all `active`** — no `in_cart` and no `ordered` in production, confirming `active` is the resting state and both advanced states are latent today.

So this capability, like sale-scan's producer, is **built dormant**: with no store and no satellite provisioned, the pull-list has no satellite-fulfilled tenant to serve and no order-fill endpoint is ever hit. It activates only when an operator registers an API-less store, a tenant marks it satellite-fulfilled, and the member provisions a satellite. The acceptance fixture seeds a `target` store to drive the whole loop after deploy.

## Goals / Non-goals

**Goals.**
- An optional, additive cart-fill path for an API-less primary store, sharing `computeToBuy` with the Kroger path.
- A tenant-run satellite fills the store's cart interactively and **stops at review** — never checkout.
- The Worker re-derives `grocery_list` state from a raw receipt; a receipt can only advance ids the Worker issued to that tenant.
- Fully deterministic (no LLM, no model) — the human in the local UI is the resolver.

**Non-goals.**
- Any change to Kroger's `place_order` (Worker → Kroger API cart write) — it stays byte-for-byte.
- A Worker-AI or local-model resolver backend — human-in-the-UI is the only backend here (a later change may add one).
- Checkout/purchase automation — the human always completes the buy in the store's own UI.
- Admin observability over `order_lists`, and any per-tenant session keying (the satellite belongs to one tenant, so the operator-scoped `storageState` session model keyed by store slug is already correct).
- Turning order-fill into a pull-channel task kind (the changes-1/2 roadmap note speculated this; Decision 1 supersedes it).

## Decision 1 — order-fill is a direct request/response, not a pull-channel task

The changes-1/2 roadmap notes reserved `order-fill` as a future **pull-channel task kind** (tenant-scope). This change **supersedes that note**: order-fill is a pair of **direct `/satellite/*` endpoints**, not a task. The reasons are structural, not cosmetic:

- **Human-directed, not Worker-directed.** There is no autonomous plan the Worker enqueues; a person opens the local UI when they want to shop and clicks Refresh. A queue whose whole point is Worker-decided work has nothing to schedule here.
- **Non-idempotent side effect.** The pull channel is safe precisely because a double-run converges (arrival dedup); a store cart write does not. The task queue's lease-expiry/at-least-once model would risk a double-fill on a dropped lease — the exact failure the direct request/response avoids (no lease → no lease-idempotency concern).
- **`place_order`'s discipline is per-invocation.** Single-shot ordering discipline (advance only after a successful write; unresolved lines stay `active`) lives inside one call, a semantics the double-run queue cannot provide. Cart-fill wants the same per-invocation discipline.

The pull channel (`/satellite/tasks/claim`, `/satellite/results`) stays **sale-scan-only**; `satellite_tasks` gains no `order-fill` kind.

## Decision 2 — the two endpoints (pull-list, receipt) + tenant-key auth

Two new POST endpoints, both under `/satellite/*` (outside `/admin*`, so the Cloudflare Access gate never applies), both authed by the **same ingest-key bearer** mechanism the claim/results routes use (`authKey` → `lookupIngestKey` + rate limit). Both are called **outbound** by the satellite's local UI (the UI is a Worker client and a localhost server to the human — see Decision 7).

```
POST /satellite/order/list      {}                                    → { order_list_id, store, location_id,
                                                                          items: [{ item_id, name, quantity,
                                                                                    for_recipes, assumed_quantity }],
                                                                          partials: [{ name, for_recipes }] }
POST /satellite/order/receipt   { order_list_id, observations: OrderObservation[], mark_placed? } → { order_list: {id, status}, results: ItemResult[] }
```

**Tenant scoping (the tenant-scope analog of `keyCanAccessTask`).** Both endpoints require a **tenant-bound** key. An operator-global key (`tenant IS NULL`) is rejected — an order-list is per-tenant working state, so there is no operator-scope order-fill. The `list` endpoint serves the caller's own tenant; the `receipt` endpoint additionally verifies the referenced `order_lists` row belongs to the caller's tenant, masking a foreign or unknown id as `404` (never revealing another tenant's order-list exists), exactly as `handleSatelliteResults` masks a cross-tenant task.

**`list` behavior.** Resolve the tenant's `computeToBuy` over the current `active` grocery list (`∪` nothing `−` pantry-has), map each `to_buy` item to its canonical id via the injected `ingredientContext.resolve`, look up the tenant's **primary store slug + location id** (from `preferences.stores`), and **mint an `order_lists` row** recording `{ id, tenant, store, location_id, item_ids }`. It is served **only** when the tenant's primary is satellite-fulfilled — i.e. `preferences.stores.fulfillment === "satellite"` (Decision 10); a Kroger (Worker-native) primary, or a non-Kroger primary without the satellite marker (a plain walk store), gets a structured error directing to `place_order` (Kroger) or the in-store walk. A POST (not GET) because it mutates state (it records the issued set). The list is *not* resolved against store availability — that is the satellite's browser job.

**`receipt` behavior.** Look up the order-list, build the authoritative context, run the observations through the shared intake, and reconcile `grocery_list` (Decisions 4–5).

Both handlers catch D1 failures into a structured `503 storage_error` and return structured errors, never throw (the tools/handlers discipline).

## Decision 3 — the order observation kind (per-item disposition, canonical-id keyed)

`order` is the third member of the shared `ObservationItem` discriminated union (`recipe | sale | order`), authored in the house style (a `const orderFields = {…} as const` spread into a bare item schema and a `kind`-tagged observation schema, a `parseOrderObservation` helper, and exports from `index.ts`). Sketch:

```ts
const orderFields = {
  /** The canonical ingredient id the pull-list carried (the authoritative key; === grocery_list.normalized_name). */
  item_id: z.string().trim().min(1),
  /** What happened to this line in the cart. Raw outcome, not a derived state. */
  disposition: z.enum(["carted", "substituted", "unavailable"]),
  /** The store product carted or substituted in — raw provenance, absent when unavailable. */
  product: z.object({
    productId: z.string().trim().min(1),
    description: z.string().trim().min(1),
    size: z.string().optional(),
    price: z.number().nonnegative().optional(),
    url: z.string().refine(isHttpUrl, { message: "url must be a public http(s) URL" }).optional(),
  }).optional(),
  note: z.string().optional(),
} as const;

export const OrderObservationSchema = z.object({ kind: z.literal("order"), ...orderFields });
```

**Sensor-not-judge.** The observation carries the *raw outcome* of what happened in the cart (which line, carted/substituted/unavailable, which store product) and provenance (the product, its price/url for spot-checkability). It carries **no derived grocery-list state** — the Worker derives the `in_cart` transition itself (Decision 5), just as the Worker re-derives on-sale/savings from a `sale`'s raw `regular`/`promo`. `order` observations travel over the order-receipt endpoint only — not the `capability`-tagged push batch (so `CAPABILITIES` is untouched) and not the pull-results — mirroring how `sale` is a union member delivered over the pull channel, not the push path.

## Decision 4 — the order_lists record + the task-scoped-authoritative receipt guard

The sale intake's integrity rule is: **the write identity is the claimed task's, never the observation's.** Order-fill has no task, so its authoritative record is the **issued order-list** — a Worker-created row naming exactly which canonical ids the Worker handed this tenant.

```sql
-- migrations/d1/0038_satellite_order_lists.sql — the issued to-buy set for a satellite cart-fill.
-- The pull-list mints one row per Refresh; the receipt references it by id. The item_ids column is the
-- AUTHORITATIVE set the receipt is validated against — a receipt can only advance ids the Worker issued.
CREATE TABLE order_lists (
  id           TEXT PRIMARY KEY,               -- opaque order-list id (the receipt correlation key)
  tenant       TEXT NOT NULL,                  -- the issuing tenant (from the ingest key's binding)
  store        TEXT NOT NULL,                  -- primary store slug at issue time
  location_id  TEXT,                           -- store location id (may be NULL)
  item_ids     TEXT NOT NULL,                  -- JSON array of canonical ingredient ids issued (authoritative)
  status       TEXT NOT NULL DEFAULT 'issued', -- 'issued' | 'received'
  created_at   INTEGER NOT NULL,               -- epoch ms
  received_at  INTEGER                         -- epoch ms a receipt was applied; NULL until then
);
CREATE INDEX order_lists_tenant ON order_lists (tenant, created_at);
```

The receipt handler passes `{ id, tenant, store, locationId, itemIds }` into the shared `intakeObservations` as a new task-scoped-authoritative option (`options.orderList`), the direct analog of `options.saleTask`. The `order` arm then enforces, all together:

1. **Order-receipt-only.** An `order` observation is valid ONLY with an `orderList` context. The push path and the pull-results path pass no `orderList`, so an `order` item is **rejected** there — the mirror of "a `sale` on the push path is rejected."
2. **Issued-set membership.** A per-item `item_id` **not** in `order_lists.item_ids` is **rejected per-item** (a receipt cannot invent an item or graft in another list's id) — the mirror of "a `sale` whose store/location disagree with the task is rejected."
3. **Tenant isolation.** The order-list is loaded by id and its `tenant` must equal the key's binding, or the whole receipt is `404` — a receipt cannot redirect to another tenant's list.
4. **Idempotent application.** Advancement is naturally idempotent (setting `in_cart` again is a no-op via the `(tenant, normalized_name)` upsert); `received_at`/`status='received'` record the first application for audit, and a re-post converges rather than double-acting.

`order_lists` is accessed only through `src/order-lists-db.ts` → `src/db.ts`.

**Pruning stale issued rows.** An `order_lists` row is minted on every Refresh but only reaches `status='received'` if a receipt is posted; a member who Refreshes and abandons the fill leaves an `issued` row forever. To keep the table bounded, a `pruneStaleOrderLists(env, olderThan)` helper (`order-lists-db.ts`) `DELETE`s `status='issued' AND created_at < ?cutoff` — the direct analog of `pruneTerminalTasks` (`satellite-tasks-db.ts`, which reaps terminal `satellite_tasks` rows on the sale-scan-plan tick) and `pruneIngestPushes`/`pruneDiscoveryLog` (the discovery sweep). It is wired into the existing `scheduled()` handler as a small prune step in the same phase as `runSaleScanPlanJob`, with a conservative retention (an issued-but-never-received list is stale after ~7 days). `received` rows are retained as the audit trail; only orphaned `issued` rows are reaped.

## Decision 5 — grocery_list reconciliation (carted → in_cart; optional mark-placed → ordered)

`grocery_list` and its lifecycle are **reused unchanged** — no schema change. (The `grocery_list.status` *column* persists only `active | in_cart | ordered`; the lifecycle's terminal `received` **removes** the row and restocks the pantry rather than storing a fourth status — order-placement spec — and is unrelated to `order_lists.status`'s own `issued | received`, Decision 4.) The reconciliation mirrors `place_order` exactly:

- **`carted` and `substituted` → `in_cart`,** via the same `advanceInCartRows(env, tenant, lines, today)` helper `place_order` calls, keyed by canonical id (a substitute still satisfies the canonical ingredient, so it advances). This is the only auto-transition, exactly as today.
- **`unavailable` → stays `active`,** to retry on the next order — the mirror of `place_order` leaving an unresolved line `active`.
- **Optional mark-placed → `ordered`.** Because the satellite stops at the store's review page, the state at receipt time is `in_cart`, not `ordered`. Advancing to `ordered` means "the human checked out," which happens *after* review — so it is a separate, optional, additive signal. Two equivalent paths, no new required state machine:
  - the user tells the agent "I placed the order" → `update_grocery_list` (which already accepts `ordered`); or
  - the local helper's optional **mark-placed** button re-posts to `/satellite/order/receipt` with `mark_placed: true` and no new observations; the handler advances the order-list's issued `in_cart` rows to `ordered` (a small `advanceOrderedRows` helper). Unused, the line simply sits at `in_cart`, identical to a Kroger cart the user never confirmed.

## Decision 6 — cart-fill never checkout (the safety property)

The satellite fills the cart, drives to the store's **review page, and stops.** The human checks out on the store's own page. Two consequences make this the safety property, not just a convenience:

- **The satellite is never the sole witness to a purchase.** A purchase exists only if the human clicked "place order" in the store's own UI — an at-most-once commit the human performs and sees.
- **A double-fill is human-visible and human-fixable, never a double-purchase.** If the satellite fills twice (a retry, a stale Refresh), the human sees a doubled cart at review and fixes it before checkout; nothing has been bought. The human's checkout is the at-most-once gate.

This realizes the satellite capability's standing **"irreversible actions stay human-gated against ground truth"** requirement, which was authored forward-looking for exactly "an order capability that fills a cart but never completes checkout." The Worker's receipt intake correspondingly advances only to `in_cart` (a preparation state), never past it automatically.

## Decision 7 — the local helper UI + its security posture

The interactive cart-fill surface is a small web UI **on the satellite** — the satellite's **first inbound listener** (it is strictly outbound-only today: grep finds no `listen`/server anywhere, the Dockerfile `EXPOSE`s nothing, and `run --watch` only dials out). This does **not** violate the outbound-only invariant: that invariant is about the **Worker never dialing in** to the satellite (so a home box behind NAT needs no inbound port for the *Worker*). A **human ↔ localhost** server is a different thing — but it is a new surface that needs standard local-app security.

**Responsibilities.** Refresh (call `/satellite/order/list`, show the to-buy list + store/location); fill-cart (drive the `OrderAdapter` over the store browser session to add each item, with a **preview** and a **checkpoint-on-ambiguity** surfaced to the human); resolve substitutions/ambiguity (the human decides — the only resolver backend, Decision 9); review (drive to the store's review page and stop); checkout handoff (hand the human the store's own page); post the receipt (`/satellite/order/receipt`); optional mark-placed.

**Security posture (new surface — standard local-app hardening):**
- **Bind scope.** Loopback (`127.0.0.1`) by default; LAN binding only on an explicit opt-in. **Never remote-reachable** — no port-forward, no `0.0.0.0` default.
- **A token.** The helper prints a session token at start; the UI must present it. This is a human↔localhost auth, distinct from the tenant **ingest key** (which the helper holds to call the Worker outbound).
- **CSRF.** State-changing POSTs (fill, receipt, mark-placed) carry a CSRF token — the UI drives the store session, so a drive-by page must not be able to trigger a fill.
- **It holds the store session.** The helper reads the store's `storageState` to drive the browser, so it must not expose it; loopback bind + token + CSRF keep the session in-process.

## Decision 8 — the OrderAdapter + SDK + `[[order_stores]]` + CLI (satellite side)

Parallel to change 3's `SaleScanAdapter`/`ScanSdk`/`loadSaleAdapters`, with **no built-in** (cart-fill is ToS-hostile → the tenant's own driver from the mounted `adapters_dir`). Browser-only — cart-fill needs a live authenticated store session, so there is no plain-HTTP tier here. Sketch:

```ts
export interface OrderSdk {
  store: OrderStoreConfig;            // the [[order_stores]] entry this drives
  config: SatelliteConfig;
  session: StorageState | null;       // the store's captured storageState (keyed by store slug)
  page: Page;                         // a live Playwright page bound to the store session
  log: Logger;
  /** Surface an ambiguity to the human in the local UI and await their resolution (the only resolver). */
  checkpoint(prompt: CheckpointPrompt): Promise<CheckpointResolution>;
}
export interface OrderAdapter {
  id: string;
  /** Fill the store cart for the issued lines; return per-item order observations (or a structured error). */
  fill(sdk: OrderSdk, lines: OrderLine[]): Promise<OrderObservation[] | { error: string }>;
}
export type OrderAdapterFactory = (sdk: OrderSdk) => OrderAdapter;
export async function loadOrderAdapters(config): Promise<Record<string, OrderAdapterFactory>>; // NO built-ins
```

**Config `[[order_stores]]`** parallels `[[scan_stores]]` (`parseOrderStore`, `order_stores?: OrderStoreConfig[]`, dedup on slug, set only when non-empty):

```toml
[[order_stores]]
store   = "target"    # store slug; matches the primary-store mapping AND the session id
adapter = "target"    # the operator module in adapters_dir (browser-only; no fetch_tier — always browser)
```

**Session** reuses the existing `storageState` model keyed by store slug (`sessionPath(configDir, slug)`), captured out-of-band by the existing **`login <store>`** verb (headful Chromium → `context.storageState()`). Because the whole satellite belongs to one tenant, the operator-scoped session model needs **no per-tenant keying**.

**CLI.** A new verb launches the localhost helper (e.g. `grocery-satellite order [--host 127.0.0.1] [--port]`) — the first verb that opens a port. `login <store>` already covers session capture. The `test` verb MAY gain an order dry-run (fetch a pull-list, preview a fill, report nothing) mirroring the sale-scan `test` extension.

## Decision 9 — the resolver is human-in-the-UI (the only backend)

Product matching and substitution decisions are resolved by the **human in the local UI** — they are already sitting there driving the fill. This is the **default and the only backend in this change**. A future change *could* add a coarse Worker-AI resolve endpoint or a local model as an alternate backend, but this change does **not** build one. Keeping the resolver human-only means the whole cart-fill path is **deterministic**: no inference, no prompt, no model selection on either the Worker or the satellite side. The adapter's `checkpoint()` is the human hand-off; there is no automated matcher to be wrong.

## Decision 10 — how the agent points the user to the helper (no new tool)

**No new MCP tool.** The agent detects a satellite-fulfilled primary from the profile it already reads at the start of `shop-groceries` (`read_user_profile()`) — specifically the `preferences.stores.fulfillment === "satellite"` marker — and tells the user to open their local helper. Justification, weighed against the `kroger_login_url` precedent:

- `kroger_login_url` exists because the **Worker mints Worker-side state** — an OAuth consent nonce/URL. There is a real server-side action behind it.
- The satellite helper has **nothing for the Worker to mint**: the helper URL is a localhost address on the tenant's own machine (the Worker cannot know it), the human↔localhost auth is the local token (satellite-side), and the "instructions" are static prose. A Worker tool would be a static-string wrapper with no Worker-side substance.
- The one dynamic routing bit — is this primary satellite-fulfilled? — is expressed by the tenant's **`preferences.stores.fulfillment` marker**, a *new reserved preference value* set through the **existing** `update_preferences` tool (the `stores` map already accepts arbitrary string entries, so this needs no schema, tool, or migration change), read from the profile the flow already loads. So the **persona owns "when → tell the user to open their helper,"** and no tool surface is added.

Consequences: `place_order` stays Kroger-only (Decision, unchanged), the MCP tool surface is unchanged (`docs/TOOLS.md` confirms "no tool touched"), and the behavior lives in the `in-store-fulfillment` mode requirement (the spec that already mandates "SHALL NOT assume Kroger") plus the persona.

## Decision 11 — provisioning

Provisioning reuses existing surfaces; **no new admin surface** is needed:
- **The satellite's auth** is a **tenant-scoped ingest key** minted by the operator via change 2's admin **Mint** dialog (which already carries the tenant selector). A tenant-bound key is exactly what the two order endpoints require (Decision 2). Confirmed sufficient.
- **The store** is registered in the shared `stores` registry (`add_store`), and the tenant sets it primary + marks it satellite-fulfilled via the existing `update_preferences` tool — `update_preferences({ stores: { primary: "<slug>", fulfillment: "satellite" } })`. `fulfillment` is a **new reserved value** in the already-open `stores` string map, so it needs no schema, tool, or migration change; absent it, a non-Kroger primary stays a plain walk store.
- **The store login** is captured by the member running `grocery-satellite login <store>` (headful, out-of-band), producing the `storageState` the helper drives.
- The member declares `[[order_stores]]` and runs the helper verb.

## Model identity

**No model id appears anywhere in this change.** Cart-fill is entirely deterministic: the satellite adapter drives a browser (no inference), the human in the local UI resolves every ambiguity (no matcher, no prompt), and the Worker does deterministic re-derivation (issued-set membership, `advanceInCartRows`). There is no LLM call, no prompt, and no model selection on this path — so there is no model identifier to hardcode, log, or gate on, and none is introduced. (The agent's *conversational* use of the resulting `in_cart` state is the LLM's reasoning, unchanged and unmodeled here.)

## Should this be one change or split?

The natural seam is **Worker-side** (the two endpoints + the `order` observation kind + `order_lists` + the reconciliation + the intake guard — dormant with no consumer, exactly like sale-scan's producer) vs **satellite-side** (the local UI + `OrderAdapter` + session + CLI + config, which carries the async Claude Design UI dependency and the first-inbound-listener security surface).

**Recommendation: keep it one change, implemented Worker-side-first as a hard internal phase boundary.** Rationale:
- **Precedent + operator preference.** Change 3 (sale-scan) was a single change spanning a Worker producer and a satellite adapter; the operator prefers coherent single changes.
- **The safety argument is one story.** Fill-cart-never-checkout, the human as the at-most-once gate, and the Worker's advance-only-to-`in_cart` intake are a single end-to-end property. Splitting them across two changes scatters the argument a reviewer must hold at once.
- **The phase boundary *is* the latent split.** The Worker side is dormant with no consumer (the pull-list serves nobody until a satellite exists), so if the Claude Design round-trip stalls, the Worker phase can land, deploy, and be verified against the seeded `target` fixture independently — the split's optionality without fragmenting the spec/review. Tasks are therefore ordered Worker-first (contract → D1 → endpoints → intake), then satellite (adapter → design → UI → CLI), so the Worker contract freezes before the helper builds against it.

## Claude Design dependency

The local helper UI's **visual design routes through the companion Claude Design project** (per `CLAUDE.md` and `src/admin/CLAUDE.md`) — this proposal describes **what** the UI does (Decision 7), not its markup. Tasks §7 calls out drafting the Claude Design prompt (the architect writes it), running it in that project, and taking its exported bundle as the basis for the local-UI implementation. If that project is unreachable from the implementation environment, the task is deferred with an explicit `*(Not performed — …)*` note (mirroring change 2's tenant-selector deferral) and the helper is built in the plainest defensible idiom, flagged for a design pass. Note this UI is a **satellite-package** surface, not `/admin/**`, so it does **not** fall under the admin Playwright gate; its review artifact is the Claude Design bundle plus a manual walkthrough, not the `admin-ui` screenshot job.

## Risks

- **A new inbound listener on the satellite.** The first port the satellite opens is real attack surface. *Mitigated by:* loopback-default bind, a required session token, CSRF on state-changing POSTs, and the outbound-only invariant staying intact for the Worker (it still never dials in). The listener is human↔localhost only.
- **Operator-authored adapter brittleness.** A store's DOM changes and a no-built-in adapter breaks silently. *Mitigated by:* the browser-side preview + checkpoint surfacing ambiguity to the human before anything is carted, and cart-fill never committing — a broken fill wastes time, never money.
- **A stale pull-list.** The grocery list changes between Refresh and receipt. *Mitigated by:* the issued-set guard advancing only ids that were issued *and* are still `active`; a dropped/added item simply isn't advanced, and the human re-Refreshes. Idempotent application means a re-post converges.
- **Speculative surface with zero users today.** Like the pull channel and sale-scan's producer, this ships dormant. *Mitigated by:* the Worker side is small and independently useful/testable, the satellite side mirrors the proven sale-scan adapter template, and the acceptance fixture exercises the full loop after deploy.
- **Mode-routing ambiguity.** A store-slug primary means "walk" today; satellite-fulfilled reuses a store slug. *Mitigated by:* an explicit per-tenant `preferences.stores.fulfillment = "satellite"` marker (Decision 11) — a *new reserved value* in the already-open `stores` string map (no schema/tool/migration change), written via the existing `update_preferences`. Walk stays the default (absent marker), so no existing tenant's behavior changes.
