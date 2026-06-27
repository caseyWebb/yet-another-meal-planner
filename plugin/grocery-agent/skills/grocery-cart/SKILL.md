---
name: grocery-cart
description: "Internal shared rules for the grocery agent, loaded by reference from the workflow skills (via their prerequisite line). Not invoked on its own."
user-invocable: false
---

## The grocery list and the cart

Capture buy-intent onto the **grocery list** continuously, as it comes up; **flush it once**, at order time. The flush has **two forms**, picked by my fulfillment mode (`preferences.stores.primary`) — **don't assume Kroger**:

- **Kroger online** (`primary: kroger`) — flush to the Kroger cart with `place_order`.
- **Kroger in-store** — walk with API-driven aisle ordering.
- **In-store walk** (`primary` is a store slug from `stores/`) — turn the list into a shopping list grouped for that store and walk it. Naming a store for one trip ("I'm going to the West 7th Tom Thumb") picks the walk for that trip only.

All three flush paths are handled by the `shop-groceries` flow.

**Capture is identical either way** — the grocery list is SKU-free and store-agnostic; only the flush differs. Flush only when I say to (order / go shopping) — if I just mention I'm out of something, add it to the list for next time, don't flush. When something runs low or out, *ask* before putting it on the list (the prompt is the point — don't auto-add). Household / non-food items belong on the list too.

**Persist multi-write turns with the granular tools.** When resolving a single turn produces more than one write — several grocery items at once, a menu's recipes-plus-grocery-items, a receive's removes-plus-pantry-restock — each write goes through its own tool (`add_to_grocery_list` / `update_grocery_list` / `remove_from_grocery_list` for the list, `update_pantry` for the pantry, `toggle_favorite` / `toggle_reject` / `update_recipe` for recipes, `log_cooked` for a cook). There is no batch tool; a multi-write turn is just several granular calls. Session state — grocery list, pantry, meal plan — is stored as **D1 rows** now: each write touches only its own row, so concurrent writes to different items don't collide and there's no whole-file overwrite to drop items. Where a single tool takes many ops (`update_pantry({ operations: […] })`) still pass them in one call (it's one round-trip), but you no longer have to serialize writes at the same store.

The Kroger cart is **write-only** — you can add to it, but not remove or check out. So never tell me something was taken out of the cart; report what should change and tell me to fix it in the Kroger app.

**Substitutions are never automatic.** Inventory subs (recipe wants salmon, I've got trout) are your judgment over the loaded pantry — surface them during the pantry pass for me to confirm. Sale subs (salmon's on the menu, trout's on sale) come up with the proposal: enumerate the substitute candidates yourself from world knowledge and price them via the Kroger tools. When an item comes back `unavailable`, name a few sensible Kroger alternatives and let me pick — never apply a swap on your own.

## Picking what to buy — purchasing tips

When I'm shopping a list — building the cart or walking the aisles — surface a couple of buying tips for the things where *which one I grab* actually matters: olive oil, canned tomatoes, a good cut of meat, picking ripe produce. The advice is curated, not improvised: it lives in the `purchasing` domain of the shared `guidance/` tree — the buy-side sibling of storage guidance, surfaced at the *pick* end of the trip rather than the put-away end.

- Call `list_guidance("purchasing")` to see what's covered, then map the things on my list to the right entries with your **own** knowledge of the items (a "canned tomatoes" line → `canned-tomatoes`, "olive oil" → `olive-oil`, "peaches" → `stone-fruit`). There's no lookup table — just pick the slugs that fit.
- `read_guidance("purchasing", [...])` the ones you picked and surface **2–3 relevant, non-obvious tips**, woven in **where I'll act on them**: at the shelf as I reach each item on a walk, or with the grouped list when there's no walk to pace against (an unmapped department list, or the online cart review). Skip the obvious.
- **Only ever give vetted advice.** If something on my list has no matching entry, say nothing about it — don't invent a tip. A contested or folklore tip (ripeness lore especially) is relayed *with* its hedge, never as settled fact.
- **Narration only.** This informs *me* at the shelf; it never changes what gets matched or ordered — never silently swap a SKU or write a brand preference off the back of a tip. If I settle on a go-to ("always the Cento Certified"), that's a brand preference I have to voice (`update_preferences`), not something you infer from a guide.
- Don't nag. A light touch on the items with a genuinely non-obvious call — not a tip on every line, and not the same tip every trip.

## Putting groceries away — storage tips

When fresh perishables newly enter my kitchen — whether I just picked up an order (the `received` restock) or hauled produce back from the farmers market (an `update_pantry` add) — offer me a couple of storage tips so less of it goes bad. The advice is curated, not improvised: it lives in the `ingredient_storage` domain of the shared `guidance/` tree.

- Call `list_guidance("ingredient_storage")` to see the available classes, then map what I just bought to the right class(es) with your **own** knowledge of the items (cilantro → `tender-herbs`, yellow onions → `alliums`, a clamshell of strawberries → `berries-grapes`). There's no lookup table — just pick the slugs that fit, plus `_ethylene` when I bought things that shouldn't be stored together.
- `read_guidance("ingredient_storage", [...])` the ones you picked and surface **2–3 relevant, non-obvious tips** — the things actually worth saying for *this* haul, not a recital. Skip the obvious ("keep milk cold").
- **Only ever give vetted advice.** If something I bought has no matching class file, say nothing about it — don't invent a tip. If a tip is written with a hedge ("some cooks rinse berries in vinegar — results vary"), relay it *with* the hedge; never assert folklore as settled fact.
- Don't nag. If you gave a tip recently, or it's a staple I clearly already know how to store, let it go — a light, occasional touch, not a lecture every trip.
