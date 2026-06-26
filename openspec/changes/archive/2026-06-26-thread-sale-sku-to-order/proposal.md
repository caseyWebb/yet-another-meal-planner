## Why

When the agent verifies a genuine deal on a specific Kroger SKU (`kroger_prices` returns each product's `sku`), there is no documented, safe path for that exact SKU to survive into the placed cart. `place_order` resolves each line through the abstracted `match_ingredient_to_kroger_sku` matcher, which picks a SKU on its own — so "buy trout because it's the real deal at SKU X" can silently become a different SKU. The `overrides` param *does* bypass the matcher and carry an exact SKU end-to-end, but it is documented only for dispositioning ambiguous/unavailable items, and — unlike the matcher's cache path — it blindly trusts the supplied SKU with no availability/price revalidation. A deal locked off a possibly-hours-stale flyer can therefore be carted even after it has gone unavailable, with no checkpoint.

## What Changes

- **Revalidate forced SKUs in `place_order`.** The `overrides` branch will recheck each supplied SKU for current curbside/delivery availability and fresh price — the same one-shot revalidation the matcher's cache path already performs via `productById` — instead of trusting it blindly. Available → resolve with **fresh** `price`/`on_sale`; unavailable → route to the existing `checkpoint` batch rather than blind-carting.
- **Reframe the `overrides` contract.** `overrides` is documented as the general "force a specific SKU into the cart" seam — for dispositioning **or** locking a verified deal — and states plainly that it pins the **SKU, not the price**: the Kroger cart API (`PUT /v1/cart/add`) carries only `{ upc, quantity }`, so the promo realizes (or not) entirely on Kroger's side at fulfillment, against a flyer that may be hours-stale.
- **Thread the verified SKU through the persona.** The "Sale-based substitutions" guidance in `AGENT_INSTRUCTIONS.md` is extended so that after verifying a deal the agent passes the verified `sku` through `place_order(overrides)` — closing the loop the two working notes flagged.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `order-placement`: `place_order`'s override handling gains SKU revalidation (available → fresh price/on_sale; unavailable → checkpoint), and the contract reframes `overrides` as the force-a-SKU seam that pins the SKU but not the price.

> The matcher's `productById` revalidation primitive (`ingredient-matching`) is **reused** but not changed — that reuse is a design detail, not a requirement change, so `ingredient-matching` gets no delta spec.

## Impact

- **Code:** `src/order.ts` (override branch + a new `revalidateSku` dep on `PlaceOrderDeps`), `src/order-tools.ts` (wire `revalidateSku` from the same Kroger user client + `getLocationId` the matcher uses). No new tool surface; reuses the existing `checkpoint` batching.
- **Docs:** `docs/TOOLS.md` `place_order` section + the tool's `description` string, in lockstep (per CLAUDE.md the tool description owns *what overrides does* and its guarantees).
- **Persona:** `AGENT_INSTRUCTIONS.md` "Sale-based substitutions" callouts (both the meal-plan and semantic-meal-plan flows), then regenerated via `aubr build:plugin`.
- **Tests:** `test/` unit coverage for the override-revalidation branch (available / unavailable / lapsed-promo).
- **No data-model/D1 change**, no migration. The SKU-cache upsert behavior is unchanged — an override still teaches the cache.
