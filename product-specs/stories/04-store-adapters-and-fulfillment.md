# Story 04 — Store adapters and fulfillment modes

The Preferences "Store" card (pages/09) presents one adapter picker — **Kroger /
Instacart / Satellites / Offline** — and the grocery surfaces present three fulfillment
paths: **online order** (review → send to cart), **store walk** (in person), and
**satellite cart-fill** (home-node fills a cart you drive). Today only Kroger-online and
the agent-side walk/satellite paths exist. This story aligns the adapter model so the
grocery page, order review, and preferences stay one coherent system.

## 1. The adapter model

An adapter = how yamp interacts with a store. Per-household configuration; each adapter
carries its own connection state and preferred store/retailer.

- **Kroger** (exists): OAuth link, preferred store picked by ZIP search (mock adds a
  picker modal with distance — the locations API exists). Connect/disconnect and
  last-synced meta move into member UI (Preferences + Account tabs both show state).
- **Instacart** (new): account link, preferred retailer by ZIP (delivery-ETA metadata),
  "40+ retailers, no satellite required". Entirely new integration — treat as its own
  change; the UI contract is what the mockup fixes. The grocery order launcher gets an
  "Order with Instacart" retailer-picker entry.
- **Satellites** (exists, agent/operator-side): per-store cart-fill via home node
  (`satellite-order-cart-fill`). Preferences shows a read-only summary (session fresh /
  scanning / re-run login) linking to the Satellites tab (pages/12); the grocery order
  launcher lists satellite stores, disabled with "re-run login" when the session is
  expired.
- **Offline** (**decided, D6: a rename, not a new entity**): the existing generic
  non-Kroger stores surface (`list_stores`/`add_store`/store notes) presented as an
  adapter tab — "stores yamp can't connect to, kept so the planner remembers you shop
  there", optionally carrying the **aisle map** (the store notes `layout` that
  `in-store-fulfillment` already specs for the agent-guided walk; the map-modal is its
  member editor). "Community-mapped" copy implies aisle maps are shareable across
  households for the same real-world store (dedup/memoize mentality; needs the story-01
  lens decision).

## 2. Fulfillment paths over the adapters

- **Online order** — the Order Review flow (pages/05 §order). Kroger today; Instacart
  later. Ends at "sent to cart, you check out" (never completes purchase).
- **Store walk** — the member-facing walk (pages/05 §walk). List reframed in store-route
  order (departments sorted by aisle), check-off as you go, ends in "Log a manual shop"
  semantics (checked → purchased → spend events, story 03). The agent-guided voice walk
  (`in-store-fulfillment`) remains; the member UI is the self-serve equivalent. The
  contract (D28): check-offs write the per-row `checked_at` (class (b) idempotent
  upserts, offline-queued); walk mode itself is pure client state (no server session
  entity); completion = the one shared idempotent shop-commit op (receive + pantry
  restock with verification + D16 spend events at completion), exposed at /api and to
  the agent voice walk. The walk MUST function with zero connectivity (D15): check-offs
  and completion are queued writes keyed by the client-minted session id, replayed on
  reconnect; starting a walk needs no server round-trip.
- **Satellite cart-fill** — launcher entry per satellite store; the helper runs on the
  member's LAN and stops at the review page (pages/12 §cart-fill).
- **Log a manual shop** — the no-adapter fallback: checked items become a purchase event.

## 3. Alignment rules

- One place decides which launcher entries appear: configured adapters + their state
  (linked, session-fresh, mapped). The grocery footer split-button is a projection of the
  Preferences store card.
- Department/aisle grouping data (`placement`) comes from the active store's knowledge:
  Kroger aisle data, satellite sale-scan observations, or the offline aisle map. "Not
  mapped" is an honest state, never a guess. Placement `{aisle, department}` is
  presentation-only — never the analytics dimension (D17).
- Spend telemetry rides story 03 §1's op-anchored contract: fulfillment path + store
  provenance come from the shared op's context, not per-surface wiring (D16).
- Instacart launcher entry: one-click to the standing preferred retailer, with a
  secondary "choose another retailer…" per-trip override that never rewrites the
  preference (the in-store-fulfillment one-trip rule). Pages 05/09 spec the same
  control.
- Satellites (D22): the cart-fill helper URL and session token never leave the satellite
  host; the launcher's disabled state keys off the satellite-reported per-store
  session-freshness observation.

## 4. Open questions

1. Instacart integration feasibility/scope (API availability, auth model, cart handoff) —
   needs a spike before proposal; the mockup only fixes the UX contract.
2. ~~Offline aisle-map sharing: per-household only, or pooled per real-world store?~~ —
   decided: aisle maps pool per shared `stores` registry slug; the map editor edits
   `layout` store notes on the shared row ("community-mapped" = existing shared-notes
   behavior with member UI; same cross-household posture as sku_cache/flyer — store
   facts are public-derived; household-private nicknames stay per-household).
3. ~~Walk sessions: persisted state, multi-member concurrent walks, and whether
   finishing a walk auto-verifies pantry additions.~~ — decided (D28): no server session
   entity; client-held walk state; cross-device/member resume from the D1 `checked_at`
   rows; concurrent split-shop walks converge as row upserts; completion auto-verifies
   pantry via the restock write's mark_pantry_verified semantics.
4. Preferred-store changes mid-list: re-derive placements/prices immediately or on next
   order preview?
5. ~~Offline vs existing stores surface~~ — decided (D6): Offline IS that surface,
   renamed.
