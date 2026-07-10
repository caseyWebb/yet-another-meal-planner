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
- **Offline** (new concept, small): stores yamp can't connect to, kept "so the planner
  remembers you shop there", optionally carrying a member-edited **aisle map** (ordered
  aisles + typical items per aisle, preset aisle names). This is a member UI over the
  existing store notes `layout` that `in-store-fulfillment` already specs for the
  agent-guided walk — same data, new editor (map-modal) + "community-mapped" copy implies
  aisle maps are shareable across households for the same store (dedup/memoize mentality;
  needs the story-01 lens decision).

## 2. Fulfillment paths over the adapters

- **Online order** — the Order Review flow (pages/05 §order). Kroger today; Instacart
  later. Ends at "sent to cart, you check out" (never completes purchase).
- **Store walk** — the member-facing walk (pages/05 §walk). List reframed in store-route
  order (departments sorted by aisle), check-off as you go, ends in "Log a manual shop"
  semantics (checked → purchased → spend events, story 03). The agent-guided voice walk
  (`in-store-fulfillment`) remains; the member UI is the self-serve equivalent. The mock
  leaves everything past "Start walk" undefined — the walk-session spec (persistence,
  resume, completion) is the main design work here.
- **Satellite cart-fill** — launcher entry per satellite store; the helper runs on the
  member's LAN and stops at the review page (pages/12 §cart-fill).
- **Log a manual shop** — the no-adapter fallback: checked items become a purchase event.

## 3. Alignment rules

- One place decides which launcher entries appear: configured adapters + their state
  (linked, session-fresh, mapped). The grocery footer split-button is a projection of the
  Preferences store card.
- Department/aisle grouping data (`placement`) comes from the active store's knowledge:
  Kroger aisle data, satellite sale-scan observations, or the offline aisle map. "Not
  mapped" is an honest state, never a guess.
- Spend telemetry (story 03) records the fulfillment path + store on every purchase.

## 4. Open questions

1. Instacart integration feasibility/scope (API availability, auth model, cart handoff) —
   needs a spike before proposal; the mockup only fixes the UX contract.
2. Offline aisle-map sharing: per-household only, or pooled per real-world store
   ("community-mapped") — and if pooled, keyed how (store name+ZIP)?
3. Walk sessions: persisted state (survive app restarts mid-shop), multi-member
   concurrent walks (household shops split), and whether finishing a walk auto-verifies
   pantry additions.
4. Preferred-store changes mid-list: re-derive placements/prices immediately or on next
   order preview?
5. Does "Offline" absorb today's `list_stores`/`add_store` store notes surface entirely,
   or coexist with it?
