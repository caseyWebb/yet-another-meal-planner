# Proposal — satellite-order-cart-fill

## Why

The satellite initiative handles the stores the Worker has no API for. Change 3 (`satellite-sale-scan`) covered the **read** side of that long tail — observing sale prices at an API-less store — but the **write** side is still Kroger-only: `place_order` writes a Kroger cart through the Kroger API, and a tenant whose primary store is (say) Target has no order path at all. This change adds the counterpart: an optional, additive **cart-fill** for API-less stores, where a tenant-run satellite fills the store's cart in a real browser, driven interactively by the human through a small local web UI, and stops at the store's review page for the human to check out.

It is deliberately **additive, not a relocation**. Kroger's `place_order` (Worker → Kroger API cart write) stays exactly as it is; most tenants stay 100% Worker-native. The store-agnostic set algebra both paths already share — `computeToBuy` (`grocery_list ∪ menu-needs − pantry-has`, keyed by canonical ingredient id) — becomes the one place the canonical to-buy list is resolved, and a tenant's **primary store** picks the flush: Kroger → the Worker's `place_order`; an API-less store the tenant marks satellite-fulfilled → their own satellite's cart-fill helper.

The safety property is the whole point: the satellite **fills the cart and never checks out**. It drives to the store's own review page and stops; the human completes checkout on the store's own page. So the satellite is never the sole witness to a purchase, and a double-fill is a human-visible, human-fixable annoyance — never a double-*purchase*. This finally realizes the satellite capability's standing "irreversible actions stay human-gated against ground truth" requirement, which was written forward-looking for exactly this capability.

## What Changes

- **Two direct order-fill endpoints under `/satellite/*`.** A **pull-list** endpoint returns the tenant's freshly-resolved to-buy list (a `computeToBuy` preview + primary store/location), and a **receipt** endpoint accepts the cart-fill receipt. Both are tenant-ingest-key-authed and live outside the `/admin*` Access gate, reusing the exact bearer mechanism the claim/results routes use. They are **NOT** pull-channel tasks: ordering is human-directed, not Worker-directed, so there is no claim/lease/task — and no lease-idempotency concern for a non-idempotent cart write.
- **A new `order` observation kind.** Added to the shared `ObservationItem` discriminated union (`recipe | sale` today). It carries a **per-item disposition** (carted / substituted / unavailable, with the matched or substitute store product as a raw observation) **keyed to the canonical ingredient ids the pull-list carried**.
- **An `order_lists` D1 record + a task-scoped-authoritative receipt guard.** The pull-list records the exact set of canonical ids the Worker issued to that tenant; the receipt intake advances **only ids the Worker put in that order-list** — reusing the sale intake's "the write identity is the Worker's, never the observation's" discipline, so a receipt can neither invent items nor redirect another tenant's list.
- **grocery_list reconciliation reuses `advanceInCartRows`.** Carted (and substituted) lines advance to **`in_cart`** exactly as `place_order` does today — same helper, same canonical-id keying, same single auto-transition; an `unavailable` line stays `active` to retry next order. An optional **mark-placed → `ordered`** affordance is additive (a local-helper button and/or the user telling the agent, which `update_grocery_list` already supports).
- **A localhost-bound local helper UI on the satellite** — the satellite's **first inbound listener**. It is the interactive cart-fill surface: refresh/show the list, drive the browser to fill the cart, resolve substitutions/ambiguity with the human, review, hand off to the store's checkout page, and post the receipt. Standard local-app security (loopback/LAN bind scope, a token, CSRF, and it holds the store session). Its **visual design is routed through the companion Claude Design project** per the repo rules.
- **An operator-authored, browser-only `OrderAdapter` + SDK** — parallel to change 3's `SaleScanAdapter`, **no built-in** (cart-fill is ToS-hostile → the tenant's own driver, loaded from the mounted `adapters_dir`). Reliability is re-established on the browser side with a **preview** and a **checkpoint-on-ambiguity** surfaced to the human in the local UI.
- **Satellite config `[[order_stores]]` + a helper-launch CLI verb** — parallel to `[[scan_stores]]`; the existing `login` verb captures the store session (keyed by store slug, the model already in place).
- **Persona: a satellite cart-fill flush path.** The `shop-groceries` flow gains a branch — a satellite-fulfilled primary store directs the user to open their local helper — alongside the untouched Kroger-online and in-store-walk branches.

