## 1. Override revalidation (code)

- [ ] 1.1 Add a `revalidateSku(sku: string)` dependency to `PlaceOrderDeps` in `src/order.ts` returning the same confident/unavailable shape the override branch needs (fresh `price`/`on_sale`/`brand`/`size` when fulfillable; an unavailable signal otherwise).
- [ ] 1.2 In `placeOrder`'s override branch (`src/order.ts:220-231`), call `deps.revalidateSku(ov.sku)` instead of building the `ResolvedLine` blindly: fulfillable → `ResolvedLine` with the **fresh** price/on_sale; not fulfillable → push a `checkpoint` line of `kind: "unavailable"`.
- [ ] 1.3 Confirm an override-resolved line still flows into `commitSkuCache` (SKU-cache upsert) and `cartAdd` exactly as a matcher-resolved line does.
- [ ] 1.4 Wire `revalidateSku` in `src/order-tools.ts` from the same Kroger user client + `getLocationId` the matcher uses, wrapping the existing `productById` + `isFulfillable` primitives.

## 2. Contract docs (lockstep)

- [ ] 2.1 Update the `place_order` tool `description` string in `src/order-tools.ts`: reframe `overrides` as force-a-SKU (disposition **or** lock a verified deal), note revalidation + unavailable-checkpoint, and state it pins the SKU **not** the price.
- [ ] 2.2 Update `docs/TOOLS.md` `place_order` section (the resolution/checkpoint paragraph and the `overrides` param line) to match 2.1.

## 3. Persona

- [ ] 3.1 Extend the "Sale-based substitutions" callouts in `AGENT_INSTRUCTIONS.md` (both the meal-plan and semantic-meal-plan flows) so that after verifying a deal the agent threads the verified `sku` through `place_order(overrides)`.
- [ ] 3.2 Regenerate the plugin bundle: `aubr build:plugin` (requires `$GROCERY_MCP_URL`); do not hand-edit `plugin/`.

## 4. Tests & verification

- [ ] 4.1 Add `test/` unit coverage for the override-revalidation branch: fulfillable override → carted with fresh price; unavailable override → checkpointed not carted; lapsed-promo override → carted with `on_sale: false`.
- [ ] 4.2 Run `aubr typecheck` and `aubr test`; run `npx openspec validate "thread-sale-sku-to-order"`.
