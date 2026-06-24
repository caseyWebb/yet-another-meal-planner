# Kroger Online — cart flush

This branch runs when my fulfillment mode is Kroger online. It may happen in the same sitting as a menu request or days later.

1. **Stale-cart check first.** If any items are still `in_cart` from a prior order that was never confirmed `ordered`, remind me to clear the Kroger cart manually before proceeding (silently flushing again double-adds). Wait for my acknowledgment.

2. **Ready-to-eat adds — restock + on-sale discovery (configured catalog).** If I've set up a ready-to-eat catalog, surface heat-and-eat buys for this order before resolving — never add unilaterally:
   - **Restock favorites.** Cross-reference `retrospective`'s `ready_to_eat_favorites` against pantry on-hand — for a favorite that's low/out, *suggest* a restock ("you're out of the frozen lasagna you keep reaching for — add it?").
   - **On-sale discovery.** Scan `kroger_flyer` for on-sale heat-and-eat / grab-and-go items not already in my catalog, and draft 1–2 worthwhile ones via `add_draft_ready_to_eat` (`source: "kroger-flyer"`).
   On my yes, add the item to the grocery list (or to `stockup.toml` for a conditional bulk buy) so the resolve/preview below picks it up. Skip entirely for an empty catalog.

3. **Resolve and preview.** Call `place_order(preview=true)` (optionally with `menu_needs` for needs not yet on the list). Surface, as one batch, anything that needs my decision before writing:
   - `checkpoint` items (`ambiguous` → pick from candidates; `unavailable` → enumerate a few sensible Kroger alternatives yourself from world knowledge and resolve each via `match_ingredient_to_kroger_sku` / `kroger_prices`, then let me pick). Don't add these unilaterally.
   - `partials` — items the list/menu wants that the pantry already has. Tell me the plan's required amount (aggregated from `for_recipes`) and ask whether to buy more. Default buy is 1 package; never silently net partials against the order.
   - **Assumed quantities.** Any resolved line with `assumed_quantity: true` defaulted to 1 package — no count was given. The tool won't judge produce; *you* do. For by-the-each produce (peppers, tomatillos, onions, limes, …), read the recipe (`read_recipe`) for the required amount and set an explicit count via `menu_needs[].quantity` or `quantities` before the real flush — a recipe wanting 4 Anaheim peppers must not silently order 1. Items that genuinely need a single package (a head of cabbage, one jar) need no action.

4. **Flush.** Once I've dispositioned the batch, call `place_order` for real — pass `overrides` for the items I picked SKUs for, `include_partials` for the partials I confirmed, `quantities` for anything beyond 1 package. Resolved items advance to `in_cart`.

5. **Report honestly.** `place_order` returns the cart write and SKU-cache commit independently. Never tell me the cart is populated when `cart.written` is false. If `cart.code` is `reauth_required`, the Kroger refresh token was rejected — tell me to re-run the one-time `/oauth/init?tenant=<me>` authorization; the resolution work is preserved. Remind me to review the cart in the Kroger app before checkout.

**Lifecycle past `in_cart` is user-asserted — never claim it on your own:**
- *"I placed the order"* → advance `in_cart` items to `ordered` (`update_grocery_list`).
- *"I picked up the groceries"* → `received` (terminal): remove the picked items with `remove_from_grocery_list` (one per item, awaited — they share the list blob) and — for `grocery`-kind items only — restock the pantry in one `update_pantry({ operations: [...] })` (all the add ops together). `household`/`other` items don't touch the pantry. Then, for the fresh perishables just received, offer a couple of storage tips following the **Putting groceries away** guidance.
