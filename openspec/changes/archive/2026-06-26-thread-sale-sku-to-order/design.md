## Context

`place_order` (`src/order.ts` / `src/order-tools.ts`) resolves the to-buy set at order time. Each line normally runs through `deps.resolve(name)` — the abstracted `match_ingredient_to_kroger_sku` matcher — which picks a SKU on its own (cache + scoring + availability). The `overrides` param lets a caller force a specific SKU: in `placeOrder` the override branch (`order.ts:220-231`) short-circuits the matcher and builds a `ResolvedLine` straight from `ov.sku`, with **no price and no availability check**. That line flows to `cartAdd` (`PUT /v1/cart/add` with `{ upc, quantity }`) and to `commitSkuCache` (which upserts the SKU as the learned mapping).

The matcher's cache path already revalidates a known SKU before trusting it: `MatchDeps.productById(productId)` does "one targeted lookup for current price and curbside/delivery availability" (`matching.ts:399-405`) — fetch fresh, check `isFulfillable`, return with fresh price. The override branch has no equivalent.

Two persona working-notes ("Sale-based substitutions" / "grocery-sale-check") flagged that sale information has no demonstrated flow-through to the placed order. The seam (`overrides`) exists; what's missing is (a) revalidation parity and (b) honest contract framing.

## Goals / Non-Goals

**Goals:**
- A sale-verified SKU passed via `place_order(overrides)` lands in the cart as that exact SKU, **after** a freshness check — not blindly.
- An override SKU that has gone unavailable since verification is surfaced in the existing `checkpoint` batch instead of being silently carted.
- The resolved line carries **fresh** `price`/`on_sale` so the agent can see at `preview` whether the deal still holds.
- The contract (tool description + `docs/TOOLS.md`) states plainly that `overrides` pins the SKU, **not** the price, and that the promo realizes on Kroger's side at fulfillment off a possibly-stale flyer.
- The persona threads the verified `sku` through `place_order(overrides)`.

**Non-Goals:**
- Locking or guaranteeing a *price* — the Kroger cart API carries no price; this is a hard external limit, stated honestly, not engineered around.
- Changing the matcher (`match_ingredient_to_kroger_sku`) itself, the SKU-cache schema, or any D1 migration.
- Adding a new tool or a new cart-write path. `place_order` stays the only cart writer.
- Portion math or quantity inference for overrides (unchanged; `assumed_quantity` semantics stay as-is).

## Decisions

### 1. Revalidate override SKUs via the existing `productById` primitive — reuse, don't reinvent

The override branch will recheck each `ov.sku` through a new `deps.revalidateSku(sku)` dependency on `PlaceOrderDeps`. `order-tools.ts` implements it from the **same** Kroger user client + `getLocationId` the matcher already uses, wrapping `productById` + `isFulfillable`:
- **fulfillable** → resolve with the **fresh** candidate's `price` and `on_sale` (not the caller-supplied/stale values; overrides don't even carry a price today).
- **not fulfillable / `null`** → emit a `checkpoint` line of `kind: "unavailable"` (the existing shape), so it is **not** added to the cart.

*Alternative considered — route overrides through `deps.resolve` with a "pin this SKU" flag.* Rejected: `resolve` runs the full matcher (search, scoring, tiebreak) and could still return `ambiguous`, defeating the point of an override. A direct single-SKU revalidation is narrower and matches intent.

*Alternative considered — keep blind-trust, doc-only.* Rejected by the explore decision: a deal locked off an hours-stale flyer could be carted after going unavailable, with no checkpoint — exactly the staleness hole the issue raises.

### 2. `overrides` pins the SKU, not the price

The cart write sends only `{ upc, quantity }`; there is no price field anywhere in `PUT /v1/cart/add`. The contract will say so explicitly. Revalidation returns the *current* price/on_sale as an honest signal, but the realized promo is Kroger's call at fulfillment, against a flyer the system already documents as possibly hours-stale. The agent surfaces this; the tool never claims a locked price.

### 3. Reframe `overrides` as the general force-a-SKU seam (disposition **or** deal-lock)

Per CLAUDE.md's tool/skill boundary, the tool description owns *what* `overrides` does and its guarantees; the persona owns *when*. The description and `docs/TOOLS.md` change from "disposition previously-ambiguous items" to "force a specific SKU into the cart — to disposition an ambiguous/unavailable item **or** to lock a SKU you verified (e.g. an on-sale one); the forced SKU is revalidated for availability and returns fresh price/on_sale, and an unavailable one is checkpointed; this pins the SKU, not the price."

### 4. The dispositioning use case is unaffected by revalidation

Revalidation only re-checkpoints on genuine *unavailability* — never re-asks for ambiguity (the override skips matching). A freshly-dispositioned item won't loop unless it actually went unavailable, in which case `cartAdd` would have failed anyway. So adding revalidation strictly improves both use cases.

## Risks / Trade-offs

- **Extra latency: one `productById` lookup per overridden line** (the branch does zero I/O today) → Bounded by the Kroger client's existing concurrency cap, same as the matcher's per-line resolve; overrides are typically a small subset of the order.
- **A still-listed SKU whose promo has lapsed** (on_sale flipped false between verify and order) → Revalidation returns fresh `on_sale: false`; the agent can surface "the deal lapsed" at `preview`. The line is still carted (it's available and the user chose it) — we do **not** auto-drop it, consistent with the no-auto-decide rule.
- **Kroger doesn't honor the flyer price at fulfillment** → Out of our control; explicitly documented as a SKU-not-price guarantee so the persona never over-promises.
- **Contract drift** → `docs/TOOLS.md`, the `place_order` description string, and `AGENT_INSTRUCTIONS.md` must change in the same pass (CLAUDE.md lockstep rule); `aubr build:plugin` regenerates `plugin/`.