**Explicitly out of scope** (a later change): a Worker-AI or local-model resolver **backend** for product matching / substitution decisions — human-in-the-local-UI is the default and the only backend in this change, which keeps the whole path deterministic; admin observability over `order_lists`; the sensor-audit / source-quarantine arm; and any change whatsoever to Kroger's `place_order` (Worker → Kroger API cart write), which stays exactly as-is.

## Capabilities

### New Capabilities

- **`satellite-order-cart-fill`** — the end-to-end cart-fill for an API-less store: the two direct `/satellite/order/*` endpoints, the `order` observation intake with the issued-set-authoritative guard, the `grocery_list` reconciliation, the local helper UI and its security posture, the operator-authored browser-only `OrderAdapter`, and the fill-cart-never-checkout safety property.

### Modified Capabilities

- **`satellite`** — a **third** capability (`order-fill`) with a **third delivery mode** (direct request/response — neither push nor claim); `order` added to the observation union; the "irreversible actions stay human-gated" invariant realized by cart-fill.
- **`order-placement`** — the order lifecycle gains the satellite cart-fill flush (carted → `in_cart`; optional mark-placed → `ordered`), reusing the fulfillment-mode-agnostic `received` behavior. Kroger's `place_order` is unchanged.
- **`in-store-fulfillment`** — a store-slug primary MAY be marked **satellite-fulfilled**, selecting the cart-fill flush instead of the in-store walk.

## Impact

- **One D1 migration.** `migrations/d1/0038_satellite_order_lists.sql` (next available number) creates the `order_lists` issued-set record. Access goes through a new `src/order-lists-db.ts` → `src/db.ts` (throw-free). No backfill.
- **Shared contract.** The `order` observation kind in `packages/contract/src/ingest.ts` (the union) plus the two endpoint shapes in a new `packages/contract/src/satellite-order.ts`, exported from `index.ts`. `CAPABILITIES` (the push-batch enum) is untouched — order-fill carries no batch envelope.
- **Worker.** Two `/satellite/order/*` handlers (`src/satellite.ts`) reusing the ingest-key auth; the `order` intake arm (dispatch by `kind`) reusing `intakeObservations` with a new task-scoped-authoritative `orderList` option; the reconciliation reusing `advanceInCartRows`.
- **Satellite package.** The local helper server (first inbound listener), the `OrderAdapter` + SDK, the `[[order_stores]]` config, session reuse (`storageState` per store slug), and a helper-launch CLI verb.
- **Persona.** A satellite cart-fill flush path in `packages/worker/AGENT_INSTRUCTIONS.md` (the `grocery-cart` tier + the `shop-groceries` branch table), rebuilt into the plugin skills. **No new MCP tool** — `place_order` stays Kroger-only and the routing signal is already in the profile.
- **Admin.** None. Provisioning reuses change 2's tenant-scoped ingest-key **Mint** selector; no `/admin/**` change, so no Playwright work in this change.
- **Docs (lockstep).** `docs/SCHEMAS.md` (the `order` kind, `order_lists`, the two endpoint shapes), `docs/ARCHITECTURE.md` (the cart-fill path, the determinism boundary, the safety property, the first inbound listener), `docs/TOOLS.md` (confirm no MCP tool touched; `place_order` stays Kroger-only), `docs/SELF_HOSTING.md` (provisioning a member's satellite + capturing the store login).
- **Built-but-dormant (production spike, read-only via the Cloudflare D1 API).** `stores = 0`, `ingest_keys = 0`, `satellite_tasks = 0`, and every `grocery_list` row is `active` (no `in_cart`/`ordered` in production). No store is registered and no tenant satellite is provisioned, so the whole path is a clean no-op — exactly as sale-scan's producer no-ops on an empty `stores`. The capability is built; it activates when an operator registers an API-less store, a tenant marks it satellite-fulfilled, and the member provisions a satellite. The acceptance fixture (tasks §11) seeds a `target` store to exercise the loop end to end.
