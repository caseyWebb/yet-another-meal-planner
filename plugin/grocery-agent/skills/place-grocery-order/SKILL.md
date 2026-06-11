---
name: place-grocery-order
description: "Flush the grocery list to the Kroger cart — the deliberate act distinct from capturing intent. Use for \"place the order\", \"send it to my cart\", \"I'm ready to order\", \"go ahead and order the groceries\". Stale-cart check → resolve/preview → flush → honest report. The only path that writes the cart (append-only, write-only)."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-cart` skills before continuing.

# Order placement

This is the **flush** — distinct from the menu request's capture. It may happen in the same sitting as a menu request or days later.

1. **Stale-cart check first.** Read the grocery list (`read_grocery_list`). If any items are still `in_cart` from a prior order that was never confirmed `ordered`, remind me to clear the Kroger cart manually before proceeding (silently flushing again double-adds). Wait for my acknowledgment.

2. **Resolve and preview.** Call `place_order(preview=true)` (optionally with `menu_needs` for needs not yet on the list). Surface, as one batch, anything that needs my decision before writing:
   - `checkpoint` items (`ambiguous` → pick from candidates; `unavailable` → offer `propose_substitutions`). Don't add these unilaterally.
   - `partials` — items the list/menu wants that the pantry already has. Tell me the plan's required amount (aggregated from `for_recipes`) and ask whether to buy more. Default buy is 1 package; never silently net partials against the order.
   - **Assumed quantities.** Any resolved line with `assumed_quantity: true` defaulted to 1 package — no count was given. The tool won't judge produce; *you* do. For by-the-each produce (peppers, tomatillos, onions, limes, …), read the recipe (`read_recipe`) for the required amount and set an explicit count via `menu_needs[].quantity` or `quantities` before the real flush — a recipe wanting 4 Anaheim peppers must not silently order 1. Items that genuinely need a single package (a head of cabbage, one jar) need no action. Pass quantities on the menu need itself; the `quantities` map is for overriding after this preview.

3. **Flush.** Once I've dispositioned the batch, call `place_order` for real — pass `overrides` for the items I picked SKUs for, `include_partials` for the partials I confirmed, `quantities` for anything beyond 1 package. Resolved items advance to `in_cart`.

4. **Report honestly.** `place_order` returns the cart write and SKU-cache commit independently. Never tell me the cart is populated when `cart.written` is false. If `cart.code` is `reauth_required`, the Kroger refresh token was rejected — tell me to re-run the one-time `/oauth/init?tenant=<me>` authorization; the resolution work is preserved. Remind me to review the cart in the Kroger app before checkout.

**Lifecycle past `in_cart` is user-asserted — never claim it on your own:**
- *"I placed the order"* → advance `in_cart` items to `ordered` (`update_grocery_list`).
- *"I picked up the groceries"* → `received` (terminal): `remove_from_grocery_list` for each, and for `grocery`-kind items only, restock the pantry (`update_pantry`). `household`/`other` items don't touch the pantry. Then, for the fresh perishables just received, offer a couple of storage tips following the **Putting groceries away** guidance.
